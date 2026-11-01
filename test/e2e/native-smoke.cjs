// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The packaged app on a real macOS or Windows machine, nothing that needs a
// permission prompt: it starts and reaches the main window, Settings opens and
// keeps a change, Keep Awake holds the computer awake the system's own way
// (caffeinate and pmset on macOS, SetThreadExecutionState and powercfg on
// Windows) and lets go, the monitor reads the processor, memory, processes and
// sensors, Stage reports what it can do and the screen sizes it can switch to,
// Remote Desktops builds the command for the system's own client (without
// starting it), and the `keeper` command reaches the running app through the
// app's own runtime, as the installers' shim runs it.
//
// CI only on macOS and Windows: it uses this account's real Keeper data folder
// and starts from an empty one.
//   node test/e2e/native-smoke.cjs [packaged executable] [shots folder]
// On Linux (any machine) it uses a throwaway home:
//   xvfb-run -a node test/e2e/native-smoke.cjs release/linux-unpacked/keeper /tmp/kns-shots
const { _electron } = (() => { try { return require('playwright-core'); } catch { return require('playwright'); } })();
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OS = process.platform;
const isMac = OS === 'darwin';
const isWin = OS === 'win32';
const SHOTS = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'keeper-native-shots'));
fs.mkdirSync(SHOTS, { recursive: true });

