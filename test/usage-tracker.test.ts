// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The usage tracker's logic: what counts as running out, used up or about to
// reset unused; the menu-bar label in each mode; the tray ring; subscriptions
// (renewals, reminders, monthly totals, receipts); history and CSV.

import { describe, expect, it } from 'vitest';
import { glanceUsage, renderLabel, renderRing } from '../core/usage-tracker/label';
import { amountText, countdown, defaultTrackerSettings, money, normalizeTrackerSettings, providerInfo, type Account, type AccountState, type Limit, type MenuBarSettings } from '../core/usage-tracker/model';
import { classify, forecastRunOut, prioritize, summarize, transitions } from '../core/usage-tracker/priority';
import { addPoint, compactHistory, dueReminders, historyCsv, monthlyTotals, nextRenewal, receiptFrom, subscriptionLimits } from '../core/usage-tracker/subscriptions';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const H = 3600_000;
const D = 24 * H;
const TH = defaultTrackerSettings().thresholds;

const acct = (id: string, provider: Account['provider'], name: string, extra: Partial<Account> = {}): Account => ({ id, provider, name, createdAt: 0, ...extra });
const st = (id: string, limits: Limit[]): AccountState => ({ accountId: id, at: NOW, state: 'ok', limits, source: '', accuracy: 'exact' });

