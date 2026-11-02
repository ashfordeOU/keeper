// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What the Weather page draws, worked out from a forecast: the condition for
// every WMO weather code (label, icon and sky colour), a one-line summary, the
// week's range bars, the sun's arc, the "feels like" reason, packing hints for
// trips and the radar timeline. Pure functions, so they can be tested.

import type { Weather } from './weather';

// ---------------------------------------------------------------- conditions

export type WxIcon =
  | 'clear' | 'mostly-clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'freezing' | 'rain' | 'heavy-rain'
  | 'showers' | 'snow' | 'snow-showers' | 'storm' | 'hail';

/** The sky behind the hero, by condition and time of day. */
export type Sky = 'clear-day' | 'clear-night' | 'partly-day' | 'partly-night' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

/** Broad groups used by the summary sentence. */
export type WxGroup = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

interface CodeInfo { label: string; icon: WxIcon; group: WxGroup }

/** Every WMO 4677 code Open-Meteo returns (https://open-meteo.com/en/docs, "WMO Weather interpretation codes"). */
export const WMO: Record<number, CodeInfo> = {
  0: { label: 'Clear', icon: 'clear', group: 'clear' },
  1: { label: 'Mostly clear', icon: 'mostly-clear', group: 'clear' },
  2: { label: 'Partly cloudy', icon: 'partly', group: 'cloudy' },
  3: { label: 'Overcast', icon: 'cloudy', group: 'cloudy' },
  45: { label: 'Fog', icon: 'fog', group: 'fog' },
  48: { label: 'Freezing fog', icon: 'fog', group: 'fog' },
  51: { label: 'Light drizzle', icon: 'drizzle', group: 'rain' },
  53: { label: 'Drizzle', icon: 'drizzle', group: 'rain' },
  55: { label: 'Heavy drizzle', icon: 'drizzle', group: 'rain' },
  56: { label: 'Light freezing drizzle', icon: 'freezing', group: 'rain' },
  57: { label: 'Freezing drizzle', icon: 'freezing', group: 'rain' },
  61: { label: 'Light rain', icon: 'rain', group: 'rain' },
  63: { label: 'Rain', icon: 'rain', group: 'rain' },
  65: { label: 'Heavy rain', icon: 'heavy-rain', group: 'rain' },
  66: { label: 'Light freezing rain', icon: 'freezing', group: 'rain' },
  67: { label: 'Freezing rain', icon: 'freezing', group: 'rain' },
  71: { label: 'Light snow', icon: 'snow', group: 'snow' },
  73: { label: 'Snow', icon: 'snow', group: 'snow' },
  75: { label: 'Heavy snow', icon: 'snow', group: 'snow' },
  77: { label: 'Snow grains', icon: 'snow', group: 'snow' },
  80: { label: 'Light showers', icon: 'showers', group: 'rain' },
  81: { label: 'Showers', icon: 'showers', group: 'rain' },
  82: { label: 'Heavy showers', icon: 'heavy-rain', group: 'rain' },
  85: { label: 'Snow showers', icon: 'snow-showers', group: 'snow' },
  86: { label: 'Heavy snow showers', icon: 'snow-showers', group: 'snow' },
  95: { label: 'Thunderstorm', icon: 'storm', group: 'storm' },
  96: { label: 'Thunderstorm with hail', icon: 'hail', group: 'storm' },
  99: { label: 'Thunderstorm with heavy hail', icon: 'hail', group: 'storm' },
};

export const WMO_CODES = Object.keys(WMO).map(Number);

/** Label, icon and group for a code; a code outside the table (or none) reads as plain cloud. */
export function condition(code: number | null | undefined): CodeInfo {
  if (typeof code === 'number' && WMO[code]) return WMO[code];
  // Unknown codes fall into the nearest WMO band rather than a blank.
  if (typeof code === 'number' && Number.isFinite(code)) {
    if (code >= 95) return WMO[95];
    if (code >= 85) return WMO[85];
    if (code >= 80) return WMO[81];
    if (code >= 71) return WMO[73];
    if (code >= 61) return WMO[63];
    if (code >= 50) return WMO[53];
    if (code >= 40) return WMO[45];
  }
  return { label: 'Cloudy', icon: 'cloudy', group: 'cloudy' };
}

