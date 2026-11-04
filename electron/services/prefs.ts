// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings helpers for the main process: which global shortcuts really work
// (and which are taken, and by what), and saving or opening a settings file
// for Settings → General → Export and import.

import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain } from 'electron';
import { ShortcutBook } from '../../core/shortcuts';

const book = new ShortcutBook(process.platform);

/** Forgets the last round of shortcuts (main.ts calls this as it unregisters them all). */
export function resetShortcutBook() {
  book.reset();
}

/** How each shortcut Keeper tried to register went (works, taken, not valid). */
export const shortcutStatus = () => book.status();

/**
 * Registers a global shortcut and remembers how it went: "taken by Quick Search"
 * when another of Keeper's shortcuts already has the keys, "taken by another app"
 * when the system says no, "not valid" when the keys make no sense.
 */
export function claimShortcut(acc: string | undefined, fn: () => void, owner = 'Keeper'): boolean {
  if (!acc) return false;
  let mine = false;
  try { mine = globalShortcut.isRegistered(acc); } catch { /* not valid: claim() reports it */ }
  return book.claim(acc, owner, () => globalShortcut.register(acc, fn), mine);
}

const win = () => BrowserWindow.getFocusedWindow() ?? undefined;

ipcMain.handle('prefs.shortcuts', () => book.status());

ipcMain.handle('prefs.saveFile', async (_e, name: string, text: string) => {
  const opts = { defaultPath: path.join(app.getPath('documents'), String(name).replace(/[\\/:*?"<>|]/g, '-')), filters: [{ name: 'Keeper settings', extensions: ['json'] }] };
  const w = win();
  const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  await fs.writeFile(r.filePath, String(text), 'utf8');
  return r.filePath;
});

ipcMain.handle('prefs.openFile', async () => {
  const opts = { properties: ['openFile' as const], filters: [{ name: 'Keeper settings', extensions: ['json'] }] };
  const w = win();
  const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
  const p = r.filePaths[0];
  if (r.canceled || !p) return null;
  const st = await fs.stat(p);
  if (st.size > 5 * 1024 * 1024) throw new Error('That file is too big to be Keeper settings.');
  return fs.readFile(p, 'utf8');
});
