// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeps one Link connection alive across carriers. The mux (and every stream
// on it: a file half sent, a forwarded port, a terminal) runs on a Resumable,
// which runs on one or more encrypted sessions ("paths"): say the relay first,
// then a direct UDP path once one is found. Moving to a better path, or back
// when it fails, loses nothing: each side numbers what it sends, keeps it
// until the other side confirms it, and after a switch sends again whatever
// the other side says it has not seen.
//
// Inside each session (already encrypted and authenticated):
//   [0xF0] hello  JSON {v, id, recv}  first message on a path, and again to make a path the active one
//   [0xF2] data   seq u32, payload    a mux frame
//   [0xF3] ack    u32                 "I have everything before this"
//
// The mux's own frame types are 1..7, so a peer without this layer is
// recognised (its first message is not a hello) and gets a plain mux.

import crypto from 'node:crypto';
import type { Carrier } from './mux';

export const HELLO = 0xf0;
export const DATA = 0xf2;
export const ACK = 0xf3;

/** A path: an encrypted session (Session from channel.ts) or anything shaped like it. */
export interface Path extends Carrier {
  readonly kind?: string;
  readonly isClosed?: boolean;
  readonly wire?: { kind: string; where?: string };
}

export interface HelloMsg {
  v: 1;
  /** the connection this path belongs to */
  id: string;
  /** messages received so far on that connection */
  recv: number;
}

export function encodeHello(h: HelloMsg): Uint8Array {
  const j = new TextEncoder().encode(JSON.stringify(h));
  const out = new Uint8Array(1 + j.length);
  out[0] = HELLO;
  out.set(j, 1);
  return out;
}

export function decodeHello(m: Uint8Array): HelloMsg | null {
  if (m[0] !== HELLO) return null;
  try {
    const h = JSON.parse(new TextDecoder().decode(m.subarray(1)));
    if (h?.v !== 1 || typeof h.id !== 'string' || !/^[\w-]{8,64}$/.test(h.id) || !Number.isInteger(h.recv) || h.recv < 0) return null;
    return h as HelloMsg;
  } catch {
    return null;
  }
}

export const newConnId = () => crypto.randomBytes(12).toString('base64url');

interface PathEntry {
  path: Path;
  kind: string;
  where?: string;
  since: number;
  bytesIn: number;
  bytesOut: number;
}

export class Resumable implements Carrier {
  onmessage?: (plain: Uint8Array) => void;
  onclose?: (reason?: string) => void;
  /** the active path changed (for the Devices page) */
  onpath?: () => void;
  /** every path is gone: the owner may dial again and adopt within `graceMs` */
  ondetached?: () => void;
  private paths: PathEntry[] = [];
  private active: PathEntry | null = null;
  private sent: Uint8Array[] = [];
  private sentBase = 0;
  private sendSeq = 0;
  private recvSeq = 0;
  private sinceAck = 0;
  private ackTimer?: NodeJS.Timeout;
  private graceTimer?: NodeJS.Timeout;
  private held: Uint8Array[] = [];
  closed = false;
  closeReason?: string;

  constructor(readonly id: string = newConnId(), private opts: { graceMs?: number; ackEvery?: number } = {}) {}

  get received() {
    return this.recvSeq;
  }

  /** what the connection runs on right now */
  get kind(): string | undefined {
    return this.active?.kind;
  }

  get where(): string | undefined {
    return this.active?.where;
  }

  get pathCount() {
    return this.paths.length;
  }

  /** messages waiting for the other side to confirm them */
  get unconfirmed() {
    return this.sent.length;
  }

  pathStats() {
    return this.paths.map((p) => ({ kind: p.kind, where: p.where, since: p.since, bytesIn: p.bytesIn, bytesOut: p.bytesOut, active: p === this.active }));
  }

  /**
   * Adds a path whose hello was already exchanged. `peerRecv` is how much the
   * other side has; `activate` moves traffic onto it now.
   */
  adopt(path: Path, peerRecv: number, activate = true) {
    if (this.closed) {
      path.close('closed');
      return;
    }
    clearTimeout(this.graceTimer);
    this.graceTimer = undefined;
    const e: PathEntry = { path, kind: path.wire?.kind ?? path.kind ?? 'lan', where: path.wire?.where, since: Date.now(), bytesIn: 0, bytesOut: 0 };
    this.paths.push(e);
    path.onmessage = (m) => this.receive(e, m);
    path.onclose = (r) => this.lost(e, r);
    if (activate || !this.active) this.switchTo(e, peerRecv, false);
  }

  /** Makes a path active and sends again what the other side has not seen. */
  private switchTo(e: PathEntry, peerRecv: number, announce: boolean) {
    this.active = e;
    if (announce) this.raw(e, encodeHello({ v: 1, id: this.id, recv: this.recvSeq }));
    this.confirm(peerRecv);
    for (let i = 0; i < this.sent.length; i++) this.raw(e, this.sent[i]);
    this.onpath?.();
  }

  private raw(e: PathEntry, m: Uint8Array) {
    try {
      e.path.send(m);
      e.bytesOut += m.length;
    } catch {
      /* the path closed under us; lost() handles it */
    }
  }

