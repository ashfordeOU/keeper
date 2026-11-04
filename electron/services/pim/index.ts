// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail, calendars, reminders, alarms and contacts in Keeper. Each part is a
// feature that can be switched off; when off, nothing connects, nothing is
// checked and nothing waits. Mail arrives through IMAP IDLE (the server says
// when), calendars are checked through the governor, and one timer waits for
// the next alarm, reminder or event alert.

import { app, BrowserWindow, clipboard, dialog, Notification, powerMonitor, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DueReminder, MailAiTask, MailView, NewAccount, OpenMessage, Outbox, PimApi, Ring, WaitingItem, WriteTask } from '../../../core/api-pim';
import { addLog, insights as insightsOf, type LogEntry } from '../../../core/pim/insights';
import { completeTask, moveToDay, todosToTasks, type OldTodo } from '../../../core/pim/tasks';
import { autoconfigUrls, fromSrv, guess, knownProvider, parseAutoconfig, type MailConfig } from '../../../core/pim/autoconfig';
import { WELL_KNOWN_CALDAV, WELL_KNOWN_CARDDAV } from '../../../core/pim/caldav';
import { occurrences as expandOccurrences, parseEvents, serializeEvents } from '../../../core/pim/ical';
import { readInvitation, replyTo } from '../../../core/pim/imip';
import { makeReply, matchesQuery, riskyAttachment, snippetOf, threadMessages, type Draft, type MailRule } from '../../../core/pim/mail';
import type { PimPrefsView } from '../../../core/pim/prefs';
import { classify, dueSnoozes, hasSignInCode, isSecurityAlert, followUpDraft, isOfflineError, isSnoozed, mergeResults, nextSnoozeWake, pickForQuestion, sortTime, splitSuggestions, subscriptions as subscriptionsOf, triageContext, voiceSamples, waitingForReply, type TriageContext } from '../../../core/pim/triage';
import { parseQuickAdd } from '../../../core/pim/quickadd';
import { dueKey, dueNow, meetingLink, nextAlarmTime, type Due } from '../../../core/pim/alarms';
import { inIsland } from '../../../core/pim/agenda';
import { BIRTHDAYS_CALENDAR, birthdayEvents, HOLIDAY_COUNTRIES, holidayCalendarId, holidayEvents } from '../../../core/pim/holidays';
import { CALENDAR_ONLY_SCOPES } from '../../../core/pim/oauth';
import { adoptSnapshot, calendarPollMs, ICS_MIN_MS, type SystemAccess } from '../../../core/pim/syscal';
import { buildCalendarStatus, upcomingFrom, type CalendarStatus, type UpcomingEvent } from '../../../core/pim/week-events';
import { systemDriver, type SystemDriver } from './system-calendars';
import type { Account, Address, Alarm, CalEvent, CalendarInfo, Contact, CountdownTimer, MailFolder, MessageSummary, Reminder, WorldClock } from '../../../core/pim/types';
import { suggest as suggestAddresses, serializeVCard } from '../../../core/pim/vcard';
import { redact } from '../../../core/brain/redact';
import { featureOn, onFeature } from '../features';
import { poll, pollNow } from '../governor';
import { cidMap, compose, MailAccount, smtpSend, smtpVerify, toBody, type Auth, type MailBox } from './mail';
import { LocalMailbox } from './local-mail';
import { gmailSendAs, localSignatures } from './signature-import';
import { cancelImport, exportContacts, exportMail, exportTasks, foundSources, importHistory, runImport, undoImport, type ImportHost } from './importer';
import { sourcesFor } from '../../../core/pim/import-flow';
import { inboxOnly, mergeFolders, resolveSources } from '../../../core/pim/unified';
import { dav, deleteHref, discover, fetchContacts, fetchIcs, graphCalendars, graphDelete, graphEvents, graphSave, putEvent, putTodo, syncCalendar, type DavAuth } from './dav';
import { accessToken, cancelSignIn, clientFor, saveTokens, signIn } from './oauth';
import { keeperUrl } from '../../../core/origin';
import { assertSecretReadable, dropSecret, emptyState, files, hash, loadAccounts, loadContacts, loadState, putSecret, readJson, readSecret, saveAccounts, writeJson, type EventCache, type FolderCache, type PendingOp, type PimState } from './store';
import { extendTimer } from '../../../core/widget-timer';
import { evaluateRules, planActions, SIEVE_SCRIPT, toSieve, type Rule } from '../../../core/pim/rules';
import { imapCriteria, matchMailQuery, orderResults, parseMailQuery } from '../../../core/pim/search';
import { badgeCount, extractCode, extractSignInLink, inTab, isBlocked, isDesignedMail, isMuted, notchAllows, sortReminders, tabCounts, toReply, unreadByAccount } from '../../../core/pim/smart';
import { labelCounts } from '../../../core/pim/mail-today';
import { linksIn, phishingWarnings } from '../../../core/pim/phishing';
import { adoptRemote, mergeEntries, noteBody, NOTE_SUBJECT, readNote, SNOOZE_FOLDER, snoozeKeyword } from '../../../core/pim/snooze-sync';
import { cleanMemory, draftPrompt, rememberIn, rewritePrompt } from '../../../core/pim/mail-ai';
import { cleanEditorHtml, htmlToText, replyIdentity, replyToOf, textToEditorHtml } from '../../../core/pim/compose-rich';
import { assembleStyled, inlineImages, pickSignature, replyMode, sanitizeSignature, signaturesOf } from '../../../core/pim/signatures';
import { asksForReceipt } from '../../../core/pim/privacy';

/** A mail alert's extras: Copy for a sign-in code, Open for a magic link, Undo for a message about to go. */
export type MailAlertExtra = { code?: string; link?: string; undoId?: string; sendAt?: number };

export interface PimDeps {
  broadcast: (channel: string, ...args: unknown[]) => void;
  /**
   * a short alert in the Island ('reminder': a task is due, shown even when other
   * alerts are not; 'mail': new Important mail, with the message id as ref)
   */
  alert: (title: string, detail?: string, kind?: 'reminder' | 'mail', ref?: string, mail?: MailAlertExtra) => void;
  /** the number for the Dock or taskbar icon (0 clears it) */
  badge?: (count: number) => void;
  /** reminders ringing now, for the Island's live activity (Snooze, Done) */
  islandReminders?: (list: DueReminder[]) => void;
  /** today's and tomorrow's events for the Island's "next meeting" */
  islandEvents: (events: { uid: string; title: string; start: number; end: number; allDay: boolean; location?: string; url?: string }[]) => void;
  /** running countdown timers for the Island */
  islandTimers: (timers: { id: string; label: string; endsAt?: number; leftMs?: number; durationMs: number }[]) => void;
  /** opens Keeper's main window on a route ("calendar:event:…") */
  show?: (route: string) => void;
  /** the Island's old single "calendar link" setting, added to the calendars as a subscription */
  islandCalendarUrl?: () => string;
  /**
   * open and save pickers, when this runs where the person's windows are not (Mail and
   * calendars in a process of its own: electron/suite/part.ts); otherwise the focused window's
   */
  dialogs?: {
    /** `none`: the answer when no window of Keeper's is focused */
    open(o: Electron.OpenDialogOptions, none: Electron.OpenDialogReturnValue): Promise<Electron.OpenDialogReturnValue>;
    save(o: Electron.SaveDialogOptions, none: Electron.SaveDialogReturnValue): Promise<Electron.SaveDialogReturnValue>;
  };
}

/** The focused window's picker (none focused: `none`), or the app's when this runs in a part. */
function openDialog(o: Electron.OpenDialogOptions, none: Electron.OpenDialogReturnValue): Promise<Electron.OpenDialogReturnValue> {
  if (deps?.dialogs) return deps.dialogs.open(o, none);
  const win = BrowserWindow.getFocusedWindow();
  return win ? dialog.showOpenDialog(win, o) : Promise.resolve(none);
}
function saveDialog(o: Electron.SaveDialogOptions, none: Electron.SaveDialogReturnValue): Promise<Electron.SaveDialogReturnValue> {
  if (deps?.dialogs) return deps.dialogs.save(o, none);
  const win = BrowserWindow.getFocusedWindow();
  return win ? dialog.showSaveDialog(win, o) : Promise.resolve(none);
}

const LOCAL = 'local';
const LOCAL_CAL = 'local:calendar';
const COLORS = ['#0a84ff', '#ff375f', '#30d158', '#ff9f0a', '#bf5af2', '#64d2ff', '#ffd60a', '#ac8e68'];

let deps: PimDeps | null = null;
let accounts: Account[] = [];
let state: PimState = emptyState();
let contacts: Contact[] = [];
const mailboxes = new Map<string, MailBox>();
const events = new Map<string, CalEvent[]>();
const memory = new Map<string, { at: number; secret: 'keychain' | 'memory' }>();
const needsSignIn = new Set<string>();
const bodyCache = new Map<string, { body: ReturnType<typeof toBody>; cid: Record<string, string> }>();
let loaded: Promise<void> | null = null;
let firstSync = new Set<string>();
let clockTimer: NodeJS.Timeout | undefined;
let outboxTimer: NodeJS.Timeout | undefined;
let lastCheck = Date.now();
const ringing = new Map<string, Ring>();
const stops: (() => void)[] = [];
// The computer's own calendars.
let driver: SystemDriver | null = null;
let sysAccess: SystemAccess | undefined;
let stopSysWatch: (() => void) | undefined;
/** a calendar is on screen until then (renewed every minute by the view) */
let visibleUntil = 0;
const calendarVisible = () => Date.now() < visibleUntil;
/** when each subscribed .ics link was last fetched */
const icsFetched = new Map<string, number>();

// ---------------------------------------------------------------- loading and saving

function ensureLocal() {
  if (!state.calendars.some((c) => c.id === LOCAL_CAL)) state.calendars.unshift({ id: LOCAL_CAL, account: LOCAL, name: 'On this computer', color: '#0a84ff', url: '', readOnly: false, visible: true, tasks: true });
}

async function load() {
  loaded ??= (async () => {
    [accounts, state, contacts] = await Promise.all([loadAccounts(), loadState(), loadContacts()]);
    ensureLocal();
    const now = Date.now();
    state.fired = state.fired.filter((f) => now - f.at < 2 * 86_400_000);
    for (const c of state.calendars) if (!c.source || c.source === 'system') events.set(c.id, (await readJson<EventCache>(files.events(c.id), { events: [] })).events);
    if (state.prefs.holidayCountry === undefined) {
      // Once: the holidays of the system's region, when Keeper knows them.
      const cc = (() => { try { return app.getLocaleCountryCode(); } catch { return ''; } })().toUpperCase();
      state.prefs.holidayCountry = HOLIDAY_COUNTRIES[cc] ? cc : '';
    }
    refreshDerived();
    await adoptIslandTodos();
  })();
  return loaded;
}

/**
 * Once: the Island's own to-do list becomes part of the task list, so the
 * Island and the Reminders page show the same tasks. The Island's file keeps
 * nothing afterwards.
 */
async function adoptIslandTodos() {
  if (state.migrated?.islandTodos) return;
  try {
    const tools = await import('../island-tools');
    const todos = (await tools.takeTodos()) as OldTodo[];
    const added = todosToTasks(todos, state.reminders);
    if (added.length) state.reminders.push(...added);
    state.migrated = { ...state.migrated, islandTodos: true };
    saveState();
  } catch {
    // Outside the app (tests) there is no Island file; try again next start.
  }
}

let saveTimer: NodeJS.Timeout | undefined;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void writeJson(files.state(), state), 300);
}

function saveEvents(calendar: string) {
  void writeJson(files.events(calendar), { events: events.get(calendar) ?? [] } satisfies EventCache);
}

function changed(kind: 'accounts' | 'mail' | 'calendar' | 'reminders' | 'alarms' | 'outbox' | 'contacts', extra?: unknown) {
  // Who you are and who you write to decide Important / Other.
  if (kind === 'accounts' || kind === 'contacts' || kind === 'outbox') ctxCache = null;
  if (kind === 'contacts') {
    refreshDerived();
    deps?.broadcast('pim-changed', 'calendar');
  }
  deps?.broadcast('pim-changed', kind, extra);
  if (kind === 'calendar' || kind === 'alarms' || kind === 'reminders') armClock();
  if (kind === 'calendar') pushIsland();
}

// ---------------------------------------------------------------- accounts and auth

const secretName = (id: string) => `pass.${id}`;
/** an alias's own outgoing server password */
const aliasSecret = (id: string, email: string) => `pass.${id}.smtp.${email.toLowerCase()}`;

async function mailAuth(a: Account): Promise<Auth> {
  const user = a.imap?.user ?? a.email ?? '';
  if (a.oauth) {
    try {
      const token = await accessToken(a.id, a.oauth, clientFor(a.oauth, state.prefs.clients)!);
      needsSignIn.delete(a.id);
      return { user: a.email ?? user, accessToken: token };
    } catch (e) {
      // A keychain that said no is not a wrong sign-in: the account is fine once it opens again.
      if ((e as { code?: string }).code !== 'KEYCHAIN_LOCKED') needsSignIn.add(a.id);
      throw e;
    }
  }
  const pass = await readSecret(secretName(a.id));
  if (pass === undefined) {
    await assertSecretReadable(secretName(a.id), 'this account’s saved password');
    needsSignIn.add(a.id);
    throw new Error('Enter the password for this account again');
  }
  return { user, pass };
}

async function davAuth(a: Account): Promise<DavAuth> {
  if (a.oauth === 'google') return { bearer: (await mailAuth(a) as { accessToken: string }).accessToken };
  const pass = await readSecret(secretName(a.id));
  if (pass === undefined) {
    await assertSecretReadable(secretName(a.id), 'this account’s saved password');
    needsSignIn.add(a.id);
    throw new Error('Enter the password for this account again');
  }
  return { basic: { user: (a as Account & { davUser?: string }).davUser ?? a.email ?? a.imap?.user ?? '', pass } };
}

function mailbox(a: Account): MailBox {
  let m = mailboxes.get(a.id);
  if (!m) {
    m = a.kind === 'local' ? new LocalMailbox(a) : new MailAccount(a, () => mailAuth(a));
    mailboxes.set(a.id, m);
  }
  return m;
}

async function discoverConfig(email: string): Promise<MailConfig> {
  const known = knownProvider(email);
  if (known) return known;
  for (const url of autoconfigUrls(email)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const c = parseAutoconfig(await res.text(), email);
        if (c) return c;
      }
    } catch {
      /* try the next place */
    }
  }
  try {
    const { promises: dns } = await import('node:dns');
    const domain = email.split('@')[1];
    const [imaps, sub] = await Promise.all([dns.resolveSrv(`_imaps._tcp.${domain}`).catch(() => []), dns.resolveSrv(`_submission._tcp.${domain}`).catch(() => [])]);
    const c = fromSrv(email, imaps, sub);
    if (c) return c;
  } catch {
    /* no DNS answers */
  }
  return guess(email);
}

function accountFrom(n: NewAccount, id: string = randomUUID()): Account & { davUser?: string } {
  const domain = n.email?.split('@')[1]?.toLowerCase() ?? '';
  const name = n.name || n.email?.split('@')[0] || 'Me';
  return {
    id,
    kind: n.kind,
    label: n.label || n.email || (n.caldav ? new URL(n.caldav.replace(/^webcal:/i, 'https:')).hostname : 'Account'),
    email: n.email,
    identities: n.email ? [{ name, email: n.email }] : [],
    imap: n.imap, smtp: n.smtp,
    caldav: n.caldav ?? (n.calendar !== false ? WELL_KNOWN_CALDAV[domain] : undefined),
    carddav: n.carddav ?? (n.contacts !== false ? WELL_KNOWN_CARDDAV[domain] : undefined),
    mail: n.kind === 'imap' || n.kind === 'google' || n.kind === 'microsoft' ? n.mail !== false && !!n.imap : false,
    calendar: n.kind === 'ics' || n.kind === 'caldav' || n.kind === 'microsoft' ? true : n.calendar !== false && !!(n.caldav ?? WELL_KNOWN_CALDAV[domain]),
    contacts: n.contacts !== false && !!(n.carddav ?? WELL_KNOWN_CARDDAV[domain]),
    insecureTls: n.insecureTls,
    color: COLORS[accounts.length % COLORS.length],
    davUser: n.davUser,
  };
}

