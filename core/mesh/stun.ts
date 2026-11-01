// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Just enough STUN (RFC 5389) to learn this device's public address and
// port: a Binding request out of the mesh socket, and the XOR-MAPPED-ADDRESS
// in the reply. Uses the same STUN servers as Link's remote screens (Link
// settings → STUN). Also a tiny Binding responder, for tests.

import crypto from 'node:crypto';
import type dgram from 'node:dgram';
import { bigToV6, intToV4 } from '../net/addr';

export const MAGIC = 0x2112a442;

export function isStun(b: Uint8Array): boolean {
  return b.length >= 20 && (b[0] & 0xc0) === 0 && new DataView(b.buffer, b.byteOffset, b.length).getUint32(4) === MAGIC;
}

export function bindingRequest(tid = crypto.randomBytes(12)): Buffer {
  const b = Buffer.alloc(20);
  b.writeUInt16BE(0x0001, 0);
  b.writeUInt16BE(0, 2);
  b.writeUInt32BE(MAGIC, 4);
  tid.copy(b, 8);
  return b;
}

export const transactionId = (b: Buffer) => b.subarray(8, 20).toString('hex');

/** The mapped address in a Binding success response, or null. */
export function parseBindingResponse(b: Buffer): { ip: string; port: number; tid: string } | null {
  if (!isStun(b) || b.readUInt16BE(0) !== 0x0101) return null;
  const len = b.readUInt16BE(2);
  let off = 20;
  let found: { ip: string; port: number } | null = null;
  while (off + 4 <= 20 + len && off + 4 <= b.length) {
    const type = b.readUInt16BE(off);
    const alen = b.readUInt16BE(off + 2);
    const v = b.subarray(off + 4, off + 4 + alen);
    if ((type === 0x0020 || type === 0x0001) && v.length >= 8) {
      const xor = type === 0x0020;
      const fam = v[1];
      const port = v.readUInt16BE(2) ^ (xor ? MAGIC >>> 16 : 0);
      if (fam === 1) found = { ip: intToV4((v.readUInt32BE(4) ^ (xor ? MAGIC : 0)) >>> 0), port };
      else if (fam === 2 && v.length >= 20) {
        const key = Buffer.concat([Buffer.from([0x21, 0x12, 0xa4, 0x42]), b.subarray(8, 20)]);
        let n = 0n;
        for (let i = 0; i < 16; i++) n = (n << 8n) | BigInt(v[4 + i] ^ (xor ? key[i] : 0));
        found = { ip: bigToV6(n), port };
      }
      if (type === 0x0020 && found) break;
    }
    off += 4 + alen + ((4 - (alen % 4)) % 4);
  }
  return found ? { ...found, tid: transactionId(b) } : null;
}

/** A Binding success response for `req`, from the address the request came from. */
export function bindingResponse(req: Buffer, ip: string, port: number): Buffer {
  const parts = ip.split('.').map(Number);
  const v = Buffer.alloc(8);
  v[1] = 1;
  v.writeUInt16BE(port ^ (MAGIC >>> 16), 2);
  v.writeUInt32BE((((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) ^ MAGIC) >>> 0, 4);
  const out = Buffer.alloc(20 + 4 + 8);
  out.writeUInt16BE(0x0101, 0);
  out.writeUInt16BE(12, 2);
  out.writeUInt32BE(MAGIC, 4);
  req.copy(out, 8, 8, 20);
  out.writeUInt16BE(0x0020, 20);
  out.writeUInt16BE(8, 22);
  v.copy(out, 24);
  return out;
}

/** "stun:host:port" (Link's STUN setting) → host and port. TURN entries are skipped. */
export function parseStunUrl(s: string): { host: string; port: number } | null {
  const m = s.trim().match(/^(?:stun:)?\[?([^\]\s]+?)\]?(?::(\d+))?$/i);
  if (!m || /^turns?:/i.test(s) || /^stuns:/i.test(s)) return null;
  return { host: m[1], port: Number(m[2] ?? 3478) };
}

/** Asks STUN servers through `sock` (the mesh socket, so the mapping is the one peers will see). */
export function stunQuery(sock: { send(b: Buffer, port: number, host: string): void }, servers: { host: string; port: number }[], wait: (tid: string, ms: number) => Promise<{ ip: string; port: number } | null>, ms = 2500): Promise<{ ip: string; port: number } | null> {
  const req = bindingRequest();
  const tid = transactionId(req);
  for (const s of servers) {
    try {
      sock.send(req, s.port, s.host);
    } catch {
      /* unreachable server */
    }
  }
  return wait(tid, ms);
}

/** Answers Binding requests on a socket (tests, and the network-namespace check). */
export function serveStun(sock: dgram.Socket) {
  sock.on('message', (m, r) => {
    if (isStun(m) && m.readUInt16BE(0) === 0x0001 && r.family === 'IPv4') sock.send(bindingResponse(m, r.address, r.port), r.port, r.address);
  });
}
