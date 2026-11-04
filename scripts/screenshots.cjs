// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Fresh screenshots for the README and docs, in light and dark, at 1440×900.
//
//   npx vite build && node scripts/build-main.mjs        (the real app needs a build)
//   xvfb-run -a -s "-screen 0 1920x1200x24" node scripts/screenshots.cjs [options]
//
// Options:
//   --only a,b,c    only these shot ids (see SHOTS below); "hero" builds only the banner
//   --skip-app      leave out the shots taken in the real app
//   --skip-demo     leave out the shots taken in the browser demo
//   --no-hero       do not rebuild the hero banner
//   --out <dir>     where the images go (default docs/screenshots)
//   --raw <dir>     also keep the unoptimised PNGs there
//   --themes-out <dir>  where the website's theme pictures go (default site/assets/themes)
//
// Two sources, like the end-to-end tests:
//   • the real app (Electron) on a throwaway, realpath'd home folder with sample files
//     (test/e2e/make-samples.cjs), a small notes vault and a terminal, with KEEPER_SKIP_TOUR=1
//     and usage stats off: only what the demo cannot draw (Quick Look, Notes, the Terminal);
//     the build machine's own drives are left out of the sidebar;
//   • the browser demo (`npx vite`, sample data from src/mock*.ts) for everything else, so no
//     real computer, person or folder shows. Each page's parts are switched on for its shot.
//     Keeper's windows of their own (Quick Search, the clipboard, the Ask prompt, the menu bar,
//     page windows and light apps) are the demo in a frame at their real size on a wallpaper;
//     the capture preview, a pin, the scrolling bar (electron/services/capture-more.ts), Draw on
//     screen (core/stage/draw.ts) and a share link's page (core/share-page.ts) are drawn from
//     the app's own HTML. Other companies' apps and devices in the sample data become plain
//     names (NEUTRAL) before a picture is taken.
//     The demo is drawn by Electron's own Chromium, so no extra browser is needed.
//   • the website's theme switcher: Hello in a dozen themes, written to site/assets/themes at
//     1280×800.
//
// Every image is written as WebP (GitHub shows WebP in READMEs); the hero banner is
// composed from scripts/hero.html and the fresh screenshots, rendered to PNG first.
//
// The same file is also the tiny Electron "browser" for the demo and the banner: when
// Electron starts it, it opens one frameless 1440×900 window on the URL it is given.

/* eslint-disable no-console */
const path = require('path');

// ---------------------------------------------------------------- Electron shell mode
if (process.versions.electron && process.type === 'browser') {
  const { app, BrowserWindow } = require('electron');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.commandLine.appendSwitch('hide-scrollbars');
  app.whenReady().then(() => {
    const url = process.argv.find((a) => /^(https?|file):/.test(a));
    const w = new BrowserWindow({ width: 1440, height: 900, useContentSize: true, frame: false, show: true, backgroundColor: '#00000000', transparent: true, webPreferences: { contextIsolation: true, sandbox: true } });
    void w.loadURL(url || 'about:blank');
  });
  return;
}

// ---------------------------------------------------------------- driver
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn, spawnSync, execFileSync } = require('child_process');
let _electron;
try {
  ({ _electron } = require('playwright'));
} catch {
  console.error('Playwright is needed: npm i -D playwright (or put a global install on NODE_PATH).');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules/.bin/electron');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name) => argv.includes(name);
const OUT = path.resolve(ROOT, opt('--out') || 'docs/screenshots');
const ONLY = opt('--only') ? new Set(opt('--only').split(',')) : null;
const KEEP_RAW = opt('--raw') ? path.resolve(opt('--raw')) : null;
const W = 1440;
const H = 900;
const MODES = ['light', 'dark'];

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-shots-')));
const RAW = KEEP_RAW || path.join(TMP, 'raw');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (id) => !ONLY || ONLY.has(id);
const log = (...a) => console.log('[shots]', ...a);
const written = [];

// Clean screenshots: no scrollbars, no blinking caret, no animations caught half way.
const CLEAN_CSS = `*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}
*{caret-color:transparent!important}
*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important}`;
// Every one-time tip and the first-run tour, marked as seen.
const COACH_KEYS = ['tour', 'home', 'cleanup', 'devices', 'sync', 'terminal', 'vpn', 'firewall', 'protection', 'notes', 'tracks', 'mesh', 'rdc', 'agents', 'convert', 'health', 'awake', 'stage', 'catalog', 'cues', 'ambience', 'dictation', 'meetings', 'remote', 'noteshub', 'settings'];

async function clean(page) {
  await page.addStyleTag({ content: CLEAN_CSS }).catch(() => undefined);
  // Close any tip that is still on screen.
  for (const sel of ['.coach button', '.tour button:has-text("Skip tour")']) {
    const b = page.locator(sel);
    if (await b.count().catch(() => 0)) await b.first().click({ timeout: 1000 }).catch(() => undefined);
  }
}

// Keeper's published pictures never show other products by name. The names come from
// Keeper's own integration catalogues, read here as text (so none is spelled out in this
// file): the coding agents' command names, the multi-word names of the AI apps Keeper can
// connect to, and the notes apps Notes Everywhere syncs with. A shot that shows one is not
// saved, and the run says what was on screen.
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function thirdPartyNames() {
  const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } };
  const between = (text, start) => { const i = text.indexOf(start); return i < 0 ? '' : text.slice(i, text.indexOf('];', i)); };
  const agents = between(read('core/brain/agents.ts'), 'export const AGENT_CLIS');
  const labels = [...agents.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  const commands = [...agents.matchAll(/command: '([a-z]+)'/g)].map((m) => m[1]).filter((c) => c.length >= 5);
  const apps = [...read('core/brain/apps.ts').matchAll(/\{ id: '[^']+', label: '([^']+)', format:/g)].map((m) => m[1]).filter((l) => l.includes(' '));
  const notes = [...between(read('core/notes-sync/connectors/registry.ts'), 'export const CONNECTORS').matchAll(/name: '([^']+)'/g)]
    .map((m) => m[1].replace(/\s*\(.*\)$/, '')).filter((n) => !/^(Markdown|Keeper)\b/.test(n));
  const words = commands.length ? new RegExp(`\\b(${commands.map(esc).join('|')})\\b`, 'i') : null;
  const exact = [...new Set([...labels, ...apps, ...notes])];
  const names = exact.length ? new RegExp(`\\b(${exact.map(esc).join('|')})\\b`) : null;
  return { labels, test: (t) => (words && t.match(words)) || (names && t.match(names)) };
}
const THIRD_PARTY = thirdPartyNames();

async function save(page, name, clip, { transparent = false, internal = false } = {}) {
  const area = clip || { x: 0, y: 0, width: W, height: H };
  await relabel(page);
  // Only the text that is really drawn inside the picture counts (windows drawn in frames: all of their text).
  const inFrames = (await Promise.all(page.frames().filter((f) => f !== page.mainFrame()).map((f) => f.evaluate(() => document.body?.innerText ?? '').catch(() => '')))).join('\n');
  const text = inFrames + '\n' + await page.evaluate((c) => {
    const out = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const el = n.parentElement;
      const cs = el && getComputedStyle(el);
      if (!el || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      range.selectNodeContents(n);
      const visible = [...range.getClientRects()].some((r) => r.width > 0 && r.right > c.x && r.left < c.x + c.width && r.bottom > c.y && r.top < c.y + c.height);
      if (visible) out.push(n.nodeValue);
    }
    // What form controls show is not a text node of their own.
    for (const el of document.querySelectorAll('select, input, textarea')) {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.right > c.x && r.left < c.x + c.width && r.bottom > c.y && r.top < c.y + c.height)) continue;
      out.push(el.tagName === 'SELECT' ? el.selectedOptions[0]?.text ?? '' : el.value || el.placeholder || '');
    }
    return out.join('\n');
  }, area).catch(() => '');
  const bad = THIRD_PARTY.test(text);
  if (bad) {
    const line = text.split('\n').find((l) => THIRD_PARTY.test(l)) ?? '';
    throw new Error(`"${bad[0]}" is on screen ("${line.trim().slice(0, 100)}"); pick another view`);
  }
  const file = path.join(RAW, `${name}.png`);
  await page.screenshot({ path: file, clip: clip || { x: 0, y: 0, width: W, height: H }, omitBackground: transparent });
  if (!internal) written.push(file);
  log('captured', name);
}

