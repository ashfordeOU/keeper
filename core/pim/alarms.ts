// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// When alarms, reminders and event alerts ring. One timer in the main process
// waits for the earliest; after sleep or a clock change it asks again, rings
// what was missed by a little (late, once), and skips what is long gone.

import type { Alarm, CalEvent, CountdownTimer, Occurrence, Reminder } from './types';

/** Missed by less than this (asleep, busy), it still rings, late. */
export const GRACE_MS = 15 * 60_000;

function parseTime(t: string): { h: number; m: number } {
  const [h, m] = t.split(':').map(Number);
  return { h: Math.min(23, Math.max(0, h || 0)), m: Math.min(59, Math.max(0, m || 0)) };
}

/** The next time an alarm rings at or after `from` (undefined: never again). */
export function nextAlarmTime(a: Alarm, from: number): number | undefined {
  if (!a.enabled) return undefined;
  if (a.snoozedUntil && a.snoozedUntil >= from) return a.snoozedUntil;
  const { h, m } = parseTime(a.time);
  if (!a.days.length) {
    const base = a.date ? new Date(`${a.date}T00:00:00`) : new Date(from);
    const t = new Date(base);
    t.setHours(h, m, 0, 0);
    if (!a.date && t.getTime() < from) t.setDate(t.getDate() + 1);
    if (t.getTime() < from || (a.lastFired && a.lastFired >= t.getTime())) return undefined;
    return t.getTime();
  }
  const t = new Date(from);
  t.setHours(h, m, 0, 0);
  for (let i = 0; i < 8; i++) {
    const c = new Date(t);
    c.setDate(t.getDate() + i);
    c.setHours(h, m, 0, 0);
    if (c.getTime() >= from && a.days.includes(c.getDay() as Alarm['days'][number]) && !(a.lastFired && a.lastFired >= c.getTime())) return c.getTime();
  }
  return undefined;
}

export type Due =
  | { kind: 'alarm'; id: string; at: number; title: string; late: boolean }
  | { kind: 'event'; id: string; at: number; title: string; late: boolean; start: number; location?: string; url?: string }
  | { kind: 'reminder'; id: string; at: number; title: string; late: boolean }
  | { kind: 'timer'; id: string; at: number; title: string; late: boolean };

export interface ScheduleInput {
  alarms: Alarm[];
  /** occurrences in the next day or so, with their events' alerts */
  occurrences: Occurrence[];
  reminders: Reminder[];
  timers: CountdownTimer[];
  /** keys of alerts already shown (`kind:id:at`), so nothing rings twice */
  fired: Set<string>;
}

export const dueKey = (d: Pick<Due, 'kind' | 'id' | 'at'>) => `${d.kind}:${d.id}:${d.at}`;

function eventAlerts(o: Occurrence): { at: number; mins: number }[] {
  const e: CalEvent = o.event;
  const list = e.alarms?.length ? e.alarms : [];
  return list.map((a) => ({ at: o.start - a.minutesBefore * 60_000, mins: a.minutesBefore }));
}

/** Everything that should ring in [since, now] (missed by at most GRACE_MS) plus the next future time. */
export function dueNow(input: ScheduleInput, since: number, now: number): { due: Due[]; next?: number } {
  const due: Due[] = [];
  let next: number | undefined;
  const consider = (d: Due) => {
    if (input.fired.has(dueKey(d))) return;
    if (d.at <= now) {
      if (d.at >= Math.max(since, now - GRACE_MS) || d.at >= now - GRACE_MS) due.push({ ...d, late: now - d.at > 60_000 });
    } else if (next === undefined || d.at < next) next = d.at;
  };
  for (const a of input.alarms) {
    // Look back a little so an alarm missed during sleep is found.
    const t = nextAlarmTime(a, Math.min(since, now - GRACE_MS));
    if (t !== undefined) consider({ kind: 'alarm', id: a.id, at: t, title: a.label || 'Alarm', late: false });
    if (t !== undefined && t <= now) {
      const after = nextAlarmTime({ ...a, lastFired: t, snoozedUntil: undefined }, now + 1);
      if (after !== undefined && (next === undefined || after < next)) next = after;
    }
  }
  for (const o of input.occurrences) {
    for (const al of eventAlerts(o)) consider({ kind: 'event', id: o.event.id, at: al.at, title: o.event.title, start: o.start, location: o.event.location, url: o.event.url ?? meetingLink(o.event), late: false });
  }
  for (const r of input.reminders) {
    if (r.done) continue;
    const at = r.remindAt ?? r.due;
    if (at !== undefined) consider({ kind: 'reminder', id: r.id, at, title: r.title, late: false });
  }
  for (const t of input.timers) if (t.endsAt !== undefined) consider({ kind: 'timer', id: t.id, at: t.endsAt, title: t.label || 'Timer', late: false });
  return { due: due.sort((a, b) => a.at - b.at), next };
}

/** A video-meeting link in an event's place, notes or URL, for a Join button. */
export function meetingLink(e: Pick<CalEvent, 'location' | 'description' | 'url'>): string | undefined {
  const hay = [e.url, e.location, e.description].filter(Boolean).join(' ');
  const m = hay.match(/https:\/\/(?:[\w-]+\.)?(?:zoom\.us\/(?:j|my|w)\/[^\s<>"]+|meet\.google\.com\/[a-z-]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"]+|teams\.live\.com\/meet\/[^\s<>"]+|[\w.-]*webex\.com\/[^\s<>"]+|meet\.jit\.si\/[^\s<>"]+|whereby\.com\/[^\s<>"]+|app\.gather\.town\/[^\s<>"]+|discord\.gg\/[^\s<>"]+)/i);
  return m?.[0];
}

/** "Ana's birthday in 3 days", "in 25 min", "now" */
export function untilText(t: number, now = Date.now()): string {
  const d = t - now;
  if (Math.abs(d) < 60_000) return 'now';
  const mins = Math.round(Math.abs(d) / 60_000);
  const s = mins < 60 ? `${mins} min` : mins < 48 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`;
  return d > 0 ? `in ${s}` : `${s} ago`;
}

export function timerLeft(t: CountdownTimer, now = Date.now()): number {
  return t.endsAt !== undefined ? Math.max(0, t.endsAt - now) : t.leftMs ?? t.durationMs;
}
