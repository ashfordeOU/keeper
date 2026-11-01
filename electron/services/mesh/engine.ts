// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Mesh on one device: networks, members, the signed key exchange over
// Keeper Link, the WireGuard configuration, the data path and the plans that
// put it all into the operating system. Plain Node (no Electron), so the
// tests run two of them over two real Link nodes; the app wraps it in
// index.ts with the keychain, the privileged helper and the window.
//
// Control plane, all over the Link channel (stream kind "mesh.ctl", one
// request per stream, JSON both ways):
//   invite    "join my network <name>?"                → the person on that device answers
//   joined    "yes, I joined"                          → the inviter introduces the new device
//   introduce "a device you are paired with joined"    (own devices only)
//   hello     my signed record for you ⇄ yours for me  → then both sides punch at once
//   punch     try direct paths again now
//   leave     "I left / you were removed"
// There is no Keeper server: Link already proves who is on the other end.

import crypto from 'node:crypto';
import dnsMod from 'node:dns';
import os from 'node:os';
import type { Identity } from '../../../core/link/identity';
import type { Mux, Stream } from '../../../core/link/mux';
import { cleanSuffix, conflicts, deviceAddr4, deviceAddr6, dnsLabel, inMesh, networkPrefix4, networkPrefix6, newNetworkId } from '../../../core/mesh/address';
import { MeshDnsServer } from '../../../core/mesh/dns';
import { pathKey, shortKey, signRecord, verifyRecord, type MeshRecord, type SignedRecord, type WgKeyPair } from '../../../core/mesh/keys';
import { aclUp, cleanupPlan, dnsUp, emptyApplied, exitServeUp, exitUseUp, hostsWrite, ifaceSync, ifaceUp, routesUp, withHostsBlock, type Applied, type IfaceCtx, type MeshOS, type Step } from '../../../core/mesh/os-plan';
import { PacketRelayClient } from '../../../core/mesh/packet-relay';
import { joinAddr, splitAddr } from '../../../core/mesh/paths';
import { compileAcl, parsePorts } from '../../../core/mesh/rules';
import { cleanPlaces, type MeshControl, type MeshPlace } from '../../../core/mesh/types';
import type { Candidate, IfaceState, MeshDiag, MeshInvite, MeshNetView, MeshNetwork, MeshPeerView, MeshRole, MeshRule, MeshState } from '../../../core/mesh/types';
import { allowedIps, quickConf, redact, setconf, uapiSet, type WgPeerConf, type WgPeerStats } from '../../../core/mesh/wgconfig';
import { DataPath } from './datapath';

export const MESH_PORT = 41820;
export const MTU = 1280;

/** What the engine needs from Keeper Link. */
export interface LinkPort {
  readonly id: string;
  readonly me: Identity;
  name(): string;
  devices(): { id: string; name: string; pub: Buffer }[];
  online(device: string): boolean;
  connect(device: string): Promise<Mux>;
  registerStream(kind: string, fn: (st: Stream, device: string) => void): void;
  settings(): { stun: string[]; relayUrl: string; localOnly: boolean; mode: string };
}

/** What the engine needs from the operating system (electron/services/mesh/driver.ts, or a fake in tests). */
export interface MeshDriver {
  os: MeshOS;
  detect(): Promise<{ impl?: 'kernel' | 'wireguard-go' | 'wireguard-nt'; bin?: string; wg?: string; state: IfaceState; message?: string }>;
  ifaceName(net: MeshNetwork, index: number): Promise<string>;
  run(steps: Step[]): Promise<{ ok: boolean; message: string }>;
  /** what to run if Keeper stops without cleaning up (kept by the helper / watchdog) */
  setCleanup(steps: Step[]): Promise<void>;
  readHosts(): Promise<string>;
  localPrefixes(): Promise<string[]>;
  defaults(): Promise<{ gw4?: string; gw6?: string; wan?: string; lan: string[]; services?: { name: string; before: string[] }[]; forwarding?: { v4?: string; v6?: string } }>;
  stats(iface: string, impl: string): Promise<WgPeerStats[]>;
  confPath?(tunnel: string): string;
  /** false on a kernel without IPv6: the mesh is IPv4 only there */
  hasIPv6?(): boolean;
  ping?(addr: string): Promise<MeshDiag>;
  mtu?(addr: string): Promise<MeshDiag>;
}

export interface MeshHooks {
  load(): Promise<MeshData | null>;
  save(d: MeshData): Promise<void>;
  /** this device's WireGuard key pair (made once, kept in the keychain) */
  wgKey(): Promise<WgKeyPair>;
  changed(): void;
  invite?(i: MeshInvite): void;
  /** asks the person on this device (admin-level changes: exit node, sharing a subnet) */
  confirm?(title: string, detail: string): Promise<boolean>;
}

interface PeerRec {
  rec: MeshRecord;
  at: number;
}

export interface MeshData {
  v: 1;
  on: boolean;
  suffix: string;
  hosts: boolean;
  networks: (MeshNetwork & { wgPort?: number; port?: number; joined?: string[] })[];
  /** verified records: "<net>/<device>" */
  peers: Record<string, PeerRec>;
  seq: number;
  /** half of each path key (secret; only sent inside Link) */
  pk: string;
  exit: { using?: string; net?: string; killSwitch: boolean; dnsThrough: boolean; allowLan: boolean };
  offerExit: boolean;
  advertise: string[];
  acceptRoutes: string[];
  /** what is in the OS right now (for cleanup after a crash) */
  applied?: Applied;
  /** where mesh controls appear (tray, Island, palette) */
  places?: Partial<Record<MeshControl, MeshPlace[]>>;
}

const fresh = (): MeshData => ({ v: 1, on: false, suffix: 'keeper', hosts: false, networks: [], peers: {}, seq: 0, pk: crypto.randomBytes(32).toString('base64'), exit: { killSwitch: true, dnsThrough: true, allowLan: true }, offerExit: false, advertise: [], acceptRoutes: [] });

interface NetRuntime {
  net: MeshData['networks'][number];
  dp: DataPath;
  iface: string;
  tag: Buffer;
  cands: Candidate[];
  up: boolean;
}

const tagOf = (net: string) => Buffer.from(net.slice(0, 8), 'hex');