/** The hero's sky for a code at day or night. */
export function skyFor(code: number | null | undefined, isDay: boolean): Sky {
  const c = condition(code);
  switch (c.group) {
    case 'clear': return isDay ? 'clear-day' : 'clear-night';
    case 'cloudy': return c.icon === 'partly' ? (isDay ? 'partly-day' : 'partly-night') : 'cloudy';
    case 'fog': return 'fog';
    case 'rain': return 'rain';
    case 'snow': return 'snow';
    case 'storm': return 'storm';
  }
}

// ---------------------------------------------------------------- time at the place

/** Hour of the day (0–23) at a time in a zone (the computer's zone when none). */
export function hourAt(t: number, tz?: string): number {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(t));
  return Number.isFinite(h) ? h % 24 : new Date(t).getHours();
}

/** yyyy-mm-dd of a time in a zone. */
export function dayKey(t: number, tz?: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(t);
}

/** "14:05" or "2:05 PM" as the computer writes it, at the place. */
export function clock(t: number, tz?: string, hourOnly = false): string {
  try {
    return new Date(t).toLocaleTimeString([], hourOnly ? { hour: 'numeric', timeZone: tz } : { hour: '2-digit', minute: '2-digit', timeZone: tz });
  } catch {
    return new Date(t).toLocaleTimeString([], hourOnly ? { hour: 'numeric' } : { hour: '2-digit', minute: '2-digit' });
  }
}

