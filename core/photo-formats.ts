// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The photo editor's formats: what it opens (and how), what it saves, and the
// small byte-level helpers that keep a photo's details when it is saved again
// (EXIF with the turn baked in, with or without the place it was taken), plus a
// plain BMP reader and writer (sharp has neither). Pure: no files, no sharp.

export type SaveFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'heic' | 'tiff' | 'gif' | 'bmp' | 'ico' | 'pdf';
export type ColourProfile = 'keep' | 'srgb';
export type MetadataMode = 'keep' | 'no-location' | 'strip';

/** Camera RAW files: opened through the system's decoder where there is one, else the full-size preview the camera saved inside. */
export const RAW_EXT = ['cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'orf', 'rw2', 'raf', 'pef', 'srw', 'x3f', '3fr', 'erf', 'kdc', 'mrw', 'mos', 'iiq', 'rwl', 'raw'];

/** Everything the editor opens. */
export const OPEN_EXT = ['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'apng', 'webp', 'avif', 'heic', 'heif', 'hif', 'tif', 'tiff', 'gif', 'bmp', 'dib', 'ico', 'cur', 'icns', 'svg', 'svgz', 'psd', 'psb', 'jxl', ...RAW_EXT];

const extOf = (name: string) => (/\.([^.\\/]+)$/.exec(name)?.[1] ?? '').toLowerCase();

/** Pictures the editor opens. */
export const EDITABLE = new RegExp(`\\.(${OPEN_EXT.join('|')})$`, 'i');
export const isEditablePicture = (name: string) => EDITABLE.test(name);
export const isRaw = (name: string) => RAW_EXT.includes(extOf(name));

/** How a picture is opened, in order: the first route that works is used. */
export function openRoutes(name: string, platform: string): ('sharp' | 'system' | 'embedded' | 'heif' | 'psd' | 'ico' | 'icns' | 'bmp' | 'jxl')[] {
  const e = extOf(name);
  const sys = platform === 'darwin' || platform === 'win32' ? (['system'] as const) : [];
  if (RAW_EXT.includes(e)) return [...sys, 'embedded'];
  if (e === 'psd' || e === 'psb') return ['psd', ...sys];
  if (e === 'ico' || e === 'cur') return ['ico', 'sharp'];
  if (e === 'icns') return ['icns', ...sys];
  if (e === 'bmp' || e === 'dib') return ['bmp', ...sys];
  if (e === 'jxl') return ['jxl', ...sys];
  if (e === 'heic' || e === 'heif' || e === 'hif') return ['sharp', ...sys, 'heif'];
  return ['sharp', ...sys];
}

/** Words for how a picture was opened, when it is not simply "as it is". */
export function openedNote(via: string): string | undefined {
  if (via === 'embedded') return 'Showing the full-size preview the camera saved inside this RAW file, not the RAW data itself.';
  if (via === 'psd') return 'Shown flattened: the layers are merged into one picture.';
  if (via === 'svg') return 'A drawing, turned into a picture to edit.';
  if (via === 'system') return undefined;
  return undefined;
}

export interface SaveFormatInfo {
  id: SaveFormat;
  label: string;
  ext: string;
  /** keeps see-through parts */
  alpha: boolean;
  /** a quality slider applies */
  quality: boolean;
  /** keeps every frame of a moving picture */
  frames: boolean;
  /** keeps the photo's details (EXIF) */
  metadata: boolean;
  /** carries a colour profile */
  profile: boolean;
  /** only on these systems (empty: everywhere) */
  only?: string[];
  note?: string;
}

export const SAVE_FORMATS: SaveFormatInfo[] = [
  { id: 'jpeg', label: 'JPEG', ext: 'jpg', alpha: false, quality: true, frames: false, metadata: true, profile: true, note: 'Smallest for photos' },
  { id: 'png', label: 'PNG', ext: 'png', alpha: true, quality: false, frames: false, metadata: true, profile: true, note: 'Sharp text, see-through' },
  { id: 'webp', label: 'WebP', ext: 'webp', alpha: true, quality: true, frames: true, metadata: true, profile: true, note: 'Small, for the web' },
  { id: 'avif', label: 'AVIF', ext: 'avif', alpha: true, quality: true, frames: false, metadata: true, profile: true, note: 'Smallest, newer apps' },
  { id: 'heic', label: 'HEIC', ext: 'heic', alpha: false, quality: true, frames: false, metadata: true, profile: true, only: ['darwin'], note: 'Small, as phones save' },
  { id: 'tiff', label: 'TIFF', ext: 'tiff', alpha: true, quality: false, frames: false, metadata: true, profile: true, note: 'For print, no loss' },
  { id: 'gif', label: 'GIF', ext: 'gif', alpha: true, quality: false, frames: true, metadata: false, profile: false, note: '256 colours, moves' },
  { id: 'bmp', label: 'BMP', ext: 'bmp', alpha: true, quality: false, frames: false, metadata: false, profile: false, note: 'Plain, for old apps' },
  { id: 'ico', label: 'Icon (.ico)', ext: 'ico', alpha: true, quality: false, frames: false, metadata: false, profile: false, note: 'Every size, 16 to 256' },
  { id: 'pdf', label: 'PDF', ext: 'pdf', alpha: false, quality: true, frames: false, metadata: false, profile: false, note: 'One page' },
];

export const formatInfo = (f: SaveFormat) => SAVE_FORMATS.find((x) => x.id === f)!;
export const extensionFor = (f: SaveFormat) => formatInfo(f).ext;

/** Can this computer write the format, and if not, why not (in plain words). */
export function canSave(f: SaveFormat, platform: string): { ok: boolean; why?: string } {
  const info = formatInfo(f);
  if (info.only && !info.only.includes(platform)) return { ok: false, why: f === 'heic' ? 'Saving HEIC needs a Mac; this computer can open HEIC but has no HEIC writer.' : 'Not on this computer.' };
  return { ok: true };
}

/** The format a picture is saved back in when nothing else is asked: its own, when it can be written. */
export function sameFormatAs(name: string): SaveFormat {
  const e = extOf(name);
  if (e === 'jpg' || e === 'jpeg' || e === 'jpe' || e === 'jfif') return 'jpeg';
  if (e === 'png' || e === 'apng') return 'png';
  if (e === 'tif') return 'tiff';
  if (e === 'heif' || e === 'hif') return 'heic';
  if (e === 'dib') return 'bmp';
  if (e === 'cur') return 'ico';
  if (['webp', 'avif', 'heic', 'tiff', 'gif', 'bmp', 'ico'].includes(e)) return e as SaveFormat;
  return 'jpeg'; // RAW, PSD, SVG, ICNS, JPEG XL: a new picture, saved as a copy
}

export const SAVE_IDS = SAVE_FORMATS.map((f) => f.id);

// ---------------------------------------------------------------- EXIF

/** The TIFF-structured bytes of an EXIF block (drops the "Exif\0\0" prefix sharp and JPEG use). */
export function exifTiff(b: Uint8Array | undefined): Uint8Array | undefined {
  if (!b || b.length < 8) return undefined;
  const s = b[0] === 0x45 && b[1] === 0x78 && b[2] === 0x69 && b[3] === 0x66 && b[4] === 0 && b[5] === 0 ? b.subarray(6) : b;
  const order = s[0] === 0x49 && s[1] === 0x49 ? 'le' : s[0] === 0x4d && s[1] === 0x4d ? 'be' : '';
  return order ? s : undefined;
}

/**
 * EXIF ready to write again: orientation set to upright (the editor turns the
 * pixels), and with `noLocation` the GPS block blanked and unlinked, so the
 * place the photo was taken is not left anywhere in the bytes. Returns a copy.
 */
export function cleanExif(tiff: Uint8Array, o: { noLocation?: boolean } = {}): Uint8Array {
  const b = new Uint8Array(tiff);
  const le = b[0] === 0x49;
  const u16 = (p: number) => (le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
  const u32 = (p: number) => (le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0);
  const w16 = (p: number, v: number) => { if (le) { b[p] = v & 255; b[p + 1] = v >> 8; } else { b[p] = v >> 8; b[p + 1] = v & 255; } };
  const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  const ifd0 = u32(4);
  if (ifd0 + 2 > b.length) return b;
  const n = u16(ifd0);
  let gps = -1;
  for (let i = 0; i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > b.length) break;
    const tag = u16(e);
    if (tag === 0x0112 && u16(e + 2) === 3) w16(e + 8, 1);
    if (tag === 0x8825) gps = e;
  }
  if (o.noLocation && gps >= 0) {
    const at = u32(gps + 8);
    // Blank every GPS value (out-of-line ones too), then the GPS directory itself.
    if (at + 2 <= b.length) {
      const m = u16(at);
      for (let i = 0; i < m && at + 2 + i * 12 + 12 <= b.length; i++) {
        const e = at + 2 + i * 12;
        const size = (SIZES[u16(e + 2)] ?? 1) * u32(e + 4);
        if (size > 4) { const off = u32(e + 8); if (off + size <= b.length) b.fill(0, off, off + size); }
      }
      b.fill(0, at + 2, Math.min(b.length, at + 2 + m * 12));
      w16(at, 0);
    }
    // Unlink: the entry becomes a harmless empty one (tag 0x0000 is skipped by readers is not safe, so drop it).
    const e0 = gps;
    const last = ifd0 + 2 + (n - 1) * 12;
    b.copyWithin(e0, e0 + 12, last + 12);
    b.fill(0, last, last + 12);
    w16(ifd0, n - 1);
    // The next-IFD pointer followed the last entry; keep it right after the shorter list.
    const next = last + 12;
    if (next + 4 <= b.length) { b.copyWithin(last, next, next + 4); b.fill(0, next, next + 4); }
  }
  return b;
}

/** Does this EXIF say where the photo was taken? */
export function hasLocation(tiff: Uint8Array | undefined): boolean {
  if (!tiff || tiff.length < 8) return false;
  const le = tiff[0] === 0x49;
  const u16 = (p: number) => (le ? tiff[p] | (tiff[p + 1] << 8) : (tiff[p] << 8) | tiff[p + 1]);
  const u32 = (p: number) => (le ? (tiff[p] | (tiff[p + 1] << 8) | (tiff[p + 2] << 16) | (tiff[p + 3] << 24)) >>> 0 : ((tiff[p] << 24) | (tiff[p + 1] << 16) | (tiff[p + 2] << 8) | tiff[p + 3]) >>> 0);
  const ifd0 = u32(4);
  if (ifd0 + 2 > tiff.length) return false;
  for (let i = 0, n = u16(ifd0); i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > tiff.length) return false;
    if (u16(e) === 0x8825) { const at = u32(e + 8); return at + 2 <= tiff.length && u16(at) > 0; }
  }
  return false;
}

// ---------------------------------------------------------------- PNG chunks

let CRC: Uint32Array | null = null;
export function crc32(b: Uint8Array): number {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  }
  let x = 0xffffffff;
  for (let i = 0; i < b.length; i++) x = CRC[(x ^ b[i]) & 255] ^ (x >>> 8);
  return (x ^ 0xffffffff) >>> 0;
}

