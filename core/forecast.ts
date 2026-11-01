// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Weather page beyond the Island tile: saved places, health advice for air
// quality and UV, official alerts (US), radar tiles, climate comparison and
// forecasts for trips taken from the calendar.

import type { CalendarEvent } from './island';
import type { Place, Weather } from './weather';

// ---------------------------------------------------------------- advice

export function aqiAdvice(aqi: number | undefined): { level: string; tone: 'ok' | 'warn' | 'danger'; advice: string } | undefined {
  if (aqi === undefined || !Number.isFinite(aqi)) return undefined;
  if (aqi <= 50) return { level: 'Good', tone: 'ok', advice: 'Air is clean. A good day to be outside.' };
  if (aqi <= 100) return { level: 'Moderate', tone: 'warn', advice: 'Fine for most people. If you are very sensitive, take it easier outdoors.' };
  if (aqi <= 150) return { level: 'Unhealthy for sensitive groups', tone: 'warn', advice: 'People with asthma, heart or lung conditions, children and older adults should cut back on long outdoor effort.' };
  if (aqi <= 200) return { level: 'Unhealthy', tone: 'danger', advice: 'Everyone should reduce long or heavy outdoor effort. Keep windows closed.' };
  if (aqi <= 300) return { level: 'Very unhealthy', tone: 'danger', advice: 'Avoid outdoor effort. Consider a mask outside and an air purifier inside.' };
  return { level: 'Hazardous', tone: 'danger', advice: 'Stay indoors with windows closed.' };
}

export function uvAdvice(uv: number | undefined): { level: string; tone: 'ok' | 'warn' | 'danger'; advice: string } | undefined {
  if (uv === undefined || !Number.isFinite(uv)) return undefined;
  if (uv < 3) return { level: 'Low', tone: 'ok', advice: 'No protection needed for most people.' };
  if (uv < 6) return { level: 'Moderate', tone: 'warn', advice: 'Wear sunglasses and sunscreen if you are out for long; seek shade around midday.' };
  if (uv < 8) return { level: 'High', tone: 'warn', advice: 'Sunscreen, a hat and sunglasses. Shade between 11 and 3.' };
  if (uv < 11) return { level: 'Very high', tone: 'danger', advice: 'Unprotected skin burns quickly. Avoid the midday sun.' };
  return { level: 'Extreme', tone: 'danger', advice: 'Stay out of the sun around midday; cover up fully.' };
}

/** Wind direction in degrees -> "NE". */
export function compass(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

// ---------------------------------------------------------------- places

export function samePlace(a: Place, b: Place): boolean {
  return Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
}

export function addPlace(list: Place[], p: Place): Place[] {
  return list.some((x) => samePlace(x, p)) ? list : [...list, p];
}

export function movePlace(list: Place[], from: number, to: number): Place[] {
  const out = [...list];
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it);
  return out;
}

// ---------------------------------------------------------------- alerts

export interface WeatherAlert {
  id: string;
  title: string;
  severity: 'minor' | 'moderate' | 'severe' | 'extreme' | 'unknown';
  headline: string;
  description: string;
  instruction?: string;
  starts?: number;
  ends?: number;
  source: string;
}

/** Parses the US National Weather Service active-alerts GeoJSON. */
export function parseNwsAlerts(json: unknown): WeatherAlert[] {
  const feats = ((json as { features?: { id?: string; properties?: Record<string, string | null> }[] })?.features ?? []);
  return feats.map((f) => {
    const p = f.properties ?? {};
    const sev = (p.severity ?? '').toLowerCase();
    return {
      id: f.id ?? p.id ?? Math.random().toString(36),
      title: p.event ?? 'Weather alert',
      severity: (['minor', 'moderate', 'severe', 'extreme'].includes(sev) ? sev : 'unknown') as WeatherAlert['severity'],
      headline: p.headline ?? '',
      description: (p.description ?? '').trim(),
      instruction: p.instruction?.trim() || undefined,
      starts: p.onset ? Date.parse(p.onset) : p.effective ? Date.parse(p.effective) : undefined,
      ends: p.ends ? Date.parse(p.ends) : p.expires ? Date.parse(p.expires) : undefined,
      source: p.senderName ?? 'National Weather Service',
    };
  });
}

/** Rough box around the 50 states and territories the NWS covers. */
export function inUnitedStates(p: Place): boolean {
  const { lat, lon } = p;
  const lower48 = lat > 24 && lat < 50 && lon > -125 && lon < -66;
  const alaska = lat > 51 && lat < 72 && (lon < -129 || lon > 172);
  const hawaii = lat > 18 && lat < 23 && lon > -161 && lon < -154;
  const pr = lat > 17.8 && lat < 18.6 && lon > -67.5 && lon < -65;
  return lower48 || alaska || hawaii || pr || p.country === 'United States';
}

// ---------------------------------------------------------------- radar tiles

/** Web Mercator tile numbers for a point at a zoom level. */
export function tileOf(lat: number, lon: number, z: number): { x: number; y: number; fx: number; fy: number } {
  const n = 2 ** z;
  const xf = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x: Math.floor(xf), y: Math.floor(yf), fx: xf - Math.floor(xf), fy: yf - Math.floor(yf) };
}

/** The tiles needed to cover a cols×rows grid centred on a place. */
export function tileGrid(lat: number, lon: number, z: number, cols = 3, rows = 3): { x: number; y: number; col: number; row: number }[] {
  const c = tileOf(lat, lon, z);
  const n = 2 ** z;
  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = (((c.x + col - Math.floor(cols / 2)) % n) + n) % n;
      const y = c.y + row - Math.floor(rows / 2);
      if (y >= 0 && y < n) out.push({ x, y, col, row });
    }
  }
  return out;
}

