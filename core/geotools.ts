// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Coordinates in every common form: decimal degrees, degrees-minutes-seconds,
// degrees and decimal minutes, UTM, geohash and plus codes, plus distances and
// bearings between points. Pure maths; nothing is looked up online.

export interface LatLon {
  lat: number;
  lon: number;
}

const r2d = (r: number) => (r * 180) / Math.PI;
const d2r = (d: number) => (d * Math.PI) / 180;

/** Reads "52.52, 13.405", "52°31'12.0\"N 13°24'18\"E", "N 52 31.2 E 13 24.3", "52.52N 13.40E" and geo: links. */
export function parseCoordinates(input: string): LatLon | undefined {
  const s = input.trim().replace(/^geo:/i, '').replace(/[,;]+/g, ' ').replace(/[′’']/g, "'").replace(/[″”"]/g, '"').replace(/\s+/g, ' ');
  // Google Maps links: …/@52.52,13.405,15z or ?q=52.52,13.405
  const link = input.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) ?? input.match(/[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (link) return check(+link[1], +link[2]);
  const part = String.raw`([NSEW])?\s*(-?\d+(?:\.\d+)?)(?:\s*°\s*|\s+|d\s*)?(?:(\d+(?:\.\d+)?)\s*'?\s*)?(?:(\d+(?:\.\d+)?)\s*"?\s*)?([NSEW])?`;
  const m = s.match(new RegExp(`^${part}\\s+${part}$`, 'i'));
  if (!m) return undefined;
  const one = (h1: string | undefined, d: string, mi: string | undefined, se: string | undefined, h2: string | undefined) => {
    let v = Math.abs(+d) + (mi ? +mi / 60 : 0) + (se ? +se / 3600 : 0);
    const hemi = (h1 ?? h2 ?? '').toUpperCase();
    if (d.startsWith('-') || hemi === 'S' || hemi === 'W') v = -v;
    return { v, hemi };
  };
  const a = one(m[1], m[2], m[3], m[4], m[5]);
  const b = one(m[6], m[7], m[8], m[9], m[10]);
  // "E 13 N 52" order: the one marked E/W is the longitude.
  if (a.hemi === 'E' || a.hemi === 'W') return check(b.v, a.v);
  return check(a.v, b.v);
}

function check(lat: number, lon: number): LatLon | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
}

export function toDecimal(p: LatLon, digits = 6): string {
  return `${p.lat.toFixed(digits)}, ${p.lon.toFixed(digits)}`;
}

