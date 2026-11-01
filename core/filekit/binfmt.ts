// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Binary formats written byte by byte: web fonts (WOFF and WOFF2 from and to
// TrueType/OpenType) and icon files (Windows .ico and macOS .icns).

import { brotliCompressSync, brotliDecompressSync, constants as Z, deflateSync, inflateSync } from 'node:zlib';

// ---------------------------------------------------------------- fonts

export interface SfntTable { tag: string; checksum: number; data: Buffer }
export interface Sfnt { flavor: number; tables: SfntTable[] }

export function fontKind(b: Buffer): 'ttf' | 'otf' | 'woff' | 'woff2' | 'ttc' | undefined {
  const sig = b.subarray(0, 4).toString('latin1');
  if (sig === 'wOFF') return 'woff';
  if (sig === 'wOF2') return 'woff2';
  if (sig === 'OTTO') return 'otf';
  if (sig === 'ttcf') return 'ttc';
  if (b.readUInt32BE(0) === 0x00010000 || sig === 'true') return 'ttf';
  return undefined;
}

export function readSfnt(b: Buffer): Sfnt {
  const flavor = b.readUInt32BE(0);
  const n = b.readUInt16BE(4);
  const tables: SfntTable[] = [];
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    const tag = b.subarray(at, at + 4).toString('latin1');
    const off = b.readUInt32BE(at + 8);
    const len = b.readUInt32BE(at + 12);
    if (off + len > b.length) throw new Error('This font file is damaged (a table runs past the end)');
    tables.push({ tag, checksum: b.readUInt32BE(at + 4), data: Buffer.from(b.subarray(off, off + len)) });
  }
  return { flavor, tables };
}

