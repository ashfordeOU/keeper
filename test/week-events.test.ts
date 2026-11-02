// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accessRow, buildCalendarStatus, eventsByDay, MAC_CALENDAR_PRIVACY, upcomingFrom, weekEventTime } from '../core/pim/week-events';
import type { SystemAccess } from '../core/pim/syscal';
import type { CalEvent, CalendarInfo, Occurrence } from '../core/pim/types';
import { weekDays } from '../core/pim/tasks';

const was = process.env.TZ;
const setTz = (tz: string) => { process.env.TZ = tz; };
beforeAll(() => setTz('Europe/Berlin'));
afterAll(() => { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; });

const cal = (id: string, o: Partial<CalendarInfo> = {}): CalendarInfo => ({ id, account: 'system', name: id, color: '#ff0000', url: '', readOnly: true, visible: true, ...o });
const ev = (id: string, title: string, o: Partial<CalEvent> = {}): CalEvent => ({ id, uid: id, calendar: 'A', title, start: 0, end: 0, allDay: false, ...o } as CalEvent);
const occ = (e: CalEvent, start: number, end: number): Occurrence => ({ event: { ...e, start, end }, start, end, instance: start });
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe('eventsByDay', () => {
  it('puts timed events on their local day, sorted, with all-day ones first', () => {
    const days = weekDays('2026-11-04', 1); // Mon 2 Nov – Sun 8 Nov
    expect(days[0]).toBe('2026-11-02');
    const list = [
      occ(ev('1', 'Standup'), local(2026, 11, 2, 9, 30), local(2026, 11, 2, 9, 45)),
      occ(ev('2', 'Holiday', { allDay: true }), local(2026, 11, 2), local(2026, 11, 3)),
      occ(ev('3', 'Lunch'), local(2026, 11, 2, 12), local(2026, 11, 2, 13)),
      occ(ev('4', 'Next week'), local(2026, 11, 9, 9), local(2026, 11, 9, 10)),
    ];
    const by = eventsByDay(list, [cal('A')], days);
    expect(by.get('2026-11-02')!.map((e) => e.title)).toEqual(['Holiday', 'Standup', 'Lunch']);
    expect(by.get('2026-11-03')).toEqual([]);
    expect([...by.values()].flat().some((e) => e.title === 'Next week')).toBe(false);
    expect(by.get('2026-11-02')![1]).toMatchObject({ color: '#ff0000', calendarName: 'A', part: 'single' });
  });

  it('shows a multi-day all-day event on each day it covers, and not the day after', () => {
    const days = weekDays('2026-11-04', 1);
    const by = eventsByDay([occ(ev('t', 'Trip', { allDay: true }), local(2026, 11, 4), local(2026, 11, 7))], [cal('A')], days);
    const on = days.filter((d) => by.get(d)!.length);
    expect(on).toEqual(['2026-11-04', '2026-11-05', '2026-11-06']);
    expect(by.get('2026-11-04')![0].part).toBe('first');
    expect(by.get('2026-11-05')![0].part).toBe('middle');
    expect(by.get('2026-11-06')![0].part).toBe('last');
    expect(weekEventTime(by.get('2026-11-05')![0], () => 'x')).toBe('All day');
  });

  it('splits a timed event over midnight into first and last parts', () => {
    const days = weekDays('2026-11-04', 1);
    const by = eventsByDay([occ(ev('n', 'Night shift'), local(2026, 11, 4, 22), local(2026, 11, 5, 6))], [cal('A')], days);
    const f = (t: number) => new Date(t).toTimeString().slice(0, 5);
    expect(weekEventTime(by.get('2026-11-04')![0], f)).toBe('22:00 →');
    expect(weekEventTime(by.get('2026-11-05')![0], f)).toBe('→ 06:00');
    // Ends exactly at midnight: not on the next day.
    const by2 = eventsByDay([occ(ev('m', 'Late'), local(2026, 11, 4, 23), local(2026, 11, 5))], [cal('A')], days);
    expect(by2.get('2026-11-05')).toEqual([]);
    expect(by2.get('2026-11-04')![0].part).toBe('single');
  });

  it('uses local days: a UTC evening event falls on the next day in Tokyo and the same day in Los Angeles', () => {
    const at = Date.UTC(2026, 10, 4, 20, 0); // 4 Nov 20:00 UTC
    const list = [occ(ev('x', 'Call'), at, at + 3_600_000)];
    try {
      setTz('Asia/Tokyo');
      const tokyo = eventsByDay(list, [cal('A')], weekDays('2026-11-04', 1));
      expect(tokyo.get('2026-11-05')!.map((e) => e.title)).toEqual(['Call']);
      setTz('America/Los_Angeles');
      const la = eventsByDay(list, [cal('A')], weekDays('2026-11-04', 1));
      expect(la.get('2026-11-04')!.map((e) => e.title)).toEqual(['Call']);
    } finally {
      setTz('Europe/Berlin');
    }
  });

  it('keeps a 25-hour day whole around a clock change', () => {
    try {
      setTz('America/New_York');
      // Sunday 1 Nov 2026: clocks go back at 02:00; an event at 23:30 is still that day.
      const days = weekDays('2026-11-01', 0);
      const by = eventsByDay([occ(ev('d', 'Late film'), local(2026, 11, 1, 23, 30), local(2026, 11, 1, 23, 50))], [cal('A')], days);
      expect(by.get('2026-11-01')!.map((e) => e.title)).toEqual(['Late film']);
      expect(by.get('2026-11-02')).toEqual([]);
    } finally {
      setTz('Europe/Berlin');
    }
  });

  it('skips hidden, task, Island-off and cancelled calendars, and shows a meeting from two calendars once', () => {
    const days = ['2026-11-04'];
    const s = local(2026, 11, 4, 10), e = local(2026, 11, 4, 11);
    const list = [
      occ(ev('1', 'Review', { calendar: 'A' }), s, e),
      occ(ev('2', 'Review', { calendar: 'B' }), s, e),
      occ(ev('3', 'Hidden', { calendar: 'H' }), s, e),
      occ(ev('4', 'Todo', { calendar: 'T' }), s, e),
      occ(ev('5', 'Off in Island', { calendar: 'I' }), s, e),
      occ(ev('6', 'Cancelled', { calendar: 'A', status: 'cancelled' }), s, e),
    ];
    const cals = [cal('A'), cal('B'), cal('H', { visible: false }), cal('T', { tasks: true }), cal('I', { island: false })];
    expect(eventsByDay(list, cals, days).get('2026-11-04')!.map((x) => x.title)).toEqual(['Off in Island', 'Review']);
    expect(eventsByDay(list, cals, days, { island: true }).get('2026-11-04')!.map((x) => x.title)).toEqual(['Review']);
  });
});

