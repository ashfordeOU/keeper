// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail, calendars, reminders, alarms and contacts, as the interface sees them.

import type { MailConfig } from './pim/autoconfig';
import type { Draft, MailRule } from './pim/mail';
import type { QuickEvent } from './pim/quickadd';
import type { Account, Address, Alarm, Attachment, CalEvent, CalendarInfo, Contact, CountdownTimer, MailFolder, MessageSummary, Occurrence, Reminder, Thread, WorldClock } from './pim/types';
import type { PimPrefsView } from './pim/prefs';
import type { SystemAccess } from './pim/syscal';

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
  /** a folder path, or 'unified' for every inbox */
  folder: string;
  query?: string;
  filter?: 'all' | 'unread' | 'flagged' | 'attachments';
  threaded?: boolean;
}

export interface Outbox {
  id: string;
  sendAt: number;
  subject: string;
  error?: string;
}

export type Ring =
  | { kind: 'alarm' | 'reminder' | 'timer'; id: string; title: string; at: number; late: boolean }
  | { kind: 'event'; id: string; title: string; at: number; late: boolean; start: number; location?: string; url?: string };

export interface PimApi {
  accounts(): Promise<(Account & { needsSignIn?: boolean; secretIn?: 'keychain' | 'memory' })[]>;
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
  messages(v: MailView): Promise<{ messages: MessageSummary[]; threads?: Thread[] }>;
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
  ai(id: string, task: 'summarize' | 'reply' | 'extract'): Promise<{ text: string; events?: QuickEvent[] }>;
  respond(id: string, status: 'accepted' | 'declined' | 'tentative'): Promise<void>;
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

  reminders(): Promise<Reminder[]>;
  saveReminder(r: Reminder): Promise<Reminder>;
  deleteReminder(id: string): Promise<void>;

  alarms(): Promise<{ alarms: Alarm[]; timers: CountdownTimer[]; clocks: WorldClock[]; next?: number }>;
  saveAlarm(a: Alarm): Promise<Alarm>;
  deleteAlarm(id: string): Promise<void>;
  snoozeAlarm(id: string): Promise<void>;
  stopRinging(id: string): Promise<void>;
  startTimer(label: string, ms: number): Promise<CountdownTimer>;
  timerAction(id: string, action: 'pause' | 'resume' | 'cancel' | 'restart'): Promise<void>;
  saveClocks(c: WorldClock[]): Promise<void>;
  /** ask the system to wake the computer for an alarm (macOS; asks for an administrator) */
  scheduleWake(id: string): Promise<{ ok: boolean; message: string }>;

  contacts(): Promise<Contact[]>;
  saveContact(c: Contact): Promise<Contact>;
  deleteContact(id: string): Promise<void>;

  prefs(): Promise<PimPrefsView>;
  setPrefs(p: Partial<PimPrefsView>): Promise<PimPrefsView>;
}
