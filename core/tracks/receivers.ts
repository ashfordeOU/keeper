// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Live positions people send to their own computer: OwnTracks (HTTP and MQTT,
// an open protocol), the OsmAnd/Traccar HTTP protocol that most GPS trackers
// and the Traccar Client app speak, and a Traccar server's REST API. Pure
// parsing and the few MQTT 3.1.1 packets a subscriber needs; the sockets live
// in electron/services/tracks/receivers.ts.

import { validLL } from './geo';
import type { LiveKind, LivePosition } from './types';
import { parseTime } from './util';

type J = Record<string, unknown>;
const num = (v: unknown) => {
  const x = typeof v === 'string' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
};

// ---------------------------------------------------------------- OwnTracks

export interface OwnTracksResult {
  position?: LivePosition;
  /** a "card" message: the name (and picture) for a tracker id */
  card?: { id: string; name: string };
}

/**
 * One OwnTracks message. `who` is "user/device" from the MQTT topic
 * (owntracks/user/device) or the HTTP X-Limit-U / X-Limit-D headers.
 */
export function parseOwnTracks(body: unknown, who: string): OwnTracksResult {
  const j = (typeof body === 'string' ? safeJson(body) : body) as J | undefined;
  if (!j || typeof j !== 'object') return {};
  const id = `owntracks:${who || String(j.tid ?? 'phone')}`;
  if (j._type === 'card' && typeof j.name === 'string') return { card: { id, name: j.name } };
  if (j._type !== 'location') return {};
  const lat = num(j.lat), lon = num(j.lon);
  if (!validLL(lat, lon)) return {};
  const tst = num(j.tst);
  const bs = num(j.bs);
  const vel = num(j.vel);
  const p: LivePosition = {
    id,
    name: String(j.tid ?? who.split('/').pop() ?? 'Phone'),
    kind: 'phone',
    source: 'owntracks',
    t: tst ? tst * 1000 : Date.now(),
    lat: lat!,
    lon: lon!,
  };
  const acc = num(j.acc), batt = num(j.batt);
  if (acc !== undefined) p.acc = acc;
  if (batt !== undefined) p.battery = batt;
  if (bs !== undefined) p.charging = bs === 2 || bs === 3;
  // OwnTracks reports km/h.
  if (vel !== undefined) p.speed = vel / 3.6;
  return { position: p };
}

/** "user/device" from an OwnTracks topic, or undefined when it is not one. */
export function ownTracksWho(topic: string, base = 'owntracks'): string | undefined {
  const parts = topic.split('/');
  const b = base.split('/').filter(Boolean);
  if (parts.length !== b.length + 2 || b.some((x, i) => parts[i] !== x)) return undefined;
  return `${parts[b.length]}/${parts[b.length + 1]}`;
}

// ---------------------------------------------------------------- OsmAnd / Traccar Client

/**
 * The OsmAnd protocol: `?id=…&lat=…&lon=…&timestamp=…&speed=…&batt=…` as a
 * query string or form body, or the newer Traccar Client JSON body. Speed in
 * the query form is in knots (Traccar's convention), in the JSON form m/s.
 */
export function parseOsmAnd(query: URLSearchParams | J, now = Date.now()): LivePosition | undefined {
  if (!(query instanceof URLSearchParams)) {
    const loc = (query.location ?? {}) as J;
    const c = (loc.coords ?? {}) as J;
    const lat = num(c.latitude), lon = num(c.longitude);
    const id = String(query.device_id ?? query.deviceId ?? '');
    if (!id || !validLL(lat, lon)) return undefined;
    const batt = (loc.battery ?? {}) as J;
    const t = parseTime(loc.timestamp as string);
    const level = num(batt.level);
    return clean<LivePosition>({ id: `osmand:${id}`, name: id, kind: 'tracker', source: 'osmand', t: Number.isFinite(t) ? t : now, lat: lat!, lon: lon!, acc: num(c.accuracy), speed: num(c.speed), battery: level === undefined ? undefined : level <= 1 ? Math.round(level * 100) : level, charging: typeof batt.is_charging === 'boolean' ? batt.is_charging : undefined });
  }
  const q = query;
  const id = q.get('id') ?? q.get('deviceid');
  const lat = num(q.get('lat')), lon = num(q.get('lon'));
  if (!id || !validLL(lat, lon)) return undefined;
  const ts = q.get('timestamp');
  const t = ts ? parseTime(/^\d+$/.test(ts) ? Number(ts) : ts) : now;
  const knots = num(q.get('speed'));
  return clean<LivePosition>({ id: `osmand:${id}`, name: id, kind: 'tracker', source: 'osmand', t: Number.isFinite(t) ? t : now, lat: lat!, lon: lon!, acc: num(q.get('accuracy') ?? q.get('hdop')), speed: knots === undefined ? undefined : knots * 0.514444, battery: num(q.get('batt') ?? q.get('battery')) });
}

// ---------------------------------------------------------------- Traccar server REST API

