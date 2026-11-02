// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The AI usage and subscription tracker: accounts (many per service, each
// with a name, colour and icon), the limits read for them, subscriptions
// kept by hand, and the settings for the menu-bar label and warnings.
// Pure types, the list of sources and small formatting helpers.

import { USAGE_TOOLS } from '../island-tools/usage';

/** Where an account's numbers come from. */
export type ProviderId =
  | 'claude-web' | 'chatgpt-web'
  | 'cc' | 'codex' | 'gemini-cli' | 'qwen' | 'opencode' | 'copilot' | 'cursor'
  | 'anthropic-api' | 'openai-api' | 'openrouter' | 'deepseek' | 'xai' | 'mistral' | 'groq' | 'gemini-api'
  | 'keeper' | 'subscription' | 'http';

/** How sure the numbers are. */
export type Accuracy = 'exact' | 'estimated' | 'manual';

export type ProviderField = 'configDir' | 'key' | 'teamId' | 'plan' | 'budget' | 'http' | 'subscription' | 'online' | 'statusLine' | 'signIn';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** two letters drawn in the provider's badge */
  glyph: string;
  color: string;
  /** local: files on this computer; api: a key; web: a sign-in inside Keeper; manual: kept by hand */
  kind: 'local' | 'api' | 'web' | 'manual';
  accuracy: Accuracy;
  /** what the account editor asks for */
  fields: ProviderField[];
  /** in plain words: where the numbers come from */
  how: string;
  /** the folder the tool keeps its files in, relative to home (local tools) */
  defaultDir?: string;
  /** the environment variable that moves that folder */
  dirEnv?: string;
  /** what the key is called, for the editor */
  keyLabel?: string;
  /** reads only from undocumented endpoints: nothing is read until the person opts in */
  unofficial?: boolean;
  /** the opt-in switch for an undocumented source, and its one-line explanation */
  optIn?: { label: string; explain: string };
}

/** The explanation shown next to every unofficial source. */
export const UNOFFICIAL = 'Unofficial; may break';

// The first two usage tools are the coding CLIs Keeper has followed longest.
const [cc, codex] = USAGE_TOOLS;

