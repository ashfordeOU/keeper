// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places & Tracks: every file reader against small fixtures.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fitCrc, parseFit, readFitMessages, writeFit } from '../core/tracks/fit';
import { parseGeoJson, parseGpx, parseKml, parseTcx } from '../core/tracks/files';
import { googleKind, parseGoogle, readLatLng } from '../core/tracks/google';
import { parseAppleHealth, readHealthWorkouts } from '../core/tracks/health';
import { importBytes, photoPoint } from '../core/tracks/importer';
import { parseXml, all } from '../core/tracks/xml';

const fx = (n: string) => path.join(__dirname, 'fixtures', 'tracks', n);
const txt = (n: string) => readFileSync(fx(n), 'utf8');
const bin = (n: string) => new Uint8Array(readFileSync(fx(n)));

describe('xml reader', () => {
  it('drops namespace prefixes, decodes entities and ignores DOCTYPE subsets', () => {
    const r = parseXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "boom">]><a:root x="1 &amp; 2"><b:item>&lt;hi&gt; &#65;&#x42;</b:item><![CDATA[<raw>]]></a:root>');
    const root = r.children[0];
    expect(root.name).toBe('root');
    expect(root.attrs.x).toBe('1 & 2');
    expect(all(r, 'item')[0].text).toBe('<hi> AB');
    expect(root.text).toContain('<raw>');
  });
});

describe('GPX', () => {
  it('reads a run with heart rate, cadence and elevation, a planned route and a timed waypoint', () => {
    const r = parseGpx(txt('run.gpx'));
    const run = r.tracks.find((t) => !t.planned)!;
    expect(run.name).toBe('Morning Run');
    expect(run.sport).toBe('run');
    expect(run.points).toHaveLength(25);
    expect(run.points[0]).toMatchObject({ hr: 140, cad: 84 });
    expect(run.points[0].ele).toBeCloseTo(15, 1);
    expect(run.stats.distanceM).toBeGreaterThan(1500);
    expect(run.stats.avgHr).toBe(152);
    const route = r.tracks.find((t) => t.planned)!;
    expect(route.name).toBe('Planned loop');
    expect(r.visits).toHaveLength(1);
    expect(r.visits[0].name).toBe('Hotel');
  });
  it('says when a file is not GPX', () => {
    expect(parseGpx('<kml/>').warnings[0]).toMatch(/not a GPX/);
  });
});

describe('KML and KMZ', () => {
  it('reads gx:Track, timed LineStrings and timed Points', () => {
    const r = parseKml(txt('trip.kml'));
    const ride = r.tracks.find((t) => t.name === 'Evening ride')!;
    expect(ride.sport).toBe('ride');
    expect(ride.points).toHaveLength(3);
    expect(ride.points[1].ele).toBe(12);
    const drive = r.tracks.find((t) => t.name === 'Driving')!;
    expect(drive.sport).toBe('drive');
    expect(drive.end - drive.start).toBe(30 * 60_000);
    expect(r.visits).toHaveLength(1);
    expect(r.visits[0]).toMatchObject({ name: 'Hotel Telegraaf & Spa', address: 'Vene 9, Tallinn' });
  });
  it('unpacks a KMZ', () => {
    const r = importBytes('trip.kmz', bin('trip.kmz'));
    expect(r.format).toBe('KMZ');
    expect(r.tracks.length).toBe(2);
  });
});

describe('GeoJSON', () => {
  it('reads lines with coordTimes and heart rates, timed points and visits', () => {
    const r = parseGeoJson(txt('ride.geojson'));
    const ride = r.tracks.find((t) => !t.planned)!;
    expect(ride.sport).toBe('ride');
    expect(ride.points.map((p) => p.hr)).toEqual([120, 130, 135, 128]);
    expect(ride.end - ride.start).toBe(30 * 60_000);
    expect(r.tracks.find((t) => t.planned)?.name).toBe('Planned');
    expect(r.history).toHaveLength(1);
    expect(r.visits[0].name).toBe('Senate Square');
  });
});

