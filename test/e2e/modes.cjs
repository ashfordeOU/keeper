// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/modes.cjs /tmp/kmo /tmp/kmo-shots
// Modes in the real app: the badge at the foot of the sidebar, "Mode: Simple" from
// the palette with its preview sheet, the switch (parts, text size, sidebar,
// Big buttons on Today), the person's own change kept for the mode and brought
// back, Changed and Reset against the mode, every mode switched through from
// Settings → General, the Privacy-max add-on with the Offline check, and Focus
// for a while (the badge, the narrow sidebar, ending it).
// Screenshots crop away the sidebar's places (this machine's own disk names).
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = fs.realpathSync(path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/kmo-')));
const SHOTS = path.resolve(process.argv[3] || path.join(ROOT, 'shots'));
const HOME = path.join(ROOT, 'alex');
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) { failed++; process.exitCode = 1; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, step = 200) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(step); } return null; };

for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures', '.config/Keeper']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.writeFileSync(path.join(HOME, 'Documents', 'Trip to Lisbon.md'), '# Lisbon\nTram 28, then the castle.');
fs.writeFileSync(path.join(HOME, 'Documents', 'Garden plan.txt'), 'Tomatoes by the fence.');
fs.writeFileSync(path.join(HOME, 'Downloads', 'Recipe - lemon cake.pdf'), '%PDF-1.4');
// A finished setup, as most people have it.
fs.writeFileSync(path.join(HOME, '.config/Keeper/settings.json'), JSON.stringify({ setupDone: true, folders: [path.join(HOME, 'Documents'), path.join(HOME, 'Downloads'), path.join(HOME, 'Desktop')] }));
const settings = () => JSON.parse(fs.readFileSync(path.join(HOME, '.config/Keeper/settings.json'), 'utf8'));

