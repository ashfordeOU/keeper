// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Builds Keeper's website (https://keeper.ashforde.org/) from site/ into site/dist.
//
//   node site/build.mjs                 build into site/dist
//   node site/build.mjs --out <dir>     build somewhere else (the Website workflow builds outside the checkout)
//
// No dependencies: plain HTML pages in site/pages are put into site/templates/layout.html,
// the changelog page is made from CHANGELOG.md, and only the screenshots the pages use are
// copied from docs/screenshots. The build then checks that every link and picture inside the
// site resolves, and stops if one does not.
//
// The output is published to the root of the gh-pages branch by .github/workflows/site.yml,
// next to the dnf repository (rpm/) and keeper-release.asc that release.yml puts there; the
// site never writes those paths. `.site-files` lists what the site wrote, so the next publish
// can remove pages that are gone without touching anything else.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, inline, markdown, slug } from './lib/markdown.mjs';
import { PARTS, PIECES, defaultOn, estimate } from './lib/parts.mjs';
import { CATEGORIES, money, totals } from './lib/savings.mjs';
import { PRESETS, ago, search, size as fileSize } from './lib/search-demo.mjs';
import { lidSteps } from './lib/lid.mjs';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SITE, '..');
const BASE = 'https://keeper.ashforde.org/';
/** The custom domain is set in Settings → Pages; the site is deployed from Actions, so no CNAME file is needed. */
const REPO = 'https://github.com/ashfordeOU/keeper';
/** Paths on gh-pages that belong to release.yml's pages job; the site must never write them. */
export const RESERVED = ['rpm', 'keeper-release.asc', 'KEYS'];

const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(outArg > 0 ? process.argv[outArg + 1] : path.join(SITE, 'dist'));
if (OUT === ROOT || OUT === SITE || !path.basename(OUT)) throw new Error(`refusing to build into ${OUT}`);

const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// ---------------------------------------------------------------- the changelog