export class MeshEngine {
  data: MeshData = fresh();
  private rt = new Map<string, NetRuntime>();
  private relay: PacketRelayClient | null = null;
  private dns: MeshDnsServer | null = null;
  private invites = new Map<string, MeshInvite>();
  private iface: MeshState['iface'] = { state: 'off' };
  private impl?: Awaited<ReturnType<MeshDriver['detect']>>;
  private timer?: NodeJS.Timeout;
  private dnsSplit: MeshState['dns']['split'] = 'off';
  private dnsMessage?: string;
  private stats = new Map<string, WgPeerStats>();
  private busy: Promise<unknown> = Promise.resolve();
  wg?: WgKeyPair;
  /** test hook: never try direct paths (to prove the relay) */
  forceRelay = false;

  constructor(private link: LinkPort, private driver: MeshDriver, private hooks: MeshHooks, private opts: { bind?: string; basePort?: number; feature?: () => boolean } = {}) {}

  // ---------------------------------------------------------------- life

  async start() {
    const d = await this.hooks.load();
    if (d) this.data = { ...fresh(), ...d, exit: { ...fresh().exit, ...(d.exit ?? {}) } };
    else await this.save();
    this.link.registerStream('mesh.ctl', (st, device) => void this.serve(st, device));
    // Left over from a crash: put the system back first.
    if (this.data.applied && (this.data.applied.ifaces.length || this.data.applied.exitUse || this.data.applied.dns.length || this.data.applied.acl || this.data.applied.exitServe)) await this.cleanup();
    if (this.data.on && this.featureOn()) await this.up();
  }

  async stop() {
    await this.down(false);
  }

  private featureOn() {
    return this.opts.feature ? this.opts.feature() : true;
  }

  private save() {
    return this.hooks.save(this.data);
  }

  private changed() {
    this.hooks.changed();
  }

  /** One change to the system at a time. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.busy.then(fn, fn);
    this.busy = p.catch(() => undefined);
    return p;
  }

  async setOn(on: boolean) {
    this.data.on = on;
    await this.save();
    if (on) await this.up();
    else await this.down(true);
    return this.state();
  }

  get isUp() {
    return this.running;
  }

  // ---------------------------------------------------------------- bringing the mesh up and down

  async up() {
    return this.serial(async () => {
      if (this.running) return;
      if (!this.featureOn()) throw new Error('Turn on Keeper Mesh in Settings → Features first');
      this.wg = await this.hooks.wgKey();
      this.iface = { state: 'starting' };
      this.changed();
      this.impl = await this.driver.detect().catch((e) => ({ state: 'error' as IfaceState, message: String(e?.message ?? e) }));
      this.running = true;
      await this.startRelay();
      let i = 0;
      for (const net of this.data.networks) await this.startNet(net, i++);
      await this.startDns();
      await this.applyAll();
      this.schedule(0);
      this.changed();
      // Exchange keys with every member that is reachable, in the background.
      for (const r of this.rt.values()) for (const m of r.net.members) void this.hello(r.net.id, m.device).catch(() => undefined);
    });
  }

  async down(clean = true) {
    return this.serial(async () => {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.running = false;
      for (const r of this.rt.values()) r.dp.stop();
      this.rt.clear();
      this.relay?.close();
      this.relay = null;
      this.dns?.close();
      this.dns = null;
      // Without Keeper the data path stops, so the interface would be dead: always put the system back.
      void clean;
      await this.cleanup();
      this.iface = { state: 'off' };
      this.dnsSplit = 'off';
      this.changed();
    });
  }

  /** Runs the cleanup plan for everything recorded as applied. */
  private async cleanup() {
    const a = this.data.applied;
    if (!a) return;
    const hosts = a.hosts ? await this.driver.readHosts().catch(() => undefined) : undefined;
    const plan = cleanupPlan(a, hosts);
    if (plan.length) await this.driver.run(plan).catch(() => undefined);
    this.data.applied = undefined;
    await this.driver.setCleanup([]).catch(() => undefined);
    await this.save();
  }

  private async startRelay() {
    const s = this.link.settings();
    if (s.mode !== 'internet' || s.localOnly || !s.relayUrl) return;
    const c = new PacketRelayClient(s.relayUrl, this.link.me);
    c.onpacket = (from, pkt) => {
      if (pkt.length < 5) return;
      const tag = Buffer.from(pkt.subarray(0, 4)).toString('hex');
      for (const r of this.rt.values()) if (r.tag.toString('hex') === tag) r.dp.fromRelay(from, pkt.subarray(4));
    };
    c.onclose = () => {
      this.changed();
      // try again a little later while the mesh is on
      setTimeout(() => this.running && this.relay === c && void c.connect().then(() => this.relayAllow()).catch(() => undefined), 15_000).unref?.();
    };
    this.relay = c;
    await c.connect().then(() => this.relayAllow()).catch(() => undefined);
  }

  private relayAllow() {
    const ids = new Set<string>();
    for (const n of this.data.networks) for (const m of n.members) ids.add(m.device);
    this.relay?.setAllow([...ids]);
  }

  private async startNet(net: MeshData['networks'][number], index: number) {
    const base = this.opts.basePort ?? MESH_PORT;
    const tag = tagOf(net.id);
    if (!net.wgPort) net.wgPort = await freeUdpPort();
    const dp = new DataPath({
      me: this.link.id,
      tag,
      port: net.port ?? (base ? base + index : 0),
      wgPort: () => net.wgPort!,
      relay: () => this.relay,
      onChange: () => this.changed(),
      bind: this.opts.bind,
    });
    await dp.start();
    net.port = dp.port;
    const iface = await this.driver.ifaceName(net, index);
    const r: NetRuntime = { net, dp, iface, tag, cands: [], up: false };
    this.rt.set(net.id, r);
    await this.gather(r);
    // peers already known from earlier exchanges work at once
    for (const m of net.members) {
      const pr = this.data.peers[`${net.id}/${m.device}`];
      if (pr) await dp.addPeer(m.device, this.keyFor(pr.rec), this.forceRelay ? [] : pr.rec.cands);
    }
    await this.save();
  }

