// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places & Tracks: sports services against recorded JSON, the live receivers
// (OwnTracks over HTTP and MQTT, the OsmAnd protocol, Traccar), booking mails
// and the Find My cache.

import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFindMyCache, findMyPlainOn } from '../core/tracks/findmy';
import { importBytes } from '../core/tracks/importer';
import { jsonLdBlocks, reservationsFrom, reservationsInHtml } from '../core/tracks/jsonld';
import { mqttConnect, mqttPublish, mqttRead, mqttSubscribe, ownTracksWho, parseOsmAnd, parseOwnTracks, traccarPositions } from '../core/tracks/receivers';
import { authorizeUrl, fitbitActivity, fitbitHasGps, polarExercise, readTokens, stravaActivity, stravaRoute } from '../core/tracks/services';
import { parseTcx } from '../core/tracks/files';
import type { LivePosition } from '../core/tracks/types';
import { receiverStatus, startMqtt, startReceiver, stopMqtt, stopReceiver } from '../electron/services/tracks/receivers';

const fx = (n: string) => path.join(__dirname, 'fixtures', 'tracks', n);
const json = (n: string) => JSON.parse(readFileSync(fx(n), 'utf8'));

describe('Strava API v3', () => {
  it('maps an activity with its streams', () => {
    const [a] = json('strava-activities.json');
    const t = stravaActivity(a, json('strava-streams.json'));
    expect(t).toMatchObject({ name: 'Morning Run', sport: 'run', source: 'strava', sourceId: '11880223344' });
    expect(t.start).toBe(Date.parse('2026-05-13T05:00:00Z'));
    expect(t.points).toHaveLength(4);
    expect(t.points[2]).toMatchObject({ hr: 155, ele: 17.8, speed: 3.3, t: t.start + 120_000 });
    expect(t.reported).toMatchObject({ distanceM: 5012.3, movingS: 1560, elapsedS: 1622, ascentM: 38.2, avgHr: 151.2, maxHr: 172 });
  });
  it('falls back to the summary line, and keeps an activity without one by its numbers', () => {
    const [a, b] = json('strava-activities.json');
    const t = stravaActivity(a);
    expect(t.points).toHaveLength(3);
    expect(t.points[0].lat).toBeCloseTo(38.5, 5);
    expect(t.points[2].t - t.points[0].t).toBe(1622_000);
    const r = stravaActivity(b);
    expect(r.sport).toBe('ride');
    expect(r.points).toHaveLength(0);
    expect(r.end - r.start).toBe(3300_000);
  });
  it('maps saved routes as planned', () => {
    const r = stravaRoute(json('strava-routes.json')[0])!;
    expect(r).toMatchObject({ planned: true, name: 'Old town loop', sport: 'run', sourceId: 'route:3344556677' });
    expect(r.reported?.distanceM).toBe(12000.5);
  });
  it('builds the sign-in address and reads tokens', () => {
    const u = new URL(authorizeUrl('strava', '123', 'http://127.0.0.1:5000/callback', 'st'));
    expect(u.origin + u.pathname).toBe('https://www.strava.com/oauth/authorize');
    expect(u.searchParams.get('scope')).toBe('read,activity:read_all');
    const f = new URL(authorizeUrl('fitbit', 'ABC', 'http://127.0.0.1:1/callback', 's', 'chal'));
    expect(f.searchParams.get('code_challenge_method')).toBe('S256');
    const t = readTokens({ access_token: 'a', refresh_token: 'r', expires_at: 1_800_000_000, athlete: { id: 7 } });
    expect(t).toEqual({ access: 'a', refresh: 'r', expiresAt: 1_800_000_000_000, userId: '7' });
    expect(readTokens({ access_token: 'p', expires_in: 3600, x_user_id: 99 }, 0)).toMatchObject({ expiresAt: 3_600_000, userId: '99' });
    expect(() => readTokens({ message: 'Bad Request' })).toThrow('Bad Request');
  });
});

