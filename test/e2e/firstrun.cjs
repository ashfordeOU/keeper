// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/firstrun.cjs /tmp/kfr /tmp/kfr-shots
// The first-run setup on a new install (no settings file, the 1.0 defaults), both ways:
//   • Goals: Welcome → What do you want Keeper for? (eight cards, up to three) →
//     approvals → Connect → one shortcut; the "Also" boxes (usage stats unticked),
//     what gets written, the library waiting for setup, the first tip on Home;
//   • Choose: group cards, a part switched on, the footer's live count, what gets written;
//   • Set up Keeper again from the command palette (current choices, Cancel).
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = fs.realpathSync(path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/kfr-')));
const SHOTS = path.resolve(process.argv[3] || path.join(ROOT, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(name) {
  const HOME = path.join(ROOT, name);
  for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures', '.config']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'Documents', 'notes about tram.txt'), 'tram 28 to Graça');
  fs.writeFileSync(path.join(HOME, 'Downloads', 'invoice.txt'), 'invoice');
  const env = { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', KEEPER_PERMISSIONS_OPEN_STUB: path.join(HOME, 'opened.jsonl') };
  delete env.KEEPER_SKIP_TOUR;
  delete env.KEEPER_DEFAULTS;
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env });
  let main;
  for (let i = 0; i < 60 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    if (!main) await sleep(500);
  }
  const errors = [];
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 60000 });
  const settings = () => JSON.parse(fs.readFileSync(path.join(HOME, '.config/Keeper/settings.json'), 'utf8'));
  const shot = async (n) => {
    for (const dark of [false, true]) {
      await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark);
      await sleep(400);
      await main.screenshot({ path: path.join(SHOTS, `${name}-${n}-${dark ? 'dark' : 'light'}.png`) });
    }
    await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));
  };
  return { app, main, errors, settings, shot, HOME };
}

const libraryRoots = (main) => main.evaluate(async () => {
  const list = await window.keeper.library.list({});
  return [...new Set((Array.isArray(list) ? list : list.files ?? []).map((f) => f.root))];
});

