// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reading the system for the monitor: live counters for the menu-bar
// readings, listening ports with their folders, graphics/fans/power, a
// process's environment and who signed it. No Electron here, so the `keeper`
// command line uses the same code. Everything is read on demand; nothing runs
// on its own.

import { existsSync, promises as fsp, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitRootOf, groupDevServers, type DevProject, type ListenerInfo } from '../../core/monitor-devservers';
import { parseAuthenticode, parseCodesign, parseEnviron, parsePackageOwner, parsePsEnv, type CodeSignature } from '../../core/monitor-procinfo';
import {
  linuxBatteryWatts, NVIDIA_PROCS, NVIDIA_QUERY, parseDrmCards, parseHwmon, parseIoregGpu, parseMacBatteryPower, parseNvidiaSmi, parseWinFans, parseWinGpuCounters,
  raplWatts, sensorLimits, winBatteryWatts, type DrmCard, type GpuReading, type HwmonChip, type Sensors,
} from '../../core/monitor-sensors';
import type { LiveReading } from '../../core/monitor-tray';
import { powershell, run } from '../../core/platform';
import { coreUsage, parseCmdline, parseDiskstats, parseIostat, parseMeminfo, parseNetDev, parseNetstatIb, parseProcStat, parseStatusUid } from '../../core/procs';

const PLATFORM = process.platform;
const MY_UID = typeof process.getuid === 'function' ? process.getuid() : -1;

/** A PowerShell runner: the app passes its long-lived one; the CLI starts a fresh one. */
export type PsRunner = (script: string, timeout?: number) => Promise<{ ok: boolean; stdout: string }>;
let ps: PsRunner = (s, t) => powershell(s, t);
export function usePowerShell(fn: PsRunner) {
  ps = fn;
}

