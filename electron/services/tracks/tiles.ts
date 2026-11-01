// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Map pictures from an OpenStreetMap-style tile server, fetched by the main
// process so each request carries a User-Agent that names Keeper (the OSM
// tile usage policy asks for one), and cached on disk for a week so the same
// tile is not asked for again. Nothing is fetched ahead of time. Only when
// the person turns the online map on; otherwise the map is the offline outline.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { tileUrl } from '../../../core/tracks/geo';
import { dir } from './store';

declare const __KEEPER_OFFICIAL__: boolean | undefined;
const OFFICIAL = typeof __KEEPER_OFFICIAL__ === 'boolean' ? __KEEPER_OFFICIAL__ : false;
const UA = 'Keeper/1 (Places & Tracks; +https://github.com/ashfordeOU/keeper)';
const WEEK = 7 * 86_400_000;
const MAX_CACHE = 200 * 1024 * 1024;

/** A test tile server (KEEPER_TRACKS_TILE_URL), honoured only by unofficial builds. */
export function tileOverride(): string | undefined {
  return !OFFICIAL ? process.env.KEEPER_TRACKS_TILE_URL || undefined : undefined;
}

const inflight = new Map<string, Promise<Uint8Array | null>>();
let failures = 0;
let pausedUntil = 0;

export function getTile(template: string, z: number, x: number, y: number): Promise<Uint8Array | null> {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > 19 || y < 0 || y >= 2 ** z) return Promise.resolve(null);
  const n = 2 ** z;
  const wx = ((x % n) + n) % n;
  const tpl = tileOverride() ?? template;
  const host = (() => { try { return new URL(tpl.replace(/\{[a-z]\}/g, '0')).host.replace(/[^\w.-]/g, '_'); } catch { return 'tiles'; } })();
  const file = path.join(dir(), 'tiles', host, String(z), String(wx), `${y}.png`);
  const key = file;
  const have = inflight.get(key);
  if (have) return have;
  const p = (async () => {
    try {
      const st = await fsp.stat(file);
      if (Date.now() - st.mtimeMs < WEEK) return new Uint8Array(await fsp.readFile(file));
    } catch { /* not cached */ }
    // After several failures in a row (offline), stop asking for a minute.
    if (Date.now() < pausedUntil) return readStale(file);
    try {
      const r = await fetch(tileUrl(tpl, z, wx, y), { headers: { 'user-agent': UA, accept: 'image/png,image/*' }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(String(r.status));
      const buf = new Uint8Array(await r.arrayBuffer());
      failures = 0;
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, buf);
      cacheBytes += buf.length;
      if (cacheBytes > MAX_CACHE) void trim();
      return buf;
    } catch {
      if (++failures >= 6) pausedUntil = Date.now() + 60_000;
      return readStale(file);
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function readStale(file: string): Promise<Uint8Array | null> {
  try { return new Uint8Array(await fsp.readFile(file)); } catch { return null; }
}

let cacheBytes = 0;
/** Keeps the cache under its size: the oldest pictures go first. */
async function trim() {
  const root = path.join(dir(), 'tiles');
  const files: { p: string; t: number; s: number }[] = [];
  const walk = async (d: string) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else { const st = await fsp.stat(p).catch(() => null); if (st) files.push({ p, t: st.mtimeMs, s: st.size }); }
    }
  };
  await walk(root);
  files.sort((a, b) => a.t - b.t);
  let total = files.reduce((s, f) => s + f.s, 0);
  for (const f of files) {
    if (total < MAX_CACHE * 0.7) break;
    await fsp.rm(f.p, { force: true });
    total -= f.s;
  }
  cacheBytes = total;
}
