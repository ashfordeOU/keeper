// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places & Tracks as the interface sees it: the main process ↔ window contract.

import type { ColourBy } from './geo';
import type { SearchHit } from './search';
import type { PersonalRecord } from './stats';
import type { PlaceCluster } from './timeline';
import type { LivePosition, NamedPlace, Point, PrivacyZone, Reservation, Sport, Stay, TimelineEntry, Track, TrackStats, Trip } from './types';
import type { ExportFormat } from './export';

export type ServiceSource = 'strava' | 'polar' | 'fitbit';

export interface ServiceConfig {
  on: boolean;
  /** the person's own app credentials (the secret is kept in the keychain) */
  clientId: string;
  connected: boolean;
  lastSync?: number;
  error?: string;
}

export interface TracksConfig {
  sources: {
    photos: { on: boolean; folders: string[] };
    folders: { on: boolean; paths: string[] };
    findMy: { on: boolean };
    /** OwnTracks over HTTP (POST /owntracks) */
    ownTracks: { on: boolean };
    /** the OsmAnd/Traccar HTTP protocol (GET or POST /osmand) */
    osmand: { on: boolean };
    /** the one small HTTP receiver both of those use */
    receiver: { port: number; lan: boolean; token: string };
    mqtt: { on: boolean; host: string; port: number; tls: boolean; user: string; topic: string; error?: string };
    traccar: { on: boolean; url: string; user: string; error?: string };
    strava: ServiceConfig;
    polar: ServiceConfig;
    fitbit: ServiceConfig;
    calendar: { on: boolean };
    mail: { on: boolean };
    link: { on: boolean };
    phone: { on: boolean };
  };
  map: { online: boolean; tileUrl: string; attribution: string; colourBy: ColourBy; dark: 'auto' | 'filter' | 'off' };
  geocode: { on: boolean; endpoint: string };
  /** live ids whose positions are yours (they also feed your timeline) */
  self: string[];
  trips: { awayKm: number };
  /** where Places & Tracks shows up besides its own page */
  surfaces: { sidebar: boolean; palette: boolean; fileMenu: boolean; tray: boolean; island: boolean };
  lastBackup?: number;
}

export type SourceId = keyof TracksConfig['sources'];

export interface SourceRow {
  id: SourceId | 'import';
  label: string;
  /** what it gives you */
  gives: string;
  platforms: string;
  on: boolean;
  /** can run on this computer right now */
  available: boolean;
  /** "Needs Places & Tracks: live sharing in Features" and the like */
  status: string;
  /** the feature switch it also needs */
  needs?: 'tracksLive' | 'tracksServices';
}

export interface ImportRecord {
  id: string;
  at: number;
  file: string;
  format: string;
  tracks: number;
  visits: number;
  points: number;
  photos: number;
  reservations: number;
  warnings: string[];
}

export interface TracksOverview {
  config: TracksConfig;
  counts: { tracks: number; visits: number; points: number; photos: number; reservations: number; live: number; places: number };
  /** the data file is encrypted with a key kept in the system keychain */
  encrypted: boolean;
  encryptionNote?: string;
  sources: SourceRow[];
  receiver: { running: boolean; url?: string; lanUrl?: string; error?: string };
  findMy: { state: 'off' | 'ok' | 'encrypted' | 'unreadable' | 'not-mac'; detail: string };
  features: { tracks: boolean; live: boolean; services: boolean };
  imports: ImportRecord[];
  /** first and last time anything happened */
  range?: [number, number];
  /** whether tiles may be loaded from a test server (unofficial builds only) */
  tileOverride?: boolean;
}

export interface TrackSummary {
  id: string;
  name: string;
  sport: Sport;
  source: string;
  start: number;
  end: number;
  stats: TrackStats;
  planned?: boolean;
  /** a few dozen points for a thumbnail line */
  preview: [number, number][];
}

export interface MapTrack {
  id: string;
  name: string;
  sport: Sport;
  points: Point[];
}

export interface TimelineView {
  entries: TimelineEntry[];
  /** tracks and moves in range, simplified for drawing */
  lines: MapTrack[];
  days: { day: number; stays: number; moves: number; activities: number; distanceM: number; places: string[] }[];
}

export interface ImportSummary {
  imported: ImportRecord[];
  /** how many items were already there */
  skipped: number;
}

export interface TracksApi {
  overview(): Promise<TracksOverview>;
  /** settings, switches and live positions already in memory; never reads the data file (for the palette, sidebar and menus) */
  brief(): Promise<{ config: TracksConfig; features: TracksOverview['features']; live: LivePosition[] }>;
  setConfig(patch: DeepPartial<TracksConfig>): Promise<TracksOverview>;
  /** keeps a password or client secret in the keychain (mqtt, traccar, strava, polar, fitbit) */
  setSecret(source: string, value: string): Promise<boolean>;
  /** with no paths, opens a file picker */
  importFiles(paths?: string[]): Promise<ImportSummary>;
  /** reads a file without keeping it (for "Show on map" from the file browser) */
  preview(path: string): Promise<{ lines: MapTrack[]; photos: { lat: number; lon: number; t: number }[]; visits: number; warnings: string[]; format: string }>;
  timeline(from: number, to: number): Promise<TimelineView>;
  trips(): Promise<Trip[]>;
  tripHtml(id: string): Promise<string>;
  tracks(): Promise<TrackSummary[]>;
  track(id: string): Promise<Track | null>;
  renameTrack(id: string, name: string): Promise<void>;
  removeTrack(id: string): Promise<void>;
  records(): Promise<PersonalRecord[]>;
  heatmap(): Promise<[number, number][]>;
  live(): Promise<LivePosition[]>;
  /** the Live view opened or closed (paired devices are asked more often while it is open) */
  liveView(open: boolean): Promise<void>;
  places(): Promise<{ named: NamedPlace[]; frequent: PlaceCluster[] }>;
  savePlace(p: NamedPlace): Promise<NamedPlace[]>;
  removePlace(id: string): Promise<NamedPlace[]>;
  mergePlaces(ids: string[], name: string): Promise<NamedPlace[]>;
  zones(): Promise<PrivacyZone[]>;
  saveZone(z: PrivacyZone): Promise<PrivacyZone[]>;
  removeZone(id: string): Promise<PrivacyZone[]>;
  reservations(): Promise<Reservation[]>;
  search(q: string): Promise<{ answer: string; hits: SearchHit[] }>;
  /** saves to `path`, or asks where; returns where it went and the text written */
  export(opts: { format: ExportFormat; from?: number; to?: number; ids?: string[]; path?: string; stays?: boolean }): Promise<{ path: string | null; text: string; tracks: number }>;
  /** a map picture from the configured tile server (cached), or null offline */
  tile(z: number, x: number, y: number): Promise<Uint8Array | null>;
  /** opens the service's sign-in page in the browser */
  connect(service: ServiceSource): Promise<{ ok: boolean; message: string }>;
  disconnect(service: ServiceSource): Promise<void>;
  syncNow(): Promise<{ ok: boolean; message: string }>;
  /** a copy of everything in a folder you choose (GeoJSON) */
  backup(): Promise<{ path: string | null }>;
  /** deletes every location, track, place and setting of Places & Tracks */
  wipe(): Promise<void>;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export type { LivePosition, NamedPlace, PrivacyZone, Reservation, Stay, Track, Trip, ExportFormat };
