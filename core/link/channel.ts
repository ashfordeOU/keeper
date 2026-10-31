// SPDX-License-Identifier: AGPL-3.0-or-later
// An end-to-end encrypted channel between two Keeper devices that already
// trust each other, over any carrier (the local network, a relay, a tunnel,
// WebRTC). The carrier only ever sees ciphertext.
//
// Handshake (SIGMA-I, the sign-and-MAC pattern behind IKEv2 and TLS 1.3):
//   1  I → R   ephemeral X25519 key eI, nonce nI
//   2  R → I   eR, nR, seal_kR( R's identity key, Ed25519 signature over the transcript )
//   3  I → I   seal_kI( I's identity key, signature over the transcript and R's key )
// Both identity keys travel encrypted, so a watcher cannot tell which devices
// are talking. Each side then checks the other's key against its trusted
// list. Traffic keys come from the X25519 secret and the whole transcript.
//
// After the handshake every message is AES-256-GCM with an implicit 64-bit
// counter per direction: a message that was replayed, dropped, reordered or
// changed fails to open and the channel closes.

import crypto from 'node:crypto';
import { dh, ephemeral, hkdf, sha256, sign, verify, type Identity } from './identity';

export type CarrierKind = 'lan' | 'direct' | 'relay' | 'tunnel' | 'local';

/** Whatever moves bytes: a WebSocket, a WebRTC data channel, an in-memory pipe. Messages arrive whole and in order. */
export interface Wire {
  kind: CarrierKind;
  send(data: Uint8Array): void;
  close(reason?: string): void;
  onmessage?: (data: Uint8Array) => void;
  onclose?: (reason?: string) => void;
  /** a description for the interface: "192.168.1.20", "relay.example.com" */
  where?: string;
}

/** Two connected wires, for tests and for linking a device to itself. */
export function pipe(kind: CarrierKind = 'local'): [Wire, Wire] {
  let closed = false;
  const a: Wire = { kind, send: (d) => !closed && queueMicrotask(() => b.onmessage?.(new Uint8Array(d))), close: (r) => shut(r) };
  const b: Wire = { kind, send: (d) => !closed && queueMicrotask(() => a.onmessage?.(new Uint8Array(d))), close: (r) => shut(r) };
  const shut = (r?: string) => {
    if (closed) return;
    closed = true;
    queueMicrotask(() => {
      a.onclose?.(r);
      b.onclose?.(r);
    });
  };
  return [a, b];
}

/** Reads messages one at a time, with a time limit, until the caller takes the wire over. */
export function reader(wire: Wire) {
  const queue: Uint8Array[] = [];
  const waiting: { resolve: (d: Uint8Array) => void; reject: (e: Error) => void }[] = [];
  let closed: string | null = null;
  wire.onmessage = (d) => {
    const w = waiting.shift();
    if (w) w.resolve(d);
    else queue.push(d);
  };
  wire.onclose = (r) => {
    closed = r ?? 'closed';
    for (const w of waiting.splice(0)) w.reject(new Error(`Connection closed (${closed})`));
  };
  return {
    next(timeoutMs = 15_000): Promise<Uint8Array> {
      const q = queue.shift();
      if (q) return Promise.resolve(q);
      if (closed) return Promise.reject(new Error(`Connection closed (${closed})`));
      return new Promise((resolve, reject) => {
        const entry = {
          resolve: (d: Uint8Array) => { clearTimeout(t); resolve(d); },
          reject: (e: Error) => { clearTimeout(t); reject(e); },
        };
        const t = setTimeout(() => {
          const i = waiting.indexOf(entry);
          if (i >= 0) waiting.splice(i, 1);
          reject(new Error('The other device did not answer in time'));
        }, timeoutMs);
        waiting.push(entry);
      });
    },
    /** messages that arrived early, for the session to process first */
    rest: () => queue.splice(0),
  };
}

// ---------------------------------------------------------------- framing helpers (small JSON headers, binary values as base64)

