// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for crash reports (Settings → Privacy).

import { ipcMain } from 'electron';
import { crashReportsApi, startCrashReports } from '../services/crash-reports';

export function registerCrashReportsIpc() {
  for (const [k, fn] of Object.entries(crashReportsApi)) ipcMain.handle(`crashReports.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  startCrashReports();
}
