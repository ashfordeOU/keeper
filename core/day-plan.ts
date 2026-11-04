// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Plan my day: a two-minute ritual. Pick up to three tasks, say roughly how
// long each takes, and Keeper lays them into the free time between your
// events; you nudge them, then they go into your calendar as blocks that
// point back at their task (so ticking a block ticks the task, and the Island
// counts down the block like any event). Wrap up the day moves what is left
// to tomorrow and can write one line in the Journal. Plain functions.

import type { CalEvent, Occurrence } from './pim/types';
import { addDays, todayTasks, type Task } from './pim/tasks';

const MIN = 60_000;

/** "About how long?" choices, in minutes. */
export const ESTIMATES = [15, 30, 45, 60, 90] as const;
/** At most this many tasks are planned: three is a day that can be finished. */
export const PLAN_PICK = 3;
/** A short breath between two blocks. */
export const PLAN_GAP_MIN = 5;
/** A block's link back to its task (CalEvent.url). */
export const TASK_LINK = 'keeper://task/';

export interface Span { start: number; end: number }
export interface PlanItem { taskId: string; title: string; minutes: number }
export interface Block extends PlanItem { start: number; end: number }

/** Rounds a time up to the next whole step (15 minutes by default). */
export function roundUp(t: number, stepMin = 15): number {
  const s = stepMin * MIN;
  return Math.ceil(t / s) * s;
}

/** The working window left today: from now (rounded up) or the day's start, to the day's end. Empty once the day is over. */
export function planWindow(now: number, dayStartMin: number, dayEndMin: number): Span {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const base = d.getTime();
  const start = Math.max(roundUp(now), base + dayStartMin * MIN);
  const end = base + dayEndMin * MIN;
  return { start: Math.min(start, end), end };
}

/** Busy times merged into as few spans as possible, sorted. */
export function mergeBusy(busy: Span[]): Span[] {
  const s = busy.filter((b) => b.end > b.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const b of s) {
    const last = out[out.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else out.push({ ...b });
  }
  return out;
}

/** The gaps of at least `minMinutes` between busy times, inside the window. */
export function freeSlots(busy: Span[], window: Span, minMinutes = 15): Span[] {
  const out: Span[] = [];
  let t = window.start;
  for (const b of mergeBusy(busy)) {
    if (b.end <= t) continue;
    if (b.start >= window.end) break;
    if (b.start - t >= minMinutes * MIN) out.push({ start: t, end: Math.min(b.start, window.end) });
    t = Math.max(t, b.end);
  }
  if (window.end - t >= minMinutes * MIN) out.push({ start: t, end: window.end });
  return out;
}

/**
 * Lays the tasks into the free slots in the order given: each goes into the
 * first gap it fits (on a five-minute mark, with a short gap after the one
 * before). What does not fit today is returned to say so.
 */
export function layOut(items: PlanItem[], slots: Span[]): { blocks: Block[]; unplaced: PlanItem[] } {
  const free = slots.map((s) => ({ ...s }));
  const blocks: Block[] = [];
  const unplaced: PlanItem[] = [];
  for (const it of items) {
    const len = it.minutes * MIN;
    const slot = free.find((s) => roundUp(s.start, 5) + len <= s.end);
    if (!slot) { unplaced.push(it); continue; }
    const start = roundUp(slot.start, 5);
    blocks.push({ ...it, start, end: start + len });
    slot.start = start + len + PLAN_GAP_MIN * MIN;
  }
  return { blocks, unplaced };
}

/**
 * Moves one block earlier or later by `deltaMin`. It stays inside the window
 * and may not run into an event or another block: then nothing changes.
 */
export function shiftBlock(blocks: Block[], index: number, deltaMin: number, busy: Span[], window: Span): Block[] {
  const b = blocks[index];
  if (!b) return blocks;
  const moved = { ...b, start: b.start + deltaMin * MIN, end: b.end + deltaMin * MIN };
  if (moved.start < window.start || moved.end > window.end) return blocks;
  const clash = (s: Span) => moved.start < s.end && moved.end > s.start;
  if (busy.some(clash) || blocks.some((o, i) => i !== index && clash(o))) return blocks;
  const out = [...blocks];
  out[index] = moved;
  return out.sort((x, y) => x.start - y.start);
}

/** A block as a calendar event that points back at its task. */
export function blockEvent(b: Block, calendar: string): CalEvent {
  return { id: '', uid: '', calendar, title: b.title, start: b.start, end: b.end, allDay: false, url: `${TASK_LINK}${encodeURIComponent(b.taskId)}`, description: 'Planned with Plan my day in Keeper.' };
}

/** The task a block points at, if it is one. */
export function taskIdOf(url: string | undefined): string | undefined {
  if (!url || !url.startsWith(TASK_LINK)) return undefined;
  const id = decodeURIComponent(url.slice(TASK_LINK.length));
  return id || undefined;
}

export interface PlannedBlock { taskId: string; title: string; start: number; end: number; eventId: string; instance: number }

/** Today's blocks (events that point at a task), in time order. */
export function plannedBlocks(occ: Occurrence[], now: number): PlannedBlock[] {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const from = d.getTime();
  const to = from + 24 * 60 * MIN;
  const out: PlannedBlock[] = [];
  for (const o of occ) {
    const taskId = taskIdOf(o.event.url);
    if (!taskId || o.end <= from || o.start >= to || o.event.status === 'cancelled') continue;
    out.push({ taskId, title: o.event.title, start: o.start, end: o.end, eventId: o.event.id, instance: o.instance });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The block going on now. */
export const currentBlock = (blocks: PlannedBlock[], now: number) => blocks.find((b) => b.start <= now && b.end > now);

/** Tasks worth offering for the plan: today's first, then the Inbox's, never done ones. */
export function planCandidates(tasks: Task[], today: string, max = 12): Task[] {
  const day = todayTasks(tasks, today);
  const inbox = tasks.filter((t) => !t.done && !t.plannedFor && !t.due);
  const seen = new Set<string>();
  return [...day, ...inbox].filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true))).slice(0, max);
}

/** A first guess at how long a task takes: its steps, or half an hour. */
export function guessMinutes(t: Pick<Task, 'steps'>): (typeof ESTIMATES)[number] {
  const n = t.steps?.filter((s) => !s.done).length ?? 0;
  return n >= 4 ? 60 : n >= 2 ? 45 : 30;
}

// ---------------------------------------------------------------- wrap up the day

/** What is left of today: the unfinished tasks planned or due today (and carried over). */
export const leftToday = (tasks: Task[], today: string) => todayTasks(tasks, today).filter((t) => !t.done);

export const tomorrowOf = (today: string) => addDays(today, 1);

/** The Journal line Wrap up adds: "- 17:40 · Wrapped up: 3 done, 2 moved to tomorrow. Good call with Sam." */
export function wrapUpLine(o: { done: number; moved: number; note?: string; at: number; clock: (t: number) => string }): string {
  const facts = [`${o.done} done`, ...(o.moved ? [`${o.moved} moved to tomorrow`] : [])].join(', ');
  const note = (o.note ?? '').replace(/\s+/g, ' ').trim();
  return `- ${o.clock(o.at)} · Wrapped up: ${facts}.${note ? ` ${note}` : ''}`;
}
