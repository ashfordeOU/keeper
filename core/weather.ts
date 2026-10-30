// SPDX-License-Identifier: AGPL-3.0-or-later
// Weather for the Island and Home, from Open-Meteo (free, no account, no key).
// Only the chosen place's coordinates are sent.

export interface Place {
  name: string;
  lat: number;
  lon: number;
  country?: string;
}

export interface Weather {
  place: Place;
  fetchedAt: number;
  units: 'metric' | 'imperial';
  current: { temp: number; feels: number; code: number; wind: number; humidity: number; isDay: boolean; uv?: number; aqi?: number };
  hourly: { t: number; temp: number; code: number; rainChance: number; rain: number; uv: number; wind: number }[];
  daily: { t: number; min: number; max: number; code: number; rainChance: number; sunrise: number; sunset: number; uvMax: number }[];
  /** "Rain starting in about 20 minutes", when the next two hours suggest it */
  nowcast?: string;
}

/** WMO weather interpretation codes -> short label and an icon key. */
export function describeCode(code: number): { label: string; icon: 'sun' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm' } {
  if (code === 0) return { label: 'Clear', icon: 'sun' };
  if (code <= 2) return { label: code === 1 ? 'Mostly clear' : 'Partly cloudy', icon: 'partly' };
  if (code === 3) return { label: 'Overcast', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: 'fog' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: 'drizzle' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: code >= 80 ? 'Showers' : 'Rain', icon: 'rain' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Snow', icon: 'snow' };
  if (code >= 95) return { label: 'Thunderstorm', icon: 'storm' };
  return { label: 'Cloudy', icon: 'cloud' };
}

export function weatherUrl(p: Place, units: 'metric' | 'imperial'): string {
  const q = new URLSearchParams({
    latitude: String(p.lat),
    longitude: String(p.lon),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day,uv_index',
    hourly: 'temperature_2m,weather_code,precipitation_probability,precipitation,uv_index,wind_speed_10m',
    minutely_15: 'precipitation',
    daily: 'temperature_2m_min,temperature_2m_max,weather_code,precipitation_probability_max,sunrise,sunset,uv_index_max',
    forecast_days: '7',
    forecast_hours: '24',
    forecast_minutely_15: '8',
    timezone: 'auto',
    timeformat: 'unixtime',
  });
  if (units === 'imperial') {
    q.set('temperature_unit', 'fahrenheit');
    q.set('wind_speed_unit', 'mph');
    q.set('precipitation_unit', 'inch');
  }
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

interface OpenMeteo {
  current: Record<string, number>;
  hourly: Record<string, number[]>;
  daily: Record<string, number[]>;
  minutely_15?: { time: number[]; precipitation: number[] };
}

export function parseWeather(p: Place, units: 'metric' | 'imperial', d: OpenMeteo, aqi?: number, now = Date.now()): Weather {
  const s = (t: number) => t * 1000;
  const hourly = d.hourly.time.map((t, i) => ({
    t: s(t), temp: d.hourly.temperature_2m[i], code: d.hourly.weather_code[i], rainChance: d.hourly.precipitation_probability?.[i] ?? 0,
    rain: d.hourly.precipitation?.[i] ?? 0, uv: d.hourly.uv_index?.[i] ?? 0, wind: d.hourly.wind_speed_10m?.[i] ?? 0,
  }));
  const daily = d.daily.time.map((t, i) => ({
    t: s(t), min: d.daily.temperature_2m_min[i], max: d.daily.temperature_2m_max[i], code: d.daily.weather_code[i],
    rainChance: d.daily.precipitation_probability_max?.[i] ?? 0, sunrise: s(d.daily.sunrise[i]), sunset: s(d.daily.sunset[i]), uvMax: d.daily.uv_index_max?.[i] ?? 0,
  }));
  return {
    place: p,
    fetchedAt: now,
    units,
    current: {
      temp: d.current.temperature_2m, feels: d.current.apparent_temperature, code: d.current.weather_code, wind: d.current.wind_speed_10m,
      humidity: d.current.relative_humidity_2m, isDay: d.current.is_day === 1, uv: d.current.uv_index, aqi,
    },
    hourly,
    daily,
    nowcast: nowcast(d.minutely_15, d.current.precipitation ?? 0, now),
  };
}

/** Looks at the next two hours in 15-minute steps for rain starting or stopping. */
export function nowcast(m: OpenMeteo['minutely_15'], _current: number, now = Date.now()): string | undefined {
  if (!m?.time?.length) return undefined;
  const steps = m.time.map((t, i) => ({ t: t * 1000, wet: (m.precipitation[i] ?? 0) >= 0.1 }));
  const first = steps[0]?.wet;
  const change = steps.findIndex((x) => x.wet !== first);
  if (change < 0) return first ? 'Rain for the next two hours' : undefined;
  const mins = Math.max(5, Math.round((steps[change].t - now) / 60_000 / 5) * 5);
  return first ? `Rain stopping in about ${mins} minutes` : `Rain starting in about ${mins} minutes`;
}

export async function fetchWeather(p: Place, units: 'metric' | 'imperial' = 'metric', signal?: AbortSignal): Promise<Weather> {
  const res = await fetch(weatherUrl(p, units), { signal });
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
  const data = (await res.json()) as OpenMeteo;
  let aqi: number | undefined;
  try {
    const a = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${p.lat}&longitude=${p.lon}&current=us_aqi`, { signal });
    if (a.ok) aqi = ((await a.json()) as { current?: { us_aqi?: number } }).current?.us_aqi;
  } catch {
    /* air quality is optional */
  }
  return parseWeather(p, units, data, aqi);
}

export async function searchPlaces(name: string, signal?: AbortSignal): Promise<Place[]> {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=${encodeURIComponent(name)}`, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[] };
  return (data.results ?? []).map((r) => ({ name: r.admin1 && r.admin1 !== r.name ? `${r.name}, ${r.admin1}` : r.name, lat: r.latitude, lon: r.longitude, country: r.country }));
}
