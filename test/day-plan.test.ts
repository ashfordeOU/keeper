// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { blockEvent, currentBlock, freeSlots, guessMinutes, layOut, leftToday, mergeBusy, planCandidates, plannedBlocks, planWindow, roundUp, shiftBlock, taskIdOf, TASK_LINK, tomorrowOf, wrapUpLine } from '../core/day-plan';
import type { Task } from '../core/pim/tasks';
import type { CalEvent, Occurrence } from '../core/pim/types';

const MIN = 60_000;
const at = (h: number, m = 0) => new Date(2026, 10, 4, h, m).getTime();
const hm = (t: number) => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const task = (id: string, o: Partial<Task> = {}): Task => ({ id, list: 'local', title: id, done: false, ...o });

describe('the working window', () => {
  it('starts now (on the next quarter hour) or at the day’s start, and ends at the day’s end', () => {
    const w = planWindow(at(7, 40), 9 * 60, 17 * 60 + 30);
    expect([hm(w.start), hm(w.end)]).toEqual(['9:00', '17:30']);
    const later = planWindow(at(10, 7), 540, 1050);
    expect(hm(later.start)).toBe('10:15');
    const over = planWindow(at(19, 0), 540, 1050);
    expect(over.end - over.start).toBeLessThanOrEqual(0);
    expect(roundUp(at(10, 0))).toBe(at(10, 0));
    expect(roundUp(at(10, 1), 5)).toBe(at(10, 5));
  });
});

describe('free time', () => {
  it('merges busy times and finds the gaps of at least 15 minutes', () => {
    expect(mergeBusy([{ start: at(10), end: at(11) }, { start: at(10, 30), end: at(11, 30) }, { start: at(9), end: at(9) }])).toEqual([{ start: at(10), end: at(11, 30) }]);
    const slots = freeSlots([{ start: at(10), end: at(11) }, { start: at(11, 10), end: at(12) }, { start: at(16), end: at(18) }], { start: at(9), end: at(17, 30) });
    expect(slots.map((s) => `${hm(s.start)}-${hm(s.end)}`)).toEqual(['9:00-10:00', '12:00-16:00']);
    expect(freeSlots([], { start: at(9), end: at(9, 10) })).toEqual([]);
  });
});

describe('laying out the plan', () => {
  it('puts each task in the first gap it fits, with a short breath between', () => {
    const slots = [{ start: at(9), end: at(10) }, { start: at(12), end: at(16) }];
    const r = layOut([{ taskId: 'a', title: 'Write', minutes: 45 }, { taskId: 'b', title: 'Call', minutes: 30 }, { taskId: 'c', title: 'Read', minutes: 15 }], slots);
    expect(r.blocks.map((b) => `${b.taskId} ${hm(b.start)}-${hm(b.end)}`)).toEqual(['a 9:00-9:45', 'b 12:00-12:30', 'c 12:35-12:50']);
    expect(r.unplaced).toEqual([]);
  });
  it('says what does not fit today', () => {
    const r = layOut([{ taskId: 'a', title: 'Big', minutes: 90 }], [{ start: at(16), end: at(17) }]);
    expect(r.blocks).toEqual([]);
    expect(r.unplaced.map((u) => u.taskId)).toEqual(['a']);
  });
  it('moves a block by 15 minutes, but never into an event, another block or outside the day', () => {
    const win = { start: at(9), end: at(17) };
    const busy = [{ start: at(11), end: at(12) }];
    const blocks = layOut([{ taskId: 'a', title: 'A', minutes: 30 }, { taskId: 'b', title: 'B', minutes: 30 }], [{ start: at(9), end: at(11) }]).blocks;
    const later = shiftBlock(blocks, 1, 15, busy, win);
    expect(hm(later[1].start)).toBe('9:50');
    expect(shiftBlock(blocks, 0, -15, busy, win)).toBe(blocks);
    expect(shiftBlock(blocks, 1, 60, busy, win)).toBe(blocks);
    expect(shiftBlock(blocks, 0, 30, busy, win)).toBe(blocks);
    expect(shiftBlock(blocks, 5, 15, busy, win)).toBe(blocks);
  });
});

describe('blocks in the calendar', () => {
  it('are events that point back at their task', () => {
    const e = blockEvent({ taskId: 'local:a b', title: 'Write', minutes: 30, start: at(9), end: at(9, 30) }, 'local:calendar');
    expect(e).toMatchObject({ calendar: 'local:calendar', title: 'Write', start: at(9), end: at(9, 30), allDay: false });
    expect(e.url).toBe(`${TASK_LINK}local%3Aa%20b`);
    expect(taskIdOf(e.url)).toBe('local:a b');
    expect(taskIdOf('https://example.org')).toBeUndefined();
    expect(taskIdOf(TASK_LINK)).toBeUndefined();
  });
  it('are found among today’s events, with the one going on now', () => {
    const occ = (url: string | undefined, s: number, e: number, status?: CalEvent['status']): Occurrence => ({ event: { id: `e${s}`, uid: '', calendar: 'c', title: 'x', start: s, end: e, allDay: false, url, status }, start: s, end: e, instance: s });
    const list = plannedBlocks([occ(`${TASK_LINK}b`, at(14), at(15)), occ(`${TASK_LINK}a`, at(9), at(10)), occ(undefined, at(11), at(12)), occ(`${TASK_LINK}c`, at(16), at(17), 'cancelled'), occ(`${TASK_LINK}d`, at(9) + 86_400_000, at(10) + 86_400_000)], at(9, 30));
    expect(list.map((b) => b.taskId)).toEqual(['a', 'b']);
    expect(currentBlock(list, at(9, 30))?.taskId).toBe('a');
    expect(currentBlock(list, at(12))).toBeUndefined();
  });
});

describe('picking and wrapping up', () => {
  const tasks = [task('t1', { plannedFor: '2026-11-04' }), task('in1'), task('done', { plannedFor: '2026-11-04', done: true }), task('later', { plannedFor: '2026-11-09' }), task('due', { due: at(18) })];
  it('offers today’s tasks first, then the Inbox’s', () => {
    expect(planCandidates(tasks, '2026-11-04').map((t) => t.id)).toEqual(['due', 't1', 'in1']);
    expect(guessMinutes({ steps: [] })).toBe(30);
    expect(guessMinutes({ steps: [{ id: '1', title: '', done: false }, { id: '2', title: '', done: false }] })).toBe(45);
  });
  it('moves what is left to tomorrow and writes one line', () => {
    expect(leftToday(tasks, '2026-11-04').map((t) => t.id)).toEqual(['due', 't1']);
    expect(tomorrowOf('2026-11-30')).toBe('2026-12-01');
    expect(wrapUpLine({ done: 3, moved: 2, note: '  Good call\nwith Sam ', at: at(17, 40), clock: hm })).toBe('- 17:40 · Wrapped up: 3 done, 2 moved to tomorrow. Good call with Sam');
    expect(wrapUpLine({ done: 0, moved: 0, at: at(18), clock: hm })).toBe('- 18:00 · Wrapped up: 0 done.');
    expect(MIN).toBe(60_000);
  });
});
