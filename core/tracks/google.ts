// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Google location history in its three shapes:
//  - the on-device Timeline export (2024 onwards; Android writes an object with
//    semanticSegments/rawSignals, iOS an array of segments with "geo:" points);
//  - the older Takeout "Semantic Location History" (one file per month, timelineObjects);
//  - the older Takeout Records.json (every raw fix, latitudeE7/longitudeE7).

import { pathLength, validLL } from './geo';
import { emptyImport, type HistoryPoint, type ImportResult, type Point, type Segment, type Visit } from './types';
import { hashId, parseTime, sportFrom } from './util';

type J = Record<string, unknown>;
const SRC = 'google' as const;

/** "52.5200°, 13.4050°", "geo:52.52,13.405", {latitudeE7, longitudeE7} or {latLng: "…"}. */
export function readLatLng(v: unknown): { lat: number; lon: number } | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') {
    const m = v.replace(/^geo:/, '').match(/(-?\d+(?:\.\d+)?)°?\s*,\s*(-?\d+(?:\.\d+)?)°?/);
    if (!m) return undefined;
    const lat = Number(m[1]), lon = Number(m[2]);
    return validLL(lat, lon) ? { lat, lon } : undefined;
  }
  if (typeof v === 'object') {
    const o = v as J;
    if (typeof o.latitudeE7 === 'number' && typeof o.longitudeE7 === 'number') {
      const lat = o.latitudeE7 / 1e7;
      // Old exports stored values over 2^31 as unsigned.
      let lon = o.longitudeE7 / 1e7;
      if (lon > 180) lon -= 2 ** 32 / 1e7;
      return validLL(lat, lon) ? { lat, lon } : undefined;
    }
    if (typeof o.latE7 === 'number' && typeof o.lngE7 === 'number') return readLatLng({ latitudeE7: o.latE7, longitudeE7: o.lngE7 });
    if (o.latLng !== undefined) return readLatLng(o.latLng);
    if (o.LatLng !== undefined) return readLatLng(o.LatLng);
    if (o.point !== undefined) return readLatLng(o.point);
    if (o.placeLocation !== undefined) return readLatLng(o.placeLocation);
  }
  return undefined;
}

const MODE: Record<string, string> = { IN_PASSENGER_VEHICLE: 'drive', IN_VEHICLE: 'drive', IN_CAR: 'drive', IN_BUS: 'drive', IN_TRAIN: 'train', IN_SUBWAY: 'train', IN_TRAM: 'train', FLYING: 'flight', WALKING: 'walk', RUNNING: 'run', CYCLING: 'ride', IN_FERRY: 'boat', MOTORCYCLING: 'drive', SKIING: 'ski', SAILING: 'boat' };
const mode = (s: unknown) => sportFrom(MODE[String(s ?? '').toUpperCase()] ?? String(s ?? ''));

/** What kind of Google export this JSON is, or undefined. */
export function googleKind(j: unknown): 'device' | 'semantic' | 'records' | undefined {
  if (Array.isArray(j)) return j.some((x) => x && typeof x === 'object' && ('visit' in x || 'activity' in x || 'timelinePath' in x)) ? 'device' : undefined;
  if (!j || typeof j !== 'object') return undefined;
  const o = j as J;
  if (Array.isArray(o.semanticSegments) || Array.isArray(o.rawSignals)) return 'device';
  if (Array.isArray(o.timelineObjects)) return 'semantic';
  if (Array.isArray(o.locations)) return 'records';
  return undefined;
}

export function parseGoogle(j: unknown): ImportResult {
  const kind = googleKind(j);
  if (kind === 'device') return parseDevice(j as J | J[]);
  if (kind === 'semantic') return parseSemantic(j as J);
  if (kind === 'records') return parseRecords(j as J);
  const out = emptyImport('Google Timeline');
  out.warnings.push('This JSON is not a Google Timeline or Location History export.');
  return out;
}

// ---------------------------------------------------------------- on-device Timeline export

function parseDevice(j: J | J[]): ImportResult {
  const out = emptyImport('Google Timeline (on-device export)');
  const segs = Array.isArray(j) ? j : ((j.semanticSegments ?? []) as J[]);
  for (const s of segs) {
    const start = parseTime(s.startTime as string);
    const end = parseTime(s.endTime as string);
    if (!Number.isFinite(start)) continue;
    const visit = s.visit as J | undefined;
    const activity = s.activity as J | undefined;
    const path = s.timelinePath as J[] | undefined;
    if (visit) {
      const top = (visit.topCandidate ?? {}) as J;
      const ll = readLatLng(top.placeLocation ?? top.placeLocation);
      if (!ll) continue;
      const semantic = typeof top.semanticType === 'string' && !/unknown/i.test(top.semanticType) ? top.semanticType.toUpperCase() : undefined;
      out.visits.push({ id: hashId(`g:v:${start}:${ll.lat}:${ll.lon}`), start, end: Number.isFinite(end) ? end : start, ...ll, placeId: (top.placeId ?? top.placeID) as string | undefined, semantic, source: SRC });
      if (semantic === 'HOME' || semantic === 'INFERRED_HOME') out.labelled.push({ ...ll, label: 'HOME' });
      if (semantic === 'WORK' || semantic === 'INFERRED_WORK') out.labelled.push({ ...ll, label: 'WORK' });
    } else if (activity) {
      const from = readLatLng(activity.start), to = readLatLng(activity.end);
      if (!from || !to) continue;
      const top = (activity.topCandidate ?? {}) as J;
      out.segments.push({ id: hashId(`g:a:${start}:${from.lat}:${from.lon}`), start, end: Number.isFinite(end) ? end : start, from, to, mode: mode(top.type), distanceM: Number(activity.distanceMeters) || undefined, source: SRC });
    } else if (path) {
      for (const p of path) {
        const ll = readLatLng(p.point);
        const t = p.time !== undefined ? parseTime(p.time as string) : start + Number(p.durationMinutesOffsetFromStartTime ?? 0) * 60_000;
        if (ll && Number.isFinite(t)) out.history.push({ t, ...ll, src: SRC });
      }
    }
  }
  if (!Array.isArray(j)) {
    for (const r of (j.rawSignals ?? []) as J[]) {
      const pos = r.position as J | undefined;
      if (!pos) continue;
      const ll = readLatLng(pos.LatLng ?? pos.latLng);
      const t = parseTime((pos.timestamp ?? r.timestamp) as string);
      if (ll && Number.isFinite(t)) out.history.push(clean({ t, ...ll, acc: num(pos.accuracyMeters), ele: num(pos.altitudeMeters), speed: num(pos.speedMetersPerSecond), src: SRC }));
    }
    const prof = j.userLocationProfile as J | undefined;
    for (const fp of (prof?.frequentPlaces ?? []) as J[]) {
      const ll = readLatLng(fp.placeLocation);
      if (ll && typeof fp.label === 'string') out.labelled.push({ ...ll, label: fp.label.toUpperCase() });
    }
  }
  attachPaths(out);
  return out;
}

