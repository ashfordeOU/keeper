// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Calendars from everywhere: the computer's own (EventKit, Windows,
// Evolution, calendar files), holidays and birthdays, the Island's agenda and
// countdown, meeting links, quick add, and .ics import/subscribe edge cases.

import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agendaFor, countdown, countdownShort, inIsland, islandAgenda, joinLink, meetingProvider, nextUp } from '../core/pim/agenda';
import { meetingLink } from '../core/pim/alarms';
import { birthdayEvents, easter, holidayEvents, holidaysIn, parseBirthday } from '../core/pim/holidays';
import { occurrences, parseEvents, serializeEvents } from '../core/pim/ical';
import { parseQuickAdd } from '../core/pim/quickadd';
import {
  adoptSnapshot, akonadiIcalPath, calendarPollMs, edsCalendars, edsRangeQuery, macCalendarUrl, mapEdsObjects, mapEventKit, mapWindows, normalizeColor, parseEdsSource, systemCalendarId, veventBlocks,
} from '../core/pim/syscal';
import type { CalendarInfo, CalEvent } from '../core/pim/types';
import { calendarFiles, windowsScript } from '../electron/services/pim/system-calendars';
import { fetchIcs } from '../electron/services/pim/dav';

const local = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const ymd = (t: number | Date) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

describe('macOS Calendar (EventKit) answers', () => {
  const answer = {
    calendars: [
      { id: 'CAL-1', title: 'Work', color: '#1BADF8FF', source: 'iCloud', writable: true, type: 'caldav' },
      { id: 'CAL-2', title: 'US Holidays', color: '#ff2968', source: 'Other', writable: false, type: 'subscription' },
      { id: 'CAL-3', title: 'Birthdays', source: 'Other', writable: true, type: 'birthday' },
    ],
    events: [
      { id: 'E1', calendar: 'CAL-1', title: 'Design review', start: local(2026, 11, 2, 10), end: local(2026, 11, 2, 11), allDay: false, timeZone: 'Europe/Tallinn', location: 'https://us02web.zoom.us/j/123456789?pwd=abc', alarms: [10], recurring: false, status: 'confirmed', attendees: [{ name: 'Sam', email: 'sam@example.org', status: 'accepted' }] },
      { id: 'E2', calendar: 'CAL-1', title: 'Standup', start: local(2026, 11, 3, 9), end: local(2026, 11, 3, 9, 15), allDay: false, recurring: true },
      { id: 'E2', calendar: 'CAL-1', title: 'Standup', start: local(2026, 11, 4, 9), end: local(2026, 11, 4, 9, 15), allDay: false, recurring: true },
      // EventKit's all-day events end at 23:59:59 on their last day.
      { id: 'E3', calendar: 'CAL-2', title: 'Thanksgiving', start: local(2026, 11, 26), end: local(2026, 11, 26, 23, 59) + 59_000, allDay: true },
      { id: 'E4', calendar: 'CAL-1', title: 'Cancelled thing', start: local(2026, 11, 5, 9), end: local(2026, 11, 5, 10), allDay: false, status: 'cancelled' },
      { calendar: 'CAL-1', title: 'no id', start: 1, end: 2 },
    ],
  };
  const snap = mapEventKit(answer);

  it('lists calendars with their colours, account and whether they can be written', () => {
    expect(snap.via).toBe('eventkit');
    expect(snap.calendars).toEqual([
      { ref: 'CAL-1', name: 'Work', color: '#1badf8', group: 'iCloud', writable: true },
      { ref: 'CAL-2', name: 'US Holidays', color: '#ff2968', group: 'Other', writable: false },
      { ref: 'CAL-3', name: 'Birthdays', color: undefined, group: 'Other', writable: false },
    ]);
  });

  it('maps events: occurrences kept apart, all-day ending at midnight, alarms, people, where to open', () => {
    expect(snap.events).toHaveLength(5);
    const [review, s1, s2, thanks, cancelled] = snap.events;
    expect(review).toMatchObject({ uid: 'E1', title: 'Design review', tz: 'Europe/Tallinn', alarms: [{ minutesBefore: 10 }], href: 'E1', etag: undefined, openUrl: macCalendarUrl('E1') });
    expect(review.attendees?.[0]).toEqual({ email: 'sam@example.org', name: 'Sam', status: 'accepted' });
    expect(s1.uid).not.toBe(s2.uid);
    expect(s1.href).toBe('E2');
    expect(s1.etag).toBe(String(local(2026, 11, 3, 9)));
    expect(thanks).toMatchObject({ allDay: true, start: local(2026, 11, 26), end: local(2026, 11, 27) });
    expect(cancelled.status).toBe('cancelled');
    expect(macCalendarUrl('A/B:1')).toBe('ical://ekevent/A%2FB%3A1?method=show&options=more');
  });

  it('joins Keeper’s list, keeping choices made in Keeper and dropping calendars that are gone', () => {
    const existing: CalendarInfo[] = [
      { id: 'local:calendar', account: 'local', name: 'On this computer', color: '#0a84ff', url: '', readOnly: false, visible: true },
      { id: systemCalendarId('CAL-1'), account: 'system', name: 'Old name', color: '#123456', colorSet: true, url: '', readOnly: false, visible: false, island: false, source: 'system', ref: 'CAL-1' },
      { id: systemCalendarId('GONE'), account: 'system', name: 'Gone', color: '#000000', url: '', readOnly: true, visible: true, source: 'system', ref: 'GONE' },
    ];
    const r = adoptSnapshot(existing, snap);
    const work = r.calendars.find((c) => c.ref === 'CAL-1')!;
    expect(work).toMatchObject({ name: 'Work', color: '#123456', visible: false, island: false, group: 'iCloud', readOnly: false });
    expect(r.calendars.find((c) => c.ref === 'CAL-2')!.color).toBe('#ff2968');
    expect(r.removed).toEqual([systemCalendarId('GONE')]);
    expect(r.calendars.some((c) => c.id === 'local:calendar')).toBe(true);
    const evs = r.events.get(work.id)!;
    expect(evs.every((e) => e.calendar === work.id && e.id.startsWith(`${work.id}:`))).toBe(true);
    // Each occurrence draws once, as a single event.
    expect(occurrences(evs, local(2026, 11, 1), local(2026, 11, 8)).filter((o) => o.event.title === 'Standup')).toHaveLength(2);
  });
});

