// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places & Tracks in the main process: imports, the timeline, trips, live
// positions, sports services, exports and privacy. Nothing starts while no
// source is on: no timers, no sockets, nothing read from disk. Every regular
// check goes through the governor and stops when its feature is switched off.

import { app, BrowserWindow, dialog, type MenuItemConstructorOptions } from 'electron';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeepPartial, ImportRecord, MapTrack, ServiceSource, SourceRow, TracksApi, TracksConfig, TracksOverview } from '../../../core/tracks/api';
import { activeSources, SOURCE_CATALOG } from '../../../core/tracks/config';
import { addImport, addLive, fromLinkPosition, ownPositionOf, type OwnPosition, allStays, countryOf, dataRange, frequentPlaces, heatmapOf, recordsOf, searchDb, summaries, timelineView, tripsOf, type TracksDb } from '../../../core/tracks/db';
import { exportAs, EXPORT_EXT, toGeoJson, tripSummaryHtml, type ExportFormat } from '../../../core/tracks/export';
import { findMyPlainOn, readFindMyCache } from '../../../core/tracks/findmy';
import { metres, simplify } from '../../../core/tracks/geo';
import { importBytes, IMPORT_EXTENSIONS, PHOTO_EXT, photoPoint } from '../../../core/tracks/importer';
import { bookingsFromMail } from '../../../core/tracks/jsonld';
import { countryLabel, geoKey, readNominatim, reverseUrl, searchUrl, RateLimiter } from '../../../core/tracks/places';
import { effectiveZones } from '../../../core/tracks/privacy';
import { effectiveStats } from '../../../core/tracks/stats';
import { mergePlaces as mergeNamed } from '../../../core/tracks/timeline';
import { emptyImport, type CalendarStop, type LivePosition, type NamedPlace, type Stay } from '../../../core/tracks/types';
import { featureOn, onFeature } from '../features';
import { pace, poll } from '../governor';
import { registerFindings } from '../guide';
import { getSecret, setSecret } from '../../store';
import { mqttRunning, receiverStatus, startMqtt, startReceiver, stopMqtt, stopReceiver } from './receivers';
import { disconnect as disconnectService, signIn, syncService, traccarLive } from './services';
import { encryption, getConfig, getDb, loaded, patchConfig, saveNow, saveSoon, wipeAll } from './store';
import { getTile, tileOverride } from './tiles';

interface Deps {
  broadcast: (channel: string, ...args: unknown[]) => void;
  /** the tray menu changed (live positions) */
  trayChanged?: () => void;
}

let deps: Deps = { broadcast: () => undefined };
const stops = new Map<string, () => void>();
let findMyState: TracksOverview['findMy'] = { state: process.platform === 'darwin' ? 'off' : 'not-mac', detail: process.platform === 'darwin' ? 'Off' : 'Find My is only on a Mac.' };

const changed = () => deps.broadcast('tracks-changed');
const self = () => getConfig().self;
const live = () => featureOn('tracks') && featureOn('tracksLive');
const services = () => featureOn('tracks') && featureOn('tracksServices');

// ---------------------------------------------------------------- starting and stopping what sources need

function stopPoll(name: string) {
  stops.get(name)?.();
  stops.delete(name);
}

function startPoll(name: string, every: number | (() => number), feature: string | string[], fn: () => unknown, now = true) {
  stopPoll(name);
  const ms = () => (typeof every === 'number' ? every : every());
  stops.set(name, poll(`tracks.${name}`, () => ({ baseMs: ms(), pauseWhenLocked: true, idleFactor: 2, maxMs: Math.max(ms(), 6 * 3600_000) }), fn, { now, feature }));
}

// ---------------------------------------------------------------- your paired devices (Keeper Link)

/** Live views open right now (one per window), so paired devices are asked more often only while someone looks. */
let liveViews = 0;

/** Paired devices are asked only while something shows them: the Live view, the tray or the Island. */
function linkNeeded(): boolean {
  const c = getConfig();
  return featureOn('tracks') && live() && c.sources.link.on && (liveViews > 0 || c.surfaces.tray || c.surfaces.island);
}

function reconfigureLink() {
  if (linkNeeded()) startPoll('link', () => (liveViews > 0 ? 60_000 : 10 * 60_000), ['tracks', 'tracksLive'], pollLink);
  else stopPoll('link');
}

async function pollLink() {
  const { pairedPositions } = await import('../link/location');
  for (const d of await pairedPositions()) {
    onPosition(fromLinkPosition(d));
  }
}

/**
 * Where this device is, for paired devices that may ask (Link answers only when its
 * owner allowed "Share my location" for them): the newest of the companion phone and
 * the live sources marked as you (from the last 30 minutes), else your Home place.
 */