/** A PNG with an eXIf chunk added right after IHDR (sharp then carries it to any format with keepExif). */
export function pngWithExif(png: Uint8Array, tiff: Uint8Array): Uint8Array {
  if (png.length < 33 || png[12] !== 0x49 || png[13] !== 0x48) return png;
  const body = new Uint8Array(4 + tiff.length);
  body.set([0x65, 0x58, 0x49, 0x66]);
  body.set(tiff, 4);
  const chunk = new Uint8Array(12 + tiff.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, tiff.length);
  chunk.set(body, 4);
  dv.setUint32(8 + tiff.length, crc32(body));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, 33));
  out.set(chunk, 33);
  out.set(png.subarray(33), 33 + chunk.length);
  return out;
}

// ---------------------------------------------------------------- BMP

/** A BMP file: 32-bit with see-through (BITMAPV4 header, which every app reads) or 24-bit. */
export function writeBmp(rgba: Uint8Array, width: number, height: number, alpha: boolean): Uint8Array {
  const bpp = alpha ? 4 : 3;
  const stride = Math.ceil((width * bpp) / 4) * 4;
  const header = alpha ? 108 : 40;
  const off = 14 + header;
  const size = off + stride * height;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  dv.setUint32(2, size, true);
  dv.setUint32(10, off, true);
  dv.setUint32(14, header, true);
  dv.setInt32(18, width, true);
  dv.setInt32(22, height, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, bpp * 8, true);
  dv.setUint32(30, alpha ? 3 : 0, true);
  dv.setUint32(34, stride * height, true);
  dv.setInt32(38, 2835, true);
  dv.setInt32(42, 2835, true);
  if (alpha) {
    dv.setUint32(54, 0x00ff0000, true);
    dv.setUint32(58, 0x0000ff00, true);
    dv.setUint32(62, 0x000000ff, true);
    dv.setUint32(66, 0xff000000, true);
    dv.setUint32(70, 0x73524742, true); // 'sRGB'
  }
  for (let y = 0; y < height; y++) {
    const row = off + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = row + x * bpp;
      out[d] = rgba[s + 2]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s];
      if (alpha) out[d + 3] = rgba[s + 3];
    }
  }
  return out;
}