describe('Polar AccessLink', () => {
  it('maps exercises, with the local time offset and ISO durations', () => {
    const [run, gym] = json('polar-exercises.json');
    const t = polarExercise(run);
    expect(t).toMatchObject({ sport: 'run', source: 'polar', sourceId: 'Ab12Cd' });
    expect(t.start).toBe(Date.parse('2026-05-13T05:00:00Z'));
    expect(t.reported).toMatchObject({ elapsedS: 1572, distanceM: 5012, avgHr: 151, maxHr: 172, calories: 312 });
    expect(t.end - t.start).toBe(1572_000);
    const g = polarExercise(gym);
    expect(g.sport).toBe('other');
    expect(g.start).toBe(Date.parse('2026-05-12T18:00:00Z'));
  });
});

describe('Fitbit Web API', () => {
  it('maps the activity log, in kilometres or miles, with GPS from TCX', () => {
    const { activities } = json('fitbit-activities.json');
    expect(fitbitHasGps(activities[0])).toBe(true);
    expect(fitbitHasGps(activities[1])).toBe(false);
    const pts = parseTcx(readFileSync(fx('run.tcx'), 'utf8'), 'fitbit').tracks[0].points;
    const t = fitbitActivity(activities[0], pts);
    expect(t).toMatchObject({ sport: 'run', source: 'fitbit', sourceId: '59911223344' });
    expect(t.points).toHaveLength(6);
    expect(t.reported).toMatchObject({ elapsedS: 1622, movingS: 1560, avgHr: 149, calories: 330, ascentM: 36.6 });
    expect(t.reported!.distanceM).toBeCloseTo(5012, 0);
    const bike = fitbitActivity(activities[1]);
    expect(bike.sport).toBe('ride');
    expect(bike.reported!.distanceM).toBeCloseTo(9656.06, 1);
    expect(bike.start).toBe(Date.parse('2026-05-11T15:00:00Z'));
  });
});

describe('booking mails (schema.org JSON-LD)', () => {
  it('reads a flight, a hotel and an event from a quoted-printable mail', () => {
    const r = importBytes('booking.eml', new Uint8Array(readFileSync(fx('booking.eml'))));
    expect(r.reservations).toHaveLength(3);
    const f = r.reservations.find((x) => x.kind === 'flight')!;
    expect(f).toMatchObject({ name: 'XA212 BER → TLL', from: 'BER', to: 'TLL', confirmation: 'K3PL9Q', provider: 'Example Air', lat: 59.4133 });
    expect(f.start).toBe(Date.parse('2026-05-12T08:00:00Z'));
    const h = r.reservations.find((x) => x.kind === 'lodging')!;
    expect(h).toMatchObject({ name: 'Hotel Telegraaf', address: 'Vene 9, Tallinn, 10123, EE', lat: 59.4372 });
    expect(h.end).toBe(Date.parse('2026-05-14T08:00:00Z'));
    const e = r.reservations.find((x) => x.kind === 'event')!;
    expect(e).toMatchObject({ name: 'Organ concert', address: 'Lai 50, Tallinn' });
  });
  it('reads other kinds, skips what is not a reservation and does not repeat itself', () => {
    const rental = { '@type': 'RentalCarReservation', reservationNumber: 'C1', reservationFor: { '@type': 'Car', brand: { name: 'Example Cars' } }, pickupTime: '2026-06-01T10:00:00Z', dropoffTime: '2026-06-03T10:00:00Z', pickupLocation: { name: 'Airport', address: { streetAddress: 'Terminal 1', addressLocality: 'Lisbon' } } };
    const train = { '@type': 'https://schema.org/TrainReservation', reservationFor: { '@type': 'TrainTrip', trainNumber: 'ICE 1', departureStation: { name: 'Berlin Hbf' }, arrivalStation: { name: 'München Hbf' }, departureTime: '2026-06-05T08:00:00+02:00' } };
    const r = reservationsFrom([[rental, rental], { '@type': 'Order' }, train]);
    expect(r.map((x) => x.kind)).toEqual(['rental', 'train']);
    expect(r[0]).toMatchObject({ name: 'Example Cars', address: 'Terminal 1, Lisbon' });
    expect(r[1].name).toBe('ICE 1 Berlin Hbf → München Hbf');
    expect(jsonLdBlocks('<script type="application/ld+json">{ not json</script>')).toEqual([]);
    expect(reservationsInHtml('<p>nothing</p>')).toEqual([]);
  });
});

