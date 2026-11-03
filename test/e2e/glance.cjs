// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/glance.cjs /tmp/gl-home /tmp/gl-shots
// The owl's glance: opened through its API (as a click on the tray icon does). Its header and
// status line, reading tiles whose values fit on one line, the Keep Awake switch, four quick
// actions with the rest under More, three recent downloads with a visible "See all", and an
// aligned footer. Nothing overflows: no scrollbars across or down, the window takes the height
// of what it shows. Keyboard works, Settings → Menu bar switches parts off, and it is
// pictured in light and dark (glance-light.png, glance-dark.png, settings-menubar-*.png).
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const HOME = process.argv[2];
const SHOTS = process.argv[3];
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
// Long names on purpose: they must be cut in the middle, not push anything sideways.
const files = [
  ['Quarterly report.pdf', 120_000],
  ['holiday-photos-lisbon-summer-2026-original-resolution-export.zip', 3_000_000],
  ['Annual financial statement 2026 - revised version (final) v3.pdf', 2_000_000],
  ['Keeper-1.0.0-arm64-mac-universal-signed-build-final.dmg', 1_500_000],
];
files.forEach(([name, size], i) => {
  const p = path.join(HOME, 'Downloads', name);
  fs.writeFileSync(p, Buffer.alloc(size, 1));
  const t = new Date(Date.now() - (files.length - i) * 60_000);
  fs.utimesSync(p, t, t);
});

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const navigate = (app, r) => app.evaluate(({ BrowserWindow }, route) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=app')); w?.webContents.send('event:navigate', route); }, r);

(async () => {
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  let main;
  for (let i = 0; i < 60 && !main; i++) { main = app.windows().find((w) => w.url().includes('view=app')); if (!main) await wait(500); }
  check(!!main, 'Keeper opens');
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  const errors = [];

  const winBounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('view=glance'))?.getBounds());
  const open = async () => {
    await main.evaluate(() => window.keeper.glance.show());
    let g;
    for (let i = 0; i < 40 && !g; i++) { g = app.windows().find((w) => w.url().includes('view=glance')); if (!g) await wait(250); }
    return g;
  };
  // No scrollbars: nothing wider or taller than the frame, and every one-line value shown in full.
  const overflow = (g) => g.evaluate(() => {
    const el = document.querySelector('.glance');
    const doc = document.scrollingElement;
    const cut = [...document.querySelectorAll('.gl-value, .gl-act-label, .gl-file-size, .gl-brand, .gl-primary, .gl-quiet, .gl-link')].filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent);
    const wrapped = [...document.querySelectorAll('.gl-value, .gl-sub, .gl-label, .gl-file-name, .gl-act-label')].filter((x) => x.getBoundingClientRect().height > parseFloat(getComputedStyle(x).lineHeight) * 1.5).map((x) => x.textContent);
    return {
      w: el.scrollWidth, cw: el.clientWidth, h: el.scrollHeight, ch: el.clientHeight,
      dw: doc.scrollWidth, dcw: doc.clientWidth, dh: doc.scrollHeight, dch: doc.clientHeight,
      inner: Math.ceil(document.querySelector('.gl-fit').getBoundingClientRect().height),
      cut, wrapped,
    };
  });
  const noOverflow = async (g, when) => {
    const o = await overflow(g);
    check(o.w <= o.cw && o.dw <= o.dcw, `${when}: no sideways overflow (${o.w}/${o.cw}, page ${o.dw}/${o.dcw})`);
    check(o.h <= o.ch && o.dh <= o.dch, `${when}: no scrolling down (${o.h}/${o.ch}, page ${o.dh}/${o.dch})`);
    check(o.cut.length === 0, `${when}: values and labels are shown in full${o.cut.length ? ` (cut: ${o.cut.join(' | ')})` : ''}`);
    check(o.wrapped.length === 0, `${when}: nothing wraps onto a second line${o.wrapped.length ? ` (${o.wrapped.join(' | ')})` : ''}`);
    return o;
  };
  // The window settles at its content's height.
  const settled = async () => {
    let last;
    for (let i = 0; i < 20; i++) { const b = await winBounds(); if (last && b.height === last.height) return b; last = b; await wait(150); }
    return last;
  };

  const g = await open();
  check(!!g, 'the glance window opens through its API');
  g.on('pageerror', (e) => errors.push(e.message));
  await g.waitForSelector('[data-testid="glance-card-storage"]', { timeout: 15_000 });
  await g.waitForSelector('.gl-file', { timeout: 15_000 }).catch(() => undefined);

  // Header: Keeper and one line of status.
  const status = (await g.textContent('[data-testid="glance-status"]'))?.trim();
  check(await g.isVisible('.gl-brand') && !!status && status !== 'Reading…', `the header says Keeper and how things stand ("${status}")`);

  // Tiles: equal size, in a tidy grid.
  const tiles = await g.$$eval('.gl-tile:not(.gl-ghost)', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.testid.replace('glance-card-', ''), w: Math.round(r.width), h: Math.round(r.height), v: e.querySelector('.gl-value').textContent }; }));
  check(tiles.length >= 3 && tiles.every((t) => ['weather', 'storage', 'system', 'network'].includes(t.id)), `reading tiles: ${tiles.map((t) => `${t.id} "${t.v}"`).join(', ')}`);
  check(new Set(tiles.map((t) => t.w)).size === 1 && new Set(tiles.map((t) => t.h)).size === 1, `the tiles are the same size (${[...new Set(tiles.map((t) => `${t.w}×${t.h}`))].join(', ')})`);
  const storage = tiles.find((t) => t.id === 'storage');
  check(!!storage && /^\d+(\.\d)? (KB|MB|GB|TB) free$/.test(storage.v), `disk in a short form ("${storage?.v}")`);
  const net = tiles.find((t) => t.id === 'network');
  check(!!net && (/^↓\S+ ↑\S+ (B|KB|MB)\/s$/.test(net.v) || /Connected|Offline/.test(net.v)), `network in a short form ("${net?.v}")`);

  // Keep Awake is a switch row, not a tile.
  check(!(await g.$('.gl-tile[data-testid="glance-card-awake"]')) && await g.isVisible('[data-testid="glance-awake-switch"]'), 'Keep Awake is a switch row');
  const before = await g.getAttribute('[data-testid="glance-awake-switch"]', 'aria-checked');
  await g.click('[data-testid="glance-awake-switch"]');
  await wait(800);
  const after = await g.getAttribute('[data-testid="glance-awake-switch"]', 'aria-checked');
  check(before !== after, `the switch turns Keep Awake ${after === 'true' ? 'on' : 'off'}`);
  check(await g.isVisible('[data-testid="glance"]'), 'the glance stays open after the switch');
  await g.click('[data-testid="glance-awake-switch"]');
  await wait(800);
  check(await g.getAttribute('[data-testid="glance-awake-switch"]', 'aria-checked') === before, 'and back');

  // Quick actions: four of the same size, the rest under More, and Edit.
  const acts = await g.$$eval('.gl-acts:not(.gl-more) .gl-act', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.testid, w: Math.round(r.width), h: Math.round(r.height) }; }));
  const pinned = acts.filter((a) => a.id !== 'glance-more');
  check(pinned.length === 4, `four quick actions (${pinned.map((a) => a.id.replace('glance-action-', '')).join(', ')})`);
  check(new Set(acts.map((a) => `${a.w}×${a.h}`)).size === 1, `quick action buttons are the same size (${[...new Set(acts.map((a) => `${a.w}×${a.h}`))].join(', ')})`);
  check(await g.isVisible('[data-testid="glance-edit"]'), 'quick actions have Edit');
  check(!(await g.isVisible('[data-testid="glance-more-panel"]')), 'More is closed by default');

  // Downloads: three rows with an icon, a name cut in the middle, a size, and a visible See all.
  const rows = await g.$$eval('.gl-file', (els) => els.map((e) => ({ name: e.querySelector('.gl-file-name').textContent, size: e.querySelector('.gl-file-size').textContent, icon: !!e.querySelector('.gl-file-ic svg') })));
  check(rows.length === 3 && rows.every((r) => r.icon && r.size), `three downloads: ${rows.map((r) => `${r.name} (${r.size})`).join(' · ')}`);
  check(rows.some((r) => r.name.includes('…') && /\.(zip|pdf|dmg)$/.test(r.name)), 'long names are cut in the middle and keep their type');
  const seeAll = await g.$eval('[data-testid="glance-see-all"]', (e) => { const c = getComputedStyle(e); return { op: Number(c.opacity), color: c.color, vis: c.visibility, w: e.getBoundingClientRect().width }; });
  check(seeAll.op === 1 && seeAll.vis === 'visible' && seeAll.w > 20, `See all is plainly visible (${seeAll.color})`);

  // Footer: Open Keeper first and filled, Settings and Quit on the right, all on one line inside the gutter.
  const foot = await g.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const [settings, quit] = [...document.querySelectorAll('.gl-quiet')].map((b) => b.getBoundingClientRect());
    const fit = r('.gl-fit');
    const openBtn = r('[data-testid="glance-open"]');
    return { openLeft: Math.round(openBtn.left - fit.left), quitRight: Math.round(fit.right - quit.right), centers: [openBtn, settings, quit].map((b) => Math.round(b.top + b.height / 2)) };
  });
  check(foot.openLeft === 12 && foot.quitRight === 12 && new Set(foot.centers).size === 1, `the footer is aligned (Open Keeper ${foot.openLeft}px in, Quit ${foot.quitRight}px in, centres ${foot.centers.join('/')})`);

  const b1 = await settled();
  const o1 = await noOverflow(g, 'at its normal size');
  check(b1.width === 360 && Math.abs(b1.height - (o1.inner + 2)) <= 2, `the window is 360 wide and as tall as its content (${b1.width}×${b1.height}, content ${o1.inner})`);

  // Keyboard: arrows move between buttons; More opens and Escape folds it.
  await g.focus('[data-testid="glance-card-storage"]');
  await g.keyboard.press('ArrowRight');
  const focused = await g.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  check(!!focused && focused !== 'glance-card-storage', `arrow keys move the focus (${focused})`);
  await g.focus('[data-testid="glance-more"]');
  await g.keyboard.press('Enter');
  await g.waitForSelector('[data-testid="glance-more-panel"]', { timeout: 3000 }).catch(() => undefined);
  const moreCount = await g.$$eval('[data-testid="glance-more-panel"] .gl-act', (els) => els.length);
  check(moreCount >= 4 && await g.getAttribute('[data-testid="glance-more"]', 'aria-expanded') === 'true', `More shows the other actions (${moreCount})`);
  const b2 = await settled();
  check(b2.height > b1.height, `the window grows to fit More (${b1.height} → ${b2.height})`);
  await noOverflow(g, 'with More open');
  await g.screenshot({ path: path.join(SHOTS, 'glance-more-light.png') });
  await g.keyboard.press('Escape');
  await wait(300);
  check(!(await g.isVisible('[data-testid="glance-more-panel"]')) && await g.evaluate(() => document.activeElement?.getAttribute('data-testid')) === 'glance-more', 'Escape folds More and keeps the focus on it');
  const b3 = await settled();
  check(b3.height === b1.height, `and the window shrinks back (${b3.height})`);

  // Live values arrive while open.
  const got = await g.evaluate(() => new Promise((r) => { const off = window.keeper.on('glance', (v) => { off(); r(v.tiles.length); }); setTimeout(() => r(0), 6000); }));
  check(got > 0, `live values arrive while it is open (${got} tiles)`);
  await g.evaluate(() => document.activeElement?.blur());
  await wait(300);
  await g.screenshot({ path: path.join(SHOTS, 'glance-light.png') });

  // Settings → Menu bar: parts can be switched off, and the window gets shorter.
  await main.evaluate(() => window.keeper.glance.setSettings({ sections: { stats: true, actions: false, downloads: false } }));
  const v = await main.evaluate(() => window.keeper.glance.view());
  check(v.actions.length === 0 && v.recent.length === 0 && v.tiles.length > 0, 'Settings switch quick actions and downloads off');
  await main.evaluate(() => window.keeper.glance.close());
  const gs = await open();
  await gs.waitForSelector('[data-testid="glance-card-storage"]', { timeout: 15_000 });
  await wait(2500);
  const b4 = await settled();
  check(!(await gs.$('[data-testid="glance-downloads"]')) && !(await gs.$('[data-testid="glance-edit"]')) && b4.height < b1.height, `the parts that are off are gone and the window is shorter (${b4.height})`);
  await noOverflow(gs, 'with parts off');
  await main.evaluate(() => window.keeper.glance.setSettings({ sections: { stats: true, actions: true, downloads: true }, actions: ['quickSearch', 'terminal'] }));
  const v2 = await main.evaluate(() => window.keeper.glance.view());
  check(v2.actions.join() === 'quickSearch,terminal' && v2.more.includes('screenshot') && !v2.more.includes('terminal'), `Settings choose the buttons; the rest go under More (${v2.actions.join()} / ${v2.more.length} more)`);
  await main.evaluate(() => window.keeper.glance.setSettings({ actions: ['quickSearch', 'screenshot', 'captureText', 'clipboard'] }));

  // Settings → Menu bar in light and dark, at 1440×900 (and a look at 1024×768).
  await main.evaluate(() => window.keeper.glance.close());
  const size = (w, h) => app.evaluate(({ BrowserWindow }, [w2, h2]) => { const x = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('view=app')); x.unmaximize(); x.setContentSize(w2, h2); x.setPosition(0, 0); }, [w, h]);
  await size(1440, 900);
  await navigate(app, 'settings:menubar');
  await main.waitForSelector('[data-testid="settings-menubar"]', { timeout: 15_000 });
  const chips = await main.$$eval('[data-testid="settings-menubar-actions"] .gl-chip', (els) => ({ on: els.filter((e) => e.getAttribute('aria-pressed') === 'true').length, disabled: els.filter((e) => e.disabled).length }));
  check(chips.on === 4 && chips.disabled > 0, `Settings: four buttons picked, the others wait until one is turned off (${chips.on} on, ${chips.disabled} waiting)`);
  await main.locator('[data-testid="settings-menubar"]').scrollIntoViewIfNeeded();
  await wait(400);
  await main.screenshot({ path: path.join(SHOTS, 'settings-menubar-light.png') });
  await size(1024, 768);
  await wait(500);
  const narrow = await main.evaluate(() => { const el = document.querySelector('[data-testid="settings-menubar"]'); return el.scrollWidth <= el.clientWidth + 1; });
  check(narrow, 'Settings → Menu bar fits at 1024×768');
  await main.screenshot({ path: path.join(SHOTS, 'settings-menubar-1024-light.png') });
  await size(1440, 900);

  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await wait(600);
  await main.screenshot({ path: path.join(SHOTS, 'settings-menubar-dark.png') });
  const g2 = await open();
  await g2.waitForSelector('[data-testid="glance-card-storage"]', { timeout: 15_000 });
  await g2.waitForSelector('.gl-file', { timeout: 15_000 }).catch(() => undefined);
  await wait(2600);
  await settled();
  await noOverflow(g2, 'in dark');
  await g2.evaluate(() => document.activeElement?.blur());
  await g2.screenshot({ path: path.join(SHOTS, 'glance-dark.png') });
  const bg = await g2.evaluate(() => getComputedStyle(document.querySelector('.glance')).backgroundColor);
  check(/rgb\((\d+), (\d+), (\d+)\)/.test(bg) && Number(bg.match(/\d+/)[0]) < 80, `dark theme (${bg})`);

  // Reduced motion: nothing in it moves.
  await g2.emulateMedia({ reducedMotion: 'reduce' });
  const moving = await g2.evaluate(() => [...document.querySelectorAll('.glance, .glance *')].filter((e) => getComputedStyle(e).transitionDuration.split(',').map(parseFloat).some((x) => x > 0.01)).length);
  check(moving === 0, `no motion with reduced motion (${moving} moving)`);
  await main.evaluate(() => window.keeper.glance.close());

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));
  await app.close();
  process.exit(process.exitCode ?? 0);
})().catch((e) => { console.error(e); process.exit(1); });