// ---------------------------------------------------------------- sample home for the real app
function makeHome() {
  const HOME = path.join(TMP, 'home');
  const d = (...p) => { const x = path.join(HOME, ...p); fs.mkdirSync(x, { recursive: true }); return x; };
  for (const f of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos']) d(f);
  const SAMPLES = path.join(HOME, 'Documents', 'Samples');
  execFileSync(process.execPath, [path.join(ROOT, 'test/e2e/make-samples.cjs'), SAMPLES], { stdio: 'ignore' });
  // A few files elsewhere, so the shelves and recent downloads have something in them.
  const copy = (from, to) => { try { fs.copyFileSync(path.join(SAMPLES, from), to); } catch { /* the sample may not exist on this system */ } };
  copy('02 photo.jpg', path.join(HOME, 'Pictures', 'Lisbon tram.jpg'));
  copy('01 picture.png', path.join(HOME, 'Pictures', 'Screenshot 2026-10-28 at 09.14.png'));
  copy('05 modern.webp', path.join(HOME, 'Pictures', 'Moodboard.webp'));
  copy('08 report.pdf', path.join(HOME, 'Downloads', 'Invoice October.pdf'));
  copy('08 report.pdf', path.join(HOME, 'Documents', 'Quarterly report.pdf'));
  for (const f of fs.readdirSync(SAMPLES)) if (/\.(docx|xlsx|zip|mp3|mp4|md|csv)$/i.test(f)) copy(f, path.join(HOME, 'Downloads', f.replace(/^\d+\s+/, '')));
  // A tidy prompt and coloured listings for the terminal shot (the host's name never shows).
  fs.writeFileSync(path.join(HOME, '.bashrc'), [
    'eval "$(dircolors -b 2>/dev/null)"',
    "alias ls='ls --color=auto'",
    "PS1='\\[\\e[1;35m\\]keeper\\[\\e[0m\\] \\[\\e[34m\\]\\w\\[\\e[0m\\] \\$ '",
    '',
  ].join('\n'));
  // Terminals start login shells, which read .bash_profile.
  fs.writeFileSync(path.join(HOME, '.bash_profile'), '[ -f ~/.bashrc ] && . ~/.bashrc\n');
  fs.writeFileSync(path.join(HOME, 'Desktop', 'Packing list.md'), '# Packing list\n\n- passport\n- charger\n- rain jacket\n');

  // A small notes vault with links, tags and a task list.
  const V = d('Documents', 'Field Notes');
  const n = (rel, text) => { const p = path.join(V, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  n('Welcome.md', '---\ntags: [start]\n---\n# Welcome\n\nThis vault is plain Markdown. Start with [[Garden plan]] or the [[Reading list]].\n\n> [!tip] Links follow renames\n> Rename a note and every `[[link]]` to it is rewritten.\n');
  n('Garden plan.md', '---\ntags: [project, garden]\nstatus: active\n---\n# Garden plan\n\nTulip bulbs go in before the first frost, in **October**. See [[Welcome]] and the [[Reading list]].\n\n## Steps\n- [x] Order bulbs\n- [x] Clear the north bed\n- [ ] Plant tulips and crocus\n- [ ] Mulch before November #todo\n\n> [!note] Frost dates\n> The first frost here is usually in ==late October==.\n\n## Beds\n- **North**: tulips, crocus\n- **South**: garlic, shallots\n');
  n('Reading list.md', '---\ntags: [books]\n---\n# Reading list\n\n- [[Books/Dune]] ✓\n- [[Books/Emma]] — reading\n- [[Books/Hyperion]]\n\n==Next up:== something short for the train.\n');
  n('Books/Dune.md', '---\ntags: [book]\nauthor: Frank Herbert\nstatus: done\n---\n# Dune\n');
  n('Books/Emma.md', '---\ntags: [book]\nauthor: Jane Austen\nstatus: reading\n---\n# Emma\n');
  n('Books/Hyperion.md', '---\ntags: [book]\nauthor: Dan Simmons\nstatus: next\n---\n# Hyperion\n');
  n('Daily/2026-10-31.md', '# Friday\n\n- Call the plumber\n- [[Garden plan]]: bulbs arrived\n');
  return { HOME, SAMPLES, VAULT: V };
}

// ---------------------------------------------------------------- the real app
async function realApp(shots) {
  const { HOME, SAMPLES, VAULT } = makeHome();
  const DATA = path.join(HOME, '.config', 'Keeper');
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({
    folders: ['Documents', 'Downloads', 'Pictures', 'Desktop', 'Music', 'Videos'].map((f) => path.join(HOME, f)),
    theme: 'playful',
    appearance: 'light',
    usageStats: false,
    updates: { mode: 'manual' },
  }));
  const lsColors = (spawnSync('dircolors', ['-b'], { encoding: 'utf8' }).stdout || '').match(/LS_COLORS='([^']*)'/)?.[1] ?? '';
  const env = { ...process.env, LS_COLORS: lsColors, HOME, XDG_CONFIG_HOME: path.join(HOME, '.config'), XDG_DATA_HOME: path.join(HOME, '.local/share'), SHELL: '/bin/bash', NODE_OPTIONS: '', KEEPER_SKIP_TOUR: '1', KEEPER_TELEMETRY: '0', DO_NOT_TRACK: '1', LANG: 'en_US.UTF-8' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: ELECTRON, args: [ROOT, '--no-sandbox', '--force-device-scale-factor=1'], env });
  let main;
  for (let i = 0; i < 120 && !main; i++) {
    main = app.windows().find((x) => x.url().includes('view=app'));
    if (!main) await sleep(500);
  }
  if (!main) throw new Error('the main window did not open');
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await app.evaluate(({ BrowserWindow }, size) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('view=app')) { w.setContentSize(size.w, size.h); w.center(); w.focus(); }
  }, { w: W, h: H });
  await main.evaluate((keys) => { for (const k of keys) localStorage.setItem(`coach.${k}`, '1'); }, COACH_KEYS);
  // The build machine's own disks and mounts (tool volumes in a container, for example) are
  // not part of the picture: only the sample home's own places stay in the sidebar while the
  // shots are taken. On a real computer these would be your own drives.
  await main.evaluate(() => {
    const keep = /^(Hello|Recent|Recents|Starred|Shared|Home|Desktop|Documents|Downloads|Music|Pictures|Videos|Movies|Trash|Network|Connect a cloud.*)$/;
    const hide = () => document.querySelectorAll('.place-row').forEach((r) => {
      const label = (r.querySelector('.label')?.textContent ?? r.textContent ?? '').trim();
      if (!keep.test(label)) r.style.display = 'none';
    });
    hide();
    new MutationObserver(hide).observe(document.body, { childList: true, subtree: true });
  }).catch((e) => console.error('[shots] could not tidy the sidebar:', e.message));
  await main.evaluate((v) => window.keeper.notes?.addVault?.(v), VAULT).catch(() => undefined);
  // Let the first scan finish so Home has its shelves.
  await sleep(6000);
  const nav = async (r) => {
    await app.evaluate(({ BrowserWindow }, route) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('event:navigate', route)), r);
    await sleep(900);
  };
  const ctx = { app, page: main, nav, HOME, SAMPLES, VAULT, sleep, engine: 'app' };
  try {
    for (const mode of MODES) {
      await main.emulateMedia({ colorScheme: mode });
      await main.evaluate((m) => window.keeper.settings.set({ appearance: m }), mode);
      await sleep(600);
      for (const s of shots) {
        try {
          await nav(s.route ?? 'home');
          await clean(main);
          if (s.prep) await s.prep(ctx, mode);
          await clean(main);
          await sleep(s.wait ?? 700);
          await save(main, `${s.id}-${mode}`, s.clip);
          if (s.after) await s.after(ctx, mode);
        } catch (e) {
          console.error(`[shots] ${s.id}-${mode} failed:`, e.message.split('\n')[0]);
          await main.keyboard.press('Escape').catch(() => undefined);
        }
      }
    }
  } finally {
    await app.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- the browser demo
async function startVite() {
  const port = 5190 + Math.floor(Math.random() * 400);
  const child = spawn(path.join(ROOT, 'node_modules/.bin/vite'), ['--configLoader', 'runner', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, BROWSER: 'none' } });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 120; i++) {
    const ok = await new Promise((r) => http.get(url, (res) => { res.resume(); r(res.statusCode === 200); }).on('error', () => r(false)));
    if (ok) return { url, child };
    await sleep(500);
  }
  child.kill();
  throw new Error('vite did not start');
}

