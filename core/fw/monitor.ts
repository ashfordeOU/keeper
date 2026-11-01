// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Watching the network over time: a compact traffic history (a year, kept
// small by thinning older data), search with tokens, spotting unusual
// transfers, and drawing connections on a world map.

import world from './world.json';

// ---------------------------------------------------------------- history

/** One bucket: bytes in and out per app (and in total). */
export interface Bucket { t: number; inB: number; outB: number; apps: Record<string, [number, number]> }

export const TIERS = [
  { name: 'minute', step: 60_000, keep: 24 * 3600_000 },
  { name: 'hour', step: 3600_000, keep: 90 * 86_400_000 },
  { name: 'day', step: 86_400_000, keep: 366 * 86_400_000 },
] as const;
export type TierName = (typeof TIERS)[number]['name'];

export interface History { minute: Bucket[]; hour: Bucket[]; day: Bucket[] }

export const emptyHistory = (): History => ({ minute: [], hour: [], day: [] });

function addTo(list: Bucket[], t: number, app: string, inB: number, outB: number) {
  let b = list[list.length - 1];
  if (!b || b.t !== t) {
    // Out-of-order samples (clock changes) go into the right bucket if it exists.
    const found = list.find((x) => x.t === t);
    if (found) b = found;
    else { b = { t, inB: 0, outB: 0, apps: {} }; list.push(b); list.sort((x, y) => x.t - y.t); }
  }
  b.inB += inB;
  b.outB += outB;
  const a = (b.apps[app] ??= [0, 0]);
  a[0] += inB;
  a[1] += outB;
}

/** Adds bytes seen for one app at time `t` to every tier, and drops what is older than each tier keeps. */
export function record(h: History, t: number, app: string, inB: number, outB: number) {
  if (!inB && !outB) return;
  for (const tier of TIERS) addTo(h[tier.name], Math.floor(t / tier.step) * tier.step, app, inB, outB);
  prune(h, t);
}

export function prune(h: History, now: number) {
  for (const tier of TIERS) {
    const cut = now - tier.keep;
    const list = h[tier.name];
    let i = 0;
    while (i < list.length && list[i].t < cut) i++;
    if (i) list.splice(0, i);
  }
}

/** The best tier for a span: minutes for a day, hours for 90 days, days beyond. */
export function tierFor(spanMs: number): TierName {
  return spanMs <= 24 * 3600_000 ? 'minute' : spanMs <= 90 * 86_400_000 ? 'hour' : 'day';
}

/** Points for a chart over [from, to], with empty buckets filled in, at most `max` points (summed down). */
export function series(h: History, from: number, to: number, opts: { app?: string; max?: number } = {}): { t: number; inB: number; outB: number }[] {
  const tierName = tierFor(to - from);
  const step = TIERS.find((x) => x.name === tierName)!.step;
  const byT = new Map(h[tierName].map((b) => [b.t, b]));
  const pts: { t: number; inB: number; outB: number }[] = [];
  for (let t = Math.floor(from / step) * step; t <= to; t += step) {
    const b = byT.get(t);
    const v = !b ? [0, 0] : opts.app ? b.apps[opts.app] ?? [0, 0] : [b.inB, b.outB];
    pts.push({ t, inB: v[0], outB: v[1] });
  }
  const max = opts.max ?? 400;
  if (pts.length <= max) return pts;
  const k = Math.ceil(pts.length / max);
  const out: typeof pts = [];
  for (let i = 0; i < pts.length; i += k) {
    const s = pts.slice(i, i + k);
    out.push({ t: s[0].t, inB: s.reduce((a, p) => a + p.inB, 0), outB: s.reduce((a, p) => a + p.outB, 0) });
  }
  return out;
}

// ---------------------------------------------------------------- unusual transfers

/** A slowly learned normal for each app (bytes per minute), and how far today strays from it. */
export interface Baseline { mean: number; varc: number; n: number }

export function updateBaseline(b: Baseline | undefined, value: number, alpha = 0.05): Baseline {
  if (!b) return { mean: value, varc: 0, n: 1 };
  const d = value - b.mean;
  const mean = b.mean + alpha * d;
  return { mean, varc: (1 - alpha) * (b.varc + alpha * d * d), n: b.n + 1 };
}

/** Unusual = well above this app's normal (and big enough to matter); needs a few days of learning first. */
export function isUnusual(b: Baseline | undefined, value: number, minBytes = 20 * 1024 * 1024): { unusual: boolean; times?: number } {
  if (!b || b.n < 60 || value < minBytes) return { unusual: false };
  const sd = Math.sqrt(b.varc);
  const unusual = value > b.mean + 4 * sd && value > b.mean * 5;
  return { unusual, times: b.mean > 0 ? Math.round(value / b.mean) : undefined };
}

