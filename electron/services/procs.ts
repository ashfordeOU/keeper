// SPDX-License-Identifier: AGPL-3.0-or-later
// The process manager: every running program with what it uses, and quitting,
// force quitting, suspending, restarting and re-prioritising them, plus the
// system's services.
//
// Cheap by design: nothing samples unless the Processes page asks, and each
// reading is one pass per operating system — /proc files on Linux, one `ps`
// on a Mac, one query to a PowerShell that stays open on Windows (starting
// PowerShell every second would cost more than everything else together).

import { app, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { closeSync, openSync, promises as fsp, readdirSync, readFileSync, readlinkSync, readSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ForceQuitApp, ProcAction, ProcActionResult, ProcDetails } from '../../core/api-procs';
import { powershell, run } from '../../core/platform';
import {
  canEnd, coreUsage, cpuPercent, descendants, energyImpact, macAppBundle, parseBootTime, parseCmdline, parseDiskstats, parseIostat, parseLaunchctlList,
  parseMeminfo, parseNetDev, parseNetSockets, parseNetstatIb, parsePasswd, parsePidRest, parseProcIo, parseProcStat, parsePsLine, parseStatusMemory,
  parseStatusUid, parseSwapusage, parseSystemctlUnits, parseUnitFiles, parseWinProcesses, parseWinServices, PRIORITIES, psQuote, rate, safeServiceName,
  type PriorityLevel, type ProcRow, type ProcSample, type ServiceRow, type Signal, type SystemRates,
} from '../../core/procs';

const PLATFORM = process.platform;
const SELF = process.pid;
const MY_UID = typeof process.getuid === 'function' ? process.getuid() : -1;

// ---------------------------------------------------------------- shared state between readings

let lastT = 0;
let lastCores = os.cpus();
/** per process: cumulative CPU ms and I/O bytes at the last reading, keyed "pid:start" so reused pids start fresh */
let lastProc = new Map<string, { cpuMs: number; read?: number; write?: number }>();
let lastSys: { diskRead?: number; diskWrite?: number; netIn?: number; netOut?: number } = {};
let latest: ProcRow[] = [];
/** connection counts are costly, so they are refreshed at most every 5 seconds */
let conn: { t: number; counts: Map<number, number> } = { t: 0, counts: new Map() };
let idleTimer: NodeJS.Timeout | undefined;

/** Forget everything after a minute without readings, so a closed page holds no memory. */
function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    lastProc = new Map();
    linuxStatic.clear();
    macNames.clear();
    latest = [];
    winSession?.close();
    winSession = undefined;
  }, 60_000);
  idleTimer.unref?.();
}

function finish(rows: (ProcRow & { key: string; cpuMs?: number; ioRead?: number; ioWrite?: number })[], sys: SystemRates, now: number, unavailable: ProcSample['unavailable']): ProcSample {
  const elapsed = lastT ? now - lastT : 0;
  const next = new Map<string, { cpuMs: number; read?: number; write?: number }>();
  for (const r of rows) {
    const prev = lastProc.get(r.key);
    if (r.cpuMs !== undefined) {
      // The first reading of a process has no baseline; keep what ps reported, if anything.
      if (prev && elapsed > 0) r.cpu = cpuPercent(prev.cpuMs, r.cpuMs, elapsed);
      next.set(r.key, { cpuMs: r.cpuMs, read: r.ioRead, write: r.ioWrite });
    }
    if (prev && elapsed > 0) {
      r.readRate = rate(prev.read, r.ioRead, elapsed);
      r.writeRate = rate(prev.write, r.ioWrite, elapsed);
    }
    r.energy = energyImpact(r.cpu, (r.readRate ?? 0) + (r.writeRate ?? 0));
  }
  lastProc = next;
  const cores = os.cpus();
  const usage = coreUsage(lastCores, cores);
  lastCores = cores;
  sys.cpu = usage.total;
  sys.perCore = usage.perCore;
  if (elapsed > 0) {
    sys.diskRead = rate(lastSys.diskRead, sys.diskRead, elapsed);
    sys.diskWrite = rate(lastSys.diskWrite, sys.diskWrite, elapsed);
    sys.netIn = rate(lastSys.netIn, sys.netIn, elapsed);
    sys.netOut = rate(lastSys.netOut, sys.netOut, elapsed);
  }
  // Keep the raw counters for next time (the rates above replaced them in `sys`).
  lastT = now;
  const procs = rows.map(({ key: _k, cpuMs: _c, ioRead: _r, ioWrite: _w, ...p }) => p);
  latest = procs;
  touch();
  return { t: now, procs, system: sys, unavailable, self: SELF };
}

// ---------------------------------------------------------------- Linux: read /proc directly, no programs started

const CLK_TCK = 100;
const PAGE = 4096;
let bootTime: number | undefined;
let users: Map<number, string> | undefined;
/** things that do not change while a process runs */
const linuxStatic = new Map<string, { uid?: number; path?: string; command?: string; ioDenied?: boolean }>();

const BUF = Buffer.allocUnsafe(64 * 1024);

/** Reads a small file (anything under /proc) without allocating per call; undefined when it can't be read. */
function readSmall(p: string): string | undefined {
  let fd = -1;
  try {
    fd = openSync(p, 'r');
    const n = readSync(fd, BUF, 0, BUF.length, 0);
    return BUF.toString('utf8', 0, n);
  } catch {
    return undefined;
  } finally {
    if (fd >= 0) closeSync(fd);
  }
}

async function readText(p: string): Promise<string | undefined> {
  try {
    return await fsp.readFile(p, 'utf8');
  } catch {
    return undefined;
  }
}

