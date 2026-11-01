// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { parseTodos, serializeTodo } from '../core/pim/ical';
import { addLog, insights, LOG_MAX, type LogEntry } from '../core/pim/insights';
import { parseTask } from '../core/pim/quickadd';
import {
  addDays, cleanTask, completeTask, dayKey, effectiveDay, inboxTasks, isOverdue, moveToDay, nextOccurrence, overdueTasks, repeatLabel,
  reorder, rescheduleAll, sortTasks, taskDay, tasksByDay, todayTasks, todosToTasks, toggleDone, upcomingTasks, weekDays, type Task,
} from '../core/pim/tasks';

const at = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const task = (p: Partial<Task>): Task => ({ id: p.id ?? Math.random().toString(36).slice(2), list: 'local', title: p.title ?? 'Task', done: false, ...p });

describe('the shared task model', () => {
  it('keeps the planner fields through VTODO (CalDAV)', () => {
    const t = task({
      id: 'l:u1', uid: 'u1', title: 'Water the plants', plannedFor: '2026-11-02', rrule: 'FREQ=WEEKLY;BYDAY=MO', project: 'home',
      steps: [{ id: 'a', title: 'Kitchen', done: true }, { id: 'b', title: 'Balcony, front', done: false }], order: 3, created: Date.UTC(2026, 9, 1), priority: 2,
      focus: [{ at: 1_700_000_000_000, minutes: 25 }],
    });
    const ics = serializeTodo(t);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261102');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
    expect(ics).toContain('CATEGORIES:home');
    const [back] = parseTodos(ics, 'l');
    expect(back).toMatchObject({ title: 'Water the plants', plannedFor: '2026-11-02', rrule: 'FREQ=WEEKLY;BYDAY=MO', project: 'home', order: 3, priority: 2, created: Date.UTC(2026, 9, 1) });
    expect(back.steps).toEqual(t.steps);
    expect(back.focus).toEqual(t.focus);
  });

  it('leaves out a repeat rule with nothing to count from (RFC 5545 needs DTSTART or DUE)', () => {
    expect(serializeTodo(task({ title: 'x', rrule: 'FREQ=DAILY' }))).not.toContain('RRULE');
  });

  it('a task belongs to its planned day, else its due day, else the Inbox', () => {
    expect(taskDay(task({ plannedFor: '2026-11-03', due: at(2026, 11, 5, 9) }))).toBe('2026-11-03');
    expect(taskDay(task({ due: at(2026, 11, 5, 9) }))).toBe('2026-11-05');
    expect(taskDay(task({}))).toBeUndefined();
    const list = [task({ id: 'a' }), task({ id: 'b', plannedFor: '2026-11-03' }), task({ id: 'c', done: true })];
    expect(inboxTasks(list).map((t) => t.id)).toEqual(['a']);
  });

  it('sorts by the person’s order, then importance, then due time', () => {
    const l = sortTasks([task({ id: 'low', priority: 1 }), task({ id: 'high', priority: 3 }), task({ id: 'first', order: 0 }), task({ id: 'done', done: true, order: -1 })]);
    expect(l.map((t) => t.id)).toEqual(['first', 'high', 'low', 'done']);
  });
});

describe('moving the Island’s to-dos', () => {
  it('turns each old to-do into a local task once (starred = important)', () => {
    const old = [
      { id: 't1', text: 'Buy milk', done: false, starred: true, created: 5 },
      { id: 't2', text: '  ', done: false, starred: false, created: 6 },
      { id: 't3', text: 'Call Ana', done: true, starred: false, created: 7, doneAt: 9 },
    ];
    const tasks = todosToTasks(old);
    expect(tasks).toEqual([
      { id: 'local:island-t1', list: 'local', uid: 'island-t1', title: 'Buy milk', done: false, doneAt: undefined, priority: 3, created: 5, order: 0 },
      { id: 'local:island-t3', list: 'local', uid: 'island-t3', title: 'Call Ana', done: true, doneAt: 9, priority: 0, created: 7, order: 1 },
    ]);
    // Running it again adds nothing twice.
    expect(todosToTasks(old, tasks)).toEqual([]);
  });
});

