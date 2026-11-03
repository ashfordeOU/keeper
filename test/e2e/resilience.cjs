// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/resilience.cjs <scratch dir> <screenshots dir>
// Drives the real Keeper: opens tabs (a scrolled library page, the terminal and
// the assistant with a half-typed question), then kills Keeper's main process
// with SIGKILL. The watchdog must start Keeper again with every tab, the scroll
// position and the draft. Then it crashes a window (reloaded with its tabs),
// kills the Network Activity service process (restarted, the page keeps
// working), and crashes Keeper twice more (safe mode after repeated crashes).
const { _electron, chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/kres-'));
const SHOTS = path.resolve(process.argv[3] || path.join(ROOT, 'shots'));
const HOME = path.join(ROOT, 'home');
const APP = path.resolve(__dirname, '../..');
const PORT = 9334 + Math.floor(Math.random() * 400);
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
// Enough files for the library to scroll.
for (let i = 0; i < 400; i++) fs.writeFileSync(path.join(HOME, 'Documents', `note ${String(i).padStart(3, '0')}.txt`), `Note number ${i}\n`);

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, step = 250) => { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } if (Date.now() - t > ms) return null; await sleep(step); } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const env = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', KEEPER_WATCHDOG: '1', KEEPER_WATCHDOG_EXTRA: `--remote-debugging-port=${PORT} --no-sandbox` };
const userData = path.join(HOME, '.config', 'Keeper');
const pageErrors = [];

/** The main window of a Keeper started by the watchdog, through its debugging port. */
async function attach() {
  const browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 5000 }).catch(() => null), 60000, 500);
  if (!browser) return null;
  const page = await until(async () => {
    for (const c of browser.contexts()) for (const p of c.pages()) if (/view=app/.test(p.url()) && !/win=/.test(p.url())) return p;
    return null;
  }, 30000, 300);
  if (page) { page.on('pageerror', (e) => pageErrors.push(e.message)); await page.waitForSelector('.sidebar', { timeout: 30000 }); }
  return { browser, page };
}

async function mainPid(page) {
  return page.evaluate(() => window.keeper.svc.list().then((l) => l.find((p) => p.id === 'main')?.pid));
}

