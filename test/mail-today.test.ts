// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { meetingLink } from '../core/pim/alarms';
import { joinLink, meetingProvider } from '../core/pim/agenda';
import {
  accountLook, chipCount, chipKeeps, chipMeeting, chipOf, chipsFor, chipView, dayGroup, eventNote, eventStatus, firstName, greeting, greetingFor,
  groupByDay, labelColor, labelCounts, lastChecked, listTime, nextLine, todayLine, todayStrip, updatedText, type ChipId,
} from '../core/pim/mail-today';
import { composeShortcut } from '../core/pim/shortcuts';
import type { CalendarInfo, CalEvent, Occurrence } from '../core/pim/types';

const at = (h: number, m = 0, day = 2) => new Date(2026, 10, day, h, m).getTime();
const clock = (t: number) => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const date = (t: number) => `date ${new Date(t).getDate()}`;

const cal = (id: string, o: Partial<CalendarInfo> = {}): CalendarInfo => ({ id, account: 'a', name: id, color: '#0a84ff', url: '', readOnly: false, visible: true, ...o });
const occ = (title: string, start: number, end: number, o: Partial<CalEvent> = {}): Occurrence => ({
  event: { id: `${o.calendar ?? 'work'}:${title}`, calendar: 'work', uid: title, title, start, end, allDay: false, ...o }, start, end, instance: start,
});

describe('greeting', () => {
  it('says good morning, afternoon or evening by the hour', () => {
    expect(greetingFor(5)).toBe('Good morning');
    expect(greetingFor(11)).toBe('Good morning');
    expect(greetingFor(12)).toBe('Good afternoon');
    expect(greetingFor(17)).toBe('Good afternoon');
    expect(greetingFor(18)).toBe('Good evening');
    expect(greetingFor(23)).toBe('Good evening');
    expect(greetingFor(2)).toBe('Hello');
    expect(greeting(at(19, 5), 'Ana')).toBe('Good evening, Ana');
    expect(greeting(at(9))).toBe('Good morning');
  });
  it('takes a first name only from a real name, never from an address', () => {
    expect(firstName(['Ana Lopez'])).toBe('Ana');
    expect(firstName([undefined, '', 'ana@example.org', '"Ana-María" Ruiz'])).toBe('Ana-María');
    expect(firstName(['ana@example.org', undefined])).toBeUndefined();
    expect(firstName([])).toBeUndefined();
  });
  it('names today in words', () => {
    expect(todayLine(at(19), 'en-GB')).toBe('Today is Monday 2 November');
    expect(todayLine(at(19), 'en-US')).toBe('Today is Monday, November 2');
  });
});

describe('meeting links', () => {
  it('finds Zoom, Meet, Teams, Webex and FaceTime links in the place, the notes or the address', () => {
    expect(meetingLink({ location: 'https://meet.google.com/abc-defg-hij' })).toBe('https://meet.google.com/abc-defg-hij');
    expect(meetingLink({ description: 'Join: https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0 thanks' })).toBe('https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0');
    expect(meetingLink({ description: 'https://teams.microsoft.com/meet/4312?p=abc' })).toBe('https://teams.microsoft.com/meet/4312?p=abc');
    expect(meetingLink({ description: 'Call: https://acme.webex.com/meet/ana' })).toBe('https://acme.webex.com/meet/ana');
    expect(meetingLink({ description: 'https://facetime.apple.com/join#v=1&p=AbC' })).toBe('https://facetime.apple.com/join#v=1&p=AbC');
    expect(meetingLink({ url: 'https://us02web.zoom.us/j/123?pwd=x' })).toBe('https://us02web.zoom.us/j/123?pwd=x');
    expect(meetingLink({ location: 'Room 4, https://example.org/agenda' })).toBeUndefined();
    expect(meetingProvider('https://facetime.apple.com/join#v=1')).toBe('FaceTime');
    expect(meetingProvider('https://acme.webex.com/meet/ana')).toBe('Webex');
    expect(joinLink({ url: 'https://meet.google.com/abc-defg-hij' })).toBe('https://meet.google.com/abc-defg-hij');
  });
});

