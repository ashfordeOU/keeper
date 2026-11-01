// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for the Island's tools (see electron/services/island-tools.ts).

import { ipcMain } from 'electron';
import { poll } from '../services/governor';
import * as t from '../services/island-tools';

function h(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(`islandTools.${name}`, async (_e, ...args) => fn(...(args as never[])));
}

export function registerIslandToolsIpc(deps: t.ShortcutDeps) {
  t.setShortcutDeps(deps);
  h('store', () => t.getStore());
  h('saveStore', (p: Parameters<typeof t.saveStore>[0]) => t.saveStore(p));
  h('exportJson', () => t.exportJson());
  h('ask', (prompt: string, input?: string, connection?: string) => t.ask(prompt, input, connection));
  h('askConnections', () => t.askConnections());
  h('usage', () => t.usage());
  h('setUsageOnline', (tool: Parameters<typeof t.setUsageOnline>[0], on: boolean) => t.setUsageOnline(tool, on));
  h('usageOnline', () => t.usageOnline());
  h('salesConfig', () => t.salesConfig());
  h('setSalesProvider', (id: Parameters<typeof t.setSalesProvider>[0], key: string, shop?: string) => t.setSalesProvider(id, key, shop));
  h('removeSalesProvider', (id: Parameters<typeof t.removeSalesProvider>[0]) => t.removeSalesProvider(id));
  h('setSalesPrefs', (p: Parameters<typeof t.setSalesPrefs>[0]) => t.setSalesPrefs(p));
  h('sales', (force?: boolean) => t.sales(force));
  h('rates', (base: string) => t.rates(base));
  h('quotes', (symbols: string[]) => t.quotes(symbols));
  h('chart', (symbol: string) => t.chart(symbol));
  h('stocksKey', () => t.stocksKey());
  h('setStocksKey', (key: string) => t.setStocksKey(key));
  h('shortcuts', () => t.shortcuts());
  h('runShortcut', (kind: Parameters<typeof t.runShortcut>[0], id: string) => t.runShortcut(kind, id));
  h('importScript', (p?: string) => t.importScript(p));
  h('macEvents', (from: number, to: number) => t.macEvents(from, to));
  h('macReminders', () => t.macReminders());
  h('setMacReminder', (id: string, done: boolean) => t.setMacReminder(id, done));

  // New-sale pings: only while the person asked for them; slower when they are away.
  poll('islandTools.sales', { baseMs: 10 * 60_000, idleFactor: 3, pauseWhenLocked: true }, () => { if (t.salesPingOn()) void t.sales(true).catch(() => undefined); }, { now: false, feature: 'islandSales' });
  // Shelf copies past their retention, once a day.
  poll('islandTools.shelfPrune', { baseMs: 24 * 3600_000, idleFactor: 1 }, () => void t.pruneShelfCopies().catch(() => undefined), { now: true, feature: 'island' });
}