/** GET /api/devices and GET /api/positions → live positions. */
export function traccarPositions(devices: J[], positions: J[]): LivePosition[] {
  const byId = new Map(devices.map((d) => [Number(d.id), d]));
  const out: LivePosition[] = [];
  for (const p of positions) {
    const d = byId.get(Number(p.deviceId));
    const lat = num(p.latitude), lon = num(p.longitude);
    if (!validLL(lat, lon)) continue;
    const a = (p.attributes ?? {}) as J;
    const cat = String(d?.category ?? '');
    const kind: LiveKind = /person/.test(cat) ? 'person' : /car|truck|bus|motorcycle|bicycle|boat|van/.test(cat) ? 'tracker' : /animal|pet/.test(cat) ? 'item' : 'tracker';
    const knots = num(p.speed);
    out.push(clean<LivePosition>({ id: `traccar:${p.deviceId}`, name: String(d?.name ?? p.deviceId), kind, source: 'osmand', t: parseTime((p.fixTime ?? p.deviceTime ?? p.serverTime) as string), lat: lat!, lon: lon!, acc: num(p.accuracy) || undefined, speed: knots === undefined ? undefined : knots * 0.514444, battery: num(a.batteryLevel), address: typeof p.address === 'string' ? p.address : undefined }));
  }
  return out;
}

// ---------------------------------------------------------------- MQTT 3.1.1 (just what a subscriber needs)

const enc = new TextEncoder();
const dec = new TextDecoder();

function str(s: string): number[] {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 0xff, ...b];
}

function remaining(len: number): number[] {
  const out: number[] = [];
  do {
    let b = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) b |= 0x80;
    out.push(b);
  } while (len > 0);
  return out;
}

const packet = (type: number, body: number[]) => Uint8Array.from([type, ...remaining(body.length), ...body]);

export function mqttConnect(o: { clientId: string; username?: string; password?: string; keepAlive?: number }): Uint8Array {
  let flags = 0x02; // clean session
  if (o.username) flags |= 0x80;
  if (o.password) flags |= 0x40;
  const ka = o.keepAlive ?? 60;
  const body = [...str('MQTT'), 4, flags, ka >> 8, ka & 0xff, ...str(o.clientId)];
  if (o.username) body.push(...str(o.username));
  if (o.password) body.push(...str(o.password));
  return packet(0x10, body);
}

export function mqttSubscribe(id: number, topics: string[], qos = 0): Uint8Array {
  const body = [id >> 8, id & 0xff];
  for (const t of topics) body.push(...str(t), qos);
  return packet(0x82, body);
}

export const mqttPing = () => Uint8Array.from([0xc0, 0]);
export const mqttDisconnect = () => Uint8Array.from([0xe0, 0]);
export const mqttPuback = (id: number) => Uint8Array.from([0x40, 2, id >> 8, id & 0xff]);

/** For tests and the local broker stand-in: a PUBLISH packet. */
export function mqttPublish(topic: string, payload: string | Uint8Array, qos = 0, id = 1): Uint8Array {
  const p = typeof payload === 'string' ? enc.encode(payload) : payload;
  const body = [...str(topic), ...(qos ? [id >> 8, id & 0xff] : []), ...p];
  return packet(0x30 | (qos << 1), body);
}

export type MqttPacket =
  | { type: 'connack'; code: number }
  | { type: 'suback'; id: number; granted: number[] }
  | { type: 'publish'; topic: string; payload: Uint8Array; qos: number; id?: number }
  | { type: 'pingresp' }
  | { type: 'other'; code: number };

/** Splits a byte stream into packets; returns what is left over (a partial packet). */
export function mqttRead(buf: Uint8Array): { packets: MqttPacket[]; rest: Uint8Array } {
  const packets: MqttPacket[] = [];
  let p = 0;
  for (;;) {
    if (buf.length - p < 2) break;
    let len = 0, mul = 1, i = p + 1, ok = false;
    for (let k = 0; k < 4 && i < buf.length; k++, i++) {
      len += (buf[i] & 0x7f) * mul;
      mul *= 128;
      if (!(buf[i] & 0x80)) { ok = true; i++; break; }
    }
    if (!ok || buf.length - i < len) break;
    const h = buf[p];
    const body = buf.subarray(i, i + len);
    const type = h >> 4;
    if (type === 2) packets.push({ type: 'connack', code: body[1] ?? 0 });
    else if (type === 9) packets.push({ type: 'suback', id: (body[0] << 8) | body[1], granted: [...body.subarray(2)] });
    else if (type === 13) packets.push({ type: 'pingresp' });
    else if (type === 3) {
      const qos = (h >> 1) & 3;
      const tl = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tl));
      let o = 2 + tl;
      let id: number | undefined;
      if (qos) { id = (body[o] << 8) | body[o + 1]; o += 2; }
      packets.push({ type: 'publish', topic, payload: body.slice(o), qos, id });
    } else packets.push({ type: 'other', code: type });
    p = i + len;
  }
  return { packets, rest: buf.slice(p) };
}

export const CONNACK_ERRORS: Record<number, string> = { 1: 'The broker does not speak MQTT 3.1.1', 2: 'The broker refused the client id', 3: 'The broker is unavailable', 4: 'Wrong user name or password', 5: 'Not allowed to connect' };

// ---------------------------------------------------------------- helpers

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