function readSmall(p: string): string | undefined {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- live counters

interface Counters { t: number; netIn?: number; netOut?: number; disk?: number; diskR?: number; diskW?: number }

async function counters(): Promise<Counters> {
  const t = Date.now();
  if (PLATFORM === 'linux') {
    const net = parseNetDev(readSmall('/proc/net/dev') ?? '');
    const disk = parseDiskstats(readSmall('/proc/diskstats') ?? '');
    return { t, netIn: net.rx, netOut: net.tx, diskR: disk.read, diskW: disk.write };
  }
  if (PLATFORM === 'darwin') {
    const r = await run('/bin/sh', ['-c', 'netstat -ibn; echo @@KEEPER@@; iostat -Id'], 5000);
    const [n, d] = r.stdout.split('@@KEEPER@@');
    const net = parseNetstatIb(n ?? '');
    return { t, netIn: net.rx, netOut: net.tx, disk: d ? parseIostat(d) : undefined };
  }
  const r = await ps("$n = Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface -Property BytesReceivedPersec,BytesSentPersec; $d = Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk -Filter \"Name='_Total'\" -Property DiskReadBytesPersec,DiskWriteBytesPersec; @{ i = ($n | Measure-Object BytesReceivedPersec -Sum).Sum; o = ($n | Measure-Object BytesSentPersec -Sum).Sum; r = $d.DiskReadBytesPersec; w = $d.DiskWriteBytesPersec } | ConvertTo-Json -Compress", 8000);
  try {
    const j = JSON.parse(r.stdout.trim() || '{}') as { i?: number; o?: number; r?: number; w?: number };
    return { t, netIn: j.i, netOut: j.o, diskR: j.r, diskW: j.w };
  } catch {
    return { t };
  }
}

const perSec = (a: number | undefined, b: number | undefined, ms: number) => (a === undefined || b === undefined || ms <= 0 ? undefined : Math.max(0, Math.round(((b - a) * 1000) / ms)));

function memNow(): { used: number; total: number } {
  if (PLATFORM === 'linux') {
    const m = parseMeminfo(readSmall('/proc/meminfo') ?? '');
    if (m.total && m.available !== undefined) return { used: m.total - m.available, total: m.total };
  }
  return { used: os.totalmem() - os.freemem(), total: os.totalmem() };
}

/**
 * Live readings from counters: processor and memory cost nothing to read;
 * network and disk are one small file read (Linux), one short command (Mac)
 * or one question to the open PowerShell (Windows). Extra sensors only when asked.
 */
export class LiveSampler {
  private cores = os.cpus();
  private last?: Counters;
  private rapl = new Map<string, { uj: number; t: number }>();

  async read(opts: { gpu?: boolean; temp?: boolean; power?: boolean; battery?: () => Promise<{ percent: number; charging: boolean } | undefined> } = {}): Promise<LiveReading> {
    const now = os.cpus();
    const cpu = coreUsage(this.cores, now);
    this.cores = now;
    const c = await counters();
    const prev = this.last;
    this.last = c;
    const ms = prev ? c.t - prev.t : 0;
    const mem = memNow();
    const r: LiveReading = { t: c.t, cpu: cpu.total, perCore: cpu.perCore, memUsed: mem.used, memTotal: mem.total };
    if (prev) {
      r.netIn = perSec(prev.netIn, c.netIn, ms);
      r.netOut = perSec(prev.netOut, c.netOut, ms);
      if (c.disk !== undefined) r.diskR = perSec(prev.disk, c.disk, ms);
      else {
        r.diskR = perSec(prev.diskR, c.diskR, ms);
        r.diskW = perSec(prev.diskW, c.diskW, ms);
      }
    }
    if (opts.gpu || opts.temp || opts.power) {
      const s = await readSensors({ gpu: opts.gpu, fans: false, temps: opts.temp, power: opts.power, quick: true }, this.rapl);
      if (opts.gpu && s.gpus.length) r.gpu = Math.max(...s.gpus.map((g) => g.util ?? 0));
      if (opts.temp && s.temps.length) r.temp = s.temps[0].celsius;
      if (opts.power) r.power = s.power.package ?? (s.power.battery !== undefined && s.power.battery > 0 ? s.power.battery : undefined);
    }
    if (opts.battery) {
      const b = await opts.battery().catch(() => undefined);
      if (b && Number.isFinite(b.percent)) {
        r.battery = b.percent;
        r.charging = b.charging;
      }
    }
    return r;
  }
}

// ---------------------------------------------------------------- sensors

let nvidiaMissingUntil = 0;

async function nvidia(): Promise<GpuReading[]> {
  if (Date.now() < nvidiaMissingUntil) return [];
  const r = await run('nvidia-smi', NVIDIA_QUERY, 5000);
  if (!r.ok) {
    // Not installed: do not try again for ten minutes.
    nvidiaMissingUntil = Date.now() + 10 * 60_000;
    return [];
  }
  const p = await run('nvidia-smi', NVIDIA_PROCS, 5000);
  return parseNvidiaSmi(r.stdout, p.ok ? p.stdout : '');
}

function drmCards(): DrmCard[] {
  const out: DrmCard[] = [];
  let names: string[] = [];
  try {
    names = readdirSync('/sys/class/drm').filter((n) => /^card\d+$/.test(n));
  } catch {
    return out;
  }
  for (const card of names) {
    const dev = `/sys/class/drm/${card}/device`;
    const vendor = readSmall(`${dev}/vendor`);
    if (!vendor) continue;
    out.push({
      card, vendor, busy: readSmall(`${dev}/gpu_busy_percent`), vramUsed: readSmall(`${dev}/mem_info_vram_used`), vramTotal: readSmall(`${dev}/mem_info_vram_total`),
      curFreq: readSmall(`/sys/class/drm/${card}/gt_cur_freq_mhz`) ?? readSmall(`/sys/class/drm/${card}/gt/gt0/rps_cur_freq_mhz`) ?? readSmall(`${dev}/tile0/gt0/freq0/cur_freq`),
      maxFreq: readSmall(`/sys/class/drm/${card}/gt_max_freq_mhz`) ?? readSmall(`/sys/class/drm/${card}/gt/gt0/rps_max_freq_mhz`) ?? readSmall(`${dev}/tile0/gt0/freq0/max_freq`),
    });
  }
  return out;
}

function hwmonChips(): HwmonChip[] {
  const out: HwmonChip[] = [];
  let dirs: string[] = [];
  try {
    dirs = readdirSync('/sys/class/hwmon');
  } catch {
    return out;
  }
  for (const d of dirs) {
    const base = `/sys/class/hwmon/${d}`;
    const name = readSmall(`${base}/name`)?.trim() ?? d;
    const files: Record<string, string> = {};
    let list: string[] = [];
    try {
      list = readdirSync(base).filter((f) => /^(fan\d+_(input|label|max)|temp\d+_(input|label|crit))$/.test(f));
    } catch {
      continue;
    }
    for (const f of list) {
      const v = readSmall(`${base}/${f}`);
      if (v !== undefined) files[f] = v.trim();
    }
    out.push({ name, files });
  }
  return out;
}

function raplRead(state: Map<string, { uj: number; t: number }>): { name: string; watts: number }[] {
  const out: { name: string; watts: number }[] = [];
  let zones: string[] = [];
  try {
    zones = readdirSync('/sys/class/powercap').filter((z) => /^intel-rapl:\d+(:\d+)?$/.test(z));
  } catch {
    return out;
  }
  for (const z of zones) {
    const uj = Number(readSmall(`/sys/class/powercap/${z}/energy_uj`));
    if (!Number.isFinite(uj)) continue;
    const name = readSmall(`/sys/class/powercap/${z}/name`)?.trim() ?? z;
    const max = Number(readSmall(`/sys/class/powercap/${z}/max_energy_range_uj`)) || undefined;
    const t = Date.now();
    const prev = state.get(z);
    state.set(z, { uj, t });
    if (prev) {
      const w = raplWatts(prev.uj, uj, t - prev.t, max);
      if (w !== undefined) out.push({ name: z.split(':').length > 2 ? name : name.replace(/^package-(\d+)$/, 'package $1'), watts: w });
    }
  }
  return out;
}

function linuxBattery(): number | undefined {
  try {
    for (const b of readdirSync('/sys/class/power_supply')) {
      const base = `/sys/class/power_supply/${b}`;
      if (readSmall(`${base}/type`)?.trim() !== 'Battery') continue;
      const w = linuxBatteryWatts({ status: readSmall(`${base}/status`), power_now: readSmall(`${base}/power_now`), current_now: readSmall(`${base}/current_now`), voltage_now: readSmall(`${base}/voltage_now`) });
      if (w !== undefined) return w;
    }
  } catch {
    /* no power supplies */
  }
  return undefined;
}

const defaultRapl = new Map<string, { uj: number; t: number }>();

/** Graphics, fans, temperatures and power, each only through public interfaces. */
export async function readSensors(want: { gpu?: boolean; fans?: boolean; temps?: boolean; power?: boolean; quick?: boolean } = { gpu: true, fans: true, temps: true, power: true }, raplState = defaultRapl): Promise<Sensors> {
  const s: Sensors = { gpus: [], fans: [], temps: [], power: { source: [] }, limits: [] };
  if (want.gpu) s.gpus.push(...(await nvidia()));
  if (PLATFORM === 'linux') {
    if (want.gpu) s.gpus.push(...parseDrmCards(drmCards()));
    if (want.fans || want.temps) {
      const h = parseHwmon(hwmonChips());
      if (want.fans) s.fans = h.fans;
      if (want.temps) s.temps = h.temps;
    }
    if (want.power) {
      // RAPL needs two readings; the first look fills the baseline and a quick second one follows.
      let domains = raplRead(raplState);
      if (!domains.length && raplState.size && !want.quick) {
        await new Promise((r) => setTimeout(r, 250));
        domains = raplRead(raplState);
      }
      if (domains.length) {
        s.power.domains = domains;
        s.power.package = Math.round(domains.filter((d) => /^package/.test(d.name)).reduce((a, d) => a + d.watts, 0) * 100) / 100 || undefined;
        s.power.source.push('RAPL (powercap)');
      }
      const b = linuxBattery();
      if (b !== undefined) {
        s.power.battery = b;
        s.power.source.push('battery (power_supply)');
      }
    }
  } else if (PLATFORM === 'darwin') {
    if (want.gpu) {
      const r = await run('/usr/sbin/ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], 5000);
      if (r.ok) s.gpus.push(...parseIoregGpu(r.stdout));
    }
    if (want.power) {
      const r = await run('/usr/sbin/ioreg', ['-rn', 'AppleSmartBattery'], 5000);
      const w = r.ok ? parseMacBatteryPower(r.stdout) : undefined;
      if (w !== undefined) {
        s.power.battery = w;
        s.power.source.push('battery (ioreg AppleSmartBattery)');
      }
    }
  } else if (PLATFORM === 'win32') {
    const parts: string[] = [];
    if (want.gpu) parts.push("g = @((Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples | Where-Object { $_.CookedValue -gt 0 } | Select-Object InstanceName,CookedValue)");
    if (want.power) parts.push('b = @(Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue | Select-Object DischargeRate,ChargeRate,Discharging)');
    if (want.fans) parts.push('f = @(Get-CimInstance Win32_Fan -ErrorAction SilentlyContinue | Select-Object Name,DeviceID,DesiredSpeed,ActiveCooling)');
    if (want.temps) parts.push('t = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object InstanceName,CurrentTemperature,CriticalTripPoint)');
    if (parts.length) {
      const r = await ps(`@{ ${parts.join('; ')} } | ConvertTo-Json -Compress -Depth 3`, 15_000);
      try {
        const j = JSON.parse(r.stdout.trim() || '{}') as { g?: { InstanceName: string; CookedValue: number }[]; b?: { DischargeRate?: number; ChargeRate?: number; Discharging?: boolean }[]; f?: { Name?: string; DeviceID?: string; DesiredSpeed?: number }[]; t?: { InstanceName: string; CurrentTemperature: number; CriticalTripPoint?: number }[] };
        const arr = <T,>(v: T[] | T | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);
        if (want.gpu && !s.gpus.some((g) => g.vendor === 'nvidia')) {
          const g = parseWinGpuCounters(arr(j.g));
          s.gpus.push({ name: 'Graphics', vendor: 'other', util: g.util, source: 'Windows GPU Engine counters' });
        }
        const w = winBatteryWatts(arr(j.b));
        if (w !== undefined) {
          s.power.battery = w;
          s.power.source.push('battery (WMI BatteryStatus)');
        }
        s.fans = parseWinFans(arr(j.f));
        s.temps = arr(j.t).map((t) => ({ label: t.InstanceName.split('\\').pop() ?? 'Zone', celsius: Math.round((t.CurrentTemperature / 10 - 273.15) * 10) / 10, critical: t.CriticalTripPoint ? Math.round(t.CriticalTripPoint / 10 - 273.15) : undefined }))
          .filter((t) => t.celsius > 0 && t.celsius < 150).sort((a, b) => b.celsius - a.celsius);
      } catch {
        /* nothing readable this time */
      }
    }
  }
  s.limits = sensorLimits(PLATFORM, s);
  return s;
}

// ---------------------------------------------------------------- listening ports

const TCP_LISTEN = '0A';
const TCP_ESTABLISHED = '01';

function hexPort(local: string): { addr: string; port: number } {
  const [ip, port] = local.split(':');
  const p = parseInt(port, 16);
  if (ip.length === 8) return { addr: [3, 2, 1, 0].map((i) => parseInt(ip.slice(i * 2, i * 2 + 2), 16)).join('.'), port: p };
  return { addr: /^0+$/.test(ip) ? '::' : ip === '00000000000000000000000001000000' ? '::1' : 'ipv6', port: p };
}

function linuxListeners(): ListenerInfo[] {
  // Listening sockets and how many connections each port has.
  const listen = new Map<string, { port: number; addr: string }>();
  const est = new Map<number, number>();
  for (const proto of ['tcp', 'tcp6']) {
    const t = readSmall(`/proc/net/${proto}`) ?? '';
    for (const l of t.split('\n').slice(1)) {
      const f = l.trim().split(/\s+/);
      if (f.length < 10) continue;
      const { addr, port } = hexPort(f[1]);
      if (f[3] === TCP_LISTEN) listen.set(f[9], { port, addr });
      else if (f[3] === TCP_ESTABLISHED) est.set(port, (est.get(port) ?? 0) + 1);
    }
  }
  if (!listen.size) return [];
  const out: ListenerInfo[] = [];
  for (const pid of readdirSync('/proc').filter((n) => /^\d+$/.test(n))) {
    let fds: string[];
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      let link = '';
      try {
        link = readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      const inode = link.match(/^socket:\[(\d+)\]$/)?.[1];
      const l = inode ? listen.get(inode) : undefined;
      if (!l) continue;
      const st = parseProcStat(readSmall(`/proc/${pid}/stat`) ?? '');
      const argv = parseCmdline(readSmall(`/proc/${pid}/cmdline`) ?? '');
      let cwd: string | undefined;
      try {
        cwd = readlinkSync(`/proc/${pid}/cwd`);
      } catch {
        cwd = undefined;
      }
      const uid = parseStatusUid(readSmall(`/proc/${pid}/status`) ?? '');
      out.push({ port: l.port, pid: Number(pid), name: st?.name ?? pid, address: l.addr, proto: 'tcp', cwd, argv, command: argv.join(' ') || undefined, mine: uid === MY_UID, established: est.get(l.port) ?? 0 });
      listen.delete(inode!);
    }
  }
  return out;
}

async function macListeners(): Promise<ListenerInfo[]> {
  const r = await run('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-FpcLn'], 10_000);
  const out: ListenerInfo[] = [];
  let pid = 0;
  let name = '';
  let user = '';
  for (const line of r.stdout.split('\n')) {
    const k = line[0];
    const v = line.slice(1);
    if (k === 'p') pid = Number(v);
    else if (k === 'c') name = v;
    else if (k === 'L') user = v;
    else if (k === 'n') {
      const m = v.match(/^(.*):(\d+)$/);
      if (m) out.push({ port: Number(m[2]), pid, name, address: m[1].replace(/^\[|\]$/g, ''), proto: 'tcp', user, mine: user === os.userInfo().username });
    }
  }
  const pids = [...new Set(out.map((o) => o.pid))];
  if (pids.length) {
    const [cw, cmd] = await Promise.all([
      run('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fpn'], 10_000),
      run('/bin/ps', ['-o', 'pid=,args=', '-p', pids.join(',')], 5000),
    ]);
    const cwds = new Map<number, string>();
    let p = 0;
    for (const l of cw.stdout.split('\n')) {
      if (l.startsWith('p')) p = Number(l.slice(1));
      else if (l.startsWith('n')) cwds.set(p, l.slice(1));
    }
    const cmds = new Map<number, string>();
    for (const l of cmd.stdout.split('\n')) {
      const m = l.trim().match(/^(\d+)\s+(.*)$/);
      if (m) cmds.set(Number(m[1]), m[2]);
    }
    for (const o of out) {
      o.cwd = cwds.get(o.pid);
      o.command = cmds.get(o.pid);
    }
  }
  return out;
}

