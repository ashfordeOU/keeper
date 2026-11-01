// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's tools in the main process: notes and scripts on disk (to-dos
// moved to the shared task list, electron/services/pim),
// Ask with any connected AI, AI usage from the tools' own files, sales and
// stocks from the person's own accounts, shortcuts, and shelf copies.
// Nothing here runs on a timer unless the person turned on new-sale pings.

import { app, dialog, Notification } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { promises as fsp, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IslandShortcut, SalesConfigView } from '../../core/api-island-tools';
import { normalizeStore, type IslandToolsStore } from '../../core/island-tools/notes';
import { newSales, parseRates, parseSales, salesRequest, SALES_PROVIDERS, summarize, type Sale, type SalesProvider } from '../../core/island-tools/sales';
import { coingeckoChartUrl, coingeckoPriceUrl, coinId, parseCoingeckoChart, parseCoingeckoPrices, parseStooq, parseTwelveQuotes, parseTwelveSeries, stooqQuoteUrl, twelveQuoteUrl, twelveSeriesUrl, type Point, type Quote } from '../../core/island-tools/stocks';
import { scriptFromText } from '../../core/island-tools/teleprompter';
import type { Rates } from '../../core/island-tools/units';
import { claudeLocal, claudeOAuthUsage, claudeTokenLines, codexRateLimits, copilotQuota, copilotToken, cursorUsage, USAGE_TOOLS, type TokenLine, type UsageReport, type UsageTool } from '../../core/island-tools/usage';
import { officeText } from '../../core/brain/extract';
import { getSecret, setSecret, settings } from '../store';

interface Prefs {
  usageOnline: Partial<Record<UsageTool, boolean>>;
  sales: { providers: { id: SalesProvider; shop?: string }[]; currency: string; convert: boolean; ping: boolean };
}

interface FileShape extends IslandToolsStore { prefs?: Prefs }

const file = () => path.join(app.getPath('userData'), 'island-tools.json');
let store: IslandToolsStore | null = null;
let prefs: Prefs = { usageOnline: {}, sales: { providers: [], currency: 'USD', convert: false, ping: false } };
/** Keys kept only until Keeper quits when the system has no keychain. */
const memKeys = new Map<string, string>();
let saveTimer: NodeJS.Timeout | undefined;

async function load(): Promise<IslandToolsStore> {
  if (store) return store;
  try {
    const raw = JSON.parse(await fsp.readFile(file(), 'utf8')) as FileShape;
    store = normalizeStore(raw);
    if (raw.prefs) prefs = { usageOnline: raw.prefs.usageOnline ?? {}, sales: { ...prefs.sales, ...raw.prefs.sales } };
  } catch {
    store = normalizeStore(null);
  }
  return store;
}

function persist(now = false) {
  clearTimeout(saveTimer);
  const write = async () => {
    if (!store) return;
    const tmp = `${file()}.${process.pid}.tmp`;
    await fsp.mkdir(path.dirname(file()), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify({ ...store, prefs }, null, 1));
    await fsp.rename(tmp, file());
  };
  if (now) return write();
  // Notes save as you type; writing at most twice a second keeps the disk quiet.
  saveTimer = setTimeout(() => void write().catch(() => undefined), 500);
  saveTimer.unref?.();
  return Promise.resolve();
}

export async function getStore(): Promise<IslandToolsStore> {
  return load();
}

export async function saveStore(patch: Partial<IslandToolsStore>): Promise<IslandToolsStore> {
  const s = await load();
  store = normalizeStore({ ...s, ...patch });
  void persist();
  return store;
}

/**
 * Hands the Island's old to-do list to the task list (once) and empties it
 * here: the Island's To-Dos and the Reminders page are one list now.
 */
export async function takeTodos(): Promise<IslandToolsStore['todos']> {
  const s = await load();
  const todos = s.todos;
  if (todos.length) {
    store = { ...s, todos: [] };
    await persist(true);
  }
  return todos;
}

export function flushIslandTools(): Promise<void> {
  return persist(true) ?? Promise.resolve();
}

// ---------------------------------------------------------------- secrets