describe('Windows calendars', () => {
  it('maps the AppointmentStore’s answer', () => {
    const s = mapWindows({
      via: 'appointments',
      calendars: [{ id: 'w1', name: 'Calendar', color: '#0078D4', account: 'you@outlook.com' }],
      events: [
        { id: 'a1', calendar: 'w1', title: 'Dentist', start: local(2026, 11, 3, 15, 30), minutes: 45, location: 'Main St', reminder: 15 },
        { id: 'a2', calendar: 'w1', title: 'Holiday', start: local(2026, 12, 24), minutes: 1440, allDay: true },
        { id: 'a3', calendar: 'w1', title: 'Teams call', start: '2026-11-04T08:00:00Z', minutes: 30, url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting', recurring: true },
      ],
    });
    expect(s.calendars).toEqual([{ ref: 'w1', name: 'Calendar', color: '#0078d4', group: 'you@outlook.com', writable: false }]);
    expect(s.events[0]).toMatchObject({ end: local(2026, 11, 3, 16, 15), alarms: [{ minutesBefore: 15 }], openUrl: 'outlookcal:' });
    expect(s.events[1]).toMatchObject({ allDay: true, start: local(2026, 12, 24), end: local(2026, 12, 25) });
    expect(s.events[2].start).toBe(Date.UTC(2026, 10, 4, 8));
    expect(s.events[2].uid).toContain('@');
    expect(joinLink(s.events[2])).toContain('teams.microsoft.com');
  });
  it('maps Outlook’s answer (end times, /Date()/ values)', () => {
    const s = mapWindows({ via: 'outlook', calendars: [{ id: 'outlook:1', name: 'Calendar', account: 'Work' }], events: [{ id: 'x', calendar: 'outlook:1', title: 'Plan', start: '/Date(1793865600000)/', end: '/Date(1793869200000)/' }] });
    expect(s.via).toBe('outlook');
    expect(s.events[0]).toMatchObject({ start: 1793865600000, end: 1793869200000, openUrl: undefined });
  });
  it('the PowerShell helper asks the store, falls back to a running Outlook and prints JSON', () => {
    const ps = windowsScript(1000, 2000);
    expect(ps).toContain('RequestStoreAsync([Windows.ApplicationModel.Appointments.AppointmentStoreAccessType]::AllCalendarsReadOnly)');
    expect(ps).toContain("IAsyncOperation`1");
    expect(ps).toContain('FromUnixTimeMilliseconds(1000)');
    expect(ps).toContain("GetActiveObject('Outlook.Application')");
    expect(ps).toContain('ConvertTo-Json');
  });
});

describe('Linux: Evolution and calendar files', () => {
  const sources = [
    parseEdsSource('goa-google', '[Data Source]\nDisplayName=you@gmail.com\nEnabled=true\nParent=\n[Collection]\nBackendName=google\n'),
    parseEdsSource('cal-google-1', '[Data Source]\nDisplayName=Family\nDisplayName[de]=Familie\nEnabled=true\nParent=goa-google\n[Calendar]\nBackendName=caldav\nColor=#33d17a\nSelected=true\n'),
    parseEdsSource('system-calendar', '[Data Source]\nDisplayName=Personal\nEnabled=true\nParent=local-stub\n[Calendar]\nBackendName=local\nColor=#62a0ea\n'),
    parseEdsSource('birthdays', '[Data Source]\nDisplayName=Birthdays & Anniversaries\nParent=contacts-stub\n[Calendar]\nBackendName=contacts\n'),
    parseEdsSource('tasks', '[Data Source]\nDisplayName=Tasks\n[Task List]\nBackendName=local\n'),
    parseEdsSource('off', '[Data Source]\nDisplayName=Off\nEnabled=false\n[Calendar]\nBackendName=local\n'),
  ];
  it('reads Evolution’s sources: calendars only, with their account and colour', () => {
    expect(sources[1]).toMatchObject({ name: 'Family', parent: 'goa-google', calendar: { color: '#33d17a', backend: 'caldav', selected: true } });
    const cals = edsCalendars(sources);
    expect(cals.map((c) => c.ref)).toEqual(['cal-google-1', 'system-calendar', 'birthdays']);
    expect(cals[0]).toMatchObject({ name: 'Family', group: 'you@gmail.com', writable: true });
    expect(cals[1]).toMatchObject({ group: 'On this computer', writable: true });
    expect(cals[2].writable).toBe(false);
  });
  it('turns Evolution’s objects into events (repeats stay rules) and builds its queries', () => {
    const evs = mapEdsObjects('cal-google-1', [
      'BEGIN:VEVENT\r\nUID:r1\r\nDTSTART;TZID=Europe/Berlin:20261102T091500\r\nDTEND;TZID=Europe/Berlin:20261102T093000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\nSUMMARY:Sync\r\nEND:VEVENT',
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:r1\r\nRECURRENCE-ID;TZID=Europe/Berlin:20261104T091500\r\nDTSTART;TZID=Europe/Berlin:20261104T110000\r\nDTEND;TZID=Europe/Berlin:20261104T113000\r\nSUMMARY:Sync (moved)\r\nEND:VEVENT\r\nEND:VCALENDAR',
    ]);
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({ calendar: 'cal-google-1', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', href: 'r1' });
    const occ = occurrences(evs, Date.UTC(2026, 10, 2), Date.UTC(2026, 10, 9));
    expect(occ.map((o) => o.event.title)).toEqual(['Sync', 'Sync (moved)']);
    expect(edsRangeQuery(Date.UTC(2026, 10, 1), Date.UTC(2026, 11, 1))).toBe('(occur-in-time-range? (make-time "20261101T000000Z") (make-time "20261201T000000Z"))');
    expect(veventBlocks(serializeEvents(evs))).toHaveLength(2);
  });
  it('finds calendar files: Evolution’s local calendars, KOrganizer and Akonadi iCal resources', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'kcal-'));
    const data = path.join(home, '.local/share');
    const conf = path.join(home, '.config');
    mkdirSync(path.join(data, 'evolution/calendar/system'), { recursive: true });
    writeFileSync(path.join(data, 'evolution/calendar/system/calendar.ics'), 'BEGIN:VCALENDAR\nEND:VCALENDAR\n');
    mkdirSync(path.join(data, 'korganizer'), { recursive: true });
    writeFileSync(path.join(data, 'korganizer/std.ics'), 'BEGIN:VCALENDAR\nEND:VCALENDAR\n');
    mkdirSync(conf, { recursive: true });
    writeFileSync(path.join(home, 'kde.ics'), 'BEGIN:VCALENDAR\nEND:VCALENDAR\n');
    writeFileSync(path.join(conf, 'akonadi_ical_resource_0rc'), `[General]\nPath=${path.join(home, 'kde.ics')}\n`);
    expect(akonadiIcalPath('[General]\nPath=file:///x/y.ics\n')).toBe('/x/y.ics');
    const prev = [process.env.XDG_DATA_HOME, process.env.XDG_CONFIG_HOME];
    process.env.XDG_DATA_HOME = data;
    process.env.XDG_CONFIG_HOME = conf;
    try {
      const files = await calendarFiles(home);
      expect(files.map((f) => `${f.group}:${f.name}`).sort()).toEqual(['Evolution:Personal', 'KDE:kde', 'KOrganizer:std']);
    } finally {
      [process.env.XDG_DATA_HOME, process.env.XDG_CONFIG_HOME] = prev;
      if (prev[0] === undefined) delete process.env.XDG_DATA_HOME;
      if (prev[1] === undefined) delete process.env.XDG_CONFIG_HOME;
    }
  });
});

