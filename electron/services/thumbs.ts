// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Thumbnails for every kind of file, cached on disk (keyed by path, size and
// modification time) and trimmed oldest-first when the cache grows too big.

import { app, nativeImage } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { extOf } from '../../core/classify';
import { readId3, readMp4Tags } from '../../core/id3';
import { settings } from '../store';
import { displayImage, grant, videoFrame, zipEntry } from './preview';

const VIDEO = /^(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpg|mpeg|3gp|mts|m2ts|ts|vob|ogv|divx|asf|f4v)$/;
const AUDIO = /^(mp3|m4a|m4b|aac|flac|ogg|opus|wav|aiff|aif|wma|alac)$/;
const DECODE = /^(heic|heif|hif|avif|cr2|cr3|crw|nef|nrw|arw|srf|sr2|dng|orf|rw2|raf|pef|srw|x3f|3fr|erf|kdc|mrw|mos|iiq|rwl|raw|psd|psb|tif|tiff|svg|svgz|jxl|jp2|j2k|tga|exr|hdr|dds|qoi|pcx|icns|webp|gif)$/;
const OFFICE = /^(docx|docm|dotx|xlsx|xlsm|pptx|pptm|ppsx|odt|ods|odp|ott|pages|key|numbers|epub|sketch|xd|3mf|kmz|cbz)$/;
/** Text, code and documents the viewer draws as a page; only their cached picture is read here. */
const DRAWN = /^(txt|md|markdown|csv|tsv|json|jsonl|log|srt|vtt|rtf|html?|xml|ya?ml|toml|ini|py|js|mjs|cjs|ts|tsx|jsx|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|rb|php|sh|bash|zsh|ps1|sql|css|scss|vue|svelte|lua|r|dart|ipynb|eml|vcf|ics|ttf|otf|woff2?|stl|obj|glb|gltf|ply|fbx)$/;

let writes = 0;
const dir = () => path.join(app.getPath('userData'), 'thumbs');

async function keyFor(p: string, size: number): Promise<string | null> {
  try {
    const st = await fsp.stat(p);
    return createHash('sha1').update(`${p}|${st.size}|${st.mtimeMs}|${size}`).digest('hex');
  } catch {
    return null;
  }
}

async function fromCache(key: string): Promise<string | null> {
  for (const ext of ['jpg', 'png']) {
    const f = path.join(dir(), key.slice(0, 2), `${key}.${ext}`);
    try {
      const b = await fsp.readFile(f);
      // Touch, so the trim keeps recently used thumbnails.
      const now = new Date();
      void fsp.utimes(f, now, now).catch(() => undefined);
      return `data:image/${ext === 'jpg' ? 'jpeg' : 'png'};base64,${b.toString('base64')}`;
    } catch {
      /* not cached */
    }
  }
  return null;
}

async function toCache(key: string, img: Electron.NativeImage, size: number): Promise<string> {
  const { width, height } = img.getSize();
  const scale = Math.min(1, size / Math.max(width, height));
  const small = scale < 1 ? img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }) : img;
  // Keep transparency for icons and drawings; photos are smaller as JPEG.
  const bmp = small.toBitmap();
  let alpha = false;
  for (let i = 3; i < bmp.length; i += 4 * 7) if (bmp[i] < 250) { alpha = true; break; }
  const data = alpha ? small.toPNG() : small.toJPEG(82);
  const ext = alpha ? 'png' : 'jpg';
  const sub = path.join(dir(), key.slice(0, 2));
  await fsp.mkdir(sub, { recursive: true });
  await fsp.writeFile(path.join(sub, `${key}.${ext}`), data);
  if (++writes % 50 === 0) void trim();
  return `data:image/${alpha ? 'png' : 'jpeg'};base64,${data.toString('base64')}`;
}

/** Deletes the least recently used thumbnails until the cache fits its limit. */
export async function trim(limitMb = (settings() as { thumbCacheMb?: number }).thumbCacheMb ?? 500): Promise<number> {
  const files: { f: string; size: number; t: number }[] = [];
  let total = 0;
  for (const sub of await fsp.readdir(dir()).catch(() => [] as string[])) {
    for (const n of await fsp.readdir(path.join(dir(), sub)).catch(() => [] as string[])) {
      const f = path.join(dir(), sub, n);
      const st = await fsp.stat(f).catch(() => null);
      if (!st) continue;
      files.push({ f, size: st.size, t: st.mtimeMs });
      total += st.size;
    }
  }
  const limit = limitMb * 1024 * 1024;
  let removed = 0;
  files.sort((a, b) => a.t - b.t);
  for (const x of files) {
    if (total <= limit) break;
    await fsp.unlink(x.f).catch(() => undefined);
    total -= x.size;
    removed++;
  }
  return removed;
}

export async function clearThumbs() {
  await fsp.rm(dir(), { recursive: true, force: true });
}