export const enc = (o: Record<string, unknown>) => new Uint8Array(Buffer.from(JSON.stringify(o)));
export function dec(d: Uint8Array): Record<string, unknown> {
  try {
    const v = JSON.parse(Buffer.from(d).toString('utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
const b = (s: unknown) => (typeof s === 'string' ? Buffer.from(s, 'base64') : Buffer.alloc(0));
const s = (x: Uint8Array) => Buffer.from(x).toString('base64');

function gcmSeal(key: Buffer, counter: bigint, plain: Uint8Array, aad?: Uint8Array): Buffer {
  const iv = Buffer.alloc(12);
  iv.writeBigUInt64BE(counter, 4);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(aad);
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

function gcmOpen(key: Buffer, counter: bigint, sealed: Uint8Array, aad?: Uint8Array): Buffer | null {
  if (sealed.length < 16) return null;
  const iv = Buffer.alloc(12);
  iv.writeBigUInt64BE(counter, 4);
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    if (aad) d.setAAD(aad);
    d.setAuthTag(Buffer.from(sealed.subarray(sealed.length - 16)));
    return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the session

export class Session {
  private sendN = 0n;
  private recvN = 0n;
  private closed = false;
  private listener?: (plain: Uint8Array) => void;
  // Messages that arrive before anyone listens are kept, not lost.
  private held: Uint8Array[] = [];
  onclose?: (reason?: string) => void;

  get onmessage() {
    return this.listener;
  }

  set onmessage(fn: ((plain: Uint8Array) => void) | undefined) {
    this.listener = fn;
    if (fn) for (const m of this.held.splice(0)) fn(m);
  }

  constructor(
    readonly wire: Wire,
    private sendKey: Buffer,
    private recvKey: Buffer,
    /** the other device's identity key */
    readonly peer: Buffer,
    early: Uint8Array[] = [],
  ) {
    wire.onmessage = (d) => this.receive(d);
    wire.onclose = (r) => this.shut(r);
    for (const d of early) queueMicrotask(() => this.receive(d));
  }

  get kind() {
    return this.wire.kind;
  }

  send(plain: Uint8Array) {
    if (this.closed) throw new Error('Connection closed');
    this.wire.send(gcmSeal(this.sendKey, this.sendN++, plain));
  }

  private receive(d: Uint8Array) {
    if (this.closed) return;
    const plain = gcmOpen(this.recvKey, this.recvN, d);
    if (!plain) {
      // Changed, replayed or out of order: nothing after this can be trusted.
      this.close('A message failed its integrity check');
      return;
    }
    this.recvN++;
    if (this.listener) this.listener(plain);
    else this.held.push(plain);
  }

  close(reason?: string) {
    if (this.closed) return;
    this.wire.close(reason);
    this.shut(reason);
  }

  private shut(reason?: string) {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.(reason);
  }

  get isClosed() {
    return this.closed;
  }
}

const PROTO = Buffer.from('keeper-link/1');

function keys(shared: Buffer, transcript: Buffer) {
  const k = hkdf(shared, transcript, 'keeper-link handshake', 128);
  return { r: k.subarray(0, 32), i: k.subarray(32, 64), i2r: k.subarray(64, 96), r2i: k.subarray(96, 128) };
}

/**
 * Starts a channel to a device. `expect` is the identity key it must turn out
 * to be (from the trusted list); anything else is refused.
 */
export async function initiate(wire: Wire, me: Identity, expect: Uint8Array, timeoutMs = 15_000): Promise<Session> {
  const rd = reader(wire);
  const e = ephemeral();
  const nI = crypto.randomBytes(16);
  wire.send(enc({ t: 'h1', v: 1, e: s(e.publicKey), n: s(nI) }));
  const m2 = dec(await rd.next(timeoutMs));
  if (m2.t !== 'h2') throw new Error(typeof m2.error === 'string' ? m2.error : 'Unexpected answer');
  const eR = b(m2.e);
  const nR = b(m2.n);
  const shared = dh(e, eR);
  const t2 = sha256(PROTO, e.publicKey, nI, eR, nR);
  const k = keys(shared, t2);
  const inner = gcmOpen(k.r, 0n, b(m2.box), t2);
  if (!inner || inner.length !== 96) throw new Error('The other device sent a broken handshake');
  const peer = inner.subarray(0, 32);
  if (!Buffer.from(expect).equals(peer)) throw new Error('This is not the device you paired with');
  if (!verify(peer, Buffer.concat([Buffer.from('R'), t2]), inner.subarray(32))) throw new Error('The other device could not prove who it is');
  const sig = sign(me, Buffer.concat([Buffer.from('I'), t2, peer]));
  wire.send(enc({ t: 'h3', box: s(gcmSeal(k.i, 0n, Buffer.concat([me.publicKey, sig]), t2)) }));
  const fin = keys(shared, sha256(t2, me.publicKey, peer));
  return new Session(wire, fin.i2r, fin.r2i, Buffer.from(peer), rd.rest());
}

/**
 * Answers a channel request. `accept` decides from the other side's identity
 * key whether it may connect (it must be on the trusted list).
 */
export async function respond(wire: Wire, me: Identity, accept: (peer: Buffer) => boolean, timeoutMs = 15_000, first?: Uint8Array): Promise<Session> {
  const rd = reader(wire);
  const m1 = dec(first ?? (await rd.next(timeoutMs)));
  if (m1.t !== 'h1' || m1.v !== 1) throw new Error('Not a Keeper link');
  const eI = b(m1.e);
  const nI = b(m1.n);
  const e = ephemeral();
  const nR = crypto.randomBytes(16);
  const shared = dh(e, eI);
  const t2 = sha256(PROTO, eI, nI, e.publicKey, nR);
  const k = keys(shared, t2);
  const sig = sign(me, Buffer.concat([Buffer.from('R'), t2]));
  wire.send(enc({ t: 'h2', e: s(e.publicKey), n: s(nR), box: s(gcmSeal(k.r, 0n, Buffer.concat([me.publicKey, sig]), t2)) }));
  const m3 = dec(await rd.next(timeoutMs));
  if (m3.t !== 'h3') throw new Error('Unexpected answer');
  const inner = gcmOpen(k.i, 0n, b(m3.box), t2);
  if (!inner || inner.length !== 96) throw new Error('The other device sent a broken handshake');
  const peer = Buffer.from(inner.subarray(0, 32));
  if (!verify(peer, Buffer.concat([Buffer.from('I'), t2, me.publicKey]), inner.subarray(32))) throw new Error('The other device could not prove who it is');
  if (!accept(peer)) {
    wire.close('not trusted');
    throw new Error('A device that is not paired tried to connect');
  }
  const fin = keys(shared, sha256(t2, peer, me.publicKey));
  return new Session(wire, fin.r2i, fin.i2r, peer, rd.rest());
}

export const _test = { gcmSeal, gcmOpen, keys };
