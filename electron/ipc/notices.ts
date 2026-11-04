// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for the notification center.

import { ipcMain } from 'electron';
import { noticesApi } from '../services/notices';

export function registerNoticesIpc() {
  for (const [k, fn] of Object.entries(noticesApi)) ipcMain.handle(`notices.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
}
