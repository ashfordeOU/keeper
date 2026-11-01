// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places & Tracks: stays and moves, trips, the stats maths, privacy zones,
// exports, search, the store and encryption at rest.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig, activeSources } from '../core/tracks/config';
import { addImport, addLive, emptyDb, searchDb, timelineView, tripsOf } from '../core/tracks/db';
import { exportAs, toCsv, toGpx, tripSummaryHtml } from '../core/tracks/export';
import { parseGpx } from '../core/tracks/files';
import { cluster, colouredRuns, decodePolyline, encodePolyline, fitZoom, fromPixel, metres, simplify, tileUrl, toPixel } from '../core/tracks/geo';
import { parseGoogle } from '../core/tracks/google';
import { countryLabel, nearestCountry, RateLimiter, readNominatim, reverseUrl } from '../core/tracks/places';
import { cutTrack, effectiveZones, filterPoints } from '../core/tracks/privacy';
import { answer, placeQuery, searchStays } from '../core/tracks/search';
import { bestEffort, compare, computeStats, finishTrack, fmtPace, paceSecPerKm, personalRecords, splits } from '../core/tracks/stats';
import { buildTimeline, clusterPlaces, detectMoves, detectStays, inferMode, mergePlaces, shiftSpan, spanRange } from '../core/tracks/timeline';
import { buildTrips } from '../core/tracks/trips';
import type { Point, Stay } from '../core/tracks/types';
import { open, seal } from '../core/tracks/vault';
import crypto from 'node:crypto';

const fx = (n: string) => readFileSync(path.join(__dirname, 'fixtures', 'tracks', n), 'utf8');
const T0 = Date.parse('2026-03-02T00:00:00Z');
const MIN = 60_000;

/** A straight line north from a point: `n` fixes `everyS` seconds apart at `mps` metres per second. */
function line(lat: number, lon: number, n: number, everyS: number, mps: number, t0 = T0, extra: Partial<Point> = {}): Point[] {
  const dLat = (mps * everyS) / 111_195;
  return Array.from({ length: n }, (_, i) => ({ t: t0 + i * everyS * 1000, lat: lat + i * dLat, lon, ...extra }));
}

function stayAt(lat: number, lon: number, from: number, minutes: number, jitter = 0.0002): Point[] {
  let s = 7;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5);
  return Array.from({ length: minutes / 2 + 1 }, (_, i) => ({ t: from + i * 2 * MIN, lat: lat + r() * jitter, lon: lon + r() * jitter }));
}