describe('today’s events', () => {
  const cals = [cal('work'), cal('hidden', { visible: false }), cal('todo', { tasks: true }), cal('quiet', { island: false })];
  const list = [
    occ('Standup', at(9), at(9, 15)),
    occ('Design review', at(17, 30), at(18, 45), { location: 'https://us02web.zoom.us/j/99' }),
    occ('Dinner', at(20), at(21, 30)),
    occ('Secret', at(10), at(11), { calendar: 'hidden' }),
    occ('Kept with tasks', at(12), at(12, 30), { calendar: 'todo' }),
    occ('Not in the Island but in Mail', at(19), at(19, 30), { calendar: 'quiet' }),
    occ('Holiday', at(0), at(0, 0, 3), { allDay: true }),
    occ('Tomorrow', at(9, 0, 3), at(10, 0, 3)),
  ];
  const now = at(18, 10);
  const strip = todayStrip(list, cals, now);
  it('lists today from every visible calendar (all-day first, Keeper’s own calendar too), not hidden ones', () => {
    expect(strip.items.map((i) => i.title)).toEqual(['Holiday', 'Standup', 'Kept with tasks', 'Design review', 'Not in the Island but in Mail', 'Dinner']);
  });
  it('marks the running event and the next one', () => {
    expect(strip.current.map((i) => i.title)).toEqual(['Design review']);
    expect(strip.next?.title).toBe('Not in the Island but in Mail');
    const [holiday, standup, , review, quiet, dinner] = strip.items;
    expect([holiday, standup, review, quiet, dinner].map((i) => eventStatus(i, strip, now))).toEqual(['allDay', 'past', 'now', 'next', 'later']);
    expect(review.join).toBe('https://us02web.zoom.us/j/99');
    expect(review.provider).toBe('Zoom');
  });
  it('says "Now · until" for the running one', () => {
    expect(eventNote(strip.items[3], now, clock)).toBe('Now · until 18:45');
    expect(eventNote(strip.items[1], now, clock)).toBe('Ended');
    expect(eventNote(strip.items[4], now, clock)).toBe('in 50 min');
    expect(eventNote(strip.items[0], now, clock)).toBe('All day');
    expect(eventNote(strip.items[5], at(9), clock)).toBe('20:00 – 21:30');
  });
  it('puts the running meeting in the title bar, else one starting within 15 minutes', () => {
    expect(chipMeeting(strip, now)?.title).toBe('Design review');
    const later = todayStrip(list, cals, at(18, 50));
    expect(chipMeeting(later, at(18, 50))?.title).toBe('Not in the Island but in Mail');
    const morning = todayStrip(list, cals, at(8, 30));
    expect(chipMeeting(morning, at(8, 30))).toBeUndefined();
    expect(chipMeeting(todayStrip(list, cals, at(8, 46)), at(8, 46))?.title).toBe('Standup');
  });
  it('folds into one line for narrow windows', () => {
    expect(nextLine(strip, clock)).toBe('Now: Design review until 18:45');
    expect(nextLine(todayStrip(list, cals, at(8)), clock)).toBe('Next: Standup at 9:00');
    expect(nextLine(todayStrip(list, cals, at(22)), clock)).toBeUndefined();
  });
});

