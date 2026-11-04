// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/sound.cjs /tmp/ksnd-home /tmp/ksnd-shots
// Drives the real Keeper app's Health → Sound & tabs against a stand-in pactl:
// Sound for each app is off until switched on (no listener running); switched
// on from the page; an app moved to the headphones and turned down; both kept
// for that app; the app starting a new stream later gets the same volume and
// output by itself (the sound server's own event, no polling); Forget lets it
// go. Light and dark at 1440×900, and 1024×768.

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
  const second = path.join(HOME, 'second-stream');
  fs.writeFileSync(path.join(bin, 'pactl'), `#!/bin/sh
echo "pactl $*" >> '${log}'
case "$1 $2" in
  "list sink-inputs")
    printf 'Sink Input #41\\n\\tSink: 47\\n\\tMute: no\\n\\tVolume: front-left: 52428 /  80%% / -5.81 dB\\n\\tProperties:\\n\\t\\tapplication.name = "Music Player"\\n\\t\\tapplication.process.id = "4242"\\n'
    [ -f '${second}' ] && printf 'Sink Input #42\\n\\tSink: 47\\n\\tMute: no\\n\\tVolume: front-left: 65536 / 100%% / 0.00 dB\\n\\tProperties:\\n\\t\\tapplication.name = "Music Player"\\n\\t\\tapplication.process.id = "4343"\\n'
    ;;
  "list short") printf '47\\talsa_output.analog\\tPipeWire\\n52\\tbluez_output.AA\\tPipeWire\\n' ;;
  "list sinks") printf 'Sink #47\\n\\tName: alsa_output.analog\\n\\tDescription: Built-in Audio\\nSink #52\\n\\tName: bluez_output.AA\\n\\tDescription: Studio Headphones\\n' ;;
  "get-default-sink ") echo alsa_output.analog ;;
  "subscribe ") while [ ! -f '${second}' ]; do sleep 0.3; done; echo "Event 'change' on sink #47"; echo "Event 'new' on sink-input #42"; while true; do sleep 1; done ;;
esac
exit 0
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
  const tidySidebar = () => main.evaluate(() => { for (const el of document.querySelectorAll('.sidebar *')) if (el.children.length === 0 && /^(vm|claude-code|env-runner|public|examples|Claude Code)$/.test((el.textContent || '').trim())) { const row = el.closest('a, button, li, [role="treeitem"]'); if (row) row.style.display = 'none'; } });
  const shot = async (name) => { await wait(800); await tidySidebar(); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const dark = (on) => main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), on);
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
  const rulesFile = path.join(HOME, '.config', 'Keeper', 'sound-rules.json');
  const row = () => main.locator('.mon-mix-row', { hasText: 'Music Player' }).first();

  // Other parts (microphone and volume watchers) keep listeners of their own; Sound for each app adds exactly one while on.
  const listeners = () => { try { return require('child_process').execSync(`pgrep -f '${bin}/pactl subscribe' || true`).toString().trim().split('\n').filter(Boolean).length; } catch { return 0; } };
  check((await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'soundPerApp')?.on === false, 'Sound for each app is off until switched on');
  await wait(3000);
  const before = listeners();

  await navigate('health:apps');
  await main.locator('.health-tabs button:has-text("Sound & tabs")').first().click({ timeout: 15000 }).catch(() => undefined);
  await main.waitForSelector('.mon-mix-row', { timeout: 20000 });
  check(/Studio Headphones/.test(await row().locator('[data-testid="mix-out"]').innerText()), 'each app has its own output choice (Linux)');

  // Switched on from the page.
  await main.locator('[aria-label="Keep each app’s sound"]').click();
  check(!!(await until(async () => (await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'soundPerApp')?.on, 10000)), 'the page’s switch turns it on');
  check(!!(await until(() => listeners() === before + 1, 10000)), `one listener for apps that start playing (${before} → ${listeners()})`);

  // Move the app to the headphones and turn it down.
  await row().locator('[data-testid="mix-out"]').selectOption('bluez_output.AA');
  check(!!(await until(() => calls().includes('pactl move-sink-input 41 bluez_output.AA'), 10000)), 'the app moves to the headphones');
  await main.evaluate(() => window.keeper.sysmon.setStream('41', { volume: 35 }));
  check(calls().includes('pactl set-sink-input-volume 41 35%'), 'and is turned down to 35%');
  const kept = await until(() => (fs.existsSync(rulesFile) ? JSON.parse(fs.readFileSync(rulesFile, 'utf8')) : null), 10000);
  check(!!kept && kept['music player']?.volume === 35 && kept['music player']?.output === 'bluez_output.AA', `both are kept for Music Player (${JSON.stringify(kept)})`);
  check(!!(await until(async () => (await row().locator('[data-testid="mix-forget"]').count()) === 1, 10000)), 'the row offers Forget');
  await shot('sound-light');
  await dark(true); await shot('sound-dark'); await dark(false);
  await main.setViewportSize({ width: 1024, height: 768 }).catch(() => undefined);
  await shot('sound-1024-light');
  check(!(await main.evaluate(() => [...document.querySelectorAll('.mon-mix-row')].some((r) => r.scrollWidth > r.clientWidth + 1))), 'the row fits at 1024×768');
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);

  // The app starts a second stream: Keeper hears it and sets it the same way.
  fs.writeFileSync(second, '1');
  check(!!(await until(() => calls().includes('pactl set-sink-input-volume 42 35%'), 15000)), 'a new stream of the same app gets 35% by itself');
  check(!!(await until(() => calls().includes('pactl move-sink-input 42 bluez_output.AA'), 15000)), 'and plays to the headphones');
  check(!calls().includes('pactl set-sink-input-volume 41 100%'), 'the stream already set is left alone');

  // Forget.
  await row().locator('[data-testid="mix-forget"]').click();
  check(!!(await until(() => { const r = JSON.parse(fs.readFileSync(rulesFile, 'utf8')); return !r['music player']; }, 10000)), 'Forget lets the app go');

  // Off: the listener stops.
  await main.evaluate(() => window.keeper.features.set('soundPerApp', false));
  check(!!(await until(() => listeners() === before, 10000)), 'switched off, its listener stops');

  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join('; ')})`);
  await app.close();
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