async function secret(name: string): Promise<string | undefined> {
  return memKeys.get(name) ?? (await getSecret(name).catch(() => undefined));
}
async function keepSecret(name: string, value: string) {
  const ok = await setSecret(name, value).catch(() => false);
  if (ok) memKeys.delete(name);
  else if (value) memKeys.set(name, value);
  else memKeys.delete(name);
}

// ---------------------------------------------------------------- web

async function get(url: string, headers: Record<string, string> = {}, timeout = 15_000): Promise<{ ok: boolean; status: number; body: unknown; text: string; link?: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'user-agent': `Keeper/${app.getVersion()}`, ...headers }, signal: ctl.signal });
    const text = await res.text();
    let body: unknown = undefined;
    try { body = JSON.parse(text); } catch { /* CSV or HTML */ }
    return { ok: res.ok, status: res.status, body, text, link: res.headers.get('link') ?? undefined };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------- Ask

type BrainModule = typeof import('./brain');

/** The computer's own model, offered even when no connection was made for it. */
const OS_MODEL = '@os';

export async function askConnections(): Promise<{ id: string; label: string; local: boolean; ready: boolean; os?: boolean }[]> {
  const brain: BrainModule = await import('./brain');
  const c = await brain.connections().catch(() => null);
  if (!c) return [];
  const list: { id: string; label: string; local: boolean; ready: boolean; os?: boolean }[] = c.connections.map((x) => ({ id: x.id, label: x.label, local: x.local, ready: !x.needsKey || x.hasKey, os: x.kind === 'platform' }));
  const osKind = c.kinds.find((k) => k.kind === 'platform' && k.available);
  if (osKind && !list.some((x) => x.os)) list.unshift({ id: OS_MODEL, label: osKind.label, local: true, ready: true, os: true });
  return list;
}

/** One answer from the chosen (or the active) AI about some text. */
export async function ask(prompt: string, input?: string, connection?: string): Promise<{ text: string; provider: string; local: boolean }> {
  const brain: BrainModule = await import('./brain');
  const b = brain.brainSettings();
  const id = connection || b.active;
  const provider = id === OS_MODEL
    ? (await import('../../core/brain/providers')).createProvider({ kind: 'platform', model: 'on-device' })
    : await brain.providerForConnection(id);
  if (b.localOnly && !provider.local) throw new Error('Keeper is set to use only AIs on this computer. Choose a local one, or change this in Settings → AI & Brain.');
  const system = 'You are the quick helper in Keeper\'s Island. Answer briefly and directly. When given text to work on, return only the result (no preamble).';
  const user = input ? `${prompt.trim()}\n\n---\n${input.slice(0, 40_000)}` : prompt.trim();
  const r = await provider.chat([{ role: 'system', content: system }, { role: 'user', content: user }], [], { maxTokens: 1500 });
  return { text: r.text.trim(), provider: provider.label, local: provider.local };
}

// ---------------------------------------------------------------- AI usage

const home = () => os.homedir();

async function newestFiles(dir: string, match: (name: string) => boolean, max: number, depth = 4): Promise<string[]> {
  const out: { p: string; m: number }[] = [];
  const walk = async (d: string, left: number) => {
    let entries: import('node:fs').Dirent[];
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && left > 0) await walk(p, left - 1);
      else if (e.isFile() && match(e.name)) {
        const st = await fsp.stat(p).catch(() => null);
        if (st && st.mtimeMs > Date.now() - 8 * 86_400_000) out.push({ p, m: st.mtimeMs });
      }
    }
  };
  await walk(dir, depth);
  return out.sort((a, b) => b.m - a.m).slice(0, max).map((x) => x.p);
}

const usageCache = new Map<UsageTool, { at: number; r: UsageReport }>();