describe('Find My cache (macOS)', () => {
  it('reads plain JSON items and devices', () => {
    const items = readFindMyCache(new Uint8Array(readFileSync(fx('findmy-Items.data'))), 'item');
    expect(items.state).toBe('ok');
    if (items.state !== 'ok') return;
    expect(items.positions).toHaveLength(1);
    expect(items.positions[0]).toMatchObject({ name: 'Keys', kind: 'item', source: 'findmy', lat: 52.5209, acc: 8.5, address: 'Alexanderplatz 1, 10178 Berlin, Germany', t: 1778760000000 });
    const dev = readFindMyCache(new Uint8Array(readFileSync(fx('findmy-Devices.data'))), 'device');
    expect(dev.state === 'ok' && dev.positions[0]).toMatchObject({ name: 'Alex’s MacBook Air', kind: 'device', battery: 87, charging: true });
  });
  it('says when macOS has encrypted the cache, and knows which versions do', () => {
    expect(readFindMyCache(new Uint8Array(readFileSync(fx('findmy-encrypted.data'))), 'item').state).toBe('encrypted');
    expect(readFindMyCache(new Uint8Array([0x00, 0x13, 0x88, 0x91]), 'item').state).toBe('encrypted');
    expect(findMyPlainOn('14.3.1')).toBe(true);
    expect(findMyPlainOn('14.4')).toBe(false);
    expect(findMyPlainOn('15.1')).toBe(false);
    expect(findMyPlainOn('13.6')).toBe(true);
    expect(findMyPlainOn('23.3.0', true)).toBe(true);
    expect(findMyPlainOn('23.4.0', true)).toBe(false);
    expect(findMyPlainOn('24.0.0', true)).toBe(false);
  });
});

describe('OwnTracks, OsmAnd and Traccar messages', () => {
  it('reads OwnTracks locations and cards', () => {
    const r = parseOwnTracks('{"_type":"location","lat":52.52,"lon":13.4,"tst":1778760000,"acc":12,"batt":64,"bs":2,"vel":18,"tid":"AX"}', 'alex/phone');
    expect(r.position).toMatchObject({ id: 'owntracks:alex/phone', name: 'AX', kind: 'phone', t: 1778760000000, acc: 12, battery: 64, charging: true, speed: 5 });
    expect(parseOwnTracks({ _type: 'card', name: 'Alex' }, 'alex/phone').card).toEqual({ id: 'owntracks:alex/phone', name: 'Alex' });
    expect(parseOwnTracks({ _type: 'transition' }, 'x/y')).toEqual({});
    expect(parseOwnTracks('not json', 'x/y')).toEqual({});
    expect(parseOwnTracks({ _type: 'location', lat: 999, lon: 1 }, 'x/y')).toEqual({});
    expect(ownTracksWho('owntracks/alex/phone')).toBe('alex/phone');
    expect(ownTracksWho('owntracks/alex/phone/event')).toBeUndefined();
    expect(ownTracksWho('home/ot/alex/phone', 'home/ot')).toBe('alex/phone');
  });
  it('reads the OsmAnd protocol as a query and as Traccar Client JSON', () => {
    const q = parseOsmAnd(new URLSearchParams('id=123456&lat=59.43&lon=24.75&timestamp=1778760000&speed=10&batt=80&accuracy=5'))!;
    expect(q).toMatchObject({ id: 'osmand:123456', kind: 'tracker', t: 1778760000000, battery: 80, acc: 5 });
    expect(q.speed).toBeCloseTo(5.14444, 4);
    expect(parseOsmAnd(new URLSearchParams('id=1&lat=x&lon=1'))).toBeUndefined();
    const j = parseOsmAnd({ device_id: 'tc1', location: { timestamp: '2026-05-14T12:00:00Z', coords: { latitude: 60.17, longitude: 24.94, accuracy: 7, speed: 1.2 }, battery: { level: 0.42, is_charging: false } } })!;
    expect(j).toMatchObject({ id: 'osmand:tc1', battery: 42, charging: false, speed: 1.2, t: Date.parse('2026-05-14T12:00:00Z') });
  });
  it('maps a Traccar server’s devices and positions', () => {
    const r = traccarPositions([{ id: 1, name: 'Van', category: 'van' }, { id: 2, name: 'Grandpa', category: 'person' }], [
      { id: 10, deviceId: 1, latitude: 52.5, longitude: 13.4, fixTime: '2026-05-14T12:00:00.000+00:00', speed: 20, accuracy: 0, attributes: { batteryLevel: 77 } },
      { id: 11, deviceId: 2, latitude: 48.1, longitude: 11.5, fixTime: '2026-05-14T12:01:00.000+00:00', address: 'Marienplatz' },
    ]);
    expect(r[0]).toMatchObject({ id: 'traccar:1', name: 'Van', kind: 'tracker', battery: 77 });
    expect(r[0].speed).toBeCloseTo(10.29, 2);
    expect(r[1]).toMatchObject({ kind: 'person', address: 'Marienplatz' });
  });
});

