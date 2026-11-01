// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Names for places: the nearest country from Keeper's offline world outline
// (approximate, good enough for "countries visited"), and reverse geocoding
// through a Nominatim server the person chooses: one request a second at
// most, every answer cached, with a User-Agent that says who is asking, as
// the OpenStreetMap Foundation's usage policy asks.

import world from '../fw/world.json';
import { metres, type LL } from './geo';

const W = world as unknown as { shapes: number[][]; centroids: Record<string, [number, number]> };
// Natural Earth names metropolitan France FX and has a few codes that are not countries.
const FIX: Record<string, string> = { FX: 'FR' };
const CENTRES = Object.entries(W.centroids).filter(([cc]) => /^[A-Z]{2}$/.test(cc)).map(([cc, [lon, lat]]) => ({ cc: FIX[cc] ?? cc, lat, lon }));

function inside(shape: number[], lon: number, lat: number): boolean {
  let c = false;
  for (let i = 0, j = shape.length - 2; i < shape.length; j = i, i += 2) {
    const xi = shape[i], yi = shape[i + 1], xj = shape[j], yj = shape[j + 1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// Each outline gets the country whose centre lies inside it (the centres are of each country's largest land area).
let labelled: { cc: string; shape: number[]; box: [number, number, number, number] }[] | null = null;
function shapes() {
  if (labelled) return labelled;
  labelled = [];
  for (const shape of W.shapes) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (let i = 0; i < shape.length; i += 2) { a = Math.min(a, shape[i]); c = Math.max(c, shape[i]); b = Math.min(b, shape[i + 1]); d = Math.max(d, shape[i + 1]); }
    const hit = CENTRES.find((x) => x.lon >= a && x.lon <= c && x.lat >= b && x.lat <= d && inside(shape, x.lon, x.lat));
    if (hit) labelled.push({ cc: hit.cc, shape, box: [a, b, c, d] });
  }
  return labelled;
}

/**
 * The country a spot is in, offline: inside a country's outline, else the
 * country with the nearest coastline or border point (outlines are rounded to
 * 0.1°, so coasts and borders can be a few kilometres off), else the nearest centre.
 */
export function nearestCountry(p: LL): string | undefined {
  const list = shapes();
  for (const s of list) if (p.lon >= s.box[0] && p.lon <= s.box[2] && p.lat >= s.box[1] && p.lat <= s.box[3] && inside(s.shape, p.lon, p.lat)) return s.cc;
  let best: string | undefined;
  let bestD = Infinity;
  const kx = Math.cos((p.lat * Math.PI) / 180);
  for (const s of list) {
    // Skip outlines whose box is already further than the best so far.
    const dx = Math.max(s.box[0] - p.lon, 0, p.lon - s.box[2]) * kx, dy = Math.max(s.box[1] - p.lat, 0, p.lat - s.box[3]);
    if (dx * dx + dy * dy > bestD) continue;
    for (let i = 0; i < s.shape.length; i += 2) {
      const ex = (s.shape[i] - p.lon) * kx, ey = s.shape[i + 1] - p.lat;
      const d = ex * ex + ey * ey;
      if (d < bestD) { bestD = d; best = s.cc; }
    }
  }
  // About 300 km out at sea: no country.
  if (best && Math.sqrt(bestD) * 111 < 300) return best;
  let near: string | undefined;
  let nearD = Infinity;
  for (const c of CENTRES) {
    const d = metres(p, c);
    if (d < nearD) { nearD = d; near = c.cc; }
  }
  return nearD < 1_500_000 ? near : undefined;
}

let names: Intl.DisplayNames | undefined;
export function countryLabel(cc: string): string {
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return names.of(cc.toUpperCase()) ?? cc;
  } catch {
    return cc;
  }
}

/** Cache key for a spot: about 100 m. */
export const geoKey = (p: LL) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;

export interface GeoName {
  name: string;
  city?: string;
  country?: string;
  /** ISO 3166-1 alpha-2, upper case */
  cc?: string;
}

export const NOMINATIM_DEFAULT = 'https://nominatim.openstreetmap.org';

export function reverseUrl(endpoint: string, p: LL): string {
  const base = endpoint.replace(/\/+$/, '');
  return `${base}/reverse?format=jsonv2&lat=${p.lat.toFixed(5)}&lon=${p.lon.toFixed(5)}&zoom=16&addressdetails=1`;
}

export function searchUrl(endpoint: string, q: string): string {
  return `${endpoint.replace(/\/+$/, '')}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
}

/** A Nominatim reverse answer → a short name. */
export function readNominatim(j: Record<string, unknown>): GeoName | undefined {
  const a = (j.address ?? {}) as Record<string, string>;
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? a.county;
  const first = (j.name as string) || a.amenity || a.shop || a.tourism || a.building || a.road;
  const name = [first, city].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(', ') || (j.display_name as string)?.split(',').slice(0, 2).join(',');
  if (!name) return undefined;
  return { name, city, country: a.country, cc: a.country_code?.toUpperCase() };
}

/** One request at a time, at most one a second (Nominatim's policy). */
export class RateLimiter {
  private last = -Infinity;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private gapMs = 1100, private now = () => Date.now(), private sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {}
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const wait = this.last + this.gapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last = this.now();
      return fn();
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}

/** Distance from a spot to a named one, for "near Tallinn" searches. */
export const within = (a: LL, b: LL, m: number) => metres(a, b) <= m;
