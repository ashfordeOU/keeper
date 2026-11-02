// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Subscription accounts signed in on the web, inside Keeper: Claude
// (claude.ai) and ChatGPT (chatgpt.com, which also carries the Codex limits).
// Each account signs in in its own isolated browser partition
// (`persist:usage-<accountId>`), so several accounts of one service sit side
// by side. Keeper never sees the password; the provider's cookies stay in
// that partition and are wiped when the account is removed.
//
// Reading usage this way is UNOFFICIAL: it uses the JSON the providers' own
// web apps fetch for their usage pages. None of it is a documented API, so
// every parser here is tolerant (unknown fields are skipped, nothing throws)
// and the shapes were taken from public sources, not verified live.
// Pure: no network, no Electron (electron/services/usage-web.ts does that).

import type { Limit } from './model';

const H = 3600_000;
const D = 24 * H;

export type WebProviderId = 'claude-web' | 'chatgpt-web';

export interface WebProviderSpec {
  /** the provider's own origin; every request goes only there */
  origin: string;
  /** where the sign-in window opens */
  login: string;
  /** the site's name, for labels ("Unofficial: uses claude.ai's own pages") */
  site: string;
  /** a cookie that is there only while signed in */
  sessionCookie: RegExp;
}

export const WEB_PROVIDERS: Record<WebProviderId, WebProviderSpec> = {
  'claude-web': { origin: 'https://claude.ai', login: 'https://claude.ai/login', site: 'claude.ai', sessionCookie: /^sessionKey$/ },
  'chatgpt-web': { origin: 'https://chatgpt.com', login: 'https://chatgpt.com/auth/login', site: 'chatgpt.com', sessionCookie: /^(__Secure-)?next-auth\.session-token(\.\d+)?$/ },
};

export const isWebProvider = (p: string): p is WebProviderId => p === 'claude-web' || p === 'chatgpt-web';

// ---------------------------------------------------------------- partitions (one per account)

export const USAGE_PARTITION_PREFIX = 'persist:usage-';
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The account's own browser partition. Throws on an id that could name another partition. */
export function usagePartition(accountId: string): string {
  if (!SAFE_ID.test(accountId)) throw new Error('Not an account id');
  return `${USAGE_PARTITION_PREFIX}${accountId}`;
}

/** The account a partition (or its folder under Partitions/) belongs to, if it is one of the tracker's. */
export function accountOfPartition(nameOrDir: string): string | undefined {
  const bare = nameOrDir.startsWith('persist:') ? nameOrDir.slice('persist:'.length) : nameOrDir;
  if (!bare.startsWith('usage-')) return undefined;
  const id = bare.slice('usage-'.length);
  return SAFE_ID.test(id) ? id : undefined;
}

/**
 * Partition folders (names under the app's Partitions folder) left behind by accounts that no
 * longer exist, e.g. when Keeper quit in the middle of removing one. Those are wiped at start.
 */
export function orphanPartitions(dirNames: string[], accountIds: string[]): string[] {
  const keep = new Set(accountIds);
  return dirNames.filter((d) => {
    const id = accountOfPartition(d);
    return id !== undefined && !keep.has(id);
  });
}

/** Is any of these cookies the provider's signed-in session? */
export function hasSessionCookie(provider: WebProviderId, cookies: { name: string; value?: string }[]): boolean {
  const re = WEB_PROVIDERS[provider].sessionCookie;
  return cookies.some((c) => re.test(c.name) && !!c.value);
}

/**
 * A browser user agent for the sign-in window: Electron's own, without the app's and Electron's
 * tokens, which some sign-in pages (Google's among them) refuse.
 */
export function browserUserAgent(ua: string): string {
  return ua.replace(/\s(?!(?:Mozilla|AppleWebKit|Chrome|Safari|Version|Mobile)\/)[A-Za-z][\w.-]*\/[\w.+-]+/g, '').replace(/\s{2,}/g, ' ').trim();
}