/** Reads uncompressed (and bit-field) BMPs at 1, 4, 8, 16, 24 and 32 bits, and 8-bit run-length ones, as RGBA. */
export function readBmp(b: Uint8Array): { data: Uint8Array; width: number; height: number } {
  if (b[0] !== 0x42 || b[1] !== 0x4d) throw new Error('Not a BMP picture');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const off = dv.getUint32(10, true);
  const hsize = dv.getUint32(14, true);
  const width = hsize === 12 ? dv.getUint16(18, true) : dv.getInt32(18, true);
  const rawH = hsize === 12 ? dv.getInt16(20, true) : dv.getInt32(22, true);
  const bpp = dv.getUint16(hsize === 12 ? 24 : 28, true);
  const comp = hsize >= 40 ? dv.getUint32(30, true) : 0;
  const height = Math.abs(rawH);
  const topDown = rawH < 0;
  if (width <= 0 || height <= 0 || width * height > 400e6) throw new Error('This BMP picture has an impossible size');
  let colours = hsize >= 40 ? dv.getUint32(46, true) : 0;
  if (!colours && bpp <= 8) colours = 1 << bpp;
  const palAt = 14 + hsize;
  const pal = (i: number) => { const p = palAt + i * (hsize === 12 ? 3 : 4); return [b[p + 2] ?? 0, b[p + 1] ?? 0, b[p] ?? 0]; };
  let masks = [0x00ff0000, 0x0000ff00, 0x000000ff, 0];
  if (comp === 3 || comp === 6) {
    const m = hsize >= 52 ? 54 : 14 + hsize;
    masks = [dv.getUint32(m, true), dv.getUint32(m + 4, true), dv.getUint32(m + 8, true), comp === 6 || hsize >= 56 ? dv.getUint32(m + 12, true) : 0];
  } else if (bpp === 16) masks = [0x7c00, 0x03e0, 0x001f, 0];
  else if (bpp === 32) masks = [0x00ff0000, 0x0000ff00, 0x000000ff, hsize >= 56 ? dv.getUint32(66, true) : 0];
  const field = (v: number, m: number) => { if (!m) return -1; let s = 0; while (!((m >>> s) & 1)) s++; const max = m >>> s; return Math.round((((v & m) >>> s) / max) * 255); };
  const data = new Uint8Array(width * height * 4);
  const put = (x: number, y: number, r: number, g: number, bl: number, a = 255) => { const yy = topDown ? y : height - 1 - y; const d = (yy * width + x) * 4; data[d] = r; data[d + 1] = g; data[d + 2] = bl; data[d + 3] = a; };
  if (comp === 1 && bpp === 8) {
    // RLE8
    let p = off; let x = 0; let y = 0;
    while (p < b.length - 1 && y < height) {
      const n = b[p++]; const v = b[p++];
      if (n) { const c = pal(v); for (let i = 0; i < n && x < width; i++) put(x++, y, c[0], c[1], c[2]); }
      else if (v === 0) { x = 0; y++; } else if (v === 1) break; else if (v === 2) { x += b[p++]; y += b[p++]; }
      else { for (let i = 0; i < v; i++) { const c = pal(b[p++]); if (x < width) put(x++, y, c[0], c[1], c[2]); } if (v & 1) p++; }
    }
    return { data, width, height };
  }
  if (comp !== 0 && comp !== 3 && comp !== 6) throw new Error('This BMP picture is compressed in a way Keeper does not read');
  const stride = Math.ceil((width * bpp) / 32) * 4;
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = off + y * stride;
    for (let x = 0; x < width; x++) {
      if (bpp === 24) { const s = row + x * 3; put(x, y, b[s + 2], b[s + 1], b[s]); }
      else if (bpp === 32 || bpp === 16) {
        const v = bpp === 32 ? dv.getUint32(row + x * 4, true) : dv.getUint16(row + x * 2, true);
        const a = field(v, masks[3]);
        if (a >= 0 && a < 255) anyAlpha = true;
        put(x, y, field(v, masks[0]), field(v, masks[1]), field(v, masks[2]), a < 0 ? 255 : a);
      } else {
        const bit = x * bpp;
        const byte = b[row + (bit >> 3)];
        const i = bpp === 8 ? byte : bpp === 4 ? (byte >> (4 - (bit & 7))) & 15 : (byte >> (7 - (bit & 7))) & 1;
        const c = pal(i);
        put(x, y, c[0], c[1], c[2]);
      }
    }
  }
  // Many 32-bit BMPs leave the fourth byte at zero: that is not a see-through picture.
  if (bpp === 32 && masks[3] && !anyAlpha) { let zero = true; for (let i = 3; i < data.length; i += 4) if (data[i]) { zero = false; break; } if (zero) for (let i = 3; i < data.length; i += 4) data[i] = 255; }
  return { data, width, height };
}

// ---------------------------------------------------------------- RAW

/** The orientation stored in a RAW file's own EXIF (embedded previews carry none), as quarter turns clockwise and a flip. */
export function orientationTurns(o: number | undefined): { turns: 0 | 1 | 2 | 3; flip: boolean } {
  switch (o) {
    case 2: return { turns: 0, flip: true };
    case 3: return { turns: 2, flip: false };
    case 4: return { turns: 2, flip: true };
    case 5: return { turns: 1, flip: true };
    case 6: return { turns: 1, flip: false };
    case 7: return { turns: 3, flip: true };
    case 8: return { turns: 3, flip: false };
    default: return { turns: 0, flip: false };
  }
}
