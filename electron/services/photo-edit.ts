// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The photo editor's renderer: a recipe (core/photo-edit.ts) applied with sharp
// and Keeper's own pixel code (core/photo-pixels.ts), on a picture opened by
// photo-open.ts (which reads everything Convert reads), and saved in any of the
// formats in core/photo-formats.ts. Edits are never baked into the only copy:
// the first save over a picture keeps the original in <userData>/photo-originals,
// and the recipe beside it, so the editor reopens with the same sliders and
// Revert brings the original back.

import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { PhotoApi, PhotoInfo, RecentPicture } from '../../core/api-photo';
import { onnxRuntimeReady } from '../../core/component-paths';
import { freeName } from '../../core/convert';
import { chooseModel, type CutoutModelId } from '../../core/cutout-models';
import { writeIco } from '../../core/filekit/binfmt';
import {
  autoAdjust, contrastLinear, copyName, defaultRecipe, describeRecipe, exposureFactor, extendPixels, keystoneQuad, normalizeRecipe, outputFormat, outputSize, replaceKeepsName, saturationFactor,
  straightenBox, temperatureMatrix, toPixels, type PhotoRecipe,
} from '../../core/photo-edit';
import { canSave, cleanExif, EDITABLE, exifTiff, extensionFor, formatInfo, hasLocation, openedNote, pngWithExif, SAVE_FORMATS, writeBmp, type SaveFormat } from '../../core/photo-formats';
import { drawOverlays } from '../../core/photo-overlay';
import {
  alphaLevels, applyColour, blendByWeight, compose, copyDisc, coverBox, gradient, grain, healSpot, hexRgb, mixDetail, paintStrokes, pictureStats, redEye, shadowFor, shiftMask, toneLut, vignette, warpQuad,
} from '../../core/photo-pixels';
import { cleanLooks, lookFrom } from '../../core/photo-presets';
import { isInside } from '../../core/safety';
import { getConverter } from '../ipc/convert';
import { featureOn } from './features';
import { openPicture, type Opened } from './photo-open';

type Sharp = typeof import('sharp').default;
type SharpInst = import('sharp').Sharp;
interface Record_ { original: string; recipe: PhotoRecipe; savedAt: number; mtime: number; sha?: string }
/** A picture in memory: interleaved 8-bit channels. */
interface Img { data: Buffer; w: number; h: number; ch: 3 | 4 }

const PREVIEW = 1600;
const store = () => path.join(app.getPath('userData'), 'photo-originals');
const indexFile = () => path.join(store(), 'index.json');
const looksFile = () => path.join(app.getPath('userData'), 'photo-looks.json');
const recentFile = () => path.join(app.getPath('userData'), 'photo-recent.json');
let index: Record<string, Record_> | null = null;
let roots: () => Promise<string[]> = async () => [];
let progress: (f: number, phase: string, task: string) => void = () => undefined;

