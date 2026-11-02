// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/studio.cjs /tmp/kstudio /tmp/kstudio-shots
//
// Drives the real Keeper app's Studio on Linux (X11):
//   - records a short session of the whole screen with the bundled ffmpeg (no pointer
//     in the picture), the pointer moved by xdotool, a pause in the middle, and
//     Chromium's stand-in microphone and camera as their own tracks
//   - checks the project folder: the screen as MP4, the event log with pointer
//     samples, the microphone and camera files, the pause cut from the timeline
//   - adds clicks to the event log (as the xinput reader would) and makes the
//     automatic zooms from the editor, picks a background, checks undo and redo
//   - exports a 720p MP4 and a GIF and checks size, length and streams with ffmpeg
//   - screenshots of the recorder page and the editor in light and dark
const { _electron } = require('playwright');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(process.argv[2] || '/tmp/kstudio');
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const ROOT = path.resolve(__dirname, '../..');
const FFMPEG = require(path.join(ROOT, 'node_modules/ffmpeg-static'));
let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) { failed++; process.exitCode = 1; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => undefined); if (v) return v; await wait(step); } return null; };
const probe = (file) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const t = r.stderr || '';
  const d = t.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const v = t.match(/Video: (\w+)[^\n]*?, (\d{2,5})x(\d{2,5})/);
  return { duration: d ? (+d[1] * 3600 + +d[2] * 60 + +d[3]) * 1000 : 0, codec: v?.[1], width: v ? +v[2] : 0, height: v ? +v[3] : 0, audio: /Audio:/.test(t), text: t };
};
const xdo = (...a) => { try { execFileSync('xdotool', a.map(String)); } catch { /* not there */ } };

