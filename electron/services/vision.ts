// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// On-device text recognition, look-alike photo fingerprints, camera details
// and plain-text extraction. Runs in the background, newest files first,
// one at a time so the computer stays responsive.

import { app, nativeImage } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { dHash, toGray9x8 } from '../../core/duplicates';
import { extractPdfText } from '../../core/convert';
import { cameraName, readExif } from '../../core/exif';
import type { FileIndex } from '../../core/indexer';
import type { FileEntry } from '../../core/types';
import { pace, track } from './governor';
import { guessLatinLanguage, languagesForScript, scriptOfLanguage } from '../../core/ocr-lang';

type TesseractWorker = { recognize(img: Buffer): Promise<{ data: { text: string } }>; terminate(): Promise<unknown>; setParameters?(p: Record<string, string>): Promise<unknown> };

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

// The recognition engine and its language model take well over 100 MB; it is let
// go a minute after the last picture and started again (in about a second) when needed.
let releaseTimer: NodeJS.Timeout | undefined;
let inFlight = 0;
function releaseWorkerSoon() {
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    if (inFlight || !worker) return;
    const w = worker;
    worker = null;
    workerLangs = '';
    void w.then((x) => x.terminate()).catch(() => undefined);
  }, 60_000);
}

export async function ocrImage(img: Electron.NativeImage | Buffer, langs: string[], params?: Record<string, string>): Promise<string> {
  inFlight++;
  clearTimeout(releaseTimer);
  try {
    const w = await getWorker(langs);
    // Layout hints for this read; the defaults go back for the next caller.
    await w.setParameters?.(params ?? { tessedit_pageseg_mode: '3', preserve_interword_spaces: '0' }).catch(() => undefined);
    const png = Buffer.isBuffer(img) ? img : img.toPNG();
    const { data } = await w.recognize(png);
    return data.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  } finally {
    inFlight--;
    releaseWorkerSoon();
  }
}

/**
 * Lines of text with where they are (for numbering what is on a screen that
 * has no accessibility information). Pixels in the image given.
 */
export async function ocrLines(png: Buffer, langs: string[] = ['eng']): Promise<{ text: string; x0: number; y0: number; x1: number; y1: number; confidence: number }[]> {
  inFlight++;
  clearTimeout(releaseTimer);
  try {
    const w = (await getWorker(langs)) as unknown as { recognize(img: Buffer, o?: unknown, out?: unknown): Promise<{ data: { blocks?: { paragraphs?: { lines?: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] | null } }> };
    const { data } = await w.recognize(png, {}, { blocks: true, text: false });
    const out: { text: string; x0: number; y0: number; x1: number; y1: number; confidence: number }[] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) {
      const t = l.text.trim();
      if (t) out.push({ text: t, confidence: l.confidence, ...l.bbox });
    }
    return out;
  } finally {
    inFlight--;
    releaseWorkerSoon();
  }
}

// The system's own text recognition (Live Text on macOS, Windows.Media.Ocr),
// when the platform service offers it; undefined from it means "use the built-in reader".
let nativeOcr: ((file: string, langs: string[]) => Promise<string | undefined>) | null = null;

export function useNativeOcr(fn: (file: string, langs: string[]) => Promise<string | undefined>) {
  nativeOcr = fn;
}

/** Text in an image file: the system's recognition first, then the built-in reader. */
export async function ocrFile(file: string, img: Electron.NativeImage, langs: string[]): Promise<string> {
  const native = nativeOcr ? await nativeOcr(file, langs).catch(() => undefined) : undefined;
  if (native !== undefined) return native.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return ocrImage(img, langs);
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

  constructor(private index: FileIndex, private opts: () => { ocr: boolean; langs: string[]; text?: boolean }, private onUpdate: () => void) {}

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
    // "Text inside documents" switched off: documents are not read at all.
    if (this.opts().text === false) return false;
    if (TEXT_EXT.has(f.ext) && f.size < 1024 * 1024) return !fresh || x!.text === undefined;
    if (f.ext === 'pdf' && f.size < 50 * 1024 * 1024) return !fresh || x!.text === undefined;
    return false;
  }

  stop() {
    this.stopped = true;
    void worker?.then((w) => w.terminate()).catch(() => undefined);
  }

  private task = track('vision', 'Reading text in documents and pictures', 'text');

  private async pump() {
    if (this.running) return;
    this.running = true;
    let told = Date.now();
    while (this.queue.length && !this.stopped) {
      const p = this.queue.shift()!;
      this.pending = this.queue.length;
      const f = this.index.files.get(p);
      if (!f) continue;
      const ocr = f.kind === 'image';
      this.task.set('working', { pending: this.pending, detail: ocr ? 'Recognising text in pictures' : 'Reading documents' });
      // Waits on battery, when hot or busy, and leaves a gap between files so nothing feels slow.
      await pace(ocr ? 'ocr' : 'text');
      try {
        await this.process(f);
      } catch {
        // Mark as done so a broken file is not retried forever.
        this.index.setExtra(f, { text: this.index.extras.get(p)?.text ?? '' });
      }
      // Search results refresh every few seconds while text arrives, not after every file.
      if (Date.now() - told > 5000) {
        told = Date.now();
        this.onUpdate();
      }
    }
    this.pending = 0;
    this.running = false;
    this.task.set('idle', { pending: 0, detail: undefined });
    this.onUpdate();
    this.index.saveSoon();
  }

  private async process(f: FileEntry) {
    if (f.ext === 'pdf') {
      // Text PDFs give their words directly; for scanned ones, read the first page with OCR.
      const { text, pages } = await extractPdfText(f.path, 20_000);
      this.index.setMeta(f.path, { ...(f.meta ?? {}), pages });
      let found = text;
      if (found.replace(/\s+/g, '').length < 20 && this.opts().ocr) {
        const thumb = await loadImage(f.path, 1600).catch(() => null);
        if (thumb) found = await ocrImage(thumb, this.opts().langs).catch(() => '');
      }
      this.index.setText(f.path, found);
      return;
    }
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
      const text = await ocrFile(f.path, img, o.langs);
      this.index.setText(f.path, text.length > 3 ? text : '');
    }
  }
}

