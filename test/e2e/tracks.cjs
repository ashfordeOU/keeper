// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI, after npm run build): xvfb-run -a node test/e2e/tracks.cjs [home] [shots]
// Drives the real Keeper with a made-up home: imports a GPX run and a Google
// Timeline export, checks the timeline (stays and a move), the trip, the map's
// track lines (tiles from a local stub server, never the real tile servers),
// an OwnTracks post to the live receiver, the palette, "Show on Map" in the
// file browser, the Island's "Arriving", and a GPX export compared with the input.
const { _electron } = require('playwright');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '../..');
const HOME = fs.realpathSync(path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ktracks-'))));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const DOCS = path.join(HOME, 'Documents');
for (const d of [DOCS, SHOTS, path.join(HOME, 'Downloads'), path.join(HOME, 'Pictures')]) fs.mkdirSync(d, { recursive: true });
const FX = path.join(ROOT, 'test/fixtures/tracks');
for (const f of ['run.gpx', 'timeline-android.json']) fs.copyFileSync(path.join(FX, f), path.join(DOCS, f));

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A 256×256 PNG in one colour: the stub tile server's only picture.
function png() {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + 256 * 3); for (let i = 0; i < 256; i++) { row[1 + i * 3] = 205; row[2 + i * 3] = 225; row[3 + i * 3] = 205; }
  const raw = Buffer.concat(Array.from({ length: 256 }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const tilePng = png();
  let tileHits = 0;
  const userAgents = new Set();
  const tiles = http.createServer((req, res) => { tileHits++; userAgents.add(req.headers['user-agent']); res.writeHead(200, { 'content-type': 'image/png' }); res.end(tilePng); });
  await new Promise((r) => tiles.listen(0, '127.0.0.1', r));
  const tileUrl = `http://127.0.0.1:${tiles.address().port}/{z}/{x}/{y}.png`;
  const recvPort = 21000 + Math.floor(Math.random() * 20000);

  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, TZ: 'UTC', NODE_OPTIONS: '', KEEPER_SUITE: 'shared', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', KEEPER_TRACKS_TILE_URL: tileUrl, KEEPER_SKIP_TOUR: '1' } });
  const errors = [];
  let main;
  for (let i = 0; i < 60 && !main; i++) { main = app.windows().find((w) => w.url().includes('view=app')); if (!main) await sleep(500); }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')));
  const consoleErrors = [];
  main.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForTimeout(2500);
  const skip = await main.$('.tour button:has-text("Skip tour")');
  if (skip) await skip.click();
  await main.evaluate(() => { for (const k of ['home', 'settings', 'tracks']) try { localStorage.setItem(`coach.${k}`, '1'); } catch { /* ignore */ } });
  const k = (fn, ...a) => main.evaluate(fn, ...a);
  const shot = async (name) => { await main.waitForTimeout(600); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const theme = async (mode) => {
    await k((m) => window.keeper.settings.set({ appearance: m }), mode);
    const ok = await main.waitForFunction((m) => document.documentElement.dataset.theme === m, mode, { timeout: 5000 }).then(() => true, () => false);
    if (!ok) {
      // The settings change did not reach the window: reload it (it reads settings afresh) and come back.
      console.log(`note: appearance ${mode} applied by reloading the window`);
      await main.reload();
      await main.waitForSelector('.nav-item', { timeout: 15000 });
      await main.waitForFunction((m) => document.documentElement.dataset.theme === m, mode, { timeout: 10000 }).catch(() => undefined);
      if (!(await main.$('.tk-page'))) await main.locator('.nav-item[title="Places & Tracks"]').first().click();
      await main.waitForSelector('.tk-page', { timeout: 10000 });
    }
    await main.waitForTimeout(500);
  };

  // Nothing runs before a source is on: no receiver.
  const ov0 = await k(() => window.keeper.tracks.overview());
  check(ov0.features.tracks && !ov0.features.live && !ov0.receiver.running, 'Places & Tracks is on, live sharing and the receiver are off by default');
  check(ov0.tileOverride === true, 'this unofficial build uses the stub tile server');

  // ---------------------------------------------------------------- import
  const imp = await k((files) => window.keeper.tracks.importFiles(files), [path.join(DOCS, 'run.gpx'), path.join(DOCS, 'timeline-android.json')]);
  check(imp.imported.length === 2 && imp.imported[0].tracks === 2 && imp.imported[1].visits === 9, `imported the GPX (2 tracks) and the Google Timeline (9 visits): ${JSON.stringify(imp.imported.map((i) => [i.format, i.tracks, i.visits, i.warnings]))}`);
  const again = await k((files) => window.keeper.tracks.importFiles(files), [path.join(DOCS, 'run.gpx')]);
  check(again.imported[0].tracks === 0 && again.skipped > 0, 'a second import of the same file adds nothing');
  const dataFile = path.join(HOME, '.config', 'Keeper', 'tracks', 'data.bin');
  for (let i = 0; i < 20 && !fs.existsSync(dataFile); i++) await sleep(250);
  const raw = fs.existsSync(dataFile) ? fs.readFileSync(dataFile) : Buffer.alloc(0);
  const enc = await k(() => window.keeper.tracks.overview());
  check(raw.length > 0 && !raw.toString('latin1').includes('59.43'), `location data is on disk, not as plain text (${raw.subarray(0, 5).toString()}: ${enc.encrypted ? 'encrypted with the keychain key' : 'compressed only — ' + enc.encryptionNote})`);
  await k(() => window.keeper.tracks.setConfig({ map: { online: true } }));

  // ---------------------------------------------------------------- timeline
  const navs = await main.$$eval('.nav-item', (els) => els.map((e) => e.getAttribute('title')));
  check(navs.includes('Places & Tracks'), `the sidebar has Places & Tracks (${navs.length} items)`);
  if (!navs.includes('Places & Tracks')) { await shot('sidebar-missing'); console.log(errors.join('\n'), consoleErrors.join('\n')); }
  await main.locator('.nav-item[title="Places & Tracks"]').first().click();
  await main.waitForSelector('.tk-page', { timeout: 10000 });
  await main.waitForSelector('.tk-entry.stay', { timeout: 15000 });
  const stays = await main.locator('.tk-entry.stay').count();
  const moves = await main.locator('.tk-entry.move').count();
  check(stays >= 2 && moves >= 1, `the timeline shows stays (${stays}) and a move (${moves}) on the latest day`);
  const flight = await main.locator('.tk-entry.move', { hasText: 'Flight' }).count();
  check(flight >= 1, 'the flight home is inferred as a flight');
  await main.waitForFunction(() => document.querySelectorAll('.tk-map .track-line').length > 0, null, { timeout: 10000 });
  await main.waitForFunction(() => document.querySelectorAll('.tk-map image').length > 0, null, { timeout: 10000 }).catch(() => undefined);
  check((await main.locator('.tk-map image').count()) > 0 && tileHits > 0, `map tiles come from the local stub (${tileHits} requests)`);
  check([...userAgents].every((u) => /^Keeper\//.test(u || '')), `tile requests name Keeper in the User-Agent (${[...userAgents].join(', ')})`);
  await shot('timeline-light');
  // Week view.
  await main.locator('.tk-nav .seg button', { hasText: 'Week' }).click();
  await main.waitForSelector('.tk-day', { timeout: 10000 });
  await shot('timeline-week-light');
  await main.locator('.tk-nav .seg button', { hasText: 'Day' }).click();

  // Search.
  const found = await k(() => window.keeper.tracks.search('When was I last in Estonia?'));
  check(found.hits.length > 0 && /^Last in Estonia on/.test(found.answer), `search answers "${found.answer}"`);

  // ---------------------------------------------------------------- trip
  await main.locator('.tk-tabs button', { hasText: 'Trips' }).click();
  await main.waitForSelector('.tk-trip-card', { timeout: 15000 });
  const card = await main.locator('.tk-trip-card').first().innerText();
  check(/Estonia/.test(card) && /2 flights/.test(card), `the trip builds: ${card.replace(/\n/g, ' · ')}`);
  await main.locator('.tk-trip-card').first().click();
  await main.waitForSelector('.tk-trip .tk-iday', { timeout: 10000 });
  const days = await main.locator('.tk-trip .tk-iday').count();
  check(days >= 3, `the trip view has a day-by-day itinerary (${days} days)`);
  await main.waitForFunction(() => document.querySelectorAll('.tk-trip .track-line').length > 0, null, { timeout: 10000 });
  check(true, 'the trip map draws its tracks');
  await shot('trip-light');

  // ---------------------------------------------------------------- activity map
  await main.locator('.tk-tabs button', { hasText: 'Activities' }).click();
  await main.waitForSelector('.tk-act', { timeout: 10000 });
  await main.locator('.tk-act', { hasText: 'Morning Run' }).click();
  await main.waitForSelector('.tk-detail .track-line', { timeout: 10000 });
  const segs = await main.locator('.tk-detail .track-line').count();
  const colours = await main.$$eval('.tk-detail .track-line', (els) => new Set(els.map((e) => e.getAttribute('stroke'))).size);
  check(segs >= 2 && colours >= 2, `the run is drawn as polylines coloured by speed (${segs} runs, ${colours} colours)`);
  await shot('activity-light');

  // ---------------------------------------------------------------- live: OwnTracks
  await k(() => window.keeper.features.set('tracksLive', true));
  let ov = await k((p) => window.keeper.tracks.setConfig({ sources: { ownTracks: { on: true }, receiver: { port: p } } }), recvPort);
  for (let i = 0; i < 20 && !ov.receiver.running; i++) { await sleep(250); ov = await k(() => window.keeper.tracks.overview()); }
  check(ov.receiver.running && ov.receiver.url === `http://127.0.0.1:${recvPort}`, `the OwnTracks receiver listens on this computer only (${ov.receiver.url})`);
  const token = ov.config.sources.receiver.token;
  const post = (body) => fetch(`http://127.0.0.1:${recvPort}/owntracks`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`alex:${token}`).toString('base64')}`, 'x-limit-u': 'alex', 'x-limit-d': 'phone' } });
  const denied = await fetch(`http://127.0.0.1:${recvPort}/owntracks`, { method: 'POST', body: '{}' });
  check(denied.status === 401, 'a post without the token is refused');
  const now = Math.floor(Date.now() / 1000);
  const r1 = await post({ _type: 'location', lat: 52.4900, lon: 13.4094, tst: now - 60, acc: 10, batt: 71, vel: 30, tid: 'AX' });
  check(r1.status === 200, 'OwnTracks post accepted');
  await main.locator('.tk-tabs button', { hasText: 'Live' }).click();
  await main.waitForSelector('.tk-entry.live', { timeout: 10000 });
  const liveText = await main.locator('.tk-entry.live').first().innerText();
  check(/AX/.test(liveText) && /71%/.test(liveText), `the live view shows the phone with its battery: ${liveText.replace(/\n/g, ' · ')}`);
  await shot('live-light');

  // The Island: you are moving towards home → "Arriving".
  await k(() => window.keeper.tracks.setConfig({ self: ['owntracks:alex/phone'] }));
  await post({ _type: 'location', lat: 52.5000, lon: 13.4094, tst: now, acc: 10, batt: 70, vel: 30, tid: 'AX' });
  let island = null;
  for (let i = 0; i < 20 && !island; i++) { island = app.windows().find((w) => /view=island/.test(w.url())); if (!island) await sleep(250); }
  if (island) {
    let txt = '';
    for (let i = 0; i < 20 && !/Arriving|home in/.test(txt); i++) { await sleep(250); txt = await island.evaluate(() => document.body.innerText).catch(() => ''); }
    check(/Arriving|home in/.test(txt), `the Island shows the arriving activity (${txt.replace(/\s+/g, ' ').slice(0, 80)})`);
    await island.screenshot({ path: path.join(SHOTS, 'island-arriving.png') }).catch(() => undefined);
  } else console.log('SKIP the Island window is not open on this display');

  // Palette: "Where is …?"
  await main.keyboard.press('Control+k');
  await main.waitForTimeout(400);
  await main.keyboard.type('where is');
  await main.waitForTimeout(500);
  const pal = await main.locator('body').innerText();
  check(/Where Is AX\?|Where Is My AX\?/.test(pal), 'the command palette offers “Where Is My AX?”');
  await shot('palette-light');
  await main.keyboard.press('Escape');

  // ---------------------------------------------------------------- "Show on Map" in the file browser
  try {
    await main.getByRole('button', { name: 'Browse', exact: true }).first().click();
    await main.waitForTimeout(800);
    await main.locator(`.folder-item[title="${DOCS}"]`).first().dblclick();
    await main.waitForSelector('text=run.gpx', { timeout: 8000 }).catch(async (e) => { await shot('browse-fail'); throw e; });
    await main.locator('text=run.gpx').first().click({ button: 'right' });
    await main.waitForSelector('.menu button:has-text("Show on Map")', { timeout: 4000 });
    await shot('filemenu-light');
    await main.locator('.menu button:has-text("Show on Map")').click();
    await main.waitForSelector('.tk-page .track-line', { timeout: 10000 });
    check(true, '“Show on Map” in the file browser opens the GPX on the map');
    await shot('show-on-map-light');
  } catch (e) {
    check(false, `“Show on Map” from the file browser: ${e.message.split('\n')[0]}`);
  }

  // ---------------------------------------------------------------- export and compare
  const list = await k(() => window.keeper.tracks.tracks());
  const run = list.find((t) => t.name === 'Morning Run');
  const out = path.join(HOME, 'Downloads', 'run-export.gpx');
  const ex = await k((a) => window.keeper.tracks.export({ format: 'gpx', ids: [a.id], path: a.out }), { id: run.id, out });
  const pts = (s) => [...s.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)">(?:<ele>([-\d.]+)<\/ele>)?<time>([^<]+)<\/time>(?:.*?<gpxtpx:hr>(\d+))?/g)].map((m) => [(+m[1]).toFixed(6), (+m[2]).toFixed(6), m[4].replace(/\.000Z$/, 'Z'), m[5]]);
  const srcPts = (s) => [...s.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"><ele>[-\d.]+<\/ele><time>([^<]+)<\/time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>(\d+)/g)].map((m) => [(+m[1]).toFixed(6), (+m[2]).toFixed(6), m[3], m[4]]);
  const a = srcPts(fs.readFileSync(path.join(DOCS, 'run.gpx'), 'utf8'));
  const b = fs.existsSync(out) ? pts(fs.readFileSync(out, 'utf8')) : [];
  check(ex.path === out && a.length === 25 && JSON.stringify(a) === JSON.stringify(b), `the exported GPX has the same ${b.length} points, times and heart rates as the imported one`);

  // ---------------------------------------------------------------- dark screenshots and settings
  // The phone is not yours any more: the timeline goes back to the trip's days.
  await k(() => window.keeper.tracks.setConfig({ self: [] }));
  await main.locator('.nav-item[title="Places & Tracks"]').first().click();
  await main.locator('.tk-tabs button', { hasText: 'Settings' }).click();
  await main.waitForSelector('.tk-settings', { timeout: 10000 });
  await shot('settings-light');
  await theme('dark');
  await main.locator('.tk-tabs button', { hasText: 'Settings' }).click();
  await main.waitForSelector('.tk-settings', { timeout: 10000 });
  await shot('settings-dark');
  await main.locator('.tk-tabs button', { hasText: 'Timeline' }).click();
  await main.waitForSelector('.tk-entry.stay', { timeout: 10000 });
  await shot('timeline-dark');
  await main.locator('.tk-tabs button', { hasText: 'Trips' }).click();
  await main.locator('.tk-trip-card').first().click();
  await main.waitForSelector('.tk-trip .tk-iday', { timeout: 10000 });
  await shot('trip-dark');
  await main.locator('.tk-tabs button', { hasText: 'Live' }).click();
  await main.waitForSelector('.tk-entry.live', { timeout: 10000 });
  await shot('live-dark');
  await main.locator('.tk-tabs button', { hasText: 'Sources' }).click();
  await main.waitForSelector('.tk-source', { timeout: 10000 });
  await shot('sources-dark');
  await theme('light');

  // ---------------------------------------------------------------- one switch deletes everything
  await k(() => window.keeper.tracks.wipe());
  const after = await k(() => window.keeper.tracks.overview());
  check(after.counts.tracks === 0 && after.counts.points === 0 && !after.receiver.running && !fs.existsSync(dataFile), 'Delete everything removes the data, stops the receiver and deletes the file');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
  tiles.close();
})().catch((e) => { console.error(e); process.exit(1); });
