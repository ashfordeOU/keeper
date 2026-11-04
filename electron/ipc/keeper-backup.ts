// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for backing up and moving Keeper itself.

import { ipcMain } from 'electron';
import { keeperBackupApi, startKeeperBackup } from '../services/keeper-backup';

export function registerKeeperBackupIpc() {
  for (const [k, fn] of Object.entries(keeperBackupApi)) ipcMain.handle(`keeperBackup.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  startKeeperBackup();
}