export function tableChecksum(d: Buffer): number {
  let sum = 0;
  const padded = d.length % 4 ? Buffer.concat([d, Buffer.alloc(4 - (d.length % 4))]) : d;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

const pad4 = (n: number) => (n + 3) & ~3;

export function writeSfnt(f: Sfnt): Buffer {
  const tables = [...f.tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = tables.length;
  let pow = 1;
  let log = 0;
  while (pow * 2 <= n) { pow *= 2; log++; }
  const head = Buffer.alloc(12 + 16 * n);
  head.writeUInt32BE(f.flavor, 0);
  head.writeUInt16BE(n, 4);
  head.writeUInt16BE(pow * 16, 6);
  head.writeUInt16BE(log, 8);
  head.writeUInt16BE(n * 16 - pow * 16, 10);
  let off = head.length;
  const body: Buffer[] = [];
  tables.forEach((t, i) => {
    const at = 12 + i * 16;
    head.write(t.tag, at, 4, 'latin1');
    head.writeUInt32BE(t.checksum || tableChecksum(t.data), at + 4);
    head.writeUInt32BE(off, at + 8);
    head.writeUInt32BE(t.data.length, at + 12);
    const padded = Buffer.alloc(pad4(t.data.length));
    t.data.copy(padded);
    body.push(padded);
    off += padded.length;
  });
  return Buffer.concat([head, ...body]);
}

/** WOFF 1.0: each table deflated when that makes it smaller. */
export function sfntToWoff(b: Buffer): Buffer {
  const f = readSfnt(b);
  const n = f.tables.length;
  const header = Buffer.alloc(44 + 20 * n);
  const parts: Buffer[] = [];
  let off = header.length;
  let total = 12 + 16 * n;
  const sorted = [...f.tables].sort((a, c) => (a.tag < c.tag ? -1 : 1));
  sorted.forEach((t, i) => {
    const z = deflateSync(t.data, { level: 9 });
    const stored = z.length < t.data.length ? z : t.data;
    const at = 44 + i * 20;
    header.write(t.tag, at, 4, 'latin1');
    header.writeUInt32BE(off, at + 4);
    header.writeUInt32BE(stored.length, at + 8);
    header.writeUInt32BE(t.data.length, at + 12);
    header.writeUInt32BE(t.checksum, at + 16);
    const padded = Buffer.alloc(pad4(stored.length));
    stored.copy(padded);
    parts.push(padded);
    off += padded.length;
    total += pad4(t.data.length);
  });
  header.write('wOFF', 0, 'latin1');
  header.writeUInt32BE(f.flavor, 4);
  header.writeUInt32BE(off, 8);
  header.writeUInt16BE(n, 12);
  header.writeUInt32BE(total, 16);
  header.writeUInt16BE(1, 20);
  return Buffer.concat([header, ...parts]);
}

export function woffToSfnt(b: Buffer): Buffer {
  if (b.subarray(0, 4).toString('latin1') !== 'wOFF') throw new Error('Not a WOFF font');
  const flavor = b.readUInt32BE(4);
  const n = b.readUInt16BE(12);
  const tables: SfntTable[] = [];
  for (let i = 0; i < n; i++) {
    const at = 44 + i * 20;
    const tag = b.subarray(at, at + 4).toString('latin1');
    const off = b.readUInt32BE(at + 4);
    const comp = b.readUInt32BE(at + 8);
    const orig = b.readUInt32BE(at + 12);
    const raw = b.subarray(off, off + comp);
    tables.push({ tag, checksum: b.readUInt32BE(at + 16), data: comp < orig ? inflateSync(raw) : Buffer.from(raw) });
  }
  return writeSfnt({ flavor, tables });
}

function base128(n: number): Buffer {
  const bytes: number[] = [];
  do { bytes.unshift(n & 0x7f); n = Math.floor(n / 128); } while (n > 0);
  for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80;
  return Buffer.from(bytes);
}

function readBase128(b: Buffer, at: number): [number, number] {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const c = b[at + i];
    v = v * 128 + (c & 0x7f);
    if (!(c & 0x80)) return [v, at + i + 1];
  }
  throw new Error('This WOFF2 font is damaged');
}

/**
 * WOFF2 with every table stored as it is (the "null transform" the format
 * allows), Brotli-compressed as one stream. Browsers read it like any WOFF2.
 */
export function sfntToWoff2(b: Buffer): Buffer {
  const f = readSfnt(b);
  // glyf must be followed by loca.
  const order = [...f.tables].sort((a, c) => (a.tag < c.tag ? -1 : 1)).filter((t) => t.tag !== 'loca');
  const loca = f.tables.find((t) => t.tag === 'loca');
  if (loca) order.splice(order.findIndex((t) => t.tag === 'glyf') + 1, 0, loca);
  const dir: Buffer[] = [];
  for (const t of order) {
    const nullGlyf = t.tag === 'glyf' || t.tag === 'loca';
    const flags = 63 | (nullGlyf ? 0xc0 : 0);
    const tag = Buffer.from(t.tag, 'latin1');
    dir.push(Buffer.from([flags]), tag, base128(t.data.length));
  }
  const stream = Buffer.concat(order.map((t) => t.data));
  const compressed = brotliCompressSync(stream, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_MODE]: Z.BROTLI_MODE_FONT, [Z.BROTLI_PARAM_SIZE_HINT]: stream.length } });
  const directory = Buffer.concat(dir);
  const header = Buffer.alloc(48);
  const length = pad4(48 + directory.length + compressed.length);
  header.write('wOF2', 0, 'latin1');
  header.writeUInt32BE(f.flavor, 4);
  header.writeUInt32BE(length, 8);
  header.writeUInt16BE(order.length, 12);
  header.writeUInt32BE(12 + 16 * order.length + order.reduce((n, t) => n + pad4(t.data.length), 0), 16);
  header.writeUInt32BE(compressed.length, 20);
  header.writeUInt16BE(1, 24);
  const out = Buffer.alloc(length);
  header.copy(out);
  directory.copy(out, 48);
  compressed.copy(out, 48 + directory.length);
  return out;
}

const WOFF2_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