/** Releases in CHANGELOG.md, newest first: { version, date, body }. Empty sections and test versions (1.0.0-x) are left out. */
function releases() {
  const src = read('CHANGELOG.md').replace(/\r\n/g, '\n');
  const parts = src.split(/^## /m).slice(1);
  return parts.map((p) => {
    const [head, ...rest] = p.split('\n');
    const m = head.match(/^\[?([^\]\s]+)\]?(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/);
    return { version: m?.[1] ?? head.trim(), date: m?.[2] ?? '', body: rest.join('\n').trim() };
  }).filter((r) => r.body && !/^unreleased$/i.test(r.version) && !r.version.includes('-'));
}

/** Links in Markdown taken from the repository point at GitHub (docs) or stay absolute. */
function repoLink(href) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const clean = href.replace(/^\.\//, '').replace(/^\.\.\//, '');
  return `${REPO}/blob/main/${clean}`;
}

function changelogHtml(list) {
  const fmt = (d) => d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
  const toc = `<nav class="toc" aria-label="Versions"><ul>${list.map((r) => `<li><a href="#v${slug(r.version)}">${escapeHtml(r.version)}</a></li>`).join('')}</ul></nav>`;
  const items = list.map((r) => {
    const used = new Set();
    const unique = (id) => { let u = id; for (let n = 2; used.has(u); n++) u = `${id}-${n}`; used.add(u); return u; };
    const body = markdown(r.body, {
      link: repoLink,
      heading: (level, text) => {
        const m = text.match(/^(Added|Changed|Fixed|Removed|Security|Deprecated)(?:\s+[—-]\s+(.*))?$/);
        if (level === 3 && m) return `<h3 id="${unique(`v${slug(r.version)}-${slug(text)}`)}"><span class="tag tag-${m[1].toLowerCase()}">${m[1]}</span>${m[2] ? ` ${inline(m[2], repoLink)}` : ''}</h3>`;
        return null;
      },
    });
    return `<article class="release" id="v${slug(r.version)}"><header><h2>${escapeHtml(r.version)}</h2>${r.date ? `<p><time datetime="${r.date}">${fmt(r.date)}</time> · <a href="${REPO}/releases/tag/v${encodeURIComponent(r.version)}">Release files</a></p>` : ''}</header>${body}</article>`;
  }).join('\n');
  return `${toc}\n<div class="releases">\n${items}\n</div>`;
}

// ---------------------------------------------------------------- pages

function pageFiles() {
  return readdirSync(path.join(SITE, 'pages')).filter((f) => f.endsWith('.html')).sort();
}

/** `<!-- key: value -->` lines at the top of a page. */
function frontMatter(src) {
  const m = src.match(/^<!--([\s\S]*?)-->\s*/);
  const meta = {};
  if (m) for (const line of m[1].split('\n')) { const kv = line.match(/^\s*([a-z]+):\s*(.*)$/); if (kv) meta[kv[1]] = kv[2].trim(); }
  return { meta, body: m ? src.slice(m[0].length) : src };
}

const NAV = [
  ['', 'Home'], ['features/', 'Features'], ['download/', 'Download'], ['privacy/', 'Privacy'],
  ['monorail/', 'With Monorail'], ['changelog/', 'Changelog'], ['support/', 'Support'],
];

// Screenshots the pages use (added as they are found), copied into assets/shots.
const shotsUsed = new Set();

/** Marks a screenshot's light and dark files as used; returns their file names. */
function useShot(name) {
  const file = (theme) => existsSync(path.join(ROOT, 'docs/screenshots', `${name}-${theme}.webp`)) ? `${name}-${theme}.webp` : `${name}.webp`;
  const files = [file('light'), file('dark')];
  for (const f of files) {
    if (!existsSync(path.join(ROOT, 'docs/screenshots', f))) throw new Error(`no screenshot docs/screenshots/${f}`);
    shotsUsed.add(f);
  }
  return files;
}

/** Width and height of a screenshot, so the page keeps its place while pictures load. */
const SIZES = { 'island-expanded': [900, 394], 'island-notch': [760, 94], 'island-pill': [760, 81], tray: [436, 548] };
const sizeOf = (name) => SIZES[name] ?? [1440, 900];

/** A screenshot in light and dark: CSS shows the one that matches the page's theme. */
// A class of "eager" loads it at once (pictures at the top of a page); others load as they near the screen.
function shot(name, alt, cls = '') {
  const [light, dark] = useShot(name);
  const [w, h] = sizeOf(name);
  const size = `width="${w}" height="${h}"`;
  const load = /\beager\b/.test(cls) ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"';
  const a = escapeHtml(alt);
  if (light === dark) return `<figure class="shot ${cls}"><img src="{{root}}assets/shots/${light}" ${size} alt="${a}" ${load}></figure>`;
  return `<figure class="shot ${cls}"><img class="only-light" src="{{root}}assets/shots/${light}" ${size} alt="${a}" ${load}><img class="only-dark" src="{{root}}assets/shots/${dark}" ${size} alt="${a}" ${load}></figure>`;
}

function render(layout, meta, body, file) {
  if (!existsSync(path.join(SITE, 'assets/og', `${meta.og ?? 'home'}.jpg`))) throw new Error(`${file}: no preview image site/assets/og/${meta.og ?? 'home'}.jpg (make it with node site/og/make.mjs)`);
  const out = meta.path ?? '';
  const depth = out.split('/').filter(Boolean).length;
  const root = meta.root ?? (depth ? '../'.repeat(depth) : './');
  const nav = NAV.map(([href, label]) => `<a href="{{root}}${href}"${href === out ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  let html = layout
    .replace('{{nav}}', nav)
    .replace('{{body}}', body)
    .replaceAll('{{title}}', escapeHtml(meta.title ? `${meta.title} · Keeper by Ashforde®` : 'Keeper by Ashforde® · one install, a whole suite for your computer'))
    .replaceAll('{{description}}', escapeHtml(meta.description ?? ''))
    .replaceAll('{{canonical}}', `${BASE}${out}`)
    .replaceAll('{{og}}', `${BASE}assets/og/${meta.og ?? 'home'}.jpg`)
    .replaceAll('{{bodyclass}}', escapeHtml(meta.class ?? ''));
  // {{win name "alt" "Title"}}: a screenshot in an app window frame.
  html = html.replace(/\{\{win ([a-z0-9-]+) "([^"]*)" "([^"]*)"\}\}/g, (_, n, alt, title) => `<div class="window"><div class="bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="title">${escapeHtml(title)}</span></div>${shot(n, alt)}</div>`);
  html = html.replace(/\{\{shot ([a-z0-9-]+) "([^"]*)"(?: "([^"]*)")?\}\}/g, (_, n, alt, cls) => shot(n, alt, cls));
  // {{use a b c}}: screenshots the page's script shows later (copied, nothing written here).
  html = html.replace(/\{\{use ([a-z0-9 -]+)\}\}/g, (_, names) => { for (const n of names.trim().split(/\s+/)) useShot(n); return ''; });
  html = html.replaceAll('{{root}}', root);
  const left = html.match(/\{\{[^}]*\}\}/);
  if (left) throw new Error(`${file}: unknown placeholder ${left[0]}`);
  return html;
}


