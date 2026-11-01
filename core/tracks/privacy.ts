// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Privacy zones: circles (home, work and any you add) whose points never
// leave Keeper in an export. Tracks are cut where they enter a zone, so the
// way to your door does not show.

import { metres, type LL } from './geo';
import type { NamedPlace, Point, PrivacyZone, Track } from './types';

/** The zones that apply: the ones you made, plus home and work. */
export function effectiveZones(zones: PrivacyZone[], places: NamedPlace[], minRadiusM = 200): PrivacyZone[] {
  const out = [...zones];
  for (const p of places) {
    if (p.kind === 'other') continue;
    out.push({ id: `place:${p.id}`, name: p.name, lat: p.lat, lon: p.lon, radiusM: Math.max(minRadiusM, p.radiusM) });
  }
  return out;
}

export const inZone = (zones: PrivacyZone[], p: LL) => zones.some((z) => metres(z, p) <= z.radiusM);

export function filterPoints<T extends LL>(points: T[], zones: PrivacyZone[]): T[] {
  return zones.length ? points.filter((p) => !inZone(zones, p)) : points;
}

/**
 * A track with the parts inside zones removed. When a zone sits in the middle
 * the track is split, so no line is drawn across the hidden part.
 */
export function cutTrack(t: Track, zones: PrivacyZone[]): Track[] {
  if (!zones.length) return [t];
  const parts: Point[][] = [];
  let cur: Point[] = [];
  for (const p of t.points) {
    if (inZone(zones, p)) {
      if (cur.length) parts.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length) parts.push(cur);
  const kept = parts.filter((p) => p.length >= 2);
  if (kept.length === 1 && kept[0].length === t.points.length) return [t];
  return kept.map((points, i) => ({ ...t, id: kept.length > 1 ? `${t.id}-${i + 1}` : t.id, points, start: points[0].t, end: points[points.length - 1].t }));
}
