// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for settings that follow you between your computers.

import { ipcMain } from 'electron';
import { settingsSyncApi, startSettingsSync } from '../services/settings-sync';

export function registerSettingsSyncIpc(d: { broadcast: (channel: string) => void }) {
  for (const [k, fn] of Object.entries(settingsSyncApi)) ipcMain.handle(`settingsSync.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  startSettingsSync(d);
}
