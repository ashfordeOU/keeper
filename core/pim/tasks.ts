// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Tasks: Keeper's one to-do list, seen as a planner. Today (with unfinished
// tasks from earlier days carried forward), a week of days, the Inbox of
// undated tasks, Overdue and Upcoming; repeating tasks that roll on to their
// next date when done; and the move of the Island's old to-dos onto it.
// Pure: the main process and the windows share it.

import { dayKey } from './ical';
import { expand, formatRRule, parseRRule } from './rrule';
import type { Reminder, TaskStep } from './types';

export type Task = Reminder;
export { dayKey };

const DAY = 86_400_000;

/** yyyy-mm-dd → local midnight. */
export function dayStart(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, (m || 1) - 1, (d || 1) + n));
}

export const isDayKey = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The day a task belongs to: its planned day, else its due date's day; none = the Inbox. */
export function taskDay(t: Task): string | undefined {
  if (isDayKey(t.plannedFor)) return t.plannedFor;
  return t.due !== undefined ? dayKey(t.due) : undefined;
}

/**
 * Where a task shows in the planner. Unfinished tasks from earlier days carry
 * forward to today (without being rewritten: the original day stays, so a
 * synced task is not changed on the server every morning).
 */
export function effectiveDay(t: Task, today: string): { day?: string; carriedFrom?: string } {
  const d = taskDay(t);
  if (!d) return {};
  if (!t.done && d < today) return { day: today, carriedFrom: d };
  return { day: d };
}

export const inInbox = (t: Task) => !t.done && taskDay(t) === undefined;

