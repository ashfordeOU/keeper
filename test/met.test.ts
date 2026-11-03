// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { apparentTemp, expiresFrom, hourlyNowcast, MET_SYMBOLS, metCoord, metGet, metSymbol, metUrl, metUserAgent, parseMet, zoneFromLongitude, zoneMidnight, zoneOffset, type MetCached, type MetForecast, type MetStep } from '../core/met';
import { normalizeWeatherSource } from '../core/weather';
import { condition, dayKey } from '../core/weather-view';
import { defaultSettings, mergeSettings } from '../core/settings';

const OSLO = { name: 'Oslo', lat: 59.91273, lon: 10.74609, tz: 'Europe/Oslo' };
const T0 = Date.UTC(2026, 10, 3, 9, 0); // 10:00 in Oslo

/** Hourly steps for 48 hours, then six-hourly for five days, as the service sends them. */
function forecast(o: { rainFrom?: number; rainTo?: number; symbol?: (i: number) => string; start?: number } = {}): MetForecast {
  const T = o.start ?? T0;
  const steps: MetStep[] = [];
  for (let i = 0; i < 48; i++) {
    const wet = o.rainFrom !== undefined && i >= o.rainFrom && i < (o.rainTo ?? 99);
    steps.push({
      time: new Date(T + i * 3600_000).toISOString(),
      data: {
        instant: { details: { air_temperature: 5 + Math.sin(i / 4) * 3, relative_humidity: 80, wind_speed: 4, wind_from_direction: 200, wind_speed_of_gust: 9, dew_point_temperature: 2, air_pressure_at_sea_level: 1012, ultraviolet_index_clear_sky: i % 24 < 6 ? 1.2 : 0 } },
        next_1_hours: { summary: { symbol_code: o.symbol?.(i) ?? (wet ? 'rain' : 'partlycloudy_day') }, details: { precipitation_amount: wet ? 1.2 : 0, probability_of_precipitation: wet ? 90 : 5 } },
        next_6_hours: { summary: { symbol_code: 'cloudy' }, details: { precipitation_amount: wet ? 4 : 0, probability_of_precipitation: wet ? 80 : 10, air_temperature_max: 9, air_temperature_min: 2 } },
        next_12_hours: { summary: { symbol_code: 'lightrainshowers_day' }, details: { probability_of_precipitation: 40 } },
      },
    });
  }
  for (let i = 48; i < 48 + 5 * 24; i += 6) {
    steps.push({
      time: new Date(T + i * 3600_000).toISOString(),
      data: {
        instant: { details: { air_temperature: 4, relative_humidity: 70, wind_speed: 3 } },
        next_6_hours: { summary: { symbol_code: 'snow' }, details: { precipitation_amount: 2, probability_of_precipitation: 60, air_temperature_max: 6, air_temperature_min: -1 } },
        next_12_hours: { summary: { symbol_code: 'snow' } },
      },
    });
  }
  return { properties: { meta: { updated_at: new Date(T0).toISOString() }, timeseries: steps } };
}

describe('MET Norway requests', () => {
  it('names Keeper and a way to reach Ashforde in the User-Agent', () => {
    expect(metUserAgent('1.0.0')).toBe('Keeper/1.0.0 https://keeper.ashforde.org');
    expect(metUserAgent('1.0.0 (evil)\nx')).toBe('Keeper/1.0.0evilx https://keeper.ashforde.org');
  });
  it('sends at most four decimals', () => {
    expect(metCoord(59.912734567)).toBe('59.9127');
    const u = new URL(metUrl(OSLO));
    expect(u.hostname).toBe('api.met.no');
    expect(u.pathname).toBe('/weatherapi/locationforecast/2.0/complete');
    expect(u.searchParams.get('lat')).toBe('59.9127');
    expect(u.searchParams.get('lon')).toBe('10.7461');
  });
});