describe('priority', () => {
  it('running out at the threshold, used up near 100%', () => {
    expect(classify({ key: 'w', label: 'Weekly', usedPercent: 75 }, [], TH, NOW).urgency).toBe('running-out');
    expect(classify({ key: 'w', label: 'Weekly', usedPercent: 69 }, [], TH, NOW).urgency).toBe('ok');
    expect(classify({ key: 'w', label: 'Weekly', usedPercent: 100, resetsAt: NOW + D }, [], TH, NOW)).toMatchObject({ urgency: 'used-up', why: 'Used up until it resets' });
    expect(classify({ key: 'x', label: 'Tokens', used: 5 }, [], TH, NOW).urgency).toBe('ok');
  });

  it('running out when the pace says it runs out before the reset', () => {
    // 65% used three hours into a five-hour window: at that pace it is gone in about 1.6 h, the reset is in 2 h.
    const l: Limit = { key: '5h', label: '5-hour', usedPercent: 65, resetsAt: NOW + 2 * H, windowMs: 5 * H };
    const at = forecastRunOut(l, [], NOW)!;
    expect(at).toBeGreaterThan(NOW);
    expect(at).toBeLessThan(NOW + 2 * H);
    expect(classify(l, [], TH, NOW)).toMatchObject({ urgency: 'running-out', why: 'At this pace it runs out before the reset' });
    expect(classify(l, [], { ...TH, predict: false }, NOW).urgency).toBe('ok');
    // Slow use: lasts to the reset.
    expect(forecastRunOut({ ...l, usedPercent: 20 }, [], NOW)).toBeUndefined();
    // Too early in the window to judge.
    expect(forecastRunOut({ ...l, resetsAt: NOW + 4.5 * H }, [], NOW)).toBeUndefined();
  });

  it('uses recent history for the pace when there is enough', () => {
    const l: Limit = { key: 'w', label: 'Weekly', usedPercent: 50, resetsAt: NOW + 10 * H, windowMs: 7 * D };
    // 10 points in the last hour, rising 20 points: gone in 2.5 h.
    const hist = [{ t: NOW - H, p: 30 }, { t: NOW - 30 * 60_000, p: 40 }, { t: NOW, p: 50 }];
    const at = forecastRunOut(l, hist, NOW)!;
    expect(Math.round((at - NOW) / 60_000)).toBe(150);
  });

  it('expiring: much unused and a long window resetting soon', () => {
    expect(classify({ key: 'w', label: 'Weekly', usedPercent: 20, resetsAt: NOW + 10 * H, windowMs: 7 * D }, [], TH, NOW).urgency).toBe('expiring');
    // A 5-hour window resets all the time: never "expiring".
    expect(classify({ key: '5h', label: '5-hour', usedPercent: 0, resetsAt: NOW + H, windowMs: 5 * H }, [], TH, NOW).urgency).toBe('ok');
    expect(classify({ key: 'w', label: 'Weekly', usedPercent: 20, resetsAt: NOW + 3 * D, windowMs: 7 * D }, [], TH, NOW).urgency).toBe('ok');
  });

  it('sorts running out (least left first), then used up (soonest reset), then expiring; skips hidden limits and paused accounts', () => {
    const accounts = [acct('a', 'cc', 'Work'), acct('b', 'codex', 'Codex', { limits: ['weekly'] }), acct('c', 'openrouter', 'OR', { paused: true })];
    const states = {
      a: st('a', [{ key: '5h', label: '5-hour', usedPercent: 80, resetsAt: NOW + H, windowMs: 5 * H }, { key: 'weekly', label: 'Weekly', usedPercent: 100, resetsAt: NOW + 22 * H, windowMs: 7 * D }]),
      b: st('b', [{ key: '5h', label: '5-hour', usedPercent: 99 }, { key: 'weekly', label: 'Weekly', usedPercent: 90, resetsAt: NOW + 2 * D, windowMs: 7 * D }]),
      c: st('c', [{ key: 'credits', label: 'Credits', usedPercent: 99 }]),
    };
    const items = prioritize(accounts, states, {}, TH, NOW);
    expect(items.map((i) => `${i.accountId}:${i.limit.key}:${i.urgency}`)).toEqual(['b:weekly:running-out', 'a:5h:running-out', 'a:weekly:used-up']);
    expect(items[0]).toMatchObject({ glyph: 'CX', accountName: 'Codex', color: providerInfo('codex').color });
    const s = summarize(items);
    expect(s.allClear).toBe(false);
    expect(s.usedUp).toHaveLength(1);
    expect(summarize([]).allClear).toBe(true);
  });

  it('a window whose reset has passed counts as fresh until the next look', () => {
    const items = prioritize([acct('a', 'codex', 'X')], { a: st('a', [{ key: '5h', label: '5-hour', usedPercent: 100, resetsAt: NOW - 10 * 60_000, windowMs: 5 * H }]) }, {}, TH, NOW);
    expect(items[0]).toMatchObject({ urgency: 'ok', left: 100 });
    expect(items[0].limit.resetsAt).toBe(NOW - 10 * 60_000 + 5 * H);
  });

  it('notices crossings and resets', () => {
    const items = prioritize([acct('a', 'codex', 'Codex')], { a: st('a', [{ key: 'weekly', label: 'Weekly', usedPercent: 0, resetsAt: NOW + 7 * D, windowMs: 7 * D }, { key: '5h', label: '5-hour', usedPercent: 85 }]) }, {}, TH, NOW);
    const t = transitions({ 'a:weekly': 'used-up', 'a:5h': 'ok' }, items, { 'a:weekly': 0, 'a:5h': 40 });
    expect(t.reset.map((i) => i.limit.key)).toEqual(['weekly']);
    expect(t.crossed.map((i) => i.limit.key)).toEqual(['5h']);
    // First look: nothing to compare with, no warnings.
    expect(transitions({}, items, {})).toEqual({ crossed: [], reset: [] });
  });
});

