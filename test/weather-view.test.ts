// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Weather page's reasoning: conditions for every WMO code, the summary
// sentence, the week's range bars, the sun's arc, packing hints, the radar
// timeline, and the forecast request and parsing that feed them.
import { describe, expect, it } from 'vitest';
import { parseWeather, weatherUrl, type Weather } from '../core/weather';
import {
  condition, dewPoint, duration, feelsReason, frameLabel, hourAt, hourlyStrip, hoursOfDay, localTimeIfDifferent, nowFrameIndex, packingHint,
  rangeBar, rangePos, skyFor, summarize, sunArc, tempColor, when, WMO, WMO_CODES,
} from '../core/weather-view';

// Every code in WMO 4677 that Open-Meteo documents.
const ALL = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
const H = 3600_000;
const T0 = Date.UTC(2026, 10, 2, 9, 0); // Monday 2 November 2026, 09:00 UTC

describe('conditions', () => {
  it('maps every documented WMO code to its own label, an icon and a sky', () => {
    expect(WMO_CODES.sort((a, b) => a - b)).toEqual(ALL);
    const icons = new Set(['clear', 'mostly-clear', 'partly', 'cloudy', 'fog', 'drizzle', 'freezing', 'rain', 'heavy-rain', 'showers', 'snow', 'snow-showers', 'storm', 'hail']);
    const skies = new Set(['clear-day', 'clear-night', 'partly-day', 'partly-night', 'cloudy', 'fog', 'rain', 'snow', 'storm']);
    for (const code of ALL) {
      const c = condition(code);
      expect(c.label.length, `label for ${code}`).toBeGreaterThan(2);
      expect(icons.has(c.icon), `icon for ${code}`).toBe(true);
      expect(skies.has(skyFor(code, true)), `day sky for ${code}`).toBe(true);
      expect(skies.has(skyFor(code, false)), `night sky for ${code}`).toBe(true);
    }
    expect(new Set(ALL.map((c) => WMO[c].label)).size).toBe(ALL.length);
  });

  it('groups codes the way people describe the sky', () => {
    expect(condition(0)).toMatchObject({ label: 'Clear', icon: 'clear', group: 'clear' });
    expect(condition(45)).toMatchObject({ icon: 'fog', group: 'fog' });
    expect(condition(48).label).toBe('Freezing fog');
    expect(condition(56).icon).toBe('freezing');
    expect(condition(66).icon).toBe('freezing');
    expect(condition(65).icon).toBe('heavy-rain');
    expect(condition(77)).toMatchObject({ label: 'Snow grains', group: 'snow' });
    expect(condition(82).icon).toBe('heavy-rain');
    expect(condition(86).icon).toBe('snow-showers');
    expect(condition(96).icon).toBe('hail');
    expect(condition(99).group).toBe('storm');
  });

  it('never leaves a blank for codes outside the table or missing data', () => {
    expect(condition(undefined).icon).toBe('cloudy');
    expect(condition(null).icon).toBe('cloudy');
    expect(condition(Number.NaN).icon).toBe('cloudy');
    expect(condition(4).icon).toBe('cloudy');
    expect(condition(60).group).toBe('rain');
    expect(condition(97).group).toBe('storm');
  });

  it('tints the sky by condition and time of day', () => {
    expect(skyFor(0, true)).toBe('clear-day');
    expect(skyFor(0, false)).toBe('clear-night');
    expect(skyFor(1, false)).toBe('clear-night');
    expect(skyFor(2, true)).toBe('partly-day');
    expect(skyFor(2, false)).toBe('partly-night');
    expect(skyFor(3, true)).toBe('cloudy');
    expect(skyFor(48, true)).toBe('fog');
    expect(skyFor(63, false)).toBe('rain');
    expect(skyFor(73, true)).toBe('snow');
    expect(skyFor(95, true)).toBe('storm');
  });
});

