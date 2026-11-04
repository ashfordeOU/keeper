// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/audit-areas.cjs /tmp/kaa-home /tmp/kaa-shots
// Drives the real Keeper app through the merged pages and the smaller
// improvements by area: one Screen page (Capture, Record, Present), one Voice
// page (Dictation, Meetings, Snippets) with a meeting's Export menu and times
// in this computer's style, one Tasks page (Plan and Lists) with a Low energy
// view, Look & Feel opening on Theme, Connect apart from Devices, Agents in
// four tabs, the Knowledge Graph under Notes, Where AI is used, the mode named
// in Settings → Features, mode toasts that replace each other, Today's clear
// day and its note, Convert's presets, ready-made checklists, the Clock's
// focus presets, plain words in Archives and Quick Search's Do again.
// Light and dark at 1440×900 with the sidebar as a rail (demo data only).

const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }

// A recorded meeting, as Keeper saves it (no speech model needed).
const userData = path.join(HOME, '.config', 'Keeper');
fs.mkdirSync(path.join(userData, 'voice', 'meetings'), { recursive: true });
fs.writeFileSync(path.join(userData, 'voice', 'settings.json'), JSON.stringify({ meetings: { notesAi: 'rules', detect: false, systemAudio: false, autoNotes: false } }));
const start = new Date(); start.setHours(16, 7, 0, 0);
const ID = '2026-11-04-demo0002';
fs.writeFileSync(path.join(userData, 'voice', 'meetings', `${ID}.json`), JSON.stringify({
  id: ID, title: 'Garden club planning', startedAt: start.getTime() - 86_400_000, endedAt: start.getTime() - 86_400_000 + 20 * 60_000, durationMs: 20 * 60_000, app: 'Video call',
  speakers: [{ id: 'me', label: 'You', track: 'mic', estimated: false }, { id: 's1', label: 'Mira Holt', track: 'system', estimated: false }],
  utterances: [
    { id: 'a', start: 10, end: 15, speaker: 's1', text: 'The spring plant sale is booked for the third Saturday.', track: 'system' },
    { id: 'b', start: 40, end: 45, speaker: 'me', text: 'I will print the posters by Friday.', track: 'mic' },
  ],
}));

