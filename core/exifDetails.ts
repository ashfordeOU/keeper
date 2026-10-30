// SPDX-License-Identifier: AGPL-3.0-or-later
// Full photo details from EXIF (JPEG APP1 or a bare TIFF/RAW header): camera,
// lens, exposure, ISO, focal length, date, orientation and GPS position.

export interface ExifDetails {
  make?: string;
  model?: string;
  lens?: string;
  software?: string;
  taken?: string;
  exposure?: string;
  fNumber?: number;
  iso?: number;
  focalLength?: number;
  focal35?: number;
  flash?: boolean;
  orientation?: number;
  width?: number;
  height?: number;
  gps?: { lat: number; lon: number; alt?: number };
}

/** Finds the TIFF header: inside a JPEG APP1 "Exif" segment, or at the start of TIFF-based files. */
export function tiffStart(b: Uint8Array): number {
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 4 < b.length && b[i] === 0xff) {
      const marker = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) return i + 10;
      if (marker === 0xda) break;
      i += 2 + len;
    }
    return -1;
  }
  if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) return 0;
  // HEIC/CR3 and others keep an "Exif\0\0" block somewhere near the start.
  for (let i = 0; i < Math.min(b.length - 10, 512 * 1024); i++) {
    if (b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66 && b[i + 4] === 0 && b[i + 5] === 0 && (b[i + 6] === 0x49 || b[i + 6] === 0x4d)) return i + 6;
  }
  return -1;
}

export function readExifDetails(b: Uint8Array): ExifDetails | undefined {
  const start = tiffStart(b);
  if (start < 0 || start + 8 > b.length) return undefined;
  const le = b[start] === 0x49;
  const at = (o: number) => start + o;
  const u16 = (o: number) => (le ? b[at(o)] | (b[at(o) + 1] << 8) : (b[at(o)] << 8) | b[at(o) + 1]);
  const u32 = (o: number) => (le ? (b[at(o)] | (b[at(o) + 1] << 8) | (b[at(o) + 2] << 16) | (b[at(o) + 3] << 24)) >>> 0 : ((b[at(o)] << 24) | (b[at(o) + 1] << 16) | (b[at(o) + 2] << 8) | b[at(o) + 3]) >>> 0);
  const s32 = (o: number) => u32(o) | 0;
  const inRange = (o: number, n: number) => at(o) >= 0 && at(o) + n <= b.length;
  const out: ExifDetails = {};
  const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  const read = (entry: number): { type: number; count: number; off: number } => {
    const type = u16(entry + 2);
    const count = u32(entry + 4);
    const size = (SIZES[type] ?? 1) * count;
    return { type, count, off: size > 4 ? u32(entry + 8) : entry + 8 };
  };
  const str = (off: number, count: number) => (inRange(off, count) ? new TextDecoder('latin1').decode(b.subarray(at(off), at(off) + count)).replace(/\0[\s\S]*$/, '').trim() : undefined);
  const rational = (off: number, signed = false) => {
    if (!inRange(off, 8)) return NaN;
    const n = signed ? s32(off) : u32(off);
    const d = signed ? s32(off + 4) : u32(off + 4);
    return d ? n / d : NaN;
  };
  const num = (e: { type: number; off: number }) => (e.type === 3 ? u16(e.off) : e.type === 4 ? u32(e.off) : e.type === 5 ? rational(e.off) : e.type === 10 ? rational(e.off, true) : NaN);

  const ifd = (off: number, kind: 'main' | 'exif' | 'gps', depth = 0) => {
    if (depth > 3 || !inRange(off, 2)) return;
    const n = u16(off);
    if (n > 500) return;
    const gps: number[][] = [];
    const ref: Record<number, string> = {};
    for (let k = 0; k < n; k++) {
      const entry = off + 2 + k * 12;
      if (!inRange(entry, 12)) return;
      const tag = u16(entry);
      const e = read(entry);
      if (kind === 'gps') {
        if (tag === 1 || tag === 3) ref[tag] = str(e.off, e.count) ?? '';
        else if (tag === 2 || tag === 4) gps[tag] = [0, 1, 2].map((i) => rational(e.off + i * 8));
        else if (tag === 6) out.gps = { ...(out.gps ?? { lat: 0, lon: 0 }), alt: rational(e.off) };
        continue;
      }
      switch (tag) {
        case 0x010f: out.make = str(e.off, e.count); break;
        case 0x0110: out.model = str(e.off, e.count); break;
        case 0x0112: out.orientation = u16(e.off); break;
        case 0x0131: out.software = str(e.off, e.count); break;
        case 0x0132: out.taken ??= str(e.off, e.count); break;
        case 0x9003: out.taken = str(e.off, e.count); break;
        case 0x829a: {
          const v = rational(e.off);
          if (v > 0) out.exposure = v >= 1 ? `${Math.round(v * 10) / 10} s` : `1/${Math.round(1 / v)} s`;
          break;
        }
        case 0x829d: out.fNumber = Math.round(rational(e.off) * 10) / 10; break;
        case 0x8827: out.iso = u16(e.off); break;
        case 0x920a: out.focalLength = Math.round(rational(e.off) * 10) / 10; break;
        case 0xa405: out.focal35 = u16(e.off); break;
        case 0x9209: out.flash = (u16(e.off) & 1) === 1; break;
        case 0xa434: out.lens = str(e.off, e.count); break;
        case 0xa002: out.width = num(e); break;
        case 0xa003: out.height = num(e); break;
        case 0x8769: ifd(u32(entry + 8), 'exif', depth + 1); break;
        case 0x8825: ifd(u32(entry + 8), 'gps', depth + 1); break;
      }
    }
    if (kind === 'gps' && gps[2] && gps[4]) {
      const dms = (v: number[]) => v[0] + v[1] / 60 + v[2] / 3600;
      const lat = dms(gps[2]) * (ref[1] === 'S' ? -1 : 1);
      const lon = dms(gps[4]) * (ref[3] === 'W' ? -1 : 1);
      if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) out.gps = { ...out.gps, lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
    }
  };
  try {
    ifd(u32(4), 'main');
  } catch {
    return undefined;
  }
  if (out.gps && !out.gps.lat && !out.gps.lon) delete out.gps;
  return Object.keys(out).length ? out : undefined;
}
