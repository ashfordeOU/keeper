// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One entry point for every file: looks at the name and the first bytes,
// unpacks KMZ and Apple Health zips, and hands the content to the right reader.
// Main process and CLI only (zip and zlib).

import { readExifDetails } from '../exifDetails';
import { unzip } from '../zipwrite';
import { parseFit } from './fit';
import { parseGeoJson, parseGpx, parseKml, parseTcx } from './files';
import { googleKind, parseGoogle } from './google';
import { parseAppleHealth } from './health';
import { reservationsInHtml } from './jsonld';
import { emptyImport, type ImportResult, type SourceKind } from './types';
import { parseTime } from './util';

export const IMPORT_EXTENSIONS = ['gpx', 'kml', 'kmz', 'geojson', 'json', 'tcx', 'fit', 'zip', 'jpg', 'jpeg', 'heic', 'tif', 'tiff', 'dng', 'eml', 'html', 'htm'];
export const PHOTO_EXT = /\.(jpe?g|heic|heif|tiff?|dng|cr2|cr3|nef|arw|orf|rw2)$/i;

const text = (b: Uint8Array) => new TextDecoder().decode(b).replace(/^﻿/, '');

/** A photo's place and time from its EXIF, or undefined when it has no GPS. */
export function photoPoint(path: string, bytes: Uint8Array): { t: number; lat: number; lon: number; path: string } | undefined {
  const d = readExifDetails(bytes);
  if (!d?.gps || !d.taken) return undefined;
  const m = d.taken.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  const t = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : parseTime(d.taken);
  if (!Number.isFinite(t) || (d.gps.lat === 0 && d.gps.lon === 0)) return undefined;
  return { t, lat: d.gps.lat, lon: d.gps.lon, path };
}

/** Reads one file's bytes (the name is used to tell formats apart). */
export function importBytes(name: string, bytes: Uint8Array, source?: SourceKind): ImportResult {
  const lower = name.toLowerCase();
  const ext = lower.split('.').pop() ?? '';
  const head = text(bytes.subarray(0, 512)).trimStart();
  if (ext === 'fit' || (bytes.length > 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54)) return parseFit(bytes, source ?? 'fit', undefined);
  if (ext === 'zip' || ext === 'kmz' || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return importZip(name, bytes, source);
  if (PHOTO_EXT.test(lower)) {
    const out = emptyImport('Photo');
    const p = photoPoint(name, bytes);
    if (p) out.photos.push(p);
    else out.warnings.push('This photo has no place in it.');
    return out;
  }
  if (ext === 'gpx' || /<gpx[\s>]/.test(head)) return parseGpx(text(bytes), source ?? 'gpx');
  if (ext === 'tcx' || /TrainingCenterDatabase/.test(head)) return parseTcx(text(bytes), source ?? 'tcx');
  if (ext === 'kml' || /<kml[\s>]/.test(head)) return parseKml(text(bytes), source ?? 'kml');
  if (ext === 'eml' || ext === 'html' || ext === 'htm' || /application\/ld\+json/i.test(text(bytes.subarray(0, 200_000)))) {
    const out = emptyImport('Booking confirmation');
    // E-mail: quoted-printable bodies are unfolded first.
    const raw = text(bytes);
    const body = ext === 'eml' ? raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) : raw;
    out.reservations.push(...reservationsInHtml(body, source ?? 'mail'));
    if (!out.reservations.length) out.warnings.push('No bookings were found in this file.');
    return out;
  }
  if (ext === 'json' || ext === 'geojson' || head.startsWith('{') || head.startsWith('[')) {
    let j: unknown;
    try {
      j = JSON.parse(text(bytes));
    } catch {
      const out = emptyImport('JSON');
      out.warnings.push('This JSON file is damaged.');
      return out;
    }
    if (googleKind(j)) return parseGoogle(j);
    return parseGeoJson(j as Record<string, unknown>, source ?? 'geojson');
  }
  const out = emptyImport('Unknown');
  out.warnings.push('Keeper does not know this kind of file. It reads GPX, KML, KMZ, GeoJSON, TCX, FIT, Google Timeline, Apple Health export.zip and photos.');
  return out;
}

function importZip(name: string, bytes: Uint8Array, source?: SourceKind): ImportResult {
  let entries;
  try {
    entries = unzip(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch (e) {
    const out = emptyImport('ZIP');
    out.warnings.push((e as Error).message);
    return out;
  }
  const files = entries.filter((e) => !e.dir && e.data);
  // Apple Health: apple_health_export/export.xml plus workout-routes/*.gpx.
  const health = files.find((e) => /(^|\/)export\.xml$/.test(e.name));
  if (health) {
    const routes = new Map<string, string>();
    for (const e of files) if (/workout-routes\/.+\.gpx$/i.test(e.name)) routes.set(e.name, text(e.data!));
    return parseAppleHealth(text(health.data!), routes);
  }
  // KMZ: doc.kml (or the first .kml) inside.
  const kml = files.find((e) => /(^|\/)doc\.kml$/i.test(e.name)) ?? files.find((e) => /\.kml$/i.test(e.name));
  if (kml && (name.toLowerCase().endsWith('.kmz') || files.length < 50)) return { ...parseKml(text(kml.data!), source ?? 'kml'), format: 'KMZ' };
  // Any other zip (a Takeout or Garmin export): read every file Keeper understands.
  const out = emptyImport('ZIP');
  for (const e of files) {
    if (!/\.(gpx|tcx|fit|kml|geojson|json)$/i.test(e.name) || /__MACOSX/.test(e.name)) continue;
    const r = importBytes(e.name, e.data!, source);
    if (/Unknown|JSON/.test(r.format) && !r.tracks.length && !r.visits.length && !r.history.length) continue;
    merge(out, r);
  }
  if (!out.tracks.length && !out.visits.length && !out.history.length) out.warnings.push('Nothing Keeper can read was found in this ZIP file.');
  return out;
}

export function merge(into: ImportResult, r: ImportResult): ImportResult {
  into.tracks.push(...r.tracks);
  into.visits.push(...r.visits);
  into.segments.push(...r.segments);
  into.history.push(...r.history);
  into.photos.push(...r.photos);
  into.reservations.push(...r.reservations);
  into.labelled.push(...r.labelled);
  into.warnings.push(...r.warnings);
  return into;
}
