// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { cleanGoals, GOALS, goalParts, goalsLine, MAX_GOALS, normalizeTips, TIP_DAYS, tipsFor, tipToday, TIPS, toggleGoal } from '../core/goals';
import { FEATURES } from '../core/features';
import { jargonIn } from '../core/settings-schema';
import { defaultSettings, mergeSettings } from '../core/settings';

const DAY = 86_400_000;

describe('What do you want Keeper for?', () => {
  it('has eight goals, each naming real parts, in plain short words', () => {
    expect(GOALS).toHaveLength(8);
    for (const g of GOALS) {
      for (const p of g.parts) expect(FEATURES.some((f) => f.id === p), `${g.id}: ${p}`).toBe(true);
      expect(g.title.split(' ').length, g.id).toBeLessThanOrEqual(4);
      expect(jargonIn(`${g.title} ${g.line}`), g.id).toEqual([]);
    }
  });
  it('picks up to three', () => {
    let l = toggleGoal([], 'files');
    l = toggleGoal(l, 'focus');
    l = toggleGoal(l, 'mail');
    expect(toggleGoal(l, 'notes')).toEqual(l);
    expect(toggleGoal(l, 'focus')).toEqual(['files', 'mail']);
    expect(MAX_GOALS).toBe(3);
    expect(cleanGoals(['files', 'nope', 'files', 'mail', 'notes', 'focus'])).toEqual(['files', 'mail', 'notes']);
    expect(cleanGoals('x')).toEqual([]);
  });
  it('adds the goals’ parts to the essentials, leaving out what this system cannot run', () => {
    const parts = goalParts(['library', 'island'], ['record', 'mail'], 'linux');
    expect(parts).toEqual(expect.arrayContaining(['library', 'island', 'capture', 'studio', 'mail', 'calendars']));
    expect(goalParts(['library'], [], 'linux')).toEqual(['library']);
    for (const id of goalParts([], GOALS.map((g) => g.id), 'win32')) {
      const f = FEATURES.find((x) => x.id === id)!;
      expect(!f.platforms || f.platforms.includes('win32'), id).toBe(true);
    }
  });
  it('says what was picked', () => {
    expect(goalsLine([])).toBe('The essentials, picked for this computer');
    expect(goalsLine(['files'])).toBe('Picked for Find my files');
    expect(goalsLine(['files', 'focus', 'mail'])).toBe('Picked for Find my files, Stay focused and Mail & calendar');
  });
  it('is kept in the settings', () => {
    expect(mergeSettings(defaultSettings([], []), { setupGoals: ['notes', 'x'] }).setupGoals).toEqual(['notes']);
  });
});

describe('Getting to know Keeper', () => {
  const start = Date.UTC(2026, 10, 1, 9);
  it('one new tip a day for a week, the person’s goals first', () => {
    const list = tipsFor(['mail']);
    expect(list).toHaveLength(TIP_DAYS);
    expect(list[0].id).toBe('search');
    expect(list.findIndex((t) => t.id === 'mail')).toBeLessThan(list.findIndex((t) => t.id === 'undo'));
    const firstOther = list.findIndex((t) => t.goals && !t.goals.includes('mail'));
    expect(firstOther === -1 || firstOther > list.findIndex((t) => t.id === 'quiet')).toBe(true);
    const s = { on: true, start, done: [] };
    expect(tipToday(s, ['mail'], start + 1000)?.id).toBe('search');
    expect(tipToday(s, ['mail'], start + DAY + 1000)?.id).toBe(list[1].id);
    expect(tipToday(s, ['mail'], start + 7 * DAY + 1000)).toBeNull();
  });
  it('a tip put away stays away; the series can be switched off; nothing before setup', () => {
    expect(tipToday({ on: true, start, done: ['search'] }, [], start + 1000)).toBeNull();
    expect(tipToday({ on: false, start, done: [] }, [], start + 1000)).toBeNull();
    expect(tipToday({ on: true, start: 0, done: [] }, [], start)).toBeNull();
  });
  it('every tip is short and plain', () => {
    for (const t of TIPS) {
      expect(t.title.split(' ').length, t.id).toBeLessThanOrEqual(6);
      expect(jargonIn(`${t.title} ${t.text}`), t.id).toEqual([]);
    }
    expect(normalizeTips({ on: false, start: -1, done: ['a', 3] })).toEqual({ on: false, start: 0, done: ['a'] });
    expect(defaultSettings([], []).tips).toEqual({ on: true, start: 0, done: [] });
  });
});
