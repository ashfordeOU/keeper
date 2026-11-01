// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// GPX, KML, GeoJSON and TCX: the open track formats every watch, phone and
// mapping site can write. Each reader returns an ImportResult.

import { validLL } from './geo';
import { finishTrack } from './stats';
import { emptyImport, type HistoryPoint, type ImportResult, type Point, type SourceKind, type Track } from './types';
import { hashId, parseTime, sportFrom } from './util';
import { all, child, children, firstDeep, num, parseXml, text, type XNode } from './xml';

function makeTrack(source: SourceKind, name: string, sportHint: string | undefined, points: Point[], extra: Partial<Track> = {}): Track | undefined {
  const pts = points.filter((p) => validLL(p.lat, p.lon));
  if (pts.length < 2) return undefined;
  const sourceId = extra.sourceId ?? `${pts[0].t}:${pts[0].lat.toFixed(5)},${pts[0].lon.toFixed(5)}:${pts.length}`;
  return finishTrack({ id: hashId(`${source}:${sourceId}`), name: name || 'Track', sport: sportFrom(sportHint ?? name), source, sourceId, points: pts, ...extra });
}

// ---------------------------------------------------------------- GPX

function gpxPoint(n: XNode, i: number): Point {
  const ext = child(n, 'extensions');
  const tpe = ext ? firstDeep(ext, 'TrackPointExtension') ?? ext : undefined;
  const t = parseTime(text(n, 'time'));
  return {
    // Routes and some exports have no times: keep the order with one second apart.
    t: Number.isFinite(t) ? t : i * 1000,
    lat: Number(n.attrs.lat),
    lon: Number(n.attrs.lon),
    ele: num(text(n, 'ele')),
    hr: num(text(tpe, 'hr') ?? (ext && text(firstDeep(ext, 'hr')))),
    cad: num(text(tpe, 'cad') ?? (ext && text(firstDeep(ext, 'cad')))),
    power: num(ext && text(firstDeep(ext, 'power'))),
    speed: num(text(n, 'speed') ?? text(tpe, 'speed')),
  };
}

const strip = (p: Point): Point => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as unknown as Point;

export function parseGpx(src: string, source: SourceKind = 'gpx'): ImportResult {
  const out = emptyImport('GPX');
  const root = parseXml(src);
  const gpx = firstDeep(root, 'gpx');
  if (!gpx) {
    out.warnings.push('This is not a GPX file.');
    return out;
  }
  const fileName = text(child(gpx, 'metadata'), 'name');
  for (const trk of children(gpx, 'trk')) {
    const pts: Point[] = [];
    let i = 0;
    for (const seg of children(trk, 'trkseg')) for (const p of children(seg, 'trkpt')) pts.push(strip(gpxPoint(p, i++)));
    const hasTime = pts.some((p) => p.t > 1e9);
    const tr = makeTrack(source, text(trk, 'name') ?? fileName ?? '', text(trk, 'type') ?? text(trk, 'name'), pts, hasTime ? {} : { planned: true });
    if (tr) out.tracks.push(tr);
  }
  for (const rte of children(gpx, 'rte')) {
    const pts = children(rte, 'rtept').map((p, i) => strip(gpxPoint(p, i)));
    const tr = makeTrack(source, text(rte, 'name') ?? 'Route', text(rte, 'type'), pts, { planned: true });
    if (tr) out.tracks.push(tr);
  }
  // Waypoints with a time are moments someone was somewhere.
  for (const w of children(gpx, 'wpt')) {
    const t = parseTime(text(w, 'time'));
    const lat = Number(w.attrs.lat), lon = Number(w.attrs.lon);
    if (Number.isFinite(t) && validLL(lat, lon)) out.visits.push({ id: hashId(`gpx-wpt:${t}:${lat}:${lon}`), start: t, end: t, lat, lon, name: text(w, 'name'), source });
  }
  if (!out.tracks.length && !out.visits.length) out.warnings.push('No tracks with at least two points were found.');
  return out;
}

// ---------------------------------------------------------------- KML (and KMZ once unpacked)

function kmlCoords(s: string | undefined): { lat: number; lon: number; ele?: number }[] {
  if (!s) return [];
  return s.trim().split(/\s+/).map((c) => {
    const [lon, lat, ele] = c.split(',').map(Number);
    return { lat, lon, ele: Number.isFinite(ele) && ele !== 0 ? ele : undefined };
  }).filter((p) => validLL(p.lat, p.lon));
}