// ---------------------------------------------------------------- interactive parts
// Each is written out in full here, so it reads well with the script off; site.js then
// makes it respond. The numbers come from the same site/lib modules the script uses.

const ALL_MB = () => estimate(PARTS.map((p) => p.id)).total;
const pct = (mb) => `${((mb / ALL_MB()) * 100).toFixed(1)}%`;

function builderHtml() {
  for (const p of PARTS) useShot(p.shot);
  const on = defaultOn();
  const est = estimate(on);
  const has = (k) => est.pieces.some((x) => x.id === k);
  const first = PARTS.find((p) => p.on);
  const [light, dark] = useShot(first.shot);
  const [w, h] = sizeOf(first.shot);
  const sw = PARTS.map((p) => `<li><button type="button" class="sw" role="switch" aria-checked="${p.on}" data-part="${p.id}" data-shot="${p.shot}"><span>${escapeHtml(p.name)}</span><span class="switch" aria-hidden="true"></span></button></li>`).join('');
  const bar = [`<i style="width:${pct(est.core)}"></i>`, ...Object.keys(PIECES).map((k) => `<i data-piece="${k}" style="width:${has(k) ? pct(PIECES[k].mb) : '0%'}"></i>`)].join('');
  const legend = [`<li>Core ${est.core} MB</li>`, ...Object.entries(PIECES).map(([k, v]) => `<li data-piece="${k}"${has(k) ? '' : ' hidden'}>${escapeHtml(v.name)} ${v.mb} MB</li>`)].join('');
  const runs = PARTS.map((p) => `<li data-runs="${p.id}"${on.includes(p.id) ? '' : ' hidden'}><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.runs)}</span></li>`).join('');
  const alt = `${escapeHtml(first.name)} in Keeper`;
  return `<div class="builder" data-builder>
  <ul class="switches" aria-label="Parts of Keeper">${sw}</ul>
  <div class="preview">
    <div class="window"><div class="bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="title" data-preview-title>${escapeHtml(first.name)}</span></div>
      <figure class="shot"><img class="only-light" data-preview="light" src="{{root}}assets/shots/${light}" width="${w}" height="${h}" alt="${alt}" loading="lazy" decoding="async"><img class="only-dark" data-preview="dark" src="{{root}}assets/shots/${dark}" width="${w}" height="${h}" alt="${alt}" loading="lazy" decoding="async"></figure></div>
    <div class="meter" aria-live="polite">
      <div class="num"><b data-total>About ${est.total} MB</b><small data-count>${est.count} of ${PARTS.length} parts on</small></div>
      <div class="bar" aria-hidden="true">${bar}</div>
      <ul class="legend">${legend}</ul>
      <ul class="runs" aria-label="What runs"><li class="none" data-runs-none${on.length ? ' hidden' : ''}>Nothing runs. Switch a part on.</li>${runs}</ul>
    </div>
  </div>
</div>`;
}