async function openShell(url) {
  const env = { ...process.env, NODE_OPTIONS: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: ELECTRON, args: [__filename, '--no-sandbox', url], env });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: W, height: H }).catch(() => undefined);
  return { app, page };
}

// The parts a page belongs to (and the parts they need), switched on in the demo for its shot:
// the demo starts with the recommended set, like a new Keeper.
function featuresFor(route) {
  const name = typeof route === 'string' ? route.split(':')[0] : route?.name;
  if (!name) return [];
  const { FEATURES } = coreModule('core/features.ts');
  const out = new Set();
  const add = (id) => { const f = FEATURES.find((x) => x.id === id); if (!f || out.has(id) || f.pro) return; out.add(id); for (const r of f.requires ?? []) add(r); };
  for (const f of FEATURES) if (f.routes?.includes(name)) add(f.id);
  return [...out];
}

async function demo(shots) {
  const vite = await startVite();
  // A blank page of the demo's own address, for windows drawn on the wallpaper alone (their
  // frames then keep their own storage).
  const BLANK = `${vite.url}__shots/blank.html`;
  const { app, page } = await openShell('about:blank');
  try {
    for (const mode of MODES) {
      for (const s of shots) {
        if (s.modes && !s.modes.includes(mode)) continue;
        try {
          const theme = s.theme ?? 'playful';
          const auto = featuresFor(s.route ?? (s.query?.view ? null : 'home'));
          const withFeatures = (query) => { const f = [...new Set([...auto, ...String(query.features ?? '').split(',').filter(Boolean)])].join(','); return f ? { ...query, features: f } : query; };
          const demoUrl = (query = {}) => `${vite.url}?${new URLSearchParams(withFeatures({ theme, appearance: mode, notour: '1', ...query }))}`;
          // The page to open on: the demo reopens the last place, like the app. The storage is
          // set from a static file of the same origin, so no running page saves over it.
          await page.goto(`${vite.url}favicon.svg`);
          await page.evaluate(({ keys, route }) => {
            for (const k of keys) localStorage.setItem(`coach.${k}`, '1');
            if (route) {
              const i = typeof route === 'string' ? route.indexOf(':') : -1;
              const r = typeof route !== 'string' ? route : i < 0 ? { name: route } : { name: route.slice(0, i), arg: route.slice(i + 1) };
              localStorage.setItem('place', JSON.stringify({ route: r, history: [], scroll: {}, at: Date.now() }));
            }
            // The demo reopens its saved tabs before the last place: forget them.
            localStorage.removeItem('demo.session');
            sessionStorage.clear();
          }, { keys: COACH_KEYS, route: s.query?.view ? null : s.route ?? 'home' });
          await page.emulateMedia({ colorScheme: mode });
          if (s.backdrop === 'wall') {
            // Only windows of their own (drawn in frames by the shot) on the wallpaper.
            await page.route(BLANK, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>' }));
            await page.goto(BLANK);
            await wallpaper(page, mode);
          } else {
            await page.goto(demoUrl(s.query));
            await page.waitForSelector(s.query?.view ? 'body' : '.sidebar', { timeout: 30_000 });
            await sleep(1200);
          }
          await clean(page);
          const got = s.prep ? await s.prep({ page, sleep, engine: 'demo', demoUrl, mode, url: vite.url }, mode) : null;
          await clean(page);
          await sleep(s.wait ?? 600);
          await save(page, `${s.id}-${mode}`, got?.width ? got : s.clip, s);
        } catch (e) {
          console.error(`[shots] ${s.id}-${mode} failed:`, e.message.split('\n')[0]);
        }
      }
    }
  } finally {
    await app.close().catch(() => undefined);
    vite.child.kill();
  }
}

// ---------------------------------------------------------------- the shots
const click = (page, sel, opts) => page.locator(sel).first().click({ timeout: 8000, ...opts });
const clickText = (page, scope, text) => page.locator(scope, { hasText: text }).first().click({ timeout: 8000 });

// The Island is drawn over a wallpaper, then cropped around it.
const WALL = {
  light: 'linear-gradient(135deg,#ffd9b8 0%,#ffb3c9 38%,#c7b8ff 100%)',
  dark: 'radial-gradient(1200px 600px at 30% 0%,#3b2a6b 0%,transparent 60%),radial-gradient(900px 600px at 90% 10%,#5a1f45 0%,transparent 55%),#0c0b14',
};
const wallpaper = (page, mode) => page.evaluate((bg) => {
  // Inline and important, so it wins over the transparent window background.
  for (const el of [document.documentElement, document.body]) el.style.setProperty('background', bg, 'important');
  document.documentElement.style.setProperty('min-height', '100vh', 'important');
}, WALL[mode]);
const islandPrep = (open, width, bare = false) => async ({ page, sleep }, mode) => {
  if (!bare) await wallpaper(page, mode);
  await page.waitForSelector('.isl', { timeout: 15_000 });
  await sleep(800);
  if (open) {
    await page.locator('.isl').first().click();
    await sleep(900);
    if (open === 'panel') {
      const more = page.locator('.isl button', { hasText: /^More/ });
      if (await more.count()) { await more.first().click(); await sleep(900); }
    }
  }
  await sleep(600);
  // Crop around the Island (and its bubble), centred, with room for the shadow.
  // The picture is the given width, centred on the Island itself; its height takes in the bubble below.
  const r = await page.evaluate(() => {
    const isl = document.querySelector('.isl');
    const own = isl.getBoundingClientRect();
    const rects = [isl, ...isl.parentElement.children].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0 && b.width < innerWidth - 40);
    const y1 = Math.max(...rects.map((b) => b.bottom));
    return { x: own.left, y: own.top, w: own.width, h: y1 - own.top };
  });
  const w = width;
  const x = Math.max(0, Math.min(1440 - w, Math.round(r.x + r.w / 2 - w / 2)));
  return { x, y: 0, width: w, height: Math.min(900, Math.ceil(r.y + r.h + 56)) };
};