export const PROVIDERS: ProviderInfo[] = [
  { id: 'claude-web', label: 'Claude (claude.ai)', glyph: 'CL', color: '#d97757', kind: 'web', accuracy: 'exact', fields: ['signIn', 'online'], unofficial: true,
    how: 'A Claude subscription (Pro, Max, Team) as claude.ai’s own usage page shows it: the 5-hour session and the weekly limits (all models, Opus), with their resets and the plan. It covers claude.ai, the apps and Claude Code on the web. You sign in to claude.ai in a window of its own; each account keeps its sign-in apart, so you can add several.',
    optIn: { label: 'Read usage from claude.ai', explain: 'Unofficial: uses claude.ai’s own pages; may stop working. Keeper asks claude.ai for this account’s usage with this account’s own sign-in, at most once every service interval (10 minutes by default).' } },
  { id: 'chatgpt-web', label: 'ChatGPT (chatgpt.com)', glyph: 'GP', color: '#10a37f', kind: 'web', accuracy: 'exact', fields: ['signIn', 'online'], unofficial: true,
    how: 'A ChatGPT plan (Plus, Pro, Team…) and the Codex 5-hour and weekly limits chatgpt.com shows for it, which cover Codex in the cloud as well as the CLI. You sign in to chatgpt.com in a window of its own; each account keeps its sign-in apart.',
    optIn: { label: 'Read usage from chatgpt.com', explain: 'Unofficial: uses chatgpt.com’s own pages; may stop working. Keeper asks chatgpt.com for this account’s plan and Codex limits with this account’s own sign-in, at most once every service interval (10 minutes by default).' } },
  { id: 'cc', label: cc.label, glyph: 'CC', color: '#d97757', kind: 'local', accuracy: 'estimated', fields: ['configDir', 'plan', 'statusLine', 'online'], defaultDir: `.${cc.id}`, dirEnv: `${cc.id.toUpperCase()}_CONFIG_DIR`,
    how: 'Tokens counted from the session files in its config folder (one account per folder). The 5-hour and weekly limits are exact once Keeper reads them from its status line; otherwise they are estimated against the plan limits you enter.',
    optIn: { label: 'Ask Anthropic with its own sign-in', explain: 'Uses the tool’s saved sign-in with an undocumented Anthropic usage endpoint. Unofficial; may stop working at any time.' } },
  { id: 'codex', label: codex.label, glyph: 'CX', color: '#10a37f', kind: 'local', accuracy: 'exact', fields: ['configDir'], defaultDir: '.codex', dirEnv: 'CODEX_HOME',
    how: 'The 5-hour and weekly limits (and credits) Codex writes into its own session logs. One account per CODEX_HOME folder.' },
  { id: 'gemini-cli', label: 'Gemini CLI', glyph: 'GC', color: '#4285f4', kind: 'local', accuracy: 'estimated', fields: ['configDir', 'plan'], defaultDir: '.gemini',
    how: 'Requests and tokens counted from its session files; the daily request allowance is the one you enter (about 1,000 a day signed in with a Google account).',
    optIn: { label: 'Ask Google for the quota left', explain: 'Uses Gemini CLI’s saved Google sign-in with the undocumented Code Assist quota endpoint (what its /stats shows). Unofficial; may break.' } },
  { id: 'qwen', label: 'Qwen Code', glyph: 'QW', color: '#615ced', kind: 'local', accuracy: 'estimated', fields: ['configDir', 'plan'], defaultDir: '.qwen',
    how: 'Requests and tokens counted from its session files; the daily request allowance is the one you enter (about 2,000 a day with the free sign-in).' },
  { id: 'opencode', label: 'OpenCode', glyph: 'OC', color: '#f59e0b', kind: 'local', accuracy: 'exact', fields: ['configDir', 'budget'], defaultDir: '.local/share/opencode',
    how: 'Tokens and the cost OpenCode records for each reply, against a monthly budget you set.' },
  { id: 'copilot', label: 'GitHub Copilot', glyph: 'GH', color: '#8957e5', kind: 'local', accuracy: 'exact', fields: ['configDir', 'online'], defaultDir: '.config/github-copilot', unofficial: true,
    how: 'Premium requests, chat and completions left this month, from GitHub’s internal Copilot endpoint with the sign-in Copilot’s editors keep in its config folder.',
    optIn: { label: 'Ask GitHub with Copilot’s sign-in', explain: 'Sends Copilot’s saved token to GitHub’s undocumented copilot_internal endpoint. Unofficial; may break.' } },
  { id: 'cursor', label: 'Cursor', glyph: 'CU', color: '#3c3c3c', kind: 'local', accuracy: 'exact', fields: ['configDir', 'online'], unofficial: true,
    how: 'Requests used this month, from Cursor’s web usage endpoint with the sign-in the Cursor app keeps on this computer (read with the sqlite3 command). No browser cookies are read.',
    optIn: { label: 'Ask Cursor with its app’s sign-in', explain: 'Reads the Cursor app’s saved sign-in from its settings database and sends it to cursor.com’s undocumented usage endpoint. Unofficial; may break.' } },
  { id: 'anthropic-api', label: 'Anthropic API', glyph: 'AN', color: '#cc785c', kind: 'api', accuracy: 'exact', fields: ['key', 'budget'], keyLabel: 'Admin API key (sk-ant-admin…)',
    how: 'Tokens and dollars this month from the Admin API’s usage and cost reports, against a monthly budget you set.' },
  { id: 'openai-api', label: 'OpenAI API', glyph: 'OA', color: '#10a37f', kind: 'api', accuracy: 'exact', fields: ['key', 'budget'], keyLabel: 'Admin key',
    how: 'Requests, tokens and dollars this month from the organization usage and costs endpoints, against a monthly budget you set.' },
  { id: 'openrouter', label: 'OpenRouter', glyph: 'OR', color: '#6467f2', kind: 'api', accuracy: 'exact', fields: ['key'], keyLabel: 'API key',
    how: 'Credits left on the key, its limit and when that limit resets, plus today’s and this month’s spend, from its key endpoint.' },
  { id: 'deepseek', label: 'DeepSeek', glyph: 'DS', color: '#4d6bfe', kind: 'api', accuracy: 'exact', fields: ['key', 'budget'], keyLabel: 'API key',
    how: 'The account balance from its balance endpoint, against the top-up amount you enter.' },
  { id: 'xai', label: 'xAI', glyph: 'XA', color: '#8c8c8c', kind: 'api', accuracy: 'exact', fields: ['key', 'teamId', 'budget'], keyLabel: 'Management key',
    how: 'Prepaid credit balance and the spending limit from the Management API (needs a management key and your team id).' },
  { id: 'mistral', label: 'Mistral', glyph: 'MI', color: '#fa520f', kind: 'api', accuracy: 'estimated', fields: ['budget'],
    how: 'Mistral has no usage endpoint for keys; Keeper counts its own calls to Mistral and their rate-limit headers.' },
  { id: 'groq', label: 'Groq', glyph: 'GQ', color: '#f55036', kind: 'api', accuracy: 'estimated', fields: ['budget'],
    how: 'Groq has no usage endpoint; Keeper counts its own calls and shows the requests and tokens left this minute from Groq’s rate-limit headers.' },
  { id: 'gemini-api', label: 'Gemini API', glyph: 'GE', color: '#4285f4', kind: 'api', accuracy: 'estimated', fields: ['budget'],
    how: 'Google shows quota only in Cloud Console (no key-based usage endpoint), so Keeper counts its own calls to Gemini.' },
  { id: 'keeper', label: 'Keeper’s own AI calls', glyph: 'KP', color: '#7c6cf0', kind: 'local', accuracy: 'exact', fields: ['budget'],
    how: 'The calls, tokens and cost Keeper itself makes to your AI connections, plus the rate limits those services report back.' },
  { id: 'subscription', label: 'Subscription', glyph: '$', color: '#2fb380', kind: 'manual', accuracy: 'manual', fields: ['subscription'],
    how: 'Kept by hand: price, billing cycle, renewal and trial dates, and a usage allowance you update yourself.' },
  { id: 'http', label: 'Custom source', glyph: '{}', color: '#64748b', kind: 'api', accuracy: 'exact', fields: ['key', 'http'], keyLabel: 'Bearer token (optional)',
    how: 'Any JSON endpoint: Keeper reads used, limit and reset from the fields you name.' },
];

