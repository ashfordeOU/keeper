// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Calendars, tasks and contacts over CalDAV/CardDAV (iCloud, Fastmail,
// Nextcloud, Google, any standard server), .ics subscriptions, and Microsoft
// 365 calendars through Microsoft Graph.

import { absolute, BODY, calendarQuery, hrefIn, multiget, parseAddressbooks, parseCalendars, parseMultistatus, PROP, syncCollection, type DavCollection } from '../../../core/pim/caldav';
import { parseEvents, parseTodos, serializeEvents, serializeTodo } from '../../../core/pim/ical';
import { parseVCards } from '../../../core/pim/vcard';
import type { CalEvent, Contact, Reminder } from '../../../core/pim/types';

export type DavAuth = { basic: { user: string; pass: string } } | { bearer: string };

export interface DavResult {
  status: number;
  text: string;
  headers: Headers;
  url: string;
}

export async function dav(method: string, url: string, auth: DavAuth, body?: string, extra: Record<string, string> = {}): Promise<DavResult> {
  const headers: Record<string, string> = { ...extra };
  if ('basic' in auth) headers.authorization = 'Basic ' + Buffer.from(`${auth.basic.user}:${auth.basic.pass}`).toString('base64');
  else headers.authorization = `Bearer ${auth.bearer}`;
  if (body) headers['content-type'] = headers['content-type'] ?? 'application/xml; charset=utf-8';
  // Redirects are followed by hand so the method and body survive them.
  let target = url;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(target, { method, headers, body, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) {
      target = new URL(res.headers.get('location')!, target).toString();
      continue;
    }
    if (res.status === 401) throw new Error('The server did not accept the user name or password');
    return { status: res.status, text: await res.text(), headers: res.headers, url: target };
  }
  throw new Error('Too many redirects');
}

export interface Discovery {
  calendars: (DavCollection & { url: string })[];
  addressbooks: (DavCollection & { url: string })[];
}

/** Finds the calendars and address books starting from a server address. */
export async function discover(base: string, auth: DavAuth, contactsBase?: string): Promise<Discovery> {
  const principalOf = async (start: string): Promise<string> => {
    // RFC 6764: try /.well-known/caldav first when given a bare host.
    const tries = /\/\.well-known\//.test(start) || new URL(start).pathname.length > 1 ? [start] : [new URL('/.well-known/caldav', start).toString(), start];
    for (const t of tries) {
      try {
        const r = await dav('PROPFIND', t, auth, BODY.principal, { depth: '0' });
        if (r.status >= 300) continue;
        const resp = parseMultistatus(r.text).responses[0];
        const p = resp && hrefIn(resp, PROP.principal);
        if (p) return absolute(r.url, p);
        return r.url;
      } catch (e) {
        if (/did not accept/.test(String(e))) throw e;
      }
    }
    return start;
  };
  const principal = await principalOf(base);
  const home = await dav('PROPFIND', principal, auth, BODY.homes, { depth: '0' });
  const r = parseMultistatus(home.text).responses[0];
  const calHome = r && hrefIn(r, PROP.calendarHome);
  const cardHome = r && hrefIn(r, PROP.addressbookHome);
  const calendars: Discovery['calendars'] = [];
  if (calHome) {
    const url = absolute(home.url, calHome);
    const list = await dav('PROPFIND', url, auth, BODY.calendars, { depth: '1' });
    for (const c of parseCalendars(list.text)) calendars.push({ ...c, url: absolute(list.url, c.href) });
  }
  const addressbooks: Discovery['addressbooks'] = [];
  let bookHome = cardHome ? absolute(home.url, cardHome) : undefined;
  if (!bookHome && contactsBase) {
    try {
      const p = await principalOf(contactsBase);
      const h = await dav('PROPFIND', p, auth, BODY.homes, { depth: '0' });
      const rr = parseMultistatus(h.text).responses[0];
      const ch = rr && hrefIn(rr, PROP.addressbookHome);
      if (ch) bookHome = absolute(h.url, ch);
    } catch {
      /* no contacts on this server */
    }
  }
  if (bookHome) {
    const list = await dav('PROPFIND', bookHome, auth, BODY.addressbooks, { depth: '1' });
    for (const b of parseAddressbooks(list.text)) addressbooks.push({ ...b, url: absolute(list.url, b.href) });
  }
  return { calendars, addressbooks };
}