function dms(v: number, pos: string, neg: string): string {
  const a = Math.abs(v);
  let d = Math.floor(a);
  let m = Math.floor((a - d) * 60);
  let s = Math.round(((a - d) * 60 - m) * 60 * 10) / 10;
  if (s >= 60) { s = 0; m++; }
  if (m >= 60) { m = 0; d++; }
  return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${v < 0 ? neg : pos}`;
}

export function toDms(p: LatLon): string {
  return `${dms(p.lat, 'N', 'S')} ${dms(p.lon, 'E', 'W')}`;
}

export function toDdm(p: LatLon): string {
  const f = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    return `${d}° ${((a - d) * 60).toFixed(3)}′ ${v < 0 ? neg : pos}`;
  };
  return `${f(p.lat, 'N', 'S')}, ${f(p.lon, 'E', 'W')}`;
}

// ---------------------------------------------------------------- UTM (WGS 84)

export function toUtm(p: LatLon): { zone: number; band: string; easting: number; northing: number; text: string } {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  let zone = Math.floor((p.lon + 180) / 6) + 1;
  // Norway and Svalbard exceptions.
  if (p.lat >= 56 && p.lat < 64 && p.lon >= 3 && p.lon < 12) zone = 32;
  if (p.lat >= 72 && p.lat < 84) zone = p.lon < 9 ? 31 : p.lon < 21 ? 33 : p.lon < 33 ? 35 : 37;
  const lon0 = d2r((zone - 1) * 6 - 180 + 3);
  const phi = d2r(p.lat);
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (d2r(p.lon) - lon0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const easting = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let northing = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 + ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (p.lat < 0) northing += 10000000;
  const bands = 'CDEFGHJKLMNPQRSTUVWXX';
  const band = bands[Math.min(20, Math.max(0, Math.floor((p.lat + 80) / 8)))];
  return { zone, band, easting: Math.round(easting), northing: Math.round(northing), text: `${zone}${band} ${Math.round(easting)}E ${Math.round(northing)}N` };
}

// ---------------------------------------------------------------- geohash

const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohash(p: LatLon, precision = 9): string {
  let lat: [number, number] = [-90, 90];
  let lon: [number, number] = [-180, 180];
  let out = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (out.length < precision) {
    const range = even ? lon : lat;
    const v = even ? p.lon : p.lat;
    const mid = (range[0] + range[1]) / 2;
    if (v >= mid) {
      ch = (ch << 1) | 1;
      range[0] = mid;
    } else {
      ch <<= 1;
      range[1] = mid;
    }
    even = !even;
    if (++bit === 5) {
      out += B32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
}

export function fromGeohash(h: string): LatLon | undefined {
  let lat: [number, number] = [-90, 90];
  let lon: [number, number] = [-180, 180];
  let even = true;
  for (const c of h.toLowerCase()) {
    const v = B32.indexOf(c);
    if (v < 0) return undefined;
    for (let b = 4; b >= 0; b--) {
      const range = even ? lon : lat;
      const mid = (range[0] + range[1]) / 2;
      if ((v >> b) & 1) range[0] = mid;
      else range[1] = mid;
      even = !even;
    }
  }
  return { lat: (lat[0] + lat[1]) / 2, lon: (lon[0] + lon[1]) / 2 };
}

// ---------------------------------------------------------------- plus codes (Open Location Code)

const OLC = '23456789CFGHJMPQRVWX';

export function plusCode(p: LatLon, length = 10): string {
  let lat = Math.min(89.9999999, Math.max(-90, p.lat)) + 90;
  let lon = ((((p.lon + 180) % 360) + 360) % 360);
  let code = '';
  let res = 20;
  for (let i = 0; i < 5 && code.length < Math.min(10, length); i++) {
    const la = Math.floor(lat / res);
    const lo = Math.floor(lon / res);
    lat -= la * res;
    lon -= lo * res;
    code += OLC[la] + OLC[lo];
    res /= 20;
  }
  return `${code.slice(0, 8)}+${code.slice(8)}`;
}

// ---------------------------------------------------------------- distances

const EARTH_KM = 6371.0088;

export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = d2r(b.lat - a.lat);
  const dLon = d2r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(d2r(a.lat)) * Math.cos(d2r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from a to b, 0–360°. */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(d2r(b.lon - a.lon)) * Math.cos(d2r(b.lat));
  const x = Math.cos(d2r(a.lat)) * Math.sin(d2r(b.lat)) - Math.sin(d2r(a.lat)) * Math.cos(d2r(b.lat)) * Math.cos(d2r(b.lon - a.lon));
  return (r2d(Math.atan2(y, x)) + 360) % 360;
}

export function compass(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

/** Every format at once, for the tool's table. */
export function allFormats(p: LatLon): { label: string; value: string }[] {
  return [
    { label: 'Decimal', value: toDecimal(p) },
    { label: 'Degrees, minutes, seconds', value: toDms(p) },
    { label: 'Degrees and minutes', value: toDdm(p) },
    { label: 'UTM', value: toUtm(p).text },
    { label: 'Geohash', value: geohash(p) },
    { label: 'Plus code', value: plusCode(p) },
    { label: 'Map link', value: `https://www.openstreetmap.org/?mlat=${p.lat.toFixed(6)}&mlon=${p.lon.toFixed(6)}#map=16/${p.lat.toFixed(5)}/${p.lon.toFixed(5)}` },
    { label: 'geo: link', value: `geo:${p.lat.toFixed(6)},${p.lon.toFixed(6)}` },
  ];
}
