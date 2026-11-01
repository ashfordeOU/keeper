// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux, Dovecot installed): xvfb-run -a node test/e2e/pim.cjs /tmp/kp-pim /tmp/kp-pim-shots
// Drives the real Keeper app against a local IMAP server (Dovecot), SMTP
// server and CalDAV server: adds a mail account through the dialog, reads a
// message with its remote picture held back, replies (with undo send) and
// finds the reply in Sent; adds a CalDAV account, writes a repeating event and
// changes one occurrence; an event alert reaches the Island; a timer rings.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');
const { SMTPServer } = require('smtp-server');
const { startDovecot } = require('../servers/dovecot.cjs');
const { startCalDav } = require('../servers/caldav.cjs');

const HOME = path.resolve(process.argv[2] || '/tmp/kp-pim');
const SHOTS = path.resolve(process.argv[3] || '/tmp/kp-pim-shots');
fs.rmSync(HOME, { recursive: true, force: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };

const MSG = (subject, extra = '') => [
  'From: Ana Lopez <ana@example.org>', 'To: Ana <ana@example.org>', `Subject: ${subject}`, `Message-ID: <${subject.replace(/\W/g, '')}@example.org>`,
  `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', extra, '',
  `<p>Hello! Here is the <b>plan</b> for ${subject}.</p><img src="https://cdn.example.org/plan.png" alt="the plan"><img src="https://t.example.org/open.gif" width="1" height="1">`,
].filter((l, i) => i !== 7 || l).join('\r\n');

(async () => {
  const dovecot = await startDovecot();
  if (!dovecot) { console.log('SKIP Dovecot is not installed'); process.exit(0); }
  const sent = [];
  const smtp = new SMTPServer({
    secure: false, disabledCommands: ['STARTTLS'], allowInsecureAuth: true,
    onAuth: (a, _s, cb) => (a.username === 'ana' && a.password === 'secret' ? cb(null, { user: 'ana' }) : cb(new Error('Invalid login'))),
    onData: (stream, s, cb) => { const c = []; stream.on('data', (x) => c.push(x)); stream.on('end', () => { sent.push({ to: s.envelope.rcptTo.map((x) => x.address), raw: Buffer.concat(c).toString() }); cb(); }); },
  });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  const smtpPort = smtp.server.address().port;
  const dav = await startCalDav();

  // Mail waiting on the server.
  const imap = new ImapFlow({ host: '127.0.0.1', port: dovecot.port, secure: false, doSTARTTLS: false, auth: { user: 'ana', pass: 'secret' }, logger: false });
  await imap.connect();
  await imap.append('INBOX', MSG('The garden project'), []);
  await imap.logout();

  const root = path.resolve(__dirname, '../..');
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/.bin/electron'), args: [root, '--no-sandbox'], env: { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 60 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return !u.includes('view=') || u.includes('view=app'); });
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await main.waitForTimeout(1500);
  // Another part of Keeper may ask for permission in the demo flows; answer no.
  const deny = async () => { const d = main.locator('.approval-back button', { hasText: "Don't allow" }); if (await d.count()) await d.first().click().catch(() => {}); };
  await deny();

  // ---------------------------------------------------------------- mail
  await main.click('.sidebar [title="Mail"]');
  await main.waitForTimeout(600);
  check(await main.getByText('Add a mail account').count() > 0, 'Mail shows "Add a mail account" with no accounts');
  await main.locator('.pim-empty button', { hasText: 'Add account' }).click();
  await main.fill('input[placeholder="you@example.com"]', 'ana@example.org');
  await main.locator('.modal button', { hasText: 'Continue' }).click();
  await main.waitForSelector('text=Change servers', { timeout: 40_000 });
  await main.getByText('Change servers').click();
  const fillServer = async (label, host, port, user) => {
    await main.fill(`[aria-label="${label} server"]`, host);
    await main.fill(`[aria-label="${label} port"]`, String(port));
    await main.selectOption(`[aria-label="${label} security"]`, 'none');
    await main.fill(`[aria-label="${label} user name"]`, user);
  };
  await fillServer('Incoming', '127.0.0.1', dovecot.port, 'ana');
  await fillServer('Outgoing', '127.0.0.1', smtpPort, 'ana');
  await main.fill('input[placeholder="As people will see it"]', 'Ana Lopez');
  await main.fill('.modal input[type="password"]', 'secret');
  await main.screenshot({ path: `${SHOTS}/app-add-account.png` });
  await main.locator('.modal button.primary', { hasText: 'Add' }).click();
  await main.waitForSelector('.mail-row', { timeout: 30_000 }).catch(() => {});
  check(await main.locator('.mail-row', { hasText: 'The garden project' }).count() === 1, 'the message from the server is in the list');
  await main.locator('.mail-row', { hasText: 'The garden project' }).click();
  await main.waitForSelector('.message-frame', { timeout: 20_000 });
  await main.waitForTimeout(500);
  const doc = await main.locator('.message-frame').getAttribute('srcdoc');
  check(/data-blocked-src="https:\/\/cdn\.example\.org\/plan\.png"/.test(doc) && !/[^-]src="https:\/\/cdn/.test(doc), 'the remote picture is held back');
  check(!/open\.gif/.test(doc), 'the tracking pixel is removed');
  check(/Content-Security-Policy/.test(doc) && (await main.locator('.message-frame').getAttribute('sandbox')) === 'allow-popups allow-popups-to-escape-sandbox', 'the message is drawn in a sandboxed frame without scripts');
  check(await main.getByText('1 picture from the internet held back').count() > 0, 'the banner offers to show the picture');
  await main.screenshot({ path: `${SHOTS}/app-mail-read.png` });

  // Reply with Markdown; Undo send window, then it goes and lands in Sent.
  await main.keyboard.press('r');
  await main.waitForSelector('.compose textarea');
  await main.locator('.compose textarea').first().fill('Thanks Ana, **looks great**!');
  await main.screenshot({ path: `${SHOTS}/app-compose.png` });
  await main.keyboard.press('Control+Enter');
  await main.waitForSelector('.mail-outbox', { timeout: 5000 }).catch(() => {});
  check(await main.locator('.mail-outbox button', { hasText: 'Undo' }).count() === 1, 'Undo send is offered');
  for (let i = 0; i < 40 && !sent.length; i++) await main.waitForTimeout(500);
  check(sent.length === 1 && sent[0].to.includes('ana@example.org'), 'the reply reached the SMTP server after the undo window');
  check(/In-Reply-To: <Thegardenproject@example\.org>/.test(sent[0]?.raw ?? '') && /<strong>looks great<\/strong>/.test(sent[0]?.raw.replace(/=\r\n/g, '') ?? ''), 'it is threaded and the Markdown became HTML');
  await main.waitForTimeout(1500);
  const check2 = new ImapFlow({ host: '127.0.0.1', port: dovecot.port, secure: false, doSTARTTLS: false, auth: { user: 'ana', pass: 'secret' }, logger: false });
  await check2.connect();
  const st = await check2.status('Sent', { messages: true });
  await check2.logout();
  check(st.messages === 1, 'a copy is in Sent on the server');
  await main.locator('.mail-folder', { hasText: 'Sent' }).first().click();
  await main.waitForTimeout(500);
  await main.locator('button[title="Check for new mail"]').click();
  await main.waitForTimeout(2000);
  check(await main.locator('.mail-row', { hasText: 'Re: The garden project' }).count() === 1, 'the reply shows in Sent in Keeper');

  // ---------------------------------------------------------------- calendar (CalDAV)
  await main.evaluate((u) => window.keeper.pim.addAccount({ kind: 'caldav', caldav: u, davUser: 'ana', password: 'secret', label: 'Home server' }), dav.url);
  for (let i = 0; i < 20; i++) {
    const cals = await main.evaluate(() => window.keeper.pim.calendars());
    // Both: the calendars are found one after the other.
    if (cals.some((c) => c.name === 'Work') && cals.some((c) => c.name === 'Tasks')) break;
    await main.waitForTimeout(500);
  }
  const cals = await main.evaluate(() => window.keeper.pim.calendars());
  const work = cals.find((c) => c.name === 'Work');
  check(!!work && !!cals.find((c) => c.name === 'Tasks')?.tasks, 'the CalDAV calendars were found (events and a task list)');
  const t9 = new Date(); t9.setDate(t9.getDate() + 1); t9.setHours(9, 0, 0, 0);
  const saved = await main.evaluate(([cal, start]) => window.keeper.pim.saveEvent({ id: '', uid: '', calendar: cal, title: 'Standup', start, end: start + 15 * 60_000, allDay: false, rrule: 'FREQ=DAILY;COUNT=5', alarms: [{ minutesBefore: 5 }] }), [work.id, t9.getTime()]);
  const objs = () => [...dav.cals['/dav/cal/ana/work/'].items.values()].map((x) => x.data);
  check(objs().some((d) => /RRULE:FREQ=DAILY;COUNT=5/.test(d) && /SUMMARY:Standup/.test(d)), 'the repeating event was written to the server');
  const third = t9.getTime() + 2 * 86_400_000;
  await main.evaluate(([e, inst]) => window.keeper.pim.saveEvent({ ...e, title: 'Standup (moved)', start: inst + 3_600_000, end: inst + 3_600_000 + 15 * 60_000 }, { scope: 'this', instance: inst }), [saved, third]);
  check(objs().some((d) => /RECURRENCE-ID/.test(d) && /Standup \(moved\)/.test(d) && /RRULE/.test(d)), 'one occurrence was changed on the server, the rest stay');
  const occ = await main.evaluate(([a, b]) => window.keeper.pim.occurrences(a, b), [t9.getTime() - 1, t9.getTime() + 6 * 86_400_000]);
  const mine = occ.filter((o) => o.event.uid === saved.uid);
  check(mine.length === 5 && mine[2].event.title === 'Standup (moved)' && new Date(mine[2].start).getHours() === 10, 'Keeper shows five occurrences with the moved one at 10:00');
  await main.click('.sidebar [title="Calendar"]');
  await main.waitForTimeout(800);
  await main.locator('.seg button', { hasText: 'Week' }).click();
  await main.waitForTimeout(500);
  await main.screenshot({ path: `${SHOTS}/app-calendar.png` });

  // An event alert rings and reaches the Island.
  const soon = Date.now() + 12_000;
  await main.evaluate((s) => window.keeper.pim.saveEvent({ id: '', uid: '', calendar: 'local:calendar', title: 'Call the plumber', start: s, end: s + 30 * 60_000, allDay: false, alarms: [{ minutesBefore: 0 }] }), soon);
  let alerted = false;
  for (let i = 0; i < 50 && !alerted; i++) {
    const st2 = await main.evaluate(() => window.keeper.island.state());
    alerted = st2.alerts.some((a) => a.title === 'Call the plumber');
    if (!alerted) await main.waitForTimeout(500);
  }
  check(alerted, 'the event alert reached the Island at its time');

  // A timer rings in Keeper with Snooze and Stop.
  await main.click('.sidebar [title="Clock"]');
  await main.evaluate(() => window.keeper.pim.startTimer('Tea', 3000));
  await main.waitForSelector('.ring-overlay', { timeout: 15_000 }).catch(() => {});
  check(await main.locator('.ring-overlay', { hasText: 'Tea' }).count() === 1, 'the timer rang with Snooze and Stop');
  await main.screenshot({ path: `${SHOTS}/app-ringing.png` });
  await main.locator('.ring-overlay button', { hasText: 'Stop' }).click();
  await main.waitForTimeout(300);
  check(await main.locator('.ring-overlay').count() === 0, 'Stop silences it');

  // Switching Mail off really stops it.
  await main.evaluate(() => window.keeper.features.set('mail', false));
  await main.waitForTimeout(800);
  check(await main.locator('.sidebar [title="Mail"]').count() === 0, 'with Mail switched off its sidebar entry goes away');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await app.close();
  smtp.close();
  await dav.stop();
  dovecot.stop();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
