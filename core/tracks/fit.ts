// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// FIT, the binary activity format of Garmin, Wahoo, Suunto, Polar, Coros and
// most bike computers. Reads file_id, session and record messages (position,
// altitude, heart rate, cadence, speed, power); everything else is skipped.
// Written from the public FIT protocol description; no outside library.

import { finishTrack } from './stats';
import { emptyImport, type ImportResult, type Point, type SourceKind } from './types';
import { hashId, sportFrom } from './util';

/** Seconds between 1970-01-01 and the FIT epoch, 1989-12-31 00:00 UTC. */
export const FIT_EPOCH = 631_065_600;
const SEMI = 180 / 2 ** 31;

const SPORTS: Record<number, string> = {
  0: 'generic', 1: 'running', 2: 'cycling', 3: 'transition', 4: 'fitness_equipment', 5: 'swimming', 6: 'basketball', 7: 'soccer', 8: 'tennis',
  10: 'training', 11: 'walking', 12: 'cross_country_skiing', 13: 'alpine_skiing', 14: 'snowboarding', 15: 'rowing', 16: 'mountaineering',
  17: 'hiking', 19: 'paddling', 21: 'e_biking', 23: 'boating', 24: 'driving', 37: 'stand_up_paddleboarding', 41: 'kayaking',
};

