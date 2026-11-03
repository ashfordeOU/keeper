// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/filesnav.cjs /tmp/kfn /tmp/kfn-shots
// One obvious place for your files, in the real app on a throwaway home:
//   • the sidebar lists real places only, laid out like GNOME Files (Recent,
//     Starred, Home Folder, the folders, Trash, a GTK bookmark; Other
//     Locations): no Library, no "All Documents", Weather out of the files;
//   • Home's first row is Desktop, Documents and Downloads with counts, then
//     Jump back in, then Find a file with the types under it;
//   • "By type" chips with counts filter a folder and Everywhere; the old
//     Library routes land on Everywhere + a chip; the keyboard moves along
//     the chips; "Find by type" comes back to the sidebar from Settings.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

if (process.argv[2]) fs.mkdirSync(process.argv[2], { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/kfn-')));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });

const FILES = {
  'Documents/plan.md': '# Plan\n', 'Documents/report.pdf': '%PDF-1.4\n', 'Documents/budget.csv': 'a,b\n', 'Documents/Taxes/receipt.txt': 'r\n', 'Documents/beach.jpg': 'x',
  'Downloads/setup.deb': 'x', 'Downloads/photos.zip': 'PK', 'Downloads/manual.pdf': '%PDF-1.4\n', 'Downloads/song.mp3': 'x',
  'Desktop/Screenshot from 2026-10-01 10-00-00.png': 'x', 'Desktop/todo.md': '- milk\n',
  'Pictures/hike.png': 'x', 'Music/track.mp3': 'x', 'Videos/clip.mp4': 'x', 'Projects/notes.md': '# Notes\n',
};
for (const [rel, t] of Object.entries(FILES)) { fs.mkdirSync(path.dirname(path.join(HOME, rel)), { recursive: true }); fs.writeFileSync(path.join(HOME, rel), t); }
fs.mkdirSync(path.join(HOME, '.config/Keeper'), { recursive: true });
fs.mkdirSync(path.join(HOME, '.config/gtk-3.0'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.config/gtk-3.0/bookmarks'), `file://${encodeURI(path.join(HOME, 'Projects'))} Projects\n`);
fs.writeFileSync(path.join(HOME, '.config/Keeper/settings.json'), JSON.stringify({
  folders: ['Documents', 'Downloads', 'Pictures', 'Desktop', 'Music', 'Videos'].map((f) => path.join(HOME, f)),
  features: { usageStats: false },
  // An existing person's sidebar: a section order with the old Library in it.
  sidebarOrder: ['library', 'tidy'], sidebarHidden: ['section:library'],
}));

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, KEEPER_SKIP_TOUR: '1', NODE_OPTIONS: '', XDG_CURRENT_DESKTOP: 'GNOME', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  let main;
  for (let i = 0; i < 60 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    if (!main) await sleep(500);
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.setContentSize(1440, 900); } });
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 60000 });
  const nav = async (r) => { await app.evaluate(({ BrowserWindow }, route) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('event:navigate', route); }, r); await sleep(1000); };
  const both = async (name) => {
    for (const dark of [false, true]) {
      await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark);
      await sleep(600);
      await main.screenshot({ path: path.join(SHOTS, `${name}-${dark ? 'dark' : 'light'}.png`) });
    }
    await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));
  };
  for (let i = 0; i < 60; i++) {
    const n = await main.evaluate(() => window.keeper.library.status().then((s) => s.files)).catch(() => 0);
    if (n >= 13) break;
    await sleep(500);
  }
  await main.reload();
  await main.waitForSelector('.sidebar', { timeout: 30000 });
  await sleep(2500);

  // ---------------------------------------------------------------- the sidebar
  const top = (await main.locator('[data-testid="sidebar-places-top"] .nav-item .label').allTextContents()).map((s) => s.trim());
  check(top.slice(0, 10).join(',') === 'Home,Recent,Starred,Home Folder,Documents,Downloads,Music,Pictures,Videos,Trash', `the places are GNOME Files' (${top.join(', ')})`);
  check(top.includes('Projects'), 'a GTK bookmark is in the sidebar');
  const side = await main.locator('nav.sidebar').innerText();
  check(!/All Documents|All Images|Download Sources|\bLIBRARY\b|^Browse$/m.test(side), 'no Library, no "All …" and no Browse in the sidebar');
  check(/Other Locations/i.test(side) && /Network/.test(side), 'Other Locations holds the disks and Network');
  check(await main.locator('[data-testid="sidebar-places-top"] .nav-item', { hasText: /Weather|Places & Tracks/ }).count() === 0 && await main.locator('[data-nav-section="desktop"] [title="Weather"]').count() === 1, 'Weather lives with the Desktop parts, not with your files');
  check(await main.locator('nav.sidebar .nav-item', { hasText: /^Documents$/ }).count() === 1, 'one "Documents" in the sidebar: the folder');
  const s0 = await main.evaluate(() => window.keeper.settings.get());
  check(!s0.sidebarOrder.includes('library') && !s0.sidebarHidden.includes('section:library'), 'an old order and hidden Library are moved on');

  // A click on a place opens it; a click on a page row (Trash) opens the page.
  await main.locator('[data-testid="sidebar-places-top"] .nav-item', { hasText: /^Downloads$/ }).click();
  await sleep(900);
  check(await main.locator('[data-testid="pathbar"] [aria-current="location"]').textContent().catch(() => '') === 'Downloads', "the sidebar's Downloads opens the Downloads folder");
  await main.locator('[data-testid="sidebar-places-top"] .nav-item', { hasText: /^Trash$/ }).click();
  await sleep(900);
  check(await main.locator('[data-testid="sidebar-places-top"] .nav-item.active', { hasText: /^Trash$/ }).count() === 1, "the sidebar's Trash opens the Trash");

  // ---------------------------------------------------------------- Home, the front door
  await nav('home');
  await sleep(800);
  const doors = await main.locator('[data-testid="home-folder"]').allInnerTexts();
  check(doors.length === 3 && /^Desktop/.test(doors[0]) && /^Documents/.test(doors[1]) && /^Downloads/.test(doors[2]), `Home's first row: Desktop, Documents, Downloads (${doors.map((d) => d.split('\n')[0]).join(', ')})`);
  check(/5 files/.test(doors[1]) && /4 files/.test(doors[2]), `the tiles say how much is in them (${doors.map((d) => d.replace(/\n/g, ' ')).join(' | ')})`);
  const order = await main.locator('.home-main > .home-slot').evaluateAll((els) => els.map((e) => e.dataset.section));
  check(order.indexOf('folders') === 0 && order.indexOf('jump') < order.indexOf('search'), `folders, then recent files, then Find a file (${order.join(', ')})`);
  await both('home');
  await main.locator('[data-testid="home-folder"]', { hasText: 'Documents' }).click();
  await sleep(1000);
  check(await main.locator('[data-testid="pathbar"] [aria-current="location"]').textContent() === 'Documents', 'the Documents tile opens the Documents folder');

  // ---------------------------------------------------------------- chips in a folder
  const chipN = async (id) => Number(((await main.locator(`[data-testid="chip-${id}"] .n`).textContent().catch(() => '')) || '0').replace(/\D/g, ''));
  check(await main.locator('[data-testid="type-bar"]').count() === 1 && await main.locator('[data-testid="scope-folder"]').getAttribute('aria-checked') === 'true', 'a folder has the type bar, scoped to the folder');
  check(await chipN('all') === 5 && await chipN('document') === 4 && await chipN('image') === 1, `chips count this folder and inside it (all ${await chipN('all')}, documents ${await chipN('document')}, pictures ${await chipN('image')})`);
  check(await main.locator('[data-testid="chip-video"]').count() === 0, 'a type with nothing in it has no chip');
  await main.locator('[data-testid="chip-document"]').click();
  await sleep(1200);
  const shownText = await main.locator('.file-list').innerText();
  check(/plan\.md/.test(shownText) && /receipt\.txt/.test(shownText) && !/beach\.jpg/.test(shownText), 'the Documents chip shows documents here and inside, and no pictures');
  check(await main.locator('[data-testid="chip-document"]').getAttribute('aria-pressed') === 'true', 'the chosen chip is pressed');
  const at = (n) => shownText.indexOf(n);
  check(at('budget.csv') < at('plan.md') && at('plan.md') < at('report.pdf'), 'sorted by name, A to Z, as the folder is');
  await both('folder-documents');
  await main.locator('[data-testid="chip-document"]').click();
  await sleep(800);
  check(await main.locator('[data-testid="chip-all"]').getAttribute('aria-pressed') === 'true', 'clicking the chosen chip again shows everything');

  // ---------------------------------------------------------------- Everywhere
  await main.locator('[data-testid="chip-image"]').click();
  await sleep(600);
  await main.locator('[data-testid="scope-everywhere"]').click();
  await sleep(1200);
  check((await main.locator('.page-head h1').textContent()) === 'Everywhere' && await main.locator('[data-testid="chip-image"]').getAttribute('aria-pressed') === 'true', 'Everywhere keeps the chosen type');
  check(await chipN('image') === 3, `Pictures everywhere counts every picture (${await chipN('image')})`);
  await main.locator('[data-testid="scope-folder"]').click();
  await sleep(1000);
  check(await main.locator('[data-testid="pathbar"] [aria-current="location"]').textContent() === 'Documents', 'the folder button goes back to the folder');

  // ---------------------------------------------------------------- old routes
  for (const [r, chip] of [['library:document', 'document'], ['screenshots', 'screenshot'], ['downloads', 'web'], ['library:image', 'image']]) {
    await nav(r);
    check(await main.locator(`[data-testid="chip-${chip}"]`).getAttribute('aria-pressed').catch(() => null) === 'true' && (await main.locator('.page-head h1').textContent()) === 'Everywhere', `${r} opens Everywhere + ${chip}`);
  }
  await nav('library:document');
  await sleep(600);
  await both('everywhere-documents');

  // ---------------------------------------------------------------- the keyboard
  await main.locator('[data-testid="chip-all"]').focus();
  await main.keyboard.press('ArrowRight');
  check(await main.evaluate(() => document.activeElement?.dataset.chip) === 'document', '→ moves along the chips');
  await main.keyboard.press('Enter');
  await sleep(600);
  check(await main.locator('[data-testid="chip-document"]').getAttribute('aria-pressed') === 'false', 'Enter on the chosen chip lets it go');

  // ---------------------------------------------------------------- Find by type in the sidebar (Settings → Sidebar)
  check(await main.locator('[data-nav-section="types"]').count() === 0, 'Find by type is not in the sidebar unless asked for');
  await main.evaluate(() => window.keeper.settings.set({ sidebarTypes: true }));
  await sleep(1200);
  check(await main.locator('[data-nav-section="types"] .nav-item', { hasText: 'Documents' }).count() === 1, 'Settings → Sidebar brings Find by type back');
  await main.evaluate(() => window.keeper.settings.set({ sidebarTypes: false }));

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await app.close();
})().catch((e) => { console.error('E2E FAILED', e); process.exit(1); });
