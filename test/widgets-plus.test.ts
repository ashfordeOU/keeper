// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cellHours, cleanWork, dayFraction, DEFAULT_WORK, isWorking, minutesIn, offsetFromViewer, overlapCells, overlapRanges, quarters, resolvePlace, viewerDayStart, workCells } from '../core/widget-world';
import { weekAddPlan, weekGrid, weekOf, weekRange } from '../core/widget-week';
import { dayPartRain, forecastDays, partOf } from '../core/widget-forecast';
import { cleanMinutes, extendTimer, plusMinute, timerText, timerView } from '../core/widget-timer';
import { inkIsDark, newWidget, normalizeWidgets, presetBounds } from '../core/widgets';
import type { WeekEvent } from '../core/pim/week-events';
import type { Task } from '../core/pim/tasks';
import type { Weather } from '../core/weather';

const was = process.env.TZ;
const setTz = (tz: string) => { process.env.TZ = tz; };
afterAll(() => { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; });

const H = 3_600_000;
/** The hours (viewer's clock) whose four quarters are all working, as numbers. */
const fullHours = (cells: number[]) => cells.map((m, i) => (m === 0b1111 ? i : -1)).filter((i) => i >= 0);

describe('world clock: working hours', () => {
  beforeAll(() => setTz('Europe/London'));

  it('maps a city’s 9–18 onto the viewer’s day', () => {
    const from = new Date(2026, 0, 14).getTime(); // London winter, UTC+0
    expect(fullHours(workCells('Europe/London', DEFAULT_WORK, from))).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    // New York (UTC−5): 9:00 there is 14:00 here.
    expect(fullHours(workCells('America/New_York', DEFAULT_WORK, from))).toEqual([14, 15, 16, 17, 18, 19, 20, 21, 22]);
    // Tokyo (UTC+9): 9:00–18:00 there is 0:00–9:00 here.
    expect(fullHours(workCells('Asia/Tokyo', DEFAULT_WORK, from))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('splits hours for half- and quarter-hour zones', () => {
    const from = new Date(2026, 0, 14).getTime();
    // Kolkata is UTC+5:30: 9:00 there is 3:30 here, 18:00 there 12:30 here.
    const k = workCells('Asia/Kolkata', DEFAULT_WORK, from);
    expect(k[3]).toBe(0b1100);
    expect(quarters(k[3])).toBe(2);
    expect(fullHours(k)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(k[12]).toBe(0b0011);
    // Kathmandu is UTC+5:45: 9:00 there is 3:15 here.
    const n = workCells('Asia/Kathmandu', DEFAULT_WORK, from);
    expect(n[3]).toBe(0b1110);
    expect(n[12]).toBe(0b0001);
  });

  it('follows clock changes on both sides', () => {
    // Late March: the US is already on summer time (UTC−4), London not yet (UTC+0).
    const mar = new Date(2026, 2, 20).getTime();
    expect(fullHours(workCells('America/New_York', DEFAULT_WORK, mar))[0]).toBe(13);
    // April: both on summer time, five hours apart again.
    const apr = new Date(2026, 3, 15).getTime();
    expect(fullHours(workCells('America/New_York', DEFAULT_WORK, apr))[0]).toBe(14);
    // Sydney leaves summer time on 5 April 2026 (UTC+11 → UTC+10); London is on BST (UTC+1) by then.
    const before = new Date(2026, 2, 20).getTime(); // UTC+11 vs UTC+0
    const after = new Date(2026, 3, 15).getTime(); // UTC+10 vs UTC+1
    expect(fullHours(workCells('Australia/Sydney', DEFAULT_WORK, before))).toEqual([0, 1, 2, 3, 4, 5, 6, 22, 23]);
    expect(fullHours(workCells('Australia/Sydney', DEFAULT_WORK, after))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('counts the real hours of a day the viewer’s clocks change', () => {
    // London springs forward on 29 March 2026: 02:00 does not exist; cells are real hours.
    const from = viewerDayStart(new Date(2026, 2, 29, 12).getTime());
    const hrs = cellHours('Europe/London', from);
    expect(hrs.slice(0, 3)).toEqual([0, 2, 3]);
    expect(dayFraction(from + 12 * H, from)).toBeCloseTo(0.5);
  });

  it('finds when everyone works, to the quarter hour', () => {
    const from = new Date(2026, 0, 14).getTime();
    const rows = [workCells('Europe/London', DEFAULT_WORK, from), workCells('Asia/Kolkata', DEFAULT_WORK, from)];
    const o = overlapCells(rows);
    // London 9–18, Kolkata 3:30–12:30 London time → 9:00–12:30.
    const r = overlapRanges(o, from);
    expect(r.minutes).toBe(210);
    expect(r.ranges).toEqual([[from + 9 * H, from + 12.5 * H]]);
    // Adding New York (14–23 London time) leaves nothing.
    expect(overlapRanges(overlapCells([...rows, workCells('America/New_York', DEFAULT_WORK, from)]), from).minutes).toBe(0);
    expect(overlapCells([]).every((m) => m === 0)).toBe(true);
  });

  it('handles night shifts and bad settings', () => {
    expect(isWorking(23 * 60, { start: 22 * 60, end: 6 * 60 })).toBe(true);
    expect(isWorking(12 * 60, { start: 22 * 60, end: 6 * 60 })).toBe(false);
    expect(isWorking(600, { start: 600, end: 600 })).toBe(false);
    expect(cleanWork(undefined)).toEqual(DEFAULT_WORK);
    expect(cleanWork({ start: 547, end: 2000 })).toEqual({ start: 540, end: 0 });
  });

  it('reads time and offsets in a zone', () => {
    const t = Date.UTC(2026, 0, 14, 12, 0);
    expect(minutesIn('Asia/Kolkata', t)).toBe(17 * 60 + 30);
    expect(offsetFromViewer('Asia/Kolkata', t)).toBe('+5:30');
    expect(offsetFromViewer('America/New_York', t)).toBe('−5');
    expect(offsetFromViewer('Europe/London', t)).toBe('');
  });

  it('turns typed names into zones', () => {
    expect(resolvePlace('Tokyo')).toEqual({ label: 'Tokyo', zone: 'Asia/Tokyo' });
    expect(resolvePlace('dubai')).toEqual({ label: 'Dubai', zone: 'Asia/Dubai' });
    expect(resolvePlace('Europe/Paris')).toEqual({ label: 'Paris', zone: 'Europe/Paris' });
    expect(resolvePlace('europe/paris')?.zone.toLowerCase()).toBe('europe/paris');
    expect(resolvePlace('Mumbai')).toEqual({ label: 'Mumbai', zone: 'Asia/Kolkata' });
    expect(resolvePlace('san francisco')).toEqual({ label: 'San Francisco', zone: 'America/Los_Angeles' });
    expect(resolvePlace('NYC')).toEqual({ label: 'New York', zone: 'America/New_York' });
    expect(resolvePlace('Buenos Aires')?.zone).toMatch(/Buenos_Aires$/);
    expect(resolvePlace('Atlantis')).toBeNull();
    expect(resolvePlace('  ')).toBeNull();
  });
});

describe('week widget grid', () => {
  beforeAll(() => setTz('Europe/Berlin'));
  const ev = (key: string, title: string, start: number, end: number, o: Partial<WeekEvent> = {}): WeekEvent => ({ key, eventId: key, instance: start, title, start, end, allDay: false, color: '#0a84ff', calendar: 'work', calendarName: 'Work', part: 'single', ...o });
  const task = (id: string, o: Partial<Task> = {}): Task => ({ id, list: 'local', title: id, done: false, ...o });
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

  it('builds Sunday- or Monday-first weeks and moves by weeks', () => {
    expect(weekOf('2026-11-04', 0)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    expect(weekOf('2026-11-04', 1)[0]).toBe('2026-11-02');
    expect(weekOf('2026-11-04', 0, -1)[0]).toBe('2026-10-25');
    expect(weekOf('2026-11-04', 0, 1)[6]).toBe('2026-11-14');
    const [a, b] = weekRange(weekOf('2026-11-04', 0));
    expect(b - a).toBe(7 * 24 * H);
  });

  it('merges events and tasks per day: all-day first, then by time, then untimed tasks', () => {
    const days = weekOf('2026-11-04', 0);
    const events = new Map<string, WeekEvent[]>([
      ['2026-11-04', [ev('hol', 'Holiday', at(4, 0), at(5, 0), { allDay: true, color: '#30d158' }), ev('std', 'Standup', at(4, 9, 15), at(4, 9, 30)), ev('lun', 'Lunch', at(4, 12, 30), at(4, 13, 30))]],
    ]);
    const tasks = [
      task('Call Ana', { plannedFor: '2026-11-04', due: at(4, 11) }),
      task('Water plants', { plannedFor: '2026-11-04' }),
      task('Old one', { plannedFor: '2026-11-02' }),
      task('Done', { plannedFor: '2026-11-04', done: true, doneAt: at(4, 8) }),
      task('Next week', { plannedFor: '2026-11-10' }),
      task('Shopping', { list: 'home:tasks', plannedFor: '2026-11-06' }),
    ];
    const cols = weekGrid(days, events, tasks, '2026-11-04', new Map([['home:tasks', '#ff375f']]));
    expect(cols).toHaveLength(7);
    const wed = cols[3];
    expect(wed.today).toBe(true);
    expect(cols[2].past).toBe(true);
    expect(wed.cards.map((c) => c.title)).toEqual(['Holiday', 'Standup', 'Call Ana', 'Lunch', 'Old one', 'Water plants']);
    expect(wed.cards.find((c) => c.title === 'Old one')).toMatchObject({ kind: 'task', carried: true, at: undefined });
    expect(wed.cards[0]).toMatchObject({ kind: 'event', allDay: true, at: undefined });
    expect(cols[5].cards).toEqual([expect.objectContaining({ title: 'Shopping', color: '#ff375f' })]);
    expect(cols[1].cards).toEqual([]);
  });

  it('shows where a multi-day event ends', () => {
    const days = weekOf('2026-11-04', 0);
    const events = new Map([['2026-11-05', [ev('trip', 'Trip', at(4, 18), at(5, 10), { part: 'last' })]]]);
    expect(weekGrid(days, events, [], '2026-11-04')[4].cards[0].at).toBe(at(5, 10));
  });

  it('makes an event from words with a time, else a task on that day', () => {
    const e = weekAddPlan('Lunch with Ana 1pm', '2026-11-06');
    expect(e).toMatchObject({ kind: 'event', title: 'Lunch with Ana', start: at(6, 13) });
    expect(weekAddPlan('standup 9:15 for 15 min', '2026-11-03')).toMatchObject({ kind: 'event', start: at(3, 9, 15), end: at(3, 9, 30) });
    expect(weekAddPlan('Water the plants', '2026-11-06')).toEqual({ kind: 'task', text: 'Water the plants', plannedFor: '2026-11-06' });
    expect(weekAddPlan('   ', '2026-11-06')).toBeNull();
  });
});

describe('forecast: rain by part of the day', () => {
  beforeAll(() => setTz('UTC'));
  const tz = 'Asia/Kolkata';
  // Midnight 3 Nov 2026 in Kolkata.
  const day0 = Date.UTC(2026, 10, 2, 18, 30);

  it('takes the highest chance in night, morning, afternoon and evening, by the place’s clock', () => {
    const hours = Array.from({ length: 48 }, (_, i) => ({ t: day0 + i * H, rainChance: i === 3 ? 20 : i === 7 ? 55 : i === 14 ? 90 : i === 20 ? 35 : i === 30 ? 100 : 5 }));
    expect(dayPartRain(hours, day0 + 12 * H, tz)).toEqual([
      { part: 'night', rain: 20 }, { part: 'morning', rain: 55 }, { part: 'afternoon', rain: 90 }, { part: 'evening', rain: 35 },
    ]);
    // Only the second day's hours count for the second day.
    expect(dayPartRain(hours, day0 + 30 * H, tz)[1]).toEqual({ part: 'morning', rain: 100 });
  });

  it('leaves parts with no hours empty', () => {
    const hours = Array.from({ length: 10 }, (_, i) => ({ t: day0 + (14 + i) * H, rainChance: 40 }));
    expect(dayPartRain(hours, day0, tz).map((p) => p.rain)).toEqual([null, null, 40, 40]);
    expect([0, 5, 6, 11, 12, 17, 18, 23].map(partOf)).toEqual(['night', 'night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening']);
  });

  it('builds seven days from today with both units', () => {
    const w: Pick<Weather, 'daily' | 'hourly' | 'hours' | 'units' | 'tz'> = {
      units: 'metric', tz,
      daily: Array.from({ length: 10 }, (_, i) => ({ t: day0 + (i - 1) * 24 * H, min: 10 + i, max: 20 + i, code: 61, rainChance: 40, sunrise: 0, sunset: 0, uvMax: 3 })),
      hourly: [],
      hours: Array.from({ length: 24 * 10 }, (_, i) => ({ t: day0 - 24 * H + i * H, temp: 15, code: 2, rainChance: i % 24 === 15 ? 70 : 10, rain: 0, uv: 0, wind: 5 })),
    };
    const days = forecastDays(w, day0 + 10 * H, 7);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ today: true, hiC: 21, loC: 11, hiF: 70, loF: 52, rain: 40 });
    expect(days[0].parts.map((p) => p.rain)).toEqual([10, 10, 70, 10]);
    const f = forecastDays({ ...w, units: 'imperial', daily: [{ ...w.daily[1], max: 68, min: 50 }] }, day0 + 10 * H);
    expect(f[0]).toMatchObject({ hiC: 20, loC: 10, hiF: 68, loF: 50 });
  });
});

describe('timer', () => {
  const now = 1_000_000;
  it('shows the chosen minutes when idle, and what is left when running or paused', () => {
    expect(timerView(undefined, 25, now)).toEqual({ state: 'idle', leftMs: 25 * 60_000, totalMs: 25 * 60_000, fraction: 1 });
    const run = { durationMs: 10 * 60_000, endsAt: now + 4 * 60_000 };
    expect(timerView(run, 25, now)).toMatchObject({ state: 'running', leftMs: 4 * 60_000, fraction: 0.4 });
    expect(timerView(run, 25, now + 11 * 60_000)).toMatchObject({ state: 'running', leftMs: 0, fraction: 0 });
    expect(timerView({ durationMs: 10 * 60_000, leftMs: 5 * 60_000 }, 25, now)).toMatchObject({ state: 'paused', fraction: 0.5 });
  });

  it('adds a minute to running, paused and idle timers', () => {
    expect(extendTimer({ durationMs: 60_000, endsAt: now + 30_000 }, 60_000, now)).toEqual({ durationMs: 120_000, endsAt: now + 90_000 });
    // Already over: a minute from now.
    expect(extendTimer({ durationMs: 60_000, endsAt: now - 5_000 }, 60_000, now)).toEqual({ durationMs: 120_000, endsAt: now + 60_000 });
    expect(extendTimer({ durationMs: 60_000, leftMs: 10_000 })).toEqual({ durationMs: 120_000, leftMs: 70_000 });
    expect(plusMinute(25)).toBe(26);
    expect(plusMinute(1440)).toBe(1440);
  });

  it('cleans minutes and writes the digits', () => {
    expect(cleanMinutes('x')).toBe(25);
    expect(cleanMinutes(0)).toBe(1);
    expect(cleanMinutes(9.6)).toBe(10);
    expect(timerText(25 * 60_000)).toBe('25:00');
    expect(timerText(4 * 60_000 + 4_001)).toBe('4:05');
    expect(timerText(0)).toBe('0:00');
    expect(timerText(3_723_000)).toBe('1:02:03');
  });
});

describe('widget kinds', () => {
  it('has size presets for the new kinds and keeps old settings working', () => {
    expect(presetBounds('week', 'S', { x: 0, y: 0 })).toMatchObject({ width: 620, height: 260 });
    expect(presetBounds('timer', 'L', { x: 0, y: 0 })).toMatchObject({ width: 290, height: 350 });
    expect(presetBounds('clock', 'L', { x: 0, y: 0 })).toMatchObject({ width: 308, height: 308 });
    expect(newWidget('timer', { x: 0, y: 0 }).options.minutes).toBe(25);
    const old = { id: 'w1', kind: 'world', bounds: { x: 0, y: 0, width: 300, height: 200 }, locked: false, allWorkspaces: true, style: {}, options: { places: [{ label: 'Tokyo', zone: 'Asia/Tokyo' }, { label: 'Pune', zone: 'Asia/Kolkata', work: { start: 600, end: 1145 } }] } };
    const [w] = normalizeWidgets([old, { ...old, id: 'w2', kind: 'timer', options: { minutes: -3 } }, { ...old, id: 'w3', kind: 'nope' }]);
    expect(w.options.places).toEqual([{ label: 'Tokyo', zone: 'Asia/Tokyo' }, { label: 'Pune', zone: 'Asia/Kolkata', work: { start: 600, end: 1140 } }]);
    expect(normalizeWidgets([{ ...old, kind: 'timer', options: { minutes: -3 } }])[0].options.minutes).toBe(1);
    expect(normalizeWidgets([old, { ...old, id: 'w3', kind: 'nope' }])).toHaveLength(1);
  });

  it('knows dark text from light', () => {
    expect(inkIsDark('#ffffff')).toBe(false);
    expect(inkIsDark('#1d1d1f')).toBe(true);
    expect(inkIsDark('#333')).toBe(true);
    expect(inkIsDark('not a colour')).toBe(false);
  });
});
