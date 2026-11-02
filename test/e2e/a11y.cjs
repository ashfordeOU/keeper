// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/a11y.cjs /tmp/ka11y /tmp/ka11y-shots
// Accessibility check of the real Keeper app. Visits every page, the Island,
// the command palette, Quick Look, the settings sections and dialogs, in light
// and dark, and runs a compact in-page checker (names, roles, ARIA, contrast,
// focusability, images). Fails on any serious or critical issue. Also checks
// the keyboard: skip link, focus trapping and return, menus, the file grid,
// sidebar sections, and the Accessibility settings (motion, text size, focus).
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(process.argv[2] || '/tmp/ka11y');
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const ROOT = path.resolve(__dirname, '../..');
const VERBOSE = process.env.A11Y_VERBOSE === '1';
let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) { failed++; process.exitCode = 1; } };
const note = (label) => console.log(`NOTE ${label}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(step); } return null; };

fs.rmSync(HOME, { recursive: true, force: true });
for (const d of ['Downloads', 'Desktop', 'Documents', 'Pictures', 'Music', 'Movies', '.config']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
// A few files so the grid, list, Quick Look and menus have something to show.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHElEQVR4nGP8z8Dwn4EIwESMolGFowpHFdJPIQDA3wMd5rJNfwAAAABJRU5ErkJggg==', 'base64');
const FILES = ['alpha.txt', 'beta notes.md', 'gamma.png', 'delta.txt', 'echo.png'];
for (const f of FILES) fs.writeFileSync(path.join(HOME, 'Documents', f), f.endsWith('.png') ? PNG : `Some text in ${f}\n`);

// Every page in the sidebar (src/state.tsx RouteName), plus a few with an argument.
const ROUTES = [
  'home', 'recents', 'library:image', 'screenshots', `browse:${HOME}/Documents`, 'downloads', 'search', 'duplicates', 'cleanup', 'space', 'large',
  'startup', 'apps', 'protection', 'rules', 'history', 'assistant', 'island', 'settings', 'settings:accessibility', 'tools', 'health', 'capture',
  'convert', 'widgets', 'ambience', 'weather', 'network', 'trash', 'remote', 'terminal', 'sync:folders', 'sync:backups', 'devices', 'netactivity',
  'vpn', 'firewall', 'agents', 'graph', 'mail', 'calendar', 'reminders', 'alarms', 'todo', 'awake', 'stage', 'controls', 'catalog',
  'appcontrols', 'browsers', 'noteshub', 'notes', 'rdc', 'mesh', 'tracks', 'cues', 'dictation', 'meetings', 'studio',
];

// ------------------------------------------------------------------ the in-page checker

/* eslint-disable */
function audit(scope) {
  const issues = [];
  const root = scope ? document.querySelector(scope) : document.body;
  if (!root) return issues;
  const add = (rule, impact, el, msg) => {
    const id = el ? (el.id ? `#${el.id}` : '') : '';
    const cls = el && typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).map((c) => `.${c}`).join('') : '';
    const text = el ? (el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) : '';
    issues.push({ rule, impact, where: el ? `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}` : '', msg });
  };
  const hidden = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (e.getAttribute('aria-hidden') === 'true' || e.hasAttribute('inert')) return true;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    }
    return false;
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !hidden(el); };
  const textOf = (el) => {
    let t = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) t += n.textContent;
      else if (n.nodeType === 1) {
        if (n.getAttribute('aria-hidden') === 'true') continue;
        if (n.tagName === 'IMG') t += n.getAttribute('alt') || '';
        else if (n.tagName === 'svg' || n.tagName === 'SVG') t += n.getAttribute('aria-label') || '';
        else t += n.getAttribute('aria-label') || textOf(n);
      }
    }
    return t;
  };
  const byIds = (ids) => ids.split(/\s+/).map((i) => document.getElementById(i)).filter(Boolean);
  const nameOf = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = byIds(lb).map((x) => textOf(x)).join(' ').trim(); if (t) return t; }
    const al = (el.getAttribute('aria-label') || '').trim();
    if (al) return al;
    if (el.matches('input, select, textarea')) {
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && textOf(l).trim()) return textOf(l).trim(); }
      const wrap = el.closest('label'); if (wrap && textOf(wrap).trim()) return textOf(wrap).trim();
      if (el.matches('input[type=button], input[type=submit]') && el.value) return el.value;
      if (el.getAttribute('placeholder')) return el.getAttribute('placeholder');
    }
    if (el.tagName === 'IMG') return el.getAttribute('alt') || '';
    const t = textOf(el).trim();
    if (t) return t;
    return (el.getAttribute('title') || '').trim();
  };

  const ROLES = new Set('alert alertdialog application article banner button cell checkbox columnheader combobox complementary contentinfo definition dialog directory document feed figure form grid gridcell group heading img link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status switch tab table tablist tabpanel term textbox timer toolbar tooltip tree treegrid treeitem'.split(' '));
  const PARENT = { tab: ['tablist'], option: ['listbox', 'group'], menuitem: ['menu', 'menubar', 'group'], menuitemcheckbox: ['menu', 'menubar', 'group'], menuitemradio: ['menu', 'menubar', 'group'], treeitem: ['tree', 'group'], row: ['table', 'grid', 'treegrid', 'rowgroup'], gridcell: ['row'], listitem: ['list', 'group'] };
  const STATE = { switch: 'aria-checked', checkbox: 'aria-checked', radio: 'aria-checked', slider: 'aria-valuenow', combobox: 'aria-expanded', scrollbar: 'aria-valuenow' };
  const interactiveSel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=option], [role=menuitem], [role=slider], [role=combobox], [role=treeitem], [tabindex]:not([tabindex="-1"])';

  for (const el of root.querySelectorAll('*')) {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue;
    const role = el.getAttribute('role');
    if (role) {
      for (const r of role.split(/\s+/).slice(0, 1)) if (!ROLES.has(r)) add('aria-roles', 'serious', el, `unknown role "${r}"`);
      const need = STATE[role];
      if (need && !el.hasAttribute(need) && !(role === 'checkbox' && el.matches('input'))) add('aria-required-attr', 'critical', el, `role=${role} needs ${need}`);
      const parents = PARENT[role];
      if (parents && !hidden(el)) {
        let p = el.parentElement; let ok = false;
        while (p) { const pr = p.getAttribute('role'); if (pr && pr !== 'presentation' && pr !== 'none' && pr !== 'generic') { ok = parents.includes(pr) || (role === 'row' && ['table'].includes(p.tagName.toLowerCase())); break; } if (role === 'row' && /^(TABLE|TBODY|THEAD)$/.test(p.tagName)) { ok = true; break; } p = p.parentElement; }
        if (!ok) add('aria-required-parent', 'critical', el, `role=${role} must be inside ${parents.join('/')}`);
      }
      if (role === 'tablist' && !el.querySelector('[role=tab]') && visible(el)) add('aria-required-children', 'critical', el, 'tablist has no tabs');
    }
    for (const a of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-activedescendant']) {
      const v = el.getAttribute(a);
      if (v && !hidden(el) && byIds(v).length === 0) add('aria-valid-attr-value', 'serious', el, `${a} points at no element`);
    }
    if (el.getAttribute('tabindex') && Number(el.getAttribute('tabindex')) > 0) add('tabindex', 'serious', el, 'tabindex above 0');
    if (!visible(el)) {
      // Focusable but hidden from screen readers.
      if (el.closest('[aria-hidden="true"]') && el.matches(interactiveSel) && !el.matches('[tabindex="-1"], :disabled') && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden') add('aria-hidden-focus', 'serious', el, 'focusable element inside aria-hidden');
      continue;
    }
    // Names.
    if (el.matches('button, [role=button], a[href], [role=link], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=option], [role=menuitem], [role=slider], [role=treeitem], [role=combobox]') || el.matches('input:not([type=hidden]):not([type=button]):not([type=submit]), select, textarea')) {
      const n = nameOf(el);
      if (!n) add(el.matches('input, select, textarea') ? 'label' : 'button-name', 'critical', el, `no accessible name (in: ${(el.closest('.setting, .row, li, label, .card, section') || el.parentElement)?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60)})`);
      else if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !textOf(el).trim() && el.getAttribute('title') && el.matches('button, [role=button]')) add('title-only-name', 'moderate', el, 'named only by title');
      else if (el.matches('input, select, textarea') && n === el.getAttribute('placeholder') && !el.getAttribute('aria-label')) add('placeholder-only-label', 'moderate', el, 'named only by placeholder');
    }
    // Nested interactive controls.
    if (el.matches('button, a[href]') && el.parentElement?.closest('button, a[href]')) add('nested-interactive', 'serious', el, 'interactive element inside another');
    // Images and canvases.
    if (el.tagName === 'IMG' && !el.hasAttribute('alt') && el.getAttribute('role') !== 'presentation') add('image-alt', 'critical', el, 'img without alt');
    if (el.tagName === 'CANVAS' && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && el.getAttribute('role') !== 'presentation' && !el.closest('.xterm')) add('canvas-name', 'moderate', el, 'canvas without a label or aria-hidden');
    if (el.matches('svg[role=img]') && !el.getAttribute('aria-label') && !el.querySelector('title')) add('svg-img-alt', 'serious', el, 'svg role=img without a name');
    // Clickable but not reachable with the keyboard (React handler on a plain element).
    if (/^(DIV|SPAN|LI|TD|TR|IMG|I|B|SECTION|ARTICLE|P|LABEL|H\d)$/.test(el.tagName) && !el.matches(interactiveSel) && !el.closest('button, a[href], label, [role=button], [role=option], [role=tab], [role=menuitem], [role=row]')) {
      const k = Object.keys(el).find((x) => x.startsWith('__reactProps$'));
      const p = k ? el[k] : null;
      if (p && typeof p.onClick === 'function' && !p.onKeyDown && !el.querySelector(interactiveSel) && !el.matches('.modal-back, .palette-back, .ql, .ring-overlay, .nt-overlay') && getComputedStyle(el).cursor === 'pointer') add('click-not-focusable', 'serious', el, 'clickable without keyboard access');
    }
  }

  // Duplicate ids that ARIA refers to.
  const seen = new Map();
  for (const el of document.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) || 0) + 1);
  for (const el of root.querySelectorAll('[aria-labelledby], [aria-controls], [aria-activedescendant]')) {
    for (const a of ['aria-labelledby', 'aria-controls', 'aria-activedescendant']) for (const id of (el.getAttribute(a) || '').split(/\s+/).filter(Boolean)) if ((seen.get(id) || 0) > 1) add('duplicate-id-aria', 'critical', el, `id "${id}" is not unique`);
  }

  // Contrast of visible text.
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/gradient\(.*transparent/.test(cs.backgroundImage)) return null; // a picture or gradient: unknown
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      if (cs.backdropFilter && cs.backdropFilter !== 'none') return null;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    const bodyBg = parse(getComputedStyle(document.body).backgroundColor);
    if (bodyBg && bodyBg.a >= 1) base = bodyBg;
    // The Island draws its own surface (a clipped shape behind the content): that is the background.
    if (document.documentElement.dataset.view === 'island') {
      const probe = document.createElement('i'); probe.style.color = 'var(--island-bg)'; document.body.appendChild(probe);
      const ib = parse(getComputedStyle(probe).color); probe.remove(); if (ib) base = ib;
    }
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const done = new Set();
  let n;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    if (!el || done.has(el) || !n.textContent.trim()) continue;
    done.add(el);
    if (!visible(el) || el.closest('button:disabled, [aria-disabled=true], .xterm, svg, canvas, video, .sr-only, [data-a11y-skip-contrast]')) continue;
    const cs = getComputedStyle(el);
    if (cs.textShadow && cs.textShadow !== 'none' && /\d+px \d+px [1-9]/.test(cs.textShadow) && false) continue;
    let fg = parse(cs.color); if (!fg) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    if (op < 0.1) continue;
    const bg = bgOf(el); if (!bg) continue;
    fg = over({ ...fg, a: fg.a * op }, bg);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const min = large ? 3 : 4.5;
    // Very faint hints (≤ 4:1 but over 3:1) are moderate; real unreadables are serious.
    if (ratio < min) add('color-contrast', ratio < (large ? 2.5 : 3.5) || ratio < min - 0.5 ? 'serious' : 'moderate', el, `${ratio.toFixed(2)}:1 (needs ${min}) ${cs.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})${op < 1 ? ` at opacity ${op.toFixed(2)}` : ''}`);
  }

  // Landmarks (main window only).
  if (!scope && document.documentElement.dataset.view === 'app') {
    if (!document.querySelector('main, [role=main]')) add('landmark-main', 'moderate', null, 'no main landmark');
    if (!document.querySelector('nav, [role=navigation]')) add('landmark-nav', 'moderate', null, 'no navigation landmark');
  }
  return issues;
}
/* eslint-enable */

