// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The top of Mail's inbox, worked out without the interface: a greeting for
// the time of day with your first name (taken from your mail accounts, never
// made up), today's date, today's events as cards (the running one "Now ·
// until 6:45 PM", Join for video meetings), the meeting chip in the title bar,
// the filter chips under the greeting, the list's day groups and times,
// an account's initials and colour, and "Updated 2 minutes ago". Pure.

import { agendaFor, countdown, type AgendaItem } from './agenda';
import { hueOf, initials, type InboxTab } from './smart';
import type { CalendarInfo, MessageSummary, Occurrence } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------- greeting

/** "Good morning" 5–11, "Good afternoon" 12–17, "Good evening" 18–23, "Hello" in the small hours. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  if (hour >= 18) return 'Good evening';
  return 'Hello';
}

/**
 * The first name in the first of these that is a real name ("Ana Lopez" →
 * "Ana"). Addresses and blanks are skipped; with none, there is no name.
 */
export function firstName(names: (string | undefined | null)[]): string | undefined {
  for (const raw of names) {
    const n = (raw ?? '').replace(/["“”'‘’()[\]<>]/g, ' ').trim();
    if (!n || n.includes('@')) continue;
    const word = n.split(/[\s,]+/).find((w) => /\p{L}/u.test(w));
    if (word) return word;
  }
  return undefined;
}

/** "Good evening, Ana" (or just "Good evening"). */
export function greeting(now: number, name?: string): string {
  const g = greetingFor(new Date(now).getHours());
  return name ? `${g}, ${name}` : g;
}

/** "Today is Monday, 2 November" in the person's own date order. */
export function todayLine(now: number, locale?: string): string {
  return `Today is ${new Date(now).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}`;
}

// ---------------------------------------------------------------- today's events

/** Calendars Mail shows events from: every visible one (the Island's own choice is its own; a list of tasks has no events). */
export const inMailToday = (c: CalendarInfo | undefined) => !!c && c.visible;

export interface TodayStrip {
  /** today's events, all-day ones first */
  items: AgendaItem[];
  /** timed events going on now */
  current: AgendaItem[];
  /** the next timed event that has not started */
  next?: AgendaItem;
}

export function todayStrip(occ: Occurrence[], calendars: CalendarInfo[], now: number): TodayStrip {
  const items = agendaFor(occ, calendars, now, now, inMailToday);
  const timed = items.filter((i) => !i.allDay);
  return { items, current: timed.filter((i) => i.now), next: timed.filter((i) => i.start > now).sort((a, b) => a.start - b.start)[0] };
}

export type EventStatus = 'allDay' | 'past' | 'now' | 'next' | 'later';

export function eventStatus(i: AgendaItem, strip: Pick<TodayStrip, 'next'>, now: number): EventStatus {
  if (i.allDay) return 'allDay';
  if (i.end <= now) return 'past';
  if (i.start <= now) return 'now';
  return strip.next?.key === i.key ? 'next' : 'later';
}

/** The line under a card's title: "Now · until 6:45 PM", "in 25 min", "Ended", "All day". */
export function eventNote(i: AgendaItem, now: number, clock: (t: number) => string): string {
  if (i.allDay) return 'All day';
  if (i.end <= now) return 'Ended';
  if (i.start <= now) return `Now · until ${clock(i.end)}`;
  return i.start - now < 3 * HOUR ? countdown(i.start, now) : `${clock(i.start)} – ${clock(i.end)}`;
}

/**
 * The meeting for the title bar: one going on now (one with a video link
 * first), else the next one starting within `withinMin` minutes.
 */
export function chipMeeting(strip: TodayStrip, now: number, withinMin = 15): AgendaItem | undefined {
  const cur = [...strip.current].sort((a, b) => Number(!!b.join) - Number(!!a.join) || b.start - a.start)[0];
  if (cur) return cur;
  return strip.next && strip.next.start - now <= withinMin * MIN ? strip.next : undefined;
}

/** The one line a narrow window shows: "Now: Design review until 6:45 PM" or "Next: Standup at 9:30 AM". */
export function nextLine(strip: TodayStrip, clock: (t: number) => string): string | undefined {
  const cur = strip.current[0];
  if (cur) return `Now: ${cur.title} until ${clock(cur.end)}`;
  if (strip.next) return `Next: ${strip.next.title} at ${clock(strip.next.start)}`;
  return undefined;
}

// ---------------------------------------------------------------- the list

export type DayGroup = 'today' | 'yesterday' | 'week' | 'older';
export const DAY_GROUP_LABEL: Record<DayGroup, string> = { today: 'Today', yesterday: 'Yesterday', week: 'Past week', older: 'Older' };

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const daysBack = (t: number, n: number) => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() - n); return d.getTime(); };

