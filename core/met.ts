// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Forecasts from MET Norway (the Norwegian Meteorological Institute) through
// its Locationforecast 2.0 service: free for any use, data under CC BY 4.0.
// Its terms ask for a User-Agent that names the app and a way to reach its
// makers, coordinates with at most four decimals, and that a forecast is not
// asked for again before its Expires time (then with If-Modified-Since).
// https://api.met.no/doc/TermsOfService · https://api.met.no/weatherapi/locationforecast/2.0/documentation
//
// The answer is turned into Keeper's own Weather shape (core/weather.ts), with
// MET's symbol codes mapped to the WMO codes every view already draws.

import { sunTimes } from './astro';
import type { Place, Weather } from './weather';
import { dayKey, hourAt } from './weather-view';

export const MET_HOST = 'https://api.met.no';
export const MET_SITE = 'https://keeper.ashforde.org';
export const MET_CREDIT = 'Weather data from MET Norway';
export const MET_LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/';

/** The identifying User-Agent MET Norway's terms ask for. */
export function metUserAgent(version: string): string {
  return `Keeper/${version.replace(/[^0-9A-Za-z.+-]/g, '') || '0'} ${MET_SITE}`;
}

/** Coordinates with at most four decimals (more is refused by the service). */
export function metCoord(v: number): string {
  return String(Math.round(v * 1e4) / 1e4);
}

export function metUrl(p: Pick<Place, 'lat' | 'lon'>, host = MET_HOST): string {
  return `${host}/weatherapi/locationforecast/2.0/complete?lat=${metCoord(p.lat)}&lon=${metCoord(p.lon)}`;
}

// ---------------------------------------------------------------- symbols

/**
 * MET's symbol code (without its _day/_night/_polartwilight ending) as a WMO
 * weather code, so the existing labels, glyphs and skies apply. The service's
 * own spellings are kept ("lightssleetshowersandthunder" has a double s).
 */
const SYMBOL_WMO: Record<string, number> = {
  clearsky: 0,
  fair: 1,
  partlycloudy: 2,
  cloudy: 3,
  fog: 45,
  lightrain: 61,
  rain: 63,
  heavyrain: 65,
  lightrainshowers: 80,
  rainshowers: 81,
  heavyrainshowers: 82,
  lightsleet: 66,
  sleet: 67,
  heavysleet: 67,
  lightsleetshowers: 66,
  sleetshowers: 67,
  heavysleetshowers: 67,
  lightsnow: 71,
  snow: 73,
  heavysnow: 75,
  lightsnowshowers: 85,
  snowshowers: 85,
  heavysnowshowers: 86,
  lightrainandthunder: 95,
  rainandthunder: 95,
  heavyrainandthunder: 95,
  lightsleetandthunder: 95,
  sleetandthunder: 95,
  heavysleetandthunder: 95,
  lightsnowandthunder: 95,
  snowandthunder: 95,
  heavysnowandthunder: 95,
  lightrainshowersandthunder: 95,
  rainshowersandthunder: 95,
  heavyrainshowersandthunder: 95,
  lightssleetshowersandthunder: 95,
  sleetshowersandthunder: 95,
  heavysleetshowersandthunder: 95,
  lightssnowshowersandthunder: 95,
  snowshowersandthunder: 95,
  heavysnowshowersandthunder: 95,
};

export const MET_SYMBOLS = Object.keys(SYMBOL_WMO);

/** "rainshowers_day" -> { code: 81, isDay: true }; unknown symbols read as cloudy. */
export function metSymbol(symbol: string | undefined): { code: number; isDay?: boolean } {
  if (!symbol) return { code: 3 };
  const m = /^([a-z]+?)(?:_(day|night|polartwilight))?$/.exec(symbol.trim().toLowerCase());
  const base = m?.[1] ?? symbol;
  const part = m?.[2];
  const code = SYMBOL_WMO[base];
  return { code: code ?? (/thunder/.test(base) ? 95 : /snow/.test(base) ? 73 : /sleet/.test(base) ? 67 : /rain/.test(base) ? 63 : 3), ...(part ? { isDay: part === 'day' } : {}) };
}

// ---------------------------------------------------------------- the answer