export async function ownPosition(now = Date.now()): Promise<OwnPosition | null> {
  const c = getConfig();
  if (!featureOn('tracks') || !live() || !c.sources.link.on) return null;
  return ownPositionOf(await getDb(), c.self, now);
}

/** Matches what runs to the switches: called on start, on every setting change and feature switch. */
export async function reconfigure(): Promise<void> {
  const c = getConfig();
  const s = c.sources;
  const on = featureOn('tracks');
  // Live receivers: only with "live sharing" on, and each its own switch.
  if (on && live() && (s.ownTracks.on || s.osmand.on)) {
    await startReceiver({ port: s.receiver.port, lan: s.receiver.lan, token: s.receiver.token, ownTracks: s.ownTracks.on, osmand: s.osmand.on, onPosition, onName });
  } else await stopReceiver();
  if (on && live() && s.mqtt.on && s.mqtt.host) {
    if (!mqttRunning()) startMqtt({ host: s.mqtt.host, port: s.mqtt.port, tls: s.mqtt.tls, user: s.mqtt.user, password: await getSecret('tracks.mqtt'), topic: s.mqtt.topic, onPosition: (p) => onPosition(p), onName, onError: (m) => void setSourceError('mqtt', m) });
  } else stopMqtt();
  if (on && live() && s.traccar.on && s.traccar.url) startPoll('traccar', 60_000, ['tracks', 'tracksLive'], pollTraccar);
  else stopPoll('traccar');
  if (on && live() && s.findMy.on && process.platform === 'darwin') startPoll('findmy', 10 * 60_000, ['tracks', 'tracksLive'], readFindMy);
  else { stopPoll('findmy'); if (process.platform === 'darwin') findMyState = { state: 'off', detail: 'Off' }; }
  if (on && s.folders.on && s.folders.paths.length) startPoll('folders', 15 * 60_000, 'tracks', scanFolders);
  else stopPoll('folders');
  if (on && s.photos.on && s.photos.folders.length) startPoll('photos', 6 * 3600_000, 'tracks', scanPhotos);
  else stopPoll('photos');
  if (on && s.mail.on) startPoll('mail', 6 * 3600_000, 'tracks', scanMail, false);
  else stopPoll('mail');
  const svcOn = (['strava', 'polar', 'fitbit'] as const).some((k) => s[k].on && s[k].connected);
  if (on && services() && svcOn) startPoll('services', 6 * 3600_000, ['tracks', 'tracksServices'], syncServices, false);
  else stopPoll('services');
  reconfigureLink();
}

async function setSourceError(id: 'mqtt' | 'traccar', message: string | undefined) {
  if (getConfig().sources[id].error === message) return;
  await patchConfig({ sources: { [id]: { error: message ?? '' } } } as DeepPartial<TracksConfig>);
  changed();
}

// ---------------------------------------------------------------- live positions

let trayTimer: NodeJS.Timeout | undefined;
function onPosition(p: LivePosition) {
  void getDb().then((db) => {
    if (!addLive(db, p)) return;
    saveSoon(5000);
    changed();
    islandFor(db, p);
    clearTimeout(trayTimer);
    trayTimer = setTimeout(() => deps.trayChanged?.(), 3000);
  });
}

function onName(id: string, name: string) {
  void getDb().then((db) => {
    const p = db.live.find((x) => x.id === id);
    if (p) { p.name = name; saveSoon(); changed(); }
  });
}

async function pollTraccar() {
  const s = getConfig().sources.traccar;
  try {
    for (const p of await traccarLive(s.url, s.user)) onPosition(p);
    await setSourceError('traccar', undefined);
  } catch (e) {
    await setSourceError('traccar', (e as Error).message);
  }
}

async function readFindMy() {
  const v = os.release();
  const plain = findMyPlainOn(v, true);
  const base = path.join(os.homedir(), 'Library', 'Caches', 'com.apple.findmy.fmipcore');
  let any = false;
  for (const [file, kind] of [['Items.data', 'item'], ['Devices.data', 'device']] as const) {
    let bytes: Buffer;
    try {
      bytes = await fsp.readFile(path.join(base, file));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      findMyState = code === 'EPERM' || code === 'EACCES'
        ? { state: 'unreadable', detail: 'macOS does not let Keeper read the Find My cache. Allow Keeper under System Settings → Privacy & Security → Full Disk Access, or leave this off.' }
        : { state: 'unreadable', detail: 'No Find My cache yet. Open the Find My app once.' };
      continue;
    }
    const r = readFindMyCache(new Uint8Array(bytes), kind);
    if (r.state === 'encrypted') {
      findMyState = { state: 'encrypted', detail: `macOS ${plain ? '' : '14.4 and later '}encrypts the Find My cache. Keeper does not decrypt it, so items and devices from Find My are not available on this Mac.` };
      continue;
    }
    if (r.state === 'unreadable') { findMyState = { state: 'unreadable', detail: r.reason }; continue; }
    any = true;
    for (const p of r.positions) onPosition(p);
  }
  if (any) findMyState = { state: 'ok', detail: 'Read from the Find My app’s cache (as fresh as the last time Find My was open).' };
  changed();
}

