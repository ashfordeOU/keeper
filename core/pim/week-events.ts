// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Calendar events beside the planner's days (the Island's Week tab and the
// Planner page), the public "upcoming events" and "calendar status" answers
// other pages read (the Weather page's trips, the Island), and the one row
// every view shows when Keeper cannot see the computer's calendars. Pure.

import { joinLink } from './agenda';
import type { SystemAccess } from './syscal';
import type { Account, CalendarInfo, Occurrence } from './types';

/** yyyy-mm-dd → local midnight, and the local midnight after it (a 23- or 25-hour day around a clock change). */
function dayRange(key: string): [number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [new Date(y, (m || 1) - 1, d || 1).getTime(), new Date(y, (m || 1) - 1, (d || 1) + 1).getTime()];
}

/** One event as a row in a day of the week. */
export interface WeekEvent {
  key: string;
  eventId: string;
  instance: number;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  color: string;
  calendar: string;
  calendarName: string;
  location?: string;
  /** opens where it lives (ical://…, outlookcal:, a web calendar) */
  openUrl?: string;
  /** for an event over several days: which part this day shows */
  part: 'single' | 'first' | 'middle' | 'last';
}

export interface WeekEventOptions {
  /** only calendars shown in the Island (the Island's Week tab) */
  island?: boolean;
}

/** Keeper's own calendar ("On this computer") holds events as well as tasks; other task lists hold none. */
const holdsEvents = (c: CalendarInfo) => !c.tasks || c.account === 'local';
const shown = (c: CalendarInfo | undefined, island?: boolean) => !!c && c.visible && holdsEvents(c) && (!island || c.island !== false);

/**
 * Occurrences sorted into the given days (yyyy-mm-dd, local time). An event
 * that spans days shows on each of them; all-day events end at midnight after
 * their last day; the same meeting from two calendars shows once. Each day:
 * all-day (and spanning) rows first, then by start.
 */
export function eventsByDay(occ: Occurrence[], calendars: CalendarInfo[], days: string[], o: WeekEventOptions = {}): Map<string, WeekEvent[]> {
  const cals = new Map(calendars.map((c) => [c.id, c]));
  const out = new Map<string, WeekEvent[]>(days.map((d) => [d, []]));
  const ranges = days.map((d) => [d, ...dayRange(d)] as const);
  const seen = new Set<string>();
  for (const x of occ) {
    const c = cals.get(x.event.calendar);
    if (!shown(c, o.island) || x.event.status === 'cancelled') continue;
    const dup = `${x.event.title.trim().toLowerCase()}|${x.start}|${x.end}`;
    if (seen.has(dup)) continue;
    seen.add(dup);
    const end = Math.max(x.end, x.start);
    const hit = ranges.filter(([, s, e]) => (end > x.start ? x.start < e && end > s : x.start >= s && x.start < e));
    if (!hit.length) continue;
    // Which days the whole event covers (not only the ones asked for), to say first / middle / last.
    const firstDay = x.start;
    const lastDay = end > x.start ? end - 1 : x.start;
    for (const [d, s, e] of hit) {
      const isFirst = firstDay >= s && firstDay < e;
      const isLast = lastDay >= s && lastDay < e;
      const part: WeekEvent['part'] = isFirst && isLast ? 'single' : isFirst ? 'first' : isLast ? 'last' : 'middle';
      out.get(d)!.push({
        key: `${x.event.id}:${x.instance}:${d}`, eventId: x.event.id, instance: x.instance, title: x.event.title || 'Untitled event',
        start: x.start, end, allDay: x.event.allDay, color: c!.color, calendar: c!.id, calendarName: c!.name,
        location: x.event.location || undefined, openUrl: x.event.openUrl, part,
      });
    }
  }
  const wide = (w: WeekEvent) => w.allDay || w.part === 'middle';
  for (const list of out.values()) list.sort((a, b) => Number(wide(b)) - Number(wide(a)) || a.start - b.start || a.end - b.end || a.title.localeCompare(b.title));
  return out;
}

