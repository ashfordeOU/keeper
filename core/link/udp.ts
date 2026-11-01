// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The direct carrier: two Keeper devices talking over UDP, straight to each
// other, after punching through their routers. Pure Node (dgram), no browser.
//
// Setup happens inside an existing Link channel (local network, tunnel or
// relay), so it is already authenticated: each side sends its candidate
// addresses there, plus a fresh 32-byte path key and connection id. Every UDP
// packet then carries a 12-byte HMAC with that key, so nobody else can inject
// or even probe the path. On top of it runs the normal Link handshake with the
// pinned device keys (channel.ts) — the same binding the screen code gets from
// checking DTLS fingerprints, but here the identity keys themselves are used.
//
// Packet: ['K'][type u8][conn u32][body][hmac 12]
//
// The path is reliable and ordered (Wire's promise): fragments with sequence
// numbers, cumulative acks with a 64-packet selective-ack bitmap, retransmit on
// timeout (RFC 6298 timer) or after three later packets got through, and a
// congestion window that grows per ack and halves on loss.

import crypto from 'node:crypto';
import type { Wire } from './channel';

export const enum P {
  Probe = 1,
  ProbeAck = 2,
  Nominate = 3,
  NominateAck = 4,
  Data = 5,
  Ack = 6,
  Ping = 7,
  Pong = 8,
  Close = 9,
}

const MAGIC = 0x4b;
const TAG = 12;
const HDR = 6;
/** payload bytes per packet: fits a 1280-byte IPv6 minimum MTU with room for headers */
export const MSS = 1150;
const MAX_CWND = 2048;
const MAX_AHEAD = 8192;

export interface Endpoint {
  address: string;
  port: number;
}

/** What the path needs from a dgram socket. */
export interface DatagramSocket {
  send(buf: Uint8Array, port: number, address: string, cb?: (err?: Error | null) => void): void;
}

export function seal(key: Uint8Array, type: P, conn: number, body: Uint8Array = new Uint8Array(0)): Buffer {
  const b = Buffer.alloc(HDR + body.length + TAG);
  b[0] = MAGIC;
  b[1] = type;
  b.writeUInt32BE(conn >>> 0, 2);
  Buffer.from(body.buffer, body.byteOffset, body.length).copy(b, HDR);
  crypto.createHmac('sha256', key).update(b.subarray(0, HDR + body.length)).digest().copy(b, HDR + body.length, 0, TAG);
  return b;
}

/** The type and body of a packet for this path, or null (wrong key, wrong connection, damaged). */
export function open(key: Uint8Array, conn: number, b: Uint8Array): { type: P; body: Buffer } | null {
  if (b.length < HDR + TAG || b[0] !== MAGIC) return null;
  const buf = Buffer.from(b.buffer, b.byteOffset, b.length);
  if (buf.readUInt32BE(2) !== conn >>> 0) return null;
  const want = crypto.createHmac('sha256', key).update(buf.subarray(0, buf.length - TAG)).digest().subarray(0, TAG);
  if (!crypto.timingSafeEqual(want, buf.subarray(buf.length - TAG))) return null;
  return { type: buf[1] as P, body: Buffer.from(buf.subarray(HDR, buf.length - TAG)) };
}

const epKey = (e: Endpoint) => `${e.address}:${e.port}`;

export interface PathOptions {
  /** ms without hearing anything before the path is declared dead */
  deadAfterMs?: number;
  /** ms of silence before a keepalive goes out */
  keepaliveMs?: number;
  /** test hook: drop this fraction of outgoing data packets */
  loss?: number;
}

/**
 * One UDP path to one other device: punching, then a reliable Wire. Feed it
 * every datagram the socket receives with `handle`.
 */
export class UdpPath {
  remote: Endpoint | null = null;
  private wireObj: UdpWire | null = null;
  private probing: { nonce: Buffer; resolve: (e: Endpoint) => void } | null = null;
  private nominated: ((e: Endpoint) => void) | null = null;
  closed = false;
  /** the reliable wire on this path has closed */
  onclosed?: () => void;

  constructor(
    private sock: DatagramSocket,
    readonly key: Buffer,
    readonly conn: number,
    readonly role: 'controlling' | 'controlled',
    private opts: PathOptions = {},
  ) {}

  private send(type: P, to: Endpoint, body?: Uint8Array) {
    if (this.closed) return;
    try {
      this.sock.send(seal(this.key, type, this.conn, body), to.port, to.address, () => undefined);
    } catch {
      /* the socket is closing */
    }
  }

