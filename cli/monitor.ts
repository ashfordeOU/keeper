// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// keeper ps | top | kill | ports | dev | sensors | history | process — the
// system monitor from a terminal, with the same readers as the app. Stopping
// anything needs --yes (or confirmation at the terminal). Everything takes --json.

import { createInterface } from 'node:readline/promises';
import { formatBytes, relativeTime } from '../core/format';
import { ancestors } from '../core/monitor-procinfo';
import { canEnd, groupByApp, type ProcRow } from '../core/procs';

type Flags = Record<string, string | boolean>;
type Out = (data: unknown, human: () => void) => void;

const tty = process.stdout.isTTY;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1');
const dim = c('2');
const red = c('31');
const yellow = c('33');
const green = c('32');

async function procs() {
  return import('../electron/services/procs');
}

/** Two readings a moment apart, so processor use is "now" rather than an average since start. */
async function sampleNow(ms = 700) {
  const p = await procs();
  await p.sample({ disk: true });
  await new Promise((r) => setTimeout(r, ms));
  return p.sample({ disk: true });
}

const pct = (v: number) => {
  const s = `${v.toFixed(1)}%`.padStart(7);
  return v >= 80 ? red(s) : v >= 30 ? yellow(s) : s;
};

function sortBy(rows: ProcRow[], key: string): ProcRow[] {
  const k = key === 'mem' || key === 'memory' ? 'memory' : key === 'pid' ? 'pid' : key === 'name' ? 'name' : key === 'energy' ? 'energy' : 'cpu';
  return [...rows].sort((a, b) => (k === 'name' ? a.name.localeCompare(b.name) : k === 'pid' ? a.pid - b.pid : ((b[k] as number) ?? 0) - ((a[k] as number) ?? 0)));
}

function filterRows(rows: ProcRow[], flags: Flags, q?: string): ProcRow[] {
  let out = rows;
  if (flags.mine) out = out.filter((r) => r.mine);
  if (q) {
    // /regex/ or plain words (name, command, pid).
    const m = q.match(/^\/(.+)\/([a-z]*)$/);
    const re = m ? new RegExp(m[1], m[2] || 'i') : null;
    out = out.filter((r) => (re ? re.test(`${r.name} ${r.command ?? ''}`) : `${r.name} ${r.command ?? ''} ${r.pid}`.toLowerCase().includes(q.toLowerCase())));
  }
  return out;
}

/** keeper ps [filter|/regex/] [--sort cpu|mem|pid|name] [--apps] [--mine] [--limit N] [--json] */
export async function cmdPs(rest: string[], flags: Flags, out: Out) {
  const s = await sampleNow();
  const limit = Number(flags.limit ?? (tty ? 40 : 100000));
  if (flags.apps) {
    const groups = groupByApp(filterRows(s.procs, flags, rest[0]), process.platform).sort((a, b) => b.cpu - a.cpu).slice(0, limit);
    return out(groups.map((g) => ({ app: g.name, processes: g.members.length, cpu: g.cpu, memory: g.memory })), () => {
      console.log(dim(`${'CPU'.padStart(7)} ${'MEMORY'.padStart(9)}  PROCS  APP`));
      for (const g of groups) console.log(`${pct(g.cpu)} ${formatBytes(g.memory).padStart(9)}  ${String(g.members.length).padStart(5)}  ${g.name}`);
    });
  }
  const rows = sortBy(filterRows(s.procs, flags, rest[0]), String(flags.sort ?? 'cpu')).slice(0, limit);
  out(rows.map((r) => ({ pid: r.pid, ppid: r.ppid, name: r.name, user: r.user, cpu: r.cpu, memory: r.memory, threads: r.threads, state: r.state, started: r.started, command: r.command })), () => {
    console.log(dim(`${'PID'.padStart(7)} ${'CPU'.padStart(7)} ${'MEMORY'.padStart(9)} ${'USER'.padEnd(10)} NAME`));
    for (const r of rows) console.log(`${String(r.pid).padStart(7)} ${pct(r.cpu)} ${formatBytes(r.memory).padStart(9)} ${(r.user ?? '').slice(0, 10).padEnd(10)} ${r.name}${flags.wide && r.command ? dim(`  ${r.command.slice(0, 120)}`) : ''}`);
  });
}

