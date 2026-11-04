// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/app-updates.cjs /tmp/kau-home /tmp/kau-shots
// Drives the real Keeper app's App updates against stand-in flatpak, snap and
// apt programs on PATH: off until switched on (no Updates tab, nothing stored),
// the first look when the tab opens, a Flatpak and a Snap update listed with
// system packages counted (2 for security), one calm row on the Fix-it List,
// Update running `flatpak update` and the row going away, Check now looking
// again. Light and dark at 1440×900, and 1024×768.

const { _electron } = require('playwright');
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

(async () => {
  const bin = path.join(HOME, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const log = path.join(HOME, 'fake-calls.log');
  const state = path.join(HOME, 'paint-updated');
  fs.writeFileSync(path.join(bin, 'flatpak'), `#!/bin/sh
echo "flatpak $*" >> '${log}'
case "$1" in
  list) if echo "$*" | grep -q 'name'; then printf 'org.example.Paint\\tPaint\\t2.1\\t12 MB\\n'; else printf 'org.example.Paint\\t2.1\\norg.example.Notes\\t5.0\\n'; fi ;;
  remote-ls) [ -f '${state}' ] || printf 'org.example.Paint\\t2.2\\tPaint\\n' ;;
  update) touch '${state}'; echo done ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'snap'), `#!/bin/sh
echo "snap $*" >> '${log}'
case "$1" in
  refresh) printf 'Name      Version  Rev   Size   Publisher  Notes\\nmapviewer 4.0      310   80MB   example    -\\n' ;;
  list) printf 'Name Version Rev Tracking Publisher Notes\\nmapviewer 3.9 300 latest/stable example -\\n' ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'apt'), `#!/bin/sh
echo "apt $*" >> '${log}'
printf 'Listing... Done\\nlibexample1/stable-security 1.2 amd64 [upgradable from: 1.1]\\nopenssl/stable-security 3.0.13 amd64 [upgradable from: 3.0.11]\\nfonts-example/stable 2 all [upgradable from: 1]\\n'
`, { mode: 0o755 });

  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  // Pictures show demo data only: this computer's own drive names are left out of the sidebar.
  const tidySidebar = () => main.evaluate(() => { for (const el of document.querySelectorAll('.sidebar *')) if (el.children.length === 0 && /^(vm|claude-code|env-runner|public|examples|Claude Code)$/.test((el.textContent || '').trim())) { const row = el.closest('a, button, li, [role="treeitem"]'); if (row) row.style.display = 'none'; } });
  const shot = async (name) => { await wait(800); await tidySidebar(); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const dark = (on) => main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), on);
  const au = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.appUpdates[f](...args), [fn, a]);

  check((await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'appUpdates')?.on === false, 'App updates is off until switched on');
  await navigate('apps');
  await main.waitForSelector('[data-testid="hub-tab-apps"]', { timeout: 15000 });
  await wait(1500);
  check(await main.locator('[data-testid="apps-updates-tab"]').count() === 0, 'no Updates tab while it is off');
  check(!fs.existsSync(path.join(HOME, '.config', 'Keeper', 'app-updates.json')), 'nothing is stored while it is off');
  check(!fs.existsSync(log) || !/remote-ls|refresh --list|upgradable/.test(fs.readFileSync(log, 'utf8')), 'no package manager is asked while it is off');

  await main.evaluate(() => window.keeper.features.set('appUpdates', true));
  await navigate('apps:updates');
  await main.waitForSelector('[data-testid="app-updates"]', { timeout: 20000 });
  const rows = await until(async () => (await main.locator('[data-testid="au-row"]').count()) >= 2 ? main.locator('[data-testid="au-list"]').innerText() : null, 30000);
  check(!!rows && /Paint/.test(rows) && /2\.1 → 2\.2/.test(rows) && /Flatpak/.test(rows), `the Flatpak update is listed with its versions (${(rows || '').replace(/\n/g, ' | ').slice(0, 160)})`);
  check(!!rows && /mapviewer/.test(rows) && /3\.9 → 4\.0/.test(rows) && /Snap/.test(rows), 'the Snap update is listed with its versions');
  const sys = await main.locator('[data-testid="au-system"]').innerText().catch(() => '');
  check(/3 updates, 2 for security/.test(sys), `system packages are counted, not listed one by one (${sys.replace(/\n/g, ' ')})`);
  check(/Signatures checked first/.test(await main.locator('[data-testid="au-summary"]').innerText()), 'the trust line says signatures are checked first');
  check(/Updates\s*3/.test(await main.locator('[data-testid="apps-updates-tab"]').innerText()), 'the Updates tab counts what is waiting');
  check(fs.existsSync(path.join(HOME, '.config', 'Keeper', 'app-updates.json')), 'the answer is kept for the next start');

  await main.evaluate(() => window.keeper.guide.refresh());
  const fix = await until(async () => (await main.evaluate(() => window.keeper.guide.list())).findings.find((f) => f.id === 'updates:apps'), 15000);
  check(!!fix && /security updates|system updates|apps have updates/.test(fix.title), `one calm row on the Fix-it List (${fix && fix.title})`);
  check(!!fix && fix.fix.kind === 'page' && fix.fix.route.name === 'apps', 'its fix opens Applications → Updates');

  await shot('app-updates-light');
  await dark(true); await shot('app-updates-dark'); await dark(false);
  await main.setViewportSize({ width: 1024, height: 768 }).catch(() => undefined);
  await shot('app-updates-1024-light');
  const overflow = await main.evaluate(() => [...document.querySelectorAll('.au-row')].some((r) => r.scrollWidth > r.clientWidth + 1));
  check(!overflow, 'rows fit at 1024×768');
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);

  // Update the Flatpak app: the package manager runs, and the row goes.
  const paint = main.locator('[data-testid="au-row"]', { hasText: 'Paint' });
  await paint.locator('[data-testid="au-update"]').click();
  check(!!(await until(() => fs.readFileSync(log, 'utf8').includes('flatpak update -y --noninteractive org.example.Paint'), 20000)), 'Update runs the package manager for that one app');
  check(!!(await until(async () => (await main.locator('[data-testid="au-row"]', { hasText: 'Paint' }).count()) === 0, 15000)), 'the updated app leaves the list');

  // Check now looks again; the package manager no longer offers it.
  await main.locator('[data-testid="au-check"]').click();
  const after = await until(async () => { const s = await au('state'); return !s.checking && s.checkedAt ? s : null; }, 30000);
  check(!!after && !after.updates.some((u) => u.id === 'flatpak:org.example.Paint') && after.updates.some((u) => u.id === 'snap:mapviewer'), 'Check now looks again and lists only what is still waiting');

  // Switched off: the tab goes.
  await main.evaluate(() => window.keeper.features.set('appUpdates', false));
  await navigate('apps');
  check(!!(await until(async () => (await main.locator('[data-testid="apps-updates-tab"]').count()) === 0, 10000)), 'switched off, the Updates tab goes away');

  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join('; ')})`);
  await app.close();
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
