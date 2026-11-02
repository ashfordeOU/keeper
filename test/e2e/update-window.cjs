// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI, after `npm run build`):
//   KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/update-window.cjs /tmp/upd-home /tmp/upd-shots
// Check for Updates end to end, against a fake release feed served from a local
// folder (KEEPER_UPDATE_FEED): the small Software Update window opens, checks at
// once and shows a newer version with its notes (as text, never HTML); it is a single
// window; it says "newest version" and explains an error with Try Again; the checkbox
// changes the update mode; Skip this version and Settings… work; About Keeper opens
// and its button opens the update window.
const { _electron } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const HOME = process.argv[2];
const SHOTS = process.argv[3];
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the fake feed: releases.json in the GitHub releases list format
const NOTES = '## What’s new in 99.0.0\n- **Faster** search across large libraries\n- A new *Software Update* window\n\nSee the [full changelog](https://github.com/ashfordeOU/keeper/blob/main/CHANGELOG.md).\n\n<script>window.__pwned = 1</script><img src="https://tracker.example/p.png" onerror="window.__pwned = 2">';
const release = (tag, body, prerelease = false) => ({ tag_name: tag, name: tag, body, html_url: `https://github.com/ashfordeOU/keeper/releases/tag/${tag}`, draft: false, prerelease, published_at: new Date(Date.now() - 86_400_000).toISOString(), assets: [] });
let feed = { status: 200, list: [release('v99.0.0', NOTES), release('v0.0.9', 'old')] };
const server = http.createServer((req, res) => {
  if (req.url === '/releases.json') {
    res.writeHead(feed.status, { 'content-type': 'application/json' });
    res.end(feed.status === 200 ? JSON.stringify(feed.list) : '{"message":"down"}');
  } else {
    res.writeHead(404);
    res.end();
  }
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const FEED = `http://127.0.0.1:${server.address().port}`;
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', KEEPER_UPDATE_FEED: FEED, KEEPER_SKIP_TOUR: '1' },
  });
  let main;
  for (let i = 0; i < 60 && !main; i++) { main = app.windows().find((w) => w.url().includes('view=app')); if (!main) await wait(500); }
  check(!!main, 'Keeper opens');
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  // Ask before installing, so a check by hand is all that runs.
  await main.evaluate(() => window.keeper.settings.set({ updateMode: 'ask' }));

  const find = async (view) => {
    let w;
    for (let i = 0; i < 40 && !w; i++) { w = app.windows().find((x) => x.url().includes(`view=${view}`)); if (!w) await wait(250); }
    return w;
  };
  const count = (view) => app.evaluate(({ BrowserWindow }, v) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().includes(`view=${v}`)).length, view);

  // ---- Check for Updates… (what the tray, app menu and palette do)
  await main.evaluate(() => window.keeper.appInfo.openUpdateWindow());
  const u = await find('update');
  check(!!u, 'Check for Updates opens the Software Update window');
  await u.waitForSelector('[data-testid="update-window"][data-state="available"]', { timeout: 20_000 });
  const title = await u.textContent('.upw-title');
  check(/^Keeper 99\.0\.0 is available — you have \d+\.\d+\.\d+/.test(title ?? ''), `it found the newer version: “${title}”`);
  const notes = await u.textContent('[data-testid="update-notes"]');
  check(/What’s new in 99\.0\.0/.test(notes) && /Faster search across large libraries/.test(notes) && /full changelog/.test(notes), 'the release notes show as formatted text');
  check(await u.$$eval('[data-testid="update-notes"] strong, [data-testid="update-notes"] em, [data-testid="update-notes"] li', (els) => els.length) >= 4, 'bold, italic and list items are kept');
  check(await u.$$eval('[data-testid="update-notes"] script, [data-testid="update-notes"] img', (els) => els.length) === 0 && !/script|pwned|<img/.test(notes), 'no HTML from the notes reaches the page');
  check(!(await u.evaluate(() => window.__pwned)), 'nothing in the notes ran');
  const buttons = await u.$$eval('.upw-foot .btn', (els) => els.map((e) => e.textContent));
  check(buttons.includes('Later') && (buttons.includes('Install and Relaunch') || buttons.includes('Download…')), `buttons: ${buttons.join(', ')}`);
  check(await u.isVisible('text=Skip this version') && await u.isVisible('text=Settings…') && await u.isVisible('text=Install updates automatically'), 'Skip this version, Settings… and the checkbox are there');
  const b = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=update')); return { ...w.getContentBounds(), resizable: w.isResizable(), title: w.getTitle() }; });
  check(b.width === 420 && b.height === 300 && !b.resizable, `420×300 and not resizable (${b.width}×${b.height})`);
  check(b.title === 'Software Update', `its title is “${b.title}”`);
  await u.screenshot({ path: path.join(SHOTS, 'update-available.png') });

  // ---- one window: asking again brings the same one forward
  await main.evaluate(() => window.keeper.appInfo.openUpdateWindow());
  await wait(800);
  check(await count('update') === 1, 'a second Check for Updates focuses the same window');

  // ---- the checkbox is the update mode
  await u.click('.upw-auto input');
  await wait(400);
  check((await main.evaluate(() => window.keeper.settings.get())).updateMode === 'auto', 'ticking “Install updates automatically” sets automatic updates');
  await u.click('.upw-auto input');
  await wait(400);
  check((await main.evaluate(() => window.keeper.settings.get())).updateMode === 'ask', 'unticking it goes back to asking first');

  // ---- up to date
  feed = { status: 200, list: [release('v0.0.9', 'old')] };
  await u.evaluate(() => window.keeper.appInfo.checkForUpdates());
  await u.waitForSelector('[data-state="current"]', { timeout: 15_000 });
  const cur = await u.textContent('.upw-title');
  const det = await u.textContent('.upw-detail');
  check(/^Keeper \S+ is the newest version$/.test(cur ?? ''), `up to date: “${cur}”`);
  check(/^(Beta|Stable) channel · Last checked just now$/.test(det ?? ''), `with the channel and when: “${det}”`);
  await u.screenshot({ path: path.join(SHOTS, 'update-current.png') });

  // ---- an error, then Try Again
  feed = { status: 502, list: [] };
  await u.evaluate(() => window.keeper.appInfo.checkForUpdates());
  await u.waitForSelector('[data-state="error"]', { timeout: 15_000 });
  check(await u.isVisible('text=Try Again') && await u.isVisible('text=Open the releases page'), `an error says so: “${await u.textContent('.upw-detail')}”`);
  await u.screenshot({ path: path.join(SHOTS, 'update-error.png') });
  feed = { status: 200, list: [release('v99.0.0', NOTES)] };
  await u.click('text=Try Again');
  await u.waitForSelector('[data-state="available"]', { timeout: 15_000 });
  check(true, 'Try Again checks again');

  // ---- Skip this version
  await u.click('text=Skip this version');
  for (let i = 0; i < 20 && (await count('update')); i++) await wait(200);
  check(await count('update') === 0, 'Skip this version closes the window');
  check((await main.evaluate(() => window.keeper.settings.get())).updateSkip === '99.0.0', 'and remembers the version');

  // ---- Settings… opens the full page
  await main.evaluate(() => window.keeper.appInfo.openUpdateWindow(false));
  const u2 = await find('update');
  await u2.waitForSelector('[data-testid="update-window"]');
  await u2.click('text=Settings…');
  for (let i = 0; i < 20 && (await count('update')); i++) await wait(200);
  check(await count('update') === 0, 'Settings… closes the small window');
  await main.waitForSelector('.update-modes', { timeout: 10_000 }).then(() => check(true, 'and shows Settings → Updates'), () => check(false, 'and shows Settings → Updates'));

  // ---- About Keeper
  await main.evaluate(() => window.keeper.appInfo.openAbout());
  const a = await find('about');
  check(!!a, 'About Keeper opens');
  await a.waitForSelector('text=Electron', { timeout: 10_000 });
  const about = await a.textContent('[data-testid="about-window"]');
  check(/Keeper by Ashforde®/.test(about) && /Version \d+\.\d+\.\d+/.test(about) && /(Beta|Stable)/.test(about), 'name, version and channel');
  check(/Electron \d+/.test(about) && /Chrome \d+/.test(about) && /Node \d+/.test(about), 'Electron, Chrome and Node versions');
  check(/PolyForm Shield License 1\.0\.0/.test(about) && /Ashforde® is a registered trademark of Ashforde OÜ/.test(about) && /© \d{4} Ashforde OÜ/.test(about), 'licence, copyright and trademark lines');
  await a.screenshot({ path: path.join(SHOTS, 'about.png') });
  await main.evaluate(() => window.keeper.appInfo.openAbout());
  await wait(600);
  check(await count('about') === 1, 'a second About focuses the same window');
  await a.click('text=Check for Updates…');
  const u3 = await find('update');
  check(!!u3, 'its Check for Updates… opens the update window');
  // A check by hand shows a skipped version all the same.
  await u3.waitForSelector('[data-state="available"]', { timeout: 15_000 }).then(() => check(true, 'a check by hand still shows the skipped version'), () => check(false, 'a check by hand still shows the skipped version'));

  // ---- dark
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await wait(800);
  await u3.screenshot({ path: path.join(SHOTS, 'update-dark.png') });
  const bg = await u3.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(/rgb\((\d+), (\d+), (\d+)\)/.test(bg) && Number(bg.match(/\d+/)[0]) < 80, `follows the dark theme (${bg})`);
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'light', updateSkip: '' }));

  await app.close();
  server.close();
  process.exit(process.exitCode ?? 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
