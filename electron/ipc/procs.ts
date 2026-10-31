// SPDX-License-Identifier: AGPL-3.0-or-later
// IPC for the process manager in Health.

import { ipcMain } from 'electron';
import { act, apps, details, icons, restartKeeper, reveal, sample, serviceAction, services, setPriority } from '../services/procs';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

export function registerProcsIpc() {
  handle('procs.sample', sample);
  handle('procs.act', act);
  handle('procs.setPriority', setPriority);
  handle('procs.details', details);
  handle('procs.icons', icons);
  handle('procs.reveal', reveal);
  handle('procs.apps', apps);
  handle('procs.restartKeeper', restartKeeper);
  handle('procs.services', services);
  handle('procs.serviceAction', serviceAction);
}
