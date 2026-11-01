// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Finding a way through: the path state machine for one peer.
//
// Each device has one UDP "mesh socket". Both peers learn each other's
// candidates (local addresses, and the public address STUN reported) over the
// Link channel, then both send small authenticated probes to every candidate
// at the same time ("simultaneous open"): each side's outgoing probe opens its
// own NAT for the other side's probe, which is how hole punching works. The
// best answer wins: the local network before the internet, then the fastest.
// If nothing answers within a few seconds, packets go through the Keeper
// Relay instead, and direct paths are tried again every minute.
//
// Roaming: an authenticated probe or pong from a new address (a laptop that
// moved to another network) moves the path there at once.
//
// Probe:  "KMP1" | type u8 | from (16) | to (16) | nonce (8) | sent ms (8) | HMAC-SHA-256 (first 16 bytes)
// Only the two devices know the HMAC key (pathKey in keys.ts), so nobody else
// can move a path or fake a latency.

import crypto from 'node:crypto';
import { familyOf, scopeOf } from '../net/addr';
import type { Candidate, MeshPath } from './types';

const TAG = Buffer.from('KMP1');
export const PING = 1;
export const PONG = 2;
const LEN = 4 + 1 + 16 + 16 + 8 + 8 + 16;

export const isProbe = (b: Uint8Array) => b.length === LEN && b[0] === 0x4b && b[1] === 0x4d && b[2] === 0x50 && b[3] === 0x31;

/** WireGuard's own messages: types 1–4 and three zero bytes. */
export const isWireGuard = (b: Uint8Array) => b.length >= 32 && b[0] >= 1 && b[0] <= 4 && b[1] === 0 && b[2] === 0 && b[3] === 0;

export function probe(key: Buffer, type: number, from: string, to: string, nonce: Buffer, sent: number): Buffer {
  const b = Buffer.alloc(LEN);
  TAG.copy(b, 0);
  b[4] = type;
  b.write(from.padEnd(16).slice(0, 16), 5, 'latin1');
  b.write(to.padEnd(16).slice(0, 16), 21, 'latin1');
  nonce.copy(b, 37, 0, 8);
  b.writeBigUInt64BE(BigInt(Math.max(0, Math.floor(sent))), 45);
  crypto.createHmac('sha256', key).update(b.subarray(0, 53)).digest().copy(b, 53, 0, 16);
  return b;
}

export interface Probe {
  type: number;
  from: string;
  to: string;
  nonce: string;
  sent: number;
}

/** Reads a probe's header without checking it (to find whose key to check it with). */
export function probeHeader(b: Buffer): { type: number; from: string; to: string } | null {
  if (!isProbe(b)) return null;
  return { type: b[4], from: b.toString('latin1', 5, 21).trim(), to: b.toString('latin1', 21, 37).trim() };
}

export function openProbe(key: Buffer, b: Buffer): Probe | null {
  if (!isProbe(b)) return null;
  const mac = crypto.createHmac('sha256', key).update(b.subarray(0, 53)).digest().subarray(0, 16);
  if (!crypto.timingSafeEqual(mac, b.subarray(53, 69))) return null;
  return { type: b[4], from: b.toString('latin1', 5, 21).trim(), to: b.toString('latin1', 21, 37).trim(), nonce: b.subarray(37, 45).toString('hex'), sent: Number(b.readBigUInt64BE(45)) };
}

/** "1.2.3.4:5", "[fd00::1]:5" → host and port. */
export function splitAddr(a: string): { host: string; port: number } | null {
  const m = a.match(/^\[([^\]]+)\]:(\d+)$/) ?? a.match(/^([^:]+):(\d+)$/);
  if (!m) return null;
  const port = Number(m[2]);
  return familyOf(m[1]) && port > 0 && port < 65536 ? { host: m[1], port } : null;
}

