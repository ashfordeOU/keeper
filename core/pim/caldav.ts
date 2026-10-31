// SPDX-License-Identifier: AGPL-3.0-or-later
// CalDAV and CardDAV (RFC 4791, 6352, 6578): the request bodies Keeper sends
// and the answers it reads. The HTTP side lives in the main process.

import { escapeXml, find, findAll, parseXml, textOf, type XmlNode } from './xml';

const DAV = 'DAV:';
const CAL = 'urn:ietf:params:xml:ns:caldav';
const CARD = 'urn:ietf:params:xml:ns:carddav';
const CS = 'http://calendarserver.org/ns/';
const APPLE = 'http://apple.com/ns/ical/';

export const BODY = {
  principal: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
  homes: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="${CAL}" xmlns:card="${CARD}"><d:prop><c:calendar-home-set/><card:addressbook-home-set/><d:displayname/></d:prop></d:propfind>`,
  calendars: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="${CAL}" xmlns:cs="${CS}" xmlns:a="${APPLE}"><d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><cs:getctag/><d:sync-token/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>`,
  addressbooks: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:cs="${CS}"><d:prop><d:resourcetype/><d:displayname/><cs:getctag/><d:sync-token/></d:prop></d:propfind>`,
};

function davDate(t: number): string {
  return new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Events (or tasks) overlapping a time range, with their data. */
export function calendarQuery(from: number, to: number, component: 'VEVENT' | 'VTODO' = 'VEVENT'): string {
  const range = component === 'VEVENT' ? `<c:time-range start="${davDate(from)}" end="${davDate(to)}"/>` : '';
  return `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="${CAL}"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="${component}">${range}</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
}

/** What changed since a sync token (empty token = everything). */
export function syncCollection(token: string, card = false): string {
  return `<?xml version="1.0" encoding="utf-8"?><d:sync-collection xmlns:d="DAV:" xmlns:c="${card ? CARD : CAL}"><d:sync-token>${escapeXml(token)}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`;
}

export function multiget(hrefs: string[], card = false): string {
  const ns = card ? CARD : CAL;
  const tag = card ? 'card:addressbook-multiget' : 'c:calendar-multiget';
  const data = card ? '<card:address-data/>' : '<c:calendar-data/>';
  return `<?xml version="1.0" encoding="utf-8"?><${tag} xmlns:d="DAV:" xmlns:${card ? 'card' : 'c'}="${ns}"><d:prop><d:getetag/>${data}</d:prop>${hrefs.map((h) => `<d:href>${escapeXml(h)}</d:href>`).join('')}</${tag}>`;
}

export interface DavResponse {
  href: string;
  /** HTTP status of the props (200, 404…) or of the resource (deleted = 404) */
  status: number;
  props: Map<string, XmlNode>;
  etag?: string;
  data?: string;
}

function statusCode(s: string): number {
  return Number(s.match(/\s(\d{3})\s/)?.[1] ?? s.match(/(\d{3})/)?.[1] ?? 0);
}

export function parseMultistatus(xml: string): { responses: DavResponse[]; syncToken?: string } {
  const doc = parseXml(xml);
  const responses: DavResponse[] = [];
  for (const r of findAll(doc, `{${DAV}}response`)) {
    const href = decodeURIComponent(textOf(find(r, `{${DAV}}href`)));
    const props = new Map<string, XmlNode>();
    let status = 0;
    const direct = r.children.find((c) => c.name === `{${DAV}}status`);
    if (direct) status = statusCode(textOf(direct));
    for (const ps of r.children.filter((c) => c.name === `{${DAV}}propstat`)) {
      const st = statusCode(textOf(ps.children.find((c) => c.name === `{${DAV}}status`)));
      const prop = ps.children.find((c) => c.name === `{${DAV}}prop`);
      if (st >= 200 && st < 300) {
        if (!status) status = st;
        for (const p of prop?.children ?? []) props.set(p.name, p);
      } else if (!status) status = st;
    }
    const etag = props.get(`{${DAV}}getetag`);
    const data = props.get(`{${CAL}}calendar-data`) ?? props.get(`{${CARD}}address-data`);
    responses.push({ href, status: status || 200, props, etag: etag ? textOf(etag) : undefined, data: data ? data.text || textOf(data) : undefined });
  }
  const tok = doc.children[0]?.children.find((c) => c.name === `{${DAV}}sync-token`);
  return { responses, syncToken: tok ? textOf(tok) : undefined };
}