describe('the short label and the glance card', () => {
  const accounts = [acct('a', 'cc', 'Work'), acct('b', 'codex', 'Codex'), acct('c', 'openrouter', 'OR', { hideInMenuBar: true }), acct('d', 'cc', 'Personal')];
  const states = {
    a: st('a', [{ key: '5h', label: '5-hour', usedPercent: 31, resetsAt: NOW + 2 * H, windowMs: 5 * H }, { key: 'weekly', label: 'Weekly', usedPercent: 75, resetsAt: NOW + 30 * H, windowMs: 7 * D }]),
    b: st('b', [{ key: 'weekly', label: 'Weekly', usedPercent: 100, resetsAt: NOW + 22 * H + 10 * 60_000, windowMs: 7 * D }]),
    c: st('c', [{ key: 'credits', label: 'Credits', usedPercent: 95 }]),
    d: st('d', [{ key: '5h', label: '5-hour', usedPercent: 50, resetsAt: NOW + 3 * H, windowMs: 5 * H }]),
  };
  const items = prioritize(accounts, states, {}, { ...TH, predict: false }, NOW);
  const S: MenuBarSettings = { mode: 'urgent', count: 1, overflow: true, hideWhenClear: false, glyph: true };

  it('most urgent with the provider letters and +N', () => {
    const l = renderLabel(items, S, NOW);
    // Two accounts of one service: each with letters of its own (Work → CW, Personal → CP).
    expect(l.text).toBe('CW 25%  +1');
    expect(l.overflow).toBe(1);
    expect(l.tone).toBe('out');
    expect(l.ring).toBe(25);
    expect(renderLabel(items, { ...S, count: 2 }, NOW).text).toBe('CW 25%  CX 0% · 22h 10m');
    expect(renderLabel(items, { ...S, count: 2, glyph: false, overflow: false }, NOW).text).toBe('25%  0% · 22h 10m');
  });

  it('reset countdowns', () => {
    expect(renderLabel(items, { ...S, mode: 'countdown', count: 2 }, NOW).text).toBe('CW Reset 1d 6h  CX Reset 22h 10m');
  });

  it('icon only', () => {
    const l = renderLabel(items, { ...S, mode: 'icon' }, NOW);
    expect(l).toMatchObject({ visible: true, text: '', parts: [] });
    expect(l.tooltip).toContain('Codex Weekly: used up, resets in 22h 10m');
  });

  it('busy day: always the lowest, one per account first', () => {
    const calm = prioritize(accounts, { a: st('a', [{ key: '5h', label: '5-hour', usedPercent: 31 }]), d: st('d', [{ key: '5h', label: '5-hour', usedPercent: 50 }]) }, {}, TH, NOW);
    expect(renderLabel(calm, { ...S, mode: 'busy', count: 2 }, NOW).text).toBe('CP 50%  CW 69%');
    expect(renderLabel(calm, { ...S, mode: 'urgent' }, NOW).text).toBe('');
  });

  it('nothing when all clear (if chosen); hidden accounts never count', () => {
    const calm = prioritize([accounts[2]], { c: states.c }, {}, TH, NOW);
    expect(renderLabel(calm, { ...S, hideWhenClear: true }, NOW).visible).toBe(false);
    expect(renderLabel([], { ...S, hideWhenClear: false }, NOW)).toMatchObject({ visible: true, text: '', tooltip: 'AI usage: nothing is running out', tone: 'ok' });
  });

  it('the AI usage card in the owl\'s glance', () => {
    expect(glanceUsage(items, S, NOW)).toMatchObject({ value: 'CW 25%  +1', detail: 'Work Weekly, resets in 1d 6h', usedPercent: 75, tone: 'bad' });
    expect(glanceUsage(items, { ...S, mode: 'icon' }, NOW)).toMatchObject({ value: 'Used up', tone: 'bad' });
    const calm = prioritize([accounts[0]], { a: st('a', [{ key: '5h', label: '5-hour', usedPercent: 31 }]) }, {}, TH, NOW);
    expect(glanceUsage(calm, S, NOW)).toMatchObject({ value: 'All clear', detail: 'Lowest: Work 5-hour, 69% left', usedPercent: 31, tone: 'ok' });
    // Only when something runs low, and never for hidden accounts.
    expect(glanceUsage(calm, { ...S, hideWhenClear: true }, NOW)).toBeUndefined();
    expect(glanceUsage(prioritize([accounts[2]], { c: states.c }, {}, TH, NOW), S, NOW)).toBeUndefined();
    expect(glanceUsage([], S, NOW)).toBeUndefined();
  });

  it('draws a ring with the share left', () => {
    const b = renderRing(32, 25, [0, 0, 0, 255], [230, 150, 20, 255]);
    expect(b.width).toBe(32);
    const alpha = (x: number, y: number) => b.data[(y * 32 + x) * 4 + 3];
    const red = (x: number, y: number) => b.data[(y * 32 + x) * 4];
    // Top-right quarter is the share left (accent colour); the bottom is faint.
    expect(red(28, 6)).toBe(230);
    expect(alpha(16, 30)).toBeLessThan(120);
    expect(alpha(16, 30)).toBeGreaterThan(0);
    // The number is drawn in the middle.
    expect(alpha(15, 15) + alpha(14, 15) + alpha(16, 15) + alpha(17, 16)).toBeGreaterThan(0);
  });
});

