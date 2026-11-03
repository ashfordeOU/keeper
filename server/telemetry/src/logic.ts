// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's usage stats server: the parts that need no Cloudflare runtime, so
// they can be tested with plain functions (test/telemetry-server.test.ts).
// The payload schema is the app's own, imported from core/telemetry.ts: the
// server accepts exactly what the app may send, nothing more.

import { MAX_BODY_BYTES, MAX_QUEUE_DAYS, validateBody, type UsagePayload } from '../../../core/telemetry';
import { CRASH_MAX_BODY, MAX_AGE_DAYS, validateCrashBody, type CrashReport } from '../../../core/crash-report';

export { MAX_BODY_BYTES };

/** Requests per install ID per hour (a normal install sends one a day). */
export const RATE_LIMIT = 6;
export const RATE_WINDOW_MS = 3_600_000;
/** Raw rows are kept this many months; daily aggregates are kept for good. */
export const RETENTION_MONTHS = 13;
/** Days the dashboard's breakdowns look back over. */
export const LOOKBACK_DAYS = 30;

const DAY_MS = 86_400_000;
export const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => dayOf(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);

/** One stored row: one install, one day. No address, no headers, nothing but the payload's own fields. */
export interface PingRow {
  install_id: string;
  day: string;
  received_at: number;
  version: string;
  channel: string;
  official: number;
  via: string;
  os: string;
  os_version: string;
  arch: string;
  cpu_vendor: string;
  cpu: string;
  cores: number;
  ram_gb: number;
  gpu: string;
  form: string;
  displays: number;
  notch: number;
  lang: string;
  region: string;
  active: number;
  days7: number;
  /** JSON array of feature IDs */
  features: string;
  /** JSON object page → bucket */
  pages: string;
  ai_providers: number;
  devices: number;
  crashes: number;
  restarts: number;
  memory: string;
  cpu_use: string;
  startup: string;
}

export const ROW_COLUMNS: (keyof PingRow)[] = [
  'install_id', 'day', 'received_at', 'version', 'channel', 'official', 'via', 'os', 'os_version', 'arch', 'cpu_vendor', 'cpu', 'cores', 'ram_gb', 'gpu', 'form',
  'displays', 'notch', 'lang', 'region', 'active', 'days7', 'features', 'pages', 'ai_providers', 'devices', 'crashes', 'restarts', 'memory', 'cpu_use', 'startup',
];

export function rowOf(p: UsagePayload, receivedAt: number): PingRow {
  return {
    install_id: p.id, day: p.day, received_at: receivedAt,
    version: p.build.version, channel: p.build.channel, official: p.build.official ? 1 : 0, via: p.build.via,
    os: p.system.os, os_version: p.system.osVersion, arch: p.system.arch, cpu_vendor: p.system.cpuVendor, cpu: p.system.cpu, cores: p.system.cores,
    ram_gb: p.system.ramGB, gpu: p.system.gpu, form: p.system.form, displays: p.system.displays, notch: p.system.notch ? 1 : 0, lang: p.system.lang, region: p.system.region,
    active: p.usage.active ? 1 : 0, days7: p.usage.days7, features: JSON.stringify(p.usage.features), pages: JSON.stringify(p.usage.pages),
    ai_providers: p.usage.aiProviders, devices: p.usage.devices,
    crashes: p.health.crashes, restarts: p.health.restarts, memory: p.health.memory, cpu_use: p.health.cpu, startup: p.health.startup,
  };
}

// ---------------------------------------------------------------- POST /v1/ping

export type PingResult = { status: 200; rows: PingRow[] } | { status: 400 | 413 | 415; error: string };

/**
 * Checks one request body. `contentType` and `declaredLength` come from the
 * headers; `text` is the body as read (the caller stops reading past the limit).
 */
export function parsePing(o: { contentType: string | null; declaredLength: number | null; text: string; now: number }): PingResult {
  if (!/^application\/json\b/i.test(o.contentType ?? '')) return { status: 415, error: 'JSON only' };
  if ((o.declaredLength ?? 0) > MAX_BODY_BYTES || new TextEncoder().encode(o.text).length > MAX_BODY_BYTES) return { status: 413, error: 'Too large' };
  let body: unknown;
  try { body = JSON.parse(o.text); } catch { return { status: 400, error: 'Not JSON' }; }
  const v = validateBody(body);
  if (!v.ok) return { status: 400, error: v.errors.slice(0, 5).join('; ') };
  // Days far in the future or older than the client's own queue are refused (a wrong clock, or a replay).
  const today = dayOf(o.now);
  const bad = v.pings.find((p) => p.day > addDays(today, 1) || p.day < addDays(today, -MAX_QUEUE_DAYS));
  if (bad) return { status: 400, error: `day ${bad.day} out of range` };
  return { status: 200, rows: v.pings.map((p) => rowOf(p, o.now)) };
}

