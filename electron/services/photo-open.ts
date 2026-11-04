// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Opens any picture as upright 8-bit RGBA: sharp for the common formats, the
// system's own decoder where there is one (sips on macOS, the Windows imaging
// codecs through the shell), and plain-JavaScript readers for the rest (HEIC,
// camera RAW previews, Photoshop's flattened picture, icons, BMP, JPEG XL).
// Used by the photo editor and by Convert, so both open the same pictures.
// No Electron here: the system decoder is passed in.

import { spawn } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readExifDetails } from '../../core/exifDetails';
import { readIco, readIcns } from '../../core/filekit/binfmt';
import { openRoutes, orientationTurns, readBmp } from '../../core/photo-formats';
import { largestJpeg } from '../../core/raw';
import { decodeHeif } from './heif-decode';

type Sharp = typeof import('sharp').default;

export interface Opened {
  /** RGBA, 8 bits, upright; frames stacked top to bottom when there are several */
  data: Buffer;
  width: number;
  /** of one frame */
  height: number;
  /** how it was opened: sharp, system, embedded (a RAW file's preview), heif, psd, ico, icns, bmp, jxl, svg */
  via: string;
  /** a see-through channel that is used */
  alpha: boolean;
  /** the full size before any scaling for a preview */
  fullWidth: number;
  fullHeight: number;
  frames?: { count: number; delay: number[]; loop: number };
  /** the original's colour profile and EXIF, for saving them again */
  icc?: Buffer;
  exif?: Buffer;
}

export interface OpenOptions {
  sharp: Sharp;
  /** longest side for a preview (0: full size) */
  maxSide?: number;
  /** every frame of a moving picture, not just the first */
  allFrames?: boolean;
  /** the system's decoder (Windows imaging codecs through the shell); PNG bytes or null */
  systemDecode?: (file: string) => Promise<Buffer | null>;
  platform?: string;
}

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' });
    c.on('error', () => resolve(1));
    c.on('close', (code) => resolve(code ?? 1));
  });
}

