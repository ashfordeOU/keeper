// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/attention.cjs /tmp/katt /tmp/katt-shots
// Drives the real Keeper app's calm-attention parts: the notification center
// (the bell, the sheet grouped by part, Mark all done, Snooze all, the per-part
// choices in Settings), the one attention list (Privacy & Security leads with
// "things worth fixing", the score as a small detail, engines under How Keeper
// checks; the Fix-it List's rows with one Fix and More), the "?" help sheet with
// the page's bundled doc, the self-check and the problem report, and usage-aware
// decluttering. Saves light and dark screenshots at 1440x900.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const ROOT = path.resolve(__dirname, '../..');
let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) { failed++; process.exitCode = 1; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await wait(step); } return null; };

fs.rmSync(HOME, { recursive: true, force: true });
for (const d of ['Downloads', 'Desktop', 'Documents', 'Pictures']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.writeFileSync(path.join(HOME, 'Documents/Plan.md'), '# Plan\n\nA note.\n');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, KEEPER_SKIP_TOUR: '1', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: path.join(HOME, '.config'), XDG_DATA_HOME: path.join(HOME, '.local/share'), XDG_CURRENT_DESKTOP: 'test' } });
  const w = await until(async () => app.windows().find((x) => { const u = x.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 30000, 200);
  const errors = [];
  w.on('pageerror', (e) => errors.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await w.waitForSelector('.sidebar', { timeout: 60000 });
  const skip = await w.$('text=Skip setup');
  if (skip) await skip.click().catch(() => undefined);
  const nav = (r) => app.evaluate(({ BrowserWindow }, route) => { for (const b of BrowserWindow.getAllWindows()) b.webContents.send('event:navigate', route); }, r);
  const k = (group, fn, ...a) => w.evaluate(([g, f, args]) => window.keeper[g][f](...args), [group, fn, a]);
  const theme = async (dark) => { await w.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark); await w.waitForTimeout(500); };
  const shots = async (name) => {
    for (const dark of [false, true]) {
      await theme(dark);
      await w.screenshot({ path: path.join(SHOTS, `auditattention-${name}-${dark ? 'dark' : 'light'}.png`) });
    }
    await theme(false);
  };
  const only = (process.env.ONLY || '').split(',').filter(Boolean);
  const part = (name) => !only.length || only.includes(name);

  // ---------------------------------------------------------------- the notification center
  if (part('notices')) {
    await nav('home');
    await w.waitForTimeout(800);
    const bell = w.getByTestId('notices-bell');
    check(await bell.count() === 1 && /Notifications/.test(await bell.getAttribute('aria-label')), 'the top bar has a labelled bell');
    await k('notices', 'test');
    check(!!(await until(async () => /1/.test(await w.locator('.notices-count').textContent()))), 'a test notice shows on the bell’s count');
    await bell.click();
    const sheet = w.getByTestId('notices-sheet');
    check(!!(await until(async () => (await sheet.count()) === 1)), 'the bell opens the notification center');
    check(!!(await until(async () => /This is how notices look/.test(await sheet.getByTestId('notices-group-keeper').textContent()))), 'the notice is listed under its part (Keeper itself)');
    await shots('notices');
    await sheet.getByTestId('notices-done-all').click();
    check(!!(await until(async () => (await sheet.getByTestId('notices-empty').count()) === 1)), 'Mark all done leaves “All caught up”');
    check(await w.locator('.notices-count').count() === 0, 'the count goes from the bell');
    await shots('notices-empty');
    await sheet.getByTestId('notices-snooze').click();
    check(!!(await until(async () => /Snoozed until/.test(await sheet.getByTestId('notices-status').textContent()))), 'Snooze all 1 h says until when');
    check((await k('notices', 'list')).snoozedUntil > Date.now() + 50 * 60_000, 'nothing is shown for an hour');
    await sheet.getByTestId('notices-unsnooze').click();
    check(!!(await until(async () => (await k('notices', 'list')).snoozedUntil === 0)), 'Stop snoozing ends it');
    await w.keyboard.press('Escape');
    check(!!(await until(async () => (await sheet.count()) === 0)), 'Escape closes the sheet');

    // Settings → General → Notifications: Now / Batched / Silent per part.
    await nav('settings:general');
    const parts = w.getByTestId('notice-parts');
    check(!!(await until(async () => (await parts.count()) === 1)), 'Settings → General shows how each part tells you');
    await parts.scrollIntoViewIfNeeded();
    await w.getByTestId('notice-part-fixit-silent').click();
    check(!!(await until(async () => (await w.evaluate(() => window.keeper.settings.get())).notices.delivery.fixit === 'silent')), 'choosing Silent for the Fix-it List is saved');
    check(await w.getByTestId('notice-part-fixit-silent').getAttribute('aria-checked') === 'true', 'the choice shows as picked');
    await w.getByTestId('notice-part-fixit-batched').click();
    check(await w.getByTestId('quiet-hours').count() === 1, 'quiet hours are offered');
    await shots('notices-settings');
  }

  // ---------------------------------------------------------------- one attention list
  if (part('privacy')) {
    await nav('security');
    const head = w.getByTestId('sec-attention');
    check(!!(await until(async () => (await head.count()) === 1, 60000)), 'Privacy & Security leads with what is worth doing');
    const h = await head.locator('h2').textContent();
    check(/worth fixing|Good to know|Nothing worth fixing/.test(h), `the headline is calm: “${h}”`);
    check(/\d+ of 100/.test(await w.getByTestId('sec-score').textContent()) && (await head.boundingBox()).height < 120, 'the score is a small detail under it');
    check(!(await w.getByTestId('sec-how').getAttribute('open')), 'engine names are under How Keeper checks, closed');
    check(!/At risk|Needs attention/.test(await w.locator('.sec-overview').textContent()), 'no “at risk” anywhere on the overview');
    const rows = w.getByTestId('sec-finding');
    if (await rows.count()) check(await rows.first().locator('.sec-actions .btn.primary').count() <= 1 && await rows.first().getByTestId('sec-more').count() === 1, 'each finding has one clear action and More');
    await shots('privacy');
    await nav('todo');
    await w.waitForSelector('.todo', { timeout: 20000 });
    await w.waitForTimeout(800);
    await shots('fixit');
  }

  // ---------------------------------------------------------------- help on every page
  if (part('help')) {
    await nav('home');
    await w.waitForTimeout(600);
    const btn = w.getByTestId('help-button');
    check(await btn.count() === 1 && /Help/.test(await btn.getAttribute('aria-label')), 'the top bar has a labelled ? button');
    await btn.click();
    const sheet = w.getByTestId('help-sheet');
    check(!!(await until(async () => (await sheet.count()) === 1)), '? opens the help sheet');
    check((await w.getByTestId('help-title').textContent()) === 'Hello', 'it is about the page you are on');
    check(await w.locator('[data-testid="help-can"] li').count() === 3, 'three things you can do here');
    check(!!(await until(async () => (await w.getByTestId('help-doc').textContent()).length > 400)), 'the page’s guide is shown from the bundled docs');
    await shots('help');
    await w.keyboard.press('F1');
    check(!!(await until(async () => (await sheet.count()) === 0)), 'F1 closes it');
    // A tab with its own guide; a link to another guide opens in the sheet; Back returns.
    await nav('security');
    await w.waitForTimeout(800);
    await w.keyboard.press('F1');
    check(!!(await until(async () => (await w.getByTestId('help-title').textContent().catch(() => '')) === 'Privacy & Security')), 'F1 opens help for Privacy & Security');
    const link = w.locator('[data-testid="help-doc"] a', { hasText: 'One attention list' });
    check(!!(await until(async () => (await link.count()) > 0)), 'the guide links to another guide');
    await link.first().click();
    check(!!(await until(async () => /Fix-it List/.test(await w.getByTestId('help-doc').textContent()) && (await w.getByTestId('help-back').count()) === 1)), 'the linked guide opens in the sheet, with Back');
    await shots('help-linked');
    await w.getByTestId('help-back').click();
    check(!!(await until(async () => (await w.getByTestId('help-back').count()) === 0)), 'Back returns to the page’s guide');
    await w.keyboard.press('Escape');
    await w.evaluate(() => window.keeper.settings.set({ helpButton: false }));
    check(!!(await until(async () => (await w.getByTestId('help-button').count()) === 0)), 'Settings can hide the ? button');
    await w.keyboard.press('F1');
    check(!!(await until(async () => (await w.getByTestId('help-sheet').count()) === 1)), 'F1 still works without the button');
    await w.keyboard.press('Escape');
    await w.evaluate(() => window.keeper.settings.set({ helpButton: true }));
  }

  // ---------------------------------------------------------------- a smaller window
  if (part('small')) {
    await w.setViewportSize({ width: 1024, height: 768 });
    await nav('security');
    await w.waitForTimeout(1200);
    const overflow = await w.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!overflow, 'Privacy & Security fits a 1024×768 window');
    await w.screenshot({ path: path.join(SHOTS, 'auditattention-privacy-1024-light.png') });
    await w.getByTestId('notices-bell').click();
    await w.waitForTimeout(400);
    await w.screenshot({ path: path.join(SHOTS, 'auditattention-notices-1024-light.png') });
    await w.keyboard.press('Escape');
    await w.setViewportSize({ width: 1440, height: 900 });
  }

  check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await app.close();
  console.log(failed ? `${failed} failed` : 'all passed');
})().catch((e) => { console.error(e); process.exit(1); });