export interface SyncResult {
  /** full list replaces the cache when true; otherwise apply `changed` and `removed` */
  full: boolean;
  events: CalEvent[];
  todos: Reminder[];
  removedHrefs: string[];
  syncToken?: string;
}

function eventsFrom(responses: { href: string; etag?: string; data?: string }[], calendar: string, base: string) {
  const events: CalEvent[] = [];
  const todos: Reminder[] = [];
  for (const r of responses) {
    if (!r.data) continue;
    const href = absolute(base, r.href);
    for (const e of parseEvents(r.data, calendar)) events.push({ ...e, href, etag: r.etag });
    for (const t of parseTodos(r.data, calendar)) todos.push({ ...t, href, etag: r.etag });
  }
  return { events, todos };
}

/**
 * Brings one calendar up to date: changes since the last sync token when the
 * server supports it (only what changed is downloaded), otherwise everything
 * in a window around today.
 */
export async function syncCalendar(url: string, calendar: string, auth: DavAuth, token: string | undefined, window: { from: number; to: number }): Promise<SyncResult> {
  if (token) {
    const r = await dav('REPORT', url, auth, syncCollection(token), { depth: '1' });
    if (r.status === 207) {
      const ms = parseMultistatus(r.text);
      const changed = ms.responses.filter((x) => x.status < 300 && x.href.replace(/\/$/, '') !== new URL(url).pathname.replace(/\/$/, ''));
      const removed = ms.responses.filter((x) => x.status === 404).map((x) => absolute(url, x.href));
      let got = { events: [] as CalEvent[], todos: [] as Reminder[] };
      if (changed.length) {
        const m = await dav('REPORT', url, auth, multiget(changed.map((c) => c.href)), { depth: '1' });
        got = eventsFrom(parseMultistatus(m.text).responses, calendar, url);
      }
      return { full: false, ...got, removedHrefs: removed, syncToken: ms.syncToken };
    }
    // Token expired (403/409/412): start over below.
  }
  const ev = await dav('REPORT', url, auth, calendarQuery(window.from, window.to, 'VEVENT'), { depth: '1' });
  if (ev.status !== 207) throw new Error(`The calendar server answered ${ev.status}`);
  const a = eventsFrom(parseMultistatus(ev.text).responses, calendar, url);
  let todos: Reminder[] = [];
  try {
    const td = await dav('REPORT', url, auth, calendarQuery(0, 0, 'VTODO'), { depth: '1' });
    if (td.status === 207) todos = eventsFrom(parseMultistatus(td.text).responses, calendar, url).todos;
  } catch {
    /* no tasks here */
  }
  // A fresh token for next time.
  let syncToken: string | undefined;
  try {
    const t = await dav('REPORT', url, auth, syncCollection(''), { depth: '1' });
    if (t.status === 207) syncToken = parseMultistatus(t.text).syncToken;
  } catch {
    /* server has no sync support */
  }
  return { full: true, events: a.events, todos, removedHrefs: [], syncToken };
}

