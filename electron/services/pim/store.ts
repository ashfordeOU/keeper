// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where mail, calendars, reminders and alarms are kept on this computer:
// small JSON files in Keeper's data folder, written one at a time through a
// temporary file. Passwords and sign-in tokens go to the system keychain.

import { app } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { Draft, MailRule } from '../../../core/pim/mail';
import type { Account, Alarm, CalEvent, CalendarInfo, Contact, CountdownTimer, MessageSummary, Reminder, WorldClock } from '../../../core/pim/types';
import { getSecret, setSecret } from '../../store';

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
  /** Google and Microsoft OAuth client IDs (overrides the ones built in) */
  clients?: { google?: string; googleSecret?: string; microsoft?: string };
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
}

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

export async function putSecret(name: string, value: string): Promise<'keychain' | 'memory'> {
  const ok = await setSecret(`pim.${name}`, value).catch(() => false);
  if (ok) {
    memory.delete(name);
    return 'keychain';
  }
  memory.set(name, value);
  return 'memory';
}

export async function readSecret(name: string): Promise<string | undefined> {
  return memory.get(name) ?? (await getSecret(`pim.${name}`).catch(() => undefined));
}

export async function dropSecret(name: string) {
  memory.delete(name);
  await setSecret(`pim.${name}`, '').catch(() => false);
}
