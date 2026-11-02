// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The 7-day forecast widget: one column per day from the weather Keeper
// already has (no fetching here), highs and lows in both °C and °F, and the
// chance of rain in each part of the day (night, morning, afternoon, evening)
// taken from that day's hours at the place. Pure.

import type { Weather } from './weather';
import { dayKey, hourAt, hoursOfDay } from './weather-view';

export type DayPart = 'night' | 'morning' | 'afternoon' | 'evening';
export const DAY_PARTS: DayPart[] = ['night', 'morning', 'afternoon', 'evening'];

/** Which part of the day an hour (0–23) belongs to: 0–5 night, 6–11 morning, 12–17 afternoon, 18–23 evening. */
export const partOf = (hour: number): DayPart => DAY_PARTS[Math.min(3, Math.max(0, Math.floor(hour / 6)))];

export interface PartRain { part: DayPart; /** highest chance in that part, %; null when no hours are known */ rain: number | null }

/** The highest chance of rain in each part of one day, from the hours of that day at the place. */
export function dayPartRain(hours: { t: number; rainChance: number }[], day: number, tz?: string): PartRain[] {
  const best = new Map<DayPart, number>();
  for (const h of hoursOfDay(hours, day, tz)) {
    const p = partOf(hourAt(h.t, tz));
    const v = Number.isFinite(h.rainChance) ? Math.min(100, Math.max(0, h.rainChance)) : 0;
    best.set(p, Math.max(best.get(p) ?? 0, v));
  }
  return DAY_PARTS.map((part) => ({ part, rain: best.has(part) ? Math.round(best.get(part)!) : null }));
}

export const toF = (c: number) => c * 1.8 + 32;
export const toC = (f: number) => (f - 32) / 1.8;

export interface ForecastDay {
  t: number;
  key: string;
  today: boolean;
  code: number;
  hiC: number; loC: number; hiF: number; loF: number;
  rain: number;
  parts: PartRain[];
}

/** Up to `n` days from today at the place, each with both units and its parts of the day. */
export function forecastDays(w: Pick<Weather, 'daily' | 'hourly' | 'hours' | 'units' | 'tz'>, now = Date.now(), n = 7): ForecastDay[] {
  const today = dayKey(now, w.tz);
  const hours = w.hours?.length ? w.hours : w.hourly;
  const metric = w.units !== 'imperial';
  return w.daily
    .filter((d) => dayKey(d.t, w.tz) >= today)
    .slice(0, n)
    .map((d) => {
      const hiC = metric ? d.max : toC(d.max);
      const loC = metric ? d.min : toC(d.min);
      return {
        t: d.t, key: dayKey(d.t, w.tz), today: dayKey(d.t, w.tz) === today, code: d.code,
        hiC: Math.round(hiC), loC: Math.round(loC), hiF: Math.round(metric ? toF(d.max) : d.max), loF: Math.round(metric ? toF(d.min) : d.min),
        rain: Math.round(d.rainChance ?? 0), parts: dayPartRain(hours, d.t, w.tz),
      };
    });
}
