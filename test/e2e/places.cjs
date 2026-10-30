// SPDX-License-Identifier: AGPL-3.0-or-later
// Usage (Linux CI): xvfb-run -a node test/e2e/places.cjs /tmp/kp /tmp/kp-shots
// Drives the real Keeper app with a made-up home folder: a Dropbox folder, a
// deleted file in the freedesktop Trash. Checks Places, the sidebar and Put Back.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const HOME = process.argv[2];
const SHOTS = process.argv[3];
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Pictures', 'Music', 'Videos', 'Desktop', 'Dropbox/Shared', '.local/share/Trash/files', '.local/share/Trash/info']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.writeFileSync(path.join(HOME, '.local/share/Trash/files/report.txt'), 'quarterly numbers\n');
fs.writeFileSync(path.join(HOME, '.local/share/Trash/info/report.txt.trashinfo'), `[Trash Info]\nPath=${encodeURI(path.join(HOME, 'Documents/report.txt'))}\nDeletionDate=2026-10-29T10:15:00\n`);

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };

(async () => {
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 40 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForTimeout(2500);

  const places = await main.evaluate(() => window.keeper.places.list());
  check(places.cloud.some((p) => p.name === 'Dropbox' && p.path.endsWith('/Dropbox')), 'places.list finds ~/Dropbox as a cloud drive');
  check(['Documents', 'Downloads', 'Pictures', 'Music'].every((n) => places.favorites.some((p) => p.name === n)), 'Favorites list the standard folders');
  check(places.volumes.length > 0 && places.volumes.every((v) => typeof v.path === 'string'), `Locations list ${places.volumes.length} volume(s)`);

  const trash = await main.evaluate(() => window.keeper.places.trash.list());
  const item = trash.items.find((i) => i.name === 'report.txt');
  check(!!item && item.original === path.join(HOME, 'Documents/report.txt'), 'trash.list shows report.txt with its original location');
  check(!!item?.deletedAt, 'trash.list reads the deletion date');

  const sidebar = await main.locator('.sidebar, nav').first().innerText();
  check(/Favorites/i.test(sidebar) && /Locations/i.test(sidebar) && /Trash/.test(sidebar) && /Dropbox/.test(sidebar), 'sidebar renders Favorites, Locations, Dropbox and Trash');
  await main.screenshot({ path: `${SHOTS}/sidebar.png` });

  await main.getByRole('button', { name: 'Trash', exact: true }).click();
  await main.waitForSelector('.trash-row >> text=report.txt', { timeout: 10000 });
  await main.screenshot({ path: `${SHOTS}/trash.png` });
  await main.locator('.trash-row', { hasText: 'report.txt' }).locator('button[title="Put back"]').click();
  await main.waitForTimeout(1500);
  check(fs.existsSync(path.join(HOME, 'Documents/report.txt')), 'Put Back moves report.txt to ~/Documents');
  check(!fs.existsSync(path.join(HOME, '.local/share/Trash/info/report.txt.trashinfo')), 'Put Back removes the .trashinfo');

  await main.getByRole('button', { name: 'Network', exact: true }).click();
  await main.waitForSelector('text=Connect to Server…', { timeout: 10000 });
  await main.waitForTimeout(2500);
  await main.screenshot({ path: `${SHOTS}/network.png` });

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
