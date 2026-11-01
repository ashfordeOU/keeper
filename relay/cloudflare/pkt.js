// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The mesh packet path of Keeper Relay, for the Cloudflare Worker: the same
// protocol and rules as core/mesh/packet-relay.ts (the Node relay's
// PacketRelayServer), written against the Workers WebSocket API so it runs
// inside one Durable Object. Plain JavaScript with no Worker-only globals in
// the logic, so it is unit-tested in Node with stand-in sockets.
//
//   GET /v1/pkt?id=<device id>   (WebSocket) prove the id by signing a challenge, then:
//     text   {"t":"allow","ids":[…]}        who may send to me (both sides must allow)
//     binary [16-byte device id][packet]    to that device / from that device
//
// It stays blind: packets are WireGuard ciphertext; it learns which two ids
// exchange packets, when, and how many bytes. A packet is passed on only if
// both devices listed each other.

export const ID_RE = /^[a-z2-9]{16}$/;
export const MAX_PACKET = 2048;
export const CONTEXT = 'keeper-relay-pkt ';
const B32 = 'abcdefghijkmnpqrstuvwxyz23456789';

const enc = new TextEncoder();
const latin1 = (b) => String.fromCharCode(...b);

/** The Link device id of a public key: base32 of SHA-256, 16 characters (as core/link/identity.ts). */
export async function deviceIdOf(pub) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', pub));
  let bits = 0, acc = 0, out = '';
  for (const b of h) {
    acc = ((acc << 8) | b) >>> 0;
    bits += 8;
    while (bits >= 5 && out.length < 16) { out += B32[(acc >>> (bits - 5)) & 31]; bits -= 5; }
    if (out.length >= 16) break;
  }
  return out;
}

export async function verifyEd25519(pub, msg, sig) {
  const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'Ed25519' }, key, sig, msg);
}

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** [16-byte id][packet] */
export function wrap(id, packet) {
  const out = new Uint8Array(16 + packet.length);
  for (let i = 0; i < 16; i++) out[i] = id.charCodeAt(i);
  out.set(packet, 16);
  return out;
}

export function unwrap(m) {
  if (m.length <= 16 || m.length > 16 + MAX_PACKET) return null;
  const id = latin1(m.subarray(0, 16));
  return ID_RE.test(id) ? { id, packet: m.subarray(16) } : null;
}

/**
 * All devices on the packet path. `ws` is a server-side WebSocket that was
 * accepted: send(string | Uint8Array), close(code, reason) and
 * addEventListener('message' | 'close').
 */
export class PacketHub {
  constructor(opts = {}) {
    this.members = new Map();
    this.stats = { packets: 0, bytes: 0, dropped: 0 };
    this.limits = { bytesPerSecond: opts.bytesPerSecond || 0, maxDevices: opts.maxDevices || 10_000 };
    this.now = opts.now || (() => Date.now());
    this.verify = opts.verify || verifyEd25519;
    this.idOf = opts.deviceId || deviceIdOf;
    this.authMs = opts.authMs ?? 10_000;
  }

  /** Whether this id may join now (checked before the WebSocket is accepted). */
  admits(id) {
    return ID_RE.test(id || '') && (this.members.has(id) || this.members.size < this.limits.maxDevices);
  }

  join(ws, id) {
    if (!this.admits(id)) { try { ws.close(1008, 'bad request'); } catch { /* gone */ } return; }
    const challenge = btoa(latin1(crypto.getRandomValues(new Uint8Array(32))));
    let me = null;
    let proving = false;
    const timer = setTimeout(() => { if (!me) try { ws.close(1008, 'no proof'); } catch { /* gone */ } }, this.authMs);
    ws.addEventListener('message', async (e) => {
      if (typeof e.data === 'string') {
        let m;
        try { m = JSON.parse(e.data); } catch { return ws.close(1008, 'bad message'); }
        if (!me && !proving && m.t === 'auth') {
          proving = true;
          let good = false;
          try {
            const pub = b64(String(m.pub ?? ''));
            good = (await this.idOf(pub)) === id && (await this.verify(pub, enc.encode(CONTEXT + challenge), b64(String(m.sig ?? ''))));
          } catch { good = false; }
          if (!good) return ws.close(1008, 'bad proof');
          clearTimeout(timer);
          const old = this.members.get(id);
          if (old) try { old.ws.close(1000, 'replaced'); } catch { /* gone */ }
          me = { ws, allow: new Set(), window: this.now(), used: 0 };
          this.members.set(id, me);
          ws.send(JSON.stringify({ t: 'ready' }));
        } else if (me && m.t === 'allow' && Array.isArray(m.ids)) {
          me.allow = new Set(m.ids.map(String).filter((x) => ID_RE.test(x)).slice(0, 256));
        } else if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong' }));
        return;
      }
      if (!me) return;
      const p = unwrap(e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data));
      if (p) this.pass(id, me, p);
    });
    ws.addEventListener('close', () => {
      clearTimeout(timer);
      if (me && this.members.get(id) === me) this.members.delete(id);
    });
    ws.send(JSON.stringify({ t: 'challenge', n: challenge }));
  }

  pass(from, me, p) {
    const to = this.members.get(p.id);
    // both devices must have listed each other
    if (!to || !to.allow.has(from) || !me.allow.has(p.id)) { this.stats.dropped++; return; }
    const limit = this.limits.bytesPerSecond;
    if (limit) {
      const now = this.now();
      if (now - me.window > 1000) { me.window = now; me.used = 0; }
      me.used += p.packet.length;
      if (me.used > limit) { this.stats.dropped++; return; }
    }
    this.stats.packets++;
    this.stats.bytes += p.packet.length;
    try { to.ws.send(wrap(from, p.packet)); } catch { this.stats.dropped++; }
  }

  close() {
    for (const m of this.members.values()) try { m.ws.close(1001, 'relay stopping'); } catch { /* gone */ }
  }
}