export const providerInfo = (id: ProviderId): ProviderInfo => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];

export type Cycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Subscription {
  cost: number;
  currency: string;
  cycle: Cycle;
  /** the next (or any past) renewal date, YYYY-MM-DD */
  renews: string;
  trialEnds?: string;
  /** an allowance, e.g. 500 requests a month */
  quota?: { amount: number; unit: string; used: number; period: 'day' | 'week' | 'month'; resetDay?: number };
  /** days before a renewal or trial end to remind */
  remindDays: number;
  url?: string;
}

export interface HttpSource {
  url: string;
  /** JSONPath-style: $.data.used, usage[0].value */
  used: string;
  limit?: string;
  /** a timestamp, ISO date or seconds-from-now */
  reset?: string;
  /** used is already a percentage */
  percent?: boolean;
  label?: string;
  unit?: string;
}

export interface PlanLimits {
  /** tokens in a 5-hour block (estimate when nothing exact is known) */
  fiveHourTokens?: number;
  weeklyTokens?: number;
  /** requests a day (Gemini CLI, Qwen Code) */
  dailyRequests?: number;
}

export interface Account {
  id: string;
  provider: ProviderId;
  name: string;
  color?: string;
  /** an icon name (Icon component) or a short emoji */
  icon?: string;
  /** left out of the menu-bar label (still in the pop-over) */
  hideInMenuBar?: boolean;
  /** limit keys to show; absent = all */
  limits?: string[];
  paused?: boolean;
  configDir?: string;
  plan?: PlanLimits;
  /** monthly budget in US dollars */
  budget?: number;
  teamId?: string;
  http?: HttpSource;
  subscription?: Subscription;
  /** ask the service with the tool's own sign-in (opt-in, undocumented endpoint) */
  online?: boolean;
  /** Keeper reads the 5-hour and weekly limits from the tool's status line */
  statusLine?: boolean;
  /** web accounts: signed in inside Keeper (in the account's own partition); expired when the site said signed out */
  signedIn?: { at: number; email?: string; expired?: boolean };
  /** claude.ai: the organization to read when the sign-in has more than one */
  orgId?: string;
  createdAt: number;
}

/** One limit or meter of one account. */
export interface Limit {
  key: string;
  /** "5-hour", "Weekly", "Monthly credits" */
  label: string;
  /** 0–100 used; absent when only a count is known */
  usedPercent?: number;
  used?: number;
  limit?: number;
  unit?: 'tokens' | 'requests' | 'usd' | 'credits' | string;
  resetsAt?: number;
  /** how long the window lasts (for the rate forecast and "use it before it resets") */
  windowMs?: number;
  estimated?: boolean;
  note?: string;
}