/** WOFF2 back to TrueType/OpenType. Fonts whose outlines were transformed need the full decoder (reported clearly). */
export function woff2ToSfnt(b: Buffer): Buffer {
  if (b.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error('Not a WOFF2 font');
  const flavor = b.readUInt32BE(4);
  const n = b.readUInt16BE(12);
  const compLen = b.readUInt32BE(20);
  let at = 48;
  const dir: { tag: string; len: number; transformed: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const flags = b[at++];
    let tag: string;
    if ((flags & 63) === 63) { tag = b.subarray(at, at + 4).toString('latin1'); at += 4; } else tag = WOFF2_TAGS[flags & 63];
    const ver = flags >> 6;
    let len: number;
    [len, at] = readBase128(b, at);
    const transformed = tag === 'glyf' || tag === 'loca' ? ver !== 3 : ver !== 0;
    if (transformed) [len, at] = readBase128(b, at);
    dir.push({ tag, len, transformed });
  }
  if (flavor === 0x74746366) throw new Error('Font collections in WOFF2 are not supported yet');
  if (dir.some((d) => d.transformed)) throw new Error('This WOFF2 font uses compressed outlines; converting it back needs the font tools engine (fontTools), which Keeper can use when it is installed');
  const stream = brotliDecompressSync(b.subarray(at, at + compLen));
  let off = 0;
  const tables = dir.map((d) => { const data = Buffer.from(stream.subarray(off, off + d.len)); off += d.len; return { tag: d.tag, checksum: tableChecksum(data), data }; });
  return writeSfnt({ flavor, tables });
}

/** Names from the font's name table (family, style, full name, version). */
export function fontNames(b: Buffer): Record<string, string> {
  const f = readSfnt(b);
  const t = f.tables.find((x) => x.tag === 'name')?.data;
  if (!t) return {};
  const count = t.readUInt16BE(2);
  const strings = t.readUInt16BE(4);
  const ids: Record<number, string> = { 1: 'family', 2: 'style', 4: 'fullName', 5: 'version', 6: 'postscript', 0: 'copyright', 13: 'license' };
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    const platform = t.readUInt16BE(at);
    const id = t.readUInt16BE(at + 6);
    const len = t.readUInt16BE(at + 8);
    const off = t.readUInt16BE(at + 10);
    const key = ids[id];
    if (!key || out[key]) continue;
    const raw = t.subarray(strings + off, strings + off + len);
    out[key] = platform === 3 || platform === 0 ? raw.swap16().toString('utf16le') : raw.toString('latin1');
  }
  return out;
}

// ---------------------------------------------------------------- icons

/** A Windows icon holding PNG images (Vista and later read these at every size). */
export function writeIco(pngs: { size: number; png: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16BE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach((p, i) => {
    const at = 6 + i * 16;
    head[at] = p.size >= 256 ? 0 : p.size;
    head[at + 1] = p.size >= 256 ? 0 : p.size;
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(p.png.length, at + 8);
    head.writeUInt32LE(off, at + 12);
    off += p.png.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.png)]);
}

/** The largest image in an .ico: PNG bytes, or raw RGBA for the older bitmap entries. */
export function readIco(b: Buffer): { png?: Buffer; rgba?: { data: Buffer; width: number; height: number } } {
  const n = b.readUInt16LE(4);
  let best = -1;
  let bestSize = -1;
  for (let i = 0; i < n; i++) { const s = b[6 + i * 16] || 256; if (s > bestSize) { bestSize = s; best = i; } }
  if (best < 0) throw new Error('This icon has no pictures');
  const at = 6 + best * 16;
  const len = b.readUInt32LE(at + 8);
  const off = b.readUInt32LE(at + 12);
  const img = b.subarray(off, off + len);
  if (img.readUInt32BE(0) === 0x89504e47) return { png: Buffer.from(img) };
  // BITMAPINFOHEADER, bottom-up, 32 or 24 bits per pixel, followed by the AND mask.
  const w = img.readInt32LE(4);
  const h = img.readInt32LE(8) / 2;
  const bpp = img.readUInt16LE(14);
  const hdr = img.readUInt32LE(0);
  if (bpp !== 32 && bpp !== 24) throw new Error(`Icons with ${bpp}-bit pictures are not supported`);
  const stride = pad4((w * bpp) / 8);
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = hdr + (h - 1 - y) * stride + (x * bpp) / 8;
      const d = (y * w + x) * 4;
      data[d] = img[s + 2]; data[d + 1] = img[s + 1]; data[d + 2] = img[s]; data[d + 3] = bpp === 32 ? img[s + 3] : 255;
    }
  }
  return { rgba: { data, width: w, height: h } };
}

const ICNS_TYPES: [number, string][] = [[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']];
export const ICNS_SIZES = ICNS_TYPES.map(([s]) => s);

export function writeIcns(pngs: { size: number; png: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  for (const p of pngs) {
    const type = ICNS_TYPES.find(([s]) => s === p.size)?.[1];
    if (!type) continue;
    const h = Buffer.alloc(8);
    h.write(type, 0, 'latin1');
    h.writeUInt32BE(p.png.length + 8, 4);
    parts.push(h, p.png);
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'latin1');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

/** The largest PNG inside an .icns. */
export function readIcns(b: Buffer): Buffer {
  let at = 8;
  let best: Buffer | undefined;
  while (at + 8 <= b.length) {
    const len = b.readUInt32BE(at + 4);
    if (len < 8) break;
    const data = b.subarray(at + 8, at + len);
    if (data.length > 8 && data.readUInt32BE(0) === 0x89504e47 && (!best || data.length > best.length)) best = Buffer.from(data);
    at += len;
  }
  if (!best) throw new Error('This icon has no PNG pictures Keeper can read');
  return best;
}