/** "All day", "09:30", "09:30 →", "→ 11:00", "all day (continues)" — times in the given formatter. */
export function weekEventTime(e: WeekEvent, fmt: (t: number) => string): string {
  if (e.allDay) return 'All day';
  if (e.part === 'first') return `${fmt(e.start)} →`;
  if (e.part === 'middle') return 'All day';
  if (e.part === 'last') return `→ ${fmt(e.end)}`;
  return fmt(e.start);
}

// ---------------------------------------------------------------- the public answers

/** Where a calendar comes from, for other pages. */
export type EventSourceKind = 'system' | 'google' | 'microsoft' | 'caldav' | 'ics' | 'local' | 'holidays' | 'birthdays';

/** One upcoming event as other pages read it (pim.upcomingEvents). */
export interface UpcomingEvent {
  key: string;
  eventId: string;
  instance: number;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location?: string;
  /** a video meeting link, when it has one */
  join?: string;
  calendar: string;
  calendarName: string;
  color: string;
  source: EventSourceKind;
  /** the account's id (Keeper's own accounts) */
  account?: string;
  openUrl?: string;
}

export function sourceOf(c: CalendarInfo, accounts: Pick<Account, 'id' | 'kind' | 'oauth'>[]): EventSourceKind {
  if (c.source) return c.source;
  if (c.account === 'local') return 'local';
  const a = accounts.find((x) => x.id === c.account);
  if (a?.oauth === 'google' || a?.kind === 'google') return 'google';
  if (a?.oauth === 'microsoft' || a?.kind === 'microsoft') return 'microsoft';
  if (a?.kind === 'ics') return 'ics';
  return 'caldav';
}

