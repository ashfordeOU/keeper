// SPDX-License-Identifier: AGPL-3.0-or-later
// The screen-capture overlay can only report the rectangle the user drew.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('keeperCapture', {
  done: (rect: { x: number; y: number; w: number; h: number } | null) => ipcRenderer.send('capture.done', rect),
});