/** A forecast whose hours follow `codes` from T0, in UTC. */
function forecast(codes: number[], opts: { rain?: number[]; tomorrow?: number } = {}): Pick<Weather, 'hourly' | 'daily' | 'current'> & { tz: string } {
  return {
    tz: 'UTC',
    current: { temp: 10, feels: 9, code: codes[0], wind: 10, humidity: 70, isDay: true },
    hourly: codes.map((code, i) => ({ t: T0 + i * H, temp: 10, code, rainChance: opts.rain?.[i] ?? 0, rain: 0, uv: 0, wind: 10 })),
    daily: [
      { t: Date.UTC(2026, 10, 2), min: 3, max: 10, code: codes[0], rainChance: 0, sunrise: Date.UTC(2026, 10, 2, 6, 30), sunset: Date.UTC(2026, 10, 2, 16, 40), uvMax: 2 },
      { t: Date.UTC(2026, 10, 3), min: 2, max: 9, code: opts.tomorrow ?? codes[0], rainChance: 0, sunrise: Date.UTC(2026, 10, 3, 6, 32), sunset: Date.UTC(2026, 10, 3, 16, 38), uvMax: 2 },
    ],
  };
}

describe('summary sentence', () => {
  it('says when a clear spell ends and what follows', () => {
    // Clear 09–17, cloudy 18–05, then fog from 06 the next morning.
    const codes = [...Array(9).fill(0), ...Array(12).fill(3), ...Array(3).fill(45)];
    expect(summarize(forecast(codes), T0)).toBe('Clear until this evening, then cloudy, foggy tomorrow morning.');
  });

  it('calls out rain coming and rain easing', () => {
    const coming = [...Array(5).fill(2), ...Array(19).fill(61)];
    expect(summarize(forecast(coming), T0)).toBe('Cloudy now, rain likely this afternoon.');
    const easing = [61, 61, 3, 3, ...Array(20).fill(3)];
    // The hour is written the way the computer writes times ("11 AM" or "11").
    expect(summarize(forecast(easing), T0)).toMatch(/^Rain easing around 11( AM)?, then cloudy\.$/);
  });

  it('treats a likely-wet hour as rain even under a cloud code', () => {
    const codes = Array(24).fill(3);
    const rain = [...Array(10).fill(0), ...Array(14).fill(80)];
    expect(summarize(forecast(codes, { rain }), T0)).toMatch(/^Cloudy now, rain likely this evening\.$/);
  });

  it('ignores a one-hour blip and handles a steady day', () => {
    const codes = [0, 0, 0, 3, 0, 0, ...Array(18).fill(0)];
    expect(summarize(forecast(codes), T0)).toBe('Clear for the next 24 hours.');
    expect(summarize(forecast(Array(24).fill(0), { tomorrow: 63 }), T0)).toBe('Clear for the next 24 hours, rain tomorrow.');
    expect(summarize(forecast(Array(24).fill(63)), T0)).toBe('Rain for the next 24 hours.');
  });

  it('reads the first hour from the current condition', () => {
    const f = forecast([2, ...Array(23).fill(0)], { tomorrow: 0 });
    f.current.code = 0;
    expect(summarize(f, T0)).toBe('Clear for the next 24 hours.');
  });

  it('falls back to the current condition when there are no hours', () => {
    expect(summarize({ ...forecast([0]), hourly: [] }, T0)).toBe('Clear.');
  });

  it('words times by part of the day at the place', () => {
    expect(when(T0 + 2 * H, T0, 'UTC')).toMatch(/^around 11( AM)?$/);
    expect(when(T0 + 5 * H, T0, 'UTC')).toBe('this afternoon');
    expect(when(T0 + 13 * H, T0, 'UTC')).toBe('tonight');
    expect(when(T0 + 17 * H, T0, 'UTC')).toBe('overnight');
    expect(when(T0 + 23 * H, T0, 'UTC')).toBe('tomorrow morning');
    // 09:00 UTC is 14:30 in Delhi.
    expect(hourAt(T0, 'Asia/Kolkata')).toBe(14);
    expect(when(T0 + 4 * H, T0, 'Asia/Kolkata')).toBe('this evening');
  });
});