interface MetDetails {
  air_temperature?: number;
  air_pressure_at_sea_level?: number;
  relative_humidity?: number;
  dew_point_temperature?: number;
  wind_speed?: number;
  wind_speed_of_gust?: number;
  wind_from_direction?: number;
  ultraviolet_index_clear_sky?: number;
  fog_area_fraction?: number;
  cloud_area_fraction?: number;
}

interface MetPeriod {
  summary?: { symbol_code?: string };
  details?: { precipitation_amount?: number; probability_of_precipitation?: number; air_temperature_max?: number; air_temperature_min?: number };
}

export interface MetStep {
  time: string;
  data: { instant: { details: MetDetails }; next_1_hours?: MetPeriod; next_6_hours?: MetPeriod; next_12_hours?: MetPeriod };
}

export interface MetForecast {
  properties: { meta?: { updated_at?: string }; timeseries: MetStep[] };
}

/** "Feels like" from temperature, humidity and wind (the apparent temperature used by Australia's weather service). */
export function apparentTemp(c: number, humidity: number, windMs: number): number {
  const e = (humidity / 100) * 6.105 * Math.exp((17.27 * c) / (237.7 + c));
  return Math.round((c + 0.33 * e - 0.7 * windMs - 4) * 10) / 10;
}

/**
 * A rough time zone from the longitude (Etc/GMT±n), for places saved before
 * they carried their zone. Good enough to group hours into days.
 */
export function zoneFromLongitude(lon: number): string {
  const h = Math.max(-12, Math.min(14, Math.round(lon / 15)));
  return h === 0 ? 'Etc/GMT' : `Etc/GMT${h > 0 ? '-' : '+'}${Math.abs(h)}`;
}

/** The zone's offset from UTC at a moment, in seconds. */
export function zoneOffset(t: number, tz: string): number {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(t).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
    return Math.round((asUtc - Math.floor(t / 1000) * 1000) / 1000);
  } catch {
    return 0;
  }
}

/** Midnight of a yyyy-mm-dd day in a zone, as a time. */
export function zoneMidnight(day: string, tz: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Two passes settle days where the offset changes (summer time).
  let t = guess - zoneOffset(guess, tz) * 1000;
  t = guess - zoneOffset(t, tz) * 1000;
  return t;
}

type Units = 'metric' | 'imperial';
const temp = (c: number, u: Units) => (u === 'imperial' ? Math.round((c * 1.8 + 32) * 10) / 10 : c);
/** MET gives metres a second; Keeper shows km/h or mph. */
const speed = (ms: number, u: Units) => Math.round(ms * (u === 'imperial' ? 2.23694 : 3.6) * 10) / 10;
const rainOf = (mm: number, u: Units) => (u === 'imperial' ? Math.round((mm / 25.4) * 100) / 100 : mm);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const WET_MM = 0.1;

/** The symbol a step stands for: its next hour, else its next six or twelve. */
function stepSymbol(s: MetStep): string | undefined {
  return s.data.next_1_hours?.summary?.symbol_code ?? s.data.next_6_hours?.summary?.symbol_code ?? s.data.next_12_hours?.summary?.symbol_code;
}