/** Cover art, document thumbnails, video frames and decoded images. Null when nothing better than an icon exists. */
export async function richThumbnail(p: string, size: number): Promise<string | null> {
  const ext = extOf(path.basename(p));
  if (DRAWN.test(ext)) return cachedThumb(p, size);
  if (!VIDEO.test(ext) && !AUDIO.test(ext) && !DECODE.test(ext) && !OFFICE.test(ext) && ext !== 'pdf' && ext !== 'app') return null;
  const key = await keyFor(p, size);
  if (!key) return null;
  const hit = await fromCache(key);
  if (hit) return hit;
  grant(p);
  let img: Electron.NativeImage | null = null;
  try {
    if (VIDEO.test(ext)) {
      const f = await videoFrame(p, 'auto', Math.max(size, 320));
      if (f) img = nativeImage.createFromPath(f);
    } else if (AUDIO.test(ext)) {
      const fh = await fsp.open(p, 'r');
      try {
        const buf = Buffer.alloc(4 * 1024 * 1024);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        const b = new Uint8Array(buf.buffer, 0, bytesRead);
        const tags = readId3(b) ?? readMp4Tags(b);
        if (tags?.cover) img = nativeImage.createFromBuffer(Buffer.from(tags.cover.data));
      } finally {
        await fh.close();
      }
    } else if (OFFICE.test(ext)) {
      img = await documentThumb(p, ext);
    } else if (DECODE.test(ext)) {
      const d = await displayImage(p, Math.max(size * 2, 512));
      if (d) img = nativeImage.createFromPath(d.path);
    }
    if ((!img || img.isEmpty()) && process.platform !== 'linux') {
      // Quick Look and the Windows shell render PDFs, Office files and more.
      img = await nativeImage.createThumbnailFromPath(p, { width: size, height: size }).catch(() => null);
    }
  } catch {
    img = null;
  }
  if (!img || img.isEmpty()) return null;
  return toCache(key, img, size);
}

async function documentThumb(p: string, ext: string): Promise<Electron.NativeImage | null> {
  const image = (b: Buffer | undefined) => (b ? nativeImage.createFromBuffer(b) : null);
  if (ext === 'epub') {
    const opf = await zipEntry(p, (n) => n.toLowerCase().endsWith('.opf'));
    if (opf) {
      const xml = opf.data.toString('utf8');
      const coverId = xml.match(/<meta[^>]+name=["']cover["'][^>]+content=["']([^"']+)/i)?.[1] ?? xml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']cover["']/i)?.[1];
      const href = (coverId && xml.match(new RegExp(`<item[^>]+id=["']${coverId}["'][^>]+href=["']([^"']+)`, 'i'))?.[1]) ?? xml.match(/<item[^>]+properties=["'][^"']*cover-image[^"']*["'][^>]+href=["']([^"']+)/i)?.[1] ?? xml.match(/<item[^>]+href=["']([^"']+)["'][^>]+properties=["'][^"']*cover-image/i)?.[1];
      if (href) {
        const base = opf.name.includes('/') ? opf.name.slice(0, opf.name.lastIndexOf('/') + 1) : '';
        const target = decodeURIComponent(base + href).replace(/\/\.\//g, '/');
        const e = await zipEntry(p, (n) => n === target);
        if (e) return image(e.data);
      }
    }
    const any = await zipEntry(p, (n) => /cover.*\.(jpe?g|png)$/i.test(n));
    return image(any?.data);
  }
  const candidates = [/^docProps\/thumbnail\.(jpe?g|png)$/i, /^Thumbnails\/thumbnail\.png$/i, /^QuickLook\/Thumbnail\.(jpe?g|png)$/i, /^preview\.jpg$/i, /^QuickLook\/Preview\.(jpe?g|png)$/i, /^previews\/preview\.png$/i, /^Metadata\/thumbnail\.png$/i];
  for (const re of candidates) {
    const e = await zipEntry(p, (n) => re.test(n));
    if (e) {
      const img = image(e.data);
      if (img && !img.isEmpty()) return img;
    }
  }
  // Office files with images but no thumbnail: use the first picture inside.
  const media = await zipEntry(p, (n) => /^(word|ppt|xl)\/media\/[^/]+\.(png|jpe?g)$/i.test(n));
  return image(media?.data);
}

/** The interface renders PDF pages and font samples itself and hands the picture back to be cached. */
export async function storeThumb(p: string, size: number, dataUrl: string): Promise<boolean> {
  const m = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!m || m[2].length > 2_000_000) return false;
  const key = await keyFor(p, size);
  if (!key) return false;
  const img = nativeImage.createFromBuffer(Buffer.from(m[2], 'base64'));
  if (img.isEmpty()) return false;
  await toCache(key, img, size);
  return true;
}

export async function cachedThumb(p: string, size: number): Promise<string | null> {
  const key = await keyFor(p, size);
  return key && existsSync(dir()) ? fromCache(key) : null;
}
