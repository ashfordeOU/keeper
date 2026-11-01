// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Everything Places & Tracks keeps, and the views the interface asks for.
// Pure, so the main process, the CLI and the browser demo share it.

import type { ImportRecord, MapTrack, TimelineView, TrackSummary } from './api';
import { metres, simplify, type LL } from './geo';
import { countryLabel, geoKey, nearestCountry, type GeoName } from './places';
import { searchStays, answer, type SearchHit } from './search';
import { effectiveStats, personalRecords } from './stats';
import { buildTimeline, clusterPlaces, daySummaries, detectStays, type TimelineInput } from './timeline';
import { buildTrips, guessHome } from './trips';
import type { CalendarStop, HistoryPoint, ImportResult, LivePosition, NamedPlace, PhotoPoint, PrivacyZone, Reservation, Segment, Stay, Track, Trip, Visit } from './types';
import { hashId } from './util';

export interface TracksDb {
  v: 1;
  tracks: Track[];
  visits: Visit[];
  segments: Segment[];
  history: HistoryPoint[];
  photos: PhotoPoint[];
  reservations: Reservation[];
  places: NamedPlace[];
  zones: PrivacyZone[];
  live: LivePosition[];
  imports: ImportRecord[];
  /** reverse-geocoding answers by geoKey */
  geo: Record<string, GeoName>;
}

export const emptyDb = (): TracksDb => ({ v: 1, tracks: [], visits: [], segments: [], history: [], photos: [], reservations: [], places: [], zones: [], live: [], imports: [], geo: {} });

export function normalizeDb(j: Partial<TracksDb> | undefined): TracksDb {
  const e = emptyDb();
  if (!j || typeof j !== 'object') return e;
  for (const k of Object.keys(e) as (keyof TracksDb)[]) if (k !== 'v' && j[k] !== undefined) (e as unknown as Record<string, unknown>)[k] = j[k];
  return e;
}

/** Adds what an import produced; items already there (same id) are skipped. */
export function addImport(db: TracksDb, r: ImportResult, file: string, now = Date.now()): { record: ImportRecord; skipped: number } {
  let skipped = 0;
  const add = <T extends { id: string }>(list: T[], items: T[]) => {
    const have = new Set(list.map((x) => x.id));
    let n = 0;
    for (const it of items) {
      if (have.has(it.id)) { skipped++; continue; }
      have.add(it.id);
      list.push(it);
      n++;
    }
    return n;
  };
  const tracks = add(db.tracks, r.tracks);
  const visits = add(db.visits, r.visits);
  add(db.segments, r.segments);
  const reservations = add(db.reservations, r.reservations);
  // Raw points: skip ones already there (same source and second).
  const seen = new Set(db.history.map((p) => `${p.src}:${Math.round(p.t / 1000)}`));
  let points = 0;
  for (const p of r.history) {
    const k = `${p.src}:${Math.round(p.t / 1000)}`;
    if (seen.has(k)) { skipped++; continue; }
    seen.add(k);
    db.history.push(p);
    points++;
  }
  if (points) db.history.sort((a, b) => a.t - b.t);
  const havePhotos = new Set(db.photos.map((p) => p.path));
  let photos = 0;
  for (const p of r.photos) if (!havePhotos.has(p.path)) { db.photos.push(p); havePhotos.add(p.path); photos++; } else skipped++;
  // Home and work as the source marked them, when you have not named them yourself.
  for (const l of r.labelled) {
    const kind = l.label === 'HOME' ? 'home' : l.label === 'WORK' ? 'work' : undefined;
    if (!kind || db.places.some((p) => p.kind === kind)) continue;
    db.places.push({ id: hashId(`place:${kind}:${l.lat}:${l.lon}`), name: kind === 'home' ? 'Home' : 'Work', lat: l.lat, lon: l.lon, radiusM: 150, kind });
  }
  const record: ImportRecord = { id: hashId(`import:${file}:${now}`), at: now, file, format: r.format, tracks, visits, points, photos, reservations, warnings: r.warnings.slice(0, 10) };
  db.imports.unshift(record);
  db.imports.length = Math.min(db.imports.length, 200);
  return { record, skipped };
}

