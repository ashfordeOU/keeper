// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The computer's own calendars, read live: macOS Calendar (EventKit, through
// keeper-helper), Windows Calendar and Outlook (a small PowerShell helper),
// and the Linux desktop's Evolution Data Server (GNOME Online Accounts) or
// calendar files. Each source answers in its own shape; these pure functions
// turn the answers into Keeper's calendars and events. No Electron imports.

import { parseEvents } from './ical';
import type { CalendarInfo, CalEvent } from './types';

/** How the computer's calendars are reached on this system. */
export type SystemKind = 'eventkit' | 'eds' | 'appointments' | 'outlook' | 'files';

export type AccessState = 'granted' | 'denied' | 'notDetermined' | 'restricted' | 'unavailable';

export interface SystemAccess {
  state: AccessState;
  /** which way the calendars are read (shown in Settings) */
  via?: SystemKind;
  /** a plain sentence for the person */
  message: string;
  /** a button can ask the system now */
  canRequest: boolean;
  /** changes arrive by themselves (no checking needed) */
  live?: boolean;
}

/** One calendar as the system describes it. */
export interface SystemCalendar {
  /** the system's own id */
  ref: string;
  name: string;
  color?: string;
  /** the account it belongs to in the system ("iCloud", "you@gmail.com") */
  group?: string;
  writable: boolean;
}

export interface SystemSnapshot {
  via: SystemKind;
  calendars: SystemCalendar[];
  /** already in Keeper's shape, with `calendar` set to the system ref (see adoptSnapshot) */
  events: CalEvent[];
}

/** A short stable id from any string (FNV-1a, 52 bits as hex). */
export function shortHash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + (h2 & 0xfffff).toString(16).padStart(5, '0');
}

export const systemCalendarId = (ref: string) => `system:${shortHash(ref)}`;

/** "#RRGGBB" from what systems hand out ("#rrggbbaa" as in CSS, "rgb(…)", "0xAARRGGBB"). */
export function normalizeColor(c: unknown): string | undefined {
  if (typeof c !== 'string') return undefined;
  const v = c.trim();
  let m = v.match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (m) return `#${m[1].toLowerCase()}`;
  m = v.match(/^#([0-9a-f]{3})$/i);
  if (m) return `#${m[1].split('').map((x) => x + x).join('').toLowerCase()}`;
  m = v.match(/^(?:#|0x)([0-9a-f]{2})([0-9a-f]{6})$/i);
  if (m) return `#${m[2].toLowerCase()}`;
  m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Number(x))).toString(16).padStart(2, '0')).join('')}`;
  return undefined;
}

/** All-day events end at midnight after their last day, whatever the source said (23:59:59, same day, …). */
function allDayRange(start: number, end: number): [number, number] {
  const s = new Date(start);
  s.setHours(0, 0, 0, 0);
  const e = new Date(Math.max(end - 1, start));
  e.setHours(0, 0, 0, 0);
  e.setDate(e.getDate() + 1);
  return [s.getTime(), e.getTime()];
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);

// ---------------------------------------------------------------- macOS: EventKit

/** What keeper-helper's `calendar.events` answers. */
export interface EventKitAnswer {
  calendars?: { id?: string; title?: string; color?: string; source?: string; writable?: boolean; type?: string }[];
  events?: {
    id?: string; item?: string; calendar?: string; title?: string; start?: number; end?: number; allDay?: boolean;
    timeZone?: string; location?: string; url?: string; notes?: string; status?: string; recurring?: boolean;
    alarms?: number[]; organizer?: { name?: string; email?: string }; attendees?: { name?: string; email?: string; status?: string }[];
  }[];
}

/** Opens one event in macOS Calendar. */
export const macCalendarUrl = (eventId: string) => `ical://ekevent/${encodeURIComponent(eventId)}?method=show&options=more`;

