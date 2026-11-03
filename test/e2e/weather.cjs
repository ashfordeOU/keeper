// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/weather.cjs /tmp/kwx-home /tmp/kwx-shots
// Drives the real Keeper app's Weather page against a stand-in for MET Norway's
// Locationforecast service on this computer (KEEPER_MET_URL): the forecast is
// drawn from MET's answer, the request names Keeper in its User-Agent and sends
// four decimals, an answer is not asked for again before it expires; the page credits MET Norway (CC BY 4.0); choosing
// Open-Meteo in Settings changes the credit. Light and dark.

const { _electron } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }

/** A Locationforecast answer: hourly for two days, then six-hourly. */
function forecast() {
  const start = new Date(); start.setUTCMinutes(0, 0, 0);
  const steps = [];
  for (let i = 0; i < 48; i++) {
    const wet = i >= 1 && i < 4;
    steps.push({ time: new Date(start.getTime() + i * 3600_000).toISOString(), data: {
      instant: { details: { air_temperature: 11.4 + Math.sin(i / 5) * 4, relative_humidity: 72, wind_speed: 5, wind_from_direction: 240, wind_speed_of_gust: 11, dew_point_temperature: 6, air_pressure_at_sea_level: 1008, ultraviolet_index_clear_sky: 1.5 } },
      next_1_hours: { summary: { symbol_code: wet ? 'lightrainshowers_day' : 'partlycloudy_day' }, details: { precipitation_amount: wet ? 0.8 : 0, probability_of_precipitation: wet ? 85 : 10 } },
      next_6_hours: { summary: { symbol_code: 'cloudy' }, details: { precipitation_amount: wet ? 2.4 : 0, probability_of_precipitation: 60, air_temperature_max: 15, air_temperature_min: 8 } },
      next_12_hours: { summary: { symbol_code: 'lightrainshowers_day' }, details: { probability_of_precipitation: 50 } },
    } });
  }
  for (let i = 48; i < 48 + 7 * 24; i += 6) {
    steps.push({ time: new Date(start.getTime() + i * 3600_000).toISOString(), data: {
      instant: { details: { air_temperature: 9, relative_humidity: 70, wind_speed: 3 } },
      next_6_hours: { summary: { symbol_code: i % 24 === 0 ? 'clearsky_day' : 'fair_day' }, details: { precipitation_amount: 0, probability_of_precipitation: 5, air_temperature_max: 13, air_temperature_min: 5 } },
      next_12_hours: { summary: { symbol_code: 'fair_day' } },
    } });
  }
  return { type: 'Feature', properties: { meta: { updated_at: start.toISOString() }, timeseries: steps } };
}

(async () => {
  const asked = [];
  const server = http.createServer((req, res) => {
    asked.push({ url: req.url, ua: req.headers['user-agent'], ims: req.headers['if-modified-since'] });
    if (!req.url.startsWith('/weatherapi/locationforecast/2.0/complete')) { res.writeHead(404); return res.end(); }
    if (req.headers['if-modified-since']) { res.writeHead(304, { expires: new Date(Date.now() + 3000).toUTCString() }); return res.end(); }
        res.writeHead(200, { 'content-type': 'application/json', expires: new Date(Date.now() + 30 * 60_000).toUTCString(), 'last-modified': new Date(Date.now() - 60_000).toUTCString() });
    res.end(JSON.stringify(forecast()));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', KEEPER_MET_URL: base, XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => { await wait(900); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

  const s0 = await main.evaluate(() => window.keeper.settings.get());
  check(s0.weatherSource === 'met', 'forecasts come from MET Norway by default');
  const place = { name: 'Bergen, Vestland', lat: 60.391263123, lon: 5.322054987, country: 'Norway', tz: 'Europe/Oslo' };
  await main.evaluate((p) => window.keeper.forecast.savePlaces([p]), place);
  await main.evaluate(async (p) => { const s = await window.keeper.settings.get(); await window.keeper.settings.set({ island: { ...s.island, place: p, weather: true } }); }, place);

  await navigate('weather');
  check(!!(await until(async () => /Bergen/.test(await main.locator('.wx').innerText()) && /\d+°/.test(await main.locator('.wx').innerText()), 20000)), 'the Weather page shows the forecast for Bergen');
  const first = asked.find((a) => a.url.includes('locationforecast'));
  check(!!first && first.ua && /^Keeper\/\d+\.\d+\.\d+\S* https:\/\/keeper\.ashforde\.org$/.test(first.ua), `the request names Keeper and Ashforde's address (${first && first.ua})`);
  check(!!first && /lat=60\.3913&lon=5\.3221$/.test(first.url), `coordinates carry four decimals (${first && first.url})`);
  const w = await main.evaluate((p) => window.keeper.forecast.get(p, 'metric'), place);
  check(w.source === 'met' && w.tz === 'Europe/Oslo' && w.hourly.length === 24 && w.daily.length >= 7, 'the forecast has 24 hours and a week of days in the place’s own time');
  check(/Rain starting in about/.test(w.nowcast ?? ''), `rain soon is worked out from the hours (${w.nowcast})`);
  check(Math.round(w.current.wind) === 18, 'wind is shown in km/h (5 m/s → 18 km/h)');
  const credit = await main.locator('[data-testid="wx-credit"]').innerText();
  check(/Weather data from MET Norway/.test(credit) && /CC BY 4\.0/.test(credit), `the page credits MET Norway under CC BY 4.0 ("${credit.trim()}")`);

  // Polite caching: nothing before it expires, then If-Modified-Since.
  const n1 = asked.filter((a) => a.url.includes('locationforecast')).length;
  await main.evaluate(async (p) => { await window.keeper.weather.get(true); return window.keeper.forecast.get({ ...p, name: 'Bergen again' }, 'metric'); }, place);
  const n2 = asked.filter((a) => a.url.includes('locationforecast')).length;
  check(n2 === n1, `the Island and the page share the answer until it expires (${n1} → ${n2} requests)`);
  // (Asking again with If-Modified-Since after it expires is covered in test/met.test.ts: Keeper never asks sooner than a minute.)
  await main.evaluate(() => window.keeper.weather.get(true));
  check(asked.filter((a) => a.url.includes('locationforecast')).length === n2, 'a forced refresh before the answer expires asks nothing');

  await shot('weather-light');
  await main.locator('[data-testid="wx-credit"]').scrollIntoViewIfNeeded();
  await shot('weather-credit-light');
  await main.evaluate(() => document.querySelector('.main, main, .content')?.scrollTo?.(0, 0));
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await shot('weather-dark');
  await main.setViewportSize({ width: 1024, height: 768 });
  await shot('weather-dark-1024');
  await main.setViewportSize({ width: 1440, height: 900 });
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));

  // Choosing Open-Meteo.
  await main.evaluate(() => window.keeper.settings.set({ weatherSource: 'open-meteo' }));
  check(!!(await until(async () => /Open-Meteo/.test(await main.locator('[data-testid="wx-credit"]').innerText()), 15000)), 'choosing Open-Meteo changes the credit');
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await app.close();
  server.close();
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
