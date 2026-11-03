// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The website (site/, published by .github/workflows/site.yml): it builds with no
// dependencies, every link inside it resolves, it never writes the paths release.yml owns on
// gh-pages, its wording keeps to the plain-words list, and it loads nothing from elsewhere.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jargonIn } from '../core/settings-schema';

const yaml = createRequire(import.meta.url)('js-yaml') as { load(text: string): unknown };
const ROOT = path.resolve(__dirname, '..');
let out = '';

function files(dir: string, base = ''): string[] {
  return readdirSync(path.join(dir, base), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(dir, path.join(base, e.name)) : [path.join(base, e.name).split(path.sep).join('/')]));
}

beforeAll(() => {
  out = path.join(mkdtempSync(path.join(tmpdir(), 'keeper-site-')), 'site');
  execFileSync(process.execPath, [path.join(ROOT, 'site/build.mjs'), '--out', out], { stdio: 'pipe' });
});
afterAll(() => { if (out) rmSync(path.dirname(out), { recursive: true, force: true }); });

describe('website', () => {
  it('builds every page, with the changelog made from CHANGELOG.md', () => {
    for (const p of ['index.html', 'features/index.html', 'download/index.html', 'privacy/index.html', 'monorail/index.html', 'changelog/index.html', 'support/index.html', '404.html']) {
      expect(existsSync(path.join(out, p)), p).toBe(true);
    }
    const newest = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').match(/^## \[(\d[^\]]*)\]/m)?.[1];
    expect(newest).toBeTruthy();
    expect(readFileSync(path.join(out, 'changelog/index.html'), 'utf8')).toContain(`id="v${newest!.toLowerCase().replace(/[^a-z0-9]+/g, '-')}"`);
  });

  it('lists what it wrote, and never writes the dnf repository or the signing key', () => {
    const listed = readFileSync(path.join(out, '.site-files'), 'utf8').trim().split('\n').sort();
    expect(listed).toEqual(files(out).sort());
    for (const f of listed) expect(f).not.toMatch(/^(rpm|KEYS)(\/|$)|^keeper-release\.asc$/);
  });

  it('is served at keeper.ashforde.org: canonical links there, nothing under the old /keeper/ path', () => {
    expect(readFileSync(path.join(out, 'index.html'), 'utf8')).toContain('<link rel="canonical" href="https://keeper.ashforde.org/');
    expect(readFileSync(path.join(out, 'sitemap.xml'), 'utf8')).toContain('<loc>https://keeper.ashforde.org/</loc>');
    for (const f of files(out).filter((p) => p.endsWith('.html'))) {
      const html = readFileSync(path.join(out, f), 'utf8');
      expect(html, f).not.toMatch(/href="\/keeper\/|src="\/keeper\/|ashfordeou\.github\.io\/(keeper|monorail)/);
    }
    expect(readFileSync(path.join(out, 'monorail/index.html'), 'utf8')).toContain('https://monorail.ashforde.org/keeper/');
  });

  it('loads scripts, styles and pictures only from itself (no tracking, no other sites)', () => {
    for (const f of files(out).filter((p) => p.endsWith('.html'))) {
      const html = readFileSync(path.join(out, f), 'utf8');
      for (const m of html.matchAll(/<(?:script|img|link|iframe|source)\b[^>]*\s(?:src|href)="([^"]+)"/g)) {
        if (/rel="canonical"/.test(m[0])) continue;
        expect(m[1], `${f}: ${m[0]}`).not.toMatch(/^(https?:)?\/\//);
      }
      expect(html).not.toMatch(/googletagmanager|google-analytics|plausible|gtag\(|fbq\(/);
    }
  });

  it('keeps to plain words in its own pages (the changelog quotes CHANGELOG.md as it is)', () => {
    const problems: string[] = [];
    for (const f of readdirSync(path.join(ROOT, 'site/pages')).filter((p) => p.endsWith('.html') && p !== 'changelog.html')) {
      const text = readFileSync(path.join(ROOT, 'site/pages', f), 'utf8')
        .replace(/<!--[\s\S]*?-->/, '')
        .replace(/<(pre|code)\b[\s\S]*?<\/\1>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\{\{[^}]*\}\}/g, ' ');
      for (const w of jargonIn(text)) problems.push(`${f}: "${w}"`);
    }
    expect(problems).toEqual([]);
  });
});

describe('website pages', () => {
  const html = (p: string) => readFileSync(path.join(out, p), 'utf8');
  const pages = () => files(out).filter((p) => p.endsWith('.html'));

  it('gives every page its own 1200 × 630 preview image from the site itself', () => {
    for (const f of pages()) {
      const m = html(f).match(/<meta property="og:image" content="https:\/\/keeper\.ashforde\.org\/(assets\/og\/[a-z-]+\.jpg)">/);
      expect(m, f).toBeTruthy();
      const jpg = readFileSync(path.join(out, m![1]));
      expect(jpg.length, m![1]).toBeLessThan(300 * 1024);
      // The JPEG's size, from its first SOF marker.
      let i = 2;
      let size: [number, number] | null = null;
      while (i < jpg.length) {
        const marker = jpg[i + 1];
        const len = jpg.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xc2) { size = [jpg.readUInt16BE(i + 7), jpg.readUInt16BE(i + 5)]; break; }
        i += 2 + len;
      }
      expect(size, m![1]).toEqual([1200, 630]);
      expect(html(f)).toContain('<meta property="og:image:width" content="1200">');
    }
    expect(html('index.html')).not.toContain('assets/shots/hero.webp');
  });

  it('loads its script and its logic only from itself, and fetches only the public release list', () => {
    const js = [readFileSync(path.join(out, 'assets/site.js'), 'utf8'), ...files(out).filter((p) => p.startsWith('assets/lib/')).map((p) => html(p))].join('\n');
    for (const m of js.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) expect(m[1]).toMatch(/^\.\.?\//);
    for (const m of js.matchAll(/https?:\/\/[^\s'"`)]+/g)) expect(m[0]).toMatch(/^https:\/\/(api\.)?github\.com\//);
    const css = html('assets/site.css');
    expect(css).not.toMatch(/@import|url\(\s*["']?https?:/);
    for (const f of pages()) expect(html(f), f).not.toMatch(/<link[^>]+(preconnect|dns-prefetch|fonts\.googleapis)/);
    expect(html('index.html')).toContain('<script type="module" src="./assets/site.js"></script>');
  });

  it('stops motion for people who ask for less, and shows everything without the script', () => {
    const css = html('assets/site.css');
    const calm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(calm).toMatch(/\.js \.reveal \{ opacity:1; transform:none; transition:none; \}/);
    expect(calm).toMatch(/animation-duration:0s !important/);
    expect(html('assets/site.js')).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    // Content hidden for the reveal only once the script runs (and shown again if it never does).
    expect(css).toMatch(/^\.js \.reveal \{ opacity:0;/m);
    expect(html('index.html')).toMatch(/classList\.add\('js'\);.*if \(!window\.keeperSite\) document\.documentElement\.classList\.remove\('js'\)/);
  });

  it('writes every interactive part out in full, so it reads well with the script off', () => {
    const home = html('index.html');
    for (const hook of ['data-builder', 'data-island', 'data-search', 'data-compare', 'data-themes', 'data-savings']) expect(home, hook).toContain(hook);
    expect(home.match(/role="switch" aria-checked="true"/g)?.length).toBe(5);
    expect(home).toContain('About 185 MB');
    expect(home).toContain('Screenshot 2026-10-28 at 09.14.02.png');
    expect(home).toContain('$150–$370 a year');
    expect(home).toMatch(/<input type="range" min="0" max="100"[^>]*aria-label=/);
    expect(home).toMatch(/role="tablist"[\s\S]*role="tabpanel"/);
    const mono = html('monorail/index.html');
    expect(mono).toContain('data-lid');
    expect(mono).toContain('You close the lid. Keeper keeps the Mac awake.');
    expect(mono).toMatch(/<svg viewBox="0 0 960 430" role="img" aria-labelledby=/);
    for (const f of ['strip.webp', 'icon.webp', 'menu.svg']) {
      const p = path.join(out, 'assets/monorail', f);
      expect(existsSync(p), f).toBe(true);
      expect(readFileSync(p).length, f).toBeLessThan(300 * 1024);
    }
  });

  it('keeps headlines short and never offers betas', () => {
    for (const f of readdirSync(path.join(ROOT, 'site/pages')).filter((p) => p.endsWith('.html') && p !== 'changelog.html')) {
      const src = readFileSync(path.join(ROOT, 'site/pages', f), 'utf8');
      for (const m of src.matchAll(/<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/g)) {
        const words = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').trim().split(/\s+/).filter((w) => w !== '&');
        expect(words.length, `${f}: ${m[2]}`).toBeLessThanOrEqual(8);
      }
      expect(src, f).not.toMatch(/\bbetas?\b|pre-release|now available/i);
    }
    expect(html('assets/site.js')).not.toMatch(/\bbeta\b/i);
    expect(html('changelog/index.html')).not.toMatch(/<h2>[^<]*-[a-z]+\.\d+/);
  });

  it('marks screenshots with their size so nothing moves while they load, and loads lower ones lazily', () => {
    for (const f of pages()) {
      for (const m of html(f).matchAll(/<img\b[^>]*>/g)) {
        expect(m[0], f).toMatch(/\swidth="\d+" height="\d+"/);
        if (/assets\/shots\//.test(m[0])) expect(m[0], f).toMatch(/loading="lazy"|fetchpriority="high"/);
      }
    }
  });
});

describe('website: the interactive parts', () => {
  // site/lib is plain JavaScript shared by the build and the browser.
  const load = (name: string) => import(path.join(ROOT, 'site/lib', name));

  it('Build your Keeper: counts each downloaded piece once and lists what runs', async () => {
    const { PARTS, CORE_MB, defaultOn, estimate, toggle } = await load('parts.mjs');
    expect(defaultOn()).toEqual(['files', 'island', 'tidy', 'privacy', 'awake']);
    expect(estimate(defaultOn())).toMatchObject({ core: CORE_MB, extra: 0, total: CORE_MB, count: 5 });
    const studio = estimate(['studio']);
    expect(studio.pieces.map((p: { id: string }) => p.id)).toEqual(['video']);
    const both = estimate(['studio', 'ai']);
    expect(both.pieces.map((p: { id: string }) => p.id)).toEqual(['ai', 'video']);
    expect(both.total).toBe(CORE_MB + 30 + 19);
    expect(estimate([]).runs).toEqual([]);
    expect(estimate(['sync']).runs[0]).toMatchObject({ id: 'sync', runs: 'Syncs on a schedule' });
    expect(toggle(['files'], 'files')).toEqual([]);
    expect(toggle(['notes'], 'files')).toEqual(['files', 'notes']);
    for (const p of PARTS) expect(existsSync(path.join(ROOT, 'docs/screenshots', `${p.shot}-light.webp`)), p.shot).toBe(true);
  });

  it('the search demo reads plain-English searches', async () => {
    const { PRESETS, parseQuery, search, size, ago } = await load('search-demo.mjs');
    expect(parseQuery('pdfs from gmail last week')).toMatchObject({ kind: 'pdf', from: 'gmail', maxDays: 14, words: [] });
    expect(parseQuery('videos over 500 MB')).toMatchObject({ kind: 'video', minMb: 500 });
    expect(parseQuery('pictures from Lisbon')).toMatchObject({ kind: 'image', from: null, words: ['lisbon'] });
    expect(search('screenshots with wifi password').map((f: { name: string; why: string }) => [f.name, f.why])).toEqual([['Screenshot 2026-10-28 at 09.14.02.png', 'Text in the picture']]);
    expect(search('videos over 500 MB').map((f: { name: string }) => f.name)).toEqual(['Lisbon trip.mov', 'Screen Recording 2025-11-02.mov']);
    expect(search('pdfs from gmail last week')).toHaveLength(2);
    expect(search('')).toEqual([]);
    expect(search('nothing like this')).toEqual([]);
    for (const q of PRESETS) expect(search(q).length, q).toBeGreaterThan(0);
    expect([size(2400), size(184), size(0.4)]).toEqual(['2.3 GB', '184 MB', '410 KB']);
    expect([ago(0), ago(1), ago(6), ago(75), ago(400), ago(800)]).toEqual(['today', 'yesterday', '6 days ago', '3 months ago', 'a year ago', '2 years ago']);
  });

  it('the price comparison adds up the ticked kinds and names no product', async () => {
    const { CATEGORIES, totals, money } = await load('savings.mjs');
    const on = CATEGORIES.filter((c: { on: boolean }) => c.on).map((c: { id: string }) => c.id);
    expect(totals(on)).toEqual({ count: 4, low: 150, high: 370 });
    expect(money(totals(on))).toBe('$150–$370 a year');
    expect(money(totals([]))).toBe('$0');
    expect(money(totals(['notch', 'clipboard']))).toBe('$20–$60 a year');
    for (const c of CATEGORIES) {
      expect(c.low).toBeLessThanOrEqual(c.high);
      expect(c.name).toMatch(/^(A|An) [a-z]|^[A-Z][a-z]+( [a-z]+)*$/);
    }
  });

  it('the before/after slider follows the pointer and the keys', async () => {
    const { fromPointer, fromKey, clamp } = await load('slider.mjs');
    expect(fromPointer(150, 100, 200)).toBe(25);
    expect(fromPointer(50, 100, 200)).toBe(0);
    expect(fromPointer(900, 100, 200)).toBe(100);
    expect(fromPointer(10, 0, 0)).toBe(50);
    expect(fromKey(50, 'ArrowLeft')).toBe(48);
    expect(fromKey(50, 'ArrowRight', true)).toBe(60);
    expect(fromKey(3, 'PageDown')).toBe(0);
    expect([fromKey(40, 'Home'), fromKey(40, 'End'), fromKey(40, 'a')]).toEqual([0, 100, null]);
    expect(clamp(Number.NaN)).toBe(50);
  });

  it('Try the Island: clock, battery, meeting and the timer', async () => {
    const { clock, battery, startsIn, tick } = await load('island.mjs');
    expect([clock(42), clock(214), clock(3725), clock(-3)]).toEqual(['0:42', '3:34', '1:02:05', '0:00']);
    expect(battery(76)).toEqual({ percent: 76, fill: 0.76, tone: 'ok' });
    expect([battery(18).tone, battery(9).tone, battery(50, true).tone, battery(140).percent]).toEqual(['warn', 'low', 'charging', 100]);
    expect([startsIn(12), startsIn(0), startsIn(65), startsIn(120)]).toEqual(['in 12 min', 'now', 'in 1 h 5 min', 'in 2 h']);
    const s = { playing: true, song: 213, length: 214, timer: 1, timerOn: true };
    expect(tick(s)).toEqual({ playing: true, song: 0, length: 214, timer: 0, timerOn: false });
    expect(tick({ ...s, playing: false, timerOn: false })).toMatchObject({ song: 213, timer: 1 });
  });

  it('the lid demo follows the hand-over: Keeper only when it says yes, asleep on battery', async () => {
    const { lidSteps, lidOwner } = await load('lid.mjs');
    expect(lidOwner({ keeperReady: true, pluggedIn: true })).toBe('keeper');
    expect(lidOwner({ keeperReady: false, pluggedIn: true })).toBe('monorail');
    expect(lidOwner({ keeperReady: true, pluggedIn: false })).toBe('none');
    const steps = lidSteps({ keeperReady: false, pluggedIn: true });
    expect(steps.some((s: { who: string }) => s.who === 'keeper')).toBe(false);
    expect(steps[1].text).toContain('waits');
    expect(lidSteps({ keeperReady: true, pluggedIn: true }).map((s: { lid: string }) => s.lid)).toEqual(['open', 'open', 'open', 'closed', 'open']);
  });
});

describe('website: devices that move', () => {
  const load = (name: string) => import(path.join(ROOT, 'site/lib', name));
  const built = (p: string) => readFileSync(path.join(out, p), 'utf8');
  const pages = () => files(out).filter((p) => p.endsWith('.html'));

  it('the hero laptop leans a few degrees at most, towards the pointer and back with the scroll', async () => {
    const { tilt, scrolled, clamp, MAX_TILT } = await load('motion.mjs');
    const rect = { left: 100, top: 100, width: 400, height: 200 };
    expect(tilt({ rect })).toEqual({ rx: 0, ry: 0 });
    expect(tilt({ x: 300, y: 200, rect })).toEqual({ rx: 0, ry: 0 });
    expect(tilt({ x: 500, y: 200, rect }).ry).toBe(MAX_TILT);
    expect(tilt({ x: 100, y: 200, rect }).ry).toBe(-MAX_TILT);
    expect(tilt({ x: 300, y: 100, rect }).rx).toBeGreaterThan(0);
    expect(tilt({ x: 9000, y: -9000, rect, scroll: 5 })).toEqual({ rx: MAX_TILT, ry: MAX_TILT });
    for (const x of [-1e6, 0, 250, 1e6]) for (const sc of [0, 0.5, 1]) {
      const t = tilt({ x, y: x, rect, scroll: sc });
      expect(Math.abs(t.rx)).toBeLessThanOrEqual(MAX_TILT);
      expect(Math.abs(t.ry)).toBeLessThanOrEqual(MAX_TILT);
    }
    expect(MAX_TILT).toBeLessThanOrEqual(4);
    expect([scrolled(0, 800), scrolled(-400, 800), scrolled(-2000, 800), scrolled(300, 800), scrolled(-10, 0)]).toEqual([0, 0.5, 1, 0, 0]);
    expect(clamp(Number.NaN, 0, 10)).toBe(5);
  });

  it('slideshows go round, and Build your Keeper shows only parts that are on', async () => {
    const { nextSlide, nextPart, SLIDE_MS } = await load('motion.mjs');
    expect([nextSlide(0, 8), nextSlide(7, 8), nextSlide(0, 8, -1), nextSlide(3, 0)]).toEqual([1, 0, 7, 0]);
    const parts = [{ id: 'files' }, { id: 'island' }, { id: 'notes' }, { id: 'tidy' }];
    expect(nextPart(parts, ['files', 'tidy'], 'files')).toBe('tidy');
    expect(nextPart(parts, ['files', 'tidy'], 'tidy')).toBe('files');
    expect(nextPart(parts, ['island'], 'files')).toBe('island');
    expect(nextPart(parts, [], 'files')).toBeNull();
    expect(SLIDE_MS).toBeGreaterThanOrEqual(3000);
  });

  it('the statement lights up word by word as it scrolls up the screen', async () => {
    const { wordsLit } = await load('motion.mjs');
    expect(wordsLit(900, 1000, 20)).toBe(0);
    expect(wordsLit(850, 1000, 20)).toBe(0);
    expect(wordsLit(600, 1000, 20)).toBe(10);
    expect(wordsLit(350, 1000, 20)).toBe(20);
    expect(wordsLit(-500, 1000, 20)).toBe(20);
    expect([wordsLit(0, 0, 20), wordsLit(0, 1000, 0)]).toEqual([0, 0]);
  });

  it('the little Mac in the lid demo shows who keeps it awake', async () => {
    const { lidSteps, scene } = await load('lid.mjs');
    const scenes = lidSteps({ keeperReady: true, pluggedIn: true }).map(scene);
    expect(scenes[0]).toEqual({ lid: 'open', screen: 'strip', glow: 'monorail' });
    expect(scenes[3]).toEqual({ lid: 'closed', screen: 'island', glow: 'keeper' });
    expect(lidSteps({ keeperReady: false, pluggedIn: true }).map(scene).every((s: { glow: string }) => s.glow === 'monorail')).toBe(true);
    expect(lidSteps({ keeperReady: true, pluggedIn: false }).map(scene).at(-1)).toEqual({ lid: 'closed', screen: 'asleep', glow: null });
  });

  it('writes the moving parts into the pages, with a still picture underneath', () => {
    const home = built('index.html');
    expect(home).toMatch(/<div class="hero-visual" data-tilt data-live>/);
    expect(home).toMatch(/class="mb-wifi"[\s\S]*class="mb-bt"/);
    expect(home).toMatch(/<p class="say" data-say>/);
    // Both slideshows sit in a monitor, with a Pause button the script shows once a show runs.
    expect(home.match(/<div class="monitor"[^>]*data-live>/g)?.length).toBe(2);
    expect(home.match(/<button type="button" class="pause" data-pause aria-pressed="false" hidden>/g)?.length).toBe(2);
    expect(home).toMatch(/<div class="shell" data-builder>[\s\S]*class="pnl pnl-parts"[\s\S]*class="pnl pnl-stage"[\s\S]*class="pnl pnl-meter meter"/);
    const mono = built('monorail/index.html');
    expect(mono).toMatch(/<div class="mac" data-screen="strip" data-lid="open" aria-hidden="true">/);
    for (const part of ['m-glow', 'm-face', 'm-back', 'm-strip', 'm-isl', 'm-zz', 'm-led']) expect(mono, part).toContain(`class="${part}`);
    // One filled button in the top bar, and the page it leads to marked as current there.
    for (const f of pages()) expect(built(f).match(/class="btn primary nav-cta"/g)?.length, f).toBe(1);
    expect(built('download/index.html')).toContain('class="btn primary nav-cta" href="../download/" aria-current="page"');
  });

  it('moves only for people who haven\'t asked for less, and only while on screen', () => {
    const css = built('assets/site.css');
    const start = css.indexOf('@media (prefers-reduced-motion: no-preference) {');
    expect(start).toBeGreaterThan(0);
    let depth = 0; let end = start;
    for (let i = css.indexOf('{', start); i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) { end = i; break; } }
    const motion = css.slice(start, end);
    const outside = css.slice(0, start) + css.slice(end);
    const NEW = ['lid-open', 'screen-on', 'app-in', 'drop', 'glow-in', 'breathe', 'breathe-pill', 'wifi', 'bt', 'steam', 'strip', 'progress'];
    for (const k of NEW) {
      expect(css, k).toContain(`@keyframes ${k} `);
      expect(motion, k).toMatch(new RegExp(`animation:[^;]*\\b${k}\\b`));
      expect(outside, k).not.toMatch(new RegExp(`animation:[^;]*\\b${k}\\b`));
    }
    // Endless loops wait for .live (set while on screen).
    for (const loop of ['breathe-pill', 'wifi', 'steam', 'strip']) {
      const rules = [...motion.matchAll(new RegExp(`([^{}]+)\\{[^}]*animation:[^;]*\\b${loop}\\b[^;]*infinite`, 'g'))].map((m) => m[1]);
      expect(rules.length, loop).toBeGreaterThan(0);
      for (const r of rules) expect(r, loop).toMatch(/\.live|data-screen="island"/);
    }
    const js = built('assets/site.js');
    expect(js).toMatch(/function heroTilt\(\) \{[\s\S]*?if \(!box \|\| calm\.matches\) return;/);
    expect(js).toMatch(/function slideshow\([^)]*\) \{[\s\S]*?if \(calm\.matches/);
    expect(js).toMatch(/function statement\(\) \{[\s\S]*?if \(!box \|\| calm\.matches\) return;/);
    expect(existsSync(path.join(ROOT, 'test/e2e/site-layout.cjs'))).toBe(true);
  });

  it('draws from one scale: radii, section spacing and the head-to-content gap', () => {
    const css = built('assets/site.css');
    expect(css).toMatch(/--r-sm:12px; --r-md:16px; --r-xl:28px;/);
    expect(css).toContain('section { padding:var(--section) 0 0; }');
    expect(css).toContain('main .head + * { margin-top:var(--head-gap); }');
    // Panels and cards take their corners from the scale (device artwork draws its own).
    const SURFACES = ['.card', '.promise', '.os', '.window', '.pnl', '.shell', '.shell-bar', '.faq details', '.plat', '.pick', '.mono-band', '.diagram', '.lid-demo', '.isl-stage', '.closing', '.meter', '.total', '.sdemo', '.compare', '.table', '.callout', '.verify-note', '.fparts li', '.cats label', '.sw', '.steps > li', '.app-card', '.signed', '.pill-nav'];
    for (const m of css.matchAll(/(^|\})\s*([^{}@]+)\{([^}]*)\}/g)) {
      const sels = m[2].split(',').map((x) => x.trim());
      const r = m[3].match(/border-radius:([^;]+)/);
      if (!r || !sels.some((x) => SURFACES.includes(x))) continue;
      expect(r[1].trim(), m[2].trim()).toMatch(/^var\(--(radius|r-sm|r-md|r-xl)\)$|^999px$/);
    }
    // A flipped spotlight swaps the two column widths, so the pairs mirror.
    expect(css).toContain('.spot.flip { grid-template-columns:minmax(0, 1.2fr) minmax(0, .8fr); }');
  });
});

describe('website workflow', () => {
  type Step = { name?: string; uses?: string; with?: Record<string, unknown>; run?: string; env?: Record<string, string>; if?: string };
  type Job = { concurrency?: { group?: string }; steps?: Step[] };
  const site = yaml.load(readFileSync(path.join(ROOT, '.github/workflows/site.yml'), 'utf8')) as { on: Record<string, { paths?: string[]; branches?: string[] } | null>; permissions: Record<string, string>; concurrency: { group: string; 'cancel-in-progress': boolean }; jobs: Record<string, Job> };
  const release = yaml.load(readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8')) as { jobs: Record<string, Job> };
  const land = yaml.load(readFileSync(path.join(ROOT, '.github/workflows/sign-and-land.yml'), 'utf8')) as { jobs: Record<string, Job> };

  it('runs on pushes to main that touch the site, on releases and by hand', () => {
    expect(Object.keys(site.on).sort()).toEqual(['push', 'release', 'workflow_dispatch']);
    expect(site.on.push?.branches).toEqual(['main']);
    for (const p of ['site/**', 'README.md', 'CHANGELOG.md', 'docs/**']) expect(site.on.push?.paths).toContain(p);
    expect(site.permissions).toEqual({ contents: 'read', pages: 'write', 'id-token': 'write' });
  });

  it('builds without installing anything and deploys with Pages from Actions, committing nothing', () => {
    const steps = site.jobs.build.steps ?? [];
    const raw = JSON.stringify(steps);
    expect(raw).not.toMatch(/npm (ci|install)/);
    expect(raw).toContain('node site/build.mjs --out');
    expect(raw).not.toMatch(/git (commit|push)/);
    expect(steps.some((s) => s.uses?.startsWith('actions/upload-pages-artifact@'))).toBe(true);
    expect((site.jobs.deploy as Job & { environment?: { name?: string } }).environment?.name).toBe('github-pages');
    expect((site.jobs.deploy.steps ?? []).some((s) => s.uses?.startsWith('actions/deploy-pages@'))).toBe(true);
  });

  it('serves the package repositories the release stores on gh-pages, and only those', () => {
    const add = (site.jobs.build.steps ?? []).find((s) => s.name === 'Add the package repositories from gh-pages');
    expect(add?.run).toContain('for p in rpm keeper-release.asc KEYS');
    expect(add?.run).toContain('git archive FETCH_HEAD');
    // The release stores them, then starts a deploy so the website shows the new version.
    const web = release.jobs.website;
    expect(web?.steps?.[0]?.run).toContain('gh workflow run site.yml --ref main');
    expect(release.jobs.pages.concurrency?.group).toBe('gh-pages');
  });

  it('is started by sign-and-land when a landed change touches the site', () => {
    const steps = land.jobs.land.steps ?? [];
    const start = steps.find((s) => s.run?.includes('gh workflow run site.yml'));
    expect(start?.if).toContain("steps.land.outputs.site == 'true'");
    expect(JSON.stringify(steps)).toContain('site=true');
  });
});
