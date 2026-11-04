// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/photo-editor.cjs /tmp/kph-home /tmp/kph-shots
//   KEEPER_PHOTO_MODELS=<folder with u2netp.onnx and isnet-general-use.onnx>  the Background tab's cut-out without a download
//   PHOTO_SHOTS_PREFIX=<path prefix>  also writes the design pictures (light and dark, 1440 × 900) as <prefix>-<name>-{light,dark}.png
// Drives the real Keeper app's photo editor on drawn demo pictures (test/e2e/photo-samples.cjs):
// the start page with recent pictures, more light with the keyboard, a look and
// auto enhance, the history list, a square crop, an area covered by dragging,
// Save (the file changes, the original is kept), reopening with the same
// sliders, Revert (the original back, byte for byte), Save a copy in another
// format from its sheet, a retouched spot, text added on top, the background
// removed and replaced with before and after, "Edit Photo…" on a RAW file in
// Files, dropping a picture on the editor, the palette, the Annotate hand-over,
// and pictures outside Keeper's folders refused.

const { _electron } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const sharp = require(path.join(ROOT, 'node_modules/sharp'));
const { make } = require('./photo-samples.cjs');

fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const PREFIX = process.env.PHOTO_SHOTS_PREFIX || '';
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

(async () => {
  // A landscape: sky, sun, hills (800 × 600), with a label to cover.
  const pic = path.join(HOME, 'Pictures', 'Hills.png');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#6fa8dc"/><circle cx="600" cy="150" r="70" fill="#f6c453"/><path d="M0 450 220 260 380 400 520 300 800 480V600H0z" fill="#3a7d44"/><rect x="40" y="40" width="160" height="50" fill="#ffffff"/><text x="52" y="75" font-size="28" fill="#000">SECRET</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(pic);
  const before = sha(pic);
  const outside = path.join(HOME, '..', 'elsewhere.png');
  fs.copyFileSync(pic, outside);
  const S = await make(path.join(HOME, 'Pictures', 'Demo'));

  const app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/.bin/electron'),
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', XDG_PICTURES_DIR: HOME + '/Pictures' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  if (process.env.KEEPER_PHOTO_MODELS) {
    fs.mkdirSync(path.join(userData, 'models'), { recursive: true });
    for (const f of ['u2netp.onnx', 'isnet-general-use.onnx']) { const s = path.join(process.env.KEEPER_PHOTO_MODELS, f); if (fs.existsSync(s) && !fs.existsSync(path.join(userData, 'models', f))) fs.symlinkSync(s, path.join(userData, 'models', f)); }
  }
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => { await wait(900); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const dark = (on) => main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), on);
  // The design pictures: 1440 × 900, the sidebar folded to icons, light and dark.
  const design = async (name) => {
    if (!PREFIX) return;
    await main.evaluate(() => window.keeper.settings.set({ sidebarMode: 'compact' }));
    for (const d of [false, true]) { await dark(d); await wait(1100); await main.screenshot({ path: `${PREFIX}-${name}-${d ? 'dark' : 'light'}.png` }); }
    await dark(false);
  };
  const meta = (f) => sharp(f).metadata();
  const summary = () => main.locator('[data-testid="ph-summary"]').innerText();
  const tab = async (id) => {
    const t = main.locator(`[data-testid="ph-tab-${id}"]`);
    if (await t.isVisible().catch(() => false)) { await t.click(); return; }
    await main.locator('[data-testid="ph-tab-more"]').click();
    await main.locator(`[role="menuitem"][data-testid="ph-tab-${id}"]`).click();
  };
  const imageReady = () => until(async () => (await main.locator('[data-testid="ph-image"]').getAttribute('src'))?.startsWith('data:image'), 20000);
  const settled = async () => { await wait(300); await until(async () => !(await main.locator('.ph-busy').isVisible().catch(() => false)), 60000); await wait(200); };

  check((await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'photoEditor')?.on === true, 'the photo editor is on (it costs nothing until a picture opens)');
  // Opened once, so it is among the recent pictures.
  await main.evaluate((p) => window.keeper.photo.info(p), S['Lake.jpg']);
  await navigate('photo');
  await main.waitForSelector('[data-testid="ph-first"]', { timeout: 15000 });
  check(!!(await until(() => main.locator('[data-testid="ph-recent-item"]').count())), 'the start page shows recent pictures');
  await shot('photo-start-light');
  await dark(true); await shot('photo-start-dark'); await dark(false);
  await design('start');

  await navigate(`photo:${pic}`);
  await main.waitForSelector('[data-testid="photo-editor"]', { timeout: 15000 });
  check(!!(await imageReady()), 'the picture opens in the editor');
  check(/800 × 600/.test(await main.locator('.page-head').innerText()), 'its size is shown under the title');
  const tabsInView = await main.locator('.ph-rail button').count();
  check(tabsInView <= 6, `at most six tools in view, the rest under More (${tabsInView})`);

  // More light, with the keyboard.
  const light = main.locator('[data-testid="ph-exposure"]');
  await light.focus();
  for (let i = 0; i < 20; i++) await light.press('ArrowRight');
  check(/\+20/.test(await main.locator('.insp-row', { has: light }).innerText()), 'the Light slider moves by keyboard (+20)');
  // A look, then undo it.
  await main.locator('[data-testid="ph-look-golden"]').click();
  check(!!(await until(async () => /Golden hour/.test(await summary()))), 'a look applies with one click');
  await main.locator('[data-testid="ph-undo"]').click();
  check(!!(await until(async () => !/Golden hour/.test(await summary()) && /Brighter/.test(await summary()))), 'Undo takes the look back off');
  await main.locator('[data-testid="ph-auto"]').click();
  check(!!(await until(async () => (await main.locator('.ph-insp').innerText()).length > 0 && !(await main.locator('[data-testid="ph-auto"]').isDisabled()))), 'Auto suggests light and colour');
  await main.locator('[data-testid="ph-undo"]').click();
  // A square crop.
  await tab('crop');
  await main.locator('[data-testid="ph-aspect-1:1"]').click();
  await wait(400);
  // Cover the white label (top left of the square crop, which starts 100 px in).
  await tab('hide');
  await main.locator('[data-testid="ph-hide-box"]').click();
  await settled();
  const b = await main.locator('[data-testid="ph-overlay"]').boundingBox();
  await main.mouse.move(b.x + b.width * 0.0, b.y + b.height * (30 / 600));
  await main.mouse.down();
  await main.mouse.move(b.x + b.width * (110 / 600), b.y + b.height * (100 / 600), { steps: 5 });
  await main.mouse.up();
  check(!!(await until(async () => /1 area hidden/.test(await summary()))), 'dragging over the picture hides an area');
  await tab('history');
  const steps = await main.locator('.ph-history li').allInnerTexts();
  check(steps[0] === 'Opened' && steps.includes('Light +20') && !steps.includes('Light +5') && steps.includes('Cropped') && steps.includes('Area hidden'), `the history lists each step, a slider nudged many times as one (${steps.join(' · ')})`);
  await shot('photo-edit-light');
  await dark(true); await shot('photo-edit-dark');
  await main.setViewportSize({ width: 1024, height: 768 }); await shot('photo-edit-dark-1024'); await main.setViewportSize({ width: 1440, height: 900 });
  await dark(false);
  await design('history');

  await main.locator('[data-testid="ph-save"]').click();
  check(!!(await until(async () => sha(pic) !== before, 15000)), 'Save changes the picture');
  const m1 = await meta(pic);
  check(m1.width === 600 && m1.height === 600, `it is square now (${m1.width} × ${m1.height})`);
  const { data } = await sharp(pic).extract({ left: 30, top: 55, width: 4, height: 4 }).raw().toBuffer({ resolveWithObject: true });
  check(data[0] < 60 && data[1] < 60 && data[2] < 60, `the covered label is dark, nothing to read (${data[0]},${data[1]},${data[2]})`);
  const sky = await sharp(pic).extract({ left: 400, top: 20, width: 2, height: 2 }).raw().toBuffer();
  check(sky[2] > 220 && sky[0] > 0x6f, `more light made the sky brighter (${sky[0]},${sky[1]},${sky[2]})`);
  const originals = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/photo-originals/.test(p) && e.name.endsWith('.png')) originals.push(p); } };
  walk(userData);
  check(originals.length === 1 && sha(originals[0]) === before, 'the original is kept, untouched');

  // Reopen: the same sliders.
  await navigate('home'); await wait(500);
  await navigate(`photo:${pic}`);
  await main.waitForSelector('[data-testid="photo-editor"]');
  check(!!(await until(async () => /Edited: Cropped · Brighter · 1 area hidden/.test(await main.locator('.page-head').innerText()))), 'reopening says what was done');
  check(/\+20/.test(await main.locator('.insp-row', { has: main.locator('[data-testid="ph-exposure"]') }).innerText()), 'and opens with the same sliders (non-destructive)');

  // Revert.
  await main.locator('[data-testid="ph-revert"]').click();
  check(!!(await until(() => sha(pic) === before, 15000)), 'Revert brings the original back, byte for byte');

  // Save a copy, from its sheet, as WebP.
  await imageReady();
  await main.locator('[data-testid="ph-copy"]').click();
  await main.waitForSelector('[data-testid="ph-save-sheet"]');
  await main.locator('[data-testid="ph-format"]').selectOption('webp');
  await shot('photo-save-light');
  await design('save');
  await main.locator('[data-testid="ph-save-copy"]').click();
  const copy = path.join(HOME, 'Pictures', 'Hills (edited).webp');
  check(!!(await until(() => fs.existsSync(copy), 15000)), 'Save a copy writes a WebP beside the original');
  check(!!(await until(async () => fs.existsSync(copy) && (await meta(copy)).format === 'webp')) && sha(pic) === before, 'the original is still untouched');

  // Retouch: heal a spot by clicking it.
  await tab('retouch');
  await settled();
  const ov = await main.locator('[data-testid="ph-overlay"]').boundingBox();
  await main.mouse.click(ov.x + ov.width * 0.5, ov.y + ov.height * 0.8);
  check(!!(await until(async () => /1 spot retouched/.test(await summary()))), 'Heal: clicking a spot retouches it');
  // Add: text on top.
  await tab('add');
  await main.locator('button[data-testid="ph-add-text"]').click();
  await main.locator('textarea[data-testid="ph-add-words"]').fill('Summer hills');
  await main.locator('textarea[data-testid="ph-add-words"]').blur();
  check(!!(await until(async () => /1 thing added/.test(await summary()))), 'Add: text goes on top');
  await settled();
  const drawnPx = await main.evaluate(() => { const c = document.querySelector('.ph-layer'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  check(drawnPx > 200, `and is drawn over the picture live (${drawnPx} pixels)`);
  await design('add');

  // Background: cut out, a new background, before and after.
  const vase = S['Vase.jpg'];
  await navigate(`photo:${vase}`);
  await main.waitForSelector('[data-testid="photo-editor"]');
  await imageReady();
  await tab('background');
  const info = await main.evaluate((p) => window.keeper.photo.info(p), vase);
  if (info.cutout === 'ready' && (info.models.fast || process.env.KEEPER_PHOTO_MODELS)) {
    await main.locator('[data-testid="ph-panel-background"] .ph-toggle button').first().click();
    check(!!(await until(async () => /Background removed/.test(await summary()), 60000)), 'Remove the background (Background tab)');
    check(!!(await until(async () => (await main.locator('[data-testid="ph-image"]').getAttribute('src')).startsWith('data:image/png'), 60000)), 'the preview turns see-through');
    await main.locator('[data-testid="ph-bg-compare"]').click();
    check(!!(await until(() => main.locator('[data-testid="ph-before"] img').count(), 20000)), 'before and after, side by side');
    await settled();
    await shot('photo-cutout-light');
    await design('cutout');
    await main.locator('[data-testid="ph-bg-compare"]').click();
    await main.locator('[data-testid="ph-bg-gradient"]').click();
    const shadow = main.locator('[data-testid="ph-bg-shadow"]');
    await shadow.focus();
    for (let i = 0; i < 7; i++) await shadow.press('PageUp');
    check(!!(await until(async () => /New background/.test(await summary()), 30000)), 'a gradient behind the subject, with a shadow');
    await main.locator('[data-testid="ph-bg-compare"]').click();
    await until(() => main.locator('[data-testid="ph-before"] img').count(), 20000);
    await settled();
    await design('background');
    await main.locator('[data-testid="ph-bg-compare"]').click();
    await main.locator('[data-testid="ph-brush-remove"]').click();
    await settled();
    const vb = await main.locator('[data-testid="ph-overlay"]').boundingBox();
    await main.mouse.move(vb.x + vb.width * (1012 / 1800), vb.y + vb.height * (88 / 1200));
    await main.mouse.down();
    await main.mouse.move(vb.x + vb.width * (1030 / 1800), vb.y + vb.height * (95 / 1200), { steps: 4 });
    await main.mouse.up();
    await tab('history');
    check(!!(await until(async () => (await main.locator('.ph-history').innerText()).includes('Edge: removed an area'))), 'the refine brush paints on the edge (and is a step in the history)');
  } else console.log(`SKIP the cut-out in the Background tab (${info.cutout}; set KEEPER_PHOTO_MODELS)`);

  // Files: right-click a camera RAW file → Edit Photo…
  await navigate(`browse:${path.dirname(S['Camera.nef'])}`);
  const card = main.locator(`.file-card[data-path="${S['Camera.nef']}"], .file-list tr[data-path="${S['Camera.nef']}"]`).first();
  await card.waitFor({ timeout: 15000 }).catch(() => undefined);
  await card.click({ button: 'right' }).catch(() => undefined);
  const edit = main.locator('[data-testid="menu-edit-photo"]');
  check(await edit.isVisible().catch(() => false), 'Files: “Edit Photo…” on a camera RAW file');
  await edit.click().catch(() => undefined);
  check(!!(await until(async () => /Camera\.nef/.test(await main.locator('.page-head').innerText()))), 'it opens in the editor');
  check(!!(await until(() => main.locator('[data-testid="ph-note"]').isVisible())), 'which says it shows the camera’s own preview');
  await imageReady();
  await design('raw');

  // Dropping a picture on the editor opens it.
  await main.evaluate((p) => {
    const dt = new DataTransfer();
    dt.setData('text/uri-list', `file://${p.split('/').map(encodeURIComponent).join('/')}`);
    document.querySelector('[data-testid="photo-editor"]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, S['Beach.jpg']).catch(() => undefined);
  check(!!(await until(async () => /Beach\.jpg/.test(await main.locator('.page-head').innerText()))), 'dropping a picture on the editor opens it');

  // The palette offers the photo editor and recent pictures.
  await navigate('home'); await wait(500);
  await main.keyboard.press('Control+k');
  await main.waitForSelector('.palette', { timeout: 5000 }).catch(() => undefined);
  await main.keyboard.type('edit');
  await wait(400);
  const pal = await main.locator('.palette').innerText().catch(() => '');
  check(/Edit a Photo/.test(pal) && /Edit (Beach|Camera|Vase|Hills|Lake)/.test(pal), 'the palette: Edit a Photo… and recent pictures');
  await main.keyboard.press('Escape');

  // The API: a new format is a copy; turning; straightening; refusing outside Keeper's folders.
  const api = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.photo[f](...args), [fn, a]);
  const copy2 = await api('save', pic, { v: 1, turns: 1, saturation: -100, maxSide: 640, format: 'webp' }, 'replace');
  check(copy2.copy && /Hills \(edited\)( 2)?\.webp$/.test(copy2.path), 'a new format is saved as a copy beside the original');
  const m2 = await meta(copy2.path);
  check(m2.format === 'webp' && m2.width === 480 && m2.height === 640, `turned, resized to 640 on the long side (${m2.width} × ${m2.height})`);
  check(sha(pic) === before, 'the original is still untouched');
  const straight = await api('preview', pic, { v: 1, straighten: 8 });
  check(straight.width < 800 && Math.abs(straight.width / straight.height - 4 / 3) < 0.02, `straightening keeps the shape and crops the corners (${straight.width} × ${straight.height})`);
  const refused = await main.evaluate((p) => window.keeper.photo.info(p).then(() => '', (e) => e.message), outside);
  check(/library’s folders/.test(refused), 'a picture outside Keeper’s folders is refused');

  // Annotate hands over to the screenshot editor.
  await navigate(`photo:${pic}`);
  await main.waitForSelector('[data-testid="photo-editor"]');
  await tab('add');
  await main.locator('[data-testid="ph-annotate"]').click();
  check(!!(await until(() => main.locator('.annotate, [data-testid="annotate"], canvas').first().isVisible().catch(() => false), 8000)), 'Annotate opens the screenshot editor with the picture');

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await app.close();
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
