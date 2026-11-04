// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/meeting-notes.cjs /tmp/kmn-home /tmp/kmn-shots
// Drives the real Keeper app's Meetings page with a recorded meeting (its
// transcript written into the data folder, so no speech model is needed):
// your notes pad opens with the template the event's title picks, typing is
// saved, Tidy my notes keeps your words, fills them out from the transcript
// and marks what came from it, the action items go to Reminders once, your
// own template is added in the settings, and (when this computer can record)
// the pad sits beside the live transcript. Light and dark at 1440×900.

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

// A recorded 1:1, as Keeper saves it.
const userData = path.join(HOME, '.config', 'Keeper');
fs.mkdirSync(path.join(userData, 'voice', 'meetings'), { recursive: true });
fs.writeFileSync(path.join(userData, 'voice', 'settings.json'), JSON.stringify({ meetings: { notesAi: 'rules', detect: false, systemAudio: false, autoNotes: false } }));
const start = Date.now() - 2 * 3600_000;
const u = (id, at, speaker, text) => ({ id, start: at, end: at + 5, speaker, text, track: speaker === 'me' ? 'mic' : 'system' });
const ID = '2026-10-05-demo0001';
fs.writeFileSync(path.join(userData, 'voice', 'meetings', `${ID}.json`), JSON.stringify({
  id: ID, title: 'Weekly 1:1 with Anja', startedAt: start, endedAt: start + 26 * 60_000, durationMs: 26 * 60_000, app: 'Video call',
  speakers: [{ id: 'me', label: 'You', track: 'mic', estimated: false }, { id: 's1', label: 'Anja Tamm', track: 'system', estimated: false }],
  utterances: [
    u('a', 12, 's1', 'The budget for the autumn campaign was approved by finance yesterday afternoon.'),
    u('b', 75, 'me', 'Great. We decided to move the launch to the second week of November.'),
    u('c', 140, 's1', 'I am blocked on the new logo files, still waiting on the design agency.'),
    u('d', 205, 'me', 'I will send the press kit to the printers by Friday.'),
    u('e', 270, 's1', 'Hiring for the support role is going well, three strong candidates so far.'),
    u('f', 330, 's1', 'Could you review the onboarding guide before the next sprint?'),
  ],
  event: { id: 'ev1', title: 'Weekly 1:1 with Anja', start, end: start + 30 * 60_000, attendees: ['Anja Tamm'] },
}));