/** The place's local time when its zone differs from the computer's, else undefined. */
export function localTimeIfDifferent(tz: string | undefined, now = Date.now(), here = Intl.DateTimeFormat().resolvedOptions().timeZone): string | undefined {
  if (!tz) return undefined;
  const fmt = (z: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: z }).format(now);
  try {
    return fmt(tz) === fmt(here) ? undefined : clock(now, tz);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- the summary line

const GROUP_WORD: Record<WxGroup, string> = { clear: 'clear', cloudy: 'cloudy', fog: 'foggy', rain: 'rain', snow: 'snow', storm: 'thunderstorms' };
const wet = (g: WxGroup) => g === 'rain' || g === 'snow' || g === 'storm';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function partOfDay(h: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

/** "this evening", "tomorrow morning", "overnight", "around 3 PM". */
export function when(t: number, now: number, tz?: string): string {
  const h = hourAt(t, tz);
  const sameDay = dayKey(t, tz) === dayKey(now, tz);
  const p = partOfDay(h);
  if (t - now <= 3 * 3600_000) return `around ${clock(t, tz, true)}`;
  if (sameDay) return p === 'night' ? 'tonight' : `this ${p}`;
  if (p === 'night') return h < 5 ? 'overnight' : 'tomorrow night';
  return `tomorrow ${p}`;
}

/** The hour's broad condition; a likely-wet hour counts as rain even under a cloud code. */
function groupOf(h: { code: number; rainChance: number }): WxGroup {
  const g = condition(h.code).group;
  if (!wet(g) && h.rainChance >= 60) return 'rain';
  return g;
}

/**
 * One plain sentence about the next day: "Clear until this evening, then
 * cloudy." It looks for the first lasting change (two hours or more) in the
 * hourly forecast, and for rain coming or stopping.
 */
export function summarize(w: Pick<Weather, 'hourly' | 'daily' | 'current'> & { tz?: string }, now = Date.now()): string {
  const hours = w.hourly.filter((h) => h.t + 3600_000 > now).slice(0, 24);
  if (!hours.length) return `${condition(w.current.code).label}.`;
  // The first hour is now: the current condition says it best.
  const groups = hours.map((h, i) => groupOf(i === 0 ? { code: w.current.code, rainChance: h.rainChance } : h));
  const g0 = groups[0];
  let change = -1;
  for (let i = 1; i < groups.length; i++) {
    if (groups[i] !== g0 && (groups[i + 1] === undefined || groups[i + 1] === groups[i])) { change = i; break; }
  }
  if (change < 0) {
    const tomorrow = w.daily[1];
    if (tomorrow && condition(tomorrow.code).group !== g0 && !wet(g0)) return `${cap(GROUP_WORD[g0])} for the next 24 hours, ${condition(tomorrow.code).label.toLowerCase()} tomorrow.`;
    return `${cap(GROUP_WORD[g0])} for the next 24 hours.`;
  }
  const g1 = groups[change];
  const at = when(hours[change].t, now, w.tz);
  if (!wet(g0) && wet(g1)) return `${cap(GROUP_WORD[g0])} now, ${GROUP_WORD[g1]} likely ${at}.`;
  if (wet(g0) && !wet(g1)) return `${cap(GROUP_WORD[g0])} easing ${at}, then ${GROUP_WORD[g1]}.`;
  // Look one change further for a "then" ("Clear until this evening, cloudy tomorrow morning").
  let next = -1;
  for (let i = change + 1; i < groups.length; i++) {
    if (groups[i] !== g1 && (groups[i + 1] === undefined || groups[i + 1] === groups[i])) { next = i; break; }
  }
  const tail = next > 0 ? `, ${GROUP_WORD[groups[next]]} ${when(hours[next].t, now, w.tz)}` : '';
  return `${cap(GROUP_WORD[g0])} until ${at}, then ${GROUP_WORD[g1]}${tail}.`;
}

// ---------------------------------------------------------------- the week

/** Where a day's low–high bar sits on a track scaled to the whole period, in percent. */
export function rangeBar(min: number, max: number, lo: number, hi: number): { left: number; width: number } {
  const span = hi - lo;
  if (!(span > 0)) return { left: 0, width: 100 };
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  const left = clamp(((Math.min(min, max) - lo) / span) * 100);
  const right = clamp(((Math.max(min, max) - lo) / span) * 100);
  return { left: Math.round(left * 10) / 10, width: Math.round(Math.max(right - left, 0) * 10) / 10 };
}

/** A point's position on that track (for "now" on today's bar), in percent. */
export function rangePos(v: number, lo: number, hi: number): number {
  const span = hi - lo;
  if (!(span > 0)) return 50;
  return Math.round(Math.min(100, Math.max(0, ((v - lo) / span) * 100)) * 10) / 10;
}

const TEMP_STOPS: [number, [number, number, number]][] = [
  [-20, [124, 92, 255]], [-5, [76, 132, 255]], [5, [56, 189, 248]], [12, [52, 211, 153]], [18, [250, 204, 21]], [25, [251, 146, 60]], [32, [239, 68, 68]], [40, [190, 24, 93]],
];

/** A colour for a temperature (Celsius, or Fahrenheit when `units` is imperial). */
export function tempColor(t: number, units: 'metric' | 'imperial' = 'metric'): string {
  const c = units === 'imperial' ? (t - 32) / 1.8 : t;
  if (c <= TEMP_STOPS[0][0]) return rgb(TEMP_STOPS[0][1]);
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [t1, c1] = TEMP_STOPS[i];
    const [t0, c0] = TEMP_STOPS[i - 1];
    if (c <= t1) {
      const f = (c - t0) / (t1 - t0);
      return rgb([0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f)) as [number, number, number]);
    }
  }
  return rgb(TEMP_STOPS[TEMP_STOPS.length - 1][1]);
}
const rgb = ([r, g, b]: [number, number, number]) => `rgb(${r}, ${g}, ${b})`;

