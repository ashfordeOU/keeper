// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper Relay: a tiny server anyone can run (or deploy as a Cloudflare
// Worker, see relay/) that joins two devices when neither can reach the other
// directly. It is blind: everything it passes along is already end-to-end
// encrypted between the two devices, so it learns only that two device ids
// talked, when, and how much.
//
//   GET /v1/listen?id=<device id>   a device waits for calls (proves its id with a signed challenge)
//   GET /v1/dial?to=<device id>     another device calls it
//   GET /v1/accept?tag=<tag>        the called device picks the call up; from here bytes are piped
//   GET /v1/online?ids=a,b          which of these devices are listening (JSON)
//   GET /                           a short text page

import crypto from 'node:crypto';
import http from 'node:http';
import { deviceId, sign, verify, type Identity } from './identity';
import { acceptWebSocket, connectWs, type WsClientWire, type WsServerConn } from './ws';
import type { Wire } from './channel';

const ID_RE = /^[a-z2-9]{16}$/;

interface Pending {
  dialer: WsServerConn;
  timer: NodeJS.Timeout;
  early: Uint8Array[];
}

export interface RelayLimits {
  /** bytes a single call may relay per second (0 = no limit) */
  bytesPerSecond?: number;
  maxListeners?: number;
}

/** The relay's state, attachable to any http.Server (or used by relay/server.ts). */
export class RelayServer {
  readonly listeners = new Map<string, WsServerConn>();
  private pending = new Map<string, Pending>();
  stats = { calls: 0, bytes: 0 };

  constructor(private limits: RelayLimits = {}) {}

  attach(server: http.Server, prefix = '') {
    server.on('upgrade', (req, socket, head) => {
      const u = new URL(req.url ?? '/', 'http://x');
      if (!u.pathname.startsWith(prefix + '/v1/')) return;
      this.upgrade(u.pathname.slice(prefix.length), u.searchParams, req, socket, head);
    });
  }

