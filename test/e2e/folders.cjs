// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/folders.cjs /tmp/kf /tmp/kf-shots
// Folders behave like the system file manager's, and the Library is clearly
// something else, in the real app on a throwaway home with a folder tree:
//   • a real folder shows its subfolders first, then its files, in icons, list
//     (with disclosure triangles), columns and gallery; double-click and Enter
//     open a folder; the path bar, Back, Forward and Ctrl/⌘+↑ work;
//   • the Library's "All Documents" says what it is, groups by folder (list
//     view by default) and "Show in folder" opens the real folder;
//   • nothing in the sidebar is wider than the sidebar at 180, 228 and 360 px
//     and in the icon rail, even with a very long name.
// FOLDERS_TAG=before only takes screenshots (for the build before the change).
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

if (process.argv[2]) fs.mkdirSync(process.argv[2], { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/kf-')));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const TAG = process.env.FOLDERS_TAG || 'after';
const BEFORE = TAG === 'before';
fs.mkdirSync(SHOTS, { recursive: true });

// A small, realistic tree: folders inside folders, and plenty of text files spread across them.
const DOCS = path.join(HOME, 'Documents');
const LONG = 'Proton Drive (admin@baweja.org) — Shared with the whole design team';
const tree = {
  'Projects/Keeper/notes.md': '# Notes\n',
  'Projects/Keeper/plan.md': '# Plan\n',
  'Projects/Keeper/Drafts/draft one.md': 'draft\n',
  'Projects/Website/index.md': '# Site\n',
  'Taxes 2025/receipts.txt': 'receipts\n',
  'readme.md': '# Read me\n',
  'todo.txt': 'milk\n',
  'budget.csv': 'a,b\n1,2\n',
};
for (let i = 1; i <= 24; i++) tree[`Notes/note ${String(i).padStart(2, '0')}.md`] = `# Note ${i}\n`;
for (const d of ['Downloads', 'Desktop', 'Pictures', '.config/Keeper', LONG]) fs.mkdirSync(path.join(HOME, d), { recursive: true });
for (const [rel, text] of Object.entries(tree)) {
  fs.mkdirSync(path.dirname(path.join(DOCS, rel)), { recursive: true });
  fs.writeFileSync(path.join(DOCS, rel), text);
}
fs.mkdirSync(path.join(DOCS, 'Empty folder'), { recursive: true });
const settingsFile = path.join(HOME, '.config/Keeper/settings.json');
fs.writeFileSync(settingsFile, JSON.stringify({ folders: ['Documents', 'Downloads', 'Pictures', 'Desktop'].map((f) => path.join(HOME, f)), pinned: [path.join(HOME, LONG)], features: { usageStats: false } }));

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, KEEPER_SKIP_TOUR: '1', NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
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
  const nav = async (r) => { await app.evaluate(({ BrowserWindow }, route) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('event:navigate', route); }, r); await sleep(900); };
  const shot = (name) => main.screenshot({ path: path.join(SHOTS, `${TAG}-${name}.png`) });
  const reload = async () => { await main.reload(); await main.waitForSelector('.sidebar', { timeout: 30000 }); await sleep(1200); };
  // Wait for the library scan to find the fixture.
  for (let i = 0; i < 60; i++) {
    const n = await main.evaluate(() => window.keeper.library.totals().then((t) => t.document.count)).catch(() => 0);
    if (n >= 30) break;
    await sleep(500);
  }
  await reload();

  // ---------------------------------------------------------------- Favorites → Documents
  await nav(`browse:${DOCS}`);
  await main.waitForSelector('.file-card, .file-list tbody tr, .folder-item', { timeout: 20000 });
  await sleep(800);
  await shot('favorites-documents-icons');

  // ---------------------------------------------------------------- Library → Documents
  await nav('library:document');
  await sleep(1200);
  await shot('library-documents');
  await main.locator('[data-testid="view-grid"]').click();
  await sleep(600);
  check(await main.locator('.file-grid > .group-head').count() >= 5, 'icons view keeps the folder groups');
  await shot('library-documents-icons');
  await main.locator('[data-testid="view-list"]').click();
  await sleep(400);

  // ---------------------------------------------------------------- the sidebar at its widths
  const sidebarAt = async (w) => {
    await main.evaluate((px) => { localStorage.setItem('sidebar.width', String(px)); localStorage.setItem('sidebar.pinned', 'true'); }, w);
    await reload();
    await nav(`browse:${path.join(HOME, LONG)}`);
  };
  for (const w of [180, 228, 360]) {
    await sidebarAt(w);
    await shot(`sidebar-${w}`);
  }
  if (BEFORE) { await app.close(); return; }

  const overflow = () => main.evaluate(() => {
    const side = document.querySelector('nav.sidebar');
    const box = side.getBoundingClientRect();
    // Room for the vertical scroll bar is part of the sidebar.
    const bad = [];
    for (const el of side.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right > box.right + 0.5 || r.left < box.left - 0.5) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} [${Math.round(r.left)}–${Math.round(r.right)}] "${(el.textContent || '').trim().slice(0, 30)}"`);
    }
    // The text of a long name ends in an ellipsis: it is clipped by its own box, not by the sidebar.
    const labels = [...side.querySelectorAll('.nav-item .label')].filter((l) => /Proton Drive/.test(l.textContent));
    const clipped = (l) => l.scrollWidth > l.clientWidth && getComputedStyle(l).textOverflow === 'ellipsis';
    // The pinned folder (a real row, not the one lengthened in the page) carries its full name in its tooltip.
    const pinned = labels.find((l) => (l.closest('.nav-item')?.getAttribute('title') ?? '').includes('Proton Drive'));
    // And no row is squashed to fit (a long sidebar scrolls instead).
    for (const b of side.querySelectorAll('.nav-item')) { const r = b.getBoundingClientRect(); if (r.height && r.height < 22) bad.push(`squashed .nav-item "${b.textContent.trim().slice(0, 20)}" (${Math.round(r.height)} px)`); }
    return { width: Math.round(box.width), bad, clippedNicely: labels.length >= 2 && labels.every(clipped), tooltip: pinned?.closest('.nav-item')?.getAttribute('title') ?? '' };
  });
  // A very long Locations row too (as the owner's "Proton Drive (admin@baweja…" one), set in the page.
  const lengthenLocation = () => main.evaluate((long) => { const sec = [...document.querySelectorAll('.nav-section')].find((x) => /Locations/i.test(x.querySelector('.nav-title')?.textContent ?? '')); const l = sec?.querySelector('.place-row .nav-item .label'); if (l) l.textContent = long; }, LONG);
  for (const w of [180, 228, 360]) {
    await sidebarAt(w);
    await lengthenLocation();
    await sleep(200);
    const o = await overflow();
    check(o.bad.length === 0, `at ${w} px (${o.width}) nothing in the sidebar is wider than it${o.bad.length ? ': ' + o.bad.slice(0, 5).join('; ') : ''}`);
    check(o.clippedNicely, `at ${w} px a long name ends in an ellipsis`);
    check(o.tooltip.includes('Proton Drive (admin@baweja.org)'), 'and its full name is in the tooltip');
  }
  // The selected row's highlight sits inside the column with even margins.
  const margins = await main.evaluate(() => {
    const side = document.querySelector('nav.sidebar').getBoundingClientRect();
    const a = document.querySelector('nav.sidebar .nav-item.active').getBoundingClientRect();
    const sb = document.querySelector('nav.sidebar').offsetWidth - document.querySelector('nav.sidebar').clientWidth;
    return { left: Math.round(a.left - side.left), right: Math.round(side.right - sb - a.right) };
  });
  check(Math.abs(margins.left - margins.right) <= 2, `the selected row has even margins (${margins.left} / ${margins.right} px)`);
  // The disk usage bar sits inside its row.
  const bar = await main.evaluate(() => {
    const b = document.querySelector('nav.sidebar .place-bar');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const row = b.closest('.place-row').querySelector('.nav-item').getBoundingClientRect();
    return r.left >= row.left && r.right <= row.right && r.bottom <= row.bottom + 0.5;
  });
  check(bar !== false, `the drive usage bar fits inside its row (${bar === null ? 'no bar on this system' : 'inside'})`);
  // Keyboard focus on a section title: the ring is drawn inside the button.
  await main.locator('nav.sidebar button.nav-title').first().focus();
  await main.keyboard.press('Shift+Tab');
  await main.keyboard.press('Tab');
  const ring = await main.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); return { cls: el.className, offset: parseFloat(cs.outlineOffset), width: parseFloat(cs.outlineWidth) }; });
  check(/nav-title/.test(ring.cls) && ring.offset <= -ring.width, `the section title focus ring is inset (offset ${ring.offset}, width ${ring.width})`);
  await shot('sidebar-focus');
  // The icon rail.
  await main.evaluate(() => localStorage.setItem('sidebar.pinned', 'false'));
  await reload();
  await main.mouse.move(900, 400);
  await sleep(500);
  const rail = await overflow();
  check(rail.width <= 60 && rail.bad.length === 0, `the icon rail (${rail.width} px) has nothing sticking out${rail.bad.length ? ': ' + rail.bad.slice(0, 5).join('; ') : ''}`);
  await shot('sidebar-rail');
  await main.evaluate(() => { localStorage.setItem('sidebar.pinned', 'true'); localStorage.setItem('sidebar.width', '228'); });
  await reload();

  // ---------------------------------------------------------------- real folders
  await nav(`browse:${DOCS}`);
  // Icons view.
  await main.locator('[data-testid="view-grid"]').click();
  await sleep(400);
  const order = await main.evaluate(() => [...document.querySelectorAll('.file-grid .file-card')].map((c) => ({ name: c.querySelector('.name')?.textContent, dir: c.dataset.dir === '1' })));
  const firstFile = order.findIndex((o) => !o.dir);
  const lastDir = order.map((o) => o.dir).lastIndexOf(true);
  // (Keeper may add a folder of its own, such as "Keeper Cues".)
  const dirNames = order.filter((o) => o.dir).map((o) => o.name).filter((n) => !/^Keeper /.test(n));
  check(dirNames.join('|') === 'Empty folder|Notes|Projects|Taxes 2025', `icons: subfolders show, by name (${dirNames.join(', ')})`);
  check(lastDir < firstFile, 'icons: folders come first, then files');
  check(order.filter((o) => !o.dir).map((o) => o.name).join('|') === 'budget.csv|readme.md|todo.txt', `icons: files by name (${order.filter((o) => !o.dir).map((o) => o.name).join(', ')})`);
  await shot('favorites-documents-icons');
  // Double-click opens a folder; the path bar follows.
  await main.locator('.file-card[data-dir="1"]', { hasText: 'Projects' }).dblclick();
  await sleep(800);
  const crumbs = async () => (await main.locator('[data-testid="pathbar"] button.crumb').allTextContents()).map((s) => s.trim());
  check((await crumbs()).join(' › ') === 'Home › Documents › Projects', `double-click opens Projects (path bar: ${(await crumbs()).join(' › ')})`);
  check((await main.locator('.file-card[data-dir="1"]').allTextContents()).join('|').includes('Keeper'), 'Projects shows its subfolders');
  // Back, Forward and Ctrl/⌘+↑.
  await main.keyboard.press('Control+[');
  await sleep(600);
  check((await crumbs()).at(-1) === 'Documents', 'Back returns to Documents');
  await main.keyboard.press('Control+]');
  await sleep(600);
  check((await crumbs()).at(-1) === 'Projects', 'Forward goes to Projects again');
  await main.keyboard.press('Control+ArrowUp');
  await sleep(600);
  check((await crumbs()).at(-1) === 'Documents', 'Ctrl+↑ goes to the enclosing folder');
  // Enter opens the selected folder; the breadcrumb goes back.
  await main.locator('.file-card[data-dir="1"]', { hasText: 'Notes' }).click();
  await main.keyboard.press('Enter');
  await sleep(700);
  check((await crumbs()).at(-1) === 'Notes', 'Enter opens the selected folder');
  await main.locator('[data-testid="pathbar"] button.crumb', { hasText: 'Documents' }).click();
  await sleep(700);
  check((await crumbs()).at(-1) === 'Documents', 'a path bar crumb opens that folder');

  // List view with disclosure triangles.
  await main.locator('[data-testid="view-list"]').click();
  await sleep(500);
  const rows = async () => main.evaluate(() => [...document.querySelectorAll('.file-list tbody tr[data-path]')].map((r) => ({ name: r.querySelector('.fl-name')?.textContent?.trim(), depth: Number(r.dataset.depth || 0), dir: r.dataset.dir === '1' })));
  const r0 = await rows();
  const nd = r0.filter((r) => r.dir).length;
  check(nd >= 4 && r0.slice(0, nd).every((r) => r.dir), `list: folders first (${r0.map((r) => r.name).join(', ')})`);
  await main.locator('.file-list tr[data-dir="1"]', { hasText: 'Projects' }).locator('.disclose').click();
  await sleep(700);
  const r1 = await rows();
  const kids = r1.filter((r) => r.depth === 1).map((r) => r.name);
  check(kids.join('|') === 'Keeper|Website', `list: the triangle shows Projects' folders in place (${kids.join(', ')})`);
  await main.locator(`.file-list tr[data-path="${path.join(DOCS, 'Projects', 'Keeper')}"] .disclose`).click();
  await sleep(700);
  const r2 = await rows();
  check(r2.filter((r) => r.depth === 2).map((r) => r.name).join('|') === 'Drafts|notes.md|plan.md', `list: and deeper, folders first (${r2.filter((r) => r.depth === 2).map((r) => r.name).join(', ')})`);
  await shot('favorites-documents-list-tree');
  // The keyboard: ← folds the selected folder.
  await main.locator('.file-list tr[data-dir="1"]', { hasText: 'Projects' }).click();
  await main.keyboard.press('ArrowLeft');
  await sleep(400);
  check((await rows()).every((r) => r.depth === 0), 'list: ← folds the selected folder');

  // Columns.
  await main.locator('[data-testid="view-columns"]').click();
  await sleep(600);
  check(await main.locator('.col-view .col-pane').count() === 1, 'columns: one column for Documents');
  await main.locator('.col-pane').first().locator('.col-row', { hasText: 'Projects' }).click();
  await sleep(700);
  check(await main.locator('.col-view .col-pane').count() === 2 && (await main.locator('.col-pane').nth(1).locator('.col-row').allTextContents()).join('|').includes('Keeper'), 'columns: choosing Projects shows its contents beside it');
  await main.locator(`.col-pane .col-row[data-path="${path.join(DOCS, 'Projects', 'Keeper')}"]`).click();
  await sleep(700);
  await main.locator('.col-pane').nth(2).locator('.col-row', { hasText: 'plan.md' }).click();
  await sleep(900);
  check(await main.locator('.col-view .col-preview').count() === 1, 'columns: a file shows its preview in the last column');
  await shot('favorites-documents-columns');
  await main.keyboard.press('ArrowLeft');
  await sleep(300);
  check(await main.locator('.col-view .col-preview').count() === 0, 'columns: ← steps back a column');
  await main.locator(`.col-pane .col-row[data-path="${path.join(DOCS, 'Projects', 'Keeper')}"]`).dblclick();
  await sleep(700);
  check((await crumbs()).at(-1) === 'Keeper', 'columns: double-clicking a folder opens it');
  await nav(`browse:${DOCS}`);

  // Gallery.
  await main.locator('[data-testid="view-gallery"]').click();
  await sleep(700);
  check(await main.locator('.gallery-view .gallery-stage').count() === 1 && await main.locator('.gallery-strip .file-card[data-dir="1"]').count() >= 4 && await main.locator('.gallery-strip .file-card').first().getAttribute('data-dir') === '1', 'gallery: a big preview and a strip with the folders first');
  await shot('favorites-documents-gallery');
  await main.locator('[data-testid="view-grid"]').click();

  // ---------------------------------------------------------------- the Library
  await nav('library:document');
  await sleep(1200);
  const head = await main.locator('[data-testid="kind-intro"]').textContent().catch(() => '');
  check(/^Every document on this computer, wherever it is\. \d+ in \d+ folders?/.test(head.trim()), `All Documents says what it is ("${head.trim()}")`);
  check(await main.locator('nav.sidebar .nav-item', { hasText: 'All Documents' }).count() === 1, 'the sidebar calls it "All Documents"');
  check(await main.locator('.file-list').count() === 1, 'a text-heavy collection opens as a list');
  const groups = await main.locator('.file-list tr.group-row').allTextContents();
  check(groups.length >= 5 && groups.some((g) => /Notes/.test(g)) && groups.some((g) => /Keeper/.test(g)), `grouped by folder (${groups.length} folders)`);
  const thumbsInList = await main.locator('.file-list .mini-thumb img').count();
  check(thumbsInList === 0, 'text files show a clean type icon, not a page render');
  check(await main.locator('[data-testid="group-by-folder"]').getAttribute('aria-pressed') === 'true', 'Group by folder is on by default');
  await shot('library-documents');
  await main.locator('[data-testid="view-grid"]').click();
  await sleep(600);
  check(await main.locator('.file-grid > .group-head').count() >= 5, 'icons view keeps the folder groups');
  await shot('library-documents-icons');
  await main.locator('[data-testid="view-list"]').click();
  await sleep(400);
  await main.locator(`.file-list tr.group-row .group-head[title="${path.join(DOCS, 'Projects', 'Keeper')}"] button`, { hasText: 'Show in folder' }).click();
  await sleep(900);
  check((await crumbs()).at(-1) === 'Keeper', 'Show in folder opens the real folder');
  await nav('library:document');
  await sleep(800);
  await main.locator('[data-testid="group-by-folder"]').click();
  await sleep(500);
  check(await main.locator('.file-list tr.group-row').count() === 0 && await main.locator('.file-list th', { hasText: 'Folder' }).count() === 1, 'Group by folder off: one list with a Folder column');
  await main.locator('[data-testid="group-by-folder"]').click();

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await app.close();
})().catch((e) => { console.error('E2E FAILED', e); process.exit(1); });
