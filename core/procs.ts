// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The process manager's pure side: reading what each operating system reports
// about running programs and services, CPU and disk rates from counters,
// trees, grouping helpers under their app, and which processes must never be
// stopped. No I/O here, so every piece is tested.

import type { MemoryPressure } from './memory';

export interface ProcRow {
  pid: number;
  ppid: number;
  name: string;
  /** user name, or 'system' / 'you' where only that is known */
  user?: string;
  /** true when it runs as the person using Keeper */
  mine: boolean;
  /** % of one processor core (100 = one core fully busy) */
  cpu: number;
  /** resident memory in bytes */
  memory: number;
  threads?: number;
  /** R running, S sleeping, T stopped (suspended), Z zombie, D waiting on disk, I idle */
  state?: string;
  nice?: number;
  /** ms since epoch */
  started?: number;
  path?: string;
  command?: string;
  /** bytes per second read from and written to disk (or all I/O on Windows) */
  readRate?: number;
  writeRate?: number;
  /** open network connections, filled on the Network tab only */
  connections?: number;
  /** rough energy impact: busy processor time weighted with I/O; an estimate, not a measurement */
  energy?: number;
  /** has a window the person can see (Windows), or is an app bundle (Mac) */
  app?: boolean;
}

export interface SystemRates {
  /** % of all cores together, 0–100 */
  cpu: number;
  perCore: number[];
  memUsed: number;
  memTotal: number;
  /** memory the system can hand out without swapping, when known */
  memAvailable?: number;
  /** macOS memory pressure: what the memory reading's colour follows there */
  memPressure?: MemoryPressure;
  /** file cache the system gives back when asked (macOS Cached Files) */
  memCached?: number;
  /** macOS: memory the compressor holds */
  memCompressed?: number;
  swapUsed?: number;
  swapTotal?: number;
  diskRead?: number;
  diskWrite?: number;
  netIn?: number;
  netOut?: number;
}

export interface ProcSample {
  t: number;
  procs: ProcRow[];
  system: SystemRates;
  /** what this operating system can't tell cheaply, so the interface can say so */
  unavailable: ('threads' | 'disk' | 'user' | 'network')[];
  /** Keeper's own process id, never offered for quitting from the list */
  self: number;
}

export interface ServiceRow {
  /** unit name, launchd label or Windows service name */
  id: string;
  name: string;
  description?: string;
  state: 'running' | 'stopped' | 'failed' | 'other';
  /** starts on its own at boot or login */
  enabled?: boolean;
  pid?: number;
  /** 'user' services can be changed without an administrator password */
  scope: 'user' | 'system';
}

// ---------------------------------------------------------------- counters to rates

/** CPU % of one core from two readings of cumulative processor time (ms) taken `elapsedMs` apart. */
export function cpuPercent(prevMs: number | undefined, nowMs: number, elapsedMs: number): number {
  if (prevMs === undefined || elapsedMs <= 0 || nowMs < prevMs) return 0;
  return Math.round(((nowMs - prevMs) / elapsedMs) * 1000) / 10;
}

/** Bytes per second from two cumulative byte counters. */
export function rate(prev: number | undefined, now: number | undefined, elapsedMs: number): number | undefined {
  if (prev === undefined || now === undefined || elapsedMs <= 0) return undefined;
  if (now < prev) return 0;
  return Math.round(((now - prev) * 1000) / elapsedMs);
}

/** A rough, comparable energy number (0–100+): processor time dominates, heavy disk use adds. */
export function energyImpact(cpu: number, ioBytesPerSec = 0): number {
  return Math.round((cpu + Math.min(40, ioBytesPerSec / (2 * 1024 * 1024))) * 10) / 10;
}

/** Total and per-core CPU use from two os.cpus() readings. */
export function coreUsage(prev: { times: Record<string, number> }[], now: { times: Record<string, number> }[]): { total: number; perCore: number[] } {
  let busyAll = 0;
  let allAll = 0;
  const perCore = now.map((c, i) => {
    const p = prev[i]?.times ?? c.times;
    const all = Object.keys(c.times).reduce((s, k) => s + (c.times[k] - (p[k] ?? 0)), 0);
    const idle = c.times.idle - (p.idle ?? 0);
    busyAll += all - idle;
    allAll += all;
    return all > 0 ? Math.round(((all - idle) / all) * 1000) / 10 : 0;
  });
  return { total: allAll > 0 ? Math.round((busyAll / allAll) * 1000) / 10 : 0, perCore };
}

