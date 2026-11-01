// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One Keeper device on the Link network. Owns the endpoint other devices and
// phones connect to, finds paired devices (local network, tunnel, relay,
// mailbox notes), runs pairing, and answers requests within each device's
// permissions. Plain Node, no Electron: the app wraps it (index.ts) and the
// tests run two of them side by side.

import crypto from 'node:crypto';
import { createReadStream, promises as fsp, realpathSync } from 'node:fs';
import http from 'node:http';
import type net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { CompanionInvite, Forward, LinkDevice, LinkSettings, LinkShare, LinkState, NearbyDevice, PairInvite, PairPrompt, RemoteEntry, ThisDevice, TunnelStatus } from '../../../core/api-link';
import { initiate, respond, type CarrierKind, type Session, type Wire, reader, dec } from '../../../core/link/channel';
import { addEntry, filterAudit, type AuditEntry, type AuditFilter } from '../../../core/link/audit';
import { cleanMeta, type DeviceMeta } from '../../../core/link/fleet';
import { HELP_ALLOWED_RPC, HELP_ALLOWED_STREAMS } from '../../../core/link/help';
import { asCarrier, decodeHello, encodeHello, firstMessage, prepend, Resumable } from '../../../core/link/resume';
import { COMPANION_CHUNK, companionKeys, fromB64u, inviteId, Opener, Sealer, toB64u, type CHeader } from '../../../core/link/companion-proto';
import { answerTcp, bridge, forwardPort, socksProxy } from '../../../core/link/forward';
import { deviceId, fingerprint, identityFromJson, identityToJson, newIdentity, type Identity } from '../../../core/link/identity';
import { DEFAULT_MAILBOX, postNote, readNotes, type Reach } from '../../../core/link/mailbox';
import { call, Mux, serve, type Handler, type Stream } from '../../../core/link/mux';
import { newPairCode, newPairSecret, pairAsHost, pairAsJoiner, type PairResult } from '../../../core/link/pair';
import { allowed, DEFAULT_PERMISSIONS, forwardTargetAllowed, METHOD_PERMISSION, type Permission, type PermissionSet } from '../../../core/link/perms';
import { relayDial, relayListen, relayOnline } from '../../../core/link/relay';
import { Receiver, safeName, sendFile, uniquePath, type Offer, type Progress } from '../../../core/link/transfer';
import { acceptWebSocket, connectWs, type WsServerConn } from '../../../core/link/ws';
import { DirectPaths } from './direct';
import { HelpSessions } from './help';
import { lanIPv4, MdnsPeer, wireguardInterfaces } from './mdns-socket';

export const DEFAULT_PORT = 47821;

export const DEFAULT_LINK_SETTINGS: LinkSettings = {
  mode: 'lan',
  localOnly: false,
  port: DEFAULT_PORT,
  relayUrl: '',
  mailbox: DEFAULT_MAILBOX,
  stun: ['stun:stun.cloudflare.com:3478'],
  downloadDir: '',
  clipboardSync: false,
  forwardLan: false,
  shares: [],
};

interface StoredDevice {
  id: string;
  pub: string;
  name: string;
  os: string;
  pairSecret: string;
  perms: PermissionSet;
  autoAccept: boolean;
  pairedAt: number;
  lastSeen?: number;
  reach?: Partial<Reach>;
}

interface StoredCompanion {
  id: string;
  name: string;
  key: string;
  created: number;
  lastSeen?: number;
  /** this phone may open a terminal here (off unless turned on under Phones) */
  terminal?: boolean;
}

interface StoredForward {
  id: string;
  device: string;
  kind: 'port' | 'socks';
  localPort: number;
  host?: string;
  port?: number;
}

export interface LinkData {
  version: 1;
  name: string;
  /** only when the system keychain is not available */
  identity?: { pub: string; priv: string };
  settings: LinkSettings;
  devices: StoredDevice[];
  companions: StoredCompanion[];
  forwards: StoredForward[];
  /** groups, tags, notes and saved commands per paired device */
  meta?: Record<string, DeviceMeta>;
  /** commands the owner has seen and allowed once, per device (hashes) */
  approved?: Record<string, string[]>;
  /** newest first: sessions, transfers, commands, terminals, help */
  audit?: AuditEntry[];
}

export interface LinkHooks {
  load(): Promise<LinkData | null>;
  save(d: LinkData): Promise<void>;
  getSecret(name: string): Promise<string | undefined>;
  setSecret(name: string, value: string): Promise<boolean>;
  /** something on the Devices page should refresh */
  changed(): void;
  transfer(p: Progress): void;
  /** show the six digits; the answer comes back through confirmPair */
  pairPrompt(p: PairPrompt): void;
  /** a device offers files; answer with answerOffer, or it is declined after a while */
  offer(o: { id: string; from: string; fromName: string; name: string; size: number }): void;
  /** a phone asks to join */
  approveCompanion(name: string): Promise<boolean>;
  notify(title: string, body: string): void;
  clipboard: { read(): string | Promise<string>; write(text: string): unknown };
  downloads(): string;
  /** where the companion page's files are */
  companionDir(): string;
  qr(text: string): Promise<string>;
  tunnel(): TunnelStatus | undefined;
  /** may the device look for a direct path now (feature on, work not held) */
  directAllowed?(): boolean;
  /** a help session started or ended (for the window and the banner) */
  helpChanged?(): void;
}

interface Conn {
  mux: Mux;
  kind: CarrierKind;
  where?: string;
  since: number;
  rtt?: number;
  /** the connection survives carrier changes (relay → direct → back) */
  res?: Resumable;
  /** this device dialled: it is the one that looks for a better path */
  initiator: boolean;
  directTries: number;
  directTimer?: NodeJS.Timeout;
}

/** A one-time help connection (no pairing, no trust kept). */
export interface Guest {
  id: string;
  mux: Mux;
  name: string;
  /** host: they help me; helper: I help them */
  role: 'host' | 'helper';
  kind: CarrierKind;
  since: number;
}

type ExtraHandler = { perm: Permission | null; fn: Handler };
type StreamHandler = { perm: Permission | null; fn: (st: Stream, device: string) => void };
/** A companion request handled outside Link (e.g. screen viewing); `cid` is the paired phone. */
export type CompanionOp = (h: CHeader, body: Uint8Array, cid: string) => Promise<{ r: unknown; body?: Uint8Array }>;

export class LinkNode {
  data!: LinkData;
  me!: Identity;
  keyProtected = false;
  private server: http.Server | null = null;
  private sockets = new Set<import('node:net').Socket>();
  port = 0;
  private mdns = new MdnsPeer();
  private conns = new Map<string, Conn[]>();
  private dialing = new Map<string, Promise<Conn>>();
  private transfers = new Map<string, Progress>();
  private receiver: Receiver;
  private offers = new Map<string, { resolve: (ok: boolean) => void; device: string; offer: Offer }>();
  private pairWaits = new Map<string, (ok: boolean) => void>();
  private invite: { code: string; secret: string; expires: number; misses: number } | null = null;
  private forwards = new Map<string, { srv?: net.Server; error?: string }>();
  private relayCtl: Wire | null = null;
  private relayState: { connected: boolean; error?: string } = { connected: false };
  private relayRetry = 0;
  private relayTimer?: NodeJS.Timeout;
  private noteTimer?: NodeJS.Timeout;
  private lastNote = '';
  private companionInvites = new Map<string, { secret: Uint8Array; expires: number }>();
  private companionsOnline = new Set<string>();
  private extraRpc = new Map<string, ExtraHandler>();
  private extraStreams = new Map<string, StreamHandler>();
  private extraCompanion = new Map<string, CompanionOp>();
  private extraControl = new Map<string, (p: Record<string, unknown>) => Promise<unknown> | unknown>();
  readonly guests = new Map<string, Guest>();
  readonly direct: DirectPaths;
  readonly help: HelpSessions;
  private stopped = false;
  tunnelUrl?: string;

  constructor(private hooks: LinkHooks, readonly opts: { hostname?: string; os?: string; mdns?: boolean; controlToken?: string; noLanDial?: boolean; directLoopback?: boolean } = {}) {
    this.receiver = new Receiver(() => this.downloadDir(), () => path.join(this.downloadDir(), '.keeper-partial'));
    this.direct = new DirectPaths(this);
    this.help = new HelpSessions(this);
  }

  /** @internal for DirectPaths and HelpSessions */
  get mdnsPeer() {
    return this.mdns;
  }

  /** @internal */
  get linkHooks() {
    return this.hooks;
  }

  // ---------------------------------------------------------------- start / stop

