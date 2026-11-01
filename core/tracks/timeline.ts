// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The timeline: stays found in raw positions (a DBSCAN-like pass in time
// order: points that stay within a small radius for long enough), moves
// between them with the way of travel guessed from speed and distance, the
// places those stays belong to, and one ordered list per day, week, month or year.

import { metres, pathLength, type LL } from './geo';
import type { ActivityEntry, CalendarStop, EventEntry, HistoryPoint, Move, NamedPlace, PhotoEntry, PhotoPoint, Point, Reservation, Segment, Sport, Stay, TimelineEntry, Track, Visit } from './types';
import { addDays, dayStart, hashId } from './util';

export interface StayOptions {
  /** how far someone may wander and still be "there" */
  radiusM: number;
  /** how long they must stay */
  minMs: number;
  /** fixes less precise than this are ignored */
  maxAccM: number;
  /** two stays this close in place and time are one */
  mergeM: number;
  mergeGapMs: number;
}

export const STAY_DEFAULTS: StayOptions = { radiusM: 120, minMs: 10 * 60_000, maxAccM: 250, mergeM: 150, mergeGapMs: 45 * 60_000 };

function centroid(pts: LL[]): LL {
  let lat = 0, lon = 0;
  for (const p of pts) { lat += p.lat; lon += p.lon; }
  return { lat: lat / pts.length, lon: lon / pts.length };
}

/** Stays in time-ordered points. */
export function detectStays(points: Point[], opts: Partial<StayOptions> = {}): Stay[] {
  const o = { ...STAY_DEFAULTS, ...opts };
  const pts = points.filter((p) => p.acc === undefined || p.acc <= o.maxAccM);
  const stays: Stay[] = [];
  let i = 0;
  while (i < pts.length) {
    // Grow the cluster while the next point is near its centre (the centre follows the points).
    let j = i + 1;
    let c: LL = { lat: pts[i].lat, lon: pts[i].lon };
    let n = 1;
    while (j < pts.length && metres(c, pts[j]) <= o.radiusM) {
      n++;
      c = { lat: c.lat + (pts[j].lat - c.lat) / n, lon: c.lon + (pts[j].lon - c.lon) / n };
      j++;
    }
    // One stray fix (a GPS jump) does not end a stay when the next ones come back.
    while (j + 1 < pts.length && metres(c, pts[j]) > o.radiusM && metres(c, pts[j + 1]) <= o.radiusM) {
      j += 2;
      while (j < pts.length && metres(c, pts[j]) <= o.radiusM) j++;
    }
    const start = pts[i].t, end = pts[j - 1].t;
    if (end - start >= o.minMs) {
      const cc = centroid(pts.slice(i, j));
      stays.push({ kind: 'stay', id: hashId(`stay:${start}:${cc.lat.toFixed(4)}:${cc.lon.toFixed(4)}`), start, end, lat: cc.lat, lon: cc.lon, source: 'detected' });
      i = j;
    } else i++;
  }
  return mergeStays(stays, o);
}

export function mergeStays<T extends Stay>(stays: T[], o: Pick<StayOptions, 'mergeM' | 'mergeGapMs'> = STAY_DEFAULTS): T[] {
  const out: T[] = [];
  for (const s of [...stays].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && s.start - last.end <= o.mergeGapMs && metres(last, s) <= o.mergeM) {
      const wl = last.end - last.start + 1, ws = s.end - s.start + 1;
      last.lat = (last.lat * wl + s.lat * ws) / (wl + ws);
      last.lon = (last.lon * wl + s.lon * ws) / (wl + ws);
      last.end = Math.max(last.end, s.end);
      last.name ??= s.name;
    } else out.push({ ...s });
  }
  return out;
}

/** The way of travel from distance and time (no other hint). */
export function inferMode(distanceM: number, ms: number): Sport {
  const v = ms > 0 ? distanceM / (ms / 1000) : 0;
  if (v >= 55 && distanceM > 80_000) return 'flight';
  if (v >= 7) return 'drive';
  if (v >= 2.2) return 'ride';
  return 'walk';
}

/** Moves between consecutive stays, using the raw points in between. */
export function detectMoves(stays: Stay[], points: Point[]): Move[] {
  const out: Move[] = [];
  let k = 0;
  for (let i = 1; i < stays.length; i++) {
    const a = stays[i - 1], b = stays[i];
    if (metres(a, b) < 200) continue;
    while (k < points.length && points[k].t <= a.end) k++;
    const path: Point[] = [{ t: a.end, lat: a.lat, lon: a.lon }];
    let m = k;
    while (m < points.length && points[m].t < b.start) path.push(points[m++]);
    path.push({ t: b.start, lat: b.lat, lon: b.lon });
    const d = pathLength(path);
    out.push({ kind: 'move', id: hashId(`move:${a.end}:${b.start}`), start: a.end, end: b.start, from: { lat: a.lat, lon: a.lon }, to: { lat: b.lat, lon: b.lon }, mode: inferMode(d, b.start - a.end), distanceM: d, path, source: 'detected' });
  }
  return out;
}