describe('symbol codes', () => {
  it('maps every symbol MET documents to a known condition', () => {
    expect(MET_SYMBOLS.length).toBe(41);
    for (const s of MET_SYMBOLS) expect(condition(metSymbol(s).code).label).not.toBe('');
  });
  it('reads the day or night ending', () => {
    expect(metSymbol('clearsky_night')).toEqual({ code: 0, isDay: false });
    expect(metSymbol('fair_day')).toEqual({ code: 1, isDay: true });
    expect(metSymbol('partlycloudy_polartwilight')).toEqual({ code: 2, isDay: false });
    expect(metSymbol('cloudy')).toEqual({ code: 3 });
  });
  it('groups showers, sleet, snow and thunder the way the icons expect', () => {
    expect(condition(metSymbol('heavyrainshowers_day').code).icon).toBe('heavy-rain');
    expect(condition(metSymbol('sleet').code).icon).toBe('freezing');
    expect(condition(metSymbol('lightsnowshowers_night').code).icon).toBe('snow-showers');
    expect(condition(metSymbol('lightssleetshowersandthunder_day').code).group).toBe('storm');
    expect(condition(metSymbol('fog').code).icon).toBe('fog');
  });
  it('reads a symbol it does not know by its words', () => {
    expect(metSymbol('somethingthunder').code).toBe(95);
    expect(metSymbol('newsnowkind').code).toBe(73);
    expect(metSymbol(undefined).code).toBe(3);
  });
});

describe('parsing a forecast', () => {
  const w = parseMet(OSLO, 'metric', forecast(), T0 + 10 * 60_000);
  it('fills the current conditions, converting wind to km/h', () => {
    expect(w.source).toBeUndefined();
    expect(w.current.temp).toBeCloseTo(5, 5);
    expect(w.current.wind).toBe(14.4);
    expect(w.current.gusts).toBe(32.4);
    expect(w.current.humidity).toBe(80);
    expect(w.current.windDir).toBe(200);
    expect(w.current.pressure).toBe(1012);
    expect(w.current.code).toBe(2);
    expect(w.current.isDay).toBe(true);
    expect(w.current.feels).toBeLessThan(w.current.temp);
    expect(w.tz).toBe('Europe/Oslo');
    expect(w.utcOffset).toBe(3600);
  });
  it('has the next 24 hours and every step for the day details', () => {
    expect(w.hourly).toHaveLength(24);
    expect(w.hourly[0].t).toBe(T0);
    expect(w.hours!.length).toBe(48 + 20);
  });
  it('makes days at the place with their range, rain and sun', () => {
    expect(w.daily.length).toBeGreaterThanOrEqual(6);
    const first = w.daily[0];
    expect(dayKey(first.t, 'Europe/Oslo')).toBe('2026-11-03');
    expect(first.t).toBe(Date.UTC(2026, 10, 2, 23));
    expect(first.max).toBeGreaterThanOrEqual(first.min);
    expect(first.sunrise).toBeLessThan(first.sunset);
    // November in Oslo: sunrise around 8 local, sunset around 16.
    expect(new Date(first.sunrise).getUTCHours()).toBe(6);
    expect(new Date(first.sunset).getUTCHours()).toBe(15);
    const snowy = w.daily[w.daily.length - 1];
    expect(condition(snowy.code).group).toBe('snow');
    expect(snowy.rainSum).toBeGreaterThan(0);
  });
  it('converts to Fahrenheit, mph and inches', () => {
    const f = parseMet(OSLO, 'imperial', forecast({ rainFrom: 0 }), T0);
    expect(f.current.temp).toBe(41);
    expect(f.current.wind).toBe(8.9);
    expect(f.hourly[0].rain).toBe(0.05);
  });
  it('guesses the zone from the longitude for places saved without one', () => {
    const g = parseMet({ name: 'Somewhere', lat: 59.9, lon: 10.7 }, 'metric', forecast(), T0);
    expect(g.tz).toBe('Etc/GMT-1');
    expect(zoneFromLongitude(-74)).toBe('Etc/GMT+5');
    expect(zoneFromLongitude(0)).toBe('Etc/GMT');
    expect(zoneFromLongitude(179)).toBe('Etc/GMT-12');
  });
  it('gives late evening a range from the hours left and tonight', () => {
    const late = Date.UTC(2026, 10, 3, 21, 0); // 22:00 in Oslo: two hours left
    const e = parseMet(OSLO, 'metric', forecast({ start: late }), late);
    expect(e.daily[0].max).toBe(9);
    expect(e.daily[0].min).toBe(2);
  });
  it('refuses an empty answer', () => {
    expect(() => parseMet(OSLO, 'metric', { properties: { timeseries: [] } })).toThrow(/no forecast/);
  });
});