describe('MQTT packets', () => {
  it('encodes CONNECT and SUBSCRIBE and reads packets across chunk boundaries', () => {
    const c = mqttConnect({ clientId: 'k', username: 'u', password: 'p', keepAlive: 60 });
    expect([...c.subarray(0, 2)]).toEqual([0x10, c.length - 2]);
    expect(new TextDecoder().decode(c.subarray(4, 8))).toBe('MQTT');
    expect(c[9]).toBe(0x80 | 0x40 | 0x02);
    const s = mqttSubscribe(1, ['owntracks/#'], 1);
    expect(s[0]).toBe(0x82);
    const big = 'x'.repeat(300);
    const pub = mqttPublish('owntracks/a/b', big, 1, 7);
    const all = new Uint8Array([0x20, 2, 0, 0, ...pub, 0xd0, 0]);
    const first = mqttRead(all.subarray(0, 10));
    expect(first.packets).toEqual([{ type: 'connack', code: 0 }]);
    const rest = new Uint8Array([...first.rest, ...all.subarray(10)]);
    const second = mqttRead(rest);
    expect(second.packets[0]).toMatchObject({ type: 'publish', topic: 'owntracks/a/b', qos: 1, id: 7 });
    expect((second.packets[0] as { payload: Uint8Array }).payload.length).toBe(300);
    expect(second.packets[1]).toEqual({ type: 'pingresp' });
  });
});

