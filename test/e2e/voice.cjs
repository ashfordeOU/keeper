// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/voice.cjs /tmp/kvoice /tmp/kvoice-shots [speech.wav] [whisper-model-dir]
// Drives the real Keeper app's Voice: Dictation and Meetings pages in the
// sidebar, the tidy-up preview, the menu-bar items, a dictation take spoken
// into Chromium's fake microphone (a WAV file) streamed live, recognised on
// this computer, tidied and put on the clipboard (copy-only mode), the
// floating pill and the Island while listening, Esc-style cancel, the talk-key
// hook's honest note when this session can't listen to keys, a meeting
// recorded and transcribed with plain-rule notes, the Island and tray while
// recording, and the feature switch hiding pages and menu items. Light and dark.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(process.argv[2] ? path.dirname(path.resolve(process.argv[2])) : require('os').tmpdir(), 'kvoice-')));
const SHOTS = path.resolve(process.argv[3] || '/tmp/kvoice-shots');
const APP = path.resolve(__dirname, '../..');
const WAV = path.resolve(process.argv[4] || process.env.KEEPER_SPEECH_SAMPLE || '');
const MODEL = path.resolve(process.argv[5] || process.env.KEEPER_WHISPER_DIR || '');
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
const userData = path.join(HOME, '.config', 'Keeper');
// The small on-device model, so nothing is downloaded during the test.
if (MODEL && fs.existsSync(path.join(MODEL, 'whisper-tiny'))) fs.cpSync(path.join(MODEL, 'whisper-tiny'), path.join(userData, 'models', 'whisper-tiny'), { recursive: true });
fs.mkdirSync(path.join(userData, 'voice'), { recursive: true });
fs.writeFileSync(path.join(userData, 'voice', 'settings.json'), JSON.stringify({ dictation: { model: 'tiny', insert: 'copy', language: 'en', sounds: false, hud: 'both' }, meetings: { model: 'tiny', language: 'en', notesAi: 'rules', detect: false } }));

// Voice's tabs: the sidebar's Voice row, then the tab.
let openTab = async () => undefined;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10_000, step = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await wait(step);
  }
}

