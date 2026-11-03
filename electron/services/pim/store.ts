// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where mail, calendars, reminders and alarms are kept on this computer:
// small JSON files in Keeper's data folder, written one at a time through a
// temporary file. Passwords and sign-in tokens go to the system keychain.

import { app } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { LogEntry } from '../../../core/pim/insights';
import type { Draft, MailRule } from '../../../core/pim/mail';
import type { MailTemplate } from '../../../core/pim/compose-rich';
import type { SmartMailbox } from '../../../core/pim/prefs';
import type { NoReplyReminder } from '../../../core/pim/smart';
import type { SnoozeEntry } from '../../../core/pim/snooze-sync';
import type { Account, Alarm, CalEvent, CalendarInfo, Contact, CountdownTimer, MessageSummary, Reminder, WorldClock } from '../../../core/pim/types';
import { KeychainLockedError } from '../../../core/keychain';
import { getSecret, secretLocked, setSecret } from '../../store';

// KEEPER_PIM_DIR lets the tests run the mail and calendar code outside Electron.
export const pimDir = () => process.env.KEEPER_PIM_DIR ?? path.join(app.getPath('userData'), 'pim');
export const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

export interface PimPrefs {
  /** show who wrote and the subject in notifications */
  notifyPreviews: boolean;
  /** notify about new mail at all */
  notifyMail: boolean;
  /** seconds a sent message waits so it can be taken back */
  undoSendSec: number;
  /** load remote pictures from these senders without asking */
  trustedSenders: string[];
  /** where "Save attachment" puts files by default */
  attachmentsFolder?: string;
  /** default minutes before events for a new event's alert */
  defaultAlertMin: number;
  /** first day of the week in calendar views (0 = Sunday) */
  weekStart: number;
  showWeekNumbers: boolean;
  /** the calendar new events go into */
  defaultCalendar?: string;
  /** read this computer's own calendars (on unless false) */
  systemCalendars?: boolean;
  /** public holidays of this country as a calendar ('' = none; unset = chosen from the system's region once) */
  holidayCountry?: string;
  /** a birthdays calendar made from contacts (on unless false) */
  birthdays?: boolean;
  /** Google and Microsoft OAuth client IDs (overrides the ones built in) */
  clients?: { google?: string; googleSecret?: string; microsoft?: string };
  /** sort inboxes into Important and Other (on unless false) */
  splitInbox?: boolean;
  /** which new mail drops down from the Island: Important only (default), all, or none */
  islandMail?: 'important' | 'all' | 'off';
  /** senders moved to Important or Other by hand (lower case) */
  importantSenders?: string[];
  otherSenders?: string[];
  /** sent mail unanswered for this many days is called out in Waiting for reply (default 3) */
  followUpDays?: number;
  /** the reading layout: list beside the message, or a wide list with bulk actions */
  mailLayout?: 'split' | 'wide';
  /** keyboard shortcuts: which set, and the person's own changes ("action": "key, key") */
  shortcutScheme?: 'gmail' | 'apple' | 'superhuman';
  shortcutOverrides?: Record<string, string>;
  /** keep the newest inbox messages' text on this computer for reading offline (on unless false) */
  offlineBodies?: boolean;
  /** the number on the Dock or taskbar icon: unread inbox mail, only Important, or none */
  dockBadge?: 'all' | 'important' | 'off';
  /** designed mail (newsletters, receipts) in dark mode: on a light card as made ('card', default) or darkened like the rest ('dark') */
  darkMail?: 'card' | 'dark';
  /** reading text size in pixels (⌘+ / ⌘−) */
  mailTextSize?: number;
  /** how close together the list's rows are */
  mailDensity?: 'compact' | 'comfortable' | 'roomy';
  /** only these senders drop down from the notch (addresses, @domains; empty = everyone) */
  notchSenders?: string[];
  /** senders whose mail goes straight to Junk (addresses, @domains) */
  blockedSenders?: string[];
  /** facts the person keeps for the AI ("I sign as Ana", "my team is …"); sent with AI requests */
  aiMemory?: string[];
  /** saved replies and messages */
  templates?: MailTemplate[];
  /** saved searches shown as mailboxes */
  smartMailboxes?: SmartMailbox[];
  /** the sign-in code or magic link in new mail: a Copy / Open button on its notification and in the Island (on unless false) */
  codeActions?: boolean;
}

export interface QueuedMail {
  id: string;
  account: string;
  sendAt: number;
  /** the composed message, ready to send */
  raw: string;
  envelope: { from: string; to: string[] };
  subject: string;
  error?: string;
  /** what was written, so "Undo" can bring it back */
  draft?: Draft;
  /** when Send was pressed */
  queuedAt?: number;
  /** a time chosen with Send later (not just the undo pause) */
  scheduled?: boolean;
}

/** A change made while the server could not be reached, tried again later. */
export type PendingOp =
  | { kind: 'flag'; account: string; folder: string; uids: number[]; flag: string; on: boolean }
  | { kind: 'move'; account: string; folder: string; uids: number[]; dest: string }
  | { kind: 'remove'; account: string; folder: string; uids: number[]; trash?: string };