(async () => {
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', LANG: 'en_GB.UTF-8', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const x = w.url(); return x && (!x.includes('view=') || x.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const x = w.webContents.getURL(); if (!x.includes('view=') || x.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const k = (fn, ...a) => main.evaluate(([f, args]) => { const [ns, m] = f.split('.'); return window.keeper[ns][m](...args); }, [fn, a]);
  const title = () => main.locator('.page-head h1').first().innerText().catch(() => '');
  const hubTabs = () => main.locator('.hub-tabs [role="tab"]').allInnerTexts().catch(() => []);
  // Light and dark of what is on screen now.
  const pair = async (name, prep) => {
    for (const mode of ['light', 'dark']) {
      await main.evaluate((m) => window.keeper.settings.set({ appearance: m }), mode);
      if (prep) await prep();
      await wait(700);
      await main.screenshot({ path: path.join(SHOTS, `auditareas-${name}-${mode}.png`) });
    }
    await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));
  };

  // Every part these pages need, and the Pro readings off (Standard).
  for (const f of ['planner', 'studio', 'stage', 'dictation', 'meetings', 'textSnippets', 'vibes', 'remoteDesktops', 'terminal', 'graphAll', 'brain', 'aiAgents', 'cues', 'convert', 'focus', 'alarms', 'calendars', 'insights', 'launcher', 'tools']) await k('features.set', f, true).catch(() => undefined);
  await wait(800);

  // ---------------------------------------------------------------- the sidebar's merged rows (before it folds to a rail)
  const rows = await main.locator('.sidebar .nav-item').evaluateAll((els) => els.map((e) => e.getAttribute('title') || e.textContent?.trim()));
  for (const want of ['Screen', 'Voice', 'Tasks', 'Look & Feel', 'Knowledge Graph']) check(rows.includes(want), `the sidebar has ${want}`);
  for (const gone of ['Studio', 'Stage', 'Toolbox', 'Dictation', 'Meetings', 'Planner', 'Reminders', 'Typed Snippets', 'Wallpaper & Vibes']) check(!rows.includes(gone), `${gone} is no longer a sidebar row of its own`);
  const sections = await main.locator('.sidebar .nav-title-label').allInnerTexts();
  check(sections.some((s) => /^connect$/i.test(s.trim())) && sections.some((s) => /^devices$/i.test(s.trim())), `a Connect section sits beside Devices (${sections.join(', ')})`);
  // The sidebar as a rail: pictures show demo data only, never this computer's own place names.
  await main.keyboard.press('Control+Alt+KeyS').catch(() => undefined);

  // ---------------------------------------------------------------- Screen
  await navigate('studio');
  await until(async () => (await title()) === 'Screen', 10000);
  check(await title() === 'Screen', 'Studio opens as Screen › Record');
  check(JSON.stringify(await hubTabs()) === JSON.stringify(['Capture', 'Record', 'Present']), `Screen has Capture, Record and Present (${(await hubTabs()).join(', ')})`);
  await pair('screen');

  // Toolbox tools in Quick Search, and Do again.
  const json = await main.evaluate(() => window.keeper.search.everything('json formatter', { launch: true, limit: 5 }));
  const tool = json.groups.flatMap((g) => g.hits).find((h) => h.kind === 'action' && h.id === 'tool-json');
  check(!!tool, 'Quick Search finds the Toolbox’s JSON formatter');
  await main.evaluate(() => window.keeper.search.launch('action', 'tool-json', '', 'open'));
  check(!!(await until(async () => (await title()) === 'Toolbox', 8000)), 'running it opens the tool on the Toolbox page');
  const again = await main.evaluate(() => window.keeper.search.everything('', { launch: true, recent: true }));
  check(again.groups.flatMap((g) => g.hits).some((h) => h.id === 'tool-json' && h.detail === 'Do again'), 'with nothing typed, Quick Search offers it again');

  // ---------------------------------------------------------------- Voice
  await navigate('meetings');
  await main.waitForSelector('[data-testid="meeting-detail"]', { timeout: 20000 });
  check(await title() === 'Voice', 'Meetings opens as Voice › Meetings');
  check(JSON.stringify(await hubTabs()) === JSON.stringify(['Dictation', 'Meetings', 'Snippets']), `Voice has Dictation, Meetings and Snippets (${(await hubTabs()).join(', ')})`);
  const head = await main.locator('[data-testid="meeting-detail"] .card').first().innerText();
  check(!/\b(SRT|VTT|TXT)\b/.test(head) && !/\bDelete\b/.test(head), 'the meeting header has no row of formats or a bare Delete');
  check(!/\b0\d:\d\d\s?[AP]M\b/.test(head), `times are written the computer’s way, never a padded “04:07 AM” (${head.split('\n').find((l) => /:\d\d/.test(l)) ?? ''})`);
  await main.click('[data-testid="meeting-export"]');
  const items = await main.locator('.menu [role="menuitem"]').allInnerTexts();
  check(items.length === 4 && items.some((t) => /Markdown/.test(t)) && items.some((t) => /SRT/.test(t)), `Export holds notes, transcript and subtitles (${items.join(' | ')})`);
  await main.screenshot({ path: path.join(SHOTS, 'auditareas-meeting-export-light.png') });
  await main.keyboard.press('Escape');
  await main.click('[data-testid="meeting-more"]');
  check(await main.locator('[data-testid="meeting-delete"]').count() === 1, 'Delete waits under More');
  await main.keyboard.press('Escape');
  await pair('voice-meeting');
  await main.click('[data-testid="hub-tab-snippets"]');
  check(!!(await until(() => main.locator('[data-testid="snippets-page"]').count(), 8000)) && await title() === 'Voice', 'Snippets is a tab of Voice');

  // ---------------------------------------------------------------- Tasks
  await k('pim.saveReminder', { id: '', list: 'local', title: 'Water the tomatoes', done: false, energy: 'low', plannedFor: new Date().toISOString().slice(0, 10) });
  await k('pim.saveReminder', { id: '', list: 'local', title: 'Write the club newsletter', done: false, energy: 'high' });
  await navigate('planner');
  await until(async () => (await title()) === 'Tasks', 10000);
  check(JSON.stringify(await hubTabs()) === JSON.stringify(['Plan', 'Lists']), `Tasks has Plan and Lists (${(await hubTabs()).join(', ')})`);
  await main.locator('.rem-lists button', { hasText: 'Low energy' }).click();
  await wait(500);
  const low = await main.locator('.rem-main').innerText();
  check(/Water the tomatoes/.test(low) && !/newsletter/.test(low), 'Low energy lists the easy task and not the deep one');
  await pair('tasks-low-energy');
  await main.click('[data-testid="hub-tab-reminders"]');
  check(!!(await until(async () => /All reminders|Today|Important/.test(await main.locator('.page-head .sub').first().innerText().catch(() => '')), 6000)), 'Lists names the list you are on under the Tasks title');

  // ---------------------------------------------------------------- Look & Feel
  await navigate('ambience');
  check(!!(await until(() => main.locator('[data-testid="amb-theme"]').count(), 15000)), 'Look & Feel opens on its Theme tab');
  check(await title() === 'Look & Feel', 'its title is Look & Feel');
  await pair('look-and-feel');

  // ---------------------------------------------------------------- Agents and the graph
  await navigate('agents:abilities');
  await main.waitForSelector('[data-testid="agents-tab-automation"]', { timeout: 15000 });
  check(await main.locator('.agents-tabs [role="tab"]').count() === 4, 'Agents has four tabs');
  check(await main.locator('[data-testid="agents-tab-automation"][aria-selected="true"]').count() === 1 && await main.locator('[data-testid="agents-view-skills"][aria-checked="true"]').count() === 1, 'the old Abilities tab opens Automation › Skills');
  check(await main.locator('h2', { hasText: 'Built-in skills' }).count() === 1, 'the built-in skills sit under your own');
  check(await main.locator('.page-head button', { hasText: 'Knowledge graph' }).count() === 0, 'no Knowledge graph button in the Agents header');
  await pair('agents');

  // ---------------------------------------------------------------- Settings: Where AI is used, the mode, toasts
  await navigate('settings:ai');
  check(!!(await until(() => main.locator('[data-testid="ai-parts"] tbody tr').count(), 10000)), 'Settings → AI has Where AI is used');
  const parts = await main.locator('[data-testid="ai-parts"] tbody th').allInnerTexts();
  check(parts.includes('Assistant') && parts.includes('Mail') && parts.includes('Agents'), `it lists the Assistant, Mail and Agents (${parts.join(', ')})`);
  await main.locator('[data-testid="ai-parts"]').scrollIntoViewIfNeeded();
  await pair('ai-parts', () => main.locator('[data-testid="ai-parts"]').scrollIntoViewIfNeeded());
  await navigate('settings:features');
  check(!!(await until(() => main.locator('[data-testid="features-mode"]').count(), 10000)), 'Settings → Features names the mode instead of the presets');
  check(await main.locator('.feature-preset').count() === 0 && await main.locator('button', { hasText: 'Save as my mode' }).count() === 1, 'no preset cards; Save as my mode');
  await pair('features-mode');

  await navigate('settings:general');
  await main.waitForSelector('[data-testid="settings-modes"]', { timeout: 10000 });
  for (const m of ['focus', 'writer', 'standard']) {
    await main.click(`[data-testid="mode-${m}"]`);
    await main.waitForSelector('[data-testid="mode-switch"]:not([disabled])', { timeout: 15000 });
    await main.click('[data-testid="mode-switch"]');
    await until(() => main.locator('[data-testid="mode-preview"]').count().then((n) => n === 0), 15000);
  }
  const toasts = await main.locator('.toast-stack .toast').allInnerTexts();
  check(toasts.filter((t) => / is on\./.test(t)).length === 1, `three quick switches show one mode toast (${toasts.join(' | ')})`);
  await pair('mode-toast');

  // ---------------------------------------------------------------- Today
  await navigate('home');
  await main.waitForSelector('[data-testid="home-today"]', { timeout: 15000 });
  const nowCard = main.locator('[data-testid="today-card-now"]');
  if (await nowCard.count()) {
    check(await nowCard.locator('[data-testid="empty-state"]').count() === 1 && /A clear day/.test(await nowCard.innerText()), 'an empty calendar shows the designed clear day');
    check(await nowCard.locator('[data-testid="today-add-event"]').count() === 1, 'with Add an event');
  } else check(false, 'Today shows Now and next');
  check(await main.locator('[data-testid="today-card-backup"], [data-testid="today-card-followup"]').count() === 0, 'quiet cards take no room on a calm day');
  await pair('today');
  await main.click('[data-testid="today-more"]');
  check(await main.locator('[data-testid="today-daily-note"]').count() === 1, 'Today’s More menu has Today’s note');
  await main.keyboard.press('Escape');

  // ---------------------------------------------------------------- Convert, Cues, Clock, Archives
  await navigate('convert');
  check(!!(await until(() => main.locator('[data-testid="convert-presets"]').count(), 10000)), 'Convert shows its presets');
  check(await main.locator('[data-testid="convert-preset-email"]').isDisabled(), 'a preset waits for files');
  await navigate('cues:checklists');
  check(!!(await until(() => main.locator('[data-testid="cue-starter"]').count(), 10000)), 'Cues offers ready-made checklists');
  const before = await main.locator('[data-testid="cue-starter"]').count();
  await main.locator('[data-testid="cue-starter"]', { hasText: 'Weekly review' }).click();
  check(!!(await until(async () => (await main.locator('[data-testid="cue-starter"]').count()) === before - 1, 8000)) && await main.locator('.tpl-row', { hasText: 'Weekly review' }).count() === 1, 'one click adds Weekly review as your own');
  await pair('cue-starters');
  await navigate('alarms:timers');
  check(!!(await until(() => main.locator('[data-testid="clock-focus"]').count(), 10000)), 'Clock → Timers has focus presets');
  await main.click('[data-testid="clock-focus-50"]');
  const f = await until(async () => { const s = await main.evaluate(() => window.keeper.island.state()); return s.focus?.mode === 'focus' ? s.focus : null; }, 8000);
  check(f && f.focusMin === 50 && f.breakMin === 10, `50 minutes with a 10-minute break (${f ? `${f.focusMin}/${f.breakMin}` : 'not started'})`);
  await pair('clock-focus');
  await main.evaluate(() => window.keeper.island.focus('stop')).catch(() => undefined);
  await navigate('archives');
  await wait(1500);
  const arch = await main.locator('.content').innerText().catch(() => '');
  check(!/bsdtar|unrar/.test(arch), 'Archives never names the program underneath');

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.log('FAIL', e.stack || e); process.exitCode = 1; });
