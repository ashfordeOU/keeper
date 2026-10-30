// SPDX-License-Identifier: AGPL-3.0-or-later
// The Weather page's data: saved places, forecasts, official alerts, radar
// frames, climate averages and forecasts for places in upcoming events.
// Only coordinates of places the user chose are ever sent.

import { app } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { TripForecast } from '../../core/api-x';
import { climateUrl, dayForecast, geocodeQuery, inUnitedStates, monthlyAverages, parseNwsAlerts, parseRadarIndex, tripStops, type MonthlyClimate, type WeatherAlert } from '../../core/forecast';
import type { CalendarEvent } from '../../core/island';
import { fetchWeather, searchPlaces, type Place, type Weather } from '../../core/weather';

const UA = { 'user-agent': 'Keeper (https://github.com/ashfordeOU/keeper)' };

export class ForecastService {
  private file = path.join(app.getPath('userData'), 'places.json');
  private cache = new Map<string, { at: number; w: Weather }>();
  private climateCache = new Map<string, MonthlyClimate[]>();
  private geoCache = new Map<string, Place | null>();

  constructor(private events: () => CalendarEvent[], private fallbackPlace: () => Place | null) {}

  async places(): Promise<Place[]> {
    try {
      const list = JSON.parse(await fsp.readFile(this.file, 'utf8')) as Place[];
      if (Array.isArray(list) && list.length) return list.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    } catch {
      /* none saved yet */
    }
    const p = this.fallbackPlace();
    return p ? [p] : [];
  }

  async savePlaces(list: Place[]): Promise<Place[]> {
    const clean = list.filter((p) => p && typeof p.name === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lon)).slice(0, 30);
    await fsp.writeFile(this.file, JSON.stringify(clean));
    return clean;
  }

  async get(p: Place, units: 'metric' | 'imperial'): Promise<Weather> {
    const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)},${units}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.w;
    const w = await fetchWeather(p, units);
    this.cache.set(key, { at: Date.now(), w });
    return w;
  }

  async alerts(p: Place): Promise<{ supported: boolean; alerts: WeatherAlert[] }> {
    if (!inUnitedStates(p)) return { supported: false, alerts: [] };
    const res = await fetch(`https://api.weather.gov/alerts/active?point=${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, { headers: { ...UA, accept: 'application/geo+json' } });
    if (!res.ok) return { supported: true, alerts: [] };
    return { supported: true, alerts: parseNwsAlerts(await res.json()) };
  }

  async radar() {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', { headers: UA });
    return res.ok ? parseRadarIndex(await res.json()) ?? null : null;
  }

  async climate(p: Place): Promise<MonthlyClimate[]> {
    const key = `${p.lat.toFixed(1)},${p.lon.toFixed(1)}`;
    const hit = this.climateCache.get(key);
    if (hit) return hit;
    const res = await fetch(climateUrl(p, 5));
    if (!res.ok) throw new Error(`Climate service returned ${res.status}`);
    const data = (await res.json()) as { daily: Parameters<typeof monthlyAverages>[0] };
    const m = monthlyAverages(data.daily);
    this.climateCache.set(key, m);
    return m;
  }

  private async geocode(location: string): Promise<Place | undefined> {
    for (const q of geocodeQuery(location)) {
      if (this.geoCache.has(q)) {
        const v = this.geoCache.get(q);
        if (v) return v;
        continue;
      }
      const found = (await searchPlaces(q).catch(() => []))[0] ?? null;
      this.geoCache.set(q, found);
      if (found) return found;
    }
    return undefined;
  }

  async trips(units: 'metric' | 'imperial'): Promise<TripForecast[]> {
    const out: TripForecast[] = [];
    for (const stop of tripStops(this.events()).slice(0, 8)) {
      const place = await this.geocode(stop.location);
      let day;
      if (place) {
        const w = await this.get(place, units).catch(() => undefined);
        day = w ? dayForecast(w, stop.day) : undefined;
      }
      out.push({ stop, place, day, units });
    }
    return out;
  }
}
