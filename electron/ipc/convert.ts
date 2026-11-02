// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for the Convert tools, plus the two jobs that need Electron itself:
// decoding pictures only the OS can read, and drawing PDF pages.

import { app, BrowserWindow, dialog, ipcMain, nativeImage } from 'electron';
import { promises as fsp } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractPdfText } from '../../core/convert';
import { TOOL_INFO, type ConvertJob, type ConvertResult } from '../../core/convert-types';
import type { FileEntry, JournalOp, Progress } from '../../core/types';
import type { Journal } from '../../core/journal';
import type { Converter } from '../services/convert';
import { ffmpegPath } from '../services/convert-shared';
import { registerFileKitIpc } from './filekit';
import { VideoDownloader, type DownloadOptions } from '../services/video-download';
import type { Segment } from '../../core/media-ops';
import { getSecret, settings } from '../store';
import { macHelperCall } from '../services/platform/mac';
import { linkNode } from '../services/link';
import { phoneScanFiles } from '../../core/scan';
import { batches, piecesPrompt, readPieces, type DocKind } from '../../core/translate-doc';
import { complete } from '../../core/ai-actions';
import { startJob } from '../services/governor';
import { markOrigin } from '../services/origin-mark';
import { featureOn } from '../services/features';

const req = createRequire(__filename);

interface Deps {
  /** a getter: the history is created after IPC is registered */
  journal: () => Journal;
  progress: (p: Progress) => void;
  changed: () => void;
  window: () => BrowserWindow | null;
  refresh: (p: string) => Promise<FileEntry | undefined>;
}

/** HEIC and other formats the OS can decode (Windows with the HEIF extension, macOS). */
async function decodeImage(file: string): Promise<Buffer | null> {
  try {
    const img = await nativeImage.createThumbnailFromPath(file, { width: 8192, height: 8192 });
    if (!img.isEmpty()) return img.toPNG();
  } catch {
    /* not decodable by the OS either */
  }
  const img = nativeImage.createFromPath(file);
  return img.isEmpty() ? null : img.toPNG();
}

const RENDER_PAGE = (pdfUrl: string, workerUrl: string) => `<!doctype html><meta charset="utf-8"><script type="module">
import * as pdfjs from ${JSON.stringify(pdfUrl)};
pdfjs.GlobalWorkerOptions.workerSrc = ${JSON.stringify(workerUrl)};
window.renderPdf = async (b64, scale) => {
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(canvas.toDataURL('image/png'));
  }
  await doc.destroy();
  return out;
};
window.renderReady = true;
</script>`;