describe('TCX', () => {
  it('reads positions, heart rate, speed and cadence, and keeps an indoor activity by its numbers', () => {
    const r = parseTcx(txt('run.tcx'));
    expect(r.tracks).toHaveLength(2);
    const run = r.tracks.find((t) => t.points.length)!;
    expect(run.sport).toBe('run');
    expect(run.points[2]).toMatchObject({ hr: 152, speed: 3.1, cad: 86, ele: 37 });
    expect(run.reported).toMatchObject({ elapsedS: 300, distanceM: 1450, calories: 110 });
    const indoor = r.tracks.find((t) => !t.points.length)!;
    expect(indoor.end - indoor.start).toBe(1_800_000);
  });
});

describe('FIT', () => {
  it('reads records and the session from a FIT file', () => {
    const r = parseFit(bin('ride.fit'));
    expect(r.warnings).toEqual([]);
    const t = r.tracks[0];
    expect(t.sport).toBe('ride');
    expect(t.points).toHaveLength(30);
    expect(t.points[0].lat).toBeCloseTo(60.16, 5);
    expect(t.points[0].lon).toBeCloseTo(24.93, 5);
    expect(t.points[3]).toMatchObject({ hr: 123 });
    expect(t.points[3].ele).toBeCloseTo(8, 1);
    expect(t.points[1].speed).toBeCloseTo(6.2, 3);
    expect(t.start).toBe(Date.parse('2026-05-14T15:00:00Z'));
    expect(t.reported?.elapsedS).toBeCloseTo(580, 0);
  });
  it('checks the file CRC and survives a round trip', () => {
    const b = bin('ride.fit');
    expect(fitCrc(b)).toBe(0); // CRC over data plus its own CRC is zero
    const pts = [{ t: Date.parse('2026-01-01T00:00:00Z'), lat: -33.9, lon: 151.2, ele: 3 }, { t: Date.parse('2026-01-01T00:00:10Z'), lat: -33.8999, lon: 151.2002, ele: 4 }];
    const back = parseFit(writeFit(pts, 1)).tracks[0];
    expect(back.sport).toBe('run');
    expect(back.points[1].lat).toBeCloseTo(-33.8999, 6);
    expect(back.points[1].lon).toBeCloseTo(151.2002, 6);
  });
  it('refuses something that is not FIT', () => {
    expect(parseFit(new TextEncoder().encode('hello world, not fit at all')).warnings[0]).toMatch(/not a FIT/);
    expect(() => readFitMessages(new Uint8Array(5))).toThrow();
  });
  it('reads compressed-timestamp records', () => {
    // file_id, a record definition (timestamp, lat, lon), one normal record, one compressed (+3 s).
    const body = [
      0x40, 0, 0, 20, 0, 3, 253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85,
      0x00, ...u32(1_000_000_000), ...u32(Math.round(10 / (180 / 2 ** 31))), ...u32(Math.round(20 / (180 / 2 ** 31))),
      0x41, 0, 0, 20, 0, 2, 0, 4, 0x85, 1, 4, 0x85,
      0x80 | (1 << 5) | ((1_000_000_000 + 3) & 0x1f), ...u32(Math.round(10.001 / (180 / 2 ** 31))), ...u32(Math.round(20.001 / (180 / 2 ** 31))),
    ];
    const file = new Uint8Array(12 + body.length + 2);
    file.set([12, 0x10, 0, 0, body.length & 0xff, body.length >> 8, 0, 0, 0x2e, 0x46, 0x49, 0x54], 0);
    file.set(body, 12);
    const r = parseFit(file);
    expect(r.tracks[0].points).toHaveLength(2);
    expect(r.tracks[0].points[1].t - r.tracks[0].points[0].t).toBe(3000);
  });
});

