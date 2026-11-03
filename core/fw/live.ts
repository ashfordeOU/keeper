// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The network monitor's view of the moment, kept pure so the app, the menu
// bar and the tests agree: connections grouped by app and then by host,
// filters (all, active, blocked, new today), short rates, small sparkline
// buffers, "where your data goes" tallies by day, and the Ask prompt's
// batching and timing (one calm prompt per app, never while you type).

import type { FwAlert, FwConnection } from '../api-fw';
import { portName, serviceFor } from '../net/flows';
import { registrable } from './rules';

// ---------------------------------------------------------------- rates

/** Below this many bytes a second a connection counts as idle. */
export const ACTIVE_BPS = 64;

/** One rate, short: "0 B/s", "512 B/s", "34 KB/s", "3.1 MB/s", "1.2 GB/s". */
export function rateText(bps: number): string {
  const v = Math.max(0, Number.isFinite(bps) ? bps : 0);
  const units: [number, string][] = [[1024 ** 3, 'GB/s'], [1024 ** 2, 'MB/s'], [1024, 'KB/s']];
  for (const [u, name] of units) {
    if (v >= u * 0.95) {
      const x = v / u;
      return `${x >= 9.95 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, '')} ${name}`;
    }
  }
  return `${Math.round(v)} B/s`;
}

/** An amount, short: "0 B", "940 B", "12 KB", "3.4 MB", "1.2 GB". */
export function amountText(b: number): string {
  return rateText(b).replace('/s', '');
}

/** "3 apps online", "1 app online" or "Nothing online right now" (the rates follow it on screen). */
export function onlineLine(apps: number): string {
  if (!apps) return 'Nothing online right now';
  return `${apps} ${apps === 1 ? 'app' : 'apps'} online`;
}

// ---------------------------------------------------------------- sparklines

/** Adds one value to a key's ring of the last `n` values (newest last); keys not seen this round are dropped. */
export function pushSpark(buf: Map<string, number[]>, values: Map<string, number>, n = 30): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [k, v] of values) {
    const prev = buf.get(k) ?? [];
    const next = [...prev, Math.max(0, v)];
    out.set(k, next.length > n ? next.slice(next.length - n) : next);
  }
  return out;
}

// ---------------------------------------------------------------- grouping

export type LiveFilter = 'all' | 'active' | 'blocked' | 'new';

export interface LiveHost {
  /** app|host — one row per destination of an app */
  key: string;
  host?: string;
  ip?: string;
  ports: number[];
  proto: string;
  country?: string;
  service?: string;
  rateIn: number;
  rateOut: number;
  bytesIn: number;
  bytesOut: number;
  conns: number;
  decision: 'allow' | 'deny' | 'ask';
  reason: string;
  ruleId?: string;
  newToday: boolean;
  firstSeen?: number;
}

export interface LiveApp {
  app: string;
  appPath?: string;
  signer?: string;
  rateIn: number;
  rateOut: number;
  bytesIn: number;
  bytesOut: number;
  conns: number;
  hosts: LiveHost[];
  blocked: number;
  newHosts: number;
}

export const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** "New today": first seen today, once Keeper has been watching since before today (else everything would be new). */
export function isNewToday(firstSeen: number | undefined, watchingSince: number | undefined, now: number): boolean {
  if (!firstSeen || !watchingSince) return false;
  const day = startOfDay(now);
  return firstSeen >= day && watchingSince < day;
}

function matchesQuery(q: string, a: { app: string; appPath?: string }, h: { host?: string; ip?: string; ports: number[]; country?: string; service?: string }): boolean {
  if (!q) return true;
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => [a.app, a.appPath, h.host, h.ip, h.country, h.service, ...h.ports.map(String)].some((x) => x?.toLowerCase().includes(w)));
}

/**
 * Live connections grouped by app, then by host (several connections to one
 * host are one row), filtered and sorted by traffic. Apps with nothing left
 * after the filter are dropped.
 */
