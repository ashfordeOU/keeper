// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): node test/e2e/make-samples.cjs /tmp/kh/Documents/samples && xvfb-run -a node test/e2e/previews.cjs /tmp/kh /tmp/kh-shots [light|dark] [minimal]
// Drives the real Keeper app: opens Quick Look on every sample file and checks each viewer.
const { _electron } = require('playwright');
const fs = require('fs');
const HOME = process.argv[2];
const SHOTS = process.argv[3];
const THEME = process.argv[4] || 'light';
fs.mkdirSync(SHOTS, { recursive: true });
(async () => {
  const app = await _electron.launch({ executablePath: require('path').resolve(__dirname, '../../node_modules/.bin/electron'), args: [require('path').resolve(__dirname, '../..'), '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config' } });
  const errors = [];
  let main;
  for (let i = 0; i < 40 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  main.on('console', (m) => { if (m.type() === 'error' && !/Autofill|net::ERR_|favicon/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForTimeout(2500);
  if (THEME === 'dark') await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  if (process.argv[5] === 'minimal') await main.evaluate(() => window.keeper.settings.set({ look: 'minimal' }));
  await app.evaluate(({ BrowserWindow }, dir) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('event:navigate', 'browse:' + dir)), HOME + '/Documents/samples');
  await main.waitForSelector('.file-card, .file-list tbody tr', { timeout: 20000 });
  await main.waitForTimeout(1500);
  await main.screenshot({ path: `${SHOTS}/00-browse.png` });
  await main.locator('.file-card, .file-list tbody tr').first().click();
  await main.keyboard.press('Space');
  await main.waitForSelector('.ql', { timeout: 10000 });
  const results = [];
  const total = await main.locator('.ql-strip button').count();
  for (let i = 0; i < total; i++) {
    // Let the viewer settle: no spinners for a moment, or 15 s at most.
    const t0 = Date.now();
    await main.waitForTimeout(700);
    while (Date.now() - t0 < 15000 && (await main.locator('.ql .ql-pane .spinner').count()) > 0) await main.waitForTimeout(300);
    await main.waitForTimeout(600);
    const r = await main.evaluate(() => {
      const pv = document.querySelector('.ql .ql-pane .pv');
      const msg = document.querySelector('.ql .ql-pane .pv-message');
      const title = document.querySelector('.ql-title span')?.textContent;
      const content = pv ? pv.querySelectorAll('img, canvas, video, audio, iframe, .pv-code, .pv-doc, .pv-grid, .tree-row, .pv-json, .j-row, .pv-hex, .pv-log, .agenda-event, .contact, .pv-table, .pv-font-hero, .pv-slide, .pv-cues, .mail-head, .pv-pdf-page').length : 0;
      return { title, kind: pv?.getAttribute('data-kind'), message: msg?.textContent ?? null, content, pwned: !!window.__pwned || document.title === 'pwned' };
    });
    const name = (r.title || `file-${i}`).replace(/[^\w.-]+/g, '_');
    await main.screenshot({ path: `${SHOTS}/${String(i + 1).padStart(2, '0')}-${name}.png` });
    results.push(r);
    await main.keyboard.press(']');
  }
  // Inline preview in the Inspector for a PDF.
  await main.keyboard.press('Escape');
  await main.waitForTimeout(400);
  await main.locator('.file-card', { hasText: 'report.pdf' }).first().click().catch(() => undefined);
  await main.waitForTimeout(2500);
  await main.screenshot({ path: `${SHOTS}/zz-inspector-pdf.png` });
  // Thumbnails in the grid after a while.
  await main.waitForTimeout(2000);
  await main.screenshot({ path: `${SHOTS}/zz-grid-thumbs.png` });
  const thumbs = await main.evaluate(() => [...document.querySelectorAll('.file-card')].map((c) => ({ name: c.querySelector('.name')?.textContent, img: !!c.querySelector('.thumb img') })));
  console.log(JSON.stringify({ results, errors, thumbs }, null, 1));
  await app.close();
  const bad = results.filter((r) => r.message || !r.content || r.pwned);
  if (bad.length || errors.length) {
    console.error(`${bad.length} viewer(s) failed, ${errors.length} page error(s)`);
    process.exit(1);
  }
  console.error(`All ${results.length} previews rendered.`);
})().catch((e) => { console.error('E2E FAILED', e); process.exit(1); });