function savingsHtml() {
  const t = totals(CATEGORIES.filter((c) => c.on).map((c) => c.id));
  const cats = CATEGORIES.map((c) => `<li><label><input type="checkbox" value="${c.id}"${c.on ? ' checked' : ''}><span>${escapeHtml(c.name)}</span><span class="price">$${c.low}–$${c.high}</span></label></li>`).join('');
  return `<div class="calc" data-savings>
  <fieldset class="bare"><legend class="sr">Kinds of paid apps you use</legend><ul class="cats">${cats}</ul></fieldset>
  <div class="total" aria-live="polite"><p>You'd pay about</p><span class="sum" data-sum>${money(t)}</span><hr><p>With Keeper</p><span class="free grad">Free</span></div>
</div>`;
}

/** One search result row (the same markup site.js writes). */
function resultRow(f, i) {
  const badge = f.kind === 'screenshot' ? 'png' : f.kind.slice(0, 4);
  return `<li style="--i:${i}"><span class="kind ${f.kind}" aria-hidden="true">${escapeHtml(badge)}</span><span class="t"><span class="name">${escapeHtml(f.name)}</span><span class="meta">${escapeHtml(f.why)} · ${escapeHtml(ago(f.days))} · ${escapeHtml(fileSize(f.mb))}</span></span></li>`;
}

function searchHtml() {
  const q = PRESETS[0];
  const chips = PRESETS.map((p, i) => `<button type="button" aria-pressed="${i === 0}">${escapeHtml(p)}</button>`).join('');
  return `<div class="sdemo" data-search>
  <label class="sfield"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m20 20-4-4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><span class="sr">Try a search</span><input type="search" value="${escapeHtml(q)}" autocomplete="off" spellcheck="false"></label>
  <div class="chips" role="group" aria-label="Try these">${chips}</div>
  <ul class="sres" aria-live="polite" aria-label="Results">${search(q).map(resultRow).join('')}</ul>
</div>`;
}

function lidHtml() {
  return `<ol class="lid-steps" data-lid-steps>${lidSteps({ keeperReady: true, pluggedIn: true }).map((s) => `<li>${escapeHtml(s.text)}</li>`).join('')}</ol>`;
}

// ---------------------------------------------------------------- build