describe('colours and how often to look', () => {
  it('normalizes the colour forms systems hand out', () => {
    expect(normalizeColor('#ABCDEF')).toBe('#abcdef');
    expect(normalizeColor('#abcdef80')).toBe('#abcdef');
    expect(normalizeColor('#abc')).toBe('#aabbcc');
    expect(normalizeColor('rgb(255, 0, 10)')).toBe('#ff000a');
    expect(normalizeColor('0xFF00FF00')).toBe('#00ff00');
    expect(normalizeColor('blue')).toBeUndefined();
    expect(normalizeColor(undefined)).toBeUndefined();
  });
  it('every minute on screen, every 5 minutes otherwise, every 15 when the system says what changed', () => {
    expect(calendarPollMs({ visible: true })).toBe(60_000);
    expect(calendarPollMs({ visible: true, live: true })).toBe(60_000);
    expect(calendarPollMs({ visible: false })).toBe(300_000);
    expect(calendarPollMs({ visible: false, live: true })).toBe(900_000);
  });
});

describe('holidays and birthdays', () => {
  it('works out Easter', () => {
    expect(ymd(easter(2026))).toBe('2026-04-05');
    expect(ymd(easter(2027))).toBe('2027-03-28');
    expect(ymd(easter(2030))).toBe('2030-04-21');
  });
  it('US holidays with observed days', () => {
    const us = holidaysIn('US', 2026).map((h) => `${ymd(h.date)} ${h.name}`);
    expect(us).toContain('2026-11-26 Thanksgiving Day');
    expect(us).toContain('2026-05-25 Memorial Day');
    expect(us).toContain('2026-01-19 Martin Luther King Jr. Day');
    // 4 July 2026 is a Saturday: observed on Friday 3 July.
    expect(us).toContain('2026-07-03 Independence Day (observed)');
  });
  it('UK Christmas and Boxing Day on a weekend move to Monday and Tuesday', () => {
    const gb = holidaysIn('GB', 2027).map((h) => `${ymd(h.date)} ${h.name}`);
    expect(gb).toContain('2027-12-27 Christmas Day (observed)');
    expect(gb).toContain('2027-12-28 Boxing Day (observed)');
    expect(gb).toContain('2027-03-26 Good Friday');
  });
  it('Estonia, Sweden and the Netherlands', () => {
    expect(holidaysIn('EE', 2026).map((h) => ymd(h.date))).toEqual(expect.arrayContaining(['2026-02-24', '2026-06-23', '2026-06-24', '2026-05-24']));
    const se = holidaysIn('SE', 2026);
    expect(ymd(se.find((h) => h.name === 'Midsummer Eve')!.date)).toBe('2026-06-19');
    expect(ymd(se.find((h) => h.name === 'All Saints’ Day')!.date)).toBe('2026-10-31');
    expect(ymd(holidaysIn('NL', 2025).find((h) => h.name === 'King’s Day')!.date)).toBe('2025-04-26');
    expect(holidaysIn('XX', 2026)).toEqual([]);
  });
  it('holiday events are all-day, in range, with stable ids', () => {
    const evs = holidayEvents('DE', local(2026, 12, 1), local(2027, 1, 2));
    expect(evs.map((e) => e.title)).toEqual(['Christmas Day', 'Second Day of Christmas', 'New Year’s Day']);
    expect(evs.every((e) => e.allDay && e.end - e.start >= 23 * 3_600_000)).toBe(true);
    expect(holidayEvents('DE', local(2026, 12, 1), local(2027, 1, 2))[0].id).toBe(evs[0].id);
  });
  it('birthdays from contacts repeat every year; 29 February falls on the 28th otherwise', () => {
    expect(parseBirthday('1990-04-12')).toEqual({ y: 1990, m: 4, d: 12 });
    expect(parseBirthday('19900412')).toEqual({ y: 1990, m: 4, d: 12 });
    expect(parseBirthday('--04-12')).toEqual({ y: undefined, m: 4, d: 12 });
    expect(parseBirthday('--0412')).toEqual({ y: undefined, m: 4, d: 12 });
    expect(parseBirthday('nope')).toBeUndefined();
    const evs = birthdayEvents([{ id: 'c1', name: 'Ana', birthday: '1990-04-12' }, { id: 'c2', name: 'Leap', birthday: '1996-02-29' }, { id: 'c3', name: 'Nobody' }]);
    expect(evs).toHaveLength(2);
    const occ = occurrences(evs, local(2026, 1, 1), local(2029, 1, 1));
    expect(occ.filter((o) => o.event.title === 'Ana’s birthday').map((o) => ymd(o.start))).toEqual(['2026-04-12', '2027-04-12', '2028-04-12']);
    expect(occ.filter((o) => o.event.title === 'Leap’s birthday').map((o) => ymd(o.start))).toEqual(['2026-02-28', '2027-02-28', '2028-02-29']);
  });
});

