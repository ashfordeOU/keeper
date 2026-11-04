// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for Side by Side (electron/services/panes.ts).

import { ipcMain } from 'electron';
import { featureOn } from '../services/features';
import { initPanes, panesApi } from '../services/panes';

export function registerPanesIpc(d: { broadcast: (channel: string, ...args: unknown[]) => void }) {
  initPanes(d.broadcast);
  for (const [k, fn] of Object.entries(panesApi)) {
    ipcMain.handle(`panes.${k}`, async (_e, ...args) => {
      if (!featureOn('filePanes')) throw new Error('Side by Side is switched off (Settings → Features)');
      return (fn as (...a: unknown[]) => unknown)(...args);
    });
  }
}
