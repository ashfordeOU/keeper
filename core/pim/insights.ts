// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Insights: a small log, kept on this computer, of tasks finished and focus
// sessions, and what it adds up to: done today and this week, minutes of
// focus, and the hours of the day the person gets most done.

import { addDays, dayKey, dayStart, weekDays } from './tasks';

export interface LogEntry {
  kind: 'task' | 'focus';
  /** when it ended (a task: when it was checked off) */
  at: number;
  /** focus: how long */
  minutes?: number;
  taskId?: string;
  title?: string;
}

/** Kept for this long, and at most this many entries. */
export const LOG_DAYS = 120;
export const LOG_MAX = 5000;

export function addLog(log: LogEntry[], e: LogEntry, now = Date.now()): LogEntry[] {
  const keepFrom = now - LOG_DAYS * 86_400_000;
  const next = [...log.filter((x) => x.at >= keepFrom), e];
  return next.length > LOG_MAX ? next.slice(next.length - LOG_MAX) : next;
}

export interface DayTotal {
  day: string;
  tasks: number;
  focusMin: number;
}

export interface Insights {
  today: DayTotal;
  week: { tasks: number; focusMin: number };
  /** the last seven days, oldest first */
  days: DayTotal[];
  /** activity per hour of day (0–23) over the last four weeks: focus minutes, plus 10 for each task done */
  hours: number[];
  /** the busiest hours, best first (at most three, none when there is nothing yet) */
  peak: number[];
  /** days in a row (up to today) with something done */
  streak: number;
}

/** Spreads a focus session over the clock hours it covered. */
function spread(hours: number[], end: number, minutes: number) {
  let t = end - minutes * 60_000;
  while (t < end - 1) {
    const d = new Date(t);
    const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    const stop = Math.min(end, nextHour);
    hours[d.getHours()] += (stop - t) / 60_000;
    t = stop;
  }
}

export function insights(log: LogEntry[], now = Date.now(), weekStart = 1): Insights {
  const today = dayKey(now);
  const week = new Set(weekDays(today, weekStart));
  const per = new Map<string, DayTotal>();
  const total = (day: string) => {
    let d = per.get(day);
    if (!d) per.set(day, (d = { day, tasks: 0, focusMin: 0 }));
    return d;
  };
  const hours = Array<number>(24).fill(0);
  const since = dayStart(addDays(today, -27));
  for (const e of log) {
    if (e.at > now) continue;
    const d = total(dayKey(e.at));
    if (e.kind === 'task') d.tasks++;
    else d.focusMin += Math.max(0, e.minutes ?? 0);
    if (e.at >= since) {
      if (e.kind === 'task') hours[new Date(e.at).getHours()] += 10;
      else spread(hours, e.at, Math.max(0, e.minutes ?? 0));
    }
  }
  const days = Array.from({ length: 7 }, (_, i) => per.get(addDays(today, i - 6)) ?? { day: addDays(today, i - 6), tasks: 0, focusMin: 0 });
  let wk = { tasks: 0, focusMin: 0 };
  for (const [day, d] of per) if (week.has(day)) wk = { tasks: wk.tasks + d.tasks, focusMin: wk.focusMin + d.focusMin };
  const peak = hours.map((v, h) => ({ v, h })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v || a.h - b.h).slice(0, 3).map((x) => x.h);
  let streak = 0;
  // Today counts once something is done; an empty today does not break yesterday's streak.
  for (let i = 0, d = today; i < 400; i++, d = addDays(d, -1)) {
    const t = per.get(d);
    if (t && (t.tasks || t.focusMin)) streak++;
    else if (i > 0) break;
  }
  return { today: per.get(today) ?? { day: today, tasks: 0, focusMin: 0 }, week: { tasks: wk.tasks, focusMin: Math.round(wk.focusMin) }, days, hours: hours.map((v) => Math.round(v)), peak, streak };
}

/** "9–10 am" */
export function hourLabel(h: number): string {
  const f = (x: number) => new Date(2000, 0, 1, x % 24).toLocaleTimeString([], { hour: 'numeric' });
  return `${f(h)}–${f(h + 1)}`;
}
