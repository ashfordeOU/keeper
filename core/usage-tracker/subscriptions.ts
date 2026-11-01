// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Subscriptions kept by hand: when each renews next, reminders before a
// renewal or a trial ends, what they cost a month together, their usage
// allowance as a limit, and receipts recognised in mail (structured fields
// only). Also the history kept for sparklines and the CSV export. Pure.

import type { Account, Cycle, Limit, Subscription } from './model';
import type { HistoryPoint } from './priority';

const D = 86_400_000;

/** YYYY-MM-DD in local time. */
export const ymd = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const parseDay = (s: string): number | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : undefined;
};

function addCycle(t: number, c: Cycle, n = 1): number {
  const d = new Date(t);
  if (c === 'weekly') return t + 7 * D * n;
  const months = c === 'monthly' ? 1 : c === 'quarterly' ? 3 : 12;
  const day = d.getDate();
  const next = new Date(d.getFullYear(), d.getMonth() + months * n, 1);
  // The 31st renews on the last day of shorter months.
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, last));
  return next.getTime();
}

/** The next renewal on or after today (the stored date may be in the past). */
export function nextRenewal(s: Pick<Subscription, 'renews' | 'cycle'>, now: number): number | undefined {
  const start = parseDay(s.renews);
  if (start === undefined) return undefined;
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (start >= today) return start;
  // Count cycles from the original date so the day of month is kept.
  for (let n = 1; n < 2000; n++) {
    const t = addCycle(start, s.cycle, n);
    if (t >= today) return t;
  }
  return undefined;
}

export const MONTHLY_FACTOR: Record<Cycle, number> = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

/** What all subscriptions cost a month, per currency (trials not yet charged are left out). */
export function monthlyTotals(subs: Subscription[], now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of subs) {
    const trial = s.trialEnds ? parseDay(s.trialEnds) : undefined;
    if (trial !== undefined && trial > now) continue;
    const cur = (s.currency || 'USD').toUpperCase();
    out[cur] = Math.round(((out[cur] ?? 0) + s.cost * MONTHLY_FACTOR[s.cycle]) * 100) / 100;
  }
  return out;
}

export interface Reminder {
  /** unique per occurrence, so each is sent once */
  key: string;
  accountId: string;
  title: string;
  body: string;
  at: number;
}

/** Renewals and trial ends within each subscription's reminder window. */
export function dueReminders(accounts: Account[], now: number): Reminder[] {
  const out: Reminder[] = [];
  for (const a of accounts) {
    const s = a.subscription;
    if (!s || a.paused) continue;
    const days = Math.max(0, s.remindDays ?? 3);
    const trial = s.trialEnds ? parseDay(s.trialEnds) : undefined;
    if (trial !== undefined && trial >= new Date(now).setHours(0, 0, 0, 0) && trial - now <= days * D) {
      out.push({ key: `trial:${a.id}:${s.trialEnds}`, accountId: a.id, title: `${a.name}: trial ends ${whenText(trial, now)}`, body: `It becomes ${money(s)} a ${cycleWord(s.cycle)} unless you cancel.`, at: trial });
      continue;
    }
    const next = nextRenewal(s, now);
    if (next !== undefined && next - now <= days * D) out.push({ key: `renew:${a.id}:${ymd(next)}`, accountId: a.id, title: `${a.name} renews ${whenText(next, now)}`, body: `${money(s)} for another ${cycleWord(s.cycle)}.`, at: next });
  }
  return out;
}

const cycleWord = (c: Cycle) => (c === 'weekly' ? 'week' : c === 'monthly' ? 'month' : c === 'quarterly' ? 'quarter' : 'year');
const money = (s: Subscription) => `${s.cost.toFixed(2)} ${s.currency.toUpperCase()}`;
function whenText(t: number, now: number): string {
  const days = Math.round((t - new Date(now).setHours(0, 0, 0, 0)) / D);
  return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** A subscription's allowance and renewal as limits, for the pop-over and the warnings. */
export function subscriptionLimits(s: Subscription, now: number): Limit[] {
  const out: Limit[] = [];
  if (s.quota && s.quota.amount > 0) {
    const q = s.quota;
    const d = new Date(now);
    const resetsAt = q.period === 'day' ? new Date(now).setHours(24, 0, 0, 0)
      : q.period === 'week' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + ((8 - d.getDay()) % 7 || 7)).getTime()
        : (() => { const day = Math.min(28, Math.max(1, q.resetDay ?? 1)); const t = new Date(d.getFullYear(), d.getMonth(), day).getTime(); return t > now ? t : new Date(d.getFullYear(), d.getMonth() + 1, day).getTime(); })();
    const windowMs = q.period === 'day' ? D : q.period === 'week' ? 7 * D : 30 * D;
    out.push({ key: 'quota', label: `${q.period === 'day' ? 'Daily' : q.period === 'week' ? 'Weekly' : 'Monthly'} ${q.unit}`, used: q.used, limit: q.amount, unit: q.unit, usedPercent: Math.max(0, Math.min(100, (q.used / q.amount) * 100)), resetsAt, windowMs });
  }
  const next = nextRenewal(s, now);
  out.push({ key: 'renewal', label: 'Renews', used: s.cost, unit: s.currency.toUpperCase() === 'USD' ? 'usd' : s.currency.toUpperCase(), resetsAt: next, note: s.trialEnds && (parseDay(s.trialEnds) ?? 0) > now ? `Trial until ${s.trialEnds}` : undefined });
  return out;
}

