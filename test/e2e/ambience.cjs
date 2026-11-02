// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/ambience.cjs /tmp/kamb /tmp/kamb-shots
// Drives the real Keeper app's wallpaper, vibes, ambient sound, folder icons
// and widgets on Linux (X11 under Xvfb). Commands that would change this
// machine's desktop (gsettings, gdbus, gio) are written to a file instead
// (KEEPER_AMBIENCE_DRYRUN); the KDE .directory route writes real files in the
// temporary home. Also measures what the wallpaper costs and saves it to
// <shots>/cost.json for docs/AMBIENCE.md.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(require('os').tmpdir(), 'kamb-')));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
// KEEPER_APP_ROOT runs against another built copy of the app (default: this checkout).
const ROOT = process.env.KEEPER_APP_ROOT ? path.resolve(process.env.KEEPER_APP_ROOT) : path.resolve(__dirname, '../..');
const DRY = path.join(HOME, 'ambience-dryrun.log');
let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) { failed++; process.exitCode = 1; } };
const until = async (fn, ms = 20000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, step)); } return null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dry = () => (fs.existsSync(DRY) ? fs.readFileSync(DRY, 'utf8') : '');

for (const d of ['Downloads', 'Desktop', 'Documents', 'Pictures/Trips']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const env = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: path.join(HOME, '.config'), XDG_DATA_HOME: path.join(HOME, '.local/share'), XDG_SESSION_TYPE: 'x11', KEEPER_AMBIENCE_DRYRUN: DRY, KEEPER_SKIP_TOUR: '1' };
  delete env.WAYLAND_DISPLAY;
  delete env.XDG_CURRENT_DESKTOP;
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox', '--enable-unsafe-swiftshader'], env }); // test only: software WebGL under Xvfb, so the shaders really compile and draw
  await app.firstWindow();
  const isMain = (x) => { const u = x.url(); return u && (!u.includes('view=') || u.includes('view=app')); };
  const w = await until(async () => app.windows().find(isMain), 30000, 200);
  const errors = [];
  w.on('pageerror', (e) => errors.push(e.message));
  await w.waitForSelector('.sidebar', { timeout: 60000 });
  await w.waitForTimeout(2500);
  const skip = await w.$('.tour button:has-text("Skip tour")');
  if (skip) await skip.click();
  await w.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  const amb = (fn, ...a) => w.evaluate(([f, args]) => window.keeper.ambience[f](...args), [fn, a]);
  const wid = (fn, ...a) => w.evaluate(([f, args]) => window.keeper.widgets[f](...args), [fn, a]);
  const wallWins = () => app.windows().filter((x) => x.url().includes('view=wallpaper') && !x.url().includes('still=1'));
  const setDark = (dark) => w.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark);
  await setDark(false);

  // ---- light by default: nothing runs until asked
  let s = await amb('state');
  check(s.features.wallpaper === false && wallWins().length === 0, 'live wallpaper is off by default: no windows');
  check(s.strategy === 'desktop-window', `X11 uses desktop-type windows (${s.strategy})`);
  check(s.settings.vibes.length >= 8 && s.features.vibes && s.features.ambientSound, 'starter vibes are there; vibes and sound features on');
  const usage0 = await w.evaluate(() => window.keeper.usage.get());
  check(!usage0.checks.some((c) => c.name.startsWith('wallpaper') || c.name === 'vibes-schedule'), 'no wallpaper or schedule checks while off');

  // ---- widgets: moved out of ipc/island.ts, same behaviour, plus new kinds and arrange mode
  const made = await w.evaluate(() => {
    const id = 'wtest' + Date.now();
    return window.keeper.widgets.save({ id, kind: 'year', bounds: { x: 300, y: 300, width: 260, height: 150 }, locked: false, allWorkspaces: true, style: { font: 'system', size: 1, color: '#ffffff', background: 'tinted', bgColor: '#111', bgColor2: '#333', radius: 22, opacity: 0.92, shape: 'pill' }, options: {} }).then((l) => ({ id, n: l.length }));
  });
  const ww = await until(async () => app.windows().find((x) => x.url().includes(`view=widget`) && x.url().includes(made.id)), 15000);
  check(!!ww, 'saving a widget opens its window (widgets IPC works from its new module)');
  if (ww) {
    await ww.waitForSelector('.wg-progress', { timeout: 10000 }).catch(() => undefined);
    check(await ww.locator('.wg-progress').count() === 3, 'the Year progress widget draws year, month and day');
    check(await ww.locator('.wg.shape-pill').count() === 1, 'the pill shape is applied');
  }
  for (const kind of ['day', 'season', 'world', 'quote']) {
    await w.evaluate((k) => window.keeper.widgets.save({ id: 'k' + k, kind: k, bounds: { x: 40, y: 40, width: 260, height: 160 }, locked: true, allWorkspaces: true, style: { font: 'system', size: 1, color: '#fff', background: 'glass', bgColor: '#111', bgColor2: '#333', radius: 22, opacity: 0.92 }, options: k === 'world' ? { places: [{ label: 'Tokyo', zone: 'Asia/Tokyo' }, { label: 'Lagos', zone: 'Africa/Lagos' }] } : {} }), kind);
  }
  const worldWin = await until(async () => app.windows().find((x) => x.url().includes('view=widget') && x.url().includes('kworld')), 15000);
  if (worldWin) await worldWin.waitForSelector('.wg-world-row', { timeout: 10000 }).catch(() => undefined);
  check(!!worldWin && await worldWin.locator('.wg-world-row').count() === 2, 'the World clock widget lists its places');
  const quoteWin = await until(async () => app.windows().find((x) => x.url().includes('view=widget') && x.url().includes('kquote')), 15000);
  check(!!quoteWin && /“.+”/.test(await quoteWin.locator('.wg-quote').innerText().catch(() => '')), 'the Quote widget shows the day’s line');
  check(await wid('arrange', true) === true && await wid('arranging') === true, 'arrange mode turns on');
  // Drag a widget near the screen's left edge: it snaps to the margin.
  await app.evaluate(({ BrowserWindow }, id) => {
    const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(id));
    win.setBounds({ x: 7, y: 300, width: 260, height: 150 });
    win.emit('moved');
  }, made.id);
  const snapped = await until(async () => { const l = await wid('list'); const x = l.find((v) => v.id === made.id); return x && x.bounds.x === 16 ? x : null; }, 5000);
  check(!!snapped, `a dragged widget snaps to the edge margin in arrange mode (x=${snapped?.bounds.x})`);
  await wid('arrange', false);
  await w.click('.sidebar [title="Widgets"]').catch(() => undefined);
  await w.waitForSelector('[data-testid="wg-arrange"]', { timeout: 10000 }).catch(() => undefined);
  check(await w.locator('.wg-add:has-text("Year progress")').count() === 1 && await w.locator('.wg-add:has-text("World clock")').count() === 1, 'the Widgets page offers the new kinds');
  await w.screenshot({ path: path.join(SHOTS, 'widgets-light.png') });

  // ---- the page
  await w.click('.sidebar [title="Wallpaper & Vibes"]');
  check(!!(await until(() => w.$('[data-testid="amb-page"]'), 15000)), 'Wallpaper & Vibes opens from the sidebar');
  await w.waitForTimeout(600);
  await w.screenshot({ path: path.join(SHOTS, 'vibes-light.png') });

  // ---- live wallpaper on: one desktop-type window per display, drawing
  await w.click('[data-testid="amb-live"] button[role="switch"]');
  const wp = await until(async () => wallWins()[0], 20000);
  check(!!wp, 'turning it on opens a wallpaper window');
  s = await amb('state');
  check(s.features.wallpaper && s.settings.wallpaper.enabled, 'the feature and the setting are on');
  check(wallWins().length === s.displays.length, `one window per display (${wallWins().length}/${s.displays.length})`);
  const wpErrors = [];
  wp.on('console', (m) => { if (m.type() === 'error') wpErrors.push(m.text()); });
  wp.on('pageerror', (e) => wpErrors.push(e.message));
  check(!!(await until(async () => (await wp.locator('.wp-root[data-running="1"] canvas').count()) === 1, 15000)), `the scene draws on a WebGL canvas, running${await wp.locator('[data-error]').getAttribute('data-error').catch(() => '') || ''}`);
  const xid = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=wallpaper'));
    const b = win.getNativeWindowHandle();
    return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
  });
  let wtype = '';
  try { wtype = execFileSync('xprop', ['-id', String(xid), '_NET_WM_WINDOW_TYPE'], { encoding: 'utf8' }); } catch (e) { wtype = String(e); }
  check(/_NET_WM_WINDOW_TYPE_DESKTOP/.test(wtype), `the X11 window is a desktop-type window (${wtype.trim()})`);
  const ignores = await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=wallpaper')); return !win.isFocusable(); });
  check(ignores, 'the wallpaper window never takes focus');
  const u1 = await w.evaluate(() => window.keeper.usage.get());
  check(u1.checks.some((c) => c.name === 'wallpaper-cover'), 'while on, one full-screen check runs through the governor');
  await sleep(6000);
  await wp.screenshot({ path: path.join(SHOTS, 'wallpaper-aurora.png') });

  // ---- every scene compiles and draws (WebGL in Chromium’s renderer)
  const scenes = (await w.evaluate(() => import('/core/scenes/catalog.ts').then((m) => m.SCENES.map((x) => x.id)).catch(() => null))) ?? ['aurora', 'nebula', 'mesh', 'lava', 'silk', 'contours', 'hexes', 'rain', 'snow', 'ocean', 'dunes', 'rays', 'fireflies', 'koi'];
  for (const id of scenes) {
    await amb('setWallpaper', 'all', { kind: 'scene', scene: id, palette: '', params: { speed: 1, intensity: 0.7, scale: 1, grain: 0.15, vignette: 0.35, seed: 0 } });
    await sleep(900);
    if (['ocean', 'koi', 'fireflies'].includes(id)) await wp.screenshot({ path: path.join(SHOTS, `wallpaper-${id}.png`) });
  }
  check(!wpErrors.some((e) => /shader|ERROR: 0:|link error|WebGL/i.test(e)), `all ${scenes.length} scenes compile without errors${wpErrors.length ? ` (${wpErrors.slice(0, 2).join(' | ')})` : ''}`);

  // ---- cost, measured (running at 30 fps, then paused)
  await amb('setWallpaper', 'all', { kind: 'scene', scene: 'aurora', palette: 'polar', params: { speed: 1, intensity: 0.7, scale: 1, grain: 0.15, vignette: 0.35, seed: 0 } });
  await sleep(7000);
  const costRun = await amb('cost');
  const costByQuality = {};
  for (const q of ['efficient', 'balanced', 'full']) {
    const st = await amb('state');
    await amb('set', { wallpaper: { ...st.settings.wallpaper, quality: q } });
    await sleep(6500);
    costByQuality[q] = await amb('cost');
  }
  const st0 = await amb('state');
  await amb('set', { wallpaper: { ...st0.settings.wallpaper, quality: 'balanced' } });
  check(costRun.displays.length >= 1 && costRun.displays[0].running && costRun.displays[0].fps > 0, `the cost card measures a running wallpaper (${JSON.stringify(costRun.displays[0])}, GPU process ${costRun.gpuCpu}%)`);

  // ---- the governor pauses it: screen locked, then unlocked
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'));
  check(!!(await until(async () => (await wp.locator('.wp-root[data-running="0"]').count()) === 1, 8000)), 'locking the screen stops drawing');
  await sleep(6000);
  const costLocked = await amb('cost');
  check(costLocked.displays.every((d) => !d.running), `paused windows report not running (${JSON.stringify(costLocked.displays[0])})`);
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('unlock-screen'));
  check(!!(await until(async () => (await wp.locator('.wp-root[data-running="1"]').count()) === 1, 8000)), 'unlocking starts it again');
  // On battery with "save energy": half the frame rate at half resolution.
  await app.evaluate(({ powerMonitor }) => { powerMonitor.isOnBatteryPower = () => true; powerMonitor.emit('on-battery'); });
  s = await until(async () => { const x = await amb('state'); return x.displays[0].live && x.displays[0].live.scale === 0.5 ? x : null; }, 8000);
  check(!!s && s.displays[0].live.fps === 15 && /battery/i.test(s.displays[0].live.reason ?? ''), `on battery it saves energy (${JSON.stringify(s?.displays[0].live)})`);
  await sleep(6000);
  const costBattery = await amb('cost');
  await app.evaluate(({ powerMonitor }) => { powerMonitor.isOnBatteryPower = () => false; powerMonitor.emit('on-ac'); });
  fs.writeFileSync(path.join(SHOTS, 'cost.json'), JSON.stringify({ running30fpsBalanced: costRun, byQuality: costByQuality, locked: costLocked, battery: costBattery, renderer: 'Xvfb (software GL)' }, null, 2));

  // ---- vibes: switch from the page; theme and wallpaper change together
  await w.click('[data-testid="amb-tab-vibes"]');
  await w.click('[data-testid="amb-vibe-deep-work"] .amb-vibe-swatch');
  s = await until(async () => { const x = await amb('state'); return x.settings.activeVibe === 'deep-work' ? x : null; }, 8000);
  check(!!s && s.settings.wallpaper.default.scene === 'contours', 'a vibe switches the wallpaper');
  const theme = await w.evaluate(() => window.keeper.settings.get().then((x) => x.theme));
  check(theme === 'minimal', `and the theme (${theme})`);
  check(!!(await until(async () => (await w.evaluate(() => window.keeper.island.state())).focus.mode === 'focus', 5000)), 'and starts the vibe’s focus session');
  await w.evaluate(() => window.keeper.island.focus('stop'));
  // ---- the tray's submenu (built by the same code as the tray)
  const tray = await amb('trayPreview');
  const top = tray[0];
  check(/Vibe: .*Deep work/.test(top?.label ?? ''), `the tray shows the active vibe (${top?.label})`);
  const labels = (top?.submenu ?? []).map((x) => x.label);
  check(labels.some((l) => /Rainy day/.test(l)) && labels.includes('Pause Wallpaper') && labels.includes('Sound Mixer…') && labels.includes('Arrange Widgets'), `the tray lists vibes, pause, mixer and arrange (${labels.length} items)`);
  check((top?.submenu ?? []).find((x) => /Deep work/.test(x.label))?.checked === true, 'the active vibe is ticked in the tray');
  fs.writeFileSync(path.join(SHOTS, 'tray.json'), JSON.stringify(tray, null, 2));
  await w.evaluate(() => window.keeper.settings.set({ theme: 'playful', look: 'playful' }));
  await amb('applyVibe', 'evening');

  // ---- capture a vibe from what is on screen
  await w.fill('[data-testid="amb-capture-name"]', 'My desk');
  await w.click('[data-testid="amb-capture"]');
  s = await until(async () => { const x = await amb('state'); return x.settings.vibes.find((v) => v.name === 'My desk') ? x : null; }, 5000);
  const mine = s?.settings.vibes.find((v) => v.name === 'My desk');
  check(!!mine && mine.widgets?.length >= 5 && mine.wallpaper?.scene === 'fireflies', 'a new vibe captures the wallpaper and the widget layout');

  // ---- schedule: a preset, then a rule that applies now switches by itself
  await w.click('[data-testid="amb-tab-schedule"]');
  await w.click('[data-testid="amb-preset-day-night"]');
  s = await until(async () => { const x = await amb('state'); return x.settings.schedule.rules.length === 2 ? x : null; }, 5000);
  check(!!s, 'the Day & night preset adds two sun rules');
  await amb('saveRules', [{ id: 'now', vibe: 'seaside', enabled: true, when: { kind: 'time', from: '00:00', to: '23:59', days: [0, 1, 2, 3, 4, 5, 6] } }, ...s.settings.schedule.rules]);
  const sc = await amb('state');
  await amb('set', { schedule: { ...sc.settings.schedule, enabled: true } });
  check(!!(await until(async () => (await amb('state')).settings.activeVibe === 'seaside', 8000)), 'turning the schedule on switches to the vibe whose rule applies now');
  const u2 = await w.evaluate(() => window.keeper.usage.get());
  check(u2.checks.some((c) => c.name === 'vibes-schedule'), 'the schedule is one governor check');
  await amb('applyVibe', 'cafe');
  await sleep(1500);
  check((await amb('state')).settings.activeVibe === 'cafe', 'a vibe chosen by hand holds until the next rule change');
  await w.screenshot({ path: path.join(SHOTS, 'schedule-light.png') });
  const sc2 = await amb('state');
  await amb('set', { schedule: { ...sc2.settings.schedule, enabled: false } });

  // ---- wallpaper tab: library, per display
  await w.click('[data-testid="amb-tab-wallpaper"]');
  await w.click('[data-testid="amb-scene-dunes"]');
  await w.waitForTimeout(1500);
  await w.screenshot({ path: path.join(SHOTS, 'wallpaper-tab-light.png') });
  await w.click('[data-testid="amb-apply"]');
  check(!!(await until(async () => (await amb('state')).settings.wallpaper.default.scene === 'dunes', 5000)), 'choosing a scene in the library and Use applies it');

  // ---- still frame: captured off screen and set through the desktop’s own setting (dry run)
  const still = await amb('setStill');
  check(still.ok && fs.existsSync(still.path) && fs.statSync(still.path).size > 5000, `a still frame is captured (${still.path && fs.statSync(still.path).size} bytes)`);
  check(/cmd gsettings set org\.gnome\.desktop\.background picture-uri file:\/\/.*still-dunes-.*\.png/.test(dry()), 'and set as the GNOME desktop picture (gsettings)');
  check(/picture-uri-dark/.test(dry()), 'for dark mode too');
  check(!!(await amb('state')).settings.previousDesktop, 'the previous picture is remembered for restore');
  const r = await amb('restoreDesktop');
  check(r.ok && /picture-uri file:\/\/\/usr\/share\/backgrounds\/original\.png/.test(dry()), 'restore puts the previous picture back');

  // ---- ambient sound: the mixer panel, playing, sleep timer
  await amb('setMix', { rain: 0.6, cafe: 0.4 }, 0.5);
  await amb('setSoundPlaying', true);
  const mixer = await until(async () => app.windows().find((x) => x.url().includes('view=ambient')), 10000);
  check(!!mixer, `playing sound opens the (hidden) mixer window that plays it${mixer ? '' : ` (${JSON.stringify((await amb('state')).settings.sound)} ${JSON.stringify((await amb('state')).features)})`}`);
  const mixErrors = [];
  mixer?.on('pageerror', (e) => mixErrors.push(e.message));
  await amb('openMixer');
  await sleep(1200);
  check(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((x) => x.webContents.getURL().includes('view=ambient') && x.isVisible() && x.isAlwaysOnTop())), 'the floating mixer shows on top');
  if (mixer) await mixer.screenshot({ path: path.join(SHOTS, 'mixer-light.png') });
  if (mixer) { await mixer.locator('[data-testid="amb-sound-waves"] input').fill('0.7'); }
  check(!!(await until(async () => ((await amb('state')).settings.sound.mix.waves ?? 0) > 0.6, 5000)), 'a slider in the panel changes the mix');
  await amb('sleep', 0.05);
  check(!!(await until(async () => (await amb('state')).settings.sound.playing === false, 10000)), 'the sleep timer stops the sound');
  await amb('closeMixer');
  check(!!(await until(async () => !app.windows().some((x) => x.url().includes('view=ambient')), 8000)), 'with nothing playing and the panel closed, the mixer window goes away');
  check(!mixErrors.length, `no errors in the mixer${mixErrors.length ? `: ${mixErrors[0]}` : ''}`);

  // ---- folder icons: GIO (dry run), then KDE .directory (real files)
  const folder = path.join(HOME, 'Pictures/Trips');
  const png = await w.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); g.fillStyle = '#4f7cff'; g.fillRect(40, 120, 432, 320); return c.toDataURL('image/png'); });
  const spec = { pattern: 'dots', color: '#4f7cff', color2: '#9db4ff', symbol: '📷' };
  let res = await amb('applyFolderIcon', [folder], spec, png);
  check(res.done.length === 1 && new RegExp(`cmd gio set ${folder.replace(/[/.]/g, '\\$&')} metadata::custom-icon file://.*folder-icons/icon-.*\\.png`).test(dry()), 'GNOME Files: the icon is set with gio metadata::custom-icon');
  const iconDir = path.join(await app.evaluate(({ app: a }) => a.getPath('userData')), 'folder-icons');
  const ico = fs.existsSync(iconDir) ? fs.readdirSync(iconDir).find((n) => n.endsWith('.ico')) : null;
  check(!!ico && fs.readFileSync(path.join(iconDir, ico)).readUInt16LE(4) === 4, 'a Windows .ico with four sizes is made too');
  res = await amb('restoreFolderIcon', [folder]);
  check(res.done.length === 1 && /cmd gio set -t unset .*Trips metadata::custom-icon/.test(dry()), 'restore unsets it');
  await app.evaluate(() => { process.env.XDG_CURRENT_DESKTOP = 'KDE'; });
  fs.writeFileSync(path.join(folder, '.directory'), '[Desktop Entry]\nIcon=folder-red\n[Dolphin]\nViewMode=1\n');
  res = await amb('applyFolderIcon', [folder], spec, png);
  const dirFile = fs.readFileSync(path.join(folder, '.directory'), 'utf8');
  check(res.done.length === 1 && /Icon=.*folder-icons\/icon-.*\.png/.test(dirFile) && /ViewMode=1/.test(dirFile), 'KDE Dolphin: Icon= in .directory, other lines kept');
  check((await amb('folderIcons')).length === 1, 'the restore list has the folder');
  await w.click('[data-testid="amb-tab-icons"]');
  await w.waitForSelector('[data-testid="amb-icon-list"]', { timeout: 5000 }).catch(() => undefined);
  await w.screenshot({ path: path.join(SHOTS, 'icons-light.png') });
  await w.click('[data-testid="amb-icon-restore-all"]');
  check(!!(await until(async () => fs.readFileSync(path.join(folder, '.directory'), 'utf8') === '[Desktop Entry]\nIcon=folder-red\n[Dolphin]\nViewMode=1\n', 5000)), 'Restore all puts the original .directory back exactly');
  await app.evaluate(() => { delete process.env.XDG_CURRENT_DESKTOP; });

  // ---- the Island's Vibes tool
  const island = app.windows().find((x) => x.url().includes('view=island'));
  if (island) {
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=island')); win?.webContents.send('event:island-open', 'vibes'); });
    const shown = await until(async () => (await island.locator('[data-testid="island-vibes"]').count()) === 1, 8000);
    check(!!shown, 'the Island opens on its Vibes tool');
    if (shown) {
      await island.locator('.amb-island-vibe:has-text("Rainy day")').click();
      check(!!(await until(async () => (await amb('state')).settings.activeVibe === 'rainy', 5000)), 'a vibe picked in the Island applies');
      await island.screenshot({ path: path.join(SHOTS, 'island-vibes-light.png') });
    }
  } else check(true, 'no Island window here (skipped)');

  // ---- command palette
  await w.keyboard.press('Control+K');
  await w.keyboard.type('vibe seaside');
  check(!!(await until(() => w.$('text=Vibe: 🌊 Seaside'), 5000)), 'the palette lists vibes');
  await w.keyboard.press('Escape');

  // ---- the command line
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'dist-cli/keeper.cjs'), 'ambience', 'vibe', 'night', '--json'], { env, encoding: 'utf8', timeout: 20000 });
    check(/"vibe":\s*"night"/.test(out) && (await amb('state')).settings.activeVibe === 'night', 'keeper ambience vibe night switches the vibe');
  } catch (e) {
    check(false, `keeper ambience: ${String(e.stderr || e.message).split('\n')[0]}`);
  }

  // ---- dark mode screenshots of each surface
  await setDark(true);
  await w.click('[data-testid="amb-tab-vibes"]');
  await w.waitForTimeout(700);
  await w.screenshot({ path: path.join(SHOTS, 'vibes-dark.png') });
  await w.click('[data-testid="amb-tab-wallpaper"]');
  await w.waitForTimeout(1200);
  await w.screenshot({ path: path.join(SHOTS, 'wallpaper-tab-dark.png') });
  await w.click('[data-testid="amb-tab-options"]');
  await w.click('[data-testid="amb-measure"]');
  await w.waitForSelector('[data-testid="amb-cost"]', { timeout: 8000 }).catch(() => undefined);
  await w.screenshot({ path: path.join(SHOTS, 'options-dark.png') });
  await w.click('[data-testid="amb-tab-icons"]');
  await w.waitForTimeout(400);
  await w.screenshot({ path: path.join(SHOTS, 'icons-dark.png') });
  await w.click('[data-testid="amb-tab-schedule"]');
  await w.waitForTimeout(400);
  await w.screenshot({ path: path.join(SHOTS, 'schedule-dark.png') });
  await w.setViewportSize({ width: 820, height: 640 }).catch(() => undefined);
  await w.click('[data-testid="amb-tab-wallpaper"]');
  await w.waitForTimeout(600);
  await w.screenshot({ path: path.join(SHOTS, 'wallpaper-tab-small-dark.png') });
  await w.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await amb('setSoundPlaying', true);
  await amb('openMixer');
  const mixer2 = await until(async () => app.windows().find((x) => x.url().includes('view=ambient')), 10000);
  await sleep(1200);
  if (mixer2) await mixer2.screenshot({ path: path.join(SHOTS, 'mixer-dark.png') });
  await amb('setSoundPlaying', false);
  await amb('closeMixer');
  if (island) {
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=island')); win?.webContents.send('event:island-open', 'vibes'); });
    await sleep(800);
    await island.screenshot({ path: path.join(SHOTS, 'island-vibes-dark.png') });
  }
  const wg = app.windows().find((x) => x.url().includes('view=widget') && x.url().includes('kseason'));
  if (wg) await wg.screenshot({ path: path.join(SHOTS, 'widget-season.png') });
  await setDark(false);

  // ---- off again: no windows, no checks
  await amb('setPlaying', false);
  check(!!(await until(async () => wallWins().length === 0, 8000)), 'turning it off closes every wallpaper window');
  const u3 = await w.evaluate(() => window.keeper.usage.get());
  check(!u3.checks.some((c) => c.name === 'wallpaper-cover' && c.everyMs !== null), 'and its full-screen check stops');
  for (const id of [made.id, 'kday', 'kseason', 'kworld', 'kquote']) await wid('remove', id);

  check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await app.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  fs.rmSync(HOME, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
