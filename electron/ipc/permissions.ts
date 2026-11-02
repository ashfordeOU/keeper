// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for the Permissions screen (first run, Settings → Permissions, the palette).

import { BrowserWindow, ipcMain } from 'electron';
import { keychainStatus, onKeychain, retryKeychain, settings } from '../store';
import { setPromptFallback } from '../services/permission-nudge';
import { listPermissions, openPermissionSettings, requestPermission, restartKeeper, testPermission } from '../services/permissions';

export function registerPermissionsIpc() {
  const id = (v: unknown) => (typeof v === 'string' && v.length < 64 ? v : '');
  ipcMain.handle('permissions.list', () => listPermissions());
  ipcMain.handle('permissions.request', (_e, v: unknown) => requestPermission(id(v)));
  ipcMain.handle('permissions.openSettings', (_e, v: unknown) => openPermissionSettings(id(v)));
  ipcMain.handle('permissions.test', (_e, v: unknown) => testPermission(id(v)));
  ipcMain.handle('permissions.restart', () => restartKeeper());
  // Features show the system's own question only when the person did not set everything up first.
  setPromptFallback(() => settings().permissionsSetup !== 'all');
  // The keychain ("Keeper Safe Storage"): every window can show the banner and Try again.
  ipcMain.handle('keychain.status', () => keychainStatus());
  ipcMain.handle('keychain.retry', () => retryKeychain());
  onKeychain((s) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('event:keychain-changed', s);
  });
}
