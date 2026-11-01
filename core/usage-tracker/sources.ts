// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Turns what each source gives into limits: the coding CLIs' own files on
// this computer, the services' documented usage, cost and balance
// endpoints, rate-limit headers on Keeper's own calls, and any JSON endpoint
// with named fields. Pure: no files, no network (the main process feeds it).

import { claudeBlock, claudeOAuthUsage, type TokenLine } from '../island-tools/usage';
import type { ReplyLine } from '../island-tools/usage-more';
import type { HttpSource, Limit, PlanLimits } from './model';

const H = 3600_000;
const H5 = 5 * H;
const D = 24 * H;
const D7 = 7 * D;

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const pct = (used: number | undefined, limit: number | undefined) => (used !== undefined && limit ? Math.max(0, Math.min(100, (used / limit) * 100)) : undefined);

/** Seconds, milliseconds or an ISO date → ms since epoch. */
export function toMs(v: unknown, now = Date.now()): number | undefined {
  if (typeof v === 'string' && !/^\d+(\.\d+)?$/.test(v.trim())) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  const n = num(v);
  if (n === undefined) return undefined;
  if (n > 1e12) return n;
  if (n > 1e9) return n * 1000;
  // A small number: seconds from now.
  return now + n * 1000;
}

// ---------------------------------------------------------------- months (UTC, as the services bill)

export function monthStartUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
export function nextMonthUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}
const monthLimit = (key: string, label: string, used: number, limit: number | undefined, unit: Limit['unit'], now: number, extra: Partial<Limit> = {}): Limit => ({
  key, label, used, limit, unit, usedPercent: pct(used, limit), resetsAt: nextMonthUtc(now), windowMs: nextMonthUtc(now) - monthStartUtc(now), ...extra,
});

// ---------------------------------------------------------------- the Anthropic coding CLI (local)

/** The status-line JSON its `statusLine` command receives: `rate_limits.five_hour` / `seven_day` / `spend_limit`. */
export function ccStatusLine(json: unknown, now: number): Limit[] {
  const rl = ((json ?? {}) as { rate_limits?: Record<string, Record<string, unknown> | undefined> }).rate_limits;
  if (!rl || typeof rl !== 'object') return [];
  const out: Limit[] = [];
  const add = (key: string, label: string, w: Record<string, unknown> | undefined, windowMs?: number) => {
    const used = num(w?.used_percentage);
    if (used === undefined) return;
    const resetsAt = toMs(w?.resets_at, now);
    // The tool drops a window once its reset passes; so do we.
    if (resetsAt !== undefined && resetsAt <= now) return;
    out.push({ key, label, usedPercent: Math.max(0, Math.min(100, used)), resetsAt, windowMs });
  };
  add('5h', '5-hour', rl.five_hour, H5);
  add('weekly', 'Weekly', rl.seven_day, D7);
  const sp = rl.spend_limit;
  if (sp) {
    const period = String(sp.period ?? 'monthly');
    add('spend', `Spend limit (${period})`, sp, period === 'daily' ? D : period === 'weekly' ? D7 : 30 * D);
    const last = out[out.length - 1];
    if (last?.key === 'spend' && num(sp.used_usd) !== undefined) Object.assign(last, { used: num(sp.used_usd), limit: num(sp.limit_usd), unit: 'usd' });
  }
  return out;
}

/**
 * The 5-hour block and the week from token counts. With a weekly reset learned from an exact
 * reading (`weeklyResetAt`), the week follows that schedule; otherwise it is the last 7 days.
 * Against plan limits the person entered, each gets an estimated share.
 */
