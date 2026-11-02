// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Week widget's grid: seven day columns, each with that day's calendar
// events and planned tasks as one list of cards (all-day first, then by time,
// then tasks without a time). Pure.

import { addDays, dayStart, effectiveDay, tasksByDay, weekDays, type Task } from './pim/tasks';
import { parseQuickAdd } from './pim/quickadd';
import type { WeekEvent } from './pim/week-events';

export interface WeekCard {
  key: string;
  kind: 'event' | 'task';
  id: string;
  title: string;
  /** a time of day to show; none for all-day events and tasks without a time */
  at?: number;
  /** event: all day (or the middle of an event over several days) */
  allDay: boolean;
  color: string;
  /** event: where it opens; task: its id is enough */
  openUrl?: string;
  instance?: number;
  part?: WeekEvent['part'];
  /** task: overdue from an earlier day, shown on today */
  carried?: boolean;
}

export interface WeekColumn {
  day: string;
  /** local midnight */
  start: number;
  today: boolean;
  past: boolean;
  cards: WeekCard[];
}

/** A task's time of day: its due time when it is not midnight. */
export function taskTime(t: Task): number | undefined {
  if (t.due === undefined) return undefined;
  const d = new Date(t.due);
  return d.getHours() || d.getMinutes() ? t.due : undefined;
}

/** The days of the week shown: `offset` weeks from the one holding `today`. */
export function weekOf(today: string, weekStart = 1, offset = 0): string[] {
  return weekDays(today, ((weekStart % 7) + 7) % 7, offset);
}

/**
 * The seven columns. `colors` gives a task list's colour (its calendar's);
 * `taskColor` is used for the rest.
 */
export function weekGrid(days: string[], events: Map<string, WeekEvent[]>, tasks: Task[], today: string, colors: Map<string, string> = new Map(), taskColor = '#bf5af2'): WeekColumn[] {
  const byDay = tasksByDay(tasks, days, today);
  return days.map((day) => {
    const evs: WeekCard[] = (events.get(day) ?? []).map((e) => {
      const wide = e.allDay || e.part === 'middle';
      return {
        key: e.key, kind: 'event', id: e.eventId, title: e.title, allDay: wide, color: e.color, openUrl: e.openUrl, instance: e.instance, part: e.part,
        at: wide ? undefined : e.part === 'last' ? e.end : e.start,
      };
    });
    const tks: WeekCard[] = (byDay.get(day) ?? []).map((t) => {
      // Left over from an earlier day: shown on today without that day's time.
      const carried = !!effectiveDay(t, today).carriedFrom;
      return { key: `task:${t.id}`, kind: 'task', id: t.id, title: t.title, allDay: false, color: colors.get(t.list) ?? taskColor, at: carried ? undefined : taskTime(t), carried };
    });
    const timed = [...evs.filter((c) => !c.allDay), ...tks.filter((c) => c.at !== undefined)].sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || (a.kind === b.kind ? 0 : a.kind === 'event' ? -1 : 1));
    const cards = [...evs.filter((c) => c.allDay), ...timed, ...tks.filter((c) => c.at === undefined)];
    return { day, start: dayStart(day), today: day === today, past: day < today, cards };
  });
}

/** The range read from the calendar for a week: its first midnight to the midnight after its last day. */
export function weekRange(days: string[]): [number, number] {
  return [dayStart(days[0]), dayStart(addDays(days[days.length - 1], 1))];
}

export type WeekAdd =
  | { kind: 'event'; title: string; start: number; end: number; rrule?: string; location?: string }
  | { kind: 'task'; text: string; plannedFor: string };

/**
 * What "+ add" in a day's column makes: words with a time of day ("Lunch with
 * Ana 1pm", "standup 9:15 for 15 min") become an event on that day (or on the
 * day the words name); anything else is a task planned for that day.
 */
export function weekAddPlan(text: string, day: string): WeekAdd | null {
  const s = text.trim();
  if (!s) return null;
  // Read as if it were that morning, so "9am" is that day and "tomorrow" the day after.
  const q = parseQuickAdd(s, dayStart(day), { location: false });
  if (q && q.found?.time && !q.allDay && q.title.trim()) return { kind: 'event', title: q.title.trim(), start: q.start, end: q.end, rrule: q.rrule, location: q.location };
  return { kind: 'task', text: s, plannedFor: day };
}