export interface AccountState {
  accountId: string;
  at: number;
  state: 'ok' | 'empty' | 'error' | 'paused';
  limits: Limit[];
  message?: string;
  source: string;
  accuracy: Accuracy;
  /** dollars spent this month (API accounts, Keeper's own calls) */
  monthUsd?: number;
  /** web accounts: the sign-in is missing or has ended; the page offers "Sign in again" */
  needsSignIn?: boolean;
  /** web accounts: the plan the site reports (Pro, Max 5×, Plus…) */
  plan?: string;
  /** claude.ai: the organizations this sign-in can read, to choose from */
  orgs?: { id: string; name: string; plan?: string }[];
}

export interface Thresholds {
  /** running out at or below this share left (percent) */
  lowLeft: number;
  /** used up at or above this share used (percent) */
  usedUp: number;
  /** also running out when the pace says it runs out before the reset */
  predict: boolean;
  /** "use it before it resets": resets within this many hours… */
  expiringHours: number;
  /** …with at least this share still unused (percent) */
  expiringLeft: number;
  /** warn about a reset only for windows of at least this many hours */
  expiringMinWindowHours: number;
}

export type LabelMode = 'icon' | 'urgent' | 'countdown' | 'busy';

export interface MenuBarSettings {
  mode: LabelMode;
  /** how many items the label shows (1–3) */
  count: 1 | 2 | 3;
  /** "+N" for the rest */
  overflow: boolean;
  /** no menu-bar item at all while nothing is running out */
  hideWhenClear: boolean;
  /** the provider's two letters before each number */
  glyph: boolean;
}

export interface NotifySettings {
  /** at the running-out and used-up thresholds */
  thresholds: boolean;
  /** when a used-up or low limit resets */
  resets: boolean;
  /** subscriptions renewing and trials ending */
  renewals: boolean;
  /** "use it before it resets" */
  expiring: boolean;
}

export interface TrackerSettings {
  thresholds: Thresholds;
  menuBar: MenuBarSettings;
  notify: NotifySettings;
  /** minutes between looks at local files and at services */
  localEveryMin: number;
  apiEveryMin: number;
  paused: boolean;
}

export function defaultTrackerSettings(): TrackerSettings {
  return {
    thresholds: { lowLeft: 30, usedUp: 99.5, predict: true, expiringHours: 24, expiringLeft: 40, expiringMinWindowHours: 48 },
    menuBar: { mode: 'urgent', count: 1, overflow: true, hideWhenClear: false, glyph: true },
    notify: { thresholds: true, resets: true, renewals: true, expiring: false },
    localEveryMin: 2,
    apiEveryMin: 10,
    paused: false,
  };
}

const clampN = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** Lenient: anything odd falls back to the default for that field. */
export function normalizeTrackerSettings(raw: unknown): TrackerSettings {
  const d = defaultTrackerSettings();
  const r = (raw ?? {}) as Partial<TrackerSettings>;
  const t = (r.thresholds ?? {}) as Partial<Thresholds>;
  const m = (r.menuBar ?? {}) as Partial<MenuBarSettings>;
  const n = (r.notify ?? {}) as Partial<NotifySettings>;
  return {
    thresholds: {
      lowLeft: clampN(t.lowLeft, 1, 90, d.thresholds.lowLeft),
      usedUp: clampN(t.usedUp, 80, 100, d.thresholds.usedUp),
      predict: typeof t.predict === 'boolean' ? t.predict : d.thresholds.predict,
      expiringHours: clampN(t.expiringHours, 1, 24 * 7, d.thresholds.expiringHours),
      expiringLeft: clampN(t.expiringLeft, 1, 100, d.thresholds.expiringLeft),
      expiringMinWindowHours: clampN(t.expiringMinWindowHours, 1, 24 * 31, d.thresholds.expiringMinWindowHours),
    },
    menuBar: {
      mode: (['icon', 'urgent', 'countdown', 'busy'] as const).includes(m.mode as LabelMode) ? (m.mode as LabelMode) : d.menuBar.mode,
      count: ([1, 2, 3] as const).includes(m.count as 1) ? (m.count as 1 | 2 | 3) : d.menuBar.count,
      overflow: typeof m.overflow === 'boolean' ? m.overflow : d.menuBar.overflow,
      hideWhenClear: typeof m.hideWhenClear === 'boolean' ? m.hideWhenClear : d.menuBar.hideWhenClear,
      glyph: typeof m.glyph === 'boolean' ? m.glyph : d.menuBar.glyph,
    },
    notify: {
      thresholds: typeof n.thresholds === 'boolean' ? n.thresholds : d.notify.thresholds,
      resets: typeof n.resets === 'boolean' ? n.resets : d.notify.resets,
      renewals: typeof n.renewals === 'boolean' ? n.renewals : d.notify.renewals,
      expiring: typeof n.expiring === 'boolean' ? n.expiring : d.notify.expiring,
    },
    localEveryMin: clampN(r.localEveryMin, 1, 60, d.localEveryMin),
    apiEveryMin: clampN(r.apiEveryMin, 5, 120, d.apiEveryMin),
    paused: !!r.paused,
  };
}

