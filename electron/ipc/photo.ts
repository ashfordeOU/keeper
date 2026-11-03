// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for the light photo editor.

import { ipcMain } from 'electron';
import { initPhotoEditor, photoApi } from '../services/photo-edit';
import { featureOn } from '../services/features';

export function registerPhotoIpc(d: { roots: () => Promise<string[]> }) {
  initPhotoEditor(d);
  for (const [k, fn] of Object.entries(photoApi)) {
    ipcMain.handle(`photo.${k}`, async (_e, ...args) => {
      if (!featureOn('photoEditor')) throw new Error('The photo editor is switched off in Settings → Features.');
      return (fn as (...a: unknown[]) => unknown)(...args);
    });
  }
}