describe('upcomingFrom and buildCalendarStatus', () => {
  it('lists every source in time order with its place and source kind', () => {
    const cals = [cal('sys', { source: 'system' }), cal('g', { account: 'acc1' }), cal('o', { account: 'acc2' }), cal('ics', { account: 'acc3' })];
    const accounts = [{ id: 'acc1', kind: 'google' as const, oauth: 'google' as const }, { id: 'acc2', kind: 'caldav' as const, oauth: 'microsoft' as const }, { id: 'acc3', kind: 'ics' as const }];
    const list = [
      occ(ev('b', 'Flight to Lisbon', { calendar: 'g', location: 'BER Airport' }), local(2026, 11, 10, 7), local(2026, 11, 10, 10)),
      occ(ev('a', 'Dentist', { calendar: 'sys', location: 'Main St 1' }), local(2026, 11, 5, 8), local(2026, 11, 5, 9)),
      occ(ev('c', 'Call', { calendar: 'o', location: 'https://zoom.us/j/1' }), local(2026, 11, 6, 8), local(2026, 11, 6, 9)),
      occ(ev('d', 'No place', { calendar: 'ics' }), local(2026, 11, 7, 8), local(2026, 11, 7, 9)),
    ];
    const all = upcomingFrom(list, cals, accounts);
    expect(all.map((x) => [x.title, x.source])).toEqual([['Dentist', 'system'], ['Call', 'microsoft'], ['No place', 'ics'], ['Flight to Lisbon', 'google']]);
    expect(all[1].join).toBe('https://zoom.us/j/1');
    expect(upcomingFrom(list, cals, accounts, { withLocation: true }).map((x) => x.title)).toEqual(['Dentist', 'Call', 'Flight to Lisbon']);
    expect(upcomingFrom(list, cals, accounts, { limit: 1 })).toHaveLength(1);
  });

  it('reports each source and the row to show', () => {
    const system: SystemAccess = { state: 'notDetermined', via: 'eventkit', raw: 'notDetermined', canRequest: true, message: 'Allow' };
    const st = buildCalendarStatus({ platform: 'darwin', system, calendars: [cal('g', { account: 'acc1' })], accounts: [{ id: 'acc1', kind: 'google', oauth: 'google', label: 'me@gmail.com', calendar: true, needsSignIn: true }] });
    expect(st.sources).toEqual([
      expect.objectContaining({ id: 'system', kind: 'system', connected: true, authorized: false }),
      expect.objectContaining({ id: 'acc1', kind: 'google', connected: true, authorized: false, calendars: 1 }),
    ]);
    expect(st.anyReadable).toBe(false);
    expect(st.row?.action).toBe('allow');
  });
});

