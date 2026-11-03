// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's small floating windows (pinned pictures, the after-capture previews,
// the drawing sheet) report actions through `keeperFloat.act` in the capture
// preload. Each window's owner listens for its own window only: a message from
// any other page is dropped.

import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron';

type Handler = (action: string, arg: unknown, e: IpcMainEvent) => void;

const handlers = new Map<number, Handler>();
let listening = false;

function onMessage(e: IpcMainEvent, action: unknown, arg: unknown) {
  const fn = handlers.get(e.sender.id);
  if (fn && typeof action === 'string' && action.length < 40) fn(action, arg, e);
}

/** Routes this window's `keeperFloat.act(...)` messages to `fn` until the window closes. */
export function onFloat(win: BrowserWindow, fn: Handler) {
  const id = win.webContents.id;
  handlers.set(id, fn);
  if (!listening) {
    listening = true;
    ipcMain.on('capture.float', onMessage);
  }
  win.once('closed', () => {
    handlers.delete(id);
    if (!handlers.size && listening) {
      listening = false;
      ipcMain.removeListener('capture.float', onMessage);
    }
  });
}
