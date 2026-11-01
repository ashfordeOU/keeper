// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Which limits need attention, in what order: running out (little left, or
// the pace says it runs out before the reset), used up (waiting for the
// reset), and expiring (much left and it resets soon: use it before it
// goes). Pure: give it accounts, their latest limits and recent history.

import { percentLeft, providerInfo, type Account, type AccountState, type Limit, type Thresholds } from './model';

export type Urgency = 'used-up' | 'running-out' | 'expiring' | 'ok';

export interface PriorityItem {
  accountId: string;
  accountName: string;
  provider: Account['provider'];
  glyph: string;
  color: string;
  icon?: string;
  hideInMenuBar: boolean;
  limit: Limit;
  left?: number;
  urgency: Urgency;
  /** when the pace says it runs out (only when that is before the reset) */
  runsOutAt?: number;
  /** why, in plain words */
  why: string;
}

export interface HistoryPoint {
  t: number;
  /** percent used */
  p?: number;
  /** amount used */
  u?: number;
}

/**
 * When the limit runs out at the current pace, or undefined if it lasts to the reset.
 * Uses recent history (the last two hours in this window) when there is enough of it,
 * else the average pace since the window began.
 */
export function forecastRunOut(l: Limit, history: HistoryPoint[], now: number): number | undefined {
  if (l.usedPercent === undefined || !l.resetsAt || l.resetsAt <= now || l.usedPercent >= 100) return undefined;
  const used = l.usedPercent;
  let perMs: number | undefined;
  const start = l.windowMs ? l.resetsAt - l.windowMs : undefined;
  const recent = history.filter((h) => h.p !== undefined && h.t >= now - 2 * 3600_000 && (start === undefined || h.t >= start)).sort((a, b) => a.t - b.t);
  if (recent.length >= 2 && recent[recent.length - 1].t - recent[0].t >= 10 * 60_000) {
    const a = recent[0];
    const b = recent[recent.length - 1];
    const d = (b.p! - a.p!) / (b.t - a.t);
    if (d > 0) perMs = d;
  }
  if (perMs === undefined && start !== undefined && l.windowMs) {
    const elapsed = now - start;
    // Too early in the window to judge the pace.
    if (elapsed >= l.windowMs * 0.15 && used > 0) perMs = used / elapsed;
  }
  if (!perMs) return undefined;
  const at = now + (100 - used) / perMs;
  return at < l.resetsAt ? at : undefined;
}

export function classify(l: Limit, history: HistoryPoint[], th: Thresholds, now: number): { urgency: Urgency; runsOutAt?: number; why: string } {
  const left = percentLeft(l);
  if (left === undefined) return { urgency: 'ok', why: '' };
  if (l.usedPercent! >= th.usedUp) return { urgency: 'used-up', why: l.resetsAt ? 'Used up until it resets' : 'Used up' };
  if (left <= th.lowLeft) return { urgency: 'running-out', why: `${Math.round(left)}% left` };
  if (th.predict) {
    const at = forecastRunOut(l, history, now);
    if (at) return { urgency: 'running-out', runsOutAt: at, why: 'At this pace it runs out before the reset' };
  }
  const windowH = (l.windowMs ?? 0) / 3600_000;
  if (l.resetsAt && l.resetsAt > now && l.resetsAt - now <= th.expiringHours * 3600_000 && left >= th.expiringLeft && windowH >= th.expiringMinWindowHours) {
    return { urgency: 'expiring', why: 'Unused allowance resets soon' };
  }
  return { urgency: 'ok', why: '' };
}

const ORDER: Record<Urgency, number> = { 'running-out': 0, 'used-up': 1, expiring: 2, ok: 3 };

/** Every shown limit of every account, classified and sorted most urgent first. */
export function prioritize(accounts: Account[], states: Record<string, AccountState | undefined>, history: Record<string, HistoryPoint[]>, th: Thresholds, now: number): PriorityItem[] {
  const out: PriorityItem[] = [];
  for (const a of accounts) {
    const s = states[a.id];
    if (!s || a.paused) continue;
    const info = providerInfo(a.provider);
    for (const l of s.limits) {
      if (a.limits && !a.limits.includes(l.key)) continue;
      // A limit whose window has passed: treat it as fresh until the next look.
      const stale = l.resetsAt !== undefined && l.resetsAt <= now;
      const lim = stale ? { ...l, usedPercent: l.usedPercent === undefined ? undefined : 0, used: l.used === undefined ? undefined : 0, resetsAt: l.windowMs ? l.resetsAt! + Math.ceil((now - l.resetsAt!) / l.windowMs) * l.windowMs : undefined } : l;
      const c = classify(lim, history[`${a.id}:${l.key}`] ?? [], th, now);
      out.push({ accountId: a.id, accountName: a.name, provider: a.provider, glyph: info.glyph, color: a.color ?? info.color, icon: a.icon, hideInMenuBar: !!a.hideInMenuBar, limit: lim, left: percentLeft(lim), urgency: c.urgency, runsOutAt: c.runsOutAt, why: c.why });
    }
  }
  return out.sort((x, y) => ORDER[x.urgency] - ORDER[y.urgency]
    // Running out: least left first (a forecast with time to spare after the real lows).
    || (x.urgency === 'running-out' ? (x.left ?? 100) - (y.left ?? 100) : 0)
    // Used up and expiring: soonest reset first.
    || ((x.limit.resetsAt ?? Infinity) - (y.limit.resetsAt ?? Infinity))
    || (x.left ?? 100) - (y.left ?? 100));
}

export interface PrioritySummary {
  runningOut: PriorityItem[];
  usedUp: PriorityItem[];
  expiring: PriorityItem[];
  allClear: boolean;
}

export function summarize(items: PriorityItem[]): PrioritySummary {
  const runningOut = items.filter((i) => i.urgency === 'running-out');
  const usedUp = items.filter((i) => i.urgency === 'used-up');
  return { runningOut, usedUp, expiring: items.filter((i) => i.urgency === 'expiring'), allClear: !runningOut.length && !usedUp.length };
}

/** Limits that crossed into running out or used up since the last look, and ones that reset. */
export function transitions(prev: Record<string, Urgency>, items: PriorityItem[], prevLeft: Record<string, number | undefined>): { crossed: PriorityItem[]; reset: PriorityItem[] } {
  const crossed: PriorityItem[] = [];
  const reset: PriorityItem[] = [];
  for (const i of items) {
    const k = `${i.accountId}:${i.limit.key}`;
    const was = prev[k];
    if (was === undefined) continue;
    if ((i.urgency === 'running-out' || i.urgency === 'used-up') && was !== i.urgency && !(was === 'used-up' && i.urgency === 'running-out')) crossed.push(i);
    const before = prevLeft[k];
    // A reset: it was used up or low and now has (nearly) everything back.
    if ((was === 'used-up' || was === 'running-out') && i.urgency !== 'used-up' && i.urgency !== 'running-out' && (i.left ?? 0) >= 90 && (before === undefined || (i.left ?? 0) > before)) reset.push(i);
  }
  return { crossed, reset };
}
