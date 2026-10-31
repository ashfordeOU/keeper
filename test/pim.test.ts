// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dueKey, dueNow, meetingLink, nextAlarmTime } from '../core/pim/alarms';
import { autoconfigUrls, fromSrv, knownProvider, parseAutoconfig } from '../core/pim/autoconfig';
import { calendarQuery, hrefIn, multiget, parseCalendars, parseMultistatus, PROP, syncCollection } from '../core/pim/caldav';
import { fold, occurrences, parseEvents, parseTodos, serializeEvents, serializeTodo } from '../core/pim/ical';
import { applyReply, readInvitation, replyTo } from '../core/pim/imip';
import { baseSubject, makeReply, matchesQuery, parseAddressList, parseUnsubscribe, ruleMatches, snippetOf, threadMessages, formatAddress } from '../core/pim/mail';
import { authUrl, codeExchange, pkce, readRedirect, readTokenResponse, xoauth2 } from '../core/pim/oauth';
import { parseQuickAdd } from '../core/pim/quickadd';
import { describeRRule, expand, formatRRule, parseRRule } from '../core/pim/rrule';
import { sanitizeMail } from '../core/pim/sanitize';
import { fromWall, isoWeek, toWall } from '../core/pim/tz';
import type { Alarm, MessageSummary } from '../core/pim/types';
import { parseVCards, serializeVCard, suggest } from '../core/pim/vcard';
import { parseXml, textOf, find } from '../core/pim/xml';
import { FEATURES } from '../core/features';

const NY = 'America/New_York';
const BER = 'Europe/Berlin';

