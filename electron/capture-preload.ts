// SPDX-License-Identifier: AGPL-3.0-or-later
// The screen overlays (area, window and colour pickers) can only report what
// the user chose. The recorder page can only stream its chunks back.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('keeperCapture', {
  done: (result: unknown) => ipcRenderer.send('capture.done', result),
});

contextBridge.exposeInMainWorld('keeperRecorder', {
  onStart: (cb: (cfg: unknown) => void) => ipcRenderer.on('recorder.start', (_e, cfg) => cb(cfg)),
  onStop: (cb: () => void) => ipcRenderer.on('recorder.stop', () => cb()),
  chunk: (buf: ArrayBuffer) => ipcRenderer.send('recorder.chunk', buf),
  started: () => ipcRenderer.send('recorder.started'),
  done: () => ipcRenderer.send('recorder.done'),
  error: (msg: string) => ipcRenderer.send('recorder.error', msg),
});
