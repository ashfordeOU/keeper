// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux, as root for the test network): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/netmon.cjs /tmp/nm-home /tmp/nm-shots [app folder]
// The network monitor and firewall in the real app, with a test enforcement
// backend (KEEPER_FW_FAKE: nothing on this computer is changed). A small
// server runs in its own network namespace at 198.51.100.10 (so its traffic
// looks like the internet's), and a test client ("nmclient") downloads from
// it. The live view lists the client with that host, its rates and a
// sparkline; search and filters work; Block from the inspector makes a deny
// rule that is applied and the connection shows as blocked; a new connection
// raises the Ask prompt in its small window (shown without taking the
// keyboard), which answers it; the menu bar's network part shows the
// busiest apps with Block, and never scrolls. Pictures in light and dark.

const { _electron } = require('playwright');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'knm-')));
const SHOTS = path.resolve(process.argv[3] || HOME);
const APP = path.resolve(process.argv[4] || path.resolve(__dirname, '../..'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10_000) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn().catch(() => undefined); if (v) return v; await wait(250); } return fn().catch(() => undefined); }
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' }).toString();

const NS = `knm${process.pid % 10000}`;
const IF = `knm${process.pid % 10000}a`;
const SERVER = '198.51.100.10';
const kids = [];
function cleanup() {
  for (const k of kids) try { k.kill('SIGKILL'); } catch { /* gone */ }
  try { sh('ip', ['netns', 'del', NS]); } catch { /* gone */ }
  try { sh('ip', ['link', 'del', IF]); } catch { /* gone */ }
}
process.on('exit', cleanup);

