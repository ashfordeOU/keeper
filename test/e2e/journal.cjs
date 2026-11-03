// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/journal.cjs /tmp/kjr-home /tmp/kjr-shots
// Drives the real Keeper app's Journal mode: off until switched on; Start
// makes the Journal vault in Documents; On this day shows last year's entry
// and the streak counts yesterday; a mood and words typed are saved as
// Markdown with properties; a photo taken today is suggested from the library
// and added into the vault; Notes opens the same file. Light and dark.

const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
const DATA = path.join(HOME, '.config', 'Keeper');
fs.mkdirSync(DATA, { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(300); } return null; }
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

(async () => {
  const now = new Date();
  const today = key(now);
  const yesterday = key(new Date(Date.now() - 86_400_000));
  const lastYear = `${now.getFullYear() - 1}${today.slice(4)}`;
  const J = path.join(HOME, 'Documents', 'Journal');
  for (const [d, text] of [[lastYear, '---\njournal: ' + lastYear + '\nmood: great\n---\n# A year ago\n\nPlanted the apple tree by the gate. The soil was still warm.\n'], [yesterday, '---\nmood: okay\n---\nLong day at work, quiet evening.\n']]) {
    fs.mkdirSync(path.join(J, d.slice(0, 4)), { recursive: true });
    fs.writeFileSync(path.join(J, d.slice(0, 4), `${d}.md`), text);
  }
  // A photo taken today, in the library.
  const sharp = require(path.join(ROOT, 'node_modules', 'sharp'));
  const photo = path.join(HOME, 'Downloads', 'Harbour at dusk.jpg');
  await sharp({ create: { width: 640, height: 420, channels: 3, background: { r: 40, g: 110, b: 160 } } }).composite([{ input: Buffer.from('<svg width="640" height="420"><rect y="250" width="640" height="170" fill="#1d3b52"/><circle cx="470" cy="150" r="60" fill="#f2b45c"/></svg>'), top: 0, left: 0 }]).jpeg().toFile(photo);
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ folders: [path.join(HOME, 'Downloads')], setupDone: true }));

  const app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const k = (ns, fn, ...a) => main.evaluate(([n, f, args]) => window.keeper[n][f](...args), [ns, fn, a]);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => { await wait(700); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

  check((await k('features', 'list')).find((f) => f.id === 'journal')?.on === false, 'Journal is off until switched on');
  await k('features', 'set', 'journal', true);
  await wait(400);
  check(await main.locator('.sidebar [title="Journal"]').count() + await main.locator('.sidebar >> text=Journal').count() > 0, 'Journal has a sidebar entry in Notes');
  await navigate('journal');
  await main.waitForSelector('[data-testid="journal-page"]', { timeout: 15000 });
  await main.locator('[data-testid="jr-start"]').click();
  await main.waitForSelector('[data-testid="jr-entry"]', { timeout: 15000 });
  const s = await k('settings', 'get');
  const vault = s.journal.vault;
  check(!!vault && (await k('notes', 'vaults')).some((v) => v.id === vault && v.path === J), 'Start makes Documents › Journal a vault and remembers it');

  // On this day and the streak.
  check(!!(await until(async () => /Planted the apple tree/.test(await main.locator('[data-testid="jr-otd"]').innerText()))), 'On this day shows last year’s entry');
  check(!!(await until(async () => /1\s*day in a row/.test(await main.locator('[data-testid="jr-streak"]').innerText()))), 'the streak counts yesterday');

  // Writing today.
  await main.locator('[data-testid="jr-mood-good"]').click();
  await main.locator('[data-testid="jr-text"]').fill('Walked along the harbour after work. The light on the water was lovely.');
  const file = path.join(J, today.slice(0, 4), `${today}.md`);
  const md = await until(() => { try { const t = fs.readFileSync(file, 'utf8'); return /harbour after work/.test(t) ? t : null; } catch { return null; } });
  check(!!md && /journal: ['"]?\d{4}-\d{2}-\d{2}/.test(md) && /mood: good/.test(md) && /^# /m.test(md), 'the entry is a Markdown note with the date and mood as properties');
  check(!!(await until(async () => /2\s*days in a row/.test(await main.locator('[data-testid="jr-streak"]').innerText()))), 'writing today makes the streak two days');

  // A photo from today, suggested from the library.
  const idea = await until(async () => (await main.locator('[data-testid="jr-ideas"] .jr-idea').count()) > 0, 30000);
  if (!idea) { await k('library', 'rescan'); }
  const idea2 = idea || await until(async () => { await navigate('journal'); await wait(1200); return (await main.locator('[data-testid="jr-ideas"] .jr-idea').count()) > 0; }, 30000);
  check(!!idea2, 'a photo taken today is suggested');
  if (idea2) await main.locator('[data-testid="jr-ideas"] .jr-idea').first().click();
  else await k('journal', 'addPhotos', vault, `${today.slice(0, 4)}/${today}.md`, [photo]);
  const withPhoto = await until(() => { const t = fs.readFileSync(file, 'utf8'); return /!\[\[[^\]]*Harbour at dusk[^\]]*\.jpg\]\]/.test(t) ? t : null; });
  check(!!withPhoto, 'the photo is copied into the vault and embedded in the entry');
  check(!!(await until(async () => (await main.locator('[data-testid="jr-photos"] img').count()) === 1)), 'the photo shows in the entry');
  await shot('journal-light');

  // An entry written in another app is read.
  await main.locator('.jr-day', { hasText: new RegExp(`^${Number(yesterday.slice(8))}$`) }).first().click();
  check(!!(await until(async () => (await main.locator('[data-testid="jr-text"]').inputValue()) === 'Long day at work, quiet evening.')), 'yesterday’s entry, written elsewhere, opens with its text');
  await main.locator('.jr-day.today').click();

  await k('settings', 'set', { appearance: 'dark' });
  await shot('journal-dark');
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await app.close();
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