/** Which day heading a message goes under (calendar days, so 11 PM yesterday is Yesterday). */
export function dayGroup(t: number, now: number): DayGroup {
  if (t >= startOfDay(now)) return 'today';
  if (t >= daysBack(now, 1)) return 'yesterday';
  if (t >= daysBack(now, 6)) return 'week';
  return 'older';
}

/** Rows in their order, with a heading wherever the day group changes. */
export function groupByDay<T>(rows: T[], timeOf: (r: T) => number, now: number): { group: DayGroup; label: string; rows: T[] }[] {
  const out: { group: DayGroup; label: string; rows: T[] }[] = [];
  for (const r of rows) {
    const g = dayGroup(timeOf(r), now);
    const last = out[out.length - 1];
    if (last && last.group === g) last.rows.push(r);
    else out.push({ group: g, label: DAY_GROUP_LABEL[g], rows: [r] });
  }
  return out;
}

/**
 * A row's time: "Now", "12 min", "3 h" within a day; then the clock time
 * while the heading names the day (Yesterday, the past week); then the date.
 */
export function listTime(t: number, now: number, clock: (t: number) => string, date: (t: number) => string): string {
  const d = now - t;
  if (d < MIN) return 'Now';
  if (d < HOUR) return `${Math.floor(d / MIN)} min`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h`;
  return dayGroup(t, now) === 'older' ? date(t) : clock(t);
}

/** "Updated just now", "Updated 2 minutes ago", "Updated 3 hours ago". */
export function updatedText(t: number | undefined, now: number): string {
  if (!t) return 'Not checked yet';
  const d = Math.max(0, now - t);
  if (d < MIN) return 'Updated just now';
  if (d < HOUR) { const m = Math.floor(d / MIN); return `Updated ${m} minute${m === 1 ? '' : 's'} ago`; }
  if (d < DAY) { const h = Math.floor(d / HOUR); return `Updated ${h} hour${h === 1 ? '' : 's'} ago`; }
  const days = Math.floor(d / DAY);
  return `Updated ${days} day${days === 1 ? '' : 's'} ago`;
}

/** When mail was last checked: the newest check among the mail accounts. */
export function lastChecked(accounts: { mail?: boolean; lastChecked?: number }[]): number | undefined {
  const ts = accounts.filter((a) => a.mail && a.lastChecked).map((a) => a.lastChecked!);
  return ts.length ? Math.max(...ts) : undefined;
}

// ---------------------------------------------------------------- accounts

/** An account's letters and colour: its own colour if chosen, else one that stays the same for its address. */
export function accountLook(a: { label?: string; email?: string; color?: string; identities?: { name?: string }[] }): { letters: string; color: string } {
  const name = a.identities?.find((i) => i.name)?.name || (a.label && !a.label.includes('@') ? a.label : undefined);
  return { letters: initials({ name, address: a.email ?? a.label ?? '?' }), color: a.color || `hsl(${hueOf((a.email ?? a.label ?? '').toLowerCase())} 52% 40%)` };
}

/** A label's colour, the same every time. */
export const labelColor = (label: string) => `hsl(${hueOf(label.toLowerCase())} 58% 50%)`;

// ---------------------------------------------------------------- filter chips

export type ChipId = 'inbox' | 'important' | 'updates' | 'promos' | 'security' | 'toreply' | 'flagged' | 'attachments';

export interface ChipDef {
  id: ChipId;
  label: string;
  icon: string;
  /** the tooltip */
  hint: string;
  /** shown with its name, not only its icon */
  text?: boolean;
  /** needs the inbox sorted into Important and Other */
  split?: boolean;
}

export const CHIPS: ChipDef[] = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox', hint: 'Everything in your inboxes', text: true },
  { id: 'important', label: 'Primary', icon: 'star', hint: 'Mail from people, replies to you and security mail', text: true, split: true },
  { id: 'updates', label: 'Updates', icon: 'info', hint: 'Receipts, orders, bills and notifications', split: true },
  { id: 'promos', label: 'Promotions', icon: 'coin', hint: 'Offers and newsletters', split: true },
  { id: 'security', label: 'Security', icon: 'shield', hint: 'Sign-in alerts, codes and password resets' },
  { id: 'toreply', label: 'To Reply', icon: 'reply', hint: 'Mail from people waiting for your answer' },
  { id: 'flagged', label: 'Flagged', icon: 'flag', hint: 'Flagged mail in your inboxes' },
  { id: 'attachments', label: 'Attachments', icon: 'paperclip', hint: 'Mail with files attached' },
];

/** The chips this inbox offers: Primary, Updates and Promotions only when the inbox is sorted. */
export const chipsFor = (split: boolean) => CHIPS.filter((c) => split || !c.split);

/** What a chip shows, in terms of the list Mail already asks for (the account chosen stays). */
export interface ChipView {
  folder: 'unified' | 'toreply';
  tab?: InboxTab;
  filter: 'all' | 'flagged' | 'attachments';
  /** narrowed further here (security mail is in Primary already) */
  only?: 'security';
}

export function chipView(id: ChipId, split: boolean): ChipView {
  const all: InboxTab | undefined = split ? 'all' : undefined;
  switch (id) {
    case 'important': case 'updates': case 'promos': return { folder: 'unified', tab: split ? id : undefined, filter: 'all' };
    case 'security': return { folder: 'unified', tab: all, filter: 'all', only: 'security' };
    case 'toreply': return { folder: 'toreply', filter: 'all' };
    case 'flagged': case 'attachments': return { folder: 'unified', tab: all, filter: id };
    default: return { folder: 'unified', tab: all, filter: 'all' };
  }
}

/**
 * The chip a view is: every inbox or one account's, To Reply; none for any
 * other folder. Unread only is a switch of its own, so it keeps the chip.
 */
export function chipOf(v: { folder: string; tab?: InboxTab; filter?: string; only?: 'security' }): ChipId | undefined {
  if (v.folder === 'toreply') return 'toreply';
  if (v.folder !== 'unified' && v.folder.toUpperCase() !== 'INBOX') return undefined;
  if (v.only === 'security') return 'security';
  if (v.filter === 'flagged' || v.filter === 'attachments') return v.filter;
  if (v.tab === 'important' || v.tab === 'updates' || v.tab === 'promos') return v.tab;
  return 'inbox';
}

/** The unread number on a chip, where Mail knows it. */
export function chipCount(id: ChipId, counts: { all?: number; important?: number; updates?: number; promos?: number } | undefined, inboxUnread: number): number | undefined {
  const n = id === 'inbox' ? counts?.all ?? inboxUnread : id === 'important' || id === 'updates' || id === 'promos' ? counts?.[id] : undefined;
  return n || undefined;
}

export const chipKeeps = (m: Pick<MessageSummary, 'security'>, only: ChipView['only']) => (only === 'security' ? !!m.security : true);

/**
 * Each label on these messages with how many carry it and how many are
 * unread, a message kept in two folders (Gmail's All Mail and Inbox) counted
 * once; most used first.
 */
export function labelCounts(list: Pick<MessageSummary, 'id' | 'messageId' | 'labels' | 'seen'>[]): { name: string; count: number; unread: number }[] {
  const by = new Map<string, { name: string; count: number; unread: number; seen: Set<string> }>();
  for (const m of list) {
    for (const raw of m.labels ?? []) {
      const name = raw.trim();
      if (!name) continue;
      const k = name.toLowerCase();
      const e = by.get(k) ?? { name, count: 0, unread: 0, seen: new Set<string>() };
      const id = m.messageId ?? m.id;
      if (e.seen.has(id)) continue;
      e.seen.add(id);
      e.count++;
      if (!m.seen) e.unread++;
      by.set(k, e);
    }
  }
  return [...by.values()].map(({ name, count, unread }) => ({ name, count, unread })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