  /** Answers plain HTTP requests (online check, home page). Returns false if not ours. */
  handleHttp(req: http.IncomingMessage, res: http.ServerResponse, prefix = ''): boolean {
    const u = new URL(req.url ?? '/', 'http://x');
    const p = u.pathname.slice(prefix.length);
    if (p === '/v1/online') {
      const ids = (u.searchParams.get('ids') ?? '').split(',').filter((x) => ID_RE.test(x)).slice(0, 64);
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(Object.fromEntries(ids.map((id) => [id, this.listeners.has(id)]))));
      return true;
    }
    if (p === '/' || p === '') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Keeper Relay\n${this.listeners.size} device(s) listening. It only passes along end-to-end encrypted traffic between paired Keeper devices.\n`);
      return true;
    }
    return false;
  }

  private upgrade(path: string, q: URLSearchParams, req: http.IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) {
    if (path === '/v1/listen') {
      const id = q.get('id') ?? '';
      if (!ID_RE.test(id) || (this.limits.maxListeners && this.listeners.size >= this.limits.maxListeners)) return void socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      const ws = acceptWebSocket(req, socket, head, 'relay');
      if (!ws) return;
      const challenge = crypto.randomBytes(32).toString('base64');
      let ok = false;
      const t = setTimeout(() => !ok && ws.close('no proof'), 10_000);
      ws.ontext = (s) => {
        try {
          const m = JSON.parse(s);
          if (!ok && m.t === 'auth') {
            const pub = Buffer.from(String(m.pub), 'base64');
            if (deviceId(pub) !== id || !verify(pub, Buffer.from('keeper-relay ' + challenge), Buffer.from(String(m.sig), 'base64'))) return ws.close('bad proof');
            ok = true;
            clearTimeout(t);
            this.listeners.get(id)?.close('replaced');
            this.listeners.set(id, ws);
            ws.sendText(JSON.stringify({ t: 'ready' }));
          } else if (m.t === 'ping') ws.sendText(JSON.stringify({ t: 'pong' }));
        } catch {
          ws.close('bad message');
        }
      };
      ws.onclose = () => {
        clearTimeout(t);
        if (this.listeners.get(id) === ws) this.listeners.delete(id);
      };
      ws.sendText(JSON.stringify({ t: 'challenge', n: challenge }));
      return;
    }
    if (path === '/v1/dial') {
      const to = q.get('to') ?? '';
      const target = this.listeners.get(to);
      const ws = acceptWebSocket(req, socket, head, 'relay');
      if (!ws) return;
      if (!target) return ws.close('offline');
      const tag = crypto.randomBytes(18).toString('base64url');
      const p: Pending = { dialer: ws, early: [], timer: setTimeout(() => { this.pending.delete(tag); ws.close('no answer'); }, 15_000) };
      ws.onmessage = (d) => p.early.length < 64 && p.early.push(d);
      ws.onclose = () => { clearTimeout(p.timer); this.pending.delete(tag); };
      this.pending.set(tag, p);
      target.sendText(JSON.stringify({ t: 'incoming', tag }));
      return;
    }
    if (path === '/v1/accept') {
      const tag = q.get('tag') ?? '';
      const p = this.pending.get(tag);
      const ws = acceptWebSocket(req, socket, head, 'relay');
      if (!ws) return;
      if (!p) return ws.close('gone');
      this.pending.delete(tag);
      clearTimeout(p.timer);
      this.stats.calls++;
      this.join(p.dialer, ws, p.early);
      return;
    }
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
  }

  private join(a: WsServerConn, b: WsServerConn, early: Uint8Array[]) {
    const limit = this.limits.bytesPerSecond ?? 0;
    let window = Date.now();
    let used = 0;
    const pass = (to: WsServerConn) => (d: Uint8Array) => {
      this.stats.bytes += d.length;
      if (limit) {
        if (Date.now() - window > 1000) { window = Date.now(); used = 0; }
        used += d.length;
        if (used > limit * 2) return to.close('over the relay limit');
      }
      to.send(d);
    };
    a.onmessage = pass(b);
    b.onmessage = pass(a);
    a.onclose = (r) => b.close(r);
    b.onclose = (r) => a.close(r);
    for (const d of early) b.send(d);
  }

  close() {
    for (const l of this.listeners.values()) l.close('relay stopping');
    for (const p of this.pending.values()) p.dialer.close('relay stopping');
  }
}

// ---------------------------------------------------------------- client side

const toWs = (base: string) => base.replace(/^http/i, 'ws').replace(/\/+$/, '');

/** Calls a device through a relay. The wire carries the normal encrypted handshake. */
export async function relayDial(relayUrl: string, to: string, timeoutMs = 10_000): Promise<Wire> {
  const w = await connectWs(`${toWs(relayUrl)}/v1/dial?to=${encodeURIComponent(to)}`, 'relay', timeoutMs, new URL(relayUrl).host);
  return w;
}

/** Waits for calls through a relay; reconnects is the caller's job (onclose fires). */
export async function relayListen(relayUrl: string, me: Identity, onIncoming: (wire: WsClientWire) => void, timeoutMs = 10_000): Promise<WsClientWire> {
  const base = toWs(relayUrl);
  const ctl = await connectWs(`${base}/v1/listen?id=${deviceId(me.publicKey)}`, 'relay', timeoutMs, new URL(relayUrl).host);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('The relay did not answer')), timeoutMs);
    ctl.ontext = (s) => {
      let m: { t?: string; n?: string; tag?: string };
      try { m = JSON.parse(s); } catch { return; }
      if (m.t === 'challenge') ctl.sendText(JSON.stringify({ t: 'auth', pub: me.publicKey.toString('base64'), sig: sign(me, Buffer.from('keeper-relay ' + m.n)).toString('base64') }));
      else if (m.t === 'ready') { clearTimeout(t); resolve(); }
      else if (m.t === 'incoming' && m.tag) {
        connectWs(`${base}/v1/accept?tag=${encodeURIComponent(m.tag)}`, 'relay', timeoutMs, new URL(relayUrl).host).then(onIncoming, () => undefined);
      }
    };
    ctl.onclose = (r) => { clearTimeout(t); reject(new Error(r || 'The relay closed the connection')); };
  });
  return ctl;
}

/** Which devices are listening on a relay right now. */
export async function relayOnline(relayUrl: string, ids: string[], fetchFn: typeof fetch = fetch): Promise<Record<string, boolean>> {
  const r = await fetchFn(`${relayUrl.replace(/\/+$/, '')}/v1/online?ids=${ids.join(',')}`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`relay ${r.status}`);
  return (await r.json()) as Record<string, boolean>;
}