  /**
   * Both sides send probes to all of the other's candidates at once; that
   * opens each router's mapping. The controlling side takes the first address
   * that answers and nominates it; the controlled side waits for that.
   */
  punch(candidates: Endpoint[], timeoutMs = 6000): Promise<Endpoint> {
    const nonce = crypto.randomBytes(8);
    const cands = dedupe(candidates).slice(0, 16);
    return new Promise<Endpoint>((resolve, reject) => {
      let done = false;
      let tick: NodeJS.Timeout | undefined;
      let n = 0;
      const finish = (e: Endpoint | null, err?: string) => {
        if (done) return;
        done = true;
        clearInterval(tick);
        clearTimeout(limit);
        this.probing = null;
        this.nominated = null;
        if (e) resolve(e);
        else reject(new Error(err ?? 'No direct path'));
      };
      const limit = setTimeout(() => finish(null, 'No direct path was found (the routers in between did not let it through)'), timeoutMs);
      let chosen: Endpoint | null = null;
      const round = () => {
        n++;
        if (chosen) {
          // Keep nominating until the other side confirms.
          this.send(P.Nominate, chosen, nonce);
          return;
        }
        for (const c of cands) this.send(P.Probe, c, Buffer.concat([nonce, Buffer.from([this.role === 'controlling' ? 1 : 2])]));
      };
      if (this.role === 'controlling') {
        this.probing = {
          nonce,
          resolve: (e) => {
            if (chosen) return;
            chosen = e;
            this.send(P.Nominate, e, nonce);
          },
        };
        this.nominated = (e) => finish(e);
      } else {
        this.nominated = (e) => finish(e);
      }
      round();
      // Fast at first, then every 200 ms.
      tick = setInterval(() => round(), n < 10 ? 50 : 200);
      tick.unref?.();
      limit.unref?.();
    }).then((e) => {
      this.remote = e;
      return e;
    });
  }

  /** Every datagram from the socket. Returns false when it was not for this path. */
  handle(msg: Uint8Array, from: Endpoint): boolean {
    const p = open(this.key, this.conn, msg);
    if (!p) return false;
    switch (p.type) {
      case P.Probe:
        this.send(P.ProbeAck, from, p.body.subarray(0, 8));
        return true;
      case P.ProbeAck:
        if (this.probing && p.body.subarray(0, 8).equals(this.probing.nonce)) this.probing.resolve(from);
        return true;
      case P.Nominate:
        if (this.role === 'controlled') {
          this.send(P.NominateAck, from, p.body.subarray(0, 8));
          if (!this.remote) this.remote = from;
          this.nominated?.(from);
        }
        return true;
      case P.NominateAck:
        if (this.role === 'controlling' && this.probing && p.body.subarray(0, 8).equals(this.probing.nonce)) this.nominated?.(from);
        return true;
      default:
        // Data and the rest belong to the wire, from the nominated address only
        // (an address change mid-session would need a new nomination).
        if (this.wireObj && this.remote && epKey(from) === epKey(this.remote)) this.wireObj.packet(p.type, p.body);
        return true;
    }
  }

  /** The reliable, ordered message carrier over the nominated address. */
  wire(): UdpWire {
    if (!this.remote) throw new Error('Not connected');
    if (!this.wireObj) this.wireObj = new UdpWire((type, body) => this.send(type, this.remote!, body), `${this.remote.address}:${this.remote.port}`, this.opts, () => {
      this.closed = true;
      this.onclosed?.();
    });
    return this.wireObj;
  }

  close(reason?: string) {
    this.wireObj?.close(reason);
    this.closed = true;
  }
}

function dedupe(c: Endpoint[]): Endpoint[] {
  const seen = new Set<string>();
  return c.filter((e) => {
    const k = epKey(e);
    if (seen.has(k) || !e.port || !e.address) return false;
    seen.add(k);
    return true;
  });
}

interface Inflight {
  seq: number;
  body: Buffer;
  sentAt: number;
  retx: number;
  sacked?: boolean;
}

/** Statistics shown on the device page and used by the tests. */
export interface PathStats {
  bytesOut: number;
  bytesIn: number;
  packetsOut: number;
  retransmits: number;
  rtt?: number;
  cwnd: number;
}