(async () => {
  // ---------------------------------------------------------------- Recommended
  {
    const { app, main, errors, settings, shot } = await launch('recommended');
    await main.waitForSelector('.tour [data-step="welcome"]', { timeout: 20000 });
    check(await main.getByText('One app for your files and your computer.').count() === 1, 'Welcome says what Keeper is');
    check(await main.locator('.setup-pillars li').count() === 4, 'four pillars');
    await shot('welcome');
    await sleep(2500);
    const roots = await libraryRoots(main).catch(() => []);
    check(!roots.includes('Documents'), `before setup the library reads only Downloads (${roots.join(', ') || 'nothing yet'})`);

    await main.click('[data-testid="setup-start"]');
    await main.waitForSelector('[data-testid="setup-goal-files"]');
    check(await main.getByText('What do you want Keeper for?').count() === 1, 'setup asks what Keeper is for');
    check(await main.locator('.setup-goal').count() === 8, 'eight goal cards');
    for (const g of ['record', 'focus', 'clean']) await main.click(`[data-testid="setup-goal-${g}"]`);
    check(await main.locator('[data-testid="setup-goal-notes"]').isDisabled(), 'a fourth goal cannot be picked');
    await main.click('[data-testid="setup-goal-clean"]');
    check(!(await main.locator('[data-testid="setup-goal-notes"]').isDisabled()), 'unpicking one frees a place');
    // Modes come first on the same screen (Standard picked); the goals point to one without changing it.
    check(await main.locator('[data-testid="setup-mode-standard"][aria-checked="true"]').count() === 1, 'the mode row comes first, with Standard picked');
    check(/Creator suits these goals/.test(await main.getByTestId('setup-mode-line').textContent()), 'the goals suggest a mode (Creator) without switching to it');
    check(/Picked for Record my screen and Stay focused/.test(await main.getByTestId('setup-goals-line').textContent()), 'the line says what was picked');
    check(await main.locator('[data-testid="setup-also-login"]').isChecked(), 'Open Keeper when I log in: ticked');
    check(await main.locator('[data-testid="setup-also-updates"]').isChecked(), 'Check for updates automatically: ticked');
    check(!(await main.locator('[data-testid="setup-also-usageStats"]').isChecked()), 'Send anonymous usage stats: visible and unticked');
    await shot('how');

    await main.click('[data-testid="setup-continue"]');
    await main.waitForSelector('.tour [data-step="approvals"]', { timeout: 20000 });
    await main.waitForSelector('[data-testid="setup-now"], [data-testid="setup-nothing-now"]', { timeout: 20000 });
    check(await main.locator('[data-testid="setup-now"] li').count() <= 2, 'at most two approvals now');
    const s = settings();
    const on = Object.entries(s.features).filter(([, v]) => v === true).length;
    check(s.features.mail === false && s.features.link === false, 'Mail and devices are offered, not on');
    check(s.features.usageStats === false, 'usage stats stay off');
    check(on >= 30 && on <= 60, `the essentials and the goals’ parts make a short list (${on})`);
    check(s.features.studio === true && s.features.focusBlock === true, 'the goals’ parts are on (Studio, Focus Blocking)');
    check(JSON.stringify(s.setupGoals) === '["record","focus"]' && s.tips.start > 0, 'the goals are kept and the week of tips starts');
    await shot('approvals');
    await main.click(await main.locator('[data-testid="setup-later"]').count() ? '[data-testid="setup-later"]' : '[data-testid="setup-approvals-next"]');

    await main.waitForSelector('.tour [data-step="connect"]');
    check(await main.locator('.setup-conn').count() === 4, 'Connect offers Mail, AI, devices and cloud');
    await shot('connect');
    await main.click('[data-testid="setup-connect-skip"]');

    await main.waitForSelector('.tour [data-step="try"]');
    check(await main.locator('[data-testid="setup-shortcut"] kbd').count() === 1, 'the last screen teaches one shortcut only');
    await shot('try');
    await main.click('[data-testid="setup-done"]');
    await sleep(800);
    check(await main.locator('.tour').count() === 0, 'setup closes');
    check(settings().setupDone === true, 'setup is recorded as done');
    await sleep(4000);
    const after = await libraryRoots(main).catch(() => []);
    check(after.includes('Documents'), `after setup the library reads every folder (${after.join(', ')})`);
    // Getting to know Keeper: the first tip on Home, put away with one click.
    const tip = main.getByTestId('home-tip');
    check(!!(await tip.count()) && /Search from anywhere/.test(await tip.textContent()), 'Home shows the first tip of the week');
    await shot('home-tip');
    await main.getByTestId('home-tip-done').click();
    await sleep(400);
    check(await main.getByTestId('home-tip').count() === 0 && settings().tips.done.includes('search'), 'the tip is put away and stays away');

    // Set up Keeper again, from the palette: the current choices, nothing changed until Continue.
    await main.keyboard.press('Control+k');
    await sleep(300);
    const first = await main.locator('.q-results .group').first().textContent();
    check(/Recent|Common/.test(first), `the palette opens with recent and common items (${first})`);
    await main.keyboard.type('Set up Keeper again');
    await sleep(300);
    await main.keyboard.press('Enter');
    await main.waitForSelector('.tour [data-step="how"]', { timeout: 10000 });
    check(true, 'Set Up Keeper Again opens setup at its second screen');
    await main.click('[data-testid="setup-close"]');
    await sleep(400);
    check(await main.locator('.tour').count() === 0, 'Cancel closes it');
    check(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
    await app.close();
  }

  // ---------------------------------------------------------------- Choose
  {
    const { app, main, errors, settings, shot } = await launch('choose');
    await main.waitForSelector('.tour [data-step="welcome"]', { timeout: 20000 });
    await main.click('[data-testid="setup-start"]');
    await main.click('[data-testid="setup-choose"]');
    await main.waitForSelector('.tour [data-step="choose"]', { timeout: 10000 });
    check(await main.locator('.setup-group').count() >= 10, 'Choose shows the group cards');
    const count = async () => Number(await main.locator('[data-testid="setup-count"]').textContent());
    const before = await count();
    await main.locator('[data-testid="setup-group-mail"] .setup-group-more').click();
    await main.locator('[data-testid="setup-part-mail"] input').check();
    await sleep(200);
    check(await count() > before, `the footer counts the new part (${before} → ${await count()})`);
    await main.locator('[data-testid="setup-group-desktop"] .setup-group-head input').check();
    await sleep(200);
    await shot('choose');
    await main.click('[data-testid="setup-choose-continue"]');
    await main.waitForSelector('.tour [data-step="approvals"]', { timeout: 20000 });
    const s = settings();
    check(s.features.mail === true, 'the picked part is on');
    check(s.features.link === false, 'parts not picked stay off');
    await main.click(await main.locator('[data-testid="setup-later"]').count() ? '[data-testid="setup-later"]' : '[data-testid="setup-approvals-next"]');
    await main.click('[data-testid="setup-connect-next"]');
    await main.click('[data-testid="setup-done"]');
    await sleep(600);
    check(await main.locator('.tour').count() === 0 && settings().setupDone === true, 'setup finishes');
    check(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
    await app.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