  async start() {
    const loaded = await this.hooks.load();
    this.data = {
      version: 1,
      name: loaded?.name || defaultName(this.opts.hostname),
      identity: loaded?.identity,
      settings: { ...DEFAULT_LINK_SETTINGS, ...(loaded?.settings ?? {}), shares: [...(loaded?.settings?.shares ?? [])], stun: [...(loaded?.settings?.stun ?? DEFAULT_LINK_SETTINGS.stun)] },
      devices: loaded?.devices ?? [],
      companions: loaded?.companions ?? [],
      forwards: loaded?.forwards ?? [],
    };
    await this.loadIdentity();
    await this.listen();
    for (const f of this.data.forwards) void this.startForward(f);
    void this.startRelay();
    this.scheduleNote(2000);
  }

  private async loadIdentity() {
    const fromKeychain = await this.hooks.getSecret('link.identity');
    if (fromKeychain) {
      this.me = identityFromJson(JSON.parse(fromKeychain));
      this.keyProtected = true;
      return;
    }
    if (this.data.identity) {
      this.me = identityFromJson(this.data.identity);
      // Move it into the keychain when that has become available.
      if (await this.hooks.setSecret('link.identity', JSON.stringify(this.data.identity))) {
        this.keyProtected = true;
        delete this.data.identity;
        await this.save();
      }
      return;
    }
    this.me = newIdentity();
    const j = identityToJson(this.me);
    if (await this.hooks.setSecret('link.identity', JSON.stringify(j))) this.keyProtected = true;
    else this.data.identity = j;
    await this.save();
  }

  get id() {
    return deviceId(this.me.publicKey);
  }

  private closeServer(): Promise<void> {
    const srv = this.server;
    this.server = null;
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    return new Promise<void>((r) => (srv ? srv.close(() => r()) : r()));
  }

  async stop() {
    this.stopped = true;
    this.help.stop('Keeper is closing');
    for (const g of this.guests.values()) g.mux.close('stopping');
    for (const list of this.conns.values()) for (const c of list) clearTimeout(c.directTimer);
    this.direct.stop();
    clearTimeout(this.relayTimer);
    clearTimeout(this.noteTimer);
    this.relayCtl?.close('stopping');
    this.mdns.stop();
    for (const list of this.conns.values()) for (const c of list) c.mux.close('stopping');
    for (const f of this.forwards.values()) f.srv?.close();
    await this.closeServer();
  }

  private save() {
    return this.hooks.save(this.data);
  }

  private downloadDir() {
    return this.data.settings.downloadDir || path.join(this.hooks.downloads(), 'Keeper');
  }

  /** Re-applies network settings: endpoint, local discovery, relay. */
  private async restartNetwork() {
    await this.closeServer();
    this.mdns.stop();
    this.relayCtl?.close('settings changed');
    await this.listen();
    void this.startRelay();
    this.scheduleNote(500);
  }

  private bindHost(): string | null {
    const s = this.data.settings;
    if (s.mode === 'off') return null;
    return '0.0.0.0';
  }