function packaged() {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  const rel = (p) => path.join(ROOT, 'release', p);
  const candidates = isMac ? ['mac-arm64/Keeper.app/Contents/MacOS/Keeper', 'mac/Keeper.app/Contents/MacOS/Keeper', 'mac-universal/Keeper.app/Contents/MacOS/Keeper']
    : isWin ? ['win-unpacked/Keeper.exe', 'win-arm64-unpacked/Keeper.exe'] : ['linux-unpacked/keeper', 'linux-arm64-unpacked/keeper'];
  const found = candidates.map(rel).find((p) => fs.existsSync(p));
  if (!found) throw new Error(`No packaged app in release/ (run npx electron-builder --dir first); looked for ${candidates.join(', ')}`);
  return found;
}
const EXE = packaged();
// The unpacked side of app.asar, where the keeper command lives.
const RESOURCES = isMac ? path.join(path.dirname(path.dirname(EXE)), 'Resources') : path.join(path.dirname(EXE), 'resources');
const CLI = path.join(RESOURCES, 'app.asar.unpacked', 'dist-cli', 'keeper.cjs');

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };
const info = (what) => console.log(`INFO ${what}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15_000, step = 300) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await wait(step);
  }
}
const sh = (file, args, timeout = 20_000) => { const r = spawnSync(file, args, { encoding: 'utf8', timeout, windowsHide: true }); return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };

// ---------------------------------------------------------------- a clean data folder
const env = { ...process.env, KEEPER_SKIP_TOUR: '1', NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: '' };
delete env.ELECTRON_RUN_AS_NODE;
let dataDir;
if (OS === 'linux') {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kns-')));
  for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(home, d), { recursive: true });
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share') });
  dataDir = path.join(home, '.config', 'Keeper');
} else {
  if (!process.env.CI) { console.error('This test empties Keeper\'s data folder for this account; it runs only on CI machines (CI=true).'); process.exit(2); }
  // The app's own folder (Electron's userData); the keeper command finds the app from the same place.
  dataDir = isMac ? path.join(os.homedir(), 'Library', 'Application Support', 'Keeper') : path.join(process.env.APPDATA, 'Keeper');
  fs.rmSync(dataDir, { recursive: true, force: true });
}

function cli(args, timeout = 30_000) {
  const r = spawnSync(EXE, [CLI, ...args], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout, windowsHide: true });
  const out = (r.stdout ?? '').trim();
  let json;
  try { json = JSON.parse(out); } catch { /* not JSON */ }
  return { code: r.status, out, err: (r.stderr ?? '').trim(), json };
}

(async () => {
  console.log(`Packaged app: ${EXE}`);
  const started = Date.now();
  const app = await _electron.launch({ executablePath: EXE, args: OS === 'linux' ? ['--no-sandbox'] : [], env, timeout: 90_000 });
  const errors = [];
  let main;
  for (let i = 0; i < 120 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (u.includes('view=app') || !u.includes('view=')); });
    if (!main) await wait(500);
  }
  check(!!main, 'the packaged app opens its main window');
  if (!main) throw new Error(`windows: ${app.windows().map((w) => w.url()).join(', ')}`);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 90_000 });
  check(true, `the main window is ready (${Math.round((Date.now() - started) / 1000)} s from launch)`);
  await main.getByRole('button', { name: /Skip tour/ }).click({ timeout: 3000 }).catch(() => undefined);
  await main.setViewportSize?.({ width: 1360, height: 900 }).catch(() => undefined);
  const k = (group, fn, ...a) => main.evaluate(([g, f, args]) => window.keeper[g][f](...args), [group, fn, a]);
  const mainPid = await app.evaluate(() => process.pid);
  const packagedFlag = await app.evaluate(({ app: a }) => a.isPackaged);
  check(packagedFlag, `Electron knows it is the packaged app (main process ${mainPid})`);
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  check(path.resolve(userData).toLowerCase() === path.resolve(dataDir).toLowerCase(), `the data folder is where the keeper command looks (${userData})`);
  await main.screenshot({ path: path.join(SHOTS, `${OS}-start.png`) });

  // ---------------------------------------------------------------- settings
  const before = await k('settings', 'get');
  check(before && typeof before === 'object', 'settings load');
  await k('settings', 'set', { appearance: 'dark' });
  const after = await k('settings', 'get');
  check(after.appearance === 'dark', 'a settings change is kept');
  await until(async () => fs.existsSync(path.join(dataDir, 'settings.json')) || fs.readdirSync(dataDir).some((f) => /settings/i.test(f)), 5000);
  check(fs.existsSync(dataDir) && fs.readdirSync(dataDir).some((f) => /settings/i.test(f)), `and written to the data folder (${fs.existsSync(dataDir) ? fs.readdirSync(dataDir).filter((f) => /settings/i.test(f)).join(', ') : 'missing'})`);
  await main.locator('.sidebar [title="Settings"]').first().click();
  const platformSection = await until(async () => (await main.locator('#platform').count()) > 0, 15_000);
  check(platformSection, 'Settings opens, with "Works with your computer"');
  const integrations = await k('platform', 'list', true);
  check(Array.isArray(integrations) && integrations.length > 0, `system integrations offered here: ${integrations.filter((i) => i.available).map((i) => i.id).join(', ')}`);
  await main.screenshot({ path: path.join(SHOTS, `${OS}-settings.png`) });
  await k('settings', 'set', { appearance: before.appearance ?? 'system' });

  // ---------------------------------------------------------------- Keep Awake
  const aw = (fn, ...a) => k('awake', fn, ...a);
  let st = await aw('status');
  check(!st.on && st.holds.length === 0, 'Keep Awake is off at first, holding nothing');
  st = await aw('start', { until: Date.now() + 10 * 60_000 });
  st = await until(async () => { const s = await aw('status'); return s.on && s.holds.length >= (OS === 'linux' ? 1 : 2) ? s : null; }, 10_000);
  const sysHold = isMac ? 'caffeinate' : isWin ? 'SetThreadExecutionState' : 'systemd-inhibit';
  check(st?.on && st.holds.some((h) => h.startsWith('powerSaveBlocker')) && (OS === 'linux' || st.holds.includes(sysHold)), `turning it on holds the computer awake: ${st?.holds.join(', ')}`);
  if (isMac) {
    const out = await until(async () => { const r = sh('/usr/bin/pmset', ['-g', 'assertions']); return /caffeinate/.test(r.out) ? r.out : null; }, 8000);
    check(!!out, 'pmset -g assertions lists the caffeinate hold');
    check(!!out && /PreventUserIdleDisplaySleep/.test(out), 'and the display is kept on');
  } else if (isWin) {
    const r = await until(async () => { const x = sh('powercfg', ['/requests']); return /powershell/i.test(x.out) ? x : null; }, 15_000);
    if (r) check(/DISPLAY:[\s\S]*powershell/i.test(r.out), 'powercfg /requests lists the hold for the display');
    else { const x = sh('powercfg', ['/requests']); check(/administrator/i.test(x.out), `powercfg /requests lists the hold (or needs an administrator): ${x.out.trim().slice(0, 400)}`); }
  }
  const b = await aw('blockers');
  check(b && typeof b.source === 'string' && Array.isArray(b.list), `"What keeps this computer awake" answers from ${b?.source}: ${b?.list.map((x) => `${x.who} (${x.what})`).join(', ') || 'none'}${b?.error ? ` · ${b.error}` : ''}`);
  if (isMac || isWin) check(b.list.some((x) => /caffeinate|powershell|keeper|electron/i.test(x.who)), 'and Keeper\'s own hold is in that list');
  await aw('stop');
  st = await until(async () => { const s = await aw('status'); return !s.on && s.holds.length === 0 ? s : null; }, 10_000);
  check(!!st, 'turning it off releases every hold');
  if (isMac) {
    const gone = await until(async () => !/caffeinate/.test(sh('/usr/bin/pmset', ['-g', 'assertions']).out), 8000);
    check(gone, 'and caffeinate is gone from pmset');
  } else if (isWin) {
    const gone = await until(async () => { const x = sh('powercfg', ['/requests']); return /administrator/i.test(x.out) || !/powershell/i.test(x.out); }, 15_000);
    check(gone, 'and the hold is gone from powercfg /requests');
  }

  // ---------------------------------------------------------------- the monitor
  await k('sysmon', 'watch', true);
  const live = await until(async () => { const l = await k('sysmon', 'live'); return l.latest && l.recent.length >= 2 ? l : null; }, 20_000);
  const r = live?.latest;
  check(r && Number.isFinite(r.cpu) && r.cpu >= 0 && r.cpu <= 100 && r.memTotal > 0 && r.memUsed > 0 && r.memUsed <= r.memTotal, `live readings: processor ${r?.cpu?.toFixed(1)}%, memory ${r && Math.round(r.memUsed / 2 ** 20)} of ${r && Math.round(r.memTotal / 2 ** 20)} MB, network in ${r?.netIn}, disk read ${r?.diskR}`);
  check(r && (r.netIn === undefined || r.netIn >= 0) && (r.diskR === undefined || r.diskR >= 0), 'network and disk rates are never negative');
  await k('sysmon', 'watch', false);
  const s = await k('procs', 'sample');
  const me = s.procs.find((p) => p.pid === mainPid);
  check(s.procs.length > 10 && me, `processes: ${s.procs.length}, including Keeper (${me?.name}, ${me && Math.round(me.memory / 2 ** 20)} MB)`);
  check(s.system.memTotal > 0 && s.system.perCore.length === os.cpus().length, `system totals and ${s.system.perCore.length} cores`);
  const sensors = await k('sysmon', 'sensors');
  check(sensors && Array.isArray(sensors.gpus) && Array.isArray(sensors.fans) && Array.isArray(sensors.temps), `sensors: ${sensors.gpus.length} graphics, ${sensors.fans.length} fans, ${sensors.temps.length} temperatures; ${sensors.limits.join(' ')}`);
  if (isMac) {
    const e = await k('sysmon', 'energy');
    check(e.supported && e.rows.length > 0, `energy impact: ${e.rows.slice(0, 4).map((x) => `${x.name} ${x.power}`).join(', ')}`);
  }
  if (isWin) {
    const mx = await k('sysmon', 'mixer');
    check(mx && Array.isArray(mx.streams), `volume mixer answers (supported: ${mx?.supported}, ${mx?.streams.length} streams; CI machines usually have no sound device)`);
  }
  const dev = await k('sysmon', 'devServers', true).catch((e) => ({ error: e.message }));
  check(dev && !dev.error && Array.isArray(dev.projects), `dev servers answer (listening ports with their folders): ${dev?.projects?.length ?? dev?.error} projects`);

  // ---------------------------------------------------------------- Stage, without starting it
  const support = await k('stage', 'support');
  check(Array.isArray(support) && support.length > 5, `Stage knows how each switch works here: ${support.filter((x) => x.how !== 'none' && x.how !== 'no').length} of ${support.length}`);
  const modes = await k('stage', 'modes');
  check(Array.isArray(modes) && (OS === 'linux' || (modes.length > 0 && modes.some((m) => m.current))), `screen sizes Stage can switch to: ${modes.length}, now ${JSON.stringify(modes.find((m) => m.current))}${isMac ? ' (from the macOS helper inside the app)' : ''}`);
  const detect = await k('stage', 'detect');
  check(detect && typeof detect === 'object', `capture detection answers: ${JSON.stringify(detect).slice(0, 200)}`);
  const apps = await k('stage', 'apps');
  check(Array.isArray(apps), `running apps for the hide list: ${apps.slice(0, 8).join(', ')}`);
  const sst = await k('stage', 'status');
  check(!sst.on, 'Stage stays off');

  // ---------------------------------------------------------------- Remote Desktops: the command, not the launch
  const rdp = await k('rdc', 'save', { name: 'Office PC', protocol: 'rdp', host: 'office-pc.example', user: 'ana', rdp: { multimon: true } });
  const cmd = await k('rdc', 'command', rdp.id);
  console.log('     ', cmd && (cmd.error ?? [cmd.file, ...cmd.args].join(' ')));
  if (isWin) check(cmd && /mstsc\.exe$/i.test(cmd.file) && /\.rdp$/i.test(cmd.args[0]) && cmd.args.includes('/multimon') && cmd.files.length === 1, 'RDP opens in Remote Desktop Connection (mstsc) with a temporary .rdp file and /multimon');
  else if (isMac) check(cmd && ((cmd.file === '/usr/bin/open' && /\.rdp$/.test(cmd.args[0])) || /freerdp/i.test(cmd.file ?? '')), 'RDP opens in the Mac\'s Remote Desktop app with a temporary .rdp file');
  else check(cmd && (cmd.error || /freerdp/.test(cmd.file)), 'RDP uses FreeRDP on Linux (or says how to get it)');
  const vnc = await k('rdc', 'save', { name: 'Lab Mac', protocol: 'vnc', host: '192.0.2.10', port: 5900 });
  const vcmd = await k('rdc', 'command', vnc.id);
  console.log('     ', vcmd && (vcmd.error ?? [vcmd.file, ...vcmd.args].join(' ')));
  check(vcmd && (vcmd.error || vcmd.file || vcmd.engine), `VNC has a way in here (${vcmd?.engine ?? vcmd?.error})`);
  if (isMac) check(vcmd.file === '/usr/bin/open' && /^vnc:\/\/192\.0\.2\.10/.test(vcmd.args[0]), 'VNC opens in the Mac\'s Screen Sharing');
  const ssh = await k('rdc', 'save', { name: 'Build box', protocol: 'ssh', host: '192.0.2.20', user: 'ci' });
  const scmd = await k('rdc', 'command', ssh.id);
  console.log('     ', scmd && (scmd.error ?? [scmd.file, ...scmd.args].join(' ')));
  check(scmd && !scmd.error, `SSH has a command here (${scmd?.engine})`);
  for (const c of [rdp, vnc, ssh]) await k('rdc', 'remove', c.id);

  // ---------------------------------------------------------------- the keeper command, through the app's own runtime
  check(fs.existsSync(CLI), `the keeper command ships unpacked (${CLI})`);
  const ver = cli(['--version']);
  check(ver.code === 0 && /\d+\.\d+\.\d+/.test(ver.out), `keeper --version: ${ver.out || ver.err}`);
  const endpoint = path.join(dataDir, 'brain', 'endpoint.json');
  check(await until(async () => fs.existsSync(endpoint), 15_000), 'the app opened its channel for the keeper command');
  const on = cli(['awake', 'on', '--for', '5m', '--json']);
  check(on.code === 0 && on.json?.on, `keeper awake on reaches the app: ${on.out.slice(0, 200) || on.err}`);
  const status = cli(['awake', 'status', '--json']);
  check(status.json?.on && status.json.holds.length > 0, `keeper awake status: held by ${status.json?.holds?.join(', ')}`);
  const off = cli(['awake', 'off', '--json']);
  check(off.code === 0 && (await aw('status')).on === false, `keeper awake off: ${off.out.slice(0, 120) || off.err}`);
  const stageSupport = cli(['stage', 'support', '--json']);
  check(stageSupport.code === 0 && Array.isArray(stageSupport.json), `keeper stage support: ${stageSupport.json?.length ?? stageSupport.err}`);
  const disp = cli(['display', 'list', '--json'], 45_000);
  check(disp.code === 0, `keeper display list: ${disp.out.slice(0, 200) || disp.err}`);
  const ps = cli(['ps', '--json', '--limit', '5']);
  check(ps.code === 0 && Array.isArray(ps.json) && ps.json.length > 0, `keeper ps (standalone): ${ps.json?.map((p) => p.name).join(', ') ?? ps.err}`);
  const sens = cli(['sensors', '--json'], 45_000);
  check(sens.code === 0 && sens.json && Array.isArray(sens.json.gpus), `keeper sensors (standalone): ${sens.out.slice(0, 160) || sens.err}`);
  const prt = cli(['ports', '--json'], 45_000);
  check(prt.code === 0 && Array.isArray(prt.json), `keeper ports (standalone): ${prt.json?.length ?? prt.err} listening`);
  if (isWin) {
    const vol = cli(['volume', '--json'], 45_000);
    check(vol.code === 0 || /sound|audio|device/i.test(vol.err), `keeper volume: ${vol.out.slice(0, 160) || vol.err}`);
  }

  // ---------------------------------------------------------------- page errors, and a clean exit
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await main.screenshot({ path: path.join(SHOTS, `${OS}-end.png`) });
  await app.close();
  if (isMac) check(await until(async () => !/caffeinate.*-w/.test(sh('/bin/ps', ['-axo', 'command']).out), 8000), 'no caffeinate is left behind after Keeper quits');
  if (isWin) {
    const left = await until(async () => { const x = sh('tasklist', ['/FI', 'IMAGENAME eq Keeper.exe', '/NH']); return !/Keeper\.exe/i.test(x.out) ? true : null; }, 20_000);
    check(left, 'Keeper quits completely');
  }
  console.log(failures ? `${failures} checks failed` : 'All checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
