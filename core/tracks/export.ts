// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Writing tracks and places back out: GPX 1.1, KML 2.2, GeoJSON, CSV and a
// printable trip summary. Privacy zones are applied before anything is written.

import { cutTrack, filterPoints } from './privacy';
import { fmtDistance, fmtDuration, effectiveStats } from './stats';
import { SPORT_LABEL, type Point, type PrivacyZone, type Stay, type Track, type Trip } from './types';
import { esc } from './xml';

export type ExportFormat = 'gpx' | 'kml' | 'geojson' | 'csv';

export interface ExportInput {
  tracks: Track[];
  stays?: Stay[];
  zones?: PrivacyZone[];
}

const iso = (t: number) => new Date(t).toISOString().replace(/\.000Z$/, 'Z');
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

function prepared(input: ExportInput): { tracks: Track[]; stays: Stay[] } {
  const zones = input.zones ?? [];
  return {
    tracks: input.tracks.flatMap((t) => cutTrack(t, zones)),
    stays: filterPoints(input.stays ?? [], zones),
  };
}

export function toGpx(input: ExportInput, creator = 'Keeper'): string {
  const { tracks, stays } = prepared(input);
  const lines = [`<?xml version="1.0" encoding="UTF-8"?>`, `<gpx version="1.1" creator="${esc(creator)}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">`];
  for (const s of stays) lines.push(`  <wpt lat="${r6(s.lat)}" lon="${r6(s.lon)}"><time>${iso(s.start)}</time>${s.name ? `<name>${esc(s.name)}</name>` : ''}</wpt>`);
  for (const t of tracks) {
    lines.push(`  <trk><name>${esc(t.name)}</name><type>${t.sport}</type><trkseg>`);
    for (const p of t.points) {
      const ext = p.hr !== undefined || p.cad !== undefined ? `<extensions><gpxtpx:TrackPointExtension>${p.hr !== undefined ? `<gpxtpx:hr>${Math.round(p.hr)}</gpxtpx:hr>` : ''}${p.cad !== undefined ? `<gpxtpx:cad>${Math.round(p.cad)}</gpxtpx:cad>` : ''}</gpxtpx:TrackPointExtension></extensions>` : '';
      lines.push(`    <trkpt lat="${r6(p.lat)}" lon="${r6(p.lon)}">${p.ele !== undefined ? `<ele>${Math.round(p.ele * 10) / 10}</ele>` : ''}${t.planned ? '' : `<time>${iso(p.t)}</time>`}${ext}</trkpt>`);
    }
    lines.push('  </trkseg></trk>');
  }
  lines.push('</gpx>', '');
  return lines.join('\n');
}

