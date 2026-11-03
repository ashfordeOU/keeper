// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC and the `keeper license` command for Keeper Pro (electron/services/pro.ts).
// The handlers exist in every build; without Pro they only ever say "off".

import { ipcMain } from 'electron';
import { proEnabled } from '../../core/pro-switch';
import { PLAN_NAME } from '../../core/entitlements';
import { registerKeeperMethod } from '../services/brain';
import { pro, startPro } from '../services/pro';

export function registerProIpc(deps: { broadcast: (channel: string) => void }) {
  ipcMain.handle('pro.status', () => pro().status());
  ipcMain.handle('pro.activate', (_e, text: unknown) => pro().activate(String(text ?? '')));
  ipcMain.handle('pro.deactivate', () => pro().deactivate());
  ipcMain.handle('pro.checkout', (_e, plan: unknown, period: unknown) => pro().checkout(plan === 'team' ? 'team' : 'pro', period === 'year' ? 'year' : 'month'));
  ipcMain.handle('pro.manage', () => pro().manage());
  ipcMain.handle('pro.restore', (_e, email: unknown) => pro().restore(String(email ?? '')));

  // `keeper license [status|activate <token>|deactivate]`
  registerKeeperMethod('keeper/license', async (p) => {
    if (!proEnabled()) return { off: true, text: 'Keeper Pro isn’t part of this version. Everything in Keeper is free.' };
    const what = String(p.action ?? 'status');
    const s = what === 'activate' ? await pro().activate(String(p.token ?? '')) : what === 'deactivate' ? await pro().deactivate() : await pro().status();
    if (!s.enabled) return { off: true, text: 'Keeper Pro isn’t part of this version.' };
    const l = s.license;
    const lines = [`Plan: ${PLAN_NAME[s.plan]}`];
    if (l) lines.push(`License: ${l.id} (${PLAN_NAME[l.plan]}, ${l.seats} seat${l.seats === 1 ? '' : 's'}${l.exp ? `, ${l.state === 'grace' ? 'ended' : 'renews'} ${new Date(l.exp).toISOString().slice(0, 10)}` : ', never ends'})`);
    else lines.push(s.problem ? `License: ${s.problem}` : 'License: none on this computer');
    return { text: lines.join('\n'), data: { plan: s.plan, license: l ?? null, problem: s.problem ?? null } };
  });

  startPro(() => deps.broadcast('pro-changed'));
}