(async () => {
  // A test network: a namespace with the server, joined to this computer by a pair of virtual cables.
  sh('ip', ['netns', 'add', NS]);
  sh('ip', ['link', 'add', IF, 'type', 'veth', 'peer', 'name', `${IF}p`]);
  sh('ip', ['link', 'set', `${IF}p`, 'netns', NS]);
  sh('ip', ['addr', 'add', '198.51.100.1/24', 'dev', IF]);
  sh('ip', ['link', 'set', IF, 'up']);
  sh('ip', ['netns', 'exec', NS, 'ip', 'addr', 'add', `${SERVER}/24`, 'dev', `${IF}p`]);
  sh('ip', ['netns', 'exec', NS, 'ip', 'link', 'set', `${IF}p`, 'up']);
  // The server sends a steady trickle to whoever connects; the client reads it and sends a little back.
  const server = spawn('ip', ['netns', 'exec', NS, process.execPath, '-e', `require('net').createServer((s) => { const t = setInterval(() => s.write(Buffer.alloc(48 * 1024, 7)), 200); s.on('data', () => {}); s.on('error', () => clearInterval(t)); s.on('close', () => clearInterval(t)); }).listen(8443, '${SERVER}')`], { stdio: 'ignore' });
  kids.push(server);
  await wait(800);
  const bin = path.join(HOME, 'nmclient');
  // Its own program file (a hard link, or a copy), so the system names it apart from other node programs.
  try { fs.linkSync(process.execPath, bin); } catch { fs.copyFileSync(process.execPath, bin); fs.chmodSync(bin, 0o755); }
  const client = spawn(bin, ['-e', `const c = require('net').connect(8443, '${SERVER}'); c.on('data', () => {}); setInterval(() => c.write(Buffer.alloc(2048, 1)), 250); c.on('error', (e) => { console.error(e.message); process.exit(1); });`], { stdio: 'ignore' });
  kids.push(client);
  await wait(500);
  check(client.exitCode === null, `the test client connects to ${SERVER}:8443`);

  const env = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_FW_FAKE: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' };
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  const errors = [];
  let main;
  for (let i = 0; i < 60 && !main; i++) { main = app.windows().find((w) => w.url().includes('view=app')); if (!main) await wait(500); }
  main.on('pageerror', (e) => errors.push(`main: ${e.message}`));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=app')); w.setSize(1440, 900); w.center(); });
  const fw = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.fw[f](...args), [fn, a]);
  await fw('setSettings', { enforce: true, monitor: true, alerts: false, askWindow: true });

  // ---------------------------------------------------------------- the live view
  await main.click('.sidebar [title="Privacy & Security"]');
  await main.click('[data-testid="hub-tab-firewall"]');
  await main.waitForSelector('[data-testid="nm-status"]', { timeout: 15_000 });
  const row = main.locator('[data-testid="nm-app"][data-app="nmclient"]');
  const listed = await until(() => row.count(), 20_000);
  check(!!listed, `the live view lists the test client by name${listed ? '' : ` (listed: ${(await main.$$eval('[data-testid="nm-app"]', (els) => els.map((e) => e.dataset.app))).join(', ')})`}`);
  if (!listed) console.log(JSON.stringify((await fw('connections')).slice(0, 12)));
  await row.locator('.nm-app').click();
  const host = row.locator(`[data-testid="nm-host"][data-host="${SERVER}"]`);
  check(!!(await until(() => host.count(), 8000)), `under it, its connection to ${SERVER}`);
  const ports = await host.locator('.nm-where-txt small').textContent().catch(() => '');
  check(/TCP 8443/.test(ports ?? ''), `with protocol and port ("${ports}")`);
  const rateOk = await until(async () => { const t = await row.locator('.nm-app .nm-num').first().textContent(); return /[1-9]/.test(t ?? '') && /KB\/s|MB\/s/.test(t ?? '') ? t : undefined; }, 15_000);
  check(!!rateOk, `received rate shown (${rateOk})`);
  await wait(4000);
  const spark = await row.locator('.nm-app .nm-spark polyline').getAttribute('points');
  check(!!spark && new Set(spark.split(' ').map((p) => p.split(',')[1])).size > 1, 'its sparkline moves');
  check(await main.isVisible('[data-testid="nm-inspector"]') && /nmclient/.test(await main.textContent('[data-testid="nm-inspector"] h3')), 'the inspector shows the selected app');

  // Search and filters.
  await main.fill('[data-testid="nm-search"]', 'nothing-like-this');
  check(!!(await until(() => main.isVisible('[data-testid="nm-empty"]'), 4000)), 'a search with no match shows a designed empty state');
  await main.fill('[data-testid="nm-search"]', '8443');
  check(!!(await until(() => row.count(), 4000)), 'search finds the client by port');
  await main.fill('[data-testid="nm-search"]', '');
  await main.click('[data-testid="nm-filter-active"]');
  check(!!(await until(() => row.count(), 4000)), 'Active lists it (it is sending and receiving)');
  await main.click('[data-testid="nm-filter-all"]');

  await main.screenshot({ path: path.join(SHOTS, 'netmon-live-light.png') });

  // ---------------------------------------------------------------- a Block rule
  await main.click('[data-testid="nm-verdict"] button:has-text("Block")');
  const st = await until(async () => { const s = await fw('status'); return s.state.groups[0].rules.find((r) => r.verdict === 'deny' && r.app.path && /node|nmclient/.test(r.app.path) && !r.host) ? s : undefined; }, 6000);
  const rule = st?.state.groups[0].rules.find((r) => r.verdict === 'deny' && !r.host);
  check(!!rule, `Block makes a deny rule for the app (${rule?.app.path})`);
  check(!!st && st.enforcement.active && /applied/i.test(st.enforcement.message ?? ''), `and the rules are applied (${st?.enforcement.message})`);
  const blocked = await until(async () => /Blocked/.test(await host.locator('.nm-chip').textContent()), 8000);
  check(!!blocked, 'the connection now shows as Blocked');
  await main.click('[data-testid="nm-filter-blocked"]');
  check(!!(await until(() => row.count(), 4000)), 'and is under Blocked');
  await main.click('[data-testid="nm-filter-all"]');
  await main.click('[data-testid="nm-verdict"] button:has-text("Follow rules")');
  const undone = await until(async () => !(await fw('status')).state.groups[0].rules.some((r) => r.id === rule?.id), 6000);
  check(!!undone, 'Follow rules takes the block away again (undo)');

  // ---------------------------------------------------------------- the Ask prompt
  await fw('setSettings', { alerts: true });
  await fw('setMode', 'alert');
  await fw('testInject', { ip: '203.0.113.50', host: 'telemetry.test', port: 443, app: { path: '/usr/bin/curl' } });
  await fw('testInject', { ip: '203.0.113.51', host: 'cdn.test', port: 443, app: { path: '/usr/bin/curl' } });
  let ask;
  for (let i = 0; i < 240 && !ask; i++) { ask = app.windows().find((w) => w.url().includes('view=netask')); if (!ask) await wait(250); }
  check(!!ask, 'a new connection opens the small Ask window');
  if (ask) {
    ask.on('pageerror', (e) => errors.push(`ask: ${e.message}`));
    await ask.waitForSelector('[data-testid="nm-ask"]', { timeout: 10_000 });
    const focus = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=netask')); return { visible: w?.isVisible(), focused: w?.isFocused() }; });
    check(focus.visible && !focus.focused, 'it shows without taking the keyboard');
    // Other programs on this computer may be waiting too: go to curl's prompt.
    for (let i = 0; i < 8 && !/curl wants/.test(await ask.textContent('[data-testid="nm-ask"]')); i++) await ask.click('[aria-label="Next app"]').catch(() => undefined);
    const text = await ask.textContent('[data-testid="nm-ask"]');
    check(/curl wants to connect/.test(text) && /telemetry\.test/.test(text) && /cdn\.test/.test(text), 'one prompt for the app, with both places (batched)');
    check(/usage or crash reports/.test(text), `it says why it may be connecting ("${text.match(/(Looks like[^.]*\.|Probably[^.]*\.|A [^.]*\.)/)?.[0]}")`);
    await wait(400);
    await ask.screenshot({ path: path.join(SHOTS, 'netmon-ask-light.png') });
    // The same prompt in the page, from the waiting pill.
    check(!!(await until(() => main.isVisible('[data-testid="nm-waiting-pill"]'), 4000)), 'the page shows “1 waiting”');
    await main.click('[data-testid="nm-waiting-pill"]');
    check(!!(await until(() => main.isVisible('[data-testid="nm-sheet"]'), 4000)), 'which opens the prompt over the page');
    await main.screenshot({ path: path.join(SHOTS, 'netmon-asksheet-light.png') });
    await main.keyboard.press('Escape');
    await ask.click('[data-testid="nm-ask-deny"]');
    const answered = await until(async () => { const s = await fw('status'); return !s.pending.some((a) => a.conn.app.path === '/usr/bin/curl') && s.state.groups[0].rules.filter((r) => r.verdict === 'deny' && /telemetry\.test|cdn\.test/.test(r.host ?? '')).length === 2 ? s : undefined; }, 6000);
    check(!!answered, 'Deny answers both places with one rule each, applied once');
    const next = await until(async () => { const vis = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=netask'))?.isVisible()); if (!vis) return 'closed'; const t = await ask.textContent('[data-testid="nm-ask"]').catch(() => ''); return t && !/curl wants/.test(t) ? 'next app' : undefined; }, 5000);
    check(!!next, `and the window moves on (${next})`);
  }

  // ---------------------------------------------------------------- where data goes and history
  await main.click('[data-testid="nm-tab-where"]');
  await main.waitForSelector('[data-testid="nm-where-title"]', { timeout: 8000 });
  check(true, `where your data goes: "${(await main.textContent('[data-testid="nm-where-title"]'))?.trim()}"`);
  await wait(400);
  await main.screenshot({ path: path.join(SHOTS, 'netmon-where-light.png') });
  await main.click('[data-testid="nm-tab-history"]');
  await main.waitForSelector('.nm-history', { timeout: 8000 });
  check(true, 'the history tab renders');
  await main.click('[data-testid="nm-tab-live"]');

  // ---------------------------------------------------------------- the menu bar
  const glWin = () => app.windows().find((w) => w.url().includes('view=glance'));
  await main.evaluate(() => window.keeper.glance.show());
  let g;
  for (let i = 0; i < 40 && !g; i++) { g = glWin(); if (!g) await wait(250); }
  check(!!g, 'the menu-bar summary opens');
  g.on('pageerror', (e) => errors.push(`glance: ${e.message}`));
  const net = await until(() => g.isVisible('[data-testid="glance-network"]'), 15_000);
  check(!!net, 'it has the Network part');
  const line = await until(async () => { const t = await g.textContent('[data-testid="glance-net-line"]'); return /\d+ apps? online/.test(t) ? t : undefined; }, 10_000);
  check(!!line, `with one line: "${line?.trim()}"`);
  const top = await until(async () => { const t = await g.$$eval('[data-testid="glance-net-app"]', (els) => els.map((e) => e.querySelector('.gl-net-name').textContent)); return t.includes('nmclient') ? t : undefined; }, 10_000);
  check(!!top && top.length <= 3, `the busiest apps, at most three (${top?.join(', ')})`);
  check(await g.locator('[data-testid="glance-net-app"]', { hasText: 'nmclient' }).locator('[data-testid="glance-net-block"]').count() === 1, 'each with a quick Block (this computer can block single apps)');
  const scroll = await g.evaluate(() => { const el = document.querySelector('.glance'); const d = document.scrollingElement; return { h: el.scrollHeight, ch: el.clientHeight, w: el.scrollWidth, cw: el.clientWidth, dh: d.scrollHeight, dch: d.clientHeight }; });
  check(scroll.h <= scroll.ch && scroll.w <= scroll.cw && scroll.dh <= scroll.dch, `the summary does not scroll (${scroll.h}/${scroll.ch})`);
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('view=glance'))?.getBounds());
  check(!!bounds && bounds.height <= 900, `it fits on the screen (${bounds?.width}×${bounds?.height})`);
  await wait(600);
  await g.screenshot({ path: path.join(SHOTS, 'netmon-popover-light.png') });
  await g.locator('[data-testid="glance-net-app"]', { hasText: 'nmclient' }).locator('[data-testid="glance-net-block"]').click();
  const gr = await until(async () => (await fw('status')).state.groups[0].rules.find((r) => r.verdict === 'deny' && !r.host && /node|nmclient/.test(r.app.path ?? '')), 6000);
  check(!!gr, 'Block in the menu bar makes the same deny rule');
  await g.locator('[data-testid="glance-net-app"]', { hasText: 'nmclient' }).locator('[data-testid="glance-net-block"]').click().catch(() => undefined);
  const gu = await until(async () => !(await fw('status')).state.groups[0].rules.some((r) => r.id === gr?.id), 6000);
  check(!!gu, 'and Allow takes it away again');

  // Settings → Menu bar has the switch.
  await main.evaluate(() => window.keeper.glance.setSettings({ sections: { stats: true, network: false, actions: true, downloads: true } }));
  await wait(2500);
  check(!(await g.isVisible('[data-testid="glance-network"]').catch(() => false)), 'Show network off hides the part');
  await main.evaluate(() => window.keeper.glance.setSettings({ sections: { stats: true, network: true, actions: true, downloads: true } }));
  await main.evaluate(() => window.dispatchEvent(new CustomEvent('keeper:go', { detail: 'settings:menubar' })));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=app')); w.webContents.send('event:navigate', 'settings:menubar'); });
  const sw = await until(() => main.getByText('Show network', { exact: true }).count(), 8000);
  check(!!sw, 'Settings → Menu bar has “Show network”');

  // ---------------------------------------------------------------- dark
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await main.click('.sidebar [title="Privacy & Security"]');
  await main.click('[data-testid="hub-tab-firewall"]');
  await main.waitForSelector('[data-testid="nm-app"]', { timeout: 15_000 });
  await main.locator('[data-testid="nm-app"][data-app="nmclient"] .nm-app').click().catch(() => undefined);
  await wait(4500);
  await main.screenshot({ path: path.join(SHOTS, 'netmon-live-dark.png') });
  await main.setViewportSize({ width: 1024, height: 768 }).catch(() => undefined);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=app')); w.setSize(1024, 768); });
  await wait(800);
  await main.screenshot({ path: path.join(SHOTS, 'netmon-live-1024-dark.png') });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=app')); w.setSize(1440, 900); });
  await main.click('[data-testid="nm-tab-where"]');
  await wait(800);
  await main.screenshot({ path: path.join(SHOTS, 'netmon-where-dark.png') });
  await main.click('[data-testid="nm-tab-live"]');
  await fw('testInject', { ip: '203.0.113.60', host: 'updates.example.test', port: 443, app: { path: '/usr/bin/wget' } });
  let ask2;
  for (let i = 0; i < 240; i++) { ask2 = app.windows().find((w) => w.url().includes('view=netask')); const vis = ask2 && await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=netask'))?.isVisible()); if (vis) break; await wait(250); }
  if (ask2) {
    await ask2.waitForSelector('[data-testid="nm-ask"]', { timeout: 10_000 }).catch(() => undefined);
    await wait(500);
    await ask2.screenshot({ path: path.join(SHOTS, 'netmon-ask-dark.png') });
    await ask2.click('[data-testid="nm-ask-later"]');
    check(!!(await until(async () => !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=netask'))?.isVisible())), 5000)), 'Later puts the prompt away (it stays on the page)');
  } else check(false, 'the Ask window opens again in dark');
  await main.evaluate(() => window.keeper.glance.show());
  await wait(3000);
  const g2 = glWin();
  if (g2) await g2.screenshot({ path: path.join(SHOTS, 'netmon-popover-dark.png') });

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close().catch(() => undefined);
  cleanup();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); cleanup(); process.exit(1); });