export function toKml(input: ExportInput, name = 'Keeper'): string {
  const { tracks, stays } = prepared(input);
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`, `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>${esc(name)}</name>`];
  for (const s of stays) out.push(`<Placemark>${s.name ? `<name>${esc(s.name)}</name>` : ''}<TimeSpan><begin>${iso(s.start)}</begin><end>${iso(s.end)}</end></TimeSpan><Point><coordinates>${r6(s.lon)},${r6(s.lat)}</coordinates></Point></Placemark>`);
  for (const t of tracks) {
    out.push(`<Placemark><name>${esc(t.name)}</name><ExtendedData><Data name="sport"><value>${t.sport}</value></Data></ExtendedData><gx:Track>`);
    for (const p of t.points) out.push(`<when>${iso(p.t)}</when>`);
    for (const p of t.points) out.push(`<gx:coord>${r6(p.lon)} ${r6(p.lat)} ${p.ele ?? 0}</gx:coord>`);
    out.push('</gx:Track></Placemark>');
  }
  out.push('</Document></kml>', '');
  return out.join('\n');
}

export function toGeoJson(input: ExportInput): string {
  const { tracks, stays } = prepared(input);
  const features: unknown[] = [];
  for (const s of stays) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [r6(s.lon), r6(s.lat)] }, properties: { kind: 'stay', name: s.name, start: iso(s.start), end: iso(s.end) } });
  for (const t of tracks) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: t.points.map((p) => (p.ele !== undefined ? [r6(p.lon), r6(p.lat), p.ele] : [r6(p.lon), r6(p.lat)])) },
      properties: { kind: 'track', name: t.name, sport: t.sport, start: iso(t.start), end: iso(t.end), coordTimes: t.points.map((p) => iso(p.t)), ...(t.points.some((p) => p.hr !== undefined) ? { heartRates: t.points.map((p) => p.hr ?? null) } : {}) },
    });
  }
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 1);
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  // A cell starting with = + - @ is a formula in spreadsheet apps: neutralise it.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(input: ExportInput): string {
  const { tracks, stays } = prepared(input);
  const rows = [['kind', 'name', 'time', 'lat', 'lon', 'ele', 'speed_mps', 'hr', 'cadence', 'end']];
  for (const s of stays) rows.push(['stay', s.name ?? '', iso(s.start), String(r6(s.lat)), String(r6(s.lon)), '', '', '', '', iso(s.end)]);
  for (const t of tracks) for (const p of t.points) rows.push(['track', t.name, iso(p.t), String(r6(p.lat)), String(r6(p.lon)), num(p.ele), num(p.speed), num(p.hr), num(p.cad), '']);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

const num = (v: number | undefined) => (v === undefined ? '' : String(Math.round(v * 100) / 100));

export function exportAs(format: ExportFormat, input: ExportInput): string {
  if (format === 'gpx') return toGpx(input);
  if (format === 'kml') return toKml(input);
  if (format === 'geojson') return toGeoJson(input);
  return toCsv(input);
}

export const EXPORT_EXT: Record<ExportFormat, string> = { gpx: 'gpx', kml: 'kml', geojson: 'geojson', csv: 'csv' };

/** A plain HTML page for printing a trip (no scripts, no outside resources). */
export function tripSummaryHtml(trip: Trip, countryName: (cc: string) => string, tracks: Track[] = []): string {
  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const rows = trip.days.map((d) => {
    const items = d.entries.map((e) => {
      if (e.kind === 'stay') return `<li>${time(e.start)} · ${esc(e.name ?? 'A place')}</li>`;
      if (e.kind === 'move') return `<li>${time(e.start)} · ${SPORT_LABEL[e.mode]} ${fmtDistance(e.distanceM)}</li>`;
      if (e.kind === 'activity') {
        const t = tracks.find((x) => x.id === e.track);
        return `<li>${time(e.start)} · ${esc(e.name)} ${fmtDistance(e.distanceM)}${t ? ` in ${fmtDuration(effectiveStats(t).movingS)}` : ''}</li>`;
      }
      if (e.kind === 'event') return `<li>${time(e.start)} · ${esc(e.title)}${e.location ? ` (${esc(e.location)})` : ''}</li>`;
      return '';
    }).filter(Boolean).join('');
    return `<section><h2>${day(d.day)}${d.places.length ? ` · ${esc(d.places.join(', '))}` : ''}</h2><ul>${items || '<li>Nothing recorded</li>'}</ul><p class="m">${fmtDistance(d.distanceM)} travelled</p></section>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(trip.title)}</title><style>body{font:14px/1.45 system-ui,sans-serif;max-width:720px;margin:24px auto;color:#222}h1{margin:0 0 4px}h2{font-size:15px;margin:18px 0 4px}ul{margin:0;padding-left:18px}.m{color:#666;margin:2px 0 0}</style></head><body>
<h1>${esc(trip.title)}</h1>
<p class="m">${day(trip.start)} – ${day(trip.end)} · ${trip.days.length} days · ${fmtDistance(trip.distanceM)} · ${trip.countries.map(countryName).map(esc).join(', ') || 'one country'}${trip.flights ? ` · ${trip.flights} flight${trip.flights === 1 ? '' : 's'}` : ''}${trip.photos ? ` · ${trip.photos} photos` : ''}</p>
${rows}
</body></html>`;
}

export type { Point };