fs.rmSync(HOME, { recursive: true, force: true });
for (const d of ['Downloads', 'Desktop', 'Documents', 'Pictures', 'Videos', '.config']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const ENV = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: path.join(HOME, '.config'), XDG_DATA_HOME: path.join(HOME, '.local/share'), XDG_VIDEOS_DIR: path.join(HOME, 'Videos') };
  const app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/.bin/electron'),
    // Chromium's stand-in microphone (a beep) and camera (a test pattern), allowed without asking
    args: [ROOT, '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: ENV,
  });
  let w;
  for (let i = 0; i < 80 && !w; i++) { w = app.windows().find((x) => x.url().includes('view=app')); if (!w) await wait(400); }
  check(!!w, 'the main window opens');
  const errors = [];
  w.on('pageerror', (e) => errors.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await w.waitForSelector('.sidebar', { timeout: 60000 });
  await w.waitForTimeout(1500);
  const nav = (r) => app.evaluate(({ BrowserWindow }, r) => { for (const x of BrowserWindow.getAllWindows()) if (x.webContents.getURL().includes('view=app')) x.webContents.send('event:navigate', r); }, r);
  const setTheme = (mode) => w.evaluate((m) => window.keeper.settings.set({ appearance: m }), mode);

  // ------------------------------------------------ the recorder page
  await setTheme('light');
  await nav('studio');
  await w.waitForSelector('[data-testid="studio-record"]', { timeout: 15000 });
  const support = await w.evaluate(() => window.keeper.studio.support());
  check(support.screen.how === 'ffmpeg' && support.screen.cursorHidden, `X11 records with ffmpeg, pointer left out (${support.screen.how})`);
  await w.evaluate(() => window.keeper.studio.setOptions({ countdown: 0, mic: true, webcam: true, systemAudio: false, fps: 30, mode: 'full', stage: false, hideWindow: false }));
  await nav('home');
  await w.waitForTimeout(300);
  await nav('studio');
  await w.waitForSelector('[data-testid="studio-record"]');
  await w.waitForTimeout(600);
  await w.screenshot({ path: path.join(SHOTS, 'studio-home-light.png') });

  // ------------------------------------------------ record
  xdo('mousemove', 200, 200);
  const started = await w.evaluate(() => window.keeper.studio.record());
  check(started.phase === 'recording' && started.how === 'ffmpeg', `recording started (${started.phase}${started.error ? `: ${started.error}` : ''})`);
  // the pointer glides around the screen
  for (let i = 0; i <= 40; i++) { xdo('mousemove', 200 + i * 25, 200 + Math.round(Math.sin(i / 6) * 150) + i * 8); await wait(50); }
  await wait(600);
  const paused = await w.evaluate(() => window.keeper.studio.pause());
  check(paused.phase === 'paused', 'pausing');
  await wait(1200);
  await w.evaluate(() => window.keeper.studio.resume());
  for (let i = 0; i <= 30; i++) { xdo('mousemove', 1200 - i * 20, 600 - i * 10); await wait(50); }
  await wait(800);
  await w.screenshot({ path: path.join(SHOTS, 'studio-recording-light.png') });
  const stopped = await w.evaluate(() => window.keeper.studio.stop());
  check(stopped.phase === 'idle' && !!stopped.project, `stopped and saved (${stopped.project ?? stopped.error})`);
  const dir = stopped.project;
  const proj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  const ev = JSON.parse(fs.readFileSync(path.join(dir, 'events.json'), 'utf8'));
  const screen = probe(path.join(dir, proj.meta.screen.file));
  check(proj.meta.screen.file === 'screen.mp4' && screen.codec === 'h264' && screen.width === 1440 && screen.height === 900, `the screen is an H.264 MP4 at full size (${screen.codec} ${screen.width}x${screen.height})`);
  check(proj.meta.duration > 4000 && proj.meta.duration < 15000, `the recording is about the right length (${proj.meta.duration} ms)`);
  check(proj.meta.cursorInVideo === false && proj.meta.how === 'ffmpeg', 'the pointer is not in the picture');
  check(ev.moves.length / 3 > 40, `pointer samples were logged (${ev.moves.length / 3})`);
  const xs = ev.moves.filter((_, i) => i % 3 === 1);
  check(Math.max(...xs) > 900 && Math.min(...xs) < 400, `the samples follow the pointer (x ${Math.min(...xs)}–${Math.max(...xs)})`);
  check(!!proj.meta.mic && fs.existsSync(path.join(dir, proj.meta.mic.file)) && probe(path.join(dir, proj.meta.mic.file)).audio, `the microphone is its own track (${proj.meta.mic?.file}, starts ${proj.meta.mic?.offset} ms in)`);
  check(!!proj.meta.webcam && probe(path.join(dir, proj.meta.webcam.file)).width > 0, `the camera is its own track (${proj.meta.webcam?.file})`);
  check(proj.timeline.clips.length === 2 && proj.timeline.clips[1].start - proj.timeline.clips[0].end > 900, `the pause is cut from the timeline (${JSON.stringify(proj.timeline.clips.map((c) => [c.start, c.end]))})`);
  check(fs.existsSync(path.join(dir, 'thumb.jpg')), 'a thumbnail was made');

  // clicks, as the xinput reader logs them on a desktop with it installed
  const at = (t) => { let best = 0; for (let i = 0; i < ev.moves.length; i += 3) if (ev.moves[i] <= t) best = i; return [ev.moves[best + 1], ev.moves[best + 2]]; };
  const clickTimes = [800, 1500, proj.meta.duration - 1500];
  ev.clicks = clickTimes.map((t) => { const [x, y] = at(t); return { t, x, y }; });
  ev.keys = [{ t: 2000, key: 'k', mods: ['ctrl'] }];
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify(ev));

  // ------------------------------------------------ the editor (opened again, to read the clicks)
  await nav('studio');
  await w.waitForTimeout(500);
  await nav(`studio:${dir}`);
  const ed = await w.waitForSelector('[data-testid="studio-editor"]', { timeout: 20000 }).catch(() => null);
  check(!!ed, 'the recording opens in the editor');
  await w.waitForFunction(() => !document.querySelector('.studio-loading'), null, { timeout: 20000 }).catch(() => undefined);
  await w.click('button[role="tab"]:has-text("Zoom")');
  await w.click('button:has-text("Make zooms again")');
  await w.waitForTimeout(400);
  const zoomBlocks = await w.locator('.tl-block.zoom').count();
  check(zoomBlocks >= 2, `automatic zooms from the clicks (${zoomBlocks})`);
  await w.click('button[role="tab"]:has-text("Frame")');
  await w.click('button[role="radio"][aria-label="Dusk"]');
  await w.keyboard.press('Control+z');
  await w.waitForTimeout(200);
  const afterUndo = await w.locator('button[role="radio"][aria-label="Dusk"][aria-checked="true"]').count();
  await w.keyboard.press('Control+Shift+z');
  await w.waitForTimeout(200);
  const afterRedo = await w.locator('button[role="radio"][aria-label="Dusk"][aria-checked="true"]').count();
  check(afterUndo === 0 && afterRedo === 1, 'undo and redo a background change');
  // to a moment inside a zoom, so the screenshot shows one
  const ruler = await w.locator('.tl-ruler').boundingBox();
  await w.mouse.click(ruler.x + ruler.width * 0.2, ruler.y + ruler.height / 2);
  await w.waitForTimeout(1200);
  await w.screenshot({ path: path.join(SHOTS, 'studio-editor-light.png') });
  const lit = await w.evaluate(() => { const c = document.querySelector('[data-testid="studio-canvas"]'); const x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 30) n++; return n; });
  check(lit > 100, 'the preview draws a frame');
  await setTheme('dark');
  await w.waitForTimeout(800);
  await w.screenshot({ path: path.join(SHOTS, 'studio-editor-dark.png') });
  // wait for the debounced save, then check it reached the disk
  await w.waitForTimeout(1200);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  check(saved.timeline.zooms.length >= 2 && saved.style.frame.background.id === 'dusk', 'edits are saved to the project');

  // ------------------------------------------------ export
  const exportOnce = async (preset, label) => {
    await w.click('[data-testid="studio-export"]');
    await w.waitForSelector('.st-presets', { timeout: 5000 });
    await w.click(`.st-preset:has-text("${preset}")`);
    const t0 = Date.now();
    await w.click('[data-testid="studio-export-start"]');
    const done = await until(() => w.evaluate(() => { const e = document.querySelector('.modal .st-error')?.textContent; if (e) return `error: ${e}`; const t = document.querySelector('[data-testid="studio-export-phase"]')?.textContent ?? ''; return /^Done|went wrong|could not|stopped/i.test(t) ? t : null; }), 240000, 500);
    const out = await w.evaluate(() => document.querySelector('.st-done .mono')?.textContent ?? null);
    console.log(`INFO ${label}: ${done} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (out) await w.screenshot({ path: path.join(SHOTS, `studio-export-${label}-dark.png`) });
    await w.click('.modal button:has-text("Done"), .modal button:has-text("Close")').catch(() => undefined);
    await w.waitForTimeout(300);
    return out;
  };
  const mp4 = await exportOnce('Quick share', 'mp4');
  const expected = saved.timeline.clips.reduce((n, c) => n + (c.end - c.start) / c.speed, 0);
  if (mp4) {
    const p = probe(mp4);
    // the frame keeps the recording's shape (1440×900 → 1152×720 at 720 lines)
    check(p.codec === 'h264' && p.width === 1152 && p.height === 720, `the MP4 is H.264 at 1152×720 (${p.codec} ${p.width}x${p.height})`);
    check(Math.abs(p.duration - expected) < 250, `the MP4 is as long as the timeline (${Math.round(p.duration)} ms, timeline ${Math.round(expected)} ms)`);
    check(p.audio, 'the MP4 has the microphone’s sound');
    check(fs.statSync(mp4).size > 20000, `the MP4 has substance (${fs.statSync(mp4).size} bytes)`);
  } else check(false, 'the MP4 export finished');
  const gif = await exportOnce('GIF', 'gif');
  if (gif) {
    const p = probe(gif);
    check(p.codec === 'gif' && p.height === 480, `the GIF is 480 lines (${p.codec} ${p.width}x${p.height})`);
  } else check(false, 'the GIF export finished');

  const webm = await exportOnce('Web', 'webm');
  if (webm) {
    const p = probe(webm);
    check(p.codec === 'vp9' && p.height === 1080 && p.audio, `the WebM is VP9 at 1080 lines with sound (${p.codec} ${p.width}x${p.height})`);
    check(Math.abs(p.duration - expected) < 250, `the WebM is as long as the timeline (${Math.round(p.duration)} ms)`);
  } else check(false, 'the WebM export finished');

  check(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await setTheme('light');
  await nav('studio');
  await w.waitForSelector('.studio-card', { timeout: 10000 }).catch(() => undefined);
  await w.waitForTimeout(600);
  await w.screenshot({ path: path.join(SHOTS, 'studio-projects-light.png') });
  await app.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
