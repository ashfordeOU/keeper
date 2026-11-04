// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for app updates.

import { ipcMain } from 'electron';
import { appUpdatesApi, startAppUpdates } from '../services/app-updates';

export function registerAppUpdatesIpc(d: { broadcast: (channel: string) => void }) {
  for (const [k, fn] of Object.entries(appUpdatesApi)) ipcMain.handle(`appUpdates.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  startAppUpdates(d);
}
