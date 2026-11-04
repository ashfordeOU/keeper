// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for Archives (electron/services/archives.ts).

import { ipcMain } from 'electron';
import { featureOn } from '../services/features';
import { archivesApi } from '../services/archives';

export function registerArchivesIpc() {
  for (const [k, fn] of Object.entries(archivesApi)) {
    ipcMain.handle(`archives.${k}`, async (_e, ...args) => {
      if (!featureOn('archives')) throw new Error('Archives is switched off (Settings → Features)');
      return (fn as (...a: unknown[]) => unknown)(...args);
    });
  }
}