/** The phone companion: positions while the page is open on the phone (Link's companion op hook). */
export function registerTracksCompanion(node: { registerCompanionOp(op: string, fn: (h: Record<string, unknown>, body: Uint8Array, cid: string) => Promise<{ r?: unknown; body?: Uint8Array }>): void; companionName?(cid: string): string | undefined }) {
  node.registerCompanionOp('tracks.position', async (h, _b, cid) => {
    if (!live() || !getConfig().sources.phone.on) throw new Error('Location sharing is off on the computer');
    const lat = Number(h.lat), lon = Number(h.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Bad position');
    onPosition({ id: `phone:${cid}`, name: node.companionName?.(cid) ?? 'Phone', kind: 'phone', source: 'phone', t: Number(h.t) || Date.now(), lat, lon, acc: Number(h.acc) || undefined, battery: Number(h.battery) || undefined });
    return { r: { ok: true } };
  });
}

// ---------------------------------------------------------------- the Island: arriving, or a workout running

const islandState = new Map<string, { kind: 'arriving' | 'workout'; startDist?: number; since: number }>();
function islandFor(db: TracksDb, p: LivePosition) {
  if (!getConfig().surfaces.island) return;
  const home = db.places.find((x) => x.kind === 'home');
  const speed = p.speed ?? 0;
  const prev = islandState.get(p.id);
  // Arriving: moving towards home, within 30 km.
  if (home && (getConfig().self.includes(p.id) || p.kind === 'person' || p.kind === 'phone')) {
    const d = metres(home, p);
    if (speed > 1 && d < 30_000 && d > home.radiusM) {
      const start = prev?.kind === 'arriving' ? prev.startDist ?? d : d;
      islandState.set(p.id, { kind: 'arriving', startDist: Math.max(start, d), since: prev?.since ?? Date.now() });
      const mins = Math.max(1, Math.round(d / speed / 60));
      deps.broadcast('progress', { task: 'arriving', phase: `${p.name} home in ${mins} min`, done: Math.round(Math.max(start, d) - d), total: Math.round(Math.max(start, d)) });
      return;
    }
    if (prev?.kind === 'arriving') {
      islandState.delete(p.id);
      deps.broadcast('progress', { task: 'arriving', phase: `${p.name} is home`, done: 1, total: 1 });
      return;
    }
  }
  // A workout: your own tracker moving at running or riding pace.
  if (getConfig().self.includes(p.id)) {
    if (speed >= 1.8 && speed <= 15) {
      const since = prev?.kind === 'workout' ? prev.since : Date.now();
      islandState.set(p.id, { kind: 'workout', since });
      const mins = (Date.now() - since) / 60_000;
      const sport = speed > 5 ? 'ride' : 'run';
      // Progress against your usual time for this sport (the median of your last ten).
      const usual = db.tracks.filter((t) => t.sport === sport && !t.planned).slice(-10).map((t) => effectiveStats(t).movingS / 60).sort((a, b) => a - b);
      const typical = usual.length ? usual[Math.floor(usual.length / 2)] : 45;
      deps.broadcast('progress', { task: 'workout', phase: `${sport === 'ride' ? 'Ride' : 'Run'} · ${Math.round(mins)} min of your usual ${Math.round(typical)}`, done: Math.min(Math.round(mins), Math.round(typical) - 1), total: Math.round(typical) });
    } else if (prev?.kind === 'workout') {
      islandState.delete(p.id);
      deps.broadcast('progress', { task: 'workout', phase: 'Workout finished', done: 1, total: 1 });
    }
  }
}

// ---------------------------------------------------------------- the tray

/** "Where things are" in the tray menu: devices, items and people with their last-seen time. */
export function trayTracksItems(show: (route?: string) => void): MenuItemConstructorOptions[] {
  if (!featureOn('tracks') || !featureOn('tracksLive') || !getConfig().surfaces.tray) return [];
  const db = loaded();
  if (!db?.live.length) return [];
  const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60_000);
    return m < 1 ? 'now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };
  const items = [...db.live].sort((a, b) => b.t - a.t).slice(0, 12).map((p) => ({
    label: `${p.name} · ${p.address ?? db.geo[geoKey(p)]?.name ?? `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`} · ${ago(p.t)}${p.battery !== undefined ? ` · ${Math.round(p.battery)}%` : ''}`,
    click: () => show(`tracks:live:${p.id}`),
  }));
  return [{ label: 'Where Things Are', submenu: [...items, { type: 'separator' }, { label: 'Places & Tracks…', click: () => show('tracks:live') }] }];
}

