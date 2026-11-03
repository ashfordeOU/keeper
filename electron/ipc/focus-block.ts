// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for Focus blocking, and `keeper/focus.pass` for the browser extension's
// block page ("let me in for a few minutes", through `keeper browser-host`).

import { ipcMain } from 'electron';
import { registerKeeperMethod } from '../services/brain';
import { featureOn } from '../services/features';
import { focusBlockApi, passForSite, startFocusBlock, type FocusBlockDeps } from '../services/focus-block';

export function registerFocusBlockIpc(d: FocusBlockDeps) {
  for (const [k, fn] of Object.entries(focusBlockApi)) ipcMain.handle(`focusBlock.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  registerKeeperMethod('keeper/focus.pass', async (p) => {
    if (!featureOn('focusBlock')) return { ok: false, message: 'Blocking is switched off in Keeper.' };
    return passForSite(String(p.site ?? ''));
  });
  void startFocusBlock(d);
}
