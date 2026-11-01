// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where Places & Tracks keeps things: <userData>/tracks/. Settings in
// config.json (no locations in it); every location, track and place in
// data.bin, encrypted with AES-256-GCM under a key held by the system keychain.
// Nothing is read from disk until something asks for it.

import { app } from 'electron';
import crypto from 'node:crypto';
import { existsSync, promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DeepPartial, TracksConfig } from '../../../core/tracks/api';
import { defaultConfig, mergeConfig } from '../../../core/tracks/config';
import { emptyDb, normalizeDb, type TracksDb } from '../../../core/tracks/db';
import { open, seal } from '../../../core/tracks/vault';
import { getSecret, setSecret } from '../../store';

export const dir = () => path.join(app.getPath('userData'), 'tracks');
const configFile = () => path.join(dir(), 'config.json');
const dataFile = () => path.join(dir(), 'data.bin');
const KEY_NAME = 'tracks.dataKey';

let config: TracksConfig | null = null;
let db: TracksDb | null = null;
let key: Buffer | undefined;
let keyChecked = false;
let note: string | undefined;

export function getConfig(): TracksConfig {
  if (config) return config;
  const base = defaultConfig(crypto.randomBytes(12).toString('base64url'));
  try {
    config = mergeConfig(base, JSON.parse(readFileSync(configFile(), 'utf8')));
  } catch {
    config = base;
  }
  return config;
}

export async function patchConfig(patch: DeepPartial<TracksConfig>): Promise<TracksConfig> {
  config = mergeConfig(getConfig(), patch);
  await writeAtomic(configFile(), JSON.stringify(config, null, 2));
  return config;
}

async function ensureKey(): Promise<Buffer | undefined> {
  if (keyChecked) return key;
  keyChecked = true;
  const have = await getSecret(KEY_NAME).catch(() => undefined);
  if (have) {
    key = Buffer.from(have, 'base64');
    return key;
  }
  // A data file sealed with a key that is gone cannot be read: say so instead of overwriting it.
  if (existsSync(dataFile())) {
    const head = readFileSync(dataFile()).subarray(0, 5).toString();
    if (head === 'KTRK1') {
      note = 'The key for your location data is no longer in the system keychain, so it cannot be read. Delete everything to start again.';
      return undefined;
    }
  }
  const fresh = crypto.randomBytes(32);
  if (await setSecret(KEY_NAME, fresh.toString('base64')).catch(() => false)) {
    key = fresh;
    return key;
  }
  note = 'This system has no keychain Keeper can use, so location data is stored unencrypted in your profile folder.';
  return undefined;
}

let loading: Promise<TracksDb> | null = null;
export function getDb(): Promise<TracksDb> {
  if (db) return Promise.resolve(db);
  loading ??= (async () => {
    const k = await ensureKey();
    try {
      const raw = await fsp.readFile(dataFile());
      db = normalizeDb(JSON.parse(open(raw, k)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !note) note = `Your location data could not be read: ${(e as Error).message}`;
      db = emptyDb();
    }
    return db;
  })();
  return loading;
}

export const loaded = () => db;
export const encryption = () => ({ encrypted: !!key, note });

let saveTimer: NodeJS.Timeout | undefined;
let saving: Promise<void> = Promise.resolve();
/** Saves soon (several changes in a row are written once). */
export function saveSoon(ms = 1500) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), ms);
}

export function saveNow(): Promise<void> {
  clearTimeout(saveTimer);
  if (!db) return saving;
  // Never overwrite a file we could not decrypt.
  if (note && /cannot be read|could not be read/.test(note)) return saving;
  const snapshot = JSON.stringify(db);
  saving = saving.then(async () => {
    const k = await ensureKey();
    await writeAtomic(dataFile(), seal(snapshot, k), 0o600);
  }).catch(() => undefined);
  return saving;
}

async function writeAtomic(file: string, data: string | Buffer, mode = 0o644) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data, { mode });
  await fsp.rename(tmp, file);
}

/** One switch deletes everything: data, settings, cached map pictures and the key. */
export async function wipeAll(): Promise<void> {
  clearTimeout(saveTimer);
  await saving;
  db = emptyDb();
  config = null;
  note = undefined;
  key = undefined;
  keyChecked = false;
  loading = null;
  await fsp.rm(dir(), { recursive: true, force: true });
  await setSecret(KEY_NAME, '').catch(() => undefined);
  for (const s of ['tracks.mqtt', 'tracks.traccar', 'tracks.strava', 'tracks.polar', 'tracks.fitbit', 'tracks.strava.tokens', 'tracks.polar.tokens', 'tracks.fitbit.tokens']) await setSecret(s, '').catch(() => undefined);
  db = null;
}
