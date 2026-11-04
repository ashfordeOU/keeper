// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/pdf-reader.cjs /tmp/kpdf-home /tmp/kpdf-shots
// Drives the real Keeper app's PDF Reader on a demo PDF made here: find, a
// highlight on selected text, a note, freehand ink, a text box, a typed
// signature, a filled form, a page turned, one removed and pages added from
// another PDF, dark pages; Save writes it all into the PDF (read back with
// pdf-lib: standard annotations, the signature on the page, the field values,
// the pages), and Restore the last version puts the old one back. Light and dark.

const { _electron } = require('playwright');
const { PDFDocument, StandardFonts, PDFName, PDFArray } = require('pdf-lib');
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

const PDF = path.join(HOME, 'Documents', 'Garden club newsletter.pdf');
const EXTRA = path.join(HOME, 'Documents', 'Appendix.pdf');

async function makePdfs() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const lines = [
    'The spring plant sale raised enough for two new raised beds.',
    'The committee agreed the budget for seeds and compost this year.',
    'Volunteers are needed for the watering rota in July and August.',
    'Please bring cuttings to swap at the next meeting in the hall.',
  ];
  for (let i = 0; i < 3; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(['Garden Club Newsletter', 'Summer events', 'Sign-up sheet'][i], { x: 72, y: 720, size: 22, font: bold });
    lines.forEach((l, k) => p.drawText(l, { x: 72, y: 680 - k * 22, size: 13, font }));
  }
  const form = doc.getForm();
  const name = form.createTextField('member_name');
  name.addToPage(doc.getPage(2), { x: 72, y: 520, width: 260, height: 22 });
  const agree = form.createCheckBox('join_rota');
  agree.addToPage(doc.getPage(2), { x: 72, y: 480, width: 16, height: 16 });
  fs.writeFileSync(PDF, await doc.save());
  const ex = await PDFDocument.create();
  const p = ex.addPage([612, 792]);
  p.drawText('Appendix: planting calendar', { x: 72, y: 720, size: 20, font: await ex.embedFont(StandardFonts.HelveticaBold) });
  fs.writeFileSync(EXTRA, await ex.save());
}