describe('meeting links', () => {
  const cases: [string, string | undefined][] = [
    ['https://us02web.zoom.us/j/85012345678?pwd=Zx', 'Zoom'],
    ['https://meet.google.com/abc-defg-hij', 'Google Meet'],
    ['https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0', 'Teams'],
    ['https://acme.webex.com/acme/j.php?MTID=m123', 'Webex'],
    ['https://meet.jit.si/KeeperStandup', 'Jitsi'],
    ['https://example.org/agenda', undefined],
  ];
  it.each(cases)('%s → %s', (url, provider) => {
    expect(meetingProvider(url)).toBe(provider);
    expect(joinLink({ description: `Notes…\n\nJoin: ${url}\n` })).toBe(provider ? url : undefined);
  });
  it('finds the link in the place, the notes or the event’s own address, and ignores look-alikes', () => {
    expect(meetingLink({ location: 'Room 4 / https://zoom.us/j/1234' })).toBe('https://zoom.us/j/1234');
    expect(joinLink({ url: 'https://meet.google.com/aaa-bbbb-ccc' })).toBe('https://meet.google.com/aaa-bbbb-ccc');
    expect(meetingProvider('https://zoom.us.evil.example/j/1')).toBeUndefined();
    expect(meetingProvider('not a url')).toBeUndefined();
  });
});