/** ag-psd's reader; it makes ImageData objects, which a main process has no canvas for, so plain ones are made. */
export async function psdReader(): Promise<typeof import('ag-psd').readPsd> {
  const ag = await import('ag-psd');
  ag.initializeCanvas(() => { throw new Error('No canvas here'); }, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' }) as ImageData);
  return ag.readPsd;
}

/** A source sharp can read: a path, encoded bytes, or raw RGBA. */
type Src = { file: string } | { bytes: Buffer } | { raw: Buffer; width: number; height: number };

export async function openPicture(file: string, o: OpenOptions): Promise<Opened> {
  const S = o.sharp;
  const platform = o.platform ?? process.platform;
  const ext = path.extname(file).slice(1).toLowerCase();
  const errors: string[] = [];
  for (const route of openRoutes(file, platform)) {
    try {
      const got = await decodeWith(route, file, ext, o, platform);
      if (got) return await finish(S, got.src, got.via, o, got.turns, got.meta);
    } catch (e) {
      errors.push(`${route}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const name = path.basename(file);
  if (ext === 'heic' || ext === 'heif') throw new Error(`${name} could not be opened: this HEIC photo uses a kind this computer cannot read.`);
  throw new Error(`${name} is in a format this computer cannot open.`);
}

async function decodeWith(route: ReturnType<typeof openRoutes>[number], file: string, ext: string, o: OpenOptions, platform: string): Promise<{ src: Src; via: string; turns?: ReturnType<typeof orientationTurns>; meta?: { icc?: Buffer; exif?: Buffer } } | null> {
  const S = o.sharp;
  switch (route) {
    case 'sharp': {
      const svg = ext === 'svg' || ext === 'svgz';
      if (svg) {
        // Drawings have no pixels: draw them about 2,400 pixels across (or the preview's size).
        const m = await S(file).metadata();
        const long = Math.max(m.width ?? 512, m.height ?? 512);
        const density = Math.max(18, Math.min(1200, (72 * (o.maxSide || 2400)) / long));
        return { src: { bytes: await S(file, { density }).png().toBuffer() }, via: 'svg' };
      }
      // Decoding for real (a header alone is not enough: some HEIC files have one sharp reads but pixels it cannot).
      const m = await S(file, { failOn: 'none' }).metadata();
      if (!m.width) throw new Error('unreadable');
      if (m.format === 'heif' && m.compression === 'hevc') await S(file, { failOn: 'none' }).resize(4, 4).raw().toBuffer();
      return { src: { file }, via: 'sharp' };
    }
    case 'system': {
      if (platform === 'darwin') {
        const tmp = path.join(os.tmpdir(), `keeper-open-${process.pid}-${Date.now()}.png`);
        try {
          if ((await run('/usr/bin/sips', ['-s', 'format', 'png', file, '--out', tmp])) === 0 && existsSync(tmp)) return { src: { bytes: await fsp.readFile(tmp) }, via: 'system' };
        } finally {
          await fsp.rm(tmp, { force: true });
        }
        return null;
      }
      const png = await o.systemDecode?.(file);
      if (!png) return null;
      // A shell thumbnail can be a small preview: for RAW files, only a full-size picture counts.
      if (/^(cr2|cr3|crw|nef|nrw|arw|srf|sr2|dng|orf|rw2|raf|pef|srw|x3f|3fr|erf|kdc|mrw|mos|iiq|rwl|raw)$/.test(ext)) {
        const m = await S(png).metadata();
        if (Math.max(m.width ?? 0, m.height ?? 0) < 1600) return null;
      }
      return { src: { bytes: png }, via: 'system' };
    }
    case 'embedded': {
      const st = await fsp.stat(file);
      if (st.size > 400 * 1024 * 1024) throw new Error('too big');
      const b = new Uint8Array(await fsp.readFile(file));
      const jpeg = largestJpeg(b);
      if (!jpeg) throw new Error('No picture was found inside this RAW file');
      const bytes = Buffer.from(jpeg);
      const own = (await S(bytes).metadata()).orientation;
      // Embedded previews usually carry no orientation of their own; the RAW file's EXIF says how to turn them.
      const turns = own && own > 1 ? undefined : orientationTurns(readExifDetails(b.subarray(0, 2 * 1024 * 1024))?.orientation);
      return { src: { bytes }, via: 'embedded', turns, meta: { exif: (await S(bytes).metadata()).exif } };
    }
    case 'heif': {
      const d = await decodeHeif(new Uint8Array(await fsp.readFile(file)));
      if (!d) throw new Error('The built-in HEIC reader could not read it');
      let meta: { icc?: Buffer; exif?: Buffer } | undefined;
      try { const m = await S(file).metadata(); meta = { icc: m.icc, exif: m.exif }; } catch { /* header unreadable too */ }
      return { src: { raw: Buffer.from(d.data.buffer, d.data.byteOffset, d.data.byteLength), width: d.width, height: d.height }, via: 'heif', meta };
    }
    case 'psd': {
      const psd = (await psdReader())(await fsp.readFile(file), { useImageData: true, skipLayerImageData: true, skipThumbnail: true });
      const img = psd.imageData;
      if (!img) throw new Error('This Photoshop file has no flattened picture saved in it (saving it with “Maximize compatibility” adds one)');
      return { src: { raw: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), width: img.width, height: img.height }, via: 'psd' };
    }
    case 'ico': {
      const r = readIco(await fsp.readFile(file));
      return { src: r.png ? { bytes: r.png } : { raw: r.rgba!.data, width: r.rgba!.width, height: r.rgba!.height }, via: 'ico' };
    }
    case 'icns': return { src: { bytes: readIcns(await fsp.readFile(file)) }, via: 'icns' };
    case 'bmp': {
      const r = readBmp(new Uint8Array(await fsp.readFile(file)));
      return { src: { raw: Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength), width: r.width, height: r.height }, via: 'bmp' };
    }
    case 'jxl': {
      const b = await fsp.readFile(file);
      const { default: decode } = (await import('@jsquash/jxl/decode')) as unknown as { default: (b: ArrayBuffer) => Promise<{ data: Uint8ClampedArray; width: number; height: number }> };
      const img = await decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      return { src: { raw: Buffer.from(img.data.buffer), width: img.width, height: img.height }, via: 'jxl' };
    }
  }
  return null;
}

async function finish(S: Sharp, src: Src, via: string, o: OpenOptions, turns?: ReturnType<typeof orientationTurns>, meta?: { icc?: Buffer; exif?: Buffer }): Promise<Opened> {
  const base = () => ('file' in src ? S(src.file, { failOn: 'none', ...(o.allFrames ? { animated: true } : {}) }) : 'bytes' in src ? S(src.bytes, { failOn: 'none' }) : S(src.raw, { raw: { width: src.width, height: src.height, channels: 4 } }));
  const m = await base().metadata();
  const pages = o.allFrames && 'file' in src ? Math.min(m.pages ?? 1, 300) : 1;
  const fullW = m.autoOrient?.width ?? m.width ?? 0;
  const fullH = (m.autoOrient?.height ?? m.height ?? 0) / (o.allFrames && 'file' in src ? Math.max(1, m.pages ?? 1) : 1);
  const icc = meta?.icc ?? m.icc;
  const exif = meta?.exif ?? m.exif;
  const alphaSrc = !!m.hasAlpha || 'raw' in src;
  if (pages > 1) {
    // A moving picture: every frame, each upright and scaled on its own.
    const full = await S((src as { file: string }).file, { animated: true, failOn: 'none' }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = full.info.width, H = m.pageHeight ?? Math.round(full.info.height / pages);
    const k = o.maxSide && Math.max(W, H) > o.maxSide ? o.maxSide / Math.max(W, H) : 1;
    const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
    const frames: Buffer[] = [];
    for (let i = 0; i < pages; i++) {
      const f = full.data.subarray(i * W * H * 4, (i + 1) * W * H * 4);
      frames.push(k === 1 ? Buffer.from(f) : await S(f, { raw: { width: W, height: H, channels: 4 } }).resize(w, h, { fit: 'fill' }).raw().toBuffer());
    }
    const delay = Array.from({ length: pages }, (_, i) => (Array.isArray(m.delay) ? m.delay[i] ?? m.delay[m.delay.length - 1] : 100) || 100);
    return { data: Buffer.concat(frames), width: w, height: h, via, alpha: true, fullWidth: W, fullHeight: H, frames: { count: pages, delay, loop: m.loop ?? 0 }, icc, exif };
  }
  let s = base().rotate();
  if (turns && (turns.turns || turns.flip)) { if (turns.turns) s = S(await s.toBuffer()).rotate(turns.turns * 90); if (turns.flip) s = s.flop(); }
  const fw = turns && turns.turns % 2 ? fullH : fullW;
  const fh = turns && turns.turns % 2 ? fullW : fullH;
  if (o.maxSide && Math.max(fw, fh) > o.maxSide) s = s.resize(o.maxSide, o.maxSide, { fit: 'inside', withoutEnlargement: true });
  const out = await s.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let alpha = false;
  if (alphaSrc) for (let i = 3; i < out.data.length; i += 4) if (out.data[i] < 255) { alpha = true; break; }
  return { data: out.data, width: out.info.width, height: out.info.height, via, alpha, fullWidth: fw || out.info.width, fullHeight: fh || out.info.height, icc, exif };
}
