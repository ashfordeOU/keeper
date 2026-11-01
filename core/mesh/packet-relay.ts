// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The packet path of Keeper Relay, for mesh peers that cannot reach each
// other directly. Each device keeps one WebSocket to the relay and sends
// WireGuard packets addressed by device id; the relay passes them to the
// other device's WebSocket. It stays blind: the packets are WireGuard
// ciphertext, so it learns which two device ids exchange packets, when, and
// how many bytes, and nothing else.
//
//   GET /v1/pkt?id=<device id>   (WebSocket) prove the id by signing a challenge, then:
//     text   {"t":"allow","ids":[…]}            who may send to me (both sides must allow)
//     binary [16-byte device id][packet]        to that device / from that device
//
// A packet is passed on only if both devices listed each other, so a relay
// cannot be used to throw packets at a device that did not ask for them.

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { deviceId, sign, verify, type Identity } from '../link/identity';
import { acceptWebSocket, connectWs, type WsClientWire, type WsServerConn } from '../link/ws';

const ID_RE = /^[a-z2-9]{16}$/;
export const MAX_PACKET = 2048;
const CONTEXT = 'keeper-relay-pkt ';

/** [16-byte id][packet] */
export function wrap(id: string, packet: Uint8Array): Uint8Array {
  if (!ID_RE.test(id)) throw new Error('bad device id');
  if (packet.length > MAX_PACKET) throw new Error('packet too large');
  const out = new Uint8Array(16 + packet.length);
  out.set(Buffer.from(id, 'latin1'), 0);
  out.set(packet, 16);
  return out;
}

export function unwrap(m: Uint8Array): { id: string; packet: Uint8Array } | null {
  if (m.length <= 16 || m.length > 16 + MAX_PACKET) return null;
  const id = Buffer.from(m.subarray(0, 16)).toString('latin1');
  return ID_RE.test(id) ? { id, packet: m.subarray(16) } : null;
}

interface Member {
  ws: WsServerConn;
  allow: Set<string>;
  window: number;
  used: number;
}

export class PacketRelayServer {
  readonly members = new Map<string, Member>();
  stats = { packets: 0, bytes: 0, dropped: 0 };

  constructor(private limits: { bytesPerSecond?: number; maxDevices?: number } = {}) {}

  attach(server: http.Server, prefix = '') {
    server.on('upgrade', (req, socket, head) => void this.handleUpgrade(req, socket, head, prefix));
  }

  /** Takes the upgrade if it is for the packet path; returns false otherwise. */
  handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, prefix = ''): boolean {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname !== prefix + '/v1/pkt') return false;
    this.upgrade(u.searchParams, req, socket, head);
    return true;
  }

  private upgrade(q: URLSearchParams, req: http.IncomingMessage, socket: Duplex, head: Buffer) {
    const id = q.get('id') ?? '';
    if (!ID_RE.test(id) || (this.limits.maxDevices && this.members.size >= this.limits.maxDevices)) return void socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    const ws = acceptWebSocket(req, socket, head, 'relay');
    if (!ws) return;
    const challenge = crypto.randomBytes(32).toString('base64');
    let me: Member | null = null;
    const t = setTimeout(() => !me && ws.close('no proof'), 10_000);
    ws.ontext = (s) => {
      let m: { t?: string; pub?: string; sig?: string; ids?: unknown };
      try {
        m = JSON.parse(s);
      } catch {
        return ws.close('bad message');
      }
      if (!me && m.t === 'auth') {
        const pub = Buffer.from(String(m.pub ?? ''), 'base64');
        if (deviceId(pub) !== id || !verify(pub, Buffer.from(CONTEXT + challenge), Buffer.from(String(m.sig ?? ''), 'base64'))) return ws.close('bad proof');
        clearTimeout(t);
        this.members.get(id)?.ws.close('replaced');
        me = { ws, allow: new Set(), window: Date.now(), used: 0 };
        this.members.set(id, me);
        ws.sendText(JSON.stringify({ t: 'ready' }));
      } else if (me && m.t === 'allow' && Array.isArray(m.ids)) {
        me.allow = new Set(m.ids.map(String).filter((x) => ID_RE.test(x)).slice(0, 256));
      } else if (m.t === 'ping') ws.sendText(JSON.stringify({ t: 'pong' }));
    };
    ws.onmessage = (d) => {
      if (!me) return;
      const p = unwrap(d);
      if (!p) return;
      const to = this.members.get(p.id);
      // both devices must have listed each other
      if (!to || !to.allow.has(id) || !me.allow.has(p.id)) {
        this.stats.dropped++;
        return;
      }
      const limit = this.limits.bytesPerSecond ?? 0;
      if (limit) {
        const now = Date.now();
        if (now - me.window > 1000) {
          me.window = now;
          me.used = 0;
        }
        me.used += p.packet.length;
        if (me.used > limit) {
          this.stats.dropped++;
          return;
        }
      }
      this.stats.packets++;
      this.stats.bytes += p.packet.length;
      to.ws.send(wrap(id, p.packet));
    };
    ws.onclose = () => {
      clearTimeout(t);
      if (me && this.members.get(id) === me) this.members.delete(id);
    };
    ws.sendText(JSON.stringify({ t: 'challenge', n: challenge }));
  }

  close() {
    for (const m of this.members.values()) m.ws.close('relay stopping');
  }
}

