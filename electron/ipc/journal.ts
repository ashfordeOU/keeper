// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Journal mode's few main-process calls: making a journal vault in Documents
// without asking where, and copying photos into an entry's vault. Everything
// else goes through Notes' own calls (the entries are ordinary notes).

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JournalApi } from '../../core/api-journal';
import { isPhoto } from '../../core/notes/journal';
import * as notes from '../services/notes';

const journalApi: JournalApi = {
  async makeVault() {
    // Some Linux desktops name no Documents folder, and the home folder comes back instead.
    const docs = path.resolve(app.getPath('documents')) === path.resolve(os.homedir()) ? path.join(os.homedir(), 'Documents') : app.getPath('documents');
    const dir = path.join(docs, 'Journal');
    await fsp.mkdir(dir, { recursive: true });
    const v = await notes.addVault(dir);
    if (!v) throw new Error('Could not make the journal folder');
    return v;
  },
  async addPhotos(vault, notePath, paths) {
    let list = paths;
    if (!list?.length) {
      const win = BrowserWindow.getFocusedWindow();
      const opts = { title: 'Add photos to this day', properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[], filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif'] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (r.canceled) return [];
      list = r.filePaths;
    }
    const out: string[] = [];
    for (const p of list.slice(0, 50)) {
      if (!isPhoto(p) || !path.isAbsolute(p)) continue;
      const data = await fsp.readFile(p);
      out.push(await notes.saveAttachment(vault, notePath, path.basename(p), data));
    }
    return out;
  },
};

export function registerJournalIpc() {
  for (const [k, fn] of Object.entries(journalApi)) ipcMain.handle(`journal.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
}
