// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
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

// Studio's hidden recording page: commands in, chunks and events out.
contextBridge.exposeInMainWorld('keeperStudioRec', {
  onCommand: (cb: (cmd: unknown) => void) => ipcRenderer.on('studio.rec.cmd', (_e, cmd) => cb(cmd)),
  chunk: (track: string, buf: ArrayBuffer) => ipcRenderer.send('studio.rec.chunk', track, buf),
  event: (track: string, what: string, detail?: unknown) => ipcRenderer.send('studio.rec.event', track, what, detail),
});

// Keeper's small floating windows (pinned pictures, the after-capture previews,
// the drawing sheet): they can only name an action for their own window.
contextBridge.exposeInMainWorld('keeperFloat', {
  act: (action: string, arg?: unknown) => ipcRenderer.send('capture.float', String(action), arg),
});