describe('the week', () => {
  it('scales each day against the whole period, so bars differ', () => {
    const lo = 2;
    const hi = 22;
    expect(rangeBar(2, 22, lo, hi)).toEqual({ left: 0, width: 100 });
    expect(rangeBar(7, 12, lo, hi)).toEqual({ left: 25, width: 25 });
    expect(rangeBar(12, 22, lo, hi)).toEqual({ left: 50, width: 50 });
    // Reversed input, out-of-range values and a flat period stay sane.
    expect(rangeBar(12, 7, lo, hi)).toEqual({ left: 25, width: 25 });
    expect(rangeBar(-5, 30, lo, hi)).toEqual({ left: 0, width: 100 });
    expect(rangeBar(5, 5, 5, 5)).toEqual({ left: 0, width: 100 });
  });

  it('places the current temperature on the track', () => {
    expect(rangePos(12, 2, 22)).toBe(50);
    expect(rangePos(-10, 2, 22)).toBe(0);
    expect(rangePos(40, 2, 22)).toBe(100);
    expect(rangePos(3, 3, 3)).toBe(50);
  });

  it('colours temperatures from cold blue to hot red, in either unit', () => {
    expect(tempColor(-30)).toBe('rgb(124, 92, 255)');
    expect(tempColor(45)).toBe('rgb(190, 24, 93)');
    expect(tempColor(18)).toBe('rgb(250, 204, 21)');
    expect(tempColor(64.4, 'imperial')).toBe(tempColor(18));
    expect(tempColor(0)).not.toBe(tempColor(30));
  });

  it('picks a day’s hours by the place’s calendar', () => {
    const hours = Array.from({ length: 48 }, (_, i) => ({ t: Date.UTC(2026, 10, 2) + i * H }));
    expect(hoursOfDay(hours, Date.UTC(2026, 10, 3), 'UTC')).toHaveLength(24);
    expect(hoursOfDay(hours, Date.UTC(2026, 10, 3), 'UTC')[0].t).toBe(Date.UTC(2026, 10, 3));
  });
});

describe('hourly strip', () => {
  it('starts with Now and puts sunset between the hours it falls in', () => {
    const items = hourlyStrip(forecast(Array(24).fill(0)), T0 + 10 * 60_000);
    expect(items[0]).toMatchObject({ kind: 'hour', now: true });
    const sunset = items.findIndex((x) => x.kind === 'sunset');
    expect(sunset).toBeGreaterThan(0);
    expect(items[sunset - 1].t).toBe(T0 + 7 * H); // the 16:00 hour; sunset at 16:40
    expect(items.filter((x) => x.kind === 'sunrise')).toHaveLength(1); // tomorrow's
    expect(items.filter((x) => x.kind === 'hour')).toHaveLength(24);
    const night = items.find((x) => x.kind === 'hour' && x.t === T0 + 12 * H);
    expect(night && night.kind === 'hour' && night.isDay).toBe(false);
  });
});

describe('tiles', () => {
  it('places the sun on its arc', () => {
    const rise = Date.UTC(2026, 10, 2, 6);
    const set = Date.UTC(2026, 10, 2, 16);
    expect(sunArc(rise, set, rise)).toMatchObject({ f: 0, x: 0, y: 1, up: true, daylight: 10 * H });
    expect(sunArc(rise, set, rise + 5 * H)).toMatchObject({ f: 0.5, x: 0.5, y: 0, up: true });
    expect(sunArc(rise, set, set)).toMatchObject({ f: 1, x: 1, y: 1, up: true });
    const q = sunArc(rise, set, rise + 2.5 * H);
    expect(q.x).toBeCloseTo(0.146, 2);
    expect(q.y).toBeCloseTo(0.293, 2);
    expect(sunArc(rise, set, rise - H).up).toBe(false);
    expect(sunArc(rise, set, set + H)).toMatchObject({ up: false, x: 1, y: 1 });
    expect(duration(10 * H + 42 * 60_000)).toBe('10 h 42 min');
  });

  it('explains why it feels different', () => {
    expect(feelsReason(9, 6, 22, 70)).toBe('Wind makes it feel colder.');
    expect(feelsReason(28, 32, 5, 75)).toBe('Humidity makes it feel warmer.');
    expect(feelsReason(10, 10.4, 5, 50)).toBe('Similar to the actual temperature.');
    expect(feelsReason(48, 43, 15, 60, 'imperial')).toBe('Wind makes it feel colder.');
  });

  it('works out the dew point', () => {
    expect(dewPoint(20, 50)).toBeCloseTo(9.3, 0);
    expect(dewPoint(68, 50, 'imperial')).toBeCloseTo(48.7, 0);
  });

  it('gives packing hints', () => {
    expect(packingHint({ min: 8, max: 14, rainChance: 70, code: 61 })).toBe('Bring an umbrella.');
    expect(packingHint({ min: 2, max: 6, rainChance: 70, code: 63 })).toBe('Bring an umbrella and a warm layer.');
    expect(packingHint({ min: -4, max: 3, rainChance: 0, code: 0 })).toBe('Cold: pack a coat, hat and gloves.');
    expect(packingHint({ min: -2, max: 1, rainChance: 60, code: 73 })).toBe('Snow possible: warm boots and a coat.');
    expect(packingHint({ min: 22, max: 33, rainChance: 0, code: 0 })).toBe('Hot: light clothes, water and sunscreen.');
    expect(packingHint({ min: 15, max: 22, rainChance: 10, code: 95 })).toMatch(/^Storms likely/);
    expect(packingHint({ min: 60, max: 72, rainChance: 0, code: 1, uvMax: 3 }, 'imperial')).toBe('Pleasant: light layers will do.');
  });

  it('shows a place’s local time only when its zone differs', () => {
    expect(localTimeIfDifferent('Europe/Berlin', T0, 'Europe/Berlin')).toBeUndefined();
    expect(localTimeIfDifferent('Asia/Kolkata', T0, 'Europe/Berlin')).toMatch(/14:30|2:30/);
    expect(localTimeIfDifferent(undefined, T0)).toBeUndefined();
  });
});