/** Is `url` on the provider's own origin (or the test stub standing in for it)? */
export function sameOrigin(url: string, base: string): boolean {
  try {
    const u = new URL(url);
    const b = new URL(base);
    return u.origin === b.origin && u.pathname.startsWith(b.pathname.replace(/\/$/, '') || '/');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- what an answer means

export type WebAnswer = 'ok' | 'signed-out' | 'blocked' | 'busy' | 'error';

/**
 * Sorts out an answer: signed out (401, or a 403 that is the site's own JSON), a browser check
 * (Cloudflare's challenge page), too many requests, or anything else.
 */
export function webAnswer(status: number, contentType: string | null | undefined, text: string, mitigated?: string | null): WebAnswer {
  const html = /text\/html/i.test(contentType ?? '') || /^\s*<(!doctype|html)/i.test(text);
  if (status >= 200 && status < 300) return html ? 'blocked' : 'ok';
  if (mitigated && /challenge/i.test(mitigated)) return 'blocked';
  if (status === 401) return 'signed-out';
  if (status === 403) return html || /cf-chl|just a moment|cf_chl/i.test(text) ? 'blocked' : 'signed-out';
  if (status === 429) return 'busy';
  return 'error';
}

// ---------------------------------------------------------------- small helpers

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const num = (v: unknown): number | undefined => {
  if (typeof v === 'boolean') return undefined;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** An ISO date, seconds or milliseconds since the epoch → ms. */
function at(v: unknown): number | undefined {
  if (typeof v === 'string' && !/^\d+(\.\d+)?$/.test(v.trim())) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  const n = num(v);
  if (n === undefined || n <= 0) return undefined;
  return n > 1e12 ? n : n > 1e9 ? n * 1000 : undefined;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const title = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** The middle part of a JWT, decoded (no signature check: only for the plan and account id). */
export function jwtClaims(token: string | undefined): Record<string, unknown> | undefined {
  const part = token?.split('.')[1];
  if (!part) return undefined;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const text = typeof atob === 'function' ? atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)) : '';
    return obj(JSON.parse(decodeURIComponent(Array.from(text, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''))));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- Claude (claude.ai)

export interface ClaudeOrg {
  id: string;
  name: string;
  plan?: string;
  /** can chat (a claude.ai organization, not only an API console one) */
  chat: boolean;
}

/** A plan name from an organization's `rate_limit_tier` and `capabilities`. */
export function claudePlan(org: Record<string, unknown>): string | undefined {
  const tier = String(org.rate_limit_tier ?? '').toLowerCase();
  const caps = (Array.isArray(org.capabilities) ? org.capabilities : []).map((c) => String(c).toLowerCase());
  const billing = String(org.billing_type ?? '').toLowerCase();
  const m = /max_(\d+)x/.exec(tier);
  if (m) return `Max ${m[1]}×`;
  if (caps.includes('claude_max') || tier.includes('max')) return 'Max';
  if (caps.includes('enterprise') || tier.includes('enterprise') || billing.includes('enterprise')) return 'Enterprise';
  if (caps.includes('raven') || caps.includes('claude_team') || tier.includes('team') || tier.includes('raven')) return 'Team';
  if (caps.includes('claude_pro') || tier.includes('pro')) return 'Pro';
  if (caps.includes('chat')) return 'Free';
  return undefined;
}

/** `GET /api/organizations` (a list), or the memberships in `GET /api/account`. */
export function claudeOrgs(body: unknown): ClaudeOrg[] {
  const b = obj(body);
  const list: unknown[] = Array.isArray(body) ? body
    : Array.isArray(b?.memberships) ? (b!.memberships as unknown[]).map((m) => obj(m)?.organization)
      : Array.isArray(b?.organizations) ? (b!.organizations as unknown[]) : [];
  const out: ClaudeOrg[] = [];
  for (const raw of list) {
    const o = obj(raw);
    const id = str(o?.uuid) ?? str(o?.id);
    if (!o || !id || out.some((x) => x.id === id)) continue;
    const caps = Array.isArray(o.capabilities) ? o.capabilities.map(String) : [];
    out.push({ id, name: str(o.name) ?? 'Organization', plan: claudePlan(o), chat: caps.includes('chat') || caps.some((c) => /^claude_(pro|max)$/.test(c)) || !caps.length });
  }
  return out;
}

const PLAN_RANK: Record<string, number> = { Enterprise: 5, Team: 4, Max: 3, Pro: 2, Free: 1 };
const rank = (p?: string) => (p ? PLAN_RANK[p.split(' ')[0]] ?? 0 : 0);

/** The organization to read: the one chosen, else the paid chat one, else the first that can chat. */
export function pickClaudeOrg(orgs: ClaudeOrg[], chosen?: string): ClaudeOrg | undefined {
  if (chosen) {
    const c = orgs.find((o) => o.id === chosen);
    if (c) return c;
  }
  const chat = orgs.filter((o) => o.chat);
  return [...(chat.length ? chat : orgs)].sort((a, b) => rank(b.plan) - rank(a.plan))[0];
}

/** Who is signed in: `GET /api/account` → `email_address`, `full_name` / `display_name`. */
export function claudeIdentity(body: unknown): { email?: string; name?: string } {
  const b = obj(body);
  const acct = obj(b?.account) ?? b;
  return { email: str(acct?.email_address) ?? str(acct?.email), name: str(acct?.display_name) ?? str(acct?.full_name) ?? str(acct?.name) };
}

const CLAUDE_WINDOWS: [string, string, string, number][] = [
  ['five_hour', '5h', '5-hour session', 5 * H],
  ['seven_day', 'weekly', 'Weekly (all models)', 7 * D],
  ['seven_day_opus', 'weekly-opus', 'Weekly (Opus)', 7 * D],
  ['seven_day_sonnet', 'weekly-sonnet', 'Weekly (Sonnet)', 7 * D],
  ['seven_day_oauth_apps', 'weekly-apps', 'Weekly (apps)', 7 * D],
];

/** One window: `{ utilization, resets_at }` (or `used_percent`/`percent`). Utilization is a percentage. */
function claudeWindow(v: unknown, key: string, label: string, windowMs?: number): Limit | undefined {
  const w = obj(v);
  if (!w) return undefined;
  const used = num(w.utilization) ?? num(w.used_percent) ?? num(w.percent_used) ?? num(w.percent);
  if (used === undefined) return undefined;
  return { key, label, usedPercent: clamp(used), resetsAt: at(w.resets_at ?? w.reset_at ?? w.resets), windowMs };
}

/**
 * claude.ai's usage answer (`GET /api/organizations/{org}/usage`):
 * `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet` (each `{ utilization, resets_at }`
 * or null), `extra_usage` (`is_enabled`, `monthly_limit`, `used_credits` in cents, `utilization`),
 * and possibly a newer `limits` list. Any other `seven_day_*` window is read too.
 */
export function claudeWebUsage(body: unknown, now: number): Limit[] {
  const b = obj(body);
  if (!b) return [];
  const out: Limit[] = [];
  const push = (l: Limit | undefined) => { if (l && !out.some((x) => x.key === l.key)) out.push(l); };
  for (const [field, key, label, ms] of CLAUDE_WINDOWS) push(claudeWindow(b[field], key, label, ms));
  for (const [field, v] of Object.entries(b)) {
    const m = /^seven_day_([a-z0-9_]+)$/.exec(field);
    if (m && !CLAUDE_WINDOWS.some((w) => w[0] === field)) push(claudeWindow(v, `weekly-${slug(m[1])}`, `Weekly (${title(m[1])})`, 7 * D));
  }
  if (Array.isArray(b.limits)) {
    for (const raw of b.limits) {
      const l = obj(raw);
      if (!l) continue;
      const name = str(l.name) ?? str(l.display_name) ?? str(l.type) ?? str(l.window);
      if (!name) continue;
      const weekly = l.weekly_scoped === true || /week|seven_day/i.test(name);
      const model = str(l.model) ?? str(l.model_family);
      const key = /five_hour|5.?hour|session/i.test(name) ? '5h' : weekly ? (model ? `weekly-${slug(model)}` : slug(name) === 'seven-day' ? 'weekly' : `weekly-${slug(name)}`) : slug(name);
      const label = key === '5h' ? '5-hour session' : weekly && model ? `Weekly (${title(model)})` : title(name);
      push(claudeWindow(l, key, label, key === '5h' ? 5 * H : weekly ? 7 * D : undefined));
    }
  }
  const extra = obj(b.extra_usage);
  if (extra && extra.is_enabled !== false) {
    const limitCents = num(extra.monthly_limit);
    const usedCents = num(extra.used_credits);
    const usedPct = num(extra.utilization) ?? (limitCents && usedCents !== undefined ? (usedCents / limitCents) * 100 : undefined);
    if (usedPct !== undefined || usedCents !== undefined) {
      const d = new Date(now);
      const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      push({ key: 'extra', label: 'Extra usage', usedPercent: usedPct === undefined ? undefined : clamp(usedPct), used: usedCents === undefined ? undefined : usedCents / 100, limit: limitCents === undefined ? undefined : limitCents / 100, unit: 'usd', resetsAt: at(extra.resets_at) ?? next, windowMs: 30 * D });
    }
  }
  return out;
}

// ---------------------------------------------------------------- ChatGPT (chatgpt.com) and Codex

export interface ChatgptSession {
  accessToken?: string;
  email?: string;
  name?: string;
  plan?: string;
  accountId?: string;
  /** when the web session ends (ms) */
  expires?: number;
}

const PLAN_NAMES: Record<string, string> = { free: 'Free', plus: 'Plus', pro: 'Pro', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu', go: 'Go' };
export const chatgptPlanName = (p: unknown): string | undefined => {
  const s = str(p)?.toLowerCase();
  return s ? PLAN_NAMES[s] ?? title(s) : undefined;
};

/** `GET /api/auth/session`: `{ user: { email, name }, accessToken, expires, account? }`; the plan from the token's claims. */
export function chatgptSession(body: unknown): ChatgptSession {
  const b = obj(body);
  if (!b) return {};
  const user = obj(b.user);
  const token = str(b.accessToken) ?? str(b.access_token);
  const claims = jwtClaims(token);
  const auth = obj(claims?.['https://api.openai.com/auth']);
  const account = obj(b.account);
  return {
    accessToken: token,
    email: str(user?.email) ?? str(obj(claims?.['https://api.openai.com/profile'])?.email),
    name: str(user?.name),
    plan: chatgptPlanName(account?.planType ?? account?.plan_type ?? auth?.chatgpt_plan_type),
    accountId: str(account?.id) ?? str(auth?.chatgpt_account_id),
    expires: at(b.expires),
  };
}

/** One `{ used_percent, limit_window_seconds, reset_at | reset_after_seconds }` window. */
function codexWebWindow(v: unknown, fallback: string, prefix: { key: string; label: string } | undefined, now: number): Limit | undefined {
  const w = obj(v);
  if (!w) return undefined;
  const used = num(w.used_percent);
  if (used === undefined) return undefined;
  const secs = num(w.limit_window_seconds) ?? (num(w.window_minutes) !== undefined ? num(w.window_minutes)! * 60 : undefined);
  const base = secs === 18_000 ? { key: '5h', label: '5-hour' } : secs !== undefined && Math.abs(secs - 604_800) < 3600 ? { key: 'weekly', label: 'Weekly' }
    : secs !== undefined && Math.abs(secs - 2_592_000) < 3600 ? { key: 'monthly', label: '30-day' }
      : secs ? { key: fallback, label: secs % 86_400 === 0 ? `${secs / 86_400}-day` : `${Math.round(secs / 3600)}-hour` } : { key: fallback, label: fallback === 'primary' ? 'Primary' : 'Secondary' };
  const after = num(w.reset_after_seconds);
  const resetsAt = at(w.reset_at ?? w.resets_at) ?? (after !== undefined ? now + after * 1000 : undefined);
  return { key: prefix ? `${prefix.key}:${base.key}` : base.key, label: prefix ? `${prefix.label} ${base.label}` : base.label, usedPercent: clamp(used), resetsAt, windowMs: secs ? secs * 1000 : undefined };
}

function rateBlock(v: unknown, prefix: { key: string; label: string } | undefined, now: number): Limit[] {
  const rl = obj(v);
  if (!rl) return [];
  const out: Limit[] = [];
  const a = codexWebWindow(rl.primary_window ?? rl.primary, 'primary', prefix, now);
  const b = codexWebWindow(rl.secondary_window ?? rl.secondary, 'secondary', prefix, now);
  if (a) out.push(a);
  if (b) out.push(b.key === a?.key ? { ...b, key: `${b.key}-2` } : b);
  return out;
}

/**
 * The Codex usage answer chatgpt.com gives a signed-in account (`GET /backend-api/wham/usage`,
 * what Codex itself asks): `plan_type`, `rate_limit.primary_window` / `secondary_window`
 * (`used_percent`, `limit_window_seconds`, `reset_after_seconds`, `reset_at`), `credits`
 * (`has_credits`, `unlimited`, `balance`) and `additional_rate_limits[]`.
 * Field names from codex-rs (`RateLimitStatusPayload`, `RateLimitWindowSnapshot`).
 */
export function chatgptUsage(body: unknown, now: number): { plan?: string; limits: Limit[] } {
  const b = obj(body);
  if (!b) return { limits: [] };
  const limits = rateBlock(b.rate_limit, undefined, now);
  const review = rateBlock(b.code_review_rate_limit, { key: 'review', label: 'Code review' }, now);
  limits.push(...review);
  if (Array.isArray(b.additional_rate_limits)) {
    for (const raw of b.additional_rate_limits) {
      const r = obj(raw);
      const name = str(r?.limit_name) ?? str(r?.metered_feature);
      if (!r || !name) continue;
      for (const l of rateBlock(r.rate_limit, { key: slug(name), label: title(name) }, now)) if (!limits.some((x) => x.key === l.key)) limits.push(l);
    }
  }
  const credits = obj(b.credits);
  if (credits && credits.has_credits && !credits.unlimited && num(credits.balance) !== undefined) {
    limits.push({ key: 'credits', label: 'Credits', used: num(credits.balance), unit: 'credits', note: 'Credits left' });
  }
  return { plan: chatgptPlanName(b.plan_type), limits };
}

// ---------------------------------------------------------------- naming

/** The name a new web account gets when the person left it empty: the signed-in email, else the service. */
export function defaultWebName(given: string | undefined, providerLabel: string, email?: string): string {
  const g = (given ?? '').trim();
  if (g && g !== providerLabel) return g;
  return email ?? (g || providerLabel);
}