// ---------------------------------------------------------------- imports

async function importPath(db: TracksDb, file: string): Promise<{ record: ImportRecord; skipped: number }> {
  const st = await fsp.stat(file);
  if (st.size > 1024 * 1024 * 1024) throw new Error(`${path.basename(file)} is larger than 1 GB.`);
  const bytes = new Uint8Array(await fsp.readFile(file));
  const r = importBytes(path.basename(file), bytes);
  return addImport(db, r, path.basename(file));
}

async function scanFolders() {
  const c = getConfig().sources.folders;
  const db = await getDb();
  const seen = await seenFiles();
  let added = 0;
  for (const root of c.paths) {
    for (const f of await listFiles(root, /\.(fit|gpx|tcx)$/i, 4)) {
      const key = `${f.path}:${f.mtime}:${f.size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await pace('sources');
      try { added += (await importPath(db, f.path)).record.tracks; } catch { /* a damaged file: skip */ }
    }
  }
  await saveSeen(seen);
  if (added) { saveSoon(); changed(); }
}

async function scanPhotos() {
  const c = getConfig().sources.photos;
  const db = await getDb();
  const seen = await seenFiles();
  const r = emptyImport('Photos');
  for (const root of c.folders) {
    for (const f of await listFiles(root, PHOTO_EXT, 6)) {
      const key = `${f.path}:${f.mtime}:${f.size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await pace('sources');
      try {
        const fh = await fsp.open(f.path, 'r');
        const buf = Buffer.alloc(Math.min(f.size, 256 * 1024));
        await fh.read(buf, 0, buf.length, 0);
        await fh.close();
        const p = photoPoint(f.path, new Uint8Array(buf));
        if (p) r.photos.push(p);
      } catch { /* unreadable */ }
    }
  }
  await saveSeen(seen);
  if (r.photos.length) { addImport(db, r, 'Photos'); saveSoon(); changed(); }
}

async function listFiles(root: string, re: RegExp, depth: number): Promise<{ path: string; mtime: number; size: number }[]> {
  const out: { path: string; mtime: number; size: number }[] = [];
  const walk = async (d: string, left: number) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory() && left > 0) await walk(p, left - 1);
      else if (e.isFile() && re.test(e.name)) {
        const st = await fsp.stat(p).catch(() => null);
        if (st) out.push({ path: p, mtime: Math.round(st.mtimeMs), size: st.size });
      }
      if (out.length > 50_000) return;
    }
  };
  await walk(root, depth);
  return out;
}

const seenFile = () => path.join(app.getPath('userData'), 'tracks', 'seen.json');
async function seenFiles(): Promise<Set<string>> {
  try { return new Set(JSON.parse(await fsp.readFile(seenFile(), 'utf8')) as string[]); } catch { return new Set(); }
}
async function saveSeen(s: Set<string>) {
  await fsp.mkdir(path.dirname(seenFile()), { recursive: true });
  await fsp.writeFile(seenFile(), JSON.stringify([...s].slice(-100_000)));
}

// ---------------------------------------------------------------- mail and calendar (read-only, only if set up)

async function scanMail() {
  // Read-only, and only when a mail account is set up: the raw JSON-LD of booking-like messages.
  const mod = await import('../pim');
  const db = await getDb();
  const r = emptyImport('Mail');
  r.reservations.push(...await bookingsFromMail({ accounts: () => mod.pim.accounts() as Promise<{ mail?: boolean }[]>, messages: (v) => mod.pim.messages(v), structuredData: mod.structuredData }, () => pace('sources')));
  if (r.reservations.length) { addImport(db, r, 'Mail'); saveSoon(); changed(); }
}