// Keeper's published pictures show plain names, not other companies' apps, services or
// devices: the demo's sample data names a few (as a real computer would), and here they
// become plain descriptions in every frame before a picture is taken. The coding agents'
// names come from Keeper's own catalogue (THIRD_PARTY above).
const NEUTRAL = [
  ['Google Chrome Helper', 'Browser Helper'], ['Google Chrome', 'Web Browser'], ['Chrome', 'Browser'], ['Brave', 'Browser'], ['Safari', 'Web Browser'], ['Firefox', 'Web Browser'],
  ['Spotify', 'Music'], ['Dropbox', 'Cloud Sync'], ['Notion', 'Notebook'], ['Slack', 'Team Chat'], ['Telegram', 'Messenger'],
  ['Zoom', 'Video Calls'], ['ChatGPT', 'Chat'], ['Steam', 'Games'], ['Figma', 'Sketchpad'], ['figma.com', 'sketch.example.com'],
  ['iCloud Drive', 'Cloud Drive'], ['Proton Drive', 'Private Drive'], ['Google Drive', 'Team Drive'], ['AirDrop', 'Nearby'],
  ['Demo’s MacBook Pro', 'Studio Laptop'], ["Demo's MacBook Pro", 'Studio Laptop'], ['KINGSTON', 'USB Drive'], ['umbrel', 'Home Server'],
  ['python3.12', 'sync-helper'], ['ask Claude', 'ask your AI'], ['Claude', 'your AI'],
];
// Whole words that are a real program's name only when they stand alone (a process list).
const NEUTRAL_EXACT = { node: 'Helper', WindowServer: 'Window Manager', 'Photos Agent': 'Photo Helper', python: 'Helper', python3: 'Helper' };
const relabel = async (page) => {
  for (const frame of page.frames()) {
    await frame.evaluate(({ labels, pairs, exact }) => {
      if (!document.body) return;
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const swap = (v) => {
        let out = v.replace(/\S+ in Keeper’s Assistant/g, 'Keeper’s Assistant');
        for (const l of labels) if (out.includes(l)) out = out.split(l).join('Coding agent');
        for (const [from, to] of pairs) if (out.includes(from)) out = out.split(from).join(to);
        return out;
      };
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const t = n.nodeValue.trim();
        if (exact[t]) { n.nodeValue = n.nodeValue.replace(t, exact[t]); continue; }
        const v = swap(n.nodeValue);
        if (v !== n.nodeValue) n.nodeValue = v;
      }
      for (const el of document.querySelectorAll('input, textarea')) { const v = swap(el.value); if (v !== el.value) el.value = v; }
      for (const el of document.querySelectorAll('[title], [aria-label]')) for (const k of ['title', 'aria-label']) { const v = el.getAttribute(k); if (v && swap(v) !== v) el.setAttribute(k, swap(v)); }
    }, { labels: THIRD_PARTY.labels, pairs: NEUTRAL, exact: NEUTRAL_EXACT }).catch(() => undefined);
  }
};

// The demo asks for an approval a few seconds in; it is not what these shots are about.
const hideApproval = async ({ page }) => { await page.addStyleTag({ content: '.approval,.approval-back{display:none!important}' }); };

