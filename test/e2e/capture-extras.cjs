// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/capture-extras.cjs /tmp/kcx /tmp/kcx-shots
//
// Drives the real Keeper app on Linux (X11, with openbox as the window manager when it is installed):
//   - share links: a small WebDAV server stands in for the person's own storage; Studio's
//     "Upload and copy link" uploads a video and its page (player, chapters, captions,
//     transcript, download), the link is copied, and the page plays the video from there
//   - Capture: the preview after each screenshot (they stack), Pin from the preview (opacity,
//     clicks going through and back, Esc closes), Upload from the preview, the self-timer,
//     a window with its shadow on a see-through background, and a scrolling capture of a
//     long page (scrolled with xdotool, stitched where the frames overlap)
// Screenshots of the screen (light and dark) for each.
const { _electron } = require('playwright');
const { execFileSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const HOME = path.resolve(process.argv[2] || '/tmp/kcx');
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const ROOT = path.resolve(__dirname, '../..');
const FFMPEG = require(path.join(ROOT, 'node_modules/ffmpeg-static'));
let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) { failed++; process.exitCode = 1; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => undefined); if (v) return v; await wait(step); } return null; };
const xdo = (...a) => { try { execFileSync('xdotool', a.map(String)); return true; } catch { return false; } };
/** The whole X screen, as a person would see it. */
const grabScreen = (file) => spawnSync(FFMPEG, ['-loglevel', 'error', '-f', 'x11grab', '-video_size', '1440x900', '-i', process.env.DISPLAY || ':99', '-frames:v', '1', '-y', file]);
/** An overlay page (a data: URL) whose text includes `text`; only URLs are read, so busy pages never hold the search up. */
const overlayWith = (app, text) => app.windows().find((p) => { try { const u = p.url(); return u.startsWith('data:') && decodeURIComponent(u).includes(text); } catch { return false; } }) ?? null;
const pngSize = (file) => { const b = fs.readFileSync(file); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), alphaType: b[25] }; };

fs.rmSync(HOME, { recursive: true, force: true });
for (const d of ['Downloads', 'Desktop', 'Documents', 'Pictures', 'Videos', '.config']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

// ------------------------------------------------ the person's own storage: a tiny WebDAV server
const stored = new Map();
const types = new Map();
const dav = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (req.method === 'MKCOL') { res.writeHead(201).end(); return; }
  if (req.method === 'PUT') {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => { stored.set(p, Buffer.concat(parts)); types.set(p, req.headers['content-type']); res.writeHead(201).end(); });
    return;
  }
  if (req.method === 'GET' && stored.has(p)) {
    const body = stored.get(p);
    res.writeHead(200, { 'content-type': types.get(p) || 'application/octet-stream', 'content-length': body.length, 'accept-ranges': 'none' });
    res.end(body);
    return;
  }
  res.writeHead(404).end();
});