async function winListeners(): Promise<ListenerInfo[]> {
  const r = await ps("$l = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess; $e = Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Group-Object LocalPort | ForEach-Object { @{ p = [int]$_.Name; n = $_.Count } }; $ids = @($l | ForEach-Object { $_.OwningProcess } | Sort-Object -Unique); $p = @(Get-CimInstance Win32_Process -Filter (($ids | ForEach-Object { \"ProcessId=$_\" }) -join ' OR ') -ErrorAction SilentlyContinue | Select-Object ProcessId,Name,CommandLine,ExecutablePath,SessionId); @{ l = @($l); e = @($e); p = $p } | ConvertTo-Json -Compress -Depth 3", 20_000);
  try {
    const j = JSON.parse(r.stdout.trim() || '{}') as { l?: { LocalAddress: string; LocalPort: number; OwningProcess: number }[]; e?: { p: number; n: number }[]; p?: { ProcessId: number; Name: string; CommandLine?: string; ExecutablePath?: string; SessionId?: number }[] };
    const procs = new Map((j.p ?? []).map((p) => [p.ProcessId, p]));
    const est = new Map((j.e ?? []).map((x) => [x.p, x.n]));
    return (j.l ?? []).map((l) => {
      const p = procs.get(l.OwningProcess);
      return { port: l.LocalPort, pid: l.OwningProcess, name: (p?.Name ?? String(l.OwningProcess)).replace(/\.exe$/i, ''), address: l.LocalAddress, proto: 'tcp' as const, command: p?.CommandLine, cwd: folderFromCommand(p?.CommandLine), mine: p ? p.SessionId !== 0 : undefined, established: est.get(l.LocalPort) ?? 0 };
    });
  } catch {
    return [];
  }
}

