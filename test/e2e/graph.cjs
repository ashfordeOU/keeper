// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a node test/e2e/graph.cjs /tmp/kg /tmp/kg-shots [models-dir]
// Drives the real Keeper app with a made-up home folder and demo mail,
// contacts, a calendar event, a task and a recorded meeting kept on this
// computer (no mail server is needed), and a stand-in AI:
//   - one person, Lena Fischer, written three ways, is linked to her mail, the
//     meeting, the event, a note and a file, each link with its reason;
//   - "Explain this connection" joins a saved attachment to the event;
//   - leaving mail out removes every mail node; putting it back restores them;
//   - the Graph page: search, the inspector, Focus, the timeline, light and dark;
//   - Related panels in Mail (the sender) and Calendar (the event);
//   - the Assistant answers "what do I have about Lena?" across mail, notes,
//     files and the calendar, citing each;
//   - with a models dir holding multilingual-e5-small: mail and events get
//     meaning vectors in the background and are found without shared words.
const { _electron } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const HOME = path.resolve(process.argv[2] || '/tmp/kg');
const SHOTS = path.resolve(process.argv[3] || '/tmp/kg-shots');
const MODELS = process.argv[4];
const ROOT = path.resolve(__dirname, '../..');
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const DOCS = path.join(HOME, 'Documents');
const DOWN = path.join(HOME, 'Downloads');
const NOTES = path.join(DOCS, 'Notes');
const DATA = path.join(HOME, '.config', 'Keeper');
const PIM = path.join(DATA, 'pim');
for (const d of [DOCS, DOWN, NOTES, DATA, PIM]) fs.mkdirSync(d, { recursive: true });

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const json = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v)); };

// ---------------------------------------------------------------- demo data
const day = new Date();
day.setHours(10, 0, 0, 0);
const T0 = day.getTime() - 2 * 86_400_000;
const H = 3_600_000;
const NOTE = path.join(NOTES, 'Lease viewing.md');
fs.writeFileSync(NOTE, 'Walked through the flat with L. Fischer. Damp in the bathroom; the deposit stays at 2,400 EUR. See [[Apartment move]]. #home\n');
fs.writeFileSync(path.join(NOTES, 'Apartment move.md'), 'Moving in March. Acme Property GmbH wants the signed lease back first. #home\n');
const RECEIPT = path.join(DOCS, 'Deposit receipt.txt');
fs.writeFileSync(RECEIPT, 'Deposit receipt 2,400 EUR, received by Lena Fischer for Acme Property GmbH.\n');
const LEASE = path.join(DOWN, 'lease.pdf');
fs.writeFileSync(LEASE, '%PDF-1.4 lease agreement Acme Property GmbH');
// The note was written during the viewing.
fs.utimesSync(NOTE, new Date(T0 + 0.6 * H), new Date(T0 + 0.6 * H));

