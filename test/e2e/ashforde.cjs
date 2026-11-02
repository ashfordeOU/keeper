// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/ashforde.cjs /tmp/kash /tmp/kash-shots
// Drives the real Keeper app's Settings → Ashforde apps on a computer that is
// not a Mac: Monorail is listed with its "coming to Windows and Linux" note,
// cannot be switched on or installed, its palette commands and Features row
// are hidden, it offers no AI tools and runs nothing in the background.
// (The macOS side — install, connect, follow — needs a Mac; see docs/ASHFORDE-APPS.md.)
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const HOME = path.resolve(process.argv[2] || '/tmp/kash');
const SHOTS = path.resolve(process.argv[3] || '/tmp/kash-shots');
const APP = path.resolve(__dirname, '../..');
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const env = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' };
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  const errors = [];
  let main;
  for (let i = 0; i < 80 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    if (!main) await wait(500);
  }
  check(!!main, 'Keeper opens');
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await main.getByRole('button', { name: /Skip tour/ }).click({ timeout: 3000 }).catch(() => undefined);
  await main.setViewportSize?.({ width: 1360, height: 900 }).catch(() => undefined);
  const k = (group, fn, ...a) => main.evaluate(([g, f, args]) => window.keeper[g][f](...args), [group, fn, a]);

  // ---- the API answers honestly off a Mac
  const ov = await k('ashforde', 'overview');
  const mono = ov.apps.find((a) => a.id === 'monorail');
  check(!!mono && mono.offered === false && /Windows and Linux/.test(mono.elsewhere), `Monorail is listed but not offered on ${ov.platform}: “${mono?.elsewhere}”`);
  const st = await k('ashforde', 'monorail');
  check(st.supported === false && !st.installed && /macOS/.test(st.unsupportedReason || ''), `status says why: ${st.unsupportedReason}`);
  const inst = await k('ashforde', 'install').then(() => 'installed', (e) => String(e.message || e));
  check(/macOS/.test(inst), `install refuses: ${inst.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);
  const act = await k('ashforde', 'action', 'workspace', 2);
  check(act.ok === false, `monorail:// actions do nothing: ${act.message}`);

  // ---- the feature stays off: switching it on is ignored here
  await k('features', 'set', 'monorail', true);
  const rows = await k('features', 'list');
  const row = rows.find((r) => r.id === 'monorail');
  check(!!row && row.on === false, 'the Monorail feature cannot be switched on off a Mac');
  const usage = await k('usage', 'get');
  check(!usage.checks.some((c) => /monorail/i.test(c.name)), 'nothing of Monorail runs in the background');

  // ---- Settings → Ashforde apps
  await main.evaluate(() => { location.hash = ''; });
  await main.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,').catch(() => undefined);
  if (!(await main.$('[data-testid="ashforde-apps"]'))) await main.locator('.sidebar >> text=Settings').first().click().catch(() => undefined);
  const panel = await main.waitForSelector('[data-testid="ashforde-apps"]', { timeout: 15_000 }).catch(() => null);
  check(!!panel, 'Settings has an Ashforde apps section');
  if (panel) {
    await panel.scrollIntoViewIfNeeded();
    await wait(400);
    const note = await main.textContent('[data-testid="monorail-elsewhere"]').catch(() => '');
    check(/Coming when Monorail supports Windows and Linux/.test(note || ''), 'the Monorail card says it is coming to Windows and Linux');
    check((await main.$$('[data-testid="monorail-card"] .toggle, [data-testid="monorail-install"]')).length === 0, 'no switch and no Install button off a Mac');
    await main.locator('#ashforde').screenshot({ path: path.join(SHOTS, 'ashforde-linux-heading.png') }).catch(() => undefined);
    await panel.screenshot({ path: path.join(SHOTS, 'ashforde-linux.png') });
  }

  // ---- Settings → Features does not list it here
  const featuresText = await main.locator('.features').first().textContent().catch(() => '');
  check(!/Monorail/.test(featuresText || ''), 'Settings → Features does not list Monorail here');

  // ---- the command palette hides its commands
  await main.keyboard.press('Control+K');
  await wait(400);
  await main.keyboard.type('monorail');
  await wait(400);
  const pal = await main.locator('.palette, [role="dialog"]').first().textContent().catch(() => '');
  check(!/Monorail: /.test(pal || ''), 'Monorail commands are not in the palette');
  await main.keyboard.press('Escape');

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
})().catch((e) => { console.error(e); process.exitCode = 1; process.exit(1); });
