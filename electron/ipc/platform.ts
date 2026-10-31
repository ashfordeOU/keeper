// SPDX-License-Identifier: AGPL-3.0-or-later
// IPC for Keeper inside the operating system.

import { ipcMain } from 'electron';
import type { IntegrationId } from '../../core/platform-integrations';
import { platformAction, platformList, platformSet } from '../services/platform';

export function registerPlatformIpc(d: { ask: (q: string) => void }) {
  ipcMain.handle('platform.list', (_e, refresh?: boolean) => platformList(!!refresh));
  ipcMain.handle('platform.set', (_e, id: IntegrationId, on: boolean) => platformSet(id, !!on));
  ipcMain.handle('platform.action', (_e, id: string) => platformAction(String(id)));
  ipcMain.handle('platform.ask', (_e, q: string) => d.ask(String(q ?? '').slice(0, 2000)));
}
