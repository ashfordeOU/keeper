// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail, calendars, reminders, alarms and contacts in Keeper. Each part is a
// feature that can be switched off; when off, nothing connects, nothing is
// checked and nothing waits. Mail arrives through IMAP IDLE (the server says
// when), calendars are checked through the governor, and one timer waits for
// the next alarm, reminder or event alert.

import { app, BrowserWindow, dialog, Notification, powerMonitor, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DueReminder, MailView, NewAccount, OpenMessage, Outbox, PimApi, Ring } from '../../../core/api-pim';
import { addLog, insights as insightsOf, type LogEntry } from '../../../core/pim/insights';
import { completeTask, moveToDay, todosToTasks, type OldTodo } from '../../../core/pim/tasks';
import { autoconfigUrls, fromSrv, guess, knownProvider, parseAutoconfig, type MailConfig } from '../../../core/pim/autoconfig';
import { WELL_KNOWN_CALDAV, WELL_KNOWN_CARDDAV } from '../../../core/pim/caldav';
import { occurrences as expandOccurrences, parseEvents, serializeEvents } from '../../../core/pim/ical';
import { readInvitation, replyTo } from '../../../core/pim/imip';
import { makeReply, matchesQuery, riskyAttachment, ruleMatches, snippetOf, threadMessages, type Draft, type MailRule } from '../../../core/pim/mail';
import type { PimPrefsView } from '../../../core/pim/prefs';
import { parseQuickAdd } from '../../../core/pim/quickadd';
import { dueKey, dueNow, meetingLink, nextAlarmTime, type Due } from '../../../core/pim/alarms';
import { inIsland } from '../../../core/pim/agenda';
import { BIRTHDAYS_CALENDAR, birthdayEvents, HOLIDAY_COUNTRIES, holidayCalendarId, holidayEvents } from '../../../core/pim/holidays';
import { CALENDAR_ONLY_SCOPES } from '../../../core/pim/oauth';
import { adoptSnapshot, calendarPollMs, ICS_MIN_MS, type SystemAccess } from '../../../core/pim/syscal';
import { systemDriver, type SystemDriver } from './system-calendars';
import type { Account, Address, Alarm, CalEvent, CalendarInfo, Contact, CountdownTimer, MailFolder, MessageSummary, Reminder, WorldClock } from '../../../core/pim/types';
import { suggest as suggestAddresses, serializeVCard } from '../../../core/pim/vcard';
import { redact } from '../../../core/brain/redact';
import { featureOn, onFeature } from '../features';
import { poll, pollNow } from '../governor';
import { cidMap, compose, MailAccount, smtpSend, smtpVerify, toBody, type Auth } from './mail';
import { dav, deleteHref, discover, fetchContacts, fetchIcs, graphCalendars, graphDelete, graphEvents, graphSave, putEvent, putTodo, syncCalendar, type DavAuth } from './dav';
import { accessToken, cancelSignIn, clientFor, saveTokens, signIn } from './oauth';
import { dropSecret, emptyState, files, hash, loadAccounts, loadContacts, loadState, putSecret, readJson, readSecret, saveAccounts, writeJson, type EventCache, type FolderCache, type PimState } from './store';

export interface PimDeps {
  broadcast: (channel: string, ...args: unknown[]) => void;
  /** a short alert in the Island ('reminder': a task is due, shown even when other alerts are not) */
  alert: (title: string, detail?: string, kind?: 'reminder') => void;
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
}

const LOCAL = 'local';
const LOCAL_CAL = 'local:calendar';
const COLORS = ['#0a84ff', '#ff375f', '#30d158', '#ff9f0a', '#bf5af2', '#64d2ff', '#ffd60a', '#ac8e68'];

let deps: PimDeps | null = null;
let accounts: Account[] = [];
let state: PimState = emptyState();
let contacts: Contact[] = [];
const mailboxes = new Map<string, MailAccount>();
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

