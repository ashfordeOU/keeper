// SPDX-License-Identifier: AGPL-3.0-or-later
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
import { Converter } from '../services/convert';

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

export function registerConvertIpc(deps: Deps) {
  let label = 'Converting';
  const converter = new Converter({
    modelsDir: path.join(app.getPath('userData'), 'models'),
    onProgress: (f, phase) => deps.progress({ task: 'convert', phase: phase || label, done: Math.round(f * 1000), total: 1000 }),
    hooks: { decodeImage, renderPdf },
  });
  let busy = false;

  ipcMain.handle('convert.run', async (_e, job: ConvertJob): Promise<ConvertResult> => {
    if (busy) throw new Error('Another conversion is still running');
    busy = true;
    label = 'Converting';
    try {
      const result = await converter.run(job);
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
  ipcMain.handle('convert.capabilities', () => converter.capabilities());
  ipcMain.handle('convert.duration', async (_e, p: string) => (await converter.probeDuration(p).catch(() => undefined)) ?? null);
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
  const cat = { video: 'Video', audio: 'Audio', image: 'Pictures', pdf: 'PDF', file: 'File' }[info.category];
  return `${cat} · ${info.label}`;
}