/** keeper top [--sort cpu|mem] [--limit N] [--once] — refreshes every 2 seconds until Ctrl-C. */
export async function cmdTop(_rest: string[], flags: Flags, out: Out) {
  const p = await procs();
  const limit = Number(flags.limit ?? Math.max(5, (process.stdout.rows ?? 30) - 8));
  await p.sample({ disk: true });
  const once = !!flags.once || !!flags.json || !tty;
  for (;;) {
    await new Promise((r) => setTimeout(r, once ? 800 : 2000));
    const s = await p.sample({ disk: true });
    const rows = sortBy(s.procs, String(flags.sort ?? 'cpu')).slice(0, limit);
    const sys = s.system;
    if (once) {
      return out({ system: sys, processes: rows.map((r) => ({ pid: r.pid, name: r.name, cpu: r.cpu, memory: r.memory })) }, () => print());
    }
    process.stdout.write('\x1b[2J\x1b[H');
    print();
    function print() {
      const mem = sys.memTotal ? (sys.memUsed / sys.memTotal) * 100 : 0;
      console.log(`${bold('CPU')} ${pct(sys.cpu)}  ${bold('Memory')} ${formatBytes(sys.memUsed)} of ${formatBytes(sys.memTotal)} (${Math.round(mem)}%)  ${sys.netIn !== undefined ? `${bold('Net')} ↓${formatBytes(sys.netIn)}/s ↑${formatBytes(sys.netOut ?? 0)}/s  ` : ''}${sys.diskRead !== undefined ? `${bold('Disk')} R ${formatBytes(sys.diskRead)}/s W ${formatBytes(sys.diskWrite ?? 0)}/s` : ''}`);
      if (sys.perCore.length) console.log(dim(sys.perCore.map((v) => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(v / 12.5))]).join('')));
      console.log(dim(`\n${'PID'.padStart(7)} ${'CPU'.padStart(7)} ${'MEMORY'.padStart(9)} NAME`));
      for (const r of rows) console.log(`${String(r.pid).padStart(7)} ${pct(r.cpu)} ${formatBytes(r.memory).padStart(9)} ${r.name}`);
      if (!once) console.log(dim('\nCtrl-C to stop · keeper kill <pid> to stop a process'));
    }
  }
}

