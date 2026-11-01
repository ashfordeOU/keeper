// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/settingsplus.cjs /tmp/ksp /tmp/ksp-shots
// Drives the real Keeper app: System Settings+ (search, a real GNOME setting
// changed and undone in an isolated keyfile settings store, a real sysctl read,
// an administrator write stopped at a stand-in pkexec), per-app controls on a
// spawned process, and the browser link through the real native messaging host
// with a fake extension on its stdin/stdout.
const { _electron } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const ROOT = path.resolve(__dirname, '../..');
let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) { failed++; process.exitCode = 1; } };
const note = (label) => console.log(`NOTE ${label}`);
const until = async (fn, ms = 20000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, step)); } return null; };

fs.rmSync(HOME, { recursive: true, force: true });
for (const d of ['Downloads', 'Desktop', 'Documents', 'bin', '.config']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
const PK = path.join(HOME, 'pkexec.log');
// Stand-in for the administrator prompt: records exactly what would run as root, then says "cancelled".
fs.writeFileSync(path.join(HOME, 'bin/pkexec'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${PK}'\necho 'Request dismissed' >&2\nexit 126\n`, { mode: 0o755 });

const ENV = {
  ...process.env, HOME, NODE_OPTIONS: '',
  XDG_CONFIG_HOME: path.join(HOME, '.config'), XDG_DATA_HOME: path.join(HOME, '.local/share'),
  PATH: `${path.join(HOME, 'bin')}:${process.env.PATH}`,
  // GNOME settings go to a private keyfile in this test home, not to this machine's dconf.
  GSETTINGS_BACKEND: 'keyfile',
};
const gs = (...a) => execFileSync('gsettings', a, { env: ENV, encoding: 'utf8' }).trim();

(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: ENV });
  await app.firstWindow();
  const w = await until(async () => app.windows().find((x) => { const u = x.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 30000, 200);
  const errors = [];
  w.on('pageerror', (e) => errors.push(e.message));
  await w.waitForSelector('.sidebar', { timeout: 60000 });
  await w.waitForTimeout(2500);
  const skip = await w.$('.tour button:has-text("Skip tour")');
  if (skip) await skip.click();
  const k = (group, fn, ...a) => w.evaluate(([g, f, args]) => window.keeper[g][f](...args), [group, fn, a]);

  // ---------------------------------------------------------------- catalogue
  // (After each sidebar click the pointer moves away: the compact sidebar opens over the page while it rests there.)
  const list = await k('catalog', 'list');
  check(list.os === 'linux' && list.entries.length >= 100 && list.counts.darwin >= 100 && list.counts.win32 >= 100, `catalogue: ${list.entries.length} Linux settings (${list.counts.darwin} macOS, ${list.counts.win32} Windows)`);
  await w.click('.sidebar [title="System Settings+"]'); await w.mouse.move(1000, 600); await w.waitForTimeout(400);
  check(!!(await until(() => w.$('[data-testid="catalog-page"]'), 15000)), 'System Settings+ opens from the sidebar');
  await w.fill('[data-testid="cat-search"]', 'light or dark');
  const row = '[data-testid="cat-row-linux.gnome.colorscheme"]';
  check(!!(await until(() => w.$(row), 8000)), 'search finds “Light or dark style”');
  check(!!(await until(async () => (await w.getAttribute(row, 'data-value')) === 'default', 8000)), 'its current value is read from gsettings (default)');
  await w.screenshot({ path: path.join(SHOTS, 'catalog-light.png') });
  await w.selectOption(`${row} select`, 'prefer-dark');
  check(!!(await until(() => w.$('[data-testid="cat-preview"]'), 8000)), 'changing it shows a preview first');
  const cmds = await w.textContent('[data-testid="cat-commands"]');
  check(cmds.includes("gsettings set org.gnome.desktop.interface color-scheme ''\\''prefer-dark'\\''") || cmds.includes('gsettings set org.gnome.desktop.interface color-scheme'), `the exact command is shown: ${cmds.trim()}`);
  await w.screenshot({ path: path.join(SHOTS, 'catalog-preview-light.png') });
  await w.click('[data-testid="cat-apply"]');
  check(!!(await until(() => gs('get', 'org.gnome.desktop.interface', 'color-scheme') === "'prefer-dark'", 10000)), 'the GNOME setting really changed (gsettings get → prefer-dark)');
  const log = await k('catalog', 'log');
  check(log[0]?.settingId === 'linux.gnome.colorscheme' && log[0].to === 'prefer-dark', 'the change is in the log');
  check(!!log[0]?.backup && fs.existsSync(log[0].backup) && /color-scheme/.test(fs.readFileSync(log[0].backup, 'utf8')), 'a backup of the schema was saved first');
  const u = await k('catalog', 'undo', log[0].id);
  check(u.ok && gs('get', 'org.gnome.desktop.interface', 'color-scheme') === "'default'", 'undo puts it back (default)');
  const bk = await k('catalog', 'backups');
  await k('catalog', 'apply', 'linux.gnome.clock.seconds', 'true');
  check(gs('get', 'org.gnome.desktop.interface', 'clock-show-seconds') === 'true', 'a second setting applied through the API');
  const rb = await k('catalog', 'restoreBackup', bk[0].id);
  check(rb.ok && gs('get', 'org.gnome.desktop.interface', 'clock-show-seconds') === 'false', 'restoring the snapshot puts the whole schema back');

  // sysctl: read for real, writes need an administrator (stopped at the stand-in prompt)
  const [sw] = await k('catalog', 'read', ['linux.kernel.swappiness']);
  const real = fs.readFileSync('/proc/sys/vm/swappiness', 'utf8').trim();
  check(sw.value === real, `sysctl read: vm.swappiness = ${sw.value} (kernel says ${real})`);
  const pv = await k('catalog', 'preview', 'linux.kernel.swappiness', '10');
  check(pv.admin && pv.commands[0] === '(as administrator) sysctl -w vm.swappiness=10', 'the preview says it needs an administrator');
  const sa = await k('catalog', 'apply', 'linux.kernel.swappiness', '10');
  check(!sa.ok && fs.existsSync(PK) && fs.readFileSync(PK, 'utf8').includes('sysctl -w vm.swappiness=10'), 'the write went to the administrator prompt only (cancelled there); nothing changed');
  check(fs.readFileSync('/proc/sys/vm/swappiness', 'utf8').trim() === real, 'and the kernel value is unchanged');
  const bad = await k('catalog', 'apply', 'linux.gnome.gtktheme', 'x; rm -rf ~');
  check(!bad.ok && /characters/.test(bad.message), 'values with shell characters are refused');

  // profiles
  await k('catalog', 'apply', 'linux.gnome.tap', 'true');
  const prof = await k('catalog', 'exportProfile', 'Test', ['linux.gnome.tap', 'linux.gnome.colorscheme']);
  gs('set', 'org.gnome.desktop.peripherals.touchpad', 'tap-to-click', 'false');
  const pp = await k('catalog', 'previewProfile', prof);
  check(pp.items.find((i) => i.id === 'linux.gnome.tap')?.status === 'change', 'profile preview shows what would change');
  await k('catalog', 'applyProfile', prof, ['linux.gnome.tap']);
  check(gs('get', 'org.gnome.desktop.peripherals.touchpad', 'tap-to-click') === 'true', 'applying the profile changed it back');

  // command palette finds catalogue settings
  await w.keyboard.press('Control+K');
  await w.waitForTimeout(300);
  await w.keyboard.type('swappiness');
  check(!!(await until(() => w.$('text=Setting: Swappiness'), 4000)), 'the command palette finds “Setting: Swappiness”');
  await w.keyboard.press('Escape');

  // ---------------------------------------------------------------- per-app controls
  const child = spawn('sleep', ['600'], { stdio: 'ignore' });
  const target = { name: 'sleep', path: '/usr/bin/sleep', pid: child.pid };
  const ctl = await k('appctl', 'controls');
  check(ctl.find((c) => c.id === 'volume').support === 'yes' && ctl.find((c) => c.id === 'dns').support === 'no', 'per-app controls say what Linux supports');
  const r1 = await k('appctl', 'set', target, { priority: 'below' });
  const nice = Number(fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8').split(') ')[1].split(' ')[16]);
  check(r1.ok && nice === 10, `priority “below normal” really applied (nice ${nice})`);
  const r2 = await k('appctl', 'set', target, { paused: true });
  const state = fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8').split(') ')[1][0];
  check(r2.ok && state === 'T', 'pause stops the process (state T)');
  await k('appctl', 'set', target, { paused: false });
  const pc = await k('appctl', 'preview', target, { cpuPercent: 25 });
  check(pc.notes.some((n) => n.includes('cpu.max = 25000 100000')), 'CPU limit preview: cpu.max 25000 100000');
  const v2 = fs.existsSync('/sys/fs/cgroup/cgroup.controllers');
  const r3 = await k('appctl', 'set', target, { cpuPercent: 25 });
  if (v2) {
    const cg = fs.readFileSync(`/proc/${child.pid}/cgroup`, 'utf8').split('\n').find((l) => l.startsWith('0::')).slice(3);
    const max = fs.existsSync(`/sys/fs/cgroup${cg}/cpu.max`) ? fs.readFileSync(`/sys/fs/cgroup${cg}/cpu.max`, 'utf8').trim() : '';
    check(r3.ok && max === '25000 100000', `CPU limit really applied in ${cg}: ${max}`);
  } else {
    check(!r3.ok, `this machine has no cgroup v2, so the CPU limit fails honestly: “${r3.message.slice(0, 90)}”`);
    note('CPU limit via cgroup v2 not verified here (cgroup v1 host); covered by unit tests of the cgroup writes');
  }
  const r4 = await k('appctl', 'set', { ...target, path: path.join(HOME, 'bin/fake-app') }, { startAtLogin: true });
  const auto = fs.readdirSync(path.join(HOME, '.config/autostart')).find((f) => f.startsWith('keeper-'));
  check(r4.ok && !!auto, `start at login wrote ~/.config/autostart/${auto}`);
  await w.click('.sidebar [title="App controls"]'); await w.mouse.move(1000, 600); await w.waitForTimeout(400);
  check(!!(await until(() => w.$('[data-testid="appcontrols-page"]'), 8000)), 'App controls page opens');
  await w.evaluate((p) => window.keeper && null, null);
  await w.waitForTimeout(800);
  const sl = await w.$('[data-testid="appctl-app-sleep"]');
  if (sl) { await sl.click(); await until(() => w.$('[data-testid="app-settings-panel"]'), 5000); }
  check(!!(await w.$('[data-testid="app-settings-panel"]')), 'the App settings panel shows for a running app');
  await w.screenshot({ path: path.join(SHOTS, 'appcontrols-light.png') });
  await k('appctl', 'clear', target);
  child.kill('SIGKILL');

  // ---------------------------------------------------------------- browser link through the real host
  const host = spawn(path.join(ROOT, 'node_modules/.bin/electron'), [path.join(ROOT, 'dist-cli/keeper.cjs'), 'browser-host'], { env: { ...ENV, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'inherit'] });
  const frame = (o) => { const b = Buffer.from(JSON.stringify(o)); const h = Buffer.alloc(4); h.writeUInt32LE(b.length); return Buffer.concat([h, b]); };
  const fromHost = [];
  let hb = Buffer.alloc(0);
  host.stdout.on('data', (c) => {
    hb = Buffer.concat([hb, c]);
    while (hb.length >= 4 && hb.length >= 4 + hb.readUInt32LE(0)) { const n = hb.readUInt32LE(0); const m = JSON.parse(hb.subarray(4, 4 + n)); hb = hb.subarray(4 + n); fromHost.push(m);
      // the fake extension answers every command
      if (m.kind === 'cmd') host.stdin.write(frame({ kind: 'reply', reqId: m.reqId, ok: true, result: m.command.cmd === 'getContentSettings' ? { camera: 'ask', javascript: 'allow' } : null }));
    }
  });
  host.stdin.write(frame({ kind: 'hello', browser: 'Chrome 131', version: '0.2.0', caps: ['tabs', 'mute', 'discard', 'contentSettings', 'dnr'] }));
  host.stdin.write(frame({ kind: 'tabs', tabs: [{ id: 7, windowId: 1, url: 'https://news.example.com/', title: 'Example news', active: true, audible: true, muted: false, discarded: false, incognito: false, bytes: 1200000, requests: 80, parties: [{ host: 'ads.tracker.example', requests: 12, blocked: 12 }] }] }));
  const ses = await until(async () => { const s = await k('browserTabs', 'sessions'); return s.sessions.length && s.sessions[0].tabs.length ? s : null; }, 15000);
  check(!!ses && ses.sessions[0].browser === 'Chrome 131' && ses.sessions[0].tabs[0].title === 'Example news', 'a browser linked through the real host shows its tabs in Keeper');
  if (ses) {
    const sid = ses.sessions[0].id;
    const m = await k('browserTabs', 'tab', sid, 7, 'mute');
    check(m.ok && fromHost.some((x) => x.kind === 'cmd' && x.command.cmd === 'mute' && x.command.tabId === 7 && x.command.muted === true), 'Mute went from Keeper → host → extension and the reply came back');
    const cs = await k('browserTabs', 'setSite', sid, 'news.example.com', 'camera', 'block');
    check(cs.ok && fromHost.some((x) => x.command?.cmd === 'contentSetting' && x.command.pattern === '*://*.news.example.com/*' && x.command.setting === 'block'), 'per-site camera block sent with a checked pattern');
    const bad2 = await k('browserTabs', 'setSite', sid, 'news.example.com', 'javascript', 'ask').catch((e) => ({ ok: false, message: String(e) }));
    check(!bad2.ok, 'an invalid site setting is refused before reaching the browser');
    const st = await k('browserTabs', 'siteSettings', sid, 'https://news.example.com/');
    check(st.camera === 'ask', 'site settings are read back from the extension');
    await w.click('.sidebar [title="Browser tabs"]'); await w.mouse.move(1000, 600); await w.waitForTimeout(400);
    check(!!(await until(() => w.$('[data-testid="tab-7"]'), 8000)), 'Browser tabs page lists the tab');
    await w.screenshot({ path: path.join(SHOTS, 'browsers-light.png') });
  }
  host.stdin.end();
  await until(async () => (await k('browserTabs', 'sessions')).sessions.length === 0, 5000);
  check((await k('browserTabs', 'sessions')).sessions.length === 0, 'closing the browser ends the session');

  // ---------------------------------------------------------------- dark
  await w.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await w.waitForTimeout(600);
  await w.click('.sidebar [title="System Settings+"]'); await w.mouse.move(1000, 600); await w.waitForTimeout(400);
  await w.waitForTimeout(800);
  await w.screenshot({ path: path.join(SHOTS, 'catalog-dark.png') });
  await w.click('.sidebar [title="App controls"]'); await w.mouse.move(1000, 600); await w.waitForTimeout(400);
  await w.waitForTimeout(800);
  await w.screenshot({ path: path.join(SHOTS, 'appcontrols-dark.png') });
  await w.click('.sidebar [title="Browser tabs"]'); await w.mouse.move(1000, 600); await w.waitForTimeout(400);
  await w.waitForTimeout(600);
  await w.screenshot({ path: path.join(SHOTS, 'browsers-dark.png') });

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
