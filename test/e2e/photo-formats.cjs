// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/photo-formats.cjs /tmp/kpf-home [/tmp/kpf-shots]
//   KEEPER_PHOTO_MODELS=<folder with u2netp.onnx and isnet-general-use.onnx>  cut-out checks without downloading the models
//   KEEPER_TEST_HEIC=<a .heic photo>                                          also open and edit a real HEIC photo
// The photo editor in the real app, through its own API, on drawn demo pictures
// (test/e2e/photo-samples.cjs): every format opens (camera RAW through its
// preview, Photoshop flattened, BMP, icons, drawings, moving GIFs, HEIC), every
// format saves and is checked pixel by pixel, the photo's details are kept,
// stripped or kept without the place, a 24-megapixel picture saves, Revert gives
// the original back byte for byte, the pixel tools change pixels, things added on
// top land in the file, the background is removed (both models, scored against the
// drawing's true outline) and replaced with a colour, a gradient, a blur, a picture
// and a shadow, and many pictures convert at once through Convert.

const { _electron } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const sharp = require(path.join(ROOT, 'node_modules/sharp'));
const { PDFDocument } = require(path.join(ROOT, 'node_modules/pdf-lib'));
const { make } = require('./photo-samples.cjs');

fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const R = (o = {}) => ({ v: 1, ...o });
const pixel = async (file, x, y) => { const { data, info } = await sharp(file).ensureAlpha().extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true }); void info; return [...data]; };
const near = (a, b, tol) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);
/** Is the IFD0 GPS pointer (tag 0x8825) in an EXIF block? */
function gpsIn(exif) {
  if (!exif) return false;
  let t = exif;
  if (t.subarray(0, 4).toString('latin1') === 'Exif') t = t.subarray(6);
  const le = t[0] === 0x49;
  const u16 = (p) => (le ? t.readUInt16LE(p) : t.readUInt16BE(p));
  const u32 = (p) => (le ? t.readUInt32LE(p) : t.readUInt32BE(p));
  const ifd = u32(4);
  for (let i = 0, n = u16(ifd); i < n; i++) if (u16(ifd + 2 + i * 12) === 0x8825) return true;
  return false;
}
function readBmpHead(file) { const b = fs.readFileSync(file); return { magic: b.subarray(0, 2).toString('latin1'), w: b.readInt32LE(18), h: b.readInt32LE(22), bpp: b.readUInt16LE(28), off: b.readUInt32LE(10), b }; }