export function ccLocalWindows(lines: TokenLine[], now: number, plan: PlanLimits = {}, weeklyResetAt?: number): Limit[] {
  const block = claudeBlock(lines, now);
  let weekStart = now - D7;
  let weekReset: number | undefined;
  if (weeklyResetAt) {
    // Move the learned reset forward (or back) to the week we are in.
    weekReset = weeklyResetAt + Math.ceil((now - weeklyResetAt) / D7) * D7;
    if (weekReset <= now) weekReset += D7;
    weekStart = weekReset - D7;
  }
  const week = lines.filter((l) => l.at > weekStart && l.at <= now).reduce((n, l) => n + l.tokens, 0);
  const fiveUsed = block?.tokens ?? 0;
  return [
    { key: '5h', label: '5-hour', used: fiveUsed, limit: plan.fiveHourTokens, unit: 'tokens', usedPercent: pct(fiveUsed, plan.fiveHourTokens), resetsAt: block?.end, windowMs: H5, estimated: true },
    { key: 'weekly', label: weeklyResetAt ? 'Weekly' : 'Last 7 days', used: week, limit: plan.weeklyTokens, unit: 'tokens', usedPercent: pct(week, plan.weeklyTokens), resetsAt: weekReset, windowMs: D7, estimated: true },
  ];
}

/** Exact readings win; local token counts fill in the amounts (and stand alone, estimated, without them). */
export function mergeExact(local: Limit[], exact: Limit[]): Limit[] {
  const out = exact.map((e) => {
    const l = local.find((x) => x.key === e.key);
    return l && e.used === undefined ? { ...e, used: l.used, unit: l.unit } : e;
  });
  for (const l of local) if (!out.some((x) => x.key === l.key)) out.push(l);
  return out;
}

/** The account usage answer the tool's own sign-in gets (opt-in; not a documented API). */
export function ccOAuth(body: unknown): Limit[] {
  return claudeOAuthUsage(body).map((w) => {
    const key = /5-hour/.test(w.label) ? '5h' : w.label === 'Weekly' ? 'weekly' : w.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return { key, label: w.label.replace(' session', ''), usedPercent: w.usedPercent, resetsAt: w.resetsAt, windowMs: key === '5h' ? H5 : /weekly/i.test(w.label) ? D7 : undefined };
  });
}

// ---------------------------------------------------------------- Codex (local)

export interface CodexSnapshot {
  at: number;
  limitId: string;
  limitName?: string;
  plan?: string;
  limits: Limit[];
}

function codexWindow(w: Record<string, unknown> | undefined, fallbackKey: string, base: number, now: number): Limit | undefined {
  if (!w) return undefined;
  const used = num(w.used_percent);
  if (used === undefined) return undefined;
  const mins = num(w.window_minutes) ?? (num(w.limit_window_seconds) !== undefined ? num(w.limit_window_seconds)! / 60 : undefined);
  const key = mins === 300 ? '5h' : mins !== undefined && mins >= 10_000 && mins <= 10_100 ? 'weekly' : fallbackKey;
  const label = key === '5h' ? '5-hour' : key === 'weekly' ? 'Weekly' : mins ? (mins % 1440 === 0 ? `${mins / 1440}-day` : `${Math.round(mins / 60)}-hour`) : fallbackKey === 'primary' ? 'Primary' : 'Secondary';
  const resetsAt = w.resets_at !== undefined ? toMs(w.resets_at, now) : w.resets_in_seconds !== undefined ? base + (num(w.resets_in_seconds) ?? 0) * 1000 : undefined;
  return { key, label, usedPercent: Math.max(0, Math.min(100, used)), resetsAt, windowMs: mins ? mins * 60_000 : undefined };
}

/**
 * Every rate-limit snapshot in a Codex session log (JSON lines). Codex writes
 * `{"timestamp","type":"event_msg","payload":{"type":"token_count","rate_limits":{…}}}`;
 * older versions used `primary_window`/`resets_in_seconds`. Newest last.
 */
