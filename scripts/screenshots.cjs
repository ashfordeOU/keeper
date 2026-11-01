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
//
// Two sources, like the end-to-end tests:
//   • the real app (Electron) on a throwaway, realpath'd home folder with sample
//     files (test/e2e/make-samples.cjs), a small notes vault and a terminal, with
//     KEEPER_SKIP_TOUR=1 and usage stats off;
//   • the browser demo (`npx vite`, sample data from src/mock*.ts) for what the real
//     app can only show with accounts, paired devices or other hardware: the Island
//     scenes, Mesh, Remote Desktops and devices, Places & Tracks, voice, cues and so on.
//     The demo is drawn by Electron's own Chromium, so no extra browser is needed.
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
  // Only the text that is really drawn inside the picture counts.
  const text = await page.evaluate((c) => {
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
  // The build machine's own disks and mounts (read-only tool volumes in a container, for
  // example) are not part of the picture: their rows in the sidebar are hidden while the
  // shots are taken. On a real computer these would be your own drives.
  await main.evaluate(async () => {
    const m = await window.keeper.places.list();
    const names = new Set([...(m.volumes ?? []), ...(m.network ?? [])].filter((p) => p.path !== '/').map((p) => p.name));
    const hide = () => document.querySelectorAll('.place-row').forEach((r) => {
      const label = r.querySelector('.label')?.textContent ?? '';
      if (names.has(label)) r.style.display = 'none';
    });
    hide();
    new MutationObserver(hide).observe(document.body, { childList: true, subtree: true });
  }).catch((e) => console.error('[shots] could not hide the machine\'s own volumes:', e.message));
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

async function demo(shots) {
  const vite = await startVite();
  const { app, page } = await openShell('about:blank');
  try {
    for (const mode of MODES) {
      for (const s of shots) {
        if (s.modes && !s.modes.includes(mode)) continue;
        try {
          const q = new URLSearchParams({ theme: s.theme ?? 'playful', appearance: mode, notour: '1', ...(s.query ?? {}) });
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
          await page.goto(`${vite.url}?${q}`);
          await page.emulateMedia({ colorScheme: mode });
          await page.waitForSelector(s.query?.view ? 'body' : '.sidebar', { timeout: 30_000 });
          await sleep(1200);
          await clean(page);
          const got = s.prep ? await s.prep({ page, sleep, engine: 'demo' }, mode) : null;
          await relabel(page);
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
  const r = await page.evaluate(() => {
    const isl = document.querySelector('.isl');
    const rects = [isl, ...isl.parentElement.children].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0 && b.width < innerWidth - 40);
    const x0 = Math.min(...rects.map((b) => b.left)), x1 = Math.max(...rects.map((b) => b.right));
    const y0 = Math.min(...rects.map((b) => b.top)), y1 = Math.max(...rects.map((b) => b.bottom));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });
  const w = Math.max(width, Math.ceil(r.w + 120));
  const x = Math.max(0, Math.min(1440 - w, Math.round(r.x + r.w / 2 - w / 2)));
  return { x, y: 0, width: w, height: Math.min(900, Math.ceil(r.y + r.h + 56)) };
};

// The demo's sample data names a few real agents as the "clients" of a session; in the
// published pictures they are plain descriptions instead.
const relabel = (page) => page.evaluate((labels) => {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    let v = n.nodeValue.replace(/\S+ in Keeper’s Assistant/g, 'Keeper’s Assistant');
    for (const l of labels) if (v.includes(l)) v = v.split(l).join('Coding agent');
    if (v !== n.nodeValue) n.nodeValue = v;
  }
}, THIRD_PARTY.labels).catch(() => undefined);

// The demo asks for an approval a few seconds in; it is not what these shots are about.
const hideApproval = async ({ page }) => { await page.addStyleTag({ content: '.approval,.approval-back{display:none!important}' }); };

const SHOTS = [
  // ---- the real app
  {
    id: 'home', engine: 'app', route: 'home', prep: async ({ page, sleep }) => {
      await page.waitForSelector('.content', { timeout: 15000 });
      await sleep(1000);
      // A file selected, so the inspector shows what Keeper knows about it.
      await page.locator('.shelf-card', { hasText: 'budget.xlsx' }).first().click({ timeout: 4000 }).catch(() => undefined);
      await sleep(1200);
    },
  },
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
      const cmd = `clear; ls --color=always ~; cd "${SAMPLES}"; ls --color=always -C | head -n 8; printf '\\n'; for c in 1 2 3 4 5 6; do printf "\\033[3%sm■■ \\033[9%sm■■  " $c $c; done; printf '\\033[0m\\n\\n'; git --version 2>/dev/null; echo "Keeper by Ashforde® — terminals keep running when the window closes"`;
      await page.keyboard.type(cmd + '\n', { delay: 2 });
      await sleep(2000);
    },
  },
  {
    id: 'convert', engine: 'app', route: 'convert', prep: async ({ page, sleep }) => {
      await page.waitForSelector('.conv-cats', { timeout: 15000 });
      await clickText(page, '.conv-cats button', 'PDF').catch(() => undefined);
      await sleep(600);
      await page.locator('.conv-tool').first().click().catch(() => undefined);
      await sleep(800);
    },
  },
  // The system monitor comes from the demo: the real one would show this machine's own processes.
  { id: 'monitor', engine: 'demo', route: 'health', wait: 2500 },
  {
    id: 'monitor-history', engine: 'demo', route: 'health', prep: async ({ page, sleep }) => {
      await page.waitForSelector('.health-tabs', { timeout: 15000 });
      const tab = page.locator('.health-tabs button', { hasText: /^History$/ });
      if (await tab.count()) await tab.first().click();
      await sleep(2500);
    },
  },
  { id: 'awake', engine: 'app', route: 'awake', prep: async ({ page, sleep }) => { await page.waitForSelector('[data-testid="awake-hero"]', { timeout: 15000 }); await sleep(800); } },
  { id: 'settingsplus', engine: 'app', route: 'catalog', prep: async ({ page, sleep }) => { await sleep(1800); } },
  { id: 'themes', engine: 'app', route: 'settings', prep: async ({ page, sleep }) => { await page.waitForSelector('.tg-card', { timeout: 15000 }); await sleep(1200); } },
  { id: 'features', engine: 'app', route: 'settings:features', prep: async ({ sleep }) => { await sleep(1500); } },

  // ---- the browser demo
  { id: 'search', engine: 'demo', route: { name: 'search', q: 'screenshots with wifi password' }, prep: async ({ page, sleep }) => { await sleep(1200); await page.locator('.main .file-card').first().click({ timeout: 4000 }).catch(() => undefined); await sleep(900); } },
  // Not taken: Clean Up and Notes Everywhere. Their pages name other apps (whose caches are
  // cleaned, or whose notes are synced), and Keeper's pictures never show other products.
  { id: 'duplicates', engine: 'demo', route: 'duplicates', prep: async ({ page, sleep }) => { await page.locator('.main button', { hasText: /Find duplicates|Scan/ }).first().click({ timeout: 4000 }).catch(() => undefined); await sleep(2500); } },
  { id: 'space', engine: 'demo', route: 'space', wait: 2000 },
  { id: 'island-pill', engine: 'demo', query: { view: 'island', island: 'split', screen: 'mac' }, prep: islandPrep(null, 760) },
  { id: 'island-notch', engine: 'demo', query: { view: 'island', island: 'many', screen: 'notch' }, prep: islandPrep(null, 760) },
  { id: 'island-expanded', engine: 'demo', query: { view: 'island', screen: 'notch' }, prep: islandPrep('panel', 900) },
  // For the hero banner only: the open Island with nothing behind it.
  { id: 'island-cut', engine: 'demo', modes: ['dark'], internal: true, transparent: true, query: { view: 'island', screen: 'notch' }, prep: islandPrep('panel', 900, true) },
  { id: 'agents', engine: 'demo', route: 'agents:permissions', prep: hideApproval },
  {
    id: 'computer-use', engine: 'demo', route: 'agents:permissions', query: { computer: '1' }, prep: async (ctx) => {
      await hideApproval(ctx);
      await ctx.page.waitForSelector('.browser-agent', { timeout: 10000 });
      await ctx.page.evaluate(() => document.querySelector('.browser-agent').scrollIntoView({ block: 'start' }));
      await ctx.sleep(800);
    },
  },
  { id: 'firewall', engine: 'demo', route: 'firewall', wait: 1500, prep: async ({ page, sleep }) => { await clickText(page, '.fw-tabs button, .fw-tabs [role=tab], .fw-tabs *', 'Rules').catch(() => undefined); await sleep(1200); } },
  { id: 'privacy', engine: 'demo', route: 'protection', wait: 1500 },
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
  { id: 'tray', engine: 'demo', query: { view: 'sysmon-popover' }, prep: async ({ page, sleep }, mode) => {
      await wallpaper(page, mode);
      // The pop-over's own window is 340×460; draw it that size, floating on the wallpaper.
      await page.evaluate(() => { const r = document.getElementById('root'); Object.assign(r.style, { position: 'absolute', left: '48px', top: '40px', width: '340px', height: '460px', overflow: 'hidden', borderRadius: '12px', boxShadow: '0 18px 50px rgba(0,0,0,.35)' }); });
      await sleep(2500);
    }, clip: { x: 0, y: 0, width: 436, height: 548 } },
  { id: 'stage', engine: 'demo', route: 'stage' },
  { id: 'dictation', engine: 'demo', route: 'dictation' },
  { id: 'meetings', engine: 'demo', route: 'meetings' },
  { id: 'cues', engine: 'demo', route: 'cues' },
  { id: 'ambience', engine: 'demo', route: 'ambience', wait: 1500 },
];

// ---------------------------------------------------------------- optimise
function toWebp(png, out, q = 84) {
  const r = spawnSync('cwebp', ['-quiet', '-q', String(q), '-m', '6', '-sharp_yuv', '-metadata', 'none', png, '-o', out]);
  if (r.status !== 0) throw new Error(`cwebp failed on ${png}: ${r.stderr}`);
}

// The Linux app stores (AppStream metainfo in packaging/flatpak) want PNG: these light
// shots are also written as compact palette PNGs under these names.
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
    if (haveCwebp) toWebp(png, path.join(OUT, `${name}.webp`));
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
    if (!fs.existsSync(path.join(ROOT, 'dist-electron/main.cjs')) || !fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
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
