// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's usage stats server, a Cloudflare Worker with a D1 database.
//
//   POST /v1/ping    one install's report(s), checked strictly against core/telemetry.ts
//   GET  /v1/stats   aggregates only, for the dashboard; needs the STATS_TOKEN bearer secret
//   cron (daily)     keeps a summary of yesterday and deletes raw rows older than 13 months
//
// The client's address is never read, stored or logged: this code never
// touches CF-Connecting-IP, X-Forwarded-For or request.cf, and never logs.
// Cloudflare's own request logs are switched off in wrangler.toml (README).

import { addDays, aggregate, authorized, dailySummary, dayOf, LOOKBACK_DAYS, MAX_BODY_BYTES, parsePing, rateDecision, retentionCutoff, ROW_COLUMNS, type PingRow } from './logic';

// The few D1 types used here (no @cloudflare/workers-types needed).
interface D1Result<T> { results: T[] }
interface D1Prepared {
  bind(...values: unknown[]): D1Prepared;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(sql: string): D1Prepared;
  batch(statements: D1Prepared[]): Promise<unknown[]>;
}
interface Env {
  DB: D1Database;
  /** a long random secret for GET /v1/stats (wrangler secret put STATS_TOKEN) */
  STATS_TOKEN?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
// The dashboard may be opened from a file or another address; the token is a header, never a cookie.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400' };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...CORS } });

/** Reads at most MAX_BODY_BYTES + 1 bytes, so a huge body is refused without being read whole. */
async function readCapped(req: Request): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

async function ping(req: Request, env: Env): Promise<Response> {
  const declared = Number(req.headers.get('content-length'));
  if (declared > MAX_BODY_BYTES) return json(413, { error: 'Too large' });
  const text = await readCapped(req);
  if (text === null) return json(413, { error: 'Too large' });
  const now = Date.now();
  const r = parsePing({ contentType: req.headers.get('content-type'), declaredLength: Number.isFinite(declared) ? declared : null, text, now });
  if (r.status !== 200) return json(r.status, { error: r.error });
  const id = r.rows[0].install_id;
  const prev = await env.DB.prepare('SELECT window_start, count FROM rate WHERE install_id = ?').bind(id).first<{ window_start: number; count: number }>();
  const rate = rateDecision(prev, now);
  await env.DB.prepare('INSERT INTO rate (install_id, window_start, count) VALUES (?, ?, ?) ON CONFLICT(install_id) DO UPDATE SET window_start = excluded.window_start, count = excluded.count').bind(id, rate.window_start, rate.count).run();
  if (!rate.allowed) return json(429, { error: 'Too many requests' });
  // One row per install per day: a later report for the same day replaces the earlier one.
  const cols = ROW_COLUMNS.join(', ');
  const marks = ROW_COLUMNS.map(() => '?').join(', ');
  const upsert = `INSERT OR REPLACE INTO pings (${cols}) VALUES (${marks})`;
  await env.DB.batch(r.rows.map((row) => env.DB.prepare(upsert).bind(...ROW_COLUMNS.map((c) => row[c]))));
  return json(200, { ok: true, stored: r.rows.length });
}

async function rowsSince(env: Env, from: string, to: string): Promise<PingRow[]> {
  return (await env.DB.prepare('SELECT * FROM pings WHERE day >= ? AND day <= ?').bind(from, to).all<PingRow>()).results;
}

async function stats(req: Request, env: Env): Promise<Response> {
  if (!authorized(req.headers.get('authorization'), env.STATS_TOKEN)) return json(401, { error: 'Unauthorized' });
  const url = new URL(req.url);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') ?? '') ? url.searchParams.get('day')! : dayOf(Date.now());
  const s = aggregate(await rowsSince(env, addDays(today, -(LOOKBACK_DAYS - 1)), today), today);
  // Longer history from the daily summaries (kept after raw rows are deleted).
  const history = (await env.DB.prepare('SELECT day, daily, weekly, monthly FROM daily_summary ORDER BY day DESC LIMIT 400').all<{ day: string; daily: number; weekly: number; monthly: number }>()).results.reverse();
  return json(200, { ...s, history });
}

/** The daily job: a summary of yesterday, then old raw rows and stale rate windows go. */
async function daily(env: Env, now: number) {
  const yesterday = addDays(dayOf(now), -1);
  const s = aggregate(await rowsSince(env, addDays(yesterday, -(LOOKBACK_DAYS - 1)), yesterday), yesterday);
  const d = dailySummary(s);
  await env.DB.prepare('INSERT OR REPLACE INTO daily_summary (day, daily, weekly, monthly, data) VALUES (?, ?, ?, ?, ?)').bind(d.day, d.daily, d.weekly, d.monthly, d.data).run();
  await env.DB.prepare('DELETE FROM pings WHERE day < ?').bind(retentionCutoff(now)).run();
  await env.DB.prepare('DELETE FROM rate WHERE window_start < ?').bind(now - 2 * 86_400_000).run();
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (pathname === '/v1/ping') return req.method === 'POST' ? ping(req, env).catch(() => json(500, { error: 'Server error' })) : json(405, { error: 'POST only' });
    if (pathname === '/v1/stats') return req.method === 'GET' ? stats(req, env).catch(() => json(500, { error: 'Server error' })) : json(405, { error: 'GET only' });
    return json(404, { error: 'Not found' });
  },
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(daily(env, Date.now()));
  },
};