describe('the Island’s agenda and countdown', () => {
  const now = local(2026, 11, 2, 9, 50);
  const cals: CalendarInfo[] = [
    { id: 'a', account: 'x', name: 'Work', color: '#ff0000', url: '', readOnly: false, visible: true },
    { id: 'b', account: 'system', name: 'Mac work', color: '#00ff00', url: '', readOnly: false, visible: true, source: 'system' },
    { id: 'c', account: 'x', name: 'Hidden from Island', color: '#0000ff', url: '', readOnly: false, visible: true, island: false },
    { id: 'd', account: 'x', name: 'Off', color: '#000', url: '', readOnly: false, visible: false },
  ];
  const ev = (id: string, calendar: string, title: string, start: number, end: number, extra: Partial<CalEvent> = {}): CalEvent => ({ id, uid: id, calendar, title, start, end, allDay: false, ...extra });
  const events = [
    ev('1', 'a', 'Standup', local(2026, 11, 2, 10), local(2026, 11, 2, 10, 15), { description: 'https://meet.google.com/abc-defg-hij' }),
    ev('2', 'b', 'Standup', local(2026, 11, 2, 10), local(2026, 11, 2, 10, 15)), // the same meeting twice
    ev('3', 'c', 'Private', local(2026, 11, 2, 11), local(2026, 11, 2, 12)),
    ev('4', 'a', 'Breakfast', local(2026, 11, 2, 8), local(2026, 11, 2, 9)),
    ev('5', 'a', 'Trip', local(2026, 11, 2), local(2026, 11, 4), { allDay: true }),
    ev('6', 'b', 'Lunch with Sam', local(2026, 11, 3, 13), local(2026, 11, 3, 14), { openUrl: 'ical://ekevent/6' }),
    ev('7', 'd', 'Invisible', local(2026, 11, 2, 15), local(2026, 11, 2, 16)),
  ];
  const occ = occurrences(events, local(2026, 11, 1), local(2026, 11, 5));

  it('today and tomorrow, all-day first, one copy of a duplicated meeting, Island choices honoured', () => {
    const a = islandAgenda(occ, cals, now);
    expect(a.today.map((i) => i.title)).toEqual(['Trip', 'Breakfast', 'Standup']);
    expect(a.today[1].past).toBe(true);
    expect(a.today[2]).toMatchObject({ join: 'https://meet.google.com/abc-defg-hij', provider: 'Google Meet', color: '#ff0000', calendarName: 'Work' });
    expect(a.tomorrow.map((i) => i.title)).toEqual(['Trip', 'Lunch with Sam']);
    expect(a.tomorrow[1].openUrl).toBe('ical://ekevent/6');
    expect(nextUp(a.today, now)?.title).toBe('Standup');
    expect(inIsland(cals[2])).toBe(false);
    expect(agendaFor(occ, cals, local(2026, 11, 4), now)).toEqual([]);
  });

  it('counts down in words and in the pill', () => {
    expect(countdown(now + 10 * 60_000, now)).toBe('in 10 min');
    expect(countdown(now + 80 * 60_000, now)).toBe('in 1 h 20 min');
    expect(countdown(now + 120 * 60_000, now)).toBe('in 2 h');
    expect(countdown(now + 3 * 86_400_000, now)).toBe('in 3 days');
    expect(countdown(now - 1, now, now + 1000)).toBe('now');
    expect(countdown(now - 2000, now, now - 1000)).toBe('ended');
    expect(countdownShort(now + 4 * 60_000 + 1, now)).toBe('5m');
    expect(countdownShort(now + 65 * 60_000, now)).toBe('1h05');
    expect(countdownShort(now, now)).toBe('now');
  });
});

