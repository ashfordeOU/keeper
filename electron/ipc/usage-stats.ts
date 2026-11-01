// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for anonymous usage stats (Settings → Privacy, the welcome tour, the firewall's list of Keeper's own connections).

import { ipcMain } from 'electron';
import { notePage, resetId, setBlocked, setOn, startUsageStats, status } from '../services/usage-stats';

export function registerUsageStatsIpc() {
  ipcMain.handle('usageStats.status', () => status());
  ipcMain.handle('usageStats.setOn', (_e, on: unknown) => setOn(on === true));
  ipcMain.handle('usageStats.resetId', () => resetId());
  ipcMain.handle('usageStats.setBlocked', (_e, b: unknown) => setBlocked(b === true));
  ipcMain.handle('usageStats.page', (_e, name: unknown) => { if (typeof name === 'string') notePage(name); });
  startUsageStats();
}
