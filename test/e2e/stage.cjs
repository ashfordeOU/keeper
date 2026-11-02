// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/stage.cjs /tmp/kst /tmp/kst-shots
// (runs itself inside a private D-Bus session so GNOME settings can be changed and read back)
//
// Drives the real Keeper app's Stage mode on Linux:
//   - nothing runs while it is off (no overlay, no watchdog, no capture check)
//   - the Recording preset counts down in the Island and on screen, then changes real
//     GNOME settings (event sounds, pointer size, Do Not Disturb through Keep Awake),
//     writes every change to the journal first, keeps the computer awake, shows the
//     backdrop and overlays, hides the Island's private things, and shows in the tray
//   - stopping puts everything back, newest first, but leaves a setting the person
//     changed by hand while Stage was on
//   - a crash: the watchdog puts things back when Keeper's process disappears
//   - a crash with the watchdog gone too: the next start puts things back
//   - the older Presentation mode runs through Stage with its old behaviour
//   - auto-start: a (pretend) recorder app starts Stage, and quitting it ends Stage
// Screenshots of the page, the Island and the overlays in light and dark.
const { spawn, spawnSync, execFileSync } = require('child_process');
if (!process.env.KEEPER_E2E_DBUS && process.platform === 'linux') {
  // D-Bus starts dconf with the bus's own environment, so the bus gets the test's home folder.
  const fs0 = require('fs');
  const p0 = require('path');
  const h = p0.resolve(process.argv[2] || '/tmp/kst');
  fs0.rmSync(h, { recursive: true, force: true });
  fs0.mkdirSync(h, { recursive: true });
  const home = fs0.realpathSync(h);
  const r = spawnSync('dbus-run-session', ['--', process.execPath, __filename, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', KEEPER_E2E_DBUS: '1', HOME: home, XDG_CONFIG_HOME: home + '/.config', XDG_DATA_HOME: home + '/.local/share' } });
  process.exit(r.status ?? 1);
}
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const HOME0 = path.resolve(process.argv[2] || '/tmp/kst');
const SHOTS = path.resolve(process.argv[3] || '/tmp/kst-shots');
const APP = path.resolve(__dirname, '../..');
fs.mkdirSync(HOME0, { recursive: true });
const HOME = fs.realpathSync(HOME0);
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
const env = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, KEEPER_SKIP_TOUR: '1', NODE_OPTIONS: '', KEEPER_SUITE: 'shared', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', XDG_CURRENT_DESKTOP: 'GNOME' };
const gs = (schema, key) => execFileSync('gsettings', ['get', schema, key], { env, encoding: 'utf8' }).trim();
const gset = (schema, key, v) => execFileSync('gsettings', ['set', schema, key, v], { env });
const SOUND = ['org.gnome.desktop.sound', 'event-sounds'];
const CURSOR = ['org.gnome.desktop.interface', 'cursor-size'];
const BANNERS = ['org.gnome.desktop.notifications', 'show-banners'];
const hasBanners = (() => { try { gs(...BANNERS); return true; } catch { return false; } })();
const userData = path.join(HOME, '.config', 'Keeper');
const journal = () => path.join(userData, 'stage-journal.json');
const watchdogs = () => { try { return execFileSync('pgrep', ['-f', 'stage-restore.sh'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; } };

// node_modules/.bin/electron is a small launcher; the real Keeper is its child. Kill that one, as a crash would.
async function hardKill(app) {
  const pid = await app.evaluate(() => process.pid);
  try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  try { app.process().kill('SIGKILL'); } catch { /* gone */ }
  await wait(500);
}

async function launch() {
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  let main;
  let isl;
  for (let i = 0; i < 80 && !(main && isl); i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && !u.startsWith('data:') && (!u.includes('view=') || u.includes('view=app')); });
    isl = app.windows().find((w) => w.url().includes('view=island'));
    if (!(main && isl)) await wait(500);
  }
  await main.waitForSelector('.sidebar', { timeout: 60_000 }).catch(async (e) => { console.log('INFO windows:', app.windows().map((w) => w.url().slice(0, 80)).join(' | '), 'text:', (await main.locator('body').innerText().catch(() => '')).slice(0, 400)); throw e; });
  await wait(2500);
  await main.click('.tour button:has-text("Skip tour")', { timeout: 3000 }).catch(() => undefined);
  await main.setViewportSize?.({ width: 1440, height: 900 }).catch(() => undefined);
  return { app, main, isl };
}

(async () => {
  gset(...SOUND, 'true');
  gset(...CURSOR, '48');
  if (hasBanners) gset(...BANNERS, 'true');
  let { app, main, isl } = await launch();
  const errors = [];
  main.on('pageerror', (e) => errors.push(e.message));
  const sg = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.stage[f](...args), [fn, a]);
  const winTitles = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).map((w) => w.getTitle()));
  const checks = () => main.evaluate(() => window.keeper.usage.get().then((u) => u.checks.filter((c) => c.name === 'stage.capture' && c.everyMs !== null).length));

  // ---- off: nothing runs
  let st = await sg('status');
  check(!st.on, 'Stage is off at first');
  check(!(await winTitles()).some((t) => /Stage (overlay|backdrop)/.test(t)), 'no overlay or backdrop window exists while off');
  check(watchdogs().length === 0 && !fs.existsSync(journal()), 'no watchdog and no journal while off');
  check(await checks() === 0, 'no capture check runs while auto-start is off');

  // ---- the page
  await main.click('.sidebar [title="Stage"]').catch(() => main.locator('.sidebar >> text=Stage').first().click());
  await main.waitForSelector('[data-testid="stage-hero"]');
  await main.waitForSelector('[data-testid="stage-sw-hideDock"]');
  await wait(400);
  await main.screenshot({ path: path.join(SHOTS, 'stage-page-light.png') });
  check(await main.locator('[data-testid="stage-sw-keepKeeperOut"] .badge').innerText().catch(() => '') === 'Not possible here', 'the page says honestly what is not possible on Linux');
  const tray0 = await sg('tray');
  check(tray0[0] === 'Stage' && tray0.includes('  Recording') && tray0.includes('  Presenting'), `the tray has a Stage menu with the presets (${tray0.join(' | ')})`);

  // ---- the Recording preset: countdown first
  await main.click('[data-testid="stage-start-recording"]');
  const counting = await until(async () => { const s = await isl.evaluate(() => window.keeper.island.state()); return s.stage?.countdownEndsAt ? s : null; }, 3000, 100);
  check(!!counting, 'the Island knows about the countdown');
  const ov = await until(async () => { const o = await sg('overlays'); return o.find((x) => x.state && x.state.count > 0); }, 3000, 100);
  check(!!ov, `the 3-2-1 countdown shows on screen (${ov ? ov.state.count : 'none'})`);
  const shotOverlay = await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Keeper Stage overlay'); if (!w) return null; const img = await w.webContents.capturePage(); return img.resize({ width: 640 }).toPNG().toString('base64'); });
  if (shotOverlay) fs.writeFileSync(path.join(SHOTS, 'stage-countdown-overlay.png'), Buffer.from(shotOverlay, 'base64'));
  st = await until(async () => { const s = await sg('status'); return s.on ? s : null; }, 15_000);
  check(!!st && st.presetName === 'Recording', 'Recording starts after the countdown');
  await wait(500);

  check(gs(...SOUND) === 'false', `event sounds are muted (${gs(...SOUND)})`);
  check(gs(...CURSOR) === '24', `the enlarged pointer is back to normal size (${gs(...CURSOR)})`);
  if (hasBanners) check(gs(...BANNERS) === 'false', 'Do Not Disturb is on, through Keep Awake (GNOME banners off)');
  const aw = await main.evaluate(() => window.keeper.awake.status());
  check(aw.on && aw.session.reason === 'Stage mode', `Keep Awake holds the computer awake for Stage (${aw.session && aw.session.reason})`);
  const j = JSON.parse(fs.readFileSync(journal(), 'utf8'));
  if (!j.entries.find((e) => e.target.key === 'event-sounds' && e.applied === 'false')) console.log('INFO journal:', JSON.stringify(j.entries.map((e) => [e.label, e.prior, e.applied, e.state])));
  const sound = j.entries.find((e) => e.target.t === 'gsettings' && e.target.key === 'event-sounds');
  check(sound && sound.prior === 'true' && sound.applied === 'false' && sound.state === 'applied', 'the journal recorded the old value of each setting before changing it');
  check(j.entries.some((e) => e.target.t === 'awake') && j.pid > 0, 'the journal lists the keep-awake session and Keeper\'s process');
  check(fs.existsSync(path.join(userData, 'stage-restore.sh')) && /gsettings/.test(fs.readFileSync(path.join(userData, 'stage-restore.sh'), 'utf8')), 'the watchdog\'s restore script is written next to the journal');
  check(watchdogs().length >= 1, 'the watchdog runs while Stage is on');
  const titles = await winTitles();
  check(titles.includes('Keeper Stage backdrop'), 'the clean backdrop is up');
  check(titles.includes('Keeper Stage overlay'), 'the click overlay is up');
  const changes = await main.locator('[data-testid="stage-changes"]').innerText().catch(() => '');
  check(/Event sounds/.test(changes) && /Pointer size/.test(changes), 'the page lists what Stage changed');
  check(/Keep Keeper out of the picture.*Linux has no way/s.test(changes), 'and what it could not do here, with the reason');
  const is = await isl.evaluate(() => window.keeper.island.state());
  check(is.stage?.on && is.clips.length === 0 && is.stage.private, 'the Island hides the clipboard and private things');
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('view=island')) w.webContents.send('event:island-open', 'controls'); });
  const live = await until(async () => { const t = await isl.locator('body').innerText(); return /Recording/.test(t) && /Stage/.test(t) ? t : null; }, 6000);
  check(!!live, 'the Island shows Stage, with the Stage switch in Controls');
  await isl.screenshot({ path: path.join(SHOTS, 'stage-island.png') }).catch(() => undefined);
  const tray1 = await sg('tray');
  check(/^● Stage: Recording/.test(tray1[0]) && tray1.includes('  Stop Stage'), `the tray shows Stage is on, with Stop (${tray1[0]})`);
  await main.screenshot({ path: path.join(SHOTS, 'stage-on-light.png') });

  // a click shows a ripple (the Try it button drives the same overlay)
  await sg('stop'); // previews only run while Stage is off; checked below
  // ---- stop: put back, but leave what the person changed
  await sg('start', 'recording', { skipCountdown: true });
  await until(async () => (await sg('status')).on, 10_000);
  gset(...CURSOR, '32');
  st = await sg('stop');
  check(!st.on, 'Stop ends Stage');
  check(gs(...SOUND) === 'true', 'event sounds are back on');
  check(gs(...CURSOR) === '32', `the pointer size the person changed during Stage is left as they set it (${gs(...CURSOR)})`);
  if (hasBanners) check(gs(...BANNERS) === 'true', 'notification banners are back');
  check(st.lastRevert.some((r) => r.outcome === 'left' && /Pointer/.test(r.label)) && st.lastRevert.some((r) => r.outcome === 'restored'), 'the result says what was put back and what was left alone');
  check(!(await main.evaluate(() => window.keeper.awake.status())).on, 'the keep-awake session ends with Stage');
  check(!fs.existsSync(journal()) && !(await winTitles()).some((t) => /Stage (overlay|backdrop)/.test(t)), 'the journal, backdrop and overlays are gone');
  await until(async () => watchdogs().length === 0, 4000);
  check(watchdogs().length === 0, 'the watchdog stops');

  // ---- previews (the "Try it" buttons)
  await main.click('[data-testid="stage-try-clicks"]');
  const rip = await until(async () => { const o = await sg('overlays'); return o.find((x) => x.state && x.state.clicks > 0); }, 4000);
  check(!!rip, 'Try it shows click ripples');
  await main.click('[data-testid="stage-try-keys"]');
  const keys = await until(async () => { const o = await sg('overlays'); return o.find((x) => x.state && x.state.keyCount > 0); }, 4000);
  check(!!keys && /S/.test(keys.state.keys), `Try it shows keystrokes (${keys && keys.state.keys})`);
  await main.click('[data-testid="stage-try-spotlight"]');
  const spot = await until(async () => { const o = await sg('overlays'); return o.find((x) => x.state && x.state.mode === 'spotlight'); }, 4000);
  check(!!spot, 'Try it shows the pointer spotlight');
  await wait(4500);
  check(!(await winTitles()).some((t) => /Stage overlay/.test(t)), 'previews close by themselves');

  // ---- the older Presentation mode, through Stage
  const pres = await main.evaluate(() => window.keeper.island.presentation(true));
  st = await sg('status');
  const aw2 = await main.evaluate(() => window.keeper.awake.status());
  check(pres === true && st.presetName === 'Presentation mode' && aw2.session?.reason === 'Presentation mode', 'Presentation mode still keeps the computer awake (now through Stage)');
  check(st.applied.map((a) => a.switch).sort().join() === 'hideDesktopIcons,keepAwake', `and does only what it did before (${st.applied.map((a) => a.switch).join(', ')})`);
  await main.evaluate(() => window.keeper.island.presentation(false));
  check(!(await sg('status')).on, 'Presentation mode ends');

  // ---- switching the feature off hides the page and its commands
  await main.click('.sidebar [title="Keep Awake"]').catch(() => undefined);
  await main.evaluate(() => window.keeper.features.set('stage', false));
  await wait(800);
  const gone = await until(async () => (await main.locator('.sidebar [title="Stage"]').count()) === 0, 6000);
  if (!gone) console.log('INFO sidebar:', await main.locator('.sidebar [title="Stage"]').first().evaluate((e) => e.outerHTML.slice(0, 300)), await main.evaluate(() => window.keeper.features.list().then((l) => JSON.stringify(l.find((f) => f.id === 'stage')))));
  check(!!gone, 'switching Stage off removes it from the sidebar');
  check((await main.evaluate(() => window.keeper.stage.tray())).length === 0, 'and from the tray');
  await main.evaluate(() => window.keeper.features.set('stage', true));
  await main.click('.sidebar [title="Stage"]').catch(() => main.locator('.sidebar >> text=Stage').first().click());
  await main.waitForSelector('[data-testid="stage-hero"]');

  // ---- dark
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await sg('start', 'presenting');
  await until(async () => (await sg('status')).on, 10_000);
  await wait(600);
  await main.screenshot({ path: path.join(SHOTS, 'stage-on-dark.png') });
  await main.locator('[data-testid="stage-starting"]').scrollIntoViewIfNeeded();
  await main.screenshot({ path: path.join(SHOTS, 'stage-starting-dark.png') });
  await sg('stop');
  await main.setViewportSize?.({ width: 820, height: 760 }).catch(() => undefined);
  await main.locator('[data-testid="stage-hero"]').scrollIntoViewIfNeeded();
  await wait(300);
  await main.screenshot({ path: path.join(SHOTS, 'stage-small-dark.png') });
  await main.setViewportSize?.({ width: 1440, height: 900 }).catch(() => undefined);
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));

  // ---- auto-start: a pretend recorder app
  const fake = path.join(HOME, 'kstfakerec');
  fs.copyFileSync('/bin/sleep', fake);
  fs.chmodSync(fake, 0o755);
  await sg('setSettings', { auto: { preset: 'screenshot', streams: true, apps: true, keeperRecorder: true, extraApps: ['kstfakerec'], stopWhenDone: true } });
  await main.evaluate(() => window.keeper.features.set('stageAuto', true));
  check(await until(async () => (await checks()) === 1, 5000), 'turning auto-start on starts one capture check');
  const proc = spawn(fake, ['300'], { stdio: 'ignore' });
  st = await until(async () => { const s = await sg('status'); return s.on && s.auto ? s : null; }, 30_000, 500);
  check(!!st && st.presetName === 'Screenshot' && /kstfakerec/.test(st.reason || ''), `a recorder app starts Stage by itself (${st && st.reason})`);
  const det = await sg('detect');
  check(det.sources.some((s) => /kstfakerec/.test(s.label) && s.reliable === false), 'detection says the recorder app is a guess, not certain');
  proc.kill();
  st = await until(async () => { const s = await sg('status'); return !s.on ? s : null; }, 45_000, 1000);
  check(!!st, 'Stage ends when the recorder quits');
  await main.evaluate(() => window.keeper.features.set('stageAuto', false));
  check(await until(async () => (await checks()) === 0, 5000) !== undefined, 'turning auto-start off stops the check');

  // ---- a crash: the watchdog puts things back
  gset(...CURSOR, '48');
  await sg('start', 'recording', { skipCountdown: true });
  await until(async () => gs(...SOUND) === 'false', 10_000);
  if (gs(...SOUND) !== 'false') console.log('INFO status before the crash:', JSON.stringify(await sg('status')).slice(0, 800));
  check(gs(...SOUND) === 'false' && fs.existsSync(journal()), 'Stage is on again before the crash');
  await hardKill(app);
  const restored = await until(async () => (gs(...SOUND) === 'true' && gs(...CURSOR) === '48' ? true : null), 12_000, 500);
  check(!!restored, `the watchdog put settings back after Keeper was killed (sounds ${gs(...SOUND)}, pointer ${gs(...CURSOR)})`);
  check(!fs.existsSync(journal()), 'and removed the journal');

  // ---- a crash with the watchdog gone too: the next start puts things back
  ({ app, main, isl } = await launch());
  await main.evaluate(() => window.keeper.stage.start('recording', { skipCountdown: true }));
  await until(async () => gs(...SOUND) === 'false', 10_000);
  for (const pid of watchdogs()) try { process.kill(Number(pid), 'SIGKILL'); } catch { /* gone */ }
  await hardKill(app);
  await wait(1500);
  check(gs(...SOUND) === 'false' && fs.existsSync(journal()), 'with the watchdog gone too, the changes and the journal are still there');
  ({ app, main, isl } = await launch());
  const back = await until(async () => (gs(...SOUND) === 'true' ? true : null), 20_000, 500);
  check(!!back && gs(...CURSOR) === '48', 'the next start of Keeper put everything back');
  st = await main.evaluate(() => window.keeper.stage.status());
  check(/still on when Keeper stopped/.test(st.recovered || ''), `and says so (${st.recovered})`);
  await main.click('.sidebar [title="Stage"]').catch(() => main.locator('.sidebar >> text=Stage').first().click());
  await main.waitForSelector('[data-testid="stage-hero"]');
  await wait(400);
  await main.screenshot({ path: path.join(SHOTS, 'stage-recovered-light.png') });

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await Promise.race([app.close(), wait(8000)]);
  await hardKill(app).catch(() => undefined);
  gset(...CURSOR, '24');
  process.exit(process.exitCode ?? 0);
})().catch((e) => { console.error(e); process.exitCode = 1; process.exit(1); });