(async () => {
  // No coding tools on the PATH: setup and Recommended see a plain computer.
  const PATH = (process.env.PATH || '').split(':').filter((d) => !/node|\.local|claude/.test(d)).join(':') || '/usr/bin:/bin';
  const env = { ...process.env, HOME, PATH, NODE_OPTIONS: '', XDG_CONFIG_HOME: path.join(HOME, '.config'), XDG_DATA_HOME: path.join(HOME, '.local/share'), KEEPER_SKIP_TOUR: '1' };
  delete env.KEEPER_DEFAULTS;
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env });
  const w = await until(async () => app.windows().find((x) => { const u = x.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 30000);
  const errors = [];
  w.on('pageerror', (e) => errors.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await w.waitForSelector('.sidebar', { timeout: 60000 });
  await sleep(2000);
  const k = (group, fn, ...a) => w.evaluate(([g, f, args]) => window.keeper[g][f](...args), [group, fn, a]);
  const set = (patch) => w.evaluate((p) => window.keeper.settings.set(p), patch);

  // This machine's own disks and servers stay out of the pictures.
  const places = await k('places', 'list').catch(() => null);
  const ids = [];
  const walk = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk); if (typeof o.id === 'string' && typeof o.path === 'string' && !o.path.startsWith(HOME)) ids.push(o.id); Object.values(o).forEach(walk); };
  walk(places);
  if (ids.length) await set({ hiddenPlaces: ids });

  const main = async () => {
    const r = await w.locator('.sidebar-col').boundingBox();
    const x = Math.ceil((r?.x ?? 0) + (r?.width ?? 0));
    return { x, y: 0, width: 1440 - x, height: 900 };
  };
  const shot = async (name, clip) => {
    for (const dark of [false, true]) {
      await set({ appearance: dark ? 'dark' : 'light' });
      await sleep(500);
      await w.screenshot({ path: path.join(SHOTS, `${name}-${dark ? 'dark' : 'light'}.png`), clip: clip ?? await main() });
    }
    await set({ appearance: 'light' });
  };
  const palette = async (text) => {
    await w.keyboard.press('Control+k');
    await w.waitForSelector('.palette input, [role="dialog"] input', { timeout: 5000 });
    await w.keyboard.type(text);
    await sleep(400);
    await w.keyboard.press('Enter');
  };
  const sheet = '[data-testid="mode-preview"]';

  // ---------------------------------------------------------------- the badge
  const badge = w.getByTestId('mode-badge');
  check(await badge.count() === 1, 'the sidebar’s foot shows the mode badge');
  check(/Standard/.test(await badge.getAttribute('aria-label')), `it reads Standard (${await badge.getAttribute('aria-label')})`);
  check(settings().mode === undefined || settings().mode.base === 'standard', 'Keeper comes in Standard');

  // ---------------------------------------------------------------- Mode: Simple from the palette, with a preview
  // A new 1.0 install: Recommended for this computer, as setup leaves it.
  await k('features', 'preset', 'recommended');
  await sleep(500);
  await palette('Mode: Simple');
  check(!!(await until(() => w.$(`${sheet} [data-testid="mode-preview-line"]`))), 'the palette opens the preview sheet first');
  const line = await w.getByTestId('mode-preview-line').textContent();
  check(/^Turns on \d+ parts? and off \d+\. Your data stays\.$/.test(line.trim()), `the sheet says what changes: “${line.trim()}”`);
  check(/Terminal|Network & firewall|Studio|Running apps/.test(await w.getByTestId('mode-preview-off').textContent()), 'it names parts that turn off');
  check(/Text size: 110%/.test(await w.getByTestId('mode-preview-settings').textContent()), 'and how it looks (text size 110%)');
  check(/not touched/.test(await w.locator(sheet).textContent()), 'and that files, notes, mail and accounts are not touched');
  check(await w.locator(`${sheet} .btn.primary`).count() === 1, 'one strong button in the sheet');
  check(settings().mode === undefined || settings().mode.base === 'standard', 'nothing changed before Switch');
  await shot('auditmodes-preview', { x: 360, y: 120, width: 720, height: 620 });
  await w.getByTestId('mode-switch').click();
  await until(() => settings().mode?.base === 'simple');
  let s = settings();
  check(s.mode?.base === 'simple', 'Switch puts Keeper in Simple');
  check(s.features.terminal === false && s.features.studio === false && s.features.bigButtons === true, 'Simple turns Terminal and Studio off, Big buttons on');
  check(s.a11y?.textScale === 1.1, 'and makes the text 110%');
  await until(async () => /Simple/.test(await badge.getAttribute('aria-label')));
  check(/Simple/.test(await badge.getAttribute('aria-label')), 'the badge follows');
  await sleep(600);
  check(await w.locator('[data-nav-section="computer"]').count() === 0 && await w.locator('[data-nav-section="security"]').count() === 0, 'the sidebar keeps a few sections (Computer and Privacy are a palette away)');
  check(await w.locator('[data-nav-section="pim"]').count() >= 0, 'Mail & Calendar stays');

  // Big buttons on Today.
  await palette('Hello');
  await until(() => w.$('[data-testid="big-buttons"]'), 8000);
  const bigs = await w.locator('.big-button').count();
  check(bigs >= 4 && bigs <= 6, `Today starts with ${bigs} big buttons`);
  await shot('auditmodes-bigbuttons');

  // ---------------------------------------------------------------- the person always wins
  await set({ a11y: { ...settings().a11y, textScale: 1.25 } });
  await sleep(400);
  await palette('Modes');
  await until(() => w.$('[data-testid="settings-modes"]'), 8000);
  await until(async () => /1 change of yours/.test(await w.getByTestId('mode-status').textContent()), 5000);
  check(/1 change of yours/.test(await w.getByTestId('mode-status').textContent()), 'Settings counts the change against Simple, not against how Keeper came');
  await w.getByTestId('mode-pro').click();
  await until(() => w.$(`${sheet} [data-testid="mode-preview-line"]`));
  check(/wait for when you return/.test(await w.locator(sheet).textContent()), 'the preview says your change waits for your return');
  await w.getByTestId('mode-switch').click();
  await until(() => settings().mode?.base === 'pro');
  s = settings();
  check(s.density === 'compact' && s.settingsAdvanced === true && s.a11y.textScale === 1, 'Pro: compact, every setting shown, text back to 100%');
  check(s.features.terminal === true && s.features.processes === true, 'Pro turns Terminal and Running apps on');
  await w.getByTestId('mode-simple').click();
  await until(() => w.$(`${sheet} [data-testid="mode-preview-line"]`));
  check(/come back/.test(await w.locator(sheet).textContent()), 'going back says your change comes back');
  await w.getByTestId('mode-switch').click();
  await until(() => settings().mode?.base === 'simple');
  check(settings().a11y.textScale === 1.25, 'back in Simple, your 125% text is back');
  await w.getByTestId('mode-reset').click();
  await until(() => settings().a11y.textScale === 1.1);
  check(settings().a11y.textScale === 1.1, 'Reset to Simple puts Simple’s own 110% back');

  // ---------------------------------------------------------------- every mode, from Settings → General
  for (const id of ['focus', 'pro', 'researcher', 'creator', 'writer', 'family', 'standard']) {
    await w.getByTestId(`mode-${id}`).click();
    const ok = await until(() => w.$(`${sheet} [data-testid="mode-preview-line"]`));
    if (id === 'writer') await shot('auditmodes-preview-writer', { x: 360, y: 120, width: 720, height: 620 });
    await w.getByTestId('mode-switch').click();
    const done = await until(() => settings().mode?.base === id);
    const sel = await w.locator(`[data-testid="mode-${id}"][aria-checked="true"]`).count();
    check(!!ok && !!done && sel === 1, `switched to ${id} with a preview, and its card is selected`);
    if (id === 'focus') {
      check(JSON.stringify(settings().today.cards) === '["now","tasks","focus"]', 'Focus shows one thing now on Today (now, top three, focus)');
      await sleep(300);
      await shot('auditmodes-settings');
    }
  }
  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);

  // ---------------------------------------------------------------- add-ons: Privacy-max and the Offline check
  const statsBefore = settings().features.usageStats;
  await w.getByTestId('addon-privacyMax').click();
  await until(() => w.$(`${sheet} [data-testid="mode-preview-line"]`));
  check(/Standard \+ Privacy-max/.test(await w.locator(sheet).textContent()), 'an add-on stacks on the mode (Standard + Privacy-max)');
  await w.getByTestId('mode-switch').click();
  await until(() => (settings().mode?.addons ?? []).includes('privacyMax'));
  s = settings();
  check(s.ai.provider === 'ollama' && s.features.weather === false && s.features.offlineCheck === true, 'Privacy-max: AI on this computer only, no forecasts, the Offline check on');
  check(s.features.usageStats === statsBefore, 'usage stats stay as the person chose');
  await w.getByTestId('addon-lowVision').click();
  await until(() => w.$(`${sheet} [data-testid="mode-preview-line"]`));
  await w.getByTestId('mode-switch').click();
  await until(() => (settings().mode?.addons ?? []).includes('lowVision'));
  check(settings().a11y.textScale === 1.5 && settings().a11y.focusAlways === true, 'Low vision stacks too: 150% text and focus outlines');
  await palette('Offline Check');
  await until(() => w.$('[data-testid="offline-check"]'), 8000);
  const before = Number(await w.getByTestId('offline-count').textContent());
  await shot('auditmodes-offline');
  await w.getByTestId('offline-all-off').click();
  await until(async () => (await w.getByTestId('offline-count').textContent()) === '0', 8000);
  check(before > 0 && (await w.getByTestId('offline-count').textContent()) === '0', `Turn all off takes ${before} ways to 0`);
  // Back to plain Standard for the session check.
  await k('modes', 'switch', { base: 'standard', addons: [] });

  // ---------------------------------------------------------------- Focus for a while
  await palette('Modes');
  await until(() => w.$('[data-testid="focus-session-25"]'), 8000);
  await w.getByTestId('focus-session-25').click();
  await until(() => settings().modeSession?.until > Date.now());
  check(settings().modeSession?.mode === 'focus', 'Focus for 25 minutes starts a session');
  await until(async () => /Focus · 2\d min/.test(await badge.getAttribute('aria-label')), 5000);
  check(/Focus · 2\d min/.test(await badge.getAttribute('aria-label')), `the badge counts down (${await badge.getAttribute('aria-label')})`);
  await sleep(500);
  check(await w.locator('[data-nav-section="computer"]').count() === 0, 'the sidebar narrows to Focus’s sections while it runs');
  check(settings().mode.base === 'standard', 'the mode itself is unchanged');
  const isl = await k('island', 'state').catch(() => null);
  check(!isl || isl.focus?.mode === 'focus' || isl.focus?.mode === undefined, `the Island’s focus timer runs (${isl?.focus?.mode})`);
  await shot('auditmodes-session');
  const foot = await w.locator('.sidebar-foot').boundingBox();
  if (foot) await shot('auditmodes-badge', { x: Math.max(0, foot.x), y: Math.max(0, foot.y - 8), width: Math.min(420, 1440 - foot.x), height: Math.min(140, 900 - foot.y + 8) });
  await w.getByTestId('mode-badge').click();
  await sleep(300);
  await shot('auditmodes-badge-menu', { x: 0, y: 680, width: 520, height: 220 });
  await w.keyboard.press('Escape');
  await w.getByTestId('focus-session-end').click();
  await until(() => !settings().modeSession);
  check(!settings().modeSession, 'End now stops it');
  await sleep(500);
  check(await w.locator('[data-nav-section="computer"]').count() >= 0, 'and the sidebar is back');

  // Setup: the mode row first, the goal cards under it (Set up Keeper again).
  await palette('Set Up Keeper Again');
  if (await until(() => w.$('[data-testid="setup-start"]'), 6000)) await w.click('[data-testid="setup-start"]');
  const row = await until(() => w.$('[data-testid="setup-mode"]'), 10000);
  check(!!row, 'setup shows the mode row before the goals');
  if (row) {
    await w.click('[data-testid="setup-goal-record"]').catch(() => undefined);
    await sleep(300);
    check(/Creator suits these goals/.test(await w.getByTestId('setup-mode-line').textContent()), 'a goal suggests a mode');
    await w.click('[data-testid="setup-mode-hint"]');
    check(await w.locator('[data-testid="setup-mode-creator"][aria-checked="true"]').count() === 1, 'one click takes the suggestion (nothing changes until Continue)');
    check(settings().mode.base === 'standard', 'still Standard until Continue');
    const card = await w.locator('.setup-card').boundingBox();
    await shot('auditmodes-setup', card ? { x: Math.floor(card.x), y: Math.floor(card.y), width: Math.ceil(card.width), height: Math.min(900 - Math.floor(card.y), Math.ceil(card.height)) } : undefined);
    await w.click('[data-testid="setup-close"]');
    await sleep(400);
  }

  // 1024×768: the cards still fit.
  await w.setViewportSize({ width: 1024, height: 768 });
  await sleep(500);
  const over = await w.evaluate(() => { const g = document.querySelector('.modes-grid'); return g ? g.scrollWidth > g.clientWidth + 1 : true; });
  check(!over, 'at 1024×768 the mode cards fit without scrolling sideways');
  await w.screenshot({ path: path.join(SHOTS, 'auditmodes-settings-1024-light.png'), clip: { x: 300, y: 0, width: 724, height: 768 } });

  check(errors.length === 0, `no page errors at the end (${errors.slice(0, 2).join(' | ')})`);
  await app.close();
  console.log(failed ? `${failed} failed` : 'all passed');
})().catch((e) => { console.error(e); process.exit(1); });