/** The first href inside a property (current-user-principal, calendar-home-set…). */
export function hrefIn(r: DavResponse, prop: string): string | undefined {
  const p = r.props.get(prop);
  return p ? textOf(find(p, `{${DAV}}href`)) || undefined : undefined;
}

export const PROP = {
  principal: `{${DAV}}current-user-principal`,
  calendarHome: `{${CAL}}calendar-home-set`,
  addressbookHome: `{${CARD}}addressbook-home-set`,
};

export interface DavCollection {
  href: string;
  name: string;
  color?: string;
  ctag?: string;
  syncToken?: string;
  readOnly: boolean;
  /** components it holds: VEVENT, VTODO */
  components: string[];
}

/** Calendars in a calendar-home listing (the home itself and non-calendars skipped). */
export function parseCalendars(xml: string): DavCollection[] {
  const out: DavCollection[] = [];
  for (const r of parseMultistatus(xml).responses) {
    const rt = r.props.get(`{${DAV}}resourcetype`);
    if (!rt || !rt.children.some((c) => c.name === `{${CAL}}calendar`)) continue;
    const comps = r.props.get(`{${CAL}}supported-calendar-component-set`);
    const components = comps ? comps.children.filter((c) => c.local === 'comp').map((c) => c.attrs.name) : ['VEVENT', 'VTODO'];
    const priv = r.props.get(`{${DAV}}current-user-privilege-set`);
    const names = priv ? findAll(priv, `{${DAV}}privilege`).flatMap((p) => p.children.map((c) => c.local)) : ['write'];
    const color = textOf(r.props.get(`{${APPLE}}calendar-color`));
    out.push({
      href: r.href,
      name: textOf(r.props.get(`{${DAV}}displayname`)) || r.href.split('/').filter(Boolean).pop() || 'Calendar',
      // Some servers store #RRGGBBAA.
      color: color ? color.slice(0, 7) : undefined,
      ctag: textOf(r.props.get(`{${CS}}getctag`)) || undefined,
      syncToken: textOf(r.props.get(`{${DAV}}sync-token`)) || undefined,
      readOnly: !names.some((n) => n === 'write' || n === 'write-content' || n === 'all'),
      components,
    });
  }
  return out;
}

export function parseAddressbooks(xml: string): DavCollection[] {
  const out: DavCollection[] = [];
  for (const r of parseMultistatus(xml).responses) {
    const rt = r.props.get(`{${DAV}}resourcetype`);
    if (!rt || !rt.children.some((c) => c.name === `{${CARD}}addressbook`)) continue;
    out.push({ href: r.href, name: textOf(r.props.get(`{${DAV}}displayname`)) || 'Contacts', readOnly: false, components: [], ctag: textOf(r.props.get(`{${CS}}getctag`)) || undefined, syncToken: textOf(r.props.get(`{${DAV}}sync-token`)) || undefined });
  }
  return out;
}

/** Resolves a (possibly relative) href against the server it came from. */
export function absolute(base: string, href: string): string {
  return new URL(href, base).toString();
}

/** Where to start looking for a provider's CalDAV service. */
export const WELL_KNOWN_CALDAV: Record<string, string> = {
  'icloud.com': 'https://caldav.icloud.com/',
  'me.com': 'https://caldav.icloud.com/',
  'mac.com': 'https://caldav.icloud.com/',
  'fastmail.com': 'https://caldav.fastmail.com/dav/',
  'gmail.com': 'https://apidata.googleusercontent.com/caldav/v2/',
  'googlemail.com': 'https://apidata.googleusercontent.com/caldav/v2/',
  'yahoo.com': 'https://caldav.calendar.yahoo.com/',
};

export const WELL_KNOWN_CARDDAV: Record<string, string> = {
  'icloud.com': 'https://contacts.icloud.com/',
  'me.com': 'https://contacts.icloud.com/',
  'fastmail.com': 'https://carddav.fastmail.com/dav/',
  'gmail.com': 'https://www.googleapis.com/carddav/v1/principals/',
};
