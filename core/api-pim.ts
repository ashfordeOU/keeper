// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail, calendars, reminders, alarms and contacts, as the interface sees them.

import type { MailConfig } from './pim/autoconfig';
import type { Draft, MailRule } from './pim/mail';
import type { QuickEvent } from './pim/quickadd';
import type { Account, Address, Alarm, Attachment, CalEvent, CalendarInfo, Contact, CountdownTimer, MailFolder, MessageSummary, Occurrence, Reminder, Thread, WorldClock } from './pim/types';
import type { PimPrefsView } from './pim/prefs';
import type { Insights } from './pim/insights';
import type { SystemAccess } from './pim/syscal';
import type { CalendarStatus, UpcomingEvent } from './pim/week-events';

export interface NewAccount {
  kind: 'imap' | 'caldav' | 'ics' | 'google' | 'microsoft';
  email?: string;
  name?: string;
  label?: string;
  password?: string;
  imap?: MailConfig['imap'];
  smtp?: MailConfig['smtp'];
  caldav?: string;
  carddav?: string;
  /** user name for CalDAV when it differs from the address */
  davUser?: string;
  insecureTls?: boolean;
  mail?: boolean;
  calendar?: boolean;
  contacts?: boolean;
}

export interface OpenMessage {
  summary: MessageSummary;
  /** sanitized HTML (or text turned into HTML) */
  html: string;
  text?: string;
  /** remote pictures held back */
  blocked: number;
  trackers: number;
  attachments: Attachment[];
  invite?: { method: string; event: CalEvent; mine?: string };
  unsubscribe?: { mailto?: string; url?: string; oneClick?: boolean };
  headers: Record<string, string>;
}

export interface MailView {
  account?: string;
  /**
   * a folder path, or a view across accounts: 'unified' (every inbox),
   * 'unified:sent' (every Sent folder), 'snoozed', or 'search' (every folder
   * kept on this computer)
   */
  folder: string;
  /** an inbox's Important or Other half */
  split?: 'important' | 'other';
  query?: string;
  filter?: 'all' | 'unread' | 'flagged' | 'attachments';
  threaded?: boolean;
}

export interface Outbox {
  id: string;
  sendAt: number;
  subject: string;
  error?: string;
  /** a time chosen with Send later (rather than the few seconds to undo) */
  scheduled?: boolean;
}

/** Sent mail with no answer yet. */
export interface WaitingItem {
  message: MessageSummary;
  /** whole days since it was sent */
  days: number;
  to: Address[];
  /** messages in the conversation */
  count: number;
  /** older than the follow-up time set in Settings */
  overdue: boolean;
}

export interface SubscriptionItem {
  key: string;
  name: string;
  address: string;
  count: number;
  opened: number;
  last: number;
  canUnsubscribe: boolean;
  neverOpened: boolean;
}

export type MailAiTask = 'summarize' | 'reply' | 'replies' | 'extract' | 'translate';
export type WriteTask = 'shorter' | 'friendly' | 'professional' | 'proofread' | 'translate';

export type Ring =
  | { kind: 'alarm' | 'reminder' | 'timer'; id: string; title: string; at: number; late: boolean }
  | { kind: 'event'; id: string; title: string; at: number; late: boolean; start: number; location?: string; url?: string };

export interface DueReminder {
  id: string;
  title: string;
  at: number;
}

export interface PimApi {
  /** lastChecked: when mail or calendars were last fetched without trouble; lastError: the last failure since then */
  accounts(): Promise<(Account & { needsSignIn?: boolean; secretIn?: 'keychain' | 'memory'; lastChecked?: number; lastError?: string })[]>;
  discover(email: string): Promise<MailConfig>;
  testAccount(a: NewAccount): Promise<{ ok: boolean; message: string }>;
  addAccount(a: NewAccount): Promise<Account>;
  /** Google / Microsoft: opens the browser to sign in, then adds the account */
  signIn(provider: 'google' | 'microsoft', email?: string, opts?: { calendarOnly?: boolean }): Promise<Account>;
  cancelSignIn(): Promise<void>;
  updateAccount(id: string, patch: Partial<Account>): Promise<Account>;
  removeAccount(id: string): Promise<void>;
  oauthReady(): Promise<{ google: boolean; microsoft: boolean }>;

