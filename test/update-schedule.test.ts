// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { AUTO_WAIT_MS, countdown, IDLE_SECONDS, nextStep, planFor } from '../core/update-schedule';

const at = (h: number, m = 0) => new Date(2026, 9, 31, h, m).getTime();
const ctx = (now: number, extra: Partial<Parameters<typeof nextStep>[1]> = {}) => ({ now, busy: [], idleSeconds: 0, readySince: now, auto: false, ...extra });

describe('planFor', () => {
  it('tonight is 23:00 today, or tomorrow when it is already later', () => {
    expect(new Date(planFor('tonight', at(15)).at as number).getHours()).toBe(23);
    expect(new Date(planFor('tonight', at(15)).at as number).getDate()).toBe(31);
    expect(new Date(planFor('tonight', at(23, 30)).at as number).getDate()).toBe(1);
  });
  it('tomorrow morning is 8:30 the next day', () => {
    const d = new Date(planFor('morning', at(15)).at as number);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([1, 8, 30]);
  });
  it('a picked time in the past means now', () => {
    expect(planFor({ at: at(9) }, at(10)).at).toBe(at(10));
  });
  it('quit waits for a quit', () => {
    expect(planFor('quit').at).toBe('quit');
  });
});

describe('nextStep', () => {
  it('waits until the warning window, then counts down, then installs', () => {
    const plan = planFor('hour', at(12));
    expect(nextStep(plan, ctx(at(12)))).toEqual({ do: 'wait' });
    expect(nextStep(plan, ctx(at(12, 57)))).toEqual({ do: 'warn', seconds: 180 });
    expect(nextStep(plan, ctx(at(13)))).toEqual({ do: 'install' });
  });
  it('never installs while Keeper is busy', () => {
    const plan = planFor('now', at(12));
    expect(nextStep(plan, ctx(at(12), { busy: ['Recording the screen'] }))).toEqual({ do: 'postpone', minutes: 10, reason: 'Recording the screen' });
  });
  it('“when I quit” never installs on its own unless automatic mode has waited a day and the computer is idle', () => {
    const plan = planFor('quit');
    expect(nextStep(plan, ctx(at(12), { auto: false, readySince: at(12) - AUTO_WAIT_MS * 2, idleSeconds: IDLE_SECONDS }))).toEqual({ do: 'wait' });
    expect(nextStep(plan, ctx(at(12), { auto: true, readySince: at(12) - 1000, idleSeconds: IDLE_SECONDS }))).toEqual({ do: 'wait' });
    expect(nextStep(plan, ctx(at(12), { auto: true, readySince: at(12) - AUTO_WAIT_MS, idleSeconds: 30 }))).toEqual({ do: 'wait' });
    const s = nextStep(plan, ctx(at(12), { auto: true, readySince: at(12) - AUTO_WAIT_MS, idleSeconds: IDLE_SECONDS }));
    expect(s.do).toBe('warn');
  });
});

describe('countdown', () => {
  it('reads naturally', () => {
    expect(countdown(245)).toBe('4:05');
    expect(countdown(42)).toBe('42 s');
  });
});