describe('formatting and settings', () => {
  it('countdowns', () => {
    expect(countdown(5 * D + 2 * H + 59_000)).toBe('5d 2h');
    expect(countdown(22 * H + 10 * 60_000)).toBe('22h 10m');
    expect(countdown(45 * 60_000)).toBe('45m');
    expect(countdown(2 * D)).toBe('2d');
    expect(countdown(10_000)).toBe('now');
  });

  it('amounts', () => {
    expect(amountText({ used: 1_200_000, limit: 5_000_000, unit: 'tokens' })).toBe('1.2M / 5.0M tokens');
    expect(amountText({ used: 12.4, limit: 50, unit: 'usd' })).toBe('$12.40 / $50.00');
    expect(amountText({ used: 340, unit: 'requests' })).toBe('340 requests');
    expect(money(9.5, 'eur')).toBe('€9.50');
    expect(money(9.5, 'CHF')).toBe('9.50 CHF');
  });

  it('settings fall back field by field', () => {
    const s = normalizeTrackerSettings({ thresholds: { lowLeft: 500, predict: 'x' }, menuBar: { mode: 'weird', count: 3 }, apiEveryMin: 1 });
    expect(s.thresholds.lowLeft).toBe(90);
    expect(s.thresholds.predict).toBe(true);
    expect(s.menuBar).toMatchObject({ mode: 'urgent', count: 3 });
    expect(s.apiEveryMin).toBe(5);
    expect(normalizeTrackerSettings(null)).toEqual(defaultTrackerSettings());
  });
});

describe('subscriptions', () => {
  const local = (s: string) => new Date(`${s}T12:00:00`).getTime();
  it('next renewal keeps the day of the month (last day in short months)', () => {
    expect(new Date(nextRenewal({ renews: '2026-01-31', cycle: 'monthly' }, local('2026-11-01'))!).getDate()).toBe(30);
    expect(new Date(nextRenewal({ renews: '2026-01-31', cycle: 'monthly' }, local('2026-12-01'))!).getDate()).toBe(31);
    expect(new Date(nextRenewal({ renews: '2025-03-15', cycle: 'yearly' }, local('2026-11-01'))!).getFullYear()).toBe(2027);
    expect(nextRenewal({ renews: '2026-11-20', cycle: 'weekly' }, local('2026-11-01'))).toBe(new Date(2026, 10, 20).getTime());
    expect(nextRenewal({ renews: 'soon', cycle: 'weekly' }, local('2026-11-01'))).toBeUndefined();
  });

  it('a monthly total per currency, trials not yet charged left out', () => {
    const now = local('2026-11-01');
    expect(monthlyTotals([
      { cost: 20, currency: 'usd', cycle: 'monthly', renews: '2026-11-05', remindDays: 3 },
      { cost: 120, currency: 'USD', cycle: 'yearly', renews: '2026-11-05', remindDays: 3 },
      { cost: 10, currency: 'EUR', cycle: 'weekly', renews: '2026-11-05', remindDays: 3 },
      { cost: 99, currency: 'USD', cycle: 'monthly', renews: '2026-11-05', trialEnds: '2026-11-10', remindDays: 3 },
    ], now)).toEqual({ USD: 30, EUR: 43.33 });
  });

  it('reminders before a renewal or a trial end, each once', () => {
    const now = local('2026-11-01');
    const accounts = [
      acct('s1', 'subscription', 'Chat', { subscription: { cost: 20, currency: 'USD', cycle: 'monthly', renews: '2026-10-03', remindDays: 3 } }),
      acct('s2', 'subscription', 'Images', { subscription: { cost: 10, currency: 'USD', cycle: 'monthly', renews: '2026-11-20', trialEnds: '2026-11-02', remindDays: 2 } }),
      acct('s3', 'subscription', 'Later', { subscription: { cost: 5, currency: 'USD', cycle: 'monthly', renews: '2026-11-25', remindDays: 3 } }),
    ];
    const r = dueReminders(accounts, now);
    expect(r.map((x) => x.key)).toEqual(['renew:s1:2026-11-03', 'trial:s2:2026-11-02']);
    expect(r[0].title).toBe('Chat renews in 2 days');
    expect(r[1].title).toBe('Images: trial ends tomorrow');
  });

  it('an allowance becomes a limit with its reset', () => {
    const now = local('2026-11-10');
    const [q, renew] = subscriptionLimits({ cost: 20, currency: 'USD', cycle: 'monthly', renews: '2026-11-15', remindDays: 3, quota: { amount: 500, unit: 'requests', used: 400, period: 'month', resetDay: 15 } }, now);
    expect(q).toMatchObject({ key: 'quota', label: 'Monthly requests', usedPercent: 80, resetsAt: new Date(2026, 10, 15).getTime() });
    expect(renew).toMatchObject({ key: 'renewal', resetsAt: new Date(2026, 10, 15).getTime(), unit: 'usd' });
  });

  it('receipts from mail: vendor, amount and cycle from the subject and preview only', () => {
    expect(receiptFrom({ id: 'm1', from: 'OpenAI <noreply@tm.openai.com>', subject: 'Your ChatGPT Plus receipt', snippet: 'Total $20.00 per month', date: 1 })).toMatchObject({ vendor: 'OpenAI', amount: 20, currency: 'USD', cycle: 'monthly' });
    expect(receiptFrom({ id: 'm2', from: 'billing@cursor.com', subject: 'Invoice for Cursor Pro', snippet: '€192,00 annual', date: 1 })).toMatchObject({ vendor: 'Cursor', amount: 192, currency: 'EUR', cycle: 'yearly' });
    expect(receiptFrom({ id: 'm3', from: 'friend@example.com', subject: 'Lunch receipt', snippet: '$12.00', date: 1 })).toBeUndefined();
    expect(receiptFrom({ id: 'm4', from: 'OpenAI', subject: 'Welcome', snippet: '$20.00', date: 1 })).toBeUndefined();
  });
});