// ---------------------------------------------------------------- which language?

type OsdWorker = { detect(img: Buffer): Promise<{ data: { script: string | null; script_confidence: number | null } }>; terminate(): Promise<unknown> };
let osd: Promise<OsdWorker> | null = null;
let osdTimer: NodeJS.Timeout | undefined;

/** The writing system of the text in a picture (Latin, Cyrillic, Han…), or null when unsure. */
export async function detectScript(png: Buffer): Promise<string | null> {
  clearTimeout(osdTimer);
  osd ??= import('tesseract.js').then(async (t) => {
    const cachePath = path.join(app.getPath('userData'), 'tessdata');
    await fsp.mkdir(cachePath, { recursive: true });
    // Script detection needs the classic engine and its small detection model (downloaded once).
    return (await (t as unknown as { createWorker(l: string, oem: number, o: object): Promise<OsdWorker> }).createWorker('osd', 0, { cachePath, legacyCore: true, legacyLang: true }));
  });
  osd.catch(() => (osd = null));
  try {
    const { data } = await (await osd).detect(png);
    return data.script && (data.script_confidence ?? 0) >= 0.3 ? data.script : null;
  } catch {
    return null;
  } finally {
    osdTimer = setTimeout(() => {
      const w = osd;
      osd = null;
      void w?.then((x) => x.terminate()).catch(() => undefined);
    }, 60_000);
  }
}

/**
 * Text in a picture without knowing its language: the system's recognizer
 * where there is one (it detects the language and reads neat handwriting),
 * otherwise script detection, then the matching reader, then for Latin text
 * a second read in the language the words turn out to be.
 */
export async function ocrImageAuto(img: Electron.NativeImage, chosen: string[]): Promise<{ text: string; langs: string[] }> {
  if (nativeOcr) {
    const tmp = path.join(app.getPath('temp'), `keeper-ocr-${process.pid}-${Date.now()}.png`);
    try {
      await fsp.writeFile(tmp, img.toPNG());
      const native = await nativeOcr(tmp, []).catch(() => undefined);
      if (native !== undefined) return { text: native.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), langs: ['auto'] };
    } finally {
      await fsp.rm(tmp, { force: true });
    }
  }
  const png = img.toPNG();
  const script = await detectScript(png);
  let langs = languagesForScript(script, chosen);
  let text = await ocrImage(png, langs);
  if (!script || script === 'Latin') {
    const guess = guessLatinLanguage(text);
    if (guess && !langs.includes(guess)) {
      langs = [guess, ...langs.filter((l) => scriptOfLanguage(l) === 'Latin')];
      text = await ocrImage(png, langs);
    }
  }
  return { text, langs };
}

/**
 * Text capture with the person's reader settings (Capture options): the
 * system's recognizer (Windows.Media.Ocr from PowerShell, macOS Vision through
 * keeper-helper) — it reads neat handwriting — or the built-in reader with a
 * cleaned picture and a layout hint. Falls back to the built-in reader when
 * the system's cannot answer.
 */
export async function ocrTuned(img: Electron.NativeImage, langs: string[], o: { engine?: import('../../core/ocr-tune').OcrEngine; layout?: import('../../core/ocr-tune').OcrLayout; enhance?: boolean; handwriting?: boolean; keepSpaces?: boolean; autoLanguage?: boolean }): Promise<string | undefined> {
  const { enhanceForOcr, pickEngine, tesseractParams } = await import('../../core/ocr-tune');
  const systemAvailable = process.platform === 'darwin' || process.platform === 'win32';
  if (pickEngine({ engine: o.engine, handwriting: o.handwriting, systemAvailable }) === 'system') {
    const tmp = path.join(app.getPath('temp'), `keeper-ocr-${process.pid}-${Date.now()}.png`);
    try {
      await fsp.writeFile(tmp, img.toPNG());
      const text = process.platform === 'win32'
        ? await (await import('./platform/windows')).windowsOcr(tmp).catch(() => undefined)
        : await (await import('./platform/mac')).macOcr(tmp, []).catch(() => undefined);
      if (text !== undefined && (text.trim() || o.engine === 'system')) return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    } finally {
      await fsp.rm(tmp, { force: true });
    }
    if (o.engine === 'system') return undefined;
  }
  // The built-in reader: only when asked for something beyond the plain read.
  if (o.engine !== 'builtin' && !o.enhance && (!o.layout || o.layout === 'auto') && !o.handwriting) return undefined;
  let pic: Electron.NativeImage = img;
  if (o.enhance !== false) {
    const { width, height } = img.getSize();
    pic = nativeImage.createFromBitmap(Buffer.from(enhanceForOcr(img.toBitmap(), width, height, { keepGrey: o.handwriting })), { width, height });
  }
  // Without a layout hint, the language detection still picks the reader.
  if (o.autoLanguage && (!o.layout || o.layout === 'auto') && !o.handwriting) return (await ocrImageAuto(pic, langs)).text;
  return ocrImage(pic.toPNG(), langs, tesseractParams(o.handwriting && (!o.layout || o.layout === 'auto') ? 'block' : o.layout, { keepSpaces: o.keepSpaces }));
}