/** Saves an event (and its changed occurrences) as one calendar object. Returns its address and version. */
export async function putEvent(calUrl: string, auth: DavAuth, events: CalEvent[], existing?: { href: string; etag?: string }): Promise<{ href: string; etag?: string }> {
  const uid = events[0].uid;
  const href = existing?.href ?? new URL(`${encodeURIComponent(uid)}.ics`, calUrl.endsWith('/') ? calUrl : calUrl + '/').toString();
  const cond: Record<string, string> = existing?.etag ? { 'if-match': existing.etag } : existing ? {} : { 'if-none-match': '*' };
  const r = await dav('PUT', href, auth, serializeEvents(events), { 'content-type': 'text/calendar; charset=utf-8', ...cond });
  if (r.status === 412) throw new Error('This event was changed elsewhere; Keeper fetched the new version, please try again');
  if (r.status >= 300) throw new Error(`The calendar server answered ${r.status}`);
  return { href, etag: r.headers.get('etag') ?? undefined };
}

export async function putTodo(calUrl: string, auth: DavAuth, t: Reminder): Promise<{ href: string; etag?: string }> {
  const href = t.href ?? new URL(`${encodeURIComponent(t.uid ?? t.id)}.ics`, calUrl.endsWith('/') ? calUrl : calUrl + '/').toString();
  const r = await dav('PUT', href, auth, serializeTodo(t), { 'content-type': 'text/calendar; charset=utf-8', ...(t.etag ? { 'if-match': t.etag } : t.href ? {} : { 'if-none-match': '*' }) });
  if (r.status >= 300) throw new Error(`The server answered ${r.status}`);
  return { href, etag: r.headers.get('etag') ?? undefined };
}

export async function deleteHref(href: string, auth: DavAuth, etag?: string) {
  const r = await dav('DELETE', href, auth, undefined, etag ? { 'if-match': etag } : {});
  if (r.status >= 300 && r.status !== 404) throw new Error(`The server answered ${r.status}`);
}

export async function fetchContacts(bookUrl: string, auth: DavAuth, account: string): Promise<Contact[]> {
  const r = await dav('REPORT', bookUrl, auth, `<?xml version="1.0" encoding="utf-8"?><card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><card:address-data/></d:prop></card:addressbook-query>`, { depth: '1' });
  if (r.status !== 207) {
    // Some servers want a multiget instead.
    const list = await dav('PROPFIND', bookUrl, auth, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>', { depth: '1' });
    const hrefs = parseMultistatus(list.text).responses.map((x) => x.href).filter((h) => /\.vcf$/i.test(h));
    if (!hrefs.length) return [];
    const m = await dav('REPORT', bookUrl, auth, multiget(hrefs, true), { depth: '1' });
    return parseMultistatus(m.text).responses.flatMap((x) => (x.data ? parseVCards(x.data, account).map((c) => ({ ...c, href: absolute(bookUrl, x.href), etag: x.etag })) : []));
  }
  return parseMultistatus(r.text).responses.flatMap((x) => (x.data ? parseVCards(x.data, account).map((c) => ({ ...c, href: absolute(bookUrl, x.href), etag: x.etag })) : []));
}

/** A subscribed .ics address (webcal:// works too). */
export async function fetchIcs(url: string, calendar: string): Promise<CalEvent[]> {
  if (/^file:\/\//i.test(url)) return parseEvents(await (await import('node:fs')).promises.readFile(decodeURIComponent(url.replace(/^file:\/\//i, '')), 'utf8'), calendar);
  const res = await fetch(url.replace(/^webcal:/i, 'https:'), { headers: { accept: 'text/calendar' } });
  if (!res.ok) throw new Error(`The calendar address answered ${res.status}`);
  return parseEvents(await res.text(), calendar);
}

// ---------------------------------------------------------------- Microsoft Graph

const GRAPH = 'https://graph.microsoft.com/v1.0';

interface GraphEvent {
  id: string;
  subject?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  location?: { displayName?: string };
  bodyPreview?: string;
  onlineMeeting?: { joinUrl?: string } | null;
  webLink?: string;
  isCancelled?: boolean;
  seriesMasterId?: string;
  reminderMinutesBeforeStart?: number;
  isReminderOn?: boolean;
  attendees?: { emailAddress: { name?: string; address: string }; status?: { response?: string } }[];
  organizer?: { emailAddress: { name?: string; address: string } };
  iCalUId?: string;
  changeKey?: string;
}

async function graph<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path.startsWith('http') ? path : GRAPH + path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'outlook.timezone="UTC"', ...(init.headers ?? {}) } });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: { message?: string } }).error?.message ?? `Microsoft answered ${res.status}`);
  return json as T;
}

