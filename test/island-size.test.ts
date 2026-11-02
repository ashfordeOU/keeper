// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { defaultSizeFor, islandUsesPanel, largestBox, panelBox, roomIn, sizeFor, snapSize, stepSize, withTabSize } from '../core/island-size';
import { hiddenSummary, islandCalendarGroups, setAllInIsland } from '../core/island-calendars';
import { place, type DisplayInfo, type Rect } from '../core/island-place';
import { agendaFor, islandAgenda } from '../core/pim/agenda';
import { eventsByDay } from '../core/pim/week-events';
import type { CalendarInfo, Occurrence } from '../core/pim/types';
import { defaultSettings, mergeSettings } from '../core/settings';

const disp = (bounds: Rect, workArea: Rect = bounds): DisplayInfo => ({ id: 1, scaleFactor: 2, internal: true, rotation: 0, touch: false, primary: true, bounds, workArea });
const mbp14 = disp({ x: 0, y: 0, width: 1512, height: 982 }, { x: 0, y: 38, width: 1512, height: 944 });
const mac = { platform: 'darwin' as const, macModel: 'MacBookPro18,3', menuBarItems: [] };

describe('open Island sizes', () => {
  it('Calendar, Week, Notes and Mail open Large; the rest at the default', () => {
    for (const t of ['calendar', 'week', 'notes', 'mail']) expect(defaultSizeFor(t)).toBe('large');
    for (const t of ['home', 'shelf', 'clipboard', 'focus']) expect(defaultSizeFor(t)).toBe('regular');
    expect(defaultSizeFor('home', { panelSize: 'compact' })).toBe('compact');
    // A bigger default makes the big tabs bigger too, a smaller one never makes them smaller than Large.
    expect(defaultSizeFor('calendar', { panelSize: 'xl' })).toBe('xl');
    expect(defaultSizeFor('calendar', { panelSize: 'compact' })).toBe('large');
    expect(defaultSizeFor('home', { panelSize: 'nonsense' })).toBe('regular');
  });

  it('a tab’s own size wins; setting it to the default clears it', () => {
    const s = { panelSize: 'regular', panelSizes: { home: 'xl', week: 'bogus' } };
    expect(sizeFor('home', s)).toBe('xl');
    expect(sizeFor('week', s)).toBe('large');
    expect(withTabSize(s, 'calendar', 'xl')).toEqual({ home: 'xl', week: 'bogus', calendar: 'xl' });
    expect(withTabSize(s, 'home', 'regular')).toEqual({ week: 'bogus' });
    expect(withTabSize(s, 'home', null)).toEqual({ week: 'bogus' });
  });

  it('boxes grow with the size, scale and notch', () => {
    const r = { scale: 1, notchH: 32 };
    const w = (['compact', 'regular', 'large', 'xl'] as const).map((z) => panelBox(z, r));
    expect(w.map((b) => b.w)).toEqual([560, 640, 820, 1000]);
    expect(w[1].h).toBe(32 + 300);
    for (let i = 1; i < w.length; i++) expect(w[i].h).toBeGreaterThan(w[i - 1].h);
    expect(panelBox('regular', { scale: 1.2, notchH: 0 })).toEqual({ w: 768, h: 360 });
  });

  it('never bigger than the room the placement leaves on the display', () => {
    const small = disp({ x: 0, y: 0, width: 900, height: 600 }, { x: 0, y: 30, width: 900, height: 540 });
    const p = place(small, { platform: 'linux' });
    expect(p.expanded.width).toBeLessThanOrEqual(900);
    expect(p.expanded.y + p.expanded.height).toBeLessThanOrEqual(570);
    const room = roomIn(p.expanded, { side: false, ears: 0, halo: 28 });
    const xl = panelBox('xl', { scale: p.scale, notchH: 0, max: room });
    expect(xl.w).toBeLessThanOrEqual(900 - 56);
    expect(xl.h + 34).toBeLessThanOrEqual(p.expanded.height);
    expect(largestBox({ scale: 1, notchH: 0, max: room })).toEqual(xl);
    // A notched MacBook Pro has room for Extra large, below the notch, inside the work area.
    const m = place(mbp14, mac);
    const r = roomIn(m.expanded, { side: false, ears: 10, halo: 0 });
    expect(panelBox('xl', { scale: 1, notchH: 32, max: r })).toEqual({ w: 1000, h: 612 });
    expect(m.expanded.y + m.expanded.height).toBeLessThanOrEqual(982);
  });

  it('the grip snaps to the nearest size; sizes clamped to the same height count once', () => {
    const r = { scale: 1, notchH: 0 };
    expect(snapSize(250, r)).toBe('compact');
    expect(snapSize(290, r)).toBe('regular');
    expect(snapSize(400, r)).toBe('large');
    expect(snapSize(5000, r)).toBe('xl');
    expect(snapSize(0, r)).toBe('compact');
    // Only 400 points of room: Large and Extra large are the same, so it snaps to Large.
    expect(snapSize(5000, { ...r, max: { w: 2000, h: 400 } })).toBe('large');
    expect(stepSize('regular', 1)).toBe('large');
    expect(stepSize('xl', 1)).toBe('xl');
    expect(stepSize('compact', -1)).toBe('compact');
  });

  it('window type: a plain window on macOS unless Panel is chosen; a panel elsewhere', () => {
    expect(islandUsesPanel('darwin', undefined)).toBe(false);
    expect(islandUsesPanel('darwin', 'standard')).toBe(false);
    expect(islandUsesPanel('darwin', 'panel')).toBe(true);
    expect(islandUsesPanel('win32', 'standard')).toBe(true);
    expect(islandUsesPanel('linux', undefined)).toBe(true);
  });
});