export function codexSnapshots(jsonl: string, now = Date.now()): CodexSnapshot[] {
  const out: CodexSnapshot[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.includes('rate_limit')) continue;
    let o: { timestamp?: string; payload?: Record<string, unknown> } & Record<string, unknown>;
    try { o = JSON.parse(line); } catch { continue; }
    const p = (o.payload ?? o) as Record<string, unknown>;
    const rl = (p.rate_limits ?? (p.msg as Record<string, unknown> | undefined)?.rate_limits) as Record<string, unknown> | undefined;
    if (!rl || typeof rl !== 'object') continue;
    const at = o.timestamp ? Date.parse(o.timestamp) : NaN;
    const base = Number.isFinite(at) ? at : now;
    const limits: Limit[] = [];
    const a = codexWindow((rl.primary ?? rl.primary_window) as Record<string, unknown> | undefined, 'primary', base, now);
    const b = codexWindow((rl.secondary ?? rl.secondary_window) as Record<string, unknown> | undefined, 'secondary', base, now);
    if (a) limits.push(a);
    if (b) limits.push(b.key === a?.key ? { ...b, key: 'secondary' } : b);
    const spend = rl.individual_limit as Record<string, unknown> | undefined;
    if (spend && num(spend.remaining_percent) !== undefined) {
      limits.push({ key: 'spend', label: 'Spend limit', usedPercent: 100 - num(spend.remaining_percent)!, used: num(spend.used), limit: num(spend.limit), unit: 'usd', resetsAt: toMs(spend.resets_at, now) });
    }
    const credits = rl.credits as Record<string, unknown> | undefined;
    if (credits && credits.has_credits && !credits.unlimited && num(credits.balance) !== undefined) {
      limits.push({ key: 'credits', label: 'Credits', used: num(credits.balance), unit: 'credits', note: 'Credits left' });
    }
    if (!limits.length) continue;
    out.push({ at: base, limitId: String(rl.limit_id ?? 'codex'), limitName: rl.limit_name ? String(rl.limit_name) : undefined, plan: rl.plan_type ? String(rl.plan_type) : undefined, limits });
  }
  return out;
}

/** The newest snapshot per limit id, merged into one list (other ids' keys get their name). */
export function codexLatest(snaps: CodexSnapshot[]): { limits: Limit[]; at: number; plan?: string } | undefined {
  if (!snaps.length) return undefined;
  const byId = new Map<string, CodexSnapshot>();
  for (const s of [...snaps].sort((a, b) => a.at - b.at)) byId.set(s.limitId, s);
  const ids = [...byId.keys()].sort((a, b) => (a === 'codex' ? -1 : b === 'codex' ? 1 : a.localeCompare(b)));
  const limits: Limit[] = [];
  for (const id of ids) {
    const s = byId.get(id)!;
    for (const l of s.limits) limits.push(id === ids[0] ? l : { ...l, key: `${id}:${l.key}`, label: `${s.limitName ?? id} ${l.label}` });
  }
  const newest = [...byId.values()].sort((a, b) => b.at - a.at)[0];
  return { limits, at: newest.at, plan: newest.plan };
}

// ---------------------------------------------------------------- Gemini CLI, Qwen Code, OpenCode (local)

const startOfDay = (now: number) => new Date(now).setHours(0, 0, 0, 0);

/** Today's requests against a daily allowance, and the week's tokens. */
export function dailyLimits(lines: ReplyLine[], now: number, dailyRequests?: number): Limit[] {
  const day0 = startOfDay(now);
  const today = lines.filter((l) => l.at >= day0);
  const week = lines.filter((l) => l.at > now - D7);
  return [
    { key: 'daily', label: 'Daily requests', used: today.length, limit: dailyRequests, unit: 'requests', usedPercent: pct(today.length, dailyRequests), resetsAt: day0 + D, windowMs: D, estimated: true },
    { key: 'week-tokens', label: 'Last 7 days', used: week.reduce((n, l) => n + l.tokens, 0), unit: 'tokens' },
  ];
}