/** Raw points that are yours: imported history plus live sources you marked as you. */
export function ownHistory(db: TracksDb, self: string[]): HistoryPoint[] {
  if (!self.length) return db.history.filter((p) => !p.src.includes(':'));
  const mine = new Set(self);
  return db.history.filter((p) => !p.src.includes(':') || mine.has(p.src));
}

export function labeler(db: TracksDb): (p: LL) => string | undefined {
  return (p) => db.geo[geoKey(p)]?.name;
}

export function countryOf(db: TracksDb): (p: LL) => string | undefined {
  return (p) => db.geo[geoKey(p)]?.cc ?? nearestCountry(p);
}

export function timelineInput(db: TracksDb, self: string[], events: CalendarStop[] = []): TimelineInput {
  return { history: ownHistory(db, self), visits: db.visits, segments: db.segments, tracks: db.tracks, photos: db.photos, places: db.places, reservations: db.reservations, events, label: labeler(db) };
}

const lineOf = (id: string, name: string, sport: MapTrack['sport'], pts: { t: number; lat: number; lon: number }[]): MapTrack => ({ id, name, sport, points: simplify(pts, pts.length > 2000 ? 15 : 4) });

export function timelineView(db: TracksDb, from: number, to: number, self: string[], events: CalendarStop[] = []): TimelineView {
  const entries = buildTimeline(timelineInput(db, self, events), from, to);
  const lines: MapTrack[] = [];
  for (const e of entries) {
    if (e.kind === 'move' && e.path.length >= 2) lines.push(lineOf(e.id, e.mode, e.mode, e.path));
    if (e.kind === 'activity') {
      const t = db.tracks.find((x) => x.id === e.track);
      if (t && t.points.length >= 2) lines.push({ ...lineOf(t.id, t.name, t.sport, t.points), points: simplify(t.points, 3) });
    }
  }
  return { entries, lines, days: daySummaries(entries, from, to) };
}

/** Every stay ever, for trips, places and search. */
export function allStays(db: TracksDb, self: string[]): Stay[] {
  const range = dataRange(db, self);
  if (!range) return [];
  return buildTimeline(timelineInput(db, self), range[0], range[1] + 1).filter((e): e is Stay => e.kind === 'stay');
}

/** First and last moment of your own data (live trackers of other people do not count). */
export function dataRange(db: TracksDb, self: string[] = []): [number, number] | undefined {
  let a = Infinity, b = -Infinity;
  const mine = new Set(self);
  for (const p of db.history) { if (p.src.includes(':') && !mine.has(p.src)) continue; if (p.t < a) a = p.t; if (p.t > b) b = p.t; }
  for (const x of [...db.visits, ...db.tracks.filter((t) => !t.planned), ...db.segments]) { a = Math.min(a, x.start); b = Math.max(b, x.end); }
  return Number.isFinite(a) ? [a, b] : undefined;
}

export function tripsOf(db: TracksDb, self: string[], awayKm = 50, events: CalendarStop[] = []): Trip[] {
  const range = dataRange(db, self);
  if (!range) return [];
  const entries = buildTimeline(timelineInput(db, self, events), range[0], range[1] + 1);
  const stays = entries.filter((e): e is Stay => e.kind === 'stay');
  return buildTrips(entries, guessHome(db.places, stays), { awayM: awayKm * 1000, minMs: 18 * 3600_000, country: countryOf(db), countryName: countryLabel, city: (p) => db.geo[geoKey(p)]?.city }).sort((a, b) => b.start - a.start);
}

export function summaries(db: TracksDb): TrackSummary[] {
  return db.tracks.map((t) => {
    const step = Math.max(1, Math.floor(t.points.length / 40));
    return { id: t.id, name: t.name, sport: t.sport, source: t.source, start: t.start, end: t.end, stats: effectiveStats(t), planned: t.planned, preview: t.points.filter((_, i) => i % step === 0).map((p) => [p.lat, p.lon] as [number, number]) };
  }).sort((a, b) => b.start - a.start);
}