function build() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const layout = readFileSync(path.join(SITE, 'templates/layout.html'), 'utf8');
  const list = releases();
  const latest = list[0];
  const written = [];
  const write = (rel, content) => {
    const dest = path.join(OUT, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    written.push(rel);
  };

  for (const f of pageFiles()) {
    const { meta, body } = frontMatter(readFileSync(path.join(SITE, 'pages', f), 'utf8'));
    let b = body;
    b = b.replace('{{changelog}}', () => changelogHtml(list));
    b = b.replaceAll('{{latest}}', escapeHtml(latest?.version ?? ''));
    b = b.replace('{{builder}}', builderHtml).replace('{{savings}}', savingsHtml).replace('{{search-demo}}', searchHtml).replace('{{lid-steps}}', lidHtml);
    const html = render(layout, meta, b, f);
    write(meta.out ?? `${meta.path ?? ''}index.html`, html);
  }

  // Assets: the stylesheet, script, pictures and preview images; screenshots the pages use.
  const copyDir = (from, to) => {
    for (const e of readdirSync(from, { withFileTypes: true })) {
      if (e.isDirectory()) { copyDir(path.join(from, e.name), `${to}/${e.name}`); continue; }
      cpSync(path.join(from, e.name), path.join(OUT, to, e.name));
      written.push(`${to}/${e.name}`);
    }
  };
  copyDir(path.join(SITE, 'assets'), 'assets');
  // The interactive parts' logic (site/lib, tested in test/site.test.ts); markdown.mjs is for the build only.
  for (const f of readdirSync(path.join(SITE, 'lib')).filter((n) => n.endsWith('.mjs') && n !== 'markdown.mjs')) {
    cpSync(path.join(SITE, 'lib', f), path.join(OUT, 'assets/lib', f));
    written.push(`assets/lib/${f}`);
  }
  cpSync(path.join(ROOT, 'public/favicon.svg'), path.join(OUT, 'assets/keeper.svg'));
  written.push('assets/keeper.svg');
  for (const f of [...shotsUsed].sort()) {
    cpSync(path.join(ROOT, 'docs/screenshots', f), path.join(OUT, 'assets/shots', f));
    written.push(`assets/shots/${f}`);
  }

  const pages = written.filter((p) => p.endsWith('index.html'));
  write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${BASE}sitemap.xml\n`);
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((p) => `<url><loc>${BASE}${p.replace(/index\.html$/, '')}</loc></url>`).join('')}</urlset>\n`);
  write('.nojekyll', '');
  written.push('.site-files');
  writeFileSync(path.join(OUT, '.site-files'), `${written.sort().join('\n')}\n`);

  for (const p of written) {
    const top = p.split('/')[0];
    if (RESERVED.includes(top)) throw new Error(`the site must not write ${p}: it belongs to release.yml's pages job`);
  }
  return written;
}

// ---------------------------------------------------------------- link check

/** Every href and src inside the site points at a file the build wrote (and every #anchor exists). */
function checkLinks(written) {
  const files = new Set(written);
  const problems = [];
  const ids = new Map();
  for (const p of written.filter((f) => f.endsWith('.html'))) {
    const all = [...readFileSync(path.join(OUT, p), 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const set = new Set(all);
    if (set.size !== all.length) problems.push(`${p}: the same id twice (${all.filter((id, i) => all.indexOf(id) !== i).join(', ')})`);
    ids.set(p, set);
  }
  for (const p of written.filter((f) => f.endsWith('.html') || f.endsWith('.css'))) {
    const src = readFileSync(path.join(OUT, p), 'utf8');
    const refs = p.endsWith('.css')
      ? [...src.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1])
      : [...src.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    for (const ref of refs) {
      if (/^(https?:|mailto:|data:)/.test(ref)) continue;
      const [pathPart, hash] = ref.split('#');
      // The site is served at the domain's root, so /x is x from the top of the site.
      const from = pathPart.startsWith('/') ? '.' : path.posix.dirname(p);
      const rel = pathPart.startsWith('/') ? pathPart.slice(1) || '.' : pathPart;
      let target = pathPart ? path.posix.normalize(path.posix.join(from, rel.split('?')[0])) : p;
      if (target.startsWith('..')) { problems.push(`${p}: ${ref} leaves the site`); continue; }
      target = target.replace(/^\.\/?/, '');
      if (target === '' || target.endsWith('/') || (!path.posix.extname(target) && files.has(`${target}/index.html`))) target = `${target.replace(/\/?$/, '/').replace(/^\/$/, '')}index.html`;
      if (!files.has(target)) { problems.push(`${p}: ${ref} (no ${target})`); continue; }
      if (hash && target.endsWith('.html') && !ids.get(target)?.has(hash)) problems.push(`${p}: ${ref} (no #${hash} in ${target})`);
    }
  }
  return problems;
}

const written = build();
const problems = checkLinks(written);
if (problems.length) {
  console.error(`Website: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
const size = written.reduce((n, p) => n + statSync(path.join(OUT, p)).size, 0);
console.log(`Website: ${written.filter((p) => p.endsWith('.html')).length} pages, ${written.length} files, ${(size / 1024 / 1024).toFixed(1)} MB in ${path.relative(process.cwd(), OUT) || OUT}; every internal link resolves and every id is unique`);