  send(plain: Uint8Array) {
    if (this.closed) throw new Error(this.closeReason ?? 'Connection closed');
    const m = new Uint8Array(5 + plain.length);
    m[0] = DATA;
    new DataView(m.buffer).setUint32(1, this.sendSeq++ >>> 0);
    m.set(plain, 5);
    this.sent.push(m);
    if (this.active) this.raw(this.active, m);
  }

  private confirm(upTo: number) {
    const drop = Math.min(this.sent.length, Math.max(0, upTo - this.sentBase));
    if (drop > 0) {
      this.sent.splice(0, drop);
      this.sentBase += drop;
    }
  }

  private receive(e: PathEntry, m: Uint8Array) {
    e.bytesIn += m.length;
    if (m[0] === DATA && m.length >= 5) {
      const seq = new DataView(m.buffer, m.byteOffset, m.length).getUint32(1);
      // Exactly the next one; repeats after a switch are dropped.
      if (seq !== (this.recvSeq >>> 0)) return;
      this.recvSeq++;
      this.deliver(m.subarray(5));
      if (++this.sinceAck >= (this.opts.ackEvery ?? 32)) this.ack();
      else if (!this.ackTimer) {
        this.ackTimer = setTimeout(() => this.ack(), 400);
        this.ackTimer.unref?.();
      }
      return;
    }
    if (m[0] === ACK && m.length >= 5) {
      this.confirm(new DataView(m.buffer, m.byteOffset, m.length).getUint32(1));
      return;
    }
    if (m[0] === HELLO) {
      // The other side moved traffic to this path (a better one, or back after a failure).
      const h = decodeHello(m);
      if (!h || h.id !== this.id) return;
      if (this.active !== e) this.switchTo(e, h.recv, true);
      else this.confirm(h.recv);
    }
  }

  private deliver(m: Uint8Array) {
    if (this.onmessage) this.onmessage(m);
    else this.held.push(m);
  }

  private ack() {
    clearTimeout(this.ackTimer);
    this.ackTimer = undefined;
    this.sinceAck = 0;
    if (!this.active) return;
    const m = new Uint8Array(5);
    m[0] = ACK;
    new DataView(m.buffer).setUint32(1, this.recvSeq >>> 0);
    this.raw(this.active, m);
  }

  /** Called by the mux's carrier contract: set late, still gets what arrived. */
  set handler(fn: ((m: Uint8Array) => void) | undefined) {
    this.onmessage = fn;
    if (fn) for (const m of this.held.splice(0)) fn(m);
  }

  private lost(e: PathEntry, reason?: string) {
    this.paths = this.paths.filter((x) => x !== e);
    if (this.closed) return;
    if (this.active === e) {
      this.active = null;
      // Fall back to the newest path that is still open, and tell the other side.
      const next = this.paths[this.paths.length - 1];
      if (next) this.switchTo(next, this.sentBase, true);
      else {
        this.ondetached?.();
        this.graceTimer = setTimeout(() => this.close(reason ?? 'Connection closed'), this.opts.graceMs ?? 20_000);
        this.graceTimer.unref?.();
      }
    }
    this.onpath?.();
  }

  /** Closes a path that is not needed any more (keeps the connection). */
  dropPath(kind: string) {
    for (const p of this.paths) if (p.kind === kind && p !== this.active) p.path.close('not needed');
  }

  close(reason?: string) {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    clearTimeout(this.ackTimer);
    clearTimeout(this.graceTimer);
    for (const p of this.paths.splice(0)) {
      p.path.onclose = undefined;
      p.path.close(reason);
    }
    this.active = null;
    this.onclose?.(reason);
  }
}

/**
 * Wraps a Mux carrier so messages that arrive before the mux listens are kept
 * (the mux sets `onmessage` a tick after it is made).
 */
export function asCarrier(r: Resumable): Carrier {
  const c: Carrier = {
    send: (m) => r.send(m),
    close: (reason) => r.close(reason),
  };
  Object.defineProperty(c, 'onmessage', { get: () => r.onmessage, set: (fn) => (r.handler = fn) });
  Object.defineProperty(c, 'onclose', { get: () => r.onclose, set: (fn) => (r.onclose = fn) });
  return c;
}

/**
 * The first message on a fresh path (the hello), or null after the time limit.
 * Messages after it stay held by the session until the next listener is set.
 */
export function firstMessage(path: Path, timeoutMs = 5000): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      path.onmessage = undefined;
      resolve(null);
    }, timeoutMs);
    path.onmessage = (m) => {
      clearTimeout(t);
      path.onmessage = undefined;
      resolve(m);
    };
  });
}

/** A carrier that hands `first` over before anything else (a peer without hellos). */
export function prepend(path: Path, first: Uint8Array): Carrier {
  let fn: ((m: Uint8Array) => void) | undefined;
  let pending: Uint8Array | null = first;
  const c: Carrier = { send: (m) => path.send(m), close: (r) => path.close(r) };
  Object.defineProperty(c, 'onclose', { get: () => path.onclose, set: (f) => (path.onclose = f) });
  Object.defineProperty(c, 'onmessage', {
    get: () => fn,
    set: (f) => {
      fn = f;
      if (f && pending) {
        const p = pending;
        pending = null;
        f(p);
      }
      path.onmessage = f;
    },
  });
  return c;
}