export function mapEventKit(r: EventKitAnswer): SystemSnapshot {
  const calendars: SystemCalendar[] = (r.calendars ?? []).filter((c) => c.id).map((c) => ({
    ref: c.id!, name: c.title || 'Calendar', color: normalizeColor(c.color), group: c.source || undefined, writable: c.writable !== false && c.type !== 'subscription' && c.type !== 'birthday',
  }));
  const events: CalEvent[] = [];
  for (const e of r.events ?? []) {
    const start = num(e.start);
    let end = num(e.end);
    if (!e.id || !e.calendar || start === undefined) continue;
    end = Math.max(end ?? start, start);
    const [s, en] = e.allDay ? allDayRange(start, end) : [start, end];
    const status = e.status === 'cancelled' || e.status === 'tentative' || e.status === 'confirmed' ? e.status : undefined;
    // EventKit hands each occurrence of a repeating event separately; the start keeps them apart.
    const uid = e.recurring ? `${e.id}@${s}` : e.id;
    events.push({
      id: `${e.calendar}:${uid}`, calendar: e.calendar, uid, title: e.title || '(no title)', start: s, end: en, allDay: !!e.allDay,
      tz: e.allDay ? undefined : str(e.timeZone), location: str(e.location), url: str(e.url), description: str(e.notes), status,
      alarms: e.alarms?.length ? e.alarms.filter((m) => Number.isFinite(m)).map((m) => ({ minutesBefore: m })) : undefined,
      organizer: e.organizer?.email ? { email: e.organizer.email, name: e.organizer.name } : undefined,
      attendees: e.attendees?.length ? e.attendees.filter((a) => a.email).map((a) => ({ email: a.email!, name: a.name, status: a.status === 'accepted' || a.status === 'declined' || a.status === 'tentative' ? a.status : 'needs-action' })) : undefined,
      // href: what to ask EventKit for when changing it; etag: which occurrence
      href: e.id, etag: e.recurring ? String(s) : undefined, openUrl: macCalendarUrl(e.id),
    });
  }
  return { via: 'eventkit', calendars, events };
}

// ---------------------------------------------------------------- Windows: AppointmentStore or Outlook

/** What the PowerShell helper prints (one JSON object). */
export interface WindowsAnswer {
  via?: 'appointments' | 'outlook';
  error?: string;
  calendars?: { id?: string; name?: string; color?: string; account?: string; writable?: boolean }[];
  events?: { id?: string; calendar?: string; title?: string; start?: string | number; minutes?: number; end?: string | number; allDay?: boolean; location?: string; details?: string; url?: string; recurring?: boolean; reminder?: number }[];
}

const when = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? (/^\/Date\((-?\d+)/.test(v) ? Number(v.match(/^\/Date\((-?\d+)/)![1]) : Date.parse(v)) : NaN);

export function mapWindows(r: WindowsAnswer): SystemSnapshot {
  const via = r.via ?? 'appointments';
  const calendars: SystemCalendar[] = (r.calendars ?? []).filter((c) => c.id).map((c) => ({ ref: c.id!, name: c.name || 'Calendar', color: normalizeColor(c.color), group: c.account || undefined, writable: false }));
  const events: CalEvent[] = [];
  for (const e of r.events ?? []) {
    const start = when(e.start);
    if (!e.id || !e.calendar || !Number.isFinite(start)) continue;
    let end = e.end !== undefined ? when(e.end) : start + (e.minutes ?? 0) * 60_000;
    if (!Number.isFinite(end) || end < start) end = start;
    const [s, en] = e.allDay ? allDayRange(start, end === start ? start + 86_400_000 : end) : [start, end];
    const uid = e.recurring ? `${e.id}@${s}` : e.id;
    events.push({
      id: `${e.calendar}:${uid}`, calendar: e.calendar, uid, title: e.title || '(no title)', start: s, end: en, allDay: !!e.allDay,
      location: str(e.location), description: str(e.details), url: str(e.url), href: e.id,
      alarms: e.reminder !== undefined && e.reminder >= 0 ? [{ minutesBefore: e.reminder }] : undefined,
      openUrl: via === 'outlook' ? undefined : 'outlookcal:',
    });
  }
  return { via, calendars, events };
}

// ---------------------------------------------------------------- Linux: Evolution Data Server

/** The parts of an Evolution source (a key file) Keeper uses. */
export interface EdsSource {
  uid: string;
  name: string;
  enabled: boolean;
  parent?: string;
  /** set for calendars (the [Calendar] group): event lists, not task or memo lists */
  calendar?: { color?: string; backend?: string; selected: boolean };
}

/** Reads one source's key file ("[Data Source]\nDisplayName=…\n[Calendar]\nColor=#…"). */
export function parseEdsSource(uid: string, data: string): EdsSource {
  const groups: Record<string, Record<string, string>> = {};
  let g = '';
  for (const raw of data.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const head = line.match(/^\[(.+)\]$/);
    if (head) { g = head[1]; groups[g] ??= {}; continue; }
    const i = line.indexOf('=');
    if (i > 0 && g) {
      // Localised names ("DisplayName[de]") lose to the plain one.
      const k = line.slice(0, i).trim();
      if (!k.includes('[')) groups[g][k] = line.slice(i + 1).trim();
    }
  }
  const ds = groups['Data Source'] ?? {};
  const cal = groups.Calendar;
  const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : v.toLowerCase() === 'true');
  return {
    uid,
    name: (ds.DisplayName ?? uid).replace(/\\s/g, ' ').replace(/\\n/g, ' '),
    enabled: bool(ds.Enabled, true),
    parent: ds.Parent || undefined,
    calendar: cal ? { color: normalizeColor(cal.Color), backend: cal.BackendName, selected: bool(cal.Selected, true) } : undefined,
  };
}

