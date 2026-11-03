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

/** Releases in CHANGELOG.md, newest first: { version, date, body }. Empty sections are left out. */
function releases() {
  const src = read('CHANGELOG.md').replace(/\r\n/g, '\n');
  const parts = src.split(/^## /m).slice(1);
  return parts.map((p) => {
    const [head, ...rest] = p.split('\n');
    const m = head.match(/^\[?([^\]\s]+)\]?(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/);
    return { version: m?.[1] ?? head.trim(), date: m?.[2] ?? '', body: rest.join('\n').trim() };
  }).filter((r) => r.body && !/^unreleased$/i.test(r.version));
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
    const pre = /-/.test(r.version) ? ' <span class="pill">beta</span>' : '';
    return `<article class="release" id="v${slug(r.version)}"><header><h2>${escapeHtml(r.version)}${pre}</h2>${r.date ? `<p><time datetime="${r.date}">${fmt(r.date)}</time> · <a href="${REPO}/releases/tag/v${encodeURIComponent(r.version)}">Release files</a></p>` : ''}</header>${body}</article>`;
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

// hero.webp is the home page's large picture and every page's preview image.
const shotsUsed = new Set(['hero.webp']);

/** A screenshot in light and dark: CSS shows the one that matches the page's theme. */
function shot(name, alt, cls = '') {
  const file = (theme) => existsSync(path.join(ROOT, 'docs/screenshots', `${name}-${theme}.webp`)) ? `${name}-${theme}.webp` : `${name}.webp`;
  const light = file('light');
  const dark = file('dark');
  for (const f of [light, dark]) {
    if (!existsSync(path.join(ROOT, 'docs/screenshots', f))) throw new Error(`no screenshot docs/screenshots/${f}`);
    shotsUsed.add(f);
  }
  const size = name.startsWith('island-expanded') ? 'width="900" height="394"' : name === 'tray' ? 'width="436" height="548"' : name === 'hero' ? 'width="1600" height="760"' : 'width="1440" height="900"';
  const a = escapeHtml(alt);
  if (light === dark) return `<figure class="shot ${cls}"><img src="{{root}}assets/shots/${light}" ${size} alt="${a}" loading="lazy" decoding="async"></figure>`;
  return `<figure class="shot ${cls}"><img class="only-light" src="{{root}}assets/shots/${light}" ${size} alt="${a}" loading="lazy" decoding="async"><img class="only-dark" src="{{root}}assets/shots/${dark}" ${size} alt="${a}" loading="lazy" decoding="async"></figure>`;
}

function render(layout, meta, body, file) {
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
    .replaceAll('{{bodyclass}}', escapeHtml(meta.class ?? ''));
  html = html.replace(/\{\{shot ([a-z0-9-]+) "([^"]*)"(?: "([^"]*)")?\}\}/g, (_, n, alt, cls) => shot(n, alt, cls));
  html = html.replaceAll('{{root}}', root);
  const left = html.match(/\{\{[^}]*\}\}/);
  if (left) throw new Error(`${file}: unknown placeholder ${left[0]}`);
  return html;
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
    const html = render(layout, meta, b, f);
    write(meta.out ?? `${meta.path ?? ''}index.html`, html);
  }

  // Assets: the stylesheet, script and icons; screenshots the pages use.
  for (const f of readdirSync(path.join(SITE, 'assets'))) {
    cpSync(path.join(SITE, 'assets', f), path.join(OUT, 'assets', f));
    written.push(`assets/${f}`);
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
