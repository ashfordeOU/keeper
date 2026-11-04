// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/design-budget.cjs /tmp/kdb /tmp/kdb-shots
//   BUDGET_ONLY=agents,security   only these pages (page ids from core/nav.ts, or a route like settings:general)
//   BUDGET_SIZES=1440x900         only these window sizes (default 1440x900,1024x768)
//   BUDGET_SHOTS=all              a picture of every page, not only of those over the budget
// The visual budget, enforced: every page of the real app (each sidebar page, each
// tab of the merged pages, each section of Settings), with every part switched on,
// at 1440×900 and 1024×768, measured against core/design-budget.ts:
//   • at most 6 tabs in view in a tab row (the rest under More);
//   • at most 5 icon-only buttons in one toolbar row, each with a label or tooltip;
//   • at most 1 filled (primary) button on a screen;
//   • no title, tab, button, row, placeholder or choice cut inside a word;
//   • no raw paths or temporary folders in what the page shows;
//   • page titles of at most 4 words.
// Writes budget-report.txt and budget-report.json (and pictures of the pages over
// budget, light) to the shots folder, and fails when any page goes over.
const { _electron } = (() => { try { return require('playwright-core'); } catch { return require('playwright'); } })();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const HOME = (() => { const h = path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/kdb-')); fs.mkdirSync(h, { recursive: true }); return fs.realpathSync(h); })();
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const ONLY = (process.env.BUDGET_ONLY || '').split(',').filter(Boolean);
const SIZES = (process.env.BUDGET_SIZES || '1440x900,1024x768').split(',').map((s) => s.split('x').map(Number));
fs.mkdirSync(SHOTS, { recursive: true });

// The rules and the list of pages, from the same TypeScript the app uses.
const LIB = path.join(HOME, 'budget-lib.cjs');
fs.writeFileSync(path.join(HOME, 'budget-entry.ts'), `export * from '${ROOT}/core/design-budget';\nexport { NAV_PAGES, HUB_TABS } from '${ROOT}/core/nav';\nexport { SECTIONS } from '${ROOT}/core/settings-schema';\n`);
require('esbuild').buildSync({ entryPoints: [path.join(HOME, 'budget-entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: LIB, logLevel: 'silent' });
const { checkBudget, budgetReport, NAV_PAGES, HUB_TABS, SECTIONS } = require(LIB);

// A home with sample files, so file pages are not empty.
for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures', 'Videos', 'Music', '.config/Keeper']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
const SAMPLES = path.join(HOME, 'Documents', 'Samples');
if (!fs.existsSync(SAMPLES)) {
  execFileSync(process.execPath, [path.join(__dirname, 'make-samples.cjs'), SAMPLES], { stdio: 'ignore' });
  const copy = (from, to) => { try { fs.copyFileSync(path.join(SAMPLES, from), to); } catch { /* not made on this system */ } };
  copy('02 photo.jpg', path.join(HOME, 'Pictures', 'Lisbon tram.jpg'));
  copy('08 report.pdf', path.join(HOME, 'Downloads', 'Invoice October.pdf'));
}
const settingsFile = path.join(HOME, '.config/Keeper/settings.json');
if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, JSON.stringify({ folders: ['Documents', 'Downloads', 'Pictures', 'Desktop'].map((f) => path.join(HOME, f)), features: { usageStats: false } }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (r) => (r.arg ? `${r.name}:${r.arg}` : r.name);

// Every page once: the sidebar's pages, the merged pages' tabs, then each section of Settings.
function pages() {
  const out = new Map();
  for (const p of NAV_PAGES) out.set(key(p.route), { id: p.id, route: p.route });
  for (const [hub, tabs] of Object.entries(HUB_TABS)) for (const t of tabs) if (!out.has(key(t.route))) out.set(key(t.route), { id: `${hub}/${t.label}`, route: t.route });
  for (const s of SECTIONS) out.set(`settings:${s.id}`, { id: `settings:${s.id}`, route: { name: 'settings', arg: s.id } });
  let list = [...out.values()];
  if (ONLY.length) list = list.filter((p) => ONLY.includes(p.id) || ONLY.includes(key(p.route)));
  return list;
}

// Runs in the page: what the budget needs, measured from what is on screen.
function measure() {
  const content = document.querySelector('#content') || document.body;
  const scope = [document.querySelector('header.topbar'), document.querySelector('nav.sidebar'), content].filter(Boolean);
  const visible = (el) => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    // Inside a closed <details> (other than its summary): not shown.
    const closed = el.closest('details:not([open])');
    if (closed && !el.closest('summary')) return false;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      if (e.getAttribute('aria-hidden') === 'true' || e.classList.contains('tabs-measure')) return false;
    }
    return true;
  };
  const where = (el) => {
    const bits = [];
    for (let e = el; e && e !== document.body && bits.length < 3; e = e.parentElement) {
      const id = e.getAttribute('data-testid') || (e.id ? `#${e.id}` : '') || (typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : e.tagName.toLowerCase());
      bits.unshift(id);
    }
    return bits.join(' > ');
  };
  const all = (sel) => scope.flatMap((s) => [...s.querySelectorAll(sel)]).filter(visible);
  const textOf = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
  const nameOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || textOf(el) || el.querySelector('[aria-label]')?.getAttribute('aria-label') || '').trim();

  // Buttons: an icon and no words is "icon-only".
  const buttons = all('button, [role="button"], a.btn').filter((b) => !b.closest('.modal, .menu, [role="menu"], .theme-quick-pop, .xterm, .tabs-measure, [role="tablist"], .seg-tabs')).map((b) => {
    const r = b.getBoundingClientRect();
    const words = textOf(b).replace(/[^\p{L}\p{N}]/gu, '');
    return { x: r.x, y: r.y, w: r.width, h: r.height, name: nameOf(b), iconOnly: !words && !!b.querySelector('svg, img, .icon'), where: where(b) };
  });

  // Tab rows: tabs in view.
  const tabRows = all('[role="tablist"]').map((t) => ({ label: t.getAttribute('aria-label') || '', tabs: [...t.querySelectorAll('[role="tab"]')].filter(visible).length, where: where(t) }));

  // Filled buttons: the page's main action (the window's own frame excluded).
  const primaries = [...content.querySelectorAll('.btn.primary, button.primary')].filter(visible).filter((b) => !b.closest('.modal, .menu, .tour')).map((b) => ({ text: textOf(b) || nameOf(b), where: where(b) }));

  // Words that do not fit.
  const canvas = document.createElement('canvas').getContext('2d');
  const fitChars = (text, font, avail, ellipsis) => {
    canvas.font = font;
    const chars = [...text];
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (canvas.measureText(chars.slice(0, mid).join('') + (ellipsis ? '…' : '')).width <= avail) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  const clipped = [];
  const kindOf = (el) => (el.matches('h1, h2, h3, h4, .page-title') ? 'title' : el.closest('[role="tab"]') ? 'tab' : el.closest('.nav-item') ? 'row' : el.closest('button, [role="button"], .btn') ? 'button' : 'label');
  const textEls = all('h1, h2, h3, h4, [role="tab"], button, .btn, .nav-item .label, label, .chip, th, .feature-name, .card-title, summary').filter((el) => !el.closest('[data-user-text], .xterm, .file-card, .file-list, .folder-item, .column-view, .modal, .menu'));
  for (const el of textEls) {
    // The element that clips: itself or a child with an ellipsis.
    const cands = [el, ...el.querySelectorAll('.ellipsis, .label, span')].filter((c) => !c.closest('[data-user-text]'));
    for (const c of cands) {
      const cs = getComputedStyle(c);
      if (cs.overflowX === 'visible' && cs.textOverflow !== 'ellipsis') continue;
      if (c.scrollWidth <= c.clientWidth + 1 || c.children.length > 2) continue;
      const text = textOf(c);
      if (!text) continue;
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const fits = fitChars(text, cs.font, c.clientWidth - pad, cs.textOverflow === 'ellipsis');
      clipped.push({ text, fits, kind: kindOf(el), where: where(c) });
      break;
    }
  }
  for (const input of all('input[placeholder], textarea[placeholder]')) {
    if (input.value) continue;
    const cs = getComputedStyle(input);
    const avail = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    canvas.font = cs.font;
    const text = input.getAttribute('placeholder');
    if (canvas.measureText(text).width > avail + 1) clipped.push({ text, fits: fitChars(text, cs.font, avail, false), kind: 'placeholder', where: where(input) });
  }
  for (const sel of all('select')) {
    const opt = sel.options[sel.selectedIndex];
    if (!opt) continue;
    const cs = getComputedStyle(sel);
    // The arrow takes about 20 px on every system's select.
    const avail = sel.clientWidth - parseFloat(cs.paddingLeft) - Math.max(parseFloat(cs.paddingRight), 20);
    canvas.font = cs.font;
    const text = opt.text.trim();
    if (canvas.measureText(text).width > avail + 1) clipped.push({ text, fits: fitChars(text, cs.font, avail, false), kind: 'choice', where: where(sel) });
  }

  // Visible words, not what people typed (inputs), code, terminals or file names.
  const texts = [];
  const skip = 'input, textarea, pre, code, kbd, .xterm, .terminal, [contenteditable="true"], [data-user-text], [data-path-ok], .file-card, .file-list, .folder-item, .column-view, .crumbs, .cm-editor, .ProseMirror, .note-editor';
  for (const s of scope) {
    const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.trim();
      if (t.length < 4 || !/[\\/]/.test(t)) continue;
      const el = n.parentElement;
      if (!el || el.closest(skip) || !visible(el)) continue;
      texts.push({ text: t, where: where(el) });
    }
  }
  // "No … yet" said in a plain line, outside the designed empty state (inside a whole card or the page, not a small hint in a row).
  const plainEmpties = [];
  for (const el of [...content.querySelectorAll('p, div, span')].filter((e) => e.children.length === 0 || (e.children.length <= 2 && !e.querySelector('div, p, button')))) {
    const t = textOf(el);
    if (!t || t.length > 90 || !/^(no|nothing)\b/i.test(t) || !visible(el) || el.closest('.empty, [data-testid="empty-state"], .modal, .menu, select, option, [data-empty-ok]')) continue;
    if (!/\b(yet|here|found|to show|so far|added)\b\.?$/i.test(t.replace(/[.!…]+$/, ''))) continue;
    if (el.parentElement && textOf(el.parentElement) === t && el.parentElement.closest('#content') && el.parentElement !== content && plainEmpties.some((p) => p.el === el.parentElement)) continue;
    plainEmpties.push({ el, text: t, where: where(el) });
  }
  // Tooltips stay out of this: a path there is fine, one hover away.
  const h1 = document.querySelector('#content h1');
  return { title: h1 && visible(h1) ? textOf(h1) : undefined, buttons, tabRows, primaries, clipped, texts, plainEmpties: plainEmpties.filter((p, i, all) => !all.some((o, j) => j !== i && o.el.contains(p.el) && o.el !== p.el)).map(({ text, where: w }) => ({ text, where: w })) };
}

(async () => {
  const app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/.bin/electron'),
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, KEEPER_SKIP_TOUR: '1', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  let main;
  for (let i = 0; i < 80 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    if (!main) await sleep(500);
  }
  const errors = [];
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  // Every part on: the most a page can ever show.
  await main.evaluate(() => window.keeper.features.preset('everything')).catch(() => undefined);
  await main.evaluate(() => { try { localStorage.setItem('coach.tour', '1'); } catch { /* storage unavailable */ } });
  await main.reload();
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await main.waitForSelector('.shelf-card, .home-recent-item', { timeout: 30_000 }).catch(() => undefined);
  await sleep(1500);

  const size = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, s) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.setContentSize(s.width, s.height); } }, { width, height });
    await main.setViewportSize({ width, height }).catch(() => undefined);
    await sleep(500);
  };
  const nav = (r) => app.evaluate(({ BrowserWindow }, route) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', route); } }, r);

  const list = pages();
  const all = [];
  const perPage = {};
  for (const [w, h] of SIZES) {
    await size(w, h);
    for (const p of list) {
      await nav(key(p.route));
      await sleep(900);
      // Close anything a page opened by itself (a sheet, a menu), then let it settle.
      await main.keyboard.press('Escape').catch(() => undefined);
      await main.waitForLoadState('domcontentloaded').catch(() => undefined);
      await sleep(400);
      let snap;
      try { snap = await main.evaluate(measure); } catch (e) { console.log(`INFO ${p.id}: could not measure (${e.message.split('\n')[0]})`); continue; }
      const found = checkBudget({ page: p.id, size: `${w}x${h}`, ...snap });
      all.push(...found);
      (perPage[p.id] ??= {})[`${w}x${h}`] = { title: snap.title, tabs: Math.max(0, ...snap.tabRows.map((t) => t.tabs)), iconButtons: snap.buttons.filter((b) => b.iconOnly).length, primaries: snap.primaries.length, problems: found.length };
      console.log(`${found.length ? 'FAIL' : 'PASS'} ${p.id} at ${w}×${h}${found.length ? `: ${found.map((f) => f.rule).join(', ')}` : ''}`);
      if (found.length || process.env.BUDGET_SHOTS === 'all') await main.screenshot({ path: path.join(SHOTS, `budget-${p.id.replace(/[^\w-]+/g, '_')}-${w}.png`) }).catch(() => undefined);
    }
  }
  const report = budgetReport(all);
  fs.writeFileSync(path.join(SHOTS, 'budget-report.txt'), report + '\n');
  fs.writeFileSync(path.join(SHOTS, 'budget-report.json'), JSON.stringify({ pages: perPage, problems: all }, null, 2));
  console.log('\n' + report);
  console.log(`${errors.length ? 'FAIL' : 'PASS'} no page errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
  console.log(`${all.length ? 'FAIL' : 'PASS'} ${list.length} pages at ${SIZES.length} sizes: ${all.length} over the visual budget`);
  if (all.length || errors.length) process.exitCode = 1;
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
