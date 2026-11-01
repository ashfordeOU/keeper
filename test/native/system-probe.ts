// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Runs Keeper's own read-only commands against the real system and checks
// that its parsers make sense of what comes back: listening ports and
// connections, routes and interfaces, sensors (WMI battery and fans on
// Windows, ioreg on macOS), what keeps the computer awake (powercfg /requests,
// pmset -g assertions) while Keeper's own hold is in place, energy impact from
// top (macOS), the volume mixer (Windows, Core Audio through Add-Type) and
// every setting in the settings catalogue that can be read without an
// administrator (registry, powercfg, sc, defaults, pmset…). Nothing is changed.
//
// CI (macOS and Windows runners):
//   npx esbuild test/native/system-probe.ts --bundle --platform=node --format=cjs --outfile=dist-ci/system-probe.cjs
//   node dist-ci/system-probe.cjs
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { caffeinateArgs, parsePmsetAssertions, parsePowercfgRequests, windowsHoldScript } from '../../core/awake-engine';
import { parseAssertions } from '../../core/monitor-energy';
import { winMixerList } from '../../core/monitor-mixer';
import { powershell, run } from '../../core/platform';
import { catalogFor, parseRead, readCmd, type SettingDef } from '../../core/settings-catalog';
import { energy, mixer } from '../../electron/services/monitor-extras';
import { listeners, readSensors } from '../../electron/services/monitor-probe';
import { parseWinModes } from '../../core/stage/display';
import { planStage } from '../../core/stage/plan';
import { NO_SWITCHES } from '../../core/stage/presets';
import { parseRead as parseStageRead, readCmd as stageReadCmd, UNSET, winModesScript, writeCmds, type Cmd } from '../../core/stage/targets';
import type { StageOs } from '../../core/stage/types';
import { readConnections, readDns, readIfaces, readRoutes } from '../../electron/services/net/system';