async function mailAuth(a: Account): Promise<Auth> {
  const user = a.imap?.user ?? a.email ?? '';
  if (a.oauth) {
    try {
      const token = await accessToken(a.id, a.oauth, clientFor(a.oauth, state.prefs.clients)!);
      needsSignIn.delete(a.id);
      return { user: a.email ?? user, accessToken: token };
    } catch (e) {
      needsSignIn.add(a.id);
      throw e;
    }
  }
  const pass = await readSecret(secretName(a.id));
  if (pass === undefined) {
    needsSignIn.add(a.id);
    throw new Error('Enter the password for this account again');
  }
  return { user, pass };
}

async function davAuth(a: Account): Promise<DavAuth> {
  if (a.oauth === 'google') return { bearer: (await mailAuth(a) as { accessToken: string }).accessToken };
  const pass = await readSecret(secretName(a.id));
  if (pass === undefined) {
    needsSignIn.add(a.id);
    throw new Error('Enter the password for this account again');
  }
  return { basic: { user: (a as Account & { davUser?: string }).davUser ?? a.email ?? a.imap?.user ?? '', pass } };
}

function mailbox(a: Account): MailAccount {
  let m = mailboxes.get(a.id);
  if (!m) {
    m = new MailAccount(a, () => mailAuth(a));
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

async function refreshFolder(a: Account, folder: string) {
  const first = !firstSync.has(fkey(a.id, folder));
  const r = await mailbox(a).sync(folder);
  firstSync.add(fkey(a.id, folder));
  needsSignIn.delete(a.id);
  let list = r.messages;
  // Local filters on new inbox mail.
  if (folder.toUpperCase() === 'INBOX' && r.added.length && state.rules.some((x) => x.enabled)) {
    for (const m of r.added) {
      const rule = state.rules.find((x) => ruleMatches(x, m));
      if (!rule) continue;
      const t = rule.then;
      if (t.action === 'move') await mailbox(a).move(folder, [m.uid], t.folder).catch(() => undefined);
      else if (t.action === 'trash') await mailbox(a).remove(folder, [m.uid], await folderOf(a, 'trash')).catch(() => undefined);
      else if (t.action === 'read') await mailbox(a).setFlags(folder, [m.uid], '\\Seen', true).catch(() => undefined);
      else if (t.action === 'flag') await mailbox(a).setFlags(folder, [m.uid], '\\Flagged', true).catch(() => undefined);
      else if (t.action === 'label') await mailbox(a).setFlags(folder, [m.uid], t.label, true).catch(() => undefined);
    }
    list = (await mailbox(a).sync(folder)).messages;
  }
  folderCache.set(fkey(a.id, folder), list);
  if (!first && folder.toUpperCase() === 'INBOX') notifyNew(a, r.added.filter((m) => !m.seen));
  changed('mail', { account: a.id, folder });
}

function notifyNew(a: Account, fresh: MessageSummary[]) {
  if (!fresh.length || !state.prefs.notifyMail || !Notification.isSupported()) return;
  const one = fresh.length === 1 ? fresh[0] : undefined;
  const title = state.prefs.notifyPreviews && one ? one.from?.name || one.from?.address || 'New mail' : `${fresh.length} new message${fresh.length === 1 ? '' : 's'}`;
  const body = state.prefs.notifyPreviews && one ? one.subject : a.label;
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => deps?.broadcast('navigate', 'mail'));
  n.show();
  deps?.alert(title, body);
}

async function refreshAccount(a: Account) {
  await mailbox(a).folders();
  await refreshFolder(a, 'INBOX');
}

function applyLocal(ids: string[], patch: Partial<MessageSummary> | null) {
  for (const id of ids) {
    const { account, folder } = splitId(id);
    const list = folderCache.get(fkey(account, folder));
    if (!list) continue;
    const i = list.findIndex((m) => m.id === id);
    if (i < 0) continue;
    if (patch) list[i] = { ...list[i], ...patch };
    else list.splice(i, 1);
  }
  changed('mail');
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
  return { summary, html: clean.html, text: cached.body.text, blocked: clean.blocked, trackers: clean.trackers, attachments: cached.body.attachments, invite, unsubscribe: cached.body.listUnsubscribe, headers: cached.body.headers };
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

async function queue(d: Draft & { account: string; sendAt?: number; markdown?: boolean }): Promise<Outbox> {
  await load();
  const a = acct(d.account);
  if (!a?.smtp) throw new Error('This account cannot send mail');
  const from = identityOf(a, d.from);
  const sig = a.identities.find((x) => x.email === from.address)?.signature;
  const body = [d.body, sig ? `-- \n${sig}` : '', d.quoted ?? ''].filter(Boolean).join('\n\n');
  const { marked } = await import('marked');
  const html = d.markdown !== false ? (marked.parse(body.replace(/^>.*$/gm, (l) => l), { async: false, gfm: true, breaks: true }) as string) : undefined;
  const atts = (d.attachments ?? []).map((x) => ({ filename: x.name ?? path.basename(x.path), path: x.path }));
  const { raw, envelope } = await compose({ from, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, text: body, html, inReplyTo: d.inReplyTo, references: d.references, attachments: atts });
  const item = { id: randomUUID(), account: a.id, sendAt: d.sendAt ?? Date.now() + state.prefs.undoSendSec * 1000, raw: raw.toString('base64'), envelope, subject: d.subject, draft: d };
  state.outbox.push(item);
  for (const r of [...d.to, ...d.cc, ...d.bcc]) {
    state.recent = [{ ...r, at: Date.now() }, ...state.recent.filter((x) => x.address.toLowerCase() !== r.address.toLowerCase())].slice(0, 300);
  }
  saveState();
  armOutbox();
  changed('outbox');
  return { id: item.id, sendAt: item.sendAt, subject: item.subject };
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
      await smtpSend(a, await mailAuth(a), raw, q.envelope);
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

async function syncAccountCalendars(a: Account) {
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

async function aiOnThread(id: string, task: 'summarize' | 'reply' | 'extract') {
  const { providerForConnection, brainSettings } = await import('../brain');
  const b = brainSettings();
  const p = await providerForConnection(b.active);
  if (b.localOnly && !p.local) throw new Error('You chose to use only AIs on this computer (Settings → AI & Brain)');
  const { account, folder } = splitId(id);
  const list = await cachedMessages(account, folder);
  const me = list.find((m) => m.id === id);
  const thread = me ? threadMessages(list).find((t) => t.messages.some((m) => m.id === id)) : undefined;
  const msgs = thread?.messages ?? (me ? [me] : []);
  const parts: string[] = [];
  for (const m of msgs.slice(-8)) {
    const o = await openMessage(m.id, { markRead: false }).catch(() => null);
    const text = (o?.text ?? m.snippet).slice(0, 6000);
    parts.push(`From: ${m.from?.name ?? ''} <${m.from?.address ?? ''}>\nDate: ${new Date(m.date).toString()}\nSubject: ${m.subject}\n\n${text}`);
  }
  // Keys, passwords and card numbers never leave the computer.
  const body = p.local ? parts.join('\n\n---\n\n') : redact(parts.join('\n\n---\n\n')).text;
  const ask = {
    summarize: 'Summarize this email conversation in 3–6 short bullet points: what it is about, what was decided, and anything the reader needs to do (with dates). Plain text.',
    reply: 'Draft a short, friendly reply to the last message in this conversation, in the same language. Only the reply text, no subject line, no signature.',
    extract: 'List every event, meeting, appointment or deadline in this conversation, one per line, each as a short plain-English phrase with its date and time, starting with "EVENT: " (e.g. "EVENT: Dinner with Ana Friday 7pm at Café Sol"). Use absolute dates. If there are none, answer "NONE".',
  }[task];
  const r = await p.chat([{ role: 'system', content: 'You help with email. Today is ' + new Date().toDateString() + '.' }, { role: 'user', content: `${ask}\n\n${body}` }], [], { maxTokens: 1200 });
  if (task !== 'extract') return { text: r.text.trim() };
  const evs = r.text.split('\n').filter((l) => /^EVENT:/i.test(l.trim())).map((l) => parseQuickAdd(l.trim().slice(6))).filter((x): x is NonNullable<typeof x> => !!x);
  return { text: r.text.trim(), events: evs };
}

// ---------------------------------------------------------------- the API

export const pim: PimApi = {
  async accounts() {
    await load();
    return accounts.map((a) => ({ ...a, needsSignIn: needsSignIn.has(a.id) || undefined, secretIn: memory.get(a.id)?.secret }));
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
    await mailboxes.get(id)?.stop();
    mailboxes.delete(id);
    await saveAccounts(accounts);
    changed('accounts');
    void startAccount(a);
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
    let list: MessageSummary[] = [];
    if (v.folder === 'unified') {
      for (const a of accounts.filter((x) => x.mail && (!v.account || x.id === v.account))) list.push(...(await cachedMessages(a.id, 'INBOX')));
    } else if (v.account) list = [...(await cachedMessages(v.account, v.folder))];
    const now = Date.now();
    list = list.filter((m) => !(m.snoozedUntil && m.snoozedUntil > now));
    if (v.filter === 'unread') list = list.filter((m) => !m.seen);
    else if (v.filter === 'flagged') list = list.filter((m) => m.flagged);
    else if (v.filter === 'attachments') list = list.filter((m) => m.hasAttachments);
    if (v.query?.trim()) list = list.filter((m) => matchesQuery(m, v.query!));
    list.sort((a, b) => b.date - a.date);
    return { messages: list, threads: v.threaded ? threadMessages(list) : undefined };
  },
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
  async setRead(ids, read) {
    applyLocal(ids, { seen: read });
    for (const g of byFolder(ids).values()) await mailbox(g.a).setFlags(g.folder, g.uids, '\\Seen', read);
  },
  async setFlagged(ids, flagged) {
    applyLocal(ids, { flagged });
    for (const g of byFolder(ids).values()) await mailbox(g.a).setFlags(g.folder, g.uids, '\\Flagged', flagged);
  },
  async move(ids, dest) {
    applyLocal(ids, null);
    for (const g of byFolder(ids).values()) await mailbox(g.a).move(g.folder, g.uids, dest);
  },
  async archive(ids) {
    for (const g of byFolder(ids).values()) {
      const dest = (await folderOf(g.a, 'archive')) ?? (await folderOf(g.a, 'all'));
      if (!dest) throw new Error(`${g.a.label} has no Archive folder`);
      applyLocal(g.uids.map((u) => `${g.a.id}:${g.folder}:${u}`), null);
      await mailbox(g.a).move(g.folder, g.uids, dest);
    }
  },
  async trash(ids) {
    applyLocal(ids, null);
    for (const g of byFolder(ids).values()) await mailbox(g.a).remove(g.folder, g.uids, await folderOf(g.a, 'trash'));
  },
  async junk(ids) {
    for (const g of byFolder(ids).values()) {
      const dest = await folderOf(g.a, 'junk');
      if (!dest) throw new Error(`${g.a.label} has no Junk folder`);
      applyLocal(g.uids.map((u) => `${g.a.id}:${g.folder}:${u}`), null);
      await mailbox(g.a).move(g.folder, g.uids, dest);
    }
  },
  async snooze(ids, until) {
    applyLocal(ids, { snoozedUntil: until });
    for (const id of ids) {
      const { account, folder } = splitId(id);
      const list = folderCache.get(fkey(account, folder));
      if (list) void writeJson(files.folder(account, folder), { ...(await readJson<FolderCache>(files.folder(account, folder), { messages: [] })), messages: list });
    }
    // Comes back as a reminder at that time.
    const m = await cachedMessages(splitId(ids[0]).account, splitId(ids[0]).folder);
    const first = m.find((x) => x.id === ids[0]);
    state.reminders.push({ id: `local:snooze-${randomUUID()}`, list: 'local', title: `Mail: ${first?.subject ?? 'snoozed message'}`, remindAt: until, done: false, notes: ids.join('\n') });
    saveState();
    changed('reminders');
  },
  async saveAttachment(id, att, to) {
    const { filename, content } = await rawAttachment(id, att);
    let dest = to;
    if (!dest) {
      const dir = state.prefs.attachmentsFolder ?? app.getPath('downloads');
      const win = BrowserWindow.getFocusedWindow();
      const r = win ? await dialog.showSaveDialog(win, { defaultPath: path.join(dir, filename) }) : { canceled: false, filePath: path.join(dir, filename) };
      if (r.canceled || !r.filePath) return null;
      dest = r.filePath;
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, content);
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
    if (u.url && u.oneClick) {
      const res = await fetch(u.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }).catch(() => null);
      if (res?.ok) return { done: true, how: 'Unsubscribed' };
    }
    if (u.mailto) {
      const m = new URL(u.mailto);
      const a = acct(o.summary.account);
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
    const d = makeReply({ original: { ...o.summary, text: o.text }, me, mode, replyTo: replyToH ? parseAddressList(replyToH) : undefined });
    if (mode === 'forward') d.attachments = [];
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
    return state.outbox.map((q) => ({ id: q.id, sendAt: q.sendAt, subject: q.subject, error: q.error }));
  },
  async saveDraft(d) {
    const a = acct(d.account);
    if (!a) return;
    const drafts = await folderOf(a, 'drafts');
    if (!drafts) return;
    const { raw } = await compose({ from: identityOf(a, d.from), to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, text: [d.body, d.quoted ?? ''].filter(Boolean).join('\n\n'), inReplyTo: d.inReplyTo, references: d.references });
    await mailbox(a).append(drafts, raw, ['\\Draft', '\\Seen']);
  },
  async suggest(q) {
    await load();
    return suggestAddresses(contacts, state.recent, q);
  },
  ai: (id, task) => aiOnThread(id, task),
  async respond(id, status) {
    const o = await openMessage(id, { markRead: false });
    if (!o.invite) throw new Error('This message has no invitation');
    const a = acct(o.summary.account)!;
    const me = identityOf(a);
    const inv = readInvitation((bodyCache.get(id) ?? (await readJson<{ body: { invite?: string } } | null>(files.body(id), null)))!.body.invite!)!;
    const r = replyTo(inv, { email: me.address, name: me.name }, status);
    if (r.to && a.smtp) {
      const { raw, envelope } = await compose({ from: me, to: [{ address: r.to }], cc: [], bcc: [], subject: r.subject, text: r.subject, icalEvent: { method: 'REPLY', content: r.ics } });
      await smtpSend(a, await mailAuth(a), raw, envelope);
    }
    // Your copy in your calendar shows your answer.
    if (status === 'declined') {
      const ev = [...events.values()].flat().find((e) => e.uid === inv.event.uid);
      if (ev) await deleteEvent(ev.id, { scope: 'all' }).catch(() => undefined);
    } else {
      await saveEvent({ ...inv.event, calendar: state.prefs.defaultCalendar ?? LOCAL_CAL, id: '', attendees: inv.event.attendees?.map((x) => (x.email.toLowerCase() === me.address.toLowerCase() ? { ...x, status } : x)) });
    }
    deps?.alert(status === 'declined' ? 'Declined' : status === 'accepted' ? 'Accepted' : 'Maybe', inv.event.title);
  },
  async rules() {
    await load();
    return state.rules;
  },
  async saveRules(r: MailRule[]) {
    state.rules = r;
    saveState();
  },
  async pickFiles() {
    const win = BrowserWindow.getFocusedWindow();
    const r = win ? await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] }) : { canceled: true, filePaths: [] };
    return r.canceled ? [] : r.filePaths;
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
      const win = BrowserWindow.getFocusedWindow();
      const r = win ? await dialog.showOpenDialog(win, { filters: [{ name: 'Calendar', extensions: ['ics', 'ical'] }] }) : { canceled: true, filePaths: [] };
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
    const win = BrowserWindow.getFocusedWindow();
    const r = win ? await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), `${cal.name}.ics`) }) : { canceled: true, filePath: undefined };
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
}

async function stopMail() {
  clearTimeout(outboxTimer);
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

/** For tests and the agents layer. */
export const pimInternals = { load, state: () => state, accounts: () => accounts };

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