async function sampleLinux(withNet: boolean, withDisk: boolean): Promise<ProcSample> {
  const now = Date.now();
  bootTime ??= parseBootTime((await readText('/proc/stat')) ?? '');
  if (!users) {
    try {
      users = parsePasswd(readFileSync('/etc/passwd', 'utf8'));
    } catch {
      users = new Map();
    }
  }
  // Small synchronous reads into one buffer: for a few hundred tiny /proc files this is several
  // times cheaper than the same number of asynchronous reads, and takes a few milliseconds.
  const pids = readdirSync('/proc').filter((n) => /^\d+$/.test(n));
  const rows: (ProcRow & { key: string; cpuMs: number; ioRead?: number; ioWrite?: number })[] = [];
  for (const pid of pids) {
    const st = parseProcStat(readSmall(`/proc/${pid}/stat`) ?? '');
    if (!st) continue;
    const key = `${st.pid}:${st.starttime}`;
    let s = linuxStatic.get(key);
    if (!s) {
      let exe: string | undefined;
      try {
        exe = readlinkSync(`/proc/${pid}/exe`);
      } catch {
        exe = undefined;
      }
      const args = parseCmdline(readSmall(`/proc/${pid}/cmdline`) ?? '');
      s = { uid: parseStatusUid(readSmall(`/proc/${pid}/status`) ?? ''), path: exe?.replace(/ \(deleted\)$/, ''), command: args.join(' ') || undefined };
      linuxStatic.set(key, s);
    }
    // Disk counters only when the Disk or Energy tab needs them.
    let io: { read: number; write: number } | null = null;
    if (withDisk && !s.ioDenied) {
      io = parseProcIo(readSmall(`/proc/${pid}/io`) ?? '');
      if (!io) s.ioDenied = true;
    }
    rows.push({
      key, pid: st.pid, ppid: st.ppid, name: st.name, user: s.uid === undefined ? undefined : users!.get(s.uid) ?? String(s.uid), mine: s.uid === MY_UID,
      cpu: 0, memory: st.rssPages * PAGE, threads: st.threads, state: st.state, nice: st.nice,
      started: bootTime ? Math.round((bootTime + st.starttime / CLK_TCK) * 1000) : undefined,
      path: s.path, command: s.command, cpuMs: (st.ticks / CLK_TCK) * 1000, ioRead: io?.read, ioWrite: io?.write,
    });
  }
  // Drop the static details of processes that ended.
  if (linuxStatic.size > rows.length * 2) {
    const live = new Set(rows.map((r) => r.key));
    for (const k of linuxStatic.keys()) if (!live.has(k)) linuxStatic.delete(k);
  }
  const mem = parseMeminfo(readSmall('/proc/meminfo') ?? '');
  const disk = parseDiskstats(readSmall('/proc/diskstats') ?? '');
  const net = parseNetDev(readSmall('/proc/net/dev') ?? '');
  const total = mem.total ?? os.totalmem();
  const avail = mem.available ?? os.freemem();
  const sys: SystemRates = {
    cpu: 0, perCore: [], memTotal: total, memUsed: total - avail, memAvailable: avail,
    swapTotal: mem.swapTotal, swapUsed: mem.swapTotal !== undefined && mem.swapFree !== undefined ? mem.swapTotal - mem.swapFree : undefined,
    diskRead: disk.read, diskWrite: disk.write, netIn: net.rx, netOut: net.tx,
  };
  const raw = { diskRead: sys.diskRead, diskWrite: sys.diskWrite, netIn: sys.netIn, netOut: sys.netOut };
  if (withNet) await countConnectionsLinux(rows.map((r) => r.pid));
  for (const r of rows) r.connections = withNet ? conn.counts.get(r.pid) ?? 0 : undefined;
  const out = finish(rows, sys, now, withDisk ? ['network'] : ['network', 'disk']);
  lastSys = raw;
  return out;
}

async function countConnectionsLinux(pids: number[]) {
  if (Date.now() - conn.t < 5000) return;
  const tables = await Promise.all(['tcp', 'tcp6', 'udp', 'udp6'].map((t) => readText(`/proc/net/${t}`)));
  const inodes = new Set<string>();
  for (const t of tables) for (const i of parseNetSockets(t ?? '')) inodes.add(i);
  const counts = new Map<number, number>();
  // Only processes we may look into answer; that is the person's own, which is what matters here.
  await Promise.all(pids.map(async (pid) => {
    let fds: string[];
    try {
      fds = await fsp.readdir(`/proc/${pid}/fd`);
    } catch {
      return;
    }
    let n = 0;
    for (const fd of fds) {
      const l = await fsp.readlink(`/proc/${pid}/fd/${fd}`).catch(() => '');
      const m = l.match(/^socket:\[(\d+)\]$/);
      if (m && inodes.has(m[1])) n++;
    }
    if (n) counts.set(pid, n);
  }));
  conn = { t: Date.now(), counts };
}

// ---------------------------------------------------------------- macOS: one ps (plus netstat and iostat) per reading

const macNames = new Map<number, { path?: string; command?: string }>();
let macUsers: Map<number, string> | undefined;
let macSwap: { t: number; total?: number; used?: number } = { t: 0 };

