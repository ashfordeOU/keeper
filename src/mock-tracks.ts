// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places & Tracks for the browser demo: home in Berlin, a few days away in
// Tallinn and Helsinki (fly out, ferry across, fly home), a run in Kadriorg,
// a ride along the Helsinki shore, two devices and a tracked set of keys.
// Built with the same code the app uses; nothing touches a disk.

import type { TracksApi, TracksConfig, TracksOverview } from '../core/tracks/api';
import { defaultConfig, mergeConfig, SOURCE_CATALOG, sourceRow } from '../core/tracks/config';
import { addImport, allStays, dataRange, emptyDb, frequentPlaces, heatmapOf, recordsOf, searchDb, summaries, timelineView, tripsOf } from '../core/tracks/db';
import { exportAs, tripSummaryHtml } from '../core/tracks/export';
import { countryLabel } from '../core/tracks/places';
import { effectiveZones } from '../core/tracks/privacy';
import { finishTrack } from '../core/tracks/stats';
import { mergePlaces } from '../core/tracks/timeline';
import { emptyImport, type HistoryPoint, type Point } from '../core/tracks/types';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** The sample world, relative to now so it always looks recent. */
function sample() {
  const r = rng(7);
  const db = emptyDb();
  const d0 = new Date(Date.now() - 9 * DAY);
  d0.setHours(0, 0, 0, 0);
  const t = (day: number, h: number) => d0.getTime() + day * DAY + h * HOUR;
  const H: HistoryPoint[] = [];
  const stay = (from: number, to: number, lat: number, lon: number) => {
    for (let x = from; x <= to; x += 10 * 60_000) H.push({ t: x, lat: lat + (r() - 0.5) * 0.0006, lon: lon + (r() - 0.5) * 0.0009, acc: 20, src: 'google' });
  };
  const move = (from: number, to: number, a: [number, number], b: [number, number], every = 60_000) => {
    for (let x = from + every; x < to; x += every) {
      const f = (x - from) / (to - from);
      H.push({ t: x, lat: a[0] + (b[0] - a[0]) * f + (r() - 0.5) * 0.0004, lon: a[1] + (b[1] - a[1]) * f + (r() - 0.5) * 0.0004, acc: 15, src: 'google' });
    }
  };
  const home: [number, number] = [52.5208, 13.4094];
  const office: [number, number] = [52.5065, 13.3906];
  const ber: [number, number] = [52.3667, 13.5033];
  const tll: [number, number] = [59.4133, 24.8328];
  const hotelT: [number, number] = [59.4372, 24.7454];
  const port: [number, number] = [59.4433, 24.7653];
  const hel: [number, number] = [60.1653, 24.9562];
  const hotelH: [number, number] = [60.1675, 24.9442];
  const hvk: [number, number] = [60.3172, 24.9633];
  // Two ordinary days at home and work.
  for (const day of [0, 1]) {
    stay(t(day, 0), t(day, 8.5), ...home); move(t(day, 8.5), t(day, 9), home, office); stay(t(day, 9), t(day, 17.5), ...office); move(t(day, 17.5), t(day, 18), office, home); stay(t(day, 18), t(day, 23.99), ...home);
  }
  // Away: fly to Tallinn.
  stay(t(2, 0), t(2, 7), ...home); move(t(2, 7), t(2, 8), home, ber); stay(t(2, 8), t(2, 9.5), ...ber);
  move(t(2, 9.5), t(2, 11.5), ber, tll, 5 * 60_000); stay(t(2, 11.5), t(2, 12), ...tll); move(t(2, 12), t(2, 12.5), tll, hotelT);
  stay(t(2, 12.5), t(2, 15), ...hotelT); move(t(2, 15), t(2, 15.3), hotelT, [59.4372, 24.7449]); stay(t(2, 15.3), t(2, 19), 59.4372, 24.7449);
  move(t(2, 19), t(2, 19.3), [59.4372, 24.7449], hotelT); stay(t(2, 19.3), t(3, 9), ...hotelT);
  stay(t(3, 10), t(3, 16), 59.4389, 24.7364); move(t(3, 16), t(3, 16.3), [59.4389, 24.7364], hotelT); stay(t(3, 16.3), t(4, 9), ...hotelT);
  // Ferry to Helsinki.
  move(t(4, 9), t(4, 9.4), hotelT, port); stay(t(4, 9.4), t(4, 10), ...port); move(t(4, 10), t(4, 12), port, hel, 4 * 60_000);
  move(t(4, 12), t(4, 12.3), hel, hotelH); stay(t(4, 12.3), t(5, 10), ...hotelH);
  stay(t(5, 11), t(5, 15), 60.1699, 24.9384); move(t(5, 15), t(5, 15.3), [60.1699, 24.9384], hotelH); stay(t(5, 15.3), t(6, 8), ...hotelH);
  // Fly home.
  move(t(6, 8), t(6, 8.6), hotelH, hvk); stay(t(6, 8.6), t(6, 10), ...hvk); move(t(6, 10), t(6, 12), hvk, ber, 5 * 60_000); stay(t(6, 12), t(6, 12.4), ...ber); move(t(6, 12.4), t(6, 13.2), ber, home);
  stay(t(6, 13.2), t(7, 23.99), ...home);
  const imp = emptyImport('Google Timeline (on-device export)');
  imp.history = H;
  imp.labelled.push({ lat: home[0], lon: home[1], label: 'HOME' }, { lat: office[0], lon: office[1], label: 'WORK' });
  addImport(db, imp, 'Timeline.json', t(8, 9));

  // A run around Kadriorg (Tallinn) and a ride along the Helsinki shore.
  const loop = (c: [number, number], radius: [number, number], start: number, n: number, speed: number, hr: number, ele: number): Point[] =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return { t: start + i * 10_000, lat: c[0] + Math.sin(a) * radius[0], lon: c[1] + Math.cos(a) * radius[1] * (1 + 0.2 * Math.sin(3 * a)), ele: Math.round((ele + 12 * Math.sin(a * 2)) * 10) / 10, hr: Math.round(hr + 12 * Math.sin(a) + r() * 4), speed: speed * (0.9 + r() * 0.2) };
    });
  const run = finishTrack({ id: 'demo-run', name: 'Morning run in Kadriorg', sport: 'run', source: 'fit', sourceId: 'demo-run', points: loop([59.4385, 24.7930], [0.0068, 0.0115], t(3, 7), 170, 3.1, 152, 18) });
  const ride = finishTrack({ id: 'demo-ride', name: 'Shore ride, Helsinki', sport: 'ride', source: 'strava', sourceId: 'demo-ride', points: loop([60.1600, 24.9300], [0.0200, 0.0450], t(5, 16), 240, 6.8, 131, 9) });
  const home5k = finishTrack({ id: 'demo-run2', name: 'Evening 5K, Tiergarten', sport: 'run', source: 'gpx', sourceId: 'demo-run2', points: loop([52.5145, 13.3501], [0.0060, 0.0100], t(7, 19), 150, 3.3, 156, 35) });
  const ri = emptyImport('Activities');
  ri.tracks.push(run, ride, home5k);
  addImport(db, ri, 'Activities', t(8, 10));
  db.photos.push({ t: t(3, 12), lat: 59.4371, lon: 24.7453, path: '/Users/demo/Pictures/Tallinn old town.jpg' }, { t: t(5, 12), lat: 60.1699, lon: 24.9384, path: '/Users/demo/Pictures/Senate Square.jpg' }, { t: t(4, 11), lat: 59.85, lon: 24.85, path: '/Users/demo/Pictures/Ferry deck.jpg' });
  db.reservations.push({ id: 'demo-fl1', kind: 'flight', name: 'BT212 BER → TLL', start: t(2, 9.5), end: t(2, 11.5), from: 'BER', to: 'TLL', confirmation: 'K3PL9Q', provider: 'airBaltic', source: 'mail' }, { id: 'demo-hotel', kind: 'lodging', name: 'Hotel Telegraaf', start: t(2, 15), end: t(4, 11), address: 'Vene 9, Tallinn, EE', source: 'mail' });
  const now = Date.now();
  db.live.push(
    { id: 'owntracks:demo/pixel', name: 'Pixel 8', kind: 'phone', source: 'owntracks', t: now - 4 * 60_000, lat: 52.5203, lon: 13.4101, acc: 12, battery: 64, charging: false },
    { id: 'findmy:device:mba', name: 'MacBook Air', kind: 'device', source: 'findmy', t: now - 35 * 60_000, lat: 52.5066, lon: 13.3908, acc: 30, battery: 88, charging: true, address: 'Potsdamer Platz, Berlin' },
    { id: 'findmy:item:keys', name: 'Keys', kind: 'item', source: 'findmy', t: now - 2 * HOUR, lat: 52.5209, lon: 13.4096, acc: 8, address: 'Home' },
  );
  db.geo = {};
  // Names for the places of the trip (as a geocoder would give them).
  const name = (p: [number, number], n: string, cc: string) => { db.geo[`${p[0].toFixed(3)},${p[1].toFixed(3)}`] = { name: n, city: n.split(', ').pop(), cc }; };
  name(hotelT, 'Hotel Telegraaf, Tallinn', 'EE'); name([59.4372, 24.7449], 'Raekoja plats, Tallinn', 'EE'); name([59.4389, 24.7364], 'Kadriorg, Tallinn', 'EE'); name(tll, 'Tallinn Airport, Tallinn', 'EE'); name(port, 'D-terminal, Tallinn', 'EE');
  name(hotelH, 'Hotel Kämp, Helsinki', 'FI'); name([60.1699, 24.9384], 'Senate Square, Helsinki', 'FI'); name(hvk, 'Helsinki Airport, Vantaa', 'FI'); name(ber, 'BER Airport, Schönefeld', 'DE');
  return db;
}