// ---- windows of their own, drawn on the picture
// Keeper's small windows (Quick Search, the clipboard, the Ask prompt, a page window…) are
// the demo itself in a frame at the window's real size; the capture preview, a pin, the
// scrolling bar, Draw on screen and a share page are drawn from the app's own HTML.
let winSeq = 0;
// The app's own HTML is served from the page's own address (a frame from srcdoc would take on
// the demo's content security policy, which allows no inline scripts).
async function htmlUrl(page, id, html) {
  const base = /^https?:/.test(page.url()) ? new URL(page.url()).origin : 'http://127.0.0.1:9';
  const url = `${base}/__shots/${id}.html`;
  await page.route(url, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  return url;
}
async function floatWin(page, o) {
  const id = `kwin${++winSeq}`;
  await page.evaluate(({ id, o }) => {
    const f = document.createElement('iframe');
    f.id = id;
    f.title = o.title ?? 'Keeper';
    Object.assign(f.style, {
      position: 'fixed', left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px`, border: '0', margin: '0',
      borderRadius: `${o.radius ?? 12}px`, background: o.bg ?? 'transparent', zIndex: String(2147480000 + (o.z ?? 0)),
      boxShadow: o.shadow === false ? 'none' : '0 28px 70px rgba(10,6,30,.38), 0 0 0 1px rgba(0,0,0,.08)',
      // The app's own HTML has no colour scheme: the frame must not have one either, or it is drawn opaque.
      ...(o.plain ? { colorScheme: 'normal' } : {}),
    });
    f.src = o.src;
    document.documentElement.appendChild(f);
  }, { id, o: { ...o, plain: !!o.html, src: o.html ? await htmlUrl(page, id, o.html) : o.src } });
  const frame = await (await page.waitForSelector(`#${id}`)).contentFrame();
  await frame.waitForLoadState('load').catch(() => undefined);
  await sleep(o.html ? 400 : 2200);
  await frame.addStyleTag({ content: CLEAN_CSS }).catch(() => undefined);
  return frame;
}

// A plain menu bar along the top of the wallpaper, with Keeper's owl in it.
const menubar = (page, mode) => page.evaluate(({ dark, icon }) => {
  const bar = document.createElement('div');
  Object.assign(bar.style, { position: 'fixed', left: '0', right: '0', top: '0', height: '28px', display: 'flex', alignItems: 'center', gap: '18px', padding: '0 16px', font: '600 13px system-ui, sans-serif', color: dark ? '#f4f1ff' : '#1d1530', background: dark ? 'rgba(20,14,40,.55)' : 'rgba(255,255,255,.55)', backdropFilter: 'blur(20px)', zIndex: '2147470000' });
  bar.innerHTML = `<span>Keeper</span><span style="font-weight:500;opacity:.8">File</span><span style="font-weight:500;opacity:.8">View</span><span style="flex:1"></span><img src="${icon}" width="18" height="18" alt="" style="border-radius:5px;outline:2px solid ${dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.18)'};outline-offset:3px"><span style="font-weight:500">Tue 9:41</span>`;
  document.documentElement.appendChild(bar);
}, { dark: mode === 'dark', icon: `data:image/svg+xml;base64,${fs.readFileSync(path.join(ROOT, 'public/favicon.svg')).toString('base64')}` });

/** The capture preview, pin and scrolling bar pages, as written in electron/services/capture-more.ts. */
function capturePages() {
  const src = fs.readFileSync(path.join(ROOT, 'electron/services/capture-more.ts'), 'utf8');
  const tpl = (start) => { const i = src.indexOf(start); if (i < 0) throw new Error(`capture-more.ts: no ${start}`); return src.slice(i + start.length, src.indexOf('`;', i)); };
  const CSP = (src.match(/const CSP = `([^`]*)`/) || [])[1] ?? '';
  const FONT = (src.match(/const FONT = `([^`]*)`/) || [])[1] ?? 'system-ui';
  // eslint-disable-next-line no-new-func
  const fill = (body, mac) => new Function('CSP', 'FONT', 'mac', `return \`${body}\`;`)(CSP, FONT, mac);
  return { preview: fill(tpl('const PREVIEW_PAGE = () => `')), pin: fill(tpl('const PIN_PAGE = (mac: boolean) => `'), true), bar: fill(tpl('const BAR_PAGE = `')) };
}

/** A module from core/, bundled on the fly (Draw on screen's sheet, the share page). */
const coreCache = new Map();
function coreModule(file) {
  if (coreCache.has(file)) return coreCache.get(file);
  const esbuild = require(path.join(ROOT, 'node_modules/esbuild'));
  const out = esbuild.buildSync({ entryPoints: [path.join(ROOT, file)], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, require);
  coreCache.set(file, m.exports);
  return m.exports;
}

const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const openFirst = async (page, sel, sleep, ms = 1200) => { const l = page.locator(sel); if (await l.count()) { await l.first().click({ timeout: 4000 }).catch(() => undefined); await sleep(ms); } };
// The Island's colour shots: the open Island with music playing, in a theme.
const islandColour = (theme, extra = {}) => ({ engine: 'demo', theme, query: { view: 'island', island: 'music', screen: 'notch', ...extra }, prep: islandPrep(true, 900) });

const SHOTS = [
  // ---- the real app (only what the demo cannot draw: a real preview, a vault on disk, a shell)
  {
    id: 'quicklook', engine: 'app', prep: async ({ page, nav, SAMPLES, sleep }) => {
      await nav('browse:' + SAMPLES);
      await page.waitForSelector('.file-card, .file-list tbody tr', { timeout: 20000 });
      await page.locator('.file-card, .file-list tbody tr', { hasText: 'deck.pptx' }).first().click();
      await page.keyboard.press('Space');
      await page.waitForSelector('.ql', { timeout: 10000 });
      await sleep(1500);
    },
    after: async ({ page }) => { await page.keyboard.press('Escape'); },
  },
  {
    id: 'notes', engine: 'app', route: 'notes', prep: async ({ page, sleep }) => {
      const open = page.locator('.nt-vault-open', { hasText: 'Field Notes' });
      if (await open.count()) await open.first().click();
      await page.waitForSelector('.nt-tree-row', { timeout: 15000 });
      const row = page.locator('.nt-tree-row[data-path="Garden plan.md"]');
      if (await row.count()) await row.first().click();
      await sleep(1000);
      // Reading view: callouts, highlights and tasks drawn as they will be read.
      await page.locator('button', { hasText: /^Read$/ }).first().click({ timeout: 3000 }).catch(() => undefined);
      await sleep(1000);
    },
  },
  {
    id: 'terminal', engine: 'app', route: 'terminal', prep: async ({ page, sleep, SAMPLES }) => {
      await page.waitForSelector('.term-pane .xterm', { timeout: 30000 });
      await sleep(1200);
      await page.locator('.term-host').first().click();
      const cmd = `clear; ls --color=always ~; cd "${SAMPLES}"; ls --color=always -C | head -n 8; printf '\\n'; for c in 1 2 3 4 5 6; do printf "\\033[3%sm■■ \\033[9%sm■■  " $c $c; done; printf '\\033[0m\\n\\n'; echo "Keeper by Ashforde® — terminals keep running when the window closes"`;
      await page.keyboard.type(cmd + '\n', { delay: 2 });
      await sleep(2000);
    },
  },

  // ---- the browser demo: pages
  { id: 'home', engine: 'demo', route: 'home', wait: 1500 },
  { id: 'hello', engine: 'demo', route: 'home', prep: async ({ page, sleep }) => { await sleep(800); await openFirst(page, '.home-recent-item', sleep); } },
  { id: 'files', engine: 'demo', route: 'browse:/Users/demo/Documents', wait: 1500 },
  { id: 'everywhere', engine: 'demo', route: 'library', wait: 1500 },
  { id: 'search', engine: 'demo', route: { name: 'search', q: 'screenshots with wifi password' }, prep: async ({ page, sleep }) => { await sleep(1200); await page.locator('.main .file-card').first().click({ timeout: 4000 }).catch(() => undefined); await sleep(900); } },
  { id: 'convert', engine: 'demo', route: 'convert', prep: async ({ page, sleep }) => { await clickText(page, '.conv-cats button, [role=tab]', 'Pictures').catch(() => undefined); await sleep(900); } },
  { id: 'monitor', engine: 'demo', route: 'health', wait: 2500 },
  { id: 'monitor-history', engine: 'demo', route: 'health:history', query: { features: 'monitorHistory' }, wait: 2500 },
  { id: 'awake', engine: 'demo', route: 'awake', wait: 1200 },
  { id: 'settingsplus', engine: 'demo', route: 'catalog', query: { features: 'settingsCatalog' }, wait: 1500 },
  { id: 'themes', engine: 'demo', route: 'settings:appearance', wait: 1500 },
  { id: 'features', engine: 'demo', route: 'settings:features', wait: 1500 },
  {
    id: 'app-icons', engine: 'demo', route: 'settings:features', query: { features: 'soloApps' }, prep: async ({ page, sleep }) => {
      await sleep(1200);
      await page.evaluate(() => { const h = [...document.querySelectorAll('.main *')].find((e) => /^app icons$/i.test(e.textContent?.trim() ?? '') && e.children.length === 0); h?.scrollIntoView({ block: 'start' }); }).catch(() => undefined);
      await sleep(800);
    },
  },
  { id: 'duplicates', engine: 'demo', route: 'duplicates', prep: async ({ page, sleep }) => { await page.locator('.main button', { hasText: /Find duplicates|Scan/ }).first().click({ timeout: 4000 }).catch(() => undefined); await sleep(2500); } },
  { id: 'space', engine: 'demo', route: 'space', wait: 2000 },
  { id: 'agents', engine: 'demo', route: 'agents:permissions', prep: hideApproval },
  {
    id: 'computer-use', engine: 'demo', route: 'agents:permissions', query: { computer: '1' }, prep: async (ctx) => {
      await hideApproval(ctx);
      await ctx.page.waitForSelector('.browser-agent', { timeout: 10000 });
      await ctx.page.evaluate(() => document.querySelector('.browser-agent').scrollIntoView({ block: 'start' }));
      await ctx.sleep(800);
    },
  },
  { id: 'network', engine: 'demo', route: 'firewall', wait: 2000 },
  { id: 'firewall', engine: 'demo', route: 'firewall', wait: 1500, prep: async ({ page, sleep }) => { await clickText(page, '.fw-tabs button, .fw-tabs [role=tab], [role=tab]', 'Rules').catch(() => undefined); await sleep(1200); } },
  {
    id: 'network-ask', engine: 'demo', route: 'firewall', prep: async ({ page, demoUrl, sleep }) => {
      await sleep(1200);
      await floatWin(page, { src: demoUrl({ view: 'netask' }), x: 1440 - 380 - 16, y: 64, w: 380, h: 250, radius: 14 });
      await sleep(600);
    },
  },
  { id: 'privacy', engine: 'demo', route: 'security', wait: 1500 },
  { id: 'tracks', engine: 'demo', route: 'tracks', wait: 2000 },
  { id: 'rdc', engine: 'demo', route: 'rdc' },
  { id: 'devices', engine: 'demo', route: 'devices' },
  { id: 'help-mode', engine: 'demo', route: 'devices:help', query: { features: 'remoteHelp' }, prep: async ({ page, sleep }) => { await page.waitForSelector('[data-testid="help-card"]', { timeout: 10000 }); await sleep(600); } },
  {
    id: 'mesh', engine: 'demo', route: 'mesh', prep: async ({ page, sleep }) => {
      const on = page.locator('button', { hasText: 'Turn on Keeper Mesh' });
      if (await on.count()) { await on.first().click(); await sleep(1500); }
    },
  },
  { id: 'stage', engine: 'demo', route: 'stage' },
  { id: 'dictation', engine: 'demo', route: 'dictation' },
  { id: 'meetings', engine: 'demo', route: 'meetings' },
  { id: 'cues', engine: 'demo', route: 'cues' },
  { id: 'ambience', engine: 'demo', route: 'ambience', wait: 1500 },
  { id: 'weather', engine: 'demo', route: 'weather', wait: 2000 },
  { id: 'mail', engine: 'demo', route: 'mail', query: { features: 'mail' }, wait: 2500 },
  { id: 'calendar', engine: 'demo', route: 'calendar', wait: 1500 },
  { id: 'journal', engine: 'demo', route: 'journal', query: { features: 'notes,journal' }, prep: async ({ page, sleep }) => { await openFirst(page, '[data-testid="jr-start"]', sleep, 1800); } },
  { id: 'reader', engine: 'demo', route: 'reader', query: { features: 'reader' }, prep: async ({ page, sleep }) => { await openFirst(page, '.rd-item, .reader-item, [data-testid^="rd-item"], li:has-text("How to plant bulbs")', sleep, 1500); } },
  { id: 'snippets', engine: 'demo', route: 'snippets', query: { features: 'textSnippets' }, wait: 1200 },
  { id: 'blocking', engine: 'demo', route: 'blocking', query: { features: 'focusBlock' }, wait: 1200 },
  { id: 'time', engine: 'demo', route: 'time', query: { features: 'timeTracking' }, wait: 1500 },
  { id: 'capture', engine: 'demo', route: 'capture', wait: 1200 },
  { id: 'web-capture', engine: 'demo', route: 'capture', prep: async ({ page, sleep }) => { await openFirst(page, '[data-testid="capture-webpage"]', sleep, 1500); } },
  { id: 'studio', engine: 'demo', route: 'studio', query: { features: 'studio' }, wait: 1200 },
  { id: 'monitors', engine: 'demo', route: 'monitors', query: { features: 'monitors' }, wait: 2000 },
  { id: 'alerts', engine: 'demo', route: 'alerts', query: { features: 'phoneAlerts' }, wait: 1500 },
  { id: 'photo', engine: 'demo', route: 'photo:/Users/demo/Pictures/Lisbon.jpg', query: { features: 'photoEditor' }, wait: 2000 },

  // ---- the browser demo: windows of their own
  {
    id: 'launcher', engine: 'demo', backdrop: 'wall', prep: async ({ page, demoUrl, sleep }) => {
      const f = await floatWin(page, { src: demoUrl({ view: 'quick' }), x: 380, y: 150, w: 680, h: 460, radius: 16 });
      await f.locator('input').first().fill('12 * 7 + 5').catch(() => undefined);
      await sleep(1200);
    },
  },
  {
    id: 'clipboard', engine: 'demo', backdrop: 'wall', prep: async ({ page, demoUrl }) => {
      await floatWin(page, { src: demoUrl({ view: 'clips' }), x: 490, y: 160, w: 460, h: 520, radius: 16 });
    },
  },
  {
    id: 'selection', engine: 'demo', route: 'reader', query: { features: 'reader' }, prep: async ({ page, demoUrl, sleep }) => {
      await openFirst(page, 'li:has-text("How to plant bulbs")', sleep, 1500);
      await floatWin(page, { src: demoUrl({ view: 'selection' }), x: 820, y: 300, w: 460, h: 132, radius: 14 });
    },
  },
  {
    id: 'blocking-window', engine: 'demo', backdrop: 'wall', prep: async ({ page, demoUrl }) => {
      await floatWin(page, { src: demoUrl({ view: 'blocked' }), x: 510, y: 250, w: 420, h: 300, radius: 14 });
    },
  },
  {
    id: 'menubar', engine: 'demo', backdrop: 'wall', clip: { x: 840, y: 0, width: 600, height: 900 }, prep: async ({ page, demoUrl }, mode) => {
      await menubar(page, mode);
      await floatWin(page, { src: demoUrl({ view: 'glance' }), x: 1440 - 360 - 120, y: 36, w: 360, h: 760, radius: 14 });
      // The window takes the height of what it shows.
      const f = page.frames().at(-1);
      const h = await f.evaluate(() => Math.ceil(document.querySelector('#root')?.scrollHeight || document.body.scrollHeight)).catch(() => 0);
      if (h > 200) await page.evaluate((hh) => { const fr = [...document.querySelectorAll('iframe')].at(-1); fr.style.height = `${hh}px`; }, Math.min(h, 840));
    },
  },
  {
    id: 'tray', engine: 'demo', query: { view: 'sysmon-popover' }, prep: async ({ page, sleep }, mode) => {
      await wallpaper(page, mode);
      // The pop-over's own window is 340×460; draw it that size, floating on the wallpaper.
      await page.evaluate(() => { const r = document.getElementById('root'); Object.assign(r.style, { position: 'absolute', left: '48px', top: '40px', width: '340px', height: '460px', overflow: 'hidden', borderRadius: '12px', boxShadow: '0 18px 50px rgba(0,0,0,.35)' }); });
      await sleep(2500);
    }, clip: { x: 0, y: 0, width: 436, height: 548 },
  },
  {
    id: 'page-window', engine: 'demo', backdrop: 'wall', prep: async ({ page, demoUrl }) => {
      await floatWin(page, { src: demoUrl({ view: 'page', page: 'calendar', route: 'calendar', label: 'Calendar' }), x: 150, y: 70, w: 1140, h: 760, radius: 12 });
    },
  },
  {
    id: 'light-apps', engine: 'demo', backdrop: 'wall', prep: async ({ page, demoUrl }) => {
      await floatWin(page, { src: demoUrl({ view: 'page', page: 'mail', route: 'mail', label: 'Keeper Mail', solo: '1', features: 'mail' }), x: 150, y: 70, w: 1140, h: 760, radius: 12 });
    },
  },
  {
    id: 'capture-preview', engine: 'demo', route: 'capture', prep: async ({ page, sleep }) => {
      await sleep(800);
      const thumb = dataUrl(await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } }));
      const f = await floatWin(page, { html: capturePages().preview, x: W - 260, y: H - 360, w: 252, h: 352, radius: 0, shadow: false });
      await f.evaluate((t) => window.preview.set([{ id: 'a', name: 'Screenshot 2026-11-04 at 09.41.12.png', thumb: t }, { id: 'b', name: 'Screenshot 2026-11-04 at 09.40.03.png', thumb: t }], 0, 0), thumb);
      await sleep(500);
    },
  },
  {
    id: 'capture-pin', engine: 'demo', route: 'home', prep: async ({ page, demoUrl, sleep }) => {
      // The picture pinned: a part of Time Tracking's day, taken a moment before.
      const back = page.url();
      await page.evaluate(() => { localStorage.setItem('place', JSON.stringify({ route: { name: 'time' }, history: [], scroll: {}, at: Date.now() })); });
      await page.goto(demoUrl({ features: 'timeTracking' }));
      await page.waitForSelector('.sidebar', { timeout: 20000 });
      await sleep(1800);
      await clean(page);
      const img = dataUrl(await page.screenshot({ clip: { x: 248, y: 270, width: 1180, height: 600 } }));
      await page.evaluate(() => { localStorage.setItem('place', JSON.stringify({ route: { name: 'home' }, history: [], scroll: {}, at: Date.now() })); });
      await page.goto(back);
      await page.waitForSelector('.sidebar', { timeout: 20000 });
      await sleep(1500);
      const f = await floatWin(page, { html: capturePages().pin, x: 700, y: 330, w: 650, h: 330, radius: 8 });
      await f.evaluate((u) => { window.pin.image(u); window.pin.set({ opacity: 0.9, css: true, through: false }); }, img);
      await f.addStyleTag({ content: '#bar{opacity:1!important}' });
      await sleep(400);
    },
  },
  {
    id: 'capture-scrolling', engine: 'demo', route: 'reader', query: { features: 'reader' }, prep: async ({ page, sleep }) => {
      await openFirst(page, 'li:has-text("How to plant bulbs")', sleep, 1500);
      await page.evaluate(() => {
        const r = document.createElement('div');
        Object.assign(r.style, { position: 'fixed', left: '900px', top: '150px', width: '500px', height: '700px', outline: '2px dashed rgba(10,132,255,.95)', background: 'rgba(10,132,255,.06)', borderRadius: '4px', zIndex: '2147470000' });
        document.documentElement.appendChild(r);
      });
      const f = await floatWin(page, { html: capturePages().bar, x: 990, y: 96, w: 320, h: 44, radius: 12 });
      await f.evaluate(() => window.bar.n(3));
    },
  },
  {
    id: 'draw', engine: 'demo', route: 'home', prep: async ({ page, sleep }) => {
      await sleep(1000);
      const { drawHtml } = coreModule('core/stage/draw.ts');
      const f = await floatWin(page, { html: drawHtml(), x: 0, y: 0, w: W, h: H, radius: 0, shadow: false });
      await f.evaluate(() => {
        draw.config({ toolbar: true, mac: true, shortcutLabel: '⌃⌥⇧D', tool: 'pen', color: '#ff3b30', width: 6 });
        draw.stroke('rect', [{ x: 250, y: 168 }, { x: 790, y: 262 }]);
        draw.color('#ffcc00'); draw.stroke('highlighter', [{ x: 262, y: 120 }, { x: 560, y: 120 }]);
        draw.color('#0a84ff'); draw.stroke('arrow', [{ x: 1000, y: 420 }, { x: 830, y: 330 }]);
        draw.color('#ff3b30');
        const pts = []; for (let a = 0; a <= Math.PI * 2.1; a += 0.12) pts.push({ x: 960 + Math.cos(a) * 150, y: 200 + Math.sin(a) * 50 });
        draw.stroke('pen', pts);
        draw.tool('arrow');
      });
      await sleep(300);
    },
  },
  {
    id: 'studio-share', engine: 'demo', backdrop: 'wall', prep: async ({ page, demoUrl, sleep }, mode) => {
      // The page a share link opens: player, chapters and transcript (core/share-page.ts).
      const { viewerHtml } = coreModule('core/share-page.ts');
      const now = Date.now();
      const html = viewerHtml({
        title: 'Planting tulips: a walkthrough', videoUrl: './planting-tulips.mp4', downloadUrl: './planting-tulips.mp4?download', type: 'video/mp4', fileName: 'planting-tulips.mp4', size: 48_200_000,
        captions: [{ start: 0, end: 3800, text: 'Here is how to plan the north bed before the first frost.' }, { start: 4200, end: 9000, text: 'Bulbs go in pointy end up, about three times as deep as they are tall.' }],
        chapters: [{ t: 0, title: 'The plan' }, { t: 62_000, title: 'Digging the bed' }, { t: 148_000, title: 'Planting' }, { t: 233_000, title: 'Mulch and water' }],
        madeAt: now, expiresAt: now + 7 * 86_400_000, lang: 'en',
      });
      const f = await floatWin(page, { html, x: 110, y: 50, w: 1220, h: 800, radius: 12, bg: mode === 'dark' ? '#111' : '#fff' });
      // A still from the recording in the player: Hello, drawn a moment before.
      const still = await floatWin(page, { src: demoUrl({}), x: 0, y: 0, w: W, h: H, radius: 0, shadow: false, z: 5 });
      await still.waitForSelector('.sidebar', { timeout: 20000 }).catch(() => undefined);
      await sleep(1200);
      const poster = dataUrl(await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } }));
      await page.evaluate(() => document.querySelectorAll('iframe')[1]?.remove());
      if (poster) await f.evaluate((p) => { const v = document.querySelector('video'); if (v) v.poster = p; }, poster);
      await sleep(600);
    },
  },

  // ---- the Island
  { id: 'island-pill', engine: 'demo', query: { view: 'island', island: 'split', screen: 'mac' }, prep: islandPrep(null, 760) },
  { id: 'island-notch', engine: 'demo', query: { view: 'island', island: 'many', screen: 'notch' }, prep: islandPrep(null, 760) },
  { id: 'island-expanded', engine: 'demo', query: { view: 'island', island: 'music', screen: 'notch' }, prep: islandPrep(true, 900) },
  // For the hero banner only: the open Island with nothing behind it.
  { id: 'island-cut', engine: 'demo', modes: ['dark'], internal: true, transparent: true, query: { view: 'island', island: 'music', screen: 'notch' }, prep: islandPrep(true, 900, true) },
  { id: 'island-ocean', ...islandColour('ocean') },
  { id: 'island-sunset', ...islandColour('sunset') },
  { id: 'island-blossom', ...islandColour('blossom') },
  { id: 'island-colourful', ...islandColour('playful', { islandLook: 'colorful', islandPreset: 'berry' }) },

  // ---- the website's theme switcher: Hello in a dozen themes (site/assets/themes, 1280×800)
  ...[['playful', 'light'], ['minimal', 'light'], ['blossom', 'light'], ['ocean', 'dark'], ['terminal', 'dark'], ['neon', 'dark'], ['paper', 'light'], ['sunset', 'light'], ['aurora', 'dark'], ['sage', 'light'], ['midnight', 'dark'], ['candy', 'light']]
    .map(([theme, mode]) => ({ id: `theme-${theme}`, engine: 'demo', theme, modes: [mode], route: 'home', wait: 1500 })),
];