export function parseKml(src: string, source: SourceKind = 'kml'): ImportResult {
  const out = emptyImport('KML');
  const root = parseXml(src);
  if (!firstDeep(root, 'kml') && !firstDeep(root, 'Placemark')) {
    out.warnings.push('This is not a KML file.');
    return out;
  }
  for (const pm of all(root, 'Placemark')) {
    const name = text(pm, 'name') ?? '';
    const span = child(pm, 'TimeSpan');
    const begin = parseTime(text(span, 'begin') ?? text(child(pm, 'TimeStamp'), 'when'));
    const end = parseTime(text(span, 'end')) || begin;
    const category = all(pm, 'Data').find((d) => /category|activity|type/i.test(d.attrs.name ?? ''));
    const sportHint = (category && text(category, 'value')) ?? name;
    // gx:Track: a time for each coordinate.
    for (const gt of [...all(pm, 'Track'), ...all(pm, 'MultiTrack').flatMap((m) => all(m, 'Track'))]) {
      const whens = children(gt, 'when').map((w) => parseTime(w.text.trim()));
      const coords = children(gt, 'coord').map((c) => c.text.trim().split(/\s+/).map(Number));
      const pts: Point[] = [];
      for (let i = 0; i < Math.min(whens.length, coords.length); i++) {
        const [lon, lat, ele] = coords[i];
        if (Number.isFinite(whens[i])) pts.push(strip({ t: whens[i], lat, lon, ele: Number.isFinite(ele) ? ele : undefined }));
      }
      const tr = makeTrack(source, name, sportHint, pts);
      if (tr && !out.tracks.some((x) => x.id === tr.id)) out.tracks.push(tr);
    }
    for (const ls of all(pm, 'LineString')) {
      const coords = kmlCoords(text(ls, 'coordinates'));
      if (coords.length < 2) continue;
      const timed = Number.isFinite(begin);
      // Spread the span's time along the line (old Google Location History KML gives a span per move).
      const t0 = timed ? begin : 0;
      const dt = timed && Number.isFinite(end) && end > begin ? (end - begin) / (coords.length - 1) : 1000;
      const pts = coords.map((c, i) => strip({ t: t0 + i * dt, lat: c.lat, lon: c.lon, ele: c.ele }));
      const tr = makeTrack(source, name, sportHint, pts, timed ? {} : { planned: true });
      if (tr) out.tracks.push(tr);
    }
    const pt = child(pm, 'Point');
    if (pt && Number.isFinite(begin)) {
      const [c] = kmlCoords(text(pt, 'coordinates'));
      if (c) out.visits.push({ id: hashId(`kml:${begin}:${c.lat}:${c.lon}`), start: begin, end: Number.isFinite(end) ? end : begin, lat: c.lat, lon: c.lon, name: name || undefined, address: text(pm, 'address'), source });
    }
  }
  if (!out.tracks.length && !out.visits.length) out.warnings.push('No tracks or timed places were found.');
  return out;
}

// ---------------------------------------------------------------- GeoJSON

type Json = Record<string, unknown>;

export function parseGeoJson(src: string | Json, source: SourceKind = 'geojson'): ImportResult {
  const out = emptyImport('GeoJSON');
  let j: Json;
  try {
    j = typeof src === 'string' ? JSON.parse(src) : src;
  } catch {
    out.warnings.push('This is not valid JSON.');
    return out;
  }
  const features: Json[] = j.type === 'FeatureCollection' ? (j.features as Json[]) ?? [] : j.type === 'Feature' ? [j] : j.type ? [{ type: 'Feature', geometry: j, properties: {} }] : [];
  for (const f of features) {
    const g = f.geometry as { type: string; coordinates: unknown } | null;
    const props = (f.properties ?? {}) as Json;
    if (!g) continue;
    const name = String(props.name ?? props.title ?? '');
    const sportHint = String(props.sport ?? props.activity ?? props.type ?? props.activityType ?? name);
    const times = (props.coordTimes ?? props.times ?? props.timestamps) as unknown;
    const lines: number[][][] = g.type === 'LineString' ? [g.coordinates as number[][]] : g.type === 'MultiLineString' ? (g.coordinates as number[][][]) : [];
    lines.forEach((line, li) => {
      const ts = Array.isArray(times) ? (Array.isArray(times[0]) ? (times as unknown[][])[li] : times) : undefined;
      const start = parseTime(props.start as string ?? props.startTime as string ?? props.time as string);
      const pts: Point[] = line.map((c, i) => {
        const t = ts ? parseTime(ts[i] as string) : c.length > 3 ? parseTime(c[3]) : Number.isFinite(start) ? start + i * 1000 : i * 1000;
        return strip({ t, lat: c[1], lon: c[0], ele: c.length > 2 && Number.isFinite(c[2]) ? c[2] : undefined, hr: Array.isArray(props.heartRates) ? Number((props.heartRates as unknown[])[i]) || undefined : undefined });
      });
      const timed = !!ts || line.some((c) => c.length > 3) || Number.isFinite(start);
      const tr = makeTrack(source, name, sportHint, pts, timed ? {} : { planned: true });
      if (tr) out.tracks.push(tr);
    });
    if (g.type === 'Point') {
      const [lon, lat, ele] = g.coordinates as number[];
      const t = parseTime((props.time ?? props.timestamp ?? props.start ?? props.startTime) as string);
      const end = parseTime((props.end ?? props.endTime) as string);
      if (!validLL(lat, lon) || !Number.isFinite(t)) continue;
      if (Number.isFinite(end) && end > t) out.visits.push({ id: hashId(`geojson:${t}:${lat}:${lon}`), start: t, end, lat, lon, name: name || undefined, source });
      else out.history.push({ t, lat, lon, ele: Number.isFinite(ele) ? ele : undefined, src: source } as HistoryPoint);
    }
  }
  if (!out.tracks.length && !out.visits.length && !out.history.length) out.warnings.push('No lines or timed points were found.');
  return out;
}