/** Turns a Locationforecast answer into Keeper's forecast. */
export function parseMet(p: Place, units: Units, d: MetForecast, now = Date.now()): Weather {
  const steps = (d?.properties?.timeseries ?? []).map((s) => ({ s, t: Date.parse(s.time) })).filter((x) => Number.isFinite(x.t) && num(x.s.data?.instant?.details?.air_temperature) !== undefined).sort((a, b) => a.t - b.t);
  if (!steps.length) throw new Error('The weather service sent no forecast for this place');
  const tz = p.tz || zoneFromLongitude(p.lon);
  const isDayAt = (t: number, symbolDay?: boolean) => {
    if (symbolDay !== undefined) return symbolDay;
    const sun = sunTimes(t, p.lat, p.lon);
    if (sun.polar) return sun.polar === 'day';
    return t >= (sun.sunrise ?? 0) && t < (sun.sunset ?? 0);
  };

  const hours: Weather['hourly'] = steps.map(({ s, t }, i) => {
    const det = s.data.instant.details;
    const next = steps[i + 1]?.t;
    const span = next ? Math.round((next - t) / 3600_000) : 1;
    // Rain over the time until the next step: its next hour, or its next six hours where steps are six hours apart.
    const amount = span >= 6 ? s.data.next_6_hours?.details?.precipitation_amount : s.data.next_1_hours?.details?.precipitation_amount ?? s.data.next_6_hours?.details?.precipitation_amount;
    const chance = s.data.next_1_hours?.details?.probability_of_precipitation ?? s.data.next_6_hours?.details?.probability_of_precipitation ?? s.data.next_12_hours?.details?.probability_of_precipitation;
    const sym = metSymbol(stepSymbol(s));
    return {
      t,
      temp: temp(det.air_temperature!, units),
      code: sym.code,
      rainChance: Math.round(chance ?? ((amount ?? 0) >= WET_MM ? 70 : 0)),
      rain: rainOf(amount ?? 0, units),
      uv: num(det.ultraviolet_index_clear_sky) ?? 0,
      wind: speed(num(det.wind_speed) ?? 0, units),
      isDay: isDayAt(t, sym.isDay),
    };
  });

  const from = Math.max(0, hours.findIndex((h) => h.t + 3600_000 > now));
  const hourly = hours.slice(from, from + 24);
  const cur = steps[Math.max(0, steps.findIndex((x) => x.t + 3600_000 > now))] ?? steps[0];
  const det = cur.s.data.instant.details;
  const curSym = metSymbol(stepSymbol(cur.s));
  const hum = num(det.relative_humidity) ?? 0;
  const windMs = num(det.wind_speed) ?? 0;
  const nextHourMm = cur.s.data.next_1_hours?.details?.precipitation_amount;

  // Days at the place: every step falls in the day it starts in.
  const byDay = new Map<string, typeof steps>();
  for (const x of steps) {
    const k = dayKey(x.t, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), x]);
  }
  const daily: Weather['daily'] = [...byDay].map(([k, list]) => {
    const t0 = zoneMidnight(k, tz);
    const temps: number[] = [];
    let rainSum = 0;
    let chance = 0;
    let uvMax = 0;
    // Late in the day only a few hours are left: their six-hour highs and lows (tonight) give the range.
    const few = list.length < 6;
    for (const { s } of list) {
      temps.push(s.data.instant.details.air_temperature!);
      const six = s.data.next_6_hours?.details;
      const within = few || hourAt(Date.parse(s.time), tz) <= 18;
      if (six?.air_temperature_max !== undefined && within) temps.push(six.air_temperature_max);
      if (six?.air_temperature_min !== undefined && within) temps.push(six.air_temperature_min);
      chance = Math.max(chance, s.data.next_1_hours?.details?.probability_of_precipitation ?? s.data.next_6_hours?.details?.probability_of_precipitation ?? 0);
      uvMax = Math.max(uvMax, num(s.data.instant.details.ultraviolet_index_clear_sky) ?? 0);
    }
    // Rain over the day, without counting an hour twice where hourly and six-hourly steps meet.
    for (let i = 0; i < list.length; i++) {
      const gap = i + 1 < list.length ? (list[i + 1].t - list[i].t) / 3600_000 : list[i].s.data.next_1_hours ? 1 : 6;
      const d1 = list[i].s.data.next_1_hours?.details?.precipitation_amount;
      const d6 = list[i].s.data.next_6_hours?.details?.precipitation_amount;
      rainSum += gap >= 6 ? d6 ?? 0 : d1 ?? (d6 !== undefined ? (d6 * gap) / 6 : 0);
    }
    // The day's look: the twelve hours from about 6 in the morning, else the step nearest midday.
    const morning = list.find((x) => hourAt(x.t, tz) >= 5 && hourAt(x.t, tz) <= 8 && x.s.data.next_12_hours?.summary?.symbol_code);
    const midday = [...list].sort((a, b) => Math.abs(hourAt(a.t, tz) - 12) - Math.abs(hourAt(b.t, tz) - 12))[0];
    const symbol = morning?.s.data.next_12_hours?.summary?.symbol_code ?? midday.s.data.next_6_hours?.summary?.symbol_code ?? stepSymbol(midday.s);
    const sun = sunTimes(t0 + 12 * 3600_000, p.lat, p.lon);
    const sunrise = sun.polar === 'day' ? t0 : sun.polar === 'night' ? sun.noon : sun.sunrise!;
    const sunset = sun.polar === 'day' ? t0 + 86_400_000 - 1 : sun.polar === 'night' ? sun.noon : sun.sunset!;
    return {
      t: t0, min: temp(Math.min(...temps), units), max: temp(Math.max(...temps), units), code: metSymbol(symbol).code,
      rainChance: Math.round(chance || (rainSum >= 1 ? 60 : 0)), sunrise, sunset, uvMax, rainSum: Math.round(rainOf(rainSum, units) * 100) / 100,
    };
  }).filter((x) => x.t + 86_400_000 > now - 86_400_000).slice(0, 10);

  return {
    place: p,
    fetchedAt: now,
    units,
    current: {
      temp: temp(det.air_temperature!, units),
      feels: temp(apparentTemp(det.air_temperature!, hum, windMs), units),
      code: curSym.code,
      wind: speed(windMs, units),
      humidity: Math.round(hum),
      isDay: isDayAt(cur.t > now ? now : cur.t, curSym.isDay),
      uv: num(det.ultraviolet_index_clear_sky),
      windDir: num(det.wind_from_direction),
      gusts: det.wind_speed_of_gust !== undefined ? speed(det.wind_speed_of_gust, units) : undefined,
      dewPoint: det.dew_point_temperature !== undefined ? temp(det.dew_point_temperature, units) : undefined,
      pressure: num(det.air_pressure_at_sea_level),
      rainNextHour: nextHourMm === undefined ? undefined : Math.round(rainOf(nextHourMm, units) * 100) / 100,
    },
    hourly,
    daily,
    hours,
    tz,
    utcOffset: zoneOffset(now, tz),
    nowcast: hourlyNowcast(hours, now),
  };
}