(async () => {
  await makePdfs();
  const original = fs.readFileSync(PDF);
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', KEEPER_PDF_TEST: '1', KEEPER_PDF_TEST_ADD: EXTRA, XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const x = w.url(); return x && (!x.includes('view=') || x.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  await main.keyboard.press('Control+Alt+KeyS').catch(() => undefined);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const x = w.webContents.getURL(); if (!x.includes('view=') || x.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => { await wait(800); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

  await main.evaluate(() => window.keeper.features.set('pdfReader', true));
  await wait(500);
  await navigate('pdf');
  await main.waitForSelector('[data-testid="pdf-page"] [data-testid="empty-state"]', { timeout: 15000 });
  await shot('pdf-empty-light');

  await navigate(`pdf:${PDF}`);
  await main.waitForSelector('[data-testid="pdf-page-0"] canvas', { timeout: 20000 });
  await main.waitForSelector('[data-testid="pdf-page-0"] .textLayer span', { timeout: 10000 });
  check(await main.locator('.pdr-title h1').innerText() === 'Garden club newsletter.pdf', 'the PDF opens with its name as the title');
  check(await main.locator('[data-testid="pdf-page"] .btn.primary').count() === 1, 'one main action: Save');

  // Find.
  await main.fill('[data-testid="pdf-find"]', 'budget');
  await main.press('[data-testid="pdf-find"]', 'Enter');
  check((await until(async () => (await main.locator('[data-testid="pdf-hits"]').innerText().catch(() => '')).includes('of 3'))) !== null, 'Find counts the pages with the word');
  await main.fill('[data-testid="pdf-find"]', '');

  // Highlight selected text on page 1.
  await main.click('[data-testid="pdf-tool-highlight"]');
  const span = main.locator('[data-testid="pdf-page-0"] .textLayer span', { hasText: 'committee agreed' }).first();
  const b = await span.boundingBox();
  await main.mouse.move(b.x + 2, b.y + b.height / 2);
  await main.mouse.down();
  await main.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2, { steps: 8 });
  await main.mouse.up();
  check(!!(await until(async () => (await main.locator('[data-testid="pdf-page-0"] [data-kind="highlight"]').count()) === 1, 4000)), 'selected text gets a highlight');

  // Freehand on page 1.
  await main.click('[data-testid="pdf-tool-draw"]');
  const p0 = await main.locator('[data-testid="pdf-page-0"]').boundingBox();
  await main.mouse.move(p0.x + 120, p0.y + 400);
  await main.mouse.down();
  for (let i = 1; i <= 10; i++) await main.mouse.move(p0.x + 120 + i * 18, p0.y + 400 + Math.sin(i) * 20);
  await main.mouse.up();
  check(await main.locator('[data-testid="pdf-page-0"] [data-kind="ink"]').count() === 1, 'drawing makes a freehand mark');

  // A note.
  await main.click('[data-testid="pdf-tool-note"]');
  await main.mouse.click(p0.x + p0.width - 90, p0.y + 120);
  await main.waitForSelector('.pdr-pop textarea', { timeout: 4000 });
  await main.fill('.pdr-pop textarea', 'Ask about the compost order');
  await main.click('.pdr-pop >> text=Done');
  check(await main.locator('[data-testid="pdf-page-0"] [data-kind="note"]').count() === 1, 'a note is placed');

  // A text box.
  await main.click('[data-testid="pdf-tool-text"]');
  await main.mouse.click(p0.x + 80, p0.y + 520);
  await main.waitForSelector('.pdr-textbox textarea', { timeout: 4000 });
  await main.keyboard.type('Approved at the June meeting');
  await main.evaluate(() => document.activeElement?.blur());
  check(await main.locator('[data-testid="pdf-page-0"] [data-kind="text"]', { hasText: 'Approved' }).count() === 1, 'a text box is placed');
  await main.click('[data-testid="pdf-tool-read"]');
  await shot('pdf-marked-light');

  // A typed signature and the form on page 3.
  await main.locator('[data-testid="pdf-page-2"]').scrollIntoViewIfNeeded();
  await main.waitForSelector('[data-field="member_name"]', { timeout: 10000 });
  await main.fill('[data-field="member_name"]', 'Ada Gardener');
  await main.press('[data-field="member_name"]', 'Enter');
  await main.check('[data-field="join_rota"]');
  await main.click('[data-testid="pdf-tool-sign"]');
  await main.waitForSelector('[data-testid="pdf-sign"]');
  await main.click('[data-testid="pdf-sign"] >> text=Type');
  await main.fill('[aria-label="Your name"]', 'Ada Gardener');
  await main.click('[data-testid="pdf-sign-use"]');
  await main.waitForSelector('[data-testid="pdf-sign"]', { state: 'detached', timeout: 5000 });
  await main.locator('[data-field="member_name"]').scrollIntoViewIfNeeded();
  const f = await main.locator('[data-field="member_name"]').boundingBox();
  await main.mouse.click(f.x + f.width + 160, f.y - 60);
  check(await main.locator('[data-testid="pdf-page-2"] [data-kind="signature"]').count() === 1, 'a signature is placed where clicked');
  await shot('pdf-form-light');

  // Pages: turn page 2, add the appendix, remove page 1 then undo, remove the appendix's copy? keep it.
  await main.click('[data-testid="pdf-thumbs"]');
  await main.waitForSelector('[data-testid="pdf-thumb-1"]');
  await main.click('[aria-label="Turn page 2"]');
  await main.click('[data-testid="pdf-add-pages"]');
  check(!!(await until(async () => (await main.locator('.pdr-thumb').count()) === 4)), 'pages are added from another PDF');
  await main.click('[aria-label="Remove page 1"]');
  check(await main.locator('.pdr-thumb').count() === 3 && await main.locator('[data-kind="highlight"]').count() === 0, 'removing a page takes its marks with it');
  await main.keyboard.press('Control+z');
  await main.click('[aria-label="Page 1"]');
  check(!!(await until(async () => (await main.locator('.pdr-thumb').count()) === 4 && (await main.locator('[data-kind="highlight"]').count()) === 1, 8000)), 'Undo brings the page and its marks back');
  check(/not saved yet/.test(await main.locator('[data-testid="pdf-status"]').innerText()), 'unsaved changes are shown');

  // Dark pages.
  await main.click('[data-testid="pdf-dark"]');
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await main.click('[aria-label="Page 1"]');
  await main.evaluate(() => { for (const el of [document.scrollingElement, ...document.querySelectorAll('body *')]) if (el && el.scrollTop && !el.classList.contains('pdr-scroll')) el.scrollTop = 0; });
  await shot('pdf-reader-dark');
  check(await main.locator('.pdr-scroll.dark-pages').count() === 1, 'dark pages for reading');
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));
  await main.click('[data-testid="pdf-dark"]');
  await main.evaluate(() => { for (const el of [document.scrollingElement, ...document.querySelectorAll('body *')]) if (el && el.scrollTop && !el.classList.contains('pdr-scroll')) el.scrollTop = 0; });
  await shot('pdf-reader-light');

  // Save, then read the file back.
  await main.click('[data-testid="pdf-save"]');
  check(!!(await until(async () => /^Saved/.test(await main.locator('[data-testid="pdf-status"]').innerText()), 20000)), 'Save writes it into the PDF');
  const doc = await PDFDocument.load(fs.readFileSync(PDF));
  const pages = doc.getPages();
  check(pages.length === 4, `4 pages after adding the appendix (${pages.length})`);
  check(pages[1].getRotation().angle === 90, 'page 2 is turned');
  const kinds = pages.map((p) => { const a = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray); return a ? a.asArray().map((r) => doc.context.lookup(r).lookupMaybe?.(PDFName.of('Subtype'), PDFName)?.decodeText?.() ?? '') : []; });
  check(['Highlight', 'Ink', 'Text', 'FreeText'].every((k) => kinds[0].includes(k)), `page 1 holds standard annotations (${kinds[0].join(', ')})`);
  const form = doc.getForm();
  check(form.getTextField('member_name').getText() === 'Ada Gardener' && form.getCheckBox('join_rota').isChecked(), 'the form is filled in');
  const xo = pages[2].node.Resources()?.lookupMaybe(PDFName.of('XObject'), require('pdf-lib').PDFDict);
  check(!!xo && xo.keys().length >= 1, 'the signature is on the page');
  check(fs.readdirSync(path.dirname(PDF)).every((f) => !f.endsWith('.keeper-saving')), 'no half-written file is left behind');
  // It opens again with its marks drawn by the PDF itself.
  await main.waitForSelector('[data-testid="pdf-page-0"] canvas', { timeout: 15000 });
  check((await main.locator('[data-testid="pdf-page-0"] [data-kind]').count()) === 0, 'after saving, the marks are part of the PDF');

  // Restore the last version.
  check(await main.evaluate((p) => window.keeper.pdfReader.hasBackup(p), PDF), 'the version before saving is kept');
  await main.evaluate((p) => window.keeper.pdfReader.restore(p), PDF);
  check(Buffer.compare(fs.readFileSync(PDF), original) === 0, 'Restore the last version puts it back exactly');

  check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await app.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
