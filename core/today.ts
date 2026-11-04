// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Today: the one place that answers "what now?". It is the top of Hello (the
// start page), not a page of its own: what is on now and next (with Join), the
// three tasks that matter most, how much mail waits for a reply, what is in
// the Inbox, one Fix-it item and a Focus button. Each of these is a card from
// one list, so a calmer set (Light, Files only) shows three and Everything
// shows all six. Mail's own Today strip shrinks to one line once Today has
// been seen that day. Plain functions so they are easy to test.

import type { AgendaItem } from './pim/agenda';
import { compareTasks, todayTasks, type Task } from './pim/tasks';

export type TodayCardId = 'now' | 'tasks' | 'reply' | 'inbox' | 'fixit' | 'focus';

export interface TodayCardDef {
  id: TodayCardId;
  name: string;
  description: string;
  /** shown only while this part is on */
  feature: string;
}

export const TODAY_CARDS: TodayCardDef[] = [
  { id: 'now', name: 'Now and next', description: 'What is on now and what comes next, with Join for calls.', feature: 'calendars' },
  { id: 'tasks', name: 'Top three tasks', description: 'The three tasks for today that matter most.', feature: 'calendars' },
  { id: 'reply', name: 'Waiting for a reply', description: 'How many messages wait for your answer.', feature: 'mail' },
  { id: 'inbox', name: 'Inbox to sort', description: 'Things you caught with the Inbox shortcut.', feature: 'captureInbox' },
  { id: 'fixit', name: 'One thing to fix', description: 'The most useful item from the Fix-it List.', feature: 'guide' },
  { id: 'focus', name: 'Focus', description: 'Start a focus session on your top task.', feature: 'focus' },
];

/** How much Today shows: a calm three, the usual five, or all six. */
export type TodaySize = 'simple' | 'standard' | 'full';

export const TODAY_SIZES: Record<TodaySize, TodayCardId[]> = {
  simple: ['now', 'tasks', 'focus'],
  standard: ['now', 'tasks', 'reply', 'inbox', 'fixit'],
  full: ['now', 'tasks', 'reply', 'inbox', 'fixit', 'focus'],
};

/** The calmer presets get the simple set; Everything gets every card. */
export function sizeForPreset(preset?: string): TodaySize {
  if (preset === 'light' || preset === 'minimal' || preset === 'files') return 'simple';
  if (preset === 'everything') return 'full';
  return 'standard';
}

export interface TodaySettings {
  /** the person's own cards, in order; null follows the preset (sizeForPreset) */
  cards: TodayCardId[] | null;
  /** the day (yyyy-mm-dd) Today was last seen on Hello: Mail's strip is one line after that */
  seen: string;
  /** Plan my day lays tasks out between these (minutes after midnight) */
  dayStart: number;
  dayEnd: number;
  /** the shortcut that opens the Inbox card from any app */
  captureShortcut: string;
}

export const DEFAULT_CAPTURE_SHORTCUT = 'CommandOrControl+Alt+J';

export function defaultTodaySettings(): TodaySettings {
  return { cards: null, seen: '', dayStart: 9 * 60, dayEnd: 17 * 60 + 30, captureShortcut: DEFAULT_CAPTURE_SHORTCUT };
}

const CARD_IDS = TODAY_CARDS.map((c) => c.id);
const isCard = (x: unknown): x is TodayCardId => CARD_IDS.includes(x as TodayCardId);
const minutes = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(24 * 60, Math.round(v))) : d);

/** Bad or missing values fall back to the defaults; the working day is at least an hour long. */
export function normalizeToday(raw: unknown): TodaySettings {
  const d = defaultTodaySettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const cards = Array.isArray(r.cards) ? [...new Set(r.cards.filter(isCard))] : null;
  let dayStart = minutes(r.dayStart, d.dayStart);
  let dayEnd = minutes(r.dayEnd, d.dayEnd);
  if (dayEnd - dayStart < 60) { dayStart = d.dayStart; dayEnd = d.dayEnd; }
  return {
    cards,
    seen: typeof r.seen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.seen) ? r.seen : '',
    dayStart,
    dayEnd,
    captureShortcut: typeof r.captureShortcut === 'string' ? r.captureShortcut : d.captureShortcut,
  };
}

