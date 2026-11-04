// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The PDF reader's files: reading a PDF to show it, and saving the edits
// (core/pdf-annotate.ts) back into it, or into a copy. Before a PDF is
// overwritten, the version it had is kept in Keeper's data folder so
// "Restore the last version" can put it back.

import { createHash } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { applyEdits, type PdfEdits } from '../../core/pdf-annotate';
import { settings } from '../store';

const MAX = 512 * 1024 * 1024;
const backupDir = () => path.join(app.getPath('userData'), 'pdf-reader', 'previous');
const backupOf = (p: string) => path.join(backupDir(), `${createHash('sha1').update(path.resolve(p)).digest('hex').slice(0, 20)}.pdf`);

async function readPdf(p: string): Promise<Uint8Array> {
  const st = await fsp.stat(p);
  if (!st.isFile()) throw new Error('This is not a file');
  if (st.size > MAX) throw new Error('This PDF is over 512 MB, too large to open here');
  const b = await fsp.readFile(p);
  if (b.subarray(0, 1024).indexOf('%PDF') < 0) throw new Error('This file is not a PDF');
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

async function dialogWin() {
  const { dialog, BrowserWindow } = await import('electron');
  return { dialog, win: BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] };
}

export const pdfReaderApi = {
  read: (p: string) => readPdf(String(p)),
  async pick(): Promise<string | null> {
    const { dialog, win } = await dialogWin();
    const r = win ? await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Open a PDF', filters: [{ name: 'PDF', extensions: ['pdf'] }] }) : { canceled: true, filePaths: [] };
    return r.canceled ? null : (r.filePaths[0] ?? null);
  },
  async pickMore(): Promise<string[]> {
    // The end-to-end test stands in for the open window.
    if (process.env.KEEPER_PDF_TEST_ADD) return [process.env.KEEPER_PDF_TEST_ADD];
    const { dialog, win } = await dialogWin();
    const r = win ? await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], title: 'Add pages from', filters: [{ name: 'PDF', extensions: ['pdf'] }] }) : { canceled: true, filePaths: [] };
    return r.canceled ? [] : r.filePaths;
  },
  async save(p: string, edits: PdfEdits, added: string[] = [], copy = false): Promise<{ path: string } | null> {
    const src = String(p);
    let out = src;
    if (copy) {
      const { dialog, win } = await dialogWin();
      const def = src.replace(/\.pdf$/i, '') + ' (edited).pdf';
      const r = process.env.KEEPER_PDF_TEST ? { canceled: false, filePath: def } : win ? await dialog.showSaveDialog(win, { defaultPath: def, filters: [{ name: 'PDF', extensions: ['pdf'] }] }) : { canceled: true, filePath: undefined };
      if (r.canceled || !r.filePath) return null;
      out = r.filePath;
    }
    const bytes = await applyEdits(await readPdf(src), await Promise.all(added.map((a) => readPdf(String(a)))), edits);
    if (out === src && settings().pdfReader?.keepPrevious !== false) {
      await fsp.mkdir(backupDir(), { recursive: true });
      await fsp.copyFile(src, backupOf(src));
    }
    // Written beside it first, then moved into place: a failed save never leaves half a PDF.
    const tmp = `${out}.keeper-saving`;
    await fsp.writeFile(tmp, bytes);
    await fsp.rename(tmp, out);
    return { path: out };
  },
  hasBackup: async (p: string) => existsSync(backupOf(String(p))),
  async restore(p: string): Promise<boolean> {
    const b = backupOf(String(p));
    if (!existsSync(b)) return false;
    await fsp.copyFile(b, String(p));
    await fsp.rm(b, { force: true });
    return true;
  },
};