/** The hours of one forecast day (by the place's calendar). */
export function hoursOfDay<H extends { t: number }>(hours: H[], day: number, tz?: string): H[] {
  const k = dayKey(day, tz);
  return hours.filter((h) => dayKey(h.t, tz) === k);
}

// ---------------------------------------------------------------- the hourly strip

export type StripItem =
  | { kind: 'hour'; t: number; temp: number; code: number; rainChance: number; isDay: boolean; now: boolean }
  | { kind: 'sunrise' | 'sunset'; t: number };

/** The next hours, with "Now" first and sunrise or sunset placed between the hours they fall in. */
export function hourlyStrip(w: Pick<Weather, 'hourly' | 'daily' | 'current'>, now = Date.now(), count = 24): StripItem[] {
  const hours = w.hourly.filter((h) => h.t + 3600_000 > now).slice(0, count);
  if (!hours.length) return [];
  const end = hours[hours.length - 1].t + 3600_000;
  const suns = w.daily.flatMap((d) => [{ kind: 'sunrise' as const, t: d.sunrise }, { kind: 'sunset' as const, t: d.sunset }]).filter((s) => s.t > now && s.t < end);
  const isDayAt = (t: number) => {
    const d = w.daily.find((x) => t >= x.sunrise - 12 * 3600_000 && t < x.sunset + 12 * 3600_000 && Math.abs(t - x.sunrise) < 24 * 3600_000);
    return d ? t >= d.sunrise && t < d.sunset : true;
  };
  const out: StripItem[] = [];
  hours.forEach((h, i) => {
    out.push({ kind: 'hour', t: h.t, temp: i === 0 ? w.current.temp : h.temp, code: i === 0 ? w.current.code : h.code, rainChance: h.rainChance, isDay: i === 0 ? w.current.isDay : h.isDay ?? isDayAt(h.t + 1800_000), now: i === 0 });
    for (const s of suns) if (s.t >= h.t && s.t < h.t + 3600_000) out.push(s);
  });
  return out;
}

// ---------------------------------------------------------------- tiles

/** The sun's place on its arc: 0 at sunrise, 1 at sunset; below the horizon outside. */
export function sunArc(sunrise: number, sunset: number, now = Date.now()): { f: number; x: number; y: number; up: boolean; daylight: number } {
  const daylight = Math.max(0, sunset - sunrise);
  const f = daylight ? (now - sunrise) / daylight : 0;
  const up = f >= 0 && f <= 1;
  const c = Math.min(1, Math.max(0, f));
  // A half-ellipse from (0,1) through (0.5,0) to (1,1), in a unit box.
  const a = Math.PI * (1 - c);
  return { f: Math.round(f * 1000) / 1000, x: Math.round((0.5 + 0.5 * Math.cos(a)) * 1000) / 1000, y: Math.round((1 - Math.sin(a)) * 1000) / 1000, up, daylight };
}

