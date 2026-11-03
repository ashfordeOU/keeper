// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/layout.cjs /tmp/kl /tmp/kl-shots
// The main window's layout, in the real app on a throwaway home with sample files:
//   • the Inspector: hidden at start, slides in when a file is selected, resized
//     by its left edge (mouse and keyboard), the width kept after a reload, hidden
//     again when the selection is cleared, and the Show/Hide toggle;
//   • the sidebar: a rail in a narrow window that opens on hover and stays open
//     when pinned, "Show all" in a long section, and its width kept after a reload;
//   • Home: the quiet header, the one-line suggestion, Jump back in grouped by
//     project, the Today column (wide) or in line (narrow), Library tiles and Edit Home.
// Screenshots in light and dark, at 1440×900 and in a small window.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HOME = fs.realpathSync(path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/kl-')));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const TAG = process.env.LAYOUT_TAG ? `${process.env.LAYOUT_TAG}-` : '';
const ONLY = (process.env.LAYOUT_ONLY || '').split(',').filter(Boolean);
const want = (part) => !ONLY.length || ONLY.includes(part);
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures', 'Videos', 'Music', '.config/Keeper']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
const SAMPLES = path.join(HOME, 'Documents', 'Samples');
if (!fs.existsSync(SAMPLES)) {
  execFileSync(process.execPath, [path.join(__dirname, 'make-samples.cjs'), SAMPLES], { stdio: 'ignore' });
  const copy = (from, to) => { try { fs.copyFileSync(path.join(SAMPLES, from), to); } catch { /* not made on this system */ } };
  copy('02 photo.jpg', path.join(HOME, 'Pictures', 'Lisbon tram.jpg'));
  copy('05 modern.webp', path.join(HOME, 'Pictures', 'Moodboard.webp'));
  copy('08 report.pdf', path.join(HOME, 'Downloads', 'Invoice October.pdf'));
  for (const f of fs.readdirSync(SAMPLES)) if (/\.(docx|xlsx|zip|mp3|mp4|md|csv)$/i.test(f)) copy(f, path.join(HOME, 'Downloads', f.replace(/^\d+\s+/, '')));
}
const settingsFile = path.join(HOME, '.config/Keeper/settings.json');
if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, JSON.stringify({ folders: ['Documents', 'Downloads', 'Pictures', 'Desktop'].map((f) => path.join(HOME, f)), features: { usageStats: false } }));

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  let main;
  for (let i = 0; i < 60 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    if (!main) await sleep(500);
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const size = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, s) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.setContentSize(s.width, s.height); } }, { width, height });
    await main.setViewportSize({ width, height }).catch(() => undefined);
    await sleep(500);
  };
  await size(1440, 900);
  await main.waitForSelector('.sidebar', { timeout: 60000 });
  const theme = async (dark) => { await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark); await sleep(450); };
  const both = async (name) => { for (const dark of [false, true]) { await theme(dark); await main.screenshot({ path: path.join(SHOTS, `${TAG}${name}-${dark ? 'dark' : 'light'}.png`) }); } await theme(false); };
  const nav = (r) => app.evaluate(({ BrowserWindow }, route) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('event:navigate', route); }, r);
  const reload = async () => { await main.reload(); await main.waitForSelector('.sidebar', { timeout: 30000 }); await sleep(1200); };
  // The library scan fills Home.
  await main.waitForSelector('.shelf-card, .home-recent-item', { timeout: 60000 }).catch(() => undefined);
  await sleep(1500);

  if (want('home')) {
    await both('home-1440');
    await size(900, 640);
    await both('home-small');
    await size(1440, 900);
    if (process.env.LAYOUT_TAG === 'before') { await app.close(); return; }
    // Home: a quiet header, your folders, Jump back in grouped by folder, Find a file, Today beside it.
    check(/files? · .* free/.test(await main.locator('[data-testid="home-line"]').textContent()), `one quiet line under the greeting ("${(await main.locator('[data-testid="home-line"]').textContent()).trim()}")`);
    check(await main.locator('[data-testid="home-rescan"]').count() === 1 && await main.getByRole('button', { name: /^Rescan$/ }).count() === 0, 'Rescan is a small icon button');
    check(await main.locator('.home .card, .home .kind-tile, .home-attention').count() === 0, 'no big storage, clean-up or attention cards');
    const sugg = main.locator('[data-testid="home-suggestion"]');
    if (await sugg.count()) {
      const h = (await sugg.boundingBox())?.height ?? 0;
      check(h <= 48, `a suggestion is one line (${Math.round(h)} px)`);
    } else console.log('  (no suggestion on this computer)');
    // The front door: Desktop, Documents and Downloads as big tiles, then a search box with the types under it.
    const doors = await main.locator('[data-testid="home-folder"] .name').allTextContents();
    check(doors.join(',') === 'Desktop,Documents,Downloads', `Home's first row is Desktop, Documents and Downloads (${doors.join(', ')})`);
    check(await main.locator('[data-testid="home-search"]').count() === 1 && await main.locator('[data-testid="home-types"] .type-chip').count() >= 3, 'Find a file: a search box and the types under it');
    const recent = main.locator('[data-testid="home-recent"] .home-recent-item');
    const nRecent = await recent.count();
    check(nRecent >= 1, `Jump back in shows recent files (${nRecent}, ${await main.locator('[data-testid="home-group"]').count()} groups)`);
    const groups = await main.locator('[data-testid="home-group"]').count();
    if (groups) {
      check(await main.locator('[data-testid="home-open-folder"]').count() >= 1, 'each project group has Open folder');
      await main.locator('[data-testid="home-open-folder"]').first().click();
      await sleep(700);
      check(await main.locator('.home').count() === 0, 'Open folder opens the folder');
      await nav('home');
      await sleep(800);
    }
    const today = main.locator('[data-testid="home-today"]');
    check(await today.count() === 1, 'Today is shown by default');
    const tb = await today.boundingBox();
    const jb = await main.locator('[data-section="jump"]').boundingBox();
    check(tb && jb && tb.x > jb.x + jb.width - 2, 'on a wide window Today is a column on the right');
    // The keyboard: the arrow keys move through the files.
    await recent.first().focus();
    await main.keyboard.press('ArrowDown');
    check(await main.evaluate(() => document.activeElement?.classList.contains('home-recent-item') && document.activeElement !== document.querySelector('[data-testid="home-recent"] .home-recent-item')), 'the arrow keys move between recent files');
    // No layout shift while the pictures load.
    const box1 = await recent.first().locator('.thumb').boundingBox();
    await sleep(1500);
    const box2 = await recent.first().locator('.thumb').boundingBox();
    check(box1 && box2 && Math.abs(box1.y - box2.y) < 1 && Math.abs(box1.height - box2.height) < 1, 'pictures load without moving anything');
    // Narrow: one column, Today in its place in the order.
    await size(760, 800);
    const tb2 = await today.boundingBox();
    const jb2 = await main.locator('[data-section="jump"]').boundingBox();
    check(tb2 && jb2 && tb2.y > jb2.y, 'on a narrow window Today follows Jump back in in one column');
    await size(1440, 900);
    // Today's own hide button, kept after a reload.
    await main.click('[data-testid="home-today-hide"]');
    await reload();
    check(await main.locator('[data-testid="home-today"]').count() === 0, 'Today can be hidden from its own header');
    // Edit Home: show By type (off by default), show Storage, hide Today, move Jump back in up, compact spacing; kept after a reload.
    await main.click('[data-testid="home-edit"]');
    await sleep(300);
    await both('home-edit');
    await main.locator('[data-testid="home-edit-library"] button[role="switch"]').click();
    await main.locator('[data-testid="home-edit-usage"] button[role="switch"]').click();
    await main.locator('[data-testid="home-edit-today"] button[role="switch"]').click();
    await main.getByRole('button', { name: 'Move Jump back in up' }).click();
    await main.locator('[data-testid="home-edit-panel"]').getByRole('radio', { name: 'Compact' }).click();
    await main.click('[data-testid="home-edit"]');
    await reload();
    check(await main.locator('[data-section="library"]').count() === 1 && await main.locator('[data-section="usage"]').count() === 1 && await main.locator('[data-section="today"]').count() === 1, 'Edit Home hides and shows sections, kept after a reload');
    check(await main.evaluate(async () => (await window.keeper.settings.get()).home.order.slice(0, 2).join(',')) === 'folders,jump', 'and the order is kept');
    check(await main.locator('.home.home-compact').count() === 1, 'the spacing choice is kept');
    await both('home-edited');
    await main.evaluate(async () => { const s = await window.keeper.settings.get(); await window.keeper.settings.set({ home: { ...s.home, order: ['folders', 'suggestions', 'jump', 'search', 'today', 'library', 'pinned', 'weather', 'usage'], hidden: ['library', 'weather', 'usage'], density: 'comfortable' } }); });
    await sleep(500);
    // A few themes.
    for (const t of ['glass', 'retro', 'minimal']) {
      await main.evaluate((id) => window.keeper.settings.set({ theme: id }), t).catch(() => undefined);
      await sleep(400);
      await main.screenshot({ path: path.join(SHOTS, `${TAG}home-theme-${t}.png`) });
    }
    await main.evaluate(() => window.keeper.settings.set({ theme: 'playful' }));
  }

  // ---------------------------------------------------------------- the Inspector
  if (want('inspector')) {
    await nav('home');
    await sleep(600);
    const pane = main.locator('[data-testid="inspector-pane"]');
    const paneW = async () => (await pane.boundingBox())?.width ?? 0;
    check(await paneW() < 2, 'no Inspector at start, before anything is selected');
    check(await main.locator('#inspector').count() === 0, 'the empty "Select a file" panel is not drawn');
    const item = main.locator('.shelf-card, .home-recent-item').first();
    await item.click();
    await sleep(700);
    check(await paneW() > 200, `selecting a file opens the Inspector (${Math.round(await paneW())} px)`);
    const sep = main.locator('[data-testid="inspector-splitter"]');
    check(await sep.getAttribute('role') === 'separator', 'the edge is a separator');
    check(await sep.getAttribute('tabindex') === '0', 'the edge can take keyboard focus');
    const before = Number(await sep.getAttribute('aria-valuenow'));
    await both('inspector-open');
    // Drag the left edge 120 px to the left.
    const box = await sep.boundingBox();
    await main.mouse.move(box.x + box.width / 2, box.y + 200);
    await main.mouse.down();
    for (let i = 1; i <= 6; i++) await main.mouse.move(box.x + box.width / 2 - i * 20, box.y + 200);
    await main.mouse.up();
    await sleep(500);
    const dragged = Number(await sep.getAttribute('aria-valuenow'));
    check(Math.abs(dragged - (before + 120)) <= 4, `dragging the edge resizes it (${before} → ${dragged})`);
    // The keyboard: ← makes it wider by 16.
    await sep.focus();
    await main.keyboard.press('ArrowLeft');
    await sleep(200);
    const keyed = Number(await sep.getAttribute('aria-valuenow'));
    check(keyed === dragged + 16, `the arrow keys resize it (${dragged} → ${keyed})`);
    await both('inspector-resized');
    await reload();
    await main.locator('.shelf-card, .home-recent-item').first().click();
    await sleep(700);
    const after = Number(await main.locator('[data-testid="inspector-splitter"]').getAttribute('aria-valuenow'));
    check(after === keyed, `the width is kept after a reload (${after})`);
    check(Math.abs(await paneW() - after) <= 2, 'the column is drawn at that width');
    // Double-click goes back to the usual width.
    await main.locator('[data-testid="inspector-splitter"]').dblclick();
    await sleep(400);
    check(Number(await main.locator('[data-testid="inspector-splitter"]').getAttribute('aria-valuenow')) === 300, 'double-clicking the edge resets the width');
    // Clearing the selection (Escape) slides it away.
    await main.locator('.content').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
    await main.keyboard.press('Escape');
    await sleep(700);
    check(await paneW() < 2, 'clearing the selection hides the Inspector');
    // The explicit toggle: shown with nothing selected, then hidden again.
    await main.click('[data-testid="inspector-toggle"]');
    await sleep(600);
    check(await paneW() > 200 && await main.getByText('Select a file to see its details.').count() > 0, 'Show Inspector shows it with nothing selected');
    await main.keyboard.press('Control+Alt+i');
    await sleep(600);
    check(await paneW() < 2, 'Ctrl+Alt+I hides it again');
  }

  // ---------------------------------------------------------------- the sidebar
  if (want('sidebar')) {
    await nav('home');
    const col = main.locator('[data-testid="sidebar-col"]');
    const colW = async () => Math.round((await col.boundingBox())?.width ?? 0);
    const navW = async () => Math.round((await main.locator('nav.sidebar').boundingBox())?.width ?? 0);
    check(await main.locator('nav.sidebar[aria-label="Sidebar"]').count() === 1, 'the sidebar is a labelled navigation landmark');
    check(await main.locator('nav.sidebar [aria-current="page"]').count() >= 1, 'the page you are on is marked as current');
    check(await colW() > 150, `a wide window has the full sidebar (${await colW()} px)`);
    // A narrow window: the rail.
    await size(860, 640);
    check(await colW() <= 60, `a narrow window gives the icon rail (${await colW()} px)`);
    check(await main.locator('nav.sidebar .nav-item .label').first().isVisible() === false, 'the rail shows icons only');
    await both('sidebar-rail');
    // Hovering opens it over the page, without moving the page.
    const mainX = (await main.locator('main.main').boundingBox()).x;
    await main.mouse.move(28, 300);
    await sleep(700);
    check(await navW() > 150, `pointing at the rail opens it (${await navW()} px)`);
    check(Math.round((await main.locator('main.main').boundingBox()).x) === Math.round(mainX), 'it opens over the page (the page does not move)');
    await both('sidebar-rail-open');
    await main.mouse.move(700, 300);
    await sleep(500);
    check(await navW() <= 60, 'moving away folds it again');
    // The pin keeps it open (and the page makes room).
    await main.mouse.move(28, 300);
    await sleep(700);
    await main.click('[data-testid="sidebar-pin"]');
    await main.mouse.move(700, 300);
    await sleep(500);
    check(await colW() > 150, `the pin keeps it open (${await colW()} px)`);
    // ⌘⌥S / Ctrl+Alt+S folds it again.
    await main.keyboard.press('Control+Alt+s');
    await sleep(400);
    check(await colW() <= 60, 'Ctrl+Alt+S folds it to the rail');
    // Keyboard focus opens the rail.
    await main.locator('nav.sidebar .nav-item').first().focus();
    await main.keyboard.press('Tab');
    await sleep(300);
    check(await navW() > 150, 'keyboard focus opens the rail');
    await main.keyboard.press('Escape');
    await main.keyboard.press('Control+Alt+s');
    await size(1440, 900);
    await sleep(300);
    check(await colW() > 150, 'pinned open, it stays full in a wide window');

    // Resizing by the right edge, kept after a reload.
    const sep = main.locator('[data-testid="sidebar-splitter"]');
    const b = await sep.boundingBox();
    const w0 = await colW();
    await main.mouse.move(b.x + 3, b.y + 300);
    await main.mouse.down();
    for (let i = 1; i <= 4; i++) await main.mouse.move(b.x + 3 + i * 15, b.y + 300);
    await main.mouse.up();
    await sleep(400);
    const w1 = await colW();
    check(Math.abs(w1 - (w0 + 60)) <= 4, `dragging the edge resizes it (${w0} → ${w1})`);
    await reload();
    check(Math.abs(await colW() - w1) <= 2, `the width is kept after a reload (${await colW()})`);
    // Dragging well below the narrowest snaps to the rail.
    const b2 = await main.locator('[data-testid="sidebar-splitter"]').boundingBox();
    await main.mouse.move(b2.x + 3, b2.y + 300);
    await main.mouse.down();
    for (let i = 1; i <= 8; i++) await main.mouse.move(b2.x + 3 - i * 25, b2.y + 300);
    await main.mouse.up();
    await sleep(400);
    check(await colW() <= 60, 'dragging it narrower than its minimum snaps to the rail');
    await main.evaluate(() => localStorage.setItem('sidebar.pinned', 'null'));

    // "Show all" in a long section (automated runs see everything unless they opt in).
    // Sections start folded for a person; open Tidy so its long list shows.
    await main.evaluate(() => { localStorage.setItem('sidebar.compactInTests', '1'); localStorage.removeItem('sidebar.closed'); localStorage.setItem('sidebar.opened', JSON.stringify(['tidy'])); });
    await reload();
    const sys = main.locator('.nav-section', { has: main.locator('[data-testid="nav-more-tidy"]') });
    const shown = async () => sys.locator('.nav-items > .nav-item:visible').count();
    const n0 = await shown();
    check(n0 >= 5 && n0 <= 6, `a long section shows its first five (${n0})`);
    const more = main.locator('[data-testid="nav-more-tidy"]');
    check(/Show all \(\d+\)/.test(await more.textContent()), `with a "${(await more.textContent()).trim()}" row`);
    await more.scrollIntoViewIfNeeded();
    await both('sidebar-compact');
    await more.click();
    await sleep(300);
    const n1 = await shown();
    check(n1 > n0, `"Show all" opens the rest in place (${n0} → ${n1})`);
    await reload();
    check(await shown() === n1, 'and stays open after a reload');
    await main.locator('[data-testid="nav-more-tidy"]').click();
    await main.evaluate(() => { localStorage.removeItem('sidebar.compactInTests'); localStorage.removeItem('sidebar.opened'); });
  }

  check(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
