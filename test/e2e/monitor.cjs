// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/monitor.cjs /tmp/kmon /tmp/kmon-shots
// Drives the real Keeper app's system monitor on Linux:
//   - no live readings run while nothing looks (zero cost when off)
//   - Health → History records a point a minute and draws charts
//   - a dev server in a git project is grouped under that project; restart and stop work
//   - a running agent is detected with what it started, and quitting the session ends it all
//   - the inspector shows parents, ports and a hidden environment (secrets need a second step)
//   - AI abilities refuse processes working in a protected folder
//   - menu-bar readings: combined and one-per-reading items, pictures, then none when off
//   - the pop-over, the tool launcher and a single-tool window
//   - the keeper CLI: ps, ports, dev, kill
// Screenshots in light and dark.
const { _electron } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const HOME = fs.realpathSync(fs.mkdirSync(path.resolve(process.argv[2] || '/tmp/kmon'), { recursive: true }) || path.resolve(process.argv[2] || '/tmp/kmon'));
const SHOTS = path.resolve(process.argv[3] || '/tmp/kmon-shots');
const APP = path.resolve(__dirname, '../..');
for (const f of fs.readdirSync(HOME)) fs.rmSync(path.join(HOME, f), { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10_000, step = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await wait(step);
  }
}
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

(async () => {
  // A project with a git folder and a dev server in it.
  const proj = path.join(HOME, 'code', 'shopfront');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'web'), { recursive: true });
  const port = await freePort();
  fs.writeFileSync(path.join(proj, 'web', 'server.js'), `require('http').createServer((q, r) => r.end('hi')).listen(${port}, '127.0.0.1');`);
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(proj, 'web'), stdio: 'ignore', detached: true, env: { ...process.env, SHOP_API_TOKEN: 'tok-123', SHOP_MODE: 'dev' } });
  server.unref();
  // A pretend coding agent (named like one) that starts a helper.
  const bin = path.join(HOME, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'aider'), '#!/bin/sh\nsleep 300 &\nwait\n', { mode: 0o755 });
  const agent = spawn(path.join(bin, 'aider'), [], { cwd: proj, stdio: 'ignore', detached: true });
  agent.unref();

  // Stand-ins for Docker and PipeWire's pactl, so the real code paths run against known answers.
  const log = path.join(HOME, 'fake-calls.log');
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
echo "docker $*" >> '${log}'
case "$1" in
  version) echo 27.0.1 ;;
  ps) echo '{"ID":"a1b2c3d4e5f6","Names":"shop-db","Image":"postgres:16","State":"running","Status":"Up 2 hours","Ports":"5432/tcp"}'; echo '{"ID":"b2c3d4e5f6a7","Names":"old-job","Image":"node:22","State":"exited","Status":"Exited (0) 2 days ago","Ports":""}' ;;
  stats) echo '{"ID":"a1b2c3d4e5f6","CPUPerc":"3.50%","MemUsage":"180MiB / 7.6GiB","NetIO":"1.2MB / 300kB","BlockIO":"40MB / 12MB","PIDs":"14"}' ;;
  system) echo '{"Type":"Images","TotalCount":"7","Active":"2","Size":"3.2GB","Reclaimable":"1.1GB (34%)"}' ;;
  restart|stop|start|pause|unpause) echo "$2" ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'pactl'), `#!/bin/sh
echo "pactl $*" >> '${log}'
case "$1 $2" in
  "list sink-inputs") printf 'Sink Input #41\n\tMute: no\n\tVolume: front-left: 52428 /  80%% / -5.81 dB\n\tProperties:\n\t\tapplication.name = "Music Player"\n\t\tapplication.process.id = "4242"\n' ;;
  "list short") printf '47\talsa_output.analog\tPipeWire\n52\tbluez_output.AA\tPipeWire\n' ;;
  "list sinks") printf 'Sink #47\n\tName: alsa_output.analog\n\tDescription: Built-in Audio\n' ;;
  "get-default-sink ") echo alsa_output.analog ;;
esac
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' };
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  const errors = [];
  let main;
  for (let i = 0; i < 80 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    if (!main) await wait(500);
  }
  check(!!main, 'Keeper opens');
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await wait(2500);
  await main.locator('.tour button:has-text("Skip tour")').click({ timeout: 3000 }).catch(() => undefined);
  await main.setViewportSize?.({ width: 1440, height: 900 }).catch(() => undefined);
  const sm = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.sysmon[f](...args), [fn, a]);
  const liveChecks = () => main.evaluate(() => window.keeper.usage.get().then((u) => u.checks.filter((c) => c.name === 'monitor-live' && c.everyMs !== null).length));
  const tab = async (label) => { await main.locator(`.health-tabs button:has-text("${label}")`).first().click(); await wait(800); };

  // ---- nothing runs while nothing looks
  check(await liveChecks() === 0, 'no live readings run while no monitor view or menu-bar reading is shown');

  // ---- Health overview with live tiles, then the tabs
  await main.locator('.sidebar >> text=Health').first().click();
  await main.waitForSelector('.health-tabs');
  const tiles = await until(async () => (await main.locator('.mon-tile').count()) >= 4, 8000);
  check(!!tiles, 'Health shows live tiles with sparklines');
  check(await liveChecks() === 1, 'live readings run while Health is on screen');
  await main.screenshot({ path: path.join(SHOTS, 'health-overview-light.png') });

  // ---- history: a point a minute after the first look
  const hist = await until(async () => { const v = await sm('history', Date.now() - 3600_000, Date.now(), 120); return v.points.length ? v : null; }, 20_000, 1000);
  check(!!hist, `history records points (${hist?.points.length ?? 0} in the last hour, ${hist?.tier})`);
  check(hist && hist.points.some((p) => Number.isFinite(p.netIn)), 'history points carry network counters');
  await tab('History');
  await main.waitForSelector('.mon-chart');
  check(await main.locator('.mon-chart').count() >= 2, 'History draws charts');
  await main.screenshot({ path: path.join(SHOTS, 'health-history-light.png') });

  // ---- dev servers grouped by project
  const dev = await until(async () => { const r = await sm('devServers'); return r.projects.find((p) => p.name === 'shopfront') ? r : null; }, 10_000);
  const group = dev?.projects.find((p) => p.name === 'shopfront');
  check(!!group && group.root === proj, `the server on port ${port} is grouped under its git root (${group?.root})`);
  const srv = group?.servers.find((s) => s.port === port);
  check(srv?.kind === 'Node.js' && srv.url === `http://127.0.0.1:${port}`, `it is recognised as ${srv?.kind} with a link`);
  await tab('Dev & agents');
  await main.waitForSelector('.mon-project');
  check(await main.locator('.mon-project h3:has-text("shopfront")').count() === 1, 'Dev & agents lists the project');

  // ---- running agents
  const agents = await until(async () => { const a = await sm('agents'); return a.find((x) => x.id === 'aider') ? a : null; });
  const ai = agents?.find((x) => x.id === 'aider');
  check(!!ai && ai.pids.length >= 2 && ai.project === 'shopfront', `the agent is found with what it started (${ai?.pids.length} processes, project ${ai?.project})`);
  await main.screenshot({ path: path.join(SHOTS, 'health-dev-light.png') });

  // ---- inspector extras
  const x = await sm('procExtras', server.pid);
  check(x && x.parents.length >= 1 && x.ports.includes(port), `inspector: parents (${x?.parents.map((p) => p.name).join(' ← ')}) and listening port`);
  const tokenHidden = x?.env?.find((e) => e.name === 'SHOP_API_TOKEN');
  check(tokenHidden && tokenHidden.value === undefined && tokenHidden.secret, 'the environment hides a token by default');
  const shown = await sm('procExtras', server.pid, { reveal: true, signature: false });
  check(shown.env.find((e) => e.name === 'SHOP_MODE')?.value === 'dev' && shown.env.find((e) => e.name === 'SHOP_API_TOKEN')?.value === undefined, 'showing values still hides secrets');
  const all = await sm('procExtras', server.pid, { reveal: true, revealSecrets: true, signature: false });
  check(all.env.find((e) => e.name === 'SHOP_API_TOKEN')?.value === 'tok-123', 'secrets show only after the second step');
  check(!!x?.signature && x.signature.source === 'package', `Linux says where the program came from (${x?.signature?.signer ?? x?.signature?.note})`);

  // ---- abilities refuse protected folders
  await sm('setSettings', { protectedFolders: [proj] });
  // Allowed without a question for this check, so the refusal comes from the protected folder itself.
  await main.evaluate(async () => { const a = await window.keeper.abilities.settings(); await window.keeper.abilities.save({ ...a, permissions: { ...a.permissions, process_control: 'allow' } }); });
  const refused = await main.evaluate((pid) => window.keeper.abilities.call('process_control', { pid, action: 'quit', reason: 'test' }), server.pid);
  check(refused.isError && /protected/.test(refused.content) && alive(server.pid), `an AI cannot stop a process working in a protected folder (${refused.content})`);
  await sm('setSettings', { protectedFolders: [] });
  const ra = await main.evaluate(() => window.keeper.abilities.call('running_agents', {}));
  check(!ra.isError && /Aider/.test(ra.content), 'the running_agents ability lists the agent');

  // ---- restart and stop
  const rs = await sm('restartServer', server.pid);
  check(rs.ok, `restart: ${rs.message}`);
  const again = await until(async () => { const r = await sm('devServers'); const s = r.projects.flatMap((p) => p.servers).find((s) => s.port === port); return s && s.pid !== server.pid ? s : null; }, 10_000);
  check(!!again && !alive(server.pid), `the server came back on port ${port} as a new process (${again?.pid})`);
  const stop = await sm('stopProject', proj);
  check(stop.ok && !!again && !(await until(async () => alive(again.pid) ? null : true, 5000) === undefined), `stop project: ${stop.message}`);
  const st = await sm('stopAgentSession', ai.pid);
  const gone = await until(async () => (ai.pids.every((p) => !alive(p)) ? true : null), 5000);
  check(st.ok && !!gone, `quitting the agent session ends all ${ai.pids.length} processes`);

  // ---- sensors
  await tab('Sensors');
  await main.waitForSelector('.mon-tile');
  check(await main.locator('.mon-limits li').count() >= 1, 'Sensors explains what this computer does not show');
  await main.screenshot({ path: path.join(SHOTS, 'health-sensors-light.png') });

  // ---- containers (through a stand-in docker)
  const cv = await sm('containers');
  check(cv.engine === 'docker' && cv.containers[0]?.name === 'shop-db' && cv.containers[0].cpu === 3.5 && cv.disk[0]?.type === 'Images', `containers with live use and disk use (${cv.containers.length}, ${cv.disk.length} disk rows)`);
  await tab('Containers');
  await main.waitForSelector('text=shop-db');
  await main.screenshot({ path: path.join(SHOTS, 'health-containers-light.png') });
  const ca = await main.evaluate(async () => { const a = await window.keeper.abilities.settings(); await window.keeper.abilities.save({ ...a, permissions: { ...a.permissions, container_action: 'allow' } }); return window.keeper.abilities.call('container_action', { id: 'a1b2c3d4e5f6', action: 'restart', reason: 'test' }); });
  check(!ca.isError && fs.readFileSync(log, 'utf8').includes('docker restart a1b2c3d4e5f6'), `the container_action ability restarts a container (${ca.content})`);

  // ---- volume per app (through a stand-in pactl), tabs, energy note
  const mx = await sm('mixer');
  check(mx.supported && mx.streams[0]?.name === 'Music Player' && mx.streams[0].volume === 80 && mx.outputs.find((o) => o.default)?.name === 'Built-in Audio', 'the mixer lists apps playing sound and the output device');
  await sm('setStream', '41', { volume: 35, muted: true });
  const calls = fs.readFileSync(log, 'utf8');
  check(calls.includes('pactl set-sink-input-volume 41 35%') && calls.includes('pactl set-sink-input-mute 41 1'), 'volume and mute reach the sound server');
  await sm('setOutput', 'bluez_output.AA');
  check(fs.readFileSync(log, 'utf8').includes('pactl set-default-sink bluez_output.AA'), 'the output device can be switched');
  await tab('Sound & tabs');
  await main.waitForSelector('.mon-mix-row');
  check(await main.locator('.mon-mix-row').count() === 1, 'Sound & tabs shows the mixer');
  check((await sm('tabs')).linked === false && await main.locator('text=No browser is linked yet').count() === 1, 'browser tabs explain how to link a browser');
  check((await sm('energy')).supported === false, 'App Nap and energy impact are offered only on macOS');
  await main.screenshot({ path: path.join(SHOTS, 'health-sound-light.png') });

  // ---- processes: regex filter, pins, new and ended marks, CSV
  const marker = spawn('sleep', ['30'], { stdio: 'ignore', detached: true });
  marker.unref();
  await tab('Processes');
  await main.waitForSelector('.procs-table');
  await main.fill('.procs-bar input', '/^sle+p$/');
  const newMark = await until(async () => (await main.locator('.procs-table >> text=New').count()) > 0, 8000);
  check(!!newMark, 'a regex filter finds the new process, marked New');
  await main.locator('.procs-table [role="row"]:has-text("sleep")').first().click({ button: 'right' }).catch(() => undefined);
  await main.locator('text=Pin to Top').click({ timeout: 3000 }).catch(() => undefined);
  check(await main.evaluate(() => JSON.parse(localStorage.getItem('procs.pins') ?? '[]').includes('sleep')), 'a process can be pinned to the top');
  try { process.kill(marker.pid, 'SIGKILL'); } catch { /* gone */ }
  const endedMark = await until(async () => (await main.locator('.procs-ended:has-text("sleep")').count()) > 0, 10_000);
  check(!!endedMark, 'an ended process shows under Ended recently');
  await main.screenshot({ path: path.join(SHOTS, 'health-processes-light.png') });
  await main.fill('.procs-bar input', '');

  // ---- share card
  await tab('Overview');
  await main.locator('button:has-text("Share card")').click();
  const drawn = await until(async () => main.evaluate(() => { const c = document.querySelector('canvas.mon-share-preview'); return c && c.width === 1200 && c.toDataURL().length > 5000; }), 8000);
  check(!!drawn, 'the share card draws a 1200×630 picture of the readings');
  await main.screenshot({ path: path.join(SHOTS, 'share-card-light.png') });
  await main.keyboard.press('Escape');
  await main.locator('.modal button[aria-label="Close"], .modal .close').first().click({ timeout: 1000 }).catch(() => undefined);

  // ---- menu-bar readings
  await tab('Settings');
  await main.screenshot({ path: path.join(SHOTS, 'health-settings-light.png') });
  check((await sm('trayState')).items.length === 0, 'no menu-bar readings by default');
  await main.evaluate(() => window.keeper.features.set('monitorTray', true));
  await sm('setSettings', { surfaces: { tray: true, island: true, launcher: true }, tray: { metrics: ['cpu', 'mem', 'net'], layout: 'combined', style: 'both', intervalSec: 1, strainColor: true, netUnit: 'bytes', memShows: 'used', tempUnit: 'c' } });
  let ts = await until(async () => { const s = await sm('trayState'); return s.items.length && s.tooltips[0] ? s : null; }, 8000);
  check(ts?.items.join() === 'combined' && /Processor: \d+%/.test(ts.tooltips[0]), `one combined item with readings (${ts?.tooltips[0]?.replace(/\n/g, ' · ')})`);
  await sm('setSettings', { tray: { layout: 'separate' } });
  ts = await until(async () => { const s = await sm('trayState'); return s.items.length === 3 ? s : null; }, 5000);
  check(ts?.items.join() === 'cpu,mem,net', `one item per reading (${ts?.items.join(', ')})`);
  const pics = await sm('trayPreview');
  check(pics.length === 3 && pics.every((p) => p.image.startsWith('data:image/png') && p.image.length > 100), 'each item has a drawn picture');
  await wait(1200);
  await main.screenshot({ path: path.join(SHOTS, 'health-settings-tray-light.png') });

  // ---- the pop-over
  await sm('showPopover');
  const pop = await until(async () => app.windows().find((w) => w.url().includes('view=sysmon-popover')), 8000);
  check(!!pop, `the pop-over opens (${app.windows().map((w) => w.url().split('?')[1]).join(', ')})`);
  if (pop) {
    await pop.waitForSelector('.mon-pop .row-m', { timeout: 8000 }).catch(() => undefined);
    check(await pop.locator('.mon-pop .row-m').count() >= 3, 'the pop-over shows readings with sparklines');
    await pop.screenshot({ path: path.join(SHOTS, 'popover-light.png') });
  }

  await main.evaluate(() => window.keeper.features.set('monitorTray', false));
  ts = await until(async () => { const s = await sm('trayState'); return s.items.length === 0 ? s : null; }, 5000);
  check(!!ts, 'switching the feature off removes every menu-bar item');

  // ---- the tool launcher and a single-tool window
  const sc = (await sm('trayState')).launcherShortcut;
  check(typeof sc === 'string', `launcher shortcut registered: ${sc || '(taken by another app here)'}`);
  await sm('openLauncher');
  const launcher = await until(async () => app.windows().find((w) => w.url().includes('view=launcher')), 8000);
  check(!!launcher, 'the tool launcher opens');
  if (launcher) {
    await launcher.waitForSelector('.launch input');
    await launcher.fill('.launch input', 'json');
    await wait(300);
    check(/JSON formatter/.test(await launcher.locator('.launch li.on').innerText()), 'typing finds the tool');
    await launcher.screenshot({ path: path.join(SHOTS, 'launcher-light.png') });
    await launcher.press('.launch input', 'Enter');
  }
  const toolWin = await until(async () => app.windows().find((w) => w.url().includes('view=tool') && w.url().includes('json')), 10_000);
  check(!!toolWin, 'Enter opens the tool in its own window');
  if (toolWin) {
    await toolWin.waitForSelector('.toolwin .tool-panel', { timeout: 15_000 }).catch(() => undefined);
    check(await toolWin.locator('.toolwin .tool-panel').count() === 1 && (await toolWin.locator('.sidebar').count()) === 0, 'the window shows only that tool');
    await toolWin.screenshot({ path: path.join(SHOTS, 'toolwindow-light.png') });
  }
  check((await sm('recentTools'))[0] === 'toolbox:json', 'the launcher remembers it as recent');

  // ---- the CLI
  const cli = (args) => execFileSync(process.execPath, [path.join(APP, 'dist-cli/keeper.cjs'), ...args], { encoding: 'utf8', env: { ...process.env, HOME }, timeout: 30_000 });
  const ps = JSON.parse(cli(['ps', '--json', '--limit', '500']));
  check(ps.some((p) => p.pid === process.pid), `keeper ps lists processes (${ps.length})`);
  const sleeper = spawn('sleep', ['120'], { stdio: 'ignore', detached: true });
  sleeper.unref();
  await wait(300);
  JSON.parse(cli(['kill', String(sleeper.pid), '--suspend', '--yes', '--json']));
  check(/^T/.test(fs.readFileSync(`/proc/${sleeper.pid}/stat`, 'utf8').split(') ')[1] ?? ''), 'keeper kill --suspend pauses a process');
  JSON.parse(cli(['kill', String(sleeper.pid), '--force', '--yes', '--json']));
  check(!!(await until(async () => (alive(sleeper.pid) && !/^Z/.test(fs.readFileSync(`/proc/${sleeper.pid}/stat`, 'utf8').split(') ')[1] ?? '') ? null : true), 5000)), 'keeper kill --force ends it');
  const ports = JSON.parse(cli(['ports', '--json']));
  check(Array.isArray(ports), `keeper ports answers (${ports.length} listening)`);

  // ---- dark
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await wait(800);
  await main.bringToFront?.().catch(() => undefined);
  await tab('History');
  await main.waitForSelector('.mon-chart');
  await main.screenshot({ path: path.join(SHOTS, 'health-history-dark.png') });
  await tab('Dev & agents');
  await main.screenshot({ path: path.join(SHOTS, 'health-dev-dark.png') });
  await tab('Sensors');
  await main.screenshot({ path: path.join(SHOTS, 'health-sensors-dark.png') });
  await tab('Settings');
  await main.screenshot({ path: path.join(SHOTS, 'health-settings-dark.png') });
  await tab('Overview');
  await main.screenshot({ path: path.join(SHOTS, 'health-overview-dark.png') });
  await sm('openLauncher');
  const l2 = await until(async () => app.windows().find((w) => w.url().includes('view=launcher')), 5000);
  if (l2) { await wait(400); await l2.screenshot({ path: path.join(SHOTS, 'launcher-dark.png') }); }
  if (toolWin) await toolWin.screenshot({ path: path.join(SHOTS, 'toolwindow-dark.png') }).catch(() => undefined);
  await main.evaluate(() => window.keeper.features.set('monitorTray', true));
  await sm('setSettings', { tray: { layout: 'combined' } });
  await sm('showPopover');
  const p2 = await until(async () => app.windows().find((w) => w.url().includes('view=sysmon-popover')), 5000);
  if (p2) { await wait(1500); await p2.screenshot({ path: path.join(SHOTS, 'popover-dark.png') }); }

  // ---- leaving: no readings once nothing looks
  if (p2 && (await p2.evaluate(() => document.visibilityState).catch(() => 'hidden')) === 'visible') await sm('showPopover');
  await main.evaluate(() => window.keeper.features.set('monitorTray', false));
  await main.locator('.sidebar >> text=Settings').first().click().catch(() => undefined);
  await wait(1500);
  check(await liveChecks() === 0, 'live readings stop once no monitor view or menu-bar reading is shown');

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  for (const p of [server.pid, agent.pid, sleeper.pid]) { try { process.kill(-p, 'SIGKILL'); } catch { /* gone */ } }
  await app.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