const ACC = 'acc1';
json(path.join(PIM, 'accounts.json'), [{ id: ACC, kind: 'imap', label: 'Home', email: 'sam@home.example', identities: [{ name: 'Sam', email: 'sam@home.example' }], imap: { host: '127.0.0.1', port: 9, security: 'none', user: 'sam' }, smtp: { host: '127.0.0.1', port: 9, security: 'none' }, mail: true, calendar: false, contacts: false }]);
json(path.join(PIM, 'mail', hash(ACC), 'folders.json'), [{ account: ACC, path: 'INBOX', name: 'Inbox', special: 'inbox', unread: 0, total: 3 }]);
const msg = (uid, subject, from, date, extra = {}) => ({ id: `${ACC}:INBOX:${uid}`, account: ACC, folder: 'INBOX', uid, messageId: `<m${uid}@acme.example>`, subject, from, to: [{ name: 'Sam', address: 'sam@home.example' }], cc: [], date, seen: true, flagged: false, answered: false, snippet: '', hasAttachments: false, ...extra });
const LENA_WORK = { name: 'Lena Fischer', address: 'lena.fischer@acme-property.example' };
const messages = [
  msg(7, 'Lease renewal and deposit', LENA_WORK, T0 - 3 * 86_400_000, { hasAttachments: true, snippet: 'The new lease is attached.' }),
  msg(8, 'Re: Lease renewal and deposit', { name: 'Fischer, Lena', address: 'Lena.Fischer@acme-property.example' }, T0 - 2.5 * 86_400_000, { inReplyTo: '<m7@acme.example>', references: ['<m7@acme.example>'], snippet: 'Thursday at 10 works.' }),
  msg(9, 'Your rent receipt', { name: 'Acme Billing', address: 'billing@acme-property.example' }, T0 - 9 * 86_400_000, { snippet: 'Rent for October received.' }),
];
json(path.join(PIM, 'mail', hash(ACC), `${hash('INBOX')}.json`), { uidValidity: '1', uidNext: 10, messages });
json(path.join(PIM, 'bodies', `${hash(`${ACC}:INBOX:7`)}.json`), { body: { id: `${ACC}:INBOX:7`, text: 'Hi Sam, the new lease is attached. The deposit stays at 2,400 EUR. Can we meet at the flat on Elm Street?', attachments: [{ id: '2', filename: 'lease.pdf', contentType: 'application/pdf', size: 40 }], headers: {} }, cid: {} });
json(path.join(PIM, 'contacts.json'), [{ id: 'c1', account: 'local', name: 'Lena Fischer', emails: ['lena@fischer-home.example', 'lena.fischer@acme-property.example'], phones: [], org: 'Acme Property GmbH' }]);
const EVENT_ID = 'local:calendar:lease-viewing';
json(path.join(PIM, 'state.json'), {
  calendars: [{ id: 'local:calendar', account: 'local', name: 'On this computer', color: '#0a84ff', url: '', readOnly: false, visible: true, tasks: true }],
  reminders: [{ id: 'r1', list: 'local', title: 'Sign the new lease', project: '#home', url: `keeper://mail/${encodeURIComponent(`${ACC}:INBOX:7`)}`, done: false, due: T0 + 2 * 86_400_000, created: T0 - 86_400_000 }],
  prefs: { holidayCountry: '' },
});
json(path.join(PIM, 'cal', `${hash('local:calendar')}.json`), { events: [{ id: EVENT_ID, calendar: 'local:calendar', uid: 'lease-viewing', title: 'Lease viewing', start: T0, end: T0 + H, allDay: false, location: 'Flat on Elm Street', attendees: [{ email: 'lena@fischer-home.example', name: 'Lena Fischer', status: 'accepted' }, { email: 'sam@home.example', name: 'Sam' }] }] });
json(path.join(DATA, 'voice', 'meetings', 'm1.json'), { id: 'm1', title: 'Lease viewing', startedAt: T0 + 5 * 60_000, endedAt: T0 + 52 * 60_000, durationMs: 47 * 60_000, app: 'Keeper', speakers: [{ id: 's1', label: 'You', track: 'mic' }, { id: 's2', label: 'Lena Fischer', track: 'system' }], utterances: [{ id: 'u1', start: 1, end: 5, speaker: 's2', text: 'The deposit is 2,400 EUR and the bathroom will be repainted.', track: 'system' }], event: { id: EVENT_ID, title: 'Lease viewing', start: T0, end: T0 + H, attendees: ['lena@fischer-home.example'] } });

// ---------------------------------------------------------------- a stand-in AI
const seen = [];
const ai = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    seen.push(body);
    const msgs = body.messages;
    const last = msgs[msgs.length - 1];
    const reply = (message) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] })); };
    const tools = (body.tools || []).map((t) => t.function.name);
    if (last.role === 'user' && tools.includes('search_everything')) return reply({ role: 'assistant', content: null, tool_calls: [{ id: 'e1', type: 'function', function: { name: 'search_everything', arguments: JSON.stringify({ query: 'Lena Fischer lease' }) } }] });
    if (last.role === 'tool') {
      const cites = [...last.content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
      const mail = cites.find((c) => c.startsWith('keeper://mail/'));
      const other = cites.find((c) => !c.startsWith('keeper://mail/'));
      return reply({ role: 'assistant', content: `Lena wrote about the lease [[${mail}]]. See also [[${other}]].` });
    }
    reply({ role: 'assistant', content: 'stand-in answer' });
  });
});

