// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The numbers for an activity: distance, moving time, pace, climb, heart rate,
// splits, personal records and comparing two activities.

import { metres } from './geo';
import type { Point, Sport, Track, TrackStats } from './types';

/** Below this a person is standing still (0.5 m/s ≈ 1.8 km/h). */
const MOVING = 0.5;
/** Pauses longer than this are not counted as moving even when the points jump. */
const GAP_S = 120;
/** Elevation changes smaller than this are GPS noise. */
const CLIMB_NOISE_M = 3;

export function computeStats(points: Point[]): TrackStats {
  const s: TrackStats = { distanceM: 0, elapsedS: 0, movingS: 0, ascentM: 0, descentM: 0 };
  if (!points.length) return s;
  s.elapsedS = Math.max(0, (points[points.length - 1].t - points[0].t) / 1000);
  let hrSum = 0, hrN = 0, maxSpeed = 0;
  let ref: number | undefined;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.hr !== undefined && p.hr > 0) {
      hrSum += p.hr;
      hrN++;
      s.maxHr = Math.max(s.maxHr ?? 0, p.hr);
    }
    if (p.ele !== undefined) {
      s.minEle = Math.min(s.minEle ?? Infinity, p.ele);
      s.maxEle = Math.max(s.maxEle ?? -Infinity, p.ele);
      // Hysteresis: only count a climb once it passes the noise threshold.
      if (ref === undefined) ref = p.ele;
      else if (p.ele - ref >= CLIMB_NOISE_M) { s.ascentM += p.ele - ref; ref = p.ele; }
      else if (ref - p.ele >= CLIMB_NOISE_M) { s.descentM += ref - p.ele; ref = p.ele; }
    }
    if (i === 0) continue;
    const a = points[i - 1];
    const d = metres(a, p);
    const dt = (p.t - a.t) / 1000;
    s.distanceM += d;
    if (dt > 0 && dt <= GAP_S) {
      const v = d / dt;
      if (v >= MOVING || (p.speed ?? 0) >= MOVING) s.movingS += dt;
      // Reported speed is steadier than speed between two fixes; spikes over 100 m/s are glitches.
      const sp = p.speed ?? v;
      if (sp < 100) maxSpeed = Math.max(maxSpeed, sp);
    }
  }
  if (hrN) s.avgHr = Math.round(hrSum / hrN);
  if (maxSpeed) s.maxSpeed = maxSpeed;
  s.ascentM = Math.round(s.ascentM);
  s.descentM = Math.round(s.descentM);
  return s;
}

/** Stats for display: the measured ones, with what the service reported filling gaps. */
export function effectiveStats(t: Pick<Track, 'stats' | 'reported'>): TrackStats {
  const r = t.reported ?? {};
  const s = t.stats;
  return {
    distanceM: s.distanceM || r.distanceM || 0,
    elapsedS: s.elapsedS || r.elapsedS || 0,
    movingS: s.movingS || r.movingS || r.elapsedS || 0,
    ascentM: s.ascentM || r.ascentM || 0,
    descentM: s.descentM || r.descentM || 0,
    maxSpeed: s.maxSpeed ?? r.maxSpeed,
    avgHr: s.avgHr ?? r.avgHr,
    maxHr: s.maxHr ?? r.maxHr,
    minEle: s.minEle ?? r.minEle,
    maxEle: s.maxEle ?? r.maxEle,
  };
}

/** Seconds per kilometre while moving. */
export function paceSecPerKm(s: TrackStats): number | undefined {
  return s.distanceM > 0 && s.movingS > 0 ? s.movingS / (s.distanceM / 1000) : undefined;
}

/** Kilometres per hour while moving. */
export function speedKmh(s: TrackStats): number | undefined {
  return s.distanceM > 0 && s.movingS > 0 ? (s.distanceM / s.movingS) * 3.6 : undefined;
}

export function fmtPace(secPerKm: number | undefined): string {
  if (!secPerKm || !Number.isFinite(secPerKm)) return '–';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return s === 60 ? `${m + 1}:00 /km` : `${m}:${String(s).padStart(2, '0')} /km`;
}

