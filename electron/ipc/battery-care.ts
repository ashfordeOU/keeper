// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for battery care.

import { ipcMain } from 'electron';
import { batteryCareApi, startBatteryCare } from '../services/charge-limit';

export function registerBatteryCareIpc(d: { broadcast: (channel: string) => void }) {
  for (const [k, fn] of Object.entries(batteryCareApi)) ipcMain.handle(`batteryCare.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  startBatteryCare(d);
}
