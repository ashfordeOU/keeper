// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for the process manager in Health. Sampling and acting on processes run
// in a service process of their own (electron/svc/procs-host.ts), started while
// the page asks and stopped a minute after it stops asking; if that process
// cannot start, the same code runs here instead.

import { ipcMain } from 'electron';
import { HostError, ServiceHost } from '../svc/host';
import * as local from '../services/procs';

const procsHost = new ServiceHost({ name: 'procs', label: 'Process sampling', script: 'svc-procs.cjs', idleStopMs: 60_000, callTimeoutMs: 30_000, init: () => ({ appPid: process.pid }) });
let inProcess = false;

type Remote = 'sample' | 'details' | 'act' | 'setPriority' | 'services' | 'serviceAction' | 'apps';

async function viaHost<T>(method: Remote, ...args: unknown[]): Promise<T> {
  if (!inProcess) {
    try {
      return await procsHost.call<T>(method, ...args);
    } catch (e) {
      if (!(e instanceof HostError) || e.code !== 'NO_HOST') throw e;
      inProcess = true;
    }
  }
  return (local[method] as (...a: unknown[]) => Promise<T>)(...args);
}

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

export function registerProcsIpc() {
  for (const m of ['sample', 'act', 'setPriority', 'details', 'apps', 'services', 'serviceAction'] as const) handle(`procs.${m}`, (...args: unknown[]) => viaHost(m, ...args));
  // These need Electron itself (icons, the file manager, restarting Keeper): here.
  handle('procs.icons', local.icons);
  handle('procs.reveal', local.reveal);
  handle('procs.restartKeeper', local.restartKeeper);
}