// ---------------------------------------------------------------- formatting

/** "5d 2h", "22h 10m", "45m", "now". */
export function countdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 30_000) return 'now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export function money(usd: number, currency = 'USD'): string {
  const v = Math.abs(usd) >= 100 ? usd.toFixed(0) : usd.toFixed(2);
  const sym: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹', CNY: '¥', AUD: 'A$', CAD: 'C$' };
  return sym[currency.toUpperCase()] ? `${sym[currency.toUpperCase()]}${v}` : `${v} ${currency.toUpperCase()}`;
}

export function compact(n: number): string {
  const a = Math.abs(n);
  return a >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 1e4 ? `${Math.round(n / 1e3)}k` : a >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n * 100) / 100);
}

/** "1.2M / 5M tokens", "$12.40 / $50", "340 requests". */
export function amountText(l: Pick<Limit, 'used' | 'limit' | 'unit'>): string {
  if (l.used === undefined) return '';
  if (l.unit === 'usd') return l.limit !== undefined ? `${money(l.used)} / ${money(l.limit)}` : money(l.used);
  const unit = l.unit && l.unit !== 'credits' ? ` ${l.unit}` : l.unit === 'credits' ? ' credits' : '';
  return l.limit !== undefined ? `${compact(l.used)} / ${compact(l.limit)}${unit}` : `${compact(l.used)}${unit}`;
}

export const percentLeft = (l: Pick<Limit, 'usedPercent'>): number | undefined => (l.usedPercent === undefined ? undefined : Math.max(0, Math.min(100, 100 - l.usedPercent)));

/**
 * The letters an account shows before its numbers (the glance, the Island): its own badge when
 * set; the service's letters when it is the only account of that service; otherwise the
 * service's first letter and the first letter of what tells the account apart in its name
 * ("Claude — Work" → "CW"). When another account already reads the same, the first two letters
 * of that word ("Pe", "Pl"); failing that, a number.
 */
export function accountGlyph(a: Pick<Account, 'id' | 'provider' | 'name' | 'icon'>, all: Pick<Account, 'id' | 'provider' | 'name' | 'icon'>[]): string {
  const own = (x: typeof a) => (x.icon && x.icon.length <= 2 ? x.icon : undefined);
  if (own(a)) return own(a)!;
  const words = (n: string) => n.split(/[\s—–·:|/()@._-]+/).filter(Boolean);
  const word = (x: typeof a) => {
    const label = new Set(words(providerInfo(x.provider).label.toLowerCase()));
    return words(x.name).find((w) => !label.has(w.toLowerCase())) ?? words(x.name)[0] ?? '?';
  };
  const first = (x: typeof a): string => {
    if (own(x)) return own(x)!;
    const info = providerInfo(x.provider);
    if (all.filter((y) => y.provider === x.provider && !own(y)).length <= 1) return info.glyph;
    return `${info.glyph[0]}${word(x)[0].toUpperCase()}`;
  };
  const g = first(a);
  const clash = all.filter((x) => first(x) === g);
  if (clash.length <= 1) return g;
  const second = (x: typeof a) => { const w = word(x); return `${w[0].toUpperCase()}${(w[1] ?? '').toLowerCase()}`; };
  const g2 = second(a);
  if (g2.length === 2 && clash.filter((x) => second(x) === g2).length === 1 && !all.some((x) => first(x) === g2)) return g2;
  return `${g[0]}${clash.findIndex((x) => x.id === a.id) + 1}`;
}

/** A short, unique-enough id. */
export function newId(prefix = 'a'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