async function sampleMac(withNet: boolean): Promise<ProcSample> {
  const now = Date.now();
  const r = await run('/bin/sh', ['-c', 'ps -axo pid=,ppid=,uid=,pcpu=,rss=,state=,nice=,time=,etime=; echo @@KEEPER@@; netstat -ibn; echo @@KEEPER@@; iostat -Id'], 10_000);
  const [psOut = '', netOut = '', ioOut = ''] = r.stdout.split('@@KEEPER@@\n');
  const ps = psOut.split('\n').map(parsePsLine).filter((x): x is NonNullable<typeof x> => !!x);
  // Names and arguments only for processes we have not seen yet.
  if (ps.some((p) => !macNames.has(p.pid))) {
    const n = await run('/bin/sh', ['-c', 'ps -axo pid=,comm=; echo @@KEEPER@@; ps -axww -o pid=,args='], 10_000);
    const [comm = '', args = ''] = n.stdout.split('@@KEEPER@@\n');
    const c = parsePidRest(comm);
    const a = parsePidRest(args);
    macNames.clear();
    for (const [pid, p] of c) macNames.set(pid, { path: p, command: a.get(pid) });
  }
  if (!macUsers) {
    const u = await run('/usr/bin/dscl', ['.', '-list', '/Users', 'UniqueID'], 5000);
    macUsers = new Map();
    for (const l of u.stdout.split('\n')) {
      const m = l.trim().match(/^(\S+)\s+(-?\d+)$/);
      if (m) macUsers.set(Number(m[2]), m[1]);
    }
  }
  if (now - macSwap.t > 10_000) {
    const s = parseSwapusage((await run('/usr/sbin/sysctl', ['vm.swapusage'], 3000)).stdout);
    macSwap = { t: now, ...s };
  }
  let counts = conn.counts;
  if (withNet && now - conn.t > 5000) {
    const l = await run('/usr/sbin/lsof', ['-nP', '-i', '-F', 'p'], 10_000);
    counts = new Map();
    for (const line of l.stdout.split('\n')) if (line.startsWith('p')) counts.set(Number(line.slice(1)), (counts.get(Number(line.slice(1))) ?? 0) + 1);
    conn = { t: now, counts };
  }
  const rows = ps.map((p) => {
    const n = macNames.get(p.pid);
    const bundle = macAppBundle(n?.path);
    const name = n?.path ? n.path.split('/').pop()! : String(p.pid);
    // pid + start time identifies a process; ps rounds elapsed time, so the start is rounded to 10 s.
    const row: ProcRow & { key: string; cpuMs: number } = {
      key: `${p.pid}:${Math.round((now - p.elapsedMs) / 10_000)}`, pid: p.pid, ppid: p.ppid, name, user: macUsers!.get(p.uid) ?? String(p.uid), mine: p.uid === MY_UID,
      cpu: p.cpu, memory: p.rss, state: p.state, nice: p.nice, started: now - p.elapsedMs, path: n?.path, command: n?.command,
      cpuMs: p.cpuMs, app: !!bundle && !!n?.path && n.path.startsWith(`${bundle}/Contents/MacOS/`),
      connections: withNet ? counts.get(p.pid) ?? 0 : undefined,
    };
    return row;
  });
  const net = parseNetstatIb(netOut);
  const sys: SystemRates = {
    cpu: 0, perCore: [], memTotal: os.totalmem(), memUsed: os.totalmem() - os.freemem(),
    swapTotal: macSwap.total, swapUsed: macSwap.used, diskRead: parseIostat(ioOut), netIn: net.rx, netOut: net.tx,
  };
  const raw = { diskRead: sys.diskRead, netIn: sys.netIn, netOut: sys.netOut };
  const out = finish(rows, sys, now, ['threads', 'disk', 'network']);
  lastSys = raw;
  return out;
}

// ---------------------------------------------------------------- Windows: one PowerShell that stays open while the page is

class PsSession {
  private child: ChildProcessWithoutNullStreams;
  private buf = '';
  private queue: { marker: string; resolve: (s: string) => void; reject: (e: Error) => void }[] = [];
  private seq = 0;
  closed = false;

  constructor() {
    const exe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    this.child = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (d: string) => this.read(d));
    this.child.on('exit', () => this.fail(new Error('PowerShell ended')));
    this.child.on('error', (e) => this.fail(e));
    // Leave the console in UTF-8 so names in any language come through.
    this.child.stdin.write('[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ProgressPreference = "SilentlyContinue"\n');
  }

  private read(d: string) {
    this.buf += d;
    while (this.queue.length) {
      const q = this.queue[0];
      const i = this.buf.indexOf(q.marker);
      if (i < 0) break;
      const out = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + q.marker.length).replace(/^\r?\n/, '');
      this.queue.shift();
      q.resolve(out);
    }
  }

  private fail(e: Error) {
    this.closed = true;
    for (const q of this.queue.splice(0)) q.reject(e);
  }

  /** Runs one line of PowerShell and returns what it printed. */
  exec(oneLine: string, timeout = 20_000): Promise<string> {
    if (this.closed) return Promise.reject(new Error('PowerShell ended'));
    const marker = `@@KEEPER-${++this.seq}@@`;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('PowerShell took too long')), timeout);
      this.queue.push({ marker, resolve: (s) => { clearTimeout(t); resolve(s); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.child.stdin.write(`${oneLine.replace(/\r?\n/g, ' ')}; Write-Output '${marker}'\n`);
    });
  }

  close() {
    this.closed = true;
    this.child.stdin.end();
    this.child.kill();
  }
}

let winSession: PsSession | undefined;
function ps(): PsSession {
  if (!winSession || winSession.closed) winSession = new PsSession();
  return winSession;
}

const WIN_SAMPLE = [
  '$p = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,WorkingSetSize,ThreadCount,KernelModeTime,UserModeTime,ReadTransferCount,WriteTransferCount,CreationDate,ExecutablePath,CommandLine,SessionId',
  '$n = Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface -Property BytesReceivedPersec,BytesSentPersec',
  "$d = Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk -Filter \"Name='_Total'\" -Property DiskReadBytesPersec,DiskWriteBytesPersec",
  '$w = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.Id })',
  '$f = Get-CimInstance Win32_PageFileUsage -Property AllocatedBaseSize,CurrentUsage',
  "@{ p = @($p | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,ThreadCount,KernelModeTime,UserModeTime,ReadTransferCount,WriteTransferCount,@{n='CreationDate';e={$_.CreationDate.ToUniversalTime().ToString('o')}},ExecutablePath,CommandLine,SessionId); nIn = ($n | Measure-Object BytesReceivedPersec -Sum).Sum; nOut = ($n | Measure-Object BytesSentPersec -Sum).Sum; dR = $d.DiskReadBytesPersec; dW = $d.DiskWriteBytesPersec; w = $w; swT = ($f | Measure-Object AllocatedBaseSize -Sum).Sum; swU = ($f | Measure-Object CurrentUsage -Sum).Sum } | ConvertTo-Json -Compress -Depth 3",
].join('; ');

