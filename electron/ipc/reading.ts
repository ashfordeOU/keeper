// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for reading aloud and the reading fonts.

import { ipcMain } from 'electron';
import { readingApi, startReading } from '../services/reading';

export function registerReadingIpc(d: { broadcast: (channel: string, ...a: unknown[]) => void }) {
  for (const [k, fn] of Object.entries(readingApi)) ipcMain.handle(`reading.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  startReading(d);
}