/**
 * Serves Link's relay and the packet path on one server. Link's relay answers
 * every other /v1/ upgrade itself (with 404 for paths it does not know), so the
 * packet path is taken out first and only the rest is handed to it.
 */
export function attachRelays(server: http.Server, link: { attach(s: http.Server, prefix?: string): void }, pkt: PacketRelayServer, prefix = '') {
  const forLink = new EventEmitter();
  link.attach(forLink as unknown as http.Server, prefix);
  server.on('upgrade', (req, socket, head) => {
    if (!pkt.handleUpgrade(req, socket, head, prefix)) forLink.emit('upgrade', req, socket, head);
  });
}

/** This device's connection to the relay's packet path. */
export class PacketRelayClient {
  private ws: WsClientWire | null = null;
  private allow: string[] = [];
  connected = false;
  onpacket?: (from: string, packet: Uint8Array) => void;
  onclose?: (reason?: string) => void;

  constructor(readonly url: string, private me: Identity) {}

  async connect(timeoutMs = 10_000) {
    const base = this.url.replace(/^http/i, 'ws').replace(/\/+$/, '');
    const ws = await connectWs(`${base}/v1/pkt?id=${deviceId(this.me.publicKey)}`, 'relay', timeoutMs, new URL(this.url).host);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('The relay did not answer')), timeoutMs);
      ws.ontext = (s) => {
        let m: { t?: string; n?: string };
        try {
          m = JSON.parse(s);
        } catch {
          return;
        }
        if (m.t === 'challenge') ws.sendText(JSON.stringify({ t: 'auth', pub: this.me.publicKey.toString('base64'), sig: sign(this.me, Buffer.from(CONTEXT + m.n)).toString('base64') }));
        else if (m.t === 'ready') {
          clearTimeout(t);
          resolve();
        }
      };
      ws.onclose = (r) => {
        clearTimeout(t);
        reject(new Error(r || 'The relay closed the connection'));
      };
    });
    ws.onmessage = (d) => {
      const p = unwrap(d);
      if (p) this.onpacket?.(p.id, p.packet);
    };
    ws.onclose = (r) => {
      this.connected = false;
      this.ws = null;
      this.onclose?.(r);
    };
    this.ws = ws;
    this.connected = true;
    this.setAllow(this.allow);
  }

  setAllow(ids: string[]) {
    this.allow = [...new Set(ids)];
    this.ws?.sendText(JSON.stringify({ t: 'allow', ids: this.allow }));
  }

  send(to: string, packet: Uint8Array) {
    if (this.ws && this.connected) this.ws.send(wrap(to, packet));
  }

  close() {
    this.ws?.close('bye');
    this.ws = null;
    this.connected = false;
  }
}
