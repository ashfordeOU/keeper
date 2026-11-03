// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a node test/e2e/notes-import.cjs /tmp/kni /tmp/kni-shots
// Drives the real Keeper app's Import notes and Export: an Evernote export
// comes in through the dialog (pick the app → steps → what will come in →
// progress → result), shows in the tree and search, Undo takes it back;
// 5,000 notes import with progress and Cancel while the page keeps
// answering; a note is exported as PDF and the vault as Markdown.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const HOME = process.argv[2];
const SHOTS = process.argv[3];
const ROOT = path.resolve(__dirname, '../..');
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const DATA = path.join(HOME, '.config', 'Keeper');
const VAULT = path.join(HOME, 'Documents', 'My Vault');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(VAULT, { recursive: true });
fs.writeFileSync(path.join(VAULT, 'Welcome.md'), '# Welcome\n\nMy own note.\n');
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };

(async () => {
  const { makeFixtures } = await import(path.join(ROOT, 'test/fixtures/notes-import/make.mjs'));
  const FX = makeFixtures(path.join(HOME, 'exports'));
  const BIG = path.join(HOME, 'exports', 'big');
  fs.mkdirSync(BIG, { recursive: true });
  for (let i = 0; i < 5000; i++) fs.writeFileSync(path.join(BIG, `n${i}.txt`), `Big note ${i}\nabout token${i}`);

  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 40 && !main; i++) { main = app.windows().find((x) => x.url().includes('view=app')); if (!main) await new Promise((r) => setTimeout(r, 500)); }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForTimeout(2500);
  const skip = await main.$('.tour button:has-text("Skip tour")');
  if (skip) await skip.click();
  // The system file pickers answer with a chosen path (they cannot be clicked under Xvfb).
  const pick = (p) => app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, p);
  const shot = async (name, dark) => {
    await main.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark).catch(() => undefined);
    await main.waitForTimeout(500);
    await main.screenshot({ path: `${SHOTS}/notes-${name}-${dark ? 'dark' : 'light'}.png` });
  };
  const openImport = async () => {
    await main.locator('.nt-vault-btn').click();
    await main.getByRole('menuitem', { name: 'Import notes…' }).click();
    await main.waitForSelector('[data-testid=notes-import] .ni-apps', { timeout: 10000 });
  };

  try {
    await main.locator('.sidebar [data-nav-key="nav:notes"]').click();
    await main.getByRole('button', { name: /Open folder as vault/ }).waitFor({ timeout: 15000 });
    await main.evaluate((p) => window.keeper.notes.addVault(p), VAULT);
    await main.locator('.sidebar [data-nav-key="nav:noteshub"]').click().catch(() => undefined);
    await main.locator('.sidebar [data-nav-key="nav:notes"]').click();
    await main.locator('.nt-vault-open', { hasText: 'My Vault' }).click();
    await main.waitForSelector('.nt-tree-row[data-path="Welcome.md"]', { timeout: 15000 });

    // 1. Evernote, through the dialog.
    await openImport();
    const apps = await main.locator('.ni-app').allInnerTexts();
    check(apps.length >= 12 && apps.some((a) => a.includes('Evernote')) && apps.some((a) => a.includes('Google Keep')) && apps.some((a) => a.includes('Simplenote')), `the dialog lists the apps: ${apps.length}`);
    await shot('import-pick', false);
    await shot('import-pick', true);
    await main.locator('.ni-app', { hasText: 'Evernote' }).first().click();
    check(await main.locator('.ni-list li').count() === 3, 'Evernote shows three plain steps');
    await pick(FX.evernote);
    await main.getByRole('button', { name: 'Choose file…' }).click();
    await main.waitForSelector('.ni-path:has-text("Garden.enex")');
    await main.getByRole('button', { name: 'Continue' }).click();
    await main.waitForSelector('.ni-ready', { timeout: 15000 });
    const big = await main.locator('.ni-big').innerText();
    check(/3 notes/.test(big) && /2 pictures and files/.test(big), `it says what will come in: ${big}`);
    await shot('import-ready', false);
    await main.getByRole('button', { name: 'Import 3 notes' }).click();
    await main.waitForSelector('.ni-done h2', { timeout: 20000 });
    const done = await main.locator('.ni-done').innerText();
    check(/3 notes and 2 files in “From Evernote”/.test(done), `the result says what came in: ${done.split('\n').slice(0, 2).join(' ')}`);
    await shot('import-done', false);
    await shot('import-done', true);
    const garden = path.join(VAULT, 'From Evernote', 'Garden', 'Garden plan.md');
    check(fs.existsSync(garden) && fs.readFileSync(garden, 'utf8').includes('- [x] Order compost') && fs.existsSync(path.join(VAULT, 'From Evernote', 'attachments', 'leaf.png')), 'the notes and their pictures are files in the vault');
    await main.getByRole('button', { name: 'Show notes' }).click();
    await main.waitForSelector('.nt-tree-row[data-path="From Evernote/Garden/Café ☕ plans — 東京.md"]', { timeout: 10000 });
    check(true, 'the imported notes show in the tree, the first one open');
    await main.getByRole('textbox', { name: 'Search notes' }).fill('Tomatoes');
    await main.waitForSelector('.nt-hit-title:has-text("Garden plan")', { timeout: 10000 });
    check(true, 'search finds text from an imported table');
    await main.getByRole('textbox', { name: 'Search notes' }).press('Escape');

    // 2. Undo, from the dialog's list of earlier imports.
    await openImport();
    await main.locator('.ni-earlier-row', { hasText: 'From Evernote' }).getByRole('button', { name: 'Undo' }).click();
    await main.waitForTimeout(800);
    check(!fs.existsSync(path.join(VAULT, 'From Evernote')) && fs.existsSync(path.join(VAULT, 'Welcome.md')), 'Undo removes exactly what the import wrote');
    await main.getByRole('button', { name: 'Close' }).first().click().catch(() => main.keyboard.press('Escape'));
    await main.waitForTimeout(1500);
    await main.screenshot({ path: `${SHOTS}/notes-after-undo.png` });
    check(!fs.existsSync(path.join(VAULT, 'From Evernote')) && await main.locator('.nt-empty-pane.is-small, .nt-tab-name:has-text("Café")').count() !== 1 || await main.locator('.nt-empty-pane.is-small').count() === 1, 'a note open when its import is undone says it is gone, and is not written back');

    // 3. 5,000 notes: progress, the page keeps answering, Cancel, then all of them.
    await openImport();
    await main.locator('.ni-app', { hasText: 'Simplenote' }).click();
    await pick(BIG);
    await main.getByRole('button', { name: 'Or a folder…' }).click();
    await main.getByRole('button', { name: 'Continue' }).click();
    await main.waitForSelector('.ni-ready', { timeout: 60000 });
    check(/5,000 notes/.test(await main.locator('.ni-big').innerText()), 'it found 5,000 notes');
    await main.getByRole('button', { name: 'Import 5,000 notes' }).click();
    await main.waitForSelector('.ni-writing .ni-count', { timeout: 10000 });
    const t0 = Date.now();
    const answered = await main.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(true))));
    check(answered && Date.now() - t0 < 1000, `the window keeps drawing while notes are written (${Date.now() - t0} ms)`);
    await shot('import-progress', false);
    await main.waitForSelector('.ni-done h2', { timeout: 120000 });
    const bigDone = await main.locator('.ni-done').innerText();
    check(/5,000 notes/.test(bigDone), `all 5,000 came in: ${bigDone.split('\n')[1]}`);
    await main.getByRole('button', { name: 'Done' }).click();
    const files = await main.evaluate(async () => { const v = (await window.keeper.notes.vaults())[0]; return (await window.keeper.notes.open(v.id)).files.length; });
    check(files >= 5001, `the vault index has every note: ${files}`);
    await main.getByRole('textbox', { name: 'Search notes' }).fill('token4999');
    await main.waitForSelector('.nt-hit-title:has-text("Big note 4999")', { timeout: 15000 });
    check(true, 'search finds the last of 5,000 notes');
    await main.getByRole('textbox', { name: 'Search notes' }).press('Escape');
    // The tree draws only what is on screen, and scrolls to the end.
    await main.locator('.nt-tree-row', { hasText: 'From Simplenote' }).first().click();
    await main.waitForTimeout(300);
    const rowsDrawn = await main.locator('.nt-tree-row').count();
    const tall = await main.locator('.nt-virtual').evaluate((el) => { el.scrollTop = el.scrollHeight; return el.scrollHeight; });
    await main.waitForTimeout(300);
    const tail = await main.locator('.nt-tree-row').allInnerTexts();
    check(rowsDrawn < 200 && tall > 5000 * 28 && tail[tail.length - 1].includes('Welcome') && tail.some((t) => /Big note \d+/.test(t)), `the tree holds all 5,000 rows but draws only what is on screen (${rowsDrawn} drawn), down to the last one (${tall}px, last ${tail[tail.length - 1]})`);

    // 4. Export: one note as PDF; the vault as Markdown.
    await main.locator('.nt-tree-row[data-path="Welcome.md"]').scrollIntoViewIfNeeded().catch(() => undefined);
    await main.getByRole('textbox', { name: 'Search notes' }).fill('My own note');
    await main.locator('.nt-hit-title', { hasText: 'Welcome' }).click();
    await main.getByRole('textbox', { name: 'Search notes' }).press('Escape');
    await main.getByRole('button', { name: 'More for this note' }).click();
    await main.getByRole('menuitem', { name: 'Export this note…' }).click();
    await main.waitForSelector('[data-testid=notes-export]');
    await shot('export', false);
    const pdf = path.join(HOME, 'Welcome.pdf');
    await pick(pdf);
    await main.locator('.ni-format', { hasText: 'PDF' }).click();
    await main.getByRole('button', { name: 'Export…' }).click();
    for (let i = 0; i < 40 && !fs.existsSync(pdf); i++) await main.waitForTimeout(250);
    check(fs.existsSync(pdf) && fs.readFileSync(pdf).subarray(0, 5).toString() === '%PDF-', 'the note is saved as a PDF');
    const mdOut = path.join(HOME, 'md-export');
    fs.mkdirSync(mdOut, { recursive: true });
    await pick(mdOut);
    await main.locator('.nt-vault-btn').click();
    await main.getByRole('menuitem', { name: 'Export notes…' }).click();
    await main.locator('.ni-format', { hasText: 'Markdown folder' }).click();
    await main.getByRole('button', { name: 'Export…' }).click();
    const outDir = path.join(mdOut, 'My Vault');
    for (let i = 0; i < 80 && !fs.existsSync(path.join(outDir, 'Welcome.md')); i++) await main.waitForTimeout(250);
    check(fs.existsSync(path.join(outDir, 'Welcome.md')) && fs.readFileSync(path.join(outDir, 'Welcome.md'), 'utf8') === fs.readFileSync(path.join(VAULT, 'Welcome.md'), 'utf8'), 'the vault is exported as a Markdown folder');
  } catch (e) {
    check(false, `step failed: ${e.message.split('\n')[0]}`);
    await main.screenshot({ path: `${SHOTS}/notes-import-failure.png` }).catch(() => undefined);
  }
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
})();