/** This month's cost against a budget, and the last 5 hours' tokens. */
export function costLimits(lines: ReplyLine[], now: number, budget?: number): Limit[] {
  const m0 = new Date(now);
  const month = lines.filter((l) => l.at >= new Date(m0.getFullYear(), m0.getMonth(), 1).getTime());
  const usd = month.reduce((n, l) => n + (l.cost ?? 0), 0);
  const h5 = lines.filter((l) => l.at > now - H5);
  return [
    { key: 'month-cost', label: 'This month', used: usd, limit: budget, unit: 'usd', usedPercent: pct(usd, budget), resetsAt: new Date(m0.getFullYear(), m0.getMonth() + 1, 1).getTime(), windowMs: 30 * D },
    { key: '5h-tokens', label: 'Last 5 hours', used: h5.reduce((n, l) => n + l.tokens, 0), unit: 'tokens' },
  ];
}

// ---------------------------------------------------------------- service APIs (documented endpoints)

interface Bucket { results?: Record<string, unknown>[]; starting_at?: string; start_time?: number }
const buckets = (body: unknown): Bucket[] => (Array.isArray((body as { data?: unknown })?.data) ? (body as { data: Bucket[] }).data : []);

/** Anthropic Admin API: GET /v1/organizations/usage_report/messages (daily buckets). */
export function anthropicUsageTokens(body: unknown): { tokens: number; byDay: Record<string, number> } {
  let tokens = 0;
  const byDay: Record<string, number> = {};
  for (const b of buckets(body)) {
    let t = 0;
    for (const r of b.results ?? []) {
      const cc = (r.cache_creation ?? {}) as Record<string, unknown>;
      t += (num(r.uncached_input_tokens) ?? 0) + (num(r.cache_read_input_tokens) ?? 0) + (num(r.output_tokens) ?? 0) + (num(cc.ephemeral_1h_input_tokens) ?? 0) + (num(cc.ephemeral_5m_input_tokens) ?? 0);
    }
    tokens += t;
    if (b.starting_at) byDay[b.starting_at.slice(0, 10)] = t;
  }
  return { tokens, byDay };
}

/** Anthropic Admin API: GET /v1/organizations/cost_report. Amounts are cents, as decimal strings. */
export function anthropicCostUsd(body: unknown): { usd: number; byDay: Record<string, number> } {
  let usd = 0;
  const byDay: Record<string, number> = {};
  for (const b of buckets(body)) {
    const d = (b.results ?? []).reduce((n, r) => n + (num(r.amount) ?? 0) / 100, 0);
    usd += d;
    if (b.starting_at) byDay[b.starting_at.slice(0, 10)] = d;
  }
  return { usd, byDay };
}

/** OpenAI: GET /v1/organization/usage/completions (start_time in seconds). */
export function openaiUsage(body: unknown): { tokens: number; requests: number } {
  let tokens = 0;
  let requests = 0;
  for (const b of buckets(body)) for (const r of b.results ?? []) {
    tokens += (num(r.input_tokens) ?? 0) + (num(r.output_tokens) ?? 0);
    requests += num(r.num_model_requests) ?? 0;
  }
  return { tokens, requests };
}

/** OpenAI: GET /v1/organization/costs; each result has amount: { value, currency }. */
export function openaiCostsUsd(body: unknown): { usd: number; byDay: Record<string, number> } {
  let usd = 0;
  const byDay: Record<string, number> = {};
  for (const b of buckets(body)) {
    const d = (b.results ?? []).reduce((n, r) => n + (num((r.amount as { value?: unknown } | undefined)?.value) ?? 0), 0);
    usd += d;
    if (b.start_time) byDay[new Date(b.start_time * 1000).toISOString().slice(0, 10)] = d;
  }
  return { usd, byDay };
}