// ---------------------------------------------------------------- optimise
function toWebp(png, out, q = 84) {
  const r = spawnSync('cwebp', ['-quiet', '-q', String(q), '-m', '6', '-sharp_yuv', '-metadata', 'none', png, '-o', out]);
  if (r.status !== 0) throw new Error(`cwebp failed on ${png}: ${r.stderr}`);
}

// The Linux app stores (AppStream metainfo in packaging/flatpak) want PNG: these light
// shots are also written as compact palette PNGs under these names.
const SITE_THEMES = path.resolve(ROOT, opt('--themes-out') || 'site/assets/themes');
const STORE_PNGS = { 'home-light': 'home.png', 'search-light': 'search.png', 'duplicates-light': 'duplicates.png', 'space-light': 'space.png' };

async function optimise() {
  const sharp = require(path.join(ROOT, 'node_modules/sharp'));
  for (const png of written) {
    const store = STORE_PNGS[path.basename(png, '.png')];
    if (store) await sharp(png).png({ palette: true, quality: 92, compressionLevel: 9, effort: 10 }).toFile(path.join(OUT, store));
  }
  const haveCwebp = spawnSync('cwebp', ['-version']).status === 0;
  for (const png of written) {
    const name = path.basename(png, '.png');
    // The website's theme switcher: smaller pictures of their own, next to the site.
    if (name.startsWith('theme-')) {
      const small = path.join(path.dirname(png), `${name}-small.png`);
      await sharp(png).resize(1280, 800).png().toFile(small);
      fs.mkdirSync(SITE_THEMES, { recursive: true });
      if (haveCwebp) toWebp(small, path.join(SITE_THEMES, `${name.slice('theme-'.length)}.webp`), 80);
      continue;
    }
    if (haveCwebp) toWebp(png, path.join(OUT, `${name}.webp`), 80);
    else {
      // No cwebp: shrink the PNG with sharp instead (palette PNG, still crisp for UI).
      await sharp(png).png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 }).toFile(path.join(OUT, `${name}.png`));
    }
  }
}