describe('rain soon', () => {
  it('says when rain starts within two hours', () => {
    const w = parseMet(OSLO, 'metric', forecast({ rainFrom: 1 }), T0 + 15 * 60_000);
    expect(w.nowcast).toBe('Rain starting in about 45 minutes');
    expect(parseMet(OSLO, 'metric', forecast({ rainFrom: 0, rainTo: 2 }), T0).nowcast).toBe('Rain stopping in about 120 minutes');
    expect(parseMet(OSLO, 'metric', forecast({ rainFrom: 0 }), T0).nowcast).toBe('Rain for the next two hours');
    expect(parseMet(OSLO, 'metric', forecast(), T0).nowcast).toBeUndefined();
    expect(hourlyNowcast([{ t: T0, rain: 0 }], T0)).toBeUndefined();
  });
});

describe('time at the place', () => {
  it('knows summer time', () => {
    expect(zoneOffset(Date.UTC(2026, 6, 1), 'Europe/Oslo')).toBe(7200);
    expect(zoneOffset(Date.UTC(2026, 0, 1), 'Europe/Oslo')).toBe(3600);
    expect(zoneMidnight('2026-07-01', 'Europe/Oslo')).toBe(Date.UTC(2026, 5, 30, 22));
    expect(zoneMidnight('2026-03-29', 'Europe/Oslo')).toBe(Date.UTC(2026, 2, 28, 23));
  });
  it('feels colder in wind and warmer in damp heat', () => {
    expect(apparentTemp(5, 50, 10)).toBeLessThan(0);
    expect(apparentTemp(30, 80, 0)).toBeGreaterThan(30);
  });
});

describe('caching as MET asks', () => {
  const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
  it('does not ask again before the answer expires, then asks with If-Modified-Since', async () => {
    const cache = new Map<string, MetCached>();
    const calls: Record<string, string>[] = [];
    let status = 200;
    const fetch = async (_u: string, init: { headers: Record<string, string> }) => {
      calls.push(init.headers);
      return { status, ok: status === 200, headers: headers({ expires: new Date(T0 + 30 * 60_000).toUTCString(), 'last-modified': 'Tue, 03 Nov 2026 08:55:00 GMT' }), json: async () => ({ n: calls.length }) };
    };
    expect(await metGet('u', { cache, version: '1.0.0', fetch, now: T0 })).toEqual({ n: 1 });
    expect(await metGet('u', { cache, version: '1.0.0', fetch, now: T0 + 10 * 60_000 })).toEqual({ n: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]['user-agent']).toBe('Keeper/1.0.0 https://keeper.ashforde.org');
    expect(calls[0]['if-modified-since']).toBeUndefined();
    status = 304;
    expect(await metGet('u', { cache, version: '1.0.0', fetch, now: T0 + 31 * 60_000 })).toEqual({ n: 1 });
    expect(calls[1]['if-modified-since']).toBe('Tue, 03 Nov 2026 08:55:00 GMT');
    status = 429;
    await expect(metGet('u', { cache, version: '1.0.0', fetch, now: T0 + 2 * 3600_000 })).rejects.toThrow(/wait/);
  });
  it('waits half an hour when no Expires comes back, and never less than a minute', () => {
    expect(expiresFrom(headers({}), T0)).toBe(T0 + 30 * 60_000);
    expect(expiresFrom(headers({ expires: new Date(T0 - 1000).toUTCString() }), T0)).toBe(T0 + 60_000);
  });
});

describe('the setting', () => {
  it('defaults to MET Norway and keeps Open-Meteo when chosen', () => {
    const base = defaultSettings([], []);
    expect(base.weatherSource).toBe('met');
    expect(mergeSettings(base, { weatherSource: 'open-meteo' }).weatherSource).toBe('open-meteo');
    expect(mergeSettings(base, { weatherSource: 'elsewhere' }).weatherSource).toBe('met');
    expect(normalizeWeatherSource(undefined)).toBe('met');
  });
});
