// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/archives.cjs /tmp/karc-home /tmp/karc-shots
// Drives the real Keeper app's Archives page: a ZIP opens and is walked into
// by folder without unpacking, one chosen file is taken out to a folder beside
// it, a 7z and a tar.xz open through the system's tar (when it is libarchive's),
// a ZIP is made with an AES-256 password and opens again only with it, a 7z
// with a password says plainly that it needs 7-Zip when that is missing, and
// "What works here" lists each kind. Light and dark at 1440×900.

const { _electron } = require('playwright');
const { execFileSync } = require('child_process');
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

// Demo files and archives of them.
const DL = path.join(HOME, 'Downloads');
const SRC = path.join(HOME, 'Documents', 'Holiday photos');
fs.mkdirSync(path.join(SRC, 'Day 2'), { recursive: true });
fs.writeFileSync(path.join(SRC, 'Beach.txt'), 'Sand and sea. '.repeat(50));
fs.writeFileSync(path.join(SRC, 'Harbour.txt'), 'Boats at dusk. '.repeat(50));
fs.writeFileSync(path.join(SRC, 'Day 2', 'Old town.txt'), 'Narrow streets. '.repeat(50));
fs.writeFileSync(path.join(HOME, 'Documents', 'Itinerary.txt'), 'Day 1: arrive. Day 2: old town.');
let bsdtar = null;
for (const b of ['bsdtar', 'tar']) { try { if (/libarchive/.test(execFileSync(b, ['--version']).toString())) { bsdtar = b; break; } } catch { /* not here */ } }
const ZIP = path.join(DL, 'Holiday photos.zip');
const SEVEN = path.join(DL, 'Holiday photos.7z');
const TXZ = path.join(DL, 'Backup.tar.xz');
if (bsdtar) {
  execFileSync(bsdtar, ['--format', 'zip', '-cf', ZIP, '-C', path.join(HOME, 'Documents'), 'Holiday photos', 'Itinerary.txt']);
  execFileSync(bsdtar, ['--format', '7zip', '-cf', SEVEN, '-C', path.join(HOME, 'Documents'), 'Holiday photos']);
  execFileSync(bsdtar, ['-cJf', TXZ, '-C', path.join(HOME, 'Documents'), 'Itinerary.txt', 'Holiday photos']);
} else {
  execFileSync('tar', ['-cJf', TXZ, '-C', path.join(HOME, 'Documents'), 'Itinerary.txt', 'Holiday photos']);
}

