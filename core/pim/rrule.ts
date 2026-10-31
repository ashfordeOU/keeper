// SPDX-License-Identifier: AGPL-3.0-or-later
// Repeating events (RFC 5545 RRULE): daily, weekly, monthly and yearly rules
// with intervals, counts, end dates, weekdays (also "second Tuesday", "last
// Friday"), days of the month, months and set positions. Expansion happens on
// the wall clock of the event's time zone, so a 9:00 meeting stays at 9:00
// across daylight-saving changes.

import { addDays, daysIn, fromWall, toWall, weekday, type Wall } from './tz';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RRule {
  freq: Freq;
  interval: number;
  count?: number;
  /** last possible start (instant) */
  until?: number;
  /** weekday (0 = Sunday) with an optional position (2 = second, -1 = last) */
  byDay?: { day: number; n?: number }[];
  byMonthDay?: number[];
  /** 1–12 */
  byMonth?: number[];
  bySetPos?: number[];
  /** week start, 0 = Sunday (default Monday) */
  wkst: number;
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Reads "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10" (an optional "RRULE:" in front is fine). */
export function parseRRule(text: string, parseUntil: (v: string) => number | undefined = defaultUntil): RRule | null {
  const parts = Object.fromEntries(
    text.replace(/^RRULE:/i, '').split(';').filter(Boolean).map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).toUpperCase(), p.slice(i + 1)];
    }),
  );
  const freq = (parts.FREQ ?? '').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const nums = (v?: string) => (v ? v.split(',').map(Number).filter((n) => Number.isFinite(n) && n !== 0) : undefined);
  const rule: RRule = { freq: freq as Freq, interval: Math.max(1, Number(parts.INTERVAL) || 1), wkst: parts.WKST ? Math.max(0, DAYS.indexOf(parts.WKST.toUpperCase())) : 1 };
  if (parts.COUNT) rule.count = Math.max(0, Number(parts.COUNT) || 0);
  if (parts.UNTIL) rule.until = parseUntil(parts.UNTIL);
  if (parts.BYDAY) {
    const days: { day: number; n?: number }[] = [];
    for (const d of parts.BYDAY.split(',')) {
      const m = d.trim().toUpperCase().match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/);
      if (m) days.push({ day: DAYS.indexOf(m[2]), n: m[1] ? Number(m[1]) : undefined });
    }
    rule.byDay = days;
  }
  rule.byMonthDay = nums(parts.BYMONTHDAY);
  rule.byMonth = nums(parts.BYMONTH);
  rule.bySetPos = nums(parts.BYSETPOS);
  return rule;
}

function defaultUntil(v: string): number | undefined {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return undefined;
  if (!m[4]) return new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59).getTime();
  if (m[7]) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

