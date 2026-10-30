// SPDX-License-Identifier: AGPL-3.0-or-later
// Reads the camera make/model and capture date from a JPEG's EXIF block.
// Only the first 128 KB of the file are needed.

export interface ExifInfo {
  make?: string;
  model?: string;
  taken?: number;
  width?: number;
  height?: number;
}

export function readExif(buf: Uint8Array): ExifInfo | undefined {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 4 < buf.length) {
    if (buf[i] !== 0xff) return undefined;
    const marker = buf[i + 1];
    const len = (buf[i + 2] << 8) | buf[i + 3];
    if (marker === 0xe1 && String.fromCharCode(...buf.slice(i + 4, i + 8)) === 'Exif') return parseTiff(buf, i + 10);
    if (marker === 0xda) return undefined;
    i += 2 + len;
  }
  return undefined;
}

function parseTiff(buf: Uint8Array, start: number): ExifInfo | undefined {
  const le = buf[start] === 0x49;
  const u16 = (o: number) => (le ? buf[start + o] | (buf[start + o + 1] << 8) : (buf[start + o] << 8) | buf[start + o + 1]);
  const u32 = (o: number) => (le ? (buf[start + o] | (buf[start + o + 1] << 8) | (buf[start + o + 2] << 16) | (buf[start + o + 3] << 24)) >>> 0 : ((buf[start + o] << 24) | (buf[start + o + 1] << 16) | (buf[start + o + 2] << 8) | buf[start + o + 3]) >>> 0);
  const str = (o: number, n: number) => String.fromCharCode(...buf.slice(start + o, start + o + n)).replace(/\0+$/, '').trim();
  const out: ExifInfo = {};
  const readIfd = (off: number, depth: number) => {
    if (off <= 0 || start + off + 2 > buf.length || depth > 2) return;
    const n = u16(off);
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      if (start + e + 12 > buf.length) return;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const valOff = count > 4 || (type === 3 && count > 2) ? u32(e + 8) : e + 8;
      if (tag === 0x010f && type === 2) out.make = str(valOff, count);
      else if (tag === 0x0110 && type === 2) out.model = str(valOff, count);
      else if (tag === 0x9003 && type === 2) {
        const m = str(valOff, count).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
        if (m) out.taken = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
      } else if (tag === 0xa002) out.width = type === 3 ? u16(e + 8) : u32(e + 8);
      else if (tag === 0xa003) out.height = type === 3 ? u16(e + 8) : u32(e + 8);
      else if (tag === 0x8769) readIfd(u32(e + 8), depth + 1);
    }
  };
  try {
    readIfd(u32(4), 0);
  } catch {
    return undefined;
  }
  return out.make || out.model || out.taken ? out : undefined;
}

/** "Apple" + "iPhone 15 Pro" -> "Apple iPhone 15 Pro" (without repeating the brand). */
export function cameraName(e: ExifInfo): string | undefined {
  if (!e.model) return e.make;
  if (!e.make || e.model.toLowerCase().startsWith(e.make.toLowerCase().split(' ')[0])) return e.model;
  return `${e.make} ${e.model}`;
}