(async () => {
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', KEEPER_ARCHIVES_TEST: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const x = w.url(); return x && (!x.includes('view=') || x.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  // The sidebar as a rail: pictures show demo data only, never this computer's own place names.
  await main.keyboard.press('Control+Alt+KeyS').catch(() => undefined);
  const a = (fn, ...args) => main.evaluate(([f, x]) => window.keeper.archives[f](...x), [fn, args]);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const x = w.webContents.getURL(); if (!x.includes('view=') || x.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => { await wait(700); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

  // Off in Recommended; this test switches it on.
  await main.evaluate(() => window.keeper.features.set('archives', true));
  await wait(400);
  check((await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'archives')?.on === true, 'Archives is on');
  await navigate('archives');
  await main.waitForSelector('[data-testid="archives-page"] [data-testid="empty-state"]', { timeout: 15000 });
  check(await main.locator('[data-testid="archives-page"] .btn.primary').count() === 1, 'the first screen has one main action');
  await shot('archives-empty-light');

  if (bsdtar) {
    // A ZIP: look inside, walk into a folder, take one file out.
    await navigate(`archives:${ZIP}`);
    await main.waitForSelector('[data-testid="arc-list"] .arc-row', { timeout: 15000 });
    check((await main.locator('[data-testid="arc-name"]').innerText()) === 'Holiday photos.zip', 'the ZIP opens');
    check(!fs.existsSync(path.join(DL, 'Holiday photos')), 'looking inside unpacks nothing');
    await main.locator('.arc-open-row', { hasText: 'Holiday photos' }).click();
    await until(async () => (await main.locator('.arc-open-row', { hasText: 'Beach.txt' }).count()) === 1, 5000);
    check(await main.locator('.arc-open-row', { hasText: 'Day 2' }).count() === 1 && await main.locator('.arc-crumbs button').count() === 2, 'walking into a folder shows its files and a breadcrumb');
    await main.locator('.arc-row', { hasText: 'Beach.txt' }).getByRole('checkbox').click();
    await shot('archives-zip-light');
    await main.click('[data-testid="arc-extract-some"]');
    const out = path.join(DL, 'Holiday photos', 'Holiday photos', 'Beach.txt');
    check(!!(await until(() => fs.existsSync(out))), 'one chosen file is taken out to a folder beside the archive');
    check(!fs.existsSync(path.join(DL, 'Holiday photos', 'Holiday photos', 'Harbour.txt')), 'and only that one');
    // Quick Look inside without unpacking beside it.
    const peek = await a('peek', ZIP, 'Itinerary.txt');
    check(fs.readFileSync(peek, 'utf8').startsWith('Day 1') && !peek.startsWith(DL), 'Quick Look reads a file from the archive in Keeper’s own preview folder');

    // A 7z through the system's tar.
    const s = await a('open', SEVEN);
    check(s.format === '7z' && s.entries.some((e) => e.name.endsWith('Old town.txt')) && s.engine === 'bsdtar', `a 7z opens through the system tar (${s.engine ?? s.note})`);
    const r7 = await a('extract', SEVEN, null, {});
    check(fs.existsSync(path.join(r7.dest, 'Holiday photos', 'Day 2', 'Old town.txt')), 'and everything in it can be taken out');
  } else console.log('SKIP ZIP and 7z through libarchive: no bsdtar here');

  // A tar.xz.
  const x = await a('open', TXZ);
  check(x.format === 'tar.xz' && x.entries.some((e) => e.name.endsWith('Itinerary.txt')), `a tar.xz opens (${x.engine})`);
  const rx = await a('extract', TXZ, ['Holiday photos/Day 2'], {});
  check(fs.existsSync(path.join(rx.dest, 'Holiday photos', 'Day 2', 'Old town.txt')) && !fs.existsSync(path.join(rx.dest, 'Itinerary.txt')), 'a chosen folder comes out with what is in it, and nothing else');

  // Make a ZIP with a password from the page.
  await navigate(`archives:${JSON.stringify({ make: [SRC] })}`);
  await main.waitForSelector('[data-testid="arc-make-sheet"]', { timeout: 10000 });
  check((await main.locator('[data-testid="arc-items"]').innerText()).includes('Holiday photos'), 'Make an archive starts with the chosen folder');
  await main.locator('.arc-check').click();
  await main.fill('[aria-label="Password"]', 'sunny days');
  await main.fill('[aria-label="Password again"]', 'sunny day');
  check(await main.locator('[data-testid="arc-make-go"]').isDisabled() && /differ/.test(await main.locator('[data-testid="arc-make-sheet"]').innerText()), 'two different passwords are caught');
  await main.fill('[aria-label="Password again"]', 'sunny days');
  await shot('archives-make-light');
  await main.click('[data-testid="arc-make-go"]');
  const made = path.join(HOME, 'Documents', 'Holiday photos.zip');
  check(!!(await until(() => fs.existsSync(made))), 'a ZIP is made next to the folder');
  const opened = await a('open', made);
  check(opened.encrypted && opened.entries.filter((e) => !e.dir).every((e) => e.encrypted), 'every file in it is protected');
  const wrong = await a('extract', made, null, { password: 'nope' }).then(() => 'ok', (e) => String(e));
  check(/Wrong password/.test(wrong), 'a wrong password is refused');
  const right = await a('extract', made, null, { password: 'sunny days' });
  check(fs.readFileSync(path.join(right.dest, 'Holiday photos', 'Day 2', 'Old town.txt'), 'utf8').startsWith('Narrow streets'), 'the right password opens it');
  if (bsdtar) {
    const dir = path.join(HOME, 'libarchive-check');
    fs.mkdirSync(dir);
    execFileSync(bsdtar, ['-xf', made, '--passphrase', 'sunny days', '-C', dir]);
    check(fs.existsSync(path.join(dir, 'Holiday photos', 'Beach.txt')), 'other archive programs open it too (libarchive)');
  }

  // 7z with a password needs 7-Zip: said plainly.
  const support = await a('support');
  if (!support.sevenZip) {
    const r = await a('create', [SRC], { format: '7z', password: 'x' }).then(() => 'ok', (e) => String(e));
    check(/needs the free 7-Zip program/.test(r), '7z with a password says it needs 7-Zip here');
  } else console.log('SKIP the missing 7-Zip message: 7-Zip is installed here');
  check(support.rows.length >= 5 && support.rows.some((r) => r.format === 'RAR' && /Never made/.test(r.create)), 'What works here lists each kind');

  // What works here, and dark.
  await main.keyboard.press('Escape').catch(() => undefined);
  await navigate(`archives:${bsdtar ? ZIP : TXZ}`);
  await main.waitForSelector('[data-testid="arc-list"] .arc-row', { timeout: 15000 });
  await main.click('[data-testid="arc-support-toggle"]');
  await main.waitForSelector('[data-testid="arc-support"] table', { timeout: 10000 });
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await main.evaluate(() => document.querySelector('[data-testid="arc-support-toggle"]')?.scrollIntoView({ block: 'center' }));
  await shot('archives-support-dark');
  await main.evaluate(() => document.querySelector('[data-testid="archives-page"]')?.scrollIntoView({ block: 'start' }));
  await shot('archives-zip-dark');
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));

  check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await app.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