export interface PimState {
  calendars: CalendarInfo[];
  alarms: Alarm[];
  timers: CountdownTimer[];
  clocks: WorldClock[];
  reminders: Reminder[];
  rules: MailRule[];
  outbox: QueuedMail[];
  /** alerts already shown (kind:id:at), kept for two days */
  fired: { key: string; at: number }[];
  /** recent addresses written to, for suggestions */
  recent: { name?: string; address: string; at: number }[];
  prefs: PimPrefs;
  /** calendar links from the Island's old "calendar link" setting already added as subscriptions */
  islandUrls?: string[];
  /** Insights: tasks finished and focus sessions (core/pim/insights.ts) */
  log?: LogEntry[];
  /** one-time moves already made (the Island's own to-dos onto the task list) */
  migrated?: { islandTodos?: boolean };
  /** snoozed messages and when they come back */
  snoozes?: { id: string; until: number }[];
  /** sent messages taken off Waiting for reply */
  waitingDismissed?: string[];
  /** changes made offline, waiting for the server */
  pendingOps?: PendingOp[];
  /** "Remind me if no reply": sent messages to bring back when nobody answered */
  noReply?: NoReplyReminder[];
  /** muted conversations (Message-IDs): new mail in them skips the inbox */
  muted?: string[];
  /** messages taken off To Reply */
  toReplyDismissed?: string[];
  /** snoozes shared with the person's other computers (core/pim/snooze-sync.ts) */
  snoozeSync?: SnoozeEntry[];
  /** Gmail filters Keeper made, per account, and the last result of writing rules to each server */
  gmailFilters?: Record<string, string[]>;
  serverRules?: Record<string, { ok: boolean; message: string; at: number }>;
  /** drafts mirrored to the server: compose id → its Message-ID there */
  draftIds?: Record<string, string>;
}

const DEFAULT_PREFS: PimPrefs = { notifyPreviews: true, notifyMail: true, undoSendSec: 10, trustedSenders: [], defaultAlertMin: 10, weekStart: 1, showWeekNumbers: false };

export function emptyState(): PimState {
  return { calendars: [], alarms: [], timers: [], clocks: [], reminders: [], rules: [], outbox: [], fired: [], recent: [], prefs: { ...DEFAULT_PREFS } };
}

let writing: Promise<void> = Promise.resolve();
let seq = 0;

/** Writes JSON safely, one write after another. */
export function writeJson(file: string, data: unknown): Promise<void> {
  writing = writing.then(async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${++seq}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data));
    await fsp.rename(tmp, file);
  }).catch(() => undefined);
  return writing;
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export const files = {
  accounts: () => path.join(pimDir(), 'accounts.json'),
  state: () => path.join(pimDir(), 'state.json'),
  contacts: () => path.join(pimDir(), 'contacts.json'),
  folder: (account: string, folder: string) => path.join(pimDir(), 'mail', hash(account), `${hash(folder)}.json`),
  folders: (account: string) => path.join(pimDir(), 'mail', hash(account), 'folders.json'),
  body: (id: string) => path.join(pimDir(), 'bodies', `${hash(id)}.json`),
  events: (calendar: string) => path.join(pimDir(), 'cal', `${hash(calendar)}.json`),
};

export interface FolderCache {
  uidValidity?: string;
  /** highest uid seen */
  uidNext?: number;
  messages: MessageSummary[];
}

export interface EventCache {
  events: CalEvent[];
  /** how far the cache covers (for calendar-query servers) */
  from?: number;
  to?: number;
}

export async function loadAccounts(): Promise<Account[]> {
  return readJson<Account[]>(files.accounts(), []);
}

export async function saveAccounts(a: Account[]) {
  await writeJson(files.accounts(), a);
}

export async function loadState(): Promise<PimState> {
  const s = await readJson<Partial<PimState>>(files.state(), {});
  const e = emptyState();
  return { ...e, ...s, prefs: { ...e.prefs, ...(s.prefs ?? {}) } };
}

export async function loadContacts(): Promise<Contact[]> {
  return readJson<Contact[]>(files.contacts(), []);
}

// ---------------------------------------------------------------- secrets

// When the system has no keychain (some Linux desktops), secrets live only
// until Keeper quits instead of being written in plain text.
const memory = new Map<string, string>();

/**
 * Passwords kept only in memory (no keychain) are mirrored to Keeper's app when Mail
 * and calendars runs in a process of its own, so a restart of that process does not
 * ask for them again (electron/suite/part.ts). Never written to disk.
 */
let memoryListener: ((all: Record<string, string>) => void) | null = null;
export function onMemorySecrets(fn: (all: Record<string, string>) => void) {
  memoryListener = fn;
}
export function restoreMemorySecrets(all: Record<string, string> | null | undefined) {
  for (const [k, v] of Object.entries(all ?? {})) if (typeof v === 'string' && !memory.has(k)) memory.set(k, v);
}
const memoryChanged = () => memoryListener?.(Object.fromEntries(memory));

export async function putSecret(name: string, value: string): Promise<'keychain' | 'memory'> {
  const ok = await setSecret(`pim.${name}`, value).catch(() => false);
  if (ok) {
    if (memory.delete(name)) memoryChanged();
    return 'keychain';
  }
  memory.set(name, value);
  memoryChanged();
  return 'memory';
}

export async function readSecret(name: string): Promise<string | undefined> {
  return memory.get(name) ?? (await getSecret(`pim.${name}`).catch(() => undefined));
}

/** Throws a "keychain locked" error when the saved secret is there but unreadable (not a wrong password). */
export async function assertSecretReadable(name: string, what: string) {
  if (!memory.has(name) && (await secretLocked(`pim.${name}`).catch(() => false))) throw new KeychainLockedError(process.platform, what);
}

export async function dropSecret(name: string) {
  if (memory.delete(name)) memoryChanged();
  await setSecret(`pim.${name}`, '').catch(() => false);
}
