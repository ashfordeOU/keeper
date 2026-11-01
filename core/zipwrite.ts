// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Writing ZIP files (for "Compress to ZIP", Word documents and exports) and
// unpacking ZIP and TAR archives without any outside program. A password uses
// the classic ZIP encryption every system's built-in unzip can open; it keeps
// casual readers out but is not strong — Keeper's own "Lock with a password"
// is the strong choice, and the interface says so.

import { createHash, randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { deflateRawSync, gunzipSync, inflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------- CRC-32

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// ---------------------------------------------------------------- classic ZIP encryption

class ZipCrypto {
  private k0 = 0x12345678;
  private k1 = 0x23456789;
  private k2 = 0x34567890;
  constructor(password: string) {
    for (const b of Buffer.from(password, 'utf8')) this.update(b);
  }
  private crcByte(c: number, b: number): number {
    return (CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  private update(b: number) {
    this.k0 = this.crcByte(this.k0, b);
    this.k1 = (Math.imul((this.k1 + (this.k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    this.k2 = this.crcByte(this.k2, this.k1 >>> 24);
  }
  private stream(): number {
    const t = (this.k2 | 2) & 0xffff;
    return (Math.imul(t, t ^ 1) >>> 8) & 0xff;
  }
  encrypt(data: Uint8Array): Buffer {
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      out[i] = c ^ this.stream();
      this.update(c);
    }
    return out;
  }
  decrypt(data: Uint8Array): Buffer {
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) {
      const c = data[i] ^ this.stream();
      out[i] = c;
      this.update(c);
    }
    return out;
  }
}

// ---------------------------------------------------------------- writing

export interface ZipInput {
  /** path inside the archive, with forward slashes; a trailing slash makes a folder */
  name: string;
  data?: Uint8Array;
  mtime?: Date;
}

function dosTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** A complete ZIP file. Text-like and uncompressed data is deflated; already-compressed data is stored. */
export function zip(entries: ZipInput[], opts: { password?: string; level?: number } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const isDir = e.name.endsWith('/');
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
    const raw = isDir ? Buffer.alloc(0) : Buffer.from(e.data ?? new Uint8Array());
    const crc = crc32(raw);
    let body: Buffer = raw;
    let method = 0;
    if (raw.length > 64) {
      const d = deflateRawSync(raw, { level: opts.level ?? 6 });
      if (d.length < raw.length * 0.95) {
        body = d;
        method = 8;
      }
    }
    let flags = 0x0800; // names are UTF-8
    if (opts.password && !isDir) {
      flags |= 1;
      const zc = new ZipCrypto(opts.password);
      const header = randomBytes(12);
      header[11] = (crc >>> 24) & 0xff;
      body = Buffer.concat([zc.encrypt(header), zc.encrypt(body)]);
    }
    const { time, date } = dosTime(e.mtime ?? new Date());
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // made by: Unix, so permissions survive
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((isDir ? 0o40755 : 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Every file under the given paths, named relative to their parent folder. */
export async function collectFiles(paths: string[]): Promise<{ abs: string; name: string }[]> {
  const out: { abs: string; name: string }[] = [];
  const walk = async (abs: string, name: string) => {
    const st = await fsp.lstat(abs);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      out.push({ abs, name: name + '/' });
      for (const c of (await fsp.readdir(abs)).sort()) await walk(path.join(abs, c), `${name}/${c}`);
    } else if (st.isFile()) out.push({ abs, name });
  };
  for (const p of paths) await walk(p, path.basename(p));
  return out;
}

// ---------------------------------------------------------------- reading

export interface UnpackedEntry {
  name: string;
  dir: boolean;
  data?: Buffer;
  mtime?: Date;
}

/** A safe relative path inside the destination, or undefined for names that would escape it. */
export function safeEntryPath(name: string): string | undefined {
  const parts = name.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (!parts.length || parts.some((p) => p === '..') || /^[a-zA-Z]:/.test(parts[0]) || name.startsWith('/')) return undefined;
  return parts.join('/');
}

export function unzip(b: Buffer, password?: string): UnpackedEntry[] {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not a ZIP file, or it is damaged');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out: UnpackedEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('The ZIP file is damaged');
    const flags = b.readUInt16LE(p + 8);
    const method = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const packed = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const off = b.readUInt32LE(p + 42);
    const name = b.toString(flags & 0x0800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) {
      out.push({ name, dir: true });
      continue;
    }
    const start = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
    let data: Buffer = b.subarray(start, start + packed);
    if (method === 99) throw new Error('This ZIP uses AES encryption; Keeper opens it with 7-Zip or your system’s archive tool when one is installed');
    if (flags & 1) {
      if (!password) throw new Error('This ZIP is protected with a password');
      const zc = new ZipCrypto(password);
      const dec = zc.decrypt(data);
      // The last header byte repeats the top of the CRC (or of the time, when sizes follow the data).
      const check = flags & 8 ? (b.readUInt16LE(p - 46 - nameLen - extraLen - commentLen + 12) >>> 8) & 0xff : (crc >>> 24) & 0xff;
      if (dec[11] !== check) throw new Error('Wrong password');
      data = dec.subarray(12);
    }
    let plain: Buffer;
    try {
      if (method === 0) plain = Buffer.from(data);
      else if (method === 8) plain = inflateRawSync(data, { maxOutputLength: 2 ** 31 - 1 });
      else throw new Error(`An entry uses a compression method Keeper cannot unpack (${method}); try 7-Zip`);
    } catch (e) {
      if (flags & 1) throw new Error('Wrong password');
      throw e;
    }
    if (crc32(plain) !== crc) throw new Error(flags & 1 ? 'Wrong password' : `${name} is damaged`);
    out.push({ name, dir: false, data: plain });
  }
  return out;
}

/** Plain or gzip-compressed TAR. */
export function untar(b: Buffer): UnpackedEntry[] {
  if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
  const out: UnpackedEntry[] = [];
  let p = 0;
  let longName: string | undefined;
  while (p + 512 <= b.length) {
    const h = b.subarray(p, p + 512);
    if (h.every((x) => x === 0)) break;
    const field = (o: number, l: number) => h.toString('utf8', o, o + l).replace(/\0.*$/s, '');
    let name = field(0, 100);
    const prefix = field(345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const mtime = new Date(parseInt(field(136, 12).trim() || '0', 8) * 1000);
    const data = b.subarray(p + 512, p + 512 + size);
    p += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    if (longName) {
      name = longName;
      longName = undefined;
    }
    if (type === '5') out.push({ name: name.endsWith('/') ? name : name + '/', dir: true, mtime });
    else if (type === '0' || type === '\0' || type === '7') out.push({ name, dir: false, data: Buffer.from(data), mtime });
    // links, devices and pax headers are skipped on purpose
  }
  return out;
}

/** Writes unpacked entries under `dest`, refusing names that would land outside it. */
export async function writeEntries(entries: UnpackedEntry[], dest: string): Promise<{ files: number; skipped: string[] }> {
  let files = 0;
  const skipped: string[] = [];
  for (const e of entries) {
    const rel = safeEntryPath(e.name);
    if (!rel) {
      skipped.push(e.name);
      continue;
    }
    const target = path.join(dest, ...rel.split('/'));
    if (e.dir) {
      await fsp.mkdir(target, { recursive: true });
      continue;
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, e.data ?? Buffer.alloc(0));
    if (e.mtime && e.mtime.getTime() > 0) await fsp.utimes(target, e.mtime, e.mtime).catch(() => undefined);
    files++;
  }
  return { files, skipped };
}

/** A short fingerprint, for tests and logs. */
export function digest(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex').slice(0, 16);
}
