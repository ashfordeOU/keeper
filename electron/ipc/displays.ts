// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for Displays: screen modes, presets and matched brightness.

import { ipcMain } from 'electron';
import { displaysApi, startDisplays } from '../services/displays';

export function registerDisplaysIpc(d: { broadcast: (channel: string) => void }) {
  for (const [k, fn] of Object.entries(displaysApi)) ipcMain.handle(`displays.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  startDisplays(d);
}