  private async listen() {
    const host = this.bindHost();
    if (!host) {
      this.port = 0;
      return;
    }
    const server = http.createServer((req, res) => void this.http(req, res));
    server.on('connection', (sock) => {
      this.sockets.add(sock);
      sock.on('close', () => this.sockets.delete(sock));
    });
    server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
    const tryPort = (p: number) =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(p, host, () => {
          server.off('error', reject);
          resolve((server.address() as net.AddressInfo).port);
        });
      });
    try {
      this.port = await tryPort(this.data.settings.port || DEFAULT_PORT);
    } catch {
      this.port = await tryPort(0);
    }
    this.server = server;
    if (this.opts.mdns !== false) {
      this.mdns.onfound = () => this.hooks.changed();
      await this.mdns.start(() => ({ id: this.id, name: this.data.name, port: this.port, host: `keeper-${this.id.slice(0, 8)}`, addresses: lanIPv4(), pairing: !!this.invite && this.invite.expires > Date.now(), os: this.opts.os ?? process.platform, help: this.help.tag() }));
    }
  }

  // ---------------------------------------------------------------- the endpoint

  private async http(req: http.IncomingMessage, res: http.ServerResponse) {
    const u = new URL(req.url ?? '/', 'http://x');
    const send = (code: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra });
      res.end(body);
    };
    if (u.pathname === '/link/ping') return send(200, 'application/json', JSON.stringify({ keeper: 1, id: this.id }));
    if (u.pathname.startsWith('/local/')) return this.control(req, u.pathname.slice(7), send);
    if (u.pathname === '/c' || u.pathname === '/c/') {
      const html = await fsp.readFile(path.join(this.hooks.companionDir(), 'index.html'), 'utf8').catch(() => null);
      if (!html) return send(404, 'text/plain', 'The companion page is not built');
      return send(200, 'text/html; charset=utf-8', html, { 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' blob: data:; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
    }
    const asset = u.pathname.match(/^\/c\/(app\.js|manifest\.webmanifest|icon\.png)$/);
    if (asset) {
      const f = await fsp.readFile(path.join(this.hooks.companionDir(), asset[1])).catch(() => null);
      if (!f) return send(404, 'text/plain', 'not found');
      const type = asset[1].endsWith('.js') ? 'text/javascript' : asset[1].endsWith('.png') ? 'image/png' : 'application/manifest+json';
      return send(200, type, f);
    }
    send(404, 'text/plain', 'Keeper');
  }

  /**
   * The keeper command on this computer: loopback only, never through the
   * tunnel, and only with the token in Keeper's data folder (readable by this
   * user alone).
   */
  private async control(req: http.IncomingMessage, op: string, send: (code: number, type: string, body: string) => void) {
    const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    const token = this.opts.controlToken;
    const given = String(req.headers['x-keeper-token'] ?? '');
    const local = (remote === '127.0.0.1' || remote === '::1') && !req.headers['cf-ray'] && !req.headers['cf-connecting-ip'] && !req.headers.origin;
    if (!token || !local || req.method !== 'POST' || given.length !== token.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))) return send(403, 'text/plain', 'no');
    let body = '';
    for await (const c of req) {
      body += c;
      if (body.length > 1_000_000) return send(413, 'text/plain', 'too large');
    }
    let p: Record<string, unknown> = {};
    try {
      p = body ? JSON.parse(body) : {};
    } catch {
      return send(400, 'text/plain', 'bad json');
    }
    const ok = (r: unknown) => send(200, 'application/json', JSON.stringify({ ok: true, r }));
    try {
      const dev = (x: unknown) => {
        const q = String(x ?? '').toLowerCase();
        const d = this.data.devices.find((y) => y.id === q || y.name.toLowerCase() === q || y.name.toLowerCase().replace(/\s+/g, '-') + '.keeper' === q);
        if (!d) throw new Error(`No paired device called ${String(x)}`);
        return d.id;
      };
      switch (op) {
        case 'state':
          return ok(this.state());
        case 'invite':
          return ok(await this.createInvite());
        case 'pair':
          return ok(await this.pair(p as { code?: string; address?: string; link?: string }));
        case 'send':
          await this.sendFiles(dev(p.device), (p.paths as string[]).map(String));
          return ok(true);
        case 'check':
          return ok(await this.check(dev(p.device)));
        case 'forward':
          return ok(await this.addForward({ device: dev(p.device), kind: p.kind === 'socks' ? 'socks' : 'port', localPort: Number(p.localPort), host: p.host ? String(p.host) : undefined, port: p.port ? Number(p.port) : undefined }));
        default: {
          const extra = this.extraControl.get(op);
          if (!extra) return send(404, 'text/plain', 'unknown');
          return ok(await extra({ ...p, device: p.device !== undefined && !String(p.device).startsWith('help:') ? dev(p.device) : p.device }));
        }
      }
    } catch (e) {
      return send(200, 'application/json', JSON.stringify({ ok: false, e: e instanceof Error ? e.message : String(e) }));
    }
  }

  private upgrade(req: http.IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) {
    const u = new URL(req.url ?? '/', 'http://x');
    const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    const viaTunnel = !!req.headers['cf-connecting-ip'] || !!req.headers['cf-ray'];
    const kind: CarrierKind = viaTunnel ? 'tunnel' : remote === '127.0.0.1' || remote === '::1' ? 'local' : 'lan';
    // Over the tunnel only when internet mode is on.
    if (viaTunnel && (this.data.settings.mode !== 'internet' || this.data.settings.localOnly)) return void socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    if (u.pathname === '/local/pipe') return void this.localPipe(req, socket, head, u);
    if (u.pathname === '/link') {
      const ws = acceptWebSocket(req, socket, head, kind, viaTunnel ? 'tunnel' : remote);
      if (ws) void this.incoming(ws);
      return;
    }
    if (u.pathname === '/c/ws') {
      const ws = acceptWebSocket(req, socket, head, kind, viaTunnel ? 'tunnel' : remote);
      if (ws) this.companion(ws);
      return;
    }
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
  }

  /** A device connected to us (local network, tunnel, relay). */
  private async incoming(wire: Wire) {
    const rd = reader(wire);
    let first: Uint8Array;
    try {
      first = await rd.next(15_000);
    } catch {
      return wire.close('timeout');
    }
    const m = dec(first);
    if (m.t === 'p1') return void this.hostPairing(wire, first);
    if (m.t === 'hp1') return void this.help.answer(wire, first);
    if (m.t !== 'h1') return wire.close('not keeper');
    try {
      const session = await respond(wire, this.me, (pub) => this.data.devices.some((d) => d.pub === pub.toString('base64')), 15_000, first);
      const dev = this.byPub(session.peer);
      if (!dev) return session.close('unknown');
      await this.answered(dev.id, session);
    } catch {
      wire.close('refused');
    }
  }

  /**
   * The answering side of a new session: a hello either starts a resumable
   * connection or moves an existing one onto this path (a direct path that
   * was just found, or the way back after one failed).
   */
  private async answered(device: string, session: Session) {
    const first = await firstMessage(session, 8000);
    const h = first ? decodeHello(first) : null;
    if (!h) {
      // An older Keeper: a plain connection.
      this.attach(device, new Mux(first ? prepend(session, first) : session, false), session.wire.kind, session.wire.where, undefined, false);
      return;
    }
    const existing = (this.conns.get(device) ?? []).find((c) => c.res?.id === h.id && !c.mux.closed);
    if (existing?.res) {
      session.send(encodeHello({ v: 1, id: h.id, recv: existing.res.received }));
      existing.res.adopt(session, h.recv);
      this.hooks.changed();
      return;
    }
    const res = new Resumable(h.id);
    session.send(encodeHello({ v: 1, id: h.id, recv: 0 }));
    res.adopt(session, h.recv);
    this.attach(device, new Mux(asCarrier(res), false), session.wire.kind, session.wire.where, res, false);
  }

  /** The calling side: starts (or, with `res`, moves) a resumable connection on a new session. */
  async hello(session: Session, res?: Resumable, timeoutMs = 4000): Promise<{ res?: Resumable; carrier: import('../../../core/link/mux').Carrier }> {
    const r = res ?? new Resumable();
    session.send(encodeHello({ v: 1, id: r.id, recv: r.received }));
    const first = await firstMessage(session, timeoutMs);
    const h = first ? decodeHello(first) : null;
    if (h && h.id === r.id) {
      r.adopt(session, h.recv);
      return { res: r, carrier: asCarrier(r) };
    }
    if (res) throw new Error('The other device did not take the new path');
    return { carrier: first ? prepend(session, first) : session };
  }

  /** @internal a wire that reached us some other way (a direct path, a help relay) */
  acceptWire(wire: Wire) {
    return this.incoming(wire);
  }

  private byPub(pub: Buffer) {
    const b = pub.toString('base64');
    return this.data.devices.find((d) => d.pub === b);
  }

  private attach(device: string, mux: Mux, kind: CarrierKind, where: string | undefined, res: Resumable | undefined, initiator: boolean): Conn {
    const c: Conn = { mux, kind, where, since: Date.now(), res, initiator, directTries: 0 };
    if (res) {
      res.onpath = () => this.hooks.changed();
      // Every path gone: the calling side dials again and resumes; the other side waits for that.
      res.ondetached = () => {
        if (initiator && !this.stopped) void this.resumeConn(device, c).catch(() => undefined);
      };
    }
    const list = this.conns.get(device) ?? [];
    list.push(c);
    this.conns.set(device, list);
    const dev = this.data.devices.find((d) => d.id === device);
    if (dev) {
      dev.lastSeen = Date.now();
      void this.save();
    }
    mux.onstream = (st) => this.stream(device, st);
    this.direct.consider(device, c);
    mux.onclose = () => {
      clearTimeout(c.directTimer);
      const l = (this.conns.get(device) ?? []).filter((x) => x !== c);
      if (l.length) this.conns.set(device, l);
      else this.conns.delete(device);
      this.hooks.changed();
    };
    this.hooks.changed();
    return c;
  }

  // ---------------------------------------------------------------- requests from other devices

  /** For features built on Link (remote screen, sync): extra requests and stream kinds. */
  registerRpc(method: string, perm: Permission | null, fn: Handler) {
    this.extraRpc.set(method, { perm, fn });
  }

  registerStream(kind: string, perm: Permission | null, fn: (st: Stream, device: string) => void) {
    this.extraStreams.set(kind, { perm, fn });
  }

  /** For features built on Link: extra requests a paired phone may make on its companion channel. */
  registerCompanionOp(op: string, fn: CompanionOp) {
    this.extraCompanion.set(op, fn);
  }

  /** Where files sent from other devices and phones are saved. */
  receivedDir(): string {
    return this.downloadDir();
  }

  /** A paired phone's name, for prompts. */
  companionName(cid: string): string | undefined {
    return this.data.companions.find((c) => c.id === cid)?.name;
  }

  private permsOf(device: string): PermissionSet {
    return this.data.devices.find((d) => d.id === device)?.perms ?? {};
  }

  /** For features built on Link: extra operations the keeper command may ask for. */
  registerControl(op: string, fn: (p: Record<string, unknown>) => Promise<unknown> | unknown) {
    this.extraControl.set(op, fn);
  }

  /** Name and permissions of whoever is on the other end: a paired device or a help guest. */
  peer(device: string): { id: string; name: string; os: string; permissions: PermissionSet; help?: 'host' | 'helper' } | null {
    const g = this.guests.get(device);
    if (g) return { id: g.id, name: g.name, os: '', permissions: g.role === 'host' ? { screenView: true, screenControl: true } : {}, help: g.role };
    const d = this.data.devices.find((x) => x.id === device);
    return d ? { id: d.id, name: d.name, os: d.os, permissions: d.perms } : null;
  }

  /** @internal a help connection is up */
  addGuest(g: Guest) {
    this.guests.set(g.id, g);
    g.mux.onstream = (st) => this.stream(g.id, st);
    g.mux.onclose = () => {
      this.guests.delete(g.id);
      this.hooks.helpChanged?.();
      this.hooks.changed();
    };
    this.hooks.helpChanged?.();
    this.hooks.changed();
  }

  private stream(device: string, st: Stream) {
    const k = String(st.meta.k ?? '');
    if (this.guests.has(device)) {
      // Help: the screen and nothing else. No files, terminal, commands or ports.
      const g = this.guests.get(device)!;
      if (k === 'rpc') {
        const m = String(st.meta.m ?? '');
        const extra = this.extraRpc.get(m);
        if (!HELP_ALLOWED_RPC.has(m)) return void serve(st, { [m]: () => { throw new Error('Not in a help session'); } });
        return void serve(st, { hello: () => ({ name: this.data.name, os: this.opts.os ?? process.platform }), ping: () => ({ t: Date.now() }), ...(extra ? { [m]: extra.fn } : {}) });
      }
      const extra = this.extraStreams.get(k);
      if (g.role === 'host' && extra && HELP_ALLOWED_STREAMS.has(k)) return extra.fn(st, device);
      if (g.role === 'helper' && extra && k === 'screen.frames') return extra.fn(st, device);
      return st.reset('not allowed');
    }
    const perms = this.permsOf(device);
    if (k === 'rpc') {
      const m = String(st.meta.m ?? '');
      const extra = this.extraRpc.get(m);
      const ok = extra ? extra.perm === null || !!perms[extra.perm] : allowed(perms, m);
      if (!ok) return void serve(st, { [m]: () => { throw new Error(m in METHOD_PERMISSION || extra ? 'This device does not allow that' : `Unknown request ${m}`); } });
      // The handler learns which device asked as $device (set here, never taken from the request).
      if (extra) return void serve(st, { [m]: (p, s2) => extra.fn({ ...p, $device: device }, s2) });
      return void serve(st, this.handlers(device));
    }
    if (k === 'file') {
      if (!perms.sendFiles) return st.reset('not allowed');
      return void this.receiver.receive(st, (p) => this.progress({ ...p, peer: device }));
    }
    if (k === 'tcp') {
      if (!perms.forward) return st.reset('not allowed');
      return answerTcp(st, (h) => forwardTargetAllowed(h, { lan: this.data.settings.forwardLan }));
    }
    if (k === 'fsread') {
      if (!perms.browse) return st.reset('not allowed');
      return void this.streamShareFile(st);
    }
    const extra = this.extraStreams.get(k);
    if (extra && (extra.perm === null || perms[extra.perm])) return extra.fn(st, device);
    st.reset('not allowed');
  }

  private handlers(device: string): Record<string, Handler> {
    const dev = () => this.data.devices.find((d) => d.id === device);
    return {
      hello: (p) => {
        const d = dev();
        if (d && p.reach && typeof p.reach === 'object') {
          d.reach = { ...d.reach, ...(p.reach as Reach) };
          void this.save();
        }
        return { name: this.data.name, os: this.opts.os ?? process.platform, reach: this.reach() };
      },
      ping: () => ({ t: Date.now() }),
      'xfer.offer': async (p) => {
        const offer: Offer = { id: String(p.id), name: safeName(String(p.name)), size: Number(p.size) || 0, mtime: Number(p.mtime) || undefined };
        const d = dev();
        const ok = d?.autoAccept ? true : await this.askOffer(device, offer);
        if (!ok) return { accept: false, reason: 'The other device declined the file' };
        return this.receiver.accept(offer);
      },
      'fs.shares': () => this.data.settings.shares.map((s) => ({ id: s.id, name: s.name })),
      'fs.list': async (p) => {
        const dir = await this.resolveShared(String(p.share), String(p.dir ?? ''));
        const ents = await fsp.readdir(dir, { withFileTypes: true });
        const out: RemoteEntry[] = [];
        for (const e of ents.slice(0, 5000)) {
          if (e.isSymbolicLink()) continue;
          const st = await fsp.stat(path.join(dir, e.name)).catch(() => null);
          if (!st) continue;
          out.push({ name: e.name, isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs });
        }
        return out;
      },
      'fs.stat': async (p) => {
        const f = await this.resolveShared(String(p.share), String(p.path ?? ''));
        const st = await fsp.stat(f);
        return { isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs };
      },
      'fs.mkdir': async (p) => {
        await fsp.mkdir(await this.resolveShared(String(p.share), String(p.path), true));
        return true;
      },
      'fs.rename': async (p) => {
        await fsp.rename(await this.resolveShared(String(p.share), String(p.from)), await this.resolveShared(String(p.share), String(p.to), true));
        return true;
      },
      'fs.remove': async (p) => {
        const f = await this.resolveShared(String(p.share), String(p.path));
        const root = this.share(String(p.share)).path;
        if (path.resolve(f) === path.resolve(root)) throw new Error('The shared folder itself cannot be removed');
        await fsp.rm(f, { recursive: true });
        return true;
      },
      'clip.set': async (p) => {
        await this.hooks.clipboard.write(String(p.text ?? '').slice(0, 1_000_000));
        return true;
      },
      'clip.get': async () => ({ text: await this.hooks.clipboard.read() }),
    };
  }

  private share(id: string): LinkShare {
    const s = this.data.settings.shares.find((x) => x.id === id);
    if (!s) throw new Error('That folder is not shared');
    return s;
  }

  /** A path inside a shared folder, or an error: never outside it, not through links. */
  private async resolveShared(share: string, rel: string, mayNotExist = false): Promise<string> {
    const root = realpathSync(this.share(share).path);
    const target = path.resolve(root, '.' + path.sep + rel.replace(/\\/g, '/').replace(/^\/+/, ''));
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Outside the shared folder');
    const check = mayNotExist ? path.dirname(target) : target;
    const real = await fsp.realpath(check);
    if (real !== root && !real.startsWith(root + path.sep)) throw new Error('Outside the shared folder');
    return target;
  }

  private async streamShareFile(st: Stream) {
    try {
      const f = await this.resolveShared(String(st.meta.share), String(st.meta.path));
      const offset = Math.max(0, Number(st.meta.offset) || 0);
      st.ondata = () => undefined;
      void st.start();
      for await (const c of createReadStream(f, { start: offset, highWaterMark: 256 * 1024 })) await st.write(c as Buffer);
      st.end();
    } catch (e) {
      st.reset(e instanceof Error ? e.message : 'could not read');
    }
  }

  private askOffer(device: string, offer: Offer): Promise<boolean> {
    const id = crypto.randomUUID();
    const dev = this.data.devices.find((d) => d.id === device);
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.offers.delete(id);
        resolve(false);
      }, 5 * 60_000);
      this.offers.set(id, { device, offer, resolve: (ok) => { clearTimeout(t); this.offers.delete(id); resolve(ok); } });
      this.hooks.offer({ id, from: device, fromName: dev?.name ?? 'A device', name: offer.name, size: offer.size });
    });
  }

  answerOffer(id: string, accept: boolean, always = false) {
    const o = this.offers.get(id);
    if (!o) return;
    if (accept && always) {
      const d = this.data.devices.find((x) => x.id === o.device);
      if (d) {
        d.autoAccept = true;
        void this.save();
      }
    }
    o.resolve(accept);
  }

  private progress(p: Progress) {
    this.transfers.set(`${p.direction}:${p.id}`, p);
    if (this.transfers.size > 40) this.transfers.delete(this.transfers.keys().next().value!);
    this.hooks.transfer(p);
    if ((p.state === 'done' || p.state === 'failed' || p.state === 'declined') && p.peer) {
      const name = this.peer(p.peer)?.name ?? p.peer;
      this.audit({ kind: 'transfer', direction: p.direction === 'send' ? 'out' : 'in', device: p.peer, deviceName: name, title: `${p.direction === 'send' ? 'Sent' : 'Received'} ${p.name}`, detail: `${p.size} bytes${p.state !== 'done' ? ` · ${p.error ?? p.state}` : ''}${this.carrierOf(p.peer) ? ` · ${this.carrierOf(p.peer)}` : ''}`, ok: p.state === 'done' });
    }
    if (p.state === 'done' && p.direction === 'receive') this.hooks.notify(`Received ${p.name}`, `Saved in ${path.dirname(p.savedAs ?? this.downloadDir())}`);
  }

  // ---------------------------------------------------------------- reaching a device

  /** How other devices can reach this one right now. */
  reach(): Reach {
    const s = this.data.settings;
    const r: Reach = { at: Date.now() };
    if (s.mode !== 'off' && this.port) r.lan = lanIPv4().map((ip) => `${ip}:${this.port}`);
    if (s.mode === 'internet' && !s.localOnly) {
      if (this.tunnelUrl) r.tunnel = this.tunnelUrl;
      if (s.relayUrl && this.relayState.connected) r.relay = s.relayUrl;
    }
    return r;
  }

  /** An open link to a device, connecting if needed (local network first, then tunnel, then relay). */
  async connect(device: string): Promise<Mux> {
    const guest = this.guests.get(device);
    if (guest) return guest.mux;
    if (device.startsWith('help:')) throw new Error('The help session has ended');
    const open = (this.conns.get(device) ?? []).filter((c) => !c.mux.closed);
    if (open.length) return open[open.length - 1].mux;
    let p = this.dialing.get(device);
    if (!p) {
      p = this.dial(device).finally(() => this.dialing.delete(device));
      this.dialing.set(device, p);
    }
    return (await p).mux;
  }

  private async dial(device: string): Promise<Conn> {
    const dev = this.data.devices.find((d) => d.id === device);
    if (!dev) throw new Error('That device is not paired');
    const s = this.data.settings;
    if (s.mode === 'off') throw new Error('Keeper Link is off on this device');
    const pub = Buffer.from(dev.pub, 'base64');
    const errors: string[] = [];
    const attempt = async (reach: Partial<Reach>): Promise<Conn | null> => {
      // 1. the local network: what mDNS heard, then the last known addresses, all at once
      const near = this.mdns.fresh().find((f) => f.id === device);
      const lan = this.opts.noLanDial ? [] : [...new Set([...(near ? near.addresses.map((a) => `${a}:${near.port}`) : []), ...(reach.lan ?? [])])];
      if (lan.length) {
        const c = await Promise.any(lan.map((a) => this.tryWire(() => connectWs(`ws://${a}/link`, 'lan', 2500, a.split(':')[0]), pub, device))).catch((e: AggregateError) => {
          errors.push(...e.errors.map(String));
          return null;
        });
        if (c) return c;
      }
      if (s.mode !== 'internet' || s.localOnly) return null;
      // 2. its tunnel
      if (reach.tunnel) {
        const c = await this.tryWire(() => connectWs(`${reach.tunnel!.replace(/^http/, 'ws')}/link`, 'tunnel', 10_000), pub, device).catch((e) => (errors.push(String(e)), null));
        if (c) return c;
      }
      // 3. a relay
      const relays = [...new Set([reach.relay, s.relayUrl].filter(Boolean) as string[])];
      for (const r of relays) {
        const c = await this.tryWire(() => relayDial(r, device), pub, device).catch((e) => (errors.push(String(e)), null));
        if (c) return c;
      }
      return null;
    };
    let c = await attempt(dev.reach ?? {});
    if (c) return c;
    // 4. ask the mailbox where it is now, and try again with that
    if (s.mode === 'internet' && !s.localOnly && s.mailbox) {
      const note = await readNotes(s.mailbox, dev.pairSecret, pub).catch(() => null);
      if (note) {
        dev.reach = { ...dev.reach, ...note };
        void this.save();
        c = await attempt(note);
        if (c) return c;
      }
    }
    throw new Error(s.mode === 'lan' || s.localOnly ? `${dev.name} is not on this network` : `Could not reach ${dev.name}`);
  }

  private async tryWire(open: () => Promise<Wire>, pub: Buffer, device: string, resume?: Resumable): Promise<Conn> {
    const wire = await open();
    try {
      const session = await initiate(wire, this.me, pub, 10_000);
      if (resume) {
        // Back on a carrier after every path was lost: the same connection continues.
        await this.hello(session, resume);
        const c = (this.conns.get(device) ?? []).find((x) => x.res === resume)!;
        return c;
      }
      const h = await this.hello(session);
      const c = this.attach(device, new Mux(h.carrier, true), wire.kind, wire.where, h.res, true);
      // Tell it where we are, and learn its name and addresses.
      const t0 = Date.now();
      const hi = await call<{ name?: string; os?: string; reach?: Reach }>(c.mux, 'hello', { reach: this.reach() }, 10_000);
      c.rtt = Date.now() - t0;
      const dev = this.data.devices.find((d) => d.id === device);
      if (dev && hi) {
        if (hi.reach) dev.reach = { ...dev.reach, ...hi.reach };
        void this.save();
      }
      return c;
    } catch (e) {
      wire.close('failed');
      throw e;
    }
  }

  /** All paths of a connection are gone: dial again (any carrier) and continue it. */
  private async resumeConn(device: string, c: Conn) {
    const dev = this.data.devices.find((d) => d.id === device);
    if (!dev || !c.res || c.res.closed) return;
    const pub = Buffer.from(dev.pub, 'base64');
    const s = this.data.settings;
    const reach = dev.reach ?? {};
    const tries: (() => Promise<Wire>)[] = [];
    if (!this.opts.noLanDial) for (const a of reach.lan ?? []) tries.push(() => connectWs(`ws://${a}/link`, 'lan', 2500, a.split(':')[0]));
    if (s.mode === 'internet' && !s.localOnly) {
      if (reach.tunnel) tries.push(() => connectWs(`${reach.tunnel!.replace(/^http/, 'ws')}/link`, 'tunnel', 10_000));
      for (const r of new Set([reach.relay, s.relayUrl].filter(Boolean) as string[])) tries.push(() => relayDial(r, device));
    }
    for (const t of tries) {
      if (c.res.closed) return;
      const ok = await this.tryWire(t, pub, device, c.res).then(() => true, () => false);
      if (ok) return;
    }
  }

  // ---------------------------------------------------------------- relay and mailbox

  private async startRelay() {
    clearTimeout(this.relayTimer);
    const s = this.data.settings;
    if (this.stopped || s.mode !== 'internet' || s.localOnly || !s.relayUrl) {
      this.relayState = { connected: false };
      return;
    }
    try {
      const ctl = await relayListen(s.relayUrl, this.me, (w) => void this.incoming(w));
      this.relayCtl = ctl;
      this.relayRetry = 0;
      this.relayState = { connected: true };
      this.scheduleNote(500);
      this.hooks.changed();
      ctl.onclose = (r) => {
        this.relayCtl = null;
        this.relayState = { connected: false, error: r };
        this.hooks.changed();
        this.retryRelay();
      };
    } catch (e) {
      this.relayState = { connected: false, error: e instanceof Error ? e.message : String(e) };
      this.hooks.changed();
      this.retryRelay();
    }
  }

  private retryRelay() {
    if (this.stopped) return;
    const wait = Math.min(300, 2 ** Math.min(8, this.relayRetry++)) * 1000;
    this.relayTimer = setTimeout(() => void this.startRelay(), wait);
    this.relayTimer.unref?.();
  }

  /** Leaves fresh "where to find me" notes for paired devices (only when something changed). */
  scheduleNote(ms = 1000) {
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => void this.postNotes(), ms);
    this.noteTimer.unref?.();
  }

  private async postNotes() {
    const s = this.data.settings;
    if (this.stopped || s.mode !== 'internet' || s.localOnly || !s.mailbox || !this.data.devices.length) return;
    const reach = this.reach();
    const key = JSON.stringify({ ...reach, at: 0 });
    if (key === this.lastNote) return;
    this.lastNote = key;
    for (const d of this.data.devices) await postNote(s.mailbox, d.pairSecret, this.me, reach).catch(() => undefined);
  }

  setTunnelUrl(url: string | undefined) {
    if (this.tunnelUrl === url) return;
    this.tunnelUrl = url;
    this.scheduleNote(500);
    this.hooks.changed();
  }

  // ---------------------------------------------------------------- pairing

  async createInvite(): Promise<PairInvite> {
    const code = newPairCode();
    const secret = newPairSecret();
    this.invite = { code, secret, expires: Date.now() + 10 * 60_000, misses: 0 };
    this.mdns.announce();
    const addrs = (this.reach().lan ?? []).join(',');
    const link = `keeper://pair?d=${this.id}&k=${secret}&f=${this.me.publicKey.toString('base64url')}${addrs ? `&a=${encodeURIComponent(addrs)}` : ''}${this.tunnelUrl && this.data.settings.mode === 'internet' ? `&t=${encodeURIComponent(this.tunnelUrl)}` : ''}`;
    return { code, link, qr: await this.hooks.qr(link), expires: this.invite.expires };
  }

  cancelInvite() {
    this.invite = null;
    this.mdns.announce();
  }

  private info() {
    return { name: this.data.name, os: this.opts.os ?? process.platform, reach: this.reach() as unknown as Record<string, unknown> };
  }

  private async hostPairing(wire: Wire, first: Uint8Array) {
    const inv = this.invite;
    if (!inv || inv.expires < Date.now()) {
      wire.send(new TextEncoder().encode(JSON.stringify({ t: 'perr', error: 'This device is not waiting to pair. Choose Pair a device on it first.' })));
      return wire.close('not pairing');
    }
    try {
      const r = await pairAsHost(wire, {
        me: this.me,
        info: this.info(),
        secret: '',
        secretFor: (m) => (m === 'qr' ? inv.secret : inv.code),
        confirm: (sas, peer) => this.askPair(sas, peer, 'host'),
      }, first);
      this.invite = null;
      this.mdns.announce();
      await this.remember(r);
    } catch (e) {
      if (String(e).includes('wrong-code') && ++inv.misses >= 5) {
        this.invite = null;
        this.hooks.notify('Pairing stopped', 'Too many wrong codes were tried. Start again if it was you.');
      }
      this.hooks.changed();
    }
  }

  private askPair(sas: string, peer: { pub: string; name: string; os: string }, role: 'host' | 'joiner', auto = false): Promise<boolean> {
    if (auto) return Promise.resolve(true);
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.pairWaits.delete(id);
        resolve(false);
      }, 2 * 60_000);
      this.pairWaits.set(id, (ok) => {
        clearTimeout(t);
        this.pairWaits.delete(id);
        resolve(ok);
      });
      this.hooks.pairPrompt({ id, sas, role, peer: { name: peer.name, os: peer.os, fingerprint: fingerprint(Buffer.from(peer.pub, 'base64')) } });
    });
  }

  confirmPair(id: string, ok: boolean) {
    this.pairWaits.get(id)?.(ok);
  }

  private async remember(r: PairResult) {
    const pub = Buffer.from(r.peer.pub, 'base64');
    const id = deviceId(pub);
    const reach = (r.peer.reach ?? {}) as Partial<Reach>;
    const existing = this.data.devices.find((d) => d.id === id);
    const dev: StoredDevice = {
      id,
      pub: r.peer.pub,
      name: r.peer.name || 'Device',
      os: r.peer.os,
      pairSecret: r.pairSecret,
      perms: existing?.perms ?? { ...DEFAULT_PERMISSIONS },
      autoAccept: existing?.autoAccept ?? false,
      pairedAt: Date.now(),
      lastSeen: Date.now(),
      reach: { ...reach },
    };
    this.data.devices = [...this.data.devices.filter((d) => d.id !== id), dev];
    await this.save();
    this.hooks.notify('Device paired', `${dev.name} can now reach this device within the permissions you set.`);
    this.hooks.changed();
    this.scheduleNote(500);
    return dev;
  }

  /** Pairs with another device that is showing a code or QR. */
  async pair(target: { deviceId?: string; address?: string; code?: string; link?: string }): Promise<{ ok: boolean; error?: string; device?: string }> {
    try {
      let addrs: string[] = [];
      let tunnel: string | undefined;
      let secret = target.code?.replace(/\D/g, '') ?? '';
      let mode: 'code' | 'qr' = 'code';
      let expectHost: Buffer | undefined;
      if (target.link) {
        const u = new URL(target.link.trim().replace(/^keeper:\/\//, 'https://x/'));
        secret = u.searchParams.get('k') ?? '';
        mode = 'qr';
        expectHost = Buffer.from(u.searchParams.get('f') ?? '', 'base64url');
        addrs = (u.searchParams.get('a') ?? '').split(',').filter(Boolean);
        tunnel = u.searchParams.get('t') ?? undefined;
        const near = this.mdns.fresh().find((f) => f.id === u.searchParams.get('d'));
        if (near) addrs.unshift(...near.addresses.map((a) => `${a}:${near.port}`));
      } else if (target.deviceId) {
        const near = this.mdns.fresh().find((f) => f.id === target.deviceId);
        if (!near) throw new Error('That device is no longer seen on this network');
        addrs = near.addresses.map((a) => `${a}:${near.port}`);
      } else if (target.address) {
        addrs = [target.address.includes(':') ? target.address : `${target.address}:${DEFAULT_PORT}`];
      }
      if (!secret) throw new Error('Enter the code shown on the other device');
      const tries: (() => Promise<Wire>)[] = addrs.map((a) => () => connectWs(`ws://${a}/link`, 'lan', 3000, a));
      if (tunnel) tries.push(() => connectWs(`${tunnel!.replace(/^http/, 'ws')}/link`, 'tunnel', 10_000));
      let wire: Wire | null = null;
      for (const t of tries) {
        wire = await t().catch(() => null);
        if (wire) break;
      }
      if (!wire) throw new Error('Could not reach the other device');
      const r = await pairAsJoiner(wire, {
        me: this.me,
        info: this.info(),
        secret,
        mode,
        expectHost,
        confirm: (sas, peer) => this.askPair(sas, peer, 'joiner', mode === 'qr'),
      });
      wire.close('paired');
      const dev = await this.remember(r);
      // The address that worked goes first next time.
      const used = wire.kind === 'lan' && wire.where ? addrs.filter((a) => a === wire!.where || a.startsWith(wire!.where + ':')) : [];
      dev.reach = { ...dev.reach, lan: [...new Set([...used, ...(dev.reach?.lan ?? []), ...addrs])] };
      await this.save();
      return { ok: true, device: dev.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg === 'wrong-code' ? 'That code is not right' : msg === 'cancelled' ? 'Pairing was cancelled' : msg };
    }
  }

  forget(device: string) {
    this.data.devices = this.data.devices.filter((d) => d.id !== device);
    for (const c of this.conns.get(device) ?? []) c.mux.close('forgotten');
    this.conns.delete(device);
    void this.save();
    this.hooks.changed();
  }

  setPermissions(device: string, perms: PermissionSet, autoAccept?: boolean) {
    const d = this.data.devices.find((x) => x.id === device);
    if (!d) return;
    d.perms = { ...perms };
    if (autoAccept !== undefined) d.autoAccept = autoAccept;
    void this.save();
    this.hooks.changed();
  }

  renameDevice(device: string, name: string) {
    const d = this.data.devices.find((x) => x.id === device);
    if (!d) return;
    d.name = name.trim().slice(0, 80) || d.name;
    void this.save();
    this.hooks.changed();
  }

  async rename(name: string) {
    this.data.name = name.trim().slice(0, 60) || this.data.name;
    await this.save();
    this.mdns.announce();
    this.hooks.changed();
  }

  // ---------------------------------------------------------------- actions on paired devices

  async check(device: string) {
    try {
      const mux = await this.connect(device);
      const rtt = await mux.ping();
      const c = (this.conns.get(device) ?? []).find((x) => x.mux === mux);
      if (c) c.rtt = rtt;
      this.hooks.changed();
      return { ok: true, via: (c?.res?.kind ?? c?.kind) as CarrierKind | undefined, rtt };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async sendFiles(device: string, paths: string[]) {
    const mux = await this.connect(device);
    for (const p of paths) await sendFile(mux, p, (pr) => this.progress({ ...pr, peer: device }));
  }

  async sendClipboard(device: string) {
    const mux = await this.connect(device);
    await call(mux, 'clip.set', { text: await this.hooks.clipboard.read() });
  }

  async remoteShares(device: string): Promise<LinkShare[]> {
    return call(await this.connect(device), 'fs.shares');
  }

  async remoteList(device: string, share: string, dir: string): Promise<RemoteEntry[]> {
    return call(await this.connect(device), 'fs.list', { share, dir });
  }

  /** Copies a file from another device's shared folder into Downloads/Keeper. */
  async remoteDownload(device: string, share: string, file: string): Promise<string> {
    const mux = await this.connect(device);
    const st = mux.open({ k: 'fsread', share, path: file });
    st.end();
    await fsp.mkdir(this.downloadDir(), { recursive: true });
    const dest = await uniquePath(path.join(this.downloadDir(), safeName(path.basename(file))));
    const tmp = dest + '.keeperdownload';
    const fh = await fsp.open(tmp, 'w');
    try {
      await new Promise<void>((resolve, reject) => {
        st.ondata = async (c) => void (await fh.write(c));
        st.onend = () => resolve();
        st.onreset = (r) => reject(new Error(r));
        void st.start();
      });
    } catch (e) {
      await fh.close();
      await fsp.rm(tmp, { force: true });
      throw e;
    }
    await fh.close();
    await fsp.rename(tmp, dest);
    return dest;
  }

  // ---------------------------------------------------------------- shares and forwards

  async addShare(p: string) {
    const st = await fsp.stat(p);
    if (!st.isDirectory()) throw new Error('Choose a folder');
    const real = await fsp.realpath(p);
    if (real === path.parse(real).root || real === os.homedir()) throw new Error('Share a folder inside your home folder, not the whole drive or home folder');
    if (!this.data.settings.shares.some((s) => s.path === real)) this.data.settings.shares.push({ id: crypto.randomBytes(6).toString('base64url'), name: path.basename(real), path: real });
    await this.save();
    this.hooks.changed();
  }

  async removeShare(id: string) {
    this.data.settings.shares = this.data.settings.shares.filter((s) => s.id !== id);
    await this.save();
    this.hooks.changed();
  }

  async addForward(f: Omit<StoredForward, 'id'>): Promise<Forward> {
    if (!(f.localPort > 0 && f.localPort < 65536)) throw new Error('Choose a port between 1 and 65535');
    if (f.kind === 'port' && !(f.port && f.port > 0 && f.port < 65536)) throw new Error('Choose the port on the other device');
    const sf: StoredForward = { ...f, id: crypto.randomBytes(6).toString('base64url'), host: f.kind === 'port' ? f.host || '127.0.0.1' : undefined };
    this.data.forwards.push(sf);
    await this.save();
    await this.startForward(sf);
    this.hooks.changed();
    return this.forwardView(sf);
  }

  private async startForward(f: StoredForward) {
    try {
      const get = () => this.connect(f.device);
      const srv = f.kind === 'socks' ? await socksProxy(get, f.localPort) : await forwardPort(get, f.localPort, f.host ?? '127.0.0.1', f.port!);
      this.forwards.set(f.id, { srv });
    } catch (e) {
      this.forwards.set(f.id, { error: e instanceof Error ? (e.message.includes('EADDRINUSE') ? `Port ${f.localPort} is already in use here` : e.message) : String(e) });
    }
  }

  async removeForward(id: string) {
    this.forwards.get(id)?.srv?.close();
    this.forwards.delete(id);
    this.data.forwards = this.data.forwards.filter((f) => f.id !== id);
    await this.save();
    this.hooks.changed();
  }

  private forwardView(f: StoredForward): Forward {
    const st = this.forwards.get(f.id);
    return { ...f, active: !!st?.srv, error: st?.error };
  }

  // ---------------------------------------------------------------- audit, fleet notes, approvals

  /** Adds an entry to this device's audit log. */
  audit(e: Omit<AuditEntry, 'id' | 'at'> & { at?: number }) {
    this.data.audit = addEntry(this.data.audit ?? [], { ...e, at: e.at ?? Date.now() }, 2000);
    void this.save();
  }

  auditLog(f: AuditFilter = {}): AuditEntry[] {
    return filterAudit(this.data.audit ?? [], f);
  }

  /** How a device is connected right now ('direct', 'relay', …). */
  carrierOf(device: string): string | undefined {
    const open = (this.conns.get(device) ?? []).filter((c) => !c.mux.closed);
    const c = open[open.length - 1];
    return c ? (c.res?.kind ?? c.kind) : this.guests.get(device)?.kind;
  }

  /** Paths under a device's connection, with bytes moved on each (for the device page and tests). */
  pathsOf(device: string) {
    return (this.conns.get(device) ?? []).filter((c) => !c.mux.closed).flatMap((c) => c.res?.pathStats() ?? [{ kind: c.kind, where: c.where, since: c.since, bytesIn: 0, bytesOut: 0, active: true }]);
  }

  setMeta(device: string, m: Partial<DeviceMeta>) {
    if (!this.data.devices.some((d) => d.id === device)) throw new Error('That device is not paired');
    this.data.meta = { ...(this.data.meta ?? {}), [device]: cleanMeta({ ...(this.data.meta?.[device] ?? { tags: [], commands: [] }), ...m }) };
    void this.save();
    this.hooks.changed();
    return this.data.meta[device];
  }

  meta(device: string): DeviceMeta {
    return this.data.meta?.[device] ?? { tags: [], commands: [] };
  }

  isApproved(device: string, hash: string) {
    return !!this.data.approved?.[device]?.includes(hash);
  }

  approve(device: string, hash: string) {
    const list = [...new Set([...(this.data.approved?.[device] ?? []), hash])].slice(-200);
    this.data.approved = { ...(this.data.approved ?? {}), [device]: list };
    void this.save();
  }

  /**
   * The keeper command's byte pipe: an HTTP upgrade on the loopback control
   * port (with the token) becomes a stream to a port on a paired device — what
   * `ssh -o ProxyCommand="keeper remote ssh-proxy %h"` uses.
   */
  private localPipe(req: http.IncomingMessage, socket: import('node:stream').Duplex, head: Buffer, u: URL) {
    const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    const token = this.opts.controlToken;
    const given = String(req.headers['x-keeper-token'] ?? '');
    const local = (remote === '127.0.0.1' || remote === '::1') && !req.headers['cf-ray'] && !req.headers['cf-connecting-ip'] && !req.headers.origin;
    if (!token || !local || given.length !== token.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))) return void socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    const q = (u.searchParams.get('device') ?? '').toLowerCase();
    const d = this.data.devices.find((y) => y.id === q || y.name.toLowerCase() === q || y.name.toLowerCase().replace(/\s+/g, '-') === q.replace(/\.keeper$/, '') || y.name.toLowerCase().replace(/\s+/g, '-') + '.keeper' === q);
    const port = Number(u.searchParams.get('port') ?? 22);
    if (!d || !(port > 0 && port < 65536)) return void socket.end('HTTP/1.1 404 Not Found\r\n\r\nNo paired device by that name');
    void this.connect(d.id).then(
      (mux) => {
        const st = mux.open({ k: 'tcp', host: '127.0.0.1', port });
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: keeper-pipe\r\nConnection: Upgrade\r\n\r\n');
        if (head.length) void st.write(head);
        this.audit({ kind: 'forward', direction: 'out', device: d.id, deviceName: d.name, title: `Opened port ${port} on ${d.name} from the command line`, ok: true });
        bridge(socket as net.Socket, st);
      },
      (e) => socket.end(`HTTP/1.1 502 Bad Gateway\r\n\r\n${e instanceof Error ? e.message : String(e)}`),
    );
  }

  // ---------------------------------------------------------------- settings and state

  async setSettings(patch: Partial<LinkSettings>) {
    const before = this.data.settings;
    this.data.settings = { ...before, ...patch, shares: patch.shares ?? before.shares };
    await this.save();
    if (patch.mode !== undefined || patch.port !== undefined || patch.relayUrl !== undefined || patch.localOnly !== undefined) await this.restartNetwork();
    this.hooks.changed();
  }

  nearby(): NearbyDevice[] {
    return this.mdns.fresh().map((f) => ({ id: f.id, name: f.name, os: f.os, addresses: f.addresses, port: f.port, pairing: f.pairing, paired: this.data.devices.some((d) => d.id === f.id) }));
  }

  async discover(waitMs = 1500): Promise<NearbyDevice[]> {
    this.mdns.query();
    await new Promise((r) => setTimeout(r, waitMs));
    return this.nearby();
  }

  /** Asks the relay which devices are listening there (only when the Devices page is open). */
  async refreshPresence(): Promise<Record<string, boolean>> {
    const s = this.data.settings;
    if (s.mode !== 'internet' || s.localOnly || !s.relayUrl || !this.data.devices.length) return {};
    return relayOnline(s.relayUrl, this.data.devices.map((d) => d.id)).catch(() => ({}));
  }

  thisDevice(): ThisDevice {
    return {
      id: this.id,
      name: this.data.name,
      os: this.opts.os ?? process.platform,
      fingerprint: fingerprint(this.me.publicKey),
      keyProtected: this.keyProtected,
      addresses: lanIPv4(),
      port: this.port,
      listening: !!this.server,
      relay: this.data.settings.relayUrl ? { url: this.data.settings.relayUrl, ...this.relayState } : undefined,
      tunnel: this.hooks.tunnel(),
      wireguard: wireguardInterfaces(),
    };
  }

  state(): LinkState {
    const near = new Set(this.mdns.fresh().map((f) => f.id));
    const devices: LinkDevice[] = this.data.devices.map((d) => {
      const open = (this.conns.get(d.id) ?? []).filter((c) => !c.mux.closed);
      const c = open[open.length - 1];
      const meta = this.data.meta?.[d.id];
      return {
        id: d.id,
        name: d.name,
        os: d.os,
        fingerprint: fingerprint(Buffer.from(d.pub, 'base64')),
        pairedAt: d.pairedAt,
        lastSeen: d.lastSeen,
        permissions: d.perms,
        autoAccept: d.autoAccept,
        online: !!c || near.has(d.id),
        via: (c?.res?.kind ?? c?.kind) as CarrierKind | undefined,
        where: c?.res?.where ?? c?.where,
        rtt: c?.rtt,
        nearby: near.has(d.id),
        meta: meta ? { ...meta } : undefined,
        paths: c ? this.pathsOf(d.id) : undefined,
      };
    });
    return {
      me: this.thisDevice(),
      settings: this.data.settings,
      devices,
      transfers: [...this.transfers.values()].reverse(),
      forwards: this.data.forwards.map((f) => this.forwardView(f)),
      companions: this.data.companions.map((c) => ({ id: c.id, name: c.name, created: c.created, lastSeen: c.lastSeen, online: this.companionsOnline.has(c.id), terminal: !!c.terminal })),
    };
  }

  // ---------------------------------------------------------------- the phone companion

  async companionInvite(base: string): Promise<CompanionInvite> {
    const secret = crypto.randomBytes(32);
    const expires = Date.now() + 10 * 60_000;
    this.companionInvites.set(inviteId(secret), { secret, expires });
    const url = `${base.replace(/\/+$/, '')}/c/#k=${toB64u(secret)}&d=${this.id}`;
    return { url, qr: await this.hooks.qr(url), expires, https: url.startsWith('https:') };
  }

  /** May this phone open a terminal here? */
  companionTerminal(cid: string): boolean {
    return !!this.data.companions.find((c) => c.id === cid)?.terminal;
  }

  setCompanionTerminal(id: string, on: boolean) {
    const c = this.data.companions.find((x) => x.id === id);
    if (!c) return;
    c.terminal = on;
    void this.save();
    this.hooks.changed();
  }

  forgetCompanion(id: string) {
    this.data.companions = this.data.companions.filter((c) => c.id !== id);
    void this.save();
    this.hooks.changed();
  }

  private companion(ws: WsServerConn) {
    let opener: Opener | null = null;
    let sealer: Sealer | null = null;
    let viaInvite: string | null = null;
    let cid: string | null = null;
    // A browser helping someone (Help mode web viewer): no pairing, the screen only.
    let helpWeb: { miss: () => void; used: () => void } | null = null;
    let helpOpened = false;
    const uploads = new Map<string, { file: string; done: number; total: number; name: string }>();
    const t = setTimeout(() => !opener && ws.close('no hello'), 15_000);
    ws.ontext = (s) => {
      if (opener) return;
      let m: { t?: string; v?: number; inv?: string; cid?: string; n?: string; help?: string; name?: string };
      try {
        m = JSON.parse(s);
      } catch {
        return ws.close('bad');
      }
      if (m.t !== 'hello' || m.v !== 1 || typeof m.n !== 'string') return ws.close('bad');
      let secret: Uint8Array | null = null;
      if (m.inv) {
        const inv = this.companionInvites.get(m.inv);
        if (inv && inv.expires > Date.now()) {
          secret = inv.secret;
          viaInvite = m.inv;
        }
      } else if (typeof m.help === 'string') {
        const w = this.help.webSecret(m.help);
        if (w) {
          secret = w.secret;
          helpWeb = w;
          cid = `helpweb:${crypto.randomBytes(6).toString('base64url')}:${String(m.name ?? 'Helper').replace(/[^\p{L}\p{N} .'-]/gu, '').slice(0, 40) || 'Helper'}`;
        }
      } else if (m.cid) {
        const c = this.data.companions.find((x) => x.id === m.cid);
        if (c) {
          secret = fromB64u(c.key);
          cid = c.id;
        }
      }
      if (!secret) {
        ws.sendText(JSON.stringify({ t: 'err', e: m.help !== undefined ? 'No one is waiting for help with that code here.' : m.inv ? 'This QR code has expired. Show a new one on the computer.' : 'This phone is no longer paired. Scan a new QR code.' }));
        return ws.close('unknown');
      }
      clearTimeout(t);
      const nApp = crypto.randomBytes(16);
      const keys = companionKeys(secret, fromB64u(m.n), nApp);
      opener = new Opener(keys.phoneToApp);
      sealer = new Sealer(keys.appToPhone);
      ws.sendText(JSON.stringify({ t: 'hi', n: toB64u(nApp), id: this.id, name: this.data.name }));
      if (cid && !helpWeb) {
        this.companionsOnline.add(cid);
        const c = this.data.companions.find((x) => x.id === cid);
        if (c) c.lastSeen = Date.now();
        this.hooks.changed();
      }
    };
    ws.onclose = () => {
      clearTimeout(t);
      if (cid && !helpWeb) {
        this.companionsOnline.delete(cid);
        this.hooks.changed();
      }
      for (const u of uploads.values()) void fsp.rm(u.file, { force: true });
    };
    const reply = (id: number | undefined, r: unknown, body?: Uint8Array) => ws.send(sealer!.seal({ id, ok: true, r }, body));
    const fail = (id: number | undefined, e: unknown) => ws.send(sealer!.seal({ id, ok: false, e: e instanceof Error ? e.message : String(e) }));
    let queue = Promise.resolve();
    ws.onmessage = (d) => {
      if (!opener) return ws.close('bad');
      const msg = opener.open(d);
      if (!msg) {
        // For a browser helper the first message proves the code and password; a failure counts as a wrong try.
        if (helpWeb && !helpOpened) helpWeb.miss();
        return ws.close('A message failed its integrity check');
      }
      if (helpWeb && !helpOpened) {
        helpOpened = true;
        helpWeb.used();
        this.audit({ kind: 'help', direction: 'in', device: cid!, deviceName: cid!.split(':').slice(2).join(':'), title: `${cid!.split(':').slice(2).join(':')} connected from a web browser with your help code`, ok: true });
      }
      queue = queue.then(() => this.companionRequest(msg.header, msg.body, { viaInvite, cid: () => cid, setCid: (x) => (cid = x), uploads, reply, fail }));
    };
  }

  private async companionRequest(h: CHeader, body: Uint8Array, ctx: { viaInvite: string | null; cid: () => string | null; setCid: (c: string) => void; uploads: Map<string, { file: string; done: number; total: number; name: string }>; reply: (id: number | undefined, r: unknown, body?: Uint8Array) => void; fail: (id: number | undefined, e: unknown) => void }) {
    const id = typeof h.id === 'number' ? h.id : undefined;
    try {
      if (h.op === 'register') {
        if (!ctx.viaInvite) throw new Error('Already paired');
        const name = String(h.name ?? 'Phone').slice(0, 60);
        if (!(await this.hooks.approveCompanion(name))) throw new Error('The computer did not allow this phone');
        const key = crypto.randomBytes(32);
        const c: StoredCompanion = { id: crypto.randomBytes(9).toString('base64url'), name, key: toB64u(key), created: Date.now(), lastSeen: Date.now() };
        this.data.companions.push(c);
        // The invite is single-use.
        this.companionInvites.delete(ctx.viaInvite);
        ctx.setCid(c.id);
        this.companionsOnline.add(c.id);
        await this.save();
        this.hooks.changed();
        return ctx.reply(id, { cid: c.id, key: c.key, device: this.id, name: this.data.name });
      }
      if (!ctx.cid()) throw new Error('Pair this phone first');
      if (ctx.cid()!.startsWith('helpweb:') && !/^screen\./.test(String(h.op))) throw new Error('Not in a help session');
      switch (h.op) {
        case 'info':
          return ctx.reply(id, { name: this.data.name, id: this.id, os: this.opts.os ?? process.platform });
        case 'shares':
          return ctx.reply(id, this.data.settings.shares.map((s) => ({ id: s.id, name: s.name })));
        case 'list': {
          const dir = await this.resolveShared(String(h.share), String(h.dir ?? ''));
          const out: RemoteEntry[] = [];
          for (const e of (await fsp.readdir(dir, { withFileTypes: true })).slice(0, 3000)) {
            if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
            const st = await fsp.stat(path.join(dir, e.name)).catch(() => null);
            if (st) out.push({ name: e.name, isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs });
          }
          return ctx.reply(id, out);
        }
        case 'read': {
          const f = await this.resolveShared(String(h.share), String(h.path));
          const offset = Math.max(0, Number(h.offset) || 0);
          const len = Math.min(COMPANION_CHUNK, Math.max(0, Number(h.len) || COMPANION_CHUNK));
          const fh = await fsp.open(f, 'r');
          try {
            const size = (await fh.stat()).size;
            const buf = Buffer.alloc(Math.max(0, Math.min(len, size - offset)));
            await fh.read(buf, 0, buf.length, offset);
            return ctx.reply(id, { size }, buf);
          } finally {
            await fh.close();
          }
        }
        case 'put': {
          const xid = String(h.xid ?? '').replace(/[^\w-]/g, '').slice(0, 40);
          const total = Number(h.total) || 0;
          const offset = Number(h.offset) || 0;
          if (!xid || total < 0 || total > 50 * 1024 ** 3) throw new Error('bad upload');
          let u = ctx.uploads.get(xid);
          if (!u) {
            if (offset !== 0) throw new Error('Start the upload again');
            await fsp.mkdir(path.join(this.downloadDir(), '.keeper-partial'), { recursive: true });
            u = { file: path.join(this.downloadDir(), '.keeper-partial', `c-${xid}.part`), done: 0, total, name: safeName(String(h.name ?? 'file')) };
            await fsp.writeFile(u.file, Buffer.alloc(0));
            ctx.uploads.set(xid, u);
          }
          if (offset !== u.done || u.done + body.length > u.total) throw new Error('Upload out of order');
          await fsp.appendFile(u.file, body);
          u.done += body.length;
          if (u.done === u.total) {
            ctx.uploads.delete(xid);
            const dest = await uniquePath(path.join(this.downloadDir(), u.name));
            await fsp.rename(u.file, dest);
            const c = this.data.companions.find((x) => x.id === ctx.cid());
            this.progress({ id: xid, name: u.name, size: u.total, done: u.total, direction: 'receive', state: 'done', savedAs: dest, peer: c?.name });
            return ctx.reply(id, { done: true, savedAs: path.basename(dest) });
          }
          return ctx.reply(id, { done: false, have: u.done });
        }
        case 'clip.get':
          return ctx.reply(id, { text: await this.hooks.clipboard.read() });
        case 'clip.set':
          await this.hooks.clipboard.write(String(h.text ?? '').slice(0, 1_000_000));
          return ctx.reply(id, true);
        default: {
          const extra = this.extraCompanion.get(String(h.op));
          if (!extra) throw new Error(`Unknown request ${String(h.op)}`);
          const out = await extra(h, body, ctx.cid()!);
          return ctx.reply(id, out.r, out.body);
        }
      }
    } catch (e) {
      ctx.fail(id, e);
    }
  }
}

function defaultName(hostname = os.hostname()) {
  const h = hostname.replace(/\.(local|lan|home|localdomain)$/i, '');
  return h || 'This computer';
}
