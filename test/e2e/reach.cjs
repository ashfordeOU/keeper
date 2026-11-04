// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/reach.cjs /tmp/kreach-home /tmp/kreach-shots [section…]
// Drives the real Keeper app through the platform parts: Send to… on a file
// (a task that links back, today's note, the AI), and the parts that follow
// below. Sections can be picked by name (default: all). Light and dark at
// 1440×900, and 1024×768 for the sheets.

const { _electron } = require('playwright');
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

const ENV = { ...process.env, KEEPER_TEST_NO_RELAUNCH: '1', KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' };

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

  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join('; ')})`);
  await app.close();
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