async function loadIndex(): Promise<Record<string, Record_>> {
  if (index) return index;
  try { index = JSON.parse(await fsp.readFile(indexFile(), 'utf8')) as Record<string, Record_>; } catch { index = {}; }
  return index;
}
async function saveIndex() {
  await fsp.mkdir(store(), { recursive: true });
  await fsp.writeFile(indexFile(), JSON.stringify(index ?? {}));
}
const sha256 = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Only pictures in places Keeper may change (the library's folders, Pictures, Downloads, the screenshot folder). */
async function checked(p: string): Promise<string> {
  const abs = path.resolve(String(p ?? ''));
  if (!EDITABLE.test(abs)) throw new Error('The photo editor opens pictures (JPEG, PNG, HEIC, RAW and more).');
  const st = await fsp.stat(abs).catch(() => null);
  if (!st?.isFile()) throw new Error('That picture is not there any more.');
  if (!(await roots()).some((r) => isInside(abs, r))) throw new Error('Keeper edits pictures in your library’s folders, Pictures and Downloads.');
  return abs;
}

/**
 * The record of an earlier save, if the file is still what Keeper wrote: the
 * same modified time, or (on drives that round times, such as memory cards and
 * shared folders) the same bytes.
 */
async function recordOf(p: string): Promise<Record_ | undefined> {
  const rec = (await loadIndex())[p];
  if (!rec || !existsSync(rec.original)) return undefined;
  const st = await fsp.stat(p).catch(() => null);
  if (!st) return undefined;
  if (Math.abs(st.mtimeMs - rec.mtime) <= 2) return rec;
  if (rec.sha && st.size < 512 * 1024 * 1024 && sha256(await fsp.readFile(p)) === rec.sha) return rec;
  return undefined;
}

// ---------------------------------------------------------------- opening

async function sharpOf(): Promise<{ S: Sharp; conv: Awaited<ReturnType<typeof getConverter>> }> {
  const conv = await getConverter();
  return { S: conv.sharpLib(), conv };
}
/** The system's own decoder (Windows imaging codecs, through the shell's thumbnails at full size). */
const systemDecode = async (file: string) => {
  const { nativeImage } = await import('electron');
  try {
    const img = await nativeImage.createThumbnailFromPath(file, { width: 8192, height: 8192 });
    if (!img.isEmpty()) return img.toPNG();
  } catch { /* the system cannot read it either */ }
  return null;
};

const sources = new Map<string, { at: number; o: Opened }>();

/** The picture to start from: the kept original after an earlier save, else the file itself; scaled for previews. */
async function source(p: string, maxSide: number, allFrames: boolean): Promise<{ o: Opened; from: string; key: string }> {
  const rec = await recordOf(p);
  const from = rec?.original ?? p;
  const stamp = rec?.mtime ?? (await fsp.stat(from)).mtimeMs;
  const key = `${from}|${stamp}`;
  const k = `${key}|${maxSide}|${allFrames}`;
  const hit = sources.get(k);
  if (hit) { hit.at = Date.now(); return { o: hit.o, from, key }; }
  const { S } = await sharpOf();
  const o = await openPicture(from, { sharp: S, maxSide, allFrames, systemDecode });
  // The preview and the full size of the picture being edited, at most.
  sources.set(k, { at: Date.now(), o });
  while (sources.size > 3) sources.delete([...sources.entries()].sort((a, b) => a[1].at - b[1].at)[0][0]);
  return { o, from, key };
}

// ---------------------------------------------------------------- the cut-out's mask

const masks = new Map<string, { at: number; alpha: Buffer; w: number; h: number }>();

/** The subject's mask for a source picture, fitted to its edges, at the preview's size (worked out once per picture and model). */
async function maskFor(p: string, want: 'fast' | 'best'): Promise<{ alpha: Buffer; w: number; h: number }> {
  if (!featureOn('convert')) throw new Error('Removing the background needs Convert, which is switched off.');
  const { S, conv } = await sharpOf();
  const model = chooseModel(want, conv.modelReady('best'));
  const pv = await source(p, PREVIEW, false);
  const k = `${pv.key}|${model}`;
  const hit = masks.get(k);
  if (hit) { hit.at = Date.now(); return hit; }
  const png = await S(pv.o.data, { raw: { width: pv.o.width, height: pv.o.height, channels: 4 } }).removeAlpha().png({ compressionLevel: 1 }).toBuffer();
  const m = await conv.cutoutModel(png, model, (f, ph) => progress(f, ph, 'photo-cutout'));
  const refined = await conv.refineMask(png, m.mask, m.size, Math.max(pv.o.width, pv.o.height));
  const out = { at: Date.now(), alpha: refined.alpha, w: refined.width, h: refined.height };
  masks.set(k, out);
  while (masks.size > 4) masks.delete([...masks.entries()].sort((a, b) => a[1].at - b[1].at)[0][0]);
  progress(1, 'Done', 'photo-cutout');
  return out;
}

// ---------------------------------------------------------------- rendering

const fromImg = (S: Sharp, x: Img) => S(x.data, { raw: { width: x.w, height: x.h, channels: x.ch } });
async function toImg(s: SharpInst): Promise<Img> {
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels as 3 | 4 };
}

interface RenderOpts {
  /** preview scale (the picture is smaller than the original by this factor); 1 for saving */
  scale: number;
  /** a mask for the cut-out at this frame's size */
  mask?: Buffer;
}