(async () => {
  const PICS = path.join(HOME, 'Pictures', 'Demo');
  const S = await make(PICS);
  const heic = process.env.KEEPER_TEST_HEIC && fs.existsSync(process.env.KEEPER_TEST_HEIC) ? path.join(PICS, 'Phone photo.heic') : null;
  if (heic) fs.copyFileSync(process.env.KEEPER_TEST_HEIC, heic);
  const lakeBefore = sha(S['Lake.jpg']);

  const app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/.bin/electron'),
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', XDG_PICTURES_DIR: HOME + '/Pictures' },
  });
  const errors = [];
  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; };
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  // Models: linked in from a folder when given, so the cut-out runs without a download.
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const from = process.env.KEEPER_PHOTO_MODELS;
  if (from) {
    fs.mkdirSync(path.join(userData, 'models'), { recursive: true });
    for (const f of ['u2netp.onnx', 'isnet-general-use.onnx']) if (fs.existsSync(path.join(from, f)) && !fs.existsSync(path.join(userData, 'models', f))) fs.symlinkSync(path.join(from, f), path.join(userData, 'models', f));
  }
  const api = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.photo[f](...args).then((r) => ({ r }), (e) => ({ e: String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })), [fn, a]);

  // ---------------------------------------------------------------- opening
  const opened = {};
  for (const [name, want] of Object.entries({
    'Lake.jpg': { w: 2400, h: 1600, via: 'sharp' }, 'Camera.nef': { w: 3000, h: 2000, via: 'embedded' }, 'Poster.psd': { w: 400, h: 300, via: 'psd' }, 'App.ico': { w: 256, h: 256, via: 'ico' },
    'Drawing.svg': { via: 'svg' }, 'Old.bmp': { w: 200, h: 120, via: 'bmp' }, 'Moving.gif': { w: 160, h: 120, via: 'sharp' }, 'Sticker.png': { w: 600, h: 400, via: 'sharp' }, 'Big 24MP.jpg': { w: 6000, h: 4000, via: 'sharp' },
  })) {
    const t = Date.now();
    const i = await api('info', S[name]);
    opened[name] = i.r;
    check(!!i.r && i.r.via === want.via && (!want.w || (i.r.width === want.w && i.r.height === want.h)), `${name} opens (${i.r ? `${i.r.width} × ${i.r.height} via ${i.r.via}` : i.e}, ${Date.now() - t} ms)`);
  }
  check(opened['Lake.jpg']?.hasLocation === true, 'a photo that says where it was taken is known to');
  check(/preview the camera saved/.test(opened['Camera.nef']?.note ?? ''), 'a RAW file opened through its own preview says so plainly');
  check(/flattened/i.test(opened['Poster.psd']?.note ?? ''), 'a Photoshop file says it is shown flattened');
  check(opened['Moving.gif']?.frames === 4, `a moving GIF has its frames counted (${opened['Moving.gif']?.frames})`);
  check(opened['Sticker.png']?.alpha === true && opened['Lake.jpg']?.alpha === false, 'see-through pictures are known');
  const bmpView = await api('preview', S['Old.bmp'], R());
  check(!!bmpView.r && bmpView.r.width === 200, 'a BMP previews');
  if (heic) {
    const h = await api('info', heic);
    check(!!h.r && h.r.width > 1000, `a real HEIC photo opens (${h.r ? `${h.r.width} × ${h.r.height} via ${h.r.via}` : h.e})`);
    const c = await api('save', heic, R({ exposure: 10 }), 'copy');
    check(!!c.r && /\.jpg$/.test(c.r.path) && (await sharp(c.r.path).metadata()).width === h.r.width, 'and saves (as a JPEG copy here: this computer has no HEIC writer)');
  } else console.log('SKIP a real HEIC photo (set KEEPER_TEST_HEIC)');

  // ---------------------------------------------------------------- saving in every format
  const lake = S['Lake.jpg'];
  const src = await pixel(lake, 0, 0).catch(() => null);
  void src;
  const plain = await sharp(lake).rotate().resize(600, 400).raw().toBuffer();
  const lum = (b) => { let s = 0; for (let i = 0; i < b.length; i += 3) s += b[i] + b[i + 1] + b[i + 2]; return s / (b.length / 3) / 3; };
  const baseLum = lum(plain);
  for (const fmt of ['jpeg', 'png', 'webp', 'avif', 'tiff', 'gif', 'bmp', 'ico', 'pdf', 'heic']) {
    const out = await api('save', lake, R({ exposure: 40, maxSide: 600, format: fmt }), 'copy');
    if (fmt === 'heic') { check(process.platform === 'darwin' ? !!out.r : /needs a Mac/.test(out.e ?? ''), `HEIC: ${process.platform === 'darwin' ? 'saved' : `refused plainly here (${out.e})`}`); continue; }
    if (!out.r) { check(false, `${fmt}: ${out.e}`); continue; }
    const f = out.r.path;
    if (fmt === 'bmp') {
      const b = readBmpHead(f);
      const mid = b.off + (b.h - 1 - 200) * Math.ceil((b.w * b.bpp) / 32) * 4 + 300 * (b.bpp / 8);
      check(b.magic === 'BM' && b.w === 600 && b.h === 400 && b.b[mid + 2] > 0, `BMP: ${b.w} × ${b.h}, ${b.bpp}-bit, real pixels`);
      continue;
    }
    if (fmt === 'ico') {
      const b = fs.readFileSync(f);
      const n = b.readUInt16LE(4);
      const sizes = Array.from({ length: n }, (_, i) => b[6 + i * 16] || 256);
      check(n === 7 && sizes.includes(16) && sizes.includes(256), `icon: ${n} sizes (${sizes.join(', ')})`);
      continue;
    }
    if (fmt === 'pdf') {
      const doc = await PDFDocument.load(fs.readFileSync(f));
      const pg = doc.getPage(0).getSize();
      check(doc.getPageCount() === 1 && Math.round(pg.width) === 450 && Math.round(pg.height) === 300, `PDF: one page, ${Math.round(pg.width)} × ${Math.round(pg.height)} pt`);
      continue;
    }
    const m = await sharp(f).metadata();
    const l = lum(await sharp(f).removeAlpha().resize(600, 400).raw().toBuffer());
    check(m.width === 600 && m.height === 400 && l > baseLum + 8, `${fmt}: ${m.format} ${m.width} × ${m.height}, brighter as asked (${Math.round(baseLum)} → ${Math.round(l)})`);
  }
  // Quality, colour profile and the photo's details.
  const q40 = await api('save', lake, R({ format: 'jpeg', quality: 40 }), 'copy');
  const q95 = await api('save', lake, R({ format: 'jpeg', quality: 95 }), 'copy');
  check(fs.statSync(q40.r.path).size < fs.statSync(q95.r.path).size * 0.6, 'a lower quality makes a smaller file');
  const keep = await sharp(q95.r.path).metadata();
  check(gpsIn(keep.exif) && keep.orientation === 1 && /Demo/.test(keep.exif.toString('latin1')), 'details kept: camera and place, turned upright');
  const iccName = (icc) => (icc ? icc.toString('latin1').replace(/\0/g, '') : '');
  check(/P3/.test(iccName(keep.icc)), 'the wide-colour profile is kept');
  const noPlace = await sharp((await api('save', lake, R({ format: 'jpeg', metadata: 'no-location' }), 'copy')).r.path).metadata();
  check(!!noPlace.exif && !gpsIn(noPlace.exif) && !noPlace.exif.includes(Buffer.from([46, 0, 0, 0, 1, 0, 0, 0])) && /Demo/.test(noPlace.exif.toString('latin1')), 'without the place: the camera stays, the place is gone from the bytes');
  const strip = await sharp((await api('save', lake, R({ format: 'webp', metadata: 'strip', profile: 'srgb' }), 'copy')).r.path).metadata();
  check(!strip.exif && /sRGB/.test(iccName(strip.icc)), 'details removed, standard colours');
  const png = await sharp((await api('save', lake, R({ format: 'png' }), 'copy')).r.path).metadata();
  check(gpsIn(png.exif), 'PNG keeps the details too');

  // ---------------------------------------------------------------- over the original, and back
  const replaced = await api('save', lake, R({ exposure: -30, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }), 'replace');
  const rm = await sharp(lake).metadata();
  check(!!replaced.r && !replaced.r.copy && rm.width === 1200 && rm.height === 800 && rm.orientation === 1, `Save over the original: cropped and upright (${rm.width} × ${rm.height})`);
  const again = await api('info', lake);
  check(again.r?.edited?.summary === 'Cropped · Darker', `reopening shows the edits (${again.r?.edited?.summary})`);
  await api('revert', lake);
  check(sha(lake) === lakeBefore, 'Revert gives the original back, byte for byte');
  const big = S['Big 24MP.jpg'];
  let t = Date.now();
  const bigOut = await api('save', big, R({ exposure: 10, contrast: 10, vibrance: 20, clarity: 20, sharpen: 30, vignette: -20 }), 'replace');
  const bigMs = Date.now() - t;
  const bm = await sharp(big).metadata();
  check(!!bigOut.r && bm.width === 6000 && bm.height === 4000 && bigMs < 60000, `a 24-megapixel picture saves at full size (${(bigMs / 1000).toFixed(1)} s)`);
  t = Date.now();
  const bigPrev = await api('preview', big, R({ exposure: 12 }));
  check(!!bigPrev.r && bigPrev.r.width === 1600 && Date.now() - t < 5000, `and previews quickly (${Date.now() - t} ms)`);

  // ---------------------------------------------------------------- moving pictures
  const gif = S['Moving.gif'];
  const g1 = await sharp((await api('save', gif, R({ exposure: 20 }), 'copy')).r.path, { animated: true }).metadata();
  check(g1.format === 'gif' && g1.pages === 4, `a moving GIF keeps its 4 frames (${g1.pages})`);
  const g2 = await sharp((await api('save', gif, R({ format: 'webp' }), 'copy')).r.path, { animated: true }).metadata();
  check(g2.format === 'webp' && g2.pages === 4, 'and becomes a moving WebP');
  const g3 = await sharp((await api('save', gif, R({ frames: 'first', format: 'png' }), 'copy')).r.path, { animated: true }).metadata();
  check((g3.pages ?? 1) === 1, 'or just its first frame');

  // ---------------------------------------------------------------- every tool changes pixels
  const tools = { highlights: -60, shadows: 60, whites: 30, blacks: -30, vibrance: 50, clarity: 60, sharpen: 60, noise: 60, vignette: -80, grain: 60, tint: 40, hsl: { aqua: [30, 40, -20] }, curve: [[0, 0], [128, 170], [255, 255]], perspectiveV: 40 };
  // On the vase photo: it has fine grain, which sharpening and noise reduction act on.
  const photo = S['Vase.jpg'];
  const base = await sharp((await api('save', photo, R({ maxSide: 800, format: 'png' }), 'copy')).r.path).raw().toBuffer();
  for (const [k, v] of Object.entries(tools)) {
    const f = (await api('save', photo, R({ maxSide: 800, format: 'png', [k]: v }), 'copy')).r.path;
    const b = await sharp(f).raw().toBuffer();
    let diff = 0;
    for (let i = 0; i < Math.min(b.length, base.length); i++) diff += Math.abs(b[i] - base[i]);
    check(diff / base.length > (k === 'sharpen' || k === 'noise' ? 0.1 : 0.4), `${k} changes the picture (${(diff / base.length).toFixed(2)} per value)`);
  }
  // Retouching: a dark speck healed away.
  const speck = path.join(PICS, 'Speck.png');
  await sharp({ create: { width: 400, height: 300, channels: 3, background: '#c8b49a' } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><circle cx="200" cy="150" r="8" fill="#111"/></svg>') }]).png().toFile(speck);
  const healed = (await api('save', speck, R({ retouch: [{ kind: 'heal', x: 0.5, y: 0.5, r: 0.04 }] }), 'copy')).r.path;
  const hp = await pixel(healed, 200, 150);
  check(near(hp, [200, 180, 154], 18), `Heal: the speck is gone (${hp.slice(0, 3)})`);
  // Size and canvas.
  const sized = await sharp((await api('save', lake, R({ width: 500, height: 500, extend: { t: 0.1, r: 0.1, b: 0.1, l: 0.1, colour: '#ff0000' } }), 'copy')).r.path).metadata();
  check(sized.width === 600 && sized.height === 600, `exact size, then more canvas (${sized.width} × ${sized.height})`);
  // Things added on top end up in the file.
  const added = (await api('save', lake, R({ maxSide: 1200, format: 'png', overlays: [{ kind: 'frame', style: 'plain', size: 0.05, colour: '#ff0000' }, { kind: 'shape', shape: 'rect', x: 0.4, y: 0.4, w: 0.2, h: 0.2, colour: '#00ff00', width: 0.01, fill: true }, { kind: 'text', text: 'Hello', x: 0.5, y: 0.2, size: 0.1, colour: '#ffffff', font: 'sans', bold: true, shadow: false }, { kind: 'sticker', emoji: '⭐', x: 0.8, y: 0.7, size: 0.15 }] }), 'copy')).r.path;
  check(near(await pixel(added, 5, 400), [255, 0, 0], 4), 'a frame is drawn into the file');
  check(near(await pixel(added, 600, 400), [0, 255, 0], 4), 'a filled shape is drawn into the file');
  const textArea = await sharp(added).extract({ left: 520, top: 130, width: 160, height: 60 }).stats();
  check(textArea.channels[0].max > 245 && textArea.channels[1].max > 245, 'text is drawn into the file');

  // ---------------------------------------------------------------- the background
  const info = await api('info', S['Vase.jpg']);
  if (info.r?.cutout !== 'ready' || (!info.r.models.fast && !from)) console.log(`SKIP cut-out checks (${info.r?.cutout}; set KEEPER_PHOTO_MODELS to a folder with the models)`);
  else {
    // The drawing's true outline (the vase and its flowers), to score each model.
    const VASE_MASK = '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1200"><rect width="1800" height="1200"/><g fill="#fff" stroke="#fff"><path d="M800 420c-30 70-120 150-120 290 0 120 90 190 220 190s220-70 220-190c0-140-90-220-120-290 20-30 30-60 10-80H790c-20 20-10 50 10 80z"/><ellipse cx="900" cy="342" rx="110" ry="22"/><g stroke-width="10" fill="none"><path d="M880 340C860 250 820 180 760 130"/><path d="M910 340c10-110 40-190 100-250"/><path d="M895 340c0-90-10-160-30-220"/></g><circle cx="760" cy="125" r="48"/><circle cx="1012" cy="88" r="56"/><circle cx="865" cy="112" r="40"/></g></svg>';
    const truth = await sharp(Buffer.from(VASE_MASK)).greyscale().raw().toBuffer();
    const iou = async (f) => {
      const a = await sharp(f).ensureAlpha().extractChannel(3).raw().toBuffer();
      let inter = 0, uni = 0;
      for (let i = 0; i < a.length; i++) { const p = a[i] > 127, q = truth[i] > 127; if (p && q) inter++; if (p || q) uni++; }
      return inter / uni;
    };
    const vase = S['Vase.jpg'];
    const scores = {};
    for (const q of ['fast', 'best']) {
      if (q === 'best' && !info.r.models.best) { console.log('SKIP the best model (not downloaded)'); continue; }
      t = Date.now();
      const out = await api('save', vase, R({ cutout: true, cutoutQuality: q }), 'copy');
      if (!out.r) { check(false, `cut out (${q}): ${out.e}`); continue; }
      scores[q] = await iou(out.r.path);
      const m = await sharp(out.r.path).metadata();
      check(m.format === 'png' && m.hasAlpha && scores[q] > 0.8, `remove the background (${q}): see-through PNG, outline matches ${(scores[q] * 100).toFixed(1)}% (${Date.now() - t} ms)`);
      check((await pixel(out.r.path, 40, 40))[3] < 10 && (await pixel(out.r.path, 900, 700))[3] > 245, `(${q}) the wall is gone, the vase is kept`);
    }
    if (scores.best !== undefined) check(scores.best >= scores.fast - 0.005, `the best model is at least as clean as the quick one (${(scores.best * 100).toFixed(1)}% vs ${(scores.fast * 100).toFixed(1)}%)`);
    const q = info.r.models.best ? 'best' : 'fast';
    const vaseRgb = await pixel(vase, 900, 700);
    const bgOut = async (background, extra = {}) => (await api('save', vase, R({ cutout: true, cutoutQuality: q, background, ...extra }), 'copy')).r.path;
    const col = await bgOut({ kind: 'colour', colour: '#ff00ff' });
    check((await sharp(col).metadata()).format === 'jpeg' && near(await pixel(col, 40, 40), [255, 0, 255], 12) && near(await pixel(col, 900, 700), vaseRgb, 16), 'a colour behind the subject (saved as the original JPEG)');
    const grad = await bgOut({ kind: 'gradient', colour: '#000000', colour2: '#ffffff', angle: 0 });
    const top = await pixel(grad, 40, 5), bottom = await pixel(grad, 40, 1190);
    check(top[0] < 30 && bottom[0] > 225, `a gradient behind it (${top[0]} → ${bottom[0]})`);
    const blur = await bgOut({ kind: 'blur', blur: 60 });
    const wall = await pixel(vase, 1500, 600), bl = await pixel(blur, 1500, 600);
    check(near(bl, wall, 30) && near(await pixel(blur, 900, 700), vaseRgb, 16), 'the original background, blurred');
    const pic = await bgOut({ kind: 'picture', picture: S['Beach.jpg'] });
    check(near(await pixel(pic, 40, 20), [255, 181, 124], 30), `a picture fills the background (${(await pixel(pic, 40, 20)).slice(0, 3)})`);
    const noShadow = await bgOut({ kind: 'colour', colour: '#ffffff' });
    const shadow = await bgOut({ kind: 'colour', colour: '#ffffff', shadow: 100 });
    const a = await pixel(noShadow, 1000, 930), b = await pixel(shadow, 1000, 930);
    check(b[0] < a[0] - 25, `a soft shadow under the subject (${a[0]} → ${b[0]})`);
    const brushed = await bgOut({ kind: 'clear' }, { strokes: [{ keep: false, r: 0.06, pts: [1012 / 1800, 88 / 1200] }], feather: 30 });
    const gone = (await pixel(brushed, 1012, 88))[3], kept = (await pixel(brushed, 900, 700))[3];
    check(gone < 20 && kept > 200, `the refine brush removes a flower, the rest stays (${gone}, ${kept})`);
    const back = await bgOut({ kind: 'clear' }, { strokes: [{ keep: true, r: 0.05, pts: [100 / 1800, 1000 / 1200, 300 / 1800, 1000 / 1200] }] });
    check((await pixel(back, 200, 1000))[3] > 240 && (await pixel(back, 200, 700))[3] < 20, 'and paints part of the table back in');
    const before = await api('preview', vase, R({ cutout: true, background: { kind: 'colour', colour: '#ff00ff' } }), { before: true });
    check(!!before.r && /^data:image\/jpeg/.test(before.r.url), 'the before view shows the picture as it was');
  }

  // ---------------------------------------------------------------- many at once, through Convert
  const outDir = path.join(HOME, 'Pictures', 'Converted');
  fs.mkdirSync(outDir, { recursive: true });
  const many = await main.evaluate(([inputs, o]) => window.keeper.convert.run({ op: { tool: 'convert.to', args: { format: 'webp' } }, inputs, outDir: o }).then((r) => r, (e) => ({ error: e.message })), [[S['Camera.nef'], S['Poster.psd'], S['Old.bmp'], S['Lake.jpg'], S['App.ico']], outDir]);
  const made = fs.readdirSync(outDir).filter((f) => f.endsWith('.webp'));
  check(made.length === 5, `Convert turns many pictures into WebP at once (${made.join(', ') || many.error})`);
  const toBmp = await main.evaluate(([inputs, o]) => window.keeper.convert.run({ op: { tool: 'convert.to', args: { format: 'bmp' } }, inputs, outDir: o }).then((r) => r, (e) => ({ error: e.message })), [[S['Lake.jpg']], outDir]);
  check(!!toBmp.outputs && readBmpHead(toBmp.outputs[0]).magic === 'BM', 'and into BMP');
  const nefWebp = await sharp(path.join(outDir, 'Camera.webp')).metadata();
  check(nefWebp.width === 3000 && nefWebp.height === 2000, `a RAW file converts upright (${nefWebp.width} × ${nefWebp.height})`);

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await app.close();
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
