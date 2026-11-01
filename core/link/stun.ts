// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The smallest useful part of STUN (RFC 5389): ask a STUN server "what address
// do you see me at?" so two devices behind routers can try to reach each other
// directly. Only the Binding request and the (XOR-)MAPPED-ADDRESS answer.

import crypto from 'node:crypto';

const MAGIC = 0x2112a442;
const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const ATTR_MAPPED = 0x0001;
const ATTR_XOR_MAPPED = 0x0020;

export interface Mapped {
  address: string;
  port: number;
}

/** A Binding request with a fresh transaction id. */
export function bindingRequest(txid: Buffer = crypto.randomBytes(12)): { packet: Buffer; txid: Buffer } {
  const b = Buffer.alloc(20);
  b.writeUInt16BE(BINDING_REQUEST, 0);
  b.writeUInt16BE(0, 2);
  b.writeUInt32BE(MAGIC, 4);
  txid.copy(b, 8);
  return { packet: b, txid };
}

/** Looks like a STUN message (first two bits zero, magic cookie). */
export function isStun(b: Uint8Array): boolean {
  return b.length >= 20 && (b[0] & 0xc0) === 0 && Buffer.from(b.buffer, b.byteOffset, b.length).readUInt32BE(4) === MAGIC;
}

/** The address a Binding success response reports for us; null for anything else or a different transaction. */
export function parseBindingResponse(b: Uint8Array, txid?: Uint8Array): Mapped | null {
  if (!isStun(b)) return null;
  const buf = Buffer.from(b.buffer, b.byteOffset, b.length);
  if (buf.readUInt16BE(0) !== BINDING_SUCCESS) return null;
  if (txid && !buf.subarray(8, 20).equals(Buffer.from(txid))) return null;
  const len = buf.readUInt16BE(2);
  if (20 + len > buf.length) return null;
  let off = 20;
  let plain: Mapped | null = null;
  while (off + 4 <= 20 + len) {
    const type = buf.readUInt16BE(off);
    const alen = buf.readUInt16BE(off + 2);
    const v = buf.subarray(off + 4, off + 4 + alen);
    if (v.length < alen) return null;
    if ((type === ATTR_XOR_MAPPED || type === ATTR_MAPPED) && v.length >= 8 && v[1] === 0x01) {
      let port = v.readUInt16BE(2);
      let ip = v.readUInt32BE(4);
      if (type === ATTR_XOR_MAPPED) {
        port ^= MAGIC >>> 16;
        ip = (ip ^ MAGIC) >>> 0;
      }
      const m = { address: [ip >>> 24, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join('.'), port };
      if (type === ATTR_XOR_MAPPED) return m;
      plain = m;
    }
    off += 4 + alen + ((4 - (alen % 4)) % 4);
  }
  return plain;
}

/** A Binding success response (for tests and a tiny local STUN responder). */
export function bindingResponse(txid: Uint8Array, m: Mapped): Buffer {
  const b = Buffer.alloc(32);
  b.writeUInt16BE(BINDING_SUCCESS, 0);
  b.writeUInt16BE(12, 2);
  b.writeUInt32BE(MAGIC, 4);
  Buffer.from(txid).copy(b, 8);
  b.writeUInt16BE(ATTR_XOR_MAPPED, 20);
  b.writeUInt16BE(8, 22);
  b[24] = 0;
  b[25] = 0x01;
  b.writeUInt16BE(m.port ^ (MAGIC >>> 16), 26);
  const ip = m.address.split('.').reduce((a, x) => (a << 8) | Number(x), 0) >>> 0;
  b.writeUInt32BE((ip ^ MAGIC) >>> 0, 28);
  return b;
}

/** "stun:host:port" (or "host:port", "host") → host and port; TURN and anything else → null. */
export function stunTarget(entry: string): { host: string; port: number } | null {
  const e = entry.trim();
  if (/^turns?:/i.test(e) || /^stuns:/i.test(e)) return null;
  const m = e.replace(/^stun:/i, '').match(/^\[?([^\]]+?)\]?(?::(\d+))?$/);
  if (!m || !m[1]) return null;
  return { host: m[1], port: m[2] ? Number(m[2]) : 3478 };
}