// ---------------------------------------------------------------- places

export interface PlaceCluster {
  id: string;
  lat: number;
  lon: number;
  visits: number;
  totalMs: number;
  lastSeen: number;
  name?: string;
}

/** Groups stays at the same spot across days (each stay joins the nearest cluster within `eps`). */
export function clusterPlaces(stays: Stay[], epsM = 150): PlaceCluster[] {
  const cl: PlaceCluster[] = [];
  for (const s of stays) {
    let best: PlaceCluster | undefined;
    let bestD = epsM;
    for (const c of cl) {
      const d = metres(c, s);
      if (d <= bestD) { best = c; bestD = d; }
    }
    const dur = Math.max(1, s.end - s.start);
    if (best) {
      const w = best.totalMs + dur;
      best.lat = (best.lat * best.totalMs + s.lat * dur) / w;
      best.lon = (best.lon * best.totalMs + s.lon * dur) / w;
      best.totalMs = w;
      best.visits++;
      best.lastSeen = Math.max(best.lastSeen, s.end);
      best.name ??= s.name;
    } else cl.push({ id: hashId(`place:${s.lat.toFixed(4)}:${s.lon.toFixed(4)}`), lat: s.lat, lon: s.lon, visits: 1, totalMs: dur, lastSeen: s.end, name: s.name });
  }
  return cl.sort((a, b) => b.totalMs - a.totalMs);
}

/** The named place a spot belongs to, if any. */
export function placeAt(places: NamedPlace[], p: LL): NamedPlace | undefined {
  let best: NamedPlace | undefined;
  let bestD = Infinity;
  for (const pl of places) {
    const d = metres(pl, p);
    if (d <= pl.radiusM && d < bestD) { best = pl; bestD = d; }
  }
  return best;
}

/** Merges several places into one at their centre, keeping the first one's name. */
export function mergePlaces(places: NamedPlace[], name?: string): NamedPlace {
  const c = centroid(places);
  const radius = Math.max(...places.map((p) => p.radiusM + metres(p, c)));
  const kind = places.find((p) => p.kind !== 'other')?.kind ?? 'other';
  return { id: places[0].id, name: name ?? places[0].name, lat: c.lat, lon: c.lon, radiusM: Math.min(2000, Math.round(radius)), kind };
}

// ---------------------------------------------------------------- the whole timeline

export interface TimelineInput {
  history: HistoryPoint[];
  visits: Visit[];
  segments: Segment[];
  tracks: Track[];
  photos: PhotoPoint[];
  places: NamedPlace[];
  events?: CalendarStop[];
  reservations?: Reservation[];
  /** a name for a spot (from the reverse-geocoding cache), when known */
  label?: (p: LL) => string | undefined;
  stay?: Partial<StayOptions>;
}

const overlaps = (s: number, e: number, from: number, to: number) => s < to && e >= from;

