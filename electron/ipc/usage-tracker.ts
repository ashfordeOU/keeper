// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC, the `keeper usage` command and the `usage_status` AI ability for the
// AI usage and subscription tracker (electron/services/usage-tracker.ts).

import { ipcMain } from 'electron';
import { registerAbility } from '../../core/abilities/registry';
import { registerKeeperMethod } from '../services/brain';
import { featureOn } from '../services/features';
import * as t from '../services/usage-tracker';

function h(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(`aiUsage.${name}`, async (_e, ...args) => fn(...(args as never[])));
}

export function registerUsageTrackerIpc(deps: t.UsageTrackerDeps) {
  h('overview', () => t.overview());
  h('refresh', (id?: string) => t.refresh(id));
  h('saveAccount', (a: Parameters<typeof t.saveAccount>[0], key?: string) => t.saveAccount(a, key));
  h('removeAccount', (id: string) => t.removeAccount(String(id)));
  h('reorder', (ids: string[]) => t.reorder(Array.isArray(ids) ? ids.map(String) : []));
  h('setSettings', (p: Parameters<typeof t.setSettings>[0]) => t.setSettings(p ?? {}));
  h('history', (days?: number) => t.history(Number(days) || 90));
  h('exportCsv', () => t.exportCsv());
  h('detect', () => t.detect());
  h('signIn', (a: Parameters<typeof t.signIn>[0]) => t.signIn(a && typeof a === 'object' ? a : { id: String(a) }));
  h('setStatusLine', (id: string, on: boolean) => t.setStatusLine(String(id), !!on));
  h('scanReceipts', () => t.scanReceipts());
  h('openPage', (tab?: string) => deps.showMain(tab ? `aiusage:${tab}` : 'aiusage'));
  h('glanceState', () => t.glanceState());

  // `keeper usage [--json]`
  registerKeeperMethod('keeper/usage', async (p) => {
    if (!featureOn('usageTracker')) return { off: true, text: 'AI usage tracking is switched off (Settings → Features).' };
    if (p.refresh) await t.refresh();
    return t.statusText();
  });

  // Agents can check their own limits before starting something big.
  registerAbility({
    name: 'usage_status', label: 'Check AI usage limits', group: 'System', defaultPermission: 'allow', network: 'never', readOnly: true,
    description: 'How much is left of each tracked AI account\'s limits (5-hour and weekly windows, credits, monthly budgets), when each resets, and which are running out or used up. Check before starting a large job.',
    parameters: { type: 'object', properties: {} },
    describe: () => 'Check how much AI usage is left',
  }, async () => {
    if (!featureOn('usageTracker')) return { content: 'AI usage tracking is switched off in Keeper.', summary: 'off', isError: true };
    const s = await t.statusText();
    return { content: `${s.text}\n\n${JSON.stringify(s.data)}`, summary: (s.data as { allClear: boolean }).allClear ? 'all clear' : 'something is running out' };
  });

  void t.initUsageTracker(deps);
}
