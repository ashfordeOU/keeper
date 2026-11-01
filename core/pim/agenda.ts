// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What the Island shows from your calendars: the next event's countdown, a
// Join button for video meetings, and today's and tomorrow's agenda. Pure.

import { meetingLink } from './alarms';
import type { CalendarInfo, CalEvent, Occurrence } from './types';

/** The video service a meeting link belongs to (for the Join button's label). */
export function meetingProvider(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return undefined; }
  if (/(^|\.)zoom\.us$|(^|\.)zoomgov\.com$/.test(host)) return 'Zoom';
  if (host === 'meet.google.com') return 'Google Meet';
  if (/^teams\.(microsoft|live)\.com$/.test(host)) return 'Teams';
  if (/(^|\.)webex\.com$/.test(host)) return 'Webex';
  if (host === 'meet.jit.si') return 'Jitsi';
  if (/(^|\.)whereby\.com$/.test(host)) return 'Whereby';
  return undefined;
}

/** The meeting link of an event (its own online-meeting address first, then links in its place or notes). */
export function joinLink(e: Pick<CalEvent, 'location' | 'description' | 'url'>): string | undefined {
  return meetingLink(e) ?? (e.url && meetingProvider(e.url) ? e.url : undefined);
}

/** "now", "in 5 min", "in 1 h 20 min", "in 2 days" — for the notch wing and the agenda. */
export function countdown(start: number, now: number, end?: number): string {
  if (start <= now) return end !== undefined && end <= now ? 'ended' : 'now';
  const mins = Math.ceil((start - now) / 60_000);
  if (mins < 60) return `in ${mins} min`;
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `in ${h} h ${m} min` : `in ${h} h`;
  }
  const days = Math.round(mins / 1440);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** The short form for the pill: "5m", "1h20", "now". */
export function countdownShort(start: number, now: number): string {
  if (start <= now) return 'now';
  const mins = Math.ceil((start - now) / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export interface AgendaItem {
  key: string;
  eventId: string;
  instance: number;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location?: string;
  color: string;
  calendar: string;
  calendarName: string;
  join?: string;
  provider?: string;
  /** opens in another app or web page; otherwise in Keeper's calendar */
  openUrl?: string;
  past: boolean;
  now: boolean;
}

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const nextDay = (t: number) => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() + 1); return d.getTime(); };

/** Calendars whose events belong in the Island: visible ones not switched off for it. */
export const inIsland = (c: CalendarInfo | undefined) => !!c && c.visible && c.island !== false && !c.tasks;

/**
 * Occurrences as agenda rows for one day, all-day ones first, the same meeting
 * from two calendars (a subscribed copy and the system's) shown once.
 */
export function agendaFor(occ: Occurrence[], calendars: CalendarInfo[], dayStart: number, now: number): AgendaItem[] {
  const from = startOfDay(dayStart);
  const to = nextDay(from);
  const cals = new Map(calendars.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: AgendaItem[] = [];
  for (const o of occ) {
    const c = cals.get(o.event.calendar);
    if (!inIsland(c) || o.end <= from || o.start >= to || o.event.status === 'cancelled') continue;
    const dup = `${o.event.title.trim().toLowerCase()}|${o.start}|${o.end}`;
    if (seen.has(dup)) continue;
    seen.add(dup);
    const join = o.event.allDay ? undefined : joinLink(o.event);
    out.push({
      key: `${o.event.id}:${o.instance}`, eventId: o.event.id, instance: o.instance, title: o.event.title, start: o.start, end: o.end, allDay: o.event.allDay,
      location: o.event.location, color: c!.color, calendar: c!.id, calendarName: c!.name, join, provider: meetingProvider(join), openUrl: o.event.openUrl,
      past: o.end <= now, now: o.start <= now && o.end > now,
    });
  }
  return out.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start || a.end - b.end);
}

/** Today's and tomorrow's agenda for the Island's Calendar tab. */
export function islandAgenda(occ: Occurrence[], calendars: CalendarInfo[], now: number): { today: AgendaItem[]; tomorrow: AgendaItem[] } {
  return { today: agendaFor(occ, calendars, now, now), tomorrow: agendaFor(occ, calendars, nextDay(now), now) };
}

/** The event the notch wing counts down to: the next timed one that has not ended. */
export function nextUp(items: AgendaItem[], now: number): AgendaItem | undefined {
  return items.filter((i) => !i.allDay && i.end > now).sort((a, b) => a.start - b.start)[0];
}