/** Windows does not show another program's working folder; the first existing folder or file in its command line is the next best thing. */
function folderFromCommand(cmd?: string): string | undefined {
  if (!cmd) return undefined;
  for (const m of cmd.matchAll(/"([A-Za-z]:\\[^"]+)"|([A-Za-z]:\\\S+)/g)) {
    const p = m[1] ?? m[2];
    if (/\\(Program Files|Windows)\\/i.test(p) || /node(\.exe)?$|python\w*(\.exe)?$/i.test(p)) continue;
    try {
      const st = statSync(p);
      return st.isDirectory() ? p : path.dirname(p);
    } catch {
      /* not a path */
    }
  }
  return undefined;
}

/** Every listening TCP port with its process, folder and command line. */
export async function listeners(): Promise<ListenerInfo[]> {
  if (PLATFORM === 'linux') return linuxListeners();
  if (PLATFORM === 'darwin') return macListeners();
  return winListeners();
}

/** Dev servers grouped by project (git root of each server's folder). */
export async function devServers(opts: { all?: boolean; cpu?: Map<number, number> } = {}): Promise<{ projects: DevProject[]; listeners: ListenerInfo[] }> {
  const ls = await listeners();
  for (const l of ls) if (opts.cpu) l.cpu = opts.cpu.get(l.pid);
  const roots = new Map<string, string | undefined>();
  const rootOf = (cwd: string) => {
    if (!roots.has(cwd)) roots.set(cwd, gitRootOf(cwd, existsSync));
    return roots.get(cwd);
  };
  return { projects: groupDevServers(ls, rootOf, { home: os.homedir(), all: opts.all }), listeners: ls };
}