describe('history and CSV', () => {
  it('one point per 10 minutes unless the value moves; hourly after a week; 90 days kept', () => {
    let pts = addPoint([], { t: NOW - 20 * 60_000, p: 10 }, NOW);
    pts = addPoint(pts, { t: NOW - 15 * 60_000, p: 10 }, NOW);
    expect(pts).toHaveLength(1);
    pts = addPoint(pts, { t: NOW - 14 * 60_000, p: 12 }, NOW);
    expect(pts).toEqual([{ t: NOW - 14 * 60_000, p: 12 }]);
    pts = addPoint(pts, { t: NOW, p: 15 }, NOW);
    expect(pts).toHaveLength(2);
    const old = [{ t: NOW - 100 * D, p: 1 }, { t: NOW - 10 * D, p: 5 }, { t: NOW - 10 * D + 600_000, p: 9 }, { t: NOW - 10 * D + 2 * H, p: 3 }, { t: NOW - H, p: 4 }];
    expect(compactHistory(old, NOW)).toEqual([{ t: NOW - 10 * D, p: 9, u: 0 }, { t: NOW - 10 * D + 2 * H, p: 3 }, { t: NOW - H, p: 4 }]);
  });

  it('exports history and monthly costs', () => {
    const csv = historyCsv([acct('a', 'openrouter', 'Team, "main"')], { 'a:credits': [{ t: NOW, p: 24.8, u: 12.4 }], 'zz:x': [{ t: NOW, p: 1 }] }, { a: { '2026-10': 30, '2026-11': 12.4 } });
    expect(csv.split('\n')[0]).toBe('time,account,service,limit,percent_used,amount_used');
    expect(csv).toContain('2026-11-01T12:00:00.000Z,"Team, ""main""",openrouter,credits,24.8,12.4');
    expect(csv).toContain('2026-10,"Team, ""main""",openrouter,30.00');
    expect(csv).not.toContain('zz');
  });
});

describe('the list of sources', () => {
  it('every unofficial source needs an opt-in that says it may break', async () => {
    const { PROVIDERS, UNOFFICIAL } = await import('../core/usage-tracker/model');
    expect(UNOFFICIAL).toBe('Unofficial; may break');
    for (const p of PROVIDERS.filter((x) => x.unofficial)) {
      expect(p.optIn, p.id).toBeTruthy();
      expect(p.fields).toContain('online');
    }
    expect(PROVIDERS.filter((x) => x.unofficial).map((x) => x.id)).toEqual(['claude-web', 'chatgpt-web', 'copilot', 'cursor']);
    for (const p of PROVIDERS.filter((x) => x.optIn)) expect(p.optIn!.explain, p.id).toMatch(/unofficial|undocumented/i);
  });
});