describe('accessRow', () => {
  const mac = (raw: string, state: SystemAccess['state'], canRequest = false): SystemAccess => ({ state, raw, via: 'eventkit', canRequest, message: raw });
  it('maps every EventKit state to the row', () => {
    expect(accessRow(mac('granted', 'granted'), 'darwin')).toBeNull();
    expect(accessRow(mac('notDetermined', 'notDetermined', true), 'darwin')).toMatchObject({ title: 'Keeper can’t see your calendars yet', action: 'allow', connect: true });
    expect(accessRow(mac('denied', 'denied'), 'darwin')).toMatchObject({ action: 'settings', settingsUrl: MAC_CALENDAR_PRIVACY });
    expect(accessRow(mac('restricted', 'restricted'), 'darwin')).toMatchObject({ action: 'settings' });
    const w = accessRow(mac('writeOnly', 'denied'), 'darwin');
    expect(w).toMatchObject({ action: 'settings' });
    expect(w!.detail).toMatch(/Full Access/);
  });
  it('says when the helper is missing or reading is off, unless accounts give events', () => {
    expect(accessRow({ state: 'unavailable', via: 'eventkit', canRequest: false, message: 'no helper' }, 'darwin')).toMatchObject({ action: 'none', detail: 'no helper' });
    expect(accessRow({ state: 'unavailable', canRequest: false, message: 'no helper' }, 'darwin')).toMatchObject({ action: 'none', connect: true });
    expect(accessRow({ state: 'unavailable', canRequest: false, message: 'none' }, 'linux', { otherSources: true })).toBeNull();
    expect(accessRow({ state: 'unavailable', canRequest: false, raw: 'switchedOff', message: 'off' }, 'darwin')).toMatchObject({ action: 'turnOn' });
    expect(accessRow({ state: 'unavailable', canRequest: false, raw: 'featureOff', message: 'off' }, 'win32')).toMatchObject({ action: 'enableFeature', connect: false });
    expect(accessRow({ state: 'granted', via: 'appointments', canRequest: false, message: '' }, 'win32')).toBeNull();
    expect(accessRow(null, 'darwin')).toBeNull();
  });
});
