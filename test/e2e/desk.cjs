// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/desk.cjs /tmp/kdesk-home /tmp/kdesk-shots
// Needs openbox, xterm, xdotool and wmctrl. Drives the real Keeper app's window
// and desktop parts on an X11 desktop:
//   Snap Windows  off until switched on; the page; a real xterm snapped to each
//                 half through the API and through a global shortcut; a shortcut
//                 changed on the page; a layout saved, the window moved away and
//                 brought back; a layout deleted from its menu.
//   Folder boxes  off until switched on; Tidy my desktop shows what moves, moves
//                 loose desktop files into one folder per kind with a box each, and
//                 Undo puts them back; a box window lists its files and rolls up;
//                 a box's rule for new files lands in Automations; switched off,
//                 the box windows close.
//   Menu bar icons  off until switched on; on Linux, Settings → Menu bar says
//                 plainly that other apps' tray icons cannot be hidden here, with
//                 no button that would pretend otherwise, and no divider is made.
//   Buttons & Shortcuts  off until switched on; the page says what this desktop
//                 allows; a button added on the page; an app shortcut that works
//                 only while its app (a real xterm) is in front, and a side
//                 button's job (through the test hook) typed into that xterm.
// Pictures in light and dark (the sidebar as a rail, so no real disk names show).

const { _electron } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
const ONLY = (process.env.DESK_ONLY || '').split(',').filter(Boolean);
const want = (part) => !ONLY.length || ONLY.includes(part);

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }
const x = (...a) => { try { return execFileSync(a[0], a.slice(1), { encoding: 'utf8', timeout: 5000 }).trim(); } catch { return ''; } };
/** An X window's outer place, as the window manager has it. */
function geometry(id) {
  const line = x('wmctrl', '-lG').split('\n').find((l) => parseInt(l.split(/\s+/)[0], 16) === Number(id));
  if (!line) return null;
  const p = line.split(/\s+/);
  return { x: +p[2], y: +p[3], width: +p[4], height: +p[5] };
}
const near = (a, b, d = 24) => Math.abs(a - b) <= d;

