// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/displays.cjs /tmp/kdp-home /tmp/kdp-shots
// Drives the real Keeper app's Displays page against stand-in xrandr and
// ddcutil programs and a stand-in backlight (KEEPER_BACKLIGHT_DIR): off until
// switched on; both screens listed with their modes; a new size switches back
// by itself when Keep is not pressed, and stays when it is; a preset saved,
// changed away from and used again; a monitor following the built-in screen's
// brightness with its own offset, written only when it should move. Light and
// dark at 1440×900, and 1024×768.

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
  const modeFile = path.join(HOME, 'hdmi-mode');
  fs.writeFileSync(modeFile, '3840x2160');
  // xrandr: the built-in panel and a 4K monitor; the monitor's current mode is kept in a file so a change shows on the next look.
  fs.writeFileSync(path.join(bin, 'xrandr'), `#!/bin/sh
echo "xrandr $*" >> '${log}'
if [ "$1" = "--output" ]; then echo "$4" > '${modeFile}'; exit 0; fi
cur=$(cat '${modeFile}')
star() { [ "$cur" = "$1" ] && echo '*' || echo ''; }
echo "Screen 0: minimum 8 x 8, current 5760 x 2160, maximum 32767 x 32767"
echo "eDP-1 connected primary 1920x1200+0+0 (normal left inverted right x axis y axis) 302mm x 189mm"
echo "   1920x1200     60.00*+  48.00"
echo "   1280x800      60.00"
echo "HDMI-1 connected 3840x2160+1920+0 (normal left inverted right x axis y axis) 600mm x 340mm"
echo "   3840x2160     60.00$(star 3840x2160)+  30.00"
echo "   2560x1440     59.95$(star 2560x1440)"
echo "   1920x1080     60.00$(star 1920x1080)"
echo "DP-1 disconnected (normal left inverted right x axis y axis)"
`, { mode: 0o755 });
  const level = path.join(HOME, 'ddc-level');
  fs.writeFileSync(level, '50');
  fs.writeFileSync(path.join(bin, 'ddcutil'), `#!/bin/sh
echo "ddcutil $*" >> '${log}'
case "$*" in
  "detect --brief") printf 'Display 1\\n   I2C bus:  /dev/i2c-5\\n   Monitor:             DEL:Example 27 4K:ABC123\\n' ;;
  *"getvcp 10 --brief") echo "VCP 10 C $(cat '${level}') 100" ;;
  *"getvcp 12 --brief") echo "VCP 12 C 75 100" ;;
  *"getvcp 62 --brief") echo "VCP 62 C 20 100" ;;
  *"setvcp 10 "*) echo "$5" > '${level}' ;;
esac
`, { mode: 0o755 });
  const bl = path.join(HOME, 'backlight', 'intel_backlight');
  fs.mkdirSync(bl, { recursive: true });
  fs.writeFileSync(path.join(bl, 'max_brightness'), '96000\n');
  fs.writeFileSync(path.join(bl, 'brightness'), '57600\n');

  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, KEEPER_BACKLIGHT_DIR: path.join(HOME, 'backlight'), XDG_SESSION_TYPE: 'x11', KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const tidySidebar = () => main.evaluate(() => { for (const el of document.querySelectorAll('.sidebar *')) if (el.children.length === 0 && /^(vm|claude-code|env-runner|public|examples|Claude Code)$/.test((el.textContent || '').trim())) { const row = el.closest('a, button, li, [role="treeitem"]'); if (row) row.style.display = 'none'; } });
  const shot = async (name) => { await wait(800); await tidySidebar(); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const dark = (on) => main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), on);
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
  const hdmi = () => main.locator('[data-testid="dp-screen"]', { hasText: 'HDMI 1' });

  const feats = await main.evaluate(() => window.keeper.features.list());
  check(feats.find((f) => f.id === 'displayModes')?.on === false && feats.find((f) => f.id === 'brightnessSync')?.on === false, 'Screen modes and matched brightness are off until switched on');
  // (Other parts may read a monitor's level, such as the brightness keys; nothing may change one.)
  check(!/xrandr --output|setvcp/.test(calls()), 'no screen or monitor is changed while they are off');

  await main.evaluate(() => window.keeper.features.set('displayModes', true));
  await navigate('displays');
  await main.waitForSelector('[data-testid="dp-screen"]', { timeout: 20000 });
  const screens = await main.locator('[data-testid="dp-screen"]').allInnerTexts();
  check(screens.length === 2 && /Built-in screen/.test(screens.join()) && /HDMI 1/.test(screens.join()), `both connected screens are listed (${screens.map((s) => s.split('\n')[1]).join(', ')})`);
  check(/3840 × 2160 · 60 Hz/.test(await hdmi().locator('[data-testid="dp-current"]').innerText()), 'the monitor shows its size and refresh rate');
  await shot('displays-light');
  await dark(true); await shot('displays-dark'); await dark(false);

  // A new size switches back by itself without Keep.
  await hdmi().locator('[data-testid="dp-size"]').selectOption('2560x1440');
  check(!!(await until(() => calls().includes('xrandr --output HDMI-1 --mode 2560x1440 --rate 59.95'), 10000)), 'choosing a size switches the monitor');
  await main.waitForSelector('[data-testid="dp-keep"]', { timeout: 10000 });
  check(/Switching back in \d+ s/.test(await main.locator('[data-testid="dp-keep"]').innerText()), 'a calm Keep this? bar counts down');
  await shot('displays-keep-light');
  check(!!(await until(() => calls().includes('xrandr --output HDMI-1 --mode 3840x2160 --rate 60'), 25000)), 'without Keep it switches back by itself');
  check(!!(await until(async () => (await main.locator('[data-testid="dp-keep"]').count()) === 0, 5000)), 'and the bar goes');

  // With Keep it stays.
  await hdmi().locator('[data-testid="dp-size"]').selectOption('1920x1080');
  await main.locator('[data-testid="dp-keep-btn"]').click({ timeout: 10000 });
  await wait(17000);
  check(fs.readFileSync(modeFile, 'utf8').trim() === '1920x1080', 'with Keep the new size stays');

  // A preset: save, change away, use again.
  await main.locator('[data-testid="dp-save"]').click();
  await main.locator('[data-testid="dp-name"]').fill('Desk');
  await main.locator('[data-testid="dp-name-save"]').click();
  check(!!(await until(async () => /Desk/.test(await main.locator('[data-testid="dp-presets"]').innerText()), 8000)), 'a preset is saved for these screens');
  await hdmi().locator('[data-testid="dp-size"]').selectOption('3840x2160');
  await main.locator('[data-testid="dp-keep-btn"]').click({ timeout: 10000 });
  await main.locator('[data-testid="dp-use"]').first().click();
  check(!!(await until(() => fs.readFileSync(modeFile, 'utf8').trim() === '1920x1080', 10000)), 'Use puts the preset back');
  await main.locator('[data-testid="dp-keep-btn"]').click({ timeout: 10000 });

  // Matched brightness: the monitor follows the built-in screen (60%), 10 dimmer.
  await main.locator('[data-testid="dp-sync-on"]').click();
  check(!!(await until(() => /setvcp 10 60/.test(calls()), 20000)), 'the monitor follows the built-in screen’s 60%');
  await main.waitForSelector('[data-testid="dp-monitors"]', { timeout: 20000 });
  check(/Built-in screen at 60%/.test(await main.locator('[data-testid="dp-builtin"]').innerText()), 'the page says the built-in level');
  await main.evaluate(() => window.keeper.displays.setBrightness({ offsets: { 'ddcutil:1': -10 } }));
  check(!!(await until(() => fs.readFileSync(level, 'utf8').trim() === '50', 20000)), 'a monitor set 10 dimmer follows at 50%');
  const writes = () => (calls().match(/setvcp 10 /g) || []).length;
  const n = writes();
  await wait(9000);
  check(writes() === n, 'nothing is written while the level stays the same');
  fs.writeFileSync(path.join(bl, 'brightness'), '86400\n');
  check(!!(await until(() => fs.readFileSync(level, 'utf8').trim() === '80', 20000)), 'the built-in screen going to 90% takes the monitor to 80%');
  await shot('displays-brightness-light');
  await main.setViewportSize({ width: 1024, height: 768 }).catch(() => undefined);
  await shot('displays-1024-light');
  check(!(await main.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'nothing runs off the side at 1024×768');
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);

  // Off: no more writes.
  await main.evaluate(() => window.keeper.features.set('brightnessSync', false));
  const m = writes();
  fs.writeFileSync(path.join(bl, 'brightness'), '19200\n');
  await wait(9000);
  check(writes() === m, 'switched off, the monitor is left alone');

  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join('; ')})`);
  await app.close();
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