// ---------------------------------------------------------------- Linux /proc

export interface LinuxStat {
  pid: number;
  name: string;
  state: string;
  ppid: number;
  /** utime + stime in clock ticks */
  ticks: number;
  nice: number;
  threads: number;
  /** ticks after boot */
  starttime: number;
  rssPages: number;
}

/** /proc/<pid>/stat. The name sits in brackets and may itself contain spaces and brackets. */
export function parseProcStat(text: string): LinuxStat | null {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const pid = Number(text.slice(0, open).trim());
  const f = text.slice(close + 2).trim().split(/\s+/);
  // f[0] is field 3 (state); field n is f[n - 3].
  if (!Number.isFinite(pid) || f.length < 22) return null;
  return {
    pid,
    name: text.slice(open + 1, close),
    state: f[0],
    ppid: Number(f[1]),
    ticks: Number(f[11]) + Number(f[12]),
    nice: Number(f[16]),
    threads: Number(f[17]),
    starttime: Number(f[19]),
    rssPages: Number(f[21]),
  };
}

/** /proc/<pid>/io → bytes really read from and written to storage. */
export function parseProcIo(text: string): { read: number; write: number } | null {
  const r = text.match(/^read_bytes:\s*(\d+)/m);
  const w = text.match(/^write_bytes:\s*(\d+)/m);
  return r && w ? { read: Number(r[1]), write: Number(w[1]) } : null;
}

/** The real user id from /proc/<pid>/status. */
export function parseStatusUid(text: string): number | undefined {
  const m = text.match(/^Uid:\s*(\d+)/m);
  return m ? Number(m[1]) : undefined;
}

/** Memory breakdown from /proc/<pid>/status, in bytes. */
export function parseStatusMemory(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of ['VmRSS', 'RssAnon', 'RssFile', 'RssShmem', 'VmSwap', 'VmSize', 'VmPeak']) {
    const m = text.match(new RegExp(`^${k}:\\s*(\\d+)\\s*kB`, 'm'));
    if (m) out[k] = Number(m[1]) * 1024;
  }
  return out;
}

/** /proc/<pid>/cmdline: arguments separated by NUL. */
export function parseCmdline(buf: string): string[] {
  return buf.split('\0').filter((s, i, a) => s !== '' || i < a.length - 1).filter(Boolean);
}

/** /etc/passwd → uid to name. */
export function parsePasswd(text: string): Map<number, string> {
  const m = new Map<number, string>();
  for (const l of text.split('\n')) {
    const f = l.split(':');
    if (f.length >= 3 && /^\d+$/.test(f[2])) m.set(Number(f[2]), f[0]);
  }
  return m;
}

/** /proc/stat: boot time (seconds since epoch). */
export function parseBootTime(text: string): number | undefined {
  const m = text.match(/^btime\s+(\d+)/m);
  return m ? Number(m[1]) : undefined;
}

/** /proc/meminfo, in bytes. */
export function parseMeminfo(text: string): { total?: number; available?: number; swapTotal?: number; swapFree?: number } {
  const g = (k: string) => {
    const m = text.match(new RegExp(`^${k}:\\s*(\\d+)`, 'm'));
    return m ? Number(m[1]) * 1024 : undefined;
  };
  return { total: g('MemTotal'), available: g('MemAvailable'), swapTotal: g('SwapTotal'), swapFree: g('SwapFree') };
}

/** /proc/diskstats → sectors read and written by whole disks (partitions and virtual devices skipped), as bytes. */
export function parseDiskstats(text: string): { read: number; write: number } {
  let read = 0;
  let write = 0;
  for (const l of text.split('\n')) {
    const f = l.trim().split(/\s+/);
    if (f.length < 10) continue;
    const name = f[2];
    if (/^(loop|ram|dm-|zram|sr|fd)/.test(name)) continue;
    // Whole disks only: sda not sda1, nvme0n1 not nvme0n1p1, mmcblk0 not mmcblk0p1.
    if (/^(sd|hd|vd|xvd)[a-z]+\d+$/.test(name) || /^(nvme\d+n\d+|mmcblk\d+)p\d+$/.test(name)) continue;
    read += Number(f[5]) * 512;
    write += Number(f[9]) * 512;
  }
  return { read, write };
}