export function mockTracks(emit: (ch: string) => void): { tracks: TracksApi } {
  const db = sample();
  let config: TracksConfig = mergeConfig(defaultConfig('demo-token'), { sources: { ownTracks: { on: true }, findMy: { on: true }, folders: { on: true, paths: ['/Users/demo/Garmin'] } }, map: { online: false } } as Partial<TracksConfig>);
  // Demo: ?darwin=25.0.0 shows a Mac on macOS 26 (Find My not available); ?live=off shows live sharing switched off.
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const release = q.get('darwin') ?? '23.3.0';
  const features = { tracks: true, live: q.get('live') !== 'off', services: false };
  const findMy: TracksOverview['findMy'] = { state: 'ok', detail: 'Demo: items and devices from the Find My cache.' };
  const self: string[] = [];
  const changed = () => emit('tracks-changed');
  const overview = async (): Promise<TracksOverview> => ({
    config,
    counts: { tracks: db.tracks.length, visits: db.visits.length, points: db.history.length, photos: db.photos.length, reservations: db.reservations.length, live: db.live.length, places: db.places.length },
    encrypted: true,
    sources: SOURCE_CATALOG.map((e) => sourceRow(e, e.id === 'import' ? undefined : (config.sources as Record<string, { on?: boolean }>)[e.id], { platform: 'darwin', release, features, findMy, linkWatching: false })),
    receiver: { running: true, url: 'http://127.0.0.1:5144' },
    findMy,
    features,
    imports: db.imports,
    range: dataRange(db),
  });
  return {
    tracks: {
      overview,
      brief: async () => ({ config, features, live: db.live }),
      setConfig: async (p) => { config = mergeConfig(config, p); changed(); return overview(); },
      setSecret: async () => true,
      importFiles: async () => ({ imported: [], skipped: 0 }),
      preview: async () => ({ lines: [{ id: 'demo-run', name: 'Morning run', sport: 'run', points: db.tracks[0].points }], photos: [], visits: 0, warnings: [], format: 'GPX' }),
      timeline: async (from, to) => timelineView(db, from, to, self),
      trips: async () => tripsOf(db, self, config.trips.awayKm),
      tripHtml: async (id) => tripSummaryHtml(tripsOf(db, self).find((x) => x.id === id)!, countryLabel, db.tracks),
      tracks: async () => summaries(db),
      track: async (id) => db.tracks.find((x) => x.id === id) ?? null,
      renameTrack: async (id, name) => { const x = db.tracks.find((y) => y.id === id); if (x) x.name = name; changed(); },
      removeTrack: async (id) => { db.tracks = db.tracks.filter((x) => x.id !== id); changed(); },
      records: async () => recordsOf(db),
      heatmap: async () => heatmapOf(db),
      live: async () => db.live,
      liveView: async () => undefined,
      places: async () => ({ named: db.places, frequent: frequentPlaces(db, self) }),
      savePlace: async (p) => { const c = { ...p, id: p.id || `p${Date.now()}` }; db.places = [...db.places.filter((x) => x.id !== c.id), c]; changed(); return db.places; },
      removePlace: async (id) => { db.places = db.places.filter((x) => x.id !== id); changed(); return db.places; },
      mergePlaces: async (ids, name) => { const m = mergePlaces(db.places.filter((p) => ids.includes(p.id)), name); db.places = [...db.places.filter((p) => !ids.includes(p.id)), m]; changed(); return db.places; },
      zones: async () => db.zones,
      saveZone: async (z) => { db.zones.push({ ...z, id: z.id || `z${Date.now()}` }); changed(); return db.zones; },
      removeZone: async (id) => { db.zones = db.zones.filter((z) => z.id !== id); changed(); return db.zones; },
      reservations: async () => db.reservations,
      search: async (q) => searchDb(db, self, q),
      export: async (o) => ({ path: null, text: exportAs(o.format, { tracks: db.tracks, stays: o.stays ? allStays(db, self) : [], zones: effectiveZones(db.zones, db.places) }), tracks: db.tracks.length }),
      tile: async () => null,
      connect: async () => ({ ok: false, message: 'Not in the demo' }),
      disconnect: async () => undefined,
      syncNow: async () => ({ ok: true, message: 'Demo: nothing new' }),
      backup: async () => ({ path: null }),
      wipe: async () => { db.tracks = []; db.history = []; db.visits = []; db.photos = []; db.live = []; db.places = []; changed(); },
    },
  };
}