// ---------------------------------------------------------------- search

export type Token = { key: 'app' | 'host' | 'country' | 'city' | 'port' | 'proto' | 'rule' | 'ip' | 'path' | 'text'; value: string; not?: boolean };

const KEYS = new Set(['app', 'host', 'country', 'city', 'port', 'proto', 'rule', 'ip', 'path']);

/** `app:firefox host:google -country:us 443` → tokens (quotes allowed: app:"Google Chrome"). */
export function parseSearch(q: string): Token[] {
  const out: Token[] = [];
  const re = /(-)?(?:(\w+):)?(?:"([^"]*)"|(\S+))/g;
  for (const m of q.matchAll(re)) {
    const key = (m[2] ?? '').toLowerCase();
    const value = (m[3] ?? m[4] ?? '').toLowerCase();
    if (!value) continue;
    out.push(KEYS.has(key) ? { key: key as Token['key'], value, not: !!m[1] } : { key: 'text', value: m[2] ? `${m[2]}:${value}` : value, not: !!m[1] });
  }
  return out;
}

export interface Searchable { app?: string; path?: string; host?: string; ip?: string; country?: string; city?: string; port?: number; proto?: string; rule?: string }

export function matchesSearch(row: Searchable, tokens: Token[]): boolean {
  for (const t of tokens) {
    const has = (s?: string | number) => s !== undefined && String(s).toLowerCase().includes(t.value);
    let ok: boolean;
    switch (t.key) {
      case 'port': ok = String(row.port ?? '') === t.value; break;
      case 'proto': ok = (row.proto ?? '').toLowerCase() === t.value; break;
      case 'country': ok = (row.country ?? '').toLowerCase() === t.value || has(countryName(row.country)); break;
      case 'text': ok = [row.app, row.path, row.host, row.ip, row.country, countryName(row.country), row.city, row.rule, row.port].some(has); break;
      default: ok = has(row[t.key]);
    }
    if (ok === !!t.not) return false;
  }
  return true;
}

let names: Intl.DisplayNames | undefined;
export function countryName(cc?: string): string | undefined {
  if (!cc) return undefined;
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return names.of(cc.toUpperCase());
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- the map

const W = world as unknown as { shapes: number[][]; centroids: Record<string, [number, number]> };

/** Natural Earth outlines (public domain), a few hundred shapes, rounded to 0.1°. */
export const worldShapes: number[][] = W.shapes;

/** Where to put a dot for a country (centre of its largest land area). */
export function countryPoint(cc?: string): [number, number] | undefined {
  return cc ? W.centroids[cc.toUpperCase()] : undefined;
}

/** Equirectangular projection to a width×height box. */
export function project(lon: number, lat: number, width: number, height: number): [number, number] {
  return [((lon + 180) / 360) * width, ((90 - lat) / 180) * height];
}

/** SVG path data for the world outlines. */
export function worldPath(width: number, height: number): string {
  let d = '';
  for (const s of W.shapes) {
    let crosses = false;
    for (let i = 0; i < s.length; i += 2) {
      const [x, y] = project(s[i], s[i + 1], width, height);
      const jump = i > 0 && Math.abs(s[i] - s[i - 2]) > 180;
      if (jump) crosses = true;
      d += `${!i || jump ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    if (!crosses) d += 'Z';
  }
  return d;
}

/** Points along the shortest path on the globe between two places (for an arc on the map). */
export function greatCircle(a: [number, number], b: [number, number], steps = 32): [number, number][] {
  const rad = Math.PI / 180;
  const [l1, p1] = [a[0] * rad, a[1] * rad];
  const [l2, p2] = [b[0] * rad, b[1] * rad];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-9) return [a, b];
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    out.push([Math.atan2(y, x) / rad, Math.atan2(z, Math.sqrt(x * x + y * y)) / rad]);
  }
  return out;
}

/** An arc as SVG path data, split where it crosses the date line so it does not streak across the map. */
export function arcPath(a: [number, number], b: [number, number], width: number, height: number): string {
  const pts = greatCircle(a, b);
  let d = '';
  let prev: number | undefined;
  for (const [lon, lat] of pts) {
    const [x, y] = project(lon, lat, width, height);
    const jump = prev !== undefined && Math.abs(lon - prev) > 180;
    d += `${!d || jump ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    prev = lon;
  }
  return d;
}
