// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/fixit.cjs /tmp/kfx /tmp/kfx-shots
// Drives the real Keeper app's Fix-it List with real findings from a test home:
// four Chrome extensions with broad access (one named through _locales), and,
// after Keeper's first look, a GitHub Actions runner service and an unsigned
// autostart entry. Checks: rows grouped and named, details gathered on opening
// (mouse and keyboard), Trust (kept on disk, back with "changed" when the item
// changes, Stop trusting), Snooze and Undo, multi-select Trust/Snooze, and
// Turn it off with Undo (the file is put back from Keeper's copy).
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const ROOT = path.resolve(__dirname, '../..');
let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) { failed++; process.exitCode = 1; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(step); } return null; };

fs.rmSync(HOME, { recursive: true, force: true });
for (const d of ['Downloads', 'Desktop', 'Documents', '.config/systemd/user', '.config/autostart', 'actions-runner', '.helper']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
const STUB = path.join(HOME, 'opened.jsonl');

// Chrome with four extensions that can read every site; one is named only through _locales.
const chrome = path.join(HOME, '.config/google-chrome');
const IDS = { readwise: 'jjhefcfhmnkfeepcpnilbbkaadhngkbi', video: 'bmjmipppabdlpjccanalncobmbacckjn', tabs: 'llangkpnndilncfkpgcpolnmgjgnompo', coupon: 'aaaabbbbccccddddeeeeffffgggghhhh' };
const ext = (id, manifest, locales) => {
  const d = path.join(chrome, 'Default/Extensions', id, '1.0_0');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(manifest));
  for (const [loc, msgs] of Object.entries(locales || {})) { fs.mkdirSync(path.join(d, '_locales', loc), { recursive: true }); fs.writeFileSync(path.join(d, '_locales', loc, 'messages.json'), JSON.stringify(msgs)); }
};
fs.mkdirSync(path.join(chrome, 'Default'), { recursive: true });
fs.writeFileSync(path.join(chrome, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Work' } } } }));
fs.writeFileSync(path.join(chrome, 'Default/Preferences'), JSON.stringify({ extensions: { settings: Object.fromEntries(Object.values(IDS).map((id) => [id, { state: 1, from_webstore: true, location: 1 }])) } }));
ext(IDS.readwise, { name: '__MSG_appName__', default_locale: 'en', version: '0.17.1', manifest_version: 3, permissions: ['contextMenus', 'storage'], host_permissions: ['<all_urls>'] }, { en: { appName: { message: 'Readwise Highlighter' } } });
ext(IDS.video, { name: 'Video Downloader Professional', version: '1.5.3', manifest_version: 3, permissions: ['downloads'], host_permissions: ['<all_urls>'] });
ext(IDS.tabs, { name: 'Tab Session Manager', version: '6.12.2', manifest_version: 3, permissions: ['tabs', 'storage'], host_permissions: ['<all_urls>'] });
ext(IDS.coupon, { name: 'Coupon Finder', version: '2.3', manifest_version: 3, permissions: ['cookies'], host_permissions: ['<all_urls>'] });

// Already there at Keeper's first look: not new, so not listed.
fs.writeFileSync(path.join(HOME, '.config/autostart/existing.desktop'), '[Desktop Entry]\nType=Application\nName=Existing\nExec=/usr/bin/true\n');
// The runner's own folder, with the file that names its repository.
fs.writeFileSync(path.join(HOME, 'actions-runner/runsvc.sh'), '#!/bin/sh\necho runner\n', { mode: 0o755 });
fs.writeFileSync(path.join(HOME, 'actions-runner/.runner'), JSON.stringify({ agentName: 'arksa-linux-1', gitHubUrl: 'https://github.com/ashfordeOU/arksa', workFolder: '_work' }));
fs.writeFileSync(path.join(HOME, '.helper/updater'), '#!/bin/sh\nsleep 1\n', { mode: 0o755 });
const RUNNER = path.join(HOME, '.config/systemd/user/actions.runner.ashfordeOU-arksa.arksa-linux-1.service');
const HELPER = path.join(HOME, '.config/autostart/updater-helper.desktop');

(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', KEEPER_SKIP_TOUR: '1', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: path.join(HOME, '.config'), XDG_DATA_HOME: path.join(HOME, '.local/share'), KEEPER_GUIDE_OPEN_STUB: STUB } });
  const w = await until(async () => app.windows().find((x) => { const u = x.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 30000, 200);
  const errors = [];
  w.on('pageerror', (e) => errors.push(e.message));
  await w.setViewportSize({ width: 1280, height: 860 }).catch(() => undefined);
  await w.waitForSelector('.sidebar', { timeout: 60000 });
  const skip = await w.$('text=Skip setup');
  if (skip) await skip.click().catch(() => undefined);
  const sec = (fn, ...a) => w.evaluate(([f, args]) => window.keeper.security[f](...args), [fn, a]);
  const guide = (fn, ...a) => w.evaluate(([f, args]) => window.keeper.guide[f](...args), [fn, a]);
  const shot = async (name, dark) => {
    await w.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark);
    await w.waitForTimeout(500);
    await w.screenshot({ path: path.join(SHOTS, `${name}-${dark ? 'dark' : 'light'}.png`) });
  };

  // Keeper's first look records what is already there; then two new things are set to start.
  check(!!(await until(async () => (await sec('persistence')).some((p) => p.name === 'existing.desktop'), 30000)), 'Keeper took its first look at what starts automatically');
  fs.writeFileSync(RUNNER, `[Unit]\nDescription=GitHub Actions Runner (ashfordeOU-arksa.arksa-linux-1)\n[Service]\nExecStart=${HOME}/actions-runner/runsvc.sh\nWorkingDirectory=${HOME}/actions-runner\n[Install]\nWantedBy=default.target\n`);
  fs.writeFileSync(HELPER, `[Desktop Entry]\nType=Application\nName=Updater\nExec=${HOME}/.helper/updater --silent\n`);
  check(!!(await until(async () => (await sec('persistence')).filter((p) => /actions\.runner|updater-helper/.test(p.name)).length === 2, 20000)), 'the two new startup items were noticed');

  await w.click('.sidebar [title="Fix-it List"]');
  const rows = w.locator('[data-testid="fixit-row"]');
  const row = (text) => rows.filter({ hasText: text }).first();
  const RUNNER_TITLE = 'GitHub Actions runner for ashfordeOU/arksa starts automatically';
  await w.getByRole('button', { name: /Check again/ }).click();
  check(!!(await until(async () => (await row(RUNNER_TITLE).count()) > 0, 60000)), 'the runner is recognised by name');
  const titles = await w.locator('.fx-head .finding-title').allTextContents();
  check(!titles.some((t) => /actions\.runner/.test(t) && !/GitHub/.test(t)), 'no raw runner label as a title');
  check(titles.some((t) => t === 'Something new runs at login: updater-helper'), `the unknown item says “Something new runs at login” (${titles.filter((t) => /login|automatically/.test(t)).join(' | ')})`);
  check(!(await w.locator('.fx-list').textContent()).match(/malware/i), 'nothing calls it malware');
  check(!titles.some((t) => /existing/.test(t)), 'what was there at the first look is not listed as new');
  check((await row(RUNNER_TITLE).locator('.badge').textContent()) === 'Good to know', 'the runner is Good to know (low)');
  // Linux has no code signatures, so an unknown item is low there (unsigned on macOS and Windows: medium). Calm words either way.
  check(['Good to know', 'When you have time'].includes(await row('updater-helper').locator('.badge').textContent()), 'severity is in calm, plain words');

  // The four extensions are shown together, with real names.
  const group = w.locator('[data-testid="fixit-group"]', { hasText: '4 browser extensions with broad access' });
  check(await group.count() === 1, 'four extensions are grouped');
  await group.locator('.fx-toggle').first().click();
  check(await w.locator('.fx-head .finding-title', { hasText: 'Chrome: the extension “Readwise Highlighter” has broad access' }).count() === 1, 'the __MSG_ name is resolved from _locales');
  check(await w.locator('.fx-head .finding-title', { hasText: IDS.readwise }).count() === 0, 'no extension is shown by its id');

  // Details, gathered on opening.
  await row(RUNNER_TITLE).locator('.fx-toggle').click();
  const details = row(RUNNER_TITLE).locator('.fx-details');
  check(!!(await until(async () => (await details.textContent()).includes('Who made it'), 20000)), 'opening the row shows its details');
  const dtext = await details.textContent();
  check(dtext.includes(`${HOME}/actions-runner/runsvc.sh`), 'the details say what it runs');
  check(dtext.includes('https://github.com/ashfordeOU/arksa') && dtext.includes('arksa-linux-1'), 'the details name the repository and runner from .runner');
  check(dtext.includes('ExecStart='), 'the details show the file’s contents');
  check(dtext.includes('Why it is on the list') && /Learn more/.test(dtext), 'the details say why, how sure, and link to more');
  check(await row(RUNNER_TITLE).locator('.fx-toggle').getAttribute('aria-expanded') === 'true', 'the toggle says it is expanded');
  await row(RUNNER_TITLE).scrollIntoViewIfNeeded();
  await w.evaluate(() => document.querySelector('.fx-row.open')?.scrollIntoView({ block: 'start' }));
  await shot('fixit-expanded', false);
  await shot('fixit-expanded', true);
  // Keyboard: the toggle is a button; Enter closes and opens it.
  const extRow = row('Readwise Highlighter');
  await extRow.locator('.fx-toggle').focus();
  await w.keyboard.press('Enter');
  check(!!(await until(async () => (await extRow.locator('.fx-details').textContent().catch(() => '')).includes('What it may do'), 10000)), 'Enter opens a row; the extension’s permissions are explained');
  const etext = await extRow.locator('.fx-details').textContent();
  check(etext.includes('read and change every website you visit') && etext.includes(IDS.readwise) && etext.includes('0.17.1') && etext.includes('chromewebstore.google.com'), 'extension details: permissions, id, version, store link');
  await w.keyboard.press('Enter');
  check(await extRow.locator('.fx-details').count() === 0, 'Enter closes it again');
  // Show in the file manager (recorded, not opened, in tests).
  await row(RUNNER_TITLE).locator('.fx-detail-actions button', { hasText: /^ ?Show in/ }).click();
  await wait(500);
  check(fs.existsSync(STUB) && fs.readFileSync(STUB, 'utf8').includes(RUNNER), 'Show in the file manager points at the file');

  // Trust: gone from the list, kept on disk with its fingerprint, listed under trusted.
  // Fix is the one action on the row; Trust, Snooze and Ignore are under More.
  check(await row(RUNNER_TITLE).locator('.fx-actions button').count() === 2, 'the row shows only Fix and More');
  await row(RUNNER_TITLE).getByTestId('fixit-more').click();
  await w.getByTestId('fixit-trust').click();
  check(!!(await until(async () => (await row(RUNNER_TITLE).count()) === 0, 10000)), 'Trust removes the row');
  const saved = await until(() => { try { const s = JSON.parse(fs.readFileSync(path.join(HOME, '.config/Keeper/guide.json'), 'utf8')); return Object.entries(s).find(([k, v]) => k.includes('actions.runner') && v.trusted?.fp); } catch { return null; } }, 5000);
  check(!!saved, 'the trust is saved with the item’s fingerprint');
  await w.getByTestId('fixit-later-tab').click();
  check(await row(RUNNER_TITLE).getByTestId('fixit-bring-back').textContent().then((t) => /Stop trusting/.test(t)), 'the trusted item is listed with Stop trusting');
  await w.getByTestId('fixit-later-tab').click();

  // The runner's service changes: it comes back, marked changed.
  fs.writeFileSync(RUNNER, fs.readFileSync(RUNNER, 'utf8').replace('runsvc.sh', 'runsvc.sh --check'));
  check(!!(await until(async () => (await sec('persistence')).some((p) => /actions\.runner/.test(p.name) && /--check/.test(p.command)), 20000)), 'the change was noticed');
  await w.getByRole('button', { name: /Check again/ }).click();
  check(!!(await until(async () => (await row(RUNNER_TITLE).count()) > 0, 30000)), 'a trusted item that changed comes back');
  check(/Changed since you trusted it/.test(await row(RUNNER_TITLE).textContent()), 'it says it changed since it was trusted');

  // Snooze and Undo.
  await row('updater-helper').getByTestId('fixit-more').click();
  await w.getByRole('menuitem', { name: 'Snooze for 1 week' }).click();
  check(!!(await until(async () => (await row('updater-helper').count()) === 0, 10000)), 'Snooze for a week hides it');
  await w.getByTestId('fixit-later-tab').click();
  check(/Snoozed until/.test(await row('updater-helper').textContent()), 'it is listed as snoozed');
  await row('updater-helper').getByTestId('fixit-bring-back').click();
  await w.getByTestId('fixit-later-tab').click();
  check(!!(await until(async () => (await row('updater-helper').count()) === 1, 10000)), 'Undo brings it back');

  // Multi-select: trust two extensions, snooze the rest of the group for a day.
  await w.locator('[data-testid="fixit-group"] .fx-toggle').first().click().catch(() => undefined);
  if (!(await row('Coupon Finder').isVisible().catch(() => false))) await w.locator('[data-testid="fixit-group"] .fx-toggle').first().click();
  await row('Coupon Finder').getByRole('checkbox').click();
  await row('Video Downloader Professional').getByRole('checkbox').click();
  check(/2 selected/.test(await w.locator('.fx-bulk').textContent()), 'two rows selected');
  await w.getByTestId('fixit-bulk-trust').click();
  check(!!(await until(async () => (await row('Coupon Finder').count()) === 0 && (await row('Video Downloader Professional').count()) === 0, 10000)), 'Trust selected trusts both');
  check(await w.locator('[data-testid="fixit-group"]', { hasText: 'browser extensions' }).count() === 0, 'two left are no longer grouped');
  await row('Readwise Highlighter').getByRole('checkbox').click();
  await row('Tab Session Manager').getByRole('checkbox').click();
  await w.getByTestId('fixit-bulk-snooze').click();
  await w.getByRole('menuitem', { name: '1 day' }).click();
  check(!!(await until(async () => (await row('Readwise Highlighter').count()) === 0 && (await row('Tab Session Manager').count()) === 0, 10000)), 'Snooze selected snoozes both');
  const states = await guide('list');
  check(states.findings.filter((f) => f.status === 'trusted').length === 2 && states.findings.filter((f) => f.status === 'snoozed').length === 2, 'two trusted and two snoozed');
  await w.getByTestId('fixit-later-tab').click();
  await w.locator('[data-testid="fixit-group"] .fx-toggle').first().click().catch(() => undefined);
  check(await w.getByTestId('fixit-bring-back').filter({ hasText: 'Stop trusting' }).count() === 2 && await w.getByTestId('fixit-bring-back').filter({ hasText: 'Undo' }).count() === 2, 'trusted items offer Stop trusting, snoozed ones Undo');
  await w.waitForTimeout(8500); // the toasts fade
  await shot('fixit-trusted', false);
  await shot('fixit-trusted', true);
  await w.getByTestId('fixit-later-tab').click();

  // Fix: turn off the unknown item; Undo puts the file back from Keeper's copy.
  await row('updater-helper').getByTestId('fixit-fix').click();
  await w.waitForSelector('.guide-panel >> text=/A copy of the file is kept/', { timeout: 20000 });
  check(await w.locator('.guide-panel').getByText(HELPER).count() > 0, 'the confirmation names the file');
  await w.locator('.guide-panel').getByRole('button', { name: /Turn it off/ }).click();
  check(!!(await until(() => !fs.existsSync(HELPER), 15000)), 'Turn it off removes the autostart file');
  await w.locator('.guide-panel').getByRole('button', { name: /Undo/ }).click();
  check(!!(await until(() => fs.existsSync(HELPER) && fs.readFileSync(HELPER, 'utf8').includes('updater --silent'), 15000)), 'Undo puts it back');
  await w.keyboard.press('Escape');

  // The trusts are on disk for the next start (the guide reads guide.json when it starts).
  let back = null;
  try { back = JSON.parse(fs.readFileSync(path.join(HOME, '.config/Keeper/guide.json'), 'utf8')); } catch { /* checked below */ }
  check(!!back && Object.values(back).filter((s) => s.trusted).length >= 3, 'the trusts are on disk for the next start');

  check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  await app.close();
  console.log(failed ? `${failed} failed` : 'all passed');
})().catch((e) => { console.error(e); process.exit(1); });
