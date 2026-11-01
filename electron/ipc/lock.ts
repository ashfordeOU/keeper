// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for locked folders.

import { ipcMain } from 'electron';
import type { LockRequest, RelockWhen, UnlockRequest } from '../../core/api-lock';
import { canLock, cancel, forget, initLock, inspect, list, lock, newKey, relock, saveRecoveryKey, setRelock, status, unlock } from '../services/lock';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

export function registerLockIpc(d: { broadcast: (channel: string, ...args: unknown[]) => void; changed: () => void }) {
  initLock(d.broadcast);
  const after = <T>(p: Promise<T>) => p.then((r) => (d.changed(), r));
  handle('lock.status', () => status());
  handle('lock.canLock', (dir: string) => canLock(dir));
  handle('lock.newRecoveryKey', () => newKey());
  handle('lock.saveRecoveryKey', (key: string, name: string) => saveRecoveryKey(key, name));
  handle('lock.lock', (req: LockRequest) => after(lock(req)));
  handle('lock.inspect', (vault: string) => inspect(vault));
  handle('lock.unlock', (req: UnlockRequest) => after(unlock(req)));
  handle('lock.relock', (p: string) => after(relock(p)));
  handle('lock.list', () => list());
  handle('lock.forget', (vault: string) => forget(vault));
  handle('lock.setRelock', (vault: string, when: RelockWhen, minutes?: number) => setRelock(vault, when, minutes));
  handle('lock.cancel', () => cancel());
}
