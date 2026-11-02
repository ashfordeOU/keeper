// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI, after npm run build): xvfb-run -a node test/e2e/tracks-link.cjs [root] [shots]
// Two real Keeper apps (separate homes) paired over Keeper Link. The desk shares
// its location with the laptop; the laptop's Places & Tracks shows the desk under
// Live ("Your paired devices"), and only after the desk allowed it.
const { _electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.realpathSync(path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ktrlink-'))));
const SHOTS = path.resolve(process.argv[3] || path.join(ROOT, 'shots'));
const homes = { a: path.join(ROOT, 'desk'), b: path.join(ROOT, 'laptop') };
for (const h of Object.values(homes)) for (const d of ['Documents', 'Downloads', 'Pictures']) fs.mkdirSync(path.join(h, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); }
  return undefined;
}

async function launch(home) {
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME: home, NODE_OPTIONS: '', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: home + '/.config', XDG_DATA_HOME: home + '/.local/share' } });
  let main;
  for (let i = 0; i < 160 && !main; i++) { main = app.windows().find((w) => w.url().includes('view=app')); if (!main) await wait(500); }
  if (!main) throw new Error('no main window');
  const errors = [];
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1280, height: 860 }).catch(() => undefined);
  await main.waitForTimeout(2500);
  return { app, main, errors };
}

const api = (w, fn, ...args) => w.evaluate(([f, a]) => {
  const p = f.split('.');
  let o = window.keeper;
  for (const k of p.slice(0, -1)) o = o[k];
  return o[p[p.length - 1]](...a);
}, [fn, args]);

(async () => {
  const A = await launch(homes.a);
  const B = await launch(homes.b);
  const sa = await api(A.main, 'link.state');

  // ---- pair the two apps through their windows (as test/e2e/link.cjs does)
  const openDevices = async (w) => { await w.locator('.nav-item[title="Pair a device, phones, remote access"]').click(); await w.waitForTimeout(500); };
  await openDevices(A.main);
  await A.main.locator('.content').getByRole('button', { name: 'Pair a Device' }).first().click();
  const code = await until(async () => (await A.main.locator('[data-testid=link-code]').innerText()).replace(/\D/g, ''));
  await openDevices(B.main);
  await B.main.locator('.content').getByRole('button', { name: 'Pair a Device' }).first().click();
  await B.main.locator('.modal').getByRole('button', { name: 'Enter a Code' }).click();
  const seen = await until(async () => (await B.main.locator('.link-row.pick').count()) > 0, 12000);
  if (seen) await B.main.locator('.link-row.pick').first().click();
  else await B.main.locator('input[placeholder^="Address"]').fill(`127.0.0.1:${sa.me.port}`);
  await B.main.locator('input.link-code-input').fill(code);
  await B.main.getByRole('button', { name: 'Pair', exact: true }).click();
  await until(async () => A.main.locator('[data-testid=link-sas]').innerText(), 15000);
  await until(async () => B.main.locator('[data-testid=link-sas]').innerText(), 15000);
  await A.main.getByRole('button', { name: /They match/ }).click();
  await B.main.getByRole('button', { name: /They match/ }).click();
  const paired = await until(async () => (await api(A.main, 'link.state')).devices.length === 1 && (await api(B.main, 'link.state')).devices.length === 1, 15000);
  check(!!paired, 'the desk and the laptop are paired');
  const laptopOnDesk = (await api(A.main, 'link.state')).devices[0];
  const deskOnLaptop = (await api(B.main, 'link.state')).devices[0];
  await B.main.keyboard.press('Escape').catch(() => undefined);
  await A.main.keyboard.press('Escape').catch(() => undefined);

  // ---- the desk: live sharing and "Your paired devices" on, its Home place as its own position
  await api(A.main, 'features.set', 'tracksLive', true);
  await api(A.main, 'tracks.setConfig', { sources: { link: { on: true } } });
  await api(A.main, 'tracks.savePlace', { id: '', name: 'Home', lat: 59.4372, lon: 24.7454, radiusM: 80, kind: 'home' });

  // ---- the laptop: same switches, then the Live view
  await api(B.main, 'features.set', 'tracksLive', true);
  await api(B.main, 'tracks.setConfig', { sources: { link: { on: true } } });
  await B.main.locator('.nav-item[title="Places & Tracks"]').first().click();
  await B.main.locator('.tk-tabs button', { hasText: 'Live' }).click();
  await B.main.waitForTimeout(3000);
  const before = await api(B.main, 'tracks.live');
  check(!before.some((p) => p.id === `link:${deskOnLaptop.id}`), 'without “Share my location” the desk’s position is not given');

  // ---- the desk allows the laptop to see where it is
  const perms = { ...(laptopOnDesk.perms ?? laptopOnDesk.permissions ?? {}), location: true };
  await api(A.main, 'link.setPermissions', laptopOnDesk.id, perms);
  // Reopen the Live view: it asks straight away (and every minute while open).
  await B.main.locator('.tk-tabs button', { hasText: 'Places' }).click();
  await B.main.locator('.tk-tabs button', { hasText: 'Live' }).click();
  const got = await until(async () => (await api(B.main, 'tracks.live')).find((p) => p.id === `link:${deskOnLaptop.id}`), 20000);
  check(!!got && Math.abs(got.lat - 59.4372) < 1e-6 && Math.abs(got.lon - 24.7454) < 1e-6 && got.source === 'link', `the laptop sees the desk at its Home place (${got ? `${got.name} ${got.lat},${got.lon} ±${got.acc} m` : 'nothing'})`);
  await B.main.waitForSelector('.tk-entry.live', { timeout: 10000 }).catch(() => undefined);
  const row = await B.main.locator('.tk-entry.live').first().innerText().catch(() => '');
  check(row.includes(deskOnLaptop.name), `the Live view lists the desk (${row.replace(/\n/g, ' · ')})`);
  await B.main.screenshot({ path: path.join(SHOTS, 'link-live-light.png') });

  // ---- the desk's audit log says the laptop looked
  const audit = await until(async () => {
    const log = await api(A.main, 'access.audit').catch(() => []);
    return JSON.stringify(log).includes('location');
  }, 5000);
  check(!!audit, 'the desk logs that the laptop saw its location');

  check(A.errors.length === 0 && B.errors.length === 0, `no page errors${[...A.errors, ...B.errors].length ? ': ' + [...A.errors, ...B.errors].join(' | ') : ''}`);
  await A.app.close();
  await B.app.close();
})().catch((e) => { console.error(e); process.exit(1); });