(async () => {
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const x = w.url(); return x && (!x.includes('view=') || x.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const v = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.voice[f](...args), [fn, a]);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const x = w.webContents.getURL(); if (!x.includes('view=') || x.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => { await wait(700); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

  // The sidebar as a rail: pictures show demo data only, never this computer's own place names.
  await main.keyboard.press('Control+Alt+KeyS').catch(() => undefined);
  const feats = await main.evaluate(() => window.keeper.features.list());
  check(feats.find((f) => f.id === 'meetingNotes')?.on === true, 'Your meeting notes is on with Meetings');
  await main.evaluate(() => window.keeper.features.set('planner', true)).catch(() => undefined);

  await navigate('meetings');
  await main.waitForSelector('[data-testid="meeting-detail"]', { timeout: 20000 });
  await main.click('[data-testid="meeting-pad-open"]');
  const pad = main.locator('[data-testid="meeting-pad"] textarea');
  await pad.waitFor({ timeout: 5000 });
  check(await main.locator('[data-testid="meeting-template"]').inputValue() === 'one-on-one', 'the 1:1 template is picked from the event title');
  check((await pad.inputValue()).includes('## Topics'), 'the pad starts with the template’s sections');
  await pad.fill('## Topics\n- budget approved\n- hiring\n- launch date\n\n## Action items\n- [ ] press kit to printers @Sam\n');
  await pad.blur();
  check(!!(await until(async () => (await v('meeting', ID)).myNotes?.includes('press kit'))), 'your notes are saved as you type');
  await shot('meeting-notes-pad-light');

  await main.click('[data-testid="meeting-notes"]');
  await main.waitForSelector('[data-testid="meeting-notes-card"] .meet-sec', { timeout: 15000 });
  const card = main.locator('[data-testid="meeting-notes-card"]');
  const text = await card.innerText();
  check(/Topics/i.test(text) && /budget approved/.test(text) && /hiring/.test(text), 'tidy notes keep your points, in your words, under your sections');
  check(/autumn campaign was approved/.test(text) && /three strong candidates/.test(text), 'short points are filled out from what was said');
  check(await card.locator('[data-from="transcript"]').count() > 0 && /from the call/.test(text), 'what came from the transcript is marked');
  const rec = await v('meeting', ID);
  check(rec.notes?.template === 'one-on-one' && rec.notes.actions.some((a) => a.from === 'you' && /press kit/.test(a.text) && a.owner === 'Sam'), 'your action item keeps its owner');
  check(rec.notes.actions.some((a) => a.from === 'transcript' && /onboarding guide/.test(a.text)), 'an action item said in the call is added');
  await card.scrollIntoViewIfNeeded();
  await main.evaluate(() => document.querySelector('[data-testid="meeting-detail"]')?.scrollIntoView({ block: 'start' }));
  await shot('meeting-notes-tidy-light');

  // Action items into Reminders, once.
  const remind = main.locator('[data-testid="meeting-remind"]');
  if (await remind.count()) {
    await remind.click();
    const after = await until(async () => { const m = await v('meeting', ID); return m.notes.actions.every((a) => a.taskId) ? m : null; });
    check(!!after, 'Add to Reminders makes a reminder for each action item');
    check(await v('sendActions', ID) === 0, 'and never twice');
    const list = await main.evaluate(() => window.keeper.pim?.reminders?.({}).catch(() => null) ?? null).catch(() => null);
    if (Array.isArray(list)) check(list.some((r) => /press kit/.test(r.title) && /Weekly 1:1/.test(r.notes ?? '')), 'the reminder says which meeting it came from');
  } else check(false, 'Add to Reminders is offered');

  // Writing the notes again keeps the reminders linked.
  await v('writeNotes', ID);
  check((await v('meeting', ID)).notes.actions.filter((a) => /press kit/.test(a.text)).every((a) => a.taskId), 'writing again keeps the reminders linked');

  // Your own template.
  await main.click('[data-testid="meetings-settings-toggle"]');
  await main.waitForSelector('[data-testid="meeting-templates"]', { timeout: 5000 });
  await main.fill('[aria-label="Template name"]', 'Planning');
  await main.fill('[aria-label="Sections"]', 'Goals, Risks, Owners');
  await main.fill('[aria-label="Words in the event title"]', 'planning, roadmap');
  await main.click('[data-testid="meeting-template-add"]');
  check(!!(await until(async () => (await v('settings')).meetings.templates.some((t) => t.name === 'Planning' && t.sections.length === 3))), 'your own template is saved');
  await main.locator('[data-testid="meeting-templates"]').scrollIntoViewIfNeeded();
  await shot('meeting-notes-templates-light');
  await main.click('[data-testid="meetings-settings-toggle"]');

  // The live pad (when this computer can record).
  const live = await v('startMeeting', { title: 'Quarterly planning' }).catch((e) => ({ error: String(e) }));
  if (live && !live.error) {
    check(live.template === 'custom-planning' && /## Goals/.test(live.myNotes ?? ''), 'a new recording’s pad uses the template its title picks');
    const lp = main.locator('[data-testid="meetings-live-pad"] textarea');
    if (await lp.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)) {
      await lp.fill('## Goals\n- ship the autumn campaign\n');
      await wait(1200);
      await shot('meeting-notes-live-light');
    }
    await main.click('[data-testid="meetings-stop"]').catch(() => v('stopMeeting'));
    const saved = await until(async () => (await v('meetings')).find((m) => m.title === 'Quarterly planning'), 30000);
    check(!!saved && /ship the autumn campaign/.test(saved.myNotes ?? ''), 'notes typed while recording are kept with the meeting');
  } else console.log(`SKIP live pad: this computer cannot record here (${live?.error ?? 'no answer'})`);

  // Dark.
  await navigate('meetings');
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await main.waitForSelector('[data-testid="meeting-detail"]', { timeout: 10000 });
  await main.locator('.meet-item', { hasText: 'Weekly 1:1 with Anja' }).click();
  await main.waitForSelector('[data-testid="meeting-notes-card"] .meet-sec', { timeout: 10000 });
  await main.evaluate(() => document.querySelector('[data-testid="meeting-detail"]')?.scrollIntoView({ block: 'start' }));
  await shot('meeting-notes-tidy-dark');
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));

  check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await app.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