/** The person's order first, then importance, then due time, then oldest first. */
export function compareTasks(a: Task, b: Task): number {
  return Number(a.done) - Number(b.done)
    || (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
    || (b.priority ?? 0) - (a.priority ?? 0)
    || (a.due ?? Infinity) - (b.due ?? Infinity)
    || (a.created ?? 0) - (b.created ?? 0)
    || a.title.localeCompare(b.title);
}

export const sortTasks = (list: Task[]) => [...list].sort(compareTasks);

/** Today: what is planned or due today, what was left from earlier days, and what was finished today. */
export function todayTasks(tasks: Task[], today: string, opts: { withDone?: boolean } = {}): Task[] {
  const start = dayStart(today);
  return sortTasks(tasks.filter((t) => (t.done ? !!opts.withDone && (t.doneAt ?? 0) >= start && (t.doneAt ?? 0) < start + DAY : effectiveDay(t, today).day === today)));
}

export function inboxTasks(tasks: Task[]): Task[] {
  return sortTasks(tasks.filter(inInbox));
}

/** The seven days of the week holding `today` (weekStart: 0 = Sunday, 1 = Monday). */
export function weekDays(today: string, weekStart = 1, offsetWeeks = 0): string[] {
  const dow = new Date(dayStart(today)).getDay();
  const first = addDays(today, -((dow - weekStart + 7) % 7) + offsetWeeks * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/** Tasks for each of the given days (unfinished ones from before today shown on today). */
export function tasksByDay(tasks: Task[], days: string[], today: string, opts: { withDone?: boolean } = {}): Map<string, Task[]> {
  const out = new Map<string, Task[]>(days.map((d) => [d, []]));
  for (const t of tasks) {
    if (t.done && !opts.withDone) continue;
    const day = t.done ? (t.doneAt !== undefined ? dayKey(t.doneAt) : taskDay(t)) : effectiveDay(t, today).day;
    if (day && out.has(day)) out.get(day)!.push(t);
  }
  for (const [d, l] of out) out.set(d, sortTasks(l));
  return out;
}

/** Not done, and its due time has passed or its planned day is before today. */
export function isOverdue(t: Task, now = Date.now()): boolean {
  if (t.done) return false;
  if (t.due !== undefined && t.due < now) return true;
  return isDayKey(t.plannedFor) && t.plannedFor < dayKey(now);
}

export function overdueTasks(tasks: Task[], now = Date.now()): Task[] {
  return tasks.filter((t) => isOverdue(t, now)).sort((a, b) => (taskDay(a) ?? '').localeCompare(taskDay(b) ?? '') || compareTasks(a, b));
}

/** Unfinished tasks after today, up to `days` ahead, soonest first. */
export function upcomingTasks(tasks: Task[], today: string, days = 14): Task[] {
  const last = addDays(today, days);
  return tasks
    .filter((t) => { const d = taskDay(t); return !t.done && !!d && d > today && d <= last; })
    .sort((a, b) => taskDay(a)!.localeCompare(taskDay(b)!) || compareTasks(a, b));
}

/**
 * Moves a task to a day (or to the Inbox with `null`). A due time moves with it
 * to the same time on the new day, and so does its reminder.
 */
export function moveToDay(t: Task, day: string | null): Task {
  if (day === null) {
    const { plannedFor: _p, due: _d, remindAt: _r, ...rest } = t;
    return rest;
  }
  const next: Task = { ...t, plannedFor: day };
  if (t.due !== undefined) {
    const shift = dayStart(day) - dayStart(dayKey(t.due));
    next.due = shiftLocal(t.due, shift);
    if (t.remindAt !== undefined) next.remindAt = shiftLocal(t.remindAt, shift);
  }
  return next;
}

/** Adds whole days on the wall clock (so 9:00 stays 9:00 across a daylight-saving change). */
function shiftLocal(t: number, ms: number): number {
  const d = new Date(t);
  const days = Math.round(ms / DAY);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Bulk "Reschedule to today/tomorrow": the tasks that change. */
export function rescheduleAll(tasks: Task[], ids: string[], day: string): Task[] {
  const want = new Set(ids);
  return tasks.filter((t) => want.has(t.id)).map((t) => moveToDay(t, day));
}

// ---------------------------------------------------------------- repeating tasks

/** The anchor a repeating task counts from: its due time, else its planned day. */
function anchorOf(t: Task): number | undefined {
  if (t.due !== undefined) return t.due;
  return isDayKey(t.plannedFor) ? dayStart(t.plannedFor) : undefined;
}

/**
 * The next time a repeating task comes round after this one: after the current
 * date and not before today (a daily task left for a week comes back tomorrow,
 * not seven times).
 */
export function nextOccurrence(t: Task, now = Date.now()): number | undefined {
  if (!t.rrule) return undefined;
  const rule = parseRRule(t.rrule);
  const anchor = anchorOf(t) ?? dayStart(dayKey(now));
  if (!rule) return undefined;
  // A count is what is left, counted from this occurrence.
  if (rule.count !== undefined && rule.count <= 1) return undefined;
  const ruleFrom = { ...rule, count: undefined };
  const today = dayStart(dayKey(now));
  const from = Math.max(anchor + 1, today);
  const list = expand(ruleFrom, anchor, undefined, from, from + 3 * 366 * DAY, [], 1);
  return list[0];
}

/**
 * Checks a task off. A repeating one rolls on to its next date instead (steps
 * unticked); `completed` says a completion happened either way, for Insights.
 */
export function completeTask(t: Task, now = Date.now()): { task: Task; completed: boolean; rolled: boolean } {
  if (t.done) return { task: t, completed: false, rolled: false };
  const next = nextOccurrence(t, now);
  if (next === undefined) return { task: { ...t, done: true, doneAt: now }, completed: true, rolled: false };
  const rolled: Task = { ...t, done: false, doneAt: undefined, steps: t.steps?.map((s) => ({ ...s, done: false })) };
  const anchor = anchorOf(t)!;
  if (t.due !== undefined) {
    rolled.due = next;
    if (t.remindAt !== undefined) rolled.remindAt = next + (t.remindAt - t.due);
    if (rolled.plannedFor) rolled.plannedFor = dayKey(next);
  } else {
    rolled.plannedFor = dayKey(next);
    if (t.remindAt !== undefined) rolled.remindAt = t.remindAt + (next - anchor);
  }
  const rule = parseRRule(t.rrule!);
  if (rule?.count !== undefined) rolled.rrule = formatRRule({ ...rule, count: rule.count - 1 });
  return { task: rolled, completed: true, rolled: true };
}

/** Toggles done (un-checking a finished task opens it again). */
export function toggleDone(t: Task, now = Date.now()): { task: Task; completed: boolean } {
  if (t.done) return { task: { ...t, done: false, doneAt: undefined }, completed: false };
  const r = completeTask(t, now);
  return { task: r.task, completed: r.completed };
}

/** Short words for a repeat rule: "Daily", "Weekly on Mon", "Every 2 weeks". */
export function repeatLabel(rrule?: string): string {
  if (!rrule) return '';
  const r = parseRRule(rrule);
  if (!r) return 'Repeats';
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[r.freq];
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const base = r.interval > 1 ? `Every ${r.interval} ${unit}s` : ({ DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly' }[r.freq]);
  if (r.byDay?.length === 5 && [1, 2, 3, 4, 5].every((d) => r.byDay!.some((b) => b.day === d))) return 'Weekdays';
  return r.byDay?.length ? `${base} on ${r.byDay.map((b) => names[b.day]).join(', ')}` : base;
}

export const REPEATS: { label: string; rrule: string }[] = [
  { label: 'Never', rrule: '' },
  { label: 'Daily', rrule: 'FREQ=DAILY' },
  { label: 'Weekdays', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Weekly', rrule: 'FREQ=WEEKLY' },
  { label: 'Every 2 weeks', rrule: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Monthly', rrule: 'FREQ=MONTHLY' },
  { label: 'Yearly', rrule: 'FREQ=YEARLY' },
];

// ---------------------------------------------------------------- order

/**
 * Drag to reorder: moves `id` to where `beforeId` is (or to the end) inside an
 * ordered list, and returns the tasks whose order changed.
 */
export function reorder(list: Task[], id: string, beforeId: string | null): Task[] {
  const ids = list.map((t) => t.id).filter((x) => x !== id);
  const at = beforeId ? ids.indexOf(beforeId) : -1;
  ids.splice(at < 0 ? ids.length : at, 0, id);
  const byId = new Map(list.map((t) => [t.id, t]));
  const out: Task[] = [];
  ids.forEach((x, i) => {
    const t = byId.get(x);
    if (t && t.order !== i) out.push({ ...t, order: i });
  });
  return out;
}

// ---------------------------------------------------------------- steps

export function stepProgress(t: Task): { done: number; total: number } | undefined {
  const s = t.steps ?? [];
  return s.length ? { done: s.filter((x) => x.done).length, total: s.length } : undefined;
}

export const newStep = (title: string): TaskStep => ({ id: Math.random().toString(36).slice(2, 10), title, done: false });

// ---------------------------------------------------------------- the Island's old to-dos

export interface OldTodo {
  id: string;
  text: string;
  done: boolean;
  starred: boolean;
  created: number;
  doneAt?: number;
}

/**
 * The Island's own to-dos become local tasks once (starred = important). The
 * ids are kept so running it twice adds nothing twice.
 */
export function todosToTasks(todos: OldTodo[], existing: Task[] = []): Task[] {
  const have = new Set(existing.map((t) => t.id));
  return todos
    .filter((t) => t && typeof t.text === 'string' && t.text.trim())
    .map((t, i): Task => ({
      id: `local:island-${t.id}`,
      list: 'local',
      uid: `island-${t.id}`,
      title: t.text.trim(),
      done: !!t.done,
      doneAt: t.done ? t.doneAt ?? t.created : undefined,
      priority: t.starred ? 3 : 0,
      created: t.created || Date.now(),
      order: i,
    }))
    .filter((t) => !have.has(t.id));
}

/** A task as written by an AI or the command line: only known fields, of the right kinds. */
export function cleanTask(x: Record<string, unknown>, base?: Task): Task {
  const t: Task = base ? { ...base } : { id: '', list: 'local', title: '', done: false };
  if (typeof x.title === 'string') t.title = x.title.trim().slice(0, 500);
  if (typeof x.notes === 'string') t.notes = x.notes.slice(0, 20_000) || undefined;
  if (typeof x.list === 'string' && !base) t.list = x.list;
  if (typeof x.project === 'string') t.project = x.project.replace(/^#/, '').trim().slice(0, 60) || undefined;
  if (x.plannedFor === null) delete t.plannedFor;
  else if (isDayKey(x.plannedFor)) t.plannedFor = x.plannedFor;
  if (x.due === null) delete t.due;
  else if (typeof x.due === 'number' || typeof x.due === 'string') {
    const d = typeof x.due === 'number' ? x.due : Date.parse(x.due);
    if (Number.isFinite(d)) t.due = d;
  }
  if (typeof x.priority === 'number' && [0, 1, 2, 3].includes(x.priority)) t.priority = x.priority as Task['priority'];
  if (x.rrule === null || x.rrule === '') delete t.rrule;
  else if (typeof x.rrule === 'string' && parseRRule(x.rrule)) t.rrule = x.rrule.replace(/^RRULE:/i, '');
  if (Array.isArray(x.steps)) t.steps = x.steps.map((s) => (typeof s === 'string' ? newStep(s) : { ...newStep(String((s as TaskStep)?.title ?? '')), done: !!(s as TaskStep)?.done })).filter((s) => s.title);
  return t;
}