describe('geometry', () => {
  it('measures distance, simplifies and round-trips polylines', () => {
    expect(metres({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111_195, -2);
    const pts = line(52, 13, 100, 1, 3);
    expect(simplify(pts, 1)).toHaveLength(2);
    const ll: [number, number][] = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
    expect(encodePolyline(ll)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(ll);
  });
  it('does web-mercator tile maths', () => {
    const [x, y] = toPixel(0, 0, 1);
    expect([x, y]).toEqual([256, 256]);
    const back = fromPixel(...toPixel(59.437, 24.745, 12), 12);
    expect(back.lat).toBeCloseTo(59.437, 6);
    expect(tileUrl('https://{s}.tile.example/{z}/{x}/{y}.png', 3, -1, 2)).toBe('https://a.tile.example/3/7/2.png');
    expect(fitZoom([24.7, 59.4, 24.8, 59.45], 800, 600)).toBeGreaterThanOrEqual(11);
  });
  it('clusters markers that would overlap and splits a track into coloured runs', () => {
    const near = [{ lat: 52.52, lon: 13.40 }, { lat: 52.5201, lon: 13.4001 }, { lat: 48.85, lon: 2.35 }];
    expect(cluster(near, 5)).toHaveLength(2);
    expect(cluster(near, 18)).toHaveLength(3);
    const pts = [...line(52, 13, 10, 10, 2), ...line(52.002, 13, 10, 10, 9, T0 + 100_000)];
    const runs = colouredRuns(pts, 'speed');
    expect(runs.length).toBeGreaterThan(1);
    expect(runs[0].color).not.toBe(runs[runs.length - 1].color);
  });
});

describe('stats maths', () => {
  it('computes distance, moving time, pace, climb and heart rate', () => {
    // 1 km at 4 m/s, a 5-minute stop, then 1 km more.
    const a = line(52, 13, 26, 10, 4, T0, { hr: 150 });
    const last = a[a.length - 1];
    const stop = Array.from({ length: 6 }, (_, i) => ({ ...last, t: last.t + (i + 1) * 60_000 }));
    const b = line(last.lat, 13, 26, 10, 4, stop[stop.length - 1].t + 10_000, { hr: 160 });
    const s = computeStats([...a, ...stop, ...b.slice(1)]);
    expect(s.distanceM).toBeCloseTo(2000 + 40, -2);
    expect(s.movingS).toBeGreaterThanOrEqual(500);
    expect(s.movingS).toBeLessThanOrEqual(520);
    expect(s.elapsedS).toBeGreaterThan(800);
    expect(s.avgHr).toBe(154); // 32 fixes at 150 (with the stop), 25 at 160
    expect(fmtPace(paceSecPerKm(s))).toMatch(/^4:1\d \/km$/);
  });
  it('ignores elevation noise below 3 m but counts real climbs', () => {
    const pts = line(52, 13, 9, 10, 3).map((p, i) => ({ ...p, ele: [100, 101, 100, 102, 100, 105, 110, 108, 104][i] }));
    const s = computeStats(pts);
    expect(s.ascentM).toBe(10);
    expect(s.descentM).toBe(6);
  });
  it('finds splits, best efforts and personal records', () => {
    const pts = [...line(52, 13, 101, 10, 3.5), ...line(52 + (3.5 * 1000) / 111_195, 13, 101, 10, 2.5, T0 + 1_010_000)];
    const sp = splits(pts);
    expect(sp[0].distanceM).toBe(1000);
    expect(sp[0].seconds).toBeCloseTo(1000 / 3.5, 0);
    expect(bestEffort(pts, 1000)).toBeCloseTo(1000 / 3.5, 0);
    expect(bestEffort(pts, 100_000)).toBeUndefined();
    const fast = finishTrack({ id: 'a', name: 'A', sport: 'run', source: 'gpx', points: line(52, 13, 200, 5, 4) });
    const slow = finishTrack({ id: 'b', name: 'B', sport: 'run', source: 'gpx', points: line(52, 13, 200, 5, 3) });
    const prs = personalRecords([fast, slow]);
    expect(prs.find((p) => p.label === '1 km')).toMatchObject({ track: 'a' });
    expect(prs.find((p) => p.label === 'Longest')).toMatchObject({ track: 'a' });
    const c = compare(fast, slow);
    expect(c.gaps[0].seconds).toBeGreaterThan(60);
  });
});

describe('stays and moves', () => {
  it('finds stays in raw points and the move between them, with the mode from speed', () => {
    const home = stayAt(52.52, 13.405, T0, 120);
    const walk = line(52.52, 13.405, 30, 30, 1.4, T0 + 121 * MIN).slice(1);
    const end = walk[walk.length - 1];
    const cafe = stayAt(end.lat + 0.0002, 13.405, end.t + MIN, 60);
    const stays = detectStays([...home, ...walk, ...cafe]);
    expect(stays).toHaveLength(2);
    expect(stays[0].end - stays[0].start).toBeGreaterThanOrEqual(110 * MIN);
    const moves = detectMoves(stays, [...home, ...walk, ...cafe]);
    expect(moves).toHaveLength(1);
    expect(moves[0].mode).toBe('walk');
    expect(moves[0].distanceM).toBeGreaterThan(1000);
  });
  it('is not fooled by a single GPS jump or by imprecise fixes', () => {
    const pts = stayAt(52.52, 13.405, T0, 60);
    pts.splice(10, 0, { t: pts[9].t + 1000, lat: 52.6, lon: 13.5 });
    pts.splice(20, 0, { t: pts[19].t + 1000, lat: 52.7, lon: 13.6, acc: 2000 });
    expect(detectStays(pts)).toHaveLength(1);
  });
  it('guesses the way of travel', () => {
    expect(inferMode(1000, 12 * MIN)).toBe('walk');
    expect(inferMode(5000, 15 * MIN)).toBe('ride');
    expect(inferMode(30_000, 25 * MIN)).toBe('drive');
    expect(inferMode(1_040_000, 120 * MIN)).toBe('flight');
  });
  it('groups stays into places and merges named places', () => {
    const s = (lat: number, h: number): Stay => ({ kind: 'stay', id: String(h), start: T0 + h * 3600_000, end: T0 + (h + 1) * 3600_000, lat, lon: 13.4, source: 'detected' });
    const c = clusterPlaces([s(52.52, 0), s(52.5201, 5), s(52.6, 7)]);
    expect(c).toHaveLength(2);
    expect(c[0].visits).toBe(2);
    const m = mergePlaces([{ id: 'a', name: 'Gym', lat: 52.52, lon: 13.4, radiusM: 100, kind: 'other' }, { id: 'b', name: 'Gym 2', lat: 52.521, lon: 13.4, radiusM: 100, kind: 'other' }]);
    expect(m.name).toBe('Gym');
    expect(m.lat).toBeCloseTo(52.5205, 4);
    expect(m.radiusM).toBeGreaterThan(150);
  });
  it('builds a day from Google visits and moves, raw points and an activity', () => {
    const r = parseGoogle(JSON.parse(fx('timeline-android.json')));
    const gpx = parseGpx(fx('run.gpx'));
    const day = spanRange('day', Date.parse('2026-05-13T10:00:00Z'));
    const entries = buildTimeline({ history: r.history, visits: r.visits, segments: r.segments, tracks: gpx.tracks, photos: [], places: [] }, day[0], day[1]);
    expect(entries.filter((e) => e.kind === 'stay').length).toBeGreaterThanOrEqual(2);
    expect(entries.some((e) => e.kind === 'move' && e.mode === 'walk')).toBe(true);
    expect(entries.some((e) => e.kind === 'activity' && e.sport === 'run')).toBe(true);
    // In time order.
    for (let i = 1; i < entries.length; i++) expect(entries[i].start).toBeGreaterThanOrEqual(entries[i - 1].start);
  });
  it('steps through days, weeks, months and years', () => {
    const at = new Date(2026, 4, 13, 12).getTime();
    const [wf, wt] = spanRange('week', at);
    expect(new Date(wf).getDay()).toBe(1);
    expect(wt - wf).toBeGreaterThanOrEqual(7 * 24 * 3600_000 - 3600_000);
    expect(new Date(spanRange('month', at)[0]).getDate()).toBe(1);
    expect(new Date(shiftSpan('year', at, -1)).getFullYear()).toBe(2025);
  });
});

describe('trips', () => {
  it('builds the trip to Tallinn from the timeline, with days, flights and countries', () => {
    const db = emptyDb();
    addImport(db, parseGoogle(JSON.parse(fx('timeline-android.json'))), 'Timeline.json');
    addImport(db, parseGpx(fx('run.gpx')), 'run.gpx');
    expect(db.places.find((p) => p.kind === 'home')).toBeTruthy();
    const trips = tripsOf(db, []);
    expect(trips).toHaveLength(1);
    const t = trips[0];
    expect(t.countries).toEqual(['EE']);
    expect(t.flights).toBe(2);
    expect(t.drives).toBeGreaterThanOrEqual(2);
    expect(t.days.length).toBeGreaterThanOrEqual(3);
    expect(t.distanceM).toBeGreaterThan(2_000_000);
    expect(t.days.some((d) => d.entries.some((e) => e.kind === 'activity'))).toBe(true);
    const html = tripSummaryHtml(t, countryLabel, db.tracks);
    expect(html).toContain('Estonia');
    expect(html).not.toMatch(/<script/i);
  });
  it('needs a home and at least a night away', () => {
    expect(buildTrips([], undefined, { awayM: 50_000, minMs: 18 * 3600_000, country: () => undefined })).toEqual([]);
    const s = (lat: number, h0: number, h1: number): Stay => ({ kind: 'stay', id: String(h0), start: T0 + h0 * 3600_000, end: T0 + h1 * 3600_000, lat, lon: 13.4, source: 'detected' });
    const short = buildTrips([s(52.52, 0, 8), s(53.5, 9, 14), s(52.52, 16, 20)], { lat: 52.52, lon: 13.4 }, { awayM: 50_000, minMs: 18 * 3600_000, country: () => 'DE' });
    expect(short).toHaveLength(0);
  });
  it('knows countries offline', () => {
    expect(nearestCountry({ lat: 59.437, lon: 24.745 })).toBe('EE');
    expect(nearestCountry({ lat: 60.17, lon: 24.94 })).toBe('FI');
    expect(nearestCountry({ lat: 52.52, lon: 13.4 })).toBe('DE');
    expect(nearestCountry({ lat: 48.8566, lon: 2.3522 })).toBe('FR');
    expect(nearestCountry({ lat: 40.4168, lon: -3.7038 })).toBe('ES');
    expect(nearestCountry({ lat: 35.68, lon: 139.69 })).toBe('JP');
    expect(nearestCountry({ lat: 0, lon: -140 })).toBeUndefined();
  });
});

describe('privacy zones', () => {
  const home = { id: 'h', name: 'Home', lat: 52.52, lon: 13.40, radiusM: 150, kind: 'home' as const };
  it('hides home and work and cuts tracks where they pass through', () => {
    const zones = effectiveZones([], [home, { ...home, id: 'x', kind: 'other' }]);
    expect(zones).toHaveLength(1);
    expect(zones[0].radiusM).toBe(200);
    const t = finishTrack({ id: 't', name: 'T', sport: 'walk', source: 'gpx', points: line(52.515, 13.40, 60, 10, 2) });
    const parts = cutTrack(t, zones);
    expect(parts.length).toBe(2);
    for (const p of parts) for (const pt of p.points) expect(metres(pt, home)).toBeGreaterThan(200);
    expect(filterPoints([{ lat: 52.52, lon: 13.4 }, { lat: 53, lon: 13 }], zones)).toHaveLength(1);
  });
  it('never exports points inside a zone', () => {
    const t = finishTrack({ id: 't', name: 'T', sport: 'walk', source: 'gpx', points: line(52.515, 13.40, 60, 10, 2) });
    const zones = effectiveZones([], [home]);
    for (const f of ['gpx', 'kml', 'geojson', 'csv'] as const) {
      const text = exportAs(f, { tracks: [t], zones });
      expect(text).not.toContain('52.52,');
      expect(text).not.toContain('lat="52.52"');
    }
  });
});

describe('exports', () => {
  it('writes GPX that reads back the same', () => {
    const t = parseGpx(fx('run.gpx')).tracks.find((x) => !x.planned)!;
    const back = parseGpx(toGpx({ tracks: [t] })).tracks[0];
    expect(back.points).toHaveLength(t.points.length);
    expect(back.points[5].hr).toBe(t.points[5].hr);
    expect(back.points[5].lat).toBeCloseTo(t.points[5].lat, 6);
    expect(back.stats.distanceM).toBeCloseTo(t.stats.distanceM, 0);
  });
  it('neutralises spreadsheet formulas in CSV', () => {
    const t = finishTrack({ id: 't', name: '=HYPERLINK("x")', sport: 'walk', source: 'gpx', points: line(1, 1, 2, 1, 1) });
    expect(toCsv({ tracks: [t] })).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('search', () => {
  it('finds the last visit to a place by name or near a looked-up spot', () => {
    expect(placeQuery('When was I last in Tallinn?')).toBe('Tallinn');
    expect(placeQuery('last time at the Gym')).toBe('Gym');
    const s = (name: string | undefined, d: number, lat = 59.43): Stay => ({ kind: 'stay', id: `${d}`, name, start: T0 + d * 86_400_000, end: T0 + d * 86_400_000 + 3600_000, lat, lon: 24.75, source: 'google' });
    const hits = searchStays([s('Hotel, Tallinn', 1), s('Hotel, Tallinn', 3), s('Office, Berlin', 4, 52.5)], 'when was I last in Tallinn');
    expect(hits).toHaveLength(2);
    expect(hits[0].stay.id).toBe('3');
    expect(answer('when was I last in Tallinn', hits)).toMatch(/^Last in Tallinn on .*2 days there/);
    expect(searchStays([s(undefined, 1)], 'Tallinn', { lat: 59.437, lon: 24.745 })[0].how).toBe('near');
  });
  it('matches country names through the offline outline', () => {
    const db = emptyDb();
    addImport(db, parseGoogle(JSON.parse(fx('timeline-android.json'))), 'Timeline.json');
    const r = searchDb(db, [], 'When was I last in Estonia?');
    expect(r.hits.length).toBeGreaterThan(0);
    expect(new Date(r.hits[0].stay.start).toISOString().slice(0, 10)).toBe('2026-05-14');
  });
});

describe('the store', () => {
  it('skips duplicates on a second import', () => {
    const db = emptyDb();
    const a = addImport(db, parseGpx(fx('run.gpx')), 'run.gpx');
    const b = addImport(db, parseGpx(fx('run.gpx')), 'run.gpx');
    expect(a.record.tracks).toBe(2);
    expect(b.record.tracks).toBe(0);
    expect(b.skipped).toBeGreaterThan(0);
  });
  it('keeps live positions and a trail, and only yours feed the timeline', () => {
    const db = emptyDb();
    expect(addLive(db, { id: 'owntracks:a/p', name: 'p', kind: 'phone', source: 'owntracks', t: T0, lat: 52.52, lon: 13.4 })).toBe(true);
    expect(addLive(db, { id: 'owntracks:a/p', name: 'p', kind: 'phone', source: 'owntracks', t: T0 - 1000, lat: 1, lon: 1 })).toBe(false);
    addLive(db, { id: 'owntracks:a/p', name: 'p', kind: 'phone', source: 'owntracks', t: T0 + 5000, lat: 52.52001, lon: 13.4 });
    expect(db.live).toHaveLength(1);
    expect(db.history).toHaveLength(1); // the second report was standing still
    for (let i = 0; i < 40; i++) addLive(db, { id: 'owntracks:a/p', name: 'p', kind: 'phone', source: 'owntracks', t: T0 + (i + 1) * 16 * MIN, lat: 52.52, lon: 13.4 });
    expect(timelineView(db, T0, T0 + 86_400_000, []).entries.filter((e) => e.kind === 'stay')).toHaveLength(0);
    expect(timelineView(db, T0, T0 + 86_400_000, ['owntracks:a/p']).entries.filter((e) => e.kind === 'stay')).toHaveLength(1);
  });
  it('encrypts at rest with AES-GCM and refuses a wrong key or a changed file', () => {
    const key = crypto.randomBytes(32);
    const b = seal('{"secret":"52.52,13.40"}', key);
    expect(b.toString('latin1')).not.toContain('52.52');
    expect(open(b, key)).toBe('{"secret":"52.52,13.40"}');
    expect(() => open(b, crypto.randomBytes(32))).toThrow();
    const bad = Buffer.from(b);
    bad[bad.length - 1] ^= 1;
    expect(() => open(bad, key)).toThrow();
    expect(open(seal('x', undefined), undefined)).toBe('x');
  });
  it('keeps sources off by default and merges settings safely', () => {
    const c = defaultConfig('t');
    expect(activeSources(c)).toEqual([]);
    expect(c.sources.ownTracks.on || c.sources.osmand.on || c.sources.mqtt.on).toBe(false);
    const m = mergeConfig(c, { sources: { ownTracks: { on: true }, bogus: 1 }, map: { online: 'yes' } } as never);
    expect(m.sources.ownTracks.on).toBe(true);
    expect((m.sources as Record<string, unknown>).bogus).toBeUndefined();
    expect(m.map.online).toBe(false);
  });
});

describe('reverse geocoding', () => {
  it('builds Nominatim requests, reads answers and waits a second between requests', async () => {
    expect(reverseUrl('https://n.example/', { lat: 59.4372, lon: 24.7454 })).toBe('https://n.example/reverse?format=jsonv2&lat=59.43720&lon=24.74540&zoom=16&addressdetails=1');
    expect(readNominatim({ name: 'Hotel Telegraaf', address: { city: 'Tallinn', country: 'Estonia', country_code: 'ee' } })).toEqual({ name: 'Hotel Telegraaf, Tallinn', city: 'Tallinn', country: 'Estonia', cc: 'EE' });
    let now = 0;
    const waits: number[] = [];
    const rl = new RateLimiter(1000, () => now, async (ms) => { waits.push(ms); now += ms; });
    await Promise.all([rl.run(async () => 1), rl.run(async () => 2), rl.run(async () => 3)]);
    expect(waits).toEqual([1000, 1000]);
  });
});
