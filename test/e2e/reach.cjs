// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/reach.cjs /tmp/kreach-home /tmp/kreach-shots [section…]
// Drives the real Keeper app through the platform parts: Send to… on a file
// (a task that links back, today's note, the AI), and the parts that follow
// below. Sections can be picked by name (default: all). Light and dark at
// 1440×900, and 1024×768 for the sheets.

const { _electron, chromium, devices } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const ONLY = process.argv.slice(4);
const want = (s) => !ONLY.length || ONLY.includes(s);
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop', 'Notes']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
const DOC = path.join(HOME, 'Documents', 'Garden plan.txt');
fs.writeFileSync(DOC, 'Plant tomatoes in May\nBuy compost\n');

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }

// A stand-in voice (Linux's spd-say) that writes down what it was asked to say.
const BIN = path.join(HOME, 'bin');
const SAID = path.join(HOME, 'said.txt');
fs.mkdirSync(BIN, { recursive: true });
fs.writeFileSync(path.join(BIN, 'spd-say'), `#!/bin/sh\nfor a; do last="$a"; done\nprintf '%s' "$last" > '${SAID}'\n`, { mode: 0o755 });
// Reading fonts from this computer (KEEPER_TEST_FONTS_DIR holds the pinned files, laid out by file name).
const http = require('http');
const FONTS_DIR = process.env.KEEPER_TEST_FONTS_DIR || '';
const fontServer = http.createServer((req, res) => {
  const name = path.basename(decodeURIComponent(req.url || ''));
  const f = FONTS_DIR && path.join(FONTS_DIR, name);
  if (f && fs.existsSync(f)) { res.writeHead(200, { 'content-type': 'font/woff2' }); res.end(fs.readFileSync(f)); } else { res.writeHead(200); res.end('not a font'); }
}).listen(0, '127.0.0.1');
const ENV = { ...process.env, PATH: `${BIN}:${process.env.PATH}`, KEEPER_FONTS_BASE: '', KEEPER_TEST_NO_RELAUNCH: '1', KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' };

async function launch(extraEnv = {}, opts = {}) {
  const env = { ...ENV, ...extraEnv };
  for (const k of opts.drop ?? []) delete env[k];
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env,
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  if (opts.setup) return { app, main, errors };
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  // Only demo data in pictures: this machine's own drives and tools leave the sidebar.
  const tidySidebar = () => main.evaluate(() => { for (const el of document.querySelectorAll('.sidebar *')) if (el.children.length === 0 && /^(vm|claude-code|env-runner|public|examples|Claude Code)$/.test((el.textContent || '').trim())) { const row = el.closest('a, button, li, [role="treeitem"]'); if (row) row.style.display = 'none'; } });
  const shot = async (name) => { await wait(800); await tidySidebar(); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const dark = (on) => main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), on);
  const both = async (name) => { await shot(`${name}-light`); await dark(true); await shot(`${name}-dark`); await dark(false); };
  const small = async (name) => {
    await main.setViewportSize({ width: 1024, height: 768 }).catch(() => undefined);
    await shot(`${name}-1024`);
    check(!(await main.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${name}: nothing runs off the side at 1024×768`);
    await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  };
  return { app, main, errors, navigate, shot, dark, both, small };
}

(async () => {
  await new Promise((r) => (fontServer.listening ? r() : fontServer.once('listening', r)));
  ENV.KEEPER_FONTS_BASE = `http://127.0.0.1:${fontServer.address().port}`;
  let k = await launch();
  let { app, main, errors, navigate, both, small } = k;

  // ---------------------------------------------------------------- Send to…
  if (want('sendto')) {
    await main.evaluate((dir) => window.keeper.notes.addVault ? window.keeper.notes.addVault(dir).catch(() => undefined) : undefined, path.join(HOME, 'Notes'));
    await navigate(`browse:${path.dirname(DOC)}`);
    const card = main.locator(`.file-card[data-path="${DOC}"]`);
    await card.waitFor({ timeout: 20000 });
    await card.click();
    await card.click({ button: 'right' });
    await main.locator('[data-testid="menu-send-to"]').click();
    await main.waitForSelector('[data-testid="send-to"]', { timeout: 5000 });
    const verbs = await main.locator('[data-testid="send-to"] .sendto-verb').evaluateAll((b) => b.map((x) => x.dataset.verb));
    check(verbs.join(',') === 'note,task,event,mail,device,ai,shelf,cue', `the sheet offers the eight verbs (${verbs.join(',')})`);
    check(/Garden plan\.txt/.test(await main.locator('.sendto-title').innerText()), 'it names what is being sent');
    await both('auditplatform-sendto');
    await small('auditplatform-sendto');
    // 2 = Task, from the keyboard.
    await main.keyboard.press('2');
    const task = await until(async () => (await main.evaluate(() => window.keeper.pim.reminders())).find((t) => t.title === 'Garden plan.txt'), 15000);
    check(!!task, 'pressing 2 makes a task from the file');
    check(!!task && /from file: Garden plan\.txt/.test(task.notes || '') && /keeper:\/\/open\?path=/.test(task.url || task.notes || ''), 'the task keeps a link back to the file');
    check(!!(await until(() => main.locator('.toast', { hasText: 'Task added' }).count(), 5000)), 'a message says so, with Undo');
    // Inspector: Send to… then AI.
    await main.locator('[data-testid="insp-send-to"]').click().catch(() => undefined);
    if (await main.locator('[data-testid="send-to"]').count()) {
      const ai = main.locator('[data-testid="send-to"] .sendto-verb[data-verb="ai"]');
      if (await ai.isDisabled()) check(/switched off/.test(await ai.getAttribute('title')), 'AI says why it cannot be used');
      else {
        await ai.click();
        const gone = await until(async () => (await main.locator('[data-testid="send-to"]').count()) === 0, 5000);
        const page = await until(async () => /Assistant/.test(await main.locator('h1').first().innerText()), 10000);
        check(!!gone && !!page, 'AI closes the sheet and opens the assistant');
        const draft = await main.evaluate(() => document.querySelector('.composer textarea')?.value ?? null);
        check(draft === null || draft.includes('Garden plan.txt'), 'with a question about the file once an AI is set up');
      }
    } else check(false, 'the Inspector has Send to…');
  }

  // ---------------------------------------------------------------- keeper do (automation)
  if (want('automation')) {
    const cli = (...args) => spawnSync(process.execPath, [path.resolve(__dirname, '../../dist-cli/keeper.cjs'), 'do', ...args], { env: { ...ENV, KEEPER_DATA_DIR: path.join(HOME, '.config', 'Keeper') }, encoding: 'utf8', timeout: 30000 });
    const list = cli('--list', '--json');
    const ids = (() => { try { return JSON.parse(list.stdout).map((a) => a.id); } catch { return []; } })();
    check(ids.includes('focus') && ids.includes('send.task') && ids.includes('catch'), `keeper do --list lists the actions (${ids.length})`);
    // The command's socket is ready once the app has written its address.
    await until(() => fs.existsSync(path.join(HOME, '.config', 'Keeper', 'brain', 'endpoint.json')) || fs.readdirSync(path.join(HOME, '.config', 'Keeper', 'brain')).length, 30000);
    const r = cli('send.task', '--title', 'Call the plumber', '--json');
    let res = null; try { res = JSON.parse(r.stdout); } catch { /* not JSON */ }
    check(r.status === 0 && res?.ok === true && /^keeper:\/\/send\?to=task/.test(res.link), `keeper do send.task answers with JSON (${(r.stdout || r.stderr).trim().slice(0, 120)})`);
    const made = await until(async () => (await main.evaluate(() => window.keeper.pim.reminders())).find((t) => t.title === 'Call the plumber'), 15000);
    check(!!made, 'and the task is made without opening anything');
    const c = cli('catch', '--text', 'Ideas for the garden');
    const caught = await until(async () => (await main.evaluate(() => window.keeper.inbox.list())).find((i) => /Ideas for the garden/.test(i.text)), 15000);
    check(c.status === 0 && !!caught, 'keeper do catch puts words in the Inbox');
    const bad = cli('focus', '--minutes', '999');
    check(bad.status !== 0 && /minutes must be a number from 0 to 240/.test(bad.stderr + bad.stdout), 'a wrong value is said plainly and fails the command');
    const nope = cli('format-disk');
    check(nope.status !== 0 && /No action called/.test(nope.stderr + nope.stdout), 'an unknown action fails with a plain message');
    // Settings → Works with your computer: the links and scripts row names keeper do.
    await navigate('settings');
    await main.waitForSelector('[data-testid="settings-search"]', { timeout: 15000 });
    await main.locator('[data-testid="settings-search"]').fill('scripts');
    await main.locator('[data-testid="settings-result"]', { hasText: /File manager and desktop search|Works with your computer/ }).first().click({ timeout: 10000 }).catch(() => undefined);
    const row = await until(async () => (await main.locator('text=keeper do focus').count()) > 0, 15000);
    check(!!row, 'Settings says how scripts run any action (keeper do)');
    await main.locator('text=keeper do focus').first().scrollIntoViewIfNeeded().catch(() => undefined);
    await both('auditplatform-automation');
  }

  // ---------------------------------------------------------------- Move or back up Keeper
  if (want('backup')) {
    const PW = 'garden tomatoes';
    const file = path.join(HOME, 'Documents', 'Keeper backup.keeperbackup');
    await main.evaluate(() => window.keeper.inbox.add({ text: 'Before the move', source: 'test' }));
    await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
    await main.evaluate(([pw, f]) => window.keeper.keeperBackup.writeFile(pw, f), [PW, file]);
    const raw = fs.readFileSync(file);
    check(raw.subarray(0, 14).toString() === 'KEEPERBACKUP 1', 'Back up writes a .keeperbackup file');
    check(!raw.includes(Buffer.from('Before the move')) && !raw.includes(Buffer.from('appearance')), 'with nothing readable without the password');
    const st = await main.evaluate(() => window.keeper.keeperBackup.status());
    check(st.files > 2 && st.leftOut.some((l) => l.why === 'secret' || l.why === 'system' || l.why === 'rebuilt'), `the panel knows what a copy holds and leaves out (${st.files} files; ${st.leftOut.map((l) => l.why).join(', ')})`);
    const wrong = await main.evaluate(([f]) => window.keeper.keeperBackup.restoreFile(f, 'not the one').then(() => 'ok', (e) => e.message), [file]);
    check(/That password doesn’t open this backup/.test(wrong), 'a wrong password is said plainly and changes nothing');
    // The nightly copy: off until switched on; Make one now.
    check((await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'keeperBackup')?.on === false, 'the nightly copy is off until switched on');
    await main.evaluate(() => window.keeper.features.set('keeperBackup', true));
    const snaps = await main.evaluate(() => window.keeper.keeperBackup.snapshotNow());
    check(snaps.snapshots.length === 1 && snaps.snapshots[0].label === 'Today', 'Make one now keeps today’s copy');
    await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));
    await navigate('settings');
    await main.waitForSelector('[data-testid="settings-search"]', { timeout: 15000 });
    await main.locator('[data-testid="settings-search"]').fill('new computer');
    await main.locator('[data-testid="settings-result"]', { hasText: 'Move or back up Keeper' }).first().click({ timeout: 10000 }).catch(() => undefined);
    check(!!(await until(() => main.locator('[data-testid="keeper-backup"]').count(), 10000)), 'Settings → General has Move or back up Keeper');
    await main.locator('[data-testid="keeper-backup"]').scrollIntoViewIfNeeded();
    await both('auditplatform-backup');
    await main.locator('[data-testid="kb-save"]').click();
    await main.locator('[data-testid="kb-pw"]').fill('short');
    await main.locator('[data-testid="kb-pw2"]').fill('short');
    check(await main.locator('[data-testid="kb-go"]').isDisabled(), 'a short password cannot be used');
    await main.locator('[data-testid="kb-pw"]').fill(PW);
    await main.locator('[data-testid="kb-pw2"]').fill(PW);
    await both('auditplatform-backup-password');
    await main.keyboard.press('Escape');
    // Something changes after the backup; restoring puts it back at the next start.
    const items = await main.evaluate(() => window.keeper.inbox.list());
    for (const it of items) await main.evaluate((id) => window.keeper.inbox.remove(id), it.id);
    check((await main.evaluate(() => window.keeper.inbox.list())).length === 0, 'the Inbox is emptied after the backup');
    const closed = new Promise((r) => app.process().once('exit', r));
    await main.evaluate(([f, pw]) => window.keeper.keeperBackup.restoreFile(f, pw), [file, PW]).catch(() => undefined);
    await Promise.race([closed, wait(15000)]);
    check(errors.length === 0, `no page errors before the restart (${errors.slice(0, 2).join('; ')})`);
    k = await launch();
    ({ app, main, errors, navigate, both, small } = k);
    const back = await until(async () => (await main.evaluate(() => window.keeper.inbox.list())).find((i) => i.text === 'Before the move'), 15000);
    check(!!back, 'after the restart the Inbox is as it was in the backup');
    const kept = fs.readdirSync(path.join(HOME, '.config', 'Keeper', 'keeper-snapshots')).filter((n) => n.startsWith('before-restore-'));
    check(kept.length === 1, 'and what the restore replaced is kept as a copy');
    check(!fs.existsSync(path.join(HOME, '.config', 'Keeper', 'restore-pending')), 'the staged restore is gone');
    // Setup's first screen offers the same restore.
    const fresh = path.join(HOME, 'fresh');
    fs.mkdirSync(path.join(fresh, 'Downloads'), { recursive: true });
    const s = await launch({ HOME: fresh, XDG_CONFIG_HOME: fresh + '/.config', XDG_DATA_HOME: fresh + '/.local/share' }, { drop: ['KEEPER_SKIP_TOUR', 'KEEPER_DEFAULTS'], setup: true });
    await s.main.waitForSelector('.tour [data-step="welcome"]', { timeout: 30000 });
    check(await s.main.locator('[data-testid="setup-moving"]').count() === 1, 'setup’s first screen asks “Moving from another computer?”');
    const tidy = () => s.main.evaluate(() => { for (const el of document.querySelectorAll('.sidebar *')) if (el.children.length === 0 && /^(vm|claude-code|env-runner|public|examples|Claude Code)$/.test((el.textContent || '').trim())) { const row = el.closest('a, button, li, [role="treeitem"]'); if (row) row.style.display = 'none'; } });
    await wait(1500); await tidy();
    await s.main.screenshot({ path: path.join(SHOTS, 'auditplatform-backup-setup-light.png') });
    await s.main.locator('[data-testid="setup-moving"]').click();
    check(!!(await until(() => s.main.locator('[data-testid="kb-restore-sheet"]').count(), 5000)), 'and opens Restore Keeper');
    await wait(900); await tidy();
    await s.main.screenshot({ path: path.join(SHOTS, 'auditplatform-backup-setup-restore-light.png') });
    const onTop = await s.main.evaluate(() => { const m = document.querySelector('[data-testid="kb-restore-sheet"]'); if (!m) return false; const r = m.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + 20); return !!el && m.contains(el); });
    check(onTop, 'the restore sheet sits above the setup card');
    await s.app.close();
  }

  // ---------------------------------------------------------------- settings on your other computers
  if (want('sync')) {
    const other = path.join(HOME, 'laptop');
    for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(other, d), { recursive: true });
    const L = await launch({ HOME: other, XDG_CONFIG_HOME: other + '/.config', XDG_DATA_HOME: other + '/.local/share' });
    const call = (w, f, ...a) => w.evaluate(([fn, args]) => { const p = fn.split('.'); let o = window.keeper; for (const x of p.slice(0, -1)) o = o[x]; return o[p[p.length - 1]](...args); }, [f, a]);
    const sa = await call(main, 'link.state');
    const sb = await call(L.main, 'link.state');
    check(sa.me.listening && sb.me.listening, 'both computers listen for each other');
    const inv = await call(main, 'link.invite');
    const pairing = call(L.main, 'link.pair', { address: `127.0.0.1:${sa.me.port}`, code: inv.code });
    for (const w of [main, L.main]) {
      const p = await until(async () => (await call(w, 'link.pending')).pairs[0], 15000);
      if (p) await call(w, 'link.confirmPair', p.id, true);
    }
    await pairing.catch(() => undefined);
    const paired = await until(async () => (await call(main, 'link.state')).devices.length === 1 && (await call(L.main, 'link.state')).devices.length === 1, 15000);
    check(!!paired, 'the two computers are paired');
    // Demo names in pictures, never this machine's; and the pairing sheets put away.
    await call(main, 'link.rename', 'Desk');
    await call(L.main, 'link.rename', 'Ana’s laptop');
    for (const w of [main, L.main]) { await w.keyboard.press('Escape').catch(() => undefined); await wait(300); }
    const idOfL = (await call(main, 'link.state')).devices[0].id;
    const idOfA = (await call(L.main, 'link.state')).devices[0].id;
    await call(L.main, 'link.renameDevice', idOfA, 'Desk');
    await call(main, 'link.renameDevice', idOfL, 'Ana’s laptop');
    for (const [w, dev] of [[main, idOfL], [L.main, idOfA]]) {
      await call(w, 'features.set', 'settingsSync', true);
      await call(w, 'settingsSync.setDevice', dev, true);
    }
    // A snippet and a theme made on the desk…
    const vs = await call(main, 'voice.settings');
    await call(main, 'voice.setSettings', { snippets: [...vs.snippets, { id: 'sn-addr', abbr: ';addr', trigger: '', text: '1 High Street' }] });
    await call(main, 'settings.set', { theme: 'blossom' });
    const r = await call(main, 'settingsSync.syncNow');
    check(r.devices[0]?.last?.ok === true, `the desk shares with the laptop (${r.devices[0]?.last?.message ?? 'ok'})`);
    const snip = await until(async () => (await call(L.main, 'voice.settings')).snippets.find((s) => s.abbr === ';addr'), 15000);
    check(!!snip && snip.text === '1 High Street', 'the snippet appears on the laptop');
    check(!!(await until(async () => (await call(L.main, 'settings.get')).theme === 'blossom', 10000)), 'and so does the theme');
    // Both change the theme; the later change wins and the other is kept as an older version.
    await call(main, 'settings.set', { theme: 'steel' });
    await wait(50);
    await call(L.main, 'settings.set', { theme: 'minimal' });
    await call(L.main, 'settingsSync.syncNow');
    const themeA = await until(async () => { const t = (await call(main, 'settings.get')).theme; return t === 'minimal' ? t : null; }, 15000);
    check(themeA === 'minimal', 'the newest change wins on both computers');
    const older = (await call(main, 'settingsSync.status')).older;
    check(older.some((o) => o.label === 'Theme' && o.value === 'steel'), `what it replaced is in Older versions (${older.map((o) => `${o.label}:${o.value}`).join(', ')})`);
    // Turning sharing off on the laptop: the desk's next try is refused, plainly.
    await call(L.main, 'settingsSync.setDevice', idOfA, false);
    const r2 = await call(main, 'settingsSync.syncNow');
    check(r2.devices[0]?.last?.ok === false, `a computer that stopped sharing refuses (${r2.devices[0]?.last?.message})`);
    await call(L.main, 'settingsSync.setDevice', idOfA, true);
    await call(L.main, 'settings.set', { theme: 'playful', appearance: 'light' });
    await call(L.main, 'settingsSync.syncNow');
    await L.navigate('settings');
    if (!(await until(() => L.main.locator('[data-testid="settings-search"]').count(), 15000))) await L.shot('debug-sync');
    await L.main.locator('[data-testid="settings-search"]').fill('other computer');
    await L.main.locator('[data-testid="settings-result"]', { hasText: 'Keep settings the same' }).first().click({ timeout: 10000 }).catch(() => undefined);
    const panel = await until(() => L.main.locator('[data-testid="settings-sync"]').count(), 10000);
    check(!!panel, 'Settings → Devices has Keep settings the same');
    if (!panel) { await L.shot('debug-sync'); console.log(await L.main.locator('.settings-page').innerText().catch(() => '')); }
    if (panel) { await L.main.locator('[data-testid="settings-sync"]').scrollIntoViewIfNeeded(); await L.both('auditplatform-sync'); }
    check(L.errors.length === 0, `no page errors on the laptop (${L.errors.slice(0, 2).join('; ')})`);
    await L.app.close();
  }

  // ---------------------------------------------------------------- the phone companion's Today
  if (want('phone')) {
    const call = (f, ...a) => main.evaluate(([fn, args]) => { const p = fn.split('.'); let o = window.keeper; for (const x of p.slice(0, -1)) o = o[x]; return o[p[p.length - 1]](...args); }, [f, a]);
    await call('link.rename', 'Desk');
    const noon = new Date(); noon.setHours(23, 0, 0, 0);
    const task = await call('pim.saveReminder', { id: '', list: 'local', title: 'Water the tomatoes', done: false, due: noon.getTime() - 3_600_000 });
    const inv = await call('link.companionInvite', false);
    const port = (await call('link.state')).me.port;
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const phone = await ctx.newPage();
    const phoneErrors = [];
    phone.on('pageerror', (e) => phoneErrors.push(e.message));
    await phone.goto(inv.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${port}`));
    const ask = await until(async () => (await main.getByText('Allow this phone?').count()) > 0, 10000);
    if (ask) await main.getByRole('button', { name: 'Allow', exact: true }).click();
    check(!!(await until(async () => (await phone.locator('#status').innerText()).includes('Connected'), 10000)), 'the phone page connects, encrypted');
    check(await phone.locator('nav#nav-main button').count() <= 6, 'the phone’s tab row has six tabs at most');
    check(!(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'nothing runs off the side of the phone');
    check(!(await phone.locator('#tab-today').isHidden()), 'Today opens first');
    const t = await until(async () => { const x = await phone.locator('#today-tasks').innerText(); return /Water the tomatoes/.test(x) ? x : null; }, 10000);
    check(!!t, 'Today lists the task due today');
    // Catch words into the Inbox.
    await phone.locator('#catch-text').fill('Ask about the allotment');
    await phone.locator('#catch-go').click();
    check(!!(await until(async () => (await call('inbox.list')).find((x) => x.text === 'Ask about the allotment' && x.source === 'phone'), 10000)), 'Catch puts words from the phone in the Inbox');
    // A photo into the Inbox.
    const photo = path.join(HOME, 'leaf.jpg');
    fs.writeFileSync(photo, Buffer.from('ffd8ffe000104a46494600', 'hex'));
    await phone.setInputFiles('#catch-photo', photo);
    check(!!(await until(async () => (await call('inbox.list')).find((x) => x.kind === 'shot' && /leaf\.jpg$/.test(x.path || '')), 15000)), 'a photo from the phone arrives in the Inbox');
    // Tick the task off.
    await phone.locator('#today-tasks .task input').first().check();
    check(!!(await until(async () => (await call('pim.reminders')).find((x) => x.id === task.id)?.done === true, 10000)), 'ticking a task on the phone completes it on the computer');
    // Find my files.
    await phone.locator('#find-q').fill('garden');
    await phone.locator('#find-go').click();
    const hit = await until(async () => { const x = await phone.locator('#find-out').innerText(); return /Garden plan\.txt/.test(x) ? x : null; }, 10000);
    check(!!hit && /~\/Documents/.test(hit), `Find shows the file and its folder in words (${(hit || '').replace(/\n/g, ' | ').slice(0, 80)})`);
    await phone.locator('#find-q').fill('');
    for (const dark of [false, true]) {
      await phone.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await phone.locator('#find-q').fill('garden');
      await phone.locator('#find-go').click();
      await wait(600);
      await phone.screenshot({ path: path.join(SHOTS, `auditplatform-phone-${dark ? 'dark' : 'light'}.png`), fullPage: true });
    }
    // More holds AI and Terminal.
    await phone.locator('#nav-more-btn').click();
    check(await phone.locator('nav#nav-more button[data-tab=ai]').isVisible(), 'More shows the clipboard, AI and Terminal');
    const manifest = await (await phone.request.get(`http://127.0.0.1:${port}/c/manifest.webmanifest`)).json();
    const sw = await phone.request.get(`http://127.0.0.1:${port}/c/sw.js`);
    check(manifest.display === 'standalone' && manifest.scope === './' && sw.ok(), 'the page can be installed (manifest and offline shell served)');
    check(phoneErrors.length === 0, `no errors on the phone page (${phoneErrors.slice(0, 2).join('; ')})`);
    await browser.close();
  }

  // ---------------------------------------------------------------- reading comfort
  if (want('reading')) {
    const a11y = async (patch) => { const s = await main.evaluate(() => window.keeper.settings.get()); await main.evaluate((a) => window.keeper.settings.set({ a11y: a }), { ...s.a11y, ...patch }); await wait(500); };
    const attr = (n) => main.evaluate((x) => document.documentElement.dataset[x], n);
    // Read aloud: off until switched on, then the system voice says the words (Markdown marks left out).
    const off = await main.evaluate(() => window.keeper.reading.speak('Hello').then(() => 'spoke', (e) => e.message));
    check(/switched off/.test(off), 'read aloud is off until switched on');
    await main.evaluate(() => window.keeper.features.set('readAloud', true));
    const r = await main.evaluate(() => window.keeper.reading.speak('# Garden plan\n**Plant** tomatoes in [May](https://x.org)'));
    const said = await until(() => fs.existsSync(SAID) && fs.readFileSync(SAID, 'utf8'), 8000);
    check(r.ok && said === 'Garden plan Plant tomatoes in May', `the computer’s voice reads the words (${said})`);
    // Text to 200%, wrapped instead of zoomed.
    await a11y({ textScale: 2, reflow: true });
    check((await attr('reflow')) === 'true' && (await attr('scaled')) === 'false', 'larger text wraps instead of zooming the window');
    const fs2 = await main.evaluate(() => getComputedStyle(document.body).fontSize);
    check(fs2 === '27px', `the body text is twice the size (${fs2})`);
    await a11y({ textScale: 1, reflow: false });
    // Larger buttons.
    await a11y({ bigTargets: true });
    const h = await main.evaluate(() => document.querySelector('.sidebar .nav-item')?.getBoundingClientRect().height ?? 0);
    check(h >= 44, `larger buttons are at least 44 pixels tall (${h})`);
    await a11y({ bigTargets: false });
    // A reading font: a file that is not the pinned one is refused; the real one is used.
    await a11y({ readingFont: 'dyslexic' });
    await wait(1500);
    if (FONTS_DIR) check((await attr('readingFont')) === 'dyslexic' && (await main.evaluate(() => document.fonts.check("16px 'Keeper Reading Dyslexic'"))), 'OpenDyslexic downloads once, is checked and used');
    else check((await attr('readingFont')) === undefined, 'a font that is not the pinned file is not used');
    await a11y({ lineSpacing: 1.6, letterSpacing: 0.04 });
    // Arrow keys move between rows of a table (Keeper itself on the Health page).
    await navigate('health:keeper');
    await until(() => main.locator('.kproc-table [role="row"] button').count(), 15000);
    const moved = await main.evaluate(async () => {
      const all = [...document.querySelectorAll('.kproc-table [role="row"]')];
      const first = all.find((r) => r.querySelector('button'));
      const i = all.indexOf(first);
      if (!first || i + 1 >= all.length) return 'few rows';
      const b = first.querySelector('button'); b.focus();
      b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 50));
      return all[i + 1].contains(document.activeElement) ? 'ok' : 'stayed';
    });
    check(moved === 'ok' || moved === 'few rows', `Down moves to the next row of a table (${moved})`);
    await navigate('settings');
    await main.waitForSelector('[data-testid="settings-search"]', { timeout: 15000 });
    await main.locator('[data-testid="settings-search"]').fill('dyslexia');
    await main.locator('[data-testid="settings-result"]', { hasText: 'Reading and read aloud' }).first().click({ timeout: 10000 }).catch(() => undefined);
    check(!!(await until(() => main.locator('[data-testid="reading-panel"]').count(), 10000)), 'Settings → Accessibility has Reading and read aloud');
    await a11y({ readingFont: 'hyperlegible', letterSpacing: 0 });
    await wait(1200);
    await main.locator('[data-testid="reading-panel"]').scrollIntoViewIfNeeded();
    await both('auditplatform-reading');
    await a11y({ lineSpacing: 0, letterSpacing: 0, readingFont: 'theme' });
  }

  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join('; ')})`);
  await app.close();
  fontServer.close();
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