/** One frame through the recipe. RGBA in; RGB or RGBA out (alpha only when something is see-through). */
async function renderFrame(S: Sharp, src: Img, r: PhotoRecipe, o: RenderOpts): Promise<Img & { alpha: boolean }> {
  let cur: Img = { ...src, data: Buffer.from(src.data) };
  const hadAlpha = (() => { for (let i = 3; i < cur.data.length; i += 4) if (cur.data[i] < 255) return true; return false; })();
  if (o.mask) for (let i = 0, j = 3; i < o.mask.length; i++, j += 4) cur.data[j] = Math.round((cur.data[j] * o.mask[i]) / 255);
  // Turn and flip.
  if (r.turns || r.flip) {
    let s = fromImg(S, cur);
    if (r.turns) s = s.rotate(r.turns * 90);
    if (r.flip) s = s.flop();
    cur = await toImg(s);
  }
  // Perspective: the leaning part stretched to fill the picture again.
  if (r.perspectiveV || r.perspectiveH) cur = { ...cur, data: Buffer.from(warpQuad(cur.data, cur.ch, cur.w, cur.h, keystoneQuad(cur.w, cur.h, r.perspectiveV, r.perspectiveH))) };
  // Straighten: turn a little, keep the largest upright part with no empty corners.
  if (r.straighten) {
    const box = straightenBox(cur.w, cur.h, r.straighten);
    const turned = await toImg(fromImg(S, cur).rotate(r.straighten, { background: { r: 0, g: 0, b: 0, alpha: 0 } }));
    const left = Math.max(0, Math.floor((turned.w - box.width) / 2));
    const top = Math.max(0, Math.floor((turned.h - box.height) / 2));
    cur = await toImg(fromImg(S, turned).extract({ left, top, width: Math.min(box.width, turned.w - left), height: Math.min(box.height, turned.h - top) }));
  }
  if (r.crop) cur = await toImg(fromImg(S, cur).extract(toPixels(r.crop, cur.w, cur.h)));
  const W = cur.w;
  const H = cur.h;
  const short = Math.min(W, H);
  // Colour and alpha apart: light and colour change the colour channels only.
  const alphaCh = (await toImg(fromImg(S, cur).extractChannel(3))).data;
  let rgbS = fromImg(S, cur).removeAlpha();
  if (r.exposure || r.saturation) rgbS = rgbS.modulate({ brightness: exposureFactor(r.exposure), saturation: saturationFactor(r.saturation) });
  if (r.contrast) { const c = contrastLinear(r.contrast); rgbS = rgbS.linear(c.a, c.b); }
  if (r.temperature || r.tint) rgbS = rgbS.recomb(temperatureMatrix(r.temperature, r.tint));
  let rgb = await toImg(rgbS);
  applyColour(rgb.data, 3, { lut: toneLut(r), vibrance: r.vibrance, hsl: r.hsl });
  // Clarity: local contrast against a wide blur; noise: a gentle median, mixed in; sharpen: an unsharp mask.
  if (r.clarity) { const b = await toImg(fromImg(S, rgb).blur(Math.max(1, short / 70))); mixDetail(rgb.data, b.data, 3, (r.clarity / 100) * 0.7); }
  if (r.noise) {
    const size = Math.max(3, Math.min(9, Math.round((short / 1000) * (r.noise / 40)) | 1));
    const den = await toImg(fromImg(S, rgb).median(size).blur(Math.max(0.4, (short / 2000) * (r.noise / 100))));
    const k = Math.min(1, r.noise / 70);
    for (let i = 0; i < rgb.data.length; i++) rgb.data[i] = Math.round(rgb.data[i] * (1 - k) + den.data[i] * k);
  }
  if (r.sharpen) rgb = await toImg(fromImg(S, rgb).sharpen({ sigma: Math.max(0.5, short / 2400), m1: 0.4, m2: (r.sharpen / 100) * 3 }));
  vignette(rgb.data, 3, W, H, r.vignette);
  grain(rgb.data, 3, W, H, r.grain);
  // Retouching: healed, cloned and red-eye spots.
  for (const s of r.retouch) {
    const cx = s.x * W, cy = s.y * H, rad = s.r * short;
    if (s.kind === 'heal') healSpot(rgb.data, 3, W, H, cx, cy, rad);
    else if (s.kind === 'clone') copyDisc(rgb.data, 3, W, H, cx, cy, (s.sx ?? s.x) * W, (s.sy ?? s.y) * H, rad);
    else redEye(rgb.data, 3, W, H, cx, cy, rad);
  }
  // Hidden areas: blurred, pixelated or covered; sizes follow the picture, so the preview matches the result.
  if (r.redact.length) {
    const pieces = await Promise.all(r.redact.map(async (z) => {
      const px = toPixels(z, W, H);
      const part = fromImg(S, rgb).extract(px);
      let input: Buffer;
      if (z.kind === 'box') input = await S({ create: { width: px.width, height: px.height, channels: 3, background: { r: 20, g: 20, b: 24 } } }).png().toBuffer();
      else if (z.kind === 'pixelate') {
        const block = Math.max(4, Math.round(short / 60));
        const small = await part.resize(Math.max(1, Math.round(px.width / block)), Math.max(1, Math.round(px.height / block)), { kernel: 'nearest' }).png().toBuffer();
        input = await S(small).resize(px.width, px.height, { kernel: 'nearest', fit: 'fill' }).png().toBuffer();
      } else input = await part.blur(Math.max(3, short / 40)).png().toBuffer();
      return { input, left: px.left, top: px.top };
    }));
    rgb = await toImg(fromImg(S, rgb).composite(pieces).removeAlpha());
  }
  let alpha: Buffer | null = hadAlpha || o.mask ? Buffer.from(alphaCh) : null;
  // The cut-out's edge: the refine brush, grown or shrunk, softened.
  if (o.mask && alpha) {
    paintStrokes(alpha, W, H, r.strokes);
    alphaLevels(alpha, r.edge);
    if (r.feather) alpha = (await toImg(S(alpha, { raw: { width: W, height: H, channels: 1 } }).blur(Math.max(0.3, (r.feather / 100) * short * 0.012)).extractChannel(0))).data;
    // A new background behind the subject, with its shadow.
    if (r.background.kind !== 'clear') {
      const bg = await backgroundFor(S, r, rgb, alpha, W, H);
      let shadow: { mask: Uint8Array; opacity: number } | undefined;
      if (r.background.shadow) {
        const sh = shadowFor(W, H, r.background.shadow);
        const moved = shiftMask(alpha, W, H, sh.dx, sh.dy);
        const soft = (await toImg(S(Buffer.from(moved), { raw: { width: W, height: H, channels: 1 } }).blur(sh.sigma).extractChannel(0))).data;
        shadow = { mask: soft, opacity: sh.opacity };
      }
      rgb = { data: Buffer.from(compose(rgb.data, alpha, bg, shadow)), w: W, h: H, ch: 3 };
      alpha = null;
    }
  }
  let out: Img = alpha ? await toImg(fromImg(S, rgb).joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } })) : rgb;
  // Size: an exact size or a longest side, worked out on the original's scale.
  const want = outputSize(Math.round(W / o.scale), Math.round(H / o.scale), r);
  const tw = Math.max(1, Math.round(want.w * o.scale)), th = Math.max(1, Math.round(want.h * o.scale));
  if (tw !== W || th !== H) out = await toImg(fromImg(S, out).resize(tw, th, { fit: 'fill' }));
  // More canvas around it.
  const ex = extendPixels(out.w, out.h, r.extend);
  if (ex.top || ex.right || ex.bottom || ex.left) {
    const clear = r.extend.colour === 'clear';
    if (clear && out.ch === 3) out = await toImg(fromImg(S, out).ensureAlpha());
    const [cr, cg, cb] = clear ? [0, 0, 0] : hexRgb(r.extend.colour);
    out = await toImg(fromImg(S, out).extend({ ...ex, background: { r: cr, g: cg, b: cb, alpha: clear ? 0 : 1 } }));
  }
  return { ...out, alpha: out.ch === 4 };
}