// ---------------------------------------------------------------- POST /v1/crash

/** Crash reports are kept 90 days, then deleted by the daily job. */
export const CRASH_RETENTION_DAYS = 90;
/** Crash requests per minute for the whole service (there is no install ID to count by). */
export const CRASH_RATE_PER_MINUTE = 600;

/** One stored crash report: no install ID, no address, nothing but the report's own fields. */
export interface CrashRow {
  received_day: string;
  version: string;
  channel: string;
  os: string;
  os_version: string;
  arch: string;
  process: string;
  kind: string;
  name: string;
  /** JSON array of frames */
  stack: string;
  /** the same problem across reports (version, process, kind, name, first five frames) */
  signature: string;
  count: number;
  first_day: string;
  last_day: string;
}

export const CRASH_COLUMNS: (keyof CrashRow)[] = ['received_day', 'version', 'channel', 'os', 'os_version', 'arch', 'process', 'kind', 'name', 'stack', 'signature', 'count', 'first_day', 'last_day'];

async function sha(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function crashRowOf(r: CrashReport, now: number): Promise<CrashRow> {
  return {
    received_day: dayOf(now), version: r.version, channel: r.channel, os: r.os, os_version: r.osVersion, arch: r.arch, process: r.process, kind: r.kind, name: r.name,
    stack: JSON.stringify(r.stack), signature: await sha(`${r.version}|${r.process}|${r.kind}|${r.name}|${r.stack.slice(0, 5).join('|')}`), count: r.count, first_day: r.first, last_day: r.last,
  };
}

export type CrashResult = { status: 200; rows: CrashRow[] } | { status: 400 | 413 | 415; error: string };

/** Checks one crash request body against the app's own schema (core/crash-report.ts). */
export async function parseCrash(o: { contentType: string | null; declaredLength: number | null; text: string; now: number }): Promise<CrashResult> {
  if (!/^application\/json\b/i.test(o.contentType ?? '')) return { status: 415, error: 'JSON only' };
  if ((o.declaredLength ?? 0) > CRASH_MAX_BODY || new TextEncoder().encode(o.text).length > CRASH_MAX_BODY) return { status: 413, error: 'Too large' };
  let body: unknown;
  try { body = JSON.parse(o.text); } catch { return { status: 400, error: 'Not JSON' }; }
  const v = validateCrashBody(body);
  if (!v.ok) return { status: 400, error: v.error };
  const today = dayOf(o.now);
  const bad = v.body.reports.find((r) => r.last > addDays(today, 1) || r.first < addDays(today, -(MAX_AGE_DAYS + 1)));
  if (bad) return { status: 400, error: `day ${bad.last} out of range` };
  return { status: 200, rows: await Promise.all(v.body.reports.map((r) => crashRowOf(r, o.now))) };
}

/** The oldest received day whose crash reports are kept. */
export function crashCutoff(now: number, days = CRASH_RETENTION_DAYS): string {
  return dayOf(now - days * DAY_MS);
}

/** A fixed window per install ID. Returns whether this request may go on, and the window to store. */
export function rateDecision(prev: { window_start: number; count: number } | null, now: number, limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS): { allowed: boolean; window_start: number; count: number } {
  if (!prev || now - prev.window_start >= windowMs) return { allowed: true, window_start: now, count: 1 };
  return { allowed: prev.count < limit, window_start: prev.window_start, count: prev.count + 1 };
}

/** The oldest day whose raw rows are kept. */
export function retentionCutoff(now: number, months = RETENTION_MONTHS): string {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return dayOf(d.getTime());
}

/** Bearer token check in constant time. */
export function authorized(header: string | null, token: string | undefined): boolean {
  if (!token || token.length < 16 || !header) return false;
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const a = new TextEncoder().encode(m[1].trim());
  const b = new TextEncoder().encode(token);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// ---------------------------------------------------------------- GET /v1/stats

export interface Share { key: string; count: number; pct: number }

export interface Stats {
  day: string;
  lookbackDays: number;
  active: { daily: number; weekly: number; monthly: number };
  /** installs per day, oldest first */
  series: { day: string; installs: number }[];
  /** breakdowns over each install's newest row in the lookback */
  by: Record<'version' | 'channel' | 'official' | 'via' | 'os' | 'osVersion' | 'arch' | 'cpuVendor' | 'machine' | 'cores' | 'ram' | 'gpu' | 'form' | 'displays' | 'notch' | 'region' | 'lang' | 'aiProviders' | 'devices' | 'memory' | 'cpu' | 'startup', Share[]>;
  /** percent of installs with each feature on */
  features: Share[];
  /** percent of installs that opened each page, with a rough count of opens */
  pages: (Share & { opens: number })[];
  health: {
    /** install-days with at least one crash, percent */
    crashDaysPct: number;
    /** crashes per 100 install-days */
    crashesPer100: number;
    restartsPer100: number;
    installDays: number;
  };
  builds: { official: number; unofficial: number };
}

/** Rough middle of each count range, for "opens" (a range is all that is ever sent). */
const MID: Record<string, number> = { '1-4': 2.5, '5-19': 12, '20-99': 60, '100+': 150 };

function shares(values: string[], total: number): Share[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([key, count]) => ({ key, count, pct: total ? Math.round((count / total) * 1000) / 10 : 0 })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

const safeJson = <T>(s: string, d: T): T => { try { return JSON.parse(s) as T; } catch { return d; } };

/** Aggregates from raw rows (the lookback window). Only counts and percentages ever leave the server. */
export function aggregate(rows: PingRow[], today: string, lookback = LOOKBACK_DAYS): Stats {
  const from = addDays(today, -(lookback - 1));
  const inWindow = rows.filter((r) => r.day >= from && r.day <= today);
  const distinct = (since: string) => new Set(inWindow.filter((r) => r.day >= since && r.active).map((r) => r.install_id)).size;
  const latest = new Map<string, PingRow>();
  for (const r of inWindow) { const have = latest.get(r.install_id); if (!have || have.day < r.day) latest.set(r.install_id, r); }
  const L = [...latest.values()];
  const n = L.length;
  const by = (f: (r: PingRow) => string | number) => shares(L.map((r) => String(f(r))), n);
  const series: Stats['series'] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) series.push({ day: d, installs: new Set(inWindow.filter((r) => r.day === d && r.active).map((r) => r.install_id)).size });
  // Features: from each install's newest row. Pages: any day in the window.
  const features = shares(L.flatMap((r) => safeJson<string[]>(r.features, [])), n);
  const pageInstalls = new Map<string, Set<string>>();
  const pageOpens = new Map<string, number>();
  for (const r of inWindow) for (const [k, b] of Object.entries(safeJson<Record<string, string>>(r.pages, {}))) {
    if (!pageInstalls.has(k)) pageInstalls.set(k, new Set());
    pageInstalls.get(k)!.add(r.install_id);
    pageOpens.set(k, (pageOpens.get(k) ?? 0) + (MID[b] ?? 0));
  }
  const pages = [...pageInstalls].map(([key, s]) => ({ key, count: s.size, pct: n ? Math.round((s.size / n) * 1000) / 10 : 0, opens: Math.round(pageOpens.get(key) ?? 0) })).sort((a, b) => b.count - a.count || b.opens - a.opens);
  const days = inWindow.length;
  const crashDays = inWindow.filter((r) => r.crashes > 0).length;
  const sum = (f: (r: PingRow) => number) => inWindow.reduce((s, r) => s + f(r), 0);
  const per100 = (x: number) => (days ? Math.round((x / days) * 1000) / 10 : 0);
  return {
    day: today,
    lookbackDays: lookback,
    active: { daily: distinct(today), weekly: distinct(addDays(today, -6)), monthly: distinct(from) },
    series,
    by: {
      version: by((r) => r.version), channel: by((r) => r.channel), official: by((r) => (r.official ? 'official' : 'unofficial')), via: by((r) => r.via),
      os: by((r) => r.os), osVersion: by((r) => `${r.os} ${r.os_version}`), arch: by((r) => r.arch), cpuVendor: by((r) => r.cpu_vendor), machine: by((r) => r.cpu),
      cores: by((r) => r.cores), ram: by((r) => `${r.ram_gb}${r.ram_gb >= 64 ? '+' : ''} GB`), gpu: by((r) => r.gpu), form: by((r) => r.form), displays: by((r) => r.displays),
      notch: by((r) => (r.notch ? 'notch' : 'no notch')), region: by((r) => r.region), lang: by((r) => r.lang),
      aiProviders: by((r) => r.ai_providers), devices: by((r) => r.devices), memory: by((r) => r.memory), cpu: by((r) => r.cpu_use), startup: by((r) => r.startup),
    },
    features,
    pages,
    health: { crashDaysPct: days ? Math.round((crashDays / days) * 1000) / 10 : 0, crashesPer100: per100(sum((r) => r.crashes)), restartsPer100: per100(sum((r) => r.restarts)), installDays: days },
    builds: { official: L.filter((r) => r.official).length, unofficial: L.filter((r) => !r.official).length },
  };
}

/** What the daily job keeps for good once raw rows are gone: counts only, no install IDs. */
export function dailySummary(stats: Stats): { day: string; daily: number; weekly: number; monthly: number; data: string } {
  const { series: _series, ...rest } = stats;
  return { day: stats.day, daily: stats.active.daily, weekly: stats.active.weekly, monthly: stats.active.monthly, data: JSON.stringify(rest) };
}
