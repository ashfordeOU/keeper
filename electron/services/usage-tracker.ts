// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The AI usage and subscription tracker in the main process: accounts and
// their keys (system keychain), reading each source (the coding CLIs' files
// on this computer, the services' documented usage and balance endpoints,
// Keeper's own calls), history, warnings and reminders, the menu-bar item
// with its pop-over, and the Island's ring. Nothing runs and nothing is read
// until an account is added; every look goes through the governor; only the
// services' own endpoints are called, with the person's own keys.

import { app, BrowserWindow, dialog, Notification } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, promises as fsp, watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AccountInput, AccountView, DetectedAccount, UsageOverview } from '../../core/api-ai-usage';
import { claudeDataDirs, claudeReadText, claudeTokenLines, copilotQuota, copilotToken, cursorUsage, type TokenLine } from '../../core/island-tools/usage';
import { geminiReplies, opencodeReply, type ReplyLine } from '../../core/island-tools/usage-more';
import { glanceUsage, renderLabel, type GlanceUsage, type MenuBarLabel } from '../../core/usage-tracker/label';
import { countdown, defaultTrackerSettings, newId, normalizeTrackerSettings, providerInfo, PROVIDERS, type Account, type AccountState, type Limit, type ProviderId, type TrackerSettings } from '../../core/usage-tracker/model';
import { prioritize, summarize, transitions, type HistoryPoint, type PriorityItem, type Urgency } from '../../core/usage-tracker/priority';
import { rateHeadersFor } from '../../core/usage-tracker/rate-store';
import {
  anthropicCostUsd, anthropicUsageTokens, apiMonthLimits, ccLocalWindows, ccOAuth, ccStatusLine, codexLatest, codexSnapshots, costLimits, dailyLimits,
  deepseekBalance, fromUsageWindows, geminiQuota, httpLimits, keeperLimits, mergeExact, monthStartUtc, openaiCostsUsd, openaiUsage, openrouterKey, rateLimits, serviceOf, xaiBalance,
} from '../../core/usage-tracker/sources';
import { chatgptSession, chatgptUsage, claudeIdentity, claudeOrgs, claudeWebUsage, defaultWebName, isWebProvider, pickClaudeOrg, WEB_PROVIDERS, type ClaudeOrg, type WebProviderId } from '../../core/usage-tracker/web';
import { addPoint, dueReminders, historyCsv, monthlyTotals, MONTHLY_FACTOR, receiptFrom, subscriptionLimits, type ReceiptGuess } from '../../core/usage-tracker/subscriptions';
import { getSecret, setSecret } from '../store';
import { featureOn, onFeature } from './features';
import { poll } from './governor';

declare const __KEEPER_OFFICIAL__: boolean | undefined;
const OFFICIAL = typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__;
const isMac = process.platform === 'darwin';
const D = 86_400_000;

export interface UsageTrackerDeps {
  preload: string;
  load: (win: BrowserWindow, view: string) => void;
  lockDown: (win: BrowserWindow) => void;
  showMain: (route?: string) => void;
  broadcast: (channel: string, ...args: unknown[]) => void;
  alert: (title: string, detail?: string) => void;
}
let deps: UsageTrackerDeps | null = null;

// ---------------------------------------------------------------- the store

interface StoreFile {
  accounts: Account[];
  settings: TrackerSettings;
  states: Record<string, AccountState>;
  history: Record<string, HistoryPoint[]>;
  costs: Record<string, Record<string, number>>;
  prevUrgency: Record<string, Urgency>;
  prevLeft: Record<string, number | undefined>;
  /** reminders and warnings already sent */
  notified: string[];
  /** a weekly reset time learned from an exact reading, per account */
  weeklyReset: Record<string, number>;
  /** the status-line setting each account had before Keeper's (restored when turned off) */
  statusLinePrev: Record<string, { had: boolean; value?: unknown }>;
}

const empty = (): StoreFile => ({ accounts: [], settings: defaultTrackerSettings(), states: {}, history: {}, costs: {}, prevUrgency: {}, prevLeft: {}, notified: [], weeklyReset: {}, statusLinePrev: {} });
let store: StoreFile | null = null;
let saveTimer: NodeJS.Timeout | undefined;
const file = () => path.join(app.getPath('userData'), 'usage-tracker.json');

async function load(): Promise<StoreFile> {
  if (store) return store;
  try {
    const raw = JSON.parse(await fsp.readFile(file(), 'utf8')) as Partial<StoreFile>;
    store = { ...empty(), ...raw, settings: normalizeTrackerSettings(raw.settings), accounts: Array.isArray(raw.accounts) ? raw.accounts : [] };
  } catch {
    store = empty();
  }
  return store;
}

function persist(now = false): Promise<void> {
  clearTimeout(saveTimer);
  const write = async () => {
    if (!store) return;
    const tmp = `${file()}.${process.pid}.tmp`;
    await fsp.mkdir(path.dirname(file()), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(store), { mode: 0o600 });
    await fsp.rename(tmp, file());
  };
  if (now) return write().catch(() => undefined);
  saveTimer = setTimeout(() => void write().catch(() => undefined), 1500);
  saveTimer.unref?.();
  return Promise.resolve();
}

export const flushUsageTracker = () => persist(true);

// ---------------------------------------------------------------- keys (system keychain; this session only without one)

const memKeys = new Map<string, string>();
let keysInMemory = false;
const keyName = (id: string) => `aiusage:${id}`;
async function keyFor(id: string): Promise<string | undefined> {
  return memKeys.get(id) ?? (await getSecret(keyName(id)).catch(() => undefined));
}
async function keepKey(id: string, value: string) {
  const ok = await setSecret(keyName(id), value).catch(() => false);
  if (ok || !value) memKeys.delete(id);
  if (!ok && value) {
    memKeys.set(id, value);
    keysInMemory = true;
  }
}
const hasKey = async (id: string) => memKeys.has(id) || !!(await getSecret(keyName(id)).catch(() => undefined));

// ---------------------------------------------------------------- reading files (cached by size and time)

const home = () => os.homedir();
const parsed = new Map<string, { mtime: number; size: number; value: unknown }>();

/**
 * The newest matching files under `dir`. `prune` skips folders untouched since the window began;
 * that is right only for folders made per day (Codex's sessions/YYYY/MM/DD), because a folder's
 * time changes when a file is added, not when one is appended to.
 */
async function newestFiles(dir: string, match: (name: string) => boolean, o: { maxAgeMs: number; depth: number; max: number; prune?: boolean }): Promise<{ p: string; m: number; s: number }[]> {
  const out: { p: string; m: number; s: number }[] = [];
  const since = Date.now() - o.maxAgeMs;
  const walk = async (d: string, left: number) => {
    let entries: import('node:fs').Dirent[];
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && left > 0) {
        // A folder made per day and untouched since the window began holds nothing new.
        if (!o.prune) await walk(p, left - 1);
        else {
          const st = await fsp.stat(p).catch(() => null);
          if (st && st.mtimeMs >= since - D) await walk(p, left - 1);
        }
      } else if (e.isFile() && match(e.name)) {
        const st = await fsp.stat(p).catch(() => null);
        if (st && st.mtimeMs >= since) out.push({ p, m: st.mtimeMs, s: st.size });
      }
    }
  };
  await walk(dir, o.depth);
  return out.sort((a, b) => b.m - a.m).slice(0, o.max);
}

async function cachedParse<T>(f: { p: string; m: number; s: number }, parse: (text: string) => T): Promise<T> {
  const c = parsed.get(f.p);
  if (c && c.mtime === f.m && c.size === f.s) return c.value as T;
  const value = parse(await fsp.readFile(f.p, 'utf8').catch(() => ''));
  parsed.set(f.p, { mtime: f.m, size: f.s, value });
  return value;
}