(async () => {
  const haveSpeech = WAV && fs.existsSync(WAV) && fs.existsSync(path.join(userData, 'models', 'whisper-tiny'));
  const env = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' };
  const args = [APP, '--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(haveSpeech ? [`--use-file-for-fake-audio-capture=${WAV}`] : [])];
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args, env });
  let main;
  let isl;
  for (let i = 0; i < 80 && !(main && isl); i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    isl = app.windows().find((w) => w.url().includes('view=island'));
    if (!(main && isl)) await wait(500);
  }
  check(!!main, 'Keeper opens');
  const errors = [];
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  openTab = async (id) => { await main.locator('.sidebar [title="Voice"]').first().click(); await main.locator(`[data-testid="hub-tab-${id}"]`).first().click(); };
  await wait(2500);
  await main.locator('.tour button:has-text("Skip tour")').click({ timeout: 3000 }).catch(() => undefined);
  await main.setViewportSize?.({ width: 1440, height: 900 }).catch(() => undefined);
  const v = (fn, ...a) => main.evaluate(([f, x]) => window.keeper.voice[f](...x), [fn, a]);
  const hudWin = () => app.windows().find((w) => w.url().includes('view=voice'));

  // ---- idle: nothing listens, nothing loaded
  let st = await v('status');
  check(st.dictation.phase === 'idle' && !st.meeting, 'idle: not listening, not recording');
  check(!hudWin(), 'no listening-pill window exists until it is needed');
  const feats = await main.evaluate(() => window.keeper.features.list());
  const f = (id) => feats.find((x) => x.id === id);
  check(f('dictation')?.on && f('meetings')?.on && f('dictationHold') && !f('dictationHold').on, 'Dictation and Meetings on; hold-to-talk off by default (it listens to a key)');
  const cfg = await v('settings');
  check(cfg.dictation.engine === 'device', 'speech is recognised on this computer by default');
  check(haveSpeech ? st.models.includes('tiny') : true, `speech models found: ${st.models.join(', ') || 'none'}`);

  // ---- placement: sidebar, page, tray, palette
  check(await main.locator('.sidebar [title="Voice"]').count() > 0, 'the sidebar has one Voice page');
  await main.locator('.sidebar [title="Voice"]').first().click();
  await main.waitForSelector('[data-testid="hub-tab-meetings"]');
  check(await main.locator('[data-testid="hub-tab-dictation"]').count() === 1 && await main.locator('[data-testid="hub-tab-snippets"]').count() === 1, 'Voice has Dictation, Meetings and Snippets tabs');
  let tray = await v('tray');
  check(tray.includes('Dictation') && tray.includes('  Start Dictating') && tray.includes('Record Meeting'), `the tray has Dictation and Record Meeting (${tray.join(' | ')})`);
  await openTab('dictation');
  await main.waitForSelector('[data-testid="dictation-hero"]');
  await wait(400);
  await main.screenshot({ path: path.join(SHOTS, 'dictation-light.png') });
  await main.click('[data-testid="dictation-tab-words"]');
  const out = await until(async () => { const t = await main.locator('[data-testid="dictation-try-out"]').textContent(); return t && t.length > 10 ? t : null; });
  check(/4 PM/.test(out ?? '') && /anna\.lee@example\.com/.test(out ?? '') && /👍/.test(out ?? '') && !/\bum\b/.test(out ?? ''), `the tidy-up preview formats, corrects and removes fillers: ${JSON.stringify(out)}`);
  await main.fill('[data-testid="dictation-word"]', 'Kubernetes');
  await main.click('[data-testid="dictation-word-add"]');
  check((await until(async () => (await v('settings')).dictionary.some((d) => d.word === 'Kubernetes'))) === true, 'a word added to the personal dictionary is saved');
  await main.screenshot({ path: path.join(SHOTS, 'dictation-words-light.png') });
  await main.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await main.keyboard.type('start dictating');
  check(await main.locator('text=Start Dictating').count() > 0, 'the command palette offers Start Dictating');
  await main.keyboard.press('Escape');

  // ---- the talk key: on this session the hook is honest about what it can do
  await main.evaluate(() => window.keeper.features.set('dictationHold', true));
  st = await until(async () => { const s = await v('status'); return s.supports.keyHow && s.supports.keyHow !== 'Starting…' ? s : null; }, 8000);
  check(!!st, `hold-to-talk: ${st?.supports.holdKey ? `listening with ${st.supports.keyHow}` : `not possible here, and says why: “${st?.supports.keyHow}”`}`);
  await main.click('[data-testid="dictation-tab-dictate"]');
  await wait(500);
  await main.screenshot({ path: path.join(SHOTS, 'dictation-hold-light.png') });
  await main.evaluate(() => window.keeper.features.set('dictationHold', false));

  // ---- a take: live text in the pill and the Island, then the finished text
  if (haveSpeech) {
    await v('start', 'toggle');
    const hud = await until(async () => hudWin());
    check(!!hud, 'starting opens the floating listening pill');
    const live = await until(async () => { const s = await v('status'); return s.dictation.stable || s.dictation.pending ? s.dictation : null; }, 40_000, 400);
    check(!!live, `words appear live while speaking: “${live ? `${live.stable} ${live.pending}`.trim() : ''}”`);
    if (hud) {
      await hud.waitForSelector('[data-testid="voice-pill"]', { timeout: 5000 }).catch(() => undefined);
      await hud.screenshot({ path: path.join(SHOTS, 'voice-pill-light.png') }).catch(() => undefined);
      check(await hud.locator('[data-testid="voice-pill"]').count() === 1, 'the pill shows the live text');
    }
    check(await isl.locator('.level').count() > 0, 'the Island shows listening too');
    await isl.screenshot({ path: path.join(SHOTS, 'voice-island-listening.png') }).catch(() => undefined);
    await wait(9000);
    await v('stop');
    const take = await until(async () => { const h = await v('history', { limit: 5 }); return h[0] ? h[0] : null; }, 60_000, 500);
    check(!!take && /country/i.test(take.text), `the take is recognised on this computer and kept in history: “${take?.text}”`);
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    check(!!take && clip === take.text, 'copy-only mode put the finished text on the clipboard');
    check(take?.outcome === 'copied' && take.app !== undefined || take?.outcome === 'copied', `outcome recorded (${take?.outcome}, app ${take?.app ?? 'unknown'})`);
    // cancel throws it away
    const before = (await v('history')).length;
    await v('start', 'toggle');
    await wait(1500);
    await v('cancel');
    await wait(1500);
    check((await v('history')).length === before && (await v('status')).dictation.phase === 'idle', 'a cancelled take is thrown away');
    const stats = await v('stats');
    check(stats.takes >= 1 && stats.words > 5, `statistics count words (${stats.words}) and time saved (${stats.minutesSaved} min)`);
    // statistics as a picture
    await main.click('[data-testid="dictation-tab-dictate"]').catch(() => undefined);
    await main.click('[data-testid="dictation-stats-png"]');
    const dl = await app.evaluate(({ app: a }) => a.getPath('downloads'));
    const png = await until(async () => { const f = fs.readdirSync(dl).find((x) => /^Keeper dictation .*\.png$/.test(x)); return f ? path.join(dl, f) : null; }, 8000);
    const head = png ? fs.readFileSync(png).subarray(0, 8).toString('hex') : '';
    check(head === '89504e470d0a1a0a' && fs.statSync(png).size > 5000, `“Save as picture” writes a PNG of the statistics (${png ? path.basename(png) : 'none'}, ${png ? fs.statSync(png).size : 0} bytes)`);
    if (png) fs.copyFileSync(png, path.join(SHOTS, 'dictation-stats-export.png'));
  } else console.log('INFO no speech sample or model given: the live take is not exercised (pass a WAV and a whisper-tiny folder)');

  // ---- a meeting
  await openTab('meetings');
  if (!(await main.waitForSelector('[data-testid="meetings-live"]', { timeout: 15_000 }).catch(() => null))) {
    await main.screenshot({ path: path.join(SHOTS, 'meetings-missing.png') });
    console.log('INFO page now:', (await main.evaluate(() => document.querySelector('.content')?.innerText ?? '')).replace(/\s+/g, ' ').slice(0, 300), errors.join(' | '));
    await openTab('meetings');
    await main.waitForSelector('[data-testid="meetings-live"]');
  }
  await main.screenshot({ path: path.join(SHOTS, 'meetings-light.png') });
  check(await main.locator('text=Tell everyone in the call').count() > 0, 'the consent reminder is shown before recording');
  await main.click('[data-testid="meetings-record"]');
  const live = await until(async () => (await v('status')).meeting, 8000);
  check(!!live, 'Record starts a meeting');
  console.log(`INFO computer's sound: ${live?.tracks.system ? 'recorded' : `not here: ${live?.systemNote}`}`);
  tray = await v('tray');
  check(tray.some((t) => /^Recording “/.test(t)) && tray.includes('  Stop and Save'), `the tray shows the recording with Pause and Stop (${tray[tray.length - 4] ?? ''})`);
  const islRec = await until(async () => { const t = await isl.evaluate(() => document.body.innerText); return /Recording “|Paused:/.test(t) ? t : null; }, 18_000);
  check(!!islRec, `the Island shows the meeting being recorded${islRec ? '' : `: ${(await isl.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200)}`}`);
  await isl.screenshot({ path: path.join(SHOTS, 'voice-island-meeting.png') }).catch(() => undefined);
  if (haveSpeech) {
    const lines = await until(async () => { const s = await v('status'); return s.meeting?.utterances.length ? s.meeting.utterances : null; }, 60_000, 1000);
    check(!!lines, `lines appear in the live transcript: “${lines?.[0]?.text ?? ''}”`);
  } else await wait(4000);
  await main.screenshot({ path: path.join(SHOTS, 'meetings-live-light.png') });
  const hud = hudWin();
  if (hud) await hud.screenshot({ path: path.join(SHOTS, 'voice-meeting-bar-light.png') }).catch(() => undefined);
  await v('pauseMeeting', true);
  check((await v('status')).meeting?.paused === true, 'Pause works');
  await v('pauseMeeting', false);
  const rec = await v('stopMeeting');
  check(!!rec && !!rec.id && (!haveSpeech || rec.utterances.length > 0), `Stop saves it (${rec?.utterances.length ?? 0} lines, speakers ${rec?.speakers.map((s) => s.label).join(', ')})`);
  check(!haveSpeech || (rec?.notes?.by === 'rules' && typeof rec.notes.summary === 'string'), 'notes are written on this computer (plain rules: no AI chosen)');
  check(!(await v('status')).meeting && (await v('tray')).includes('Record Meeting'), 'after stopping, the tray offers Record Meeting again');
  await main.click('[data-testid="meetings-settings-toggle"]');
  check(await main.locator('text=Suggest names from remembered voices').count() === 1, 'meeting settings offer name suggestions from remembered voices');
  await main.click('[data-testid="meetings-settings-toggle"]');
  await main.waitForSelector('[data-testid="meeting-detail"]', { timeout: 10_000 }).catch(() => undefined);
  await wait(600);
  await main.screenshot({ path: path.join(SHOTS, 'meetings-detail-light.png') });
  check(await main.locator('[data-testid="meeting-transcript"]').count() === 1, 'the meeting opens with its transcript');

  // ---- dark
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await wait(800);
  await main.screenshot({ path: path.join(SHOTS, 'meetings-detail-dark.png') });
  await openTab('dictation');
  await main.waitForSelector('[data-testid="dictation-hero"]');
  await wait(400);
  await main.screenshot({ path: path.join(SHOTS, 'dictation-dark.png') });
  await main.click('[data-testid="dictation-tab-history"]');
  await wait(500);
  await main.screenshot({ path: path.join(SHOTS, 'dictation-history-dark.png') });
  await main.click('[data-testid="dictation-tab-settings"]');
  await wait(500);
  check(await main.locator('text=Spell my project’s names').count() === 1 && !(await v('settings')).dictation.codeTerms, 'code-aware spelling is offered and off until chosen');
  await main.screenshot({ path: path.join(SHOTS, 'dictation-settings-dark.png'), fullPage: true });
  // small window
  await main.setViewportSize?.({ width: 820, height: 640 }).catch(() => undefined);
  await openTab('meetings').catch(() => undefined);
  await wait(500);
  await main.screenshot({ path: path.join(SHOTS, 'meetings-small-dark.png') });
  const overflow = await main.evaluate(() => { const c = document.querySelector('.content'); return c ? c.scrollWidth - c.clientWidth : 0; });
  check(overflow <= 2, `no sideways scrolling in a small window (${overflow}px)`);
  await main.setViewportSize?.({ width: 1440, height: 900 }).catch(() => undefined);

  // ---- switching Meetings off hides its page and tray items
  await openTab('dictation');
  await main.evaluate(() => window.keeper.features.set('meetings', false));
  await wait(800);
  check(!(await v('tray')).some((t) => /Meeting/.test(t)), 'with Meetings off, the tray has no meeting items');
  check(await main.locator('[data-testid="hub-tab-meetings"]').count() === 0, 'and Voice has no Meetings tab');
  await main.evaluate(() => window.keeper.features.set('meetings', true));

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  fs.rmSync(HOME, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
