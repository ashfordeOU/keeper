// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux, Dovecot installed): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/pim-compose.cjs /tmp/kp-cmp /tmp/kp-cmp-shots [/path/for/named/shots]
// Drives the real Keeper app against a local IMAP server (Dovecot) and SMTP
// server: an account added through the dialog leaves its password in no file;
// rich signatures with a logo go out with the picture attached (cid:) and the
// HTML cleaned; the signature picker and the default per kind of message; the
// account's Reply All default, forwards with attachments and plain format;
// the signature editor in Settings (light and dark); and an event's Join,
// links, place and attached file open in the person's own apps.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');
const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const { startDovecot } = require('../servers/dovecot.cjs');

const HOME = path.resolve(process.argv[2] || '/tmp/kp-cmp');
const SHOTS = path.resolve(process.argv[3] || '/tmp/kp-cmp-shots');
const NAMED = process.argv[4] ? path.resolve(process.argv[4]) : null;
fs.rmSync(HOME, { recursive: true, force: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PASSWORD = `Kp-${Date.now().toString(36)}-very-unusual-pass`;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function filesUnder(root) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(p); } };
  if (fs.existsSync(root)) walk(root);
  return out;
}

(async () => {
  const dovecot = await startDovecot({ password: PASSWORD });
  if (!dovecot) { console.log('SKIP Dovecot is not installed'); process.exit(0); }
  const sent = [];
  const smtp = new SMTPServer({
    secure: false, disabledCommands: ['STARTTLS'], allowInsecureAuth: true,
    onAuth: (a, _s, cb) => (a.username === 'ana' && a.password === PASSWORD ? cb(null, { user: 'ana' }) : cb(new Error('Invalid login'))),
    onData: (stream, s, cb) => { const c = []; stream.on('data', (x) => c.push(x)); stream.on('end', () => { sent.push({ to: s.envelope.rcptTo.map((x) => x.address), raw: Buffer.concat(c) }); cb(); }); },
  });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  const smtpPort = smtp.server.address().port;
  const imap = new ImapFlow({ host: '127.0.0.1', port: dovecot.port, secure: false, doSTARTTLS: false, auth: { user: 'ana', pass: PASSWORD }, logger: false });
  await imap.connect();
  await imap.append('INBOX', ['From: Ben Ng <ben@example.org>', 'To: Ana <ana@example.org>', 'Cc: Carla <carla@example.org>', 'Subject: Quarterly plan', 'Message-ID: <plan1@example.org>', `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b"', '', '--b', 'Content-Type: text/plain', '', 'Here is the plan.', '--b', 'Content-Type: text/plain; name="plan.txt"', 'Content-Disposition: attachment; filename="plan.txt"', '', 'the plan itself', '--b--', ''].join('\r\n'), []);
  await imap.logout();

  const root = path.resolve(__dirname, '../..');
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/.bin/electron'), args: [root, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SKIP_TOUR: '1', KEEPER_SUITE: 'shared', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  // What Keeper hands to the system to open is recorded here instead.
  await app.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openExternal = async (u) => { globalThis.__opened.push(u); };
    shell.openPath = async (p) => { globalThis.__opened.push(`file:${p}`); return ''; };
  });
  const opened = () => app.evaluate(() => globalThis.__opened);
  let main;
  for (let i = 0; i < 60 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return !u.includes('view=') || u.includes('view=app'); });
    if (!main) await wait(500);
  }
  const errors = [];
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.getURL().includes('view=') || w.webContents.getURL().includes('view=app')) { w.setSize(1440, 900); w.center(); w.show(); } });
  await wait(1000);
  const k = (fn, arg) => main.evaluate(fn, arg);
  const shot = async (name, mode) => {
    await main.screenshot({ path: path.join(SHOTS, `${name}-${mode}.png`) });
    if (NAMED) fs.copyFileSync(path.join(SHOTS, `${name}-${mode}.png`), path.join(NAMED, `pimall-${name}-${mode}.png`));
  };

  // ---------------------------------------------------------------- add the account through the dialog
  await main.click('.sidebar [title="Mail"]');
  await main.waitForSelector('[data-testid="mail-welcome"]', { timeout: 10_000 });
  await main.click('[data-testid="provider-imap"]');
  await main.fill('input[placeholder="you@example.com"]', 'ana@example.org');
  await main.locator('.modal button', { hasText: 'Continue' }).click();
  await main.waitForSelector('text=Change servers', { timeout: 40_000 });
  await main.getByText('Change servers').click();
  for (const [label, port] of [['Incoming', dovecot.port], ['Outgoing', smtpPort]]) {
    await main.fill(`[aria-label="${label} server"]`, '127.0.0.1');
    await main.fill(`[aria-label="${label} port"]`, String(port));
    await main.selectOption(`[aria-label="${label} security"]`, 'none');
    await main.fill(`[aria-label="${label} user name"]`, 'ana');
  }
  await main.fill('input[placeholder="As people will see it"]', 'Ana Lopez');
  await main.fill('.modal input[type="password"]', PASSWORD);
  await main.locator('.modal button.primary', { hasText: 'Add' }).click();
  await main.waitForSelector('.mail-row', { timeout: 30_000 }).catch(() => {});
  check(await main.locator('.mail-row', { hasText: 'Quarterly plan' }).count() === 1, 'the account works');
  await wait(1500);

  // ---------------------------------------------------------------- the password is in no file Keeper wrote
  const leaks = filesUnder(HOME).filter((f) => { try { const t = fs.readFileSync(f, 'latin1'); return t.includes(PASSWORD) || t.includes(Buffer.from(PASSWORD).toString('base64')); } catch { return false; } });
  check(leaks.length === 0, `no file holds the password (${filesUnder(HOME).length} files looked at)${leaks.length ? `: ${leaks.join(', ')}` : ''}`);
  const acct = (await k(() => window.keeper.pim.accounts())).find((a) => a.email === 'ana@example.org');
  check(!!acct && (acct.secretIn === 'keychain' || acct.secretIn === 'memory'), `the password is in the ${acct?.secretIn}`);

  // ---------------------------------------------------------------- signatures
  const full = `<table><tr><td><img src="data:image/png;base64,${PNG}" alt="Logo" width="40"></td><td><b onclick="steal()">Ana Lopez</b><script>alert(2)</script><br><a href="https://studio.example">studio.example</a></td></tr></table>`;
  await k(async ({ id, full }) => {
    const a = (await window.keeper.pim.accounts()).find((x) => x.id === id);
    await window.keeper.pim.updateAccount(id, { identities: [{ ...a.identities[0], signatures: [{ id: 'full', name: 'Full', html: full }, { id: 'short', name: 'Short', html: '<i>— Ana</i>' }], signatureDefaults: { reply: 'short' } }] });
  }, { id: acct.id, full });
  await main.click('[data-testid="mail-compose"]');
  await main.waitForSelector('.compose .compose-editor');
  await wait(400);
  check(await main.locator('[data-testid="compose-signature"] img').count() === 1, 'the new message shows the full signature with its logo');
  check(await main.locator('[data-testid="compose-sig-pick"] option').count() === 4, 'the signature picker offers usual, none and each signature');
  await main.locator('.compose input[aria-label="To"]').fill('ben@example.org');
  await main.keyboard.press('Enter');
  await main.locator('.compose input[aria-label="Subject"]').fill('With my signature');
  await main.locator('.compose .compose-editor').fill('Hello Ben');
  await shot('compose-signature', 'light');
  await main.keyboard.press('Control+Enter');
  for (let i = 0; i < 60 && !sent.length; i++) await wait(500);
  const p1 = sent[0] ? await simpleParser(sent[0].raw, { keepCidLinks: true }) : null;
  const logo = p1?.attachments.find((x) => x.contentType === 'image/png');
  check(!!logo && /src="cid:[^"]+"/.test(p1.html) && p1.html.includes(`cid:${logo.contentId.replace(/[<>]/g, '')}`), 'the logo goes as an attached picture the HTML points to (cid:)');
  check(!!p1 && !/onerror|onclick|<script|data:image/.test(p1.html) && /studio\.example/.test(p1.html), 'the signature HTML is cleaned');
  check(!!p1 && /-- \nAna Lopez/.test(p1.text), 'the text part carries the signature as text');

  // Reply: the account answers everyone, with the short signature.
  await k((id) => window.keeper.pim.updateAccount(id, { compose: { replyAll: true, font: 'serif', quote: 'above' } }), acct.id);
  const inbox = (await k((a) => window.keeper.pim.messages({ account: a, folder: 'INBOX' }), acct.id)).messages;
  const plan = inbox.find((m) => m.subject === 'Quarterly plan');
  const reply = await k((id) => window.keeper.pim.draftFor(id, 'reply'), plan.id);
  check(reply.cc.some((c) => c.address === 'carla@example.org'), 'Reply answers everyone when the account says so');
  sent.length = 0;
  await k(async ({ a, d }) => window.keeper.pim.send({ ...d, account: a, body: 'Sounds good', sendAt: Date.now() }), { a: acct.id, d: reply });
  for (let i = 0; i < 60 && !sent.length; i++) await wait(500);
  const p2 = sent[0] ? await simpleParser(sent[0].raw) : null;
  check(!!p2 && /— Ana/.test(p2.text) && !/Ana Lopez\n/.test(p2.text.split('Sounds good')[1] ?? ''), 'a reply gets the signature chosen for replies');
  check(!!p2 && /font-family:Georgia/.test(p2.html), 'the account’s font is used');
  // Forward keeps the attachment.
  const fwd = await k((id) => window.keeper.pim.draftFor(id, 'forward'), plan.id);
  check(fwd.attachments.some((x) => x.name === 'plan.txt'), 'a forward takes the attachment along');
  // Plain format: no HTML at all.
  await k((id) => window.keeper.pim.updateAccount(id, { compose: { format: 'plain' } }), acct.id);
  sent.length = 0;
  await k(async (a) => window.keeper.pim.send({ account: a, to: [{ address: 'ben@example.org' }], cc: [], bcc: [], subject: 'Plain one', body: '**not bold**', sendAt: Date.now() }), acct.id);
  for (let i = 0; i < 60 && !sent.length; i++) await wait(500);
  const p3 = sent[0] ? await simpleParser(sent[0].raw) : null;
  check(!!p3 && !p3.html && /\*\*not bold\*\*/.test(p3.text), 'plain format sends text only');
  await k((id) => window.keeper.pim.updateAccount(id, { compose: {} }), acct.id);
  await main.keyboard.press('Escape').catch(() => {});

  // ---------------------------------------------------------------- the editor in Settings, light and dark
  for (const mode of ['light', 'dark']) {
    await k(async (m) => { await window.keeper.settings.set({ appearance: m }); }, mode);
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.getURL().includes('view=') || w.webContents.getURL().includes('view=app')) w.webContents.send('event:navigate', 'settings:pim'); });
    await wait(1500);
    await k(() => { for (const d of document.querySelectorAll('details.identities-details')) d.open = true; });
    await wait(400);
    const area = main.locator('[data-testid="address-signatures"]').first();
    check(await area.count() === 1 && await main.locator('[data-testid="sig-area"]').count() >= 2, `the signature editor shows each signature (${mode})`);
    await main.locator('[data-testid="account-writing"]').first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
    await wait(300);
    await shot('signature-editor', mode);
  }
  await k(async () => { await window.keeper.settings.set({ appearance: 'light' }); });

  // ---------------------------------------------------------------- an event's links, place and file
  const start = Date.now() + 2 * 3_600_000;
  const ev = await k((s) => window.keeper.pim.saveEvent({ id: '', calendar: 'local:calendar', uid: '', title: 'Design review', start: s, end: s + 3_600_000, allDay: false, location: '1 Market Street, Bristol', url: 'https://docs.example.com/agenda', description: 'Join https://zoom.us/j/123456789\nSlides: https://slides.example/deck', attachments: [{ name: 'brief.txt', type: 'text/plain', data: 'YnJpZWY=' }, { name: 'plan.pdf', url: 'https://files.example/plan.pdf' }] }), start);
  await main.click('.sidebar [title="Calendar"]');
  await wait(900);
  await main.evaluate(({ id, s }) => window.keeper.pim.openEvent(id, s), { id: ev.id, s: ev.start });
  await main.waitForSelector('[data-testid="event-join"]', { timeout: 8000 }).catch(() => {});
  check(await main.locator('[data-testid="event-join"]').count() === 1, 'the event shows Join');
  await main.click('[data-testid="event-join"]').catch(() => {});
  for (const b of await main.locator('[data-testid="event-link"]').all()) await b.click();
  for (const b of await main.locator('[data-testid="event-attachment"]').all()) await b.click();
  await wait(800);
  const got = await opened();
  check(got.includes('https://zoom.us/j/123456789'), 'Join opens the meeting in the default app');
  check(got.includes('https://docs.example.com/agenda') && got.includes('https://slides.example/deck'), 'the event’s link and links in its notes open in the browser');
  check(got.includes('https://files.example/plan.pdf') && got.some((x) => /^file:.*brief\.txt$/.test(x)), 'attached files open (a web file in the browser, a file inside the event in its app)');
  check(await main.locator('.event-editor button[title="Open in Maps"]').count() === 1, 'the place offers Open in Maps');
  for (const mode of ['light', 'dark']) {
    await k(async (m) => { await window.keeper.settings.set({ appearance: m }); }, mode);
    await wait(500);
    await shot('event-links', mode);
  }

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  smtp.close();
  dovecot.stop();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