/** The new background, W × H, 3 channels. */
async function backgroundFor(S: Sharp, r: PhotoRecipe, rgb: Img, alpha: Buffer, W: number, H: number): Promise<Uint8Array> {
  const b = r.background;
  if (b.kind === 'colour') { const [cr, cg, cb] = hexRgb(b.colour); const out = new Uint8Array(W * H * 3); for (let i = 0; i < W * H; i++) { out[i * 3] = cr; out[i * 3 + 1] = cg; out[i * 3 + 2] = cb; } return out; }
  if (b.kind === 'gradient') return gradient(W, H, b.colour, b.colour2, b.angle);
  if (b.kind === 'blur') {
    // The original background, blurred, without the subject bleeding into it.
    const sigma = Math.max(1, (b.blur / 100) * Math.min(W, H) * 0.05);
    const weight = Buffer.alloc(W * H);
    for (let i = 0; i < W * H; i++) weight[i] = 255 - alpha[i];
    const weighted = await toImg(fromImg(S, rgb).joinChannel(weight, { raw: { width: W, height: H, channels: 1 } }).blur(sigma));
    const plain = await toImg(fromImg(S, rgb).blur(sigma * 1.5));
    return blendByWeight(weighted.data, plain.data);
  }
  if (b.kind === 'picture' && b.picture) {
    const pic = path.resolve(b.picture);
    if (!EDITABLE.test(pic) || !existsSync(pic)) throw new Error('The background picture is not there any more.');
    const o = await openPicture(pic, { sharp: S, maxSide: Math.max(W, H) * 2, systemDecode });
    const box = coverBox(o.width, o.height, W, H);
    return (await toImg(S(o.data, { raw: { width: o.width, height: o.height, channels: 4 } }).extract(box).resize(W, H, { fit: 'fill' }).flatten({ background: '#ffffff' }))).data;
  }
  return new Uint8Array(W * H * 3).fill(255);
}

