// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Trips, built from the timeline by themselves: a run of stays far from home
// that lasts at least a night becomes a trip, with a day-by-day itinerary,
// the distance travelled, flights and drives, photos and countries visited.

import { bbox, metres, type LL } from './geo';
import { clusterPlaces } from './timeline';
import type { Move, NamedPlace, Stay, TimelineEntry, Trip, TripDay } from './types';
import { addDays, dayStart, hashId } from './util';

export interface TripOptions {
  /** further than this from home counts as away */
  awayM: number;
  /** a trip lasts at least this long */
  minMs: number;
  /** what country a spot is in */
  country: (p: LL) => string | undefined;
  /** the name of a country code, for titles */
  countryName?: (cc: string) => string;
  /** the city a spot is in, when known (from looked-up names) */
  city?: (p: LL) => string | undefined;
}

/** Home: the place named home, else the place with the most time spent. */
export function guessHome(places: NamedPlace[], stays: Stay[]): LL | undefined {
  const named = places.find((p) => p.kind === 'home');
  if (named) return named;
  const top = clusterPlaces(stays)[0];
  return top ? { lat: top.lat, lon: top.lon } : undefined;
}

export function buildTrips(entries: TimelineEntry[], home: LL | undefined, opts: TripOptions): Trip[] {
  if (!home) return [];
  const sorted = [...entries].sort((a, b) => a.start - b.start);
  const stays = sorted.filter((e): e is Stay => e.kind === 'stay');
  const runs: { start: number; end: number }[] = [];
  let cur: { start: number; end: number; firstAway: number } | null = null;
  let lastHomeEnd: number | undefined;
  for (const s of stays) {
    const away = metres(home, s) > opts.awayM;
    if (away) {
      if (!cur) cur = { start: lastHomeEnd ?? s.start, end: s.end, firstAway: s.start };
      else cur.end = s.end;
    } else {
      if (cur) runs.push({ start: cur.start, end: s.start });
      cur = null;
      lastHomeEnd = s.end;
    }
  }
  if (cur) runs.push({ start: cur.start, end: cur.end });

  const trips: Trip[] = [];
  for (const r of runs) {
    if (r.end - r.start < opts.minMs) continue;
    const inTrip = sorted.filter((e) => e.end >= r.start && e.start <= r.end);
    trips.push(makeTrip(inTrip, r.start, r.end, home, opts));
  }
  return trips;
}

function makeTrip(entries: TimelineEntry[], start: number, end: number, home: LL, opts: TripOptions): Trip {
  const days: TripDay[] = [];
  for (let d = dayStart(start); d <= end; d = addDays(d, 1)) {
    const next = addDays(d, 1);
    const es = entries.filter((e) => e.start < next && e.end >= d && !(e.kind === 'stay' && e.end <= start));
    const distanceM = es.reduce((s, e) => s + (e.kind === 'move' || e.kind === 'activity' ? (e.start >= d ? e.distanceM : 0) : 0), 0);
    const places = [...new Set(es.filter((e): e is Stay => e.kind === 'stay' && metres(home, e) > opts.awayM).map((e) => e.name).filter((n): n is string => !!n))];
    days.push({ day: d, entries: es, distanceM, places });
  }
  const stays = entries.filter((e): e is Stay => e.kind === 'stay' && metres(home, e) > opts.awayM);
  const moves = entries.filter((e): e is Move => e.kind === 'move');
  const countries: string[] = [];
  for (const s of stays) {
    const cc = opts.country(s);
    if (cc && !countries.includes(cc)) countries.push(cc);
  }
  // The title: the cities where most time was spent, else the countries.
  const time = new Map<string, number>();
  for (const s of stays) {
    const city = opts.city?.(s) ?? (s.name?.includes(',') ? s.name.split(',').pop()!.trim() : undefined);
    if (city) time.set(city, (time.get(city) ?? 0) + (s.end - s.start));
  }
  const top = [...time.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 2);
  const title = top.length ? top.join(' and ') : countries.length ? countries.map((c) => opts.countryName?.(c) ?? c).slice(0, 2).join(' and ') : 'Trip';
  const pts: LL[] = [...stays, ...moves.flatMap((m) => [m.from, m.to])];
  return {
    id: hashId(`trip:${start}`),
    title,
    start,
    end,
    days,
    distanceM: entries.reduce((s, e) => s + (e.kind === 'move' || e.kind === 'activity' ? e.distanceM : 0), 0),
    countries,
    places: [...new Set(stays.map((s) => s.name).filter((n): n is string => !!n))],
    photos: entries.filter((e) => e.kind === 'photo').length,
    flights: moves.filter((m) => m.mode === 'flight').length,
    drives: moves.filter((m) => m.mode === 'drive').length,
    bbox: bbox(pts.length ? pts : [home]),
  };
}