export function fmtDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 100_000 ? 1 : 0)} km`;
}

/** Time for each whole kilometre (the last partial one too). */
export function splits(points: Point[], every = 1000): { index: number; distanceM: number; seconds: number }[] {
  const out: { index: number; distanceM: number; seconds: number }[] = [];
  if (points.length < 2) return out;
  let d = 0, mark = every, lastT = points[0].t, lastD = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = metres(points[i - 1], points[i]);
    const prevD = d;
    d += seg;
    while (d >= mark) {
      // Where inside this segment the mark falls.
      const f = seg ? (mark - prevD) / seg : 1;
      const t = points[i - 1].t + f * (points[i].t - points[i - 1].t);
      out.push({ index: out.length + 1, distanceM: every, seconds: (t - lastT) / 1000 });
      lastT = t;
      lastD = mark;
      mark += every;
    }
  }
  if (d - lastD > every * 0.05) out.push({ index: out.length + 1, distanceM: d - lastD, seconds: (points[points.length - 1].t - lastT) / 1000 });
  return out;
}

/** Fastest time over a distance anywhere in the track (two pointers over the points). */
export function bestEffort(points: Point[], distanceM: number): number | undefined {
  if (points.length < 2) return undefined;
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + metres(points[i - 1], points[i]));
  if (cum[cum.length - 1] < distanceM) return undefined;
  let best = Infinity;
  let j = 0;
  for (let i = 1; i < points.length; i++) {
    while (j < i && cum[i] - cum[j + 1] >= distanceM) j++;
    if (cum[i] - cum[j] >= distanceM) {
      // Interpolate the start so the window is exactly the distance.
      const over = cum[i] - cum[j] - distanceM;
      const segLen = cum[j + 1] - cum[j];
      const f = segLen ? over / segLen : 0;
      const startT = points[j].t + f * (points[j + 1].t - points[j].t);
      best = Math.min(best, (points[i].t - startT) / 1000);
    }
  }
  return Number.isFinite(best) ? best : undefined;
}

export interface PersonalRecord {
  label: string;
  sport: Sport;
  value: number;
  unit: 's' | 'm';
  track: string;
  at: number;
}

const EFFORTS: Record<string, [string, number][]> = {
  run: [['1 km', 1000], ['5 km', 5000], ['10 km', 10_000], ['Half marathon', 21_097.5], ['Marathon', 42_195]],
  ride: [['10 km', 10_000], ['40 km', 40_000], ['100 km', 100_000]],
  walk: [['5 km', 5000]],
  hike: [['10 km', 10_000]],
};

/** Best efforts and longest activities, per sport. */
export function personalRecords(tracks: Track[]): PersonalRecord[] {
  const best = new Map<string, PersonalRecord>();
  const put = (r: PersonalRecord, lowerWins: boolean) => {
    const k = `${r.sport}:${r.label}`;
    const have = best.get(k);
    if (!have || (lowerWins ? r.value < have.value : r.value > have.value)) best.set(k, r);
  };
  for (const t of tracks) {
    if (t.planned) continue;
    const st = effectiveStats(t);
    if (st.distanceM > 0) put({ label: 'Longest', sport: t.sport, value: st.distanceM, unit: 'm', track: t.id, at: t.start }, false);
    if (st.ascentM > 0) put({ label: 'Most climbing', sport: t.sport, value: st.ascentM, unit: 'm', track: t.id, at: t.start }, false);
    for (const [label, d] of EFFORTS[t.sport] ?? []) {
      const s = bestEffort(t.points, d);
      if (s) put({ label, sport: t.sport, value: s, unit: 's', track: t.id, at: t.start }, true);
    }
  }
  return [...best.values()].sort((a, b) => a.sport.localeCompare(b.sport) || a.label.localeCompare(b.label));
}

/** Two activities side by side, and the gap between them at each kilometre. */
export function compare(a: Track, b: Track): { a: TrackStats; b: TrackStats; gaps: { km: number; seconds: number }[] } {
  const sa = splits(a.points), sb = splits(b.points);
  const gaps: { km: number; seconds: number }[] = [];
  let ta = 0, tb = 0;
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    ta += sa[i].seconds;
    tb += sb[i].seconds;
    if (sa[i].distanceM === 1000 && sb[i].distanceM === 1000) gaps.push({ km: i + 1, seconds: Math.round(tb - ta) });
  }
  return { a: effectiveStats(a), b: effectiveStats(b), gaps };
}

/** A series for charts, sampled to at most `max` values along the distance. */
export function profile(points: Point[], key: 'ele' | 'hr' | 'speed', max = 200): { d: number; v: number | null }[] {
  if (points.length < 2) return [];
  const out: { d: number; v: number | null }[] = [];
  const step = Math.max(1, Math.floor(points.length / max));
  let d = 0;
  for (let i = 0; i < points.length; i++) {
    if (i) d += metres(points[i - 1], points[i]);
    if (i % step) continue;
    let v: number | null = null;
    if (key === 'speed') {
      const j = Math.max(0, i - step);
      const dt = (points[i].t - points[j].t) / 1000;
      v = points[i].speed ?? (dt > 0 && i > 0 ? (metres(points[j], points[i]) / dt) : null);
      if (v !== null) v *= 3.6;
    } else v = points[i][key] ?? null;
    out.push({ d, v });
  }
  return out;
}

/** Finishes a track: sorts its points, removes repeats, fills the stats and times. */
export function finishTrack(t: Omit<Track, 'stats' | 'start' | 'end'> & Partial<Pick<Track, 'start' | 'end' | 'stats'>>): Track {
  const pts = t.points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)).sort((a, b) => a.t - b.t);
  const clean: Point[] = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (last && last.t === p.t && last.lat === p.lat && last.lon === p.lon) continue;
    clean.push(p);
  }
  const start = t.start ?? clean[0]?.t ?? 0;
  const end = t.end ?? clean[clean.length - 1]?.t ?? start;
  return { ...t, points: clean, start, end, stats: computeStats(clean) };
}
