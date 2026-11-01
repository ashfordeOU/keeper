// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The two archive formats notes exports use: tar (Joplin's .jex) and zip
// (Markdown exports, Notesnook exports). Small, dependency-free readers and
// writers; zip is written uncompressed so any app can open it.

import { inflateRawSync } from 'node:zlib';

export interface ArchiveEntry { name: string; data: Uint8Array; mtime?: number }

const enc = new TextEncoder();

// ---------------------------------------------------------------- tar

function octal(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, '0') + '\0';
}

export function writeTar(entries: ArchiveEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    const h = new Uint8Array(512);
    let name = e.name;
    let prefix = '';
    if (enc.encode(name).length > 100) {
      const i = name.lastIndexOf('/', 154);
      if (i > 0) { prefix = name.slice(0, i); name = name.slice(i + 1); }
    }
    const put = (s: string, off: number, len: number) => h.set(enc.encode(s).subarray(0, len), off);
    put(name, 0, 100);
    put(octal(0o644, 8), 100, 8);
    put(octal(0, 8), 108, 8);
    put(octal(0, 8), 116, 8);
    put(octal(e.data.length, 12), 124, 12);
    put(octal(Math.floor((e.mtime ?? Date.now()) / 1000), 12), 136, 12);
    h.fill(32, 148, 156);
    h[156] = 48; // '0' regular file
    put('ustar\0', 257, 6);
    put('00', 263, 2);
    put(prefix, 345, 155);
    let sum = 0;
    for (const b of h) sum += b;
    put(octal(sum, 7) + ' ', 148, 8);
    parts.push(h, e.data, new Uint8Array((512 - (e.data.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  return concatAll(parts);
}

export function readTar(buf: Uint8Array): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  const dec = new TextDecoder();
  const str = (off: number, len: number) => dec.decode(buf.subarray(off, off + len)).replace(/\0.*$/s, '');
  for (let off = 0; off + 512 <= buf.length;) {
    if (buf.subarray(off, off + 512).every((b) => b === 0)) break;
    const name = str(off, 100);
    const size = parseInt(str(off + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(buf[off + 156] || 48);
    const prefix = str(off + 257, 6).startsWith('ustar') ? str(off + 345, 155) : '';
    const full = prefix ? `${prefix}/${name}` : name;
    if (type === '0' || type === '\0') out.push({ name: full, data: buf.slice(off + 512, off + 512 + size), mtime: parseInt(str(off + 136, 12).trim() || '0', 8) * 1000 });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

// ---------------------------------------------------------------- zip

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(t: number): { time: number; date: number } {
  const d = new Date(t);
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

export function writeZip(entries: ArchiveEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const { time, date } = dosTime(e.mtime ?? Date.now());
    const h = new Uint8Array(30 + name.length);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
    v.setUint16(10, time, true); v.setUint16(12, date, true); v.setUint32(14, crc, true);
    v.setUint32(18, e.data.length, true); v.setUint32(22, e.data.length, true); v.setUint16(26, name.length, true);
    h.set(name, 30);
    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true); cv.setUint32(24, e.data.length, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    c.set(name, 46);
    parts.push(h, e.data);
    central.push(c);
    offset += h.length + e.data.length;
  }
  const cd = concatAll(central);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cd.length, true); ev.setUint32(16, offset, true);
  return concatAll([...parts, cd, end]);
}

export function readZip(buf: Uint8Array): ArchiveEntry[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: ArchiveEntry[] = [];
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    const lstart = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = buf.subarray(lstart, lstart + csize);
    if (!name.endsWith('/')) {
      if (method === 0) out.push({ name, data: raw.slice() });
      else if (method === 8) out.push({ name, data: new Uint8Array(inflateRawSync(raw)) });
    }
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

function concatAll(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
