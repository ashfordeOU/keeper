// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote Desktop in a Keeper tab, the main-process half.
//
// The tab runs the RDP engine (IronRDP's WebAssembly client, the downloadable
// component "ironrdp"). It cannot open TCP or TLS, so for each session Keeper
// listens on 127.0.0.1 (a random port) and the engine opens a WebSocket there,
// naming a random per-session token. The relay checks the token and the target,
// dials the computer (directly, or through the gateway's local end: SSH tunnel,
// proxy, Keeper Link or mesh), passes on the X.224 request, does the TLS
// handshake itself and checks the certificate against the one the person
// trusted, then copies bytes both ways (see core/rdc/rdcleanpath.ts).
//
// Nothing listens before a session starts, and the listener closes with it.

import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { acceptWebSocket, type WsServerConn } from '../../../core/link/ws';
import {
  certVerdict, failureText, MAX_REQUEST, parseConfirm, parseRelayRequest, pduLength, pinOf, PROTOCOL_HYBRID, PROTOCOL_SSL,
  RDCP_GENERAL_ERROR, RDCP_NEGOTIATION_ERROR, RDCP_TARGET_UNREACHABLE, RDCP_TLS_FAILED, relayError, relayResponse, tpktLength, x224Request, colonHex,
} from '../../../core/rdc/rdcleanpath';
import { destinationOf, relayRefusal } from '../../../core/rdc/rdp-tab';

export interface ServerCert {
  /** "sha256/…", what a connection pins */
  pin: string;
  sha256: string;
  sha1: string;
  subject?: string;
  issuer?: string;
  /** the system trusts it for this name */
  systemTrusted: boolean;
}

function describe(sock: tls.TLSSocket, name: string): ServerCert | null {
  const c = sock.getPeerCertificate(false);
  if (!c?.raw) return null;
  const sha256 = createHash('sha256').update(c.raw).digest();
  const sha1 = createHash('sha1').update(c.raw).digest();
  let systemTrusted = sock.authorized;
  if (systemTrusted && !net.isIP(name)) {
    try { systemTrusted = !!new X509Certificate(c.raw).checkHost(name); } catch { systemTrusted = false; }
  }
  const dn = (o?: Record<string, unknown>) => (o?.CN ? String(o.CN) : undefined);
  return { pin: pinOf(sha256), sha256: colonHex(sha256), sha1: colonHex(sha1), subject: dn(c.subject as never), issuer: dn(c.issuer as never), systemTrusted };
}

/** The certificate chain the server sent, leaf first, as DER. */
function chainOf(sock: tls.TLSSocket): Uint8Array[] {
  const out: Uint8Array[] = [];
  let c: tls.DetailedPeerCertificate | undefined = sock.getPeerCertificate(true) as tls.DetailedPeerCertificate;
  const seen = new Set<string>();
  while (c?.raw && !seen.has(c.fingerprint256) && out.length < 8) {
    seen.add(c.fingerprint256);
    out.push(new Uint8Array(c.raw));
    c = c.issuerCertificate;
  }
  return out;
}

/** Reads exactly one TPKT packet from a socket (the X.224 Connection Confirm). */
function readTpkt(sock: net.Socket, timeoutMs: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const done = (e?: Error, v?: Uint8Array) => {
      clearTimeout(t);
      sock.off('data', onData);
      sock.off('error', onErr);
      sock.off('close', onClose);
      if (e) reject(e);
      else resolve(v!);
    };
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      try {
        const n = tpktLength(buf);
        if (n === null || buf.length < n) return;
        // Nothing follows a Connection Confirm until the client starts TLS.
        if (buf.length > n) sock.unshift(buf.subarray(n));
        done(undefined, new Uint8Array(buf.subarray(0, n)));
      } catch (e) { done(e as Error); }
    };
    const onErr = (e: Error) => done(e);
    const onClose = () => done(new Error('The computer closed the connection'));
    const t = setTimeout(() => done(new Error('The computer did not answer')), timeoutMs);
    sock.on('data', onData);
    sock.once('error', onErr);
    sock.once('close', onClose);
  });
}