/** Every activity point, thinned, for the heatmap. */
export function heatmapOf(db: TracksDb, max = 20_000): [number, number][] {
  const all: [number, number][] = [];
  for (const t of db.tracks) if (!t.planned) for (const p of simplify(t.points, 8)) all.push([p.lat, p.lon]);
  if (all.length <= max) return all;
  const step = all.length / max;
  return Array.from({ length: max }, (_, i) => all[Math.floor(i * step)]);
}

export const recordsOf = (db: TracksDb) => personalRecords(db.tracks);

export function frequentPlaces(db: TracksDb, self: string[]) {
  return clusterPlaces(allStays(db, self)).slice(0, 50);
}

export function searchDb(db: TracksDb, self: string[], q: string, near?: LL): { answer: string; hits: SearchHit[] } {
  const stays = allStays(db, self);
  // Country names match too ("when was I last in Finland").
  const cc = countryOf(db);
  const named = stays.map((s) => {
    const c = cc(s);
    return c ? { ...s, name: [s.name, countryLabel(c)].filter(Boolean).join(', ') } : s;
  });
  const hits = searchStays(named, q, near).slice(0, 100);
  return { answer: answer(q, hits), hits };
}

/** Live positions also become history (for the timeline of things marked as you, and trails). */
export function addLive(db: TracksDb, p: LivePosition, maxPerSource = 50_000): boolean {
  const i = db.live.findIndex((x) => x.id === p.id);
  const prev = i >= 0 ? db.live[i] : undefined;
  if (prev && prev.t > p.t) return false;
  if (i >= 0) db.live[i] = { ...prev, ...p, name: prev?.name && prev.name !== prev.id ? prev.name : p.name };
  else db.live.push(p);
  // Keep a trail, but not a new point for every report while standing still.
  let last: HistoryPoint | undefined;
  for (let k = db.history.length - 1; k >= 0; k--) if (db.history[k].src === p.id) { last = db.history[k]; break; }
  if (!last || metres(last, p) > 25 || p.t - last.t > 15 * 60_000) {
    db.history.push({ t: p.t, lat: p.lat, lon: p.lon, ...(p.acc !== undefined ? { acc: p.acc } : {}), ...(p.speed !== undefined ? { speed: p.speed } : {}), src: p.id });
    if (last && last.t > p.t) db.history.sort((a, b) => a.t - b.t);
    const mine = db.history.filter((h) => h.src === p.id);
    if (mine.length > maxPerSource) {
      const drop = new Set(mine.slice(0, mine.length - maxPerSource));
      db.history = db.history.filter((h) => !drop.has(h));
    }
  }
  return true;
}

export { detectStays };

export interface OwnPosition { lat: number; lon: number; acc?: number; t: number; battery?: number }

/**
 * Where this device is, for paired devices that ask over Keeper Link: the newest of
 * the companion phone and the live sources marked as you (last 30 minutes), else Home.
 */
export function ownPositionOf(db: TracksDb, self: string[], now = Date.now()): OwnPosition | null {
  const mine = db.live.filter((p) => (p.id.startsWith('phone:') || self.includes(p.id)) && now - p.t < 30 * 60_000 && p.t <= now + 60_000).sort((a, b) => b.t - a.t)[0];
  if (mine) return { lat: mine.lat, lon: mine.lon, ...(mine.acc !== undefined ? { acc: mine.acc } : {}), t: mine.t, ...(mine.battery !== undefined ? { battery: mine.battery } : {}) };
  const home = db.places.find((p) => p.kind === 'home');
  return home ? { lat: home.lat, lon: home.lon, acc: home.radiusM, t: now } : null;
}

/** A paired device's position (Keeper Link) as a live position. */
export function fromLinkPosition(d: { device: string; name: string; lat: number; lon: number; acc?: number; t: number; battery?: number }): LivePosition {
  return { id: `link:${d.device}`, name: d.name, kind: 'device', source: 'link', t: d.t, lat: d.lat, lon: d.lon, ...(d.acc !== undefined ? { acc: d.acc } : {}), ...(d.battery !== undefined ? { battery: d.battery } : {}) };
}