export class UdpWire implements Wire {
  readonly kind = 'direct' as const;
  onmessage?: (data: Uint8Array) => void;
  onclose?: (reason?: string) => void;
  stats: PathStats = { bytesOut: 0, bytesIn: 0, packetsOut: 0, retransmits: 0, cwnd: 32 };
  // sender
  private nextSeq = 0;
  private queue: { seq: number; body: Buffer }[] = [];
  private inflight = new Map<number, Inflight>();
  private sndUna = 0;
  private cwnd = 32;
  private ssthresh = Infinity;
  private srtt = 0;
  private rttvar = 0;
  private rto = 400;
  private recoverUntil = -1;
  private rtoTimer?: NodeJS.Timeout;
  // receiver
  private rcvNxt = 0;
  private ooo = new Map<number, Buffer>();
  private parts: Buffer[] = [];
  private unacked = 0;
  private ackTimer?: NodeJS.Timeout;
  // liveness
  private lastRecv = Date.now();
  private lastSend = Date.now();
  private alive?: NodeJS.Timeout;
  private closedFlag = false;

  constructor(
    private out: (type: P, body?: Uint8Array) => void,
    readonly where: string,
    private opts: PathOptions = {},
    private onShut: () => void = () => undefined,
  ) {
    const keep = opts.keepaliveMs ?? 10_000;
    this.alive = setInterval(() => {
      const now = Date.now();
      if (now - this.lastRecv > (this.opts.deadAfterMs ?? 30_000)) return this.shut('The direct connection stopped answering');
      if (now - this.lastSend > keep) this.raw(P.Ping);
    }, Math.min(keep, 5000));
    this.alive.unref?.();
  }

  get closed() {
    return this.closedFlag;
  }

  private raw(type: P, body?: Uint8Array) {
    this.lastSend = Date.now();
    this.out(type, body);
  }

  send(data: Uint8Array) {
    if (this.closedFlag) throw new Error('Connection closed');
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    for (let off = 0; off < buf.length || off === 0; off += MSS) {
      const chunk = buf.subarray(off, Math.min(buf.length, off + MSS));
      const last = off + MSS >= buf.length;
      const body = Buffer.alloc(5 + chunk.length);
      const seq = this.nextSeq++;
      body.writeUInt32BE(seq, 0);
      body[4] = last ? 1 : 0;
      chunk.copy(body, 5);
      this.queue.push({ seq, body });
      if (last) break;
    }
    this.pump();
  }

  private pump() {
    while (this.queue.length && this.inflight.size < Math.floor(this.cwnd) && this.queue[0].seq - this.sndUna < MAX_AHEAD) {
      const q = this.queue.shift()!;
      const f: Inflight = { seq: q.seq, body: q.body, sentAt: Date.now(), retx: 0 };
      this.inflight.set(q.seq, f);
      this.transmit(f);
    }
    this.armRto();
  }

  private transmit(f: Inflight) {
    f.sentAt = Date.now();
    this.stats.packetsOut++;
    this.stats.bytesOut += f.body.length - 5;
    if (this.opts.loss && Math.random() < this.opts.loss) return;
    this.raw(P.Data, f.body);
  }

  private armRto() {
    if (this.rtoTimer || !this.inflight.size || this.closedFlag) return;
    this.rtoTimer = setTimeout(() => {
      this.rtoTimer = undefined;
      this.onRto();
    }, this.rto);
    this.rtoTimer.unref?.();
  }

  private onRto() {
    if (this.closedFlag || !this.inflight.size) return;
    const now = Date.now();
    let oldest: Inflight | undefined;
    for (const f of this.inflight.values()) if (!f.sacked && (!oldest || f.seq < oldest.seq)) oldest = f;
    if (oldest && now - oldest.sentAt >= this.rto - 5) {
      if (oldest.retx > 14) return this.shut('The direct connection stopped answering');
      // Loss: back off.
      this.ssthresh = Math.max(4, this.cwnd / 2);
      this.cwnd = Math.max(4, this.cwnd / 2);
      this.rto = Math.min(8000, this.rto * 2);
      // Resend everything still out that is older than one timeout.
      for (const f of this.inflight.values()) {
        if (f.sacked || now - f.sentAt < this.rto / 2) continue;
        f.retx++;
        this.stats.retransmits++;
        this.transmit(f);
      }
    }
    this.armRto();
  }

