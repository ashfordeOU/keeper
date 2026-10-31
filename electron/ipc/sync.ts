// SPDX-License-Identifier: AGPL-3.0-or-later
// IPC for sync between devices, backups and mirrors.

import { ipcMain } from 'electron';
import type { SyncApi } from '../../core/api-sync';
import { registerKeeperMethod } from '../services/brain';
import { startSync, syncApi, type SyncServiceDeps } from '../services/sync';

export const SYNC_METHODS = Object.keys(syncApi) as (keyof SyncApi)[];

export async function registerSyncIpc(d: SyncServiceDeps) {
  for (const m of SYNC_METHODS) {
    ipcMain.handle(`sync.${m}`, async (_e, ...args) => (syncApi[m] as (...a: unknown[]) => unknown)(...args));
  }
  // The keeper command: keeper sync … / keeper backup … while the app runs.
  for (const m of SYNC_METHODS) registerKeeperMethod(`keeper/sync.${m}`, (p) => (syncApi[m] as (...a: unknown[]) => unknown)(...((p.args as unknown[]) ?? [])));
  await startSync(d);
}