  /** This device's candidates: local addresses with the mesh port, the STUN address, the relay. */
  private async gather(r: NetRuntime) {
    const s = this.link.settings();
    const out: Candidate[] = [];
    if (this.opts.bind && this.opts.bind !== '0.0.0.0') out.push({ kind: 'lan', addr: joinAddr(this.opts.bind, r.dp.port) });
    else
      for (const list of Object.values(os.networkInterfaces()))
        for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && !inMesh(a.address, this.prefixes())) out.push({ kind: 'lan', addr: joinAddr(a.address, r.dp.port) });
    if (s.mode === 'internet' && !s.localOnly && s.stun.length) {
      const pub = await r.dp.stun(s.stun).catch(() => null);
      if (pub && !out.some((c) => c.addr === joinAddr(pub.ip, pub.port))) out.push({ kind: 'public', addr: joinAddr(pub.ip, pub.port) });
    }
    if (this.relay?.connected) out.push({ kind: 'relay', addr: this.relay.url });
    const changed = JSON.stringify(out) !== JSON.stringify(r.cands);
    r.cands = out;
    return changed;
  }

  /** Endpoint refresh (the governor calls this): new addresses are sent to peers. */
  async refresh() {
    if (!this.running) return;
    for (const r of this.rt.values()) {
      if (await this.gather(r)) for (const m of r.net.members) void this.hello(r.net.id, m.device).catch(() => undefined);
      else for (const m of r.net.members) if (!this.data.peers[`${r.net.id}/${m.device}`] && this.link.online(m.device)) void this.hello(r.net.id, m.device).catch(() => undefined);
    }
    await this.readStats();
    this.changed();
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(() => {
      const now = Date.now();
      let next = 30_000;
      let keep = false;
      for (const r of this.rt.values()) {
        next = Math.min(next, r.dp.tick(now));
        for (const d of r.dp.devices()) if (now < (r.dp.peer(d)?.path.activeUntil ?? 0)) keep = true;
      }
      // keepalives only while peers are active: otherwise wake rarely
      if (keep !== this.keepalive) {
        this.keepalive = keep;
        void this.syncAll().catch(() => undefined);
      }
      this.schedule(next);
    }, ms);
    this.timer.unref?.();
  }

  private keepalive = false;
  /** the mesh is on and running here (even with no networks yet) */
  private running = false;

  // ---------------------------------------------------------------- the OS side

  private prefixes(): string[] {
    return this.data.networks.flatMap((n) => [n.prefix6, ...(n.prefix4 ? [n.prefix4] : [])]);
  }

  private my(net: MeshNetwork) {
    const a6 = deviceAddr6(net.id, this.link.id);
    const a4 = net.ipv4 && net.prefix4 && !this.conflict(net) ? deviceAddr4(net.prefix4, net.id, this.link.id, this.peerA4s(net.id)) : undefined;
    return { a6, a4 };
  }

  private conflicts4 = new Map<string, string>();

  private conflict(net: MeshNetwork): string | undefined {
    return this.conflicts4.get(net.id);
  }

  private peerA4s(net: string): string[] {
    return Object.entries(this.data.peers).filter(([k]) => k.startsWith(net + '/')).map(([, v]) => v.rec.a4).filter((x): x is string => !!x);
  }

  private records(net: string): MeshRecord[] {
    const n = this.data.networks.find((x) => x.id === net);
    if (!n) return [];
    return n.members.map((m) => this.data.peers[`${net}/${m.device}`]?.rec).filter((r): r is MeshRecord => !!r);
  }

  private keyFor(rec: MeshRecord) {
    return pathKey({ dev: this.link.id, pk: this.data.pk }, { dev: rec.dev, pk: rec.pk });
  }

  /** The WireGuard peers of one network. */
  wgPeers(net: string): WgPeerConf[] {
    const r = this.rt.get(net);
    const now = Date.now();
    return this.records(net).map((rec) => {
      const isExit = this.data.exit.using === rec.dev && this.data.exit.net === net && !!rec.exit;
      const shim = r?.dp.shimPort(rec.dev);
      const active = now < (r?.dp.peer(rec.dev)?.path.activeUntil ?? 0);
      return {
        name: rec.name,
        pub: rec.wg,
        allowed: allowedIps(rec, { exit: isExit, acceptRoutes: this.data.acceptRoutes.includes(rec.dev) }),
        endpoint: shim ? `127.0.0.1:${shim}` : undefined,
        keepalive: active ? 25 : 0,
      };
    });
  }

  private ifaceCtx(r: NetRuntime): IfaceCtx {
    const net = r.net;
    const { a6, a4 } = this.my(net);
    const peers = this.wgPeers(net.id);
    const base = { priv: this.wg!.priv, listenPort: net.wgPort, peers };
    const impl = this.impl?.impl ?? 'kernel';
    const exitRec = this.data.exit.net === net.id ? this.records(net.id).find((x) => x.dev === this.data.exit.using && x.exit) : undefined;
    const conf =
      this.driver.os === 'win32'
        ? quickConf(base, { addresses: [`${a6}/48`, ...(a4 && net.prefix4 ? [`${a4}/${net.prefix4.split('/')[1]}`] : [])], mtu: MTU, dns: exitRec && this.data.exit.dnsThrough ? [exitRec.a6] : undefined })
        : impl === 'kernel'
          ? setconf(base)
          : uapiSet(base);
    return { noV6: this.driver.hasIPv6?.() === false, os: this.driver.os, iface: r.iface, impl, a6, a4, prefix6: net.prefix6, prefix4: a4 ? net.prefix4 : undefined, mtu: MTU, conf, bin: this.impl?.bin, wg: this.impl?.wg, confPath: this.driver.confPath?.(r.iface) };
  }

  private canApply() {
    return !!this.impl?.impl && this.impl.state !== 'no-wireguard';
  }

  private applied(): Applied {
    return (this.data.applied ??= emptyApplied(this.driver.os));
  }

  /** Records first, then runs: a crash in between still leaves a complete cleanup plan. */
  private async runRecorded(steps: Step[], record: (a: Applied) => void) {
    record(this.applied());
    await this.save();
    const hosts = this.applied().hosts ? await this.driver.readHosts().catch(() => undefined) : undefined;
    await this.driver.setCleanup(cleanupPlan(this.applied(), hosts)).catch(() => undefined);
    if (!steps.length) return { ok: true, message: '' };
    return this.driver.run(steps);
  }

  private async applyAll() {
    // IPv4 ranges already used here
    const local = await this.driver.localPrefixes().catch(() => [] as string[]);
    for (const n of this.data.networks) {
      const hit = n.prefix4 ? conflicts(n.prefix4, local.filter((c) => !inMesh(c.split('/')[0], this.prefixes()))) : [];
      if (hit.length) this.conflicts4.set(n.id, `${n.prefix4} is already used here by ${hit[0]}; this device uses IPv6 only in ${n.name}`);
      else this.conflicts4.delete(n.id);
    }
    if (!this.canApply()) {
      this.iface = { state: this.impl?.state === 'error' ? 'error' : 'config-only', impl: 'none', message: this.impl?.message ?? 'WireGuard is not available on this computer: keys, addresses and paths work, the network card does not' };
      return;
    }
    let ok = true;
    let message = '';
    for (const r of this.rt.values()) {
      const ctx = this.ifaceCtx(r);
      const routes = this.acceptedRoutes(r.net.id);
      const steps = [...ifaceUp(ctx), ...routesUp(this.driver.os, r.iface, routes), ...aclUp(this.driver.os, r.iface, this.acl(r.net), this.dns?.port ?? 53)];
      const res = await this.runRecorded(steps, (a) => {
        if (!a.ifaces.some((x) => x.iface === r.iface)) a.ifaces.push({ os: ctx.os, iface: r.iface, impl: ctx.impl, bin: ctx.bin, confPath: ctx.confPath });
        if (routes.length) a.routes = [...a.routes.filter((x) => x.iface !== r.iface), { iface: r.iface, cidrs: routes }];
        a.acl = true;
      });
      r.up = res.ok;
      if (!res.ok) {
        ok = false;
        message = res.message;
      }
    }
    this.iface = ok
      ? { state: 'up', impl: this.impl!.impl, name: [...this.rt.values()].map((r) => r.iface).join(', ') }
      : { state: /cancel|dismiss|not authorized|denied/i.test(message) ? 'needs-admin' : 'error', impl: this.impl!.impl, message: message || 'Could not set up the network card' };
    if (ok) {
      await this.restartDnsOnMesh();
      await this.applyExit();
    }
  }

  /** Brings a running interface up to date (new peer, new key, keepalive change, new routes). */
  private async syncNet(r: NetRuntime) {
    if (!r.up || !this.canApply()) return;
    const ctx = this.ifaceCtx(r);
    const routes = this.acceptedRoutes(r.net.id);
    await this.runRecorded([...ifaceSync(ctx), ...routesUp(this.driver.os, r.iface, routes), ...aclUp(this.driver.os, r.iface, this.acl(r.net), this.dns?.port ?? 53)], (a) => {
      a.routes = [...a.routes.filter((x) => x.iface !== r.iface), ...(routes.length ? [{ iface: r.iface, cidrs: routes }] : [])];
    });
  }

  private async syncAll() {
    for (const r of this.rt.values()) await this.syncNet(r);
  }

  private acceptedRoutes(net: string): string[] {
    return this.records(net).filter((r) => this.data.acceptRoutes.includes(r.dev)).flatMap((r) => r.routes ?? []);
  }

  private acl(net: MeshNetwork) {
    return compileAcl(
      net.rules,
      net.members.map((m) => {
        const rec = this.data.peers[`${net.id}/${m.device}`]?.rec;
        return { device: m.device, role: m.role, addrs: rec ? [rec.a6, ...(rec.a4 ? [rec.a4] : [])] : [] };
      }),
    );
  }

  // ---------------------------------------------------------------- names

  private labels(): Map<string, { a4?: string; a6?: string }> {
    const m = new Map<string, { a4?: string; a6?: string }>();
    const first = this.data.networks[0];
    if (first) m.set(dnsLabel(this.link.name()), this.my(first));
    for (const n of this.data.networks)
      for (const rec of this.records(n.id)) {
        const l = dnsLabel(rec.name, [...m.keys()].filter((k) => m.get(k)?.a6 !== rec.a6));
        if (!m.has(l)) m.set(l, { a6: rec.a6, a4: rec.a4 });
      }
    return m;
  }

  private async startDns() {
    this.dns?.close();
    const names = this.labels.bind(this);
    this.dns = new MeshDnsServer({
      suffix: () => this.data.suffix,
      names: { get: (l) => names().get(l) },
      forward: () => (this.data.offerExit ? systemDns() : []),
      mayForward: (from) => inMesh(from.replace(/^::ffff:/, ''), this.prefixes()),
    });
    // Until the network card is up, names are answered on this computer only (for checking).
    await this.dns.listen('127.0.0.1', [5053, 0]).catch(() => undefined);
  }

  private async restartDnsOnMesh() {
    const first = [...this.rt.values()].find((r) => r.up);
    if (!first || !this.dns) return;
    const me = this.my(first.net);
    // no IPv6 on this kernel: answer on the IPv4 mesh address
    const a6 = this.driver.hasIPv6?.() === false && me.a4 ? me.a4 : me.a6;
    this.dns.close();
    try {
      await this.dns.listen(a6, this.driver.os === 'win32' ? [53] : [53, 5053]);
    } catch (e) {
      this.dnsSplit = 'failed';
      this.dnsMessage = `Names: could not listen on ${a6} (${(e as Error).message})`;
      await this.dns.listen('127.0.0.1', [5053, 0]).catch(() => undefined);
      return;
    }
    const steps: Step[] = [...dnsUp({ os: this.driver.os, iface: first.iface, server: a6, port: this.dns.port, suffix: this.data.suffix })];
    const hostsNow = this.data.hosts ? await this.driver.readHosts().catch(() => '') : '';
    if (this.data.hosts) steps.push(...hostsWrite(this.driver.os, withHostsBlock(hostsNow, [...this.labels()].map(([l, a]) => ({ ip: a.a6!, names: [`${l}.${this.data.suffix}`] })))));
    const r = await this.runRecorded(steps, (a) => {
      a.dns = [{ iface: first.iface, suffix: this.data.suffix }];
      a.hosts = this.data.hosts;
    });
    this.dnsSplit = r.ok ? 'on' : 'failed';
    this.dnsMessage = r.ok ? undefined : `Split DNS: ${r.message}`;
  }

  // ---------------------------------------------------------------- exit node and routes

  private async applyExit() {
    if (!this.canApply()) return;
    const d = await this.driver.defaults().catch(() => ({ lan: [] as string[] }) as Awaited<ReturnType<MeshDriver['defaults']>>);
    if (this.data.offerExit || this.data.advertise.length) {
      const first = [...this.rt.values()].find((r) => r.up);
      if (first) {
        const before = d.forwarding ?? {};
        const noV6 = this.driver.hasIPv6?.() === false;
        await this.runRecorded(exitServeUp({ os: this.driver.os, iface: first.iface, prefix6: first.net.prefix6, prefix4: first.net.prefix4, wan: d.wan, noV6 }), (a) => {
          a.exitServe ??= { iface: first.iface, before, noV6 };
        });
      }
    }
    const using = this.data.exit.using;
    const r = using ? this.rt.get(this.data.exit.net ?? '') : undefined;
    const rec = r ? this.records(r.net.id).find((x) => x.dev === using && x.exit) : undefined;
    if (r && rec) {
      const path = r.dp.peer(rec.dev)?.path.best;
      const relayHost = this.relay?.url ? new URL(this.relay.url).hostname : undefined;
      const bypass = [...new Set([...(path ? [path.host] : []), ...rec.cands.map((c) => splitAddr(c.addr)?.host).filter((x): x is string => !!x), ...(relayHost && /^[\d.:a-f]+$/i.test(relayHost) ? [relayHost] : [])])];
      const ctx = { noV6: this.driver.hasIPv6?.() === false, os: this.driver.os, iface: r.iface, bypass, gw4: d.gw4, gw6: d.gw6, wan: d.wan, killSwitch: this.data.exit.killSwitch, allowLan: this.data.exit.allowLan, lan: d.lan, dns: this.data.exit.dnsThrough ? rec.a6 : undefined, services: d.services };
      await this.syncNet(r);
      await this.runRecorded(exitUseUp(ctx), (a) => {
        a.exitUse = ctx;
      });
    }
  }

  async setExit(device: string | null, o: { killSwitch?: boolean; dnsThrough?: boolean; allowLan?: boolean } = {}) {
    const net = device ? this.data.networks.find((n) => this.data.peers[`${n.id}/${device}`]?.rec.exit) : undefined;
    if (device && !net) throw new Error('That device does not offer itself as an exit node');
    this.data.exit = { ...this.data.exit, ...o, using: device ?? undefined, net: net?.id };
    await this.save();
    await this.reapply();
    return this.state();
  }

  async offerExit(on: boolean) {
    if (on && this.hooks.confirm && !(await this.hooks.confirm('Let your devices use this computer to reach the internet?', 'Their traffic leaves through this computer’s connection. Keeper turns on IP forwarding and address translation, which needs your administrator password.'))) return this.state();
    this.data.offerExit = on;
    await this.save();
    await this.reapply();
    await this.announce();
    return this.state();
  }

  async advertise(routes: string[]) {
    const clean = [...new Set(routes.map((r) => r.trim()).filter(Boolean))];
    for (const r of clean) {
      const p = r.split('/');
      if (p.length !== 2 || !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|f[cd])/i.test(p[0])) throw new Error(`${r} is not a private network range (like 192.168.1.0/24)`);
      if (inMesh(p[0], this.prefixes())) throw new Error(`${r} is the mesh itself`);
    }
    if (clean.length && this.hooks.confirm && !(await this.hooks.confirm(`Share ${clean.join(', ')} with your mesh?`, 'Your devices will reach these addresses through this computer. Keeper turns on IP forwarding, which needs your administrator password.'))) return this.state();
    this.data.advertise = clean;
    await this.save();
    await this.reapply();
    await this.announce();
    return this.state();
  }

  async acceptRoutes(device: string, on: boolean) {
    const mine = await this.driver.localPrefixes().catch(() => [] as string[]);
    if (on) {
      const recs = this.data.networks.map((n) => this.data.peers[`${n.id}/${device}`]?.rec).filter(Boolean) as MeshRecord[];
      const clash = recs.flatMap((r) => r.routes ?? []).find((rt) => conflicts(rt, mine).length);
      if (clash) throw new Error(`${clash} overlaps a network this computer is on; not using it`);
    }
    this.data.acceptRoutes = on ? [...new Set([...this.data.acceptRoutes, device])] : this.data.acceptRoutes.filter((d) => d !== device);
    await this.save();
    await this.syncAll();
    return this.state();
  }

  /** Puts exit and route changes into the system: the simplest safe way is down and up again. */
  private async reapply() {
    if (!this.running) return;
    await this.down(true);
    await this.up();
  }

  /** Sends fresh records to every member (after a change they need to know about). */
  private async announce() {
    for (const n of this.data.networks) for (const m of n.members) void this.hello(n.id, m.device).catch(() => undefined);
  }

  // ---------------------------------------------------------------- networks and members

  async createNetwork(name: string, ipv4 = true) {
    const id = newNetworkId();
    const local = await this.driver.localPrefixes().catch(() => [] as string[]);
    const net: MeshData['networks'][number] = { id, name: name.trim() || 'Home', members: [], rules: [], ipv4, prefix6: networkPrefix6(id), prefix4: ipv4 ? (networkPrefix4(id, local) ?? undefined) : undefined, created: Date.now(), owner: this.link.id };
    this.data.networks.push(net);
    await this.save();
    if (this.running) await this.reapply();
    return this.state();
  }

  async renameNetwork(id: string, name: string) {
    const n = this.net(id);
    n.name = name.trim() || n.name;
    await this.save();
    return this.state();
  }

  async removeNetwork(id: string) {
    const n = this.net(id);
    for (const m of n.members) void this.ctl(m.device, 'leave', { net: id }).catch(() => undefined);
    this.data.networks = this.data.networks.filter((x) => x.id !== id);
    for (const k of Object.keys(this.data.peers)) if (k.startsWith(id + '/')) delete this.data.peers[k];
    await this.save();
    if (this.running) await this.reapply();
    return this.state();
  }

  private net(id: string) {
    const n = this.data.networks.find((x) => x.id === id);
    if (!n) throw new Error('No such mesh network');
    return n;
  }

  /** Invites a paired device; the person there says yes or no. */
  async addMember(netId: string, device: string, role: MeshRole) {
    const n = this.net(netId);
    if (!this.link.devices().some((d) => d.id === device)) throw new Error('Pair that device with Keeper Link first');
    if (!n.members.some((m) => m.device === device)) n.members.push({ device, role, added: Date.now() });
    await this.save();
    this.relayAllow();
    await this.ctl(device, 'invite', { net: this.publicNet(n), role });
    return this.state();
  }

  async removeMember(netId: string, device: string) {
    const n = this.net(netId);
    n.members = n.members.filter((m) => m.device !== device);
    delete this.data.peers[`${netId}/${device}`];
    this.rt.get(netId)?.dp.removePeer(device);
    await this.save();
    void this.ctl(device, 'leave', { net: netId }).catch(() => undefined);
    const r = this.rt.get(netId);
    if (r) await this.syncNet(r);
    return this.state();
  }

  private publicNet(n: MeshNetwork) {
    return { id: n.id, name: n.name, ipv4: n.ipv4, prefix6: n.prefix6, prefix4: n.prefix4, owner: n.owner, created: n.created };
  }

  async answerInvite(id: string, ok: boolean) {
    const inv = this.invites.get(id);
    if (!inv) throw new Error('That invitation has gone');
    this.invites.delete(id);
    if (ok) {
      const p = inv as MeshInvite & { pub: ReturnType<MeshEngine['publicNet']> };
      if (!this.data.networks.some((n) => n.id === inv.net)) {
        this.data.networks.push({ ...p.pub, members: [{ device: inv.from, role: inv.role, added: Date.now() }], rules: [] });
      } else {
        const n = this.net(inv.net);
        if (!n.members.some((m) => m.device === inv.from)) n.members.push({ device: inv.from, role: inv.role, added: Date.now() });
      }
      await this.save();
      this.relayAllow();
      const others = await this.ctl<{ device: string; role: MeshRole }[]>(inv.from, 'joined', { net: inv.net }).catch(() => []);
      // The inviter's other devices in this network that this device is paired with as well (own devices only).
      const n = this.net(inv.net);
      for (const o of others ?? []) if (o.role === 'own' && inv.role === 'own' && o.device !== this.link.id && this.link.devices().some((d) => d.id === o.device) && !n.members.some((m) => m.device === o.device)) n.members.push({ device: o.device, role: 'own', added: Date.now() });
      await this.save();
      if (this.running) await this.reapply();
      for (const m of n.members) void this.hello(n.id, m.device).catch(() => undefined);
    } else void this.ctl(inv.from, 'leave', { net: inv.net, declined: true }).catch(() => undefined);
    this.changed();
    return this.state();
  }

  async saveRule(netId: string, rule: MeshRule) {
    const n = this.net(netId);
    parsePorts(rule.ports);
    const r = { ...rule, id: rule.id || crypto.randomBytes(4).toString('hex') };
    n.rules = [...n.rules.filter((x) => x.id !== r.id), r];
    await this.save();
    const rt = this.rt.get(netId);
    if (rt) await this.syncNet(rt);
    return this.state();
  }

  async removeRule(netId: string, id: string) {
    const n = this.net(netId);
    n.rules = n.rules.filter((x) => x.id !== id);
    await this.save();
    const rt = this.rt.get(netId);
    if (rt) await this.syncNet(rt);
    return this.state();
  }

  async setPlaces(p: Partial<Record<MeshControl, MeshPlace[]>>) {
    this.data.places = cleanPlaces({ ...cleanPlaces(this.data.places), ...p });
    await this.save();
    this.changed();
    return this.state();
  }

  async setDns(p: { suffix?: string; hosts?: boolean }) {
    if (p.suffix !== undefined) this.data.suffix = cleanSuffix(p.suffix);
    if (p.hosts !== undefined) this.data.hosts = p.hosts;
    await this.save();
    if (this.running) await this.reapply();
    return this.state();
  }

  // ---------------------------------------------------------------- the Link side

  /** One request to another device over Link: stream "mesh.ctl". */
  async ctl<T = unknown>(device: string, op: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    const mux = await this.link.connect(device);
    const st = mux.open({ k: 'mesh.ctl', op });
    await st.writeJson(body);
    st.end();
    const reply = await Promise.race([st.readAll(1 << 20), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${op}: no answer`)), timeoutMs).unref?.())]);
    const r = JSON.parse(reply.data.toString('utf8') || 'null') as { ok?: boolean; r?: T; e?: string } | null;
    if (!r?.ok) throw new Error(r?.e ?? 'The other device refused');
    return r.r as T;
  }

  private async serve(st: Stream, device: string) {
    const op = String(st.meta.op ?? '');
    let res: { ok: boolean; r?: unknown; e?: string };
    try {
      const { data } = await st.readAll(1 << 20);
      const body = JSON.parse(data.toString('utf8') || '{}') as Record<string, unknown>;
      res = { ok: true, r: await this.handle(device, op, body) };
    } catch (e) {
      res = { ok: false, e: e instanceof Error ? e.message : String(e) };
    }
    await st.writeJson(res).catch(() => undefined);
    st.end();
  }

  private async handle(device: string, op: string, b: Record<string, unknown>): Promise<unknown> {
    if (!this.featureOn()) throw new Error('Keeper Mesh is off on that device');
    const netId = String(b.net && typeof b.net === 'object' ? (b.net as { id: string }).id : b.net ?? '');
    switch (op) {
      case 'invite': {
        const pub = b.net as ReturnType<MeshEngine['publicNet']>;
        if (!/^[0-9a-f]{16}$/.test(pub?.id ?? '') || pub.prefix6 !== networkPrefix6(pub.id)) throw new Error('bad network');
        if (pub.prefix4 && !/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.0\.0\/16$/.test(pub.prefix4)) throw new Error('bad network');
        const existing = this.data.networks.find((n) => n.id === pub.id);
        if (existing?.members.some((m) => m.device === device)) return { already: true };
        const dev = this.link.devices().find((d) => d.id === device);
        const inv: MeshInvite & { pub: typeof pub } = { id: crypto.randomBytes(6).toString('hex'), net: pub.id, name: String(pub.name).slice(0, 60), from: device, fromName: dev?.name ?? device, role: b.role === 'own' ? 'own' : 'guest', pub };
        this.invites.set(inv.id, inv);
        this.hooks.invite?.(inv);
        this.changed();
        return { pending: true };
      }
      case 'joined': {
        const n = this.net(netId);
        const me = n.members.find((m) => m.device === device);
        if (!me) throw new Error('not invited');
        n.joined = [...new Set([...(n.joined ?? []), device])];
        await this.save();
        // Tell this network's other own devices, and tell the new one about them.
        const others = n.members.filter((m) => m.device !== device);
        if (me.role === 'own') for (const o of others.filter((m) => m.role === 'own')) void this.ctl(o.device, 'introduce', { net: netId, device }).catch(() => undefined);
        void this.hello(netId, device).catch(() => undefined);
        return me.role === 'own' ? others.map((o) => ({ device: o.device, role: o.role })) : [];
      }
      case 'introduce': {
        const n = this.net(netId);
        const by = n.members.find((m) => m.device === device);
        const who = String(b.device ?? '');
        if (by?.role !== 'own') throw new Error('only your own devices introduce others');
        if (this.link.devices().some((d) => d.id === who) && !n.members.some((m) => m.device === who)) {
          n.members.push({ device: who, role: 'own', added: Date.now() });
          await this.save();
          this.relayAllow();
        }
        return true;
      }
      case 'hello': {
        const n = this.net(netId);
        if (!n.members.some((m) => m.device === device)) throw new Error('not a member of that network');
        await this.accept(n, device, b.rec as SignedRecord);
        const mine = this.myRecord(n, device);
        // Both sides punch now: this side straight after answering, the other when the answer arrives.
        setTimeout(() => this.rt.get(n.id)?.dp.punch(device), 20).unref?.();
        return mine;
      }
      case 'punch': {
        this.rt.get(netId)?.dp.punch(device);
        return true;
      }
      case 'leave': {
        const n = this.data.networks.find((x) => x.id === netId);
        if (!n) return true;
        n.members = n.members.filter((m) => m.device !== device);
        delete this.data.peers[`${netId}/${device}`];
        this.rt.get(netId)?.dp.removePeer(device);
        // a network with nobody else in it that someone else made: gone
        if (!n.members.length && n.owner !== this.link.id) this.data.networks = this.data.networks.filter((x) => x.id !== netId);
        await this.save();
        this.changed();
        return true;
      }
      default:
        throw new Error(`Unknown mesh request ${op}`);
    }
  }

  private myRecord(n: MeshData['networks'][number], to: string): SignedRecord {
    if (!this.wg) throw new Error('Keeper Mesh is not on here');
    const r = this.rt.get(n.id);
    const { a6, a4 } = this.my(n);
    this.data.seq++;
    const rec: MeshRecord = {
      v: 1,
      net: n.id,
      dev: this.link.id,
      to,
      name: this.link.name(),
      wg: this.wg.pub,
      a6,
      ...(a4 ? { a4 } : {}),
      port: r?.dp.port ?? n.port ?? MESH_PORT,
      cands: this.forceRelay ? (r?.cands ?? []).filter((c) => c.kind === 'relay') : (r?.cands ?? []),
      pk: this.data.pk,
      ...(this.data.offerExit ? { exit: true } : {}),
      ...(this.data.advertise.length ? { routes: this.data.advertise } : {}),
      seq: this.data.seq,
      ts: Date.now(),
    };
    void this.save();
    return signRecord(this.link.me, rec);
  }

  /** Checks a peer's record against the identity pinned at pairing, then uses it. */
  private async accept(n: MeshNetwork, device: string, s: SignedRecord) {
    const dev = this.link.devices().find((d) => d.id === device);
    if (!dev) throw new Error('not paired');
    const key = `${n.id}/${device}`;
    const v = verifyRecord(dev.pub, s, { net: n.id, to: this.link.id, prefix4: n.prefix4, lastSeq: this.data.peers[key]?.rec.seq });
    if (!v.ok) throw new Error(`Refused ${dev.name}'s mesh key: ${v.why}`);
    // An IPv4 address another member already has: that device uses IPv6 only here.
    const rec = { ...v.rec };
    if (rec.a4 && this.records(n.id).some((x) => x.dev !== device && x.a4 === rec.a4)) delete rec.a4;
    this.data.peers[key] = { rec, at: Date.now() };
    await this.save();
    const r = this.rt.get(n.id);
    if (r) {
      await r.dp.addPeer(device, this.keyFor(rec), this.forceRelay ? [] : rec.cands);
      await this.syncNet(r);
    }
    this.changed();
  }

  /** Sends this device's record and takes the peer's (both signed), then punches. */
  async hello(netId: string, device: string) {
    const n = this.net(netId);
    if (!this.running || !this.wg) return;
    const theirs = await this.ctl<SignedRecord>(device, 'hello', { net: netId, rec: this.myRecord(n, device) });
    await this.accept(n, device, theirs);
    this.rt.get(netId)?.dp.punch(device);
    this.schedule(0);
  }

  // ---------------------------------------------------------------- what the window sees

  private async readStats() {
    for (const r of this.rt.values()) {
      if (!r.up) continue;
      const s = await this.driver.stats(r.iface, this.impl?.impl ?? '').catch(() => [] as WgPeerStats[]);
      for (const x of s) this.stats.set(x.pub, x);
    }
  }

  async refreshState() {
    await this.readStats();
    return this.state();
  }

  state(): MeshState {
    const names = new Map(this.link.devices().map((d) => [d.id, d.name]));
    const nets: MeshNetView[] = this.data.networks.map((n) => {
      const r = this.rt.get(n.id);
      const me = this.my(n);
      const labels = this.labels();
      const peers: MeshPeerView[] = n.members.map((m) => {
        const pr = this.data.peers[`${n.id}/${m.device}`];
        const rec = pr?.rec;
        const peer = r?.dp.peer(m.device);
        const st = rec ? this.stats.get(rec.wg) : undefined;
        const label = rec ? [...labels].find(([, a]) => a.a6 === rec.a6)?.[0] : undefined;
        return {
          device: m.device,
          name: names.get(m.device) ?? rec?.name ?? m.device,
          dns: label ? `${label}.${this.data.suffix}` : '',
          role: m.role,
          online: this.link.online(m.device),
          joined: !!rec,
          a6: rec?.a6,
          a4: rec?.a4,
          wgKey: rec ? shortKey(rec.wg) : undefined,
          path: peer?.path.path ?? 'none',
          endpoint: peer?.path.best ? joinAddr(peer.path.best.host, peer.path.best.port) : peer?.path.state === 'relay' ? this.relay?.url : undefined,
          latencyMs: peer?.path.best?.rtt,
          lastHandshake: st?.lastHandshake || undefined,
          rx: st?.rx ?? peer?.rx ?? 0,
          tx: st?.tx ?? peer?.tx ?? 0,
          offersExit: !!rec?.exit,
          routes: rec?.routes ?? [],
          routesAccepted: this.data.acceptRoutes.includes(m.device),
          keyVerified: !!rec,
        };
      });
      const myLabel = dnsLabel(this.link.name());
      return { ...n, me: { ...me, dns: `${myLabel}.${this.data.suffix}` }, peers, conflict: this.conflict(n) };
    });
    return {
      feature: this.featureOn(),
      on: this.data.on,
      iface: this.iface,
      wgPub: this.wg?.pub,
      port: [...this.rt.values()][0]?.dp.port ?? MESH_PORT,
      candidates: [...this.rt.values()][0]?.cands ?? [],
      networks: nets,
      exit: { using: this.data.exit.using, offering: this.data.offerExit, killSwitch: this.data.exit.killSwitch, dnsThrough: this.data.exit.dnsThrough, allowLan: this.data.exit.allowLan },
      advertise: { routes: this.data.advertise, approved: this.data.advertise.length > 0 },
      dns: { suffix: this.data.suffix, responder: this.dns?.address ? joinAddr(this.dns.address, this.dns.port) : undefined, split: this.dnsSplit, hosts: this.data.hosts, message: this.dnsMessage },
      relay: this.relay ? { url: this.relay.url, connected: this.relay.connected } : undefined,
      places: cleanPlaces(this.data.places),
      invites: [...this.invites.values()].map(({ id, net, name, from, fromName, role }) => ({ id, net, name, from, fromName, role })),
    };
  }

  /** Internal details for tests and the troubleshooting panel. */
  runtime(net: string) {
    const r = this.rt.get(net);
    return r ? { iface: r.iface, port: r.dp.port, wgPort: r.net.wgPort, relayed: r.dp.relayed, shim: (d: string) => r.dp.shimPort(d), path: (d: string) => r.dp.peer(d)?.path } : undefined;
  }

  /** The generated configuration, private key left out. */
  config(netId: string): string {
    const n = this.net(netId);
    const { a6, a4 } = this.my(n);
    const r = this.rt.get(netId);
    const peers = this.wgPeers(netId).map((p) => ({ ...p, endpoint: p.endpoint ?? undefined }));
    return redact(quickConf({ priv: this.wg?.priv ?? '', listenPort: n.wgPort, peers }, { addresses: [`${a6}/48`, ...(a4 && n.prefix4 ? [`${a4}/${n.prefix4.split('/')[1]}`] : [])], mtu: MTU, table: r && this.driver.os !== 'win32' ? 'off' : undefined }));
  }

  // ---------------------------------------------------------------- troubleshooting

  private findPeer(device: string) {
    for (const r of this.rt.values()) {
      const rec = this.data.peers[`${r.net.id}/${device}`]?.rec;
      if (rec) return { r, rec };
    }
    throw new Error('That device is not in a running mesh network with this one');
  }

  async ping(device: string): Promise<MeshDiag> {
    const { r, rec } = this.findPeer(device);
    if (r.up && this.driver.ping) return this.driver.ping(rec.a4 ?? rec.a6);
    const p = r.dp.peer(device)?.path;
    if (!p) return { ok: false, lines: ['No path to that device yet'] };
    const before = p.best?.at ?? 0;
    p.touch(Date.now());
    r.dp.punch(device);
    await new Promise((res) => setTimeout(res, 1500));
    const ok = !!p.best && p.best.at >= before;
    return { ok: ok || p.state === 'relay', lines: [ok ? `Reply from ${joinAddr(p.best!.host, p.best!.port)} in ${p.best!.rtt} ms (path probe; the network card is not up)` : p.state === 'relay' ? 'Reachable through the relay' : 'No reply'] };
  }

  async pathTest(device: string): Promise<MeshDiag> {
    const { r, rec } = this.findPeer(device);
    const lines = [`This device: ${r.cands.map((c) => `${c.kind} ${c.addr}`).join(', ') || 'no candidates'}`, `${rec.name}: ${rec.cands.map((c) => `${c.kind} ${c.addr}`).join(', ') || 'no candidates'}`];
    await this.ctl(device, 'punch', { net: r.net.id }).catch((e) => lines.push(`Could not ask it to punch: ${(e as Error).message}`));
    r.dp.punch(device);
    this.schedule(0);
    const p = r.dp.peer(device)?.path;
    const t0 = Date.now();
    while (p && p.state === 'punching' && Date.now() - t0 < 6500) await new Promise((res) => setTimeout(res, 100));
    const path = p?.path ?? 'none';
    lines.push(`Path: ${({ lan: 'Direct (LAN)', internet: 'Direct (internet)', relay: 'Relayed', none: 'Not connected' } as const)[path]}${p?.best ? ` via ${joinAddr(p.best.host, p.best.port)}, ${p.best.rtt} ms` : ''}`);
    lines.push(`Relay: ${this.relay ? (this.relay.connected ? `connected (${this.relay.url})` : 'not connected') : 'not set (Devices → Remote access)'}`);
    return { ok: path !== 'none', lines };
  }

  async mtuProbe(device: string): Promise<MeshDiag> {
    const { r, rec } = this.findPeer(device);
    if (r.up && this.driver.mtu) return this.driver.mtu(rec.a4 ?? rec.a6);
    return { ok: true, lines: [`The mesh uses an MTU of ${MTU}, which fits inside any internet path and the relay. Measuring needs the network card up.`] };
  }
}

/** A UDP port nobody uses right now (for WireGuard's own listening port). */
async function freeUdpPort(): Promise<number> {
  const dgram = await import('node:dgram');
  const s = dgram.createSocket('udp4');
  await new Promise<void>((r) => s.bind(0, '127.0.0.1', () => r()));
  const p = s.address().port;
  s.close();
  return p;
}

/** This computer's DNS servers (for answering an exit node's peers). */
function systemDns(): string[] {
  try {
    return dnsMod.getServers().map((s) => s.replace(/^\[|\](:\d+)?$/g, '').replace(/:53$/, '')).filter((s) => !/^127\./.test(s));
  } catch {
    return [];
  }
}