describe('time zones', () => {
  it('converts wall time both ways, across daylight saving', () => {
    // 2026-03-08 is the US spring-forward day: 09:00 is EDT (UTC-4), the day before EST (UTC-5).
    expect(new Date(fromWall({ y: 2026, mo: 3, d: 7, h: 9, mi: 0, s: 0 }, NY)).toISOString()).toBe('2026-03-07T14:00:00.000Z');
    expect(new Date(fromWall({ y: 2026, mo: 3, d: 8, h: 9, mi: 0, s: 0 }, NY)).toISOString()).toBe('2026-03-08T13:00:00.000Z');
    expect(toWall(Date.UTC(2026, 6, 1, 12), BER)).toMatchObject({ h: 14, mi: 0 });
  });
  it('moves a skipped time forward and takes the first of a repeated one', () => {
    // 02:30 does not exist on 2026-03-08 in New York.
    const t = fromWall({ y: 2026, mo: 3, d: 8, h: 2, mi: 30, s: 0 }, NY);
    expect(toWall(t, NY).h).toBe(3);
    // 01:30 happens twice on 2026-11-01; the first is EDT (05:30Z).
    expect(new Date(fromWall({ y: 2026, mo: 11, d: 1, h: 1, mi: 30, s: 0 }, NY)).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
  it('numbers ISO weeks', () => {
    expect(isoWeek(new Date(2026, 0, 1).getTime())).toBe(1);
    expect(isoWeek(new Date(2026, 11, 31).getTime())).toBe(53);
  });
});

describe('repeating events', () => {
  it('keeps 9:00 local across a daylight-saving change', () => {
    const start = fromWall({ y: 2026, mo: 3, d: 5, h: 9, mi: 0, s: 0 }, NY);
    const r = parseRRule('FREQ=DAILY;COUNT=5')!;
    const ts = expand(r, start, NY, start, start + 30 * 86_400_000);
    expect(ts).toHaveLength(5);
    expect(ts.map((t) => toWall(t, NY).h)).toEqual([9, 9, 9, 9, 9]);
    // The UTC hour shifts by one across 8 March.
    expect(new Date(ts[2]).getUTCHours()).toBe(14);
    expect(new Date(ts[3]).getUTCHours()).toBe(13);
  });
  it('does weekly on several days with an interval', () => {
    const start = fromWall({ y: 2026, mo: 1, d: 5, h: 10, mi: 0, s: 0 }, BER); // a Monday
    const ts = expand(parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4')!, start, BER, 0, Infinity);
    expect(ts.map((t) => toWall(t, BER).d)).toEqual([5, 7, 19, 21]);
  });
  it('does "last Friday" and "second Tuesday" of the month', () => {
    const start = fromWall({ y: 2026, mo: 1, d: 30, h: 16, mi: 0, s: 0 }, BER);
    const last = expand(parseRRule('FREQ=MONTHLY;BYDAY=-1FR;COUNT=3')!, start, BER, 0, Infinity).map((t) => toWall(t, BER));
    expect(last.map((w) => `${w.mo}-${w.d}`)).toEqual(['1-30', '2-27', '3-27']);
    const s2 = fromWall({ y: 2026, mo: 1, d: 13, h: 9, mi: 0, s: 0 }, BER);
    expect(expand(parseRRule('FREQ=MONTHLY;BYDAY=2TU;COUNT=2')!, s2, BER, 0, Infinity).map((t) => toWall(t, BER).d)).toEqual([13, 10]);
  });
  it('skips months without the day, and honours UNTIL and BYSETPOS', () => {
    const start = new Date(2026, 0, 31, 12).getTime();
    expect(expand(parseRRule('FREQ=MONTHLY;COUNT=3')!, start, undefined, 0, Infinity).map((t) => new Date(t).getMonth())).toEqual([0, 2, 4]);
    const until = parseRRule('FREQ=DAILY;UNTIL=20260103T235959Z')!;
    expect(expand(until, new Date(2026, 0, 1, 9).getTime(), undefined, 0, Infinity)).toHaveLength(3);
    // Last weekday of the month.
    const lw = expand(parseRRule('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=2')!, new Date(2026, 0, 1, 9).getTime(), undefined, 0, Infinity);
    expect(lw.map((t) => new Date(t).getDate())).toEqual([30, 27]);
  });
  it('does yearly birthdays and round-trips the rule text', () => {
    const r = parseRRule('FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=4')!;
    expect(expand(r, new Date(2020, 6, 4).getTime(), undefined, new Date(2026, 0, 1).getTime(), new Date(2028, 0, 1).getTime()).map((t) => new Date(t).getFullYear())).toEqual([2026, 2027]);
    expect(parseRRule(formatRRule(parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,-1FR;COUNT=4')!))).toEqual(parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,-1FR;COUNT=4'));
    expect(describeRRule(parseRRule('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR')!)).toBe('Every weekday');
  });
});

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
METHOD:REQUEST
BEGIN:VEVENT
UID:standup-1
DTSTART;TZID=Europe/Berlin:20260105T091500
DTEND;TZID=Europe/Berlin:20260105T093000
RRULE:FREQ=DAILY;COUNT=5
EXDATE;TZID=Europe/Berlin:20260107T091500
SUMMARY:Standup\\, team
LOCATION:https://meet.google.com/abc-defg-hij
ORGANIZER;CN="Ana Lopez":mailto:ana@example.org
ATTENDEE;CN=Bob;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:bob@example.org
BEGIN:VALARM
TRIGGER:-PT10M
ACTION:DISPLAY
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:standup-1
RECURRENCE-ID;TZID=Europe/Berlin:20260108T091500
DTSTART;TZID=Europe/Berlin:20260108T100000
DTEND;TZID=Europe/Berlin:20260108T101500
SUMMARY:Standup (moved)
END:VEVENT
END:VCALENDAR`;

describe('iCalendar', () => {
  it('reads repeats, cancelled dates, changed occurrences and alarms', () => {
    const evs = parseEvents(ICS, 'work');
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({ title: 'Standup, team', tz: BER, alarms: [{ minutesBefore: 10 }] });
    const occ = occurrences(evs, fromWall({ y: 2026, mo: 1, d: 1, h: 0, mi: 0, s: 0 }, BER), fromWall({ y: 2026, mo: 2, d: 1, h: 0, mi: 0, s: 0 }, BER));
    expect(occ.map((o) => `${toWall(o.start, BER).d} ${toWall(o.start, BER).h}:${toWall(o.start, BER).mi}`)).toEqual(['5 9:15', '6 9:15', '8 10:0', '9 9:15']);
    expect(occ[2].event.title).toBe('Standup (moved)');
  });
  it('writes what it reads', () => {
    const evs = parseEvents(ICS, 'work');
    const again = parseEvents(serializeEvents(evs), 'work');
    expect(again.map((e) => [e.title, e.start, e.end, e.rrule, e.exdates, e.recurrenceId])).toEqual(evs.map((e) => [e.title, e.start, e.end, e.rrule, e.exdates, e.recurrenceId]));
  });
  it('folds long lines at 75 octets without splitting characters', () => {
    const line = 'SUMMARY:' + 'ü'.repeat(60);
    const f = fold(line);
    expect(f.split('\r\n ').every((p) => new TextEncoder().encode(p).length <= 75)).toBe(true);
    expect(f.split('\r\n ').join('')).toBe(line);
  });
  it('reads and writes tasks', () => {
    const t = parseTodos(serializeTodo({ id: 'x', list: 'l', uid: 'u1', title: 'Pay rent', due: Date.UTC(2026, 1, 1, 9), done: false, priority: 3 }), 'l');
    expect(t[0]).toMatchObject({ title: 'Pay rent', due: Date.UTC(2026, 1, 1, 9), done: false, priority: 3 });
  });
  it('maps Windows zone names from Exchange invitations', () => {
    const e = parseEvents('BEGIN:VEVENT\nUID:w\nDTSTART;TZID=W. Europe Standard Time:20260601T100000\nSUMMARY:x\nEND:VEVENT')[0];
    expect(e.tz).toBe('Europe/Berlin');
  });
});

describe('invitations', () => {
  it('reads a request, writes a reply and applies one', () => {
    const inv = readInvitation(ICS)!;
    expect(inv.method).toBe('REQUEST');
    const r = replyTo(inv, { email: 'bob@example.org' }, 'accepted');
    expect(r.to).toBe('ana@example.org');
    expect(r.subject).toBe('Accepted: Standup, team');
    const back = readInvitation(r.ics)!;
    expect(back.method).toBe('REPLY');
    expect(back.replyFrom).toEqual({ email: 'bob@example.org', status: 'accepted' });
    expect(applyReply(inv.event, back).attendees?.[0].status).toBe('accepted');
  });
});

describe('CalDAV', () => {
  const MS = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/" xmlns:cs="http://calendarserver.org/ns/">
 <d:response><d:href>/cal/ana/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/cal/ana/work/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work &amp; more</d:displayname><a:calendar-color>#FF2968FF</a:calendar-color><cs:getctag>c1</cs:getctag><d:sync-token>http://x/sync/1</d:sync-token>
 <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
 <d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege></d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 <d:propstat><d:prop><x:missing xmlns:x="urn:x"/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>
 <d:response><d:href>/cal/ana/holidays/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Holidays</d:displayname><d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;
  it('lists calendars with colour, tags, write access and components', () => {
    const cals = parseCalendars(MS);
    expect(cals).toEqual([
      { href: '/cal/ana/work/', name: 'Work & more', color: '#FF2968', ctag: 'c1', syncToken: 'http://x/sync/1', readOnly: false, components: ['VEVENT'] },
      { href: '/cal/ana/holidays/', name: 'Holidays', color: undefined, ctag: undefined, syncToken: undefined, readOnly: true, components: ['VEVENT', 'VTODO'] },
    ]);
  });
  it('reads data, deletions and the new sync token', () => {
    const r = parseMultistatus(`<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/cal/a%20b.ics</D:href><D:propstat><D:prop><D:getetag>"e1"</D:getetag><C:calendar-data><![CDATA[BEGIN:VCALENDAR
END:VCALENDAR]]></C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response><D:response><D:href>/cal/gone.ics</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response><D:sync-token>tok2</D:sync-token></D:multistatus>`);
    expect(r.syncToken).toBe('tok2');
    expect(r.responses[0]).toMatchObject({ href: '/cal/a b.ics', etag: '"e1"', status: 200 });
    expect(r.responses[0].data).toContain('BEGIN:VCALENDAR');
    expect(r.responses[1].status).toBe(404);
  });
  it('finds the principal and builds request bodies', () => {
    const r = parseMultistatus('<multistatus xmlns="DAV:"><response><href>/</href><propstat><prop><current-user-principal><href>/p/ana/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>').responses[0];
    expect(hrefIn(r, PROP.principal)).toBe('/p/ana/');
    expect(calendarQuery(Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1))).toContain('start="20260101T000000Z"');
    expect(syncCollection('a&b')).toContain('a&amp;b');
    expect(multiget(['/x.ics'])).toContain('<d:href>/x.ics</d:href>');
  });
});

describe('finding mail servers', () => {
  it('knows the big providers', () => {
    expect(knownProvider('me@gmail.com')).toMatchObject({ oauth: 'google', imap: { host: 'imap.gmail.com', port: 993 } });
    expect(knownProvider('me@icloud.com')?.imap?.user).toBe('me');
    expect(knownProvider('me@example.org')).toBeUndefined();
  });
  it('reads an autoconfig file', () => {
    const xml = `<clientConfig version="1.1"><emailProvider id="ex"><displayName>Example Mail</displayName>
      <incomingServer type="pop3"><hostname>pop.ex.org</hostname></incomingServer>
      <incomingServer type="imap"><hostname>imap.%EMAILDOMAIN%</hostname><port>993</port><socketType>SSL</socketType><username>%EMAILLOCALPART%</username></incomingServer>
      <outgoingServer type="smtp"><hostname>smtp.ex.org</hostname><port>587</port><socketType>STARTTLS</socketType><username>%EMAILADDRESS%</username></outgoingServer>
    </emailProvider></clientConfig>`;
    expect(parseAutoconfig(xml, 'ana@ex.org')).toEqual({
      provider: 'Example Mail',
      imap: { host: 'imap.ex.org', port: 993, security: 'tls', user: 'ana' },
      smtp: { host: 'smtp.ex.org', port: 587, security: 'starttls', user: 'ana@ex.org' },
    });
    expect(autoconfigUrls('a@b.org')[0]).toBe('https://autoconfig.b.org/mail/config-v1.1.xml?emailaddress=a%40b.org');
    expect(fromSrv('a@b.org', [{ name: 'mail.b.org', port: 993 }], [{ name: '.', port: 0 }])).toMatchObject({ imap: { host: 'mail.b.org' }, smtp: undefined });
  });
});

describe('safe mail HTML', () => {
  it('removes scripts, handlers, forms and frames', () => {
    const r = sanitizeMail('<p onclick="x()">Hi<script>alert(1)</script></p><form action="//x"><input name=a></form><iframe src="//x"></iframe><a href="javascript:alert(1)">bad</a><svg><script>1</script></svg>');
    expect(r.html).not.toMatch(/script|onclick|<form|<input|<iframe|javascript:|<svg/i);
    expect(r.html).toContain('<p>Hi</p>');
  });
  it('holds back remote images and CSS, keeps inline ones, drops tracking pixels', () => {
    const html = `<style>@import url(https://x.org/a.css); body{background:url('https://x.org/bg.png')}</style>
      <img src="https://cdn.example.org/logo.png" alt="logo"><img src="cid:img1@x"><img src="https://t.example.org/open.gif" width="1" height="1">
      <div style="background-image:url(https://x.org/b.png);color:red">x</div><img src="https://list-manage.com/track/open.php?u=1">`;
    const r = sanitizeMail(html, { cid: { 'img1@x': 'data:image/png;base64,AAAA' } });
    expect(r.html).toContain('data-blocked-src="https://cdn.example.org/logo.png"');
    expect(r.html).not.toMatch(/[^-]src="https:\/\/cdn/);
    expect(r.html).toContain('src="data:image/png;base64,AAAA"');
    expect(r.html).not.toMatch(/open\.gif|list-manage/);
    expect(r.html).not.toMatch(/@import|url\(/);
    expect(r.html).toContain('color:red');
    expect(r.trackers).toBe(2);
    expect(r.blocked).toBe(4);
    const allowed = sanitizeMail(html, { allowRemote: true });
    expect(allowed.html).toContain('src="https://cdn.example.org/logo.png"');
    expect(allowed.html).not.toContain('open.gif');
  });
  it('makes links open outside and show where they go', () => {
    const r = sanitizeMail('<a href="https://bank.example.com/login">Your bank</a>');
    expect(r.html).toContain('target="_blank"');
    expect(r.html).toContain('title="https://bank.example.com/login"');
    expect(r.html).toContain('rel="noopener noreferrer"');
  });
});

const msg = (over: Partial<MessageSummary>): MessageSummary => ({ id: Math.random().toString(36), account: 'a', folder: 'INBOX', uid: 1, subject: 'Hello', to: [], cc: [], date: 0, seen: true, flagged: false, answered: false, snippet: '', hasAttachments: false, ...over });

describe('conversations and replies', () => {
  it('threads by headers and by subject when headers are missing', () => {
    const a = msg({ messageId: 'a@x', subject: 'Plans', date: 1 });
    const b = msg({ messageId: 'b@x', inReplyTo: 'a@x', subject: 'Re: Plans', date: 2, seen: false });
    const c = msg({ messageId: 'c@x', references: ['a@x', 'b@x'], subject: 'Re: Re: Plans', date: 3 });
    const d = msg({ messageId: 'd@x', subject: 'AW: Plans', date: 4 });
    const e = msg({ messageId: 'e@x', subject: 'Other', date: 5 });
    const t = threadMessages([e, c, a, d, b]);
    expect(t).toHaveLength(2);
    expect(t[0].messages.map((m) => m.messageId)).toEqual(['e@x']);
    expect(t[1].messages.map((m) => m.messageId)).toEqual(['a@x', 'b@x', 'c@x', 'd@x']);
    expect(t[1].unread).toBe(1);
    expect(baseSubject('Re: [list] Fwd: AW: Hello  there')).toBe('hello there');
  });
  it('builds reply-all without me and with threading headers', () => {
    const o = { ...msg({ messageId: 'm1@x', references: ['m0@x'], subject: 'Re: Budget', from: { name: 'Ana', address: 'ana@x.org' }, to: [{ address: 'me@x.org' }, { address: 'bob@x.org' }], cc: [{ address: 'cy@x.org' }], date: Date.UTC(2026, 0, 2) }), text: 'Line 1\nLine 2' };
    const d = makeReply({ original: o, me: ['ME@x.org'], mode: 'replyAll' });
    expect(d.to).toEqual([{ name: 'Ana', address: 'ana@x.org' }]);
    expect(d.cc.map((a) => a.address)).toEqual(['bob@x.org', 'cy@x.org']);
    expect(d.subject).toBe('Re: Budget');
    expect(d.references).toEqual(['m0@x', 'm1@x']);
    expect(d.quoted).toContain('> Line 2');
    const f = makeReply({ original: o, me: [], mode: 'forward' });
    expect(f.subject).toBe('Fwd: Budget');
    expect(f.to).toEqual([]);
  });
  it('parses and formats addresses', () => {
    expect(parseAddressList('"Lopez, Ana" <ana@x.org>, bob@y.org, junk')).toEqual([{ name: 'Lopez, Ana', address: 'ana@x.org' }, { address: 'bob@y.org' }]);
    expect(formatAddress({ name: 'Lopez, Ana', address: 'ana@x.org' })).toBe('"Lopez, Ana" <ana@x.org>');
  });
  it('reads unsubscribe headers, snippets, filters and search', () => {
    expect(parseUnsubscribe('<mailto:u@x.org?subject=unsub>, <https://x.org/u?id=1>', 'List-Unsubscribe=One-Click')).toEqual({ mailto: 'mailto:u@x.org?subject=unsub', url: 'https://x.org/u?id=1', oneClick: true });
    expect(snippetOf('Hi Ana,\nsee you soon.\n\nOn Mon, 1 Jan 2026 at 10:00, Bob wrote:\n> old')).toBe('Hi Ana, see you soon.');
    const m = { ...msg({ subject: 'Invoice 42', from: { address: 'billing@acme.com' }, hasAttachments: true, seen: false }), text: 'Total due' };
    expect(ruleMatches({ id: 'r', name: 'r', enabled: true, when: [{ field: 'from', contains: 'acme' }, { field: 'body', contains: 'due' }], then: { action: 'flag' } }, m)).toBe(true);
    expect(matchesQuery(m, 'from:acme is:unread has:attachment invoice')).toBe(true);
    expect(matchesQuery(m, 'from:other')).toBe(false);
  });
});

describe('quick add', () => {
  const now = new Date(2026, 9, 28, 10, 0).getTime(); // Wednesday
  it('understands days, times, durations and places', () => {
    const e = parseQuickAdd('Lunch with Ana Friday 1pm at Café Sol', now)!;
    expect(e.title).toBe('Lunch with Ana');
    expect(new Date(e.start)).toEqual(new Date(2026, 9, 30, 13, 0));
    expect(e.end - e.start).toBe(3_600_000);
    expect(e.location).toBe('Café Sol');
    const d = parseQuickAdd('Dentist tomorrow 15:30 for 45 min', now)!;
    expect(new Date(d.start)).toEqual(new Date(2026, 9, 29, 15, 30));
    expect(d.end - d.start).toBe(45 * 60_000);
    const r = parseQuickAdd('Meeting next tuesday 10-11am', now)!;
    expect([new Date(r.start).getDate(), new Date(r.start).getHours(), new Date(r.end).getHours()]).toEqual([3, 10, 11]);
  });
  it('makes repeating and all-day events', () => {
    const s = parseQuickAdd('Standup every weekday 9:15', now)!;
    expect(s.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(s.title).toBe('Standup');
    const trip = parseQuickAdd('Trip to Lisbon 12-15 March', now)!;
    expect(trip.allDay).toBe(true);
    expect(new Date(trip.start)).toEqual(new Date(2026, 2, 12));
    expect(new Date(trip.end)).toEqual(new Date(2026, 2, 16));
    const call = parseQuickAdd('Call mum in 2 hours remind me 10 min before', now)!;
    expect(new Date(call.start).getHours()).toBe(12);
    expect(call.alarm).toBe(10);
  });
});

describe('alarms and reminders', () => {
  const base: Alarm = { id: 'a', label: 'Wake', time: '07:30', days: [1, 2, 3, 4, 5], enabled: true, sound: 'chime', snoozeMin: 9 };
  it('finds the next ring on repeat days', () => {
    const fri = new Date(2026, 9, 30, 8, 0).getTime();
    expect(new Date(nextAlarmTime(base, fri)!)).toEqual(new Date(2026, 10, 2, 7, 30));
    expect(nextAlarmTime({ ...base, enabled: false }, fri)).toBeUndefined();
    const once: Alarm = { ...base, days: [], date: '2026-10-31' };
    expect(new Date(nextAlarmTime(once, fri)!)).toEqual(new Date(2026, 9, 31, 7, 30));
    expect(nextAlarmTime({ ...once, lastFired: new Date(2026, 9, 31, 7, 30).getTime() }, fri)).toBeUndefined();
  });
  it('rings what was missed by a little after sleep, skips what is long gone, never twice', () => {
    const t = new Date(2026, 10, 2, 7, 30).getTime();
    const input = { alarms: [base], occurrences: [], reminders: [{ id: 'r', list: 'l', title: 'Pay rent', remindAt: t - 3 * 3_600_000, done: false }], timers: [], fired: new Set<string>() };
    const late = dueNow(input, t - 8 * 3_600_000, t + 5 * 60_000);
    expect(late.due.map((d) => [d.kind, d.late])).toEqual([['alarm', true]]);
    input.fired.add(dueKey(late.due[0]));
    const again = dueNow(input, t, t + 6 * 60_000);
    expect(again.due).toHaveLength(0);
    expect(new Date(again.next!)).toEqual(new Date(2026, 10, 3, 7, 30));
  });
  it('alerts before events and finds meeting links', () => {
    const ev = parseEvents(ICS, 'w')[0];
    const occ = occurrences([ev], ev.start - 1, ev.start + 1);
    const r = dueNow({ alarms: [], occurrences: occ, reminders: [], timers: [], fired: new Set() }, ev.start - 11 * 60_000, ev.start - 10 * 60_000);
    expect(r.due[0]).toMatchObject({ kind: 'event', title: 'Standup, team', url: 'https://meet.google.com/abc-defg-hij' });
    expect(meetingLink({ description: 'Join: https://us02web.zoom.us/j/123?pwd=x now' })).toBe('https://us02web.zoom.us/j/123?pwd=x');
  });
});

describe('sign-in with OAuth', () => {
  it('makes a PKCE pair and an authorization address', () => {
    const p = pkce();
    expect(p.challenge).toBe(createHash('sha256').update(p.verifier).digest('base64url'));
    const u = new URL(authUrl('google', { clientId: 'cid' }, 'http://127.0.0.1:5555/', p.challenge, p.state, 'a@gmail.com'));
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('login_hint')).toBe('a@gmail.com');
    expect(readRedirect('/?code=c1&state=s1')).toEqual({ code: 'c1', state: 's1', error: undefined });
    expect(codeExchange('microsoft', { clientId: 'cid' }, 'c1', 'v', 'http://127.0.0.1:1/').body).toContain('code_verifier=v');
  });
  it('reads tokens and builds XOAUTH2', () => {
    const idt = `x.${Buffer.from(JSON.stringify({ email: 'a@gmail.com' })).toString('base64url')}.y`;
    const t = readTokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idt }, 0);
    expect(t).toEqual({ access: 'at', refresh: 'rt', expires: 3_540_000, email: 'a@gmail.com' });
    expect(readTokenResponse({ access_token: 'at2' }, 0, 'rt').refresh).toBe('rt');
    expect(() => readTokenResponse({ error: 'invalid_grant' })).toThrow('invalid_grant');
    expect(Buffer.from(xoauth2('u', 'tok'), 'base64').toString()).toBe('user=u\x01auth=Bearer tok\x01\x01');
  });
});

describe('contacts and XML', () => {
  it('reads and writes vCards and suggests addresses', () => {
    const cards = parseVCards('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Ana Lopez\r\nitem1.EMAIL;TYPE=work:ana@x.org\r\nTEL;VALUE=uri:tel:+1-555\r\nORG:Acme\\, Inc.;Sales\r\nUID:urn:uuid:123\r\nEND:VCARD\r\n', 'acc');
    expect(cards[0]).toMatchObject({ id: 'acc:123', name: 'Ana Lopez', emails: ['ana@x.org'], phones: ['+1-555'], org: 'Acme, Inc.' });
    expect(parseVCards(serializeVCard(cards[0]), 'acc')[0]).toMatchObject({ name: 'Ana Lopez', emails: ['ana@x.org'], org: 'Acme, Inc.' });
    expect(suggest(cards, [{ address: 'anabel@y.org' }], 'ana')).toEqual([{ name: 'Ana Lopez', address: 'ana@x.org' }, { address: 'anabel@y.org', name: undefined }]);
  });
  it('resolves namespaces and entities', () => {
    const d = parseXml('<a:x xmlns:a="urn:a"><a:y>1 &lt; 2 &#x26; ok</a:y><![CDATA[<raw>]]></a:x>');
    expect(textOf(find(d, '{urn:a}y'))).toBe('1 < 2 & ok');
    expect(d.children[0].text).toBe('<raw>');
  });
});

describe('features', () => {
  it('mail, calendars and alarms can each be switched off and own their pages', () => {
    const f = (id: string) => FEATURES.find((x) => x.id === id);
    expect(f('mail')?.routes).toEqual(['mail']);
    expect(f('calendars')?.routes).toEqual(['calendar', 'reminders']);
    expect(f('alarms')?.routes).toEqual(['alarms']);
  });
});

describe('timers in the Island', () => {
  it('shows each running countdown as a timer activity with its time left', async () => {
    const { activitiesFrom } = await import('../core/island-activities');
    const now = 1_000_000;
    const base = { shelf: [], shelves: [], activeShelf: '', closedShelves: [], clips: [], focus: { mode: 'idle' }, keepAwake: { on: false }, agents: [], events: [], alerts: [] } as unknown as Parameters<typeof activitiesFrom>[0];
    const acts = activitiesFrom({ ...base, countdowns: [{ id: 't', label: 'Tea', endsAt: now + 90_000, durationMs: 180_000 }, { id: 'p', label: 'Pasta', leftMs: 30_000, durationMs: 600_000 }] }, now);
    expect(acts.map((a) => [a.kind, a.title, a.trailing])).toEqual([['timer', 'Tea', '1:30'], ['timer', 'Pasta (paused)', '0:30']]);
    expect(acts[0].progress).toBeCloseTo(0.5);
  });
});