const OS = process.platform;
let failures = 0;
const check = (ok: unknown, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const info = (what: string) => console.log(`INFO ${what}`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const compileError = (s: string) => /error CS\d+|Cannot add type|Add-Type : /i.test(s);

async function ports() {
  const server = net.createServer(() => undefined);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  const client = net.connect(port, '127.0.0.1');
  await new Promise((r) => client.once('connect', r));
  try {
    const l = await listeners();
    const mine = l.find((x) => x.port === port);
    check(mine && mine.pid === process.pid, `listening ports: ${l.length} found, including this test's port ${port} (pid ${mine?.pid}, ${mine?.name})`);
    const c = await readConnections();
    const conn = c.conns.find((x) => x.proto === 'TCP' && (x.localPort === port || x.remotePort === port) && x.state !== 'Listen');
    check(conn, `connections: ${c.conns.length} read (amounts per ${c.amounts}), including the test's own connection${conn ? ` ${conn.local}:${conn.localPort} → ${conn.remote}:${conn.remotePort} ${conn.state ?? ''} pid ${conn.pid ?? '?'}` : ''}`);
    for (const n of c.notes) info(n);
  } finally {
    client.destroy();
    server.close();
  }
}

async function network() {
  const r = await readRoutes(0);
  const def = r.routes.find((x) => x.prefix === 0);
  check(r.routes.length > 0 && def, `routes: ${r.routes.length}, default via ${def?.gateway ?? '?'} on ${def?.iface ?? '?'}`);
  const ifaces = await readIfaces(r.routes, r.descriptions);
  check(ifaces.some((i) => i.up && i.addresses.length), `interfaces: ${ifaces.map((i) => `${i.label ?? i.name}(${i.kind}${i.up ? '' : ', down'})`).join(', ')}`);
  const dns = await readDns();
  check(dns.length > 0, `DNS servers: ${dns.map((d) => d.address).join(', ')}`);
}

async function sensors() {
  const s = await readSensors();
  check(Array.isArray(s.gpus) && Array.isArray(s.fans) && Array.isArray(s.temps) && s.power && Array.isArray(s.power.source), `sensors answer: ${s.gpus.length} graphics, ${s.fans.length} fans, ${s.temps.length} temperatures, power ${JSON.stringify(s.power)}`);
  for (const l of s.limits) info(`sensors: ${l}`);
}

async function awakeHold() {
  let hold: ChildProcess | undefined;
  try {
    if (OS === 'darwin') {
      hold = spawn('/usr/bin/caffeinate', caffeinateArgs({ display: 'keep-on' }, process.pid), { stdio: 'ignore' });
      await wait(1500);
      const out = (await run('/usr/bin/pmset', ['-g', 'assertions'], 8000)).stdout;
      const list = parsePmsetAssertions(out);
      check(list.some((b) => b.who === 'caffeinate' && /PreventUserIdleDisplaySleep|PreventUserIdleSystemSleep/.test(b.what)), `pmset -g assertions shows Keeper's caffeinate hold: ${list.map((b) => `${b.who}:${b.what}`).join(', ')}`);
      const byPid = parseAssertions(out);
      check(hold.pid !== undefined && (byPid.get(hold.pid)?.length ?? 0) > 0, `the energy view links the hold to its process (${hold.pid}: ${byPid.get(hold.pid!)?.join('; ')})`);
    } else if (OS === 'win32') {
      const ps = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
      hold = spawn(ps, ['-NoProfile', '-NonInteractive', '-Command', windowsHoldScript({ display: 'keep-on' }, process.pid)], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      hold.stderr?.on('data', (d) => { err += d; });
      await wait(6000);
      check(!compileError(err) && hold.exitCode === null, `the Windows hold script runs and keeps running${err ? ` (stderr: ${err.trim().slice(0, 300)})` : ''}`);
      const r = await run('powercfg', ['/requests'], 15_000);
      const list = parsePowercfgRequests(r.stdout);
      if (!r.ok || /administrator/i.test(r.stdout + r.stderr)) info(`powercfg /requests needs an administrator here: ${(r.stdout + r.stderr).trim().slice(0, 200)}`);
      else {
        check(list.some((b) => /powershell/i.test(b.who) && b.what === 'display') && list.some((b) => /powershell/i.test(b.who) && b.what === 'system'), `powercfg /requests shows the hold for the display and the system: ${list.map((b) => `${b.what}:${b.who}`).join(', ')}`);
      }
    }
  } finally {
    hold?.kill();
  }
}

async function energyView() {
  if (OS !== 'darwin') return;
  const e = await energy();
  check(e.supported && e.rows.length > 0 && e.rows.every((r) => r.pid > 0 && r.name && Number.isFinite(r.power)), `energy impact from top: ${e.rows.slice(0, 5).map((r) => `${r.name} ${r.power}`).join(', ')}`);
}

async function volumeMixer() {
  if (OS !== 'win32') return;
  const raw = await powershell(winMixerList(), 30_000);
  check(!compileError(raw.stderr + raw.stdout), `the Core Audio mixer compiles and runs (ok: ${raw.ok}${raw.stderr ? `, stderr: ${raw.stderr.trim().slice(0, 300)}` : ''})`);
  const m = await mixer();
  info(`mixer: supported ${m.supported}, ${m.streams.length} streams ${m.streams.map((s) => `${s.name} ${s.volume}%`).join(', ')} (CI machines usually have no sound device)`);
}

/** Stage, planned with every switch on and nothing applied: each value it would change must be readable (that is what it puts back). */
async function stagePlan() {
  if (OS !== 'darwin' && OS !== 'win32') return;
  const switches = { ...NO_SWITCHES, hideDesktopIcons: true, hideDock: true, hideMenuBar: true, hideOtherApps: true, dnd: true, muteAlerts: true, pauseMusic: true, neutralCursor: true, keepAwake: true, cleanClipboard: true, hidePrivate: true, keepKeeperOut: true };
  const plan = planStage(switches, { os: OS as StageOs, desktop: '', wayland: false, tools: [], schemas: [], extensions: [] });
  check(plan.values.length > 0, `Stage plan: ${plan.values.length} values to change (${plan.values.map((v) => v.label).join(', ')}), actions ${plan.actions.join(', ')}${plan.skipped.length ? `, skipped ${plan.skipped.map((x) => x.switch).join(', ')}` : ''}`);
  const runCmd = (c: Cmd) => ('ps' in c ? powershell(c.ps, 25_000) : run(c.cmd, c.args, 25_000));
  for (const v of plan.values) {
    const r = await runCmd(stageReadCmd(v.target));
    const now = parseStageRead(v.target, r.ok, r.stdout);
    const writes = writeCmds(v.target, v.value);
    const line = `Stage reads "${v.label}" before changing it: ${now === null ? 'unreadable' : now === UNSET ? '(not set)' : now} → would set ${JSON.stringify(v.value)} with ${writes.length} command(s)`;
    // macOS reads the Dock and menu bar through System Events, which needs the Automation permission (not given on CI machines).
    if (v.target.t === 'mac-osa' && now === null) info(`${line} (needs Automation permission: ${r.stderr.trim().slice(0, 160)})`);
    else check(now !== null && writes.length > 0 && !compileError(r.stderr), `${line}${r.stderr && now === null ? ` (${r.stderr.trim().slice(0, 300)})` : ''}`);
  }
  if (OS === 'win32') {
    const r = await powershell(winModesScript(''), 30_000);
    const modes = parseWinModes(r.stdout);
    check(r.ok && modes.length > 0 && modes.some((m) => m.current), `screen sizes Stage can switch to: ${modes.length} (current ${JSON.stringify(modes.find((m) => m.current))})${r.ok ? '' : ` ${r.stderr.trim().slice(0, 300)}`}`);
  }
}

/** Read kinds whose value always exists, so "no value" means a wrong command or parser. */
const ALWAYS: Partial<Record<SettingDef['op']['t'], true>> = { pmset: true, powercfg: true, spctl: true, mdutil: true };

async function settingsCatalogue() {
  const os = OS === 'darwin' ? 'macos' : OS === 'win32' ? 'windows' : 'linux';
  const defs = catalogFor(os as SettingDef['os']);
  let read = 0;
  let set = 0;
  let skipped = 0;
  const missingTools = new Set<string>();
  for (const def of defs) {
    const cmd = readCmd(def.op);
    if (!cmd) { skipped++; continue; }
    if (cmd.file.startsWith('/') && !existsSync(cmd.file)) { missingTools.add(cmd.file); continue; }
    const r = await run(cmd.file, cmd.args, 15_000);
    let v: string | undefined;
    try {
      v = parseRead(def, r.stdout, r.ok);
    } catch (e) {
      check(false, `${def.id}: reading its value threw ${(e as Error).message}`);
      continue;
    }
    read++;
    if (v !== undefined) set++;
    const line = `${def.id} (${[cmd.file, ...cmd.args].join(' ')}) = ${v === undefined ? '(not set, system default)' : JSON.stringify(v)}`;
    if (ALWAYS[def.op.t]) check(v !== undefined, line);
    else if (def.op.t === 'service') check(v !== undefined || /does not exist|1060/i.test(r.stdout + r.stderr), line);
    else console.log(`     ${line}`);
  }
  check(missingTools.size === 0, `every tool the catalogue reads with exists${missingTools.size ? `; missing: ${[...missingTools].join(', ')}` : ''}`);
  check(read > 0, `settings catalogue: ${defs.length} ${os} settings, ${read} read (${set} set explicitly), ${skipped} need an administrator to read`);
}

(async () => {
  console.log(`System probe on ${OS} ${process.arch}, Node ${process.version}`);
  for (const [name, fn] of [['ports', ports], ['network', network], ['sensors', sensors], ['awake', awakeHold], ['energy', energyView], ['mixer', volumeMixer], ['stage', stagePlan], ['settings', settingsCatalogue]] as const) {
    try {
      await fn();
    } catch (e) {
      check(false, `${name} threw: ${(e as Error).stack ?? e}`);
    }
  }
  console.log(failures ? `${failures} system checks failed` : 'All system checks passed');
  process.exit(failures ? 1 : 0);
})();
