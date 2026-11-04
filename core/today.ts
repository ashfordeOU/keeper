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

export type TodayCardId = 'now' | 'tasks' | 'reply' | 'inbox' | 'fixit' | 'focus' | 'followup' | 'backup' | 'recap' | 'onthisday';

export interface TodayCardDef {
  id: TodayCardId;
  name: string;
  description: string;
  /** shown only while this part is on */
  feature: string;
  /** shown only while it has something to say; otherwise it takes no room */
  quiet?: boolean;
}

export const TODAY_CARDS: TodayCardDef[] = [
  { id: 'now', name: 'Now and next', description: 'What is on now and what comes next, with Join for calls.', feature: 'calendars' },
  { id: 'tasks', name: 'Top three tasks', description: 'The three tasks for today that matter most.', feature: 'calendars' },
  { id: 'reply', name: 'Waiting for a reply', description: 'How many messages wait for your answer.', feature: 'mail' },
  { id: 'inbox', name: 'Inbox to sort', description: 'Things you caught with the Inbox shortcut.', feature: 'captureInbox' },
  { id: 'fixit', name: 'One thing to fix', description: 'The most useful item from the Fix-it List.', feature: 'guide' },
  { id: 'focus', name: 'Focus', description: 'Start a focus session on your top task.', feature: 'focus' },
  { id: 'followup', name: 'Follow-ups', description: 'Mail you sent that still waits for an answer, past your follow-up days.', feature: 'mail', quiet: true },
  { id: 'backup', name: 'Backups', description: 'Shown when a backup is late or went wrong, with Fix.', feature: 'sync', quiet: true },
  { id: 'recap', name: 'Your week', description: 'Tasks done, focus time and your streak this week.', feature: 'insights' },
  { id: 'onthisday', name: 'On this day', description: 'Photos and journal entries from this day in earlier years.', feature: 'library', quiet: true },
];

/** Cards that only show when they have something to say (a late backup, a follow-up due, a photo from last year). */
export const QUIET_CARDS = TODAY_CARDS.filter((c) => c.quiet).map((c) => c.id);

/** How much Today shows: a calm three, the usual five, or all six. */
export type TodaySize = 'simple' | 'standard' | 'full';

export const TODAY_SIZES: Record<TodaySize, TodayCardId[]> = {
  simple: ['now', 'tasks', 'focus'],
  standard: ['now', 'tasks', 'reply', 'inbox', 'fixit', 'followup', 'backup'],
  full: ['now', 'tasks', 'reply', 'inbox', 'fixit', 'focus', 'followup', 'backup', 'recap', 'onthisday'],
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

/** The cards to draw now: a quiet card only while it has something to say (`has`). */
export function visibleCards(cards: TodayCardId[], has: Partial<Record<TodayCardId, boolean>>): TodayCardId[] {
  return cards.filter((c) => !QUIET_CARDS.includes(c) || has[c] === true);
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

// ---------------------------------------------------------------- the quieter cards

/** A backup worth a word on Today: one that went wrong, or has not run for longer than it should. */
export interface BackupNote { id: string; name: string; line: string; late: boolean }

const DAY = 86_400_000;

/** How long is too long without a backup: a day and a half for daily ones, nine days for weekly, else a week. */
export function backupLateAfter(schedule: unknown): number {
  const kind = typeof schedule === 'string' ? schedule : (schedule as { kind?: string } | undefined)?.kind;
  if (kind === 'hourly') return DAY / 2;
  if (kind === 'daily') return DAY * 1.5;
  if (kind === 'weekly') return DAY * 9;
  return DAY * 7;
}

/** "3 days ago", "yesterday", "today". */
export function daysAgo(t: number, now: number): string {
  const d = Math.floor((now - t) / DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

/** The backup most worth a word: one that failed first, then the latest one; none when all are fine. */
export function backupNote(jobs: { id: string; name: string; schedule: unknown; created: number; lastRun?: number; lastOk?: boolean; paused?: boolean; state?: string }[], now: number): BackupNote | undefined {
  const notes = jobs.filter((j) => !j.paused && j.state !== 'running').flatMap((j): (BackupNote & { at: number; bad: number })[] => {
    if (j.lastRun && j.lastOk === false) return [{ id: j.id, name: j.name, line: `Last backup went wrong ${daysAgo(j.lastRun, now)}`, late: true, at: j.lastRun, bad: 2 }];
    const since = j.lastRun ?? j.created;
    if (now - since > backupLateAfter(j.schedule)) return [{ id: j.id, name: j.name, line: j.lastRun ? `Last backup ${daysAgo(j.lastRun, now)}` : 'Not backed up yet', late: true, at: since, bad: 1 }];
    return [];
  });
  const top = notes.sort((a, b) => b.bad - a.bad || a.at - b.at)[0];
  return top ? { id: top.id, name: top.name, line: top.line, late: top.late } : undefined;
}

/** Files made on this day (month and day) in earlier years, newest year first: photos for On this day. */
export function onThisDayFiles<F extends { btime: number; mtime: number; screenshot?: boolean }>(files: F[], now: number, n = 6): F[] {
  const d = new Date(now);
  const year = d.getFullYear();
  const same = (t: number) => { const x = new Date(t); return x.getMonth() === d.getMonth() && x.getDate() === d.getDate() && x.getFullYear() < year; };
  return files.filter((f) => !f.screenshot && same(f.btime || f.mtime)).sort((a, b) => (b.btime || b.mtime) - (a.btime || a.mtime)).slice(0, n);
}

/** "A year ago", "2 years ago". */
export function yearsAgo(t: number, now: number): string {
  const y = new Date(now).getFullYear() - new Date(t).getFullYear();
  return y <= 1 ? 'A year ago' : `${y} years ago`;
}

/** The week in a line: "6 tasks done · 2 h 30 min focused · 4 days in a row". */
export function recapLine(week: { tasks: number; focusMin: number }, streak: number): string {
  const parts: string[] = [];
  parts.push(week.tasks === 1 ? '1 task done' : `${week.tasks} tasks done`);
  const h = Math.floor(week.focusMin / 60);
  const m = Math.round(week.focusMin % 60);
  parts.push(week.focusMin < 1 ? 'no focus time yet' : h ? `${h} h${m ? ` ${m} min` : ''} focused` : `${m} min focused`);
  if (streak > 1) parts.push(`${streak} days in a row`);
  return parts.join(' · ');
}

/** Follow-ups: "2 sent messages wait for an answer". */
export const followUpLine = (n: number) => (n === 1 ? '1 message you sent waits for an answer' : `${n} messages you sent wait for an answer`);