  folders(): Promise<MailFolder[]>;
  messages(v: MailView): Promise<{ messages: MessageSummary[]; threads?: Thread[]; counts?: { important: number; other: number } }>;
  /** the servers' own search, for mail older than what is kept here (local results come from messages({ folder: 'search' })) */
  searchServer(query: string, account?: string): Promise<MessageSummary[]>;
  /** sent mail without an answer, newest first */
  waiting(): Promise<WaitingItem[]>;
  /** a follow-up to an unanswered message, ready to send */
  followUp(id: string): Promise<Draft & { account: string }>;
  dismissWaiting(id: string): Promise<void>;
  /** newsletters and lists, the ones never opened first */
  subscriptions(): Promise<SubscriptionItem[]>;
  /** unsubscribe from a sender and/or archive (or delete) everything from it */
  cleanup(key: string, action: 'unsubscribe' | 'archive' | 'both' | 'trash'): Promise<{ how: string; moved: number }>;
  /** always put this sender's mail in Important or Other */
  setCategory(address: string, category: 'important' | 'other'): Promise<void>;
  unsnooze(ids: string[]): Promise<void>;
  /** AI help with a piece of writing (the compose window) */
  write(text: string, task: WriteTask, lang?: string): Promise<string>;
  /** a question answered from your mail, with the messages it used */
  askMail(question: string): Promise<{ answer: string; sources: MessageSummary[] }>;
  refresh(account?: string, folder?: string): Promise<void>;
  older(account: string, folder: string): Promise<void>;
  open(id: string, opts?: { allowRemote?: boolean; markRead?: boolean }): Promise<OpenMessage>;
  setRead(ids: string[], read: boolean): Promise<void>;
  setFlagged(ids: string[], flagged: boolean): Promise<void>;
  move(ids: string[], folder: string): Promise<void>;
  archive(ids: string[]): Promise<void>;
  trash(ids: string[]): Promise<void>;
  junk(ids: string[]): Promise<void>;
  snooze(ids: string[], until: number): Promise<void>;
  saveAttachment(id: string, attachment: string, to?: string): Promise<string | null>;
  openAttachment(id: string, attachment: string): Promise<void>;
  unsubscribe(id: string): Promise<{ done: boolean; how: string }>;
  trustSender(address: string): Promise<void>;
  /** the reply or forward, filled in */
  draftFor(id: string, mode: 'reply' | 'replyAll' | 'forward'): Promise<Draft>;
  send(d: Draft & { account: string; sendAt?: number; markdown?: boolean }): Promise<Outbox>;
  undoSend(id: string): Promise<Draft | null>;
  outbox(): Promise<Outbox[]>;
  saveDraft(d: Draft & { account: string }): Promise<void>;
  suggest(q: string): Promise<Address[]>;
  /** AI on a conversation, with the AI chosen in Settings → AI & Brain */
  ai(id: string, task: MailAiTask, opts?: { lang?: string }): Promise<{ text: string; events?: QuickEvent[]; options?: string[] }>;
  /** sent: a reply went to the organiser (false when the account has no outgoing mail server) */
  respond(id: string, status: 'accepted' | 'declined' | 'tentative'): Promise<{ sent: boolean } | void>;
  rules(): Promise<MailRule[]>;
  saveRules(r: MailRule[]): Promise<void>;
  pickFiles(): Promise<string[]>;