/** API-account limits for one month: dollars against the budget, tokens and requests as amounts. */
export function apiMonthLimits(o: { usd?: number; tokens?: number; requests?: number; budget?: number }, now: number): Limit[] {
  const out: Limit[] = [];
  if (o.usd !== undefined) out.push(monthLimit('month-cost', 'Monthly spend', o.usd, o.budget, 'usd', now));
  if (o.tokens !== undefined) out.push({ key: 'month-tokens', label: 'Tokens this month', used: o.tokens, unit: 'tokens' });
  if (o.requests !== undefined) out.push({ key: 'month-requests', label: 'Requests this month', used: o.requests, unit: 'requests' });
  return out;
}

const nextUtc = (period: string, now: number): number | undefined => {
  const d = new Date(now);
  if (period === 'daily') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  if (period === 'weekly') { const dow = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 7 - dow); }
  if (period === 'monthly') return nextMonthUtc(now);
  return undefined;
};

/** OpenRouter: GET /api/v1/key → { data: { limit, limit_remaining, limit_reset, usage_daily, usage_monthly, free_model_daily_requests } }. */
export function openrouterKey(body: unknown, now: number): Limit[] {
  const d = ((body ?? {}) as { data?: Record<string, unknown> }).data ?? {};
  const out: Limit[] = [];
  const limit = num(d.limit);
  const remaining = num(d.limit_remaining);
  if (limit !== undefined && remaining !== undefined) {
    const reset = d.limit_reset ? nextUtc(String(d.limit_reset), now) : undefined;
    const period = String(d.limit_reset ?? '');
    out.push({ key: 'credits', label: period ? `${period[0].toUpperCase()}${period.slice(1)} credits` : 'Credits', used: Math.max(0, limit - remaining), limit, unit: 'usd', usedPercent: pct(Math.max(0, limit - remaining), limit), resetsAt: reset, windowMs: period === 'daily' ? D : period === 'weekly' ? D7 : period === 'monthly' ? 30 * D : undefined });
  }
  const free = d.free_model_daily_requests as Record<string, unknown> | undefined;
  if (free && num(free.limit)) out.push({ key: 'free-daily', label: 'Free requests today', used: num(free.used) ?? 0, limit: num(free.limit), unit: 'requests', usedPercent: pct(num(free.used) ?? 0, num(free.limit)), resetsAt: nextUtc('daily', now), windowMs: D });
  if (num(d.usage_daily) !== undefined) out.push({ key: 'today-cost', label: 'Spent today', used: num(d.usage_daily)!, unit: 'usd' });
  if (num(d.usage_monthly) !== undefined) out.push({ key: 'month-cost', label: 'Spent this month', used: num(d.usage_monthly)!, unit: 'usd' });
  return out;
}

/** DeepSeek: GET /user/balance → { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }. */
export function deepseekBalance(body: unknown, topUp?: number): Limit[] {
  const infos = ((body ?? {}) as { balance_infos?: Record<string, unknown>[] }).balance_infos ?? [];
  return infos.map((b) => {
    const left = num(b.total_balance) ?? 0;
    const cur = String(b.currency ?? 'USD').toUpperCase();
    const unit = cur === 'USD' ? 'usd' : cur;
    // With the amount topped up, the share used is known.
    return topUp && cur === 'USD'
      ? { key: `balance-${cur.toLowerCase()}`, label: 'Balance', used: Math.max(0, topUp - left), limit: topUp, unit, usedPercent: pct(Math.max(0, topUp - left), topUp), note: `${left.toFixed(2)} left` }
      : { key: `balance-${cur.toLowerCase()}`, label: 'Balance left', used: left, unit, note: b.granted_balance ? `${b.granted_balance} granted` : undefined };
  });
}

/**
 * xAI Management API: GET /v1/billing/teams/{team}/prepaid/balance → { total: { val: "-1000" } }
 * (USD cents; purchases count negative, so a credit shows as a negative total).
 */