describe('the message list', () => {
  const now = at(18);
  it('groups by calendar day', () => {
    expect(dayGroup(at(0, 5), now)).toBe('today');
    expect(dayGroup(at(23, 50, 1), now)).toBe('yesterday');
    expect(dayGroup(at(9, 0, 1) - 3 * 86_400_000, now)).toBe('week');
    expect(dayGroup(at(9, 0, 1) - 9 * 86_400_000, now)).toBe('older');
    const rows = [at(17), at(9), at(22, 0, 1), at(8, 0, 1) - 4 * 86_400_000];
    expect(groupByDay(rows, (t) => t, now).map((g) => [g.label, g.rows.length])).toEqual([['Today', 2], ['Yesterday', 1], ['Past week', 1]]);
  });
  it('shows minutes and hours under a day, then the clock time, then the date', () => {
    expect(listTime(now - 20_000, now, clock, date)).toBe('Now');
    expect(listTime(now - 12 * 60_000, now, clock, date)).toBe('12 min');
    expect(listTime(now - 60 * 60_000, now, clock, date)).toBe('1 h');
    expect(listTime(now - 23.5 * 3_600_000, now, clock, date)).toBe('23 h');
    expect(listTime(at(9, 5, 1), now, clock, date)).toBe('9:05');
    expect(listTime(at(9, 5, -10), now, clock, date)).toBe('date 21');
  });
  it('says when mail was last checked', () => {
    expect(updatedText(undefined, now)).toBe('Not checked yet');
    expect(updatedText(now - 5_000, now)).toBe('Updated just now');
    expect(updatedText(now - 60_000, now)).toBe('Updated 1 minute ago');
    expect(updatedText(now - 2 * 60_000 - 10, now)).toBe('Updated 2 minutes ago');
    expect(updatedText(now - 3 * 3_600_000, now)).toBe('Updated 3 hours ago');
    expect(updatedText(now - 2 * 86_400_000, now)).toBe('Updated 2 days ago');
    expect(lastChecked([{ mail: true, lastChecked: 5 }, { mail: true, lastChecked: 9 }, { mail: false, lastChecked: 20 }, { mail: true }])).toBe(9);
    expect(lastChecked([{ mail: true }])).toBeUndefined();
  });
  it('draws an account with steady initials and colour', () => {
    const a = accountLook({ label: 'Work', email: 'ana@studio.example', identities: [{ name: 'Ana Lopez' }] });
    expect(a.letters).toBe('AL');
    expect(accountLook({ label: 'Work', email: 'ana@studio.example' }).color).toBe(a.color);
    expect(accountLook({ label: 'x', email: 'bo@example.org' }).color).not.toBe(a.color);
    expect(accountLook({ label: 'bo@example.org', email: 'bo@example.org' }).letters).toBe('B');
    expect(accountLook({ label: 'Home', email: 'h@example.org', color: '#ff375f' }).color).toBe('#ff375f');
    expect(labelColor('Clients')).toBe(labelColor('clients'));
  });
  it('counts labels once per message, unread too', () => {
    const counts = labelCounts([
      { id: '1', messageId: 'a', labels: ['Clients'], seen: false },
      { id: '2', messageId: 'a', labels: ['clients'], seen: false },
      { id: '3', labels: ['Clients', 'Receipts'], seen: true },
      { id: '4', labels: ['Receipts', ' '], seen: false },
    ]);
    expect(counts).toEqual([{ name: 'Clients', count: 2, unread: 1 }, { name: 'Receipts', count: 2, unread: 1 }]);
  });
});

describe('filter chips', () => {
  it('maps each chip to the inbox view Keeper already has, and back', () => {
    for (const c of chipsFor(true)) {
      const v = chipView(c.id, true);
      expect(chipOf({ ...v })).toBe(c.id);
    }
    expect(chipView('important', true)).toEqual({ folder: 'unified', tab: 'important', filter: 'all' });
    expect(chipView('security', true)).toEqual({ folder: 'unified', tab: 'all', filter: 'all', only: 'security' });
    expect(chipView('toreply', true)).toEqual({ folder: 'toreply', filter: 'all' });
    expect(chipView('flagged', false)).toEqual({ folder: 'unified', tab: undefined, filter: 'flagged' });
  });
  it('leaves out the sorted tabs when the inbox is not sorted', () => {
    expect(chipsFor(false).map((c) => c.id)).toEqual(['inbox', 'security', 'toreply', 'flagged', 'attachments'] as ChipId[]);
    expect(chipsFor(true).map((c) => c.id)).toContain('promos');
  });
  it('knows which chip is on (one account’s inbox too; Unread only keeps it)', () => {
    expect(chipOf({ folder: 'INBOX', tab: 'updates' })).toBe('updates');
    expect(chipOf({ folder: 'unified', tab: 'all', filter: 'unread' })).toBe('inbox');
    expect(chipOf({ folder: 'Sent' })).toBeUndefined();
    expect(chipOf({ folder: 'label:Clients' })).toBeUndefined();
  });
  it('carries the unread numbers it knows, and narrows to security mail', () => {
    expect(chipCount('inbox', { all: 7 }, 3)).toBe(7);
    expect(chipCount('inbox', undefined, 3)).toBe(3);
    expect(chipCount('promos', { promos: 0 }, 3)).toBeUndefined();
    expect(chipCount('flagged', { all: 7 }, 3)).toBeUndefined();
    expect(chipKeeps({ security: true }, 'security')).toBe(true);
    expect(chipKeeps({}, 'security')).toBe(false);
    expect(chipKeeps({}, undefined)).toBe(true);
  });
});

describe('the New message key', () => {
  it('shows ⌘N on a Mac and Ctrl+N elsewhere, or the person’s own key', () => {
    expect(composeShortcut('gmail', {}, true)).toBe('⌘N');
    expect(composeShortcut('gmail', {}, false)).toBe('Ctrl+N');
    expect(composeShortcut('apple', {}, true)).toBe('⌘N');
    expect(composeShortcut('superhuman', {}, false)).toBe('Ctrl+N');
    expect(composeShortcut('gmail', { compose: 'w' }, true)).toBe('W');
    expect(composeShortcut('gmail', { compose: '' }, true)).toBeUndefined();
  });
});