export function formatRRule(r: RRule): string {
  const out = [`FREQ=${r.freq}`];
  if (r.interval > 1) out.push(`INTERVAL=${r.interval}`);
  if (r.count) out.push(`COUNT=${r.count}`);
  if (r.until !== undefined) out.push(`UNTIL=${new Date(r.until).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
  if (r.byDay?.length) out.push(`BYDAY=${r.byDay.map((d) => `${d.n ?? ''}${DAYS[d.day]}`).join(',')}`);
  if (r.byMonthDay?.length) out.push(`BYMONTHDAY=${r.byMonthDay.join(',')}`);
  if (r.byMonth?.length) out.push(`BYMONTH=${r.byMonth.join(',')}`);
  if (r.bySetPos?.length) out.push(`BYSETPOS=${r.bySetPos.join(',')}`);
  if (r.wkst !== 1) out.push(`WKST=${DAYS[r.wkst]}`);
  return out.join(';');
}

type Day = { y: number; mo: number; d: number };

/** Days of a month that match the rule's BYMONTHDAY / BYDAY parts. */
function monthCandidates(r: RRule, y: number, mo: number, start: Wall): Day[] {
  const dim = daysIn(y, mo);
  let days: number[];
  if (r.byMonthDay?.length) {
    days = r.byMonthDay.map((n) => (n > 0 ? n : dim + n + 1)).filter((n) => n >= 1 && n <= dim);
  } else if (r.byDay?.length) {
    days = [];
  } else {
    days = start.d <= dim ? [start.d] : [];
  }
  if (r.byDay?.length) {
    const match: number[] = [];
    for (const bd of r.byDay) {
      const all: number[] = [];
      for (let d = 1; d <= dim; d++) if (weekday(y, mo, d) === bd.day) all.push(d);
      if (bd.n === undefined) match.push(...all);
      else {
        const pick = bd.n > 0 ? all[bd.n - 1] : all[all.length + bd.n];
        if (pick) match.push(pick);
      }
    }
    days = r.byMonthDay?.length ? days.filter((d) => match.includes(d)) : match;
  }
  return [...new Set(days)].sort((a, b) => a - b).map((d) => ({ y, mo, d }));
}

function setPos<T>(list: T[], pos?: number[]): T[] {
  if (!pos?.length) return list;
  const out: T[] = [];
  for (const p of pos) {
    const v = p > 0 ? list[p - 1] : list[list.length + p];
    if (v !== undefined && !out.includes(v)) out.push(v);
  }
  return out;
}

/** The days each period contributes, in order. */
function periodDays(r: RRule, k: number, start: Wall): Day[] {
  if (r.freq === 'DAILY') {
    const w = addDays(start, k * r.interval);
    const day = { y: w.y, mo: w.mo, d: w.d };
    if (r.byMonth?.length && !r.byMonth.includes(day.mo)) return [];
    if (r.byMonthDay?.length) {
      const dim = daysIn(day.y, day.mo);
      if (!r.byMonthDay.some((n) => (n > 0 ? n : dim + n + 1) === day.d)) return [];
    }
    if (r.byDay?.length && !r.byDay.some((b) => b.day === weekday(day.y, day.mo, day.d))) return [];
    return [day];
  }
  if (r.freq === 'WEEKLY') {
    // The week containing the start, moved on by whole weeks.
    const back = (weekday(start.y, start.mo, start.d) - r.wkst + 7) % 7;
    const weekStart = addDays(start, -back + k * 7 * r.interval);
    const wanted = r.byDay?.length ? r.byDay.map((b) => b.day) : [weekday(start.y, start.mo, start.d)];
    const out: Day[] = [];
    for (let i = 0; i < 7; i++) {
      const w = addDays(weekStart, i);
      if (!wanted.includes(weekday(w.y, w.mo, w.d))) continue;
      if (r.byMonth?.length && !r.byMonth.includes(w.mo)) continue;
      out.push({ y: w.y, mo: w.mo, d: w.d });
    }
    return setPos(out, r.bySetPos);
  }
  if (r.freq === 'MONTHLY') {
    const total = start.mo - 1 + k * r.interval;
    const y = start.y + Math.floor(total / 12);
    const mo = (total % 12) + 1;
    if (r.byMonth?.length && !r.byMonth.includes(mo)) return [];
    return setPos(monthCandidates(r, y, mo, start), r.bySetPos);
  }
  const y = start.y + k * r.interval;
  const months = r.byMonth?.length ? [...r.byMonth].sort((a, b) => a - b) : [start.mo];
  const out: Day[] = [];
  for (const mo of months) out.push(...monthCandidates(r, y, mo, start));
  return setPos(out, r.bySetPos);
}

/**
 * Start instants of a repeating event that fall in [from, to), in order.
 * `dtstart` is the first start; `tz` the zone it repeats in (local when absent);
 * `exdates` are cancelled starts. At most `limit` results.
 */
export function expand(rule: RRule, dtstart: number, tz: string | undefined, from: number, to: number, exdates: number[] = [], limit = 2000): number[] {
  const start = toWall(dtstart, tz);
  const ex = new Set(exdates);
  const out: number[] = [];
  let produced = 0;
  // Enough periods for decades of daily events; the loop stops much earlier normally.
  for (let k = 0; k < 50_000; k++) {
    const days = periodDays(rule, k, start);
    let pastEnd = false;
    for (const day of days) {
      const t = fromWall({ ...day, h: start.h, mi: start.mi, s: start.s }, tz);
      if (t < dtstart) continue;
      if (rule.until !== undefined && t > rule.until) { pastEnd = true; break; }
      produced++;
      if (rule.count !== undefined && produced > rule.count) { pastEnd = true; break; }
      if (t >= to) { pastEnd = true; break; }
      if (t >= from && !ex.has(t)) {
        out.push(t);
        if (out.length >= limit) return out;
      }
    }
    if (pastEnd) break;
    // A period that starts after `to` cannot produce anything earlier.
    if (!days.length && periodStartAfter(rule, k, start, to, tz)) break;
  }
  return out;
}

function periodStartAfter(r: RRule, k: number, start: Wall, to: number, tz?: string): boolean {
  const months = r.freq === 'YEARLY' ? k * r.interval * 12 : r.freq === 'MONTHLY' ? k * r.interval : 0;
  const days = r.freq === 'WEEKLY' ? k * 7 * r.interval : r.freq === 'DAILY' ? k * r.interval : 0;
  let w = addDays(start, days);
  if (months) {
    const total = start.mo - 1 + months;
    w = { ...w, y: start.y + Math.floor(total / 12), mo: (total % 12) + 1, d: 1 };
  }
  return fromWall({ ...w, h: 0, mi: 0, s: 0 }, tz) > to;
}

/** "Every 2 weeks on Monday and Wednesday, 10 times" */
export function describeRRule(r: RRule): string {
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[r.freq];
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ord = (n: number) => (n === -1 ? 'last' : ['', 'first', 'second', 'third', 'fourth', 'fifth'][n] ?? `${n}th`);
  let s = r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`;
  if (r.freq === 'DAILY' && r.byDay?.length === 5 && [1, 2, 3, 4, 5].every((d) => r.byDay!.some((b) => b.day === d))) s = 'Every weekday';
  else if (r.byDay?.length) s += ' on ' + r.byDay.map((b) => (b.n ? `the ${ord(b.n)} ${names[b.day]}` : names[b.day])).join(', ').replace(/, ([^,]*)$/, ' and $1');
  if (r.byMonthDay?.length) s += ` on day ${r.byMonthDay.join(', ')}`;
  if (r.count) s += `, ${r.count} times`;
  if (r.until) s += `, until ${new Date(r.until).toLocaleDateString()}`;
  return s;
}
