// SPDX-License-Identifier: AGPL-3.0-or-later
// IPC for previews and the keeper-file:// protocol.

import { ipcMain, protocol } from 'electron';
import { archive, bytes, displayImage, extract, filmstrip, fileUrl, info, initPreview, serveFile, text, transcode } from '../services/preview';
import { storeThumb } from '../services/thumbs';

export function registerPreviewIpc() {
  initPreview();
  const h = (name: string, fn: (...a: never[]) => unknown) => ipcMain.handle(`preview.${name}`, (_e, ...args) => fn(...(args as never[])));
  h('info', (p: string) => info(p));
  h('text', (p: string, max?: number) => text(p, max));
  h('bytes', (p: string, offset?: number, len?: number) => bytes(p, offset, len));
  h('archive', (p: string) => archive(p));
  h('extract', (p: string, entry: string) => extract(p, entry));
  h('transcode', async (p: string, audioOnly?: boolean) => fileUrl(await transcode(p, audioOnly)));
  h('filmstrip', (p: string, n?: number) => filmstrip(p, n));
  h('image', (p: string, max?: number) => displayImage(p, max));
  h('storeThumb', (p: string, size: number, url: string) => storeThumb(p, size, url));
}

/** Serves local files to the viewer, with seeking; call once the app is ready. */
export function registerFileProtocol() {
  protocol.handle('keeper-file', (req) => serveFile(req));
}
