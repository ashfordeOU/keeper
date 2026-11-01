// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Small shared helpers: stable ids, sport names from every source's own words, times.

import type { Sport } from './types';

/** A short stable id from any text (FNV-1a, two rounds for fewer collisions). */
export function hashId(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

const SPORTS: [RegExp, Sport][] = [
  [/strength|weight|training|yoga|pilates|elliptical|crossfit|hiit|workout|still|unknown/i, 'other'],
  [/fly|flight|plane|aero/i, 'flight'],
  [/run|jog|trail_?run/i, 'run'],
  [/cycl|bik|ride|ebike|velo|mountainbik|gravel|handcycl/i, 'ride'],
  [/hik|mountaineer|trek/i, 'hike'],
  [/walk|on_?foot|stroll|stairs/i, 'walk'],
  [/swim/i, 'swim'],
  [/ski|snowboard|skat/i, 'ski'],
  [/row|kayak|canoe|paddl|sup\b/i, 'row'],
  [/train|rail|subway|tram|metro/i, 'train'],
  [/ferry|boat|sail/i, 'boat'],
  [/car|driv|vehicle|motor|bus|taxi|automotive/i, 'drive'],
];

/** "HKWorkoutActivityTypeRunning", "IN_PASSENGER_VEHICLE", "Ride", "biking", FIT sport names… */
export function sportFrom(s: string | undefined): Sport {
  if (!s) return 'other';
  const t = s.replace(/^HKWorkoutActivityType/, '');
  for (const [re, sp] of SPORTS) if (re.test(t)) return sp;
  return 'other';
}

/** Parses ISO times and the common variants ("2024-05-01 07:00:00 +0200"). NaN when unreadable. */
export function parseTime(s: string | number | undefined): number {
  if (s === undefined || s === null || s === '') return NaN;
  if (typeof s === 'number') return s > 1e14 ? s / 1000 : s < 1e11 ? s * 1000 : s;
  const str = String(s).trim();
  if (/^\d+$/.test(str)) return parseTime(Number(str));
  let t = Date.parse(str);
  if (Number.isFinite(t)) return t;
  // Apple Health: "2024-05-01 07:00:00 +0200"
  const m = str.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*([+-]\d{2}):?(\d{2})$/);
  if (m) t = Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`);
  return t;
}

/** "PT1H2M3.5S" → seconds. */
export function isoDuration(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return undefined;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0));
}

/** Local midnight of the day a time falls on. */
export function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(day: number, n: number): number {
  const d = new Date(day);
  d.setDate(d.getDate() + n);
  return d.getTime();
}