// ---------------------------------------------------------------- TCX

function tcxPoints(trackNodes: XNode[]): Point[] {
  const pts: Point[] = [];
  for (const tr of trackNodes) {
    for (const tp of children(tr, 'Trackpoint')) {
      const pos = child(tp, 'Position');
      if (!pos) continue;
      const ext = child(tp, 'Extensions');
      pts.push(strip({
        t: parseTime(text(tp, 'Time')),
        lat: Number(text(pos, 'LatitudeDegrees')),
        lon: Number(text(pos, 'LongitudeDegrees')),
        ele: num(text(tp, 'AltitudeMeters')),
        hr: num(text(child(tp, 'HeartRateBpm'), 'Value')),
        cad: num(text(tp, 'Cadence') ?? (ext && text(firstDeep(ext, 'RunCadence')))),
        speed: num(ext && text(firstDeep(ext, 'Speed'))),
        power: num(ext && text(firstDeep(ext, 'Watts'))),
      }));
    }
  }
  return pts;
}

export function parseTcx(src: string, source: SourceKind = 'tcx'): ImportResult {
  const out = emptyImport('TCX');
  const root = parseXml(src);
  if (!firstDeep(root, 'TrainingCenterDatabase')) {
    out.warnings.push('This is not a TCX file.');
    return out;
  }
  for (const act of all(root, 'Activity')) {
    const laps = children(act, 'Lap');
    const pts = tcxPoints(laps.flatMap((l) => children(l, 'Track')));
    const id = text(act, 'Id');
    const reported = {
      elapsedS: laps.reduce((s, l) => s + (num(text(l, 'TotalTimeSeconds')) ?? 0), 0) || undefined,
      distanceM: laps.reduce((s, l) => s + (num(text(l, 'DistanceMeters')) ?? 0), 0) || undefined,
      calories: laps.reduce((s, l) => s + (num(text(l, 'Calories')) ?? 0), 0) || undefined,
    };
    const sport = act.attrs.Sport ?? 'Other';
    const tr = makeTrack(source, `${sport} ${id ? new Date(parseTime(id)).toISOString().slice(0, 10) : ''}`.trim(), sport, pts, { sourceId: id, reported });
    if (tr) out.tracks.push(tr);
    else if (id && Number.isFinite(parseTime(id)) && reported.elapsedS) {
      // An indoor activity: no points, but the numbers still count.
      const start = parseTime(id);
      out.tracks.push({ id: hashId(`${source}:${id}`), name: sport, sport: sportFrom(sport), source, sourceId: id, start, end: start + reported.elapsedS * 1000, points: [], stats: { distanceM: 0, elapsedS: 0, movingS: 0, ascentM: 0, descentM: 0 }, reported });
    }
  }
  for (const c of all(root, 'Course')) {
    const tr = makeTrack(source, text(c, 'Name') ?? 'Course', text(c, 'Name'), tcxPoints(children(c, 'Track')), { planned: true });
    if (tr) out.tracks.push(tr);
  }
  if (!out.tracks.length) out.warnings.push('No activities were found.');
  return out;
}