async function testNew(n: NewAccount): Promise<{ ok: boolean; message: string }> {
  const a = accountFrom(n, 'test');
  try {
    if (n.kind === 'ics') {
      const evs = await fetchIcs(n.caldav!, 'test');
      return { ok: true, message: `Found ${evs.length} event${evs.length === 1 ? '' : 's'}` };
    }
    const auth: Auth = { user: n.imap?.user ?? n.email ?? '', pass: n.password ?? '' };
    const parts: string[] = [];
    if (a.mail && a.imap) {
      await new MailAccount(a, async () => auth).test();
      parts.push('Mail: connected');
      if (a.smtp) {
        await smtpVerify(a, { user: n.smtp?.user ?? auth.user, pass: n.password ?? '' });
        parts.push('sending: works');
      }
    }
    if (a.calendar && a.caldav) {
      try {
        const d = await discover(a.caldav, { basic: { user: n.davUser ?? n.email ?? auth.user, pass: n.password ?? '' } }, a.carddav);
        parts.push(`${d.calendars.length} calendar${d.calendars.length === 1 ? '' : 's'}`);
      } catch (e) {
        if (n.kind === 'caldav') throw e;
        parts.push('calendars: not found');
      }
    }
    return { ok: true, message: parts.join(', ') || 'Connected' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

async function addAccount(n: NewAccount, oauthTokens?: Parameters<typeof saveTokens>[1]): Promise<Account> {
  await load();
  const a = accountFrom(n);
  if (oauthTokens) {
    a.oauth = n.kind === 'google' ? 'google' : 'microsoft';
    await saveTokens(a.id, oauthTokens);
  } else if (n.password !== undefined) {
    memory.set(a.id, { at: Date.now(), secret: await putSecret(secretName(a.id), n.password) });
  }
  accounts.push(a);
  await saveAccounts(accounts);
  changed('accounts');
  void startAccount(a);
  return a;
}

async function startAccount(a: Account) {
  if (a.mail && featureOn('mail')) {
    void refreshAccount(a).catch(() => undefined);
    void mailbox(a).watch('INBOX', () => void refreshFolder(a, 'INBOX').catch(() => undefined));
  }
  if ((a.calendar || a.contacts) && featureOn('calendars')) void syncAccountCalendars(a).catch(() => undefined);
}

// ---------------------------------------------------------------- mail

const folderCache = new Map<string, MessageSummary[]>();
const fkey = (account: string, folder: string) => `${account}\n${folder}`;

async function cachedMessages(account: string, folder: string): Promise<MessageSummary[]> {
  const k = fkey(account, folder);
  let m = folderCache.get(k);
  if (!m) {
    m = (await readJson<FolderCache>(files.folder(account, folder), { messages: [] })).messages;
    folderCache.set(k, m);
  }
  return m;
}

function splitId(id: string): { account: string; folder: string; uid: number } {
  const first = id.indexOf(':');
  const last = id.lastIndexOf(':');
  return { account: id.slice(0, first), folder: id.slice(first + 1, last), uid: Number(id.slice(last + 1)) };
}

const acct = (id: string) => accounts.find((a) => a.id === id);

async function folderOf(a: Account, special: MailFolder['special']): Promise<string | undefined> {
  let list = await mailbox(a).cachedFolders();
  if (!list.length) list = await mailbox(a).folders().catch(() => []);
  return list.find((f) => f.special === special)?.path;
}

// ---------------------------------------------------------------- when each account was last checked

/** Per account: when mail or calendars were last fetched without trouble, and the last failure. */
const health = new Map<string, { checked?: number; error?: string; errorAt?: number }>();
async function noted<T>(a: Account, what: 'mail' | 'calendars', p: Promise<T>): Promise<T> {
  try {
    const r = await p;
    health.set(a.id, { checked: Date.now() });
    return r;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200);
    health.set(a.id, { ...health.get(a.id), error: `${what === 'mail' ? 'Mail' : 'Calendars'}: ${msg}`, errorAt: Date.now() });
    changed('accounts');
    throw e;
  }
}

function refreshFolder(a: Account, folder: string) {
  return noted(a, 'mail', refreshFolderNow(a, folder));
}

async function refreshFolderNow(a: Account, folder: string) {
  const first = !firstSync.has(fkey(a.id, folder));
  const r = await mailbox(a).sync(folder);
  firstSync.add(fkey(a.id, folder));
  needsSignIn.delete(a.id);
  let list = r.messages;
  // New inbox mail: blocked senders to Junk, muted conversations out of the inbox, then the rules.
  if (folder.toUpperCase() === 'INBOX' && r.added.length) {
    if (await arrivalActions(a, folder, r.added)) list = (await mailbox(a).sync(folder)).messages;
  }
  // Keeper-only marks (snooze) survive the server's list.
  const old = folderCache.get(fkey(a.id, folder));
  if (old) {
    const mine = new Map(old.filter((m) => m.snoozedUntil || m.returnedAt).map((m) => [m.id, m]));
    for (const m of list) {
      const o = mine.get(m.id);
      if (o) Object.assign(m, { snoozedUntil: o.snoozedUntil, returnedAt: o.returnedAt });
    }
  }
  folderCache.set(fkey(a.id, folder), list);
  adoptSyncedSnoozes(list);
  if (folder.toUpperCase() !== 'INBOX') ctxCache = null;
  if (!first && folder.toUpperCase() === 'INBOX') void notifyNew(a, r.added.filter((m) => !m.seen)).catch(() => undefined);
  changed('mail', { account: a.id, folder });
  // Back online: changes made while offline go to the server now.
  if (state.pendingOps?.some((o) => o.account === a.id)) void replayOps(a.id);
}

/**
 * New mail: a notification and the Island's drop-down for Important mail (or
 * all, or none, as set; only accounts and senders chosen for the notch). A
 * sign-in code gets Copy and a magic link gets Open, in both.
 */
async function notifyNew(a: Account, fresh: MessageSummary[]) {
  if (!fresh.length) return;
  const ctx = await triageCtx();
  const sorted = fresh.map((m) => withTriage(m, ctx)).filter((m) => !isBlocked(m.from, state.prefs.blockedSenders ?? []) && !isMuted(m, state.muted ?? []));
  void updateBadge();
  if (!state.prefs.notifyMail) return;
  const how = state.prefs.islandMail ?? 'important';
  if (how === 'off') return;
  const shown = (how === 'all' ? sorted : sorted.filter((m) => m.category === 'important'))
    .filter((m) => notchAllows(m, { accountOff: a.notch === false, senders: state.prefs.notchSenders }));
  if (!shown.length) return;
  const one = shown.length === 1 ? shown[0] : undefined;
  const sec = shown.some((m) => m.security);
  // The code or link is read from the message itself (a sign-in mail is short).
  let extra: MailAlertExtra | undefined;
  if (one && state.prefs.codeActions !== false && (one.security || hasSignInCode(`${one.subject}\n${one.snippet}`))) {
    const o = await openMessage(one.id, { markRead: false }).catch(() => null);
    if (o && (o.code || o.signInLink)) extra = { code: o.code, link: o.signInLink };
  }
  const who = one ? one.from?.name || one.from?.address || 'New mail' : `${shown.length} new message${shown.length === 1 ? '' : 's'}`;
  const title = state.prefs.notifyPreviews ? (sec && one ? `Security: ${who}` : who) : `${shown.length} new message${shown.length === 1 ? '' : 's'}`;
  const body = extra?.code ? `${state.prefs.notifyPreviews && one ? `${one.subject} · ` : ''}Code ${extra.code} — click to copy` : extra?.link ? `${state.prefs.notifyPreviews && one ? `${one.subject} · ` : ''}Sign-in link — click to open` : state.prefs.notifyPreviews && one ? one.subject : a.label;
  if (Notification.isSupported()) {
    const actions = extra?.code ? [{ type: 'button' as const, text: 'Copy code' }] : extra?.link ? [{ type: 'button' as const, text: 'Open link' }] : [];
    const n = new Notification({ title, body, silent: false, actions });
    const act = () => {
      if (extra?.code) { clipboard.writeText(extra.code); deps?.alert('Code copied', extra.code); }
      else if (extra?.link) void shell.openExternal(extra.link);
      else deps?.broadcast('navigate', one ? `mail:${one.id}` : 'mail');
    };
    n.on('click', act);
    n.on('action', act);
    n.show();
  }
  deps?.alert(title, extra?.code ? `${one?.subject ?? ''}`.trim() || body : body, 'mail', one?.id ?? `${a.id}:INBOX`, extra);
}

async function refreshAccount(a: Account) {
  await mailbox(a).folders();
  await refreshFolder(a, 'INBOX');
  // Sent and Archive too, so Waiting for reply and Important see your replies (and work offline).
  for (const special of ['sent', 'archive'] as const) {
    // Gmail has no Archive: All Mail holds archived mail there.
    const f = (await folderOf(a, special)) ?? (special === 'archive' ? await folderOf(a, 'all') : undefined);
    if (f) await refreshFolder(a, f).catch(() => undefined);
  }
  void prefetchBodies(a).catch(() => undefined);
}

/** The newest inbox messages' text, kept on this computer so they open offline. */
async function prefetchBodies(a: Account) {
  if (state.prefs.offlineBodies === false) return;
  const list = (await cachedMessages(a.id, 'INBOX')).slice(0, 30);
  for (const m of list) {
    if (await fsp.access(files.body(m.id)).then(() => true, () => false)) continue;
    const { body, parsed } = await mailbox(a).body(m.folder, m.uid);
    const entry = { body, cid: cidMap(parsed) };
    if (JSON.stringify(entry).length < 3_000_000) await writeJson(files.body(m.id), entry);
  }
}

function persistFolder(account: string, folder: string) {
  const list = folderCache.get(fkey(account, folder));
  if (!list) return;
  void readJson<FolderCache>(files.folder(account, folder), { messages: [] }).then((c) => writeJson(files.folder(account, folder), { ...c, messages: list }));
}

function applyLocal(ids: string[], patch: Partial<MessageSummary> | null) {
  const touched = new Set<string>();
  for (const id of ids) {
    const { account, folder } = splitId(id);
    const list = folderCache.get(fkey(account, folder));
    if (!list) continue;
    const i = list.findIndex((m) => m.id === id);
    if (i < 0) continue;
    if (patch) list[i] = { ...list[i], ...patch };
    else list.splice(i, 1);
    touched.add(fkey(account, folder));
  }
  // Kept on disk at once, so a change made offline is still there after a restart.
  for (const k of touched) persistFolder(...(k.split('\n') as [string, string]));
  changed('mail');
}

// ---------------------------------------------------------------- offline changes

async function runOp(o: PendingOp) {
  const a = acct(o.account);
  if (!a) return;
  if (o.kind === 'flag') await mailbox(a).setFlags(o.folder, o.uids, o.flag, o.on);
  else if (o.kind === 'move') await mailbox(a).move(o.folder, o.uids, o.dest);
  else await mailbox(a).remove(o.folder, o.uids, o.trash);
}

/** A change to the server; when it cannot be reached, the change waits and is tried again. */
async function serverOp(o: PendingOp) {
  try {
    await runOp(o);
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    state.pendingOps = [...(state.pendingOps ?? []), o];
    saveState();
  }
}

let replaying = false;
async function replayOps(account: string) {
  if (replaying) return;
  replaying = true;
  try {
    const mine = (state.pendingOps ?? []).filter((o) => o.account === account);
    const left: PendingOp[] = (state.pendingOps ?? []).filter((o) => o.account !== account);
    for (let i = 0; i < mine.length; i++) {
      try {
        await runOp(mine[i]);
      } catch (e) {
        // Still offline: keep this one and the rest. Other failures (a folder gone) are dropped.
        if (isOfflineError(e)) { left.push(...mine.slice(i)); break; }
      }
    }
    state.pendingOps = left;
    saveState();
  } finally {
    replaying = false;
  }
}

// ---------------------------------------------------------------- Important and Other

const myAddresses = () => accounts.flatMap((a) => [a.email, ...a.identities.map((i) => i.email)]).filter((x): x is string => !!x).map((x) => x.toLowerCase());

/** Every cached message of the given kind of folder, across mail accounts. */
async function cachedOf(special: 'inbox' | 'sent' | 'archive', account?: string): Promise<MessageSummary[]> {
  const out: MessageSummary[] = [];
  for (const a of accounts.filter((x) => x.mail && (!account || x.id === account))) {
    const f = special === 'inbox' ? 'INBOX' : (await folderOf(a, special)) ?? (special === 'archive' ? await folderOf(a, 'all') : undefined);
    if (f) out.push(...(await cachedMessages(a.id, f)));
  }
  return out;
}

/** Every folder kept on this computer, except Spam and Trash unless asked. */
async function cachedEverywhere(account?: string, withHidden = false): Promise<MessageSummary[]> {
  const out: MessageSummary[] = [];
  for (const a of accounts.filter((x) => x.mail && (!account || x.id === account))) {
    for (const f of await mailbox(a).cachedFolders()) {
      if (!withHidden && (f.special === 'junk' || f.special === 'trash')) continue;
      out.push(...(await cachedMessages(a.id, f.path)));
    }
  }
  return out;
}

let ctxCache: { at: number; ctx: TriageContext } | null = null;
async function triageCtx(): Promise<TriageContext> {
  if (ctxCache && Date.now() - ctxCache.at < 5000) return ctxCache.ctx;
  const ctx = triageContext({
    me: myAddresses(), sent: await cachedOf('sent'), contacts: contacts.flatMap((c) => c.emails), recent: state.recent.map((r) => r.address),
    important: state.prefs.importantSenders, other: state.prefs.otherSenders,
  });
  ctxCache = { at: Date.now(), ctx };
  return ctx;
}

function withTriage(m: MessageSummary, ctx: TriageContext): MessageSummary {
  const t = classify(m, ctx);
  return { ...m, category: t.category, security: t.security || undefined };
}

// ---------------------------------------------------------------- snooze

let snoozeTimer: NodeJS.Timeout | undefined;
function armSnooze() {
  clearTimeout(snoozeTimer);
  const next = nextSnoozeWake(state.snoozes ?? [], Date.now());
  if (next === undefined) return;
  snoozeTimer = setTimeout(() => void wakeSnoozed(), Math.max(0, Math.min(next - Date.now(), 2_147_000_000)));
}

/** Snoozed mail whose time has come is back at the top of the inbox, unread, and the Island says so. */
async function wakeSnoozed() {
  const { due, waiting } = dueSnoozes(state.snoozes ?? [], Date.now());
  state.snoozes = waiting;
  saveState();
  for (const s of due) {
    const { account, folder, uid } = splitId(s.id);
    const list = await cachedMessages(account, folder);
    const m = list.find((x) => x.id === s.id);
    if (!m) continue;
    Object.assign(m, { snoozedUntil: undefined, returnedAt: s.until, seen: false });
    persistFolder(account, folder);
    const a = acct(account);
    if (a) void serverOp({ kind: 'flag', account, folder, uids: [uid], flag: '\\Seen', on: false }).catch(() => undefined);
    deps?.alert(`Back from snooze: ${m.from?.name || m.from?.address || ''}`.trim(), m.subject, 'mail', m.id);
  }
  if (due.length) { changed('mail'); void shareSnooze(due.map((s) => s.id), null); }
  armSnooze();
}

function byFolder(ids: string[]): Map<string, { a: Account; folder: string; uids: number[] }> {
  const out = new Map<string, { a: Account; folder: string; uids: number[] }>();
  for (const id of ids) {
    const { account, folder, uid } = splitId(id);
    const a = acct(account);
    if (!a) continue;
    const k = fkey(account, folder);
    const g = out.get(k) ?? { a, folder, uids: [] };
    g.uids.push(uid);
    out.set(k, g);
  }
  return out;
}

async function openMessage(id: string, opts: { allowRemote?: boolean; markRead?: boolean } = {}): Promise<OpenMessage> {
  await load();
  const { account, folder, uid } = splitId(id);
  const a = acct(account);
  if (!a) throw new Error('This account was removed');
  let cached = bodyCache.get(id);
  if (!cached) {
    const disk = await readJson<{ body: ReturnType<typeof toBody>; cid: Record<string, string> } | null>(files.body(id), null);
    if (disk) cached = disk;
    else {
      const { body, parsed } = await mailbox(a).body(folder, uid);
      cached = { body, cid: cidMap(parsed) };
      // Bodies are kept on disk (small ones) so reopening is instant and works offline.
      if (JSON.stringify(cached).length < 3_000_000) void writeJson(files.body(id), cached);
    }
    bodyCache.set(id, cached);
    if (bodyCache.size > 40) bodyCache.delete(bodyCache.keys().next().value!);
  }
  const list = await cachedMessages(account, folder);
  const summary = list.find((m) => m.id === id) ?? { id, account, folder, uid, subject: cached.body.headers.subject ?? '', to: [], cc: [], date: 0, seen: true, flagged: false, answered: false, snippet: '', hasAttachments: false };
  if (!summary.snippet && cached.body.text) summary.snippet = snippetOf(cached.body.text);
  const sender = summary.from?.address.toLowerCase();
  const allow = !!opts.allowRemote || (!!sender && state.prefs.trustedSenders.includes(sender));
  // The mail cleaner and parsers are large: they load the first time a message is opened.
  const { sanitizeMail, textToHtml } = await import('../../../core/pim/sanitize');
  const clean = cached.body.html ? sanitizeMail(cached.body.html, { allowRemote: allow, cid: cached.cid }) : { html: textToHtml(cached.body.text ?? ''), blocked: 0, trackers: 0 };
  if (opts.markRead !== false && !summary.seen) {
    summary.seen = true;
    void mailbox(a).setFlags(folder, [uid], '\\Seen', true).catch(() => undefined);
    changed('mail', { account, folder });
  }
  let invite: OpenMessage['invite'];
  if (cached.body.invite) {
    const inv = readInvitation(cached.body.invite);
    const me = a.identities.map((x) => x.email.toLowerCase());
    if (inv) invite = { method: inv.method, event: inv.event, mine: inv.event.attendees?.find((x) => me.includes(x.email.toLowerCase()))?.status };
  }
  // Warnings for mail pretending to be someone else (contacts and the domains you write to are known).
  const known = [...new Set([...myAddresses(), ...state.recent.map((r) => r.address)].map((x) => x.toLowerCase().split('@')[1]).filter(Boolean))];
  const replyToH = cached.body.headers['reply-to'];
  const { parseAddressList } = await import('../../../core/pim/mail');
  const mine = sender ? myAddresses().includes(sender) : false;
  const warnings = mine ? [] : phishingWarnings({
    from: summary.from, replyTo: replyToH ? parseAddressList(replyToH) : undefined, headers: cached.body.headers,
    links: cached.body.html ? linksIn(cached.body.html) : [], contacts: contacts.map((c) => ({ name: c.name, emails: c.emails })), knownDomains: known,
  });
  // A message that looks like an impersonation never gets a one-click Copy or Open.
  const textAll = `${summary.subject}\n${cached.body.text ?? ''}`;
  const suspicious = warnings.some((w) => w.level === 2);
  const code = suspicious ? undefined : extractCode(textAll);
  const signInLink = code || suspicious ? undefined : extractSignInLink(textAll, cached.body.html);
  const remind = (state.noReply ?? []).find((r) => r.messageId === summary.messageId);
  return {
    summary, html: clean.html, text: cached.body.text, blocked: clean.blocked, trackers: clean.trackers, attachments: cached.body.attachments, invite, unsubscribe: cached.body.listUnsubscribe, headers: cached.body.headers,
    warnings: warnings.length ? warnings : undefined, code, signInLink, designed: cached.body.html ? isDesignedMail(cached.body.html) : false,
    cleanedLinks: (clean as { cleanedLinks?: number }).cleanedLinks, receiptAsked: asksForReceipt(cached.body.headers) || undefined,
    muted: isMuted(summary, state.muted ?? []) || undefined, blockedSender: isBlocked(summary.from, state.prefs.blockedSenders ?? []) || undefined, remindAt: remind?.at,
  };
}

async function rawAttachment(id: string, att: string): Promise<{ filename: string; content: Buffer }> {
  const { account, folder, uid } = splitId(id);
  const a = acct(account);
  if (!a) throw new Error('This account was removed');
  const { simpleParser } = await import('mailparser');
  const parsed = await simpleParser(await mailbox(a).source(folder, uid));
  const x = parsed.attachments[Number(att)];
  if (!x) throw new Error('That attachment is not in the message');
  return { filename: path.basename(x.filename || `attachment-${Number(att) + 1}`), content: x.content };
}

function identityOf(a: Account, from?: string): Address {
  const i = a.identities.find((x) => x.email === from) ?? a.identities[0];
  return i ? { name: i.name, address: i.email } : { address: a.email ?? '' };
}

type Sendable = Draft & { account: string; sendAt?: number; markdown?: boolean; html?: string; noSignature?: boolean; key?: string; remindAt?: number; signatureId?: string };

/** new mail, a reply or a forward (for the signature chosen for each) */
const kindOf = (d: Sendable): 'new' | 'reply' | 'forward' => (d.forwardOf || /^fwd?:/i.test(d.subject) ? 'forward' : d.inReplyTo || /^re:/i.test(d.subject) ? 'reply' : 'new');

/**
 * The message as it will go: the rich text (in the account's font, size and
 * colour) or Markdown, the signature picked for this kind of message (or the
 * one chosen in the window, or none), the quote above or below, plain text
 * only when the account writes plain, and pictures inside as attached
 * pictures (cid:), with the alias's Reply-To.
 */
async function build(d: Sendable, a: Account) {
  const from = identityOf(a, d.from);
  const ident = a.identities.find((x) => x.email === from.address);
  const list = signaturesOf(ident);
  const picked = d.noSignature || d.signatureId === '' ? undefined : d.signatureId ? list.find((x) => x.id === d.signatureId) : pickSignature(ident, kindOf(d), a.signatureOnReplies !== false);
  // Cleaned again as it goes, whatever wrote it.
  const sig = picked ? { ...picked, html: sanitizeSignature(picked.html) } : undefined;
  const style = a.compose;
  let bodyHtml: string;
  if (d.html !== undefined) bodyHtml = cleanEditorHtml(d.html);
  else if (d.markdown !== false && style?.format !== 'plain') {
    const { marked } = await import('marked');
    bodyHtml = marked.parse(d.body, { async: false, gfm: true, breaks: true }) as string;
  } else bodyHtml = textToEditorHtml(d.body);
  const bodyText = d.html !== undefined ? htmlToText(d.html) : d.body;
  const out = assembleStyled({ html: bodyHtml, text: bodyText, signature: sig, quotedText: d.quoted, style });
  let html = out.html;
  const inline: { filename: string; content: string; encoding: 'base64'; contentType: string; cid: string }[] = [];
  if (html) {
    const r = inlineImages(html, randomUUID().slice(0, 8));
    html = r.html;
    for (const p of r.parts) inline.push({ filename: p.filename, content: p.content, encoding: 'base64', contentType: p.contentType, cid: p.cid });
  }
  const atts = [...(d.attachments ?? []).map((x) => ({ filename: x.name ?? path.basename(x.path), path: x.path })), ...inline];
  return { from, text: out.text, html, atts, replyTo: replyToOf(ident) };
}

async function queue(d: Sendable): Promise<Outbox> {
  await load();
  const a = acct(d.account);
  if (!a?.smtp) throw new Error('This account cannot send mail');
  const { from, text, html, atts, replyTo } = await build(d, a);
  const { raw, envelope, messageId } = await compose({ from, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, text, html, inReplyTo: d.inReplyTo, references: d.references, attachments: atts, replyTo });
  const now = Date.now();
  const item = { id: randomUUID(), account: a.id, sendAt: d.sendAt ?? now + state.prefs.undoSendSec * 1000, raw: raw.toString('base64'), envelope, subject: d.subject, draft: d, queuedAt: now, scheduled: d.sendAt !== undefined && d.sendAt - now > 60_000 };
  state.outbox.push(item);
  for (const r of [...d.to, ...d.cc, ...d.bcc]) {
    state.recent = [{ ...r, at: Date.now() }, ...state.recent.filter((x) => x.address.toLowerCase() !== r.address.toLowerCase())].slice(0, 300);
  }
  // "Remind me if no reply", chosen while writing.
  if (d.remindAt) state.noReply = [...(state.noReply ?? []), { messageId, account: a.id, subject: d.subject, to: d.to, sentAt: item.sendAt, at: d.remindAt }];
  // The copy in Drafts goes once it is sent.
  if (d.key) void dropDraftCopy(d.key);
  saveState();
  armOutbox();
  armNoReply();
  changed('outbox');
  // The Island counts down with Undo while it waits to go.
  if (!item.scheduled && item.sendAt - now >= 2000) deps?.alert('Sending', d.subject || '(no subject)', 'mail', undefined, { undoId: item.id, sendAt: item.sendAt });
  return { id: item.id, sendAt: item.sendAt, subject: item.subject, scheduled: item.scheduled };
}

/** A draft kept on the server under a compose window's key: saved again, the previous copy goes. */
async function mirrorDraft(d: Sendable) {
  const a = acct(d.account);
  if (!a) return;
  const drafts = await folderOf(a, 'drafts');
  if (!drafts) return;
  const { from, text, html, replyTo } = await build({ ...d, noSignature: true }, a);
  const prevMid = d.key ? state.draftIds?.[d.key] : undefined;
  const { raw, messageId } = await compose({ from, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, text, html, inReplyTo: d.inReplyTo, references: d.references, replyTo, keepBcc: true });
  await mailbox(a).append(drafts, raw, ['\\Draft', '\\Seen']);
  if (d.key) {
    state.draftIds = { ...state.draftIds, [d.key]: `${a.id}\n${messageId}` };
    saveState();
  }
  if (prevMid) await removeDraftByMid(prevMid);
}

async function removeDraftByMid(stored: string) {
  const [account, mid] = stored.split('\n');
  const a = acct(account);
  if (!a || !mid) return;
  const drafts = await folderOf(a, 'drafts');
  if (!drafts) return;
  const uids = await mailbox(a).byMessageId(drafts, mid).catch(() => [] as number[]);
  if (uids.length) await mailbox(a).remove(drafts, uids).catch(() => undefined);
}

async function dropDraftCopy(key: string) {
  const stored = state.draftIds?.[key];
  if (!stored) return;
  const rest = { ...state.draftIds };
  delete rest[key];
  state.draftIds = rest;
  saveState();
  await removeDraftByMid(stored).catch(() => undefined);
}

function armOutbox() {
  clearTimeout(outboxTimer);
  const pending = state.outbox.filter((x) => !x.error);
  if (!pending.length) return;
  const next = Math.min(...pending.map((x) => x.sendAt));
  outboxTimer = setTimeout(() => void flushOutbox(), Math.max(0, Math.min(next - Date.now(), 2_147_000_000)));
}

async function flushOutbox() {
  const now = Date.now();
  for (const q of [...state.outbox]) {
    if (q.error || q.sendAt > now) continue;
    const a = acct(q.account);
    if (!a) {
      state.outbox = state.outbox.filter((x) => x !== q);
      continue;
    }
    try {
      const raw = Buffer.from(q.raw, 'base64');
      // An alias with a server of its own goes out through it.
      const own = a.identities.find((x) => x.smtp && x.email.toLowerCase() === q.envelope.from.toLowerCase());
      if (own?.smtp) {
        const pass = await readSecret(aliasSecret(a.id, own.email));
        if (pass === undefined) throw new Error(`Enter the password for ${own.email}’s outgoing server again (Settings → Mail & Calendar)`);
        await smtpSend({ ...a, smtp: own.smtp }, { user: own.smtp.user ?? own.email, pass }, raw, q.envelope);
      } else await smtpSend(a, await mailAuth(a), raw, q.envelope);
      state.outbox = state.outbox.filter((x) => x !== q);
      // Gmail files sent mail by itself; other servers need a copy in Sent.
      if (a.oauth !== 'google') {
        const sent = await folderOf(a, 'sent');
        if (sent) await mailbox(a).append(sent, raw).catch(() => undefined);
      }
      const d = q.draft;
      if (d?.inReplyTo) {
        // Mark the original as answered when it is in the list.
        for (const [k, list] of folderCache) {
          const m = list.find((x) => x.messageId === d.inReplyTo);
          if (m) {
            m.answered = true;
            void mailbox(a).setFlags(k.split('\n')[1], [m.uid], '\\Answered', true).catch(() => undefined);
          }
        }
      }
      deps?.alert('Sent', q.subject);
    } catch (e) {
      q.error = e instanceof Error ? e.message : String(e);
      deps?.alert('Could not send', q.error);
    }
  }
  saveState();
  changed('outbox');
  changed('mail');
  armOutbox();
}

// ---------------------------------------------------------------- calendars

function calOf(id: string) {
  return state.calendars.find((c) => c.id === id);
}

function syncAccountCalendars(a: Account) {
  return noted(a, 'calendars', syncAccountCalendarsNow(a));
}

async function syncAccountCalendarsNow(a: Account) {
  const window = { from: Date.now() - 120 * 86_400_000, to: Date.now() + 400 * 86_400_000 };
  if (a.kind === 'ics') {
    const id = `${a.id}:ics`;
    if (!calOf(id)) state.calendars.push({ id, account: a.id, name: a.label, color: a.color ?? '#64d2ff', url: a.caldav!, readOnly: true, visible: true });
    events.set(id, await fetchIcs(a.caldav!, id));
    saveEvents(id);
    saveState();
    changed('calendar');
    return;
  }
  if (a.oauth === 'microsoft') {
    const token = await accessToken(a.id, 'microsoft', clientFor('microsoft', state.prefs.clients)!, 'graph');
    for (const c of await graphCalendars(token)) {
      const id = `${a.id}:${hash(c.id)}`;
      const info = calOf(id) ?? (state.calendars.push({ id, account: a.id, name: c.name, color: c.color ?? a.color ?? '#0a84ff', url: c.id, readOnly: c.readOnly, visible: true }), calOf(id)!);
      info.name = c.name;
      events.set(id, await graphEvents(token, c.id, id, window.from, window.to));
      saveEvents(id);
    }
    saveState();
    changed('calendar');
    return;
  }
  if (!a.caldav) return;
  const auth = await davAuth(a);
  const found = await discover(a.caldav, auth, a.carddav);
  for (const c of found.calendars) {
    const id = `${a.id}:${hash(c.url)}`;
    let info = calOf(id);
    if (!info) {
      info = { id, account: a.id, name: c.name, color: c.color ?? COLORS[state.calendars.length % COLORS.length], url: c.url, readOnly: c.readOnly, visible: true, tasks: c.components.includes('VTODO') && !c.components.includes('VEVENT') };
      state.calendars.push(info);
    }
    info.name = c.name;
    info.readOnly = c.readOnly;
    // Unchanged since last time (same ctag): nothing to download.
    if (info.ctag && c.ctag && info.ctag === c.ctag && events.has(id)) continue;
    const r = await syncCalendar(c.url, id, auth, info.syncToken, window);
    let list = r.full ? [] : (events.get(id) ?? []);
    const touched = new Set([...r.removedHrefs, ...r.events.map((e) => e.href!), ...r.todos.map((t) => t.href!)]);
    list = list.filter((e) => !touched.has(e.href!));
    list.push(...r.events);
    events.set(id, list);
    state.reminders = state.reminders.filter((t) => t.list !== id || (!r.full && !touched.has(t.href!)));
    state.reminders.push(...r.todos);
    info.ctag = c.ctag;
    info.syncToken = r.syncToken;
    saveEvents(id);
  }
  if (a.contacts && found.addressbooks.length) {
    const got: Contact[] = [];
    for (const b of found.addressbooks) got.push(...(await fetchContacts(b.url, auth, a.id).catch(() => [])));
    contacts = [...contacts.filter((c) => c.account !== a.id), ...got];
    void writeJson(files.contacts(), contacts);
    changed('contacts');
  }
  saveState();
  changed('calendar');
  changed('reminders');
}

/** Accounts' calendars; subscribed .ics links at most every 15 minutes unless `force`. */
async function syncAllCalendars(force = true) {
  await load();
  for (const a of accounts) {
    if (!(a.calendar || a.contacts)) continue;
    if (a.kind === 'ics') {
      if (!force && Date.now() - (icsFetched.get(a.id) ?? 0) < ICS_MIN_MS) continue;
      icsFetched.set(a.id, Date.now());
    }
    await syncAccountCalendars(a).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- the computer's own calendars, holidays, birthdays

function sysDriver(): SystemDriver {
  driver ??= systemDriver();
  return driver;
}

function dropCalendars(ids: string[]) {
  if (!ids.length) return;
  for (const id of ids) {
    events.delete(id);
    void fsp.rm(files.events(id), { force: true });
  }
  state.calendars = state.calendars.filter((c) => !ids.includes(c.id));
}

/** Reads the computer's calendars again (a window from a month ago to half a year ahead). */
async function syncSystem() {
  await load();
  if (state.prefs.systemCalendars === false || !featureOn('calendars')) {
    const gone = state.calendars.filter((c) => c.source === 'system').map((c) => c.id);
    if (gone.length) { dropCalendars(gone); saveState(); changed('calendar'); }
    return;
  }
  const d = sysDriver();
  sysAccess = await d.access().catch((e) => ({ state: 'unavailable', canRequest: false, message: e instanceof Error ? e.message : String(e) }) as SystemAccess);
  if (sysAccess.state !== 'granted') return;
  const now = Date.now();
  let snap;
  try {
    snap = await d.snapshot(now - 31 * 86_400_000, now + 183 * 86_400_000);
  } catch {
    return; // unreachable right now: the copy on disk stays
  }
  const r = adoptSnapshot(state.calendars, snap);
  const before = JSON.stringify(state.calendars.filter((c) => c.source === 'system'));
  state.calendars = r.calendars;
  dropCalendars(r.removed);
  let any = before !== JSON.stringify(state.calendars.filter((c) => c.source === 'system'));
  for (const [id, list] of r.events) {
    if (JSON.stringify(events.get(id) ?? []) === JSON.stringify(list)) continue;
    events.set(id, list);
    saveEvents(id);
    any = true;
  }
  if (any) {
    saveState();
    changed('calendar');
  }
  if (sysAccess.live && !stopSysWatch && d.watch) {
    let t: NodeJS.Timeout | undefined;
    stopSysWatch = d.watch(() => { clearTimeout(t); t = setTimeout(() => void syncSystem(), 300); });
  }
}

/** Calendar access was just given elsewhere (the Permissions screen): look again now. */
export async function systemCalendarsChanged() {
  await load();
  if (state.prefs.systemCalendars === false || !featureOn('calendars')) return;
  sysAccess = await sysDriver().access(false).catch(() => sysAccess);
  if (sysAccess?.state !== 'granted') {
    // The running helper may not know yet; asking it answers at once now that macOS has the answer.
    sysAccess = await sysDriver().access(true).catch(() => sysAccess);
  }
  deps?.broadcast('pim-changed', 'calendar');
  if (sysAccess?.state === 'granted') await syncSystem();
}

/** Holidays and birthdays: worked out here, never downloaded. */
function refreshDerived() {
  const want: CalendarInfo[] = [];
  const cc = state.prefs.holidayCountry;
  const was = (id: string) => state.calendars.find((c) => c.id === id);
  if (cc && HOLIDAY_COUNTRIES[cc]) {
    const id = holidayCalendarId(cc);
    const w = was(id);
    want.push({ id, account: 'holidays', name: `Holidays · ${HOLIDAY_COUNTRIES[cc].name}`, color: w?.color ?? '#30d158', colorSet: w?.colorSet, url: '', readOnly: true, visible: w?.visible ?? true, island: w?.island, source: 'holidays', group: 'Holidays and birthdays', ref: cc });
    const y = new Date().getFullYear();
    events.set(id, holidayEvents(cc, new Date(y - 1, 0, 1).getTime(), new Date(y + 3, 0, 1).getTime(), id));
  }
  const withBirthday = contacts.filter((c) => c.birthday);
  if (state.prefs.birthdays !== false && withBirthday.length) {
    const w = was(BIRTHDAYS_CALENDAR);
    want.push({ id: BIRTHDAYS_CALENDAR, account: 'birthdays', name: 'Birthdays', color: w?.color ?? '#ff9f0a', colorSet: w?.colorSet, url: '', readOnly: true, visible: w?.visible ?? true, island: w?.island, source: 'birthdays', group: 'Holidays and birthdays' });
    events.set(BIRTHDAYS_CALENDAR, birthdayEvents(withBirthday, BIRTHDAYS_CALENDAR));
  }
  for (const c of state.calendars) if ((c.source === 'holidays' || c.source === 'birthdays') && !want.some((x) => x.id === c.id)) events.delete(c.id);
  state.calendars = [...state.calendars.filter((c) => c.source !== 'holidays' && c.source !== 'birthdays'), ...want];
}

/** The Island's old "calendar link" becomes a subscription in the calendar list (once per link). */
async function adoptIslandUrl(url: string | undefined) {
  const u = (url ?? '').trim();
  if (!u) return;
  await load();
  const norm = (x: string) => x.trim().replace(/^webcal:/i, 'https:').replace(/\/+$/, '');
  if ((state.islandUrls ?? []).includes(u)) return;
  state.islandUrls = [...(state.islandUrls ?? []), u];
  saveState();
  if (accounts.some((a) => a.kind === 'ics' && norm(a.caldav ?? '') === norm(u))) return;
  // A file path works as well as a web address (the Island accepted both).
  const a = await addAccount({ kind: 'ics', caldav: /^(https?|webcal):/i.test(u) ? u : `file://${u.replace(/^file:\/\//, '')}`, label: 'Calendar link' });
  await syncAccountCalendars(a).catch(() => undefined);
}
export { adoptIslandUrl as adoptIslandCalendarUrl };

/**
 * Every visible calendar's events in a range, for other pages (the Weather page's
 * trips, the Island). Stable: see PimApi.upcomingEvents.
 */
export async function upcomingEvents(from: number, to: number, opts: { withLocation?: boolean; limit?: number } = {}): Promise<UpcomingEvent[]> {
  await load();
  if (!featureOn('calendars') || !(to > from)) return [];
  return upcomingFrom(expandOccurrences(allEvents(), from, to), state.calendars, accounts, opts);
}

/** Where events come from and whether each may be read. Stable and cheap: see PimApi.calendarStatus. */
export async function calendarStatus(): Promise<CalendarStatus> {
  await load();
  let system: SystemAccess;
  if (!featureOn('calendars')) system = { state: 'unavailable', canRequest: false, raw: 'featureOff', message: 'Calendars are switched off (Settings → Features → Calendar and reminders).' };
  else if (state.prefs.systemCalendars === false) system = { state: 'unavailable', canRequest: false, raw: 'switchedOff', message: 'Reading this computer’s calendars is switched off.' };
  else system = sysAccess ?? (sysAccess = await sysDriver().access().catch((e) => ({ state: 'unavailable', canRequest: false, message: e instanceof Error ? e.message : String(e) }) as SystemAccess));
  return buildCalendarStatus({
    platform: process.platform, system, calendars: state.calendars,
    accounts: accounts.map((a) => ({ id: a.id, kind: a.kind, oauth: a.oauth, label: a.label, calendar: a.calendar, needsSignIn: needsSignIn.has(a.id) })),
  });
}

function allEvents(): CalEvent[] {
  const visible = new Set(state.calendars.filter((c) => c.visible).map((c) => c.id));
  return [...events.entries()].filter(([id]) => visible.has(id)).flatMap(([, l]) => l);
}

/** The master and every changed occurrence of one event (one calendar object). */
function family(calendar: string, uid: string): CalEvent[] {
  return (events.get(calendar) ?? []).filter((e) => e.uid === uid);
}

async function writeFamily(cal: CalendarInfo, uid: string, list: CalEvent[], removed = false) {
  const a = acct(cal.account);
  const current = family(cal.id, uid);
  const href = current[0]?.href;
  const etag = current[0]?.etag;
  if (cal.source === 'system') {
    const d = sysDriver();
    if (removed) {
      if (current[0] && d.remove) await d.remove(cal, current[0], { scope: 'all' });
    } else {
      if (!d.save) throw new Error('This calendar cannot be changed from Keeper');
      const id = await d.save(cal, list, { isNew: !href, scope: 'this' });
      if (id && !href) list = list.map((e) => ({ ...e, href: id }));
    }
    setTimeout(() => void syncSystem(), 1500).unref?.();
  } else if (cal.source) {
    throw new Error('This calendar cannot be changed');
  } else if (cal.account === LOCAL || !a) {
    // Kept on this computer only.
  } else if (a.oauth === 'microsoft') {
    const token = await accessToken(a.id, 'microsoft', clientFor('microsoft', state.prefs.clients)!, 'graph');
    if (removed) {
      if (href) await graphDelete(token, href);
    } else {
      const saved = await graphSave(token, cal.url, list[0]);
      list = list.map((e) => ({ ...e, href: saved.href, etag: saved.etag }));
    }
  } else {
    const auth = await davAuth(a);
    if (removed) {
      if (href) await deleteHref(href, auth, etag);
    } else {
      const saved = await putEvent(cal.url, auth, list, href ? { href, etag } : undefined);
      list = list.map((e) => ({ ...e, href: saved.href, etag: saved.etag }));
    }
  }
  const rest = (events.get(cal.id) ?? []).filter((e) => e.uid !== uid);
  events.set(cal.id, removed ? rest : [...rest, ...list]);
  saveEvents(cal.id);
  changed('calendar');
}

async function saveEvent(e: CalEvent, opts: { scope?: 'this' | 'all'; instance?: number } = {}): Promise<CalEvent> {
  await load();
  const calId = e.calendar || state.prefs.defaultCalendar || LOCAL_CAL;
  const cal = calOf(calId) ?? calOf(LOCAL_CAL)!;
  if (cal.readOnly) throw new Error('This calendar cannot be changed');
  const uid = e.uid || `${randomUUID()}@keeper`;
  let list = family(cal.id, uid);
  const master = list.find((x) => x.recurrenceId === undefined);
  const next: CalEvent = { ...e, uid, calendar: cal.id, id: `${cal.id}:${uid}` };
  if (opts.scope === 'this' && master?.rrule && opts.instance !== undefined) {
    // One occurrence changed: an override with RECURRENCE-ID next to the master.
    const o: CalEvent = { ...next, rrule: undefined, exdates: undefined, recurrenceId: opts.instance, id: `${cal.id}:${uid}:${opts.instance}`, href: master.href, etag: master.etag };
    list = [...list.filter((x) => x.recurrenceId !== opts.instance), o];
  } else if (master && next.recurrenceId === undefined) {
    // The whole series: move every changed occurrence by the same shift.
    const shift = next.start - master.start;
    list = [{ ...next, href: master.href, etag: master.etag }, ...list.filter((x) => x.recurrenceId !== undefined).map((x) => ({ ...x, start: x.start + shift, end: x.end + shift }))];
  } else {
    // A brand-new event, or one moved from another calendar.
    if (e.calendar && e.calendar !== cal.id) await deleteEvent(e.id, { scope: 'all' }).catch(() => undefined);
    list = [next];
  }
  await writeFamily(cal, uid, list);
  return list.find((x) => x.recurrenceId === (opts.scope === 'this' ? opts.instance : undefined)) ?? list[0];
}

async function deleteEvent(id: string, opts: { scope?: 'this' | 'all'; instance?: number } = {}) {
  await load();
  const ev = [...events.values()].flat().find((x) => x.id === id);
  if (!ev) return;
  const cal = calOf(ev.calendar);
  if (!cal || cal.readOnly) throw new Error('This calendar cannot be changed');
  const list = family(cal.id, ev.uid);
  const master = list.find((x) => x.recurrenceId === undefined);
  if (cal.source === 'system' && !master?.rrule) {
    // The system hands out each occurrence on its own: remove that one, or the whole series.
    const d = sysDriver();
    if (!d.remove) throw new Error('This calendar cannot be changed from Keeper');
    await d.remove(cal, ev, opts);
    events.set(cal.id, (events.get(cal.id) ?? []).filter((x) => (opts.scope === 'all' ? x.href !== ev.href : x.id !== ev.id)));
    saveEvents(cal.id);
    changed('calendar');
    setTimeout(() => void syncSystem(), 1500).unref?.();
    return;
  }
  if (opts.scope === 'this' && master?.rrule && opts.instance !== undefined) {
    const kept = list.filter((x) => x.recurrenceId !== opts.instance).map((x) => (x === master ? { ...x, exdates: [...(x.exdates ?? []), opts.instance!] } : x));
    await writeFamily(cal, ev.uid, kept);
  } else await writeFamily(cal, ev.uid, list, true);
}

let lastIsland = '';
function pushIsland() {
  if (!deps) return;
  const now = Date.now();
  const on = featureOn('calendars') && featureOn('calendar');
  const cals = new Map(state.calendars.map((c) => [c.id, c]));
  const occ = on ? expandOccurrences(allEvents(), now - 3_600_000, now + 2 * 86_400_000) : [];
  // The same meeting from two calendars (a subscribed copy and the system's) once.
  const seen = new Set<string>();
  const list = occ.filter((o) => !o.event.allDay && inIsland(cals.get(o.event.calendar))).filter((o) => { const k = `${o.event.title}|${o.start}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((o) => ({ uid: `${o.event.id}:${o.start}`, title: o.event.title, start: o.start, end: o.end, allDay: o.event.allDay, location: o.event.location, url: meetingLink(o.event) ?? (o.event.url && /^https:/i.test(o.event.url) ? o.event.url : undefined), color: cals.get(o.event.calendar)?.color }));
  const key = JSON.stringify(list);
  if (key === lastIsland) return;
  lastIsland = key;
  deps.islandEvents(list);
}

// ---------------------------------------------------------------- the clock (alarms, reminders, alerts, timers)

/** Reminders that rang and wait for Done or Snooze (the Island's live activity). */
const dueTasks = new Map<string, DueReminder>();

function pushDue() {
  deps?.islandReminders?.([...dueTasks.values()].sort((a, b) => a.at - b.at));
}

/** A task changed: it stops ringing once done, deleted, or moved to later. */
function settleDue(id: string) {
  if (!dueTasks.has(id)) return;
  const t = state.reminders.find((x) => x.id === id);
  const at = t && (t.remindAt ?? t.due);
  if (!t || t.done || at === undefined || at > Date.now()) {
    dueTasks.delete(id);
    pushDue();
  }
}

// ---------------------------------------------------------------- tasks: saving, completing, insights

/** Insights are kept unless switched off in Settings → Features. */
function logEntry(e: LogEntry) {
  if (!featureOn('insights')) return;
  state.log = addLog(state.log ?? [], e);
  saveState();
}

/** A focus session ended (from the Island): logged for Insights, and on its task. */
export async function logFocus(minutes: number, taskId?: string) {
  await load();
  const m = Math.round(minutes);
  if (m < 1) return;
  logEntry({ kind: 'focus', at: Date.now(), minutes: m, taskId });
  const t = taskId && state.reminders.find((x) => x.id === taskId);
  if (t) await writeTask({ ...t, focus: [...(t.focus ?? []), { at: Date.now(), minutes: m }].slice(-200) });
  else changed('reminders');
}

/** Saves one task here and, for an account's task list, on the server. */
async function writeTask(r: Reminder): Promise<Reminder> {
  const list = r.list || 'local';
  let next: Reminder = { ...r, list, id: r.id || `${list}:${randomUUID()}`, uid: r.uid ?? randomUUID(), created: r.created ?? Date.now() };
  const prev = state.reminders.find((x) => x.id === next.id);
  // Checked off: a repeating task rolls on to its next date; either way it counts in Insights.
  if (next.done && !prev?.done) {
    const c = completeTask({ ...next, done: false, doneAt: undefined });
    next = c.task;
    logEntry({ kind: 'task', at: Date.now(), taskId: next.id, title: next.title });
  }
  if (next.done && !next.doneAt) next.doneAt = Date.now();
  const cal = calOf(list);
  const a = cal && acct(cal.account);
  if (cal && a && !a.oauth) next = { ...next, ...(await putTodo(cal.url, await davAuth(a), next)) };
  state.reminders = [...state.reminders.filter((x) => x.id !== next.id), next];
  saveState();
  changed('reminders');
  settleDue(next.id);
  return next;
}

function armClock() {
  clearTimeout(clockTimer);
  if (!deps) return;
  const now = Date.now();
  const on = { alarms: featureOn('alarms'), cal: featureOn('calendars') };
  const r = dueNow({
    alarms: on.alarms ? state.alarms : [],
    occurrences: on.cal ? expandOccurrences(allEvents(), now - 20 * 60_000, now + 2 * 86_400_000) : [],
    reminders: on.cal ? state.reminders : [],
    timers: on.alarms ? state.timers : [],
    fired: new Set(state.fired.map((f) => f.key)),
  }, lastCheck, now);
  lastCheck = now;
  for (const d of r.due) ring(d);
  deps.islandTimers(on.alarms ? state.timers.map((t) => ({ id: t.id, label: t.label, endsAt: t.endsAt, leftMs: t.leftMs, durationMs: t.durationMs })) : []);
  // Long timers drift; look again at least every 10 minutes (cheap: a few comparisons).
  const wait = r.next === undefined ? 10 * 60_000 : Math.min(Math.max(250, r.next - now), 10 * 60_000);
  clockTimer = setTimeout(armClock, wait);
}

function ring(d: Due) {
  state.fired.push({ key: dueKey(d), at: Date.now() });
  const r: Ring = d.kind === 'event' ? { kind: 'event', id: d.id, title: d.title, at: d.at, late: d.late, start: d.start, location: d.location, url: d.url } : { kind: d.kind, id: d.id, title: d.title, at: d.at, late: d.late };
  if (d.kind === 'alarm') {
    const a = state.alarms.find((x) => x.id === d.id);
    if (a) {
      a.lastFired = d.at;
      a.snoozedUntil = undefined;
      if (!a.days.length) a.enabled = false;
    }
    ringing.set(d.id, r);
  }
  if (d.kind === 'timer') {
    state.timers = state.timers.filter((t) => t.id !== d.id);
    ringing.set(d.id, r);
  }
  saveState();
  const detail = d.kind === 'event' ? `${new Date(d.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${d.location ? ` · ${d.location}` : ''}` : d.kind === 'timer' ? 'Time is up' : d.kind === 'reminder' ? 'Reminder' : `Alarm${d.late ? ' (while the computer was asleep)' : ''}`;
  if (Notification.isSupported()) {
    const n = new Notification({ title: d.title, body: detail, silent: false, urgency: d.kind === 'alarm' ? 'critical' : 'normal', timeoutType: d.kind === 'alarm' ? 'never' : 'default' });
    n.on('click', () => deps?.broadcast('navigate', d.kind === 'event' ? 'calendar' : d.kind === 'reminder' ? 'reminders' : 'alarms'));
    n.show();
  }
  if (d.kind === 'reminder') {
    dueTasks.set(d.id, { id: d.id, title: d.title, at: d.at });
    pushDue();
  }
  deps?.alert(d.title, detail, d.kind === 'reminder' ? 'reminder' : undefined);
  deps?.broadcast('pim-ring', r);
  changed(d.kind === 'reminder' ? 'reminders' : 'alarms');
}

async function scheduleWake(id: string): Promise<{ ok: boolean; message: string }> {
  const a = state.alarms.find((x) => x.id === id);
  const t = a && nextAlarmTime(a, Date.now());
  if (!t) return { ok: false, message: 'This alarm has no next time' };
  if (process.platform !== 'darwin') {
    return { ok: false, message: process.platform === 'win32' ? 'Windows can wake for a scheduled task with “Wake the computer to run this task” in Task Scheduler; Keeper cannot set that up yet.' : 'Linux can wake from sleep with rtcwake (needs administrator rights); Keeper cannot set that up yet.' };
  }
  const d = new Date(t - 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const when = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  const { run } = await import('../../../core/platform');
  const r = await run('osascript', ['-e', `do shell script "pmset schedule wake '${when}'" with administrator privileges`], 120_000);
  return r.ok ? { ok: true, message: `The Mac will wake at ${d.toLocaleTimeString()}` } : { ok: false, message: 'The Mac did not schedule a wake (the password prompt was cancelled)' };
}

// ---------------------------------------------------------------- AI

/** The AI chosen in Settings → AI & Brain (on this computer first when that is what the person chose). */
async function aiProvider() {
  const { providerForConnection, brainSettings } = await import('../brain');
  const b = brainSettings();
  const p = await providerForConnection(b.active);
  if (b.localOnly && !p.local) throw new Error('You chose to use only AIs on this computer (Settings → AI & Brain)');
  // Keys, passwords and card numbers never leave the computer.
  const clean = (t: string) => (p.local ? t : redact(t).text);
  const ask = async (system: string, user: string, maxTokens = 1200) => (await p.chat([{ role: 'system', content: `${system} Today is ${new Date().toDateString()}.` }, { role: 'user', content: user }], [], { maxTokens })).text.trim();
  return { clean, ask };
}

async function threadText(id: string): Promise<{ text: string; last?: MessageSummary }> {
  const { account, folder } = splitId(id);
  const list = await cachedMessages(account, folder);
  const me = list.find((m) => m.id === id);
  // The conversation across folders (your replies in Sent belong to it too).
  const pool = me ? [...list, ...(await cachedOf('sent', account))] : [];
  const thread = me ? threadMessages(pool).find((t) => t.messages.some((m) => m.id === id)) : undefined;
  const msgs = thread?.messages ?? (me ? [me] : []);
  const parts: string[] = [];
  for (const m of msgs.slice(-8)) {
    const o = await openMessage(m.id, { markRead: false }).catch(() => null);
    const text = (o?.text ?? m.snippet).slice(0, 6000);
    parts.push(`From: ${m.from?.name ?? ''} <${m.from?.address ?? ''}>\nDate: ${new Date(m.date).toString()}\nSubject: ${m.subject}\n\n${text}`);
  }
  return { text: parts.join('\n\n---\n\n'), last: msgs[msgs.length - 1] };
}

async function aiOnThread(id: string, task: MailAiTask, opts: { lang?: string } = {}) {
  const ai = await aiProvider();
  const { text, last } = await threadText(id);
  // Sign-in codes, password resets and sign-in alerts never go to an AI.
  if (last && (isSecurityAlert(last) || hasSignInCode(`${last.subject}\n${last.snippet}`))) throw new Error('Keeper does not send security mail (sign-in codes, password resets) to an AI');
  const body = ai.clean(text);
  const system = 'You help with email.';
  if (task === 'replies') {
    // Three different answers, written the way the person writes.
    const samples = voiceSamples(await cachedOf('sent', splitId(id).account), myAddresses());
    const voice = samples.length ? `\n\nHow I write (lines from my own sent mail, match this tone, length and greeting style):\n${samples.map((x) => `- ${ai.clean(x)}`).join('\n')}` : '';
    const r = await ai.ask(system, `Write three different short replies to the last message in this conversation, as me, in the same language as that message: 1) a yes / positive answer, 2) a reply that asks a question or suggests something else, 3) a polite no or "not now". Only the reply texts, no subject lines, no signatures, separated by a line containing only ===.${voice}\n\n${body}`);
    const options = splitSuggestions(r);
    return { text: options[0] ?? r, options };
  }
  if (task === 'translate') {
    const lang = opts.lang || 'English';
    return { text: await ai.ask(system, `Translate the last message of this conversation into ${lang}. Keep the meaning, names and numbers; only the translation.\n\n${body}`, 2000) };
  }
  const ask = {
    summarize: 'Summarize this email conversation in 3–6 short bullet points: what it is about, what was decided, and anything the reader needs to do (with dates). Plain text.',
    reply: 'Draft a short, friendly reply to the last message in this conversation, in the same language. Only the reply text, no subject line, no signature.',
    extract: 'List every event, meeting, appointment or deadline in this conversation, one per line, each as a short plain-English phrase with its date and time, starting with "EVENT: " (e.g. "EVENT: Dinner with Ana Friday 7pm at Café Sol"). Use absolute dates. If there are none, answer "NONE".',
  }[task];
  const r = await ai.ask(system, `${ask}\n\n${body}`);
  if (task !== 'extract') return { text: r };
  const evs = r.split('\n').filter((l) => /^EVENT:/i.test(l.trim())).map((l) => parseQuickAdd(l.trim().slice(6))).filter((x): x is NonNullable<typeof x> => !!x);
  return { text: r, events: evs };
}

/** Rewrites a draft (shorter, friendlier, more formal, proofread) or translates it. */
async function aiWrite(text: string, task: WriteTask, lang?: string): Promise<string> {
  if (!text.trim()) return text;
  const ai = await aiProvider();
  const { writingPrompt, cleanWritingReply } = await import('../writing');
  const prompt = task === 'translate'
    ? `Translate this email into ${lang || 'English'}, keeping its tone, names, numbers and line breaks.\n\nReply with the resulting text only — no introduction, quotes or notes.\n\n<text>\n${ai.clean(text)}\n</text>`
    : writingPrompt(task, ai.clean(text));
  return cleanWritingReply(await ai.ask('You help write email.', prompt, 3000));
}

/** "When does my flight leave?": answered from the mail that best fits, with those messages as sources. */
async function askMail(question: string): Promise<{ answer: string; sources: MessageSummary[] }> {
  const ai = await aiProvider();
  const ctx = await triageCtx();
  // Security mail (codes, password resets) is never sent to an AI.
  const all = (await cachedEverywhere()).filter((m) => !classify(m, ctx).security);
  const picked = pickForQuestion(question, all, 8);
  if (!picked.length) return { answer: 'Nothing in the mail kept on this computer matches that question.', sources: [] };
  const parts: string[] = [];
  for (const [i, m] of picked.entries()) {
    const o = i < 5 ? await openMessage(m.id, { markRead: false }).catch(() => null) : null;
    parts.push(`[${i + 1}] From: ${m.from?.name ?? ''} <${m.from?.address ?? ''}> · ${new Date(m.date).toDateString()} · ${m.subject}\n${(o?.text ?? m.snippet).slice(0, 3000)}`);
  }
  const answer = await ai.ask('You answer questions about the person\'s own email. Use only the messages given; cite them like [1]. If they do not contain the answer, say so.', `Question: ${question}\n\nMessages:\n\n${ai.clean(parts.join('\n\n'))}`, 800);
  return { answer, sources: picked };
}

/** One-click unsubscribe (RFC 8058) when offered, else by mail, else the sender's page. */
async function unsubscribeWith(u: NonNullable<OpenMessage['unsubscribe']>, account: string): Promise<{ done: boolean; how: string }> {
  if (u.url && u.oneClick) {
    const res = await fetch(u.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }).catch(() => null);
    if (res?.ok) return { done: true, how: 'Unsubscribed' };
  }
  if (u.mailto) {
    const m = new URL(u.mailto);
    const a = acct(account);
    if (a?.smtp) {
      await queue({ account: a.id, to: [{ address: decodeURIComponent(m.pathname) }], cc: [], bcc: [], subject: m.searchParams.get('subject') ?? 'unsubscribe', body: m.searchParams.get('body') ?? 'unsubscribe', sendAt: Date.now(), markdown: false });
      return { done: true, how: 'An unsubscribe request was sent by mail' };
    }
  }
  if (u.url) {
    await shell.openExternal(u.url);
    return { done: false, how: 'The sender’s unsubscribe page opened in your browser' };
  }
  return { done: false, how: 'Could not unsubscribe automatically' };
}

// ---------------------------------------------------------------- rules, blocked senders and muted conversations on arrival

/** What happens to new inbox mail; true when something moved (the list is read again). */
async function arrivalActions(a: Account, folder: string, added: MessageSummary[]): Promise<boolean> {
  const blocked = state.prefs.blockedSenders ?? [];
  const muted = state.muted ?? [];
  const rules = (state.rules as Rule[]).filter((x) => x.enabled && (!x.account || x.account === a.id));
  if (!blocked.length && !muted.length && !rules.length) return false;
  let moved = false;
  const box = mailbox(a);
  for (const m of added) {
    try {
      if (isBlocked(m.from, blocked)) {
        const junk = await folderOf(a, 'junk');
        if (junk) { await box.move(folder, [m.uid], junk); moved = true; }
        continue;
      }
      if (isMuted(m, muted)) {
        // A muted conversation: read, and out of the inbox.
        await box.setFlags(folder, [m.uid], '\\Seen', true);
        const arch = (await folderOf(a, 'archive')) ?? (await folderOf(a, 'all'));
        if (arch) { await box.move(folder, [m.uid], arch); moved = true; }
        continue;
      }
      const hits = evaluateRules(rules, m);
      if (!hits.length) continue;
      const plan = planActions(hits.flatMap((h) => h.actions));
      if (plan.read) await box.setFlags(folder, [m.uid], '\\Seen', true);
      if (plan.flag) await box.setFlags(folder, [m.uid], '\\Flagged', true);
      for (const l of plan.labels) await box.setFlags(folder, [m.uid], l, true);
      if (plan.dest) {
        const dest = plan.dest.kind === 'move' ? plan.dest.folder : plan.dest.kind === 'archive' ? (await folderOf(a, 'archive')) ?? (await folderOf(a, 'all')) : undefined;
        if (plan.dest.kind === 'trash') await box.remove(folder, [m.uid], await folderOf(a, 'trash'));
        else if (dest) await box.move(folder, [m.uid], dest);
        moved = true;
      }
      if (plan.read || plan.flag || plan.labels.length) moved = true;
    } catch {
      // One message failing (a folder gone) does not stop the rest.
    }
  }
  return moved;
}

// ---------------------------------------------------------------- the Dock badge

let badgeTimer: NodeJS.Timeout | undefined;
let lastBadge = -1;
async function updateBadge() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(async () => {
    const mode = state.prefs.dockBadge ?? 'all';
    const ctx = await triageCtx();
    const inbox = mode === 'off' ? [] : (await cachedOf('inbox')).filter((m) => !isBlocked(m.from, state.prefs.blockedSenders ?? [])).map((m) => withTriage(m, ctx));
    const n = badgeCount(inbox, mode);
    if (n !== lastBadge) { lastBadge = n; deps?.badge?.(n); }
  }, 400);
}

// ---------------------------------------------------------------- snooze on every computer

/** Messages snoozed on another computer (their keyword) are snoozed here too; ones woken there come back here. */
function adoptSyncedSnoozes(list: MessageSummary[]) {
  const now = Date.now();
  const mine = new Map((state.snoozes ?? []).map((x) => [x.id, x.until]));
  let touched = false;
  for (const m of list) {
    const t = m.syncedSnooze;
    if (t && t > now && mine.get(m.id) !== t && !(m.returnedAt && m.returnedAt >= t)) {
      m.snoozedUntil = t;
      state.snoozes = [...(state.snoozes ?? []).filter((x) => x.id !== m.id), { id: m.id, until: t }];
      touched = true;
    } else if (!t && mine.has(m.id) && m.snoozedUntil && (state.snoozeSync ?? []).some((e) => e.messageId === m.messageId && e.done)) {
      m.snoozedUntil = undefined;
      state.snoozes = (state.snoozes ?? []).filter((x) => x.id !== m.id);
      touched = true;
    }
  }
  if (touched) { saveState(); armSnooze(); }
}

/** Tells the server (and so the person's other computers) about a snooze, or that it ended. */
async function shareSnooze(ids: string[], until: number | null) {
  for (const g of byFolder(ids).values()) {
    const msgs = (await cachedMessages(g.a.id, g.folder)).filter((m) => g.uids.includes(m.uid));
    const now = Date.now();
    state.snoozeSync = mergeEntries(state.snoozeSync ?? [], msgs.filter((m) => m.messageId).map((m) => ({ messageId: m.messageId!, until: until ?? 0, at: now, done: until === null || undefined })));
    try {
      const box = mailbox(g.a);
      if (await box.keepsKeywords(g.folder)) {
        for (const m of msgs) {
          for (const k of [m.syncedSnooze].filter((x): x is number => !!x)) await box.setFlags(g.folder, [m.uid], snoozeKeyword(k), false);
          if (until) await box.setFlags(g.folder, [m.uid], snoozeKeyword(until), true);
          m.syncedSnooze = until ?? undefined;
        }
      } else {
        // No keywords here: a small note in a hidden folder carries the snoozes.
        await box.ensureFolder(SNOOZE_FOLDER);
        const prev = await box.newestText(SNOOZE_FOLDER).catch(() => undefined);
        const all = mergeEntries(prev ? readNote(prev.text) : [], state.snoozeSync ?? []);
        const { raw } = await compose({ from: identityOf(g.a), to: [identityOf(g.a)], cc: [], bcc: [], subject: NOTE_SUBJECT, text: noteBody(all, now) });
        await box.append(SNOOZE_FOLDER, raw, ['\\Seen']);
        if (prev) await box.remove(SNOOZE_FOLDER, [prev.uid]).catch(() => undefined);
      }
    } catch {
      // Offline: the snooze still holds here.
    }
  }
  saveState();
}

/** Servers without keywords: the hidden folder's note, read when the inbox is checked. */
async function readSnoozeNote(a: Account) {
  try {
    const box = mailbox(a);
    if (await box.keepsKeywords('INBOX')) return;
    const note = await box.newestText(SNOOZE_FOLDER);
    if (!note) return;
    const remote = readNote(note.text);
    state.snoozeSync = mergeEntries(state.snoozeSync ?? [], remote);
    const inbox = await cachedMessages(a.id, 'INBOX');
    const byMid = new Map(inbox.filter((m) => m.messageId).map((m) => [m.messageId!, m]));
    const { snooze, wake } = adoptRemote(inbox.map((m) => ({ messageId: m.messageId, until: m.snoozedUntil })), remote, Date.now());
    for (const x of snooze) { const m = byMid.get(x.messageId); if (m) m.syncedSnooze = x.until; }
    for (const mid of wake) { const m = byMid.get(mid); if (m) Object.assign(m, { snoozedUntil: undefined }); state.snoozes = (state.snoozes ?? []).filter((s) => s.id !== m?.id); }
    adoptSyncedSnoozes(inbox);
  } catch {
    // No note yet, or offline.
  }
}

// ---------------------------------------------------------------- remind me if no reply

let noReplyTimer: NodeJS.Timeout | undefined;
function armNoReply() {
  clearTimeout(noReplyTimer);
  const list = state.noReply ?? [];
  if (!list.length) return;
  const next = Math.min(...list.map((r) => r.at));
  noReplyTimer = setTimeout(() => void checkNoReply(), Math.max(1000, Math.min(next - Date.now(), 2_147_000_000)));
}

async function checkNoReply() {
  const list = state.noReply ?? [];
  if (!list.length) return;
  const pool = [...(await cachedOf('inbox')), ...(await cachedOf('archive'))];
  const { due, answered, waiting } = sortReminders(list, pool, myAddresses(), Date.now());
  state.noReply = waiting;
  for (const r of due) {
    const who = r.to.map((x) => x.name || x.address).join(', ');
    deps?.alert(`No reply yet from ${who}`, r.subject, 'mail', r.id);
    if (Notification.isSupported()) {
      const n = new Notification({ title: `No reply yet from ${who}`, body: r.subject });
      n.on('click', () => deps?.broadcast('navigate', r.id ? `mail:${r.id}` : 'mail'));
      n.show();
    }
  }
  if (due.length || answered.length) { saveState(); changed('mail'); }
  armNoReply();
}

// ---------------------------------------------------------------- undo (⌘Z) for archive, delete and move

type UndoStep = { label: string; moves: { account: string; from: string; to: string; uids: number[]; mids: string[] }[] };
const undoStack: UndoStep[] = [];

/** A message an app prepared over MCP, waiting for the person in Keeper's compose window. */
let staged: (Draft & { account: string }) | null = null;
function stageCompose(d: Draft & { account: string }) {
  staged = d;
  deps?.broadcast('pim-changed', 'staged');
  deps?.show?.('mail:staged');
}

/** Moves messages and remembers how to bring them back. */
async function moveRecorded(ids: string[], dest: (a: Account) => Promise<string | undefined>, label: string, opts: { trash?: boolean } = {}) {
  const step: UndoStep = { label, moves: [] };
  for (const g of byFolder(ids).values()) {
    const to = await dest(g.a);
    const list = await cachedMessages(g.a.id, g.folder);
    const mids = list.filter((m) => g.uids.includes(m.uid) && m.messageId).map((m) => m.messageId!);
    applyLocal(g.uids.map((u) => `${g.a.id}:${g.folder}:${u}`), null);
    if (opts.trash) {
      await serverOp({ kind: 'remove', account: g.a.id, folder: g.folder, uids: g.uids, trash: to });
      if (!to || to === g.folder) continue;
    } else {
      if (!to) throw new Error(`${g.a.label} has no folder for that`);
      await serverOp({ kind: 'move', account: g.a.id, folder: g.folder, uids: g.uids, dest: to });
    }
    step.moves.push({ account: g.a.id, from: g.folder, to: to!, uids: g.uids, mids });
  }
  if (step.moves.length) { undoStack.push(step); if (undoStack.length > 20) undoStack.shift(); }
}

async function undoLast(): Promise<string | null> {
  const step = undoStack.pop();
  if (!step) return null;
  for (const mv of step.moves) {
    const a = acct(mv.account);
    if (!a) continue;
    const box = mailbox(a);
    // Find them where they went (by Message-ID: the server gave them new uids).
    const uids: number[] = [];
    for (const mid of mv.mids) uids.push(...(await box.byMessageId(mv.to, mid).catch(() => [] as number[])));
    if (uids.length) await box.move(mv.to, uids, mv.from);
    await refreshFolder(a, mv.from).catch(() => undefined);
  }
  changed('mail');
  return step.label;
}

// ---------------------------------------------------------------- search

/** Local results first (this computer's cache), then the servers' older ones, newest first within each. */
async function searchMail(query: string, opts: { account?: string; limit?: number; server?: boolean } = {}): Promise<{ messages: MessageSummary[]; local: number }> {
  await load();
  const q = parseMailQuery(query);
  const ctx = await triageCtx();
  const labels = new Map(accounts.map((a) => [a.id, a.label]));
  const folders = new Map<string, string | undefined>();
  for (const a of accounts.filter((x) => x.mail)) for (const f of await mailbox(a).cachedFolders()) folders.set(fkey(a.id, f.path), f.special);
  const pool = (await cachedEverywhere(opts.account, true)).map((m) => withTriage(m, ctx));
  const local = pool.filter((m) => matchMailQuery(m, q, { special: folders.get(fkey(m.account, m.folder)), accountLabel: labels.get(m.account) }));
  let server: MessageSummary[] = [];
  if (opts.server) server = await serverSearch(q, opts.account);
  const all = orderResults(local, server);
  const limit = opts.limit ?? 500;
  const localCount = Math.min(limit, all.filter((m) => !server.includes(m)).length);
  return { messages: all.slice(0, limit), local: localCount };
}

async function serverSearch(q: ReturnType<typeof parseMailQuery>, account?: string): Promise<MessageSummary[]> {
  const crit = imapCriteria(q);
  if (!crit) return [];
  const ctx = await triageCtx();
  const found: MessageSummary[] = [];
  for (const a of accounts.filter((x) => x.mail && (!account || x.id === account))) {
    const where = new Set<string>(['INBOX']);
    for (const sp of ['sent', 'archive', 'all'] as const) { const f = await folderOf(a, sp); if (f) where.add(f); }
    for (const f of where) {
      try {
        const known = new Set((await cachedMessages(a.id, f)).map((m) => m.uid));
        const uids = (await mailbox(a).searchWith(f, crit)).filter((u) => !known.has(u)).slice(0, 40);
        found.push(...(await mailbox(a).summaries(f, uids)));
      } catch {
        // Offline or refused: the local results stand.
      }
    }
  }
  return mergeResults([], found.map((m) => withTriage(m, ctx)).filter((m) => matchMailQuery(m, { ...q, words: [], not: [] })));
}

// ---------------------------------------------------------------- rules on the server

async function writeServerRules(): Promise<{ account: string; label: string; ok: boolean; message: string }[]> {
  await load();
  const rules = state.rules as Rule[];
  const out: { account: string; label: string; ok: boolean; message: string }[] = [];
  for (const a of accounts.filter((x) => x.mail)) {
    const mine = rules.filter((r) => r.server && (!r.account || r.account === a.id));
    const had = (state.gmailFilters?.[a.id]?.length ?? 0) > 0 || !!state.serverRules?.[a.id];
    if (!mine.length && !had) continue;
    let res: { ok: boolean; message: string };
    try {
      if (a.oauth === 'google') {
        const client = clientFor('google', state.prefs.clients);
        if (!client) throw new Error('This copy of Keeper has no Google sign-in');
        const token = await accessToken(a.id, 'google', client);
        const { syncGmailFilters } = await import('./gmail-filters');
        const r = await syncGmailFilters(token, mine, state.gmailFilters?.[a.id] ?? []);
        state.gmailFilters = { ...state.gmailFilters, [a.id]: r.owned };
        res = { ok: true, message: `${r.written} Gmail filter${r.written === 1 ? '' : 's'} written${r.skipped ? ` · ${r.skipped} need Keeper (“any of” rules)` : ''}` };
      } else if (a.imap && !a.oauth) {
        const auth = await mailAuth(a);
        if (!('pass' in auth)) throw new Error('needs a password');
        const { putActiveScript } = await import('./managesieve');
        const target = { host: a.imap.host, port: Number(process.env.KEEPER_SIEVE_PORT) || 4190, user: auth.user, pass: auth.pass, insecure: a.insecureTls, plain: a.imap.security === 'none' };
        const [archive, trash] = [await folderOf(a, 'archive'), await folderOf(a, 'trash')];
        const script = toSieve(mine, { archive, trash });
        const r = await putActiveScript(target, SIEVE_SCRIPT, script);
        res = { ok: true, message: `Written to the server as a Sieve script${r.extensions.length ? '' : ''}` };
      } else {
        res = { ok: false, message: 'This provider has no way for Keeper to write rules; they run in Keeper.' };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res = { ok: false, message: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|did not answer/.test(msg) ? 'The server does not offer ManageSieve; the rules run in Keeper while it is open.' : msg };
    }
    state.serverRules = { ...state.serverRules, [a.id]: { ...res, at: Date.now() } };
    out.push({ account: a.id, label: a.label, ...res });
  }
  saveState();
  return out;
}

// ---------------------------------------------------------------- AI writing, with the person's memory

async function aiCompose(r: { req: string; draft: string; tone?: string; instruction?: string; lang?: string; replyTo?: string }): Promise<string> {
  const { providerForConnection, brainSettings } = await import('../brain');
  const b = brainSettings();
  const p = await providerForConnection(b.active);
  if (b.localOnly && !p.local) throw new Error('You chose to use only AIs on this computer (Settings → AI & Brain)');
  const clean = (t: string) => (p.local ? t : redact(t).text);
  const memory = state.prefs.aiMemory ?? [];
  // A line to remember, written as an instruction ("remember that I sign as Ana").
  const keep = r.instruction ? rememberIn(r.instruction) : undefined;
  if (keep) {
    state.prefs.aiMemory = cleanMemory([...memory, keep]);
    saveState();
    return r.draft;
  }
  let thread: string | undefined;
  if (r.replyTo) {
    const last = (await cachedMessages(splitId(r.replyTo).account, splitId(r.replyTo).folder)).find((m) => m.id === r.replyTo);
    if (last && (isSecurityAlert(last) || hasSignInCode(`${last.subject}\n${last.snippet}`))) throw new Error('Keeper does not send security mail (sign-in codes, password resets) to an AI');
    thread = clean((await threadText(r.replyTo)).text).slice(0, 20_000);
  }
  const prompt = r.draft.trim() && !r.instruction ? rewritePrompt(clean(r.draft), { tone: r.tone, lang: r.lang }, memory) : draftPrompt(r.instruction ?? 'Write a short reply.', { draft: clean(r.draft), thread, memory });
  let sofar = '';
  let last = 0;
  const res = await p.chat([{ role: 'system', content: `You help write email. Today is ${new Date().toDateString()}.` }, { role: 'user', content: prompt }], [], {
    maxTokens: 3000,
    onDelta: (d: string) => {
      sofar += d;
      if (Date.now() - last > 60) { last = Date.now(); deps?.broadcast('pim-ai-stream', { req: r.req, text: sofar }); }
    },
  });
  const { cleanWritingReply } = await import('../writing');
  const text = cleanWritingReply(res.text.trim() || sofar);
  deps?.broadcast('pim-ai-stream', { req: r.req, text, done: true });
  return text;
}

// ---------------------------------------------------------------- printing and Quick Look

async function printableHtml(id: string, allowRemote = false): Promise<string> {
  const o = await openMessage(id, { markRead: false, allowRemote });
  const s = o.summary;
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const who = (l: Address[]) => esc(l.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', '));
  const head = `<table style="font:12px -apple-system,system-ui,sans-serif;color:#333;margin-bottom:12px">${[['From', s.from ? who([s.from]) : ''], ['To', who(s.to)], s.cc.length ? ['Cc', who(s.cc)] : null, ['Date', esc(new Date(s.date).toLocaleString())], ['Subject', esc(s.subject)]].filter(Boolean).map((r) => `<tr><td style="padding:1px 10px 1px 0;color:#777">${r![0]}</td><td>${r![1]}</td></tr>`).join('')}</table><hr style="border:none;border-top:1px solid #ccc">`;
  const csp = `default-src 'none'; img-src data:${allowRemote ? ' https: http:' : ''}; style-src 'unsafe-inline'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${esc(s.subject)}</title><style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:24px;color:#111}img{max-width:100%}</style></head><body>${head}${o.html}</body></html>`;
}

async function attachmentPreview(id: string, att: string) {
  const { filename, content } = await rawAttachment(id, att);
  const o = await openMessage(id, { markRead: false });
  const meta = o.attachments.find((x) => x.id === att);
  const type = meta?.contentType ?? 'application/octet-stream';
  const out: { filename: string; contentType: string; size: number; data?: string; text?: string } = { filename, contentType: type, size: content.length };
  if (content.length > 20 * 1024 * 1024) return out;
  if (/^image\/(png|jpe?g|gif|webp|bmp)$|^application\/pdf$/i.test(type) || /\.(png|jpe?g|gif|webp|pdf)$/i.test(filename)) out.data = content.toString('base64');
  else if (/^text\/|json|xml|csv|calendar|vcard/i.test(type) || /\.(txt|md|csv|log|json|xml|ics|vcf)$/i.test(filename)) out.text = content.toString('utf8').slice(0, 500_000);
  return out;
}

// ---------------------------------------------------------------- catching up after sleep or a network change

let lastNet = '';
function netSignature(): string {
  const ifs = os.networkInterfaces();
  return Object.entries(ifs).flatMap(([n, l]) => (l ?? []).filter((x) => !x.internal).map((x) => `${n}:${x.address}`)).sort().join(',');
}
let catchUpTimer: NodeJS.Timeout | undefined;
function catchUp() {
  clearTimeout(catchUpTimer);
  // A few seconds for the network to come up.
  catchUpTimer = setTimeout(() => {
    for (const a of accounts.filter((x) => x.mail)) {
      void refreshFolder(a, 'INBOX').catch(() => undefined);
      void readSnoozeNote(a);
    }
    if (state.pendingOps?.length) for (const a of accounts) void replayOps(a.id);
    void flushOutbox();
    void checkNoReply();
  }, 4000);
}

// ---------------------------------------------------------------- the API

// ---------------------------------------------------------------- import and export

const LOCAL_MAIL = 'local-mail';

/** The "On this computer" mail account, made the first time something is imported. */
async function localMailAccount(): Promise<Account> {
  await load();
  let a = acct(LOCAL_MAIL);
  if (!a) {
    a = { id: LOCAL_MAIL, kind: 'local', label: 'On this computer', identities: [], mail: true, calendar: false, contacts: false, color: '#8e8e93' };
    accounts.push(a);
    await saveAccounts(accounts);
    changed('accounts');
  }
  return a;
}

const importHost: ImportHost = {
  progress: (p) => deps?.broadcast('pim-import', p),
  async localMail() {
    const a = await localMailAccount();
    return { account: a.id, box: mailbox(a) as LocalMailbox };
  },
  async mailChanged(folders) {
    const a = acct(LOCAL_MAIL);
    if (!a) return;
    await mailbox(a).folders();
    for (const f of new Set(folders)) {
      folderCache.set(fkey(a.id, f), (await mailbox(a).sync(f)).messages);
      firstSync.add(fkey(a.id, f));
    }
    ctxCache = null;
    changed('mail', { account: a.id });
  },
  async addEvents(evs, opts) {
    await load();
    let cal = opts.calendar ? calOf(opts.calendar) : undefined;
    const created = !cal;
    if (!cal) {
      cal = { id: `${LOCAL}:cal:${randomUUID().slice(0, 8)}`, account: LOCAL, name: opts.name || 'Imported', color: COLORS[state.calendars.length % COLORS.length], url: '', readOnly: false, visible: true, colorSet: true };
      state.calendars.push(cal);
      events.set(cal.id, []);
      saveState();
    }
    if (cal.readOnly) throw new Error('This calendar cannot be changed');
    const byUid = new Map<string, CalEvent[]>();
    for (const e of evs) byUid.set(e.uid, [...(byUid.get(e.uid) ?? []), { ...e, calendar: cal.id, id: `${cal.id}:${e.uid}${e.recurrenceId !== undefined ? `:${e.recurrenceId}` : ''}`, href: undefined, etag: undefined }]);
    if (cal.account === LOCAL && !cal.source) {
      // On this computer: written at once, not one at a time (thousands of events load quickly).
      const rest = (events.get(cal.id) ?? []).filter((e) => !byUid.has(e.uid));
      events.set(cal.id, [...rest, ...[...byUid.values()].flat()]);
      saveEvents(cal.id);
      changed('calendar');
    } else for (const [uid, list] of byUid) await writeFamily(cal, uid, list);
    return { calendar: cal.id, created, uids: [...byUid.keys()] };
  },
  async removeEvents(calendar, uids, dropCalendar) {
    await load();
    const cal = calOf(calendar);
    if (!cal) return;
    if (dropCalendar && cal.account === LOCAL) {
      events.delete(cal.id);
      void fsp.rm(files.events(cal.id), { force: true });
      state.calendars = state.calendars.filter((c) => c.id !== cal.id);
      saveState();
      changed('calendar');
      return;
    }
    if (cal.account === LOCAL) {
      const gone = new Set(uids);
      events.set(cal.id, (events.get(cal.id) ?? []).filter((e) => !gone.has(e.uid)));
      saveEvents(cal.id);
      changed('calendar');
    } else for (const uid of uids) await writeFamily(cal, uid, [], true);
  },
  reminders: () => state.reminders,
  async addReminders(list) {
    await load();
    state.reminders = [...state.reminders, ...list];
    saveState();
    changed('reminders');
  },
  async removeReminders(ids) {
    await load();
    const gone = new Set(ids);
    state.reminders = state.reminders.filter((r) => !gone.has(r.id));
    saveState();
    changed('reminders');
  },
  contacts: () => contacts,
  async addContacts(list) {
    await load();
    contacts = [...contacts, ...list];
    void writeJson(files.contacts(), contacts);
    changed('contacts');
  },
  async removeContacts(ids) {
    await load();
    const gone = new Set(ids);
    contacts = contacts.filter((c) => !gone.has(c.id));
    void writeJson(files.contacts(), contacts);
    changed('contacts');
  },
  async signInToken(provider, scopes) {
    await load();
    const client = clientFor(provider, state.prefs.clients);
    if (!client) throw new Error(`This copy of Keeper has no ${provider === 'google' ? 'Google' : 'Microsoft'} sign-in set up. Export a file from the app instead, or add a client ID in Settings → Mail & Calendar.`);
    // Used for this import only: the token is never written anywhere.
    return (await signIn(provider, client, undefined, undefined, scopes)).access;
  },
  mailbox: (account) => {
    const a = acct(account);
    return a ? mailbox(a) : undefined;
  },
  folders: async (account) => {
    const a = acct(account);
    return a ? mailbox(a).cachedFolders() : [];
  },
};

const PICK_TITLES: Record<string, string> = { mbox: 'Choose mailbox files', eml: 'Choose a folder of messages', olm: 'Choose an Outlook archive', ics: 'Choose a calendar file', 'tasks-csv': 'Choose a task list', 'tasks-ics': 'Choose a task file', todoist: 'Choose a Todoist file', vcf: 'Choose contact cards', 'contacts-csv': 'Choose a contacts file' };

export const pim: PimApi = {
  async accounts() {
    await load();
    return accounts.map((a) => {
      const h = health.get(a.id);
      return { ...a, needsSignIn: needsSignIn.has(a.id) || undefined, secretIn: memory.get(a.id)?.secret, lastChecked: h?.checked, lastError: h?.error && (!h.checked || (h.errorAt ?? 0) > h.checked) ? h.error : undefined };
    });
  },
  discover: (email) => discoverConfig(email.trim()),
  testAccount: testNew,
  addAccount: (n) => addAccount(n),
  async signIn(provider, email, opts) {
    await load();
    const client = clientFor(provider, state.prefs.clients);
    if (!client) throw new Error(`This copy of Keeper has no ${provider === 'google' ? 'Google' : 'Microsoft'} sign-in set up. Add a client ID in Settings → Mail & Calendar, or use an app password.`);
    if (opts?.calendarOnly) {
      // Only the calendar: no mail access is asked for; Microsoft's token is for Graph.
      const tokens = await signIn(provider, client, email, undefined, CALENDAR_ONLY_SCOPES[provider]);
      const address = tokens.email ?? email ?? '';
      const cfg = knownProvider('x@gmail.com')!;
      const a = await addAccount({ kind: provider, email: address, label: `${provider === 'google' ? 'Google' : 'Microsoft'} calendar${address ? ` · ${address}` : ''}`, caldav: provider === 'google' ? cfg.caldav : undefined, mail: false, calendar: true, contacts: false }, tokens);
      if (provider === 'microsoft') await saveTokens(a.id, tokens, 'graph');
      void syncAccountCalendars(a).catch(() => undefined);
      return a;
    }
    const tokens = await signIn(provider, client, email);
    const address = tokens.email ?? email ?? '';
    const cfg = knownProvider(address) ?? (provider === 'google' ? knownProvider('x@gmail.com')! : knownProvider('x@outlook.com')!);
    const fix = <T extends { user: string }>(s?: T) => (s ? { ...s, user: address } : s);
    return addAccount({ kind: provider, email: address, imap: fix(cfg.imap), smtp: fix(cfg.smtp), caldav: provider === 'google' ? cfg.caldav : undefined, carddav: provider === 'google' ? cfg.carddav : undefined }, tokens);
  },
  async cancelSignIn() { cancelSignIn(); },
  async updateAccount(id, patch) {
    await load();
    const a = acct(id);
    if (!a) throw new Error('No such account');
    const { password, ...rest } = patch as Partial<Account> & { password?: string };
    Object.assign(a, rest);
    if (password !== undefined) {
      memory.set(a.id, { at: Date.now(), secret: await putSecret(secretName(a.id), password) });
      needsSignIn.delete(a.id);
    }
    await saveAccounts(accounts);
    changed('accounts');
    ctxCache = null;
    // Signatures, sharing and labels need no new connection.
    if (password !== undefined || 'imap' in rest || 'smtp' in rest || 'mail' in rest || 'calendar' in rest || 'oauth' in rest || 'insecureTls' in rest || 'caldav' in rest) {
      await mailboxes.get(id)?.stop();
      mailboxes.delete(id);
      void startAccount(a);
    }
    return a;
  },
  async removeAccount(id) {
    await load();
    await mailboxes.get(id)?.stop();
    mailboxes.delete(id);
    accounts = accounts.filter((a) => a.id !== id);
    for (const c of state.calendars.filter((x) => x.account === id)) {
      events.delete(c.id);
      void fsp.rm(files.events(c.id), { force: true });
    }
    state.calendars = state.calendars.filter((c) => c.account !== id);
    state.reminders = state.reminders.filter((r) => !r.list.startsWith(`${id}:`));
    contacts = contacts.filter((c) => c.account !== id);
    await dropSecret(secretName(id));
    await dropSecret(`oauth.${id}.mail`);
    await dropSecret(`oauth.${id}.graph`);
    await fsp.rm(path.dirname(files.folders(id)), { recursive: true, force: true });
    await fsp.rm(path.join(path.dirname(files.state()), 'local-mail', hash(id)), { recursive: true, force: true });
    await saveAccounts(accounts);
    saveState();
    changed('accounts');
    changed('calendar');
  },
  async oauthReady() {
    await load();
    return { google: !!clientFor('google', state.prefs.clients), microsoft: !!clientFor('microsoft', state.prefs.clients) };
  },

  async folders() {
    await load();
    const out: MailFolder[] = [];
    for (const a of accounts.filter((x) => x.mail)) out.push(...(await mailbox(a).cachedFolders()));
    return out;
  },
  async messages(v: MailView) {
    await load();
    const now = Date.now();
    let list: MessageSummary[] = [];
    const smart = v.folder.startsWith('smart:') ? (state.prefs.smartMailboxes ?? []).find((x) => x.id === v.folder.slice(6)) : undefined;
    const combined = v.folder.startsWith('view:') ? (state.prefs.unifiedViews ?? []).find((x) => x.id === v.folder.slice(5)) : undefined;
    if (combined) {
      const all: MailFolder[] = [];
      for (const a of accounts.filter((x) => x.mail)) all.push(...(await mailbox(a).cachedFolders()));
      list = mergeFolders(await Promise.all(resolveSources(combined, all).filter((s) => !v.account || s.account === v.account).map((s) => cachedMessages(s.account, s.folder))));
    } else if (v.folder === 'unified' || v.folder === 'toreply') list = await cachedOf('inbox', v.account);
    else if (v.folder === 'unified:sent') list = await cachedOf('sent', v.account);
    else if (v.folder === 'snoozed') list = (await cachedEverywhere(v.account)).filter((m) => isSnoozed(m, now));
    else if (v.folder === 'search') list = await cachedEverywhere(v.account, true);
    else if (v.folder.startsWith('label:')) { const l = v.folder.slice(6).toLowerCase(); list = (await cachedEverywhere(v.account)).filter((m) => (m.labels ?? []).some((x) => x.toLowerCase() === l)); }
    else if (smart) list = (await searchMail(smart.query, { account: v.account })).messages;
    else if (v.account) list = [...(await cachedMessages(v.account, v.folder))];
    if (v.folder !== 'snoozed') list = list.filter((m) => !isSnoozed(m, now));
    const ctx = await triageCtx();
    list = list.map((m) => withTriage(m, ctx));
    // An inbox splits into Important and Other (security alerts are always Important); Other in two tabs.
    const inbox = v.folder === 'unified' || v.folder.toUpperCase() === 'INBOX' || (!!combined && inboxOnly(combined));
    if (inbox) {
      // Blocked senders and muted conversations never show in an inbox.
      const blocked = state.prefs.blockedSenders ?? [];
      list = list.filter((m) => !isBlocked(m.from, blocked) && !isMuted(m, state.muted ?? []));
    }
    if (v.folder === 'toreply') {
      list = toReply(list, myAddresses(), now, { dismissed: state.toReplyDismissed, sent: await cachedOf('sent', v.account) });
    }
    let counts: { important: number; other: number; all?: number; updates?: number; promos?: number } | undefined;
    if (inbox && state.prefs.splitInbox !== false) {
      const t = tabCounts(list);
      counts = { important: t.important, other: t.updates + t.promos, all: t.all, updates: t.updates, promos: t.promos };
      if (v.tab && v.tab !== 'all') list = list.filter((m) => inTab(m, v.tab));
      else if (!v.tab && v.split) list = list.filter((m) => inTab(m, v.split === 'important' ? 'important' : 'other'));
    }
    if (v.filter === 'unread') list = list.filter((m) => !m.seen);
    else if (v.filter === 'flagged') list = list.filter((m) => m.flagged);
    else if (v.filter === 'attachments') list = list.filter((m) => m.hasAttachments);
    if (v.query?.trim()) {
      const q = parseMailQuery(v.query);
      const exact = list.filter((m) => matchMailQuery(m, q) || matchesQuery(m, v.query!));
      // A question in plain words ("when does my flight leave?") matches on its words instead.
      list = exact.length || v.folder !== 'search' ? exact : pickForQuestion(v.query, list.filter((m) => !m.security), 50);
    }
    // Search: this computer's inboxes first, then the rest, newest first within each.
    const rank = (m: MessageSummary) => (v.folder === 'search' ? (m.folder.toUpperCase() === 'INBOX' ? 0 : 1) : 0);
    list.sort((a, b) => rank(a) - rank(b) || sortTime(b, now) - sortTime(a, now));
    if (v.folder === 'search') list = list.slice(0, 500);
    return { messages: list, threads: v.threaded ? threadMessages(list).sort((a, b) => Math.max(...b.messages.map((m) => sortTime(m, now))) - Math.max(...a.messages.map((m) => sortTime(m, now)))) : undefined, counts };
  },
  async searchServer(query, account) {
    await load();
    // The same filters as on this computer (from:, subject:, is:unread, after: …), sent to the servers.
    return (await serverSearch(parseMailQuery(query), account)).sort((x, y) => y.date - x.date);
  },
  async waiting() {
    await load();
    const now = Date.now();
    const pool = [...(await cachedOf('inbox')), ...(await cachedOf('sent')), ...(await cachedOf('archive'))];
    const days = state.prefs.followUpDays ?? 3;
    return waitingForReply(pool, myAddresses(), now, { maxDays: 45, dismissed: state.waitingDismissed }).map((w): WaitingItem => ({ message: w.message, days: w.days, to: w.to, count: w.thread.messages.length, overdue: w.days >= days }));
  },
  async followUp(id) {
    const o = await openMessage(id, { markRead: false }).catch(() => null);
    const { account, folder } = splitId(id);
    const m = o?.summary ?? (await cachedMessages(account, folder)).find((x) => x.id === id);
    if (!m) throw new Error('That message is no longer here');
    return { ...followUpDraft({ ...m, text: o?.text }, myAddresses()), account };
  },
  async dismissWaiting(id) {
    const { account, folder } = splitId(id);
    const m = (await cachedMessages(account, folder)).find((x) => x.id === id);
    state.waitingDismissed = [...(state.waitingDismissed ?? []), m?.messageId ?? id].slice(-500);
    saveState();
    changed('mail');
  },
  async subscriptions() {
    await load();
    const pool = [...(await cachedOf('inbox')), ...(await cachedOf('archive'))];
    return subscriptionsOf(pool, myAddresses()).slice(0, 150).map((x) => ({ key: x.key, name: x.name, address: x.address, count: x.count, opened: x.opened, last: x.last, canUnsubscribe: !!x.unsub, neverOpened: x.neverOpened }));
  },
  async cleanup(key, action) {
    await load();
    const pool = [...(await cachedOf('inbox')), ...(await cachedOf('archive'))];
    const sub = subscriptionsOf(pool, myAddresses()).find((x) => x.key === key);
    if (!sub) throw new Error('Nothing from that sender is here any more');
    let how = '';
    if (action === 'unsubscribe' || action === 'both') {
      const latest = pool.find((m) => m.id === sub.latest);
      how = (latest?.unsub ? await unsubscribeWith(latest.unsub, latest.account) : await pim.unsubscribe(sub.latest)).how;
    }
    // Only what is still in an inbox is moved.
    const inboxIds = sub.ids.filter((id) => splitId(id).folder.toUpperCase() === 'INBOX');
    if (action === 'archive' || action === 'both') await pim.archive(inboxIds);
    if (action === 'trash') await pim.trash(inboxIds);
    const moved = action === 'unsubscribe' ? 0 : inboxIds.length;
    if (action !== 'unsubscribe') how = [how, `${moved} message${moved === 1 ? '' : 's'} ${action === 'trash' ? 'deleted' : 'archived'}`].filter(Boolean).join(' · ');
    // Whatever still comes from them goes to Other.
    if (action !== 'trash') await pim.setCategory(sub.address, 'other');
    return { how, moved };
  },
  async setCategory(address, category) {
    const a = address.toLowerCase();
    state.prefs.importantSenders = (state.prefs.importantSenders ?? []).filter((x) => x !== a);
    state.prefs.otherSenders = (state.prefs.otherSenders ?? []).filter((x) => x !== a);
    if (category === 'important') state.prefs.importantSenders.push(a);
    else state.prefs.otherSenders.push(a);
    ctxCache = null;
    saveState();
    changed('mail');
  },
  async unsnooze(ids) {
    state.snoozes = (state.snoozes ?? []).filter((x) => !ids.includes(x.id));
    for (const id of ids) {
      const { account, folder } = splitId(id);
      await cachedMessages(account, folder);
    }
    applyLocal(ids, { snoozedUntil: undefined, returnedAt: Date.now() });
    saveState();
    armSnooze();
    void shareSnooze(ids, null);
  },
  write: (text, task, lang) => aiWrite(text, task, lang),
  askMail: (q) => askMail(q),
  async refresh(account, folder) {
    await load();
    for (const a of accounts.filter((x) => x.mail && (!account || x.id === account))) {
      if (folder && folder !== 'unified') await refreshFolder(a, folder);
      else await refreshAccount(a);
    }
  },
  async older(account, folder) {
    const a = acct(account);
    if (!a) return;
    folderCache.set(fkey(account, folder), await mailbox(a).older(folder));
    changed('mail', { account, folder });
  },
  open: openMessage,
  // Each change shows at once and goes to the server; offline, it waits and is sent later.
  async setRead(ids, read) {
    applyLocal(ids, { seen: read });
    for (const g of byFolder(ids).values()) await serverOp({ kind: 'flag', account: g.a.id, folder: g.folder, uids: g.uids, flag: '\\Seen', on: read });
  },
  async setFlagged(ids, flagged) {
    applyLocal(ids, { flagged });
    for (const g of byFolder(ids).values()) await serverOp({ kind: 'flag', account: g.a.id, folder: g.folder, uids: g.uids, flag: '\\Flagged', on: flagged });
  },
  async move(ids, dest) {
    await moveRecorded(ids, async () => dest, 'Move');
  },
  async archive(ids) {
    await moveRecorded(ids, async (a) => (await folderOf(a, 'archive')) ?? (await folderOf(a, 'all')), 'Archive');
  },
  async trash(ids) {
    await moveRecorded(ids, (a) => folderOf(a, 'trash'), 'Delete', { trash: true });
  },
  async junk(ids) {
    await moveRecorded(ids, (a) => folderOf(a, 'junk'), 'Move to Junk');
  },
  async snooze(ids, until) {
    await load();
    // Kept on this computer: the message hides until then, then comes back unread at the top.
    for (const id of ids) await cachedMessages(splitId(id).account, splitId(id).folder);
    applyLocal(ids, { snoozedUntil: until, returnedAt: undefined });
    state.snoozes = [...(state.snoozes ?? []).filter((x) => !ids.includes(x.id)), ...ids.map((id) => ({ id, until }))];
    saveState();
    armSnooze();
    // The person's other computers hide it too (IMAP keyword, or the hidden note).
    void shareSnooze(ids, until);
  },
  async saveAttachment(id, att, to) {
    const { filename, content } = await rawAttachment(id, att);
    let dest = to;
    if (!dest) {
      const dir = state.prefs.attachmentsFolder ?? app.getPath('downloads');
      const r = await saveDialog({ defaultPath: path.join(dir, filename) }, { canceled: false, filePath: path.join(dir, filename) });
      if (r.canceled || !r.filePath) return null;
      dest = r.filePath;
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, content);
    // Where it came from (the system's "Where from"), so the knowledge graph links the file to this email.
    void import('../origin-mark').then((m) => m.markOrigin(dest!, { url: keeperUrl('mail', id) })).catch(() => undefined);
    return dest;
  },
  async openAttachment(id, att) {
    const { filename, content } = await rawAttachment(id, att);
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-att-'));
    const p = path.join(dir, filename);
    await fsp.writeFile(p, content);
    // Programs, scripts and macro documents are never started from a mail: they are shown in their folder instead.
    if (riskyAttachment(filename)) shell.showItemInFolder(p);
    else await shell.openPath(p);
  },
  async unsubscribe(id) {
    const o = await openMessage(id, { markRead: false });
    const u = o.unsubscribe;
    if (!u) return { done: false, how: 'This message has no unsubscribe link' };
    return unsubscribeWith(u, o.summary.account);
  },
  async trustSender(address) {
    const a = address.toLowerCase();
    if (!state.prefs.trustedSenders.includes(a)) state.prefs.trustedSenders.push(a);
    saveState();
  },
  async draftFor(id, mode) {
    const o = await openMessage(id, { markRead: false });
    const a = acct(o.summary.account);
    const me = a?.identities.map((x) => x.email) ?? [];
    const replyToH = o.headers['reply-to'];
    const { parseAddressList } = await import('../../../core/pim/mail');
    const d = makeReply({ original: { ...o.summary, text: o.text }, me, mode: replyMode(a, mode as 'reply' | 'replyAll') === 'replyAll' && mode !== 'forward' ? 'replyAll' : mode, replyTo: replyToH ? parseAddressList(replyToH) : undefined });
    d.attachments = [];
    // A forward takes the original's attachments along, unless the account says not to.
    if (mode === 'forward' && a?.compose?.forwardAttachments !== false) {
      const dir = path.join(path.dirname(files.state()), 'forward', hash(id));
      for (const att of o.attachments.filter((x) => !x.inline || !x.cid)) {
        const got = await rawAttachment(id, att.id).catch(() => null);
        if (!got) continue;
        await fsp.mkdir(dir, { recursive: true });
        const p = path.join(dir, got.filename.replace(/[\\/:*?"<>|]+/g, '_') || `attachment-${att.id}`);
        await fsp.writeFile(p, got.content);
        d.attachments.push({ path: p, name: got.filename });
      }
    }
    // A reply goes from the alias the mail was written to.
    if (a) d.from = replyIdentity(a, o.summary)?.email ?? d.from;
    return d;
  },
  send: (d) => queue(d),
  async undoSend(id) {
    const q = state.outbox.find((x) => x.id === id);
    if (!q || q.sendAt <= Date.now()) return null;
    state.outbox = state.outbox.filter((x) => x.id !== id);
    saveState();
    armOutbox();
    changed('outbox');
    return q.draft ?? null;
  },
  async outbox() {
    await load();
    return state.outbox.map((q) => ({ id: q.id, sendAt: q.sendAt, subject: q.subject, error: q.error, scheduled: q.scheduled }));
  },
  async saveDraft(d) {
    await mirrorDraft(d);
  },
  async suggest(q) {
    await load();
    return suggestAddresses(contacts, state.recent, q);
  },
  ai: (id, task, opts) => aiOnThread(id, task, opts),
  async respond(id, status) {
    const o = await openMessage(id, { markRead: false });
    if (!o.invite) throw new Error('This message has no invitation');
    const a = acct(o.summary.account)!;
    const me = identityOf(a);
    const inv = readInvitation((bodyCache.get(id) ?? (await readJson<{ body: { invite?: string } } | null>(files.body(id), null)))!.body.invite!)!;
    const r = replyTo(inv, { email: me.address, name: me.name }, status);
    let sent = false;
    if (r.to && a.smtp) {
      const { raw, envelope } = await compose({ from: me, to: [{ address: r.to }], cc: [], bcc: [], subject: r.subject, text: r.subject, icalEvent: { method: 'REPLY', content: r.ics } });
      await smtpSend(a, await mailAuth(a), raw, envelope);
      sent = true;
    }
    // Your copy in your calendar shows your answer: the one already there (a synced calendar often has it), else a new one.
    const mine = (list?: CalEvent['attendees']) => list?.map((x) => (x.email.toLowerCase() === me.address.toLowerCase() ? { ...x, status } : x));
    const existing = [...events.values()].flat().find((e) => e.uid === inv.event.uid);
    if (status === 'declined') {
      if (existing) await deleteEvent(existing.id, { scope: 'all' }).catch(() => undefined);
    } else if (existing) {
      if (!calOf(existing.calendar)?.readOnly) await saveEvent({ ...existing, attendees: mine(existing.attendees) }).catch(() => undefined);
    } else {
      await saveEvent({ ...inv.event, calendar: state.prefs.defaultCalendar ?? LOCAL_CAL, id: '', attendees: mine(inv.event.attendees) });
    }
    const word = status === 'declined' ? 'Declined' : status === 'accepted' ? 'Accepted' : 'Maybe';
    // Without an outgoing mail server the organiser is not told: say so rather than claim it was answered.
    deps?.alert(sent || !r.to ? word : `${word} in your calendar only`, sent || !r.to ? inv.event.title : `${inv.event.title} · no reply was sent (this account has no outgoing mail server), so the organiser does not know`);
    return { sent: sent || !r.to };
  },
  async rules() {
    await load();
    return state.rules;
  },
  async saveRules(r: MailRule[]) {
    const before = JSON.stringify((state.rules as Rule[]).filter((x) => x.server));
    state.rules = r;
    saveState();
    // Rules marked "also on the server" are written there when they change.
    if (JSON.stringify(r.filter((x) => x.server)) !== before) void writeServerRules().then(() => changed('mail'), () => undefined);
  },
  async pickFiles() {
    const r = await openDialog({ properties: ['openFile', 'multiSelections'] }, { canceled: true, filePaths: [] });
    return r.canceled ? [] : r.filePaths;
  },
  async signatureSources(account) {
    await load();
    const a = acct(account);
    const out: { source: string; name: string; html: string; email?: string }[] = [];
    // Gmail: the account's own send-from settings, with the sign-in it already has.
    if (a?.oauth === 'google') {
      const token = (await mailAuth(a) as { accessToken: string }).accessToken;
      for (const s of await gmailSendAs(token)) if (s.signature) out.push({ source: 'Gmail', name: s.email, html: s.signature.html, email: s.email });
    }
    out.push(...(await localSignatures().catch(() => [])));
    return out;
  },
  async setAliasPassword(account, email, password) {
    await load();
    if (password) await putSecret(aliasSecret(account, email), password);
    else await dropSecret(aliasSecret(account, email));
  },

  async calendars() {
    await load();
    return state.calendars;
  },
  async setCalendar(id, patch) {
    await load();
    const c = calOf(id);
    if (!c) return;
    Object.assign(c, patch);
    if (patch.color) c.colorSet = true;
    saveState();
    changed('calendar');
  },
  async occurrences(from, to) {
    await load();
    return expandOccurrences(allEvents(), from, to);
  },
  saveEvent,
  deleteEvent,
  async quickAdd(text, calendar) {
    await load();
    const q = parseQuickAdd(text);
    if (!q) return null;
    return saveEvent({ id: '', calendar: calendar ?? state.prefs.defaultCalendar ?? LOCAL_CAL, uid: '', title: q.title, start: q.start, end: q.end, allDay: q.allDay, rrule: q.rrule, location: q.location, alarms: q.allDay ? undefined : [{ minutesBefore: q.alarm ?? state.prefs.defaultAlertMin }] });
  },
  parseQuick: async (text) => parseQuickAdd(text),
  async subscribe(url, name) {
    const a = await addAccount({ kind: 'ics', caldav: url.trim(), label: name });
    await syncAccountCalendars(a);
    return state.calendars.find((c) => c.account === a.id)!;
  },
  async importIcs(file, calendar) {
    await load();
    let p = file;
    if (!p) {
      const r = await openDialog({ filters: [{ name: 'Calendar', extensions: ['ics', 'ical'] }] }, { canceled: true, filePaths: [] });
      if (r.canceled || !r.filePaths[0]) return 0;
      p = r.filePaths[0];
    }
    const evs = parseEvents(await fsp.readFile(p, 'utf8'));
    const cal = calOf(calendar ?? state.prefs.defaultCalendar ?? LOCAL_CAL) ?? calOf(LOCAL_CAL)!;
    const byUid = new Map<string, CalEvent[]>();
    for (const e of evs) byUid.set(e.uid, [...(byUid.get(e.uid) ?? []), { ...e, calendar: cal.id, id: `${cal.id}:${e.uid}${e.recurrenceId !== undefined ? `:${e.recurrenceId}` : ''}` }]);
    for (const [uid, list] of byUid) await writeFamily(cal, uid, list);
    return byUid.size;
  },
  async exportIcs(calendar) {
    await load();
    const cal = calOf(calendar);
    if (!cal) return null;
    const r = await saveDialog({ defaultPath: path.join(app.getPath('downloads'), `${cal.name}.ics`) }, { canceled: true, filePath: '' });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, serializeEvents(events.get(cal.id) ?? []));
    return r.filePath;
  },
  async syncCalendars() {
    await Promise.all([syncAllCalendars(true), syncSystem()]);
  },
  async systemAccess(request) {
    await load();
    if (!request && sysAccess) return sysAccess;
    if (state.prefs.systemCalendars === false) return { state: 'unavailable', canRequest: false, message: 'Reading this computer’s calendars is switched off.' };
    sysAccess = await sysDriver().access(request);
    if (sysAccess.state === 'granted') void syncSystem();
    deps?.broadcast('pim-changed', 'calendar');
    return sysAccess;
  },
  async watchCalendar(visible) {
    const was = calendarVisible();
    visibleUntil = visible ? Date.now() + 3 * 60_000 : 0;
    if (visible && !was) {
      // Just opened: look now, then every minute while it stays open.
      pollNow('pim.system');
      pollNow('pim.calendars');
    }
  },
  upcomingEvents: (from, to, opts) => upcomingEvents(from, to, opts),
  calendarStatus: () => calendarStatus(),
  async openCalendarSources() {
    deps?.show?.('calendar:sources');
  },
  async openEvent(id, instance) {
    await load();
    const ev = [...events.values()].flat().find((x) => x.id === id);
    if (!ev) return;
    if (ev.openUrl) {
      await shell.openExternal(ev.openUrl).catch(() => deps?.show?.(`calendar:event:${instance ?? ev.start}:${id}`));
      return;
    }
    deps?.show?.(`calendar:event:${instance ?? ev.start}:${id}`);
  },

  async openEventAttachment(id, index) {
    await load();
    const ev = [...events.values()].flat().find((x) => x.id === id);
    const a = ev?.attachments?.[index];
    if (!a) throw new Error('This file is no longer in the event');
    const url = a.url && /^(https?:|mailto:)/i.test(a.url) ? a.url : undefined;
    if (url) { await shell.openExternal(url); return; }
    if (!a.data) throw new Error('This file cannot be opened from here');
    // A file inside the event is written out once, then opened in its own app.
    const dir = path.join(path.dirname(files.state()), 'event-files', hash(`${id}:${index}`));
    const name = (a.name ?? 'attachment').replace(/[\\/:*?"<>|]+/g, '_');
    await fsp.mkdir(dir, { recursive: true });
    const p = path.join(dir, name);
    await fsp.writeFile(p, Buffer.from(a.data, 'base64'));
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
  },

  async reminders() {
    await load();
    return state.reminders.filter((r) => !r.id.startsWith('local:snooze-') || !r.done);
  },
  async saveReminder(r) {
    await load();
    return writeTask(r);
  },
  async deleteReminder(id) {
    const r = state.reminders.find((x) => x.id === id);
    const cal = r && calOf(r.list);
    const a = cal && acct(cal.account);
    if (r?.href && a) await deleteHref(r.href, await davAuth(a), r.etag);
    state.reminders = state.reminders.filter((x) => x.id !== id);
    saveState();
    changed('reminders');
    settleDue(id);
  },
  async completeReminder(id, done = true) {
    await load();
    const t = state.reminders.find((x) => x.id === id);
    if (!t) return null;
    if (t.done === done) return t;
    return writeTask(done ? { ...t, done: true } : { ...t, done: false, doneAt: undefined });
  },
  async snoozeReminder(id, minutes) {
    await load();
    const t = state.reminders.find((x) => x.id === id);
    if (!t) return;
    await writeTask({ ...t, remindAt: Date.now() + Math.max(1, Math.min(24 * 60, minutes)) * 60_000 });
  },
  async moveTasks(ids, day) {
    await load();
    for (const id of ids) {
      const t = state.reminders.find((x) => x.id === id);
      if (t) await writeTask(moveToDay(t, day));
    }
  },
  async reorderTasks(order) {
    await load();
    for (const o of order) {
      const t = state.reminders.find((x) => x.id === o.id);
      if (!t || t.order === o.order) continue;
      // Local tasks change in place; an account's tasks are written to the server too.
      if (calOf(t.list)) await writeTask({ ...t, order: o.order });
      else state.reminders = state.reminders.map((x) => (x.id === o.id ? { ...x, order: o.order } : x));
    }
    saveState();
    changed('reminders');
  },
  async insights() {
    await load();
    return insightsOf(state.log ?? [], Date.now(), state.prefs.weekStart);
  },
  async dueReminders() {
    return [...dueTasks.values()];
  },

  async alarms() {
    await load();
    const now = Date.now();
    const times = state.alarms.map((a) => nextAlarmTime(a, now)).filter((t): t is number => t !== undefined);
    return { alarms: state.alarms, timers: state.timers, clocks: state.clocks, next: times.length ? Math.min(...times) : undefined };
  },
  async saveAlarm(a) {
    await load();
    const next: Alarm = { ...a, id: a.id || randomUUID() };
    if (!next.days.length && !next.date) {
      // A one-off alarm rings at the next time it can: today, or tomorrow when that time has passed.
      const [h, m] = next.time.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      next.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    next.lastFired = undefined;
    state.alarms = [...state.alarms.filter((x) => x.id !== next.id), next];
    saveState();
    changed('alarms');
    return next;
  },
  async deleteAlarm(id) {
    state.alarms = state.alarms.filter((x) => x.id !== id);
    ringing.delete(id);
    saveState();
    changed('alarms');
  },
  async snoozeAlarm(id) {
    const a = state.alarms.find((x) => x.id === id);
    const r = ringing.get(id);
    ringing.delete(id);
    if (a) {
      a.enabled = true;
      a.snoozedUntil = Date.now() + a.snoozeMin * 60_000;
    } else if (r?.kind === 'timer') {
      state.timers.push({ id: randomUUID(), label: r.title, durationMs: 5 * 60_000, endsAt: Date.now() + 5 * 60_000 });
    }
    saveState();
    changed('alarms');
    deps?.broadcast('pim-ring-stop', id);
  },
  async stopRinging(id) {
    ringing.delete(id);
    deps?.broadcast('pim-ring-stop', id);
  },
  async startTimer(label, ms) {
    const t: CountdownTimer = { id: randomUUID(), label: label || 'Timer', durationMs: ms, endsAt: Date.now() + ms };
    state.timers.push(t);
    saveState();
    changed('alarms');
    return t;
  },
  async timerAction(id, action) {
    const t = state.timers.find((x) => x.id === id);
    if (!t) return;
    const now = Date.now();
    if (action === 'pause' && t.endsAt !== undefined) { t.leftMs = Math.max(0, t.endsAt - now); t.endsAt = undefined; }
    else if (action === 'resume' && t.endsAt === undefined) { t.endsAt = now + (t.leftMs ?? t.durationMs); t.leftMs = undefined; }
    else if (action === 'restart') { t.endsAt = now + t.durationMs; t.leftMs = undefined; }
    else if (action === 'cancel') state.timers = state.timers.filter((x) => x.id !== id);
    else if (action === 'extend') Object.assign(t, extendTimer(t, 60_000, now));
    saveState();
    changed('alarms');
  },
  async saveClocks(c: WorldClock[]) {
    state.clocks = c;
    saveState();
    changed('alarms');
  },
  scheduleWake,

  async contacts() {
    await load();
    return contacts;
  },
  async saveContact(c) {
    await load();
    let next: Contact = { ...c, account: c.account || LOCAL, id: c.id || `${c.account || LOCAL}:${randomUUID()}`, uid: c.uid ?? randomUUID() };
    const a = acct(next.account);
    if (a && next.href) {
      const r = await dav('PUT', next.href, await davAuth(a), serializeVCard(next), { 'content-type': 'text/vcard; charset=utf-8', ...(next.etag ? { 'if-match': next.etag } : {}) });
      if (r.status >= 300) throw new Error(`The server answered ${r.status}`);
      next = { ...next, etag: r.headers.get('etag') ?? undefined };
    }
    contacts = [...contacts.filter((x) => x.id !== next.id), next];
    void writeJson(files.contacts(), contacts);
    changed('contacts');
    return next;
  },
  async deleteContact(id) {
    const c = contacts.find((x) => x.id === id);
    const a = c && acct(c.account);
    if (c?.href && a) await deleteHref(c.href, await davAuth(a), c.etag);
    contacts = contacts.filter((x) => x.id !== id);
    void writeJson(files.contacts(), contacts);
    changed('contacts');
  },

  importSources: async (area) => sourcesFor(area, process.platform),
  foundSources: () => foundSources(),
  async pickImport(source) {
    const info = sourcesFor('mail', process.platform).concat(sourcesFor('calendar', process.platform), sourcesFor('reminders', process.platform), sourcesFor('contacts', process.platform)).find((s) => s.id === source);
    if (!info) return [];
    const folder = info.pick === 'folder';
    const exts = (info.extensions ?? []).filter(Boolean);
    const r = await openDialog({
      title: PICK_TITLES[source] ?? 'Choose',
      // .mbox exports from a Mac are folders; files without an extension are mboxes too.
      properties: folder ? ['openDirectory', 'multiSelections'] : source === 'mbox' ? ['openFile', 'openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
      filters: folder || source === 'mbox' ? undefined : [{ name: info.label, extensions: exts }],
    }, { canceled: true, filePaths: [] });
    return r.canceled ? [] : r.filePaths;
  },
  runImport: (req) => runImport(req, importHost),
  async cancelImport(id) { cancelImport(id); },
  undoImport: (id) => undoImport(id, importHost),
  importHistory: () => importHistory(),
  async exportMail(account, folder, format) {
    await load();
    const a = acct(account);
    if (!a) return null;
    const single = !!folder && format === 'mbox';
    const name = `${(folder === 'INBOX' ? 'Inbox' : folder?.split('/').pop()) ?? a.label}`.replace(/[\\/:*?"<>|]+/g, ' ');
    const r = single
      ? await saveDialog({ defaultPath: path.join(app.getPath('downloads'), `${name}.mbox`), filters: [{ name: 'Mailbox', extensions: ['mbox'] }] }, { canceled: true, filePath: '' })
      : await openDialog({ title: 'Choose where to save the mail', properties: ['openDirectory', 'createDirectory'] }, { canceled: true, filePaths: [] }).then((x) => ({ canceled: x.canceled, filePath: x.filePaths[0] ? path.join(x.filePaths[0], name) : '' }));
    if (r.canceled || !r.filePath) return null;
    return exportMail(account, folder, format, r.filePath, importHost);
  },
  async exportTasks(format) {
    await load();
    const r = await saveDialog({ defaultPath: path.join(app.getPath('downloads'), `Tasks.${format}`), filters: [{ name: format === 'csv' ? 'Spreadsheet' : 'Calendar', extensions: [format] }] }, { canceled: true, filePath: '' });
    if (r.canceled || !r.filePath) return null;
    return exportTasks(state.reminders, format, r.filePath);
  },
  async exportContacts(format) {
    await load();
    const r = await saveDialog({ defaultPath: path.join(app.getPath('downloads'), `Contacts.${format}`), filters: [{ name: format === 'vcf' ? 'Contact cards' : 'Spreadsheet', extensions: [format] }] }, { canceled: true, filePath: '' });
    if (r.canceled || !r.filePath) return null;
    return exportContacts(contacts, format, r.filePath);
  },
  search: (query, opts) => searchMail(query, opts),
  async unreadCounts() {
    await load();
    const ctx = await triageCtx();
    const inbox = (await cachedOf('inbox')).filter((m) => !isSnoozed(m, Date.now()) && !isBlocked(m.from, state.prefs.blockedSenders ?? [])).map((m) => withTriage(m, ctx));
    return { byAccount: unreadByAccount(inbox), all: badgeCount(inbox, 'all'), important: badgeCount(inbox, 'important'), labels: labelCounts(await cachedEverywhere()) };
  },
  async dismissToReply(id) {
    const { account, folder } = splitId(id);
    const m = (await cachedMessages(account, folder)).find((x) => x.id === id);
    state.toReplyDismissed = [...(state.toReplyDismissed ?? []), m?.messageId ?? id].slice(-500);
    saveState();
    changed('mail');
  },
  async remindNoReply(id, at) {
    await load();
    const { account, folder } = splitId(id);
    const m = (await cachedMessages(account, folder)).find((x) => x.id === id) ?? (await openMessage(id, { markRead: false }).catch(() => null))?.summary;
    if (!m?.messageId) throw new Error('This message has no Message-ID, so a reply to it cannot be recognised');
    state.noReply = (state.noReply ?? []).filter((r) => r.messageId !== m.messageId);
    if (at !== null) state.noReply.push({ messageId: m.messageId, id, account, subject: m.subject, to: m.to, sentAt: m.date, at });
    saveState();
    armNoReply();
    changed('mail');
  },
  async noReplyReminders() {
    await load();
    return state.noReply ?? [];
  },
  async mute(ids, on) {
    await load();
    const keys = new Set(state.muted ?? []);
    for (const id of ids) {
      const { account, folder } = splitId(id);
      const m = (await cachedMessages(account, folder)).find((x) => x.id === id);
      if (!m) continue;
      // The conversation's root names it; every message after it refers to the root.
      const root = m.references?.[0] ?? m.inReplyTo ?? m.messageId;
      if (!root) continue;
      if (on) keys.add(root);
      else for (const k of [root, ...(m.references ?? []), ...(m.messageId ? [m.messageId] : [])]) keys.delete(k);
    }
    state.muted = [...keys].slice(-2000);
    saveState();
    if (on) await pim.archive(ids.filter((id) => splitId(id).folder.toUpperCase() === 'INBOX')).catch(() => undefined);
    changed('mail');
  },
  async block(address, on) {
    await load();
    const x = address.trim().toLowerCase();
    if (!x) return;
    const list = (state.prefs.blockedSenders ?? []).filter((b) => b !== x);
    state.prefs.blockedSenders = on ? [...list, x] : list;
    saveState();
    if (on) {
      // What is already in an inbox from them goes to Junk too.
      const ids = (await cachedOf('inbox')).filter((m) => isBlocked(m.from, [x])).map((m) => m.id);
      if (ids.length) await pim.junk(ids).catch(() => undefined);
    }
    changed('mail');
    void updateBadge();
  },
  async reportSpam(ids) {
    await load();
    const senders = new Set<string>();
    for (const id of ids) {
      const { account, folder } = splitId(id);
      const m = (await cachedMessages(account, folder)).find((x) => x.id === id);
      if (m?.from?.address) senders.add(m.from.address.toLowerCase());
    }
    await pim.junk(ids);
    state.prefs.blockedSenders = [...new Set([...(state.prefs.blockedSenders ?? []), ...senders])];
    saveState();
  },
  async label(ids, label, on) {
    const l = label.trim();
    if (!l) return;
    for (const id of ids) {
      const { account, folder } = splitId(id);
      const m = (await cachedMessages(account, folder)).find((x) => x.id === id);
      if (m) applyLocal([id], { labels: on ? [...new Set([...(m.labels ?? []), l])] : (m.labels ?? []).filter((x) => x !== l) });
    }
    for (const g of byFolder(ids).values()) await serverOp({ kind: 'flag', account: g.a.id, folder: g.folder, uids: g.uids, flag: l, on });
  },
  undo: () => undoLast(),
  previewAttachment: (id, att) => attachmentPreview(id, att),
  printable: (id, opts) => printableHtml(id, !!opts?.allowRemote),
  async savePdf() {
    // Drawn by the app's windows (electron/ipc/pim.ts); here only when no window can.
    throw new Error('Saving as PDF needs Keeper’s window');
  },
  syncServerRules: () => writeServerRules(),
  async senderPhotos(addresses) {
    await load();
    const want = new Set(addresses.map((x) => x.toLowerCase()));
    const out: Record<string, string> = {};
    for (const c of contacts) if (c.photo) for (const e of c.emails) if (want.has(e.toLowerCase())) out[e.toLowerCase()] = c.photo;
    return out;
  },
  aiCompose: (r) => aiCompose(r),
  async stageCompose(d) { stageCompose(d); },
  async stagedCompose() {
    const d = staged;
    staged = null;
    return d;
  },
  dropDraft: (key) => dropDraftCopy(key),

  async prefs() {
    await load();
    return state.prefs as PimPrefsView;
  },
  async setPrefs(p) {
    await load();
    state.prefs = { ...state.prefs, ...p };
    if (p.holidayCountry !== undefined || p.birthdays !== undefined) { refreshDerived(); changed('calendar'); }
    if (p.systemCalendars !== undefined) void syncSystem();
    saveState();
    if (p.undoSendSec !== undefined) armOutbox();
    if (p.dockBadge !== undefined || p.blockedSenders !== undefined || p.splitInbox !== undefined) void updateBadge();
    if (p.smartMailboxes !== undefined || p.unifiedViews !== undefined || p.blockedSenders !== undefined) changed('mail');
    if (p.aiMemory !== undefined) state.prefs.aiMemory = cleanMemory(p.aiMemory);
    return state.prefs as PimPrefsView;
  },
};

// ---------------------------------------------------------------- starting and stopping

function startMail() {
  for (const a of accounts) if (a.mail) void startAccount({ ...a, calendar: false, contacts: false } as Account).catch(() => undefined);
  // A safety net for servers without IDLE; slows down when away, stops while locked.
  stops.push(poll('pim.mail', { baseMs: 10 * 60_000, idleFactor: 3, pauseWhenLocked: true }, async () => {
    for (const a of accounts.filter((x) => x.mail)) await refreshFolder(a, 'INBOX').catch(() => undefined);
  }, { now: false, feature: 'mail' }));
  armOutbox();
  armSnooze();
  armNoReply();
  void updateBadge();
  for (const a of accounts.filter((x) => x.mail)) void readSnoozeNote(a);
  // After sleep, or when the network changes (another Wi-Fi, a cable, a VPN), catch up at once.
  powerMonitor.on('resume', catchUp);
  powerMonitor.on('unlock-screen', catchUp);
  lastNet = netSignature();
  const net = setInterval(() => { const n = netSignature(); if (n !== lastNet) { lastNet = n; if (n) catchUp(); } }, 30_000);
  net.unref?.();
  mailStops.push(() => { powerMonitor.off('resume', catchUp); powerMonitor.off('unlock-screen', catchUp); clearInterval(net); });
}

const mailStops: (() => void)[] = [];

async function stopMail() {
  for (const f of mailStops.splice(0)) f();
  clearTimeout(outboxTimer);
  clearTimeout(snoozeTimer);
  clearTimeout(noReplyTimer);
  clearTimeout(catchUpTimer);
  for (const m of mailboxes.values()) await m.stop();
  mailboxes.clear();
}

export async function startPim(d: PimDeps) {
  deps = d;
  await load();
  // A feature missing from the registry must not stop the rest from starting.
  const watch = (id: string, fn: (on: boolean) => void) => { try { stops.push(onFeature(id, fn)); } catch (e) { console.error(e); } };
  watch('mail', (on) => (on ? startMail() : void stopMail()));
  if (featureOn('mail')) startMail();
  // Every 5 minutes, every minute while a calendar is on screen (servers answer "nothing new" cheaply;
  // .ics links are fetched at most every 15 minutes); paused while the screen is locked.
  stops.push(poll('pim.calendars', () => ({ baseMs: calendarPollMs({ visible: calendarVisible() }), idleFactor: 1, pauseWhenLocked: true }), () => syncAllCalendars(false), { now: true, feature: 'calendars' }));
  // The computer's own calendars: the system says when they change where it can (macOS).
  stops.push(poll('pim.system', () => ({ baseMs: calendarPollMs({ visible: calendarVisible(), live: !!stopSysWatch }), idleFactor: 1, pauseWhenLocked: true }), () => syncSystem(), { now: true, feature: 'calendars' }));
  stops.push(() => { stopSysWatch?.(); stopSysWatch = undefined; driver?.close?.(); driver = null; });
  watch('calendars', (on) => {
    if (on) { pollNow('pim.calendars'); pollNow('pim.system'); }
    else { stopSysWatch?.(); stopSysWatch = undefined; }
    armClock();
    pushIsland();
  });
  watch('calendar', () => pushIsland());
  if (featureOn('calendars')) void adoptIslandUrl(d.islandCalendarUrl?.()).catch(() => undefined);
  watch('alarms', () => armClock());
  // After sleep or a clock change, look again at once (and ring what was missed by a little).
  const again = () => armClock();
  powerMonitor.on('resume', again);
  powerMonitor.on('unlock-screen', again);
  stops.push(() => { powerMonitor.off('resume', again); powerMonitor.off('unlock-screen', again); });
  armClock();
  pushIsland();
}

export async function stopPim() {
  for (const s of stops.splice(0)) s();
  clearTimeout(clockTimer);
  clearTimeout(saveTimer);
  await stopMail();
  await writeJson(files.state(), state);
}

/** The conversation a message belongs to (its folder and your Sent mail), oldest first. */
export async function threadOf(id: string): Promise<MessageSummary[]> {
  await load();
  const { account, folder } = splitId(id);
  const pool = [...(await cachedMessages(account, folder)), ...(await cachedOf('sent', account))];
  return threadMessages(pool).find((t) => t.messages.some((m) => m.id === id))?.messages ?? [];
}

/** For tests and the agents layer. */
export const pimInternals = { load, state: () => state, accounts: () => accounts, everywhere: () => cachedEverywhere(), events: () => events };

/**
 * Read-only: the raw schema.org JSON-LD blocks (<script type="application/ld+json">) of a
 * message, which the sanitised view drops. For Places & Tracks' bookings; marks nothing read.
 */
export async function structuredData(id: string): Promise<string[]> {
  await load();
  const { account, folder, uid } = splitId(id);
  const a = acct(account);
  if (!a) return [];
  let html = bodyCache.get(id)?.body.html;
  if (html === undefined) {
    const disk = await readJson<{ body: ReturnType<typeof toBody> } | null>(files.body(id), null);
    html = disk ? disk.body.html : (await mailbox(a).body(folder, uid)).body.html;
  }
  if (!html) return [];
  return [...html.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim()).filter(Boolean).slice(0, 20);
}
