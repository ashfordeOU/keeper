// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places & Tracks settings: every source has its own switch and starts off;
// the live receivers stay off until you turn them on.

import type { DeepPartial, SourceId, SourceRow, TracksConfig } from './api';

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

interface CatalogEntry { id: SourceRow['id']; label: string; gives: string; platforms: string; needs?: SourceRow['needs'] }

/** Every source, what it gives and where it works. Shown in the app and in docs/TRACKS.md. */
export const SOURCE_CATALOG: CatalogEntry[] = [
  { id: 'import', label: 'Files you import', gives: 'GPX, KML/KMZ, GeoJSON, TCX, FIT, Google Timeline (on-device export, Semantic Location History, Records.json), Apple Health export.zip, booking mails (.eml)', platforms: 'macOS, Windows, Linux' },
  { id: 'folders', label: 'Watched folders', gives: 'New FIT, GPX and TCX files from any watch or bike computer (Garmin, Wahoo, Suunto, Coros, Polar exports…)', platforms: 'macOS, Windows, Linux' },
  { id: 'photos', label: 'Photos', gives: 'Where and when your photos were taken (EXIF GPS)', platforms: 'macOS, Windows, Linux' },
  { id: 'findMy', label: 'Find My (Mac cache)', gives: 'Your Apple devices and items, as last cached by the Find My app', platforms: 'macOS up to 14.3 only (encrypted since 14.4)', needs: 'tracksLive' },
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
