// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The AI usage tracker in the browser demo: a few sample accounts, worked out
// with the same code the app uses, and nothing read or sent anywhere.

import type { AccountView, AiUsageApi, UsageOverview } from '../core/api-ai-usage';
import { renderLabel } from '../core/usage-tracker/label';
import { defaultTrackerSettings, newId, normalizeTrackerSettings, type AccountState } from '../core/usage-tracker/model';
import { prioritize, summarize, type HistoryPoint } from '../core/usage-tracker/priority';
import { dueReminders, monthlyTotals, subscriptionLimits } from '../core/usage-tracker/subscriptions';

export function mockAiUsage(): { aiUsage: AiUsageApi } {
  const now = Date.now();
  const H = 3600_000;
  let settings = defaultTrackerSettings();
  let accounts: AccountView[] = [
    { id: 'm1', provider: 'cc', name: 'Work', color: '#d97757', createdAt: now, hasKey: false, statusLine: true, statusLineOn: true },
    { id: 'm2', provider: 'cc', name: 'Personal', createdAt: now, hasKey: false },
    { id: 'm3', provider: 'codex', name: 'Codex', createdAt: now, hasKey: false },
    { id: 'm4', provider: 'openrouter', name: 'OpenRouter', createdAt: now, hasKey: true },
    { id: 'm5', provider: 'subscription', name: 'Design tool', createdAt: now, hasKey: false, subscription: { cost: 20, currency: 'USD', cycle: 'monthly', renews: new Date(now + 2 * 86_400_000).toISOString().slice(0, 10), remindDays: 3 } },
  ];
  const states: Record<string, AccountState> = {
    m1: { accountId: 'm1', at: now, state: 'ok', accuracy: 'exact', source: 'limits from its status line', limits: [{ key: '5h', label: '5-hour', usedPercent: 74, resetsAt: now + 2.2 * H, windowMs: 5 * H }, { key: 'weekly', label: 'Weekly', usedPercent: 31, resetsAt: now + 122 * H, windowMs: 168 * H }] },
    m2: { accountId: 'm2', at: now, state: 'ok', accuracy: 'estimated', source: 'tokens counted', limits: [{ key: '5h', label: '5-hour', used: 1_200_000, unit: 'tokens', estimated: true }, { key: 'weekly', label: 'Last 7 days', used: 9_400_000, unit: 'tokens', estimated: true }] },
    m3: { accountId: 'm3', at: now, state: 'ok', accuracy: 'exact', source: 'limits Codex wrote', limits: [{ key: '5h', label: '5-hour', usedPercent: 100, resetsAt: now + 22 * H, windowMs: 5 * H }, { key: 'weekly', label: 'Weekly', usedPercent: 40, resetsAt: now + 10 * H, windowMs: 168 * H }] },
    m4: { accountId: 'm4', at: now, state: 'ok', accuracy: 'exact', source: 'Its key endpoint', limits: [{ key: 'credits', label: 'Monthly credits', used: 12.4, limit: 50, unit: 'usd', usedPercent: 24.8, resetsAt: now + 9 * 24 * H, windowMs: 30 * 24 * H }] },
  };
  const recent: Record<string, HistoryPoint[]> = { 'm1:5h': Array.from({ length: 24 }, (_, i) => ({ t: now - (24 - i) * 600_000, p: 30 + i * 2 })) };
  const ov = (): UsageOverview => {
    const st = { ...states };
    for (const a of accounts) if (a.subscription) st[a.id] = { accountId: a.id, at: now, state: 'ok', accuracy: 'manual', source: 'Kept by hand', limits: subscriptionLimits(a.subscription, Date.now()) };
    const items = prioritize(accounts, st, recent, settings.thresholds, Date.now());
    return {
      on: true, menuBarOn: true, settings, accounts, states: st, items, summary: summarize(items), label: renderLabel(items, settings.menuBar, Date.now()),
      nextUpdateAt: Date.now() + 120_000, recent, costs: { m4: { [new Date().toISOString().slice(0, 7)]: 12.4 } },
      subscriptions: { monthly: monthlyTotals(accounts.flatMap((a) => (a.subscription ? [a.subscription] : [])), Date.now()), upcoming: dueReminders(accounts, Date.now()) },
      keysInMemory: false,
    };
  };
  return {
    aiUsage: {
      overview: async () => ov(),
      refresh: async () => ov(),
      saveAccount: async (a) => {
        const prev = accounts.find((x) => x.id === a.id);
        const next = { ...(prev ?? { createdAt: Date.now(), hasKey: false }), ...a, id: prev?.id ?? newId('m') } as AccountView;
        accounts = prev ? accounts.map((x) => (x.id === next.id ? next : x)) : [...accounts, next];
        return accounts;
      },
      removeAccount: async (id) => (accounts = accounts.filter((a) => a.id !== id)),
      reorder: async (ids) => (accounts = [...accounts].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))),
      setSettings: async (p) => (settings = normalizeTrackerSettings({ ...settings, ...p, thresholds: { ...settings.thresholds, ...p.thresholds }, menuBar: { ...settings.menuBar, ...p.menuBar }, notify: { ...settings.notify, ...p.notify } })),
      history: async () => recent,
      exportCsv: async () => ({ rows: 0 }),
      detect: async () => [],
      setStatusLine: async () => ({ ok: false, message: 'Not in the demo' }),
      scanReceipts: async () => [],
      showPopover: async () => undefined,
      closePopover: async () => undefined,
      openPage: async () => undefined,
      trayState: async () => ({ visible: true, text: ov().label.text, tooltip: ov().label.tooltip }),
    },
  };
}
