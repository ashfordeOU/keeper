// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/time-track.cjs /tmp/ktt-home /tmp/ktt-shots
// Drives the real Keeper app's time tracking: off until switched on; apps,
// windows and sites in front become spans (through the test hook, since a
// virtual display has no window manager to say which window is in front);
// excluded apps and pauses record nothing; a project rule sorts the time; the
// Day and Week views draw it; CSV export; data on disk is not plain text;
// Delete everything. A day recorded earlier is read from its file. Light and dark.

const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Yesterday, as an earlier Keeper would have written it (gzipped, no keychain on this test machine).
const DATA = path.join(HOME, '.config', 'Keeper', 'time');
fs.mkdirSync(DATA, { recursive: true });
const y = new Date(Date.now() - 86_400_000);
const yAt = (h, m) => { const d = new Date(y); d.setHours(h, m, 0, 0); return d.getTime(); };
const yesterday = [
  [9, 0, 9, 25, 'Mail', 'Inbox'], [9, 25, 10, 40, 'Code', 'redesign — header.tsx'], [10, 40, 10, 55, 'Slack', 'design-team'],
  [10, 55, 12, 10, 'Firefox', 'Homepage redesign', 'figma.com'], [13, 0, 13, 20, 'Firefox', 'Morning news', 'news.example'], [13, 20, 15, 5, 'Code', 'redesign — styles.css'],
  [15, 5, 15, 30, 'Mail', 'Re: launch date'], [15, 30, 16, 45, 'Writer', 'Quarterly report.docx'], [16, 45, 17, 30, 'Firefox', 'Invoices', 'billing.example'],
].map(([h1, m1, h2, m2, app, title, site]) => ({ start: yAt(h1, m1), end: yAt(h2, m2), app, title, ...(site ? { site } : {}) }));
fs.writeFileSync(path.join(DATA, `${dayKey(y.getTime())}.bin`), Buffer.concat([Buffer.from('KTRK0'), zlib.gzipSync(Buffer.from(JSON.stringify(yesterday)))]));