async function calendarStops(from: number, to: number): Promise<CalendarStop[]> {
  if (!getConfig().sources.calendar.on || !featureOn('calendars')) return [];
  try {
    const { pim } = await import('../pim');
    const occ = await pim.occurrences(Math.max(from, to - 2 * 365 * 86_400_000), to);
    return occ.filter((o) => o.event.location).map((o) => ({ id: `${o.event.id}:${o.start}`, title: o.event.title, start: o.start, end: o.end, location: o.event.location! }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- services

async function syncServices(): Promise<string> {
  const c = getConfig();
  const db = await getDb();
  const msgs: string[] = [];
  for (const svc of ['strava', 'polar', 'fitbit'] as const) {
    const s = c.sources[svc];
    if (!s.on || !s.connected) continue;
    try {
      const have = new Set(db.tracks.filter((t) => t.source === svc).map((t) => t.sourceId ?? ''));
      const list = await syncService(svc, s.clientId, s.lastSync ? s.lastSync - 86_400_000 : 0, have);
      const r = emptyImport(svc);
      r.tracks.push(...list);
      const { record } = addImport(db, r, svc);
      msgs.push(`${svc}: ${record.tracks} new`);
      await patchConfig({ sources: { [svc]: { lastSync: Date.now(), error: '' } } } as DeepPartial<TracksConfig>);
    } catch (e) {
      msgs.push(`${svc}: ${(e as Error).message}`);
      await patchConfig({ sources: { [svc]: { error: (e as Error).message } } } as DeepPartial<TracksConfig>);
    }
  }
  saveSoon();
  changed();
  return msgs.join(' · ') || 'Nothing to sync.';
}

// ---------------------------------------------------------------- names for places (reverse geocoding, when on)

const limiter = new RateLimiter();
let naming = false;
async function nameStays(db: TracksDb, stays: Stay[]) {
  const g = getConfig().geocode;
  if (!g.on || naming) return;
  naming = true;
  try {
    let n = 0;
    for (const s of stays) {
      if (s.name || db.geo[geoKey(s)] || n >= 60) continue;
      n++;
      const j = await limiter.run(() => fetch(reverseUrl(g.endpoint, s), { headers: { 'user-agent': 'Keeper/1 (Places & Tracks; +https://github.com/ashfordeOU/keeper)', accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null))).catch(() => null);
      const name = j ? readNominatim(j as Record<string, unknown>) : undefined;
      if (name) db.geo[geoKey(s)] = name;
    }
    if (n) { saveSoon(); changed(); }
  } finally {
    naming = false;
  }
}

// ---------------------------------------------------------------- the overview

function sourceRows(c: TracksConfig): SourceRow[] {
  return SOURCE_CATALOG.map((e) => {
    if (e.id === 'import') return { ...e, on: true, available: true, status: 'Always available' };
    const src = c.sources[e.id] as { on: boolean; connected?: boolean; error?: string };
    let available = true;
    let status = src.on ? 'On' : 'Off';
    if (e.id === 'findMy' && process.platform !== 'darwin') { available = false; status = 'Only on a Mac'; }
    if (e.id === 'link' && src.on) status = liveViews > 0 || c.surfaces.tray || c.surfaces.island ? 'On: devices that share their location with this one' : 'On: asked only while the Live view is open';
    if (e.needs === 'tracksLive' && !featureOn('tracksLive')) status = src.on ? 'Waiting: turn on Places & Tracks: live sharing in Features' : status;
    if (e.needs === 'tracksServices' && !featureOn('tracksServices')) status = src.on ? 'Waiting: turn on Places & Tracks: services in Features' : status;
    if (src.connected === false && src.on) status = 'Not connected yet';
    if (src.error) status = src.error;
    return { ...e, on: src.on, available, status };
  });
}

async function overview(): Promise<TracksOverview> {
  const c = getConfig();
  // Counting needs the data; with no source and nothing imported, nothing is read.
  const db = loaded() ?? (activeSources(c).length || (await hasData()) ? await getDb() : null);
  const enc = encryption();
  return {
    config: c,
    counts: db ? { tracks: db.tracks.length, visits: db.visits.length, points: db.history.length, photos: db.photos.length, reservations: db.reservations.length, live: db.live.length, places: db.places.length } : { tracks: 0, visits: 0, points: 0, photos: 0, reservations: 0, live: 0, places: 0 },
    encrypted: db ? enc.encrypted : true,
    encryptionNote: enc.note,
    sources: sourceRows(c),
    receiver: receiverStatus(),
    findMy: findMyState,
    features: { tracks: featureOn('tracks'), live: featureOn('tracksLive'), services: featureOn('tracksServices') },
    imports: db?.imports.slice(0, 30) ?? [],
    range: db ? dataRange(db, c.self) : undefined,
    tileOverride: !!tileOverride(),
  };
}

async function hasData(): Promise<boolean> {
  try { await fsp.access(path.join(app.getPath('userData'), 'tracks', 'data.bin')); return true; } catch { return false; }
}

const win = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => w.isVisible()) ?? undefined;

// ---------------------------------------------------------------- the API

export const tracks: TracksApi = {
  overview,
  async liveView(open) {
    liveViews = Math.max(0, liveViews + (open ? 1 : -1));
    reconfigureLink();
  },
  async brief() {
    const features = { tracks: featureOn('tracks'), live: featureOn('tracksLive'), services: featureOn('tracksServices') };
    return { config: getConfig(), features, live: features.live ? loaded()?.live.slice().sort((a, b) => b.t - a.t) ?? [] : [] };
  },
  async setConfig(patch) {
    const before = getConfig();
    // The receiver's token is made by Keeper, not typed.
    if (patch.sources?.receiver) delete (patch.sources.receiver as { token?: string }).token;
    await patchConfig(patch);
    if (JSON.stringify(before.sources) !== JSON.stringify(getConfig().sources)) await reconfigure();
    else reconfigureLink();
    changed();
    return overview();
  },
  async setSecret(source, value) {
    if (!/^(mqtt|traccar|strava|polar|fitbit)$/.test(source)) throw new Error('Unknown source');
    const ok = await setSecret(`tracks.${source}`, value);
    if (source === 'mqtt') { stopMqtt(); await reconfigure(); }
    return ok;
  },
  async importFiles(paths) {
    let list = paths;
    if (!list) {
      const w = win();
      const opts = { properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[], filters: [{ name: 'Tracks and location history', extensions: IMPORT_EXTENSIONS }] };
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
      if (r.canceled) return { imported: [], skipped: 0 };
      list = r.filePaths;
    }
    const db = await getDb();
    const imported: ImportRecord[] = [];
    let skipped = 0;
    for (const f of list) {
      try {
        const r = await importPath(db, f);
        imported.push(r.record);
        skipped += r.skipped;
      } catch (e) {
        imported.push({ id: f, at: Date.now(), file: path.basename(f), format: '?', tracks: 0, visits: 0, points: 0, photos: 0, reservations: 0, warnings: [(e as Error).message] });
      }
    }
    await saveNow();
    changed();
    void nameStays(db, allStays(db, self()));
    return { imported, skipped };
  },
  async preview(file) {
    const bytes = new Uint8Array(await fsp.readFile(file));
    const r = importBytes(path.basename(file), bytes);
    const lines: MapTrack[] = [
      ...r.tracks.map((t) => ({ id: t.id, name: t.name, sport: t.sport, points: simplify(t.points, 3) })),
      ...r.segments.filter((s) => s.path?.length).map((s) => ({ id: s.id, name: s.mode, sport: s.mode, points: s.path! })),
    ];
    if (r.history.length > 1) lines.push({ id: 'history', name: 'Location history', sport: 'other', points: simplify(r.history.map(({ t, lat, lon }) => ({ t, lat, lon })), 30).slice(0, 20_000) });
    return { lines, photos: r.photos.map(({ lat, lon, t }) => ({ lat, lon, t })), visits: r.visits.length, warnings: r.warnings, format: r.format };
  },
  async timeline(from, to) {
    const db = await getDb();
    const view = timelineView(db, from, to, self(), await calendarStops(from, to));
    void nameStays(db, view.entries.filter((e): e is Stay => e.kind === 'stay'));
    return view;
  },
  async trips() {
    const db = await getDb();
    const range = dataRange(db, self());
    return tripsOf(db, self(), getConfig().trips.awayKm, range ? await calendarStops(range[0], range[1]) : []);
  },
  async tripHtml(id) {
    const db = await getDb();
    const t = (await tracks.trips()).find((x) => x.id === id);
    if (!t) throw new Error('That trip is gone.');
    return tripSummaryHtml(t, countryLabel, db.tracks);
  },
  async tracks() {
    return summaries(await getDb());
  },
  async track(id) {
    return (await getDb()).tracks.find((t) => t.id === id) ?? null;
  },
  async renameTrack(id, name) {
    const t = (await getDb()).tracks.find((x) => x.id === id);
    if (t && name.trim()) { t.name = name.trim().slice(0, 200); saveSoon(); changed(); }
  },
  async removeTrack(id) {
    const db = await getDb();
    db.tracks = db.tracks.filter((t) => t.id !== id);
    saveSoon();
    changed();
  },
  async records() {
    return recordsOf(await getDb());
  },
  async heatmap() {
    return heatmapOf(await getDb());
  },
  async live() {
    if (!featureOn('tracksLive')) return [];
    return (await getDb()).live.slice().sort((a, b) => b.t - a.t);
  },
  async places() {
    const db = await getDb();
    return { named: db.places, frequent: frequentPlaces(db, self()) };
  },
  async savePlace(p) {
    const db = await getDb();
    const clean: NamedPlace = { id: p.id || `place-${Date.now().toString(36)}`, name: String(p.name).slice(0, 120) || 'Place', lat: +p.lat, lon: +p.lon, radiusM: Math.max(25, Math.min(5000, +p.radiusM || 150)), kind: ['home', 'work'].includes(p.kind) ? p.kind : 'other' };
    // Only one home and one work.
    if (clean.kind !== 'other') for (const x of db.places) if (x.kind === clean.kind && x.id !== clean.id) x.kind = 'other';
    const i = db.places.findIndex((x) => x.id === clean.id);
    if (i >= 0) db.places[i] = clean;
    else db.places.push(clean);
    saveSoon();
    changed();
    return db.places;
  },
  async removePlace(id) {
    const db = await getDb();
    db.places = db.places.filter((p) => p.id !== id);
    saveSoon();
    changed();
    return db.places;
  },
  async mergePlaces(ids, name) {
    const db = await getDb();
    const sel = db.places.filter((p) => ids.includes(p.id));
    if (sel.length < 2) return db.places;
    const m = mergeNamed(sel, name || sel[0].name);
    db.places = [...db.places.filter((p) => !ids.includes(p.id)), m];
    saveSoon();
    changed();
    return db.places;
  },
  async zones() {
    return (await getDb()).zones;
  },
  async saveZone(z) {
    const db = await getDb();
    const clean = { id: z.id || `zone-${Date.now().toString(36)}`, name: String(z.name || 'Private place').slice(0, 120), lat: +z.lat, lon: +z.lon, radiusM: Math.max(50, Math.min(5000, +z.radiusM || 300)) };
    const i = db.zones.findIndex((x) => x.id === clean.id);
    if (i >= 0) db.zones[i] = clean;
    else db.zones.push(clean);
    saveSoon();
    changed();
    return db.zones;
  },
  async removeZone(id) {
    const db = await getDb();
    db.zones = db.zones.filter((z) => z.id !== id);
    saveSoon();
    changed();
    return db.zones;
  },
  async reservations() {
    return (await getDb()).reservations.slice().sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
  },
  async search(q) {
    const db = await getDb();
    let near: { lat: number; lon: number } | undefined;
    const g = getConfig().geocode;
    const r = searchDb(db, self(), q);
    // Nothing by name: ask the geocoder where the place is (when that is on), then look nearby.
    if (!r.hits.length && g.on) {
      const { placeQuery } = await import('../../../core/tracks/search');
      const j = await limiter.run(() => fetch(searchUrl(g.endpoint, placeQuery(q)), { headers: { 'user-agent': 'Keeper/1 (Places & Tracks; +https://github.com/ashfordeOU/keeper)' }, signal: AbortSignal.timeout(10_000) }).then((x) => (x.ok ? x.json() : []))).catch(() => []);
      const first = (j as { lat: string; lon: string }[])[0];
      if (first) near = { lat: Number(first.lat), lon: Number(first.lon) };
      if (near) return searchDb(db, self(), q, near);
    }
    return r;
  },
  async export(opts) {
    const db = await getDb();
    const from = opts.from ?? -Infinity, to = opts.to ?? Infinity;
    const list = db.tracks.filter((t) => (opts.ids ? opts.ids.includes(t.id) : !t.planned && t.end >= from && t.start <= to));
    const stays = opts.stays ? allStays(db, self()).filter((s) => s.end >= from && s.start <= to) : [];
    const text = exportAs(opts.format, { tracks: list, stays, zones: effectiveZones(db.zones, db.places) });
    let target: string | null = opts.path ?? null;
    if (!target) {
      const w = win();
      const def = path.join(app.getPath('downloads'), `Keeper tracks.${EXPORT_EXT[opts.format]}`);
      const r = w ? await dialog.showSaveDialog(w, { defaultPath: def }) : await dialog.showSaveDialog({ defaultPath: def });
      target = r.canceled ? null : r.filePath ?? null;
    }
    if (target) await fsp.writeFile(target, text);
    return { path: target, text, tracks: list.length };
  },
  async tile(z, x, y) {
    const m = getConfig().map;
    if (!m.online && !tileOverride()) return null;
    return getTile(m.tileUrl, z, x, y);
  },
  async connect(service: ServiceSource) {
    const s = getConfig().sources[service];
    try {
      await signIn(service, s.clientId);
      await patchConfig({ sources: { [service]: { connected: true, on: true, error: '' } } } as DeepPartial<TracksConfig>);
      await reconfigure();
      changed();
      return { ok: true, message: 'Connected.' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },
  async disconnect(service) {
    await disconnectService(service);
    await patchConfig({ sources: { [service]: { connected: false } } } as DeepPartial<TracksConfig>);
    await reconfigure();
    changed();
  },
  async syncNow() {
    const parts: string[] = [];
    const s = getConfig().sources;
    if (s.folders.on) { await scanFolders(); parts.push('folders checked'); }
    if (s.photos.on) { await scanPhotos(); parts.push('photos checked'); }
    if (s.mail.on) { await scanMail(); parts.push('mail checked'); }
    if (live() && s.findMy.on && process.platform === 'darwin') await readFindMy();
    if (live() && s.traccar.on) await pollTraccar();
    if (services()) parts.push(await syncServices());
    return { ok: true, message: parts.join(' · ') || 'Nothing to check: switch a source on first.' };
  },
  async backup() {
    const db = await getDb();
    const w = win();
    const def = path.join(app.getPath('documents'), `Places and Tracks ${new Date().toISOString().slice(0, 10)}.geojson`);
    const r = w ? await dialog.showSaveDialog(w, { defaultPath: def }) : await dialog.showSaveDialog({ defaultPath: def });
    if (r.canceled || !r.filePath) return { path: null };
    // A backup is yours: privacy zones are not applied to it.
    await fsp.writeFile(r.filePath, toGeoJson({ tracks: db.tracks, stays: allStays(db, self()) }));
    await patchConfig({ lastBackup: Date.now() });
    changed();
    return { path: r.filePath };
  },
  async wipe() {
    for (const k of [...stops.keys()]) stopPoll(k);
    await stopReceiver();
    stopMqtt();
    await wipeAll();
    findMyState = { state: process.platform === 'darwin' ? 'off' : 'not-mac', detail: 'Off' };
    changed();
    deps.trayChanged?.();
  },
};

// ---------------------------------------------------------------- the keeper command

export async function keeperTracks(p: Record<string, unknown>): Promise<unknown> {
  const cmd = String(p.cmd ?? 'list');
  const args = (p.args ?? []) as string[];
  if (cmd === 'import') return tracks.importFiles(args.map((a) => path.resolve(String(p.cwd ?? process.cwd()), a)));
  if (cmd === 'list') return (await tracks.tracks()).map(({ preview: _p, ...rest }) => rest);
  if (cmd === 'export') {
    const format = String(p.format ?? 'gpx') as ExportFormat;
    if (!EXPORT_EXT[format]) throw new Error('Formats: gpx, kml, geojson, csv');
    const from = p.from ? Date.parse(String(p.from)) : undefined;
    const to = p.to ? Date.parse(String(p.to)) + (/^\d{4}-\d{2}-\d{2}$/.test(String(p.to)) ? 86_400_000 : 0) : undefined;
    const r = await tracks.export({ format, from, to, path: p.out ? path.resolve(String(p.cwd ?? process.cwd()), String(p.out)) : undefined });
    return p.out ? { path: r.path, tracks: r.tracks } : { text: r.text, tracks: r.tracks };
  }
  if (cmd === 'where') {
    const q = args.join(' ').toLowerCase();
    const db = await getDb();
    const hits = db.live.filter((x) => !q || x.name.toLowerCase().includes(q) || x.id.toLowerCase().includes(q));
    return hits.map((x) => ({ ...x, place: x.address ?? db.geo[geoKey(x)]?.name, country: countryOf(db)(x) }));
  }
  throw new Error('Usage: keeper tracks import <file> | list | export --from D --to D --format gpx | where <device>');
}

// ---------------------------------------------------------------- start

export function startTracks(d: Deps) {
  deps = d;
  // Link asks Places & Tracks where this device is (null unless you allowed it here and there).
  void import('../link/location').then((m) => m.setOwnPositionSource(() => ownPosition())).catch(() => undefined);
  for (const f of ['tracks', 'tracksLive', 'tracksServices']) onFeature(f, () => void reconfigure().catch(() => undefined));
  // Only something is switched on needs a look now.
  if (activeSources(getConfig()).length) void reconfigure().catch(() => undefined);
  // To do: location history from several sources that exists nowhere else.
  registerFindings('tracks', async () => {
    if (!featureOn('tracks')) return [];
    const b = await backupState();
    if (!b.hasData || b.sources < 1 || (b.lastBackup && Date.now() - b.lastBackup < 60 * 86_400_000)) return [];
    return [{
      id: 'tracks:backup', source: 'tracks', area: 'backup', severity: 'low',
      title: `Location history from ${b.sources} source${b.sources === 1 ? '' : 's'} isn’t backed up`,
      why: 'Places & Tracks keeps it only on this computer, encrypted. If the computer is lost, so is the history. Save a copy somewhere safe.',
      fix: { kind: 'page', route: { name: 'tracks', arg: 'privacy' }, label: 'Save a copy' },
    }];
  });
}

export async function stopTracks() {
  for (const k of [...stops.keys()]) stopPoll(k);
  await stopReceiver();
  stopMqtt();
  await saveNow();
}

/** For the guide: how many sources feed location history, and when it was last saved elsewhere. */
export async function backupState(): Promise<{ sources: number; lastBackup?: number; hasData: boolean }> {
  const c = getConfig();
  const db = loaded() ?? ((await hasData()) ? await getDb() : null);
  const kinds = new Set<string>();
  for (const t of db?.tracks ?? []) kinds.add(t.source);
  if (db?.visits.length || db?.history.some((h) => !h.src.includes(':'))) kinds.add('history');
  if (db?.photos.length) kinds.add('photos');
  for (const l of db?.live ?? []) kinds.add(l.source);
  return { sources: kinds.size, lastBackup: c.lastBackup, hasData: !!db && (db.tracks.length + db.visits.length + db.history.length) > 0 };
}