(async () => {
  const wm = spawn('openbox', [], { stdio: 'ignore' });
  await wait(800);
  fs.mkdirSync(path.join(HOME, '.config/Keeper'), { recursive: true });

  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', KEEPER_INPUT_TEST: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', XDG_SESSION_TYPE: 'x11' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const k = (ns, fn, ...a) => main.evaluate(([n, f, args]) => window.keeper[n][f](...args), [ns, fn, a]);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  await k('settings', 'set', { sidebarMode: 'compact' });
  const shot = async (name) => {
    for (const theme of ['light', 'dark']) {
      await k('settings', 'set', { appearance: theme });
      await wait(700);
      await main.screenshot({ path: path.join(SHOTS, `${name}-${theme}.png`) });
    }
    await k('settings', 'set', { appearance: 'light' });
  };
  const features = async () => k('features', 'list');

  // ================================================================ Snap Windows
  if (want('snap')) {
    check((await features()).find((f) => f.id === 'snapWindows')?.on === false, 'snap: off until switched on');
    await k('features', 'set', 'snapWindows', true);
    await wait(400);
    await navigate('snap');
    await main.waitForSelector('[data-testid="snap-page"]', { timeout: 15000 });
    const st = await k('snap', 'status');
    check(st.availability.state === 'ready', `snap: ready on this X11 desktop (${st.availability.state}: ${st.availability.line})`);
    check(await main.locator('[data-testid="snap-tile-left"]').count() === 1 && await main.locator('[data-testid="snap-tile-leftThird"]').count() === 0, 'snap: the halves show first, thirds a tab away');
    check(!!(await main.locator('[data-testid="snap-layouts"] [data-testid="empty-state"]').count()), 'snap: no layouts yet is a designed empty state');
    await shot('snap-empty');

    // A real window of another app.
    const term = spawn('xterm', ['-T', 'snap-target', '-geometry', '60x15+300+200', '-e', 'sleep', '600'], { stdio: 'ignore' });
    const id = await until(() => x('xdotool', 'search', '--name', 'snap-target').split('\n')[0], 10000);
    check(!!id, 'snap: a test window is open');
    x('xdotool', 'windowactivate', '--sync', id);
    await wait(400);
    let r = await k('snap', 'run', 'left');
    check(r.ok, `snap: left half through the API (${r.message ?? ''})`);
    let g = await until(() => { const v = geometry(id); return v && near(v.x, 0) && near(v.width, 720) ? v : null; }, 5000);
    check(!!g, `snap: the window fills the left half (${JSON.stringify(geometry(id))})`);

    // The global shortcut, pressed while the other app is in front.
    x('xdotool', 'windowactivate', '--sync', id);
    await wait(300);
    x('xdotool', 'key', '--clearmodifiers', 'ctrl+alt+shift+Right');
    g = await until(() => { const v = geometry(id); return v && near(v.x, 720) && near(v.width, 720) ? v : null; }, 5000);
    check(!!g, `snap: Ctrl+Alt+Shift+Right puts it in the right half (${JSON.stringify(geometry(id))})`);
    const shortcuts = await main.evaluate(() => window.keeper.prefs?.shortcuts?.() ?? null).catch(() => null);
    if (Array.isArray(shortcuts)) check(shortcuts.some((s) => s.owner === 'Snap: Left half' && s.state === 'ok'), 'snap: its shortcuts are listed as working in Settings → Shortcuts');

    // Change a shortcut on the page: the thirds tab, record a key.
    await main.getByRole('tab', { name: 'Thirds' }).click();
    await main.locator('[data-testid="snap-tile-leftThird"] .keyrec').click();
    await main.keyboard.press('Control+Alt+Shift+Digit1');
    const set = await until(async () => (await k('settings', 'get')).snap.shortcuts.leftThird, 5000);
    check(/Alt\+Shift\+1$/.test(set || ''), `snap: a shortcut recorded on the page is saved (${set})`);
    x('xdotool', 'windowactivate', '--sync', id);
    await wait(300);
    x('xdotool', 'key', '--clearmodifiers', 'ctrl+alt+shift+1');
    g = await until(() => { const v = geometry(id); return v && near(v.x, 0) && near(v.width, 480) ? v : null; }, 5000);
    check(!!g, `snap: the new shortcut works at once (${JSON.stringify(geometry(id))})`);

    // A saved layout brings the window back.
    await main.bringToFront();
    await main.locator('[data-testid="snap-save"]').click();
    const saved = await until(async () => (await k('snap', 'status')).layouts[0], 8000);
    check(!!saved && saved.windows.some((w) => w.title === 'snap-target') && saved.name === 'Laptop', `snap: Save this layout keeps the windows, named after the screens (${saved?.name}, ${saved?.windows.length})`);
    x('wmctrl', '-i', '-r', `0x${Number(id).toString(16)}`, '-e', '0,600,400,400,300');
    await wait(500);
    r = await k('snap', 'restoreLayout', saved.id);
    check(r.moved >= 1, `snap: restoring moves the windows back (${r.moved})`);
    g = await until(() => { const v = geometry(id); return v && near(v.x, 0) && near(v.width, 480) ? v : null; }, 5000);
    check(!!g, `snap: the test window is back in the left third (${JSON.stringify(geometry(id))})`);
    await main.getByRole('tab', { name: 'Halves' }).click();
    await main.waitForSelector(`[data-testid="snap-layout-${saved.id}"]`, { timeout: 5000 });
    await shot('snap');

    // Delete from its menu.
    await main.locator(`[data-testid="snap-layout-${saved.id}"] button[aria-label^="More for"]`).click();
    await main.locator('[data-testid="snap-delete"]').click();
    check(!!(await until(async () => (await k('snap', 'status')).layouts.length === 0, 5000)), 'snap: a layout is deleted from its menu');

    // Off again: the shortcut is given back.
    await k('features', 'set', 'snapWindows', false);
    await wait(600);
    x('xdotool', 'windowactivate', '--sync', id);
    const before = geometry(id);
    x('xdotool', 'key', '--clearmodifiers', 'ctrl+alt+shift+Right');
    await wait(1200);
    const after = geometry(id);
    check(before && after && before.x === after.x, 'snap: switched off, its shortcuts do nothing');
    term.kill();
  }

  // ================================================================ Folder boxes
  if (want('boxes')) {
    const desk = path.join(HOME, 'Desktop');
    for (const f of ['Harbour.jpg', 'Beach.png', 'Plans.pdf', 'Budget.xlsx', 'Reading list.txt', 'Song.mp3', 'Talk.mp4', 'Setup.zip']) fs.writeFileSync(path.join(desk, f), 'sample ' + f);
    fs.mkdirSync(path.join(desk, 'Projects'), { recursive: true });
    await k('features', 'set', 'widgets', true);
    await navigate('widgets');
    await main.waitForSelector('.wg-add', { timeout: 15000 });
    check(!(await main.locator('.wg-add:has-text("Folder box")').count()), 'boxes: no Folder box to add until the part is on');
    check((await features()).find((f) => f.id === 'folderBoxes')?.on === false, 'boxes: off until switched on');
    await k('features', 'set', 'folderBoxes', true);
    await main.waitForSelector('[data-testid="boxes-tidy"]', { timeout: 10000 });
    check(await main.locator('.wg-add:has-text("Folder box")').count() === 1, 'boxes: Folder box can be added once on');

    await main.locator('[data-testid="boxes-tidy-look"]').click();
    await main.waitForSelector('[data-testid="boxes-plan"]', { timeout: 10000 });
    const planText = await main.locator('[data-testid="boxes-plan"]').innerText();
    check(/8 files move into 5 folders/.test(planText) && /Pictures/.test(planText) && /2 files/.test(planText), `boxes: the plan says what moves before anything does (${planText.split('\n').slice(0, 2).join(' / ')})`);
    check(fs.existsSync(path.join(desk, 'Harbour.jpg')), 'boxes: nothing moved while looking');
    for (const theme of ['light', 'dark']) { await k('settings', 'set', { appearance: theme }); await wait(600); await main.screenshot({ path: path.join(SHOTS, `boxes-plan-${theme}.png`) }); }
    await k('settings', 'set', { appearance: 'light' });
    await main.locator('[data-testid="boxes-tidy-go"]').click();
    const tidied = await until(() => fs.existsSync(path.join(desk, 'Pictures', 'Harbour.jpg')) && fs.existsSync(path.join(desk, 'Documents', 'Plans.pdf')), 10000);
    check(!!tidied && !fs.existsSync(path.join(desk, 'Harbour.jpg')) && fs.existsSync(path.join(desk, 'Projects')), 'boxes: loose files are in one folder per kind; folders stay');
    const boxes = await until(async () => { const l = (await k('widgets', 'list')).filter((w) => w.kind === 'folder'); return l.length === 5 ? l : null; }, 8000);
    check(!!boxes, `boxes: a box for each folder (${(await k('widgets', 'list')).filter((w) => w.kind === 'folder').length})`);
    const hist = await k('history', 'list');
    const entry = hist.find((h) => /Tidied the desktop into 5 boxes/.test(h.title));
    check(!!entry && entry.undoable, 'boxes: tidying is one step in History, with Undo');
    await main.waitForSelector('.wgp .fbox-item', { timeout: 10000 }).catch(() => undefined);
    await main.locator('.wgp').first().scrollIntoViewIfNeeded();
    await shot('boxes');

    // A box window on the desktop lists its files and rolls up.
    const pics = boxes?.find((w) => w.options.title === 'Pictures');
    const win = await until(async () => {
      for (const w of app.windows()) { if (w.url().includes('view=widget') && w.url().includes(pics?.id ?? '-')) return w; }
      return null;
    }, 10000);
    check(!!win, 'boxes: the Pictures box is on the desktop');
    if (win) {
      await win.waitForSelector('[data-testid="folder-box"] .fbox-item', { timeout: 10000 }).catch(() => undefined);
      const names = await win.locator('.fbox-name').allInnerTexts();
      check(names.join(',') === 'Beach.png,Harbour.jpg', `boxes: the box shows its folder's files (${names.join(', ')})`);
      await win.screenshot({ path: path.join(SHOTS, 'boxes-window.png') });
      await win.locator('.fbox-roll').click();
      const rolled = await until(async () => (await k('widgets', 'list')).find((w) => w.id === pics.id)?.bounds.height === 44, 5000);
      const hNow = await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(id))?.getBounds().height, pics.id);
      check(!!rolled && hNow <= 50, `boxes: rolled up to its title bar (${hNow})`);
      await win.locator('.fbox-roll').click();
      const back = await until(async () => (await k('widgets', 'list')).find((w) => w.id === pics.id)?.bounds.height > 44, 5000);
      check(!!back, 'boxes: and unrolled again');
    }

    // Undo puts every file back.
    await k('history', 'undo', entry.id);
    check(!!(await until(() => fs.existsSync(path.join(desk, 'Harbour.jpg')) && fs.existsSync(path.join(desk, 'Plans.pdf')), 8000)), 'boxes: Undo puts the files back on the desktop');
    check(!fs.existsSync(path.join(desk, 'Documents')), 'boxes: and removes the folders it made, now empty');

    // A box's rule for new files is an Automation.
    await main.bringToFront();
    await navigate('widgets');
    await main.waitForSelector('.wgp', { timeout: 10000 });
    const card = main.locator('.wgp', { hasText: 'Pictures' }).first();
    await card.locator('button', { hasText: 'Edit' }).click();
    await main.locator('[data-testid="box-rule"]').first().selectOption('pictures');
    const rule = await until(async () => (await k('settings', 'get')).rules.find((r) => r.id.startsWith('box-pictures')), 5000);
    check(!!rule && rule.action.to === path.join(desk, 'Pictures') && rule.scope[0] === desk, 'boxes: New desktop files here adds an Automation for that box');
    await card.locator('button', { hasText: 'Done' }).click();

    // Off: the box windows close, the other widgets stay.
    await k('features', 'set', 'folderBoxes', false);
    const gone = await until(() => !app.windows().some((w) => w.url().includes(pics?.id ?? '-')), 8000);
    check(!!gone, 'boxes: switched off, the boxes leave the desktop');
  }

  // ================================================================ Menu bar icons
  if (want('menubar')) {
    check((await features()).find((f) => f.id === 'menuBarItems')?.on === false, 'menubar: off until switched on');
    await k('features', 'set', 'menuBarItems', true);
    await wait(400);
    const st = await k('menuBar', 'status');
    check(st.availability.state === 'unsupported' && !st.divider && !st.shown.length, `menubar: on Linux it says so and makes no divider (${st.availability.state})`);
    await navigate('settings:menubar');
    await main.waitForSelector('[data-testid="menubar-items"]', { timeout: 15000 });
    const text = await main.locator('[data-testid="menubar-items"]').innerText();
    check(/cannot hide or move other apps’ icons here/.test(text), 'menubar: the panel tells the truth about Linux trays');
    check(await main.locator('[data-testid="menubar-items"] button').count() === 0, 'menubar: and offers no button that would do nothing');
    await main.locator('[data-testid="menubar-items"]').scrollIntoViewIfNeeded();
    await shot('menubar');
    await k('features', 'set', 'menuBarItems', false);
    await wait(400);
    check(await main.locator('[data-testid="menubar-items"]').count() === 0, 'menubar: switched off, its settings leave');
  }

  // ================================================================ Buttons & Shortcuts
  if (want('buttons')) {
    check((await features()).find((f) => f.id === 'mouseButtons')?.on === false, 'buttons: off until switched on (experimental)');
    await k('features', 'set', 'mouseButtons', true);
    await wait(400);
    await navigate('buttons');
    await main.waitForSelector('[data-testid="buttons-page"]', { timeout: 15000 });
    const st = await k('remap', 'status');
    check(st.availability.keys.state === 'ready', `buttons: app shortcuts work on this X11 desktop (${st.availability.keys.line})`);
    check(/xinput|input|still does its own thing/.test(st.availability.mouse.line + (st.availability.mouse.hint ?? '')), `buttons: the mouse line is honest about Linux (${st.availability.mouse.state})`);
    check(!!(await main.locator('[data-testid="remap-mouse"] [data-testid="empty-state"]').count()), 'buttons: no jobs yet is a designed empty state');
    await shot('buttons-empty');
    await main.locator('[data-testid="remap-add-button"]').click();
    const added = await until(async () => (await k('settings', 'get')).inputRemap.mouse[0], 5000);
    check(added?.button === 'back' && added.keys === 'Alt+Left' && added.app === '', `buttons: Add a button gives the back button Go back in every app (${JSON.stringify(added)})`);

    // A real app: whatever reaches it is written to a file when Return is pressed.
    const out = path.join(HOME, 'typed.txt');
    const term = spawn('xterm', ['-T', 'remap-target', '-geometry', '60x10+200+200', '-e', 'sh', '-c', `cat > ${out}`], { stdio: 'ignore' });
    const id = await until(() => x('xdotool', 'search', '--name', 'remap-target').split('\n')[0], 10000);
    const s0 = await k('settings', 'get');
    await k('settings', 'set', { inputRemap: { ...s0.inputRemap, mouse: [{ ...added, app: 'xterm', keys: 'Shift+B' }], keys: [{ id: 'k1', app: 'xterm', from: 'Control+Alt+Shift+K', to: 'Shift+H' }] } });
    await wait(500);
    x('xdotool', 'windowactivate', '--sync', id);
    const fronted = await until(async () => /xterm/i.test((await k('remap', 'status')).front), 8000);
    check(!!fronted, `buttons: Keeper sees the xterm in front (${(await k('remap', 'status')).front})`);
    const owned = await until(async () => (await main.evaluate(() => window.keeper.prefs.shortcuts())).some((x) => x.owner === 'In xterm: Control+Alt+Shift+K' && x.state === 'ok'), 6000);
    check(!!owned, 'buttons: the app shortcut is taken only while its app is in front');
    x('xdotool', 'key', '--clearmodifiers', 'ctrl+alt+shift+k');
    await wait(900);
    const pressed = await k('remap', 'testPress', 'back');
    check(pressed?.sent === 'Shift+B', `buttons: the back button's job in this app is found (${JSON.stringify(pressed)})`);
    await wait(900);
    x('xdotool', 'key', 'Return');
    const typed = await until(() => { try { const t = fs.readFileSync(out, 'utf8'); return t.includes('\n') ? t : null; } catch { return null; } }, 6000);
    check((typed || '').trim() === 'HB', `buttons: the xterm got H from the app shortcut and B from the button (${JSON.stringify(typed)})`);

    // Another app in front (a terminal of another kind): the shortcut is given back.
    const other = spawn('xterm', ['-name', 'otherapp', '-class', 'OtherApp', '-T', 'other-app', '-e', 'sleep', '600'], { stdio: 'ignore' });
    const oid = await until(() => x('xdotool', 'search', '--name', 'other-app').split('\n')[0], 10000);
    if (oid) x('xdotool', 'windowactivate', '--sync', oid);
    const freed = await until(async () => !(await main.evaluate(() => window.keeper.prefs.shortcuts())).some((x) => x.owner === 'In xterm: Control+Alt+Shift+K'), 8000);
    check(!!freed, `buttons: with another app in front the shortcut is free again (${(await k('remap', 'status')).front}; ${(await main.evaluate(() => window.keeper.prefs.shortcuts())).filter((x) => x.owner.startsWith('In ')).map((x) => x.owner).join(',')})`);
    await navigate('buttons');
    await main.waitForSelector('[data-testid^="remap-key-"]', { timeout: 8000 });
    await shot('buttons');
    term.kill();
    other.kill();
    await k('features', 'set', 'mouseButtons', false);
  }

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await app.close();
  wm.kill();
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
