// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Distances, boxes, simplification, Google's encoded polylines, web-mercator
// tile maths and the nearest country from Keeper's offline world outline.

import { distanceKm } from '../geotools';
import type { Point } from './types';

export interface LL { lat: number; lon: number }

/** Great-circle distance in metres. */
export const metres = (a: LL, b: LL): number => distanceKm(a, b) * 1000;

export function pathLength(points: LL[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += metres(points[i - 1], points[i]);
  return d;
}

export function bbox(points: LL[]): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of points) {
    if (p.lon < a) a = p.lon;
    if (p.lat < b) b = p.lat;
    if (p.lon > c) c = p.lon;
    if (p.lat > d) d = p.lat;
  }
  return Number.isFinite(a) ? [a, b, c, d] : [0, 0, 0, 0];
}

export const validLL = (lat: unknown, lon: unknown): boolean =>
  typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

/** Douglas–Peucker in metres (flat approximation, fine for a track's scale). */
export function simplify<T extends LL>(points: T[], toleranceM: number): T[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const kx = 111_320 * Math.cos((points[0].lat * Math.PI) / 180);
  const ky = 110_540;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const ax = points[s].lon * kx, ay = points[s].lat * ky;
    const bx = points[e].lon * kx, by = points[e].lat * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1, bestD = toleranceM;
    for (let i = s + 1; i < e; i++) {
      const px = points[i].lon * kx, py = points[i].lat * ky;
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Google's encoded polyline (Strava's summary_polyline uses it too). */
export function decodePolyline(s: string, precision = 5): [number, number][] {
  const out: [number, number][] = [];
  const f = 10 ** precision;
  let i = 0, lat = 0, lon = 0;
  while (i < s.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do {
        b = s.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const v = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += v;
      else lon += v;
    }
    out.push([lat / f, lon / f]);
  }
  return out;
}

export function encodePolyline(points: [number, number][], precision = 5): string {
  const f = 10 ** precision;
  let plat = 0, plon = 0, s = '';
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    while (x >= 0x20) {
      s += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    s += String.fromCharCode(x + 63);
  };
  for (const [lat, lon] of points) {
    const a = Math.round(lat * f), b = Math.round(lon * f);
    enc(a - plat);
    enc(b - plon);
    plat = a;
    plon = b;
  }
  return s;
}

// ---------------------------------------------------------------- web mercator (map tiles)

export const TILE = 256;

/** World pixel coordinates at a zoom level. */
export function toPixel(lat: number, lon: number, z: number): [number, number] {
  const s = TILE * 2 ** z;
  const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return [((lon + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
}

export function fromPixel(x: number, y: number, z: number): LL {
  const s = TILE * 2 ** z;
  const lon = (x / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / s;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon };
}

/** The zoom that fits a box into a view of w×h pixels. */
export function fitZoom(box: [number, number, number, number], w: number, h: number, max = 17): number {
  for (let z = max; z > 0; z--) {
    const [x1, y1] = toPixel(box[3], box[0], z);
    const [x2, y2] = toPixel(box[1], box[2], z);
    if (Math.abs(x2 - x1) <= w * 0.9 && Math.abs(y2 - y1) <= h * 0.9) return z;
  }
  return 1;
}

/** Fills a tile URL template: {z}/{x}/{y}, {s} for a/b/c subdomains, {r} for retina. */
export function tileUrl(template: string, z: number, x: number, y: number): string {
  const n = 2 ** z;
  const wx = ((x % n) + n) % n;
  return template.replace('{z}', String(z)).replace('{x}', String(wx)).replace('{y}', String(y)).replace('{s}', 'abc'[(wx + y) % 3]).replace('{r}', '');
}

// ---------------------------------------------------------------- grid clustering (many points on a map)

export interface Cluster<T> { lat: number; lon: number; items: T[] }

/** Groups points that would overlap on screen: one marker per cell of `cellPx` at zoom `z`. */
export function cluster<T extends LL>(items: T[], z: number, cellPx = 48): Cluster<T>[] {
  const cells = new Map<string, Cluster<T>>();
  for (const it of items) {
    const [x, y] = toPixel(it.lat, it.lon, z);
    const key = `${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`;
    const c = cells.get(key);
    if (c) {
      c.items.push(it);
      c.lat += (it.lat - c.lat) / c.items.length;
      c.lon += (it.lon - c.lon) / c.items.length;
    } else cells.set(key, { lat: it.lat, lon: it.lon, items: [it] });
  }
  return [...cells.values()];
}

// ---------------------------------------------------------------- colouring a track

export type ColourBy = 'speed' | 'ele' | 'hr' | 'none';

/** A value per segment (between point i and i+1) for colouring, or null where unknown. */
export function segmentValues(points: Point[], by: ColourBy): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (by === 'speed') {
      const dt = (b.t - a.t) / 1000;
      out.push(b.speed ?? (dt > 0 ? metres(a, b) / dt : null));
    } else if (by === 'ele') out.push(b.ele ?? a.ele ?? null);
    else if (by === 'hr') out.push(b.hr ?? a.hr ?? null);
    else out.push(null);
  }
  return out;
}

/** Blue (low) through green and yellow to red (high). */
export function ramp(f: number): string {
  const x = Math.max(0, Math.min(1, f));
  const stops: [number, number, number][] = [[59, 130, 246], [34, 197, 94], [234, 179, 8], [239, 68, 68]];
  const p = x * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(p));
  const t = p - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Splits a track into runs of the same colour bucket, for drawing as a few polylines. */
export function colouredRuns(points: Point[], by: ColourBy, buckets = 8): { color: string; points: Point[] }[] {
  if (points.length < 2 || by === 'none') return points.length ? [{ color: '', points }] : [];
  const vals = segmentValues(points, by);
  const known = vals.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (!known.length) return [{ color: '', points }];
  // 5th to 95th percentile, so one GPS spike does not wash out the colours.
  const lo = known[Math.floor(known.length * 0.05)];
  const hi = known[Math.min(known.length - 1, Math.floor(known.length * 0.95))];
  const out: { color: string; points: Point[] }[] = [];
  let cur: { b: number; points: Point[] } | null = null;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    const b = v === null || hi === lo ? Math.floor(buckets / 2) : Math.round(((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (buckets - 1));
    if (!cur || cur.b !== b) {
      if (cur) out.push({ color: ramp(cur.b / (buckets - 1)), points: cur.points });
      cur = { b, points: [points[i]] };
    }
    cur.points.push(points[i + 1]);
  }
  if (cur) out.push({ color: ramp(cur.b / (buckets - 1)), points: cur.points });
  return out;
}