// ---------------------------------------------------------------- environment and signature

/** A process's environment as name/value pairs, or a reason it cannot be read. */
export async function processEnv(pid: number): Promise<{ vars: [string, string][] } | { error: string }> {
  if (!Number.isInteger(pid) || pid <= 0) return { error: 'Not a process' };
  if (PLATFORM === 'linux') {
    try {
      return { vars: parseEnviron(await fsp.readFile(`/proc/${pid}/environ`, 'utf8')) };
    } catch {
      return { error: 'Only your own programs’ environments can be read.' };
    }
  }
  if (PLATFORM === 'darwin') {
    const [withEnv, plain] = await Promise.all([run('/bin/ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)], 5000), run('/bin/ps', ['-ww', '-o', 'command=', '-p', String(pid)], 5000)]);
    const vars = parsePsEnv(withEnv.stdout.trim(), plain.stdout.trim());
    return vars.length ? { vars } : { error: 'macOS shows the environment only for your own programs (and not for protected ones).' };
  }
  return { error: 'Windows has no public way to read another program’s environment without opening its memory, which Keeper does not do.' };
}

const sigCache = new Map<string, CodeSignature>();

/** Who signed a program: codesign (Mac), Authenticode (Windows) or the system package that installed it (Linux). */
export async function codeSignature(file: string): Promise<CodeSignature> {
  if (!file || !path.isAbsolute(file)) return { valid: false, signed: false, source: 'none', note: 'Keeper does not know where this program is.' };
  const cached = sigCache.get(file);
  if (cached) return cached;
  let sig: CodeSignature;
  if (PLATFORM === 'darwin') {
    const bundle = file.match(/^(.*?\.app)\//)?.[1] ?? file;
    const [d, v, e] = await Promise.all([
      run('/usr/bin/codesign', ['-dv', '--verbose=4', bundle], 15_000),
      run('/usr/bin/codesign', ['--verify', '--strict', bundle], 30_000),
      run('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', bundle], 15_000),
    ]);
    sig = parseCodesign(`${d.stdout}\n${d.stderr}`, v.ok, e.stdout);
  } else if (PLATFORM === 'win32') {
    const q = file.replace(/'/g, "''");
    const r = await ps(`$s = Get-AuthenticodeSignature -LiteralPath '${q}'; @{ Status = [int]$s.Status; StatusMessage = $s.StatusMessage; IsOSBinary = $s.IsOSBinary; Subject = $s.SignerCertificate.Subject; Issuer = $s.SignerCertificate.Issuer } | ConvertTo-Json -Compress`, 20_000);
    sig = parseAuthenticode(r.stdout.trim());
  } else {
    const tools: ['dpkg' | 'rpm' | 'pacman', string, string[]][] = [['dpkg', 'dpkg', ['-S', file]], ['rpm', 'rpm', ['-qf', file]], ['pacman', 'pacman', ['-Qo', file]]];
    sig = { valid: false, signed: false, source: 'package', note: 'No system package manager answered.' };
    for (const [tool, bin, args] of tools) {
      const r = await run(bin, args, 10_000);
      if (r.stdout || r.ok) {
        sig = parsePackageOwner(tool, r.stdout);
        if (sig.valid) break;
      }
    }
  }
  if (sigCache.size > 200) sigCache.clear();
  sigCache.set(file, sig);
  return sig;
}

// ---------------------------------------------------------------- running agents

/** The working folder of each process (roots of agent sessions); Linux reads /proc, a Mac asks lsof once. */
export async function cwdsOf(pids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!pids.length) return out;
  if (PLATFORM === 'linux') {
    for (const p of pids) {
      try {
        out.set(p, readlinkSync(`/proc/${p}/cwd`));
      } catch {
        /* not ours */
      }
    }
  } else if (PLATFORM === 'darwin') {
    const r = await run('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fpn'], 10_000);
    let p = 0;
    for (const l of r.stdout.split('\n')) {
      if (l.startsWith('p')) p = Number(l.slice(1));
      else if (l.startsWith('n')) out.set(p, l.slice(1));
    }
  }
  return out;
}

/** Running coding agents, AI tools and local model servers, each with everything it started, its folder, project and ports. */
export async function runningAgents(procs: { pid: number; ppid: number; name: string; command?: string; cpu?: number; memory?: number }[]): Promise<import('../../core/api-sysmon').RunningAgent[]> {
  const { detectAgents } = await import('../../core/agents-detect');
  const found = detectAgents(procs);
  const cwds = await cwdsOf(found.map((a) => a.pid));
  const ls = found.length ? await listeners().catch(() => [] as ListenerInfo[]) : [];
  return found.map((a) => {
    const cwd = cwds.get(a.pid) ?? (PLATFORM === 'win32' ? folderFromCommand(a.command) : undefined);
    const root = cwd ? gitRootOf(cwd, existsSync) ?? cwd : undefined;
    const set = new Set(a.pids);
    return {
      key: a.key, id: a.agent.id, label: a.agent.label, kind: a.agent.kind, pid: a.pid, pids: a.pids, cpu: a.cpu, memory: a.memory, command: a.command, cwd,
      project: root && root !== os.homedir() ? path.basename(root) : undefined, ports: [...new Set(ls.filter((l) => set.has(l.pid)).map((l) => l.port))].sort((x, y) => x - y),
    };
  });
}
