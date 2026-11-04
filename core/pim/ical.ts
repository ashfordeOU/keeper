// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// iCalendar (RFC 5545): reading and writing events (VEVENT), tasks (VTODO) and
// their alarms, with time zones, repeats, cancelled dates and changed
// occurrences. Used for CalDAV, .ics subscriptions, imports and invitations.

import { expand, parseRRule } from './rrule';
import { fromWall, validZone } from './tz';
import type { Attendee, CalEvent, EventAttachment, Occurrence, Reminder } from './types';

export interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

export interface Component {
  type: string;
  props: Prop[];
  children: Component[];
}

/** Undo line folding (a line starting with a space or tab continues the previous one). */
export function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n').filter((l) => l.length);
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

export function escapeText(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

function parseLine(line: string): Prop | null {
  // NAME;PARAM=a;PARAM2="b:c":value — colons inside quoted params do not end the name part.
  let i = 0;
  let quoted = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const bits = head.match(/(?:[^;"]|"[^"]*")+/g) ?? [];
  const name = (bits.shift() ?? '').toUpperCase();
  const params: Record<string, string> = {};
  for (const b of bits) {
    const j = b.indexOf('=');
    if (j > 0) params[b.slice(0, j).toUpperCase()] = b.slice(j + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

export function parseComponents(text: string): Component[] {
  const root: Component = { type: 'ROOT', props: [], children: [] };
  const stack = [root];
  for (const line of unfold(text)) {
    const p = parseLine(line);
    if (!p) continue;
    const top = stack[stack.length - 1];
    if (p.name === 'BEGIN') {
      const c: Component = { type: p.value.toUpperCase(), props: [], children: [] };
      top.children.push(c);
      stack.push(c);
    } else if (p.name === 'END') {
      if (stack.length > 1) stack.pop();
    } else top.props.push(p);
  }
  return root.children;
}

const prop = (c: Component, name: string) => c.props.find((p) => p.name === name);
const props = (c: Component, name: string) => c.props.filter((p) => p.name === name);

// Common Windows zone names seen in invitations from Exchange, mapped to IANA.
const WINDOWS_ZONES: Record<string, string> = {
  'Pacific Standard Time': 'America/Los_Angeles', 'Mountain Standard Time': 'America/Denver', 'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York', 'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest', 'FLE Standard Time': 'Europe/Kiev',
  'E. Europe Standard Time': 'Europe/Bucharest', 'Russian Standard Time': 'Europe/Moscow', 'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai', 'Tokyo Standard Time': 'Asia/Tokyo', 'AUS Eastern Standard Time': 'Australia/Sydney',
  'UTC': 'UTC', 'Singapore Standard Time': 'Asia/Singapore', 'Arabian Standard Time': 'Asia/Dubai',
};

export function zoneOf(tzid?: string): string | undefined {
  if (!tzid) return undefined;
  const clean = tzid.replace(/^\/(?:[^/]+\/)*?(?=[A-Z][a-z]+\/)/, '').trim();
  if (validZone(clean)) return clean;
  if (WINDOWS_ZONES[clean]) return WINDOWS_ZONES[clean];
  return undefined;
}

/** A DATE or DATE-TIME value as an instant; TZID honoured, floating times are local. */
export function parseDate(value: string, params: Record<string, string> = {}): { t: number; allDay: boolean; tz?: string } | undefined {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h || params.VALUE === 'DATE') return { t: new Date(+y, +mo - 1, +d).getTime(), allDay: true };
  if (z) return { t: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)), allDay: false, tz: 'UTC' };
  const tz = zoneOf(params.TZID);
  return { t: fromWall({ y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: +(s ?? 0) }, tz), allDay: false, tz };
}

function parseDuration(v: string): number {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86_400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

function attendee(p: Prop): Attendee {
  const status = (p.params.PARTSTAT ?? '').toLowerCase();
  return {
    email: p.value.replace(/^mailto:/i, ''),
    name: p.params.CN,
    status: (['accepted', 'declined', 'tentative', 'needs-action'].includes(status) ? status : undefined) as Attendee['status'],
    role: p.params.ROLE === 'CHAIR' ? 'chair' : p.params.ROLE === 'OPT-PARTICIPANT' ? 'optional' : 'required',
  };
}

/** Events in an iCalendar text (repeating ones as their master plus changed occurrences). */
export function parseEvents(text: string, calendar = ''): CalEvent[] {
  const out: CalEvent[] = [];
  for (const cal of parseComponents(text)) {
    for (const c of cal.type === 'VCALENDAR' ? cal.children : [cal]) {
      if (c.type !== 'VEVENT') continue;
      const ds = prop(c, 'DTSTART');
      const start = ds && parseDate(ds.value, ds.params);
      if (!start) continue;
      const de = prop(c, 'DTEND');
      const dur = prop(c, 'DURATION');
      const endP = de ? parseDate(de.value, de.params) : undefined;
      const end = endP ? endP.t : dur ? start.t + parseDuration(dur.value) : start.allDay ? start.t + 86_400_000 : start.t;
      const uid = prop(c, 'UID')?.value ?? `${start.t}-${prop(c, 'SUMMARY')?.value ?? ''}`;
      const rid = prop(c, 'RECURRENCE-ID');
      const recurrenceId = rid ? parseDate(rid.value, rid.params)?.t : undefined;
      const exdates: number[] = [];
      for (const ex of props(c, 'EXDATE')) for (const v of ex.value.split(',')) {
        const d = parseDate(v, ex.params);
        if (d) exdates.push(d.t);
      }
      const alarms = c.children.filter((a) => a.type === 'VALARM').map((a) => {
        const trig = prop(a, 'TRIGGER');
        if (!trig) return null;
        if (trig.params.VALUE === 'DATE-TIME') {
          const at = parseDate(trig.value);
          return at ? { minutesBefore: Math.round((start.t - at.t) / 60_000) } : null;
        }
        return { minutesBefore: Math.round(-parseDuration(trig.value) / 60_000) };
      }).filter((a): a is { minutesBefore: number } => !!a);
      const status = (prop(c, 'STATUS')?.value ?? '').toLowerCase();
      const org = prop(c, 'ORGANIZER');
      const ev: CalEvent = {
        id: `${calendar}:${uid}${recurrenceId !== undefined ? `:${recurrenceId}` : ''}`,
        calendar,
        uid,
        title: unescapeText(prop(c, 'SUMMARY')?.value ?? '(no title)'),
        start: start.t,
        end: Math.max(end, start.t),
        allDay: start.allDay,
        tz: start.tz && start.tz !== 'UTC' ? start.tz : undefined,
        location: prop(c, 'LOCATION') ? unescapeText(prop(c, 'LOCATION')!.value) : undefined,
        description: prop(c, 'DESCRIPTION') ? unescapeText(prop(c, 'DESCRIPTION')!.value) : undefined,
        url: prop(c, 'URL')?.value,
        rrule: prop(c, 'RRULE')?.value,
        exdates: exdates.length ? exdates : undefined,
        recurrenceId,
        attendees: props(c, 'ATTENDEE').map(attendee),
        organizer: org ? attendee(org) : undefined,
        alarms: alarms.length ? alarms : undefined,
        status: status === 'cancelled' || status === 'tentative' || status === 'confirmed' ? status : undefined,
      };
      if (!ev.attendees?.length) delete ev.attendees;
      const atts = props(c, 'ATTACH').flatMap((a): EventAttachment[] => {
        const name = a.params.FILENAME ?? a.params['X-FILENAME'] ?? a.params['X-APPLE-FILENAME'] ?? a.params['X-ORACLE-FILENAME'];
        const type = a.params.FMTTYPE;
        if (a.params.VALUE === 'BINARY' || (a.params.ENCODING ?? '').toUpperCase() === 'BASE64') {
          const data = a.value.replace(/\s+/g, '');
          return data.length <= 2_800_000 ? [{ name: name ?? 'attachment', type, data }] : [];
        }
        return /^(https?|ftp):/i.test(a.value) ? [{ name: name ?? (decodeURIComponent(a.value.split(/[?#]/)[0].split('/').pop() || '') || a.value), type, url: a.value }] : [];
      });
      if (atts.length) ev.attachments = atts;
      out.push(ev);
    }
  }
  return out;
}

/** A local day as yyyy-mm-dd. */
export function dayKey(t: number | Date): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Tasks (VTODO) in an iCalendar text. */
export function parseTodos(text: string, list = ''): Reminder[] {
  const out: Reminder[] = [];
  for (const cal of parseComponents(text)) {
    for (const c of cal.type === 'VCALENDAR' ? cal.children : [cal]) {
      if (c.type !== 'VTODO') continue;
      const due = prop(c, 'DUE');
      const dueT = due ? parseDate(due.value, due.params)?.t : undefined;
      const status = prop(c, 'STATUS')?.value?.toUpperCase();
      const completed = prop(c, 'COMPLETED');
      const pr = Number(prop(c, 'PRIORITY')?.value ?? 0);
      const uid = prop(c, 'UID')?.value ?? String(Math.random());
      const alarm = c.children.find((a) => a.type === 'VALARM');
      const trig = alarm && prop(alarm, 'TRIGGER');
      let remindAt: number | undefined;
      if (trig?.params.VALUE === 'DATE-TIME') remindAt = parseDate(trig.value)?.t;
      else if (trig && dueT !== undefined) remindAt = dueT + parseDuration(trig.value);
      // The planned day is the task's start date (DTSTART); a date-time start counts by its local day.
      const start = prop(c, 'DTSTART');
      const startT = start ? parseDate(start.value, start.params)?.t : undefined;
      const rrule = prop(c, 'RRULE')?.value;
      const project = prop(c, 'CATEGORIES')?.value.split(/(?<!\\),/)[0];
      const steps = props(c, 'X-KEEPER-STEP').map((p, i) => ({ id: p.params['X-ID'] || `s${i}`, title: unescapeText(p.value), done: p.params['X-DONE'] === '1' }));
      const order = Number(prop(c, 'X-KEEPER-ORDER')?.value);
      const created = prop(c, 'CREATED');
      const energy = prop(c, 'X-KEEPER-ENERGY')?.value;
      const focus = (prop(c, 'X-KEEPER-FOCUS')?.value ?? '').split(',').map((x) => x.split('/').map(Number)).filter(([at, m]) => at > 0 && m > 0).map(([at, minutes]) => ({ at, minutes }));
      const t: Reminder = {
        id: `${list}:${uid}`,
        list,
        uid,
        title: unescapeText(prop(c, 'SUMMARY')?.value ?? '(no title)'),
        notes: prop(c, 'DESCRIPTION') ? unescapeText(prop(c, 'DESCRIPTION')!.value) : undefined,
        due: dueT,
        remindAt,
        done: status === 'COMPLETED' || !!completed,
        doneAt: completed ? parseDate(completed.value)?.t : undefined,
        // iCalendar: 1 highest … 9 lowest; Keeper: 3 high, 2 medium, 1 low.
        priority: pr === 0 ? 0 : pr <= 4 ? 3 : pr === 5 ? 2 : 1,
      };
      if (startT !== undefined) t.plannedFor = dayKey(startT);
      if (rrule) t.rrule = rrule.replace(/^RRULE:/i, '');
      if (project) t.project = unescapeText(project);
      if (steps.length) t.steps = steps;
      if (Number.isFinite(order)) t.order = order;
      if (created) t.created = parseDate(created.value)?.t;
      if (focus.length) t.focus = focus;
      if (energy === 'low' || energy === 'high') t.energy = energy;
      out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------- writing

const pad = (n: number) => String(n).padStart(2, '0');

export function utcStamp(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function localDate(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function wallStamp(t: number, tz: string): string {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(t))) p[x.type] = x.value;
  return `${p.year}${p.month}${p.day}T${p.hour === '24' ? '00' : p.hour}${p.minute}${p.second}`;
}

/** Fold long lines at 75 octets, as the standard asks. */
export function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function dateProp(name: string, t: number, allDay: boolean, tz?: string): string {
  if (allDay) return `${name};VALUE=DATE:${localDate(t)}`;
  if (tz) return `${name};TZID=${tz}:${wallStamp(t, tz)}`;
  return `${name}:${utcStamp(t)}`;
}

function eventLines(e: CalEvent, now: number): string[] {
  const L = ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${utcStamp(now)}`, dateProp('DTSTART', e.start, e.allDay, e.tz), dateProp('DTEND', e.end, e.allDay, e.tz)];
  if (e.recurrenceId !== undefined) L.push(dateProp('RECURRENCE-ID', e.recurrenceId, e.allDay, e.tz));
  L.push(`SUMMARY:${escapeText(e.title)}`);
  if (e.location) L.push(`LOCATION:${escapeText(e.location)}`);
  if (e.description) L.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.url) L.push(`URL:${e.url}`);
  for (const a of e.attachments ?? []) {
    const p = `${a.type ? `;FMTTYPE=${a.type}` : ''}${a.name ? `;FILENAME="${a.name.replace(/"/g, '')}"` : ''}`;
    if (a.url) L.push(`ATTACH${p}:${a.url}`);
    else if (a.data) L.push(`ATTACH${p};ENCODING=BASE64;VALUE=BINARY:${a.data}`);
  }
  if (e.rrule && e.recurrenceId === undefined) L.push(`RRULE:${e.rrule.replace(/^RRULE:/i, '')}`);
  for (const x of e.exdates ?? []) L.push(dateProp('EXDATE', x, e.allDay, e.tz));
  if (e.status) L.push(`STATUS:${e.status.toUpperCase()}`);
  if (e.organizer) L.push(`ORGANIZER${e.organizer.name ? `;CN="${e.organizer.name}"` : ''}:mailto:${e.organizer.email}`);
  for (const a of e.attendees ?? []) {
    L.push(`ATTENDEE${a.name ? `;CN="${a.name}"` : ''};ROLE=${a.role === 'optional' ? 'OPT-PARTICIPANT' : a.role === 'chair' ? 'CHAIR' : 'REQ-PARTICIPANT'};PARTSTAT=${(a.status ?? 'needs-action').toUpperCase()};RSVP=TRUE:mailto:${a.email}`);
  }
  for (const al of e.alarms ?? []) {
    const m = Math.abs(al.minutesBefore);
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(e.title)}`, `TRIGGER:${al.minutesBefore >= 0 ? '-' : ''}PT${m}M`, 'END:VALARM');
  }
  L.push('END:VEVENT');
  return L;
}

/** A whole calendar object: the event and (optionally) its changed occurrences. */
export function serializeEvents(events: CalEvent[], opts: { method?: 'REQUEST' | 'REPLY' | 'CANCEL' | 'PUBLISH'; now?: number } = {}): string {
  const now = opts.now ?? Date.now();
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ashforde//Keeper//EN', 'CALSCALE:GREGORIAN'];
  if (opts.method) L.push(`METHOD:${opts.method}`);
  for (const e of events) L.push(...eventLines(e, now));
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

export function serializeTodo(r: Reminder, now = Date.now()): string {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ashforde//Keeper//EN', 'BEGIN:VTODO', `UID:${r.uid ?? r.id}`, `DTSTAMP:${utcStamp(now)}`, `SUMMARY:${escapeText(r.title)}`];
  if (r.notes) L.push(`DESCRIPTION:${escapeText(r.notes)}`);
  if (r.created) L.push(`CREATED:${utcStamp(r.created)}`);
  if (r.plannedFor && /^\d{4}-\d{2}-\d{2}$/.test(r.plannedFor)) L.push(`DTSTART;VALUE=DATE:${r.plannedFor.replace(/-/g, '')}`);
  if (r.due !== undefined) L.push(`DUE:${utcStamp(r.due)}`);
  // RFC 5545 needs DTSTART or DUE for a repeating task; the planned day or the due date anchors it.
  if (r.rrule && (r.plannedFor || r.due !== undefined)) L.push(`RRULE:${r.rrule.replace(/^RRULE:/i, '')}`);
  if (r.project) L.push(`CATEGORIES:${escapeText(r.project)}`);
  for (const st of r.steps ?? []) L.push(`X-KEEPER-STEP;X-ID=${st.id.replace(/[^\w-]/g, '')};X-DONE=${st.done ? 1 : 0}:${escapeText(st.title)}`);
  if (r.order !== undefined) L.push(`X-KEEPER-ORDER:${r.order}`);
  if (r.energy) L.push(`X-KEEPER-ENERGY:${r.energy}`);
  if (r.focus?.length) L.push(`X-KEEPER-FOCUS:${r.focus.map((f) => `${f.at}/${f.minutes}`).join(',')}`);
  if (r.priority) L.push(`PRIORITY:${r.priority === 3 ? 1 : r.priority === 2 ? 5 : 9}`);
  L.push(`STATUS:${r.done ? 'COMPLETED' : 'NEEDS-ACTION'}`);
  if (r.done) L.push(`COMPLETED:${utcStamp(r.doneAt ?? now)}`);
  if (r.remindAt !== undefined) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(r.title)}`, `TRIGGER;VALUE=DATE-TIME:${utcStamp(r.remindAt)}`, 'END:VALARM');
  L.push('END:VTODO', 'END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- occurrences

/**
 * Every occurrence that overlaps [from, to): single events as they are,
 * repeating ones expanded (cancelled dates skipped, changed occurrences used in
 * place of the instance they replace). Cancelled events are left out.
 */
export function occurrences(events: CalEvent[], from: number, to: number): Occurrence[] {
  const overrides = new Map<string, CalEvent>();
  for (const e of events) if (e.recurrenceId !== undefined) overrides.set(`${e.calendar}:${e.uid}:${e.recurrenceId}`, e);
  const out: Occurrence[] = [];
  for (const e of events) {
    if (e.recurrenceId !== undefined) continue;
    const len = e.end - e.start;
    const rule = e.rrule ? parseRRule(e.rrule) : null;
    if (!rule) {
      if (e.status !== 'cancelled' && e.end > from && e.start < to) out.push({ event: e, start: e.start, end: e.end, instance: e.start });
      continue;
    }
    // Start a little early so a long event that began before `from` still shows.
    for (const t of expand(rule, e.start, e.allDay ? undefined : e.tz, from - Math.max(len, 0), to, e.exdates)) {
      const o = overrides.get(`${e.calendar}:${e.uid}:${t}`);
      if (o) {
        overrides.delete(`${e.calendar}:${e.uid}:${t}`);
        if (o.status !== 'cancelled' && o.end > from && o.start < to) out.push({ event: o, start: o.start, end: o.end, instance: t });
      } else if (t + len > from) out.push({ event: e, start: t, end: t + len, instance: t });
    }
  }
  // Changed occurrences moved into the range from an instance outside it.
  for (const o of overrides.values()) if (o.status !== 'cancelled' && o.end > from && o.start < to) out.push({ event: o, start: o.start, end: o.end, instance: o.recurrenceId! });
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}