  private onAck(body: Buffer) {
    if (body.length < 12) return;
    const cum = body.readUInt32BE(0);
    const bits = body.readBigUInt64BE(4);
    const now = Date.now();
    let progressed = false;
    let sample: number | undefined;
    for (const [seq, f] of this.inflight) {
      if (seq < cum) {
        if (f.retx === 0) sample = now - f.sentAt;
        this.inflight.delete(seq);
        progressed = true;
        this.grow();
      }
    }
    let highestSacked = -1;
    for (let i = 0; i < 64; i++) {
      if (!((bits >> BigInt(i)) & 1n)) continue;
      const seq = cum + 1 + i;
      const f = this.inflight.get(seq);
      if (f) {
        if (f.retx === 0) sample = now - f.sentAt;
        this.inflight.delete(seq);
        progressed = true;
        this.grow();
      }
      highestSacked = seq;
    }
    if (cum > this.sndUna) this.sndUna = cum;
    if (sample !== undefined) this.rttSample(sample);
    // Three or more later packets arrived: the gap was lost, resend it now.
    if (highestSacked >= 0) {
      for (const f of this.inflight.values()) {
        if (f.seq < highestSacked - 2 && f.retx === 0 && now - f.sentAt > Math.max(10, this.srtt)) {
          f.retx++;
          this.stats.retransmits++;
          this.transmit(f);
          if (f.seq > this.recoverUntil) {
            this.ssthresh = Math.max(4, this.cwnd / 2);
            this.cwnd = this.ssthresh;
            this.recoverUntil = this.nextSeq;
          }
        }
      }
    }
    if (progressed) {
      clearTimeout(this.rtoTimer);
      this.rtoTimer = undefined;
    }
    this.pump();
  }

  private grow() {
    if (this.cwnd < this.ssthresh) this.cwnd = Math.min(MAX_CWND, this.cwnd + 1);
    else this.cwnd = Math.min(MAX_CWND, this.cwnd + 1 / this.cwnd);
    this.stats.cwnd = Math.round(this.cwnd);
  }

  private rttSample(r: number) {
    if (!this.srtt) {
      this.srtt = r;
      this.rttvar = r / 2;
    } else {
      this.rttvar = 0.75 * this.rttvar + 0.25 * Math.abs(this.srtt - r);
      this.srtt = 0.875 * this.srtt + 0.125 * r;
    }
    this.rto = Math.min(8000, Math.max(150, this.srtt + 4 * this.rttvar));
    this.stats.rtt = Math.round(this.srtt);
  }

  /** @internal a packet from the path */
  packet(type: P, body: Buffer) {
    if (this.closedFlag) return;
    this.lastRecv = Date.now();
    switch (type) {
      case P.Data:
        return this.onData(body);
      case P.Ack:
        return this.onAck(body);
      case P.Ping:
        return this.raw(P.Pong);
      case P.Pong:
        return;
      case P.Close:
        return this.shut(body.toString('utf8') || 'The other device closed the direct connection');
    }
  }

  private onData(body: Buffer) {
    if (body.length < 5) return;
    const seq = body.readUInt32BE(0);
    if (seq < this.rcvNxt) return this.sendAck(); // a repeat: our ack was lost
    if (seq - this.rcvNxt > MAX_AHEAD) return;
    if (seq !== this.rcvNxt) {
      this.ooo.set(seq, body);
      return this.sendAck();
    }
    this.accept(body);
    for (let b = this.ooo.get(this.rcvNxt); b; b = this.ooo.get(this.rcvNxt)) {
      this.ooo.delete(this.rcvNxt);
      this.accept(b);
    }
    if (++this.unacked >= 2 || this.ooo.size) this.sendAck();
    else if (!this.ackTimer) {
      this.ackTimer = setTimeout(() => this.sendAck(), 10);
      this.ackTimer.unref?.();
    }
  }

  private accept(body: Buffer) {
    this.rcvNxt++;
    const chunk = body.subarray(5);
    this.stats.bytesIn += chunk.length;
    this.parts.push(chunk);
    if (body[4] === 1) {
      const msg = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts);
      this.parts = [];
      try {
        this.onmessage?.(new Uint8Array(msg));
      } catch {
        /* the listener's problem */
      }
    }
  }

  private sendAck() {
    clearTimeout(this.ackTimer);
    this.ackTimer = undefined;
    this.unacked = 0;
    let bits = 0n;
    for (let i = 0; i < 64; i++) if (this.ooo.has(this.rcvNxt + 1 + i)) bits |= 1n << BigInt(i);
    const b = Buffer.alloc(12);
    b.writeUInt32BE(this.rcvNxt >>> 0, 0);
    b.writeBigUInt64BE(bits, 4);
    this.raw(P.Ack, b);
  }

  close(reason?: string) {
    if (this.closedFlag) return;
    const r = Buffer.from(String(reason ?? '').slice(0, 100));
    for (let i = 0; i < 3; i++) this.raw(P.Close, r);
    this.shut(reason);
  }

  private shut(reason?: string) {
    if (this.closedFlag) return;
    this.closedFlag = true;
    clearInterval(this.alive);
    clearTimeout(this.rtoTimer);
    clearTimeout(this.ackTimer);
    this.inflight.clear();
    this.queue = [];
    this.onShut();
    this.onclose?.(reason);
  }
}