export const joinAddr = (host: string, port: number) => (familyOf(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`);

/** Direct paths: the local network (private addresses) or the internet. */
export function kindOf(host: string): 'lan' | 'internet' {
  const s = scopeOf(host);
  return s === 'lan' || s === 'link' || s === 'loopback' ? 'lan' : 'internet';
}

/** The order candidates are tried in, best first: local network, then public, never relay addresses. */
export function rankCandidates(c: Candidate[]): { host: string; port: number; kind: 'lan' | 'internet' }[] {
  const out: { host: string; port: number; kind: 'lan' | 'internet' }[] = [];
  const seen = new Set<string>();
  for (const x of c) {
    if (x.kind === 'relay') continue;
    const a = splitAddr(x.addr);
    if (!a || seen.has(x.addr)) continue;
    seen.add(x.addr);
    out.push({ ...a, kind: kindOf(a.host) });
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'lan' ? -1 : 1));
}

export interface PathSocket {
  send(b: Buffer, port: number, host: string): void;
}

export interface PathTimings {
  /** between probe rounds while punching */
  probeEveryMs: number;
  /** how long to punch before falling back to the relay */
  punchForMs: number;
  /** a keepalive probe on a direct path, only while the peer is active */
  keepaliveMs: number;
  /** no answer for this long on a direct path: punch again */
  deadAfterMs: number;
  /** while relayed: try direct again this often */
  retryDirectMs: number;
}

export const TIMINGS: PathTimings = { probeEveryMs: 200, punchForMs: 5000, keepaliveMs: 25_000, deadAfterMs: 80_000, retryDirectMs: 60_000 };

export type PathState = 'idle' | 'punching' | 'direct' | 'relay' | 'failed';

export interface PathEvents {
  /** the path changed (for the UI and the WireGuard endpoint) */
  change?(p: PeerPath): void;
  /** the relay is usable right now */
  relay?(): boolean;
}

/** The path to one peer. Driven by tick(now) and by probes arriving; no timers of its own. */
export class PeerPath {
  state: PathState = 'idle';
  best?: { host: string; port: number; kind: 'lan' | 'internet'; rtt: number; at: number };
  /** the last pong on the current direct path */
  lastPong = 0;
  /** traffic or a request in the last keepalive period: keepalives only while active */
  activeUntil = 0;
  private cands: { host: string; port: number; kind: 'lan' | 'internet' }[] = [];
  private punchUntil = 0;
  private nextProbe = 0;
  private nextKeepalive = 0;
  private retryAt = 0;
  private outstanding = new Map<string, number>();
  rounds = 0;

  constructor(
    readonly me: string,
    readonly peer: string,
    private key: Buffer,
    private sock: PathSocket,
    private t: PathTimings = TIMINGS,
    private ev: PathEvents = {},
  ) {}

  get path(): MeshPath {
    if (this.state === 'direct' && this.best) return this.best.kind;
    // while trying direct paths again, packets still go through the relay
    if (this.state === 'relay' || (this.state === 'punching' && this.ev.relay?.())) return 'relay';
    return 'none';
  }

  setCandidates(c: Candidate[]) {
    this.cands = rankCandidates(c);
  }

  setKey(k: Buffer) {
    this.key = k;
  }

  /** Begin punching now (both sides do this when the Link message "punch" arrives). */
  punch(now: number) {
    if (this.state !== 'direct') this.set('punching');
    this.punchUntil = now + this.t.punchForMs;
    this.nextProbe = now;
    this.tick(now);
  }

  touch(now: number) {
    this.activeUntil = now + this.t.keepaliveMs * 2;
  }

  tick(now: number) {
    if (this.state === 'punching') {
      if (now >= this.nextProbe) {
        this.rounds++;
        for (const c of this.cands) this.ping(c.host, c.port, now);
        this.nextProbe = now + this.t.probeEveryMs;
      }
      if (now >= this.punchUntil) {
        this.retryAt = now + this.t.retryDirectMs;
        if (this.best) this.set('direct');
        else this.set(this.ev.relay?.() ? 'relay' : 'failed');
      }
      return;
    }
    if (this.state === 'direct' && this.best) {
      if (now - this.lastPong > this.t.deadAfterMs) {
        // The direct path went quiet (the network changed): punch again, relay meanwhile.
        this.best = undefined;
        this.punch(now);
        return;
      }
      if (now < this.activeUntil && now >= this.nextKeepalive) {
        this.ping(this.best.host, this.best.port, now);
        this.nextKeepalive = now + this.t.keepaliveMs;
      }
      return;
    }
    if ((this.state === 'relay' || this.state === 'failed') && this.retryAt && now >= this.retryAt) {
      this.retryAt = now + this.t.retryDirectMs;
      this.punchUntil = now + this.t.punchForMs;
      this.nextProbe = now;
      // Packets keep going through the relay while it tries (see route()).
      this.state = 'punching';
      this.tick(now);
    }
  }

  /** A probe for this peer arrived on the mesh socket from host:port. Returns false if it did not check out. */
  receive(b: Buffer, host: string, port: number, now: number): boolean {
    const p = openProbe(this.key, b);
    if (!p || p.from !== this.peer || p.to !== this.me) return false;
    if (p.type === PING) {
      this.sock.send(probe(this.key, PONG, this.me, this.peer, Buffer.from(p.nonce, 'hex'), p.sent), port, host);
      // Peer-reflexive: the address it really comes from (after its NAT). Answer it, and try it ourselves.
      if (!this.cands.some((c) => c.host === host && c.port === port)) {
        this.cands.push({ host, port, kind: kindOf(host) });
        if (this.state !== 'direct') this.ping(host, port, now);
      }
      // Roaming: the peer moved; follow it straight away.
      if (this.state === 'direct' && this.best && (this.best.host !== host || this.best.port !== port)) this.ping(host, port, now);
      return true;
    }
    if (p.type === PONG) {
      const sentAt = this.outstanding.get(p.nonce);
      if (sentAt === undefined) return true;
      this.outstanding.delete(p.nonce);
      const rtt = Math.max(0, now - sentAt);
      const kind = kindOf(host);
      const better = !this.best || (kind === 'lan' && this.best.kind !== 'lan') || (kind === this.best.kind && rtt + 2 < this.best.rtt) || (this.best.host === host && this.best.port === port);
      const moved = this.state === 'direct' && this.best && (this.best.host !== host || this.best.port !== port) && now - this.lastPong > this.t.keepaliveMs / 5;
      if (better || moved) this.best = { host, port, kind, rtt, at: now };
      if (this.best && this.best.host === host && this.best.port === port) {
        this.best.rtt = rtt;
        this.lastPong = now;
      }
      // The first answer is enough to send data; better ones may still come during the punch window.
      if (this.state !== 'direct') {
        this.nextKeepalive = now + this.t.keepaliveMs;
        this.set('direct');
      } else this.ev.change?.(this);
      return true;
    }
    return false;
  }

  /** Where WireGuard's packets for this peer go now. */
  route(): { via: 'direct'; host: string; port: number } | { via: 'relay' } | null {
    if (this.state === 'direct' && this.best) return { via: 'direct', host: this.best.host, port: this.best.port };
    if ((this.state === 'relay' || this.state === 'punching') && this.ev.relay?.()) return { via: 'relay' };
    return null;
  }

  private ping(host: string, port: number, now: number) {
    const nonce = crypto.randomBytes(8);
    this.outstanding.set(nonce.toString('hex'), now);
    if (this.outstanding.size > 256) this.outstanding.delete(this.outstanding.keys().next().value!);
    try {
      this.sock.send(probe(this.key, PING, this.me, this.peer, nonce, now), port, host);
    } catch {
      /* an address family this computer cannot reach */
    }
  }

  private set(s: PathState) {
    if (this.state === s) return;
    this.state = s;
    this.ev.change?.(this);
  }
}
