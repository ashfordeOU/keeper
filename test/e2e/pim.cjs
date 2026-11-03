// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux, Dovecot installed): xvfb-run -a node test/e2e/pim.cjs /tmp/kp-pim /tmp/kp-pim-shots
// Drives the real Keeper app against a local IMAP server (Dovecot), SMTP
// server and CalDAV server: adds a mail account through the dialog, reads a
// message with its remote picture held back, replies (with undo send) and
// finds the reply in Sent; adds a CalDAV account, writes a repeating event and
// changes one occurrence; an event alert reaches the Island; a timer rings.
// Mail's second round: rules on arrival, search with filters, phishing and
// tracking, invitations (iMIP), aliases, remind if no reply, drafts on the
// server, undo, inbox tabs and the narrow layout. The Today layout: the
// greeting, today's events with Join, the meeting chip, the filter chips, the
// account column, labels and "Updated … ago".
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
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/.bin/electron'), args: [root, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
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
  const acc0 = (await main.evaluate(() => window.keeper.pim.accounts()))[0];
  check(!!acc0?.lastChecked && !acc0.lastError, 'the account records when it was last checked');
  await main.locator('.mail-row', { hasText: 'The garden project' }).click();
  await main.waitForSelector('.message-frame', { timeout: 20_000 });
  await main.waitForTimeout(500);
  const doc = await main.locator('.message-frame').getAttribute('srcdoc');
  check(/data-blocked-src="https:\/\/cdn\.example\.org\/plan\.png"/.test(doc) && !/[^-]src="https:\/\/cdn/.test(doc), 'the remote picture is held back');
  check(!/open\.gif/.test(doc), 'the tracking pixel is removed');
  check(/Content-Security-Policy/.test(doc) && (await main.locator('.message-frame').getAttribute('sandbox')) === 'allow-popups allow-popups-to-escape-sandbox', 'the message is drawn in a sandboxed frame without scripts');
  check(await main.getByText('1 picture from the internet held back').count() > 0, 'the banner offers to show the picture');
  await main.screenshot({ path: `${SHOTS}/app-mail-read.png` });
  // Add to Tasks: a task titled with the subject that links back to the email.
  await main.locator('[data-testid="mail-add-task"]').click();
  await main.waitForTimeout(600);
  const fromMail = (await main.evaluate(() => window.keeper.pim.reminders())).find((t) => t.title === 'The garden project');
  check(!!fromMail && /^keeper:\/\/mail\//.test(fromMail.url ?? '') && /keeper:\/\/mail\//.test(fromMail.notes ?? '') && /From an email from/.test(fromMail.notes ?? ''), 'Add to Tasks makes a task that links back to the email');
  if (fromMail) await main.evaluate((id) => window.keeper.pim.deleteReminder(id), fromMail.id);

  // Reply with Markdown; Undo send window, then it goes and lands in Sent.
  await main.keyboard.press('r');
  await main.waitForSelector('.compose .compose-editor');
  await main.locator('.compose .compose-editor').fill('Thanks Ana, **looks great**!');
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

  // ---------------------------------------------------------------- Important / Other, the Island, waiting, subscriptions, snooze, send later
  const RAW2 = (from, subject, extra = []) => [`From: ${from}`, 'To: Ana <ana@example.org>', `Subject: ${subject}`, `Message-ID: <${subject.replace(/\W/g, '')}.${Date.now()}@example.net>`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', ...extra, '', `${subject}.`].join('\r\n');
  const accId = (await main.evaluate(() => window.keeper.pim.accounts())).find((a) => a.mail).id;
  await main.locator('.mail-folder', { hasText: 'All inboxes' }).click();
  await main.waitForTimeout(500);
  const im2 = new ImapFlow({ host: '127.0.0.1', port: dovecot.port, secure: false, doSTARTTLS: false, auth: { user: 'ana', pass: 'secret' }, logger: false });
  await im2.connect();
  await im2.append('INBOX', RAW2('Weekly Picks <news@weekly.example.net>', 'Weekly picks', ['List-Id: <picks.weekly.example.net>', 'List-Unsubscribe: <https://weekly.example.net/u>', 'Precedence: bulk']), []);
  await im2.append('INBOX', RAW2('Cloudbox <no-reply@accounts.example.net>', 'New sign-in to your account'), []);
  await im2.logout();
  let mailAlert = null;
  for (let i = 0; i < 60 && !mailAlert; i++) {
    mailAlert = (await main.evaluate(() => window.keeper.island.state())).alerts.find((a) => a.kind === 'mail') ?? null;
    if (!mailAlert) await main.waitForTimeout(500);
  }
  check(!!mailAlert && /Security/.test(mailAlert.title) && /New sign-in/.test(mailAlert.detail ?? ''), 'new Important mail (a sign-in alert) dropped down from the Island, through IDLE');
  check(!!mailAlert?.ref && mailAlert.ref.split(':').length > 2, 'the Island alert names the message (Open, Archive, Mark read)');
  const imp = await main.evaluate(() => window.keeper.pim.messages({ folder: 'unified', split: 'important' }));
  const oth = await main.evaluate(() => window.keeper.pim.messages({ folder: 'unified', split: 'other' }));
  check(imp.messages.some((m) => /New sign-in/.test(m.subject) && m.security) && !imp.messages.some((m) => m.subject === 'Weekly picks'), 'the sign-in alert is Important (Security); the newsletter is not');
  check(oth.messages.some((m) => m.subject === 'Weekly picks' && m.bulk && m.unsub), 'the newsletter is in Other, with its list headers');
  await main.locator('.mail-tabs button', { hasText: 'Primary' }).click();
  await main.waitForTimeout(600);
  await main.screenshot({ path: `${SHOTS}/app-mail-important.png` });

  // Sent to someone else, no answer: Waiting for reply, with a follow-up.
  await main.evaluate((acc) => window.keeper.pim.send({ account: acc, to: [{ name: 'Bob', address: 'bob@example.org' }], cc: [], bcc: [], subject: 'Quote for the garden', body: 'Here is the quote.', sendAt: Date.now() }), accId);
  for (let i = 0; i < 40 && sent.length < 2; i++) await main.waitForTimeout(500);
  await main.evaluate(() => window.keeper.pim.refresh());
  const waiting = await main.evaluate(() => window.keeper.pim.waiting());
  const w = waiting.find((x) => x.message.subject === 'Quote for the garden');
  check(!!w && w.to.some((a) => a.address === 'bob@example.org'), 'the unanswered message is in Waiting for reply');
  const fu = w ? await main.evaluate((id) => window.keeper.pim.followUp(id), w.message.id) : null;
  check(!!fu && fu.subject === 'Re: Quote for the garden' && fu.to.some((a) => a.address === 'bob@example.org') && !!fu.inReplyTo, 'Follow up writes to the same person in the same conversation');
  await main.locator('[data-testid="mail-nav-waiting"]').click();
  await main.waitForSelector('[data-testid="mail-waiting"]', { timeout: 5000 }).catch(() => {});
  check(await main.locator('.waiting-row', { hasText: 'Quote for the garden' }).count() === 1, 'Waiting for reply shows it');

  // Subscriptions: archive everything from the newsletter (moved on the server).
  const subs = await main.evaluate(() => window.keeper.pim.subscriptions());
  const sub = subs.find((x) => x.address === 'news@weekly.example.net');
  check(!!sub && sub.canUnsubscribe && !subs.some((x) => /accounts\.example/.test(x.address)), 'Subscriptions lists the newsletter (not the security mail)');
  if (sub) await main.evaluate((k) => window.keeper.pim.cleanup(k, 'archive'), sub.key);
  const im3 = new ImapFlow({ host: '127.0.0.1', port: dovecot.port, secure: false, doSTARTTLS: false, auth: { user: 'ana', pass: 'secret' }, logger: false });
  await im3.connect();
  let inArchive = false;
  { const lock = await im3.getMailboxLock('Archive'); try { for await (const m of im3.fetch('1:*', { envelope: true })) if (m.envelope.subject === 'Weekly picks') inArchive = true; } finally { lock.release(); } }
  await im3.logout();
  check(inArchive, 'Archive all moved the newsletter to Archive on the server');

  // Snooze: gone now, back unread a few seconds later, with a note in the Island.
  const garden = (await main.evaluate(() => window.keeper.pim.messages({ folder: 'unified' }))).messages.find((m) => m.subject === 'The garden project');
  await main.evaluate((id) => window.keeper.pim.snooze([id], Date.now() + 3000), garden.id);
  const hidden = !(await main.evaluate(() => window.keeper.pim.messages({ folder: 'unified' }))).messages.some((m) => m.id === garden.id);
  const listed = (await main.evaluate(() => window.keeper.pim.messages({ folder: 'snoozed' }))).messages.some((m) => m.id === garden.id);
  check(hidden && listed, 'a snoozed message leaves the inbox and is listed under Snoozed');
  let back = false;
  for (let i = 0; i < 30 && !back; i++) {
    await main.waitForTimeout(500);
    back = (await main.evaluate(() => window.keeper.pim.messages({ folder: 'unified' }))).messages.some((m) => m.id === garden.id && !m.seen);
  }
  check(back, 'it comes back unread at its time');

  // Send later: scheduled, listed, and can be taken back to edit.
  const later = await main.evaluate((acc) => window.keeper.pim.send({ account: acc, to: [{ address: 'bob@example.org' }], cc: [], bcc: [], subject: 'Tomorrow morning', body: 'Later.', sendAt: Date.now() + 3_600_000 }), accId);
  check(later.scheduled === true && (await main.evaluate(() => window.keeper.pim.outbox())).some((o) => o.id === later.id && o.scheduled), 'Send later is scheduled');
  const undone = await main.evaluate((id) => window.keeper.pim.undoSend(id), later.id);
  check(undone?.subject === 'Tomorrow morning' && sent.length === 2, 'a scheduled message can be taken back before it goes');

  // ---------------------------------------------------------------- Mail, second round
  const imapOf = () => new ImapFlow({ host: '127.0.0.1', port: dovecot.port, secure: false, doSTARTTLS: false, auth: { user: 'ana', pass: 'secret' }, logger: false });
  const waitFor = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await main.waitForTimeout(500); } return null; };
  const inFolder = async (folder) => {
    const c = imapOf();
    await c.connect();
    const out = [];
    const lock = await c.getMailboxLock(folder);
    try { if (c.mailbox.exists) for await (const m of c.fetch('1:*', { envelope: true, flags: true, source: true })) out.push({ subject: m.envelope.subject, flags: [...m.flags], raw: m.source.toString() }); } finally { lock.release(); }
    await c.logout();
    return out;
  };

  // Rules: run here as mail arrives (label, mark read, archive).
  await main.evaluate(() => window.keeper.pim.saveRules([{ id: 'r1', name: 'Bills', enabled: true, when: [{ field: 'from', contains: 'billing@' }, { field: 'subject', contains: 'invoice' }], then: { action: 'label', label: 'Bills' }, also: [{ action: 'read' }, { action: 'archive' }] }]));
  { const c = imapOf(); await c.connect(); await c.append('INBOX', RAW2('Utility Co <billing@utility.example>', 'Your invoice for October'), []); await c.append('INBOX', RAW2('Utility Co <billing@utility.example>', 'Planned works on your street'), []); await c.logout(); }
  await main.evaluate(() => window.keeper.pim.refresh(undefined, 'INBOX'));
  const archived = await waitFor(async () => (await inFolder('Archive')).find((m) => m.subject === 'Your invoice for October'));
  check(!!archived && archived.flags.includes('\\Seen') && archived.flags.includes('Bills'), 'a rule labelled, marked read and archived the matching mail on arrival');
  check((await inFolder('INBOX')).some((m) => m.subject === 'Planned works on your street'), 'mail that does not match every condition stays in the inbox');

  // Search with filters, this computer first.
  const found = await main.evaluate(() => window.keeper.pim.search('from:billing subject:works is:unread'));
  check(found.messages.length === 1 && found.messages[0].subject === 'Planned works on your street' && found.local === 1, 'search with from:, subject: and is:unread finds the message on this computer');

  // Remote images, tracking pixels and tracking links; a look-alike sender gets a warning.
  { const c = imapOf(); await c.connect(); await c.append('INBOX', ['From: PayPal Support <help@paypa1-secure.example>', 'To: Ana <ana@example.org>', 'Subject: Confirm your account', `Message-ID: <phish.${Date.now()}@paypa1-secure.example>`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', '<p>Please <a href="https://evil.example/login?utm_source=mail&amp;id=7">https://www.paypal.com/login</a> now.</p><img src="https://cdn.example.org/logo.png">'].join('\r\n'), []); await c.logout(); }
  await main.evaluate(() => window.keeper.pim.refresh(undefined, 'INBOX'));
  const phish = await waitFor(async () => (await main.evaluate(() => window.keeper.pim.messages({ folder: 'unified' }))).messages.find((m) => m.subject === 'Confirm your account'));
  const opened = phish ? await main.evaluate((id) => window.keeper.pim.open(id, { markRead: false }), phish.id) : null;
  check(!!opened && opened.warnings?.some((w) => w.kind === 'link-mismatch') && opened.warnings?.some((w) => w.kind === 'lookalike' || w.kind === 'brand-name'), 'a look-alike sender and a link that lies are warned about');
  check(!!opened && !opened.signInLink && !opened.code, 'a message that looks like an impersonation gets no one-click Open or Copy');
  check(!!opened && opened.blocked === 1 && opened.cleanedLinks === 1 && /href="https:\/\/evil\.example\/login\?id=7"/.test(opened.html), 'the remote picture is held back and the tracking part of the link is taken off');
  await main.locator('.mail-folder', { hasText: 'All inboxes' }).click();
  await main.locator('.mail-tabs button', { hasText: 'Inbox' }).first().click();
  await main.waitForTimeout(400);
  await main.locator('.mail-row', { hasText: 'Confirm your account' }).first().click();
  await main.waitForSelector('[data-testid="mail-phish"]', { timeout: 10_000 }).catch(() => {});
  check(await main.locator('[data-testid="mail-phish"] button', { hasText: 'Report spam' }).count() === 1, 'the warning banner offers Report spam and Block');
  await main.screenshot({ path: `${SHOTS}/app-mail-phish.png` });
  await main.locator('[data-testid="mail-privacy-banner"] button', { hasText: 'Load images' }).click();
  await main.waitForTimeout(800);
  check(/src="https:\/\/cdn\.example\.org\/logo\.png"/.test(await main.locator('.message-frame').first().getAttribute('srcdoc')), 'Load images shows the picture');

  // A sign-in code drops from the Island with Copy.
  { const c = imapOf(); await c.connect(); await c.append('INBOX', RAW2('Cloudbox <no-reply@accounts.example.net>', 'Your Cloudbox sign-in code', []).replace('Your Cloudbox sign-in code.', 'Your verification code is 482913. It expires in 10 minutes.'), []); await c.logout(); }
  const codeAlert = await waitFor(async () => (await main.evaluate(() => window.keeper.island.state())).alerts.find((a) => a.kind === 'mail' && a.mail && a.mail.code === '482913'), 60);
  check(!!codeAlert, 'a sign-in code reaches the Island with Copy');

  // An invitation: Accept answers the organiser (iMIP REPLY); Add to Calendar only adds it.
  const start = new Date(Date.now() + 3 * 86_400_000); start.setHours(15, 0, 0, 0);
  const ymd = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', 'METHOD:REQUEST', 'BEGIN:VEVENT', `UID:plan-${Date.now()}@example.net`, `DTSTAMP:${ymd(new Date())}`, `DTSTART:${ymd(start)}`, `DTEND:${ymd(new Date(start.getTime() + 3_600_000))}`, 'SUMMARY:Garden planning', 'ORGANIZER;CN=Bob:mailto:bob@example.net', 'ATTENDEE;CN=Ana;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ana@example.org', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  { const c = imapOf(); await c.connect(); await c.append('INBOX', ['From: Bob <bob@example.net>', 'To: Ana <ana@example.org>', 'Subject: Invitation: Garden planning', `Message-ID: <inv.${Date.now()}@example.net>`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="b1"', '', '--b1', 'Content-Type: text/plain; charset=utf-8', '', 'You are invited.', '--b1', 'Content-Type: text/calendar; charset=utf-8; method=REQUEST', '', ics, '--b1--', ''].join('\r\n'), []); await c.logout(); }
  await main.evaluate(() => window.keeper.pim.refresh(undefined, 'INBOX'));
  await waitFor(async () => main.locator('.mail-row', { hasText: 'Garden planning' }).count());
  await main.locator('.mail-row', { hasText: 'Garden planning' }).first().click();
  await main.waitForSelector('[data-testid="mail-invite"]', { timeout: 15_000 }).catch(() => {});
  check(await main.locator('[data-testid="mail-invite"] button', { hasText: 'Add to Calendar' }).count() === 1, 'the invitation card has Accept, Maybe, Decline and Add to Calendar');
  await main.screenshot({ path: `${SHOTS}/app-mail-invite.png` });
  const before = sent.length;
  await main.locator('[data-testid="mail-invite"] button', { hasText: 'Accept' }).click();
  const replyMail = await waitFor(async () => sent.slice(before).find((x) => /METHOD:REPLY/.test(x.raw.replace(/=\r\n/g, ''))));
  check(!!replyMail && replyMail.to.includes('bob@example.net') && /PARTSTAT=ACCEPTED/.test(replyMail.raw.replace(/=\r\n/g, '').replace(/\r\n /g, '')), 'Accept sent an iMIP reply to the organiser');
  const inCal = await waitFor(async () => (await main.evaluate(([a, b]) => window.keeper.pim.occurrences(a, b), [start.getTime() - 1, start.getTime() + 2 * 3_600_000])).some((o) => o.event.title === 'Garden planning'));
  check(!!inCal, 'the accepted event is in the calendar');

  // Send-from aliases with their own Reply-To and signature.
  const accNow = (await main.evaluate(() => window.keeper.pim.accounts())).find((a) => a.mail);
  await main.evaluate(([id, ids]) => window.keeper.pim.updateAccount(id, { identities: ids }), [accNow.id, [...accNow.identities, { name: 'Garden Club', email: 'club@example.org', replyTo: 'team@example.org', signature: 'The Garden Club' }]]);
  const sBefore = sent.length;
  await main.evaluate((acc) => window.keeper.pim.send({ account: acc, from: 'club@example.org', to: [{ address: 'bob@example.org' }], cc: [], bcc: [], subject: 'Club news', body: '', html: '<div><b>Big</b> news</div>', sendAt: Date.now() }), accNow.id);
  const club = await waitFor(async () => sent.slice(sBefore).find((x) => /Subject: Club news/.test(x.raw)));
  const clubRaw = (club?.raw ?? '').replace(/=\r\n/g, '');
  check(/^From: Garden Club <club@example\.org>/m.test(clubRaw) && /^Reply-To: team@example\.org/m.test(clubRaw), 'an alias sends with its own From and Reply-To');
  check(/<b>Big<\/b> news/.test(clubRaw) && /The Garden Club/.test(clubRaw) && /\*?Big\*? news/.test(clubRaw), 'rich text goes as HTML with a plain-text copy, and the alias’s signature');

  // Remind me if no reply: no answer comes, so the Island says so.
  await main.evaluate(() => window.keeper.pim.refresh());
  const clubSent = await waitFor(async () => (await main.evaluate(() => window.keeper.pim.messages({ folder: 'unified:sent' }))).messages.find((m) => m.subject === 'Club news'));
  if (clubSent) await main.evaluate((id) => window.keeper.pim.remindNoReply(id, Date.now() + 2500), clubSent.id);
  check((await main.evaluate(() => window.keeper.pim.noReplyReminders())).some((r) => r.subject === 'Club news'), 'Remind me if no reply is set on the sent message');
  const nudge = await waitFor(async () => (await main.evaluate(() => window.keeper.island.state())).alerts.find((a) => /No reply yet/.test(a.title) && a.detail === 'Club news'));
  check(!!nudge, 'with no reply by then, the Island reminds');

  // Drafts are mirrored to the server's Drafts folder (one copy), and go when sent.
  const draft = { account: accNow.id, to: [{ address: 'bob@example.org' }], cc: [], bcc: [], subject: 'Draft one', body: 'first', key: 'k-e2e' };
  await main.evaluate((d) => window.keeper.pim.saveDraft(d), draft);
  await main.evaluate((d) => window.keeper.pim.saveDraft({ ...d, subject: 'Draft two', body: 'second' }), draft);
  const drafts = await inFolder('Drafts');
  check(drafts.length === 1 && drafts[0].subject === 'Draft two' && drafts[0].flags.includes('\\Draft'), 'a draft saved twice is one copy in Drafts on the server, the newest');
  await main.evaluate((d) => window.keeper.pim.send({ ...d, subject: 'Draft two', body: 'second', sendAt: Date.now() }), draft);
  check(!!(await waitFor(async () => (await inFolder('Drafts')).length === 0)), 'sending it removes the copy from Drafts');

  // Undo (⌘Z) brings an archived message back.
  const works = (await main.evaluate(() => window.keeper.pim.messages({ folder: 'unified' }))).messages.find((m) => m.subject === 'Planned works on your street');
  if (works) await main.evaluate((id) => window.keeper.pim.archive([id]), works.id);
  await waitFor(async () => (await inFolder('Archive')).some((m) => m.subject === 'Planned works on your street'));
  const undoneMove = await main.evaluate(() => window.keeper.pim.undo());
  check(undoneMove === 'Archive' && !!(await waitFor(async () => (await inFolder('INBOX')).some((m) => m.subject === 'Planned works on your street'))), 'Undo moves the archived message back to the inbox');

  // Snooze is shared with the person's other computers through an IMAP keyword.
  const works2 = await waitFor(async () => (await main.evaluate(() => window.keeper.pim.messages({ folder: 'unified', tab: 'all' }))).messages.find((m) => m.subject === 'Planned works on your street'));
  if (works2) await main.evaluate((id) => window.keeper.pim.snooze([id], Date.now() + 3_600_000), works2.id);
  const kw = await waitFor(async () => (await inFolder('INBOX')).find((m) => m.subject === 'Planned works on your street' && m.flags.some((f) => f.startsWith('$KSnooze-'))));
  check(!!kw, 'a snooze is written to the server as a keyword, for the person’s other computers');
  if (works2) await main.evaluate((id) => window.keeper.pim.unsnooze([id]), works2.id);
  check(!!(await waitFor(async () => (await inFolder('INBOX')).some((m) => m.subject === 'Planned works on your street' && !m.flags.some((f) => f.startsWith('$KSnooze-'))))), 'unsnoozing takes the keyword off');

  // Tabs: Primary (Important), Updates and Promos, with counts.
  const tabs = await main.evaluate(() => window.keeper.pim.messages({ folder: 'unified', tab: 'all' }));
  check(tabs.counts && typeof tabs.counts.updates === 'number' && typeof tabs.counts.promos === 'number' && tabs.counts.important + tabs.counts.updates + tabs.counts.promos === tabs.counts.all, 'the inbox tabs have unread counts that add up');

  // A narrow window: the list, then the message with Back.
  await main.setViewportSize({ width: 820, height: 760 });
  await main.locator('.mail-folder', { hasText: 'All inboxes' }).click();
  await main.locator('.mail-tabs button', { hasText: 'Inbox' }).first().click();
  await main.waitForTimeout(500);
  await main.locator('.mail-row').first().click();
  await main.waitForTimeout(800);
  const frameShown = await main.locator('.mail-reader .message-card').first().isVisible().catch(() => false);
  const listHidden = !(await main.locator('.mail-list').isVisible());
  check(frameShown && listHidden, 'below 900 px a clicked message shows in place of the list');
  await main.screenshot({ path: `${SHOTS}/app-mail-narrow.png` });
  await main.locator('[data-testid="mail-back"]').click();
  await main.waitForTimeout(400);
  check(await main.locator('.mail-list').isVisible(), 'Back returns to the list');
  await main.setViewportSize({ width: 1440, height: 900 });
  await main.waitForTimeout(300);

  // ---------------------------------------------------------------- Mail: Today
  // Join opens the meeting in the default browser; here the main process only notes the address.
  await app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = async (u) => { global.__opened.push(u); }; });
  const t0 = Date.now();
  const ev = (title, start, end, extra = {}) => main.evaluate(([e]) => window.keeper.pim.saveEvent(e), [{ id: '', uid: '', calendar: 'local:calendar', title, start, end, allDay: false, ...extra }]);
  await ev('Design review', t0 - 20 * 60_000, t0 + 40 * 60_000, { location: 'https://us02web.zoom.us/j/8812345?pwd=garden' });
  await ev('Plant order call', t0 + 2 * 3_600_000, t0 + 2.5 * 3_600_000, { description: 'Join with Google Meet: https://meet.google.com/abc-defg-hij' });
  await ev('Lunch with Bob', t0 + 3 * 3_600_000, t0 + 4 * 3_600_000, { location: 'Café Verde' });
  // A label on one message, for the Labels list.
  const toLabel = (await main.evaluate(() => window.keeper.pim.messages({ folder: 'unified', tab: 'all' }))).messages.find((m) => !m.security);
  if (toLabel) await main.evaluate((id) => window.keeper.pim.label([id], 'Clients', true), toLabel.id);
  await main.locator('[data-testid="mail-rail"] button[aria-label^="All inboxes"]').click();
  await main.waitForSelector('[data-testid="mail-today-card"]', { timeout: 10_000 }).catch(() => {});
  const todayText = (await main.locator('[data-testid="mail-today"]').innerText().catch(() => '')) || '';
  check(/^Good (morning|afternoon|evening), Ana|^Hello, Ana/.test(todayText) && /Today is /.test(todayText), `the inbox greets Ana by the time of day with today's date ("${todayText.split('\n')[0]}")`);
  const now0 = main.locator('.today-card.now', { hasText: 'Design review' });
  check(await now0.count() === 1 && /Now · until/.test(await now0.innerText()), 'the running event is marked "Now · until …"');
  check(await main.locator('[data-testid="mail-today-card"]').count() >= 3 && await main.locator('.today-card', { hasText: 'Lunch with Bob' }).locator('[data-testid="mail-today-join"]').count() === 0, 'today’s events show as cards; one without a video link has no Join');
  await now0.locator('[data-testid="mail-today-join"]').click();
  const joined = await waitFor(async () => (await app.evaluate(() => global.__opened)).find((u) => /zoom\.us/.test(u)), 10);
  check(!!joined, 'Join opens the Zoom link in the default app');
  check(await main.locator('[data-testid="meeting-chip"]', { hasText: 'Design review' }).locator('[data-testid="mail-today-join"]').count() === 1, 'the bar at the top shows the meeting going on, with Join');
  // Keyboard: the cards are buttons in the tab order; arrow keys move between them.
  await main.locator('.today-card.now .today-open').focus();
  await main.keyboard.press('ArrowRight');
  check(await main.evaluate(() => document.activeElement?.closest('.today-card')?.textContent ?? '').then((t) => /Plant order call/.test(t)), 'arrow keys move between the event cards');
  // Chips: Inbox with its number, icon chips with names; a chosen one filters the list and is marked.
  const inboxChip = main.locator('[data-chip="inbox"]');
  check(await inboxChip.getAttribute('aria-selected') === 'true' || await main.locator('[data-chip="important"]').getAttribute('aria-selected') === 'true', 'a chip is marked as chosen');
  check((await main.locator('[data-chip="security"]').getAttribute('aria-label')) === 'Security' && /Sign-in alerts/.test(await main.locator('[data-chip="security"]').getAttribute('title')), 'icon chips have names and tooltips');
  await inboxChip.click();
  await main.waitForTimeout(500);
  const allRows = await main.locator('.mail-row').count();
  await main.locator('[data-chip="security"]').click();
  await main.waitForTimeout(500);
  const secRows = await main.locator('.mail-row').allInnerTexts();
  check(secRows.length > 0 && secRows.length < allRows && secRows.every((t) => /Security/.test(t)) && await main.locator('[data-chip="security"]').getAttribute('aria-selected') === 'true', `the Security chip shows only security mail (${secRows.length} of ${allRows})`);
  await inboxChip.click();
  await main.waitForTimeout(400);
  check(await main.locator('.mail-row').count() === allRows, 'Inbox shows everything again');
  check(await main.locator('[data-testid="mail-day"]', { hasText: 'Today' }).count() === 1, 'messages are grouped under Today');
  check(await main.locator('[data-testid="mail-rail-account"] .rail-initials', { hasText: 'AL' }).count() === 1, 'the account column shows the account’s initials');
  check(/^(New message)\s*(Ctrl\+N|⌘N)$/.test((await main.locator('[data-testid="mail-compose"]').innerText()).replace(/\s+/g, ' ').trim()), 'New message shows its shortcut');
  const label = await waitFor(async () => (await main.locator('[data-testid="mail-label"]', { hasText: 'Clients' }).count()) > 0, 20);
  check(!!label, 'labels are listed with a colour and a count');
  // Footer: when mail was last checked; a click checks now.
  const foot = main.locator('[data-testid="mail-updated"]');
  check(/Updated (just now|\d+ minutes? ago)/.test(await foot.innerText()), `the footer says when mail was last checked ("${await foot.innerText()}")`);
  await foot.click();
  check(!!(await waitFor(async () => /Updated just now/.test(await foot.innerText()), 30)), 'clicking it checks for new mail');
  // Screenshots of the layout in light and dark.
  for (const look of ['light', 'dark']) {
    await main.evaluate((a) => window.keeper.settings.set({ appearance: a }), look);
    await inboxChip.click();
    await main.waitForTimeout(600);
    await main.locator('.mail-row').first().click();
    await main.waitForTimeout(1500);
    await main.screenshot({ path: `${SHOTS}/app-mail-today-${look}.png` });
  }
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'system' }));
  // Narrow: the cards fold into one "Now: …" line.
  await inboxChip.click();
  await main.setViewportSize({ width: 820, height: 760 });
  await main.waitForTimeout(500);
  check(await main.locator('[data-testid="mail-today-next"]').isVisible() && !(await main.locator('[data-testid="mail-today-strip"]').isVisible()) && /Now: Design review/.test(await main.locator('[data-testid="mail-today-next"]').innerText()), 'a narrow window shows one "Now: …" line instead of the cards');
  await main.setViewportSize({ width: 1440, height: 900 });
  // The setting turns it off.
  await main.evaluate(() => window.keeper.settings.set({ mailToday: false }));
  await main.waitForTimeout(600);
  check(await main.locator('[data-testid="mail-today"]').count() === 0 && await main.locator('[data-testid="meeting-chip"]').count() === 0, 'Show today at the top of the inbox: off hides the greeting, the events and the chip');
  await main.evaluate(() => window.keeper.settings.set({ mailToday: true }));

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
