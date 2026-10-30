// SPDX-License-Identifier: AGPL-3.0-or-later
// On-device text recognition, look-alike photo fingerprints, camera details
// and plain-text extraction. Runs in the background, newest files first,
// one at a time so the computer stays responsive.

import { app, nativeImage } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { dHash, toGray9x8 } from '../../core/duplicates';
import { cameraName, readExif } from '../../core/exif';
import type { FileIndex } from '../../core/indexer';
import type { FileEntry } from '../../core/types';

type TesseractWorker = { recognize(img: Buffer): Promise<{ data: { text: string } }>; terminate(): Promise<unknown> };

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml', 'xml', 'html', 'htm', 'rtf', 'ini', 'toml', 'tex', 'srt', 'vtt']);
const OCR_EXT = new Set(['png', 'jpg', 'jpeg', 'heic', 'heif', 'webp', 'bmp', 'tif', 'tiff', 'gif']);

let worker: Promise<TesseractWorker> | null = null;
let workerLangs = '';

async function getWorker(langs: string[]): Promise<TesseractWorker> {
  const key = langs.join('+');
  if (worker && workerLangs === key) return worker;
  if (worker) await (await worker).terminate().catch(() => undefined);
  workerLangs = key;
  worker = import('tesseract.js').then(async (t) => {
    const cachePath = path.join(app.getPath('userData'), 'tessdata');
    await fsp.mkdir(cachePath, { recursive: true });
    // The language model is downloaded once and kept on this computer; images never leave it.
    return (await t.createWorker(langs, 1, { cachePath })) as unknown as TesseractWorker;
  });
  return worker;
}

/** An image the OS can decode (HEIC included on macOS), scaled down for speed. */
export async function loadImage(p: string, max = 2000): Promise<Electron.NativeImage | null> {
  let img: Electron.NativeImage | null = null;
  try {
    if (process.platform !== 'linux') img = await nativeImage.createThumbnailFromPath(p, { width: max, height: max });
  } catch {
    img = null;
  }
  if (!img || img.isEmpty()) img = nativeImage.createFromPath(p);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const scale = Math.min(1, max / Math.max(width, height));
  return scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : img;
}

export async function ocrImage(img: Electron.NativeImage | Buffer, langs: string[]): Promise<string> {
  const w = await getWorker(langs);
  const png = Buffer.isBuffer(img) ? img : img.toPNG();
  const { data } = await w.recognize(png);
  return data.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function fingerprint(img: Electron.NativeImage): string {
  const small = img.resize({ width: 9, height: 8, quality: 'good' });
  return dHash(toGray9x8(small.toBitmap(), 9, 8));
}

export class VisionQueue {
  private queue: string[] = [];
  private running = false;
  private stopped = false;
  pending = 0;

  constructor(private index: FileIndex, private opts: () => { ocr: boolean; langs: string[] }, private onUpdate: () => void) {}

  /** Queues work for files that have not been processed at their current version. */
  schedule(files: FileEntry[]) {
    const todo = files
      .filter((f) => !f.cloudOnly && this.needsWork(f))
      // Screenshots first: they are the ones people search text in.
      .sort((a, b) => Number(!!b.screenshot) - Number(!!a.screenshot) || b.mtime - a.mtime)
      .map((f) => f.path);
    const set = new Set(this.queue);
    for (const p of todo) if (!set.has(p)) this.queue.push(p);
    this.pending = this.queue.length;
    void this.pump();
  }

  private needsWork(f: FileEntry): boolean {
    const x = this.index.extras.get(f.path);
    const fresh = x && x.mtime === f.mtime;
    if (f.kind === 'image' && OCR_EXT.has(f.ext)) return !fresh || x!.dhash === undefined || (this.opts().ocr && x!.text === undefined && f.size < 40 * 1024 * 1024);
    if (TEXT_EXT.has(f.ext) && f.size < 1024 * 1024) return !fresh || x!.text === undefined;
    return false;
  }

  stop() {
    this.stopped = true;
    void worker?.then((w) => w.terminate()).catch(() => undefined);
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    let since = 0;
    while (this.queue.length && !this.stopped) {
      const p = this.queue.shift()!;
      this.pending = this.queue.length;
      const f = this.index.files.get(p);
      if (!f) continue;
      try {
        await this.process(f);
      } catch {
        // Mark as done so a broken file is not retried forever.
        this.index.setExtra(f, { text: this.index.extras.get(p)?.text ?? '' });
      }
      if (++since % 10 === 0) this.onUpdate();
      // Yield between files so the main process stays snappy.
      await new Promise((r) => setTimeout(r, 30));
    }
    this.pending = 0;
    this.running = false;
    this.onUpdate();
    this.index.saveSoon();
  }

  private async process(f: FileEntry) {
    if (TEXT_EXT.has(f.ext)) {
      const raw = await fsp.readFile(f.path, 'utf8');
      this.index.setText(f.path, (f.ext === 'rtf' ? raw.replace(/\\[a-z]+-?\d* ?|[{}]/g, '') : f.ext === 'html' || f.ext === 'htm' ? raw.replace(/<[^>]+>/g, ' ') : raw).slice(0, 20_000));
      return;
    }
    const img = await loadImage(f.path);
    if (!img) {
      this.index.setExtra(f, { text: '', dhash: '' });
      return;
    }
    const { width, height } = img.getSize();
    const meta: FileEntry['meta'] = { ...(f.meta ?? {}) };
    if (f.ext === 'jpg' || f.ext === 'jpeg') {
      const fh = await fsp.open(f.path, 'r');
      try {
        const buf = Buffer.alloc(128 * 1024);
        await fh.read(buf, 0, buf.length, 0);
        const ex = readExif(buf);
        if (ex) {
          meta.camera = cameraName(ex);
          meta.width = ex.width ?? meta.width;
          meta.height = ex.height ?? meta.height;
        }
      } finally {
        await fh.close();
      }
    }
    if (!meta.width) {
      meta.width = width;
      meta.height = height;
    }
    this.index.setMeta(f.path, meta);
    this.index.setDhash(f.path, fingerprint(img));
    const o = this.opts();
    if (o.ocr && this.index.extras.get(f.path)?.text === undefined) {
      const text = await ocrImage(img, o.langs);
      this.index.setText(f.path, text.length > 3 ? text : '');
    }
  }
}