export async function graphCalendars(token: string): Promise<{ id: string; name: string; color?: string; readOnly: boolean }[]> {
  const r = await graph<{ value: { id: string; name: string; hexColor?: string; canEdit?: boolean }[] }>(token, '/me/calendars?$top=100');
  return r.value.map((c) => ({ id: c.id, name: c.name, color: c.hexColor || undefined, readOnly: c.canEdit === false }));
}

/** Occurrences already expanded by Microsoft for the window (repeats included). */
export async function graphEvents(token: string, calendarId: string, calendar: string, from: number, to: number): Promise<CalEvent[]> {
  const out: CalEvent[] = [];
  let next: string | undefined = `/me/calendars/${encodeURIComponent(calendarId)}/calendarView?startDateTime=${new Date(from).toISOString()}&endDateTime=${new Date(to).toISOString()}&$top=200`;
  while (next) {
    const page: { value: GraphEvent[]; '@odata.nextLink'?: string } = await graph(token, next);
    for (const e of page.value) {
      const start = Date.parse(e.start.dateTime + 'Z');
      const end = Date.parse(e.end.dateTime + 'Z');
      out.push({
        id: `${calendar}:${e.id}`, calendar, uid: e.iCalUId ?? e.id, title: e.subject ?? '(no title)', start, end, allDay: !!e.isAllDay,
        location: e.location?.displayName || undefined, description: e.bodyPreview || undefined, url: e.onlineMeeting?.joinUrl ?? undefined,
        status: e.isCancelled ? 'cancelled' : undefined, href: e.id, etag: e.changeKey,
        alarms: e.isReminderOn ? [{ minutesBefore: e.reminderMinutesBeforeStart ?? 15 }] : undefined,
        attendees: e.attendees?.map((a) => ({ email: a.emailAddress.address, name: a.emailAddress.name, status: a.status?.response === 'accepted' ? 'accepted' : a.status?.response === 'declined' ? 'declined' : a.status?.response === 'tentativelyAccepted' ? 'tentative' : 'needs-action' })),
        organizer: e.organizer ? { email: e.organizer.emailAddress.address, name: e.organizer.emailAddress.name } : undefined,
      });
    }
    next = page['@odata.nextLink'];
  }
  return out;
}

function toGraph(e: CalEvent) {
  const t = (ms: number) => ({ dateTime: new Date(ms).toISOString().replace('Z', ''), timeZone: 'UTC' });
  return {
    subject: e.title, start: t(e.start), end: t(e.end), isAllDay: e.allDay,
    location: e.location ? { displayName: e.location } : undefined,
    body: e.description ? { contentType: 'text', content: e.description } : undefined,
    isReminderOn: !!e.alarms?.length, reminderMinutesBeforeStart: e.alarms?.[0]?.minutesBefore,
    attendees: e.attendees?.map((a) => ({ emailAddress: { address: a.email, name: a.name }, type: a.role === 'optional' ? 'optional' : 'required' })),
  };
}

export async function graphSave(token: string, calendarId: string, e: CalEvent): Promise<{ href: string; etag?: string }> {
  if (e.href) {
    const r = await graph<GraphEvent>(token, `/me/events/${encodeURIComponent(e.href)}`, { method: 'PATCH', body: JSON.stringify(toGraph(e)) });
    return { href: r.id, etag: r.changeKey };
  }
  const r = await graph<GraphEvent>(token, `/me/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', body: JSON.stringify(toGraph(e)) });
  return { href: r.id, etag: r.changeKey };
}

export async function graphDelete(token: string, id: string) {
  await graph(token, `/me/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
