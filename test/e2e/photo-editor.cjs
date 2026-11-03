// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/photo-editor.cjs /tmp/kph-home /tmp/kph-shots
// Drives the real Keeper app's photo editor on a picture in Pictures: the start
// page, more light with the keyboard, a square crop, an area covered by dragging
// over it, Save (the file changes, the original is kept), reopening with the
// same sliders, Revert (the original back, byte for byte), Save a copy as WebP,
// turning, the Annotate hand-over, and pictures outside Keeper's folders refused.

const { _electron } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require(path.resolve(__dirname, '../../node_modules/sharp'));

fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

(async () => {
  // A landscape: sky, sun, hills (800 × 600).
  const pic = path.join(HOME, 'Pictures', 'Hills.png');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#6fa8dc"/><circle cx="600" cy="150" r="70" fill="#f6c453"/><path d="M0 450 220 260 380 400 520 300 800 480V600H0z" fill="#3a7d44"/><rect x="40" y="40" width="160" height="50" fill="#ffffff"/><text x="52" y="75" font-size="28" fill="#000">SECRET</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(pic);
  const before = sha(pic);
  const outside = path.join(HOME, '..', 'elsewhere.png');
  fs.copyFileSync(pic, outside);

  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', XDG_PICTURES_DIR: HOME + '/Pictures' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => { await wait(900); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const dark = (on) => main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), on);
  const meta = (f) => sharp(f).metadata();

  check((await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'photoEditor')?.on === true, 'the photo editor is on (it costs nothing until a picture opens)');
  await navigate('photo');
  await main.waitForSelector('[data-testid="ph-first"]', { timeout: 15000 });
  await shot('photo-start-light');
  await dark(true); await shot('photo-start-dark'); await dark(false);

  await navigate(`photo:${pic}`);
  await main.waitForSelector('[data-testid="photo-editor"]', { timeout: 15000 });
  check(!!(await until(async () => (await main.locator('[data-testid="ph-image"]').getAttribute('src'))?.startsWith('data:image'))), 'the picture opens in the editor');
  check(/800 × 600/.test(await main.locator('.page-head').innerText()), 'its size is shown under the title');

  // More light, with the keyboard.
  const light = main.locator('[data-testid="ph-exposure"]');
  await light.focus();
  for (let i = 0; i < 20; i++) await light.press('ArrowRight');
  check(/\+20/.test(await main.locator('.insp-row', { has: light }).innerText()), 'the Light slider moves by keyboard (+20)');
  // A square crop.
  await main.locator('[data-testid="ph-tab-crop"]').click();
  await main.locator('[data-testid="ph-aspect-1:1"]').click();
  await wait(400);
  // Cover the white label (top left of the square crop, which starts 100 px in).
  await main.locator('[data-testid="ph-tab-hide"]').click();
  await main.locator('[data-testid="ph-hide-box"]').click();
  await wait(800);
  const b = await main.locator('[data-testid="ph-overlay"]').boundingBox();
  // In the 600 × 600 crop the label spans x 0–100, y 40–90 (the crop starts at x = 100 of the original).
  await main.mouse.move(b.x + b.width * 0.0, b.y + b.height * (30 / 600));
  await main.mouse.down();
  await main.mouse.move(b.x + b.width * (110 / 600), b.y + b.height * (100 / 600), { steps: 5 });
  await main.mouse.up();
  check(!!(await until(async () => /1 area hidden/.test(await main.locator('[data-testid="ph-summary"]').innerText()))), 'dragging over the picture hides an area');
  await shot('photo-edit-light');
  await dark(true); await shot('photo-edit-dark');
  await main.setViewportSize({ width: 1024, height: 768 }); await shot('photo-edit-dark-1024'); await main.setViewportSize({ width: 1440, height: 900 });
  await dark(false);

  await main.locator('[data-testid="ph-save"]').click();
  check(!!(await until(async () => sha(pic) !== before, 15000)), 'Save changes the picture');
  const m1 = await meta(pic);
  check(m1.width === 600 && m1.height === 600, `it is square now (${m1.width} × ${m1.height})`);
  const { data } = await sharp(pic).extract({ left: 30, top: 55, width: 4, height: 4 }).raw().toBuffer({ resolveWithObject: true });
  check(data[0] < 60 && data[1] < 60 && data[2] < 60, `the covered label is dark, nothing to read (${data[0]},${data[1]},${data[2]})`);
  const sky = await sharp(pic).extract({ left: 400, top: 20, width: 2, height: 2 }).raw().toBuffer();
  check(sky[2] > 220 && sky[0] > 0x6f, `more light made the sky brighter (${sky[0]},${sky[1]},${sky[2]})`);
  const kept = path.join(HOME, '.config');
  const originals = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/photo-originals/.test(p) && e.name.endsWith('.png')) originals.push(p); } };
  walk(kept);
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

  // A copy in another format, and turning.
  const api = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.photo[f](...args), [fn, a]);
  const copy = await api('save', pic, { v: 1, turns: 1, flip: false, straighten: 0, exposure: 0, contrast: 0, saturation: -100, temperature: 0, redact: [], maxSide: 640, format: 'webp', cutout: false }, 'replace');
  check(copy.copy && /Hills \(edited\)\.webp$/.test(copy.path), 'a new format is saved as a copy beside the original');
  const m2 = await meta(copy.path);
  check(m2.format === 'webp' && m2.width === 480 && m2.height === 640, `turned, resized to 640 on the long side (${m2.width} × ${m2.height})`);
  check(sha(pic) === before, 'the original is still untouched');
  const straight = await api('preview', pic, { v: 1, turns: 0, flip: false, straighten: 8, exposure: 0, contrast: 0, saturation: 0, temperature: 0, redact: [], maxSide: 0, format: 'same', cutout: false });
  check(straight.width < 800 && Math.abs(straight.width / straight.height - 4 / 3) < 0.02, `straightening keeps the shape and crops the corners (${straight.width} × ${straight.height})`);
  const refused = await main.evaluate((p) => window.keeper.photo.info(p).then(() => '', (e) => e.message), outside);
  check(/library’s folders/.test(refused), 'a picture outside Keeper’s folders is refused');
  const info = await api('info', pic);
  check(['ready', 'download'].includes(info.cutout), `removing the background is offered on this computer (${info.cutout})`);

  // Annotate hands over to the screenshot editor.
  await main.locator('[data-testid="ph-tab-export"]').click();
  await main.locator('[data-testid="ph-annotate"]').click();
  check(!!(await until(() => main.locator('.annotate, [data-testid="annotate"], canvas').first().isVisible().catch(() => false), 8000)), 'Annotate opens the screenshot editor with the picture');

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await app.close();
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