async function confirm(q: string, flags: Flags): Promise<boolean> {
  if (flags.yes) return true;
  if (!process.stdin.isTTY) throw new Error('Add --yes to do this without a question.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`${q} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

/** keeper kill <pid|name|/regex/> [--force] [--tree] [--suspend|--resume] [--yes] */
export async function cmdKill(rest: string[], flags: Flags, out: Out) {
  const target = rest[0];
  if (!target) throw new Error('Usage: keeper kill <pid|name|/regex/> [--force] [--tree] [--suspend|--resume] [--yes]');
  const p = await procs();
  const s = await p.sample({ disk: false });
  const rows = /^\d+$/.test(target) ? s.procs.filter((r) => r.pid === Number(target)) : filterRows(s.procs, { mine: true }, target).filter((r) => r.pid !== process.pid);
  if (!rows.length) throw new Error(`Nothing running matches “${target}”.`);
  const blocked = rows.map((r) => ({ r, ok: canEnd(r, process.platform, process.pid, !!flags.force) })).filter((x) => !x.ok.ok);
  for (const b of blocked) console.error(yellow(`Skipping ${b.r.name} (${b.r.pid}): ${b.ok.reason}`));
  const go = rows.filter((r) => canEnd(r, process.platform, process.pid, !!flags.force).ok);
  if (!go.length) throw new Error('Keeper will not stop those processes.');
  const action = flags.suspend ? 'suspend' : flags.resume ? 'resume' : flags.tree ? 'endTree' : flags.force ? 'forceQuit' : 'quit';
  const verb = { suspend: 'Pause', resume: 'Resume', endTree: 'End (with everything they started)', forceQuit: 'Force quit', quit: 'Quit' }[action];
  if (!flags.json) for (const r of go) console.log(`  ${String(r.pid).padStart(7)}  ${r.name}${r.command ? dim(`  ${r.command.slice(0, 80)}`) : ''}`);
  if (!(await confirm(`${verb} ${go.length} process${go.length === 1 ? '' : 'es'}?`, flags))) return console.log('Nothing was changed.');
  const r = await p.act(action as 'quit', go.map((x) => x.pid));
  out(r, () => {
    console.log(r.ok ? green(r.message ?? `Done (${r.done}).`) : red(r.message ?? 'Some could not be stopped.'));
    for (const f of r.failed) console.log(red(`  ${f.name ?? f.pid}: ${f.reason}`));
  });
  if (!r.ok) process.exitCode = 1;
}

/** keeper ports [--all] — listening ports with their program and folder. */
export async function cmdPorts(_rest: string[], flags: Flags, out: Out) {
  const { listeners } = await import('../electron/services/monitor-probe');
  const ls = (await listeners()).filter((l) => flags.all || l.mine !== false).sort((a, b) => a.port - b.port);
  out(ls.map(({ argv: _a, ...l }) => l), () => {
    if (!ls.length) return console.log(dim('Nothing is listening (that Keeper can see; add --all, or run as an administrator to see everything).'));
    console.log(dim(`${'PORT'.padStart(6)} ${'PID'.padStart(7)} ${'ADDRESS'.padEnd(16)} PROGRAM`));
    for (const l of ls) console.log(`${String(l.port).padStart(6)} ${String(l.pid).padStart(7)} ${(l.address ?? '').padEnd(16)} ${l.name}${l.cwd ? dim(`  ${l.cwd}`) : ''}`);
  });
}

/** keeper dev [--all] [stop <pid|project>] [--yes] — dev servers grouped by project. */
export async function cmdDev(rest: string[], flags: Flags, out: Out) {
  const { devServers } = await import('../electron/services/monitor-probe');
  const { projects } = await devServers({ all: !!flags.all });
  if (rest[0] === 'stop') {
    const t = rest[1];
    if (!t) throw new Error('Usage: keeper dev stop <pid|project> [--yes]');
    const proj = projects.find((p) => p.name === t || p.root === t);
    const pids = proj ? [...new Set(proj.servers.map((s) => s.pid))] : [Number(t)].filter((n) => projects.some((p) => p.servers.some((s) => s.pid === n)));
    if (!pids.length) throw new Error(`No dev server or project called “${t}”. See: keeper dev`);
    if (!(await confirm(`Stop ${pids.length} server process${pids.length === 1 ? '' : 'es'}${proj ? ` of ${proj.name}` : ''} and what they started?`, flags))) return console.log('Nothing was changed.');
    const p = await procs();
    await p.sample({ disk: false });
    const r = await p.act('endTree', pids);
    return out(r, () => console.log(r.ok ? green(r.message ?? 'Stopped.') : red(r.failed.map((f) => f.reason).join('; '))));
  }
  out(projects, () => {
    if (!projects.length) return console.log(dim('No dev servers are running.'));
    for (const p of projects) {
      console.log(`${bold(p.name)}${p.root ? dim(`  ${p.root}`) : ''}`);
      for (const s of p.servers) console.log(`  ${String(s.port).padStart(5)}  ${s.kind.padEnd(14)} ${dim(`pid ${s.pid}`)}${s.idle ? dim(' · idle') : ''}${s.exposed ? yellow(' · open to the network') : ''}${s.url ? `  ${s.url}` : ''}`);
    }
  });
}

/** keeper agents --running: coding agents, AI tools and model servers that are running now. */
export async function cmdAgentsRunning(_rest: string[], _flags: Flags, out: Out) {
  const s = await sampleNow(400);
  const { runningAgents } = await import('../electron/services/monitor-probe');
  const a = await runningAgents(s.procs);
  out(a, () => {
    if (!a.length) return console.log(dim('No coding agents, AI tools or model servers are running.'));
    for (const x of a) console.log(`${bold(x.label)} ${dim(`${x.kind} · pid ${x.pid} · ${x.pids.length} processes · ${x.cpu.toFixed(1)}% CPU · ${formatBytes(x.memory)}`)}${x.project ? `  ${x.project}` : ''}${x.ports.length ? dim(`  port ${x.ports.join(', ')}`) : ''}`);
  });
}

/** keeper sensors — graphics, temperatures, fans and power. */
export async function cmdSensors(_rest: string[], _flags: Flags, out: Out) {
  const { readSensors } = await import('../electron/services/monitor-probe');
  const s = await readSensors();
  out(s, () => {
    for (const g of s.gpus) console.log(`${bold('GPU')}    ${g.name}: ${g.util !== undefined ? `${Math.round(g.util)}%` : '—'}${g.approx ? dim(' (estimate)') : ''}${g.memTotal ? ` · ${formatBytes(g.memUsed ?? 0)} of ${formatBytes(g.memTotal)}` : ''}${g.temp !== undefined ? ` · ${g.temp} °C` : ''}${g.power !== undefined ? ` · ${g.power} W` : ''} ${dim(g.source)}`);
    for (const t of s.temps.slice(0, 12)) console.log(`${bold('Temp')}   ${t.label}: ${t.celsius} °C`);
    for (const f of s.fans) console.log(`${bold('Fan')}    ${f.label}: ${f.rpm} rpm`);
    if (s.power.battery !== undefined) console.log(`${bold('Power')}  battery ${s.power.battery >= 0 ? `${s.power.battery} W out` : `${-s.power.battery} W in`}`);
    for (const d of s.power.domains ?? []) console.log(`${bold('Power')}  ${d.name}: ${d.watts} W`);
    for (const l of s.limits) console.log(dim(`· ${l}`));
  });
}

/** keeper process <pid> — details, parents, ports and signature (environment values only with --env). */
export async function cmdProcess(rest: string[], flags: Flags, out: Out) {
  const pid = Number(rest[0]);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Usage: keeper process <pid> [--env] [--secrets]');
  const p = await procs();
  const s = await p.sample({ disk: false });
  const d = await p.details(pid);
  if (!d) throw new Error(`No process ${pid}.`);
  const probe = await import('../electron/services/monitor-probe');
  const { redactEnv } = await import('../core/monitor-procinfo');
  const [env, sig, ls] = await Promise.all([probe.processEnv(pid), d.path ? probe.codeSignature(d.path) : Promise.resolve(undefined), probe.listeners().catch(() => [])]);
  const vars = 'vars' in env ? redactEnv(env.vars, { reveal: !!flags.env, revealSecrets: !!flags.secrets }) : undefined;
  const data = { ...d, parents: ancestors(pid, s.procs), ports: ls.filter((l) => l.pid === pid).map((l) => l.port), signature: sig, env: vars, envError: 'error' in env ? env.error : undefined };
  out(data, () => {
    console.log(`${bold(d.name)} ${dim(`pid ${pid}${d.user ? ` · ${d.user}` : ''}${d.started ? ` · started ${relativeTime(d.started)}` : ''}`)}`);
    if (d.path) console.log(`  Program   ${d.path}`);
    if (d.command) console.log(`  Command   ${d.command}`);
    if (d.cwd) console.log(`  Folder    ${d.cwd}`);
    if (data.parents.length) console.log(`  Parents   ${data.parents.map((x) => `${x.name} (${x.pid})`).join(' ← ')}`);
    if (data.ports.length) console.log(`  Listening ${data.ports.join(', ')}`);
    if (sig) console.log(`  Signature ${sig.valid ? green('valid') : sig.signed ? yellow('does not check out') : 'none'}${sig.signer ? ` · ${sig.signer}` : ''}${sig.teamId ? ` · team ${sig.teamId}` : ''}`);
    for (const m of d.memory) console.log(`  ${m.label.padEnd(26)} ${formatBytes(m.bytes)}`);
    if (d.children.length) console.log(`  Started   ${d.children.slice(0, 12).map((x) => `${x.name} (${x.pid})`).join(', ')}`);
    if (d.connections.length) console.log(`  ${d.connections.length} connections, ${d.openFiles.length + (d.openFilesMore ?? 0)} open files`);
    if (vars) {
      console.log(`  Environment (${vars.length})${flags.env ? '' : dim(' — values hidden; --env to show, --secrets for keys too')}`);
      for (const v of vars) if (v.value !== undefined || flags.env) console.log(dim(`    ${v.name}=${v.value ?? '••••'}`));
    } else if (data.envError) console.log(dim(`  ${data.envError}`));
  });
}

/** keeper history [--hours N] — peaks and the apps that worked hardest (needs the app running). */
export async function cmdHistory(_rest: string[], flags: Flags, out: Out) {
  const { connectToApp } = await import('../core/brain/client');
  const app = await connectToApp();
  if (!app) throw new Error('Keeper is not running. Open the Keeper app first (history is kept by the app).');
  const hours = Number(flags.hours ?? 24);
  let v: import('../core/api-sysmon').HistoryView;
  try {
    v = (await app.call('keeper/sysmon.history', { from: Date.now() - hours * 3600_000, to: Date.now(), max: 300 })) as typeof v;
  } finally {
    app.close();
  }
  out(v, () => {
    console.log(bold(`The last ${hours} hours`) + dim(` (${v.points.length} points)`));
    for (const p of v.peaks) console.log(`  Peak ${p.metric.padEnd(7)} ${Math.round(p.value * 10) / 10}  ${dim(new Date(p.t).toLocaleString())}`);
    console.log(bold('\nWorked hardest'));
    for (const a of v.top.slice(0, 10)) console.log(`  ${a.name.padEnd(28)} ${String(a.cpuMinutes).padStart(7)} CPU-min  ${dim(`avg ${a.avgCpu}% · peak ${formatBytes(a.peakMem)}`)}`);
  });
}

/** keeper containers [stop|start|restart|pause|unpause <id>] [--yes] — Docker or Podman with live use and disk use. */
export async function cmdContainers(rest: string[], flags: Flags, out: Out) {
  const x = await import('../electron/services/monitor-extras');
  if (rest[0] && rest[0] !== 'list') {
    const [action, id] = rest;
    if (!id) throw new Error('Usage: keeper containers stop|start|restart|pause|unpause <id> [--yes]');
    if (!(await confirm(`${action} the container ${id}?`, flags))) return console.log('Nothing was changed.');
    const r = await x.containerAction(id, action as 'stop');
    out(r, () => console.log(r.ok ? green(r.message) : red(r.message)));
    if (!r.ok) process.exitCode = 1;
    return;
  }
  const v = await x.containers();
  out(v, () => {
    if (!v.engine) return console.log(dim(v.note ?? 'No container engine.'));
    console.log(dim(`${v.engine}: ${v.containers.length} containers`));
    for (const c of v.containers) console.log(`  ${c.id}  ${c.name.padEnd(24)} ${c.state.padEnd(8)} ${c.cpu !== undefined ? pct(c.cpu) : '      –'} ${c.memUsed ? formatBytes(c.memUsed).padStart(9) : ''}  ${dim(c.image)}`);
    for (const d of v.disk) console.log(dim(`  ${d.type}: ${formatBytes(d.size)} (${formatBytes(d.reclaimable)} could be freed)`));
  });
}

/** keeper volume [<stream id> <0-100>|mute|unmute] — apps playing sound (Linux, Windows). */
export async function cmdVolume(rest: string[], _flags: Flags, out: Out) {
  const x = await import('../electron/services/monitor-extras');
  if (rest[0]) {
    const [id, v] = rest;
    const ok = await x.setStream(id, v === 'mute' ? { muted: true } : v === 'unmute' ? { muted: false } : { volume: Number(v) });
    return out({ ok }, () => console.log(ok ? 'Done.' : red('The sound system did not accept it.')));
  }
  const m = await x.mixer();
  out(m, () => {
    if (!m.supported) return console.log(dim(m.note ?? 'Not supported here.'));
    for (const s of m.streams) console.log(`  ${s.id.padStart(6)}  ${s.name.padEnd(28)} ${s.muted ? 'muted' : `${s.volume}%`}`);
    for (const o of m.outputs) console.log(dim(`  output ${o.default ? '●' : '○'} ${o.name}`));
  });
}

export const MONITOR_HELP = `
  ${bold('System monitor')}
  keeper ps [filter|/regex/] [--sort cpu|mem] [--apps] [--mine] [--wide]   running processes
  keeper top [--sort mem] [--once]                       live view, refreshes every 2 s
  keeper kill <pid|name|/regex/> [--force|--tree|--suspend|--resume] [--yes]
  keeper process <pid> [--env] [--secrets]               details, parents, ports, signature
  keeper ports [--all]                                   listening ports with program and folder
  keeper dev [--all] | dev stop <pid|project> [--yes]    dev servers grouped by project
  keeper agents --running                                running coding agents and model servers
  keeper sensors                                         graphics, temperatures, fans, power
  keeper containers [stop|start|restart <id>] [--yes]    Docker / Podman with live use and disk use
  keeper volume [<stream> <0-100>|mute|unmute]           volume per app (Linux, Windows)
  keeper history [--hours 24]                            peaks and busiest apps (app running)
`;