// ---------------------------------------------------------------- the hero banner
async function hero() {
  const src = path.join(__dirname, 'hero.html');
  const pick = (n) => {
    for (const ext of ['png', 'webp']) {
      const raw = path.join(RAW, `${n}.png`);
      if (fs.existsSync(raw)) return raw;
      const p = path.join(OUT, `${n}.${ext}`);
      if (fs.existsSync(p)) return p;
    }
    return null;
  };
  const parts = { app: pick('home-dark'), island: pick('island-cut-dark') || pick('island-expanded-dark'), icon: path.join(ROOT, 'build/icon.svg') };
  if (!parts.app || !parts.island) { log('hero: home-dark and island-cut-dark (or island-expanded-dark) are needed; skipped'); return; }
  const q = new URLSearchParams(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, 'file://' + v])));
  const { app, page } = await openShell(`file://${src}?${q}`);
  try {
    await page.setViewportSize({ width: 1600, height: 760 });
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 15000 });
    await sleep(300);
    const file = path.join(RAW, 'hero.png');
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1600, height: 760 } });
    if (spawnSync('cwebp', ['-version']).status === 0) toWebp(file, path.join(OUT, 'hero.webp'), 88);
    log('captured hero');
  } finally {
    await app.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- run
(async () => {
  const appShots = SHOTS.filter((s) => s.engine === 'app' && want(s.id));
  const demoShots = SHOTS.filter((s) => s.engine === 'demo' && want(s.id));
  if (appShots.length && !has('--skip-app')) {
    if (!fs.existsSync(path.join(ROOT, 'dist-electron/main.mjs')) || !fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
      console.error('Build first: npx vite build && node scripts/build-main.mjs');
      process.exit(1);
    }
    await realApp(appShots);
  }
  if (demoShots.length && !has('--skip-demo')) await demo(demoShots);
  await optimise();
  if (!has('--no-hero') && (!ONLY || ONLY.has('hero'))) await hero();
  if (!KEEP_RAW) fs.rmSync(TMP, { recursive: true, force: true });
  log(`done: ${written.length} screenshots in ${path.relative(ROOT, OUT)}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