  calendars(): Promise<CalendarInfo[]>;
  setCalendar(id: string, patch: Partial<Pick<CalendarInfo, 'visible' | 'color' | 'name' | 'island'>>): Promise<void>;
  occurrences(from: number, to: number): Promise<Occurrence[]>;
  saveEvent(e: CalEvent, opts?: { scope?: 'this' | 'all'; instance?: number }): Promise<CalEvent>;
  deleteEvent(id: string, opts?: { scope?: 'this' | 'all'; instance?: number }): Promise<void>;
  quickAdd(text: string, calendar?: string): Promise<CalEvent | null>;
  parseQuick(text: string): Promise<QuickEvent | null>;
  subscribe(url: string, name?: string): Promise<CalendarInfo>;
  importIcs(path?: string, calendar?: string): Promise<number>;
  exportIcs(calendar: string): Promise<string | null>;
  syncCalendars(): Promise<void>;
  /** this computer's own calendars: may Keeper read them (request: ask the system now) */
  systemAccess(request?: boolean): Promise<SystemAccess>;
  /** a calendar is on screen (the Island's Calendar tab, the Calendar page): look for changes every minute */
  watchCalendar(visible: boolean): Promise<void>;
  /** opens an event where it lives (the Calendar app, the provider's page) or in Keeper's calendar */
  openEvent(id: string, instance?: number): Promise<void>;
  /**
   * Stable for other pages: every visible calendar's events from `from` to `to`
   * (this computer's own through EventKit and the others, Google, Microsoft,
   * CalDAV, .ics links, holidays), in time order, each with its place, join
   * link and source. withLocation keeps only events that have a place.
   */
  upcomingEvents(from: number, to: number, opts?: { withLocation?: boolean; limit?: number }): Promise<UpcomingEvent[]>;
  /**
   * Stable for other pages, and cheap (nothing is fetched): per source whether
   * it is connected and may be read, the computer's own access (on a Mac
   * `system.raw` is EventKit's authorization state), and the "Keeper can't see
   * your calendars yet" row to show, if any.
   */
  calendarStatus(): Promise<CalendarStatus>;
  /** opens the main window on where calendars are connected (Google, Outlook, CalDAV) */
  openCalendarSources(): Promise<void>;

  reminders(): Promise<Reminder[]>;
  /** saves a task; checking off a repeating one rolls it on to its next date */
  saveReminder(r: Reminder): Promise<Reminder>;
  deleteReminder(id: string): Promise<void>;
  /** checks a task off (or opens it again); a repeating one rolls on */
  completeReminder(id: string, done?: boolean): Promise<Reminder | null>;
  /** a due reminder comes back in this many minutes */
  snoozeReminder(id: string, minutes: number): Promise<void>;
  /** moves tasks to a day (yyyy-mm-dd), or to the Inbox with null */
  moveTasks(ids: string[], day: string | null): Promise<void>;
  /** the person's own order (drag to reorder) */
  reorderTasks(order: { id: string; order: number }[]): Promise<void>;
  /** tasks finished and focus minutes, today and this week, and the busiest hours */
  insights(): Promise<Insights>;
  /** reminders ringing right now (the Island shows them until Done or Snooze) */
  dueReminders(): Promise<DueReminder[]>;

  alarms(): Promise<{ alarms: Alarm[]; timers: CountdownTimer[]; clocks: WorldClock[]; next?: number }>;
  saveAlarm(a: Alarm): Promise<Alarm>;
  deleteAlarm(id: string): Promise<void>;
  snoozeAlarm(id: string): Promise<void>;
  stopRinging(id: string): Promise<void>;
  startTimer(label: string, ms: number): Promise<CountdownTimer>;
  /** extend: one more minute */
  timerAction(id: string, action: 'pause' | 'resume' | 'cancel' | 'restart' | 'extend'): Promise<void>;
  saveClocks(c: WorldClock[]): Promise<void>;
  /** ask the system to wake the computer for an alarm (macOS; asks for an administrator) */
  scheduleWake(id: string): Promise<{ ok: boolean; message: string }>;

  contacts(): Promise<Contact[]>;
  saveContact(c: Contact): Promise<Contact>;
  deleteContact(id: string): Promise<void>;

  prefs(): Promise<PimPrefsView>;
  setPrefs(p: Partial<PimPrefsView>): Promise<PimPrefsView>;
}