describe('live receivers', () => {
  afterEach(async () => { await stopReceiver(); stopMqtt(); });
  const port = () => 20000 + Math.floor(Math.random() * 20000);

  it('takes OwnTracks and OsmAnd posts with the token, refuses without it', async () => {
    const got: LivePosition[] = [];
    const p = port();
    await startReceiver({ port: p, lan: false, token: 'tok', ownTracks: true, osmand: true, onPosition: (x) => got.push(x), onName: () => undefined });
    expect(receiverStatus()).toMatchObject({ running: true, url: `http://127.0.0.1:${p}` });
    const base = `http://127.0.0.1:${p}`;
    const body = JSON.stringify({ _type: 'location', lat: 52.52, lon: 13.4, tst: 1778760000, tid: 'AX' });
    expect((await fetch(`${base}/owntracks`, { method: 'POST', body })).status).toBe(401);
    const ok = await fetch(`${base}/owntracks`, { method: 'POST', body, headers: { authorization: `Basic ${Buffer.from('alex:tok').toString('base64')}`, 'x-limit-u': 'alex', 'x-limit-d': 'phone', 'content-type': 'application/json' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([]);
    expect((await fetch(`${base}/?id=77&lat=59.4&lon=24.7&token=tok`)).status).toBe(200);
    expect((await fetch(`${base}/osmand?id=77&lat=bad&lon=24.7&token=tok`)).status).toBe(400);
    expect(got.map((x) => x.id)).toEqual(['owntracks:alex/phone', 'osmand:77']);
  });

  it('answers 404 for a receiver that is switched off', async () => {
    const p = port();
    await startReceiver({ port: p, lan: false, token: 't', ownTracks: false, osmand: true, onPosition: () => undefined, onName: () => undefined });
    expect((await fetch(`http://127.0.0.1:${p}/owntracks?token=t`, { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('subscribes to an MQTT broker and receives OwnTracks positions', async () => {
    // A tiny broker stand-in: accepts CONNECT, answers SUBACK, then publishes one location (QoS 1).
    const seen: string[] = [];
    let puback = false;
    const broker = net.createServer((sock) => {
      sock.on('data', (d) => {
        const type = d[0] >> 4;
        if (type === 1) {
          seen.push('connect');
          sock.write(Uint8Array.from([0x20, 2, 0, 0]));
        } else if (type === 8) {
          seen.push('subscribe');
          sock.write(Uint8Array.from([0x90, 3, 0, 1, 1]));
          sock.write(mqttPublish('owntracks/alex/phone', JSON.stringify({ _type: 'location', lat: 60.17, lon: 24.94, tst: 1778760000, batt: 50 }), 1, 9));
        } else if (type === 4) puback = true;
      });
    });
    await new Promise<void>((r) => broker.listen(0, '127.0.0.1', () => r()));
    const bport = (broker.address() as net.AddressInfo).port;
    const pos = await new Promise<LivePosition>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no position')), 5000);
      startMqtt({ host: '127.0.0.1', port: bport, tls: false, user: 'u', password: 'p', topic: 'owntracks/#', onPosition: (x) => { clearTimeout(timer); resolve(x); }, onName: () => undefined, onError: (m) => m && reject(new Error(m)) });
    });
    expect(pos).toMatchObject({ id: 'owntracks:alex/phone', source: 'mqtt', battery: 50, lat: 60.17 });
    await new Promise((r) => setTimeout(r, 100));
    expect(seen).toEqual(['connect', 'subscribe']);
    expect(puback).toBe(true);
    stopMqtt();
    broker.close();
  });
});

describe('your paired devices (Keeper Link)', () => {
  it('gives Link this device’s position: the newest of phone and your own trackers, else Home', async () => {
    const { emptyDb, ownPositionOf, fromLinkPosition } = await import('../core/tracks/db');
    const now = Date.parse('2026-05-14T12:00:00Z');
    const db = emptyDb();
    expect(ownPositionOf(db, [], now)).toBeNull();
    db.places.push({ id: 'h', name: 'Home', lat: 52.52, lon: 13.4, radiusM: 120, kind: 'home' });
    expect(ownPositionOf(db, [], now)).toEqual({ lat: 52.52, lon: 13.4, acc: 120, t: now });
    db.live.push({ id: 'phone:c1', name: 'Pixel', kind: 'phone', source: 'phone', t: now - 5 * 60_000, lat: 59.43, lon: 24.75, acc: 9, battery: 50 });
    db.live.push({ id: 'owntracks:a/b', name: 'Other', kind: 'phone', source: 'owntracks', t: now - 60_000, lat: 1, lon: 1 });
    expect(ownPositionOf(db, [], now)).toMatchObject({ lat: 59.43, acc: 9, battery: 50 });
    expect(ownPositionOf(db, ['owntracks:a/b'], now)).toMatchObject({ lat: 1 });
    // A stale phone position does not count: back to Home.
    expect(ownPositionOf(db, [], now + 2 * 3600_000)).toMatchObject({ lat: 52.52 });
    expect(fromLinkPosition({ device: 'd1', name: 'Desk', lat: 1, lon: 2, t: 3 })).toEqual({ id: 'link:d1', name: 'Desk', kind: 'device', source: 'link', t: 3, lat: 1, lon: 2 });
  });
});

describe('bookings from the mailbox', () => {
  it('reads JSON-LD blocks the mail service hands over, only when mail is set up', async () => {
    const { bookingsFromMail, jsonLdBlocks } = await import('../core/tracks/jsonld');
    const raw = readFileSync(fx('booking.eml'), 'utf8').replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    const blocks = jsonLdBlocks(raw).map((v) => JSON.stringify(v));
    const opened: string[] = [];
    const reader = {
      accounts: async () => [{ mail: true }],
      messages: async (v: { query: string }) => ({ messages: v.query === 'booking' || v.query === 'reservation' ? [{ id: 'm1' }, { id: 'm2' }] : [] }),
      structuredData: async (id: string) => { opened.push(id); return id === 'm1' ? blocks : ['{ broken']; },
    };
    const r = await bookingsFromMail(reader);
    expect(r.map((x) => x.kind).sort()).toEqual(['event', 'flight', 'lodging']);
    expect(opened).toEqual(['m1', 'm2']); // each message once
    expect(await bookingsFromMail({ ...reader, accounts: async () => [] })).toEqual([]);
    expect(await bookingsFromMail({ ...reader, accounts: async () => [{ mail: false }] })).toEqual([]);
  });
});