/** Every visible calendar's events in a range, in time order, the same meeting once; optionally only ones with a place. */
export function upcomingFrom(occ: Occurrence[], calendars: CalendarInfo[], accounts: Pick<Account, 'id' | 'kind' | 'oauth'>[], o: { withLocation?: boolean; limit?: number } = {}): UpcomingEvent[] {
  const cals = new Map(calendars.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: UpcomingEvent[] = [];
  for (const x of [...occ].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const c = cals.get(x.event.calendar);
    if (!shown(c) || x.event.status === 'cancelled') continue;
    if (o.withLocation && !x.event.location?.trim()) continue;
    const dup = `${x.event.title.trim().toLowerCase()}|${x.start}|${x.end}`;
    if (seen.has(dup)) continue;
    seen.add(dup);
    const source = sourceOf(c!, accounts);
    out.push({
      key: `${x.event.id}:${x.instance}`, eventId: x.event.id, instance: x.instance, title: x.event.title, start: x.start, end: x.end, allDay: x.event.allDay,
      location: x.event.location || undefined, join: x.event.allDay ? undefined : joinLink(x.event), calendar: c!.id, calendarName: c!.name, color: c!.color,
      source, account: source === 'system' || source === 'local' || source === 'holidays' || source === 'birthdays' ? undefined : c!.account, openUrl: x.event.openUrl,
    });
    if (o.limit && out.length >= o.limit) break;
  }
  return out;
}

/** One place calendars come from, as pim.calendarStatus answers it. */
export interface CalendarSourceStatus {
  /** "system", or the account's id */
  id: string;
  kind: EventSourceKind;
  label: string;
  /** set up (the computer's calendars: the switch is on and the system has them) */
  connected: boolean;
  /** Keeper may read it now (system access given; the account signed in) */
  authorized: boolean;
  calendars: number;
  message?: string;
}

/** pim.calendarStatus: cheap (nothing is fetched), for every view that shows events. */
export interface CalendarStatus {
  platform: string;
  /** the computer's own calendars (on a Mac: EventKit, `raw` is its authorization state) */
  system: SystemAccess;
  sources: CalendarSourceStatus[];
  /** any source Keeper can read events from right now */
  anyReadable: boolean;
  /** the row to show above events, when there is one */
  row: AccessRow | null;
}

export function buildCalendarStatus(input: {
  platform: string;
  system: SystemAccess;
  calendars: CalendarInfo[];
  accounts: (Pick<Account, 'id' | 'kind' | 'oauth' | 'label' | 'calendar'> & { needsSignIn?: boolean })[];
}): CalendarStatus {
  const { system, calendars } = input;
  const sysCals = calendars.filter((c) => c.source === 'system' && !c.tasks).length;
  const sources: CalendarSourceStatus[] = [{
    id: 'system', kind: 'system', label: input.platform === 'darwin' ? 'This Mac (Calendar app)' : 'This computer',
    connected: system.state !== 'unavailable', authorized: system.state === 'granted', calendars: sysCals, message: system.message,
  }];
  for (const a of input.accounts) {
    if (!a.calendar) continue;
    const n = calendars.filter((c) => c.account === a.id && !c.tasks).length;
    const kind = sourceOf({ account: a.id } as CalendarInfo, [a]);
    sources.push({ id: a.id, kind, label: a.label, connected: true, authorized: !a.needsSignIn, calendars: n, message: a.needsSignIn ? 'Sign in again to read this account’s calendars.' : undefined });
  }
  const anyReadable = sources.some((s) => s.authorized && s.connected && (s.id === 'system' || s.calendars > 0));
  return { platform: input.platform, system, sources, anyReadable, row: accessRow(system, input.platform, { otherSources: sources.some((s) => s.id !== 'system' && s.authorized && s.calendars > 0) }) };
}

// ---------------------------------------------------------------- "Keeper can't see your calendars yet"

export const MAC_CALENDAR_PRIVACY = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars';

/** The inline row every events view shows when the computer's calendars cannot be read. */
export interface AccessRow {
  title: string;
  detail: string;
  /**
   * allow: ask the system now (then refresh); settings: open the privacy page;
   * turnOn: switch reading this computer's calendars back on; enableFeature: switch
   * the Calendars feature on; none: nothing to press
   */
  action: 'allow' | 'settings' | 'turnOn' | 'enableFeature' | 'none';
  settingsUrl?: string;
  /** offer "Connect Google / Outlook calendar" */
  connect: boolean;
}

/**
 * The row for an access state, or null when there is nothing to say. On a
 * Mac every state but "granted" gets the row (notDetermined: Allow; denied,
 * write-only, restricted: the privacy page). Elsewhere a missing system
 * calendar only gets the row when no account gives events either.
 */
export function accessRow(a: SystemAccess | null | undefined, platform: string, o: { otherSources?: boolean } = {}): AccessRow | null {
  if (!a || a.state === 'granted') return null;
  const title = 'Keeper can’t see your calendars yet';
  if (a.raw === 'featureOff') return { title, detail: a.message, action: 'enableFeature', connect: false };
  if (a.raw === 'switchedOff') return o.otherSources ? null : { title, detail: a.message, action: 'turnOn', connect: true };
  if (a.state !== 'unavailable' && (a.via === 'eventkit' || platform === 'darwin')) {
    if (a.state === 'notDetermined') return { title, detail: a.message, action: a.canRequest === false ? 'settings' : 'allow', settingsUrl: MAC_CALENDAR_PRIVACY, connect: true };
    if (a.raw === 'writeOnly') return { title, detail: 'Keeper may only add events. Choose “Full Access” for Keeper in Privacy & Security → Calendars to see them.', action: 'settings', settingsUrl: MAC_CALENDAR_PRIVACY, connect: true };
    if (a.state === 'restricted') return { title, detail: a.message, action: 'settings', settingsUrl: MAC_CALENDAR_PRIVACY, connect: true };
    return { title, detail: a.message, action: 'settings', settingsUrl: MAC_CALENDAR_PRIVACY, connect: true };
  }
  if (a.state === 'unavailable') {
    // Switched off, no helper, or no desktop calendars: say so unless accounts already give events.
    if (o.otherSources) return null;
    return { title, detail: a.message, action: 'none', connect: true };
  }
  return { title, detail: a.message, action: a.canRequest ? 'allow' : 'none', connect: true };
}