describe('Today and carry-forward', () => {
  const today = '2026-11-04';
  it('rolls unfinished tasks from earlier days to today, without rewriting them', () => {
    const t = task({ plannedFor: '2026-11-01' });
    expect(effectiveDay(t, today)).toEqual({ day: today, carriedFrom: '2026-11-01' });
    expect(t.plannedFor).toBe('2026-11-01');
    expect(effectiveDay({ ...t, done: true }, today)).toEqual({ day: '2026-11-01' });
    expect(effectiveDay(task({ plannedFor: '2026-11-06' }), today)).toEqual({ day: '2026-11-06' });
  });

  it('lists today’s, carried and (when asked) finished-today tasks', () => {
    const list = [
      task({ id: 'old', plannedFor: '2026-10-30' }),
      task({ id: 'due', due: at(2026, 11, 4, 15) }),
      task({ id: 'later', plannedFor: '2026-11-05' }),
      task({ id: 'inbox' }),
      task({ id: 'doneToday', done: true, doneAt: at(2026, 11, 4, 8), plannedFor: '2026-11-04' }),
      task({ id: 'doneBefore', done: true, doneAt: at(2026, 11, 3, 8), plannedFor: '2026-11-03' }),
    ];
    expect(todayTasks(list, today).map((t) => t.id).sort()).toEqual(['due', 'old']);
    expect(todayTasks(list, today, { withDone: true }).map((t) => t.id).sort()).toEqual(['doneToday', 'due', 'old']);
  });

  it('builds the week (Monday or Sunday first) and puts carried tasks on today', () => {
    expect(weekDays(today, 1)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    expect(weekDays(today, 0)[0]).toBe('2026-11-01');
    expect(weekDays(today, 1, 1)[0]).toBe('2026-11-09');
    const days = weekDays(today, 1);
    const m = tasksByDay([task({ id: 'a', plannedFor: '2026-10-20' }), task({ id: 'b', plannedFor: '2026-11-07' })], days, today);
    expect(m.get(today)!.map((t) => t.id)).toEqual(['a']);
    expect(m.get('2026-11-07')!.map((t) => t.id)).toEqual(['b']);
  });

  it('moves tasks between days with their due time and reminder, and to the Inbox', () => {
    const t = task({ due: at(2026, 11, 4, 9, 30), remindAt: at(2026, 11, 4, 9, 20) });
    const m = moveToDay(t, '2026-11-06');
    expect(m.plannedFor).toBe('2026-11-06');
    expect(new Date(m.due!).getHours()).toBe(9);
    expect(dayKey(m.due!)).toBe('2026-11-06');
    expect(m.remindAt! - m.due!).toBe(-10 * 60_000);
    const inbox = moveToDay(m, null);
    expect(inbox.plannedFor).toBeUndefined();
    expect(inbox.due).toBeUndefined();
    expect(rescheduleAll([t, task({ id: 'x' })], [t.id], '2026-11-05').map((x) => x.plannedFor)).toEqual(['2026-11-05']);
  });
});

describe('Overdue and Upcoming', () => {
  const now = at(2026, 11, 4, 12);
  it('finds overdue tasks by due time or an earlier planned day', () => {
    expect(isOverdue(task({ due: at(2026, 11, 4, 11) }), now)).toBe(true);
    expect(isOverdue(task({ due: at(2026, 11, 4, 13) }), now)).toBe(false);
    expect(isOverdue(task({ plannedFor: '2026-11-03' }), now)).toBe(true);
    expect(isOverdue(task({ plannedFor: '2026-11-04' }), now)).toBe(false);
    expect(isOverdue(task({ plannedFor: '2026-11-01', done: true }), now)).toBe(false);
    expect(overdueTasks([task({ id: 'b', plannedFor: '2026-11-02' }), task({ id: 'a', plannedFor: '2026-11-01' })], now).map((t) => t.id)).toEqual(['a', 'b']);
  });
  it('lists upcoming tasks after today, soonest first', () => {
    const l = upcomingTasks([task({ id: 'far', plannedFor: '2026-12-30' }), task({ id: 'b', plannedFor: '2026-11-08' }), task({ id: 'a', due: at(2026, 11, 5, 9) }), task({ id: 't', plannedFor: '2026-11-04' })], '2026-11-04');
    expect(l.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('repeating tasks', () => {
  it('rolls a daily task with a due time to the next day', () => {
    const now = at(2026, 11, 4, 10);
    const t = task({ due: at(2026, 11, 4, 9), remindAt: at(2026, 11, 4, 8, 50), rrule: 'FREQ=DAILY', steps: [{ id: 's', title: 'x', done: true }] });
    const r = completeTask(t, now);
    expect(r.completed).toBe(true);
    expect(r.rolled).toBe(true);
    expect(r.task.done).toBe(false);
    expect(r.task.due).toBe(at(2026, 11, 5, 9));
    expect(r.task.remindAt).toBe(at(2026, 11, 5, 8, 50));
    expect(r.task.steps![0].done).toBe(false);
  });

  it('does not stack up missed days: a task left for a week comes back from today on', () => {
    const now = at(2026, 11, 10, 10);
    expect(nextOccurrence(task({ plannedFor: '2026-11-02', rrule: 'FREQ=DAILY' }), now)).toBe(at(2026, 11, 10));
    expect(nextOccurrence(task({ due: at(2026, 11, 2, 9), rrule: 'FREQ=DAILY' }), now)).toBe(at(2026, 11, 10, 9));
  });

  it('rolls planned-day tasks on their weekday, and counts down a COUNT', () => {
    // 2026-11-02 is a Monday.
    const t = task({ plannedFor: '2026-11-02', rrule: 'FREQ=WEEKLY;BYDAY=MO,TH;COUNT=3' });
    const r1 = completeTask(t, at(2026, 11, 2, 12)).task;
    expect(r1.plannedFor).toBe('2026-11-05');
    expect(r1.rrule).toContain('COUNT=2');
    const r2 = completeTask(r1, at(2026, 11, 5, 12)).task;
    expect(r2.plannedFor).toBe('2026-11-09');
    expect(r2.rrule).toContain('COUNT=1');
    // The last one is simply done.
    const r3 = completeTask(r2, at(2026, 11, 9, 12));
    expect(r3.task.done).toBe(true);
    expect(r3.rolled).toBe(false);
  });

  it('stops at UNTIL, and a plain task is simply done', () => {
    const t = task({ plannedFor: '2026-11-02', rrule: 'FREQ=DAILY;UNTIL=20261102' });
    expect(completeTask(t, at(2026, 11, 2, 12)).task.done).toBe(true);
    expect(completeTask(task({}), 5).task).toMatchObject({ done: true, doneAt: 5 });
    expect(toggleDone(task({ done: true, doneAt: 4 })).task).toMatchObject({ done: false, doneAt: undefined });
  });

  it('describes repeats briefly', () => {
    expect(repeatLabel('FREQ=DAILY')).toBe('Daily');
    expect(repeatLabel('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('Weekdays');
    expect(repeatLabel('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')).toBe('Every 2 weeks on Mon');
  });
});

describe('order and clean input', () => {
  it('reorders by drag and returns only what changed', () => {
    const l = [task({ id: 'a', order: 0 }), task({ id: 'b', order: 1 }), task({ id: 'c', order: 2 })];
    expect(reorder(l, 'c', 'a').map((t) => [t.id, t.order])).toEqual([['c', 0], ['a', 1], ['b', 2]]);
    expect(reorder(l, 'a', null).map((t) => [t.id, t.order])).toEqual([['b', 0], ['c', 1], ['a', 2]]);
  });
  it('takes only known fields of the right kinds from an AI', () => {
    const t = cleanTask({ title: '  Pay rent ', plannedFor: '2026-11-05', priority: 7, rrule: 'nonsense', project: '#home', steps: ['a', { title: 'b', done: true }], extra: 1 });
    expect(t).toMatchObject({ title: 'Pay rent', plannedFor: '2026-11-05', project: 'home', list: 'local' });
    expect(t.priority).toBeUndefined();
    expect(t.rrule).toBeUndefined();
    expect(t.steps!.map((s) => [s.title, s.done])).toEqual([['a', false], ['b', true]]);
    expect((t as unknown as Record<string, unknown>).extra).toBeUndefined();
    expect(cleanTask({ plannedFor: null }, task({ plannedFor: '2026-11-01' })).plannedFor).toBeUndefined();
  });
  it('adds days across months', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('insights', () => {
  const now = at(2026, 11, 4, 18);
  const log: LogEntry[] = [
    { kind: 'task', at: at(2026, 11, 4, 9, 15) },
    { kind: 'task', at: at(2026, 11, 4, 9, 45) },
    { kind: 'focus', at: at(2026, 11, 4, 10, 30), minutes: 50 },
    { kind: 'task', at: at(2026, 11, 2, 14) },
    { kind: 'focus', at: at(2026, 11, 3, 15), minutes: 25 },
    // Last week: not in this week's totals.
    { kind: 'task', at: at(2026, 10, 30, 9) },
  ];
  it('adds up today and this week', () => {
    const i = insights(log, now, 1);
    expect(i.today).toEqual({ day: '2026-11-04', tasks: 2, focusMin: 50 });
    expect(i.week).toEqual({ tasks: 3, focusMin: 75 });
    expect(i.days).toHaveLength(7);
    expect(i.days[6].day).toBe('2026-11-04');
  });
  it('spreads focus over the hours it covered and finds the best hours', () => {
    const i = insights(log, now, 1);
    // 9:40–10:30: 20 minutes in the 9 o'clock hour, 30 in the 10 o'clock hour; plus 3 tasks done at 9 (×10).
    expect(i.hours[9]).toBe(20 + 30);
    expect(i.hours[10]).toBe(30);
    expect(i.hours[14]).toBe(25 + 10);
    expect(i.peak).toEqual([9, 14, 10]);
  });
  it('counts a streak of days with something done', () => {
    expect(insights(log, now).streak).toBe(3);
    // Nothing yet today does not break yesterday's streak.
    expect(insights(log.filter((e) => e.at < at(2026, 11, 4)), now).streak).toBe(2);
    expect(insights([], now)).toMatchObject({ streak: 0, peak: [] });
  });
  it('keeps the log small', () => {
    let l: LogEntry[] = [{ kind: 'task', at: now - 200 * 86_400_000 }];
    l = addLog(l, { kind: 'task', at: now }, now);
    expect(l).toHaveLength(1);
    const big = Array.from({ length: LOG_MAX }, (_, i) => ({ kind: 'task' as const, at: now - i }));
    expect(addLog(big, { kind: 'task', at: now }, now)).toHaveLength(LOG_MAX);
  });
});

describe('tasks in plain words', () => {
  const now = at(2026, 11, 4, 12); // a Wednesday
  it('reads priority, project, day, time and repeats', () => {
    expect(parseTask('Pay rent !!! #home every month', now)).toEqual({ title: 'Pay rent', plannedFor: '2026-11-04', rrule: 'FREQ=MONTHLY', priority: 3, project: 'home' });
    expect(parseTask('call Ana tomorrow 3pm !', now)).toEqual({ title: 'call Ana', plannedFor: '2026-11-05', due: at(2026, 11, 5, 15), priority: 1 });
    expect(parseTask('water plants every Mon and Thu', now)).toEqual({ title: 'water plants', plannedFor: '2026-11-05', rrule: 'FREQ=WEEKLY;BYDAY=MO,TH' });
    expect(parseTask('#work review the deck friday !!', now)).toEqual({ title: 'review the deck', plannedFor: '2026-11-06', project: 'work', priority: 2 });
    expect(parseTask('standup every weekday 9:15', now)).toMatchObject({ title: 'standup', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', due: at(2026, 11, 4, 9, 15) });
    expect(parseTask('gym every 2 weeks', now)).toMatchObject({ rrule: 'FREQ=WEEKLY;INTERVAL=2', plannedFor: '2026-11-04' });
    expect(parseTask('stretch every day', now)).toMatchObject({ rrule: 'FREQ=DAILY' });
    expect(parseTask('plan trip every Saturday', now)).toMatchObject({ rrule: 'FREQ=WEEKLY;BYDAY=SA', plannedFor: '2026-11-07' });
  });
  it('leaves plain text alone', () => {
    expect(parseTask('Buy milk', now)).toEqual({ title: 'Buy milk' });
    expect(parseTask('Wow, great!', now)).toEqual({ title: 'Wow, great!' });
    expect(parseTask('buy monster energy and a month pass', now)).toEqual({ title: 'buy monster energy and a month pass' });
    // A place stays in the title of a task.
    expect(parseTask('meet at the office tomorrow', now)).toEqual({ title: 'meet at the office', plannedFor: '2026-11-05' });
    expect(parseTask('   ', now)).toBeNull();
  });
});