/** /proc/net/dev → bytes received and sent on every interface except loopback. */
export function parseNetDev(text: string): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  for (const l of text.split('\n').slice(2)) {
    const m = l.match(/^\s*([^:]+):\s*(.*)$/);
    if (!m || m[1].trim() === 'lo') continue;
    const f = m[2].trim().split(/\s+/);
    rx += Number(f[0]) || 0;
    tx += Number(f[8]) || 0;
  }
  return { rx, tx };
}

/** Socket inodes from /proc/net/tcp, tcp6, udp, udp6 (header line skipped). */
export function parseNetSockets(text: string): Set<string> {
  const s = new Set<string>();
  for (const l of text.split('\n').slice(1)) {
    const f = l.trim().split(/\s+/);
    if (f.length > 9 && f[9] !== '0') s.add(f[9]);
  }
  return s;
}

// ---------------------------------------------------------------- macOS / BSD ps

/** "1-02:03:04.56", "02:03.45" or "0:01.23" (ps time / etime) → milliseconds. */
export function parsePsTime(s: string): number {
  const m = s.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return 0;
  return Math.round(((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 3600 + Number(m[3]) * 60 + Number(m[4])) * 1000);
}

export interface PsRow {
  pid: number;
  ppid: number;
  uid: number;
  cpu: number;
  rss: number;
  state: string;
  nice: number;
  /** cumulative processor time, ms */
  cpuMs: number;
  /** ms since it started */
  elapsedMs: number;
}

/** `ps -axo pid=,ppid=,uid=,pcpu=,rss=,state=,nice=,time=,etime=` — fixed fields, nothing with spaces. */
export function parsePsLine(line: string): PsRow | null {
  const f = line.trim().split(/\s+/);
  if (f.length < 9 || !/^\d+$/.test(f[0])) return null;
  return {
    pid: Number(f[0]),
    ppid: Number(f[1]),
    uid: Number(f[2]),
    cpu: Number(f[3]) || 0,
    rss: Number(f[4]) * 1024,
    state: f[5].charAt(0),
    nice: Number(f[6]) || 0,
    cpuMs: parsePsTime(f[7]),
    elapsedMs: parsePsTime(f[8]),
  };
}

/** `ps -axo pid=,comm=` or `pid=,args=`: the pid, then the rest of the line as is (paths may contain spaces). */
export function parsePidRest(text: string): Map<number, string> {
  const m = new Map<number, string>();
  for (const l of text.split('\n')) {
    const r = l.match(/^\s*(\d+)\s(.*)$/);
    if (r) m.set(Number(r[1]), r[2].trim());
  }
  return m;
}

/** `netstat -ibn`: bytes in and out over every non-loopback interface (link rows only, so nothing is counted twice). */
export function parseNetstatIb(text: string): { rx: number; tx: number } {
  const lines = text.split('\n');
  const head = lines[0]?.trim().split(/\s+/) ?? [];
  const ib = head.indexOf('Ibytes');
  const ob = head.indexOf('Obytes');
  let rx = 0;
  let tx = 0;
  const seen = new Set<string>();
  for (const l of lines.slice(1)) {
    const f = l.trim().split(/\s+/);
    if (!f[0] || f[0].startsWith('lo') || !/<Link#\d+>/.test(f[2] ?? '') || seen.has(f[0])) continue;
    seen.add(f[0]);
    // Rows without an address have one field fewer, so count from the end.
    const off = f.length - head.length;
    rx += Number(f[ib + off]) || 0;
    tx += Number(f[ob + off]) || 0;
  }
  return { rx, tx };
}

/** `iostat -Id`: cumulative megabytes transferred per disk → bytes (read and write are not separated). */
export function parseIostat(text: string): number {
  const lines = text.trim().split('\n');
  const vals = lines[lines.length - 1]?.trim().split(/\s+/).map(Number) ?? [];
  let total = 0;
  for (let i = 2; i < vals.length; i += 3) total += Number.isFinite(vals[i]) ? vals[i] * 1024 * 1024 : 0;
  return total;
}

/** `sysctl vm.swapusage`: "total = 2048.00M  used = 1024.50M  free = ..." */
export function parseSwapusage(text: string): { total?: number; used?: number } {
  const n = (k: string) => {
    const m = text.match(new RegExp(`${k} = ([\\d.]+)([KMG])`));
    return m ? Number(m[1]) * { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2] as 'K' | 'M' | 'G'] : undefined;
  };
  return { total: n('total'), used: n('used') };
}

/** The app bundle a Mac process belongs to: the outermost ".app" in its path. */
export function macAppBundle(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const i = path.indexOf('.app/');
  return i > 0 ? path.slice(0, i + 4) : path.endsWith('.app') ? path : undefined;
}

// ---------------------------------------------------------------- Windows

export interface WinProcJson {
  ProcessId: number;
  ParentProcessId: number;
  Name: string;
  WorkingSetSize?: number | string;
  ThreadCount?: number;
  /** 100-nanosecond units */
  KernelModeTime?: number | string;
  UserModeTime?: number | string;
  ReadTransferCount?: number | string;
  WriteTransferCount?: number | string;
  CreationDate?: string;
  ExecutablePath?: string | null;
  CommandLine?: string | null;
  SessionId?: number;
  Priority?: number;
}

export interface WinRaw {
  pid: number;
  ppid: number;
  name: string;
  memory: number;
  threads?: number;
  cpuMs: number;
  read?: number;
  write?: number;
  started?: number;
  path?: string;
  command?: string;
  session?: number;
}

/** "/Date(1700000000000)/" (ConvertTo-Json in Windows PowerShell) or an ISO string. */
export function parseWinDate(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = String(v).match(/\/Date\((\d+)/);
  if (m) return Number(m[1]);
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

export function parseWinProcesses(json: string): WinRaw[] {
  let list: WinProcJson[];
  try {
    const v = JSON.parse(json || '[]') as WinProcJson | WinProcJson[];
    list = Array.isArray(v) ? v : [v];
  } catch {
    return [];
  }
  return list.filter((p) => p && typeof p.ProcessId === 'number').map((p) => ({
    pid: p.ProcessId,
    ppid: p.ParentProcessId ?? 0,
    name: String(p.Name ?? '').replace(/\.exe$/i, ''),
    memory: Number(p.WorkingSetSize) || 0,
    threads: p.ThreadCount,
    cpuMs: (Number(p.KernelModeTime ?? 0) + Number(p.UserModeTime ?? 0)) / 10_000,
    read: p.ReadTransferCount === undefined ? undefined : Number(p.ReadTransferCount),
    write: p.WriteTransferCount === undefined ? undefined : Number(p.WriteTransferCount),
    started: parseWinDate(p.CreationDate),
    path: p.ExecutablePath ?? undefined,
    command: p.CommandLine ?? undefined,
    session: p.SessionId,
  }));
}

/**
 * Quotes a value for PowerShell inside single quotes: the only special
 * character there is the quote itself (and its typographic twins, which
 * PowerShell also treats as quotes).
 */
export function psQuote(s: string): string {
  return `'${String(s).replace(/['‘’‚‛]/g, '$&$&')}'`;
}

/** Names we pass to service managers: letters, digits and a few separators only. */
export function safeServiceName(s: string): boolean {
  return /^[\w@.:\-\\ ]{1,200}$/.test(s) && !/\.\./.test(s);
}

// ---------------------------------------------------------------- services

/** `systemctl list-units --type=service --all --no-legend --plain --no-pager` */
export function parseSystemctlUnits(text: string, scope: 'user' | 'system'): ServiceRow[] {
  const out: ServiceRow[] = [];
  for (const l of text.split('\n')) {
    const m = l.trim().replace(/^●\s*/, '').match(/^(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
    if (!m) continue;
    const [, id, load, active, sub, desc] = m;
    if (load === 'not-found') continue;
    out.push({
      id, name: id.replace(/\.service$/, ''), description: desc || undefined, scope,
      state: active === 'active' ? 'running' : active === 'failed' ? 'failed' : active === 'inactive' ? 'stopped' : sub === 'running' ? 'running' : 'other',
    });
  }
  return out;
}

/** `systemctl list-unit-files --type=service --no-legend` → which units start at boot. */
export function parseUnitFiles(text: string): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const l of text.split('\n')) {
    const f = l.trim().split(/\s+/);
    if (f[0]?.endsWith('.service') && f[1]) m.set(f[0], f[1] === 'enabled' || f[1] === 'enabled-runtime');
  }
  return m;
}

/** `launchctl list`: "PID\tStatus\tLabel" with "-" for none. */
export function parseLaunchctlList(text: string, scope: 'user' | 'system'): ServiceRow[] {
  const out: ServiceRow[] = [];
  for (const l of text.split('\n').slice(1)) {
    const f = l.split('\t');
    if (f.length < 3 || !f[2]) continue;
    const pid = /^\d+$/.test(f[0]) ? Number(f[0]) : undefined;
    const status = Number(f[1]);
    const label = f[2].trim();
    out.push({ id: label, name: label.replace(/^(com|org|io|net)\.[^.]+\./, ''), scope, pid, state: pid ? 'running' : status && status !== 0 ? 'failed' : 'stopped' });
  }
  return out;
}

/** Get-CimInstance Win32_Service | Select Name,DisplayName,State,StartMode,Description,ProcessId | ConvertTo-Json */
export function parseWinServices(json: string): ServiceRow[] {
  let list: { Name: string; DisplayName?: string; State?: string; StartMode?: string; Description?: string | null; ProcessId?: number }[];
  try {
    const v = JSON.parse(json || '[]');
    list = Array.isArray(v) ? v : [v];
  } catch {
    return [];
  }
  return list.filter((s) => s?.Name).map((s) => ({
    id: s.Name, name: s.DisplayName || s.Name, description: s.Description ?? undefined, scope: 'system' as const,
    state: s.State === 'Running' ? 'running' : s.State === 'Stopped' ? 'stopped' : 'other',
    enabled: s.StartMode === 'Auto', pid: s.ProcessId || undefined,
  }));
}

// ---------------------------------------------------------------- safety

const CRITICAL: Record<string, string[]> = {
  darwin: ['kernel_task', 'launchd', 'WindowServer', 'loginwindow', 'logd', 'opendirectoryd', 'securityd', 'configd', 'notifyd', 'mds', 'syslogd', 'UserEventAgent', 'coreservicesd', 'diskarbitrationd', 'Dock', 'SystemUIServer', 'Finder'],
  win32: ['System', 'Idle', 'System Idle Process', 'Registry', 'smss', 'csrss', 'wininit', 'winlogon', 'lsass', 'services', 'svchost', 'dwm', 'fontdrvhost', 'Memory Compression', 'LsaIso', 'Secure System', 'explorer'],
  linux: ['systemd', 'init', 'kthreadd', 'Xorg', 'Xwayland', 'gnome-shell', 'plasmashell', 'kwin_wayland', 'kwin_x11', 'mutter', 'gdm', 'gdm-session-worker', 'sddm', 'lightdm', 'dbus-daemon', 'dbus-broker', 'pipewire', 'wireplumber', 'polkitd', 'udevd', 'systemd-logind', 'systemd-journald', 'systemd-udevd'],
};

/** Some of these are safe to restart but not to end, so they get a gentler note. */
const RESTARTABLE = new Set(['Finder', 'Dock', 'SystemUIServer', 'explorer', 'plasmashell']);

/**
 * Why a process must not be stopped from the list, or null when it may be.
 * The system would crash, log you out, or lose the screen.
 */
export function protectedReason(p: Pick<ProcRow, 'pid' | 'name' | 'ppid'>, platform: string, self: number): string | null {
  if (p.pid === self) return 'This is Keeper itself. Use Restart Keeper instead.';
  if (p.pid <= 1 || (platform === 'win32' && p.pid === 4)) return 'This is the core of the operating system; stopping it would crash or restart the computer.';
  // Kernel threads on Linux are children of kthreadd (pid 2).
  if (platform === 'linux' && (p.pid === 2 || p.ppid === 2)) return 'This is part of the Linux kernel and cannot be stopped.';
  const name = p.name.replace(/\.exe$/i, '');
  if ((CRITICAL[platform] ?? []).some((c) => c.toLowerCase() === name.toLowerCase())) {
    return RESTARTABLE.has(name)
      ? `${name} is part of your desktop. The system restarts it on its own; ending it closes all its windows.`
      : `${name} keeps the system running; stopping it would crash the computer or sign you out.`;
  }
  return null;
}

/** Like protectedReason, but allows the desktop pieces that the system relaunches by itself. */
export function canEnd(p: Pick<ProcRow, 'pid' | 'name' | 'ppid'>, platform: string, self: number, force = false): { ok: boolean; reason?: string } {
  const r = protectedReason(p, platform, self);
  if (!r) return { ok: true };
  if (!force && RESTARTABLE.has(p.name.replace(/\.exe$/i, ''))) return { ok: true, reason: r };
  return { ok: false, reason: r };
}

// ---------------------------------------------------------------- trees and apps

export interface TreeNode {
  p: ProcRow;
  depth: number;
  children: TreeNode[];
}

/** Parent–child tree; processes whose parent is gone become roots. Children sorted by `cmp`. */
export function buildTree(procs: ProcRow[], cmp: (a: ProcRow, b: ProcRow) => number = (a, b) => a.pid - b.pid): TreeNode[] {
  const by = new Map<number, TreeNode>();
  for (const p of procs) by.set(p.pid, { p, depth: 0, children: [] });
  const roots: TreeNode[] = [];
  for (const n of by.values()) {
    const parent = n.p.ppid !== n.p.pid ? by.get(n.p.ppid) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sort = (list: TreeNode[], depth: number, seen: Set<number>) => {
    list.sort((a, b) => cmp(a.p, b.p));
    for (const n of list) {
      if (seen.has(n.p.pid)) { n.children = []; continue; }
      seen.add(n.p.pid);
      n.depth = depth;
      sort(n.children, depth + 1, seen);
    }
  };
  sort(roots, 0, new Set());
  return roots;
}

/** Depth-first list of a tree, skipping the children of collapsed pids. */
export function flattenTree(roots: TreeNode[], collapsed: Set<number>): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      out.push(n);
      if (!collapsed.has(n.p.pid)) walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/** Every descendant of `pid` (not including it), deepest first, so children stop before their parents. */
export function descendants(pid: number, procs: Pick<ProcRow, 'pid' | 'ppid'>[]): number[] {
  const kids = new Map<number, number[]>();
  for (const p of procs) if (p.pid !== p.ppid) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p.pid]);
  const out: number[] = [];
  const seen = new Set<number>([pid]);
  const walk = (id: number) => {
    for (const k of kids.get(id) ?? []) {
      if (seen.has(k)) continue;
      seen.add(k);
      walk(k);
      out.push(k);
    }
  };
  walk(pid);
  return out;
}

/** What app a process belongs to: its .app bundle on a Mac, its program folder for installed apps, otherwise its name. */
export function appKey(p: Pick<ProcRow, 'name' | 'path'>, platform: string): string {
  if (platform === 'darwin') {
    const b = macAppBundle(p.path);
    if (b) return b;
  }
  const path = p.path ?? '';
  const dir = path.replace(/[\\/][^\\/]*$/, '');
  if (platform === 'win32' && /\\(program files( \(x86\))?|appdata\\local\\programs)\\/i.test(path)) return dir.toLowerCase();
  if (platform === 'linux' && /^\/(opt|snap)\/|\.mount_|\/app\//.test(path)) return dir;
  // Helpers share their app's name stem: "Code Helper (Renderer)" → "Code".
  return p.name.replace(/ Helper.*$| \(.*\)$|-(renderer|gpu|utility|helper|zygote)$/i, '').toLowerCase();
}

export interface AppGroup {
  key: string;
  /** the process that started the rest, shown as the group's name */
  lead: ProcRow;
  name: string;
  members: ProcRow[];
  cpu: number;
  memory: number;
  energy: number;
  readRate: number;
  writeRate: number;
}

/** Groups helpers under their app, adding up what they use. */
export function groupByApp(procs: ProcRow[], platform: string): AppGroup[] {
  const groups = new Map<string, ProcRow[]>();
  for (const p of procs) {
    const k = appKey(p, platform);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups.entries()].map(([key, members]) => {
    const pids = new Set(members.map((m) => m.pid));
    const lead = members.find((m) => !pids.has(m.ppid)) ?? members[0];
    const bundle = platform === 'darwin' ? macAppBundle(lead.path) : undefined;
    const name = bundle ? bundle.split('/').pop()!.replace(/\.app$/, '') : lead.name;
    const sum = (f: (p: ProcRow) => number | undefined) => members.reduce((s, m) => s + (f(m) ?? 0), 0);
    return {
      key, lead, name, members,
      cpu: Math.round(sum((m) => m.cpu) * 10) / 10,
      memory: sum((m) => m.memory),
      energy: Math.round(sum((m) => m.energy) * 10) / 10,
      readRate: sum((m) => m.readRate),
      writeRate: sum((m) => m.writeRate),
    };
  });
}

/** Case-insensitive match on name, pid, user, path or command; `/regex/flags` matches name and command by a regular expression. */
export function matchProc(p: ProcRow, q: string): boolean {
  const re = procRegex(q);
  if (re) return re.test(p.name) || (!!p.command && re.test(p.command));
  const s = q.trim().toLowerCase();
  if (!s) return true;
  if (/^\d+$/.test(s) && String(p.pid) === s) return true;
  return [p.name, p.user, p.path, p.command].some((v) => v?.toLowerCase().includes(s));
}

/** A `/pattern/flags` filter as a RegExp (case-insensitive unless flags say otherwise); null for plain words or a broken pattern. */
export function procRegex(q: string): RegExp | null {
  const m = q.trim().match(/^\/(.+)\/([gimsuy]*)$/);
  if (!m) return null;
  try {
    return new RegExp(m[1], m[2].replace('g', '') || 'i');
  } catch {
    return null;
  }
}

/** Processes started in the last `ms` (the "New" mark) and those gone since the last reading (the "Ended" list). */
export function procChanges(prev: Pick<ProcRow, 'pid' | 'name' | 'started'>[], now: Pick<ProcRow, 'pid' | 'name' | 'started'>[], at = Date.now(), ms = 60_000): { fresh: Set<number>; ended: { pid: number; name: string }[] } {
  const fresh = new Set(now.filter((p) => p.started && at - p.started < ms).map((p) => p.pid));
  const live = new Set(now.map((p) => `${p.pid}:${p.started ?? ''}`));
  const ended = prev.length ? prev.filter((p) => !live.has(`${p.pid}:${p.started ?? ''}`)).map((p) => ({ pid: p.pid, name: p.name })) : [];
  return { fresh, ended };
}

/** CSV of process rows for spreadsheets. */
export function procsCsv(rows: ProcRow[]): string {
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['pid', 'ppid', 'name', 'user', 'cpu', 'memory', 'threads', 'energy', 'readRate', 'writeRate', 'connections', 'started', 'path', 'command'];
  return [head.join(','), ...rows.map((r) => [r.pid, r.ppid, r.name, r.user, r.cpu, r.memory, r.threads, r.energy, r.readRate, r.writeRate, r.connections, r.started ? new Date(r.started).toISOString() : '', r.path, r.command].map(esc).join(','))].join('\n') + '\n';
}

/** Signals the interface may ask for; anything else is refused. */
export const SIGNALS = ['SIGTERM', 'SIGKILL', 'SIGSTOP', 'SIGCONT', 'SIGHUP', 'SIGINT'] as const;
export type Signal = (typeof SIGNALS)[number];

/** Priority levels offered, mapped to nice values (lower = more processor time). */
export const PRIORITIES = { lowest: 19, low: 10, normal: 0, high: -10, highest: -20 } as const;
export type PriorityLevel = keyof typeof PRIORITIES;

export function priorityOf(nice: number | undefined): PriorityLevel {
  if (nice === undefined) return 'normal';
  if (nice >= 15) return 'lowest';
  if (nice > 0) return 'low';
  if (nice === 0) return 'normal';
  if (nice > -15) return 'high';
  return 'highest';
}