(async () => {
  await new Promise((r) => dav.listen(0, '127.0.0.1', r));
  const DAV = `http://127.0.0.1:${dav.address().port}/dav`;
  // A window manager, so windows can be listed and picked (as on any desktop).
  let wm = null;
  try { execFileSync('which', ['openbox']); wm = spawn('openbox', [], { stdio: 'ignore' }); await wait(800); } catch { console.log('INFO no openbox: window capture is checked without a window manager'); }

  const ENV = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SKIP_TOUR: '1', KEEPER_SUITE: 'shared', XDG_CONFIG_HOME: path.join(HOME, '.config'), XDG_DATA_HOME: path.join(HOME, '.local/share'), XDG_PICTURES_DIR: path.join(HOME, 'Pictures'), XDG_SESSION_TYPE: 'x11' };
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: ENV });
  let w;
  for (let i = 0; i < 80 && !w; i++) { w = app.windows().find((x) => x.url().includes('view=app')); if (!w) await wait(400); }
  check(!!w, 'the main window opens');
  const errors = [];
  w.on('pageerror', (e) => errors.push(e.message));
  await w.waitForSelector('.sidebar', { timeout: 60000 });
  await w.waitForTimeout(1200);
  const nav = (r) => app.evaluate(({ BrowserWindow }, r) => { for (const x of BrowserWindow.getAllWindows()) if (x.webContents.getURL().includes('view=app')) x.webContents.send('event:navigate', r); }, r);
  const setTheme = (mode) => w.evaluate((m) => window.keeper.settings.set({ appearance: m }), mode);
  const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  const windowByTitle = async (re) => { for (const p of app.windows()) { const t = await p.title().catch(() => ''); if (re.test(t)) return p; } return null; };
  const mainBounds = () => app.evaluate(({ BrowserWindow }) => { const x = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('view=app')); x.setBounds({ x: 0, y: 0, width: 1440, height: 900 }); return x.getBounds(); });
  await mainBounds();

  // ------------------------------------------------ Studio: Upload and copy link
  await nav('studio');
  await w.waitForTimeout(800);
  const none = await w.evaluate(() => window.keeper.studio.shareTarget());
  check(none.kind === 'none', 'with no storage set up, nothing can be uploaded');
  const refused = await w.evaluate(() => window.keeper.studio.share('/nope.mp4', null, { hours: 0 }).then(() => 'uploaded', (e) => e.message));
  check(/exported video|Upload & share/.test(refused), `sharing without storage or a video is refused (${refused})`);
  const s0 = await w.evaluate(() => window.keeper.settings.get());
  await w.evaluate((u) => window.keeper.settings.get().then((s) => window.keeper.settings.set({ island: { ...s.island, upload: u } })), { ...s0.island.upload, kind: 'webdav', url: DAV, username: '', prefix: 'keeper', publicUrl: '' });
  const target = await w.evaluate(() => window.keeper.studio.shareTarget());
  check(target.kind === 'webdav' && target.where.startsWith('127.0.0.1'), `the storage is the person's own (${target.where})`);

  const video = path.join(HOME, 'Videos', 'Demo walkthrough.mp4');
  spawnSync(FFMPEG, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', video]);
  check(fs.existsSync(video), 'a short video to share');
  const shared = await w.evaluate((v) => window.keeper.studio.share(v, null, { hours: 24 }), video);
  check(/^http:\/\/127\.0\.0\.1:\d+\/dav\/keeper\/[a-z0-9]+\/index\.html$/.test(shared.link), `a link to the page in the person's storage (${shared.link})`);
  const files = [...stored.keys()];
  check(files.some((f) => f.endsWith('/Demo walkthrough.mp4')) && files.some((f) => f.endsWith('/index.html')), `the video and its page were uploaded side by side (${files.join(', ')})`);
  const vid = [...stored.entries()].find(([k]) => k.endsWith('.mp4'))?.[1];
  check(vid && vid.equals(fs.readFileSync(video)), 'the uploaded video is the same file');
  check((await clipboard()) === shared.link, 'the link was copied');
  check(shared.expiresAt > Date.now() + 23 * 3600_000, 'the page says when the link ends');
  const html = stored.get(new URL(shared.link).pathname).toString('utf8');
  check(html.includes('src="./Demo%20walkthrough.mp4"') && html.includes('Download'), 'the page plays and downloads the video next to it');
  const islandAlert = await w.evaluate(() => window.keeper.island.state().then((s) => s.alerts.map((a) => a.title)));
  check(islandAlert.includes('Link copied'), `the Island says "Link copied" (${islandAlert.slice(0, 3).join(', ')})`);

  // The page in a browser window: the video plays from the person's storage; chapters and transcript follow.
  const page = Buffer.from(html.replace('"chapters":[]', '"chapters":[{"t":0,"title":"Opening the app"},{"t":1500,"title":"Choosing a folder"},{"t":3000,"title":"Sharing the result"}]')
    .replace('"paragraphs":[]', '"paragraphs":[{"start":0,"text":"Here is how to share a walkthrough with your team."},{"start":2200,"text":"Pick the folder, then send the link; it stays in your own storage."}]')
    .replace('id="chapters-box" hidden', 'id="chapters-box"').replace('id="transcript-box" hidden', 'id="transcript-box"'));
  const demoPath = new URL(shared.link).pathname.replace('index.html', 'demo.html');
  stored.set(demoPath, page);
  types.set(demoPath, 'text/html; charset=utf-8');
  for (const theme of ['light', 'dark']) {
    const shot = await app.evaluate(async ({ BrowserWindow, nativeTheme }, { url, theme }) => {
      nativeTheme.themeSource = theme;
      const v = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { sandbox: true } });
      await v.loadURL(url);
      const played = await v.webContents.executeJavaScript(`new Promise((r) => { const x = document.getElementById('v'); if (x.readyState >= 1) r(x.duration); else x.addEventListener('loadedmetadata', () => r(x.duration)); setTimeout(() => r(-1), 8000); })`);
      await v.webContents.executeJavaScript(`document.getElementById('v').currentTime = 1.6; document.querySelectorAll('#chapters button')[1].classList.add('on'); 1`);
      await new Promise((r) => setTimeout(r, 900));
      const img = await v.webContents.capturePage();
      v.destroy();
      nativeTheme.themeSource = 'system';
      return { played, png: img.toPNG().toString('base64') };
    }, { url: `${DAV.replace('/dav', '')}${demoPath}`, theme });
    fs.writeFileSync(path.join(SHOTS, `capture-share-viewer-${theme}.png`), Buffer.from(shot.png, 'base64'));
    if (theme === 'light') check(shot.played > 3.5, `the page loads the video from the storage (${shot.played} s long)`);
  }

  // The export dialog offers the link.
  // (A full record-and-export with "Upload and copy link" runs in test/e2e/studio.cjs.)

  // ------------------------------------------------ Capture: preview after each screenshot
  await w.evaluate(() => window.keeper.capture.setOptions({ quickPreview: true, quickSeconds: 0, timer: 0, windowShadow: true, annotateAfterScreenshot: false }));
  await nav('capture');
  await w.waitForTimeout(600);
  const shot1 = await w.evaluate(() => window.keeper.capture.screenshot('full'));
  const shot2 = await w.evaluate(() => window.keeper.capture.screenshot('full'));
  check(!!shot1 && !!shot2 && fs.existsSync(shot2), 'two screenshots saved');
  const pv = await until(async () => { const s = await w.evaluate(() => window.keeper.capture.previews()); return s.shown.length === 2 ? s : null; }, 8000);
  check(!!pv, `the previews stack in the corner (${JSON.stringify(pv?.shown)})`);
  const preview = await until(() => windowByTitle(/capture preview/i), 5000);
  check(!!preview, 'the preview window is up');
  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    await w.waitForTimeout(700);
    grabScreen(path.join(SHOTS, `capture-preview-${theme}.png`));
  }
  await setTheme('light');

  // Upload from the preview: the picture goes to the person's storage and the link is copied.
  const before = stored.size;
  await preview.click('.card:last-child button[aria-label="Upload and copy link"]');
  const up = await until(async () => (stored.size > before ? [...stored.keys()].find((k) => k.endsWith('.png')) : null), 10000);
  check(!!up, `Upload sends the screenshot to the storage (${up})`);
  check(/\/dav\/keeper\/[a-z0-9]+\/Screenshot.*\.png$/.test(await clipboard()), 'and copies its link');

  // Pin from the preview.
  const prev2 = await until(() => windowByTitle(/capture preview/i), 3000);
  await prev2.click('.card:last-child button[aria-label="Pin on screen"]');
  const pinned = await until(async () => { const l = await w.evaluate(() => window.keeper.capture.pins()); return l.length ? l : null; }, 8000);
  check(!!pinned && pinned.length === 1, 'Pin puts the picture on top of everything');
  const id = pinned?.[0].id;
  await w.evaluate((id) => window.keeper.capture.setPin(id, { opacity: 0.55 }), id);
  await w.evaluate((id) => window.keeper.capture.setPin(id, { through: true }), id);
  let pins = await w.evaluate(() => window.keeper.capture.pins());
  check(pins[0]?.opacity === 0.55 && pins[0]?.through === true, `opacity and clicks going through (${JSON.stringify(pins[0] && { o: pins[0].opacity, t: pins[0].through })})`);
  await nav('capture');
  await w.waitForTimeout(3500);
  const pinLine = await w.locator('[data-testid="capture-pins"]').textContent().catch(() => '');
  check(/1 picture pinned/.test(pinLine) && /clicks go through/.test(pinLine), `Capture lists the pin (${pinLine?.trim()})`);
  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    await w.waitForTimeout(700);
    grabScreen(path.join(SHOTS, `capture-pin-${theme}.png`));
  }
  await setTheme('light');
  await w.evaluate(() => window.keeper.capture.clickablePins());
  pins = await w.evaluate(() => window.keeper.capture.pins());
  check(pins[0]?.through === false, 'the pin takes clicks again');
  const pinWin = await windowByTitle(/pinned picture/i);
  if (pinWin) {
    await pinWin.bringToFront().catch(() => undefined);
    await pinWin.keyboard.press('Escape').catch(() => undefined);
  }
  check(!!(await until(async () => ((await w.evaluate(() => window.keeper.capture.pins())).length === 0 ? true : null), 5000)), 'Esc closes the pin');
  await w.evaluate(() => window.keeper.capture.closePreviews());

  // Self-timer: the countdown shows, then the picture is taken.
  const t0 = Date.now();
  const timed = await w.evaluate(() => window.keeper.capture.screenshot('full', { timer: 3 }));
  const took = Date.now() - t0;
  check(!!timed && took >= 3000 && took < 9000, `the self-timer waits 3 seconds (${took} ms)`);
  await w.evaluate(() => window.keeper.capture.closePreviews());

  // ------------------------------------------------ a window with its shadow, and a scrolling capture
  const LONG = `<!doctype html><html><head><title>Long page</title><style>body{margin:0;font:16px sans-serif}div{height:36px;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid #ddd}b{display:inline-block;height:14px;border-radius:7px}</style></head><body>${Array.from({ length: 80 }, (_, i) => `<div><span>Row ${i + 1}</span><b style="width:${40 + ((i * 37) % 200)}px;background:hsl(${(i * 47) % 360} 70% 55%)"></b><span>${'item '.repeat(1 + (i % 7))}</span></div>`).join('')}</body></html>`;
  await app.evaluate(async ({ BrowserWindow }, html) => {
    const t = new BrowserWindow({ x: 820, y: 120, width: 560, height: 520, title: 'Long page', show: true, webPreferences: { sandbox: true } });
    t.on('page-title-updated', (e) => e.preventDefault());
    await t.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    globalThis.__longPage = t;
  }, LONG);
  await wait(800);
  // Window: pick "Long page" from the chooser.
  const winShot = w.evaluate(() => window.keeper.capture.screenshot('window').catch((e) => `error: ${e.message}`));
  const chooser = await until(async () => overlayWith(app, 'Choose a window'), 8000);
  if (chooser) {
    const names = await chooser.locator('button span').allTextContents();
    const ok = await chooser.locator('button:has(span:text-is("Long page"))').count();
    if (ok) await chooser.click('button:has(span:text-is("Long page"))');
    else await chooser.keyboard.press('Escape');
    const p = await winShot;
    if (ok && typeof p === 'string' && p.endsWith('.png')) {
      const s = pngSize(p);
      check(s.width > 560 && s.height > 520 && s.alphaType === 6, `the window comes with a shadow on a see-through background (${s.width}×${s.height}, colour type ${s.alphaType})`);
      fs.copyFileSync(p, path.join(SHOTS, 'capture-window-shadow.png'));
    } else check(false, `the window chooser lists "Long page" (${names.join(', ')}; ${p})`);
  } else check(false, `the window chooser opens (${await winShot})`);
  await w.evaluate(() => window.keeper.capture.closePreviews());

  // Scrolling: drag over the long page; Keeper scrolls it with xdotool and stitches the frames.
  const b = await app.evaluate(() => globalThis.__longPage.getContentBounds());
  const scroll = w.evaluate(() => window.keeper.capture.screenshot('scroll').catch((e) => `error: ${e.message}`));
  const area = await until(async () => overlayWith(app, 'the part of the window that scrolls'), 8000);
  check(!!area, 'the area chooser asks for the part that scrolls');
  if (area) await area.evaluate((r) => window.keeperCapture.done(r), { x: b.x + 10, y: b.y + 10, w: b.width - 40, h: 380 });
  const bar = await until(() => windowByTitle(/scrolling capture/i), 6000);
  check(!!bar, 'a Stop bar shows outside the captured part');
  if (bar) grabScreen(path.join(SHOTS, 'capture-scrolling-light.png'));
  const long = await Promise.race([scroll, wait(90_000).then(() => 'timeout')]);
  if (typeof long === 'string' && long.endsWith('.png')) {
    const s = pngSize(long);
    check(s.height > 380 * 3, `one tall picture from the scrolled page (${s.width}×${s.height})`);
    fs.copyFileSync(long, path.join(SHOTS, 'capture-scrolling-result.png'));
  } else check(false, `the scrolling capture finished (${long})`);
  await app.evaluate(() => globalThis.__longPage.destroy());
  await w.evaluate(() => window.keeper.capture.closePreviews());

  check(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await app.close();
  if (wm) wm.kill();
  dav.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