function u32(x: number): number[] {
  const v = x >>> 0;
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

describe('Google Timeline', () => {
  it('tells the three formats apart', () => {
    expect(googleKind(JSON.parse(txt('timeline-android.json')))).toBe('device');
    expect(googleKind(JSON.parse(txt('timeline-ios.json')))).toBe('device');
    expect(googleKind(JSON.parse(txt('semantic-2019_MAY.json')))).toBe('semantic');
    expect(googleKind(JSON.parse(txt('records.json')))).toBe('records');
    expect(googleKind({ type: 'FeatureCollection' })).toBeUndefined();
  });
  it('reads the on-device export from Android: visits, moves, paths, raw signals, home and work', () => {
    const r = parseGoogle(JSON.parse(txt('timeline-android.json')));
    expect(r.visits).toHaveLength(9);
    expect(r.segments).toHaveLength(8);
    expect(r.segments.filter((s) => s.mode === 'flight')).toHaveLength(2);
    expect(r.segments.find((s) => s.mode === 'walk')?.distanceM).toBe(2700);
    expect(r.history.length).toBe(2);
    expect(r.history.find((h) => h.acc === 12)?.ele).toBe(30);
    expect(r.labelled.map((l) => l.label)).toEqual(expect.arrayContaining(['HOME', 'WORK']));
    // The path between the airport and the hotel joins its move.
    const drive = r.segments.find((s) => s.start === Date.parse('2026-05-12T10:30:00Z'))!;
    expect(drive.path!.length).toBe(3);
  });
  it('reads the on-device export from an iPhone (geo: points, minute offsets)', () => {
    const r = parseGoogle(JSON.parse(txt('timeline-ios.json')));
    expect(r.visits).toHaveLength(2);
    expect(r.visits[0]).toMatchObject({ lat: 52.5208, lon: 13.4094, semantic: 'HOME', placeId: 'ChIJhome' });
    expect(r.segments[0].mode).toBe('walk');
    expect(r.history[0].t).toBe(Date.parse('2026-05-12T06:00:00+02:00') + 20 * 60_000);
  });
  it('reads Takeout Semantic Location History', () => {
    const r = parseGoogle(JSON.parse(txt('semantic-2019_MAY.json')));
    expect(r.visits.map((v) => v.name)).toEqual(['Hotel Telegraaf', 'Kadriorg Palace', 'Home']);
    expect(r.visits[0].address).toMatch(/Vene 9/);
    expect(r.segments[0]).toMatchObject({ mode: 'walk', distanceM: 2700 });
    expect(r.segments[0].path!.length).toBe(3);
    expect(r.labelled[0]).toMatchObject({ label: 'HOME' });
  });
  it('reads Records.json (both timestamp forms) and skips 0,0', () => {
    const r = parseGoogle(JSON.parse(txt('records.json')));
    expect(r.history).toHaveLength(3);
    expect(r.history[1].t).toBe(1646122200000);
    expect(r.history[0]).toMatchObject({ acc: 20, ele: 40 });
  });
  it('reads every way Google writes a coordinate', () => {
    expect(readLatLng('52.5200°, 13.4050°')).toEqual({ lat: 52.52, lon: 13.405 });
    expect(readLatLng('geo:-33.9,151.2')).toEqual({ lat: -33.9, lon: 151.2 });
    expect(readLatLng({ latitudeE7: 525200000, longitudeE7: 134050000 })).toEqual({ lat: 52.52, lon: 13.405 });
    expect(readLatLng({ latLng: '1.5°, 2.5°' })).toEqual({ lat: 1.5, lon: 2.5 });
  });
});

describe('Apple Health export', () => {
  it('joins workouts with their routes and keeps indoor ones', () => {
    const r = importBytes('export.zip', bin('apple-health-export.zip'));
    expect(r.format).toBe('Apple Health');
    expect(r.tracks).toHaveLength(2);
    const run = r.tracks.find((t) => t.sport === 'run')!;
    expect(run.points).toHaveLength(12);
    expect(run.reported).toMatchObject({ elapsedS: 1320, distanceM: 2400, avgHr: 152, maxHr: 171, calories: 180, ascentM: 12 });
    expect(run.start).toBe(Date.parse('2026-05-13T05:00:00Z'));
    const gym = r.tracks.find((t) => t.sport !== 'run')!;
    expect(gym.sport).toBe('other');
    expect(gym.points).toHaveLength(0);
    expect(gym.reported?.calories).toBe(210);
  });
  it('reads HKWorkout metadata and says when a route file is missing', () => {
    const xml = '<HealthData><Workout workoutActivityType="HKWorkoutActivityTypeCycling" duration="1" durationUnit="hr" totalDistance="20" totalDistanceUnit="mi" startDate="2026-01-01 10:00:00 +0000" endDate="2026-01-01 11:00:00 +0000"><MetadataEntry key="HKWeatherTemperature" value="50 degF"/><WorkoutRoute><FileReference path="/workout-routes/gone.gpx"/></WorkoutRoute></Workout></HealthData>';
    const w = readHealthWorkouts(xml)[0];
    expect(w).toMatchObject({ durationS: 3600, metadata: { HKWeatherTemperature: '50 degF' } });
    expect(w.distanceM).toBeCloseTo(32186.88, 1);
    const r = parseAppleHealth(xml, new Map());
    expect(r.warnings[0]).toMatch(/missing/);
    expect(r.tracks[0].sport).toBe('ride');
  });
});

describe('photos', () => {
  it('places a photo by its EXIF GPS and time', () => {
    const b = new Uint8Array(600);
    const dv = new DataView(b.buffer);
    const enc = (s: string) => new TextEncoder().encode(s);
    b.set(enc('II*\0'), 0);
    dv.setUint32(4, 8, true);
    const ifd = (at: number, list: [number, number, number, number][]) => {
      dv.setUint16(at, list.length, true);
      list.forEach(([tag, type, count, value], i) => {
        const e = at + 2 + i * 12;
        dv.setUint16(e, tag, true); dv.setUint16(e + 2, type, true); dv.setUint32(e + 4, count, true);
        dv.setUint32(e + 8, value, true);
      });
      dv.setUint32(at + 2 + list.length * 12, 0, true);
    };
    const rat = (at: number, n: number, d: number) => { dv.setUint32(at, n, true); dv.setUint32(at + 4, d, true); };
    ifd(8, [[0x8769, 4, 1, 100], [0x8825, 4, 1, 430]]);
    b.set(enc('2026:05:13 09:30:00\0'), 200);
    ifd(100, [[0x9003, 2, 20, 200]]);
    rat(320, 59, 1); rat(328, 26, 1); rat(336, 1440, 100);
    rat(344, 24, 1); rat(352, 44, 1); rat(360, 4320, 100);
    ifd(430, [[1, 2, 2, 0x4e], [2, 5, 3, 320], [3, 2, 2, 0x45], [4, 5, 3, 344]]);
    const p = photoPoint('/p/old town.tif', b)!;
    expect(p.lat).toBeCloseTo(59.4373, 3);
    expect(p.lon).toBeCloseTo(24.7453, 3);
    expect(p.t).toBe(new Date(2026, 4, 13, 9, 30, 0).getTime());
    expect(importBytes('old town.tif', b).photos).toHaveLength(1);
    expect(photoPoint('x.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeUndefined();
  });
});

describe('import dispatch', () => {
  it('picks the reader by name and content', () => {
    expect(importBytes('a.gpx', bin('run.gpx')).format).toBe('GPX');
    expect(importBytes('Timeline.json', bin('timeline-android.json')).format).toMatch(/Google/);
    expect(importBytes('x.geojson', bin('ride.geojson')).format).toBe('GeoJSON');
    expect(importBytes('noext', bin('run.tcx')).format).toBe('TCX');
    expect(importBytes('weird.bin', new Uint8Array([1, 2, 3])).warnings[0]).toMatch(/does not know/);
  });
});
