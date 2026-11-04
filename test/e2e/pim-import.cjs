// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/pim-import.cjs /tmp/kp-imp /tmp/kp-imp-shots [/path/for/named/shots]
// Drives the real Keeper app: Mail, Calendar and Reminders open on their
// designed first screens (light and dark); the Import flow brings in an mbox
// file through the dialog's own steps (the system file picker answered here),
// the mail lands in "On this computer", is searchable and opens with its
// attachment, and Undo takes it back; a calendar file, a task spreadsheet and
// contact cards come in through the same flow; a folder exports as .mbox;
// a combined mailbox lists two folders as one.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(process.argv[2] || '/tmp/kp-imp');
const SHOTS = path.resolve(process.argv[3] || '/tmp/kp-imp-shots');
const NAMED = process.argv[4] ? path.resolve(process.argv[4]) : null;
fs.rmSync(HOME, { recursive: true, force: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const msg = (subject, i, extra = []) => [
  `From: Ana Lopez <ana@example.org>`, 'To: Ben <ben@example.org>', `Subject: ${subject}`, `Message-ID: <${subject.replace(/\W/g, '')}${i}@example.org>`,
  `Date: ${new Date(Date.now() - i * 3_600_000).toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b"', ...extra, '',
  '--b', 'Content-Type: text/plain; charset=utf-8', '', `Notes about ${subject}.`, '--b', 'Content-Type: text/plain; name="plan.txt"', 'Content-Disposition: attachment; filename="plan.txt"', '', 'the plan', '--b--', '',
].join('\n');

(async () => {
  const mbox = path.join(HOME, 'Downloads', 'Projects.mbox');
  fs.writeFileSync(mbox, ['Garden plans', 'Kitchen quote', 'Roof repair'].map((s, i) => `From ana@example.org Mon Nov  2 10:00:00 2026\n${msg(s, i, i ? ['Status: RO'] : ['Status: O'])}`).join('\n'));
  const ics = path.join(HOME, 'Downloads', 'Family.ics');
  const day = (n) => { const d = new Date(Date.now() + n * 86_400_000); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
  fs.writeFileSync(ics, ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:fam1', `DTSTART:${day(1)}T090000Z`, `DTEND:${day(1)}T100000Z`, 'RRULE:FREQ=WEEKLY;COUNT=4', 'SUMMARY:Swimming lesson', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
  const csv = path.join(HOME, 'Downloads', 'tasks.csv');
  fs.writeFileSync(csv, 'Title,Due,Priority,List\nRenew passport,2026-12-01,High,Admin\nBook dentist,,Low,Health\n');
  const vcf = path.join(HOME, 'Downloads', 'people.vcf');
  fs.writeFileSync(vcf, 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Carla Diaz\r\nEMAIL:carla@example.org\r\nEND:VCARD\r\n');

  const root = path.resolve(__dirname, '../..');
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/.bin/electron'), args: [root, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  // The system's file picker is answered here (what a person would choose).
  const answer = (files) => app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: f });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f[0] });
  }, files);
  let main;
  for (let i = 0; i < 60 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return !u.includes('view=') || u.includes('view=app'); });
    if (!main) await wait(500);
  }
  const errors = [];
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.getURL().includes('view=') || w.webContents.getURL().includes('view=app')) { w.setSize(1440, 900); w.center(); w.show(); } });
  await wait(1200);
  const k = (fn, arg) => main.evaluate(fn, arg);
  const shot = async (name, mode) => {
    await main.screenshot({ path: path.join(SHOTS, `${name}-${mode}.png`) });
    if (NAMED) fs.copyFileSync(path.join(SHOTS, `${name}-${mode}.png`), path.join(NAMED, `pimall-${name}-${mode}.png`));
  };
  const go = async (title) => { await main.click(`.sidebar [title="${title}"]`); await wait(900); };

  // ---------------------------------------------------------------- first screens, light and dark
  for (const mode of ['light', 'dark']) {
    await k(async (m) => { await window.keeper.settings.set({ appearance: m }); }, mode);
    await wait(600);
    await go('Mail');
    await main.waitForSelector('[data-testid="mail-welcome"]', { timeout: 8000 }).catch(() => {});
    check(await main.locator('[data-testid="mail-welcome"]').count() === 1, `Mail opens on its first screen (${mode})`);
    const names = await main.locator('.pim-provider').allInnerTexts();
    check(['Gmail', 'Outlook', 'iCloud', 'Yahoo', 'Fastmail', 'Other'].every((n) => names.some((x) => x.includes(n))), `a button for each provider (${names.join(', ')})`);
    await shot('mail-welcome', mode);
    await go('Calendar');
    await main.waitForSelector('[data-testid="calendar-welcome"]', { timeout: 8000 }).catch(() => {});
    check(await main.locator('[data-testid="calendar-welcome"]').count() === 1, `Calendar opens on its first screen (${mode})`);
    await shot('calendar-welcome', mode);
    await go('Reminders');
    await main.waitForSelector('[data-testid="reminders-welcome"]', { timeout: 8000 }).catch(() => {});
    check(await main.locator('[data-testid="reminders-welcome"]').count() === 1, `Reminders opens on its first screen (${mode})`);
    await shot('reminders-welcome', mode);
  }
  await k(async () => { await window.keeper.settings.set({ appearance: 'light' }); });

  // A provider button starts that provider's own setup.
  await go('Mail');
  await main.click('[data-testid="provider-icloud"]');
  await wait(500);
  check(await main.locator('[data-testid="guide-icloud"]').count() === 1 && (await main.locator('input[placeholder="you@icloud.com"]').count()) === 1, 'iCloud opens the account dialog with iCloud’s steps');
  await main.keyboard.press('Escape');
  await wait(300);

  // ---------------------------------------------------------------- import mail through the flow
  await main.click('[data-testid="mail-import"]');
  await main.waitForSelector('[data-testid="import-choose"]', { timeout: 5000 });
  for (const mode of ['light', 'dark']) {
    await k(async (m) => { await window.keeper.settings.set({ appearance: m }); }, mode);
    await wait(500);
    await shot('import-choose', mode);
  }
  await main.click('[data-testid="import-source-mbox"]');
  check(await main.locator('[data-testid="import-ready"] .imp-howto li').count() >= 2, 'plain steps are shown before choosing');
  await answer([mbox]);
  await main.click('[data-testid="import-pick"]');
  await wait(300);
  check((await main.locator('.imp-picked').innerText()).includes('Projects.mbox'), 'the chosen file is named');
  await main.click('[data-testid="import-start"]');
  await main.waitForSelector('[data-testid="import-summary"], [data-testid="import-ready"] [role="alert"]', { timeout: 30_000 }).catch(() => {});
  if (!(await main.locator('[data-testid="import-summary"]').count())) console.log('dialog says:', await main.locator('[data-testid="import-dialog"]').innerText().catch(() => '(no dialog)'));
  const summary = await main.locator('.imp-summary').innerText().catch(() => '');
  check(summary === '3 messages', `the summary says what came in (${summary})`);
  for (const mode of ['light', 'dark']) {
    await k(async (m) => { await window.keeper.settings.set({ appearance: m }); }, mode);
    await wait(500);
    await shot('import-done', mode);
  }
  await k(async () => { await window.keeper.settings.set({ appearance: 'light' }); });
  await main.locator('[data-testid="import-summary"] button', { hasText: 'Show' }).click();
  await wait(1200);
  const listText = await main.locator('.mail-list').innerText().catch(() => '');
  check(/Garden plans/.test(listText) && /Roof repair/.test(listText), 'the imported folder opens with its messages');
  check((await main.locator('.mail-account-name', { hasText: 'On this computer' }).count()) === 1, 'the mail is in "On this computer"');
  const found = await k(async () => (await window.keeper.pim.search('kitchen')).messages.map((m) => m.subject));
  check(found.includes('Kitchen quote'), 'imported mail is found by search');
  const accts = await k(async () => window.keeper.pim.accounts());
  const local = accts.find((a) => a.kind === 'local');
  const msgs = (await k(async (a) => (await window.keeper.pim.messages({ account: a, folder: 'Imported/Projects' })).messages, local.id));
  check(msgs.filter((m) => !m.seen).length === 1, 'read marks came along (one unread)');
  const opened = await k(async (id) => window.keeper.pim.open(id), msgs[0].id);
  check(opened.attachments.some((a) => a.filename === 'plan.txt'), 'a message opens with its attachment');
  // Export the folder as .mbox and check it reads back.
  const out = path.join(HOME, 'Downloads', 'Projects-export.mbox');
  await answer([out]);
  const ex = await k(async (a) => window.keeper.pim.exportMail(a, 'Imported/Projects', 'mbox'), local.id);
  check(ex && ex.count === 3 && fs.readFileSync(out, 'utf8').match(/^From /gm).length === 3, 'the folder exports as an .mbox file');
  // Undo from Past imports.
  const hist = await k(async () => window.keeper.pim.importHistory());
  await k(async (id) => window.keeper.pim.undoImport(id), hist[0].id);
  await wait(800);
  const after = await k(async (a) => (await window.keeper.pim.folders()).filter((f) => f.account === a && f.path.startsWith('Imported')).length, local.id);
  check(after === 0, 'Undo takes the import back');

  // ---------------------------------------------------------------- calendar, tasks and contacts through the same flow
  const flow = async (source, file) => {
    await answer([file]);
    await main.click(`[data-testid="import-source-${source}"]`);
    await main.click('[data-testid="import-pick"]');
    await wait(200);
    await main.click('[data-testid="import-start"]');
    await main.waitForSelector('[data-testid="import-summary"]', { timeout: 20_000 });
    return main.locator('.imp-summary').innerText();
  };
  await go('Calendar');
  await main.click('[data-testid="calendar-import"]').catch(async () => { await main.click('.pim-welcome .btn.ghost'); });
  await main.waitForSelector('[data-testid="import-choose"]', { timeout: 5000 });
  const calSum = await flow('ics', ics);
  check(/1 event · 1 repeating/.test(calSum), `a calendar file comes in (${calSum})`);
  await main.keyboard.press('Escape');
  const cals = await k(async () => (await window.keeper.pim.calendars()).map((c) => c.name));
  check(cals.includes('Family'), 'it is a calendar of its own named after the file');

  await go('Reminders');
  await main.click('[data-testid="reminders-import"]');
  await main.waitForSelector('[data-testid="import-choose"]', { timeout: 5000 });
  const taskSum = await flow('tasks-csv', csv);
  check(/2 tasks in 2 lists/.test(taskSum), `tasks come in from a spreadsheet (${taskSum})`);
  await main.keyboard.press('Escape');
  await wait(500);
  const tasks = await k(async () => (await window.keeper.pim.reminders()).filter((r) => r.title === 'Renew passport'));
  check(tasks.length === 1 && tasks[0].priority === 3 && tasks[0].project === 'Admin', 'with their priority and list');

  const contactsResult = await k(async (p) => window.keeper.pim.runImport({ source: 'vcf', paths: [p] }), vcf);
  check(contactsResult.added === 1, 'contact cards come in');
  const people = await k(async () => (await window.keeper.pim.contacts()).map((c) => c.name));
  check(people.includes('Carla Diaz'), 'the contact is there for address suggestions');

  // ---------------------------------------------------------------- a combined mailbox
  await k(async (p) => window.keeper.pim.runImport({ source: 'mbox', paths: [p] }), mbox);
  const folders = await k(async (a) => (await window.keeper.pim.folders()).filter((f) => f.account === a).map((f) => f.path), local.id);
  await k(async (a) => window.keeper.pim.setPrefs({ unifiedViews: [{ id: 'mine', name: 'My picks', sources: [{ account: a, folder: 'Imported/Projects' }, { account: a, folder: 'inbox' }] }] }), local.id);
  const combined = await k(async () => (await window.keeper.pim.messages({ folder: 'view:mine' })).messages.length);
  check(folders.includes('Imported/Projects') && combined === 3, `a combined mailbox lists the chosen folders as one (${combined})`);
  await go('Mail');
  await wait(800);
  check(await main.locator('[data-testid="mail-combined"]', { hasText: 'My picks' }).count() === 1, 'it is listed under All inboxes');

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