/** The event calendars among Evolution's sources, with their account's name as the group. */
export function edsCalendars(sources: EdsSource[]): (SystemCalendar & { backend?: string })[] {
  const byUid = new Map(sources.map((s) => [s.uid, s]));
  return sources
    .filter((s) => s.calendar && s.enabled)
    .map((s) => {
      const parent = s.parent ? byUid.get(s.parent) : undefined;
      // "contacts" and "birthdays" calendars are made from the address book and cannot be written.
      const writable = !['contacts', 'weather', 'webcal', 'http'].includes(s.calendar!.backend ?? '');
      const group = parent && parent.enabled !== false ? parent.name : s.calendar!.backend === 'local' ? 'On this computer' : undefined;
      return { ref: s.uid, name: s.name, color: s.calendar!.color, group, writable, backend: s.calendar!.backend };
    });
}

/** Events from the iCalendar objects Evolution hands out for one calendar (repeats stay as rules). */
export function mapEdsObjects(ref: string, objects: string[]): CalEvent[] {
  const out: CalEvent[] = [];
  for (const o of objects) {
    const text = /BEGIN:VCALENDAR/i.test(o) ? o : `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${o.trim()}\r\nEND:VCALENDAR\r\n`;
    for (const e of parseEvents(text, ref)) out.push({ ...e, href: e.uid });
  }
  return out;
}

/** Evolution's query for everything that happens between two times. */
export function edsRangeQuery(from: number, to: number): string {
  const t = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `(occur-in-time-range? (make-time "${t(from)}") (make-time "${t(to)}"))`;
}

/** The VEVENT blocks of an iCalendar text, one string each (what Evolution takes to write). */
export function veventBlocks(ics: string): string[] {
  return [...ics.matchAll(/BEGIN:VEVENT[\s\S]*?END:VEVENT\r?\n?/g)].map((m) => m[0].replace(/\r?\n$/, ''));
}

// ---------------------------------------------------------------- calendar files (Evolution's local ones, KOrganizer)

/** Paths from an Akonadi iCal resource's settings ("Path=/home/me/cal.ics"). */
export function akonadiIcalPath(rc: string): string | undefined {
  const m = rc.match(/^\s*Path\s*=\s*(.+?)\s*$/m);
  return m?.[1].replace(/^file:\/\//, '');
}

// ---------------------------------------------------------------- joining with Keeper's calendar list

/**
 * Brings a snapshot into Keeper's calendar list: new calendars are added,
 * names follow the system, colours follow it unless chosen in Keeper, and
 * calendars the system no longer has are dropped. Events get Keeper ids.
 */
export function adoptSnapshot(existing: CalendarInfo[], snap: SystemSnapshot): { calendars: CalendarInfo[]; events: Map<string, CalEvent[]>; removed: string[] } {
  const mine = existing.filter((c) => c.source === 'system');
  const others = existing.filter((c) => c.source !== 'system');
  const next: CalendarInfo[] = [];
  const idOf = new Map<string, string>();
  for (const sc of snap.calendars) {
    const id = systemCalendarId(sc.ref);
    idOf.set(sc.ref, id);
    const was = mine.find((c) => c.id === id);
    next.push({
      id, account: 'system', name: sc.name, color: was?.colorSet ? was.color : sc.color ?? was?.color ?? '#8e8e93', url: '', readOnly: !sc.writable,
      visible: was?.visible ?? true, island: was?.island, colorSet: was?.colorSet, source: 'system', group: sc.group, ref: sc.ref,
    });
  }
  const events = new Map<string, CalEvent[]>(next.map((c) => [c.id, []]));
  for (const e of snap.events) {
    const id = idOf.get(e.calendar);
    if (!id) continue;
    events.get(id)!.push({ ...e, calendar: id, id: `${id}:${e.uid}${e.recurrenceId !== undefined ? `:${e.recurrenceId}` : ''}` });
  }
  const removed = mine.filter((c) => !idOf.has(c.ref ?? '') && !next.some((n) => n.id === c.id)).map((c) => c.id);
  return { calendars: [...others, ...next], events, removed };
}

/**
 * How often to look again: every minute while a calendar is on screen (the
 * Island's Calendar tab or the Calendar page), every 5 minutes otherwise, and
 * only every 15 minutes when the system tells Keeper about changes itself.
 */
export function calendarPollMs(o: { visible: boolean; live?: boolean }): number {
  if (o.visible) return 60_000;
  return o.live ? 15 * 60_000 : 5 * 60_000;
}

/** Subscribed .ics links are whole files: never fetched more often than this. */
export const ICS_MIN_MS = 15 * 60_000;
