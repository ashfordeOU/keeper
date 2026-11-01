// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The phone companion's protocol, shared by the page the phone opens and the
// app that serves it. The QR code carries a one-time secret in the part of the
// address browsers never send (#k=…); after the phone is approved it gets its
// own long-term key, kept in the page's storage. Every message is sealed with
// ChaCha20-Poly1305 and a per-direction counter, so neither the local network
// nor a tunnel provider can read or change what the phone and the computer say.
//
//   phone → app   text  {t:'hello', v:1, inv|cid, n}
//   app → phone   text  {t:'hi', n, id, name}      keys = HKDF(secret, nPhone ‖ nApp)
//   then binary: seal(counter, [u32 header length][header JSON][body])
//
// Requests carry {id, op, …}; answers {id, ok, r | e}; the app may push {ev}.
// Ops: register, info, shares, list, read, put, clip.get, clip.set. Screen
// viewing and control can be added later as ops on the same channel.

import { concat, fromB64u, fromUtf8, hkdf, open, seal, toB64u, utf8 } from './jscrypto';

export interface CHeader {
  id?: number;
  op?: string;
  ok?: boolean;
  e?: string;
  r?: unknown;
  ev?: string;
  [k: string]: unknown;
}

export function companionKeys(secret: Uint8Array, nPhone: Uint8Array, nApp: Uint8Array) {
  const k = hkdf(secret, concat(nPhone, nApp), utf8('keeper-companion/1'), 64);
  return { phoneToApp: k.subarray(0, 32), appToPhone: k.subarray(32, 64) };
}

function nonce(counter: number): Uint8Array {
  const n = new Uint8Array(12);
  const dv = new DataView(n.buffer);
  dv.setUint32(4, Math.floor(counter / 0x100000000));
  dv.setUint32(8, counter >>> 0);
  return n;
}

/** One direction's sealing: messages must be opened in the order they were sealed. */
export class Sealer {
  private n = 0;
  constructor(private key: Uint8Array) {}
  seal(header: CHeader, body?: Uint8Array): Uint8Array {
    const h = utf8(JSON.stringify(header));
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, h.length);
    return seal(this.key, nonce(this.n++), concat(len, h, body ?? new Uint8Array(0)));
  }
}

export class Opener {
  private n = 0;
  constructor(private key: Uint8Array) {}
  open(msg: Uint8Array): { header: CHeader; body: Uint8Array } | null {
    const p = open(this.key, nonce(this.n), msg);
    if (!p || p.length < 4) return null;
    this.n++;
    const len = new DataView(p.buffer, p.byteOffset, 4).getUint32(0);
    if (len > p.length - 4) return null;
    try {
      return { header: JSON.parse(fromUtf8(p.subarray(4, 4 + len))), body: p.subarray(4 + len) };
    } catch {
      return null;
    }
  }
}

/** An invite's public id: lets the app find the secret without the secret travelling. */
export function inviteId(secret: Uint8Array): string {
  return toB64u(hkdf(secret, new Uint8Array(0), utf8('keeper-companion invite id'), 12));
}

export { fromB64u, toB64u };

/** Largest chunk the phone asks for or sends at once. */
export const COMPANION_CHUNK = 512 * 1024;
