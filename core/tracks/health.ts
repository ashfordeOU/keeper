// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Apple Health's export.zip: workouts from export.xml (HKWorkout with its
// statistics and metadata) joined with their route files in workout-routes/.
// The caller unpacks the zip and hands in the two kinds of entries.

import { parseGpx } from './files';
import { finishTrack } from './stats';
import { emptyImport, type ImportResult, type Track } from './types';
import { hashId, parseTime, sportFrom } from './util';
import { decodeEntities } from './xml';

const attrsOf = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const re = /([\w:]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]] = decodeEntities(m[2]);
  return out;
};

const toSeconds = (v: string | undefined, unit: string | undefined) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return unit === 'min' ? n * 60 : unit === 'hr' || unit === 'h' ? n * 3600 : n;
};
const toMetres = (v: string | undefined, unit: string | undefined) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return unit === 'km' ? n * 1000 : unit === 'mi' ? n * 1609.344 : unit === 'ft' ? n * 0.3048 : unit === 'yd' ? n * 0.9144 : n;
};

export interface HealthWorkout {
  type: string;
  start: number;
  end: number;
  durationS?: number;
  distanceM?: number;
  calories?: number;
  avgHr?: number;
  maxHr?: number;
  indoor?: boolean;
  source?: string;
  routes: string[];
  metadata: Record<string, string>;
}

/**
 * Workouts in export.xml. Scans for <Workout …>…</Workout> blocks rather than
 * building the whole tree, because exports often hold millions of health records.
 */
export function readHealthWorkouts(xml: string): HealthWorkout[] {
  const out: HealthWorkout[] = [];
  let i = 0;
  for (;;) {
    const s = xml.indexOf('<Workout ', i);
    if (s < 0) break;
    const tagEnd = xml.indexOf('>', s);
    if (tagEnd < 0) break;
    const selfClosing = xml[tagEnd - 1] === '/';
    const e = selfClosing ? tagEnd + 1 : xml.indexOf('</Workout>', tagEnd);
    const block = xml.slice(s, e < 0 ? xml.length : e);
    i = e < 0 ? xml.length : e + 1;
    const a = attrsOf(xml.slice(s, tagEnd));
    const start = parseTime(a.startDate), end = parseTime(a.endDate);
    if (!Number.isFinite(start)) continue;
    const w: HealthWorkout = { type: a.workoutActivityType ?? 'Other', start, end: Number.isFinite(end) ? end : start, durationS: toSeconds(a.duration, a.durationUnit), distanceM: toMetres(a.totalDistance, a.totalDistanceUnit), calories: Number(a.totalEnergyBurned) || undefined, source: a.sourceName, routes: [], metadata: {} };
    for (const m of block.matchAll(/<MetadataEntry\s([^>]*)\/?>/g)) {
      const ma = attrsOf(m[1]);
      if (ma.key) w.metadata[ma.key] = ma.value ?? '';
    }
    if (w.metadata.HKIndoorWorkout === '1') w.indoor = true;
    for (const m of block.matchAll(/<WorkoutStatistics\s([^>]*)\/?>/g)) {
      const sa = attrsOf(m[1]);
      if (sa.type === 'HKQuantityTypeIdentifierHeartRate') {
        w.avgHr = Number(sa.average) || undefined;
        w.maxHr = Number(sa.maximum) || undefined;
      } else if (sa.type === 'HKQuantityTypeIdentifierActiveEnergyBurned' && !w.calories) w.calories = Number(sa.sum) || undefined;
      else if (/Distance/.test(sa.type ?? '') && !w.distanceM) w.distanceM = toMetres(sa.sum, sa.unit);
    }
    for (const m of block.matchAll(/<FileReference\s+path="([^"]+)"/g)) w.routes.push(decodeEntities(m[1]));
    out.push(w);
  }
  return out;
}

/** Joins workouts with their routes; `files` maps paths inside the zip (any prefix) to GPX text. */
export function parseAppleHealth(exportXml: string, files: Map<string, string>): ImportResult {
  const out = emptyImport('Apple Health');
  const byName = new Map<string, string>();
  for (const [p, txt] of files) byName.set(p.split('/').pop()!, txt);
  const workouts = readHealthWorkouts(exportXml);
  if (!workouts.length && !exportXml.includes('<HealthData')) out.warnings.push('This is not an Apple Health export.');
  for (const w of workouts) {
    const name = w.type.replace(/^HKWorkoutActivityType/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
    const reported = { elapsedS: w.durationS, distanceM: w.distanceM, avgHr: w.avgHr, maxHr: w.maxHr, calories: w.calories };
    let track: Track | undefined;
    for (const r of w.routes) {
      const gpx = byName.get(r.split('/').pop()!);
      if (!gpx) {
        out.warnings.push(`The route ${r} is missing from the export.`);
        continue;
      }
      const parsed = parseGpx(gpx, 'apple-health');
      const pts = parsed.tracks.flatMap((t) => t.points);
      if (pts.length >= 2) {
        track = finishTrack({ id: hashId(`apple-health:${w.start}:${w.type}`), name, sport: sportFrom(w.type), source: 'apple-health', sourceId: `${w.start}:${w.type}`, points: [...(track?.points ?? []), ...pts], reported });
      }
    }
    // Workouts without a route (indoor, pool, gym) still go on the timeline with their numbers.
    track ??= { id: hashId(`apple-health:${w.start}:${w.type}`), name, sport: sportFrom(w.type), source: 'apple-health', sourceId: `${w.start}:${w.type}`, start: w.start, end: w.end, points: [], stats: { distanceM: 0, elapsedS: 0, movingS: 0, ascentM: 0, descentM: 0 }, reported };
    if (w.metadata.HKElevationAscended) track.reported = { ...track.reported, ascentM: (Number(w.metadata.HKElevationAscended.split(' ')[0]) || 0) / (/cm/.test(w.metadata.HKElevationAscended) ? 100 : 1) };
    out.tracks.push(track);
  }
  return out;
}