describe('settings from before the sizes', () => {
  it('existing users get the defaults; bad values are dropped', () => {
    const base = defaultSettings([], []);
    const { panelSize, panelSizes, windowType, ...old } = base.island;
    void panelSize; void panelSizes; void windowType;
    const s = mergeSettings(base, { island: old });
    expect(s.island.panelSize).toBe('regular');
    expect(s.island.panelSizes).toEqual({});
    expect(s.island.windowType).toBe('standard');
    const bad = mergeSettings(base, { island: { ...old, panelSize: 'huge', panelSizes: { calendar: 'xl', week: 'giant', 'bad key!': 'large' }, windowType: 'nspanel' } });
    expect(bad.island.panelSize).toBe('regular');
    expect(bad.island.panelSizes).toEqual({ calendar: 'xl' });
    expect(bad.island.windowType).toBe('standard');
    expect(mergeSettings(base, { island: { ...old, windowType: 'panel', panelSize: 'xl' } }).island).toMatchObject({ windowType: 'panel', panelSize: 'xl' });
  });
});

// ---------------------------------------------------------------- which calendars show

const cal = (id: string, o: Partial<CalendarInfo> = {}): CalendarInfo => ({ id, account: 'acc1', name: id, color: '#ff0000', url: '', readOnly: false, visible: true, ...o });
const day = new Date(2026, 10, 2, 0, 0, 0).getTime();
const at = (h: number) => day + h * 3_600_000;
const ev = (id: string, calendar: string, h: number, title = id): Occurrence => ({ event: { id, calendar, uid: id, title, start: at(h), end: at(h + 1), allDay: false }, start: at(h), end: at(h + 1), instance: at(h) });

describe('calendars in the Island', () => {
  const cals = [cal('work'), cal('holidays', { account: 'holidays', source: 'holidays', island: false }), cal('shared', { island: true }), cal('gone', { visible: false }), cal('todo', { tasks: true })];
  const occ = [ev('a', 'work', 9), ev('b', 'holidays', 10), ev('c', 'shared', 11), ev('d', 'gone', 12)];

  it('a calendar switched off for the Island leaves its Calendar tab, Week tab and agenda', () => {
    expect(agendaFor(occ, cals, day, day).map((x) => x.title)).toEqual(['a', 'c']);
    expect(islandAgenda(occ, cals, day).today.map((x) => x.title)).toEqual(['a', 'c']);
    const key = '2026-11-02';
    expect(eventsByDay(occ, cals, [key], { island: true }).get(key)!.map((x) => x.title)).toEqual(['a', 'c']);
    // Keeper's own Calendar page still shows it (only hidden calendars leave it).
    expect(eventsByDay(occ, cals, [key]).get(key)!.map((x) => x.title)).toEqual(['a', 'b', 'c']);
  });

  it('the picker groups calendars by where they come from, without task lists', () => {
    const g = islandCalendarGroups([...cals, cal('mac', { account: 'system', source: 'system', group: 'iCloud' }), cal('mine', { account: 'local' })], [{ id: 'acc1', label: 'Work account' }]);
    expect(g.map((x) => x.label)).toEqual(['This computer · iCloud', 'Work account', 'Keeper', 'Holidays and birthdays']);
    expect(g.find((x) => x.label === 'Work account')!.calendars.map((c) => c.id)).toEqual(['work', 'shared', 'gone']);
  });

  it('Show all / Hide all change only what differs, and leave calendars hidden in Keeper alone', () => {
    expect(setAllInIsland(cals, true)).toEqual([{ id: 'holidays', island: true }]);
    expect(setAllInIsland(cals, false)).toEqual([{ id: 'work', island: false }, { id: 'shared', island: false }]);
    expect(hiddenSummary(cals)).toBe('2 of 3');
    expect(hiddenSummary([cal('x')])).toBe('');
  });
});

describe('per-tab default boxes (the size table)', () => {
  it('a tab’s own box is used until the person picks a size; a bigger default for all tabs wins over it', async () => {
    const { tabPanel } = await import('../core/island-size');
    const table = { home: { w: 600, h: 176 }, focus: { w: 420, h: 168 } };
    expect(tabPanel('home', {}, table)).toMatchObject({ px: { w: 600, h: 176 }, own: false });
    expect(tabPanel('focus', { panelSizes: { focus: 'large' } }, table)).toMatchObject({ size: 'large', px: { w: 820, h: 440 }, own: true });
    expect(tabPanel('home', { panelSize: 'xl' }, table)).toMatchObject({ size: 'xl', own: false });
    expect(tabPanel('calendar', {}, table)).toMatchObject({ size: 'large', own: false });
    expect(largestBox({ scale: 1, notchH: 0 }, { wide: { w: 1100, h: 200 } })).toEqual({ w: 1100, h: 580 });
  });
});

describe('Keeper’s own calendar', () => {
  it('holds events as well as tasks: the Week tab and the picker include it', () => {
    const own = cal('local:calendar', { account: 'local', name: 'On this computer', tasks: true });
    const key = '2026-11-02';
    expect(eventsByDay([ev('x', 'local:calendar', 9)], [own], [key], { island: true }).get(key)!.map((e) => e.title)).toEqual(['x']);
    expect(islandCalendarGroups([own]).map((g) => g.label)).toEqual(['Keeper']);
    expect(setAllInIsland([own], false)).toEqual([{ id: 'local:calendar', island: false }]);
  });
});
