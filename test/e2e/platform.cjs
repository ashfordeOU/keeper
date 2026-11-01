// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/platform.cjs /tmp/kp-platform /tmp/kp-platform-shots
// Drives the real Keeper app on a private D-Bus session: switches on GNOME and
// KDE search, then asks for results the way the desktop does (with gdbus),
// opens the assistant from a question, and copies the MCP setup.
const { _electron } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const HOME = process.argv[2];
const SHOTS = process.argv[3];
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Pictures', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
const DOC = path.join(HOME, 'Documents', 'Tax return 2025.txt');
fs.writeFileSync(DOC, 'Tax return 2025\nRefund due: 412 EUR\n');

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const gdbus = (...args) => {
  try {
    return execFileSync('gdbus', ['call', '--session', ...args], { env: process.env, encoding: 'utf8', timeout: 10_000 });
  } catch (e) {
    return 'ERROR ' + (e.stderr || e.message);
  }
};
const GNOME = ['--dest', 'org.ashfordeou.Keeper.SearchProvider', '--object-path', '/org/ashfordeou/Keeper/SearchProvider', '--method'];
const KDE = ['--dest', 'org.ashfordeou.Keeper.Runner', '--object-path', '/runner', '--method'];

(async () => {
  const daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { stdio: ['ignore', 'pipe', 'ignore'] });
  process.env.DBUS_SESSION_BUS_ADDRESS = await new Promise((r) => daemon.stdout.once('data', (d) => r(d.toString().trim())));
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', XDG_CURRENT_DESKTOP: 'GNOME' },
  });
  const errors = [];
  let main;
  for (let i = 0; i < 40 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1360, height: 900 }).catch(() => undefined);

  // Wait for the library to pick up the document.
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    const r = await main.evaluate(() => window.keeper.library.search('tax return', 5));
    found = r.hits.some((h) => h.file.name === 'Tax return 2025.txt');
    if (!found) await main.waitForTimeout(500);
  }
  check(found, 'the library has the test document');

  const list = await main.evaluate(() => window.keeper.platform.list(true));
  const byId = Object.fromEntries(list.map((i) => [i.id, i]));
  check(byId['gnome-search']?.available && byId.krunner?.available, 'GNOME and KDE search are offered (session bus found)');
  check(!byId['gnome-search']?.detail, 'on GNOME there is no "not on GNOME" note');
  check(['mcp', 'ask-shortcut', 'url-actions', 'desktop-actions'].every((id) => byId[id]), 'MCP, Ask Keeper, links and launcher actions are listed');

  const on = await main.evaluate(() => window.keeper.platform.set('gnome-search', true));
  check(!on.message, `switching on GNOME search worked${on.message ? ': ' + on.message : ''}`);
  const ini = path.join(HOME, '.local/share/gnome-shell/search-providers/keeper-search-provider.ini');
  const svc = path.join(HOME, '.local/share/dbus-1/services/org.ashfordeou.Keeper.SearchProvider.service');
  check(fs.existsSync(ini) && fs.readFileSync(ini, 'utf8').includes('DesktopId=keeper.desktop'), 'GNOME provider .ini installed');
  check(fs.existsSync(svc) && /Exec=.*--keeper-dbus/.test(fs.readFileSync(svc, 'utf8')), 'D-Bus activation file installed');

  const ids = gdbus(...GNOME, 'org.gnome.Shell.SearchProvider2.GetInitialResultSet', "['tax', 'return']");
  check(ids.includes(`f:${DOC}`), 'gdbus GetInitialResultSet returns the document: ' + ids.trim());
  const metas = gdbus(...GNOME, 'org.gnome.Shell.SearchProvider2.GetResultMetas', `['f:${DOC}']`);
  check(metas.includes("'name': <'Tax return 2025.txt'>") && metas.includes('~/Documents'), 'gdbus GetResultMetas describes it: ' + metas.trim());

  await main.evaluate(() => window.keeper.platform.set('krunner', true));
  const match = gdbus(...KDE, 'org.kde.krunner1.Match', 'tax return');
  check(match.includes(`f:${DOC}`) && match.includes('subtext'), 'gdbus KRunner Match returns the document');

  const off = await main.evaluate(() => window.keeper.platform.set('gnome-search', false));
  check(!fs.existsSync(ini) && !fs.existsSync(svc), 'switching off removes the GNOME files');
  check(gdbus(...GNOME, 'org.gnome.Shell.SearchProvider2.GetInitialResultSet', "['tax']").startsWith('ERROR'), 'and stops answering');
  check(off.list.find((i) => i.id === 'gnome-search').enabled === false, 'and the list shows it off');

  const mcp = await main.evaluate(() => window.keeper.platform.action('copy-mcp'));
  const cfg = JSON.parse(mcp.copy);
  check(cfg.mcpServers?.keeper?.args?.includes('mcp'), 'MCP setup snippet: ' + JSON.stringify(cfg.mcpServers.keeper));

  // A local model needs no key, so the assistant's question box is shown.
  await main.evaluate(() => window.keeper.settings.get().then((s) => window.keeper.settings.set({ brain: { ...s.brain, active: 'ollama' } })));
  await main.waitForTimeout(300);
  await main.evaluate(() => window.keeper.platform.ask('when does my passport expire?'));
  await main.waitForTimeout(1200);
  const asked = await main.evaluate(() => [...document.querySelectorAll('input, textarea')].map((e) => e.value).find((v) => v.includes('passport')));
  check(!!asked, 'Ask Keeper opens the assistant with the question filled in');

  await main.evaluate(() => window.keeper.platform.set('krunner', false));
  await main.evaluate(() => window.keeper.settings.get().then(() => undefined));
  // The Settings section, as people see it.
  await main.evaluate(() => window.dispatchEvent(new Event('focus')));
  const nav = main.locator('.sidebar [title="Settings"]').first();
  if (await nav.count()) await nav.click();
  await main.waitForTimeout(800);
  const section = main.locator('#platform');
  if (await section.count()) {
    await section.scrollIntoViewIfNeeded();
    await main.waitForTimeout(400);
    await main.screenshot({ path: path.join(SHOTS, 'settings-platform-linux.png') });
  }
  check(await section.count() > 0, 'Settings shows "Works with your computer"');

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));
  await app.close();
  daemon.kill();
})().catch((e) => { console.error(e); process.exitCode = 1; process.exit(); });