async function claudeReport(): Promise<UsageReport> {
  const dir = process.env.KEEPER_CLAUDE_DIR ?? path.join(home(), '.claude');
  const base: UsageReport = { tool: 'claude', label: 'Claude Code', state: 'none', windows: [], source: '', updatedAt: Date.now() };
  if (!existsSync(dir)) return { ...base, message: 'Claude Code is not set up on this computer.' };
  const files = await newestFiles(path.join(dir, 'projects'), (n) => n.endsWith('.jsonl'), 60);
  const lines: TokenLine[] = [];
  for (const f of files) lines.push(...claudeTokenLines(await fsp.readFile(f, 'utf8').catch(() => '')));
  const r: UsageReport = { ...base, state: 'partial', windows: claudeLocal(lines), source: `Counted from ${files.length} session file${files.length === 1 ? '' : 's'} in ~/.claude` };
  if (!prefs.usageOnline.claude) return { ...r, message: 'Exact limits: allow Keeper to ask Anthropic with Claude Code\'s sign-in.' };
  try {
    let token: string | undefined;
    const credFile = path.join(dir, '.credentials.json');
    if (existsSync(credFile)) token = (JSON.parse(await fsp.readFile(credFile, 'utf8')) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth?.accessToken;
    if (!token && process.platform === 'darwin') token = await macKeychain('Claude Code-credentials').then((j) => j && (JSON.parse(j) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth?.accessToken).catch(() => undefined);
    if (!token) return { ...r, message: 'Could not find Claude Code\'s sign-in; showing local counts.' };
    const res = await get(process.env.KEEPER_CLAUDE_USAGE_URL ?? 'https://api.anthropic.com/api/oauth/usage', { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' });
    const w = res.ok ? claudeOAuthUsage(res.body) : [];
    if (!w.length) return { ...r, message: `Anthropic did not return limits (${res.status}); showing local counts.` };
    return { ...r, state: 'ok', windows: [...w, ...r.windows.filter((x) => x.label === 'Last 7 days')], source: 'Limits from Anthropic with Claude Code\'s sign-in; tokens counted in ~/.claude' };
  } catch (e) {
    return { ...r, message: e instanceof Error ? e.message : String(e) };
  }
}

function macKeychain(service: string): Promise<string | undefined> {
  return new Promise((resolve) => execFile('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], { timeout: 5000 }, (err, out) => resolve(err ? undefined : out.trim())));
}

async function codexReport(): Promise<UsageReport> {
  const dir = process.env.KEEPER_CODEX_DIR ?? path.join(process.env.CODEX_HOME ?? path.join(home(), '.codex'));
  const base: UsageReport = { tool: 'codex', label: 'Codex', state: 'none', windows: [], source: '', updatedAt: Date.now() };
  if (!existsSync(dir)) return { ...base, message: 'Codex is not set up on this computer.' };
  const files = await newestFiles(path.join(dir, 'sessions'), (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'), 5, 4);
  for (const f of files) {
    const w = codexRateLimits(await fsp.readFile(f, 'utf8').catch(() => ''));
    if (w) return { ...base, state: 'ok', windows: w, source: 'The limits Codex wrote in its latest session file' };
  }
  return { ...base, state: 'partial', message: 'Codex has not reported its limits recently; use it once and look again.' };
}

async function copilotReport(): Promise<UsageReport> {
  const base: UsageReport = { tool: 'copilot', label: 'GitHub Copilot', state: 'none', windows: [], source: '', updatedAt: Date.now() };
  const dirs = [process.env.KEEPER_COPILOT_DIR, path.join(process.env.XDG_CONFIG_HOME ?? path.join(home(), '.config'), 'github-copilot'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'github-copilot')].filter((x): x is string => !!x);
  let token: string | undefined;
  for (const d of dirs) for (const f of ['apps.json', 'hosts.json']) {
    if (token) break;
    token = copilotToken(await fsp.readFile(path.join(d, f), 'utf8').catch(() => ''));
  }
  if (!token) return { ...base, message: 'Copilot is not signed in on this computer.' };
  if (!prefs.usageOnline.copilot) return { ...base, state: 'partial', message: 'Allow Keeper to ask GitHub with Copilot\'s sign-in to see premium requests left.' };
  const res = await get(process.env.KEEPER_COPILOT_URL ?? 'https://api.github.com/copilot_internal/user', { authorization: `token ${token}`, accept: 'application/json' }).catch(() => null);
  const w = res?.ok ? copilotQuota(res.body) : [];
  return w.length ? { ...base, state: 'ok', windows: w, source: 'From GitHub with Copilot\'s sign-in' } : { ...base, state: 'error', message: `GitHub did not return a quota${res ? ` (${res.status})` : ''}.` };
}

function sqlite(db: string, sql: string): Promise<string | undefined> {
  return new Promise((resolve) => execFile('sqlite3', [db, sql], { timeout: 5000 }, (err, out) => resolve(err ? undefined : out.trim())));
}

async function cursorReport(): Promise<UsageReport> {
  const base: UsageReport = { tool: 'cursor', label: 'Cursor', state: 'none', windows: [], source: '', updatedAt: Date.now() };
  const db = process.env.KEEPER_CURSOR_DB ?? (process.platform === 'darwin'
    ? path.join(home(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
    : process.platform === 'win32' ? path.join(process.env.APPDATA ?? '', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
      : path.join(home(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'));
  if (!existsSync(db)) return { ...base, message: 'Cursor is not set up on this computer.' };
  if (!prefs.usageOnline.cursor) return { ...base, state: 'partial', message: 'Allow Keeper to ask Cursor with its own sign-in to see requests used this month.' };
  const token = await sqlite(db, "select value from ItemTable where key='cursorAuth/accessToken'");
  if (!token) return { ...base, state: 'error', message: 'Could not read Cursor\'s sign-in (the sqlite3 command is needed).' };
  let user = '';
  try { user = (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { sub?: string }).sub?.split('|').pop() ?? ''; } catch { /* not a JWT */ }
  const res = await get(`${process.env.KEEPER_CURSOR_URL ?? 'https://cursor.com/api/usage'}?user=${encodeURIComponent(user)}`, { cookie: `WorkosCursorSessionToken=${encodeURIComponent(`${user}::${token}`)}` }).catch(() => null);
  const w = res?.ok ? cursorUsage(res.body) : [];
  return w.length ? { ...base, state: 'ok', windows: w, source: 'From Cursor with its own sign-in' } : { ...base, state: 'error', message: `Cursor did not return usage${res ? ` (${res.status})` : ''}.` };
}

export async function usage(): Promise<UsageReport[]> {
  await load();
  const fresh = (tool: UsageTool, fn: () => Promise<UsageReport>) => {
    const c = usageCache.get(tool);
    if (c && Date.now() - c.at < 60_000) return Promise.resolve(c.r);
    return fn().then((r) => (usageCache.set(tool, { at: Date.now(), r }), r), (e) => ({ tool, label: tool, state: 'error' as const, windows: [], source: '', message: String(e), updatedAt: Date.now() }));
  };
  const info = (tool: UsageTool): UsageReport => ({ tool, label: USAGE_TOOLS.find((t) => t.id === tool)!.label, state: 'none', windows: [], source: '', message: USAGE_TOOLS.find((t) => t.id === tool)!.how, updatedAt: Date.now() });
  const base = await Promise.all([fresh('claude', claudeReport), fresh('codex', codexReport), fresh('copilot', copilotReport), fresh('cursor', cursorReport), Promise.resolve(info('gemini')), Promise.resolve(info('grok'))]);
  // Local model servers (Ollama, LM Studio) and services with no local record (monitor workstream).
  return [...base, ...(await (await import('./monitor-usage')).localModelReports().catch(() => []))];
}

export async function setUsageOnline(tool: UsageTool, on: boolean) {
  await load();
  prefs.usageOnline = { ...prefs.usageOnline, [tool]: on };
  usageCache.delete(tool);
  void persist();
}

export async function usageOnline() {
  await load();
  return prefs.usageOnline;
}

// ---------------------------------------------------------------- sales

let lastSales: Sale[] = [];
type SalesResult = ReturnType<typeof summarize> & { errors: { provider: SalesProvider; message: string }[]; fetchedAt: number };
let salesCache: { at: number; v: SalesResult } | undefined;

export async function salesConfig(): Promise<SalesConfigView> {
  await load();
  const providers = await Promise.all(SALES_PROVIDERS.map(async (p) => {
    const conf = prefs.sales.providers.find((x) => x.id === p.id);
    return { ...p, connected: !!conf && !!(await secret(`sales.${p.id}`)), shop: conf?.shop };
  }));
  return { providers, currency: prefs.sales.currency, convert: prefs.sales.convert, ping: prefs.sales.ping };
}

export async function setSalesProvider(id: SalesProvider, key: string, shop?: string): Promise<SalesConfigView> {
  await load();
  await keepSecret(`sales.${id}`, key.trim());
  prefs.sales.providers = [...prefs.sales.providers.filter((x) => x.id !== id), { id, shop: shop?.trim() || undefined }];
  salesCache = undefined;
  void persist();
  return salesConfig();
}

export async function removeSalesProvider(id: SalesProvider): Promise<SalesConfigView> {
  await load();
  await keepSecret(`sales.${id}`, '');
  prefs.sales.providers = prefs.sales.providers.filter((x) => x.id !== id);
  salesCache = undefined;
  void persist();
  return salesConfig();
}

export async function setSalesPrefs(p: { currency?: string; convert?: boolean; ping?: boolean }): Promise<SalesConfigView> {
  await load();
  prefs.sales = { ...prefs.sales, ...p, currency: (p.currency ?? prefs.sales.currency).toUpperCase() };
  salesCache = undefined;
  void persist();
  return salesConfig();
}

const ratesCache = new Map<string, { at: number; r: Rates }>();
/** ECB reference rates (via frankfurter.app), only when the person turned on conversion. */
export async function rates(base: string): Promise<Rates | null> {
  const b = base.toUpperCase();
  const c = ratesCache.get(b);
  if (c && Date.now() - c.at < 6 * 3600_000) return c.r;
  const res = await get(`${process.env.KEEPER_FX_URL ?? 'https://api.frankfurter.app'}/latest?from=${encodeURIComponent(b)}`).catch(() => null);
  const r = res?.ok ? parseRates(res.body) : undefined;
  if (!r) return null;
  ratesCache.set(b, { at: Date.now(), r });
  return r;
}

export async function sales(force = false): Promise<SalesResult> {
  await load();
  if (!force && salesCache && Date.now() - salesCache.at < 5 * 60_000) return salesCache.v;
  const since = Date.now() - 30 * 86_400_000;
  const all: Sale[] = [];
  const errors: { provider: SalesProvider; message: string }[] = [];
  await Promise.all(prefs.sales.providers.map(async (p) => {
    const key = await secret(`sales.${p.id}`);
    if (!key) return;
    let cursor: string | undefined;
    try {
      for (let page = 0; page < 20; page++) {
        const req = salesRequest(p.id, key, since, { shop: p.shop, cursor, base: process.env.KEEPER_SALES_BASE });
        const res = await get(req.url, req.headers);
        if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'The key was refused; check it has read access.' : `The service answered ${res.status}.`);
        const parsed = parseSales(p.id, res.body, since, res.link);
        all.push(...parsed.sales);
        if (!parsed.next) break;
        cursor = parsed.next;
      }
    } catch (e) {
      errors.push({ provider: p.id, message: e instanceof Error ? e.message : String(e) });
    }
  }));
  const fx = prefs.sales.convert ? await rates(prefs.sales.currency) : null;
  const added = lastSales.length ? newSales(lastSales, all) : [];
  lastSales = all;
  if (prefs.sales.ping && added.length && Notification.isSupported()) {
    const total = added.reduce((n, s) => n + s.amount, 0);
    new Notification({ title: added.length === 1 ? 'New sale' : `${added.length} new sales`, body: `${total.toFixed(2)} ${added[0].currency} · ${SALES_PROVIDERS.find((x) => x.id === added[0].provider)?.label ?? ''}`, silent: false }).show();
  }
  const v: SalesResult = { ...summarize(all, prefs.sales.currency, Date.now(), fx ?? undefined), errors, fetchedAt: Date.now() };
  salesCache = { at: Date.now(), v };
  return v;
}

/** For the governor: true while new-sale pings are wanted. */
export function salesPingOn(): boolean {
  return !!prefs.sales.ping && prefs.sales.providers.length > 0;
}

// ---------------------------------------------------------------- stocks

export async function stocksKey(): Promise<boolean> {
  return !!(await secret('stocks.twelvedata'));
}
export async function setStocksKey(key: string): Promise<boolean> {
  await keepSecret('stocks.twelvedata', key.trim());
  return stocksKey();
}

export async function quotes(symbols: string[]): Promise<{ quotes: Quote[]; errors: string[] }> {
  const out: Quote[] = [];
  const errors: string[] = [];
  const crypto = symbols.filter((s) => coinId(s));
  const shares = symbols.filter((s) => !coinId(s));
  const base = process.env.KEEPER_STOCKS_BASE;
  if (crypto.length) {
    const res = await get(base ? `${base}/coingecko?ids=${crypto.map(coinId).join(',')}` : coingeckoPriceUrl(crypto.map((s) => coinId(s)!))).catch((e) => ({ ok: false, status: 0, body: null, text: String(e) }));
    if (res.ok) out.push(...parseCoingeckoPrices(res.body, crypto));
    else errors.push('Crypto prices are unavailable right now.');
  }
  if (shares.length) {
    const key = await secret('stocks.twelvedata');
    if (key) {
      const res = await get(base ? `${base}/twelve?symbols=${shares.join(',')}` : twelveQuoteUrl(shares, key)).catch(() => null);
      if (res?.ok) out.push(...parseTwelveQuotes(res.body, shares));
      else errors.push('Twelve Data did not answer; check the key.');
    } else {
      const res = await get(base ? `${base}/stooq?s=${shares.join('+')}` : stooqQuoteUrl(shares)).catch(() => null);
      if (res?.ok) out.push(...parseStooq(res.text, shares));
      else errors.push('Share prices are unavailable right now.');
    }
  }
  return { quotes: symbols.map((s) => out.find((q) => q.symbol === s.toUpperCase())).filter((q): q is Quote => !!q), errors };
}

export async function chart(symbol: string): Promise<Point[]> {
  const id = coinId(symbol);
  if (id) {
    const res = await get(coingeckoChartUrl(id)).catch(() => null);
    return res?.ok ? parseCoingeckoChart(res.body) : [];
  }
  const key = await secret('stocks.twelvedata');
  if (!key) return [];
  const res = await get(twelveSeriesUrl(symbol, key)).catch(() => null);
  return res?.ok ? parseTwelveSeries(res.body) : [];
}

// ---------------------------------------------------------------- shortcuts

export interface ShortcutDeps {
  rules: () => { id: string; name: string; enabled: boolean }[];
  runRule: (id: string) => Promise<unknown>;
}
let deps: ShortcutDeps | null = null;
export function setShortcutDeps(d: ShortcutDeps) { deps = d; }

function macShortcuts(): Promise<string[]> {
  if (process.platform !== 'darwin') return Promise.resolve([]);
  return new Promise((resolve) => execFile('/usr/bin/shortcuts', ['list'], { timeout: 8000 }, (err, out) => resolve(err ? [] : out.split('\n').map((s) => s.trim()).filter(Boolean))));
}

export async function shortcuts(): Promise<IslandShortcut[]> {
  const out: IslandShortcut[] = (await macShortcuts()).map((n) => ({ kind: 'shortcut', id: n, name: n, detail: 'Shortcut' }));
  for (const r of deps?.rules() ?? []) out.push({ kind: 'rule', id: r.id, name: r.name, detail: r.enabled ? 'Automation' : 'Automation (paused)' });
  for (const a of settings().island.scriptActions ?? []) out.push({ kind: 'script', id: a.id, name: a.name, detail: a.command });
  return out;
}

export async function runShortcut(kind: IslandShortcut['kind'], id: string): Promise<{ ok: boolean; message: string }> {
  if (kind === 'shortcut') {
    if (process.platform !== 'darwin') return { ok: false, message: 'Shortcuts run on a Mac.' };
    const ok = await new Promise<boolean>((resolve) => execFile('/usr/bin/shortcuts', ['run', id], { timeout: 120_000 }, (err) => resolve(!err)));
    return { ok, message: ok ? `Ran “${id}”` : `“${id}” did not finish` };
  }
  if (kind === 'rule') {
    if (!deps) return { ok: false, message: 'Automations are not ready yet.' };
    await deps.runRule(id);
    return { ok: true, message: 'Automation ran' };
  }
  const a = (settings().island.scriptActions ?? []).find((x) => x.id === id);
  if (!a) return { ok: false, message: 'That command is gone.' };
  // The person's own command, without files; it runs in their shell like in a terminal.
  const child = spawn(a.command.replace(/\{files\}|\{file\}|\{dir\}/g, ''), { shell: true, detached: true, stdio: 'ignore', cwd: os.homedir() });
  child.unref();
  return { ok: true, message: `Started “${a.name}”` };
}

// ---------------------------------------------------------------- teleprompter scripts

export async function importScript(p?: string): Promise<{ title: string; text: string } | null> {
  let file = p;
  if (!file) {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Scripts', extensions: ['txt', 'md', 'markdown', 'docx', 'odt', 'rtf', 'html'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    file = r.filePaths[0];
  }
  const ext = path.extname(file).slice(1).toLowerCase();
  const buf = await fsp.readFile(file);
  const raw = ext === 'docx' || ext === 'odt' ? officeText(buf, ext) : ext === 'rtf' ? (await import('../../core/docparse')).rtfToText(buf.toString('utf8')) : buf.toString('utf8');
  return { title: path.basename(file).replace(/\.[^.]+$/, ''), text: scriptFromText(raw) };
}

// ---------------------------------------------------------------- shelf copies

/**
 * With "keep copies" on, files dropped on the shelf are copied into a folder
 * and the copies are shown, so the shelf still has them after the originals
 * move or a download folder is cleaned. Copies older than the retention go.
 */
export async function keepShelfCopies(paths: string[]): Promise<string[]> {
  const s = settings().island as { shelfKeepCopies?: boolean; shelfFolder?: string };
  if (!s.shelfKeepCopies) return paths;
  const dir = s.shelfFolder || path.join(app.getPath('userData'), 'Shelf');
  await fsp.mkdir(dir, { recursive: true });
  const out: string[] = [];
  for (const p of paths) {
    if (p.startsWith(dir + path.sep)) { out.push(p); continue; }
    const st = await fsp.stat(p).catch(() => null);
    if (!st?.isFile()) { out.push(p); continue; }
    const ext = path.extname(p);
    let dest = path.join(dir, path.basename(p));
    for (let i = 2; existsSync(dest); i++) dest = path.join(dir, `${path.basename(p, ext)} ${i}${ext}`);
    await fsp.copyFile(p, dest).then(() => out.push(dest), () => out.push(p));
  }
  return out;
}

export async function pruneShelfCopies(): Promise<number> {
  const s = settings().island as { shelfKeepCopies?: boolean; shelfFolder?: string; shelfRetentionDays?: number };
  const days = s.shelfRetentionDays ?? 7;
  if (!s.shelfKeepCopies || days <= 0) return 0;
  const dir = s.shelfFolder || path.join(app.getPath('userData'), 'Shelf');
  let n = 0;
  for (const name of await fsp.readdir(dir).catch(() => [] as string[])) {
    const p = path.join(dir, name);
    const st = await fsp.stat(p).catch(() => null);
    if (st?.isFile() && Date.now() - st.mtimeMs > days * 86_400_000) {
      await fsp.rm(p, { force: true });
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- macOS Calendar and Reminders
// Through the signed helper's EventKit access; asked only while the Calendar or
// To-Dos tool is open. Off a Mac, or when access is refused, the lists are empty.

export interface MacEvent { id: string; title: string; start: number; end: number; allDay: boolean; calendar: string; location?: string; url?: string; notes?: string }
export interface MacReminder { id: string; title: string; done: boolean; list: string; due?: number }

async function eventKit<T>(method: string, params: unknown, empty: T): Promise<T> {
  if (process.platform !== 'darwin') return empty;
  try {
    return await (await import('./platform/mac')).macHelperCall<T>(method, params, 20_000);
  } catch {
    return empty;
  }
}

export async function macEvents(from: number, to: number): Promise<MacEvent[]> {
  const r = await eventKit<{ events?: MacEvent[] } | MacEvent[]>('eventkit.events', { from, to }, []);
  return Array.isArray(r) ? r : r.events ?? [];
}

export async function macReminders(): Promise<MacReminder[]> {
  const r = await eventKit<{ reminders?: MacReminder[] } | MacReminder[]>('eventkit.reminders', {}, []);
  return Array.isArray(r) ? r : r.reminders ?? [];
}

export async function setMacReminder(id: string, done: boolean): Promise<boolean> {
  const r = await eventKit<{ ok?: boolean }>('eventkit.setReminder', { id, done }, { ok: false });
  return !!r?.ok;
}