/** The recipe on every frame of a picture (a moving one has several). */
async function render(p: string, r: PhotoRecipe, o: { preview?: number; before?: boolean }): Promise<{ frames: (Img & { alpha: boolean })[]; delay?: number[]; loop?: number; src: Opened }> {
  const { S } = await sharpOf();
  const animated = !o.preview && r.frames === 'all' && formatInfo(outputFormat(r, path.extname(p))).frames;
  const { o: src } = await source(p, o.preview ?? 0, animated);
  const recipe = o.before ? { ...defaultRecipe(), turns: r.turns, flip: r.flip, straighten: r.straighten, perspectiveV: r.perspectiveV, perspectiveH: r.perspectiveH, crop: r.crop, width: r.width, height: r.height, maxSide: r.maxSide, extend: r.extend } : r;
  let mask: Buffer | undefined;
  if (recipe.cutout && !src.frames) {
    const m = await maskFor(p, recipe.cutoutQuality);
    mask = m.w === src.width && m.h === src.height ? m.alpha : (await toImg(S(m.alpha, { raw: { width: m.w, height: m.h, channels: 1 } }).resize(src.width, src.height, { fit: 'fill', kernel: 'cubic' }).extractChannel(0))).data;
  }
  const opts: RenderOpts = { scale: src.width / (src.fullWidth || src.width), mask };
  const n = src.frames?.count ?? 1;
  const size = src.width * src.height * 4;
  const frames: (Img & { alpha: boolean })[] = [];
  for (let i = 0; i < n; i++) frames.push(await renderFrame(S, { data: src.data.subarray(i * size, (i + 1) * size), w: src.width, h: src.height, ch: 4 }, recipe, opts));
  return { frames, delay: src.frames?.delay, loop: src.frames?.loop, src };
}

// ---------------------------------------------------------------- things added on top

/** The added layer at full size, drawn by Chromium in a hidden window (the same drawing as the editor's preview). */
async function overlayLayer(r: PhotoRecipe, W: number, H: number): Promise<Buffer | null> {
  if (!r.overlays.length) return null;
  const win = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, partition: `keeper-photo-${Date.now()}` } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,<meta charset="utf-8"><body style="margin:0">');
    const js = `(() => { const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H}; const ctx = c.getContext('2d'); (${drawOverlays.toString()})(ctx, ${JSON.stringify(r.overlays)}, ${W}, ${H}); return c.toDataURL('image/png'); })()`;
    const url = (await win.webContents.executeJavaScript(js)) as string;
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  } finally {
    win.destroy();
  }
}