(async () => {
  await new Promise((r) => ai.listen(0, '127.0.0.1', r));
  const port = ai.address().port;
  if (MODELS) fs.symlinkSync(path.resolve(MODELS), path.join(DATA, 'models'));
  json(path.join(DATA, 'settings.json'), {
    folders: [DOCS, DOWN],
    brain: { enabled: true, semantic: !!MODELS, visibility: 'full', active: 'mock', pauseOnBattery: false, connections: [{ id: 'mock', kind: 'openai-compatible', label: 'Test AI (this computer)', model: 'mock-1', baseUrl: `http://127.0.0.1:${port}/v1` }] },
  });

  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', KEEPER_SKIP_TOUR: '1', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 60 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 60000 });
  await main.waitForTimeout(2000);
  const skip = await main.$('.tour button:has-text("Skip tour")');
  if (skip) await skip.click();
  for (let i = 0; i < 60; i++) {
    const st = await main.evaluate(() => window.keeper.brain.status());
    if (st.withText >= 3) break;
    await main.waitForTimeout(1000);
  }

  // ---- one person, linked to everything, with reasons
  let st = await main.evaluate(() => window.keeper.agents.graphStatus());
  // Mail and calendars may still be starting: the graph catches up at most every 30 seconds.
  for (let i = 0; i < 30 && !(st.counts.mail && st.counts.event && st.counts.meeting && st.counts.file); i++) {
    await main.waitForTimeout(1500);
    st = await main.evaluate(() => window.keeper.agents.graphStatus());
  }
  check(st.on && st.counts.mail >= 2 && st.counts.event === 1 && st.counts.meeting === 1 && st.counts.task === 1 && st.counts.note >= 2, `the graph holds mail, an event, a meeting, a task and notes (${JSON.stringify(st.counts)})`);
  const lena = await main.evaluate(() => window.keeper.agents.graphRelated({ email: 'LENA@fischer-home.example' }, { limit: 30 }));
  check(lena.node?.kind === 'person' && lena.node.label === 'Lena Fischer' && lena.node.emails.length === 2, 'Lena’s two addresses, her card and “Fischer, Lena” are one person');
  const kinds = new Set(lena.items.map((r) => r.node.kind));
  check(['mail', 'meeting', 'event', 'note', 'file'].every((k) => kinds.has(k)), `Lena is linked to mail, a meeting, an event, a note and a file (${[...kinds].join(', ')})`);
  const why = (kind) => lena.items.find((r) => r.node.kind === kind)?.why[0] ?? '';
  check(/wrote “(Re: )?Lease renewal/.test(why('mail')) && /invited to “Lease viewing”/.test(why('event')) && /Named in/.test(why('note')), `each link says why (${why('mail')} · ${why('event')} · ${why('note')})`);
  check(lena.items.some((r) => r.node.kind === 'org' && r.node.label === 'Acme Property GmbH'), 'she works at Acme Property GmbH (from her card and her address)');
  const lease = await main.evaluate((p) => window.keeper.agents.graphRelated({ path: p }, { limit: 20 }), LEASE);
  check(lease.items.some((r) => r.node.kind === 'mail' && r.reason === 'attached'), 'the saved attachment is linked to the email it came with');
  const x = await main.evaluate(([a, b]) => window.keeper.agents.graphExplain(a, b), [`f:${LEASE}`, `ev:${EVENT_ID}`]);
  check(!!x && x.steps.length >= 3 && x.steps.length <= 5 && x.steps.slice(1).every((s) => s.why?.length), `“Explain this connection” joins the lease to the viewing in ${x?.steps.length ?? 0} steps`);
  const hits = await main.evaluate(() => window.keeper.agents.searchEverything('deposit Lena', { limit: 10 }));
  check(hits.some((h) => h.kind === 'mail') && hits.some((h) => h.kind === 'file' || h.kind === 'note'), `one search finds mail and files together (${hits.map((h) => h.kind).join(', ')})`);

  // ---- search by meaning over mail, events and the rest (with the model)
  if (MODELS) {
    let m = (await main.evaluate(() => window.keeper.agents.graphStatus())).meaning;
    for (let i = 0; i < 60 && !(m.on && m.items > 0 && m.pending === 0); i++) {
      await main.waitForTimeout(1000);
      m = (await main.evaluate(() => window.keeper.agents.graphStatus())).meaning;
    }
    check(m.on && m.embedded >= 5 && m.pending === 0, `mail, events, tasks, contacts and meetings got meaning vectors in the background (${m.embedded} of ${m.items})`);
    const byMeaning = await main.evaluate(() => window.keeper.agents.searchEverything('how much money do I pay as security for the apartment', { kinds: ['mail', 'event', 'task', 'meeting'] }));
    check(byMeaning.some((h) => h.why.includes('meaning') && /deposit|lease|viewing/i.test(h.title + (h.snippet ?? ''))), `an email or meeting is found by meaning without shared words (${byMeaning.map((h) => `${h.kind}:${h.title}:${h.why}`).join(' | ')})`);
  }

  // ---- privacy: no mail when mail is left out
  const before = await main.evaluate(() => window.keeper.settings.get().then((s) => s.graph));
  await main.evaluate((g) => window.keeper.settings.set({ graph: { ...g, mail: false } }), before);
  const off = await main.evaluate(() => window.keeper.agents.graphStatus());
  const offHits = await main.evaluate(() => window.keeper.agents.searchEverything('lease renewal', { kinds: ['mail'] }));
  check(!off.counts.mail && offHits.length === 0, 'leaving mail out removes mail from the graph and from search by meaning');
  await main.evaluate((g) => window.keeper.settings.set({ graph: g }), before);
  const on = await main.evaluate(() => window.keeper.agents.graphStatus());
  check(on.counts.mail >= 2, 'putting mail back brings it back');

  // ---- the Graph page
  const shot = async (name) => { await main.waitForTimeout(900); await main.screenshot({ path: `${SHOTS}/${name}.png` }); };
  await main.locator('.sidebar [title="Knowledge Graph"]').click();
  await main.waitForSelector('[data-testid="kg-canvas"]', { timeout: 15000 });
  await main.waitForTimeout(2500);
  check(await main.locator('[data-testid="kg-start-chip"]', { hasText: 'Lena Fischer' }).count() > 0, 'the page starts with the people who link most');
  await shot('graph-overview-light');
  await main.fill('[data-testid="kg-search"]', 'lena');
  await main.waitForSelector('[data-testid="kg-opt-node"]', { timeout: 5000 });
  await main.waitForSelector('[data-testid="kg-opt-hit"]', { timeout: 5000 }).catch(() => undefined);
  check(await main.locator('[data-testid="kg-opt-hit"]').count() > 0, 'the search box also finds things inside mail, notes and files');
  await shot('graph-search-light');
  await main.keyboard.press('Enter');
  await main.waitForSelector('[data-testid="kg-side-title"]', { timeout: 8000 });
  await main.waitForSelector('[data-testid="kg-link"]', { timeout: 8000 });
  check((await main.locator('[data-testid="kg-side-title"]').innerText()) === 'Lena Fischer', 'picking her focuses the graph on her and opens the inspector');
  const sideText = await main.locator('[data-testid="kg-side"]').innerText();
  check(/Lease renewal/.test(sideText) && /Lease viewing/.test(sideText) && /Email/.test(sideText), 'the inspector lists her mail and the viewing, with Email as the main action');
  await shot('graph-person-light');
  await main.fill('[data-testid="kg-explain-input"]', 'lease.pdf');
  await main.waitForSelector('[data-testid="kg-explain-opt"]', { timeout: 5000 });
  await main.locator('[data-testid="kg-explain-opt"]').first().click();
  await main.waitForSelector('[data-testid="kg-explain"]', { timeout: 5000 });
  check(/Attached to|Emailed/.test(await main.locator('[data-testid="kg-explain"]').innerText()), 'the inspector explains how she connects to the lease');
  await shot('graph-explain-light');
  await main.locator('[data-testid="kg-mode-timeline"]').click();
  await shot('graph-timeline-light');
  await main.locator('[data-testid="kg-mode-map"]').click();
  await main.locator('[data-testid="kg-privacy-open"]').click();
  await main.waitForSelector('[data-testid="kg-privacy"]', { timeout: 5000 });
  await shot('graph-privacy-light');
  await main.keyboard.press('Escape');

  // ---- Related panels in Mail and Calendar
  await main.evaluate((id) => window.keeper.search.open(`mail:${id}`), `${ACC}:INBOX:8`);
  await main.waitForSelector('[data-testid="mail-related"]', { timeout: 15000 });
  await main.locator('[data-testid="mail-related"] button[aria-expanded]').first().click();
  await main.waitForSelector('[data-testid="mail-related"] [data-testid="related-row"]', { timeout: 8000 });
  const mailRel = await main.locator('[data-testid="mail-related"]').first().innerText();
  check(/Lease viewing/.test(mailRel), 'Mail: the sender’s Related panel shows the viewing and her other things');
  await shot('graph-related-mail-light');
  await main.locator('.sidebar [title="Calendar"]').click().catch(() => undefined);
  await main.evaluate(([at, id]) => window.keeper.search.open(`calendar:event:${at}:${id}`), [T0, EVENT_ID]).catch(() => undefined);
  const evRel = await main.waitForSelector('[data-testid="event-related"]', { timeout: 10000 }).then(() => true, () => false);
  if (evRel) {
    await main.locator('[data-testid="event-related"] button[aria-expanded]').click();
    await main.waitForSelector('[data-testid="event-related"] [data-testid="related-row"]', { timeout: 8000 }).catch(() => undefined);
  }
  const evText = evRel ? await main.locator('[data-testid="event-related"]').innerText() : '';
  check(/Lena Fischer/.test(evText) && /Lease viewing/.test(evText), 'Calendar: the event’s Related panel shows Lena and the recorded meeting');
  await main.keyboard.press('Escape');

  // ---- the Assistant: what do I have about Lena?
  await main.locator('.sidebar [title="Assistant"]').click();
  await main.waitForSelector('.composer textarea', { timeout: 10000 });
  await main.fill('.composer textarea', 'What do I have about Lena Fischer?');
  await main.keyboard.press('Enter');
  await main.waitForSelector('.cite', { timeout: 30000 });
  const cites = await main.locator('.cite').allInnerTexts();
  const asked = seen.find((b) => (b.tools || []).some((t) => t.function.name === 'search_everything'));
  check(!!asked, 'the Assistant is given search over everything');
  check(cites.length >= 2 && cites.some((c) => /Lease renewal/.test(c)), `the answer cites the email by its subject (${cites.join(' | ')})`);
  await main.waitForSelector('.sources .source', { timeout: 5000 }).catch(() => undefined);
  await shot('graph-assistant-light');

  // ---- dark
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await main.locator('.sidebar [title="Knowledge Graph"]').click();
  await main.waitForSelector('[data-testid="kg-canvas"]', { timeout: 10000 });
  await main.waitForTimeout(2000);
  await shot('graph-overview-dark');
  await main.locator('[data-testid="kg-start-chip"]', { hasText: 'Lena Fischer' }).first().click();
  await main.waitForSelector('[data-testid="kg-link"]', { timeout: 8000 });
  await shot('graph-person-dark');
  await main.locator('[data-testid="kg-mode-timeline"]').click();
  await shot('graph-timeline-dark');
  await main.locator('[data-testid="kg-mode-map"]').click();
  await main.locator('[data-testid="kg-back"]').click();
  await main.waitForTimeout(500);
  await main.fill('[data-testid="kg-search"]', 'deposit');
  await main.waitForSelector('[data-testid="kg-opt-hit"]', { timeout: 5000 }).catch(() => undefined);
  await shot('graph-search-dark');
  await main.setViewportSize({ width: 1024, height: 768 });
  await main.keyboard.press('Escape');
  await main.locator('[data-testid="kg-start-chip"]').first().click().catch(() => undefined);
  await shot('graph-person-dark-1024');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
  ai.close();
})().catch((e) => { console.error(e); process.exit(1); });
