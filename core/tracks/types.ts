// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places & Tracks: where your things, people and activities have been. The
// shapes every part shares: points, tracks, visits, live positions, trips.
// Pure types; nothing here touches a disk or the network.

/** One position fix. Time in milliseconds since 1970 (UTC). */
export interface Point {
  t: number;
  lat: number;
  lon: number;
  /** metres above sea level */
  ele?: number;
  /** metres per second */
  speed?: number;
  /** beats per minute */
  hr?: number;
  /** revolutions or steps per minute */
  cad?: number;
  /** watts */
  power?: number;
  /** horizontal accuracy in metres */
  acc?: number;
}

export type Sport = 'run' | 'ride' | 'walk' | 'hike' | 'swim' | 'ski' | 'row' | 'drive' | 'flight' | 'train' | 'boat' | 'other';

export const SPORT_LABEL: Record<Sport, string> = {
  run: 'Run', ride: 'Ride', walk: 'Walk', hike: 'Hike', swim: 'Swim', ski: 'Ski', row: 'Row', drive: 'Drive', flight: 'Flight', train: 'Train', boat: 'Boat', other: 'Activity',
};

/** Where an item came from: an importer, a service, a receiver or a device. */
export type SourceKind =
  | 'gpx' | 'kml' | 'geojson' | 'tcx' | 'fit' | 'google' | 'apple-health' | 'photos' | 'folder'
  | 'strava' | 'polar' | 'fitbit' | 'owntracks' | 'osmand' | 'mqtt' | 'findmy' | 'link' | 'phone' | 'calendar' | 'mail' | 'demo';

export interface TrackStats {
  distanceM: number;
  /** first to last point */
  elapsedS: number;
  /** time spent moving (speed above a walking crawl) */
  movingS: number;
  ascentM: number;
  descentM: number;
  maxSpeed?: number;
  avgHr?: number;
  maxHr?: number;
  minEle?: number;
  maxEle?: number;
}

export interface Track {
  id: string;
  name: string;
  sport: Sport;
  source: SourceKind;
  /** id at the source (Strava activity id, file name…) so a second import is not a duplicate */
  sourceId?: string;
  start: number;
  end: number;
  points: Point[];
  stats: TrackStats;
  /** summary numbers a service reported when it gave no points (or fewer than it measured) */
  reported?: Partial<TrackStats> & { calories?: number };
  /** a route (planned), not something that happened */
  planned?: boolean;
  notes?: string;
}

/** A place someone stayed (a visit from Google, or found in the raw points). */
export interface Visit {
  id: string;
  start: number;
  end: number;
  lat: number;
  lon: number;
  name?: string;
  address?: string;
  /** Google place id and the like */
  placeId?: string;
  /** 'HOME', 'WORK' … as the source said */
  semantic?: string;
  source: SourceKind;
}

/** A move between two visits, as a source described it (Google activity segments). */
export interface Segment {
  id: string;
  start: number;
  end: number;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  mode: Sport;
  distanceM?: number;
  path?: Point[];
  source: SourceKind;
}

/** A raw position from location history (Records.json, rawSignals, a receiver). */
export interface HistoryPoint extends Point {
  /** source and device, e.g. "google", "owntracks:phone" */
  src: string;
}

export interface PhotoPoint {
  t: number;
  lat: number;
  lon: number;
  path: string;
}

/** A place the person named, or merged from several nearby ones. */
export interface NamedPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  kind: 'home' | 'work' | 'other';
}

export interface PrivacyZone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
}

export type LiveKind = 'device' | 'item' | 'person' | 'phone' | 'tracker';

export interface LivePosition {
  /** stable across updates: "owntracks:alex/phone", "findmy:item:…" */
  id: string;
  name: string;
  kind: LiveKind;
  source: SourceKind;
  t: number;
  lat: number;
  lon: number;
  acc?: number;
  /** 0..100 */
  battery?: number;
  charging?: boolean;
  speed?: number;
  address?: string;
}

export type ReservationKind = 'flight' | 'lodging' | 'event' | 'rental' | 'train' | 'bus' | 'restaurant';

/** A booking read from a confirmation mail (schema.org JSON-LD). */
export interface Reservation {
  id: string;
  kind: ReservationKind;
  name: string;
  start?: number;
  end?: number;
  /** flight: departure and arrival airport codes; lodging and events: the address */
  from?: string;
  to?: string;
  address?: string;
  lat?: number;
  lon?: number;
  confirmation?: string;
  provider?: string;
  source: SourceKind;
}

export interface CalendarStop {
  id: string;
  title: string;
  start: number;
  end: number;
  location: string;
  lat?: number;
  lon?: number;
}

/** Everything an import produced. */
export interface ImportResult {
  format: string;
  tracks: Track[];
  visits: Visit[];
  segments: Segment[];
  history: HistoryPoint[];
  photos: PhotoPoint[];
  reservations: Reservation[];
  /** places a source marked as home or work */
  labelled: { lat: number; lon: number; label: string }[];
  warnings: string[];
}

export const emptyImport = (format: string): ImportResult => ({ format, tracks: [], visits: [], segments: [], history: [], photos: [], reservations: [], labelled: [], warnings: [] });

// ---------------------------------------------------------------- the timeline

export interface Stay {
  kind: 'stay';
  id: string;
  start: number;
  end: number;
  lat: number;
  lon: number;
  name?: string;
  placeId?: string;
  /** a named place this stay belongs to */
  place?: string;
  source: SourceKind | 'detected';
}

export interface Move {
  kind: 'move';
  id: string;
  start: number;
  end: number;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  mode: Sport;
  distanceM: number;
  path: Point[];
  source: SourceKind | 'detected';
}

export interface ActivityEntry {
  kind: 'activity';
  id: string;
  start: number;
  end: number;
  track: string;
  name: string;
  sport: Sport;
  distanceM: number;
}

export interface PhotoEntry {
  kind: 'photo';
  id: string;
  start: number;
  end: number;
  lat: number;
  lon: number;
  path: string;
}

export interface EventEntry {
  kind: 'event';
  id: string;
  start: number;
  end: number;
  title: string;
  location?: string;
  reservation?: ReservationKind;
}

export type TimelineEntry = Stay | Move | ActivityEntry | PhotoEntry | EventEntry;

export interface TripDay {
  /** local midnight */
  day: number;
  entries: TimelineEntry[];
  distanceM: number;
  places: string[];
}

export interface Trip {
  id: string;
  title: string;
  start: number;
  end: number;
  days: TripDay[];
  distanceM: number;
  /** ISO country codes, in the order first visited */
  countries: string[];
  places: string[];
  photos: number;
  flights: number;
  drives: number;
  /** bounding box: [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
}