// ---------------------------------------------------------------- receipts in mail (structured fields only)

export interface ReceiptGuess {
  vendor: string;
  amount: number;
  currency: string;
  date: number;
  cycle?: Cycle;
  messageId: string;
}

const VENDORS: [RegExp, string][] = [
  [/anthropic/i, 'Anthropic'], [/openai|chatgpt/i, 'OpenAI'], [/github/i, 'GitHub'], [/cursor|anysphere/i, 'Cursor'],
  [/x\.ai|xai\b/i, 'xAI'], [/mistral/i, 'Mistral'], [/openrouter/i, 'OpenRouter'], [/deepseek/i, 'DeepSeek'], [/google/i, 'Google'],
  [/perplexity/i, 'Perplexity'], [/groq/i, 'Groq'], [/windsurf|codeium/i, 'Windsurf'], [/jetbrains/i, 'JetBrains'], [/midjourney/i, 'Midjourney'],
];

/** A receipt from a message's sender, subject and preview: vendor, amount and date only. */
export function receiptFrom(m: { id: string; from?: string; subject: string; snippet?: string; date: number }): ReceiptGuess | undefined {
  const head = `${m.subject} ${m.snippet ?? ''}`;
  if (!/receipt|invoice|payment|your .*(plan|subscription)|renew/i.test(m.subject)) return undefined;
  const vendor = VENDORS.find(([r]) => r.test(m.from ?? '') || r.test(m.subject))?.[1];
  if (!vendor) return undefined;
  const am = /(US\$|\$|€|£|USD|EUR|GBP)\s?(\d{1,5}(?:[.,]\d{2})?)|(\d{1,5}(?:[.,]\d{2}))\s?(USD|EUR|GBP|€)/i.exec(head);
  if (!am) return undefined;
  const sym = (am[1] ?? am[4] ?? '$').toUpperCase();
  const currency = sym.includes('€') || sym === 'EUR' ? 'EUR' : sym.includes('£') || sym === 'GBP' ? 'GBP' : 'USD';
  const amount = Number((am[2] ?? am[3]).replace(',', '.'));
  const cycle: Cycle | undefined = /annual|yearly|per year|\/yr/i.test(head) ? 'yearly' : /monthly|per month|\/mo/i.test(head) ? 'monthly' : undefined;
  return { vendor, amount, currency, date: m.date, cycle, messageId: m.id };
}

// ---------------------------------------------------------------- history for sparklines

/** Adds a point (at most one per 10 minutes unless the value moved), keeps ~90 days: 10-minute detail for a week, hourly after. */
export function addPoint(points: HistoryPoint[], p: HistoryPoint, now: number): HistoryPoint[] {
  const last = points[points.length - 1];
  let out = points;
  if (last && p.t - last.t < 10 * 60_000) {
    if (last.p === p.p && last.u === p.u) return points;
    out = [...points.slice(0, -1), p];
  } else out = [...points, p];
  return compactHistory(out, now);
}

export function compactHistory(points: HistoryPoint[], now: number): HistoryPoint[] {
  const cutoff = now - 90 * D;
  const fine = now - 7 * D;
  const out: HistoryPoint[] = [];
  let hour = -1;
  for (const p of points) {
    if (p.t < cutoff) continue;
    if (p.t >= fine) { out.push(p); continue; }
    const h = Math.floor(p.t / 3600_000);
    // Older points: the highest reading in each hour.
    if (h === hour) {
      const prev = out[out.length - 1];
      if ((p.p ?? -1) > (prev.p ?? -1) || (p.u ?? -1) > (prev.u ?? -1)) out[out.length - 1] = { t: prev.t, p: Math.max(prev.p ?? 0, p.p ?? 0), u: Math.max(prev.u ?? 0, p.u ?? 0) };
    } else {
      hour = h;
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------- CSV

const cell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function historyCsv(accounts: Account[], history: Record<string, HistoryPoint[]>, costs: Record<string, Record<string, number>>): string {
  const rows = [['time', 'account', 'service', 'limit', 'percent_used', 'amount_used'].join(',')];
  for (const [k, pts] of Object.entries(history)) {
    const [id, ...rest] = k.split(':');
    const a = accounts.find((x) => x.id === id);
    if (!a) continue;
    for (const p of pts) rows.push([new Date(p.t).toISOString(), a.name, a.provider, rest.join(':'), p.p?.toFixed(1), p.u].map(cell).join(','));
  }
  rows.push('');
  rows.push(['month', 'account', 'service', 'usd'].join(','));
  for (const [id, months] of Object.entries(costs)) {
    const a = accounts.find((x) => x.id === id);
    if (!a) continue;
    for (const [m, usd] of Object.entries(months).sort()) rows.push([m, a.name, a.provider, usd.toFixed(2)].map(cell).join(','));
  }
  return rows.join('\n') + '\n';
}
