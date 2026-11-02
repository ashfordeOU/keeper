// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places & Tracks settings: every source has its own switch and starts off;
// the live receivers stay off until you turn them on.

import type { DeepPartial, SourceId, SourceRow, TracksConfig, TracksOverview } from './api';
import { findMyPlainOn } from './findmy';

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export function defaultConfig(token: string): TracksConfig {
  const svc = { on: false, clientId: '', connected: false };
  return {
    sources: {
      photos: { on: false, folders: [] },
      folders: { on: false, paths: [] },
      findMy: { on: false },
      ownTracks: { on: false },
      osmand: { on: false },
      receiver: { port: 5144, lan: false, token },
      mqtt: { on: false, host: '', port: 1883, tls: false, user: '', topic: 'owntracks/#' },
      traccar: { on: false, url: '', user: '' },
      strava: { ...svc },
      polar: { ...svc },
      fitbit: { ...svc },
      calendar: { on: false },
      mail: { on: false },
      link: { on: false },
      phone: { on: false },
    },
    map: { online: false, tileUrl: OSM_TILES, attribution: OSM_ATTRIBUTION, colourBy: 'speed', dark: 'auto' },
    geocode: { on: false, endpoint: 'https://nominatim.openstreetmap.org' },
    self: [],
    trips: { awayKm: 50 },
    surfaces: { sidebar: true, palette: true, fileMenu: true, tray: true, island: true },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep merge of a saved or patched config onto a base; unknown keys are dropped. */
export function mergeConfig<T>(base: T, patch: DeepPartial<T> | unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined || typeof patch !== typeof base ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(base)) {
    if (!(k in patch)) continue;
    const pv = (patch as Record<string, unknown>)[k];
    const bv = (base as Record<string, unknown>)[k];
    out[k] = isObj(bv) ? mergeConfig(bv, pv) : pv === undefined || (bv !== undefined && typeof pv !== typeof bv) ? bv : pv;
  }
  // Optional fields that the base leaves out (lastBackup, error, lastSync).
  for (const k of ['lastBackup', 'error', 'lastSync']) if (k in patch && !(k in base)) out[k] = (patch as Record<string, unknown>)[k];
  return out as T;
}

/** How many sources are switched on (live receivers count only with their feature on). */
export function activeSources(c: TracksConfig): SourceId[] {
  const s = c.sources;
  return (Object.keys(s) as SourceId[]).filter((k) => k !== 'receiver' && (s[k] as { on?: boolean }).on);
}

export interface CatalogEntry { id: SourceRow['id']; label: string; gives: string; platforms: string; needs?: SourceRow['needs'] }

/** Every source, what it gives and where it works. Shown in the app and in docs/TRACKS.md. */
export const SOURCE_CATALOG: CatalogEntry[] = [
  { id: 'import', label: 'Files you import', gives: 'GPX, KML/KMZ, GeoJSON, TCX, FIT, Google Timeline (on-device export, Semantic Location History, Records.json), Apple Health export.zip, booking mails (.eml)', platforms: 'macOS, Windows, Linux' },
  { id: 'folders', label: 'Watched folders', gives: 'New FIT, GPX and TCX files from any watch or bike computer (Garmin, Wahoo, Suunto, Coros, Polar exports…)', platforms: 'macOS, Windows, Linux' },
  { id: 'photos', label: 'Photos', gives: 'Where and when your photos were taken (EXIF GPS)', platforms: 'macOS, Windows, Linux' },
  { id: 'findMy', label: 'Find My (Mac cache)', gives: 'Your Apple devices and items, as last cached by the Find My app', platforms: 'macOS 14.3 and earlier', needs: 'tracksLive' },
  { id: 'ownTracks', label: 'OwnTracks (HTTP)', gives: 'Live positions from the OwnTracks app on phones you or your family use', platforms: 'macOS, Windows, Linux', needs: 'tracksLive' },
  { id: 'mqtt', label: 'OwnTracks (MQTT)', gives: 'Live positions through your own MQTT broker', platforms: 'macOS, Windows, Linux', needs: 'tracksLive' },
  { id: 'osmand', label: 'GPS trackers (OsmAnd protocol)', gives: 'Live positions from GPS trackers, the Traccar Client app and OsmAnd', platforms: 'macOS, Windows, Linux', needs: 'tracksLive' },
  { id: 'traccar', label: 'Traccar server', gives: 'Devices and positions from your own Traccar server (REST API)', platforms: 'macOS, Windows, Linux', needs: 'tracksLive' },
  { id: 'phone', label: 'Phone companion', gives: 'Your phone’s position while Keeper’s companion page is open on it', platforms: 'Any phone browser', needs: 'tracksLive' },
  { id: 'link', label: 'Your paired devices', gives: 'Where your other Keeper devices are, when they share their location with this one (Devices → device → Share my location)', platforms: 'macOS, Windows, Linux', needs: 'tracksLive' },
  { id: 'strava', label: 'Strava', gives: 'Activities, their GPS streams and saved routes (Strava API v3, your own API app)', platforms: 'macOS, Windows, Linux', needs: 'tracksServices' },
  { id: 'polar', label: 'Polar Flow', gives: 'Exercises with GPS routes (Polar AccessLink, your own client)', platforms: 'macOS, Windows, Linux', needs: 'tracksServices' },
  { id: 'fitbit', label: 'Fitbit', gives: 'Activities with GPS as TCX (Fitbit Web API, your own app)', platforms: 'macOS, Windows, Linux', needs: 'tracksServices' },
  { id: 'calendar', label: 'Calendar', gives: 'Events with a location, on your trips', platforms: 'macOS, Windows, Linux' },
  { id: 'mail', label: 'Booking mails', gives: 'Flights, hotels and tickets from confirmation mails (read-only)', platforms: 'macOS, Windows, Linux' },
];

/** What turning on a feature a source needs does, in a few words. */
export const FEATURE_FIX: Record<'tracksLive' | 'tracksServices', { label: string; requires: string }> = {
  tracksLive: { label: 'Turn on live sharing', requires: 'Starts a small receiver on this computer for the live sources you switch on.' },
  tracksServices: { label: 'Turn on sports services', requires: 'Lets Keeper ask the services you connect for new activities every six hours.' },
};

export interface SourceContext {
  platform: string;
  /** the kernel release (os.release()); on a Mac, Darwin 23.4 is macOS 14.4 */
  release: string;
  features: { live: boolean; services: boolean };
  findMy: TracksOverview['findMy'];
  /** the Live view is open, or the tray or Island shows positions */
  linkWatching: boolean;
}

/** Can Keeper read Find My here? Only on a Mac before macOS 14.4, which encrypts the cache. */
export function findMyAvailable(platform: string, release: string): { ok: boolean; why?: string; status?: string } {
  if (platform !== 'darwin') return { ok: false, status: 'Only on a Mac', why: 'Find My keeps its cache only on a Mac.' };
  if (!findMyPlainOn(release, true)) return { ok: false, status: 'Not available on this version of macOS', why: 'Since macOS 14.4 Apple encrypts the Find My cache and offers apps no other way in, so Keeper cannot see Find My’s devices, items or people.' };
  return { ok: true };
}

/** One source's row: its status, tone and what can be done about it. */
export function sourceRow(e: CatalogEntry, src: { on?: boolean; connected?: boolean; error?: string } | undefined, ctx: SourceContext): SourceRow {
  if (e.id === 'import') return { ...e, on: true, available: true, status: 'Always available', tone: 'on' };
  const on = !!src?.on;
  if (e.id === 'findMy') {
    const a = findMyAvailable(ctx.platform, ctx.release);
    // Shown off and without a switch, whatever was saved: it cannot run here.
    if (!a.ok) return { ...e, on: false, available: false, status: a.status!, why: a.why, tone: 'unavailable', instead: ['openFindMy', 'sharePhone'] };
  }
  const featureOn = e.needs === 'tracksLive' ? ctx.features.live : e.needs === 'tracksServices' ? ctx.features.services : true;
  if (on && e.needs && !featureOn) {
    return { ...e, on, available: true, status: 'Needs one more switch', tone: 'warn', fix: { feature: e.needs, ...FEATURE_FIX[e.needs] } };
  }
  if (!on) return { ...e, on, available: true, status: 'Off', tone: 'off' };
  if (src?.error) return { ...e, on, available: true, status: src.error, tone: 'warn' };
  if (src?.connected === false) return { ...e, on, available: true, status: 'Not connected yet', tone: 'warn' };
  if (e.id === 'link') return { ...e, on, available: true, status: ctx.linkWatching ? 'On: devices that share their location with this one' : 'On: asked only while the Live view is open', tone: 'on' };
  if (e.id === 'findMy') {
    const f = ctx.findMy;
    if (f.state === 'encrypted') return { ...e, on: false, available: false, status: 'Not available on this version of macOS', why: f.detail, tone: 'unavailable', instead: ['openFindMy', 'sharePhone'] };
    if (f.state === 'unreadable') return { ...e, on, available: true, status: f.detail, tone: 'warn' };
    if (f.state === 'ok') return { ...e, on, available: true, status: 'On', why: f.detail, tone: 'on' };
    return { ...e, on, available: true, status: 'On: reading Find My shortly', tone: 'on' };
  }
  return { ...e, on, available: true, status: 'On', tone: 'on' };
}
