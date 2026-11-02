// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/awake.cjs /tmp/kaw /tmp/kaw-shots
// Drives the real Keeper app's Keep Awake: turning it on holds the computer
// awake (the Electron power hold, plus systemd-inhibit where the system bus
// allows it), the Island shows the time left, a timed session ends by itself,
// a trigger on a running app starts and ends a session, and switching the
// feature off in Settings → Features removes its page, its Island controls,
// its holds and its checks. Screenshots in light and dark.
const { _electron } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const HOME = path.resolve(process.argv[2] || '/tmp/kaw');
const SHOTS = path.resolve(process.argv[3] || '/tmp/kaw-shots');
const APP = path.resolve(__dirname, '../..');
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10_000, step = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await wait(step);
  }
}
const hasInhibit = (() => { try { execFileSync('systemd-inhibit', ['--list', '--no-pager'], { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; } })();
const inhibitors = () => { try { return execFileSync('systemd-inhibit', ['--list', '--no-pager', '--no-legend'], { encoding: 'utf8', timeout: 5000 }); } catch { return ''; } };

(async () => {
  const env = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' };
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  const errors = [];
  let main;
  let isl;
  for (let i = 0; i < 80 && !(main && isl); i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    isl = app.windows().find((w) => w.url().includes('view=island'));
    if (!(main && isl)) await wait(500);
  }
  check(!!main, 'Keeper opens');
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await main.getByRole('button', { name: /Skip tour/ }).click({ timeout: 3000 }).catch(() => undefined);
  await main.setViewportSize?.({ width: 1360, height: 900 }).catch(() => undefined);
  const aw = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.awake[f](...args), [fn, a]);
  const checks = () => main.evaluate(() => window.keeper.usage.get().then((u) => u.checks.filter((c) => c.name === 'awake.check' && c.everyMs !== null).length));

  // ---- idle: nothing runs
  let st = await aw('status');
  check(!st.on && st.holds.length === 0 && !st.checking, 'off by default: no hold, no regular check');
  check(await checks() === 0, 'no keep-awake check is scheduled while nothing needs one');

  // ---- the page, and the switch
  await main.click('.sidebar [title="Keep Awake"]').catch(() => main.locator('.sidebar >> text=Keep Awake').first().click());
  await main.waitForSelector('[data-testid="awake-hero"]');
  await main.screenshot({ path: path.join(SHOTS, 'awake-off-light.png') });
  await main.click('[data-testid="awake-toggle"]');
  st = await until(async () => { const s = await aw('status'); return s.on ? s : null; });
  check(!!st?.on, 'clicking the cup turns Keep Awake on');
  check(st?.holds.some((h) => h.startsWith('powerSaveBlocker (prevent-display-sleep)')), `Electron's power hold is in place (${st?.holds.join(', ')})`);
  if (hasInhibit) {
    const list = await until(async () => (/Keeper/.test(inhibitors()) ? inhibitors() : null), 5000);
    check(!!list, 'systemd-inhibit lists Keeper as holding sleep');
  } else console.log(`INFO systemd-inhibit cannot reach a system bus here; checked Electron's hold instead (holds: ${st?.holds.join(', ')})`);
  check(await main.locator('.awake-hero.on').count() === 1, 'the page shows it is on');
  const b = await aw('blockers');
  check(b && typeof b.source === 'string', `"What keeps this computer awake" answers from ${b?.source}${b?.error ? ` (${b.error})` : ''}: ${b?.list.map((x) => x.who).join(', ') || 'none'}`);
  await wait(500);
  await main.screenshot({ path: path.join(SHOTS, 'awake-on-light.png') });
  await main.click('[data-testid="awake-stop"]');
  st = await until(async () => { const s = await aw('status'); return !s.on ? s : null; });
  check(!!st && st.holds.length === 0, 'turning it off releases every hold');
  if (hasInhibit) check(!/Keeper/.test(inhibitors()), 'systemd-inhibit no longer lists Keeper');

  // ---- a timed session: the Island shows the time left, and it ends by itself
  st = await aw('start', { until: Date.now() + 12_000 });
  check(st.on && st.session.endsAt > Date.now(), 'a 12-second session starts');
  const islState = () => isl.evaluate(() => window.keeper.island.state());
  const is = await until(async () => { const s = await islState(); return s.keepAwake.on && s.keepAwake.until ? s : null; }, 5000);
  check(!!is && Math.abs(is.keepAwake.until - st.session.endsAt) < 1000, 'the Island knows when the session ends');
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('view=island')) w.webContents.send('event:island-open', 'home'); });
  const live = await until(async () => { const t = await isl.locator('body').innerText(); return /Staying awake|Awake/.test(t) && /\b0:\d\d\b/.test(t) ? t : null; }, 6000);
  if (!live) console.log('INFO Island text:', JSON.stringify((await isl.locator('body').innerText()).slice(0, 600)));
  check(!!live, `the Island shows that it is awake, with the time left (${(live || '').match(/\b0:\d\d\b/)?.[0] ?? 'not found'})`);
  await isl.screenshot({ path: path.join(SHOTS, 'awake-island.png') }).catch(() => undefined);
  const remaining = await main.locator('[data-testid="awake-remaining"]').innerText().catch(() => '');
  check(/^0:\d\d$/.test(remaining), `the page counts down (${remaining})`);
  st = await until(async () => { const s = await aw('status'); return !s.on ? s : null; }, 25_000, 500);
  check(!!st, 'the session ends by itself when its time is up');
  const stats = await aw('stats');
  check(stats.recent.some((r) => r.why === 'Time is up'), 'statistics record why it ended (Time is up)');

  // ---- a trigger: while a (pretend) app runs
  const fake = path.join(HOME, 'kawfakeapp');
  fs.copyFileSync('/bin/sleep', fake);
  fs.chmodSync(fake, 0o755);
  const proc = spawn(fake, ['300'], { stdio: 'ignore' });
  await wait(300);
  const rule = { id: 'e2e-app', name: 'While the test app runs', enabled: true, match: 'all', conditions: [{ kind: 'app', value: 'kawfakeapp' }], priority: 0, reactivateAfterMin: 0, options: { display: 'allow-sleep' } };
  const test = await aw('testTrigger', rule);
  check(test.matches, '"Would it match now?" says yes while the app runs');
  await aw('saveTrigger', rule);
  st = await until(async () => { const s = await aw('status'); return s.on && s.session.source === 'trigger' ? s : null; }, 15_000);
  check(!!st && st.session.triggerId === 'e2e-app', 'the trigger starts a session by itself');
  check(st?.holds.some((h) => h.includes('prevent-app-suspension')), 'the trigger\'s options apply (the screen may sleep)');
  check(st?.checking && await checks() === 1, 'one regular check runs while a session or trigger needs it');
  await main.reload();
  await main.waitForSelector('[data-testid="awake-triggers"]');
  await wait(500);
  await main.locator('[data-testid="awake-triggers"]').scrollIntoViewIfNeeded();
  await main.screenshot({ path: path.join(SHOTS, 'awake-trigger-light.png') });
  await main.locator('[data-testid="awake-blockers"]').scrollIntoViewIfNeeded();
  await main.screenshot({ path: path.join(SHOTS, 'awake-blockers-stats-light.png') });
  proc.kill();
  st = await until(async () => { const s = await aw('status'); return !s.on ? s : null; }, 45_000, 1000);
  check(!!st, 'when the app quits, the trigger ends the session');
  await aw('saveTrigger', { ...rule, enabled: false });
  st = await aw('status');
  check(!st.checking, 'with no session and no trigger on, the check stops again');

  // ---- the separate menu-bar icon can be shown and hidden (its picture is drawn at run time)
  const shown = await aw('setSettings', { menuItem: true, iconStyle: 'owl' });
  await wait(1500);
  check(shown.menuItem === true && (await aw('status')).platform === process.platform, 'the separate menu-bar icon turns on without errors');
  await aw('setSettings', { menuItem: false, iconStyle: 'cup' });

  // ---- dark
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await aw('start', { minutes: 90 });
  await wait(800);
  await main.locator('[data-testid="awake-hero"]').scrollIntoViewIfNeeded();
  await main.screenshot({ path: path.join(SHOTS, 'awake-on-dark.png') });
  await main.locator('[data-testid="awake-triggers"]').scrollIntoViewIfNeeded();
  await main.screenshot({ path: path.join(SHOTS, 'awake-trigger-dark.png') });
  // Settings → Features: your own sets, by power source, and what each feature runs now
  await main.evaluate(() => window.keeper.features.saveSet('Travel'));
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('event:navigate', 'settings:features'); });
  const setsShown = await until(() => main.locator('[data-testid="feature-sets"]').count(), 6000);
  check(!!setsShown, 'Settings → Features shows your own sets');
  await main.locator('[data-testid="feature-sets"]').scrollIntoViewIfNeeded();
  const listed = await until(() => main.locator('[data-testid="feature-sets"] >> text=Travel').count(), 5000);
  if (!listed) console.log('INFO sets:', JSON.stringify(await main.evaluate(() => window.keeper.features.sets())));
  check(!!listed, 'a saved set is listed');
  const liveKA = await until(() => main.locator('[data-testid="feature-live-keepAwake"]').innerText(), 8000);
  check(/check every/.test(liveKA || ''), `each feature shows what it runs now (Keep awake: ${liveKA})`);
  await main.screenshot({ path: path.join(SHOTS, 'features-sets-dark.png') });

  // ---- switching the feature off removes the page, the Island controls, the holds and the checks
  // (the page you are on stays in the sidebar, so go elsewhere first)
  await main.locator('.sidebar >> text=Home').first().click().catch(() => undefined);
  await wait(300);
  await main.evaluate(() => window.keeper.features.set('keepAwake', false));
  st = await until(async () => { const s = await aw('status'); return !s.on && s.holds.length === 0 ? s : null; }, 6000);
  check(!!st, 'switching Keep Awake off ends the running session and releases its holds');
  check(!st?.checking && await checks() === 0, 'and leaves no regular check running');
  await wait(500);
  check(await main.locator('.sidebar [title="Keep Awake"]').count() === 0 && await main.locator('.sidebar >> text=Keep Awake').count() === 0, 'its sidebar entry is gone');
  const isl2 = await islState();
  check(isl2.awakeAvailable === false, 'the Island hides its keep-awake controls');
  const startOff = await aw('start', {}).then(() => 'started', (e) => String(e.message || e));
  check(/switched off/i.test(startOff), 'a start request while it is off is refused with a reason');
  await main.evaluate(() => window.keeper.features.set('keepAwake', true));
  await wait(500);
  check(await main.locator('.sidebar >> text=Keep Awake').count() > 0, 'switching it back on brings the page back');
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  console.log(process.exitCode ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