let mySession: number | undefined;

async function sampleWindows(withNet: boolean): Promise<ProcSample> {
  const now = Date.now();
  const out = await ps().exec(WIN_SAMPLE);
  let j: { p?: unknown; nIn?: number; nOut?: number; dR?: number; dW?: number; w?: number[] | number; swT?: number; swU?: number } = {};
  try {
    j = JSON.parse(out.trim() || '{}');
  } catch {
    /* an odd reading; the next one will do */
  }
  const list = parseWinProcesses(JSON.stringify(j.p ?? []));
  const windows = new Set(Array.isArray(j.w) ? j.w : j.w !== undefined ? [j.w] : []);
  mySession ??= list.find((p) => p.pid === SELF)?.session;
  let counts = conn.counts;
  if (withNet && now - conn.t > 5000) {
    const c = await ps().exec('Get-NetTCPConnection | Group-Object OwningProcess | ForEach-Object { "$($_.Name) $($_.Count)" }').catch(() => '');
    counts = new Map();
    for (const l of c.split('\n')) {
      const m = l.trim().match(/^(\d+)\s+(\d+)$/);
      if (m) counts.set(Number(m[1]), Number(m[2]));
    }
    conn = { t: now, counts };
  }
  const rows = list.map((p) => ({
    key: `${p.pid}:${p.started ?? 0}`, pid: p.pid, ppid: p.ppid, name: p.name, mine: p.session !== 0 && p.session === mySession,
    user: p.session === 0 ? 'system' : p.session === mySession ? 'you' : `session ${p.session}`,
    cpu: 0, memory: p.memory, threads: p.threads, started: p.started, path: p.path, command: p.command, app: windows.has(p.pid),
    cpuMs: p.cpuMs, ioRead: p.read, ioWrite: p.write, connections: withNet ? counts.get(p.pid) ?? 0 : undefined,
  }));
  const sys: SystemRates = {
    cpu: 0, perCore: [], memTotal: os.totalmem(), memUsed: os.totalmem() - os.freemem(),
    swapTotal: j.swT ? j.swT * 1024 * 1024 : undefined, swapUsed: j.swU !== undefined ? j.swU * 1024 * 1024 : undefined,
    diskRead: j.dR, diskWrite: j.dW, netIn: j.nIn, netOut: j.nOut,
  };
  const raw = { diskRead: sys.diskRead, diskWrite: sys.diskWrite, netIn: sys.netIn, netOut: sys.netOut };
  const res = finish(rows, sys, now, []);
  lastSys = raw;
  return res;
}

let busy: Promise<ProcSample> | null = null;

/** One reading of every process. Overlapping requests share one reading. */
export function sample(opts: { network?: boolean; disk?: boolean } = {}): Promise<ProcSample> {
  busy ??= (PLATFORM === 'linux' ? sampleLinux(!!opts.network, opts.disk !== false) : PLATFORM === 'darwin' ? sampleMac(!!opts.network) : sampleWindows(!!opts.network)).finally(() => { busy = null; });
  return busy;
}

// ---------------------------------------------------------------- actions

const SIG_NUM: Record<Signal, number> = { SIGTERM: 15, SIGKILL: 9, SIGSTOP: 19, SIGCONT: 18, SIGHUP: 1, SIGINT: 2 };

function info(pid: number): ProcRow | undefined {
  return latest.find((p) => p.pid === pid);
}

function signal(pid: number, sig: Signal): { ok: boolean; reason?: string; needsAdmin?: boolean } {
  try {
    process.kill(pid, sig);
    return { ok: true };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return { ok: false, reason: 'It belongs to another user or the system.', needsAdmin: true };
    if (code === 'ESRCH') return { ok: true };
    return { ok: false, reason: (e as Error).message };
  }
}

/** Runs one fixed command with administrator rights, using the system's own password prompt. */
async function asAdmin(kind: 'signal' | 'renice' | 'taskkill', pid: number, value: string | number): Promise<{ ok: boolean; reason?: string }> {
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, reason: 'Not a process.' };
  if (PLATFORM === 'win32') {
    const args = kind === 'taskkill' ? `/PID ${pid}${value === 'force' ? ' /F' : ''}` : '';
    if (!args) return { ok: false, reason: 'Not supported here.' };
    const r = await powershell(`try { $p = Start-Process -FilePath taskkill -ArgumentList ${psQuote(args)} -Verb RunAs -WindowStyle Hidden -PassThru -Wait; exit $p.ExitCode } catch { exit 5 }`, 120_000);
    return r.ok ? { ok: true } : { ok: false, reason: 'Administrator permission was not given.' };
  }
  const cmd = kind === 'signal' ? ['kill', '-s', String(value).replace(/^SIG/, ''), String(pid)] : ['renice', '-n', String(Number(value)), '-p', String(pid)];
  if (kind === 'signal' && !(String(value) in SIG_NUM)) return { ok: false, reason: 'Not allowed.' };
  if (PLATFORM === 'linux') {
    const r = await run('pkexec', cmd, 120_000);
    return r.ok ? { ok: true } : { ok: false, reason: r.stderr.includes('dismissed') || r.stderr.includes('Not authorized') ? 'Administrator permission was not given.' : r.stderr.trim() || 'Could not get administrator permission.' };
  }
  // Every part is a number or a fixed word, so the shell line cannot be anything else.
  const line = cmd.join(' ');
  const r = await run('/usr/bin/osascript', ['-e', `do shell script "${line}" with administrator privileges`], 120_000);
  return r.ok ? { ok: true } : { ok: false, reason: 'Administrator permission was not given.' };
}

