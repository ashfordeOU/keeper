// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's tools in the browser demo: sample usage, sales, quotes and notes.

import type { IslandToolsApi, SalesConfigView } from '../core/api-island-tools';
import { normalizeStore, type IslandToolsStore } from '../core/island-tools/notes';
import { SALES_PROVIDERS, summarize, type Sale } from '../core/island-tools/sales';
import type { UsageReport } from '../core/island-tools/usage';

export function mockIslandTools(): { islandTools: IslandToolsApi } {
  const now = Date.now();
  let store: IslandToolsStore = normalizeStore({
    notes: [
      { id: 'n1', text: '# Launch checklist\n- Record the demo\n- Post on Friday', created: now - 86_400_000, updated: now - 3600_000, pinned: true },
      { id: 'n2', text: 'Wi-Fi at the studio: Studio-5G', created: now - 5 * 86_400_000, updated: now - 5 * 86_400_000 },
    ],
    todos: [
      { id: 't1', text: 'Send the invoice to Acme', done: false, starred: true, created: now - 7200_000 },
      { id: 't2', text: 'Book the train for Tuesday', done: false, starred: false, created: now - 3600_000 },
      { id: 't3', text: 'Renew the domain', done: true, starred: false, created: now - 86_400_000, doneAt: now - 1800_000 },
    ],
    scripts: [{ id: 's1', title: 'Weekly update', text: 'Good morning everyone.\n\nThis week we shipped the new Island tools: Ask, AI usage, sales, stocks, a teleprompter and more.\n\nNext week we focus on the release, the website and the launch video.\n\nThank you, and see you on Friday.', updated: now }],
    stocks: ['AAPL', 'MSFT', 'NVDA', 'BTC', 'ETH'],
  });
  let online: Partial<Record<string, boolean>> = { claude: true };
  const providers = new Set(['stripe', 'lemonsqueezy']);
  let conf: Omit<SalesConfigView, 'providers'> = { currency: 'USD', convert: true, ping: true };
  const view = (): SalesConfigView => ({ ...conf, providers: SALES_PROVIDERS.map((p) => ({ ...p, connected: providers.has(p.id) })) });
  const sales: Sale[] = Array.from({ length: 70 }, (_, i) => ({ provider: i % 3 ? 'stripe' : 'lemonsqueezy', id: `s${i}`, at: now - Math.floor((i * i * 37_000_000) % (29 * 86_400_000)), amount: [19, 49, 9, 99, 29][i % 5], currency: 'USD' }));
  const usage: UsageReport[] = [
    { tool: 'claude', label: 'Claude Code', state: 'ok', source: 'Limits from Anthropic with Claude Code\'s sign-in', updatedAt: now, windows: [{ label: '5-hour session', usedPercent: 62, resetsAt: now + 96 * 60_000 }, { label: 'Weekly', usedPercent: 38, resetsAt: now + 3 * 86_400_000 }] },
    { tool: 'codex', label: 'Codex', state: 'ok', source: 'The limits Codex wrote in its latest session file', updatedAt: now, windows: [{ label: '5-hour session', usedPercent: 84, resetsAt: now + 41 * 60_000 }, { label: 'Weekly', usedPercent: 27, resetsAt: now + 5 * 86_400_000 }] },
    { tool: 'copilot', label: 'GitHub Copilot', state: 'ok', source: 'From GitHub with Copilot\'s sign-in', updatedAt: now, windows: [{ label: 'Premium requests this month', usedPercent: 76, used: 229, limit: 300, resetsAt: now + 9 * 86_400_000 }] },
    { tool: 'cursor', label: 'Cursor', state: 'partial', windows: [], source: '', message: 'Allow Keeper to ask Cursor with its own sign-in to see requests used this month.', updatedAt: now },
    { tool: 'gemini', label: 'Gemini', state: 'none', windows: [], source: '', message: 'Gemini CLI does not keep its limits on this computer; open its usage page instead.', updatedAt: now },
    { tool: 'grok', label: 'Grok', state: 'none', windows: [], source: '', message: 'Grok does not keep its limits on this computer; open its usage page instead.', updatedAt: now },
  ];
  const prices: Record<string, [number, number]> = { AAPL: [231.42, 0.84], MSFT: [418.1, -0.32], NVDA: [142.77, 2.4], BTC: [71234, 1.9], ETH: [3920.5, -1.1], TSLA: [251.3, 3.2] };
  const wait = <T,>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(v), ms));
  return {
    islandTools: {
      exportJson: async () => '/Users/demo/Downloads/Keeper tasks and notes.json',
      store: async () => store,
      saveStore: async (p) => (store = normalizeStore({ ...store, ...p })),
      ask: (prompt, input) => wait({ text: input ? `Here is a tighter version:\n\n${input.split(/\s+/).slice(0, 24).join(' ')}…` : `About “${prompt}”: in the demo, answers come from a sample. In Keeper they come from the AI you connected.`, provider: 'Apple Intelligence (on this Mac)', local: true }, 700),
      askConnections: async () => [{ id: 'apple', label: 'Apple Intelligence (on this Mac)', local: true, ready: true }, { id: 'anthropic', label: 'Claude', local: false, ready: true }],
      usage: () => wait(usage, 300),
      setUsageOnline: async (t, on) => { online = { ...online, [t]: on }; },
      usageOnline: async () => online,
      salesConfig: async () => view(),
      setSalesProvider: async (id) => { providers.add(id); return view(); },
      removeSalesProvider: async (id) => { providers.delete(id); return view(); },
      setSalesPrefs: async (p) => { conf = { ...conf, ...p }; return view(); },
      sales: () => wait({ ...summarize(sales, conf.currency, now), errors: [], fetchedAt: now }, 300),
      rates: async (base) => ({ base, rates: { USD: 1.08, GBP: 0.84, JPY: 162 } }),
      quotes: (symbols) => wait({ quotes: symbols.filter((s) => prices[s]).map((s) => ({ symbol: s, price: prices[s][0], changePct: prices[s][1], source: s === 'BTC' || s === 'ETH' ? 'coingecko' as const : 'stooq' as const, at: now })), errors: [] }, 250),
      chart: async (s) => Array.from({ length: 78 }, (_, i) => ({ t: now - (78 - i) * 300_000, v: (prices[s]?.[0] ?? 100) * (1 + Math.sin(i / 7) * 0.01 + i * 0.0002) })),
      stocksKey: async () => false,
      setStocksKey: async () => true,
      shortcuts: async () => [
        { kind: 'shortcut', id: 'Start my day', name: 'Start my day', detail: 'Shortcut' },
        { kind: 'shortcut', id: 'Log water', name: 'Log water', detail: 'Shortcut' },
        { kind: 'rule', id: 'screenshots-by-month', name: 'File screenshots into monthly folders', detail: 'Automation' },
        { kind: 'script', id: 'deploy', name: 'Deploy site', detail: 'npm run deploy' },
      ],
      runShortcut: async (_k, id) => wait({ ok: true, message: `Ran “${id}”` }, 400),
      importScript: async () => ({ title: 'Imported script', text: 'This text came from a file.' }),
      macEvents: async () => [],
      macReminders: async () => [],
      setMacReminder: async () => true,
    },
  };
}