/** Everything that happened between two times, in order. */
export function buildTimeline(input: TimelineInput, from: number, to: number): TimelineEntry[] {
  // Raw points a little either side, so a stay across midnight is found whole.
  const margin = 12 * 3600_000;
  const visits = input.visits.filter((v) => overlaps(v.start, v.end, from - margin, to + margin));
  const segs = input.segments.filter((s) => overlaps(s.start, s.end, from - margin, to + margin));
  const covered = [...visits, ...segs].map((x) => [x.start, x.end] as const).sort((a, b) => a[0] - b[0]);
  const isCovered = (t: number) => covered.some(([s, e]) => t >= s && t <= e);
  const raw = input.history.filter((p) => p.t >= from - margin && p.t <= to + margin);
  const free = covered.length ? raw.filter((p) => !isCovered(p.t)) : raw;

  const imported: Stay[] = visits.map((v) => ({ kind: 'stay', id: v.id, start: v.start, end: v.end, lat: v.lat, lon: v.lon, name: v.name, placeId: v.placeId, source: v.source }));
  const detected = detectStays(free, input.stay);
  const stays = mergeStays([...imported, ...detected].sort((a, b) => a.start - b.start), { mergeM: 60, mergeGapMs: 5 * 60_000 });
  for (const s of stays) {
    const pl = placeAt(input.places, s);
    if (pl) { s.place = pl.id; s.name = pl.name; }
    else s.name ??= input.label?.(s);
  }

  const moves: Move[] = segs.map((g) => ({ kind: 'move', id: g.id, start: g.start, end: g.end, from: g.from, to: g.to, mode: g.mode, distanceM: g.distanceM ?? pathLength(g.path ?? [g.from, g.to]), path: g.path ?? [{ t: g.start, ...g.from }, { t: g.end, ...g.to }], source: g.source }));
  // Moves between stays that no imported segment explains.
  for (const m of detectMoves(stays, free)) {
    if (!moves.some((x) => overlaps(x.start, x.end, m.start + 60_000, m.end - 60_000))) moves.push(m);
  }

  const acts: ActivityEntry[] = input.tracks.filter((t) => !t.planned && overlaps(t.start, t.end, from, to)).map((t) => ({ kind: 'activity', id: `act:${t.id}`, start: t.start, end: t.end, track: t.id, name: t.name, sport: t.sport, distanceM: t.stats.distanceM || t.reported?.distanceM || 0 }));
  const photos: PhotoEntry[] = input.photos.filter((p) => p.t >= from && p.t < to).map((p) => ({ kind: 'photo', id: `photo:${p.path}`, start: p.t, end: p.t, lat: p.lat, lon: p.lon, path: p.path }));
  const events: EventEntry[] = [
    ...(input.events ?? []).filter((e) => overlaps(e.start, e.end, from, to)).map((e): EventEntry => ({ kind: 'event', id: `cal:${e.id}`, start: e.start, end: e.end, title: e.title, location: e.location })),
    ...(input.reservations ?? []).filter((r) => r.start !== undefined && overlaps(r.start, r.end ?? r.start, from, to)).map((r): EventEntry => ({ kind: 'event', id: `res:${r.id}`, start: r.start!, end: r.end ?? r.start!, title: r.name, location: r.address ?? (r.to ? `${r.from ?? ''} → ${r.to}` : undefined), reservation: r.kind })),
  ];

  const all: TimelineEntry[] = [
    ...stays.filter((s) => overlaps(s.start, s.end, from, to)),
    ...moves.filter((m) => overlaps(m.start, m.end, from, to)),
    ...acts, ...photos, ...events,
  ];
  return all.sort((a, b) => a.start - b.start || order(a) - order(b));
}

const ORDER: Record<TimelineEntry['kind'], number> = { stay: 0, move: 1, activity: 2, event: 3, photo: 4 };
const order = (e: TimelineEntry) => ORDER[e.kind];

export type Span = 'day' | 'week' | 'month' | 'year';

/** The [from, to) range of a day, week (Monday first), month or year around a time. */
export function spanRange(span: Span, at: number): [number, number] {
  const d = new Date(dayStart(at));
  if (span === 'day') return [d.getTime(), addDays(d.getTime(), 1)];
  if (span === 'week') {
    const back = (d.getDay() + 6) % 7;
    const s = addDays(d.getTime(), -back);
    return [s, addDays(s, 7)];
  }
  if (span === 'month') return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()];
  return [new Date(d.getFullYear(), 0, 1).getTime(), new Date(d.getFullYear() + 1, 0, 1).getTime()];
}

/** Moves the anchor of a span forward or back by one span. */
export function shiftSpan(span: Span, at: number, dir: 1 | -1): number {
  const d = new Date(at);
  if (span === 'day') d.setDate(d.getDate() + dir);
  else if (span === 'week') d.setDate(d.getDate() + 7 * dir);
  else if (span === 'month') d.setMonth(d.getMonth() + dir);
  else d.setFullYear(d.getFullYear() + dir);
  return d.getTime();
}

/** Days in a range with how much happened on each (for month and year views). */
export function daySummaries(entries: TimelineEntry[], from: number, to: number): { day: number; stays: number; moves: number; activities: number; distanceM: number; places: string[] }[] {
  const out = new Map<number, { day: number; stays: number; moves: number; activities: number; distanceM: number; places: string[] }>();
  for (let d = dayStart(from); d < to; d = addDays(d, 1)) out.set(d, { day: d, stays: 0, moves: 0, activities: 0, distanceM: 0, places: [] });
  for (const e of entries) {
    const row = out.get(dayStart(Math.max(e.start, from)));
    if (!row) continue;
    if (e.kind === 'stay') {
      row.stays++;
      if (e.name && !row.places.includes(e.name)) row.places.push(e.name);
    } else if (e.kind === 'move') { row.moves++; row.distanceM += e.distanceM; }
    else if (e.kind === 'activity') { row.activities++; row.distanceM += e.distanceM; }
  }
  return [...out.values()];
}
