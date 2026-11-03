// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The light photo editor's renderer: a recipe (core/photo-edit.ts) applied with
// sharp, through Convert's converter (which also opens HEIC and other formats
// and has the on-device cut-out model). Edits are never baked into the only
// copy: the first save over a picture keeps the original in
// <userData>/photo-originals, and the recipe beside it, so the editor reopens
// with the same sliders and Revert brings the original back.

import { app } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import type { PhotoInfo, PhotoApi } from '../../core/api-photo';
import { onnxRuntimeReady } from '../../core/component-paths';
import { freeName } from '../../core/convert';
import {
  contrastLinear, copyName, describeRecipe, EDITABLE, exposureFactor, extensionFor, fitSide, isUnchanged, normalizeRecipe, outputFormat, replaceKeepsName, saturationFactor,
  straightenBox, temperatureMatrix, toPixels, type PhotoRecipe,
} from '../../core/photo-edit';
import { isInside } from '../../core/safety';
import { getConverter } from '../ipc/convert';
import { featureOn } from './features';

type Sharp = typeof import('sharp').default;
interface Raw { data: Buffer; info: { width: number; height: number; channels: number } }
interface Record_ { original: string; recipe: PhotoRecipe; savedAt: number; mtime: number }

const store = () => path.join(app.getPath('userData'), 'photo-originals');
const indexFile = () => path.join(store(), 'index.json');
let index: Record<string, Record_> | null = null;
let roots: () => Promise<string[]> = async () => [];

async function loadIndex(): Promise<Record<string, Record_>> {
  if (index) return index;
  try { index = JSON.parse(await fsp.readFile(indexFile(), 'utf8')) as Record<string, Record_>; } catch { index = {}; }
  return index;
}
async function saveIndex() {
  await fsp.mkdir(store(), { recursive: true });
  await fsp.writeFile(indexFile(), JSON.stringify(index ?? {}));
}

/** Only pictures in places Keeper may change (the library's folders, Pictures, Downloads, the screenshot folder). */
async function checked(p: string): Promise<string> {
  const abs = path.resolve(String(p ?? ''));
  if (!EDITABLE.test(abs)) throw new Error('The photo editor opens pictures (JPEG, PNG, WebP, HEIC and more).');
  const st = await fsp.stat(abs).catch(() => null);
  if (!st?.isFile()) throw new Error('That picture is not there any more.');
  if (!(await roots()).some((r) => isInside(abs, r))) throw new Error('Keeper edits pictures in your library’s folders, Pictures and Downloads.');
  return abs;
}

/** The record of an earlier save, if the file is still what Keeper wrote. */
async function recordOf(p: string): Promise<Record_ | undefined> {
  const rec = (await loadIndex())[p];
  if (!rec) return undefined;
  const st = await fsp.stat(p).catch(() => null);
  if (!st || Math.abs(st.mtimeMs - rec.mtime) > 2 || !existsSync(rec.original)) return undefined;
  return rec;
}

// ---------------------------------------------------------------- rendering

const sources = new Map<string, { at: number; raw: Raw }>();

async function sharpOf(): Promise<{ S: Sharp; conv: Awaited<ReturnType<typeof getConverter>> }> {
  const conv = await getConverter();
  return { S: conv.sharpLib(), conv };
}

/** The picture to start from: the kept original after an earlier save, else the file itself; scaled for previews. */
async function source(p: string, maxSide?: number): Promise<Raw> {
  const rec = await recordOf(p);
  const from = rec?.original ?? p;
  const key = `${from}|${maxSide ?? 0}|${rec?.mtime ?? (await fsp.stat(from)).mtimeMs}`;
  const hit = sources.get(key);
  if (hit) return hit.raw;
  const { S, conv } = await sharpOf();
  let img = await conv.image(from);
  if (maxSide) img = S(await img.toBuffer()).resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true });
  const raw = (await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true })) as Raw;
  // Two pictures at most: the preview and the full size of the one being edited.
  sources.set(key, { at: Date.now(), raw });
  while (sources.size > 2) sources.delete([...sources.entries()].sort((a, b) => a[1].at - b[1].at)[0][0]);
  return raw;
}

