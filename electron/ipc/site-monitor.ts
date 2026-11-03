// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for site and server monitors.

import { ipcMain } from 'electron';
import { monitorsApi, startMonitors } from '../services/site-monitor';

export function registerMonitorsIpc(d: { broadcast: (channel: string) => void; alert: (title: string, detail: string) => void }) {
  for (const [k, fn] of Object.entries(monitorsApi)) ipcMain.handle(`monitors.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  startMonitors(d);
}