/** The cards Today draws: the person's own or the preset's, without those whose part is off. */
export function todayCards(s: Pick<TodaySettings, 'cards'>, preset: string | undefined, on: (feature: string) => boolean): TodayCardId[] {
  const list = s.cards ?? TODAY_SIZES[sizeForPreset(preset)];
  return list.filter((id) => on(TODAY_CARDS.find((c) => c.id === id)!.feature));
}

/** Shows or hides one card, keeping the others where they are (a hidden card comes back in its usual place). */
export function setCardShown(current: TodayCardId[], id: TodayCardId, shown: boolean): TodayCardId[] {
  if (!shown) return current.filter((c) => c !== id);
  if (current.includes(id)) return current;
  return CARD_IDS.filter((c) => c === id || current.includes(c));
}

/** How wide each card is on a 12-column row: up to three share one row; more put Now and the tasks on top, the small ones under. */
export function cardSpan(cards: TodayCardId[], id: TodayCardId): number {
  if (cards.length <= 3) return 12 / Math.max(1, cards.length);
  const wide: TodayCardId[] = cards.filter((c) => c === 'now' || c === 'tasks');
  const small: TodayCardId[] = cards.filter((c) => c !== 'now' && c !== 'tasks');
  const row = wide.includes(id) ? wide : small;
  return Math.max(3, Math.floor(12 / Math.max(1, row.length)));
}

// ---------------------------------------------------------------- what is on

export interface NowNext {
  /** the timed event going on now (one with a video link first) */
  now?: AgendaItem;
  /** the next timed event that has not started */
  next?: AgendaItem;
  /** all-day events today */
  allDay: AgendaItem[];
  /** timed events later than `next` that are not shown */
  later: number;
}

export function nowNext(items: AgendaItem[], now: number): NowNext {
  const timed = items.filter((i) => !i.allDay && i.end > now).sort((a, b) => a.start - b.start);
  const current = timed.filter((i) => i.start <= now).sort((a, b) => Number(!!b.join) - Number(!!a.join) || b.start - a.start)[0];
  const upcoming = timed.filter((i) => i.start > now);
  return { now: current, next: upcoming[0], allDay: items.filter((i) => i.allDay), later: Math.max(0, upcoming.length - 1) };
}

/** "20 min left", "1 h 5 min left". */
export function timeLeft(end: number, now: number): string {
  const m = Math.max(1, Math.ceil((end - now) / 60_000));
  if (m < 60) return `${m} min left`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min left` : `${h} h left`;
}

/** "in 25 min", "in 2 h", "in 1 h 10 min". */
export function startsIn(start: number, now: number): string {
  const m = Math.max(1, Math.ceil((start - now) / 60_000));
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `in ${h} h ${m % 60} min` : `in ${h} h`;
}

// ---------------------------------------------------------------- tasks

/**
 * The three tasks that matter most today: important ones first, then the
 * person's own order (what the Planner shows). Carried-over tasks count as today's.
 */
export function topTasks(tasks: Task[], today: string, n = 3): Task[] {
  return todayTasks(tasks, today).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || compareTasks(a, b)).slice(0, n);
}

// ---------------------------------------------------------------- Mail's strip

/** Mail's Today strip is one line once Today has been seen on Hello today. */
export function mailStripCompact(seen: string | undefined, today: string): boolean {
  return !!seen && seen === today;
}

// ---------------------------------------------------------------- words

export const replyLine = (n: number) => (n === 1 ? '1 message waits for your reply' : `${n} messages wait for your reply`);

/** The kicker over Today: "Wednesday 4 November". */
export function todayKicker(now: number, locale?: string): string {
  return new Date(now).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
}