function dial(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    const t = setTimeout(() => { s.destroy(); reject(Object.assign(new Error(`Nothing answers at ${host} on port ${port}`), { code: 'ETIMEDOUT' })); }, timeoutMs);
    s.once('connect', () => { clearTimeout(t); s.setNoDelay(true); resolve(s); });
    s.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function startTls(sock: net.Socket, servername: string, timeoutMs: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    // Checked by fingerprint below, not by the system's list (most computers sign their own).
    const t = tls.connect({ socket: sock, rejectUnauthorized: false, servername: net.isIP(servername) ? undefined : servername, minVersion: 'TLSv1.2' });
    const timer = setTimeout(() => { t.destroy(); reject(new Error('The secure connection did not complete')); }, timeoutMs);
    t.once('secureConnect', () => { clearTimeout(timer); resolve(t); });
    t.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Asks the computer for its certificate before a session starts (the same
 * X.224 and TLS opening the engine makes), so the tab can ask about it first.
 */
export async function probeRdpCert(host: string, port: number, name: string, timeoutMs = 8000): Promise<ServerCert> {
  const sock = await dial(host, port, timeoutMs);
  try {
    sock.write(x224Request(PROTOCOL_SSL | PROTOCOL_HYBRID, 'keeper'));
    const cc = parseConfirm(await readTpkt(sock, timeoutMs));
    if (!cc.ok) throw new Error(failureText(cc.failure));
    if (cc.protocol === 0) throw new Error('This computer only offers the old Remote Desktop security without TLS. Open it in the outside app.');
    const t = await startTls(sock, name, timeoutMs);
    const c = describe(t, name);
    t.destroy();
    if (!c) throw new Error('The computer sent no certificate');
    return c;
  } finally {
    sock.destroy();
  }
}

export interface RelayOpen {
  /** where to dial (the gateway's local end, or the computer itself) */
  host: string;
  port: number;
  /** the computer's own name, for TLS and the certificate check */
  name: string;
  /** what the engine must name as its destination */
  destination: string;
  /** the certificate it must show: a pin, or any when the person accepts any */
  pin?: string;
  acceptAny?: boolean;
  /** the session started, ended or failed (in plain words) */
  onState(state: 'connected' | 'closed' | 'error', error?: string): void;
}

/** A WebSocket listener on 127.0.0.1 for one session's engine. */
export class RdpRelay {
  readonly token = randomBytes(24).toString('base64url');
  port = 0;
  private srv: http.Server | null = null;
  private ws: WsServerConn | null = null;
  private remote: tls.TLSSocket | net.Socket | null = null;
  private closed = false;
  /** bytes copied each way, for tests and the session line */
  sent = 0;
  received = 0;

  constructor(private o: RelayOpen) {}

  /** The address the engine connects to (its path carries the token too). */
  get url() { return `ws://127.0.0.1:${this.port}/rdp/${this.token}`; }
  get destination() { return this.o.destination; }

  listen(): Promise<void> {
    const srv = http.createServer((_req, res) => { res.writeHead(404).end(); });
    srv.on('upgrade', (req, socket, head) => {
      // Only this session's engine: the right path, and only one at a time (a reconnect replaces it).
      if (this.closed || req.url !== `/rdp/${this.token}`) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
      const ws = acceptWebSocket(req, socket, head, 'local');
      if (!ws) return;
      this.dropPeer();
      this.ws = ws;
      this.serve(ws);
    });
    this.srv = srv;
    return new Promise((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => { this.port = (srv.address() as net.AddressInfo).port; resolve(); });
    });
  }

  private dropPeer() {
    const ws = this.ws;
    const remote = this.remote;
    this.ws = null;
    this.remote = null;
    if (ws && !ws.closed) ws.close('replaced');
    remote?.destroy();
  }

  private serve(ws: WsServerConn) {
    let pending = Buffer.alloc(0);
    let started = false;
    const fail = (code: number, why: string, extra: Partial<{ x224: Uint8Array; tlsAlertCode: number; wsaLastError: number }> = {}) => {
      if (!ws.closed) {
        ws.send(relayError({ errorCode: code, tlsAlertCode: extra.tlsAlertCode, wsaLastError: extra.wsaLastError }, extra.x224));
        ws.close(why.slice(0, 100));
      }
      this.o.onState('error', why);
    };
    ws.onmessage = (data) => {
      if (started) {
        // The session itself: straight on to the computer.
        if (this.remote && !this.remote.destroyed) { this.remote.write(data); this.sent += data.length; }
        return;
      }
      pending = Buffer.concat([pending, Buffer.from(data)]);
      let need: number | null;
      try { need = pduLength(pending); } catch { fail(RDCP_GENERAL_ERROR, 'The tab sent something that is not a Remote Desktop request'); return; }
      if (need !== null && need > MAX_REQUEST) { fail(RDCP_GENERAL_ERROR, 'The request is too large'); return; }
      if (need === null || pending.length < need) return;
      started = true;
      const first = pending.subarray(0, need);
      const rest = pending.subarray(need);
      void this.open(ws, new Uint8Array(first), rest, fail);
    };
    ws.onclose = () => {
      if (this.ws === ws) {
        this.remote?.destroy();
        this.remote = null;
        this.ws = null;
        if (!this.closed) this.o.onState('closed');
      }
    };
  }

  private async open(ws: WsServerConn, request: Uint8Array, rest: Buffer, fail: (code: number, why: string, extra?: { x224?: Uint8Array; tlsAlertCode?: number; wsaLastError?: number }) => void) {
    let req;
    try { req = parseRelayRequest(request); } catch (e) { fail(RDCP_GENERAL_ERROR, `The tab sent a request Keeper does not accept (${(e as Error).message})`); return; }
    const why = relayRefusal(req, { token: this.token, destination: this.o.destination });
    if (why) { fail(RDCP_GENERAL_ERROR, why === 'token' ? 'Refused a connection without this session’s token' : 'Refused a connection to another computer'); return; }
    let sock: net.Socket;
    try {
      sock = await dial(this.o.host, this.o.port, 15_000);
    } catch (e) {
      fail(RDCP_TARGET_UNREACHABLE, `${this.o.name} does not answer (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`);
      return;
    }
    if (ws.closed) { sock.destroy(); return; }
    this.remote = sock;
    try {
      sock.write(req.x224);
      const confirm = await readTpkt(sock, 15_000);
      const cc = parseConfirm(confirm);
      if (!cc.ok) { fail(RDCP_NEGOTIATION_ERROR, failureText(cc.failure), { x224: confirm }); sock.destroy(); return; }
      if (cc.protocol === 0) { fail(RDCP_NEGOTIATION_ERROR, 'This computer only offers the old Remote Desktop security without TLS. Open it in the outside app.', { x224: confirm }); sock.destroy(); return; }
      const t = await startTls(sock, this.o.name, 15_000);
      this.remote = t;
      const cert = describe(t, this.o.name);
      const verdict = cert ? certVerdict({ pin: this.o.pin, seen: cert.pin, systemTrusted: cert.systemTrusted, acceptAny: this.o.acceptAny }) : 'ask';
      if (verdict === 'ask' || verdict === 'changed') {
        // The person said yes to another certificate (or to none): this is not that computer.
        fail(RDCP_TLS_FAILED, 'The computer showed a different certificate from the one you trusted. Connect again to check it.', { tlsAlertCode: 42 });
        t.destroy();
        return;
      }
      ws.send(relayResponse(confirm, chainOf(t), `${t.remoteAddress ?? this.o.host}:${t.remotePort ?? this.o.port}`));
      this.o.onState('connected');
      if (rest.length) { t.write(rest); this.sent += rest.length; }
      t.on('data', (d: Buffer) => { this.received += d.length; if (!ws.closed) ws.send(new Uint8Array(d.buffer, d.byteOffset, d.length)); });
      t.on('close', () => { if (!ws.closed) ws.close('closed'); });
      t.on('error', () => undefined);
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { library?: string };
      fail(err.library === 'SSL routines' || /TLS|SSL|secure/i.test(err.message) ? RDCP_TLS_FAILED : RDCP_GENERAL_ERROR, `${this.o.name}: ${err.message}`);
      sock.destroy();
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.dropPeer();
    this.srv?.close();
    this.srv = null;
  }
}

export { destinationOf };