(async () => {
  // ---------------------------------------------------------------- 1. open tabs, then kill -9
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  await app.firstWindow();
  const w = await until(() => app.windows().find((x) => /view=app/.test(x.url())), 30000);
  w.on('pageerror', (e) => pageErrors.push(e.message));
  await w.waitForSelector('.sidebar', { timeout: 60000 });
  await until(() => w.evaluate(() => window.keeper.library.status().then((s) => s.files >= 400)), 60000, 500);
  // A local model needs no key, so the assistant's question box shows.
  await w.evaluate(() => window.keeper.settings.get().then((s) => window.keeper.settings.set({ brain: { ...s.brain, active: 'ollama' } })));

  // A first-run tour may be showing; skip it.
  await w.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  // Tab 1: Everywhere + Documents (once All Documents), from Home's types, scrolled.
  await w.click('[data-testid="home-types"] [data-chip="document"]');
  await w.waitForTimeout(1500);
  // Tab 2: the terminal, opened with a middle-click (new tab in the background), then selected.
  await w.click('.sidebar [title="Terminal"]', { button: 'middle' });
  await w.waitForTimeout(600);
  check(await w.locator('.tab-strip .tab').count() === 2, 'a middle-click on the sidebar opens a page in a new tab');
  // Tab 3: the assistant, from the sidebar's "Open in New Tab".
  await w.click('.sidebar [title="Assistant"]', { button: 'right' });
  await w.getByText('Open in New Tab', { exact: true }).click();
  await w.waitForTimeout(800);
  check(await w.locator('.tab-strip .tab').count() === 3, '"Open in New Tab" from a sidebar entry');
  await w.locator('.tab-strip .tab', { hasText: 'Assistant' }).click();
  await w.waitForSelector('.composer textarea', { timeout: 15000 });
  // Typed key by key: the box must show each letter as it is typed (the draft is saved behind it).
  await w.click('.composer textarea');
  await w.keyboard.type('Where did I save', { delay: 15 });
  check(await w.inputValue('.composer textarea') === 'Where did I save', 'typing into the assistant box shows the text straight away');
  await w.keyboard.type(' the lease from', { delay: 15 });
  await w.locator('.tab-strip .tab', { hasText: 'Documents' }).click();
  await w.waitForTimeout(1200);
  await w.evaluate(() => { const c = document.querySelector('.main > .content'); c.scrollTop = 900; c.dispatchEvent(new Event('scroll')); });
  await w.waitForTimeout(1600);
  const scrolled = await w.evaluate(() => document.querySelector('.main > .content').scrollTop);
  check(scrolled > 300, `the Documents page is scrolled (${scrolled})`);
  await w.screenshot({ path: path.join(SHOTS, 'tabs-before-crash.png') });

  // ---------------------------------------------------------------- a window crashes
  const inMain = (js) => app.evaluate(({ BrowserWindow }, code) => {
    const m = BrowserWindow.getAllWindows().find((x) => /view=app/.test(x.webContents.getURL()));
    return m.webContents.executeJavaScript(code);
  }, js);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => /view=app/.test(x.webContents.getURL())).webContents.forcefullyCrashRenderer());
  const reopened = await until(() => inMain("document.querySelector('.toast-stack')?.textContent ?? ''").then((t) => (/reopened/.test(t) ? t : null)), 10000, 200);
  check(!!reopened, 'after a window crashed it was reopened at once, and says so');
  const tabsAfter = await until(() => inMain("document.querySelectorAll('.tab-strip .tab').length").then((n) => (n === 3 ? n : null)), 10000);
  check(tabsAfter === 3, 'with all three tabs');
  const w2 = await until(() => app.windows().find((x) => /view=app/.test(x.url())), 5000);
  void w2;
  // Keeper's own main process (the launcher in front of it is not Keeper).
  const pid1 = await app.evaluate(() => process.pid);
  process.kill(pid1, 'SIGKILL');
  check(true, `killed Keeper's main process with SIGKILL (pid ${pid1})`);

  // ---------------------------------------------------------------- 2. the watchdog brings it back
  let a = await attach();
  check(!!a?.page, 'the watchdog started Keeper again by itself');
  if (!a?.page) { console.log('cannot continue'); process.exit(1); }
  let page = a.page;
  await page.waitForTimeout(2500);
  const titles = await page.locator('.tab-strip .tab').allTextContents();
  check(titles.length === 3 && titles.some((t) => /Documents/.test(t)) && titles.some((t) => /Terminal/.test(t)) && titles.some((t) => /Assistant/.test(t)), `every tab is back (${titles.join(' | ')})`);
  check(await page.locator('.tab-strip .tab.on', { hasText: 'Documents' }).count() === 1, 'the tab that was in front is in front');
  const back = await until(() => page.evaluate(() => document.querySelector('.main > .content').scrollTop).then((v) => (v > 300 ? v : null)), 10000);
  check(!!back, `the scroll position is back (${back})`);
  check(await page.locator('.update-banner.recovery').count() === 1, 'it says Keeper closed unexpectedly and the tabs are back');
  await page.screenshot({ path: path.join(SHOTS, 'tabs-after-crash.png') });
  await page.locator('.tab-strip .tab', { hasText: 'Assistant' }).click();
  const draft = await until(() => page.inputValue('.composer textarea').then((v) => v || null), 10000);
  check(draft === 'Where did I save the lease from', `the half-typed question is back (“${draft}”)`);
  await page.locator('.tab-strip .tab', { hasText: 'Terminal' }).click();
  check(!!(await until(() => page.locator('.term-app').count(), 15000)), 'the terminal tab opens');

  // ---------------------------------------------------------------- 4. a service process crashes
  // A Keeper started again after a crash is not under test control: its sidebar sections start
  // folded and long ones show their most used items first. Open System and show all of it.
  // Network Activity is a tab of Privacy & Security (a section that starts open).
  if (!(await page.locator('.sidebar [title="Privacy & Security"]').isVisible())) await page.locator('.sidebar button.nav-title', { hasText: /privacy/i }).first().click().catch(() => undefined);
  await page.click('.sidebar [title="Privacy & Security"]');
  await page.click('[data-testid="hub-tab-netactivity"]');
  const svc = await until(() => page.evaluate(() => window.keeper.svc.list().then((l) => l.find((p) => p.id === 'svc:net' && p.pid))), 30000, 500);
  check(!!svc, `Network Activity runs in its own process (pid ${svc?.pid}, ${Math.round((svc?.memory ?? 0) / 1048576)} MB)`);
  const mainBefore = await mainPid(page);
  if (svc) process.kill(svc.pid, 'SIGKILL');
  const again = await until(() => page.evaluate((old) => window.keeper.svc.list().then((l) => l.find((p) => p.id === 'svc:net' && p.pid && p.pid !== old)), svc?.pid), 30000, 500);
  check(!!again && again.restarts >= 1, `the service was started again (pid ${again?.pid}, restarts ${again?.restarts})`);
  check((await mainPid(page)) === mainBefore, 'Keeper itself kept running');
  const sample = await page.evaluate(() => window.keeper.net.sample().then((s) => s.flows.length).catch((e) => `error: ${e.message}`));
  check(typeof sample === 'number', `Network Activity still answers (${sample} connections)`);
  if (!(await page.locator('.sidebar [title="Health"]').isVisible())) await page.locator('.sidebar button.nav-title', { hasText: /computer/i }).first().click().catch(() => undefined);
  await page.click('.sidebar [title="Health"]');
  await page.click('[data-tab-id="keeper"]');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'processes.png') });
  check(await page.locator('.kproc-row', { hasText: 'Network Activity' }).count() === 1, 'the Processes page lists the service');

  // Stop all background work, then resume.
  await page.getByRole('button', { name: /Stop all background work/ }).click();
  check(!!(await until(() => page.locator('.kproc-held').count(), 5000)), 'Stop all background work holds it');
  check((await page.evaluate(() => window.keeper.svc.held())) > Date.now(), 'and the main process says work is held');
  await page.getByRole('button', { name: /Resume background work/ }).click();
  check((await until(() => page.evaluate(() => window.keeper.svc.held()).then((h) => (h === 0 ? true : null)), 5000)) === true, 'and resumes');

  // ---------------------------------------------------------------- 5. crash loop → safe mode
  for (let n = 2; n <= 3; n++) {
    const pid = await mainPid(page);
    await a.browser.close().catch(() => undefined);
    process.kill(pid, 'SIGKILL');
    await until(() => !alive(pid), 10000, 100);
    // Nothing of the old Keeper may be left behind (service processes leave with it).
    const left = await until(() => { try { return require('child_process').execSync(`ps -eo pid,ppid,args | awk '$2==${pid}'`).toString().trim() === '' ? true : null; } catch { return true; } }, 8000, 300);
    check(!!left, `nothing of crashed Keeper ${n - 1} was left running`);
    const t0 = Date.now();
    a = await attach();
    console.log(`  crash ${n}: Keeper back in ${Date.now() - t0} ms`);
    page = a?.page;
    if (!page) break;
    await page.waitForTimeout(2000);
  }
  check(!!page && await page.locator('.update-banner.recovery.safe').count() === 1, 'after three crashes in five minutes Keeper starts in safe mode');
  if (page) {
    await page.screenshot({ path: path.join(SHOTS, 'safe-mode.png') });
    const hidden = await page.evaluate(() => [...document.querySelectorAll('.sidebar [title]')].map((e) => e.getAttribute('title')));
    check(!hidden.includes('Terminal') && hidden.some((t) => t.startsWith('Recent')), 'safe mode keeps your files and switches the rest off');
    check((await page.locator('.tab-strip .tab').count()) >= 1, 'tabs are still there in safe mode');
  }

  // ---------------------------------------------------------------- 6. a normal quit is not a crash
  const lastPid = page ? await mainPid(page) : 0;
  await page?.evaluate(() => window.keeper.session.relaunch(false)).catch(() => undefined);
  await sleep(1500);
  a?.browser.close().catch(() => undefined);
  a = await attach();
  page = a?.page;
  check(!!page && await page.locator('.update-banner.recovery').count() === 0, '"Start normally" restarts without safe mode and without a crash notice');
  const pidNow = page ? await mainPid(page) : 0;
  check(pidNow && pidNow !== lastPid, 'a fresh Keeper is running');
  // Quit through the app; the watchdog must not start it again.
  await page.evaluate(() => window.close()).catch(() => undefined);
  try { process.kill(pidNow, 'SIGTERM'); } catch { /* gone */ }
  await sleep(9000);
  check(!alive(pidNow), 'Keeper quit');
  const running = JSON.parse(fs.readFileSync(path.join(userData, 'session', 'running.json'), 'utf8'));
  check(running === null, 'a normal quit is recorded as clean');
  const relaunched = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).then(() => true).catch(() => false);
  check(!relaunched, 'the watchdog does not start Keeper after a normal quit');

  check(pageErrors.length === 0, `no page errors${pageErrors.length ? ': ' + pageErrors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
