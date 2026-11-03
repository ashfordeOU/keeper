// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage: NODE_PATH=/opt/node22/lib/node_modules node test/e2e/site-layout.cjs [builtSiteDir] [shotsDir] [--schemes light,dark] [--widths 1440,1024,768,390]
// Measures the website's layout in Chromium at each width and color scheme, with motion
// reduced so every part sits where it ends up:
//   - one container: every .wrap has the same content edges, and nothing spills past them
//     (except inside a box that scrolls or clips, which is checked itself);
//   - centered blocks are truly centered (equal space left and right, within 2px), both the
//     box in its parent and what's inside it;
//   - cards in a row are the same height and width, and no grid leaves one card alone on its
//     last row;
//   - the alternating spotlights mirror (same text and picture widths, same gap, both halves
//     vertically centered), and section heads sit the same distance above their content;
//   - radii, icon chips and button heights come from one small set;
//   - no sideways scrolling, and the animated devices settle into place.
// Without a site directory it builds one (node site/build.mjs --out <tmp>). Fails on any problem.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const SCHEMES = opt('--schemes', 'light,dark').split(',');
const WIDTHS = opt('--widths', '1440,1024,768,390').split(',').map(Number);
let [DIR, SHOTS] = args;
let tmp = '';
if (!DIR) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-site-layout-'));
  DIR = path.join(tmp, 'site');
  execFileSync(process.execPath, [path.join(ROOT, 'site/build.mjs'), '--out', DIR], { stdio: 'pipe' });
}
DIR = path.resolve(DIR);
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const PAGES = ['home', 'features', 'download', 'monorail', 'privacy', 'support', 'changelog'];
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain', '.xml': 'text/xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DIR, p);
  if (!f.startsWith(DIR) || !fs.existsSync(f)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

// ------------------------------------------------------------------ the in-page measurer
// Runs in the page; returns a list of problems as plain strings.
function measure() {
  const TOL = 2;
  const out = [];
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const name = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    const sec = el.closest('section[id], [id]');
    return `${el.tagName.toLowerCase()}${id}${cls}${sec && sec !== el ? ` in #${sec.id}` : ''}`;
  };
  const px = (v) => parseFloat(v) || 0;
  const contentBox = (el) => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return { left: r.left + px(s.borderLeftWidth) + px(s.paddingLeft), right: r.right - px(s.borderRightWidth) - px(s.paddingRight), top: r.top, bottom: r.bottom, width: r.width };
  };

  // No sideways scrolling.
  if (document.documentElement.scrollWidth > innerWidth) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth})`);

  // One container: every .wrap's content edges match the header's.
  const wraps = [...document.querySelectorAll('.wrap')].filter(visible);
  const ref = contentBox(document.querySelector('header.top .wrap'));
  for (const w of wraps) {
    const b = contentBox(w);
    if (Math.abs(b.left - ref.left) > TOL || Math.abs(b.right - ref.right) > TOL) out.push(`container edges differ: ${name(w)} ${b.left.toFixed(0)}–${b.right.toFixed(0)} vs ${ref.left.toFixed(0)}–${ref.right.toFixed(0)}`);
  }

  // Nothing spills out of the container (things inside a scrolling or clipping box are that box's business).
  const BLEED = ['.feat-nav', '.skip', '.sr', 'header.top .links'];
  const clips = (el) => { const s = getComputedStyle(el); return s.overflowX !== 'visible' || s.overflowY !== 'visible'; };
  const walk = (el, box) => {
    for (const c of el.children) {
      if (!visible(c) || BLEED.some((sel) => c.matches(sel))) continue;
      const s = getComputedStyle(c);
      if (s.position === 'fixed' || s.position === 'absolute' && c.closest('.isl-stage, .laptop, .monitor, .mac, .compare, .hero-visual')) continue;
      const r = c.getBoundingClientRect();
      if (r.left < box.left - TOL || r.right > box.right + TOL) out.push(`spills out of the container: ${name(c)} ${r.left.toFixed(0)}–${r.right.toFixed(0)} vs ${box.left.toFixed(0)}–${box.right.toFixed(0)}`);
      else if (!clips(c) && c.tagName !== 'svg') walk(c, box);
    }
  };
  for (const w of wraps) walk(w, contentBox(w));

  // Centered blocks: the box sits in the middle of its parent, and what's inside sits in the middle of the box.
  const CENTERED = ['.hero > *:not(.dl-note)', '.head.center', '.head.center > *', '.closing', '.closing > *', '.faq', '.center', '.laptop', '.monitor', '.isl-mock', '.mono-illus .illus', '.trust', '.cta:not(.start)', '.holder', '.page-head.center > *'];
  const seen = new Set();
  for (const sel of CENTERED) {
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el) || !visible(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const p = contentBox(el.parentElement);
      if (getComputedStyle(el).position !== 'absolute' || el.matches('.isl-mock')) {
        const l = r.left - p.left; const rr = p.right - r.right;
        if (Math.abs(l - rr) > TOL) out.push(`not centered in its parent: ${name(el)} (${l.toFixed(1)} left, ${rr.toFixed(1)} right)`);
      }
      const s = getComputedStyle(el);
      const centersText = s.textAlign === 'center' || (s.display.includes('flex') && s.justifyContent === 'center');
      if (!centersText || el.matches('.laptop, .monitor, .isl-mock, .faq')) continue;
      const range = document.createRange(); range.selectNodeContents(el);
      const ir = range.getBoundingClientRect();
      if (!ir.width) continue;
      const b = contentBox(el);
      const l = ir.left - b.left; const rr = b.right - ir.right;
      if (Math.abs(l - rr) > TOL) out.push(`contents not centered: ${name(el)} (${l.toFixed(1)} left, ${rr.toFixed(1)} right)`);
    }
  }

  // Cards in a row: same height and width; no card alone on a last row.
  const GRIDS = ['.grid', '.promises', '.platforms', '.pair', '.os-tabs', '.fparts', '.cats', '.switches', '.fshots', '.steps.shots', '.footer-none'];
  for (const g of document.querySelectorAll(GRIDS.join(','))) {
    if (!visible(g)) continue;
    const kids = [...g.children].filter(visible);
    const rows = [];
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      const row = rows.find((x) => Math.abs(x.top - r.top) <= TOL);
      if (row) row.items.push(r); else rows.push({ top: r.top, items: [r] });
    }
    const multi = rows.some((x) => x.items.length > 1);
    for (const row of rows) {
      if (row.items.length < 2) continue;
      const hs = row.items.map((r) => r.height); const ws = row.items.map((r) => r.width);
      if (Math.max(...hs) - Math.min(...hs) > TOL) out.push(`cards in a row differ in height: ${name(g)} (${hs.map((h) => h.toFixed(0)).join(', ')})`);
      if (Math.max(...ws) - Math.min(...ws) > TOL) out.push(`cards in a row differ in width: ${name(g)} (${ws.map((w) => w.toFixed(0)).join(', ')})`);
    }
    const last = rows[rows.length - 1];
    const gb = contentBox(g);
    if (multi && last.items.length === 1 && last.items[0].width < gb.right - gb.left - TOL) out.push(`one card alone on the last row: ${name(g)} (${kids.length} cards)`);
  }

  // Spotlights mirror: same text and picture widths, same gap, both halves vertically centered.
  const spots = [...document.querySelectorAll('.spot')].filter(visible);
  const dims = spots.map((s) => {
    const t = s.querySelector('.spot-text').getBoundingClientRect();
    const m = [...s.children].find((c) => !c.classList.contains('spot-text')).getBoundingClientRect();
    return { t, m, gap: t.left < m.left ? m.left - t.right : t.left - m.right, side: t.right > m.left + 1 && m.right > t.left + 1 ? 'stacked' : (t.left < m.left ? 'left' : 'right') };
  });
  for (const [i, d] of dims.entries()) {
    if (d.side === 'stacked') continue;
    const cy = (r) => r.top + r.height / 2;
    if (Math.abs(cy(d.t) - cy(d.m)) > TOL) out.push(`spotlight ${i + 1}: text and picture not vertically centered (${(cy(d.t) - cy(d.m)).toFixed(1)}px)`);
    const a = dims[0];
    if (Math.abs(d.t.width - a.t.width) > TOL || Math.abs(d.m.width - a.m.width) > TOL || Math.abs(d.gap - a.gap) > TOL) out.push(`spotlight ${i + 1} doesn't mirror spotlight 1 (text ${d.t.width.toFixed(0)}/${a.t.width.toFixed(0)}, picture ${d.m.width.toFixed(0)}/${a.m.width.toFixed(0)}, gap ${d.gap.toFixed(0)}/${a.gap.toFixed(0)})`);
    if (i > 0 && d.side === dims[i - 1].side) out.push(`spotlight ${i + 1} is on the same side as the one before`);
  }

  // One rhythm: every section head sits the same distance above what follows it, and sections are spaced alike.
  const heads = [...document.querySelectorAll('main .head')].filter(visible);
  const gaps = heads.map((h) => { const n = h.nextElementSibling; return n && visible(n) ? Math.round(n.getBoundingClientRect().top - h.getBoundingClientRect().bottom) : null; }).filter((x) => x != null);
  if (new Set(gaps).size > 1) out.push(`section heads sit at different distances above their content (${[...new Set(gaps)].join(', ')}px)`);
  const pads = [...document.querySelectorAll('main section')].filter((s) => visible(s) && !s.closest('.feat, .closing') && !s.matches('.closing, .os, .fgroup')).map((s) => getComputedStyle(s).paddingTop);
  if (new Set(pads).size > 1) out.push(`sections are spaced differently (${[...new Set(pads)].join(', ')})`);

  // One set of radii, icon chips and button sizes.
  const RADII = new Set(['12px', '16px', '20px', '28px', '999px']); // 999px: capsules (the top bar, buttons)
  const CARDS = '.shell,.pnl,.pill-nav,.card,.promise,.os,.app-card,.meter,.total,.sdemo,.window,.signed,.steps > li,.pick,.mono-band,.diagram,.lid-demo,.isl-stage,.closing,.faq details,.compare,.table,.plat,.verify-note,.fparts li,.cats label,.sw,.files a,.callout,.release-line';
  for (const el of document.querySelectorAll(CARDS)) {
    if (!visible(el)) continue;
    const r = getComputedStyle(el).borderTopLeftRadius;
    if (!RADII.has(r)) out.push(`radius off the scale: ${name(el)} ${r}`);
  }
  for (const el of document.querySelectorAll('.ic, .seal, .os-ic')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (![44, 64].includes(Math.round(r.width)) || Math.round(r.width) !== Math.round(r.height)) out.push(`icon chip off the scale: ${name(el)} ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
  }
  for (const row of document.querySelectorAll('.cta')) {
    const bs = [...row.querySelectorAll(':scope > .btn')].filter(visible).map((b) => b.getBoundingClientRect());
    const byRow = new Map();
    for (const b of bs) { const k = Math.round(b.top); byRow.set(k, [...(byRow.get(k) || []), b.height]); }
    for (const hs of byRow.values()) if (Math.max(...hs) - Math.min(...hs) > TOL) out.push(`buttons side by side differ in height: ${name(row)} (${hs.map((h) => h.toFixed(0)).join(', ')})`);
  }
  for (const b of document.querySelectorAll('main .btn')) {
    if (visible(b) && b.getBoundingClientRect().height < 40) out.push(`button too small to tap: ${name(b)} ${b.getBoundingClientRect().height.toFixed(0)}px`);
  }
  return out;
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  let failed = 0;
  for (const page of PAGES) {
    for (const w of WIDTHS) {
      for (const scheme of SCHEMES) {
        const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, colorScheme: scheme, reducedMotion: 'reduce', deviceScaleFactor: 1 });
        const pg = await ctx.newPage();
        const errors = [];
        pg.on('pageerror', (e) => errors.push(String(e)));
        await pg.route('**/*', (route) => (route.request().url().startsWith(`http://localhost:${port}`) ? route.continue() : route.abort()));
        await pg.goto(`http://localhost:${port}/${page === 'home' ? '' : `${page}/`}`, { waitUntil: 'networkidle' });
        await pg.evaluate(async () => { for (const img of document.images) { img.loading = 'eager'; } await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))); });
        await pg.waitForTimeout(150);
        const problems = [...errors.map((e) => `script error: ${e}`), ...(await pg.evaluate(measure))];
        const label = `${page} ${w} ${scheme}`;
        if (problems.length) { failed += problems.length; console.log(`FAIL ${label}\n  ${[...new Set(problems)].join('\n  ')}`); } else console.log(`PASS ${label}`);
        if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `layout-${page}-${w}-${scheme}.png`), fullPage: true });
        await ctx.close();
      }
    }
  }
  await browser.close();
  server.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `${failed} layout problem(s)` : 'Layout: every page is aligned at every width');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