describe('quick add in plain English', () => {
  const now = local(2026, 11, 2, 10); // a Monday morning
  it.each([
    ['lunch with Sam tomorrow 1pm', 'lunch with Sam', local(2026, 11, 3, 13), local(2026, 11, 3, 14)],
    ['Dentist friday 15:30 for 45 min', 'Dentist', local(2026, 11, 6, 15, 30), local(2026, 11, 6, 16, 15)],
    ['Flight to Berlin on 12/20 8am', 'Flight to Berlin', local(2026, 12, 20, 8), local(2026, 12, 20, 9)],
    ['Dinner 20.12. 7pm', 'Dinner', local(2026, 12, 20, 19), local(2026, 12, 20, 20)],
    ['Call 25/12 9am', 'Call', local(2026, 12, 25, 9), local(2026, 12, 25, 10)],
    ['Review at 3', 'Review', local(2026, 11, 2, 15), local(2026, 11, 2, 16)],
  ])('“%s”', (text, title, start, end) => {
    expect(parseQuickAdd(text, now)).toMatchObject({ title, start, end, allDay: false });
  });
  it('a date already gone this year means next year; ranges and repeats', () => {
    expect(ymd(parseQuickAdd('Ski trip Jan 10', now)!.start)).toBe('2027-01-10');
    expect(ymd(parseQuickAdd('Party 3/1', now)!.start)).toBe('2027-03-01');
    expect(ymd(parseQuickAdd('Report 2026-10-01', now)!.start)).toBe('2026-10-01');
    const trip = parseQuickAdd('Offsite Dec 3-5', now)!;
    expect([ymd(trip.start), ymd(trip.end), trip.allDay]).toEqual(['2026-12-03', '2026-12-06', true]);
    expect(parseQuickAdd('Standup every weekday 9:15', now)).toMatchObject({ rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', start: local(2026, 11, 2, 9, 15) });
    expect(parseQuickAdd('Party saturday 8pm at Ana’s place', now)).toMatchObject({ title: 'Party', location: 'Ana’s place', start: local(2026, 11, 7, 20) });
  });
});

describe('.ics import and subscriptions: edge cases', () => {
  const ICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN',
    'BEGIN:VTIMEZONE', 'TZID:America/New_York', 'END:VTIMEZONE',
    // A weekly meeting on New York time across the November change (1 Nov 2026).
    'BEGIN:VEVENT', 'UID:weekly@test', 'DTSTART;TZID=America/New_York:20261026T090000', 'DTEND;TZID=America/New_York:20261026T093000',
    'RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE;TZID=America/New_York:20261109T090000', 'SUMMARY:Weekly', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:weekly@test', 'RECURRENCE-ID;TZID=America/New_York:20261116T090000', 'DTSTART;TZID=America/New_York:20261116T140000',
    'DTEND;TZID=America/New_York:20261116T143000', 'SUMMARY:Weekly (afternoon)', 'END:VEVENT',
    // All-day across three days (DTEND is exclusive), and one with no DTEND at all.
    'BEGIN:VEVENT', 'UID:conf@test', 'DTSTART;VALUE=DATE:20261110', 'DTEND;VALUE=DATE:20261113', 'SUMMARY:Conference', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:day@test', 'DTSTART;VALUE=DATE:20261120', 'SUMMARY:Day off', 'END:VEVENT',
    // UTC, a Windows zone name, a floating time, folded long text with escapes.
    'BEGIN:VEVENT', 'UID:utc@test', 'DTSTART:20261105T150000Z', 'DTEND:20261105T160000Z', 'SUMMARY:UTC call', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:win@test', 'DTSTART;TZID=W. Europe Standard Time:20261106T100000', 'DTEND;TZID=W. Europe Standard Time:20261106T110000', 'SUMMARY:Exchange', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:float@test', 'DTSTART:20261107T080000', 'DTEND:20261107T083000', 'SUMMARY:Floating', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:fold@test', 'DTSTART:20261108T120000Z', 'DURATION:PT45M', 'SUMMARY:Lunch\\, then a walk', 'DESCRIPTION:Join: https://zoom.us/j/9', ' 87654321 \\nBring shoes', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');

  it('repeats on the event’s own clock across daylight saving, with skipped and moved occurrences', () => {
    const evs = parseEvents(ICS, 'cal');
    const weekly = occurrences(evs, Date.UTC(2026, 9, 20), Date.UTC(2026, 10, 30)).filter((o) => o.event.uid === 'weekly@test');
    expect(weekly.map((o) => new Date(o.start).toISOString())).toEqual([
      '2026-10-26T13:00:00.000Z', // EDT
      '2026-11-02T14:00:00.000Z', // EST: still 9:00 in New York
      '2026-11-16T19:00:00.000Z', // the moved one, 14:00 EST
    ]);
    expect(weekly[2].event.title).toBe('Weekly (afternoon)');
  });

  it('all-day events, UTC, Windows zone names, floating times, durations and folded text', () => {
    const evs = parseEvents(ICS, 'cal');
    const by = (uid: string) => evs.find((e) => e.uid === uid)!;
    expect(by('conf@test')).toMatchObject({ allDay: true, start: local(2026, 11, 10), end: local(2026, 11, 13) });
    expect(by('day@test')).toMatchObject({ allDay: true, start: local(2026, 11, 20) });
    expect(by('day@test').end - by('day@test').start).toBeGreaterThanOrEqual(23 * 3_600_000);
    expect(by('utc@test').start).toBe(Date.UTC(2026, 10, 5, 15));
    expect(by('win@test').start).toBe(Date.UTC(2026, 10, 6, 9));
    expect(by('float@test').start).toBe(local(2026, 11, 7, 8));
    expect(by('fold@test')).toMatchObject({ title: 'Lunch, then a walk', end: Date.UTC(2026, 10, 8, 12, 45) });
    expect(by('fold@test').description).toBe('Join: https://zoom.us/j/987654321 \nBring shoes');
    expect(joinLink(by('fold@test'))).toBe('https://zoom.us/j/987654321');
    // Days spanned by the conference: three.
    expect(occurrences([by('conf@test')], local(2026, 11, 11), local(2026, 11, 12))).toHaveLength(1);
  });

  it('subscribes to a link or a file (webcal:// is https://)', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kics-'));
    const f = path.join(dir, 'my cal.ics');
    writeFileSync(f, ICS);
    const evs = await fetchIcs(`file://${encodeURI(f)}`, 'sub');
    expect(evs.filter((e) => e.calendar === 'sub')).toHaveLength(parseEvents(ICS).length);
    // A bad answer is an error the person sees, not an empty calendar.
    await expect(fetchIcs('http://127.0.0.1:1/nothing.ics', 'x')).rejects.toThrow();
  });
});