export interface RadarFrame {
  time: number;
  path: string;
}

/** Past (and nowcast) radar frames from the public radar index. */
export function parseRadarIndex(json: unknown): { host: string; frames: RadarFrame[] } | undefined {
  const d = json as { host?: string; radar?: { past?: { time: number; path: string }[]; nowcast?: { time: number; path: string }[] } };
  if (!d?.host || !d.radar) return undefined;
  const frames = [...(d.radar.past ?? []), ...(d.radar.nowcast ?? [])].map((f) => ({ time: f.time * 1000, path: f.path }));
  return frames.length ? { host: d.host, frames } : undefined;
}

export function radarTileUrl(host: string, frame: RadarFrame, z: number, x: number, y: number): string {
  // 256 px tiles, colour scheme 2, smoothed, with snow.
  return `${host}${frame.path}/256/${z}/${x}/${y}/2/1_1.png`;
}

export function mapTileUrl(z: number, x: number, y: number): string {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

// ---------------------------------------------------------------- climate

export interface MonthlyClimate {
  month: number;
  avgMax: number;
  avgMin: number;
  rainMm: number;
  rainyDays: number;
  sunHours?: number;
}

/** Averages the daily archive (several years) into twelve months. */
export function monthlyAverages(daily: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[]; precipitation_sum: (number | null)[]; sunshine_duration?: (number | null)[] }): MonthlyClimate[] {
  const acc = Array.from({ length: 12 }, () => ({ max: 0, min: 0, n: 0, rain: 0, wet: 0, sun: 0, sunN: 0, years: new Set<string>() }));
  daily.time.forEach((t, i) => {
    const m = Number(t.slice(5, 7)) - 1;
    const a = acc[m];
    if (!a) return;
    const mx = daily.temperature_2m_max[i];
    const mn = daily.temperature_2m_min[i];
    const pr = daily.precipitation_sum[i];
    if (mx === null || mn === null) return;
    a.max += mx;
    a.min += mn;
    a.n++;
    a.rain += pr ?? 0;
    if ((pr ?? 0) >= 1) a.wet++;
    a.years.add(t.slice(0, 4));
    const sun = daily.sunshine_duration?.[i];
    if (sun !== null && sun !== undefined) {
      a.sun += sun / 3600;
      a.sunN++;
    }
  });
  return acc.map((a, month) => {
    const years = Math.max(1, a.years.size);
    return {
      month,
      avgMax: a.n ? Math.round((a.max / a.n) * 10) / 10 : NaN,
      avgMin: a.n ? Math.round((a.min / a.n) * 10) / 10 : NaN,
      rainMm: Math.round(a.rain / years),
      rainyDays: Math.round(a.wet / years),
      sunHours: a.sunN ? Math.round(a.sun / years) : undefined,
    };
  });
}

export function climateUrl(p: Place, years = 5, now = new Date()): string {
  const end = new Date(now.getFullYear() - 1, 11, 31);
  const start = new Date(end.getFullYear() - years + 1, 0, 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return `https://archive-api.open-meteo.com/v1/archive?latitude=${p.lat}&longitude=${p.lon}&start_date=${iso(start)}&end_date=${iso(end)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration&timezone=auto`;
}

// ---------------------------------------------------------------- trips

export interface TripStop {
  event: CalendarEvent;
  /** where the event is, as written in the calendar */
  location: string;
  day: number;
}

const ONLINE = /(zoom\.us|meet\.google|teams\.microsoft|webex|whereby|https?:\/\/|online|virtual|phone|call\b|tbd|n\/a)/i;

/** Events in the next `days` with a real-world location, one per location and day. */
export function tripStops(events: CalendarEvent[], now = Date.now(), days = 14): TripStop[] {
  const seen = new Set<string>();
  const out: TripStop[] = [];
  for (const e of events) {
    if (!e.location || ONLINE.test(e.location) || e.start > now + days * 86_400_000 || e.end < now) continue;
    const day = new Date(e.start).setHours(0, 0, 0, 0);
    // Rooms like "Room 4" or "3rd floor" are not places to forecast.
    const loc = e.location.replace(/\s+/g, ' ').trim();
    if (/^(room|rm|floor|level|desk|office|conf\w*)\b/i.test(loc) || loc.length < 3) continue;
    const key = `${loc.toLowerCase()}@${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ event: e, location: loc, day });
  }
  return out.sort((a, b) => a.event.start - b.event.start);
}

/** The part of an address most likely to geocode: "Hotel X, 12 Rua Y, Lisbon, Portugal" -> "Lisbon". */
export function geocodeQuery(location: string): string[] {
  const parts = location.split(',').map((p) => p.replace(/\b\d{4,6}\b/g, '').trim()).filter(Boolean);
  const cands = [];
  if (parts.length >= 2) cands.push(parts[parts.length - 2], parts[parts.length - 1]);
  cands.push(parts[0], location);
  return [...new Set(cands.filter((c) => c && !/^\d/.test(c)))];
}

/** The forecast day matching a date, if the forecast reaches it. */
export function dayForecast(w: Weather, day: number): Weather['daily'][number] | undefined {
  return w.daily.find((d) => new Date(d.t).setHours(0, 0, 0, 0) === day) ?? w.daily.find((d) => Math.abs(d.t - day) < 86_400_000);
}

/** Moon phase 0..1 (0 = new, 0.5 = full) and its name. */
export function moonPhase(t = Date.now()): { phase: number; name: string; illumination: number } {
  const synodic = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const days = (t - ref) / 86_400_000;
  const phase = (((days / synodic) % 1) + 1) % 1;
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  const name = names[Math.round(phase * 8) % 8];
  return { phase, name, illumination: Math.round(((1 - Math.cos(phase * 2 * Math.PI)) / 2) * 100) };
}