/** Draws every page of a PDF in a hidden window (pdf.js needs a canvas). */
async function renderPdf(file: string, scale: number): Promise<Buffer[]> {
  const dir = path.dirname(req.resolve('pdfjs-dist/package.json'));
  const pdfUrl = pathToFileURL(path.join(dir, 'legacy', 'build', 'pdf.mjs')).toString();
  const workerUrl = pathToFileURL(path.join(dir, 'legacy', 'build', 'pdf.worker.mjs')).toString();
  const page = path.join(app.getPath('userData'), 'pdf-render.html');
  await fsp.writeFile(page, RENDER_PAGE(pdfUrl, workerUrl));
  const win = new BrowserWindow({ show: false, width: 400, height: 400, webPreferences: { sandbox: true, contextIsolation: true, javascript: true } });
  try {
    await win.loadFile(page);
    for (let i = 0; i < 100; i++) {
      if (await win.webContents.executeJavaScript('!!window.renderReady')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const b64 = (await fsp.readFile(file)).toString('base64');
    const urls = (await win.webContents.executeJavaScript(`window.renderPdf(${JSON.stringify(b64)}, ${Number(scale) || 1})`)) as string[];
    return urls.map((u) => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64'));
  } finally {
    win.destroy();
  }
}

/**
 * Prints HTML (or a web page) to PDF in a hidden window with its own private
 * session. `onePage` measures the page and prints it as one long page, so
 * nothing is split across pages.
 */
async function printToPdf(source: { html?: string; url?: string }, o: { pageSize: 'a4' | 'letter'; onePage: boolean }): Promise<Buffer> {
  const size = o.pageSize === 'letter' ? { width: 8.5, height: 11 } : { width: 8.27, height: 11.69 };
  const margin = 0.4;
  // Laid out at the printable width (CSS pixels are 1/96 inch), so measuring the page matches what prints.
  const win = new BrowserWindow({
    show: false, width: Math.round((size.width - 2 * margin) * 96), height: 1000,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: !!source.url, partition: `keeper-print-${Date.now()}`, offscreen: false },
  });
  let tmp: string | undefined;
  try {
    if (source.url) {
      if (!/^https?:\/\//i.test(source.url)) throw new Error('Type a web address starting with http:// or https://');
      await Promise.race([win.loadURL(source.url), new Promise((_r, rej) => setTimeout(() => rej(new Error('The page took too long to load')), 45_000))]);
      // Pages that load pictures as you scroll: scroll once to the end and back.
      await win.webContents.executeJavaScript('new Promise(r => { let y = 0; const t = setInterval(() => { window.scrollTo(0, y += 900); if (y > document.body.scrollHeight) { clearInterval(t); window.scrollTo(0, 0); setTimeout(r, 600); } }, 60); })').catch(() => undefined);
    } else {
      tmp = path.join(app.getPath('temp'), `keeper-print-${process.pid}-${Date.now()}.html`);
      await fsp.writeFile(tmp, source.html ?? '');
      await win.loadFile(tmp);
    }
    let pageSize: Electron.PrintToPDFOptions['pageSize'] = o.pageSize === 'letter' ? 'Letter' : 'A4';
    if (o.onePage) {
      // Print styles can differ from the screen: measure with them applied.
      await win.webContents.executeJavaScript(`(() => { const s = document.createElement('style'); s.textContent = '@page { margin: 0 }'; document.head.appendChild(s); })()`).catch(() => undefined);
      const px = (await win.webContents.executeJavaScript('Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, document.documentElement.getBoundingClientRect().height))').catch(() => 1100)) as number;
      // A little extra so rounding never spills a line onto a second page (PDF pages top out at 200 inches).
      pageSize = { width: size.width, height: Math.min(200, Math.max(size.height, (px / 96) * 1.03 + 2 * margin + 0.3)) };
    }
    return await win.webContents.printToPDF({ printBackground: true, pageSize, margins: { top: margin, bottom: margin, left: margin, right: margin } });
  } finally {
    win.destroy();
    if (tmp) await fsp.rm(tmp, { force: true });
  }
}

/**
 * Speech to text with times, through the speech-to-text service chosen for
 * dictation (a local one keeps everything on this computer).
 */
async function transcribe(file: string): Promise<Segment[]> {
  const s = settings().island;
  const key = await getSecret('dictation');
  if (!key && !/localhost|127\.0\.0\.1|\[::1\]/.test(s.dictationUrl)) throw new Error('Choose a speech-to-text service first: Island settings → Dictation (a local server works without a key)');
  const form = new FormData();
  form.append('file', new Blob([await fsp.readFile(file)], { type: 'audio/mpeg' }), path.basename(file));
  form.append('model', s.dictationModel);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  const res = await fetch(s.dictationUrl, { method: 'POST', headers: key ? { authorization: `Bearer ${key}` } : {}, body: form });
  if (!res.ok) throw new Error(`The speech service returned ${res.status}`);
  const data = (await res.json()) as { text?: string; duration?: number; segments?: { start: number; end: number; text: string }[] };
  if (data.segments?.length) return data.segments.map((x) => ({ start: x.start, end: x.end, text: x.text }));
  return data.text ? [{ start: 0, end: data.duration ?? 0, text: data.text }] : [];
}

/**
 * Scanning with a phone: the companion page uploads the photos it took, then
 * asks for them to be made into one straightened, cleaned-up PDF here.
 */
async function registerPhoneScan(converter: () => Promise<Converter>, deps: Deps) {
  for (let i = 0; i < 120 && !linkNode(); i++) await new Promise((r) => setTimeout(r, 250));
  const node = linkNode();
  if (!node) return;
  node.registerCompanionOp('scan.make', async (h) => {
    const dir = node.receivedDir();
    const names = phoneScanFiles(h.files);
    if (!names.length) throw new Error('No photos to make a scan from');
    const inputs = names.map((n) => path.join(dir, n));
    const mode = h.mode === 'color' || h.mode === 'gray' ? h.mode : 'bw';
    const result = await (await converter()).run({ op: { tool: 'image.scan', mode, pageSize: 'fit', straighten: true }, inputs, outDir: dir });
    for (const p of inputs) await fsp.rm(p, { force: true });
    // A name a person recognises: "Phone scan 2026-10-31 14.05.pdf".
    const { freeName } = await import('../../core/convert');
    const d = new Date();
    const stamp = `${d.toISOString().slice(0, 10)} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
    const named = freeName(dir, `Phone scan ${stamp}`, 'pdf');
    await fsp.rename(result.outputs[0], named);
    void deps.refresh(named);
    deps.changed();
    return { r: { savedAs: path.basename(named), pages: names.length, message: result.message } };
  });
}

const LANG_NAMES: Record<string, string> = { en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', et: 'Estonian', cs: 'Czech', tr: 'Turkish', ru: 'Russian', uk: 'Ukrainian', el: 'Greek', ar: 'Arabic', he: 'Hebrew', hi: 'Hindi', zh: 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean', id: 'Indonesian', vi: 'Vietnamese', th: 'Thai' };

/**
 * Pieces of a document in another language: with the AI chosen in Keeper's
 * settings (a local model keeps it on this computer), or macOS's own
 * on-device translator.
 */
async function translate(texts: string[], language: string, engine: 'ai' | 'system', kind: DocKind): Promise<string[]> {
  if (engine === 'system') {
    if (process.platform !== 'darwin') throw new Error("The system translator is only on macOS; choose “Keeper's AI” instead");
    const r = await macHelperCall<{ texts: string[] }>('translate', { texts, to: language }, 30 * 60_000);
    return r.texts;
  }
  const s = settings().ai;
  const opts = { provider: s.provider, model: s.model, apiKey: await getSecret(s.provider), ollamaUrl: s.ollamaUrl };
  const out = texts.slice();
  for (const batch of batches(texts)) {
    const pieces = batch.map((i) => texts[i]);
    const { system, prompt } = piecesPrompt(LANG_NAMES[language] ?? language, pieces, kind);
    const back = readPieces(pieces, await complete(system, prompt, opts));
    batch.forEach((i, j) => (out[i] = back[j]));
  }
  return out;
}

/** macOS's own on-device recognizer through keeper-helper; undefined where it is not available. */
async function systemTranscribe(file: string, language?: string): Promise<Segment[] | undefined> {
  if (process.platform !== 'darwin') return undefined;
  try {
    const r = await macHelperCall<{ segments: Segment[] }>('speech.transcribe', { path: file, language: language ?? 'auto' }, 60 * 60_000);
    return r.segments;
  } catch (e) {
    if (/helper is not available|Unknown method/.test(String(e))) return undefined;
    throw e;
  }
}

type Tess = { recognize(img: Buffer, o?: object, out?: object): Promise<{ data: { blocks?: { paragraphs: { lines: { words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] }[] } }>; terminate(): Promise<unknown> };
let tess: Promise<Tess> | null = null;
let tessIdle: NodeJS.Timeout | undefined;

/** Words and where they are in a picture (for searchable PDFs). The reader is let go a minute after use. */
async function ocrWords(png: Buffer) {
  tess ??= (async () => {
    const t = (await import('tesseract.js')) as unknown as { createWorker(l: string[], oem: number, o: object): Promise<Tess> };
    const cachePath = path.join(app.getPath('userData'), 'tessdata');
    await fsp.mkdir(cachePath, { recursive: true });
    return t.createWorker(settings().ocrLanguages?.length ? settings().ocrLanguages : ['eng'], 1, { cachePath });
  })();
  clearTimeout(tessIdle);
  const w = await tess;
  const { data } = await w.recognize(png, {}, { blocks: true });
  tessIdle = setTimeout(() => { void w.terminate(); tess = null; }, 60_000);
  const words: { text: string; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const wd of l.words) if (wd.text.trim()) words.push({ text: wd.text, ...wd.bbox });
  return words;
}

/** Downloads; on Linux without a configured downloads folder Electron says the home folder, so use ~/Downloads. */
function downloadsDir(): string {
  const d = app.getPath('downloads');
  return path.resolve(d) === path.resolve(app.getPath('home')) ? path.join(d, 'Downloads') : d;
}

export function registerConvertIpc(deps: Deps) {
  let label = 'Converting';
  // The converters, and the PDF, image and signing libraries they use, load the first time something is converted.
  let made: Promise<Converter> | undefined;
  const converter = () => (made ??= import('../services/convert').then(({ Converter }) => new Converter({
    modelsDir: path.join(app.getPath('userData'), 'models'),
    onProgress: (f, phase) => deps.progress({ task: 'convert', phase: phase || label, done: Math.round(f * 1000), total: 1000 }),
    hooks: { decodeImage, renderPdf, printToPdf, transcribe, systemTranscribe, ocrWords, translate },
    // "Prepare for AI" can hand its chunks to Keeper's brain, which reads files in the library.
    toBrain: async () => {
      const b = await import('../services/brain');
      await b.syncBrain();
      return 'Keeper’s brain reads it when the folder is part of your library';
    },
  })));
  registerFileKitIpc(converter);
  let busy = false;
  void registerPhoneScan(converter, deps);

  ipcMain.handle('convert.run', async (_e, job: ConvertJob): Promise<ConvertResult> => {
    if (busy) throw new Error('Another conversion is still running');
    busy = true;
    label = 'Converting';
    try {
      const result = await (await converter()).run(job);
      const ops: JournalOp[] = [];
      for (const o of result.outputs) {
        const size = (await fsp.stat(o).catch(() => ({ size: 0 }))).size;
        ops.push({ type: 'create', from: job.inputs[0], to: o, size });
        void deps.refresh(o);
      }
      if (ops.length) await deps.journal().record(`${toolTitle(job)}: ${ops.length} new file${ops.length === 1 ? '' : 's'}`, ops);
      deps.changed();
      return result;
    } finally {
      busy = false;
      deps.progress({ task: 'convert', phase: 'Done', done: 1, total: 1 });
    }
  });
  ipcMain.handle('convert.capabilities', async () => (await converter()).capabilities());
  ipcMain.handle('convert.duration', async (_e, p: string) => (await (await converter()).probeDuration(p).catch(() => undefined)) ?? null);
  const downloader = new VideoDownloader(path.join(app.getPath('userData'), 'bin'), ffmpegPath);
  ipcMain.handle('convert.downloadVideo', async (_e, o: Omit<DownloadOptions, 'folder'> & { folder?: string }) => {
    if (!featureOn('videoDownload')) throw new Error('Video downloads are switched off (Settings → Features)');
    const folder = o.folder || path.join(downloadsDir(), 'Keeper Videos');
    const job = startJob('Downloading a video', { id: 'download-video' });
    try {
      const files = await downloader.download({ ...o, folder }, (p) => {
        job.update(`${Math.round(p.fraction * 100)}%`);
        deps.progress({ task: 'download-video', phase: p.phase, done: Math.round(p.fraction * 1000), total: 1000 });
      });
      // Each video records the page it came from (Downloaded From → YouTube, Vimeo…).
      for (const f of files) await markOrigin(f, { url: o.url });
      for (const f of files) void deps.refresh(f);
      deps.changed();
      return files;
    } finally {
      job.end();
      deps.progress({ task: 'download-video', phase: 'Done', done: 1, total: 1 });
    }
  });
  ipcMain.handle('convert.cancelDownload', () => downloader.cancel());
  // A voice recording made in the Toolbox: saved under Music/Keeper Recordings as M4A (and the original WebM is dropped).
  ipcMain.handle('convert.saveRecording', async (_e, base64: string, ext: string) => {
    const dir = path.join(app.getPath('music'), 'Keeper Recordings');
    await fsp.mkdir(dir, { recursive: true });
    const { freeName } = await import('../../core/convert');
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
    const raw = freeName(dir, `Recording ${stamp}`, /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'webm');
    await fsp.writeFile(raw, Buffer.from(base64, 'base64'));
    const ff = ffmpegPath();
    if (!ff) return raw;
    const m4a = raw.replace(/\.[^.]+$/, '.m4a');
    const { exec } = await import('../services/convert-extra');
    const r = await exec(ff, ['-hide_banner', '-y', '-nostdin', '-i', raw, '-c:a', 'aac', '-b:a', '160k', m4a]);
    if (r.code !== 0) return raw;
    await fsp.rm(raw, { force: true });
    void deps.refresh(m4a);
    deps.changed();
    return m4a;
  });
  ipcMain.handle('convert.mediaInfo', async (_e, p: string) => (await converter()).extra.info(p));
  // iPhone and iPad backups for the storage view.
  ipcMain.handle('convert.phoneBackups', async () => (await import('../services/phone-backups')).phoneBackups());
  // External displays: brightness, contrast and volume over DDC/CI.
  ipcMain.handle('convert.displays', async () => (await import('../services/display-control')).listDisplays());
  ipcMain.handle('convert.setDisplay', async (_e, id: string, control: 'brightness' | 'contrast' | 'volume', v: number) => (await import('../services/display-control')).setDisplay(id, control, v));
  // Small pictures of every page for the visual organizer (at most 400 pages).
  ipcMain.handle('convert.pdfThumbs', async (_e, p: string): Promise<string[]> => {
    if (!/\.pdf$/i.test(p)) throw new Error('Choose a PDF');
    const pages = await renderPdf(p, 0.3);
    return pages.slice(0, 400).map((png) => {
      const img = nativeImage.createFromBuffer(png);
      return `data:image/jpeg;base64,${img.toJPEG(70).toString('base64')}`;
    });
  });
  ipcMain.handle('convert.pdfFields', async (_e, p: string) => (await import('../services/pdf-tools')).formFields(p));
  ipcMain.handle('convert.webToPdf', async (_e, url: string, o: { pageSize: 'a4' | 'letter'; onePage: boolean; outDir?: string }) => {
    const pdf = await printToPdf({ url }, o);
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'page'; } })();
    const dir = o.outDir || downloadsDir();
    const { freeName } = await import('../../core/convert');
    const out = freeName(dir, `${host} ${new Date().toISOString().slice(0, 10)}`, 'pdf');
    await fsp.writeFile(out, pdf);
    void deps.refresh(out);
    deps.changed();
    return out;
  });
  ipcMain.handle('convert.pageCount', async (_e, p: string) => (await extractPdfText(p, 1, 1).catch(() => null))?.pages ?? null);
  ipcMain.handle('settings.pickFiles', async (_e, opts: { title?: string; extensions?: string[] } = {}) => {
    const win = deps.window();
    const o: Electron.OpenDialogOptions = {
      title: opts.title ?? 'Choose files',
      properties: ['openFile', 'multiSelections'],
      filters: opts.extensions?.length ? [{ name: 'Files', extensions: opts.extensions }, { name: 'All files', extensions: ['*'] }] : undefined,
    };
    const r = win ? await dialog.showOpenDialog(win, o) : await dialog.showOpenDialog(o);
    return r.canceled ? [] : r.filePaths;
  });
}

function toolTitle(job: ConvertJob): string {
  const info = TOOL_INFO[job.op.tool];
  const cat = { video: 'Video', audio: 'Audio', image: 'Pictures', pdf: 'PDF', doc: 'Documents', file: 'File', convert: 'Convert' }[info.category];
  return `${cat} · ${info.label}`;
}
