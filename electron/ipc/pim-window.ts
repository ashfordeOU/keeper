// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The calls the Mail, Calendar, Reminders and Planner pages make (pim.*). Apart from
// ipc/pim.ts so that a light app (Keeper Mail, docs/SOLO.md) can answer its windows
// without loading the agents and the brain, which the `keeper` command's methods need.

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { mailLink } from '../../core/pim/mail-link';
import { markOrigin } from '../services/origin-mark';
import { pim as pimHere } from '../services/pim';
import { pimCalls as pim } from '../services/pim/route';

export const PIM_METHODS = Object.keys(pimHere) as (keyof typeof pimHere)[];

// Answered here, or by Mail and calendars in a process of its own (services/pim/route.ts).
export function registerPimWindowIpc() {
  for (const m of PIM_METHODS) {
    ipcMain.handle(`pim.${m}`, (_e, ...args: unknown[]) => (pim[m] as (...a: unknown[]) => unknown)(...args));
  }
  // A saved attachment records the message it came from (Downloaded From → Mail).
  ipcMain.removeHandler('pim.saveAttachment');
  ipcMain.handle('pim.saveAttachment', async (_e, id: string, att: string, to?: string) => {
    const saved = await pim.saveAttachment(id, att, to);
    if (saved) await markOrigin(saved, { url: mailLink(id) });
    return saved;
  });
  // Save as PDF: the message is drawn in a hidden window (no scripts) and printed to a file.
  ipcMain.removeHandler('pim.savePdf');
  ipcMain.handle('pim.savePdf', async (e, id: string) => {
    const html = await pim.printable(id);
    const owner = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const title = (html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'Message').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Message';
    const pick = owner ? await dialog.showSaveDialog(owner, { defaultPath: path.join(app.getPath('downloads'), `${title}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] }) : { canceled: true, filePath: undefined };
    if (pick.canceled || !pick.filePath) return null;
    const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, offscreen: true } });
    try {
      await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await w.webContents.printToPDF({ printBackground: true });
      await fsp.writeFile(pick.filePath, pdf);
      return pick.filePath;
    } finally {
      w.destroy();
    }
  });
}