export function groupLive(rows: (FwConnection & { firstSeen?: number })[], o: { filter?: LiveFilter; query?: string; now?: number; watchingSince?: number } = {}): LiveApp[] {
  const now = o.now ?? Date.now();
  const filter = o.filter ?? 'all';
  const apps = new Map<string, LiveApp>();
  const hosts = new Map<string, LiveHost>();
  for (const r of rows) {
    const appKey = r.appPath ?? r.app;
    let a = apps.get(appKey);
    if (!a) { a = { app: r.app, appPath: r.appPath, signer: r.signer, rateIn: 0, rateOut: 0, bytesIn: 0, bytesOut: 0, conns: 0, hosts: [], blocked: 0, newHosts: 0 }; apps.set(appKey, a); }
    const where = r.host ?? r.ip ?? '?';
    const hk = `${appKey}|${where}`;
    let h = hosts.get(hk);
    if (!h) {
      h = { key: hk, host: r.host, ip: r.ip, ports: [], proto: (r.proto ?? 'tcp').toUpperCase(), country: r.country, service: r.service, rateIn: 0, rateOut: 0, bytesIn: 0, bytesOut: 0, conns: 0, decision: r.decision, reason: r.reason, ruleId: r.ruleId, newToday: isNewToday(r.firstSeen, o.watchingSince, now), firstSeen: r.firstSeen };
      hosts.set(hk, h);
      a.hosts.push(h);
    }
    if (r.port !== undefined && !h.ports.includes(r.port)) h.ports.push(r.port);
    h.rateIn += r.rateIn; h.rateOut += r.rateOut;
    h.bytesIn += r.bytesIn ?? 0; h.bytesOut += r.bytesOut ?? 0;
    h.conns++;
    // A host with one blocked connection shows as blocked: that is what the person needs to see.
    if (r.decision === 'deny' || (r.decision === 'ask' && h.decision === 'allow')) { h.decision = r.decision; h.reason = r.reason; h.ruleId = r.ruleId; }
  }
  const q = (o.query ?? '').trim();
  const out: LiveApp[] = [];
  for (const a of apps.values()) {
    a.hosts = a.hosts.filter((h) => {
      if (filter === 'active' && h.rateIn + h.rateOut < ACTIVE_BPS) return false;
      if (filter === 'blocked' && h.decision !== 'deny') return false;
      if (filter === 'new' && !h.newToday) return false;
      return matchesQuery(q, a, h);
    }).sort((x, y) => y.rateIn + y.rateOut - (x.rateIn + x.rateOut) || y.conns - x.conns || (x.host ?? x.ip ?? '').localeCompare(y.host ?? y.ip ?? ''));
    if (!a.hosts.length) continue;
    for (const h of a.hosts) { h.ports.sort((x, y) => x - y); a.rateIn += h.rateIn; a.rateOut += h.rateOut; a.bytesIn += h.bytesIn; a.bytesOut += h.bytesOut; a.conns += h.conns; if (h.decision === 'deny') a.blocked++; if (h.newToday) a.newHosts++; }
    out.push(a);
  }
  return out.sort((x, y) => y.rateIn + y.rateOut - (x.rateIn + x.rateOut) || y.conns - x.conns || x.app.localeCompare(y.app));
}

/** Counts for the filter row: how many hosts each filter would show. */
export function filterCounts(rows: (FwConnection & { firstSeen?: number })[], o: { now?: number; watchingSince?: number } = {}): Record<LiveFilter, number> {
  const count = (filter: LiveFilter) => groupLive(rows, { ...o, filter }).reduce((n, a) => n + a.hosts.length, 0);
  return { all: count('all'), active: count('active'), blocked: count('blocked'), new: count('new') };
}

/** The busiest apps right now (for the menu bar): internet traffic only, most first. */
export function topApps(apps: LiveApp[], n = 3): LiveApp[] {
  return [...apps].sort((x, y) => y.rateIn + y.rateOut - (x.rateIn + x.rateOut) || y.conns - x.conns).slice(0, n);
}

// ---------------------------------------------------------------- where your data goes

/** Per day (start of day, ms) → app → host → [bytes in, bytes out, connections]. */
export type DestTally = Record<string, Record<string, Record<string, [number, number, number]>>>;

export const TALLY_DAYS = 35;

/** Adds traffic (and new connections) for one app and host on the day of `t`; days older than TALLY_DAYS go. */
export function tally(t: DestTally, at: number, app: string, host: string, inB: number, outB: number, newConns = 0): void {
  if (!inB && !outB && !newConns) return;
  const day = String(startOfDay(at));
  const a = ((t[day] ??= {})[app] ??= {});
  const v = (a[host] ??= [0, 0, 0]);
  v[0] += Math.max(0, inB); v[1] += Math.max(0, outB); v[2] += Math.max(0, newConns);
  const cut = startOfDay(at - TALLY_DAYS * 86_400_000);
  for (const k of Object.keys(t)) if (+k < cut) delete t[k];
}

export interface DestTotal { host: string; inB: number; outB: number; conns: number; apps: string[] }