function dirOf(a: Account): string {
  const info = providerInfo(a.provider);
  if (a.configDir) return a.configDir.replace(/^~(?=$|[\\/])/, home());
  if (info.dirEnv && process.env[info.dirEnv]) return process.env[info.dirEnv]!;
  if (a.provider === 'copilot') return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home(), '.config'), 'github-copilot');
  if (a.provider === 'cursor') {
    return process.platform === 'darwin' ? path.join(home(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage')
      : process.platform === 'win32' ? path.join(process.env.APPDATA ?? '', 'Cursor', 'User', 'globalStorage')
        : path.join(process.env.XDG_CONFIG_HOME ?? path.join(home(), '.config'), 'Cursor', 'User', 'globalStorage');
  }
  return path.join(home(), info.defaultDir ?? '');
}

// ---------------------------------------------------------------- the network (only the services' own endpoints)

/** Tests point every service at a local stub; official builds ignore this. */
function endpoint(url: string): string {
  const stub = !OFFICIAL ? process.env.KEEPER_USAGE_STUB : undefined;
  if (!stub) return url;
  const u = new URL(url);
  return `${stub.replace(/\/$/, '')}/${u.host}${u.pathname}${u.search}`;
}

async function getJson(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(endpoint(url), { headers: { 'user-agent': `Keeper/${app.getVersion()}`, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = undefined; }
  return { ok: res.ok, status: res.status, body };
}

class SourceError extends Error {}
async function must(url: string, headers: Record<string, string>, what: string) {
  const r = await getJson(url, headers);
  if (r.status === 401 || r.status === 403) throw new SourceError(`${what} did not accept the key (${r.status}).`);
  if (!r.ok) throw new SourceError(`${what} answered ${r.status}.`);
  return r.body;
}

/** Follows `has_more` / `next_page` for a few pages (a month of daily buckets is one or two). */
async function pages(url: string, headers: Record<string, string>, what: string): Promise<unknown> {
  const all: unknown[] = [];
  let next: string | undefined;
  for (let i = 0; i < 4; i++) {
    const body = (await must(next ? `${url}&page=${encodeURIComponent(next)}` : url, headers, what)) as { data?: unknown[]; has_more?: boolean; next_page?: string };
    all.push(...(body?.data ?? []));
    if (!body?.has_more || !body.next_page) break;
    next = body.next_page;
  }
  return { data: all };
}

// ---------------------------------------------------------------- each source

const state = (a: Account, s: Omit<AccountState, 'accountId' | 'at' | 'accuracy'> & { accuracy?: AccountState['accuracy'] }): AccountState => ({ accountId: a.id, at: Date.now(), accuracy: s.accuracy ?? providerInfo(a.provider).accuracy, ...s });

async function readStatusFile(dir: string): Promise<{ json: unknown; at: number } | undefined> {
  const f = path.join(dir, 'keeper-status.json');
  const st = await fsp.stat(f).catch(() => null);
  if (!st) return undefined;
  try { return { json: JSON.parse(await fsp.readFile(f, 'utf8')), at: st.mtimeMs }; } catch { return undefined; }
}

function macKeychain(service: string): Promise<string | undefined> {
  return new Promise((resolve) => execFile('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], { timeout: 5000 }, (err, out) => resolve(err ? undefined : out.trim())));
}

/**
 * The folders an account of the coding CLI reads: the one it names; else the one(s) the
 * environment points the tool at; else both the XDG folder and ~/.claude (newer versions of the
 * tool write to the first).
 */
function ccDirs(a: Account): string[] {
  if (a.configDir) return [dirOf(a)];
  const env = providerInfo('cc').dirEnv!;
  return claudeDataDirs(home(), { configDir: process.env[env], xdgConfig: process.env.XDG_CONFIG_HOME }, path.sep);
}
const tilde = (p: string) => (p.startsWith(home()) ? `~${p.slice(home().length)}` : p);

async function ccRead(a: Account): Promise<AccountState> {
  const dirs = ccDirs(a).filter((d) => existsSync(d));
  if (!dirs.length) return state(a, { state: 'empty', limits: [], source: '', message: `Nothing in ${ccDirs(a).map(tilde).join(' or ')} yet. Use the tool once with this folder.` });
  // The status line and the saved sign-in live in the account's own folder (~/.claude by default).
  const dir = dirOf(a);
  const files = (await Promise.all(dirs.map((d) => newestFiles(path.join(d, 'projects'), (n) => n.endsWith('.jsonl'), { maxAgeMs: 8 * D, depth: 4, max: 300 })))).flat();
  const lines: TokenLine[] = [];
  for (const f of files) lines.push(...(await cachedParse(f, claudeTokenLines)));
  const now = Date.now();
  let exact: Limit[] = [];
  const read = claudeReadText({ files: files.length, replies: lines.length, weekReplies: lines.filter((l) => l.at > now - 7 * D).length, where: dirs.map(tilde).join(' and ') });
  const sources: string[] = [read.charAt(0).toLowerCase() + read.slice(1)];
  let message: string | undefined;
  if (a.statusLine) {
    const st = await readStatusFile(dir);
    if (st) {
      exact = ccStatusLine(st.json, now);
      if (exact.length) sources.unshift('limits from its status line');
    } else message = 'Waiting for the tool to show its status line once (send it a message).';
  }
  if (!exact.length && a.online) {
    try {
      let token: string | undefined;
      const cred = path.join(dir, '.credentials.json');
      if (existsSync(cred)) token = (JSON.parse(await fsp.readFile(cred, 'utf8')) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth?.accessToken;
      if (!token && isMac && !a.configDir) token = await macKeychain(`${providerInfo('cc').label}-credentials`).then((j) => j && (JSON.parse(j) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth?.accessToken).catch(() => undefined);
      if (token) {
        const r = await getJson(process.env.KEEPER_CLAUDE_USAGE_URL && !OFFICIAL ? process.env.KEEPER_CLAUDE_USAGE_URL : 'https://api.anthropic.com/api/oauth/usage', { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' });
        if (r.ok) {
          exact = ccOAuth(r.body);
          if (exact.length) sources.unshift('limits from Anthropic with the tool’s own sign-in');
        } else message = `Anthropic did not return limits (${r.status}); showing estimates.`;
      } else message = 'Could not find the tool’s sign-in in this folder; showing estimates.';
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
  }
  const weekly = exact.find((l) => l.key === 'weekly')?.resetsAt;
  if (weekly && store) store.weeklyReset[a.id] = weekly;
  const local = ccLocalWindows(lines, now, a.plan, store?.weeklyReset[a.id]);
  const limits = mergeExact(local, exact);
  if (!exact.length && !a.plan?.fiveHourTokens && !a.plan?.weeklyTokens) message ??= 'Estimated: add plan limits, or let Keeper read its status line, to see what is left.';
  return state(a, { state: 'ok', limits, source: sources.join('; '), message, accuracy: exact.length ? 'exact' : 'estimated' });
}

async function codexRead(a: Account): Promise<AccountState> {
  const dir = dirOf(a);
  if (!existsSync(dir)) return state(a, { state: 'empty', limits: [], source: '', message: `Nothing in ${dir} yet.` });
  const files = await newestFiles(path.join(dir, 'sessions'), (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'), { maxAgeMs: 8 * D, depth: 4, max: 6, prune: true });
  const snaps = [];
  for (const f of files) snaps.push(...(await cachedParse(f, (t) => codexSnapshots(t))));
  const latest = codexLatest(snaps);
  if (!latest) return state(a, { state: 'empty', limits: [], source: '', message: 'Codex has not reported its limits in the last week; use it once and look again.' });
  return state(a, { state: 'ok', limits: latest.limits, source: `limits Codex wrote ${countdown(Date.now() - latest.at)} ago${latest.plan ? ` (${latest.plan} plan)` : ''}` });
}

async function repliesRead(a: Account, kind: 'gemini-cli' | 'qwen'): Promise<AccountState> {
  const dir = dirOf(a);
  if (!existsSync(dir)) return state(a, { state: 'empty', limits: [], source: '', message: `Nothing in ${dir} yet.` });
  const files = await newestFiles(path.join(dir, 'tmp'), (n) => n.startsWith('session-') && n.endsWith('.json'), { maxAgeMs: 8 * D, depth: 3, max: 400 });
  const lines: ReplyLine[] = [];
  for (const f of files) lines.push(...(await cachedParse(f, geminiReplies)));
  const daily = a.plan?.dailyRequests ?? (kind === 'gemini-cli' ? 1000 : 2000);
  const local = dailyLimits(lines, Date.now(), daily);
  const source = `counted from ${files.length} session file${files.length === 1 ? '' : 's'}`;
  if (kind !== 'gemini-cli' || !a.online) return state(a, { state: 'ok', limits: local, source });
  // Opt-in, unofficial: the quota Gemini CLI's own /stats shows, with its saved Google sign-in.
  try {
    const creds = JSON.parse(await fsp.readFile(path.join(dir, 'oauth_creds.json'), 'utf8')) as { access_token?: string; expiry_date?: number };
    if (!creds.access_token) throw new SourceError('Gemini CLI is not signed in with Google in this folder.');
    if (creds.expiry_date && creds.expiry_date < Date.now()) throw new SourceError('Gemini CLI’s sign-in has expired; run Gemini CLI once to renew it.');
    const post = async (method: string, body: unknown) => {
      const res = await fetch(endpoint(`https://cloudcode-pa.googleapis.com/v1internal:${method}`), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.access_token}`, 'user-agent': `Keeper/${app.getVersion()}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new SourceError(`Google answered ${res.status} (unofficial endpoint).`);
      return res.json() as Promise<Record<string, unknown>>;
    };
    const loaded = await post('loadCodeAssist', { metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } });
    const project = String(loaded.cloudaicompanionProject ?? '');
    const quota = geminiQuota(await post('retrieveUserQuota', { project }), Date.now());
    return state(a, { state: 'ok', limits: [...quota, ...local.filter((l) => !quota.length || l.key !== 'daily')], source: `quota from Google’s Code Assist endpoint (unofficial); ${source}`, accuracy: quota.length ? 'exact' : 'estimated' });
  } catch (e) {
    return state(a, { state: 'ok', limits: local, source, message: e instanceof Error ? e.message : String(e) });
  }
}

// ---------------------------------------------------------------- web sign-ins (claude.ai, chatgpt.com): unofficial, opt-in

/** When each web account last asked its site, and the ones to ask on the next look regardless. */
const webAsked = new Map<string, number>();
const webFresh = new Set<string>();
const claudeOrgCache = new Map<string, { at: number; orgs: ClaudeOrg[] }>();

const signInAgain = (a: Account, message: string): AccountState => state(a, { state: 'empty', limits: [], source: '', message, needsSignIn: true });

/** The site said this account is signed out: remember it, so nothing more is sent until the person signs in again. */
function signedOut(a: Account, site: string): AccountState {
  a.signedIn = { at: a.signedIn?.at ?? Date.now(), email: a.signedIn?.email, expired: true };
  void persist();
  return signInAgain(a, `Signed out of ${site}. Sign in again to keep reading this account.`);
}

async function claudeOrgsFor(a: Account, force = false): Promise<ClaudeOrg[] | AccountState> {
  const { webGet } = await import('./usage-web');
  const c = claudeOrgCache.get(a.id);
  if (c && !force && Date.now() - c.at < 6 * 3600_000) return c.orgs;
  const r = await webGet(a.id, 'claude-web', '/api/organizations');
  if (r.answer === 'signed-out') return signedOut(a, 'claude.ai');
  if (r.answer !== 'ok') throw new SourceError(webTrouble(r.answer, r.status, 'claude.ai'));
  const orgs = claudeOrgs(r.body);
  claudeOrgCache.set(a.id, { at: Date.now(), orgs });
  return orgs;
}

const webTrouble = (answer: string, status: number, site: string) => answer === 'blocked'
  ? `${site} asked for a browser check. Open “Sign in again” once to pass it.`
  : answer === 'busy' ? `${site} asked Keeper to slow down (429); it tries again later.` : `${site} answered ${status} (unofficial endpoint; it may have changed).`;

async function webRead(a: Account & { provider: WebProviderId }): Promise<AccountState> {
  const site = WEB_PROVIDERS[a.provider].site;
  if (!a.signedIn) return signInAgain(a, `Not signed in yet. Choose “Sign in” to sign in to ${site} in a window of its own.`);
  if (a.signedIn.expired) return signInAgain(a, `Signed out of ${site}. Sign in again to keep reading this account.`);
  if (!a.online) return state(a, { state: 'empty', limits: [], source: '', message: offMessage(a) });
  // Never more often than the service interval, except right after signing in or opting in.
  const every = (store?.settings.apiEveryMin ?? 10) * 60_000;
  const last = webAsked.get(a.id);
  const prev = store?.states[a.id];
  if (!webFresh.has(a.id) && last && Date.now() - last < every - 15_000 && prev && prev.state !== 'error') return prev;
  webFresh.delete(a.id);
  webAsked.set(a.id, Date.now());
  const { webGet } = await import('./usage-web');
  const now = Date.now();
  if (a.provider === 'claude-web') {
    const orgs = await claudeOrgsFor(a);
    if (!Array.isArray(orgs)) return orgs;
    const org = pickClaudeOrg(orgs, a.orgId);
    if (!org) return state(a, { state: 'empty', limits: [], source: '', message: 'This sign-in has no claude.ai organization to read.' });
    const r = await webGet(a.id, 'claude-web', `/api/organizations/${encodeURIComponent(org.id)}/usage`);
    if (r.answer === 'signed-out') return signedOut(a, site);
    if (r.answer !== 'ok') throw new SourceError(webTrouble(r.answer, r.status, site));
    const limits = claudeWebUsage(r.body, now);
    const choices = orgs.filter((o) => o.chat).map((o) => ({ id: o.id, name: o.name, plan: o.plan }));
    const base = { plan: org.plan, orgs: choices.length > 1 ? choices : undefined };
    if (!limits.length) return state(a, { ...base, state: 'empty', limits: [], source: `claude.ai (unofficial)`, message: `claude.ai shows no limits for ${org.name}${org.plan ? ` (${org.plan})` : ''}${org.plan === 'Free' ? '; free plans may have none to show' : ''}.` });
    return state(a, { ...base, state: 'ok', limits, source: `claude.ai’s own usage page data for ${org.name}${org.plan ? `, ${org.plan} plan` : ''} (unofficial)` });
  }
  // ChatGPT: the session gives a short-lived token (kept in memory for this request only).
  const sr = await webGet(a.id, 'chatgpt-web', '/api/auth/session');
  if (sr.answer === 'signed-out') return signedOut(a, site);
  if (sr.answer !== 'ok') throw new SourceError(webTrouble(sr.answer, sr.status, site));
  const sess = chatgptSession(sr.body);
  if (!sess.accessToken) return signedOut(a, site);
  const r = await webGet(a.id, 'chatgpt-web', '/backend-api/wham/usage', { authorization: `Bearer ${sess.accessToken}`, ...(sess.accountId ? { 'chatgpt-account-id': sess.accountId } : {}) });
  const noWeb = `Codex limits are not available from the web for this account; add its Codex folder (Accounts → Add account → Codex) for exact numbers.`;
  if (r.answer === 'signed-out' && r.status === 401) return signedOut(a, site);
  if (r.answer !== 'ok') return state(a, { state: 'empty', limits: [], plan: sess.plan, source: 'chatgpt.com (unofficial)', message: r.status === 404 || r.status === 403 ? noWeb : webTrouble(r.answer, r.status, site) });
  const u = chatgptUsage(r.body, now);
  const plan = u.plan ?? sess.plan;
  if (!u.limits.length) return state(a, { state: 'empty', limits: [], plan, source: 'chatgpt.com (unofficial)', message: `${plan ? `${plan} plan. ` : ''}${noWeb}` });
  return state(a, { state: 'ok', limits: u.limits, plan, source: `chatgpt.com’s own Codex usage data${plan ? `, ${plan} plan` : ''} (unofficial)` });
}

/** Who is signed in, asked once right after signing in (the person's own action). */
async function webIdentity(a: Account & { provider: WebProviderId }): Promise<{ email?: string } | undefined> {
  const { webGet } = await import('./usage-web');
  if (a.provider === 'claude-web') {
    const r = await webGet(a.id, 'claude-web', '/api/account').catch(() => null);
    if (r?.answer === 'ok') {
      const orgs = claudeOrgs(r.body);
      if (orgs.length) claudeOrgCache.set(a.id, { at: Date.now(), orgs });
      return { email: claudeIdentity(r.body).email };
    }
    const o = await webGet(a.id, 'claude-web', '/api/organizations').catch(() => null);
    return o?.answer === 'ok' ? {} : undefined;
  }
  const r = await webGet(a.id, 'chatgpt-web', '/api/auth/session').catch(() => null);
  const sess = r?.answer === 'ok' ? chatgptSession(r.body) : {};
  return sess.accessToken ? { email: sess.email } : undefined;
}

const offMessage = (a: Account) => `Unofficial source: turn on “${providerInfo(a.provider).optIn?.label}” in its settings to read it.`;

async function copilotRead(a: Account): Promise<AccountState> {
  const dir = dirOf(a);
  let token: string | undefined;
  for (const f of ['apps.json', 'hosts.json']) token ??= copilotToken(await fsp.readFile(path.join(dir, f), 'utf8').catch(() => ''));
  if (!token) return state(a, { state: 'empty', limits: [], source: '', message: `Copilot is not signed in in ${dir}.` });
  if (!a.online) return state(a, { state: 'empty', limits: [], source: '', message: offMessage(a) });
  const body = await must(process.env.KEEPER_COPILOT_URL && !OFFICIAL ? process.env.KEEPER_COPILOT_URL : 'https://api.github.com/copilot_internal/user', { authorization: `token ${token}` }, 'GitHub');
  const limits = fromUsageWindows(copilotQuota(body));
  return limits.length ? state(a, { state: 'ok', limits, source: 'GitHub’s internal Copilot endpoint with Copilot’s sign-in (unofficial)' }) : state(a, { state: 'empty', limits: [], source: '', message: 'GitHub returned no quota (unlimited plans have none).' });
}

function sqlite(db: string, sql: string): Promise<string | undefined> {
  return new Promise((resolve) => execFile('sqlite3', [db, sql], { timeout: 5000 }, (err, out) => resolve(err ? undefined : out.trim())));
}

async function cursorRead(a: Account): Promise<AccountState> {
  const dir = dirOf(a);
  const db = dir.endsWith('.vscdb') ? dir : path.join(dir, 'state.vscdb');
  if (!existsSync(db)) return state(a, { state: 'empty', limits: [], source: '', message: `No Cursor settings database at ${db}.` });
  if (!a.online) return state(a, { state: 'empty', limits: [], source: '', message: offMessage(a) });
  const token = await sqlite(db, "select value from ItemTable where key='cursorAuth/accessToken'");
  if (!token) throw new SourceError('Could not read Cursor’s sign-in (the sqlite3 command is needed).');
  let user = '';
  try { user = (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { sub?: string }).sub?.split('|').pop() ?? ''; } catch { /* not a JWT */ }
  const body = await must(`${process.env.KEEPER_CURSOR_URL && !OFFICIAL ? process.env.KEEPER_CURSOR_URL : 'https://cursor.com/api/usage'}?user=${encodeURIComponent(user)}`, { cookie: `WorkosCursorSessionToken=${encodeURIComponent(`${user}::${token}`)}` }, 'Cursor');
  const limits = fromUsageWindows(cursorUsage(body));
  return limits.length ? state(a, { state: 'ok', limits, source: 'cursor.com’s usage endpoint with the Cursor app’s sign-in (unofficial)' }) : state(a, { state: 'empty', limits: [], source: '', message: 'Cursor returned no usage.' });
}

async function opencodeRead(a: Account): Promise<AccountState> {
  const dir = dirOf(a);
  if (!existsSync(dir)) return state(a, { state: 'empty', limits: [], source: '', message: `Nothing in ${dir} yet.` });
  const files = await newestFiles(path.join(dir, 'storage', 'message'), (n) => n.endsWith('.json'), { maxAgeMs: 32 * D, depth: 2, max: 4000 });
  const lines: ReplyLine[] = [];
  for (const f of files) { const r = await cachedParse(f, opencodeReply); if (r) lines.push(r); }
  return state(a, { state: 'ok', limits: costLimits(lines, Date.now(), a.budget), source: `counted from ${files.length} message file${files.length === 1 ? '' : 's'}`, monthUsd: undefined });
}

async function keeperRows(service?: string): Promise<{ calls: number; input: number; output: number; cost?: number }[]> {
  const { usageReport } = await import('./agents');
  const { brainSettings } = await import('./brain');
  const day = new Date().getUTCDate();
  const conns = brainSettings().connections;
  return usageReport(day).filter((r) => {
    if (!service) return true;
    const c = conns.find((x) => x.id === r.id);
    return !!c && serviceOf(c.baseUrl || c.kind) === service;
  });
}

async function apiRead(a: Account): Promise<AccountState> {
  const now = Date.now();
  const key = await keyFor(a.id);
  const needsKey = providerInfo(a.provider).fields.includes('key') && a.provider !== 'http';
  if (needsKey && !key) return state(a, { state: 'error', limits: [], source: '', message: 'Add a key for this account.' });
  const since = new Date(monthStartUtc(now)).toISOString();
  const sinceSec = Math.floor(monthStartUtc(now) / 1000);
  switch (a.provider) {
    case 'anthropic-api': {
      const h = { 'x-api-key': key!, 'anthropic-version': '2023-06-01' };
      const [u, c] = await Promise.all([
        pages(`https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=${encodeURIComponent(since)}&bucket_width=1d&limit=31`, h, 'Anthropic'),
        pages(`https://api.anthropic.com/v1/organizations/cost_report?starting_at=${encodeURIComponent(since)}&limit=31`, h, 'Anthropic'),
      ]);
      const usd = anthropicCostUsd(c).usd;
      return state(a, { state: 'ok', limits: apiMonthLimits({ usd, tokens: anthropicUsageTokens(u).tokens, budget: a.budget }, now), source: 'Admin API usage and cost reports', monthUsd: usd });
    }
    case 'openai-api': {
      const h = { authorization: `Bearer ${key}` };
      const [u, c] = await Promise.all([
        pages(`https://api.openai.com/v1/organization/usage/completions?start_time=${sinceSec}&bucket_width=1d&limit=31`, h, 'OpenAI'),
        pages(`https://api.openai.com/v1/organization/costs?start_time=${sinceSec}&bucket_width=1d&limit=31`, h, 'OpenAI'),
      ]);
      const usd = openaiCostsUsd(c).usd;
      const use = openaiUsage(u);
      return state(a, { state: 'ok', limits: apiMonthLimits({ usd, tokens: use.tokens, requests: use.requests, budget: a.budget }, now), source: 'Organization usage and costs endpoints', monthUsd: usd });
    }
    case 'openrouter': {
      const limits = openrouterKey(await must('https://openrouter.ai/api/v1/key', { authorization: `Bearer ${key}` }, 'OpenRouter'), now);
      return state(a, { state: 'ok', limits, source: 'Its key endpoint', monthUsd: limits.find((l) => l.key === 'month-cost')?.used });
    }
    case 'deepseek':
      return state(a, { state: 'ok', limits: deepseekBalance(await must('https://api.deepseek.com/user/balance', { authorization: `Bearer ${key}` }, 'DeepSeek'), a.budget), source: 'Its balance endpoint' });
    case 'xai': {
      if (!a.teamId) return state(a, { state: 'error', limits: [], source: '', message: 'Add your xAI team id (Console → Settings).' });
      const body = await must(`https://management-api.x.ai/v1/billing/teams/${encodeURIComponent(a.teamId)}/prepaid/balance`, { authorization: `Bearer ${key}` }, 'xAI');
      return state(a, { state: 'ok', limits: xaiBalance(body, a.budget), source: 'Management API prepaid balance' });
    }
    case 'http': {
      if (!a.http?.url || !a.http.used) return state(a, { state: 'error', limits: [], source: '', message: 'Add the address and the field that holds the amount used.' });
      const body = await must(a.http.url, key ? { authorization: `Bearer ${key}` } : {}, new URL(a.http.url).host);
      const limits = httpLimits(body, a.http, now);
      return limits.length ? state(a, { state: 'ok', limits, source: new URL(a.http.url).host }) : state(a, { state: 'error', limits: [], source: '', message: `No number at “${a.http.used}” in the answer.` });
    }
    case 'mistral': case 'groq': case 'gemini-api': case 'keeper': {
      const svc = a.provider === 'keeper' ? undefined : a.provider;
      const rows = await keeperRows(svc).catch(() => []);
      const limits = [...keeperLimits(rows, now, a.budget), ...(svc ? rateLimits(rateHeadersFor(svc), now) : [])];
      return state(a, { state: 'ok', limits, source: svc ? 'Keeper’s own calls to this service, and the limits it reports back' : 'Keeper’s own calls to your AI connections', monthUsd: limits[0].used });
    }
    default:
      return state(a, { state: 'empty', limits: [], source: '' });
  }
}

async function readAccount(a: Account): Promise<AccountState> {
  if (a.paused) return state(a, { state: 'paused', limits: [], source: '', message: 'Paused: nothing is read until you resume it.' });
  switch (a.provider) {
    case 'cc': return ccRead(a);
    case 'codex': return codexRead(a);
    case 'gemini-cli': return repliesRead(a, 'gemini-cli');
    case 'qwen': return repliesRead(a, 'qwen');
    case 'opencode': return opencodeRead(a);
    case 'copilot': return copilotRead(a);
    case 'cursor': return cursorRead(a);
    case 'claude-web': case 'chatgpt-web': return webRead(a as Account & { provider: WebProviderId });
    case 'subscription': return state(a, { state: 'ok', limits: a.subscription ? subscriptionLimits(a.subscription, Date.now()) : [], source: 'kept by hand' });
    default: return apiRead(a);
  }
}

/** Read on the 2-minute local schedule (files, Keeper's own log, subscriptions); services and web sign-ins go on the slower one. */
const isLocal = (a: Account) => { const k = providerInfo(a.provider).kind; return k === 'local' || k === 'manual'; };

// ---------------------------------------------------------------- looking, with backoff on errors

const failures = new Map<string, { n: number; until: number }>();
let lastLook = 0;
let busy: Promise<void> | null = null;

async function look(which: 'local' | 'api' | 'all', only?: string, force = false): Promise<void> {
  const s = await load();
  const list = s.accounts.filter((a) => (only ? a.id === only : which === 'all' || (which === 'local') === isLocal(a)));
  await Promise.all(list.map(async (a) => {
    const f = failures.get(a.id);
    if (!force && f && Date.now() < f.until) return;
    try {
      const st = await readAccount(a);
      s.states[a.id] = st;
      if (st.state === 'error') throw new SourceError(st.message ?? 'error');
      failures.delete(a.id);
    } catch (e) {
      const n = (f?.n ?? 0) + 1;
      // Back off: twice as long after each failure, up to an hour.
      failures.set(a.id, { n, until: Date.now() + Math.min(3600_000, s.settings.apiEveryMin * 60_000 * 2 ** (n - 1)) });
      const prev = s.states[a.id];
      s.states[a.id] = { ...(prev ?? state(a, { state: 'error', limits: [], source: '' })), state: 'error', at: Date.now(), message: e instanceof Error ? e.message : String(e) };
    }
  }));
  lastLook = Date.now();
  after();
}

function lookOnce(which: 'local' | 'api' | 'all', only?: string, force = false): Promise<void> {
  const run = async () => look(which, only, force);
  busy = (busy ?? Promise.resolve()).then(run, run).finally(() => { busy = null; });
  return busy;
}

// ---------------------------------------------------------------- after each look: history, costs, warnings, surfaces

let items: PriorityItem[] = [];
let label: MenuBarLabel = renderLabel([], defaultTrackerSettings().menuBar, Date.now());
const notices: string[] = [];
const islandListeners = new Set<() => void>();

const ym = (t: number) => new Date(t).toISOString().slice(0, 7);

function notify(key: string | undefined, title: string, body: string, island = false) {
  const s = store!;
  if (key) {
    if (s.notified.includes(key)) return;
    s.notified = [...s.notified, key].slice(-500);
  }
  notices.push(title);
  if (notices.length > 20) notices.shift();
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
  if (island) deps?.alert(title, body);
}

function after() {
  const s = store!;
  const now = Date.now();
  // History for sparklines and the page's charts.
  for (const a of s.accounts) {
    const st = s.states[a.id];
    if (!st || st.state === 'error') continue;
    for (const l of st.limits) {
      if (l.usedPercent === undefined && l.used === undefined) continue;
      const k = `${a.id}:${l.key}`;
      s.history[k] = addPoint(s.history[k] ?? [], { t: now, p: l.usedPercent === undefined ? undefined : Math.round(l.usedPercent * 10) / 10, u: l.used }, now);
    }
    // Costs per month.
    const usd = st.monthUsd ?? (a.subscription && !(a.subscription.trialEnds && Date.parse(a.subscription.trialEnds) > now) && a.subscription.currency.toUpperCase() === 'USD' ? a.subscription.cost * MONTHLY_FACTOR[a.subscription.cycle] : undefined);
    if (usd !== undefined) s.costs[a.id] = { ...(s.costs[a.id] ?? {}), [ym(now)]: Math.round(usd * 100) / 100 };
  }
  for (const k of Object.keys(s.history)) if (!s.accounts.some((a) => k.startsWith(`${a.id}:`))) delete s.history[k];
  items = prioritize(s.accounts, s.states, s.history, s.settings.thresholds, now);
  // Warnings: crossing a threshold, and limits that came back.
  const t = transitions(s.prevUrgency, items, s.prevLeft);
  if (!s.settings.paused) {
    if (s.settings.notify.thresholds) for (const i of t.crossed) {
      const reset = i.limit.resetsAt ? ` Resets in ${countdown(i.limit.resetsAt - now)}.` : '';
      notify(`cross:${i.accountId}:${i.limit.key}:${i.urgency}:${i.limit.resetsAt ?? ym(now)}`, i.urgency === 'used-up' ? `${i.accountName} ${i.limit.label}: used up` : `${i.accountName} ${i.limit.label}: ${Math.round(i.left ?? 0)}% left`, `${i.why}.${reset}`, true);
    }
    if (s.settings.notify.resets) for (const i of t.reset) notify(undefined, `${i.accountName} ${i.limit.label} reset: ${Math.round(i.left ?? 100)}% available`, 'Your allowance is back.');
    if (s.settings.notify.expiring) for (const i of items.filter((x) => x.urgency === 'expiring')) {
      notify(`exp:${i.accountId}:${i.limit.key}:${i.limit.resetsAt}`, `${i.accountName} ${i.limit.label}: ${Math.round(i.left ?? 0)}% unused`, `It resets in ${countdown((i.limit.resetsAt ?? now) - now)}; use it before then.`);
    }
    if (s.settings.notify.renewals) for (const r of dueReminders(s.accounts, now)) notify(r.key, r.title, r.body);
  }
  s.prevUrgency = Object.fromEntries(items.map((i) => [`${i.accountId}:${i.limit.key}`, i.urgency]));
  s.prevLeft = Object.fromEntries(items.map((i) => [`${i.accountId}:${i.limit.key}`, i.left]));
  label = renderLabel(items, s.settings.menuBar, now);
  void persist();
  deps?.broadcast('ai-usage', { at: now });
  for (const l of islandListeners) l();
}

// ---------------------------------------------------------------- polling (only with accounts, through the governor)

let polling = false;
const stops = new Map<string, () => void>();
function syncPolling() {
  const s = store;
  const want = !!s && featureOn('usageTracker') && !s.settings.paused && s.accounts.some((a) => !a.paused);
  if (want && !polling) {
    polling = true;
    stops.set('local', poll('aiUsage.local', () => ({ baseMs: (store?.settings.localEveryMin ?? 2) * 60_000, idleFactor: 3, pauseWhenLocked: true }), () => (store?.accounts.some(isLocal) ? lookOnce('local') : undefined), { feature: 'usageTracker' }));
    stops.set('api', poll('aiUsage.api', () => ({ baseMs: (store?.settings.apiEveryMin ?? 10) * 60_000, idleFactor: 2, pauseWhenLocked: true, maxMs: 60 * 60_000 }), () => (store?.accounts.some((a) => !isLocal(a)) ? lookOnce('api') : undefined), { feature: 'usageTracker' }));
  } else if (!want && polling) {
    polling = false;
    for (const stop of stops.values()) stop();
    stops.clear();
  }
  syncWatchers();
}

/** The status-line file is one small file per account: watch its folder instead of polling it. */
const watchers = new Map<string, FSWatcher>();
let watchTimer: NodeJS.Timeout | undefined;
function syncWatchers() {
  const want = new Map<string, string>();
  if (polling && store) for (const a of store.accounts) if (a.provider === 'cc' && a.statusLine && !a.paused) want.set(a.id, dirOf(a));
  for (const [id, w] of watchers) if (!want.has(id)) { w.close(); watchers.delete(id); }
  for (const [id, dir] of want) {
    if (watchers.has(id) || !existsSync(dir)) continue;
    try {
      const w = watch(dir, { persistent: false }, (_e, name) => {
        if (name !== 'keeper-status.json') return;
        clearTimeout(watchTimer);
        watchTimer = setTimeout(() => void lookOnce('local', id), 3000);
      });
      w.on('error', () => { w.close(); watchers.delete(id); });
      watchers.set(id, w);
    } catch {
      /* the regular look still happens */
    }
  }
}

// ---------------------------------------------------------------- the AI usage card in the owl's glance

// Keeper has one icon in the menu bar, the owl. The tracker has no item of its own: its summary is
// a card in the owl's glance (core/glance.ts), read only while the glance is open.

/**
 * The glance's AI usage card: undefined while the tracker is off or has no accounts (the glance
 * then reads the coding tools itself), null while it tracks accounts but has nothing to show.
 */
export async function glanceCard(now = Date.now()): Promise<GlanceUsage | null | undefined> {
  if (!featureOn('usageTracker')) return undefined;
  const s = await load();
  if (!s.accounts.length) return undefined;
  return glanceUsage(items, s.settings.menuBar, now) ?? null;
}

// ---------------------------------------------------------------- the Island's ring

export interface UsageIslandAlert {
  id: string;
  title: string;
  detail: string;
  /** 0–100 left */
  left: number;
  urgency: 'running-out' | 'used-up';
}

/** The most urgent limit while something is running out (for the Island's ring), else nothing. */
export function usageIslandAlert(): UsageIslandAlert | undefined {
  if (!store || store.settings.paused || !featureOn('usageTracker')) return undefined;
  const i = items.find((x) => x.urgency === 'running-out' || x.urgency === 'used-up');
  if (!i) return undefined;
  const reset = i.limit.resetsAt ? `resets in ${countdown(i.limit.resetsAt - Date.now())}` : '';
  return { id: `${i.accountId}:${i.limit.key}`, title: `${i.accountName} ${i.limit.label}`, detail: i.urgency === 'used-up' ? `Used up · ${reset}` : `${Math.round(i.left ?? 0)}% left${reset ? ` · ${reset}` : ''}`, left: Math.round(i.left ?? 0), urgency: i.urgency as 'running-out' | 'used-up' };
}

/** The limit closest to running out across every tracked account, for the ring beside the Island. */
export function usagePinItem(): { tool: string; label: string; percent: number } | undefined {
  if (!store || store.settings.paused || !featureOn('usageTracker')) return undefined;
  const best = items.filter((i) => i.left !== undefined && i.urgency !== 'expiring').sort((a, b) => (a.left ?? 100) - (b.left ?? 100))[0];
  return best ? { tool: best.provider, label: `${best.accountName} · ${best.limit.label}`, percent: Math.round(100 - (best.left ?? 100)) } : undefined;
}

export function onUsageChange(fn: () => void): () => void {
  islandListeners.add(fn);
  return () => islandListeners.delete(fn);
}

// ---------------------------------------------------------------- the interface

async function view(a: Account): Promise<AccountView> {
  return { ...a, hasKey: await hasKey(a.id), statusLineOn: a.provider === 'cc' ? !!a.statusLine : undefined };
}
export async function accounts(): Promise<AccountView[]> {
  const s = await load();
  return Promise.all(s.accounts.map(view));
}

export async function overview(): Promise<UsageOverview> {
  const s = await load();
  const now = Date.now();
  const recent: Record<string, HistoryPoint[]> = {};
  for (const [k, pts] of Object.entries(s.history)) recent[k] = pts.filter((p) => p.t >= now - 7 * D);
  const subs = s.accounts.filter((a) => a.subscription && !a.paused).map((a) => a.subscription!);
  const everyMs = Math.min(...[s.accounts.some(isLocal) ? s.settings.localEveryMin : Infinity, s.accounts.some((a) => !isLocal(a)) ? s.settings.apiEveryMin : Infinity]) * 60_000;
  return {
    on: featureOn('usageTracker'),
    settings: s.settings,
    accounts: await Promise.all(s.accounts.map(view)),
    states: s.states,
    items,
    summary: summarize(items),
    label,
    nextUpdateAt: polling && Number.isFinite(everyMs) && lastLook ? lastLook + everyMs : undefined,
    recent,
    costs: s.costs,
    subscriptions: { monthly: monthlyTotals(subs, now), upcoming: dueReminders(s.accounts.map((a) => ({ ...a, subscription: a.subscription && { ...a.subscription, remindDays: 31 } })), now).sort((x, y) => x.at - y.at) },
    keysInMemory,
  };
}

export async function refresh(accountId?: string): Promise<UsageOverview> {
  await load();
  await lookOnce('all', accountId, true);
  return overview();
}

const clean = (v: string | undefined, n = 200) => (v ?? '').toString().slice(0, n).trim();

export async function saveAccount(input: AccountInput, key?: string): Promise<AccountView[]> {
  const s = await load();
  if (!PROVIDERS.some((p) => p.id === input.provider)) throw new Error('Unknown service');
  const prev = input.id ? s.accounts.find((a) => a.id === input.id) : undefined;
  // Only the account's own fields (not what the page shows about it).
  // The sign-in state is Keeper's own record, never taken from the page.
  const { hasKey: _k, statusLineOn: _s, signedIn: _si, ...fields } = input as AccountInput & Partial<AccountView>;
  const a: Account = {
    ...(prev ?? {}),
    ...fields,
    id: prev?.id ?? newId('u'),
    name: clean(input.name, 60) || providerInfo(input.provider).label,
    signedIn: prev?.signedIn,
    createdAt: prev?.createdAt ?? Date.now(),
  } as Account;
  if (prev && prev.provider !== a.provider) throw new Error('An account’s service cannot change');
  if (a.configDir) a.configDir = clean(a.configDir, 1000) || undefined;
  // A web account asks its site straight away when it was just opted in or pointed at another organization.
  if (isWebProvider(a.provider) && (a.online && !prev?.online || a.orgId !== prev?.orgId)) webFresh.add(a.id);
  s.accounts = prev ? s.accounts.map((x) => (x.id === a.id ? a : x)) : [...s.accounts, a];
  if (key !== undefined) await keepKey(a.id, key.trim());
  failures.delete(a.id);
  await persist(true);
  syncPolling();
  void lookOnce('all', a.id, true);
  return accounts();
}

export async function removeAccount(id: string): Promise<AccountView[]> {
  const s = await load();
  const a = s.accounts.find((x) => x.id === id);
  if (a?.statusLine) await setStatusLine(id, false).catch(() => undefined);
  // A web sign-in: its partition's cookies and storage go with it.
  if (a && isWebProvider(a.provider)) await import('./usage-web').then((w) => w.forgetSignIn(id)).catch(() => undefined);
  webAsked.delete(id);
  webFresh.delete(id);
  claudeOrgCache.delete(id);
  s.accounts = s.accounts.filter((x) => x.id !== id);
  delete s.states[id];
  delete s.costs[id];
  delete s.weeklyReset[id];
  await keepKey(id, '');
  await persist(true);
  syncPolling();
  after();
  return accounts();
}

/**
 * Signs a web account in (claude.ai, chatgpt.com) in a window of its own, in the account's own
 * partition. A new account (no id yet) is added first, and taken away again when the window is
 * closed before signing in. The name defaults to the signed-in email.
 */
export async function signIn(input: AccountInput | { id: string }): Promise<{ ok: boolean; message: string; accountId?: string; accounts: AccountView[] }> {
  const s = await load();
  let a: Account | undefined = 'provider' in input && !input.id ? undefined : s.accounts.find((x) => x.id === input.id);
  let added = false;
  if (!a) {
    if (!('provider' in input) || !isWebProvider(input.provider)) return { ok: false, message: 'Not a web account', accounts: await accounts() };
    const list = await saveAccount({ ...input, name: (input.name ?? '').trim() });
    a = s.accounts.find((x) => x.id === list[list.length - 1].id)!;
    added = true;
  }
  if (!isWebProvider(a.provider)) return { ok: false, message: 'Not a web account', accounts: await accounts() };
  const acct = a as Account & { provider: WebProviderId };
  const site = WEB_PROVIDERS[acct.provider].site;
  const web = await import('./usage-web');
  let email: string | undefined;
  const r = await web.signInWindow(acct.id, acct.provider, async () => {
    const who = await webIdentity(acct);
    email = who?.email;
    return !!who;
  }, { parent: BrowserWindow.getFocusedWindow(), title: `Sign in to ${site} · ${acct.name}` });
  if (!r.ok) {
    if (added && !acct.signedIn) await removeAccount(acct.id);
    return { ok: false, message: r.message ?? 'Not signed in.', accounts: await accounts() };
  }
  acct.signedIn = { at: Date.now(), email };
  acct.name = defaultWebName(acct.name, providerInfo(acct.provider).label, email);
  failures.delete(acct.id);
  webFresh.add(acct.id);
  await persist(true);
  syncPolling();
  void lookOnce('all', acct.id, true);
  return { ok: true, message: `Signed in to ${site}${email ? ` as ${email}` : ''}.`, accountId: acct.id, accounts: await accounts() };
}

export async function reorder(ids: string[]): Promise<AccountView[]> {
  const s = await load();
  const rank = (id: string) => { const i = ids.indexOf(id); return i < 0 ? ids.length : i; };
  s.accounts = [...s.accounts].sort((a, b) => rank(a.id) - rank(b.id));
  after();
  return accounts();
}

export async function setSettings(patch: Partial<TrackerSettings>): Promise<TrackerSettings> {
  const s = await load();
  s.settings = normalizeTrackerSettings({ ...s.settings, ...patch, thresholds: { ...s.settings.thresholds, ...(patch.thresholds ?? {}) }, menuBar: { ...s.settings.menuBar, ...(patch.menuBar ?? {}) }, notify: { ...s.settings.notify, ...(patch.notify ?? {}) } });
  await persist(true);
  syncPolling();
  after();
  return s.settings;
}

export async function history(days = 90): Promise<Record<string, HistoryPoint[]>> {
  const s = await load();
  const since = Date.now() - days * D;
  return Object.fromEntries(Object.entries(s.history).map(([k, v]) => [k, v.filter((p) => p.t >= since)]));
}

export async function exportCsv(): Promise<{ path?: string; rows: number }> {
  const s = await load();
  const csv = historyCsv(s.accounts, s.history, s.costs);
  const target = process.env.KEEPER_USAGE_CSV && !OFFICIAL
    ? process.env.KEEPER_USAGE_CSV
    : (await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('downloads'), `ai-usage-${new Date().toISOString().slice(0, 10)}.csv`), filters: [{ name: 'CSV', extensions: ['csv'] }] })).filePath;
  if (!target) return { rows: 0 };
  await fsp.writeFile(target, csv);
  return { path: target, rows: csv.split('\n').length - 3 };
}

/** Config folders of the coding tools on this computer: the usual ones, the environment's, and Keeper's agent profiles'. */
export async function detect(): Promise<DetectedAccount[]> {
  const s = await load();
  const out: DetectedAccount[] = [];
  const add = (provider: ProviderId, dir: string, name: string) => {
    if (!dir || !existsSync(dir) || out.some((o) => o.provider === provider && path.resolve(o.configDir) === path.resolve(dir))) return;
    const added = s.accounts.some((a) => a.provider === provider && path.resolve(dirOf(a)) === path.resolve(dir));
    out.push({ provider, name, configDir: dir, added });
  };
  for (const p of PROVIDERS.filter((x) => x.kind === 'local' && x.defaultDir)) {
    add(p.id, path.join(home(), p.defaultDir!), p.label);
    if (p.dirEnv && process.env[p.dirEnv]) add(p.id, process.env[p.dirEnv]!, `${p.label} (${path.basename(process.env[p.dirEnv]!)})`);
  }
  const cursorDir = dirOf({ id: '', provider: 'cursor', name: '', createdAt: 0 });
  if (existsSync(path.join(cursorDir, 'state.vscdb'))) add('cursor', cursorDir, 'Cursor');
  // Separate accounts made in Keeper's agent profiles (each has its own config folder).
  try {
    const { agentClis } = await import('./agents');
    for (const prof of (await agentClis()).profiles) {
      const provider: ProviderId | undefined = prof.agent.startsWith(providerInfo('cc').defaultDir!.slice(1)) ? 'cc' : prof.agent === 'codex' ? 'codex' : undefined;
      if (provider && prof.configDir) add(provider, prof.configDir, `${providerInfo(provider).label} · ${prof.label}`);
    }
  } catch {
    /* no profiles */
  }
  return out;
}

// ---------------------------------------------------------------- reading the coding CLI's status line

const BRIDGE = `#!/bin/sh
# Keeper: keeps the latest status-line data (rate limits) in this account's
# config folder, then runs the status line you had before, if any.
out="$1"
prev="$2"
input=$(cat)
printf '%s' "$input" > "$out.tmp" && mv "$out.tmp" "$out"
if [ -n "$prev" ]; then printf '%s' "$input" | sh -c "$prev"; fi
`;
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export async function setStatusLine(accountId: string, on: boolean): Promise<{ ok: boolean; message: string }> {
  const s = await load();
  const a = s.accounts.find((x) => x.id === accountId);
  if (!a || a.provider !== 'cc') return { ok: false, message: 'Not an account of that tool' };
  if (process.platform === 'win32') return { ok: false, message: 'Reading the status line works on macOS and Linux for now.' };
  const dir = dirOf(a);
  const settingsFile = path.join(dir, 'settings.json');
  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse(await fsp.readFile(settingsFile, 'utf8')); } catch { /* new file */ }
  if (on) {
    const script = path.join(app.getPath('userData'), 'usage-statusline.sh');
    await fsp.writeFile(script, BRIDGE, { mode: 0o755 });
    const prev = cfg.statusLine as { command?: string } | undefined;
    const ours = typeof prev?.command === 'string' && prev.command.includes('usage-statusline.sh');
    if (!ours) s.statusLinePrev[a.id] = { had: 'statusLine' in cfg, value: cfg.statusLine };
    const before = s.statusLinePrev[a.id]?.value as { command?: string } | undefined;
    cfg.statusLine = { type: 'command', command: `${q(script)} ${q(path.join(dir, 'keeper-status.json'))} ${q(before?.command ?? '')}`, padding: 0 };
  } else {
    const prev = s.statusLinePrev[a.id];
    if (prev?.had) cfg.statusLine = prev.value;
    else delete cfg.statusLine;
    delete s.statusLinePrev[a.id];
    await fsp.rm(path.join(dir, 'keeper-status.json'), { force: true });
  }
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(settingsFile, JSON.stringify(cfg, null, 2));
  a.statusLine = on;
  await persist(true);
  syncPolling();
  return { ok: true, message: on ? 'Keeper now reads the limits from its status line; your own status line still shows.' : 'Its status line is back as it was.' };
}

// ---------------------------------------------------------------- receipts in Mail (structured fields only)

export async function scanReceipts(): Promise<ReceiptGuess[]> {
  if (!featureOn('mail')) return [];
  const { pim } = await import('./pim');
  if (!(await pim.accounts().catch(() => [])).length) return [];
  const out: ReceiptGuess[] = [];
  for (const query of ['receipt', 'invoice']) {
    const r = await pim.messages({ folder: 'unified', query }).catch(() => null);
    for (const m of r?.messages ?? []) {
      const g = receiptFrom({ id: m.id, from: m.from ? `${m.from.name ?? ''} ${m.from.address ?? ''}` : '', subject: m.subject, snippet: m.snippet, date: m.date });
      if (g && !out.some((x) => x.messageId === g.messageId)) out.push(g);
    }
  }
  return out.sort((a, b) => b.date - a.date).slice(0, 50);
}

// ---------------------------------------------------------------- tests and Settings

/** What the glance's AI usage card and the short label show right now (tests, Settings preview). */
export async function glanceState(): Promise<{ card?: GlanceUsage; text: string; tooltip: string; notices: string[] }> {
  const card = (await glanceCard()) ?? undefined;
  return { card, text: label.text, tooltip: label.tooltip, notices: [...notices] };
}

/** A plain-text summary for the CLI and AI agents. */
export async function statusText(): Promise<{ text: string; data: unknown }> {
  const o = await overview();
  const now = Date.now();
  const lines: string[] = [];
  for (const a of o.accounts) {
    const st = o.states[a.id];
    lines.push(`${a.name} (${providerInfo(a.provider).label}${st?.plan ? ` ${st.plan}` : ''}${st ? `, ${st.accuracy}` : ''})${st?.message ? ` — ${st.message}` : ''}`);
    for (const l of st?.limits ?? []) {
      const it = o.items.find((i) => i.accountId === a.id && i.limit.key === l.key);
      lines.push(`  ${l.label}: ${l.usedPercent !== undefined ? `${Math.round(100 - l.usedPercent)}% left` : ''}${l.used !== undefined ? ` ${l.unit === 'usd' ? `$${l.used.toFixed(2)}` : Math.round(l.used)}${l.limit !== undefined ? ` of ${l.unit === 'usd' ? `$${l.limit}` : l.limit}` : ''}${l.unit && l.unit !== 'usd' ? ` ${l.unit}` : ''}` : ''}${l.resetsAt ? `, resets in ${countdown(l.resetsAt - now)}` : ''}${it && it.urgency !== 'ok' ? ` [${it.urgency}]` : ''}${l.estimated ? ' (estimated)' : ''}`);
    }
  }
  if (!o.accounts.length) lines.push('No accounts are tracked. Add one in Keeper → Usage.');
  const data = {
    allClear: o.summary.allClear,
    runningOut: o.summary.runningOut.map(brief),
    usedUp: o.summary.usedUp.map(brief),
    expiring: o.summary.expiring.map(brief),
    accounts: o.accounts.map((a) => ({ id: a.id, name: a.name, service: a.provider, plan: o.states[a.id]?.plan, needsSignIn: o.states[a.id]?.needsSignIn || undefined, accuracy: o.states[a.id]?.accuracy, state: o.states[a.id]?.state, message: o.states[a.id]?.message, limits: (o.states[a.id]?.limits ?? []).map((l) => ({ key: l.key, label: l.label, usedPercent: l.usedPercent, used: l.used, limit: l.limit, unit: l.unit, resetsAt: l.resetsAt ? new Date(l.resetsAt).toISOString() : undefined, estimated: !!l.estimated })) })),
    subscriptionsMonthly: o.subscriptions.monthly,
    label: o.label.text,
  };
  return { text: lines.join('\n'), data };
}
const brief = (i: PriorityItem) => ({ account: i.accountName, limit: i.limit.label, percentLeft: i.left === undefined ? undefined : Math.round(i.left), resetsAt: i.limit.resetsAt ? new Date(i.limit.resetsAt).toISOString() : undefined, why: i.why });

// ---------------------------------------------------------------- start

export async function initUsageTracker(d: UsageTrackerDeps) {
  deps = d;
  const start = async () => {
    const s = await load();
    if (featureOn('usageTracker') && s.accounts.length) {
      items = prioritize(s.accounts, s.states, s.history, s.settings.thresholds, Date.now());
      label = renderLabel(items, s.settings.menuBar, Date.now());
    }
    syncPolling();
    // Sign-ins of web accounts removed while Keeper was not there to wipe them.
    if (featureOn('usageTracker')) void import('./usage-web').then((w) => w.forgetOrphans(s.accounts.filter((a) => isWebProvider(a.provider)).map((a) => a.id))).catch(() => undefined);
  };
  onFeature('usageTracker', (on) => {
    if (!on) {
      syncPolling();
      for (const l of islandListeners) l();
    } else void start();
  }, { now: true });
}

export function stopUsageTracker() {
  for (const w of watchers.values()) w.close();
  watchers.clear();
}