// ------------------------------------------------------------------ driving the app

(async () => {
  const ENV = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: path.join(HOME, '.config'), XDG_DATA_HOME: path.join(HOME, '.local/share') };
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: ENV });
  let w; let isl;
  for (let i = 0; i < 80 && !(w && isl); i++) {
    w = app.windows().find((x) => x.url().includes('view=app'));
    isl = app.windows().find((x) => x.url().includes('view=island'));
    if (!(w && isl)) await wait(400);
  }
  check(!!w, 'the main window opens');
  const errors = [];
  w.on('pageerror', (e) => errors.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await w.waitForSelector('.sidebar', { timeout: 60000 });
  await w.waitForTimeout(2000);
  const skipTour = await w.$('.tour button:has-text("Skip tour")');
  if (skipTour) await skipTour.click();
  const nav = (r) => app.evaluate(({ BrowserWindow }, r) => { for (const x of BrowserWindow.getAllWindows()) if (x.webContents.getURL().includes('view=app')) x.webContents.send('event:navigate', r); }, r);
  const set = (patch) => w.evaluate((p) => window.keeper.settings.set(p), patch);
  const closeAll = async () => { for (let i = 0; i < 3; i++) { await w.keyboard.press('Escape'); await w.waitForTimeout(80); } };

  const all = []; // { mode, where, rule, impact, el, msg }
  const run = async (page, mode, where, scope) => {
    const found = await page.evaluate(audit, scope ?? null).catch((e) => [{ rule: 'checker-error', impact: 'moderate', where: '', msg: String(e).slice(0, 200) }]);
    for (const f of found) all.push({ mode, page: where, ...f });
    return found;
  };

  for (const mode of ['light', 'dark']) {
    await set({ appearance: mode });
    await w.waitForTimeout(400);
    // ------------------------------------------------ pages
    for (const r of ROUTES) {
      await nav(r);
      await w.waitForTimeout(r === 'settings' || r === 'tracks' || r === 'terminal' ? 1600 : 700);
      await closeAll();
      await run(w, mode, `page ${r.startsWith('browse:') ? 'browse' : r}`);
    }
    // ------------------------------------------------ the command palette
    await nav('home');
    await w.waitForTimeout(500);
    await w.keyboard.press('Control+k');
    await w.waitForSelector('.palette', { timeout: 5000 }).catch(() => undefined);
    await w.waitForTimeout(500); // let it finish fading in
    await run(w, mode, 'palette');
    await w.keyboard.press('Escape');
    // ------------------------------------------------ files: grid, list, menu, rename dialog, Quick Look
    await nav(`browse:${HOME}/Documents`);
    await w.waitForSelector('.file-card, .file-list tbody tr', { timeout: 15000 }).catch(() => undefined);
    await w.waitForTimeout(800);
    const first = w.locator('.file-card, .file-list tbody tr').first();
    if (await first.count()) {
      await first.click({ button: 'right' });
      await w.waitForSelector('.menu', { timeout: 4000 }).catch(() => undefined);
      await run(w, mode, 'file context menu', '.menu');
      const rename = w.locator('.menu [role=menuitem]', { hasText: 'Rename' }).first();
      if (await rename.count()) {
        await rename.click();
        await w.waitForSelector('.modal', { timeout: 4000 }).catch(() => undefined);
        await w.waitForTimeout(300);
        await run(w, mode, 'rename dialog', '.modal');
        await w.keyboard.press('Escape');
      }
      await first.click();
      await w.keyboard.press('Space');
      if (await w.waitForSelector('.ql', { timeout: 6000 }).catch(() => null)) {
        await w.waitForTimeout(800);
        await run(w, mode, 'Quick Look', '.ql');
        await w.keyboard.press('Escape');
      }
      await w.keyboard.press('Control+2');
      await w.waitForTimeout(400);
      await run(w, mode, 'file list', '.content');
      await w.keyboard.press('Control+1');
    }
    // ------------------------------------------------ settings sections and a settings dialog
    await nav('settings');
    await w.waitForTimeout(1200);
    const sections = await w.$$eval('.content h2[id]', (h) => h.map((x) => x.id));
    for (const id of sections) {
      await nav(`settings:${id}`);
      await w.waitForTimeout(250);
    }
    note(`${mode}: ${sections.length} settings sections checked with the settings page`);
    // ------------------------------------------------ the Island (compact and open)
    if (isl) {
      await run(isl, mode, 'Island (compact)');
      await isl.locator('.isl').first().click().catch(() => undefined);
      await isl.waitForTimeout(900);
      await run(isl, mode, 'Island (open)');
      await isl.mouse.move(1, 400).catch(() => undefined);
    }
    await w.screenshot({ path: path.join(SHOTS, `a11y-${mode}.png`) });
  }

  // ------------------------------------------------------------------ results
  const serious = all.filter((x) => x.impact === 'serious' || x.impact === 'critical');
  const byRule = {};
  for (const x of all) byRule[`${x.impact} ${x.rule}`] = (byRule[`${x.impact} ${x.rule}`] || 0) + 1;
  console.log('Issues by rule:', JSON.stringify(byRule, null, 1));
  const uniq = new Map();
  for (const x of serious) { const k = `${x.rule}|${x.where}|${x.msg}`; if (!uniq.has(k)) uniq.set(k, x); }
  for (const x of [...uniq.values()].slice(0, VERBOSE ? 1000 : 60)) console.log(`  ${x.impact.padEnd(8)} ${x.rule.padEnd(22)} ${x.mode.padEnd(5)} ${x.page.padEnd(22)} ${x.where} — ${x.msg}`);
  fs.writeFileSync(path.join(SHOTS, 'a11y-issues.json'), JSON.stringify(all, null, 1));
  check(serious.length === 0, `no serious or critical accessibility issues (${serious.length} found, ${uniq.size} distinct; ${all.length - serious.length} moderate)`);

  // ------------------------------------------------------------------ keyboard
  await set({ appearance: 'light' });
  await nav('home');
  await w.waitForTimeout(600);
  // A fresh page, as when the window opens: the first Tab starts at the top.
  await w.reload();
  await w.waitForSelector('.sidebar', { timeout: 30000 });
  await w.waitForTimeout(1500);
  await w.keyboard.press('Tab');
  const firstTab = await w.evaluate(() => document.activeElement?.outerHTML.slice(0, 90));
  check(/skip-link/.test(firstTab || ''), `Tab first reaches “Skip to content” (${firstTab})`);
  await w.keyboard.press('Enter');
  check(await w.evaluate(() => document.activeElement?.id === 'content'), 'the skip link moves focus to the page');
  check(await w.evaluate(() => !!document.querySelector('nav.sidebar[aria-label]') && !!document.querySelector('main') && !!document.querySelector('[aria-current="page"]')), 'landmarks: sidebar nav, main, and the current page marked');
  // Focus rings: visible outline in the theme's accent.
  const ring = await w.evaluate(() => { const b = document.querySelector('.topbar button:not([disabled])'); b.focus(); const cs = getComputedStyle(b); return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), matches: b.matches(':focus-visible') }; });
  check(ring.style !== 'none' && parseFloat(ring.width) >= 2, `a visible focus ring after keyboard focus (${ring.style} ${ring.width} ${ring.color}, accent ${ring.accent})`);
  // Palette: opens, arrow keys move the active option, Esc closes and focus returns.
  await w.evaluate(() => document.querySelector('.topbar button:not([disabled])')?.focus());
  const before = await w.evaluate(() => document.activeElement?.outerHTML.slice(0, 80));
  await w.keyboard.press('Control+k');
  await w.waitForSelector('.palette', { timeout: 4000 });
  const a1 = await w.getAttribute('.palette input', 'aria-activedescendant');
  await w.keyboard.press('ArrowDown');
  const a2 = await w.getAttribute('.palette input', 'aria-activedescendant');
  check(a1 !== a2 && !!a2, `palette: arrow keys move the active option (${a1} → ${a2})`);
  for (let i = 0; i < 4; i++) await w.keyboard.press('Tab');
  check(await w.evaluate(() => !!document.activeElement?.closest('.palette')), 'palette: Tab stays inside it');
  await w.keyboard.press('Escape');
  await w.waitForTimeout(200);
  check(await w.evaluate(() => !document.querySelector('.palette')) && (await w.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))) === before, 'palette: Esc closes it and focus goes back');
  // File grid: focus, arrows, type-to-select, context menu from the keyboard, and the rename dialog's focus trap.
  await nav(`browse:${HOME}/Documents`);
  await w.waitForSelector('.file-card', { timeout: 15000 }).catch(() => undefined);
  await w.waitForTimeout(600);
  const cards = await w.locator('.file-card').count();
  if (cards >= 3) {
    await w.evaluate(() => document.querySelector('.file-card[tabindex="0"]')?.focus());
    await w.keyboard.press('ArrowRight');
    await w.waitForTimeout(150);
    const sel1 = await w.evaluate(() => document.activeElement?.getAttribute('data-path'));
    check(!!sel1 && (await w.evaluate(() => document.activeElement?.getAttribute('aria-selected'))) === 'true', `file grid: arrow keys move focus and selection (${sel1 && path.basename(sel1)})`);
    await w.keyboard.press('g');
    await w.waitForTimeout(150);
    const sel2 = await w.evaluate(() => document.activeElement?.getAttribute('data-path'));
    check(!!sel2 && path.basename(sel2).startsWith('g'), `file grid: typing “g” selects ${sel2 && path.basename(sel2)}`);
    await w.keyboard.press('Shift+F10');
    const menu = await w.waitForSelector('.menu[role=menu]', { timeout: 3000 }).catch(() => null);
    check(!!menu, 'file grid: Shift+F10 opens the context menu');
    if (menu) {
      const f1 = await w.evaluate(() => document.activeElement?.textContent);
      await w.keyboard.press('ArrowDown');
      const f2 = await w.evaluate(() => document.activeElement?.textContent);
      check(f1 !== f2 && (await w.evaluate(() => document.activeElement?.getAttribute('role'))) === 'menuitem', `context menu: arrow keys move between items (${f1} → ${f2})`);
      await w.keyboard.press('r');
      const f3 = await w.evaluate(() => document.activeElement?.textContent || '');
      check(/^R/.test(f3), `context menu: a letter jumps to an item (${f3})`);
      await w.keyboard.press('Enter');
      const dlg = await w.waitForSelector('.modal[role=dialog][aria-modal=true]', { timeout: 3000 }).catch(() => null);
      check(!!dlg, 'Rename opens a dialog with role=dialog and aria-modal');
      if (dlg) {
        for (let i = 0; i < 12; i++) await w.keyboard.press('Tab');
        check(await w.evaluate(() => !!document.activeElement?.closest('.modal')), 'dialog: Tab stays inside it');
        await w.keyboard.press('Escape');
        await w.waitForTimeout(200);
        check(await w.evaluate(() => !document.querySelector('.modal') && !!document.activeElement?.closest('.file-grid')), 'dialog: Esc closes it and focus goes back to the file');
      }
    }
  } else note(`only ${cards} file cards; grid keyboard checks skipped`);
  // Sidebar sections: Enter and Space open and close them. (Automated runs keep every section
  // open unless they opt in to folding, as a person sees it.)
  await w.evaluate(() => localStorage.setItem('sidebar.compactInTests', '1'));
  await w.reload();
  await w.waitForSelector('.sidebar', { timeout: 30000 });
  await w.waitForTimeout(800);
  const sec = w.locator('.sidebar button.nav-title').first();
  await sec.focus();
  const e1 = await sec.getAttribute('aria-expanded');
  await w.keyboard.press('Enter');
  await w.waitForTimeout(150);
  const e2 = await sec.getAttribute('aria-expanded');
  await w.keyboard.press(' ');
  await w.waitForTimeout(150);
  const e3 = await sec.getAttribute('aria-expanded');
  check(e1 !== e2 && e3 === e1, `sidebar sections toggle with Enter and Space (${e1} → ${e2} → ${e3})`);
  await w.evaluate(() => { localStorage.removeItem('sidebar.compactInTests'); localStorage.removeItem('sidebar.opened'); });
  await w.reload();
  await w.waitForSelector('.sidebar', { timeout: 30000 });
  await w.waitForTimeout(800);
  // Tabs: arrow keys (any role=tablist on a page).
  await nav('settings');
  await w.waitForTimeout(1200);
  const tab = w.locator('[role=tablist] [role=tab]').first();
  if (await tab.count()) {
    await tab.focus();
    await w.keyboard.press('ArrowRight');
    check(await w.evaluate(() => document.activeElement?.getAttribute('role') === 'tab' && document.activeElement?.getAttribute('aria-selected') === 'true'), 'tabs: arrow keys move to and select the next tab');
  } else note('no tab list on the settings page');

  // ------------------------------------------------------------------ Settings → Accessibility
  await nav('settings:accessibility');
  await w.waitForTimeout(800);
  check(await w.locator('#accessibility').count() === 1 && await w.locator('[role=radiogroup][aria-label="Reduce motion"]').count() === 1, 'Settings has an Accessibility section');
  await w.locator('[role=radiogroup][aria-label="Reduce motion"] [role=radio]', { hasText: 'On' }).click();
  await w.waitForTimeout(300);
  const motion = await w.evaluate(() => ({ attr: document.documentElement.dataset.motion, dur: getComputedStyle(document.querySelector('.nav-chevron') || document.body).transitionDuration }));
  check(motion.attr === 'reduce' && /^(0s|1e-0\ds|0\.000001s)/.test(motion.dur), `reduce motion: on (data-motion=${motion.attr}, transitions ${motion.dur})`);
  if (isl) check(await isl.evaluate(() => document.documentElement.dataset.motion) === 'reduce', 'reduce motion reaches the Island window');
  await w.locator('[role=radiogroup][aria-label="Text size"] [role=radio]', { hasText: '125%' }).click();
  await w.waitForTimeout(400);
  const scale = await w.evaluate(() => ({ zoom: getComputedStyle(document.getElementById('root')).zoom, fits: document.documentElement.scrollHeight <= innerHeight + 1 && document.querySelector('.shell').getBoundingClientRect().bottom <= innerHeight + 1 }));
  check(String(scale.zoom) === '1.25' && scale.fits, `larger text: 125% (zoom ${scale.zoom}, window still fits: ${scale.fits})`);
  await w.screenshot({ path: path.join(SHOTS, 'a11y-text-125.png') });
  const sw = w.locator('[role=switch][aria-label="Always show focus outlines"]');
  await sw.click();
  await w.waitForTimeout(300);
  const always = await w.evaluate(() => { const b = document.querySelector('[role=switch][aria-label="Always show focus outlines"]'); return { attr: document.documentElement.dataset.focusAlways, outline: getComputedStyle(b).outlineStyle }; });
  check(always.attr === 'true' && always.outline !== 'none', `always show focus outlines: a clicked control shows its ring (${always.outline})`);
  await set({ a11y: { motion: 'system', textScale: 1, focusAlways: false } });
  await w.waitForTimeout(300);

  // ------------------------------------------------------------------ system settings
  // Wait for the change rather than a fixed time: on a busy machine the media-query event can take a while.
  const motionIs = (v) => w.waitForFunction((x) => document.documentElement.dataset.motion === x, v, { timeout: 3000 }).then(() => true, () => false);
  await w.emulateMedia({ reducedMotion: 'reduce' });
  check(await motionIs('reduce'), 'reduce motion follows the system setting');
  await w.emulateMedia({ reducedMotion: 'no-preference' });
  check(await motionIs('system'), 'and animates again when the system does');
  await w.emulateMedia({ forcedColors: 'active' });
  await w.waitForTimeout(300);
  await w.evaluate(() => document.querySelector('.topbar button:not([disabled])')?.focus());
  await w.keyboard.press('Tab');
  const forced = await w.evaluate(() => {
    const on = document.querySelector('.toggle.on'); const off = document.querySelector('.toggle:not(.on)');
    const b = document.activeElement;
    return { on: on && getComputedStyle(on).backgroundColor, off: off && getComputedStyle(off).backgroundColor, offBorder: off && getComputedStyle(off).borderTopStyle, ring: b && getComputedStyle(b).outlineStyle };
  });
  check(!!forced.on && forced.on !== forced.off && forced.offBorder !== 'none' && forced.ring !== 'none', `forced colours: switches stay visible on and off, focus ring kept (${JSON.stringify(forced)})`);
  await w.emulateMedia({ forcedColors: 'none' });

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await app.close();
  console.log(failed ? `${failed} check(s) failed` : 'all accessibility checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
