// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for the photo editor.

import { ipcMain } from 'electron';
import type { Progress } from '../../core/types';
import { initPhotoEditor, photoApi } from '../services/photo-edit';
import { featureOn } from '../services/features';

export function registerPhotoIpc(d: { roots: () => Promise<string[]>; progress?: (p: Progress) => void }) {
  initPhotoEditor({ roots: d.roots, progress: (f, phase, task) => d.progress?.({ task, phase, done: Math.round(f * 1000), total: 1000 }) });
  for (const [k, fn] of Object.entries(photoApi)) {
    ipcMain.handle(`photo.${k}`, async (_e, ...args) => {
      if (!featureOn('photoEditor')) throw new Error('The photo editor is switched off in Settings → Features.');
      return (fn as (...a: unknown[]) => unknown)(...args);
    });
  }
}