/** The top destinations between two times, for one app or all. */
export function topDestinations(t: DestTally, from: number, to: number, opts: { app?: string; n?: number } = {}): DestTotal[] {
  const m = new Map<string, DestTotal>();
  for (const [day, apps] of Object.entries(t)) {
    if (+day < startOfDay(from) || +day > to) continue;
    for (const [app, hosts] of Object.entries(apps)) {
      if (opts.app && app !== opts.app) continue;
      for (const [host, [i, o, c]] of Object.entries(hosts)) {
        const d = m.get(host) ?? { host, inB: 0, outB: 0, conns: 0, apps: [] };
        d.inB += i; d.outB += o; d.conns += c;
        if (!d.apps.includes(app)) d.apps.push(app);
        m.set(host, d);
      }
    }
  }
  return [...m.values()].sort((a, b) => b.inB + b.outB - (a.inB + a.outB) || b.conns - a.conns).slice(0, opts.n ?? 10);
}

export interface WhereApp { app: string; inB: number; outB: number; hosts: DestTotal[]; hostCount: number }

/** "Where your data goes": the apps that used the most, each with its top hosts (by registrable domain) and how many places it reached. */
export function whereSummary(t: DestTally, from: number, to: number, opts: { apps?: number; hosts?: number } = {}): { apps: WhereApp[]; totalIn: number; totalOut: number; places: number } {
  const byApp = new Map<string, Map<string, DestTotal>>();
  for (const [day, apps] of Object.entries(t)) {
    if (+day < startOfDay(from) || +day > to) continue;
    for (const [app, hosts] of Object.entries(apps)) {
      const m = byApp.get(app) ?? new Map<string, DestTotal>();
      for (const [host, [i, o, c]] of Object.entries(hosts)) {
        const k = /^[\d.:]+$/.test(host) ? host : registrable(host);
        const d = m.get(k) ?? { host: k, inB: 0, outB: 0, conns: 0, apps: [app] };
        d.inB += i; d.outB += o; d.conns += c;
        m.set(k, d);
      }
      byApp.set(app, m);
    }
  }
  const places = new Set<string>();
  let totalIn = 0;
  let totalOut = 0;
  const list: WhereApp[] = [];
  for (const [app, m] of byApp) {
    const hosts = [...m.values()].sort((a, b) => b.inB + b.outB - (a.inB + a.outB) || b.conns - a.conns);
    const inB = hosts.reduce((n, h) => n + h.inB, 0);
    const outB = hosts.reduce((n, h) => n + h.outB, 0);
    totalIn += inB; totalOut += outB;
    for (const h of hosts) places.add(h.host);
    list.push({ app, inB, outB, hosts: hosts.slice(0, opts.hosts ?? 3), hostCount: hosts.length });
  }
  list.sort((a, b) => b.inB + b.outB - (a.inB + a.outB) || b.hostCount - a.hostCount);
  return { apps: list.slice(0, opts.apps ?? 8), totalIn, totalOut, places: places.size };
}

// ---------------------------------------------------------------- CSV

const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };

/** Traffic over time (and the apps' totals) as CSV for a spreadsheet; cells that look like formulas are made harmless. */
export function historyCsv(points: { t: number; inB: number; outB: number }[], apps: { app: string; inB: number; outB: number }[], dests: DestTotal[] = []): string {
  const lines = ['time,bytes received,bytes sent'];
  for (const p of points) lines.push([new Date(p.t).toISOString(), p.inB, p.outB].map(csvCell).join(','));
  lines.push('', 'app,bytes received,bytes sent');
  for (const a of apps) lines.push([a.app, a.inB, a.outB].map(csvCell).join(','));
  if (dests.length) {
    lines.push('', 'destination,bytes received,bytes sent,connections,apps');
    for (const d of dests) lines.push([d.host, d.inB, d.outB, d.conns, d.apps.join(' ')].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- the Ask prompt

export interface AskBatch {
  /** the app's path (or name): one prompt per app */
  id: string;
  app: string;
  appPath?: string;
  signer?: string;
  alerts: FwAlert[];
  /** the places it wants to reach, most recent first, without repeats */
  hosts: string[];
  first: number;
  last: number;
  attempts: number;
  /** "seen, not held": the system let the first try through */
  monitorOnly: boolean;
  why: string;
}

/** Waiting alerts as one prompt per app (oldest first), each listing the places it wants to reach. */
export function batchAlerts(alerts: FwAlert[]): AskBatch[] {
  const m = new Map<string, AskBatch>();
  for (const a of [...alerts].sort((x, y) => x.t - y.t)) {
    const id = a.conn.app.path ?? a.conn.app.name ?? '?';
    let b = m.get(id);
    if (!b) { b = { id, app: a.conn.app.name ?? id, appPath: a.conn.app.path, signer: a.conn.app.signer, alerts: [], hosts: [], first: a.t, last: a.t, attempts: 0, monitorOnly: true, why: '' }; m.set(id, b); }
    b.alerts.push(a);
    b.signer ??= a.conn.app.signer;
    const where = a.conn.host ?? a.conn.ip;
    b.hosts = [where, ...b.hosts.filter((h) => h !== where)];
    b.last = Math.max(b.last, a.t);
    b.attempts += a.attempts;
    b.monitorOnly &&= a.monitorOnly;
  }
  const out = [...m.values()];
  // The clearest reason any of its places gives (updates, reports, packages…), else what kind of app it is.
  for (const b of out) {
    const named = b.alerts.map((a) => hostReason(a.conn.host, a.conn.port)).find(Boolean);
    const a = b.alerts[b.alerts.length - 1];
    b.why = named ?? whyConnecting({ app: b.app, host: a.conn.host, port: a.conn.port, proto: a.conn.proto, service: a.service, browser: a.conn.app.browser, devtool: a.conn.app.devtool, system: a.conn.app.system });
  }
  return out.sort((x, y) => x.first - y.first);
}

/** One short, plain reason an app may be connecting there (a guess, worded as one). */
export function whyConnecting(c: { app?: string; host?: string; port?: number; proto?: string; service?: string; browser?: boolean; devtool?: boolean; system?: boolean }): string {
  const named = hostReason(c.host, c.port);
  if (named) return named;
  const svc = c.service ?? serviceFor(c.host);
  if (c.browser) return 'A page you opened, or something it loads.';
  if (c.devtool) return 'A developer tool fetching something.';
  if (c.system) return 'A part of the system.';
  if (svc) return `${svc}.`;
  const port = portName(c.port, (c.proto ?? 'tcp').toUpperCase());
  return port ? `Using ${port}.` : 'Keeper can’t tell why; ask the app’s maker if unsure.';
}

/** A reason read from the place itself (its name or port), when there is a clear one. */
function hostReason(host?: string, port?: number): string | undefined {
  const h = (host ?? '').toLowerCase();
  const c = { port };
  if (/(^|\.)(update|updates|swupdate|download|dl|cdn-update)[.-]|autoupdate|sparkle|appcast/.test(h)) return 'Probably checking for updates.';
  if (/(telemetry|analytics|metrics|stats|segment|sentry|crash|events?\.|tracking|collect)/.test(h)) return 'Looks like usage or crash reports.';
  if (/(^|\.)(ocsp|crl|pki)\.|certificate|digicert|letsencrypt|lencr/.test(h)) return 'Checking that a certificate is still valid.';
  if (/(^|\.)(time|ntp)\./.test(h) || c.port === 123) return 'Setting the clock.';
  if (/(push|notify|notifications|courier|mtalk|fcm)\./.test(h) || c.port === 5223) return 'Waiting for notifications.';
  if (/(sync|icloud|dropbox|onedrive|drive|backup)/.test(h)) return 'Probably syncing your files or settings.';
  if (/(registry\.npmjs|pypi|crates\.io|rubygems|proxy\.golang|packagist|nuget)/.test(h)) return 'Downloading code packages.';
  if (/(github|gitlab|bitbucket)/.test(h)) return 'Talking to a code host.';
  if (c.port === 22) return 'A secure shell (remote login).';
  if (c.port === 53 || c.port === 853) return 'Looking up names on the internet.';
  if (c.port === 25 || c.port === 465 || c.port === 587 || c.port === 993 || c.port === 143) return 'Sending or reading mail.';
  return undefined;
}

export interface AskTiming {
  now: number;
  /** when the oldest unanswered prompt arrived */
  pendingSince?: number;
  /** milliseconds since the last key press or click anywhere (the system's idle time) */
  idleMs: number;
  /** the prompt is already on screen */
  showing: boolean;
  /** "Later" was pressed: quiet until then */
  snoozedUntil?: number;
}

/** Gather prompts for a moment, wait while the person types (up to a limit), respect "Later"; never interrupt. */
export const ASK_GATHER_MS = 3000;
export const ASK_TYPING_IDLE_MS = 2000;
export const ASK_TYPING_MAX_MS = 45_000;

export function askTiming(t: AskTiming): { show: boolean; recheckMs?: number } {
  if (t.pendingSince === undefined) return { show: false };
  if (t.showing) return { show: true };
  if (t.snoozedUntil && t.now < t.snoozedUntil) return { show: false, recheckMs: t.snoozedUntil - t.now };
  const age = t.now - t.pendingSince;
  if (age < ASK_GATHER_MS) return { show: false, recheckMs: ASK_GATHER_MS - age };
  // Typing: wait for a pause, but not forever (it opens without taking the keyboard anyway).
  if (t.idleMs < ASK_TYPING_IDLE_MS && age < ASK_TYPING_MAX_MS) return { show: false, recheckMs: 1000 };
  return { show: true };
}