(async () => {
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', KEEPER_TIME_TEST: '1', KEEPER_TEST_CONDITIONS: '{"idleSec":0}', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const k = (ns, fn, ...a) => main.evaluate(([n, f, args]) => window.keeper[n][f](...args), [ns, fn, a]);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => { await wait(600); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const today = dayKey(Date.now());

  check((await k('features', 'list')).find((f) => f.id === 'timeTracking')?.on === false, 'time tracking is off until switched on');
  await k('timeTrack', 'testFront', { app: 'Code', title: 'notes.md' });
  await wait(2500);
  check((await k('timeTrack', 'day', today)).spans.length === 0, 'nothing is recorded while it is off');

  await k('features', 'set', 'timeTracking', true);
  await wait(500);
  await k('timeTrack', 'testFront', { app: 'Code', title: 'redesign — header.tsx' });
  await wait(3000);
  await k('timeTrack', 'testFront', { app: 'Firefox', title: 'Feed', site: 'news.example' });
  await wait(3000);
  await k('timeTrack', 'testFront', { app: '1Password', title: 'Vault' });
  await wait(2500);
  await k('timeTrack', 'testFront', { app: 'Mail', title: 'Inbox' });
  await wait(2500);
  let d = await k('timeTrack', 'day', today);
  const apps = d.summary.apps.map((a) => a.key);
  check(apps.includes('Code') && apps.includes('Firefox') && apps.includes('Mail'), `apps in front become time (${apps.join(', ')})`);
  check(!apps.includes('1Password'), 'an excluded app is never recorded');
  check(d.summary.sites.some((s) => s.key === 'news.example'), 'the site in front is kept');
  check(d.spans.some((s) => s.title === 'redesign — header.tsx'), 'window titles are kept');
  const st = await k('timeTrack', 'status');
  check(st.recording && st.now?.app === 'Mail', 'the status says what is being recorded now');

  // Titles off: only apps and sites.
  await k('settings', 'set', { timeTrack: { ...st.options, titles: false } });
  await k('timeTrack', 'testFront', { app: 'Writer', title: 'Secret plan.docx' });
  await wait(2500);
  await k('timeTrack', 'testFront', { app: 'Mail', title: 'Inbox' });
  await wait(500);
  d = await k('timeTrack', 'day', today);
  check(d.spans.some((s) => s.app === 'Writer' && !s.title), 'with titles off, only the app is kept');
  await k('settings', 'set', { timeTrack: { ...st.options, titles: true } });

  // Paused: nothing.
  await k('timeTrack', 'setPaused', true, 60);
  await k('timeTrack', 'testFront', { app: 'Games', title: 'Level 3' });
  await wait(2500);
  await k('timeTrack', 'testFront', { app: 'Mail', title: 'Inbox' });
  await k('timeTrack', 'setPaused', false);
  d = await k('timeTrack', 'day', today);
  check(!d.summary.apps.some((a) => a.key === 'Games'), 'a pause records nothing');

  // A project rule sorts the time.
  await k('timeTrack', 'saveRules', [{ id: 'r1', project: 'Website redesign', field: 'title', contains: 'redesign' }, { id: 'r2', project: 'Website redesign', field: 'site', contains: 'figma.com' }, { id: 'r3', project: 'Email and chat', field: 'app', contains: 'mail' }, { id: 'r4', project: 'Email and chat', field: 'app', contains: 'slack' }]);
  d = await k('timeTrack', 'day', today);
  check(d.summary.projects.some((p) => p.key === 'Website redesign'), 'a rule puts time in a project');

  // The page: today, then yesterday read from its file.
  await navigate('time');
  await main.waitForSelector('[data-testid="time-page"]', { timeout: 15000 });
  check(/Recording/.test(await main.locator('[data-testid="tt-now"]').innerText()), 'the page says it is recording');
  check(await main.locator('.tt-block').count() > 0, 'today’s timeline has blocks');
  await main.getByRole('button', { name: 'Day before' }).click();
  check(!!(await until(async () => /7 h/.test(await main.locator('[data-testid="tt-total"]').innerText()))), 'a day recorded earlier is read from its file (7 h)');
  check(await main.locator('[data-testid="tt-projects"] li').count() >= 2, 'its projects are listed');
  await shot('time-day-light');
  await main.locator('[role="tab"]:has-text("Week"), .tab:has-text("Week")').first().click();
  await main.waitForSelector('[data-testid="tt-week"]');
  check(await main.locator('.tt-weekrow').count() === 7, 'the week has seven days');
  await shot('time-week-light');
  await main.locator('[role="tab"]:has-text("Projects"), .tab:has-text("Projects")').first().click();
  check(await main.locator('.tt-rule').count() === 4, 'the rules are listed');
  await shot('time-projects-light');

  // CSV.
  const csv = await k('timeTrack', 'exportCsv', dayKey(Date.now() - 86_400_000), today);
  const text = csv.saved ? fs.readFileSync(csv.path, 'utf8') : '';
  check(/^Date,Start,End,Minutes,App,Title,Site,Project/.test(text) && /Quarterly report\.docx/.test(text) && /Website redesign/.test(text), `CSV export has the spans and projects (${csv.rows} rows)`);

  // On disk: today's file is not readable as plain text.
  await app.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  await k('features', 'set', 'timeTracking', false); // flushes
  await wait(1500);
  const todayFile = path.join(DATA, `${today}.bin`);
  const raw = fs.existsSync(todayFile) ? fs.readFileSync(todayFile) : Buffer.alloc(0);
  check(raw.length > 0 && !raw.includes(Buffer.from('redesign')), `today’s file is written and not plain text (${raw.subarray(0, 5).toString()})`);
  await k('features', 'set', 'timeTracking', true);

  // Dark.
  await k('settings', 'set', { appearance: 'dark' });
  await main.locator('[role="tab"]:has-text("Day"), .tab:has-text("Day")').first().click();
  await main.getByRole('button', { name: 'Day before' }).click();
  await shot('time-day-dark');
  await main.locator('[role="tab"]:has-text("Settings"), .tab:has-text("Settings")').first().click();
  await shot('time-settings-dark');

  // Delete everything.
  await k('timeTrack', 'wipe');
  const left = fs.readdirSync(DATA).filter((n) => n.endsWith('.bin'));
  check(left.length === 0 && (await k('timeTrack', 'day', dayKey(y.getTime()))).spans.length === 0, 'Delete everything removes every day');

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await app.close();
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