// ---------------------------------------------------------------- Takeout Semantic Location History

function duration(o: J | undefined): [number, number] {
  const d = (o ?? {}) as J;
  return [parseTime((d.startTimestamp ?? d.startTimestampMs) as string), parseTime((d.endTimestamp ?? d.endTimestampMs) as string)];
}

function parseSemantic(j: J): ImportResult {
  const out = emptyImport('Google Semantic Location History');
  for (const o of (j.timelineObjects ?? []) as J[]) {
    const pv = o.placeVisit as J | undefined;
    const as = o.activitySegment as J | undefined;
    if (pv) {
      const loc = (pv.location ?? {}) as J;
      const ll = readLatLng(loc);
      const [start, end] = duration(pv.duration as J);
      if (!ll || !Number.isFinite(start)) continue;
      const semantic = typeof loc.semanticType === 'string' ? loc.semanticType.replace(/^TYPE_/, '') : undefined;
      out.visits.push({ id: hashId(`g:v:${start}:${ll.lat}:${ll.lon}`), start, end: Number.isFinite(end) ? end : start, ...ll, name: loc.name as string | undefined, address: loc.address as string | undefined, placeId: loc.placeId as string | undefined, semantic, source: SRC });
      if (semantic === 'HOME' || semantic === 'WORK') out.labelled.push({ ...ll, label: semantic });
    } else if (as) {
      const from = readLatLng(as.startLocation), to = readLatLng(as.endLocation);
      const [start, end] = duration(as.duration as J);
      if (!from || !to || !Number.isFinite(start)) continue;
      const path: Point[] = [];
      const raw = ((as.simplifiedRawPath as J | undefined)?.points ?? []) as J[];
      for (const p of raw) {
        const ll = readLatLng(p);
        const t = parseTime((p.timestamp ?? p.timestampMs) as string);
        if (ll && Number.isFinite(t)) path.push({ t, ...ll });
      }
      if (!path.length) {
        const wps = ((as.waypointPath as J | undefined)?.waypoints ?? []) as J[];
        const lls = [from, ...wps.map(readLatLng).filter((x): x is { lat: number; lon: number } => !!x), to];
        // Waypoints carry no times: spread the segment's time along them.
        lls.forEach((ll, i) => path.push({ t: start + ((end - start) * i) / Math.max(1, lls.length - 1), ...ll }));
      }
      out.segments.push({ id: hashId(`g:a:${start}:${from.lat}:${from.lon}`), start, end: Number.isFinite(end) ? end : start, from, to, mode: mode(as.activityType), distanceM: Number(as.distance) || undefined, path, source: SRC });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Takeout Records.json

function parseRecords(j: J): ImportResult {
  const out = emptyImport('Google Location History (Records.json)');
  for (const r of (j.locations ?? []) as J[]) {
    const ll = readLatLng(r);
    const t = parseTime((r.timestamp ?? r.timestampMs) as string);
    if (!ll || !Number.isFinite(t)) continue;
    out.history.push(clean({ t, ...ll, acc: num(r.accuracy), ele: num(r.altitude), speed: num(r.velocity), src: SRC }));
  }
  out.history.sort((a, b) => a.t - b.t);
  return out;
}

// ---------------------------------------------------------------- helpers

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v && Number.isFinite(Number(v)) ? Number(v) : undefined);
const clean = (p: HistoryPoint): HistoryPoint => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as unknown as HistoryPoint;

/** On-device exports keep the path of a move separately: give each activity its points. */
function attachPaths(out: ImportResult) {
  if (!out.segments.length || !out.history.length) return;
  out.history.sort((a, b) => a.t - b.t);
  for (const s of out.segments as Segment[]) {
    const pts = out.history.filter((p) => p.t >= s.start && p.t <= s.end).map(({ t, lat, lon }) => ({ t, lat, lon }));
    s.path = [{ t: s.start, ...s.from }, ...pts, { t: s.end, ...s.to }];
    s.distanceM ??= pathLength(s.path);
  }
}

export type { Visit };