// ---------------------------------------------------------------- saving

function sips(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const c = spawn('/usr/bin/sips', args, { stdio: 'ignore' });
    c.on('error', () => resolve(1));
    c.on('close', (code) => resolve(code ?? 1));
  });
}

/** Encodes finished frames in a format, keeping the colour profile and details as asked. */
async function encode(S: Sharp, frames: Img[], fmt: SaveFormat, r: PhotoRecipe, src: Opened, anim?: { delay?: number[]; loop?: number }): Promise<Buffer> {
  const info = formatInfo(fmt);
  const first = frames[0];
  const q = r.quality || (fmt === 'avif' ? 60 : fmt === 'webp' ? 88 : 90);
  if (fmt === 'bmp') return Buffer.from(writeBmp(first.ch === 4 ? first.data : (await toImg(fromImg(S, first).ensureAlpha())).data, first.w, first.h, first.ch === 4));
  if (fmt === 'ico') {
    const png = await fromImg(S, first).png().toBuffer();
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    return writeIco(await Promise.all(sizes.map(async (size) => ({ size, png: await S(png).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer() }))));
  }
  if (fmt === 'pdf') {
    const doc = await PDFDocument.create();
    const jpg = await fromImg(S, first).flatten({ background: '#ffffff' }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
    const img = await doc.embedJpg(jpg);
    const page = doc.addPage([first.w * 0.75, first.h * 0.75]);
    page.drawImage(img, { x: 0, y: 0, width: first.w * 0.75, height: first.h * 0.75 });
    return Buffer.from(await doc.save());
  }
  if (frames.length > 1 && info.frames) {
    const pngs = await Promise.all(frames.map(async (x) => fromImg(S, x).ensureAlpha().png({ compressionLevel: 0 }).toBuffer()));
    const joined = S(pngs, { join: { animated: true } });
    const delay = anim?.delay?.slice(0, frames.length);
    return fmt === 'gif' ? joined.gif({ delay, loop: anim?.loop ?? 0 }).toBuffer() : joined.webp({ quality: q, delay, loop: anim?.loop ?? 0 }).toBuffer();
  }
  // The photo's details travel inside a PNG carrier, so sharp writes them to any format.
  let s: SharpInst = fromImg(S, first);
  const tiff = info.metadata && r.metadata !== 'strip' ? exifTiff(src.exif) : undefined;
  if (tiff) {
    const carrier = await fromImg(S, first).png({ compressionLevel: 0 }).toBuffer();
    s = S(Buffer.from(pngWithExif(carrier, cleanExif(tiff, { noLocation: r.metadata === 'no-location' })))).keepExif();
  }
  let iccTmp: string | undefined;
  if (info.profile && fmt !== 'heic') {
    if (r.profile === 'keep' && src.icc?.length) {
      iccTmp = path.join(os.tmpdir(), `keeper-icc-${process.pid}-${Date.now()}.icc`);
      await fsp.writeFile(iccTmp, src.icc);
      s = s.withIccProfile(iccTmp);
    } else s = s.withIccProfile('srgb');
  }
  try {
    switch (fmt) {
      case 'jpeg': return await s.flatten({ background: '#ffffff' }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
      case 'png': return await s.png({ compressionLevel: 8 }).toBuffer();
      case 'webp': return await s.webp({ quality: q }).toBuffer();
      case 'avif': return await s.avif({ quality: q }).toBuffer();
      case 'tiff': return await s.tiff({ compression: 'lzw' }).toBuffer();
      case 'gif': return await s.gif().toBuffer();
      case 'heic': {
        if (process.platform !== 'darwin') throw new Error(canSave('heic', process.platform).why);
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-heic-'));
        try {
          const inp = path.join(dir, 'in.png');
          const outp = path.join(dir, 'out.heic');
          await s.flatten({ background: '#ffffff' }).png({ compressionLevel: 1 }).toFile(inp);
          if ((await sips(['-s', 'format', 'heic', '-s', 'formatOptions', String(q), inp, '--out', outp])) !== 0 || !existsSync(outp)) throw new Error('This Mac could not save HEIC.');
          return await fsp.readFile(outp);
        } finally {
          await fsp.rm(dir, { recursive: true, force: true });
        }
      }
    }
  } finally {
    if (iccTmp) await fsp.rm(iccTmp, { force: true });
  }
  throw new Error('Keeper cannot save this format.');
}

/** Renders at full size, adds the things on top, and encodes. */
async function produce(p: string, r: PhotoRecipe, fmt: SaveFormat): Promise<Buffer> {
  const { S } = await sharpOf();
  const out = await render(p, r, {});
  let frames: Img[] = out.frames;
  const layer = await overlayLayer(r, frames[0].w, frames[0].h);
  if (layer) frames = await Promise.all(frames.map(async (f) => { const x = await toImg(fromImg(S, f).ensureAlpha().composite([{ input: layer }])); return f.ch === 3 ? toImg(fromImg(S, x).removeAlpha()) : x; }));
  return encode(S, frames, fmt, r, out.src, { delay: out.delay, loop: out.loop });
}

// ---------------------------------------------------------------- recent pictures

async function readJson<T>(f: string, d: T): Promise<T> {
  try { return JSON.parse(await fsp.readFile(f, 'utf8')) as T; } catch { return d; }
}
async function remember(p: string) {
  const list = (await readJson<RecentPicture[]>(recentFile(), [])).filter((x) => x && x.path !== p);
  list.unshift({ path: p, name: path.basename(p), at: Date.now() });
  await fsp.mkdir(path.dirname(recentFile()), { recursive: true });
  await fsp.writeFile(recentFile(), JSON.stringify(list.slice(0, 24)));
}

// ---------------------------------------------------------------- the API

async function info(p0: string): Promise<PhotoInfo> {
  const p = await checked(p0);
  const rec = await recordOf(p);
  const { conv } = await sharpOf();
  const { o } = await source(p, PREVIEW, false);
  const st = await fsp.stat(p);
  void remember(p).catch(() => undefined);
  let frames: number | undefined;
  if (/\.(gif|webp|png|apng)$/i.test(p)) {
    try { const m = await conv.sharpLib()(rec?.original ?? p).metadata(); if ((m.pages ?? 1) > 1) frames = m.pages; } catch { /* one frame */ }
  }
  const recipe = rec ? normalizeRecipe(rec.recipe) : undefined;
  return {
    path: p, name: path.basename(p), width: o.fullWidth, height: o.fullHeight, size: st.size,
    edited: rec && recipe ? { recipe, savedAt: rec.savedAt, summary: describeRecipe(recipe) } : undefined,
    cutout: featureOn('convert') ? (onnxRuntimeReady() ? 'ready' : 'download') : 'off',
    models: { fast: conv.modelReady('fast'), best: conv.modelReady('best') },
    via: o.via,
    note: openedNote(o.via),
    frames,
    alpha: o.alpha,
    hasLocation: hasLocation(exifTiff(o.exif)),
    formats: SAVE_FORMATS.map((f) => ({ id: f.id, ...canSave(f.id, process.platform) })),
  };
}

export const photoApi: PhotoApi = {
  info,
  async preview(p0, recipe, o) {
    const p = await checked(p0);
    const r = normalizeRecipe(recipe);
    const { S } = await sharpOf();
    const out = (await render(p, r, { preview: PREVIEW, before: o?.before })).frames[0];
    const buf = out.alpha ? await fromImg(S, out).png({ compressionLevel: 3 }).toBuffer() : await fromImg(S, out).jpeg({ quality: 85 }).toBuffer();
    return { url: `data:image/${out.alpha ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`, width: out.w, height: out.h };
  },
  async save(p0, recipe, mode) {
    const p = await checked(p0);
    const r = normalizeRecipe(recipe);
    const ext = path.extname(p);
    const { o } = await source(p, PREVIEW, false);
    const fmt = outputFormat(r, ext, o.alpha, process.platform);
    const why = canSave(fmt, process.platform);
    if (!why.ok) throw new Error(why.why);
    const asCopy = mode === 'copy' || !replaceKeepsName(r, ext, o.alpha, process.platform);
    if (!asCopy && JSON.stringify(r) === JSON.stringify(normalizeRecipe(defaultRecipe()))) return photoApi.revert(p);
    progress(0.2, 'Saving', 'photo-save');
    try {
      const out = await produce(p, r, fmt);
      if (asCopy) {
        const dest = freeName(path.dirname(p), copyName(path.basename(p), fmt).replace(/\.[^.]+$/, ''), extensionFor(fmt));
        await fsp.writeFile(dest, out);
        return { path: dest, copy: true };
      }
      // Over the original: the original is kept first (once), so Revert can bring it back.
      const idx = await loadIndex();
      let rec = await recordOf(p);
      if (!rec) {
        await fsp.mkdir(store(), { recursive: true });
        const kept = path.join(store(), `${sha256(Buffer.from(`${p}|${Date.now()}`)).slice(0, 24)}${ext}`);
        await fsp.copyFile(p, kept);
        rec = { original: kept, recipe: r, savedAt: Date.now(), mtime: 0 };
      }
      const tmp = `${p}.keeper-edit`;
      await fsp.writeFile(tmp, out);
      await fsp.rename(tmp, p);
      const st = await fsp.stat(p);
      idx[p] = { ...rec, recipe: r, savedAt: Date.now(), mtime: st.mtimeMs, sha: sha256(out) };
      await saveIndex();
      sources.clear();
      return { path: p, copy: false };
    } finally {
      progress(1, 'Done', 'photo-save');
    }
  },
  async revert(p0) {
    const p = await checked(p0);
    const idx = await loadIndex();
    const rec = await recordOf(p);
    if (rec) {
      const tmp = `${p}.keeper-edit`;
      await fsp.copyFile(rec.original, tmp);
      await fsp.rename(tmp, p);
      await fsp.rm(rec.original, { force: true });
    }
    delete idx[p];
    await saveIndex();
    sources.clear();
    return { path: p, copy: false };
  },
  async auto(p0, recipe) {
    const p = await checked(p0);
    const r = normalizeRecipe(recipe);
    // Measured on the framing only, so earlier light and colour changes do not count twice.
    const plain = { ...defaultRecipe(), turns: r.turns, flip: r.flip, straighten: r.straighten, crop: r.crop };
    const out = (await render(p, plain, { preview: PREVIEW })).frames[0];
    return autoAdjust(pictureStats(out.data, out.ch));
  },
  async looks() {
    return cleanLooks(await readJson(looksFile(), []));
  },
  async saveLook(name, recipe) {
    const look = lookFrom(normalizeRecipe(recipe), String(name ?? ''));
    const list = cleanLooks(await readJson(looksFile(), [])).filter((l) => l.id !== look.id);
    list.push(look);
    await fsp.writeFile(looksFile(), JSON.stringify(list));
    return list;
  },
  async deleteLook(id) {
    const list = cleanLooks(await readJson(looksFile(), [])).filter((l) => l.id !== id);
    await fsp.writeFile(looksFile(), JSON.stringify(list));
    return list;
  },
  async downloadModel(id: CutoutModelId) {
    if (id !== 'fast' && id !== 'best') throw new Error('Unknown model');
    const { conv } = await sharpOf();
    await conv.downloadModel(id, (f, ph) => progress(f, ph, 'photo-model'));
    masks.clear();
  },
  async removeModel(id: CutoutModelId) {
    if (id !== 'fast' && id !== 'best') throw new Error('Unknown model');
    const { conv } = await sharpOf();
    await conv.removeModel(id);
    masks.clear();
  },
  async recent() {
    const list = await readJson<RecentPicture[]>(recentFile(), []);
    return list.filter((x) => x && typeof x.path === 'string' && existsSync(x.path) && EDITABLE.test(x.path)).slice(0, 12);
  },
};

export function initPhotoEditor(d: { roots: () => Promise<string[]>; progress?: (f: number, phase: string, task: string) => void }) {
  roots = d.roots;
  if (d.progress) progress = d.progress;
}