describe('radar timeline', () => {
  const frames = Array.from({ length: 15 }, (_, i) => ({ time: T0 + (i - 12) * 10 * 60_000 }));
  it('labels frames from the newest past one', () => {
    const now = nowFrameIndex(frames, T0 + 3 * 60_000);
    expect(now).toBe(12);
    expect(frameLabel(frames[0].time, frames[now].time)).toBe('−2 h');
    expect(frameLabel(frames[9].time, frames[now].time)).toBe('−30 min');
    expect(frameLabel(frames[now].time, frames[now].time)).toBe('Now');
    expect(frameLabel(frames[14].time, frames[now].time)).toBe('+20 min');
    expect(frameLabel(T0 - 90 * 60_000, T0)).toBe('−1.5 h');
    expect(frameLabel(T0 - 110 * 60_000, T0)).toBe('\u22122 h');
  });
});

describe('forecast request and parsing', () => {
  it('asks for the extra fields the tiles use, for ten days', () => {
    const u = new URL(weatherUrl({ name: 'X', lat: 1, lon: 2 }, 'metric'));
    for (const f of ['wind_direction_10m', 'wind_gusts_10m', 'dew_point_2m', 'pressure_msl', 'visibility']) expect(u.searchParams.get('current')).toContain(f);
    expect(u.searchParams.get('daily')).toContain('precipitation_sum');
    expect(u.searchParams.get('forecast_days')).toBe('10');
    expect(u.hostname).toBe('api.open-meteo.com');
  });

  it('keeps the next 24 hours from now and every hour for the days', () => {
    const start = Date.UTC(2026, 10, 2) / 1000;
    const n = 48;
    const w = parseWeather({ name: 'X', lat: 1, lon: 2 }, 'metric', {
      timezone: 'Europe/Berlin', utc_offset_seconds: 3600,
      current: { temperature_2m: 5, apparent_temperature: 2, weather_code: 3, wind_speed_10m: 12, wind_direction_10m: 270, wind_gusts_10m: 30, relative_humidity_2m: 80, dew_point_2m: 2, pressure_msl: 1015, visibility: 9000, is_day: 1, uv_index: 1 },
      hourly: {
        time: Array.from({ length: n }, (_, i) => start + i * 3600), temperature_2m: Array(n).fill(5), weather_code: Array(n).fill(3),
        precipitation_probability: Array(n).fill(10), precipitation: Array(n).fill(0), uv_index: Array(n).fill(0), wind_speed_10m: Array(n).fill(5), is_day: Array(n).fill(1),
      },
      daily: { time: [start, start + 86400], temperature_2m_min: [1, 2], temperature_2m_max: [6, 7], weather_code: [3, 61], precipitation_probability_max: [10, 80], precipitation_sum: [0, 4.2], sunrise: [start + 25000, start + 111000], sunset: [start + 60000, start + 146000], uv_index_max: [1, 1] },
      minutely_15: { time: [start + 9 * 3600, start + 9 * 3600 + 900, start + 9 * 3600 + 1800, start + 9 * 3600 + 2700], precipitation: [0.1, 0.2, 0, 0] },
    }, undefined, T0 + 20 * 60_000);
    expect(w.hourly).toHaveLength(24);
    expect(w.hourly[0].t).toBe(T0);
    expect(w.hours).toHaveLength(48);
    expect(w.tz).toBe('Europe/Berlin');
    expect(w.current).toMatchObject({ windDir: 270, gusts: 30, dewPoint: 2, pressure: 1015, visibility: 9000, rainNextHour: 0.3 });
    expect(w.daily[1].rainSum).toBe(4.2);
  });
});