export function xaiBalance(body: unknown, topUp?: number): Limit[] {
  const total = num(((body ?? {}) as { total?: { val?: unknown } }).total?.val);
  if (total === undefined) return [];
  const left = Math.max(0, -total / 100);
  return [topUp
    ? { key: 'prepaid', label: 'Prepaid credits', used: Math.max(0, topUp - left), limit: topUp, unit: 'usd', usedPercent: pct(Math.max(0, topUp - left), topUp), note: `$${left.toFixed(2)} left` }
    : { key: 'prepaid', label: 'Prepaid credits left', used: left, unit: 'usd' }];
}

// ---------------------------------------------------------------- any JSON endpoint

/** A small JSONPath: `$.data.used`, `data.items[0].value`, `quota["left"]`. */
export function jsonPath(obj: unknown, path: string): unknown {
  const parts = path.trim().replace(/^\$\.?/, '').match(/[^.[\]"']+|\[\d+\]/g) ?? [];
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    const idx = /^\[(\d+)\]$/.exec(p);
    cur = idx ? (cur as unknown[])[Number(idx[1])] : (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function httpLimits(body: unknown, s: HttpSource, now: number): Limit[] {
  const used = num(jsonPath(body, s.used));
  if (used === undefined) return [];
  const limit = s.limit ? num(jsonPath(body, s.limit)) : undefined;
  const resetsAt = s.reset ? toMs(jsonPath(body, s.reset), now) : undefined;
  return [{ key: 'custom', label: s.label || 'Usage', used: s.percent ? undefined : used, limit: s.percent ? undefined : limit, unit: s.unit, usedPercent: s.percent ? Math.max(0, Math.min(100, used)) : pct(used, limit), resetsAt }];
}

// ---------------------------------------------------------------- rate-limit headers on Keeper's own calls

export interface RateWindow {
  limit?: number;
  remaining?: number;
  resetsAt?: number;
}
export interface RateHeaders {
  requests?: RateWindow;
  tokens?: RateWindow;
  at: number;
}

/** "6m0s", "1.5s", "20ms", "1h2m" (OpenAI, Groq) → milliseconds. */
export function durationMs(s: string): number | undefined {
  let ms = 0;
  let hit = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    hit = true;
    const n = Number(m[1]);
    ms += m[2] === 'h' ? n * H : m[2] === 'm' ? n * 60_000 : m[2] === 's' ? n * 1000 : n;
  }
  return hit ? ms : undefined;
}

/** OpenAI-style `x-ratelimit-*-requests|tokens` and Anthropic's `anthropic-ratelimit-*` headers. */
export function parseRateHeaders(get: (name: string) => string | null | undefined, now: number): RateHeaders | undefined {
  const read = (kind: 'requests' | 'tokens'): RateWindow | undefined => {
    const limit = num(get(`x-ratelimit-limit-${kind}`) ?? get(`anthropic-ratelimit-${kind}-limit`) ?? undefined);
    const remaining = num(get(`x-ratelimit-remaining-${kind}`) ?? get(`anthropic-ratelimit-${kind}-remaining`) ?? undefined);
    if (limit === undefined && remaining === undefined) return undefined;
    const r = get(`x-ratelimit-reset-${kind}`) ?? get(`anthropic-ratelimit-${kind}-reset`);
    const resetsAt = r ? (/^\d{4}-/.test(r) ? Date.parse(r) : (() => { const d = durationMs(r); return d === undefined ? undefined : now + d; })()) : undefined;
    return { limit, remaining, resetsAt: Number.isFinite(resetsAt) ? resetsAt : undefined };
  };
  const requests = read('requests');
  const tokens = read('tokens');
  return requests || tokens ? { requests, tokens, at: now } : undefined;
}

export function rateLimits(h: RateHeaders | undefined, now: number): Limit[] {
  if (!h || now - h.at > 10 * 60_000) return [];
  const out: Limit[] = [];
  const add = (key: string, label: string, w: RateWindow | undefined, unit: string) => {
    if (!w || w.limit === undefined || w.remaining === undefined) return;
    // Once its reset passes, the window is full again.
    if (w.resetsAt && w.resetsAt <= now) return;
    out.push({ key, label, used: w.limit - w.remaining, limit: w.limit, unit, usedPercent: pct(w.limit - w.remaining, w.limit), resetsAt: w.resetsAt, note: `${w.remaining} left` });
  };
  add('rpm', 'Requests this minute', h.requests, 'requests');
  add('tpm', 'Tokens this minute', h.tokens, 'tokens');
  return out;
}

/** Which service a base URL or provider kind belongs to (for headers and Keeper's own calls). */
export function serviceOf(urlOrKind: string): 'anthropic-api' | 'openai-api' | 'groq' | 'mistral' | 'xai' | 'openrouter' | 'deepseek' | 'gemini-api' | undefined {
  const s = urlOrKind.toLowerCase();
  if (s.includes('anthropic')) return 'anthropic-api';
  if (s.includes('groq')) return 'groq';
  if (s.includes('mistral')) return 'mistral';
  if (s.includes('x.ai') || s === 'xai' || s.includes('grok')) return 'xai';
  if (s.includes('openrouter')) return 'openrouter';
  if (s.includes('deepseek')) return 'deepseek';
  if (s.includes('generativelanguage') || s.includes('gemini')) return 'gemini-api';
  if (s.includes('openai')) return 'openai-api';
  return undefined;
}

/** Keeper's own calls this month (from its call log), as limits. */
export function keeperLimits(rows: { calls: number; input: number; output: number; cost?: number }[], now: number, budget?: number): Limit[] {
  const calls = rows.reduce((n, r) => n + r.calls, 0);
  const tokens = rows.reduce((n, r) => n + r.input + r.output, 0);
  const usd = rows.reduce((n, r) => n + (r.cost ?? 0), 0);
  return [
    monthLimit('month-cost', 'Monthly spend', usd, budget, 'usd', now),
    { key: 'month-tokens', label: 'Tokens this month', used: tokens, unit: 'tokens' },
    { key: 'month-requests', label: 'Calls this month', used: calls, unit: 'requests' },
  ];
}

// ---------------------------------------------------------------- unofficial sources (opt-in)

/** Limits from the Island's usage readers (Copilot's quota, Cursor's usage): one per window, monthly. */
export function fromUsageWindows(ws: { label: string; usedPercent?: number; used?: number; limit?: number; resetsAt?: number }[]): Limit[] {
  return ws.map((w) => ({
    key: w.label.toLowerCase().replace(/ this month$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    label: w.label.replace(/ this month$/, ''),
    usedPercent: w.usedPercent,
    used: w.used,
    limit: w.limit,
    unit: w.used !== undefined ? 'requests' : undefined,
    resetsAt: w.resetsAt,
    windowMs: w.resetsAt ? 30 * D : undefined,
  }));
}

/**
 * Gemini CLI's Code Assist quota (`POST v1internal:retrieveUserQuota`, undocumented):
 * `{ buckets: [{ modelId, tokenType, remainingFraction, remainingAmount, resetTime }] }`.
 */
export function geminiQuota(body: unknown, now: number): Limit[] {
  const buckets = ((body ?? {}) as { buckets?: Record<string, unknown>[] }).buckets ?? [];
  const out: Limit[] = [];
  for (const b of buckets) {
    const frac = num(b.remainingFraction);
    if (frac === undefined) continue;
    const model = String(b.modelId ?? 'model');
    const kind = b.tokenType ? String(b.tokenType).toLowerCase() : 'requests';
    const resetsAt = toMs(b.resetTime, now);
    const left = num(b.remainingAmount);
    out.push({ key: `quota:${model}:${kind}`, label: `${model} ${kind === 'requests' ? 'requests' : kind}`, usedPercent: Math.max(0, Math.min(100, (1 - frac) * 100)), resetsAt, windowMs: D, note: left !== undefined ? `${left} left` : undefined });
  }
  return out;
}