function result(done: number, failed: ProcActionResult['failed'], message?: string): ProcActionResult {
  return { ok: failed.length === 0, done, failed, message };
}

async function waitGone(pid: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') return true;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function quitOne(pid: number, force: boolean, admin: boolean): Promise<{ ok: boolean; reason?: string; needsAdmin?: boolean }> {
  const p = info(pid);
  if (PLATFORM === 'win32') {
    if (admin) return asAdmin('taskkill', pid, force ? 'force' : '');
    const r = await run('taskkill', ['/PID', String(pid), ...(force ? ['/F'] : [])], 15_000);
    if (r.ok) return { ok: true };
    if (/access is denied/i.test(r.stderr)) return { ok: false, reason: 'It belongs to another user or the system.', needsAdmin: true };
    return { ok: false, reason: force ? r.stderr.trim() || 'Could not end it.' : 'It has no window to close. Use Force Quit.' };
  }
  // A Mac app is asked to quit the way the Dock does, so it can save and tidy up.
  if (PLATFORM === 'darwin' && !force && !admin && p?.app && p.path) {
    const bundle = macAppBundle(p.path)!;
    const r = await run('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'tell application (item 1 of argv) to quit', '-e', 'end run', bundle], 15_000);
    if (r.ok) return { ok: true };
  }
  const sig: Signal = force ? 'SIGKILL' : 'SIGTERM';
  if (admin) return asAdmin('signal', pid, sig);
  return signal(pid, sig);
}

export async function act(action: ProcAction, pids: number[], opts: { admin?: boolean } = {}): Promise<ProcActionResult> {
  const failed: ProcActionResult['failed'] = [];
  let done = 0;
  const list = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
  if (!latest.length) await sample();
  for (const pid of list) {
    const p = info(pid) ?? { pid, ppid: 0, name: String(pid), mine: false, cpu: 0, memory: 0 };
    const force = action === 'forceQuit' || action === 'endTree';
    const check = canEnd(p, PLATFORM, SELF, force || action === 'suspend');
    if (!check.ok) {
      failed.push({ pid, name: p.name, reason: check.reason! });
      continue;
    }
    let r: { ok: boolean; reason?: string; needsAdmin?: boolean };
    switch (action) {
      case 'quit':
      case 'forceQuit':
        r = await quitOne(pid, action === 'forceQuit', !!opts.admin);
        break;
      case 'endTree': {
        // Children first, so nothing gets re-parented and keeps running.
        const all = [...descendants(pid, latest), pid].filter((x) => x !== SELF && x !== process.ppid);
        const blocked = all.map((x) => info(x)).filter((x): x is ProcRow => !!x && !canEnd(x, PLATFORM, SELF, true).ok);
        if (blocked.length) {
          r = { ok: false, reason: `It started ${blocked.map((b) => b.name).join(', ')}, which must keep running.` };
          break;
        }
        if (PLATFORM === 'win32') {
          const k = await run('taskkill', ['/PID', String(pid), '/T', '/F'], 20_000);
          r = k.ok ? { ok: true } : { ok: false, reason: k.stderr.trim() || 'Could not end it.', needsAdmin: /denied/i.test(k.stderr) };
        } else {
          const res = await Promise.all(all.map((x) => (opts.admin ? asAdmin('signal', x, 'SIGKILL') : Promise.resolve(signal(x, 'SIGKILL')))));
          const bad = res.find((x) => !x.ok);
          r = bad ?? { ok: true };
          done += all.length - 1;
        }
        break;
      }
      case 'suspend':
      case 'resume':
        r = await pause(pid, action === 'suspend', !!opts.admin);
        break;
      case 'restart':
        r = await restart(pid);
        break;
    }
    if (r.ok) done++;
    else failed.push({ pid, name: p.name, reason: r.reason ?? 'It did not work.', needsAdmin: r.needsAdmin });
  }
  return result(done, failed);
}

async function pause(pid: number, stop: boolean, admin: boolean): Promise<{ ok: boolean; reason?: string; needsAdmin?: boolean }> {
  if (PLATFORM === 'win32') {
    const fn = stop ? 'NtSuspendProcess' : 'NtResumeProcess';
    const script = [
      "if (-not ('KeeperNt' -as [type])) { Add-Type -Name KeeperNt -Namespace '' -MemberDefinition '[DllImport(\"ntdll.dll\")] public static extern int NtSuspendProcess(IntPtr h); [DllImport(\"ntdll.dll\")] public static extern int NtResumeProcess(IntPtr h);' }",
      `try { $h = (Get-Process -Id ${pid} -ErrorAction Stop).Handle; [KeeperNt]::${fn}($h) } catch { 'DENIED' }`,
    ].join('; ');
    const out = await ps().exec(script).catch((e: Error) => e.message);
    return /DENIED/.test(out) ? { ok: false, reason: 'It belongs to another user or the system.', needsAdmin: true } : /^\s*0\s*$/.test(out) ? { ok: true } : { ok: false, reason: out.trim() || 'It did not work.' };
  }
  const sig: Signal = stop ? 'SIGSTOP' : 'SIGCONT';
  return admin ? asAdmin('signal', pid, sig) : signal(pid, sig);
}

/** Quits a program and starts it again the same way. Only for the person's own programs. */
async function restart(pid: number): Promise<{ ok: boolean; reason?: string }> {
  const p = info(pid);
  if (!p) return { ok: false, reason: 'It is no longer running.' };
  if (!p.mine) return { ok: false, reason: 'Only your own programs can be restarted. Use Services for system ones.' };
  let launch: () => void;
  if (PLATFORM === 'darwin') {
    const bundle = macAppBundle(p.path);
    if (!bundle || !p.app) return { ok: false, reason: 'On a Mac, Keeper restarts apps only; for anything else the exact way it was started is not known.' };
    launch = () => void run('/usr/bin/open', [bundle]);
  } else if (PLATFORM === 'linux') {
    const [cmd, cwd] = await Promise.all([fsp.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => ''), fsp.readlink(`/proc/${pid}/cwd`).catch(() => undefined)]);
    const args = parseCmdline(cmd);
    const exe = p.path ?? args[0];
    if (!exe || !args.length) return { ok: false, reason: 'How it was started is not known.' };
    launch = () => spawn(exe, args.slice(1), { cwd, detached: true, stdio: 'ignore', argv0: args[0] } as never).unref();
  } else {
    if (!p.path || !p.command) return { ok: false, reason: 'How it was started is not known.' };
    // The command line starts with the program (quoted or not); the rest goes back exactly as it was.
    const rest = p.command.replace(/^\s*("[^"]*"|\S+)\s?/, '');
    launch = () => spawn(p.path!, rest ? [rest] : [], { cwd: path.dirname(p.path!), detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  }
  const q = await quitOne(pid, false, false);
  if (!q.ok) return q;
  if (!(await waitGone(pid, 10_000))) return { ok: false, reason: 'It did not quit within 10 seconds, so it was not started again. Try Force Quit.' };
  try {
    launch();
  } catch (e) {
    return { ok: false, reason: `It quit but could not be started again: ${(e as Error).message}` };
  }
  return { ok: true };
}

export async function setPriority(pid: number, level: PriorityLevel, opts: { admin?: boolean } = {}): Promise<ProcActionResult> {
  const nice = PRIORITIES[level];
  if (nice === undefined) return result(0, [{ pid, reason: 'Unknown priority.' }]);
  const p = info(pid);
  if (p && p.pid === SELF) return result(0, [{ pid, name: p.name, reason: 'Keeper looks after its own priority.' }]);
  if (opts.admin && PLATFORM !== 'win32') {
    const r = await asAdmin('renice', pid, nice);
    return r.ok ? result(1, []) : result(0, [{ pid, name: p?.name, reason: r.reason! }]);
  }
  try {
    os.setPriority(pid, nice);
    return result(1, []);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const denied = code === 'EACCES' || code === 'EPERM' || /denied|permission/i.test((e as Error).message);
    return result(0, [{ pid, name: p?.name, reason: denied ? 'Raising priority, or changing another user’s program, needs an administrator.' : (e as Error).message, needsAdmin: denied && PLATFORM !== 'win32' }]);
  }
}

// ---------------------------------------------------------------- details

export async function details(pid: number): Promise<ProcDetails | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (!latest.length) await sample();
  const p = info(pid);
  if (!p) return null;
  const d: ProcDetails = {
    pid, name: p.name, path: p.path, command: p.command, user: p.user, started: p.started, memory: [{ label: 'In memory now', bytes: p.memory }],
    openFiles: [], connections: [], children: latest.filter((c) => c.ppid === pid).map((c) => ({ pid: c.pid, name: c.name })), notes: [],
  };
  const LIMIT = 300;
  if (PLATFORM === 'linux') {
    const [status, cwd, env, fds] = await Promise.all([
      readText(`/proc/${pid}/status`), fsp.readlink(`/proc/${pid}/cwd`).catch(() => undefined),
      fsp.readFile(`/proc/${pid}/environ`, 'utf8').catch(() => undefined), fsp.readdir(`/proc/${pid}/fd`).catch(() => undefined),
    ]);
    d.cwd = cwd;
    d.envCount = env === undefined ? undefined : env.split('\0').filter(Boolean).length;
    const m = parseStatusMemory(status ?? '');
    const labels: Record<string, string> = { RssAnon: 'Private (its own data)', RssFile: 'Files and libraries', RssShmem: 'Shared', VmSwap: 'Swapped to disk', VmSize: 'Address space reserved', VmPeak: 'Most reserved at once' };
    for (const [k, l] of Object.entries(labels)) if (m[k] !== undefined) d.memory.push({ label: l, bytes: m[k] });
    if (!fds) d.notes.push('Open files and connections are only visible for your own programs.');
    else {
      const links = await Promise.all(fds.slice(0, 2000).map((fd) => fsp.readlink(`/proc/${pid}/fd/${fd}`).catch(() => '')));
      const sockets = new Set(links.map((l) => l.match(/^socket:\[(\d+)\]$/)?.[1]).filter(Boolean) as string[]);
      const files = links.filter((l) => l.startsWith('/') && !l.startsWith('/dev/'));
      d.openFiles = [...new Set(files)].slice(0, LIMIT);
      if (files.length > LIMIT) d.openFilesMore = files.length - LIMIT;
      for (const proto of ['tcp', 'tcp6', 'udp', 'udp6']) {
        const t = (await readText(`/proc/net/${proto}`)) ?? '';
        for (const l of t.split('\n').slice(1)) {
          const f = l.trim().split(/\s+/);
          if (f.length > 9 && sockets.has(f[9])) d.connections.push({ proto, local: hexAddr(f[1]), remote: f[2].endsWith(':0000') ? undefined : hexAddr(f[2]), state: proto.startsWith('tcp') ? TCP_STATES[f[3]] : undefined });
        }
      }
    }
  } else if (PLATFORM === 'darwin') {
    const r = await run('/usr/sbin/lsof', ['-nP', '-p', String(pid), '-F', 'ftn'], 10_000);
    let fd = '';
    let type = '';
    for (const l of r.stdout.split('\n')) {
      if (l.startsWith('f')) fd = l.slice(1);
      else if (l.startsWith('t')) type = l.slice(1);
      else if (l.startsWith('n')) {
        const n = l.slice(1);
        if (fd === 'cwd') d.cwd = n;
        else if (type === 'REG' && n.startsWith('/')) d.openFiles.push(n);
        else if (type === 'IPv4' || type === 'IPv6') {
          const [local, remote] = n.split('->');
          d.connections.push({ proto: type, local: local.replace(/ \(.*\)$/, ''), remote: remote?.replace(/ \(.*\)$/, ''), state: n.match(/\((\w+)\)$/)?.[1] });
        }
      }
    }
    if (d.openFiles.length > LIMIT) {
      d.openFilesMore = d.openFiles.length - LIMIT;
      d.openFiles = d.openFiles.slice(0, LIMIT);
    }
    if (!r.ok && !r.stdout) d.notes.push('Open files and connections are only visible for your own apps.');
  } else {
    const out = await ps().exec(
      `$x = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; $c = @(Get-NetTCPConnection -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State); @{ priv = $x.PrivateMemorySize64; paged = $x.PagedMemorySize64; peak = $x.PeakWorkingSet64; c = @($c | ForEach-Object { @{ l = "$($_.LocalAddress):$($_.LocalPort)"; r = "$($_.RemoteAddress):$($_.RemotePort)"; s = "$($_.State)" } }) } | ConvertTo-Json -Compress -Depth 3`,
    ).catch(() => '{}');
    try {
      const j = JSON.parse(out.trim() || '{}') as { priv?: number; paged?: number; peak?: number; c?: { l: string; r: string; s: string }[] | { l: string; r: string; s: string } };
      if (j.priv) d.memory.push({ label: 'Private (its own data)', bytes: j.priv });
      if (j.paged) d.memory.push({ label: 'Can be paged out', bytes: j.paged });
      if (j.peak) d.memory.push({ label: 'Most in memory at once', bytes: j.peak });
      for (const c of Array.isArray(j.c) ? j.c : j.c ? [j.c] : []) d.connections.push({ proto: 'TCP', local: c.l, remote: c.r.startsWith('0.0.0.0') || c.r.startsWith('::') ? undefined : c.r, state: c.s });
    } catch {
      /* nothing extra */
    }
    d.notes.push('Windows does not list a program’s open files without extra tools, so only connections are shown.');
  }
  return d;
}

const TCP_STATES: Record<string, string> = { '01': 'Established', '02': 'Syn sent', '03': 'Syn received', '04': 'Fin wait', '05': 'Fin wait 2', '06': 'Time wait', '07': 'Closed', '08': 'Close wait', '09': 'Last ack', '0A': 'Listening', '0B': 'Closing' };

function hexAddr(s: string): string {
  const [ip, port] = s.split(':');
  const p = parseInt(port, 16);
  if (ip.length === 8) return `${[3, 2, 1, 0].map((i) => parseInt(ip.slice(i * 2, i * 2 + 2), 16)).join('.')}:${p}`;
  // IPv6: four little-endian 32-bit words.
  const words = ip.match(/.{8}/g) ?? [];
  const bytes = words.flatMap((w) => [3, 2, 1, 0].map((i) => w.slice(i * 2, i * 2 + 2)));
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push(parseInt(bytes[i] + bytes[i + 1], 16).toString(16));
  return `[${groups.join(':').replace(/(^|:)0(:0)+(:|$)/, '::')}]:${p}`;
}

// ---------------------------------------------------------------- icons, reveal, apps

const iconCache = new Map<string, string>();

export async function icons(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all([...new Set(paths)].slice(0, 200).map(async (p) => {
    if (!p || !path.isAbsolute(p)) return;
    // A Mac app's icon belongs to its bundle, not the program inside it.
    const target = PLATFORM === 'darwin' ? macAppBundle(p) ?? p : p;
    let v = iconCache.get(target);
    if (v === undefined) {
      try {
        const img = await app.getFileIcon(target, { size: 'small' });
        v = img.isEmpty() ? '' : img.toDataURL();
      } catch {
        v = '';
      }
      if (iconCache.size > 600) iconCache.delete(iconCache.keys().next().value!);
      iconCache.set(target, v);
    }
    if (v) out[p] = v;
  }));
  return out;
}

export async function reveal(p: string) {
  if (p && path.isAbsolute(p)) shell.showItemInFolder(PLATFORM === 'darwin' ? macAppBundle(p) ?? p : p);
}

export async function apps(): Promise<ForceQuitApp[]> {
  if (PLATFORM === 'win32') {
    const out = await ps().exec("@(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object Id,ProcessName,Path,Responding) | ConvertTo-Json -Compress").catch(() => '[]');
    try {
      const v = JSON.parse(out.trim() || '[]') as { Id: number; ProcessName: string; Path?: string; Responding?: boolean }[] | { Id: number; ProcessName: string; Path?: string; Responding?: boolean };
      return (Array.isArray(v) ? v : [v]).filter((a) => a.Id !== SELF).map((a) => ({ pid: a.Id, name: a.ProcessName, path: a.Path, notResponding: a.Responding === false }));
    } catch {
      return [];
    }
  }
  const s = await sample();
  if (PLATFORM === 'darwin') return s.procs.filter((p) => p.app && p.mine && p.pid !== SELF).map((p) => ({ pid: p.pid, name: macAppBundle(p.path)!.split('/').pop()!.replace(/\.app$/, ''), path: p.path }));
  // Linux: the person's programs that talk to the display and were not started by another program of theirs.
  const mine = s.procs.filter((p) => p.mine && p.pid !== SELF);
  const byPid = new Map(s.procs.map((p) => [p.pid, p]));
  const gui = await Promise.all(mine.map(async (p) => {
    const env = await fsp.readFile(`/proc/${p.pid}/environ`, 'utf8').catch(() => '');
    if (!/(^|\0)(DISPLAY|WAYLAND_DISPLAY)=/.test(env)) return null;
    if (/^(bash|sh|zsh|fish|dash|dbus-.*|at-spi.*|gvfs.*|xdg-.*|ibus.*|gsd-.*|pipewire.*|wireplumber|pulseaudio|systemd|gnome-.*|kde.*|kwin.*|plasma.*|evolution-.*|tracker.*|Xwayland|Xorg|ssh-agent|gpg-agent|xdg-desktop-portal.*)$/.test(p.name)) return null;
    const parent = byPid.get(p.ppid);
    // A helper started by the same program is part of it.
    if (parent?.mine && parent.path && parent.path === p.path) return null;
    if (/\b(type=(renderer|gpu-process|utility|zygote))/.test(p.command ?? '')) return null;
    return { pid: p.pid, name: p.name, path: p.path } as ForceQuitApp;
  }));
  return gui.filter((x): x is ForceQuitApp => !!x);
}

export async function restartKeeper() {
  app.relaunch();
  app.quit();
}

// ---------------------------------------------------------------- services

export async function services(): Promise<{ supported: boolean; services: ServiceRow[]; note?: string }> {
  if (PLATFORM === 'linux') {
    const args = ['list-units', '--type=service', '--all', '--no-legend', '--plain', '--no-pager'];
    const files = ['list-unit-files', '--type=service', '--no-legend', '--no-pager'];
    const [sys, usr, sysF, usrF] = await Promise.all([run('systemctl', args, 15_000), run('systemctl', ['--user', ...args], 15_000), run('systemctl', files, 15_000), run('systemctl', ['--user', ...files], 15_000)]);
    if (!sys.ok && !usr.ok) return { supported: false, services: [], note: 'This system does not use systemd, so Keeper cannot list its services.' };
    const en = new Map([...parseUnitFiles(sysF.stdout), ...parseUnitFiles(usrF.stdout)]);
    const list = [...parseSystemctlUnits(usr.stdout, 'user'), ...parseSystemctlUnits(sys.stdout, 'system')];
    for (const s of list) s.enabled = en.get(s.id);
    return { supported: true, services: list };
  }
  if (PLATFORM === 'darwin') {
    const r = await run('/bin/launchctl', ['list'], 15_000);
    const user = parseLaunchctlList(r.stdout, 'user');
    // System daemons: names from their definition files; whether they run comes from the process list.
    const sys: ServiceRow[] = [];
    for (const dir of ['/Library/LaunchDaemons']) {
      for (const f of await fsp.readdir(dir).catch(() => [] as string[])) if (f.endsWith('.plist')) sys.push({ id: f.replace(/\.plist$/, ''), name: f.replace(/\.plist$/, ''), scope: 'system', state: 'other' });
    }
    return { supported: true, services: [...user, ...sys], note: 'Apple’s own system services are protected and not listed.' };
  }
  const out = await ps().exec('@(Get-CimInstance Win32_Service -Property Name,DisplayName,State,StartMode,Description,ProcessId | Select-Object Name,DisplayName,State,StartMode,Description,ProcessId) | ConvertTo-Json -Compress', 30_000).catch(() => '[]');
  return { supported: true, services: parseWinServices(out.trim()) };
}

export async function serviceAction(id: string, scope: 'user' | 'system', action: 'start' | 'stop' | 'restart' | 'enable' | 'disable'): Promise<ProcActionResult> {
  if (!safeServiceName(id) || !['start', 'stop', 'restart', 'enable', 'disable'].includes(action)) return result(0, [{ pid: 0, name: id, reason: 'Not a service name Keeper will pass on.' }]);
  const fail = (reason: string) => result(0, [{ pid: 0, name: id, reason }]);
  if (PLATFORM === 'linux') {
    const r = scope === 'user' ? await run('systemctl', ['--user', action, id], 60_000) : await run('pkexec', ['systemctl', action, id], 120_000);
    return r.ok ? result(1, []) : fail(r.stderr.trim().split('\n')[0] || 'It did not work.');
  }
  if (PLATFORM === 'darwin') {
    const target = scope === 'user' ? `gui/${MY_UID}/${id}` : `system/${id}`;
    const sub = { start: ['kickstart', target], stop: ['kill', 'SIGTERM', target], restart: ['kickstart', '-k', target], enable: ['enable', target], disable: ['disable', target] }[action];
    if (scope === 'user') {
      const r = await run('/bin/launchctl', sub, 30_000);
      return r.ok ? result(1, []) : fail(r.stderr.trim() || 'It did not work.');
    }
    // safeServiceName allows no quotes or shell characters, so this line is exactly what it says.
    const r = await run('/usr/bin/osascript', ['-e', `do shell script "/bin/launchctl ${sub.join(' ')}" with administrator privileges`], 120_000);
    return r.ok ? result(1, []) : fail('Administrator permission was not given.');
  }
  const cmd = {
    start: `Start-Service -Name ${psQuote(id)}`,
    stop: `Stop-Service -Name ${psQuote(id)} -Force`,
    restart: `Restart-Service -Name ${psQuote(id)} -Force`,
    enable: `Set-Service -Name ${psQuote(id)} -StartupType Automatic`,
    disable: `Set-Service -Name ${psQuote(id)} -StartupType Manual`,
  }[action];
  // Services need an administrator: start an elevated PowerShell for this one command (Windows asks).
  const inner = `-NoProfile -Command ${cmd.replace(/"/g, '\\"')}`;
  const r = await powershell(`try { $p = Start-Process -FilePath powershell.exe -ArgumentList ${psQuote(inner)} -Verb RunAs -WindowStyle Hidden -PassThru -Wait; exit $p.ExitCode } catch { exit 5 }`, 120_000);
  return r.ok ? result(1, []) : fail('Administrator permission was not given, or the service refused.');
}