/**
 * Rain starting or stopping within the next two hours, from hour-long steps
 * (MET's minute-by-minute nowcast covers only the Nordic countries).
 */
export function hourlyNowcast(hours: { t: number; rain: number }[], now = Date.now()): string | undefined {
  const next = hours.filter((h) => h.t + 3600_000 > now).slice(0, 3);
  if (next.length < 2) return undefined;
  const wet = (h: { rain: number }) => h.rain >= WET_MM;
  const first = wet(next[0]);
  const change = next.findIndex((h) => wet(h) !== first);
  if (change < 0) return first ? 'Rain for the next two hours' : undefined;
  if (change > 2) return undefined;
  const mins = Math.max(5, Math.round((next[change].t - now) / 60_000 / 5) * 5);
  if (mins > 120) return undefined;
  return first ? `Rain stopping in about ${mins} minutes` : `Rain starting in about ${mins} minutes`;
}

// ---------------------------------------------------------------- polite caching

export interface MetCached {
  body: unknown;
  /** the answer's Expires header, as a time */
  expires: number;
  /** the answer's Last-Modified header, sent back as If-Modified-Since */
  lastModified?: string;
}

/** When the next request may be made: the Expires header, or half an hour when there is none. */
export function expiresFrom(headers: { get(name: string): string | null }, now = Date.now()): number {
  const e = Date.parse(headers.get('expires') ?? '');
  return Number.isFinite(e) ? Math.max(e, now + 60_000) : now + 30 * 60_000;
}

export interface MetFetch {
  (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }): Promise<{ status: number; ok: boolean; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;
}

/**
 * Fetches a forecast with MET's caching rules: nothing is asked before the
 * last answer expires, then only with If-Modified-Since (a 304 keeps the copy).
 */
export async function metGet(url: string, o: { cache: Map<string, MetCached>; version: string; fetch: MetFetch; signal?: AbortSignal; now?: number }): Promise<unknown> {
  const now = o.now ?? Date.now();
  const hit = o.cache.get(url);
  if (hit && now < hit.expires) return hit.body;
  const headers: Record<string, string> = { 'user-agent': metUserAgent(o.version), accept: 'application/json' };
  if (hit?.lastModified) headers['if-modified-since'] = hit.lastModified;
  const res = await o.fetch(url, { headers, signal: o.signal });
  if (res.status === 304 && hit) {
    o.cache.set(url, { ...hit, expires: expiresFrom(res.headers, now) });
    return hit.body;
  }
  if (res.status === 429) throw new Error('The weather service asked Keeper to wait a little');
  if (res.status === 403) throw new Error('The weather service refused the request');
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
  const body = await res.json();
  o.cache.set(url, { body, expires: expiresFrom(res.headers, now), lastModified: res.headers.get('last-modified') ?? undefined });
  // A small cache: places people look at, not the whole world.
  if (o.cache.size > 40) o.cache.delete(o.cache.keys().next().value!);
  return body;
}