/** The FIT CRC-16. */
export function fitCrc(bytes: Uint8Array, start = 0, end = bytes.length): number {
  const T = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
  let crc = 0;
  for (let i = start; i < end; i++) {
    const b = bytes[i];
    let tmp = T[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ T[b & 0xf];
    tmp = T[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ T[(b >> 4) & 0xf];
  }
  return crc;
}

interface FieldDef { num: number; size: number; base: number }
interface Def { little: boolean; global: number; fields: FieldDef[]; devSize: number }

export type FitMessage = { global: number; fields: Record<number, number | string | undefined> };

function readField(v: DataView, off: number, f: FieldDef, little: boolean): number | string | undefined {
  const base = f.base & 0x1f;
  // Arrays (size larger than the type) are read as their first element; strings whole.
  try {
    switch (base) {
      case 0x00: case 0x02: case 0x0a: case 0x0d: { const x = v.getUint8(off); return x === 0xff && base !== 0x0a ? undefined : x === 0 && base === 0x0a ? undefined : x; }
      case 0x01: { const x = v.getInt8(off); return x === 0x7f ? undefined : x; }
      case 0x03: { if (f.size < 2) return undefined; const x = v.getInt16(off, little); return x === 0x7fff ? undefined : x; }
      case 0x04: { if (f.size < 2) return undefined; const x = v.getUint16(off, little); return x === 0xffff ? undefined : x; }
      case 0x0b: { if (f.size < 2) return undefined; const x = v.getUint16(off, little); return x === 0 ? undefined : x; }
      case 0x05: { if (f.size < 4) return undefined; const x = v.getInt32(off, little); return x === 0x7fffffff ? undefined : x; }
      case 0x06: { if (f.size < 4) return undefined; const x = v.getUint32(off, little); return x === 0xffffffff ? undefined : x; }
      case 0x0c: { if (f.size < 4) return undefined; const x = v.getUint32(off, little); return x === 0 ? undefined : x; }
      case 0x08: { if (f.size < 4) return undefined; const x = v.getFloat32(off, little); return Number.isFinite(x) ? x : undefined; }
      case 0x09: { if (f.size < 8) return undefined; const x = v.getFloat64(off, little); return Number.isFinite(x) ? x : undefined; }
      case 0x07: {
        let s = '';
        for (let i = 0; i < f.size; i++) {
          const c = v.getUint8(off + i);
          if (!c) break;
          s += String.fromCharCode(c);
        }
        try { s = decodeURIComponent(escape(s)); } catch { /* not UTF-8: keep as read */ }
        return s || undefined;
      }
      default: return undefined;
    }
  } catch {
    return undefined;
  }
}

/** Every data message in the file, in order. Throws on a file that is not FIT. */
export function readFitMessages(bytes: Uint8Array, wanted?: Set<number>): FitMessage[] {
  if (bytes.length < 14) throw new Error('This file is too short to be a FIT file.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = bytes[0];
  if ((headerSize !== 12 && headerSize !== 14) || String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) !== '.FIT') throw new Error('This is not a FIT file.');
  const dataSize = v.getUint32(4, true);
  const end = Math.min(bytes.length, headerSize + dataSize);
  const defs = new Map<number, Def>();
  const out: FitMessage[] = [];
  let p = headerSize;
  let lastTs = 0;
  while (p < end) {
    const h = bytes[p++];
    if (h & 0x80) {
      // Compressed timestamp header: local type in bits 5-6, a 5-bit time offset.
      const local = (h >> 5) & 0x3;
      const offset = h & 0x1f;
      const def = defs.get(local);
      if (!def) throw new Error('This FIT file is damaged (data before its definition).');
      const ts = (lastTs & ~0x1f) + offset + ((offset < (lastTs & 0x1f)) ? 0x20 : 0);
      lastTs = ts;
      const m = readData(v, p, def, wanted);
      p += def.fields.reduce((s, f) => s + f.size, 0) + def.devSize;
      if (m) {
        m.fields[253] ??= ts;
        out.push(m);
      }
      continue;
    }
    const local = h & 0x0f;
    if (h & 0x40) {
      // Definition message.
      p++; // reserved
      const little = bytes[p++] === 0;
      const global = little ? v.getUint16(p, true) : v.getUint16(p, false);
      p += 2;
      const n = bytes[p++];
      const fields: FieldDef[] = [];
      for (let i = 0; i < n; i++, p += 3) fields.push({ num: bytes[p], size: bytes[p + 1], base: bytes[p + 2] });
      let devSize = 0;
      if (h & 0x20) {
        const dn = bytes[p++];
        for (let i = 0; i < dn; i++, p += 3) devSize += bytes[p + 1];
      }
      defs.set(local, { little, global, fields, devSize });
      continue;
    }
    const def = defs.get(local);
    if (!def) throw new Error('This FIT file is damaged (data before its definition).');
    const m = readData(v, p, def, wanted);
    p += def.fields.reduce((s, f) => s + f.size, 0) + def.devSize;
    if (m) {
      const ts = m.fields[253];
      if (typeof ts === 'number') lastTs = ts;
      out.push(m);
    }
  }
  return out;
}

function readData(v: DataView, p: number, def: Def, wanted?: Set<number>): FitMessage | undefined {
  if (wanted && !wanted.has(def.global)) return undefined;
  const fields: FitMessage['fields'] = {};
  let off = p;
  for (const f of def.fields) {
    if (off + f.size <= v.byteLength) fields[f.num] = readField(v, off, f, def.little);
    off += f.size;
  }
  return { global: def.global, fields };
}

const toMs = (fitSeconds: number) => (fitSeconds + FIT_EPOCH) * 1000;

export function parseFit(bytes: Uint8Array, source: SourceKind = 'fit', name?: string): ImportResult {
  const out = emptyImport('FIT');
  let msgs: FitMessage[];
  try {
    msgs = readFitMessages(bytes, new Set([0, 18, 20]));
  } catch (e) {
    out.warnings.push((e as Error).message);
    return out;
  }
  if (bytes.length >= 14 && bytes[0] === 14) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const hcrc = v.getUint16(12, true);
    if (hcrc && hcrc !== fitCrc(bytes, 0, 12)) out.warnings.push('The FIT header check does not match; read anyway.');
  }
  const fileId = msgs.find((m) => m.global === 0);
  const session = msgs.find((m) => m.global === 18);
  const pts: Point[] = [];
  for (const m of msgs) {
    if (m.global !== 20) continue;
    const f = m.fields;
    const lat = f[0], lon = f[1], ts = f[253];
    if (typeof lat !== 'number' || typeof lon !== 'number' || typeof ts !== 'number') continue;
    const alt = typeof f[78] === 'number' ? f[78] / 5 - 500 : typeof f[2] === 'number' ? f[2] / 5 - 500 : undefined;
    const spd = typeof f[73] === 'number' ? f[73] / 1000 : typeof f[6] === 'number' ? f[6] / 1000 : undefined;
    const p: Point = { t: toMs(ts), lat: lat * SEMI, lon: lon * SEMI };
    if (alt !== undefined) p.ele = Math.round(alt * 10) / 10;
    if (typeof f[3] === 'number') p.hr = f[3];
    if (typeof f[4] === 'number') p.cad = f[4];
    if (spd !== undefined) p.speed = spd;
    if (typeof f[7] === 'number') p.power = f[7];
    pts.push(p);
  }
  const sportNum = session?.fields[5];
  const sport = typeof sportNum === 'number' ? SPORTS[sportNum] ?? 'generic' : 'generic';
  const created = fileId?.fields[4];
  const startS = session?.fields[2] ?? created;
  const reported = session ? {
    elapsedS: typeof session.fields[7] === 'number' ? session.fields[7] / 1000 : undefined,
    movingS: typeof session.fields[8] === 'number' ? session.fields[8] / 1000 : undefined,
    distanceM: typeof session.fields[9] === 'number' ? session.fields[9] / 100 : undefined,
    calories: typeof session.fields[11] === 'number' ? session.fields[11] : undefined,
    avgHr: typeof session.fields[16] === 'number' ? session.fields[16] : undefined,
    maxHr: typeof session.fields[17] === 'number' ? session.fields[17] : undefined,
    ascentM: typeof session.fields[22] === 'number' ? session.fields[22] : undefined,
  } : undefined;
  const sourceId = `${fileId?.fields[3] ?? ''}:${created ?? startS ?? pts[0]?.t ?? ''}`;
  const label = name ?? `${sport.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}${typeof startS === 'number' ? ` ${new Date(toMs(startS)).toISOString().slice(0, 10)}` : ''}`;
  if (pts.length >= 2 || (reported?.elapsedS && typeof startS === 'number')) {
    const start = pts[0]?.t ?? toMs(startS as number);
    out.tracks.push(finishTrack({ id: hashId(`${source}:${sourceId}`), name: label, sport: sportFrom(sport), source, sourceId, points: pts, reported, start, end: pts.length ? undefined : start + (reported?.elapsedS ?? 0) * 1000 }));
  } else out.warnings.push('This FIT file has no activity in it (it may be settings or a course).');
  return out;
}

// ---------------------------------------------------------------- writing (tests and exports)

/** A minimal FIT activity: file_id, records and a session. Used for fixtures and round trips. */
export function writeFit(points: Point[], sport = 1): Uint8Array {
  const body: number[] = [];
  const u8 = (x: number) => body.push(x & 0xff);
  const u16 = (x: number) => { u8(x); u8(x >> 8); };
  const u32 = (x: number) => { u16(x & 0xffff); u16((x >>> 16) & 0xffff); };
  const i32 = (x: number) => u32(x >>> 0);
  const def = (local: number, global: number, fields: [number, number, number][]) => {
    u8(0x40 | local); u8(0); u8(0); u16(global); u8(fields.length);
    for (const f of fields) { u8(f[0]); u8(f[1]); u8(f[2]); }
  };
  const fitTs = (ms: number) => Math.round(ms / 1000) - FIT_EPOCH;
  def(0, 0, [[0, 1, 0x00], [1, 2, 0x84], [4, 4, 0x86]]);
  u8(0); u8(4); u16(255); u32(fitTs(points[0]?.t ?? 0));
  def(1, 20, [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [2, 2, 0x84], [3, 1, 0x02], [6, 2, 0x84]]);
  for (const p of points) {
    u8(1); u32(fitTs(p.t)); i32(Math.round(p.lat / SEMI)); i32(Math.round(p.lon / SEMI));
    u16(p.ele === undefined ? 0xffff : Math.round((p.ele + 500) * 5)); u8(p.hr ?? 0xff); u16(p.speed === undefined ? 0xffff : Math.round(p.speed * 1000));
  }
  def(2, 18, [[253, 4, 0x86], [2, 4, 0x86], [5, 1, 0x00], [7, 4, 0x86]]);
  const first = points[0]?.t ?? 0, last = points[points.length - 1]?.t ?? 0;
  u8(2); u32(fitTs(last)); u32(fitTs(first)); u8(sport); u32(Math.round(last - first));
  const header = [14, 0x10, 0x52, 0x08, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0];
  const size = body.length;
  header[4] = size & 0xff; header[5] = (size >> 8) & 0xff; header[6] = (size >> 16) & 0xff; header[7] = (size >>> 24) & 0xff;
  const h = Uint8Array.from(header);
  const hc = fitCrc(h, 0, 12);
  h[12] = hc & 0xff; h[13] = hc >> 8;
  const all = new Uint8Array(14 + size + 2);
  all.set(h, 0);
  all.set(body, 14);
  const c = fitCrc(all, 0, 14 + size);
  all[14 + size] = c & 0xff;
  all[15 + size] = c >> 8;
  return all;
}
