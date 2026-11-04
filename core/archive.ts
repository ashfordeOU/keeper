// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Lists what is inside ZIP-based files (zip, jar, apk, ipa, epub, docx…) and
// tar archives without unpacking them.

export interface ArchiveEntry {
  name: string;
  size: number;
  /** compressed size, when the format knows it */
  packed?: number;
  mtime?: number;
  dir: boolean;
  /** protected with a password */
  encrypted?: boolean;
}

const u16 = (b: Uint8Array, p: number) => b[p] | (b[p + 1] << 8);
const u32 = (b: Uint8Array, p: number) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;

function dosTime(date: number, time: number): number {
  return new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2).getTime();
}

/**
 * Finds the end-of-central-directory record in the tail of a ZIP file.
 * Returns where the central directory starts and how big it is.
 */
export function findZipDirectory(tail: Uint8Array, fileSize: number): { offset: number; size: number; count: number } | undefined {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      let count = u16(tail, i + 10);
      let size = u32(tail, i + 12);
      let offset = u32(tail, i + 16);
      // ZIP64: the real values live in the zip64 end record just before.
      const loc = i - 20;
      if ((offset === 0xffffffff || count === 0xffff) && loc >= 0 && u32(tail, loc) === 0x07064b50) {
        const recAt = Number(new DataView(tail.buffer, tail.byteOffset + loc + 8, 8).getBigUint64(0, true)) - (fileSize - tail.length);
        if (recAt >= 0 && u32(tail, recAt) === 0x06064b50) {
          const dv = new DataView(tail.buffer, tail.byteOffset + recAt);
          count = Number(dv.getBigUint64(32, true));
          size = Number(dv.getBigUint64(40, true));
          offset = Number(dv.getBigUint64(48, true));
        }
      }
      return { offset, size, count };
    }
  }
  return undefined;
}

/** Parses the central directory records. */
export function parseZipDirectory(dir: Uint8Array): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  let p = 0;
  while (p + 46 <= dir.length && u32(dir, p) === 0x02014b50) {
    const flags = u16(dir, p + 8);
    const time = u16(dir, p + 12);
    const date = u16(dir, p + 14);
    let packed = u32(dir, p + 20);
    let size = u32(dir, p + 24);
    const nameLen = u16(dir, p + 28);
    const extraLen = u16(dir, p + 30);
    const commentLen = u16(dir, p + 32);
    const nameBytes = dir.subarray(p + 46, p + 46 + nameLen);
    const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'utf-8').decode(nameBytes);
    // ZIP64 sizes in the extra field.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = u16(dir, e);
      const len = u16(dir, e + 2);
      if (id === 0x0001) {
        const dv = new DataView(dir.buffer, dir.byteOffset + e + 4, len);
        let q = 0;
        if (size === 0xffffffff && q + 8 <= len) { size = Number(dv.getBigUint64(q, true)); q += 8; }
        if (packed === 0xffffffff && q + 8 <= len) { packed = Number(dv.getBigUint64(q, true)); q += 8; }
      }
      e += 4 + len;
    }
    out.push({ name, size, packed, mtime: dosTime(date, time), dir: name.endsWith('/'), ...(flags & 1 ? { encrypted: true } : {}) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Parses a (decompressed) tar stream. Handles GNU long names and pax paths. */
export function parseTar(b: Uint8Array, limit = 20_000): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  let p = 0;
  let longName: string | undefined;
  const str = (at: number, len: number) => {
    const s = b.subarray(at, at + len);
    const z = s.indexOf(0);
    return new TextDecoder('utf-8').decode(z >= 0 ? s.subarray(0, z) : s);
  };
  const octal = (at: number, len: number) => {
    // Base-256 for very large files.
    if (b[at] & 0x80) {
      let v = 0;
      for (let i = 1; i < len; i++) v = v * 256 + b[at + i];
      return v;
    }
    return parseInt(str(at, len).trim() || '0', 8) || 0;
  };
  while (p + 512 <= b.length && out.length < limit) {
    if (b.subarray(p, p + 512).every((x) => x === 0)) break;
    const size = octal(p + 124, 12);
    const type = String.fromCharCode(b[p + 156] || 48);
    let name = str(p, 100);
    const prefix = str(p + 345, 155);
    if (prefix && b[p + 257] === 0x75) name = `${prefix}/${name}`;
    const body = p + 512;
    if (type === 'L') longName = str(body, size);
    else if (type === 'x') {
      const pax = new TextDecoder('utf-8').decode(b.subarray(body, body + size));
      const m = pax.match(/\d+ path=([^\n]+)\n/);
      if (m) longName = m[1];
    } else if (type !== 'g') {
      out.push({ name: longName ?? name, size, mtime: octal(p + 136, 12) * 1000, dir: type === '5' || name.endsWith('/') });
      longName = undefined;
    }
    p = body + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Turns a flat list into a tree-friendly summary: total size and file count. */
export function summarize(entries: ArchiveEntry[]): { files: number; folders: number; size: number; packed: number } {
  let files = 0;
  let folders = 0;
  let size = 0;
  let packed = 0;
  for (const e of entries) {
    if (e.dir) folders++;
    else {
      files++;
      size += e.size;
      packed += e.packed ?? 0;
    }
  }
  return { files, folders, size, packed };
}

/**
 * The outside tools that can unpack one entry, in the order to try them. Every
 * list ends its options with `--`, so an entry named like an option (for
 * example "--to-command=…" for tar) is only ever read as a name.
 */
export function extractCommands(archive: string, entry: string, dir: string, sep = '/'): [string, string[]][] {
  return [
    ['tar', ['-xf', archive, '-C', dir, '--', entry]],
    ['7z', ['x', '-y', `-o${dir}`, '--', archive, entry]],
    ['7zz', ['x', '-y', `-o${dir}`, '--', archive, entry]],
    ['unrar', ['x', '-y', '--', archive, entry, dir + sep]],
  ];
}