/** "10 h 42 min". */
export function duration(ms: number): string {
  const m = Math.round(ms / 60_000);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Why it feels warmer or colder than the thermometer says. */
export function feelsReason(temp: number, feels: number, wind: number, humidity: number, units: 'metric' | 'imperial' = 'metric'): string {
  const d = units === 'imperial' ? (feels - temp) / 1.8 : feels - temp;
  const windy = units === 'imperial' ? wind >= 9 : wind >= 15;
  const c = units === 'imperial' ? (temp - 32) / 1.8 : temp;
  if (Math.abs(d) < 1) return 'Similar to the actual temperature.';
  if (d < 0) return windy || c < 10 ? 'Wind makes it feel colder.' : 'Dry air makes it feel cooler.';
  return humidity >= 60 ? 'Humidity makes it feel warmer.' : c >= 20 && !windy ? 'Strong sun makes it feel warmer.' : 'Little wind makes it feel warmer.';
}

/** Dew point from temperature and humidity (Magnus formula), in the same units. */
export function dewPoint(temp: number, humidity: number, units: 'metric' | 'imperial' = 'metric'): number {
  const c = units === 'imperial' ? (temp - 32) / 1.8 : temp;
  const g = Math.log(Math.max(1, humidity) / 100) + (17.62 * c) / (243.12 + c);
  const dp = (243.12 * g) / (17.62 - g);
  return Math.round((units === 'imperial' ? dp * 1.8 + 32 : dp) * 10) / 10;
}

/** A comfort word for a dew point. */
export function dewComfort(dp: number, units: 'metric' | 'imperial' = 'metric'): string {
  const c = units === 'imperial' ? (dp - 32) / 1.8 : dp;
  return c < 10 ? 'Dry and comfortable' : c < 16 ? 'Comfortable' : c < 20 ? 'A little sticky' : 'Humid and muggy';
}

/** Position (0–1) on a gauge of air quality, US AQI 0–300+. */
export const aqiPos = (aqi: number) => Math.min(1, Math.max(0, aqi / 300));
/** Position (0–1) on a UV scale of 0–11+. */
export const uvPos = (uv: number) => Math.min(1, Math.max(0, uv / 11));

/** Visibility in words and units. */
export function visibilityText(m: number, units: 'metric' | 'imperial' = 'metric'): string {
  if (units === 'imperial') {
    const mi = m / 1609.34;
    return mi >= 10 ? `${Math.round(mi)} mi` : `${Math.round(mi * 10) / 10} mi`;
  }
  const km = m / 1000;
  return km >= 10 ? `${Math.round(km)} km` : `${Math.round(km * 10) / 10} km`;
}

/** Pressure in hPa (or inches of mercury). */
export function pressureText(hpa: number, units: 'metric' | 'imperial' = 'metric'): string {
  return units === 'imperial' ? `${(hpa * 0.02953).toFixed(2)} inHg` : `${Math.round(hpa)} hPa`;
}

// ---------------------------------------------------------------- trips

/** A one-line packing hint for a day somewhere. */
export function packingHint(day: { min: number; max: number; rainChance: number; code: number; uvMax?: number }, units: 'metric' | 'imperial' = 'metric'): string {
  const c = (v: number) => (units === 'imperial' ? (v - 32) / 1.8 : v);
  const g = condition(day.code).group;
  if (g === 'storm') return 'Storms likely: plan indoor time and bring a rain jacket.';
  if (g === 'snow' || (c(day.max) <= 2 && day.rainChance >= 40)) return 'Snow possible: warm boots and a coat.';
  if (day.rainChance >= 50 || g === 'rain') return c(day.min) < 8 ? 'Bring an umbrella and a warm layer.' : 'Bring an umbrella.';
  if (c(day.max) <= 5) return 'Cold: pack a coat, hat and gloves.';
  if (c(day.min) <= 8) return 'Cool mornings: pack a jacket.';
  if (c(day.max) >= 30) return 'Hot: light clothes, water and sunscreen.';
  if ((day.uvMax ?? 0) >= 6) return 'Sunny: sunglasses and sunscreen.';
  return 'Pleasant: light layers will do.';
}

// ---------------------------------------------------------------- radar timeline

/** "−2 h", "−40 min", "Now", "+30 min" for a radar frame against the newest past frame. */
export function frameLabel(t: number, nowFrame: number): string {
  const m = Math.round((t - nowFrame) / 60_000);
  if (Math.abs(m) < 5) return 'Now';
  const sign = m < 0 ? '−' : '+';
  const a = Math.abs(m);
  // Hours to the nearest half: "−2 h", "−1.5 h".
  if (a >= 60) return `${sign}${Math.round(a / 30) / 2} h`;
  return `${sign}${a} min`;
}

/** The index of the "Now" frame: the newest frame not in the future. */
export function nowFrameIndex(frames: { time: number }[], now = Date.now()): number {
  let k = 0;
  frames.forEach((f, i) => { if (f.time <= now + 60_000) k = i; });
  return k;
}