async function render(p: string, r: PhotoRecipe, o: { preview?: number }): Promise<{ data: Buffer; width: number; height: number; alpha: boolean }> {
  const { S, conv } = await sharpOf();
  const from = (x: Raw) => S(x.data, { raw: { width: x.info.width, height: x.info.height, channels: x.info.channels as 4 } });
  const raw = (s: import('sharp').Sharp) => s.raw().toBuffer({ resolveWithObject: true }) as Promise<Raw>;
  let cur = await source(p, o.preview);
  // Turn and flip.
  if (r.turns || r.flip) {
    let s = from(cur);
    if (r.turns) s = s.rotate(r.turns * 90);
    if (r.flip) s = s.flop();
    cur = await raw(s);
  }
  // Straighten: turn a little, keep the largest upright part with no empty corners.
  if (r.straighten) {
    const box = straightenBox(cur.info.width, cur.info.height, r.straighten);
    const turned = await raw(from(cur).rotate(r.straighten, { background: { r: 0, g: 0, b: 0, alpha: 0 } }));
    const left = Math.max(0, Math.floor((turned.info.width - box.width) / 2));
    const top = Math.max(0, Math.floor((turned.info.height - box.height) / 2));
    cur = await raw(from(turned).extract({ left, top, width: Math.min(box.width, turned.info.width - left), height: Math.min(box.height, turned.info.height - top) }));
  }
  if (r.crop) cur = await raw(from(cur).extract(toPixels(r.crop, cur.info.width, cur.info.height)));
  // Light and colour, on the colour channels only (the see-through channel stays as it is).
  const W = cur.info.width;
  const H = cur.info.height;
  const alpha = await raw(from(cur).extractChannel(3));
  const hasAlpha = alpha.data.some((v) => v < 255);
  let rgb = from(cur).removeAlpha();
  if (r.exposure || r.saturation) rgb = rgb.modulate({ brightness: exposureFactor(r.exposure), saturation: saturationFactor(r.saturation) });
  if (r.contrast) { const c = contrastLinear(r.contrast); rgb = rgb.linear(c.a, c.b); }
  if (r.temperature) rgb = rgb.recomb(temperatureMatrix(r.temperature));
  let col = await raw(rgb);
  // Hidden areas: blurred, pixelated or covered; sizes follow the picture, so the preview matches the result.
  if (r.redact.length) {
    const short = Math.min(W, H);
    const pieces = await Promise.all(r.redact.map(async (z) => {
      const px = toPixels(z, W, H);
      const part = S(col.data, { raw: { width: W, height: H, channels: 3 } }).extract(px);
      let input: Buffer;
      if (z.kind === 'box') input = await S({ create: { width: px.width, height: px.height, channels: 3, background: { r: 20, g: 20, b: 24 } } }).png().toBuffer();
      else if (z.kind === 'pixelate') {
        const block = Math.max(4, Math.round(short / 60));
        const small = await part.resize(Math.max(1, Math.round(px.width / block)), Math.max(1, Math.round(px.height / block)), { kernel: 'nearest' }).png().toBuffer();
        input = await S(small).resize(px.width, px.height, { kernel: 'nearest', fit: 'fill' }).png().toBuffer();
      } else input = await part.blur(Math.max(3, short / 40)).png().toBuffer();
      return { input, left: px.left, top: px.top };
    }));
    // Composing adds a see-through channel; the colour picture stays three channels.
    col = await raw(S(col.data, { raw: { width: W, height: H, channels: 3 } }).composite(pieces).removeAlpha());
  }
  let a = hasAlpha ? alpha.data : null;
  // The subject cut out, on this computer.
  if (r.cutout) {
    if (!featureOn('convert')) throw new Error('Removing the background needs Convert, which is switched off.');
    const png = await S(col.data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    a = (await conv.cutoutMask(png)).alpha;
  }
  const outRaw = a ? await raw(S(col.data, { raw: { width: W, height: H, channels: 3 } }).joinChannel(a, { raw: { width: W, height: H, channels: 1 } })) : col;
  return { data: outRaw.data, width: W, height: H, alpha: !!a };
}

async function encode(x: { data: Buffer; width: number; height: number; alpha: boolean }, format: 'jpeg' | 'png' | 'webp', maxSide = 0, quality = 90): Promise<Buffer> {
  const { S } = await sharpOf();
  const size = fitSide(x.width, x.height, maxSide);
  let s = S(x.data, { raw: { width: x.width, height: x.height, channels: x.alpha ? 4 : 3 } });
  if (size.w !== x.width) s = s.resize(size.w, size.h);
  if (format === 'jpeg') return s.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
  if (format === 'webp') return s.webp({ quality }).toBuffer();
  return s.png({ compressionLevel: 8 }).toBuffer();
}

// ---------------------------------------------------------------- the API

async function info(p0: string): Promise<PhotoInfo> {
  const p = await checked(p0);
  const rec = await recordOf(p);
  const { conv } = await sharpOf();
  const meta = await (await conv.image(rec?.original ?? p)).metadata().catch(() => ({ width: 0, height: 0, format: '' }));
  const st = await fsp.stat(p);
  return {
    path: p, name: path.basename(p), width: meta.width ?? 0, height: meta.height ?? 0, size: st.size,
    edited: rec ? { recipe: rec.recipe, savedAt: rec.savedAt, summary: describeRecipe(rec.recipe) } : undefined,
    cutout: featureOn('convert') ? (onnxRuntimeReady() ? 'ready' : 'download') : 'off',
  };
}

export const photoApi: PhotoApi = {
  info,
  async preview(p0, recipe) {
    const p = await checked(p0);
    const r = normalizeRecipe(recipe);
    const out = await render(p, r, { preview: 1600 });
    const buf = await encode(out, out.alpha ? 'png' : 'jpeg', 0, 85);
    return { url: `data:image/${out.alpha ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`, width: out.width, height: out.height };
  },
  async save(p0, recipe, mode) {
    const p = await checked(p0);
    const r = normalizeRecipe(recipe);
    const ext = path.extname(p);
    const fmt = outputFormat(r, ext);
    const asCopy = mode === 'copy' || !replaceKeepsName(r, ext);
    if (!asCopy && isUnchanged(r)) return photoApi.revert(p);
    const out = await encode(await render(p, r, {}), fmt, r.maxSide);
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
      const kept = path.join(store(), `${createHash('sha256').update(`${p}|${Date.now()}`).digest('hex').slice(0, 24)}${ext}`);
      await fsp.copyFile(p, kept);
      rec = { original: kept, recipe: r, savedAt: Date.now(), mtime: 0 };
    }
    const tmp = `${p}.keeper-edit`;
    await fsp.writeFile(tmp, out);
    await fsp.rename(tmp, p);
    const st = await fsp.stat(p);
    idx[p] = { ...rec, recipe: r, savedAt: Date.now(), mtime: st.mtimeMs };
    await saveIndex();
    sources.clear();
    return { path: p, copy: false };
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
};

export function initPhotoEditor(d: { roots: () => Promise<string[]> }) {
  roots = d.roots;
}
