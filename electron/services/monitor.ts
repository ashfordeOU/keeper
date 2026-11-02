// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Health history (one sample a minute for a day), "what used the most",
// alerts for runaway apps, Docker containers, stopping process trees and
// coding-agent sessions, temperatures, disk health and an internet speed test.

import { app, Notification } from 'electron';
import { promises as fsp, readlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Consumer, DiskHealth, DockerContainer, Thermal } from '../../core/api-x';
import { defaultAlertRules, evaluateAlerts, mbps, processTree, pushSample, topConsumers, type AlertRule, type HealthSample, type ProcessAlert, type SpeedResult } from '../../core/monitor';
import { powershell, run } from '../../core/platform';
import { readBattery } from './system';
import { matchAgent } from '../../core/agents-detect';
import { poll } from './governor';
import { recordMinute, saveHistory, seedFromLegacy } from './monitor-history';
import { monitorSettings } from './monitor-settings';
import { readMemory } from './memory';

/** Where heavy-use alerts also show (the Island), set by the main process. */
let islandAlert: ((title: string, detail: string) => void) | null = null;
export function setMonitorIslandAlert(fn: (title: string, detail: string) => void) {
  islandAlert = fn;
}

interface Proc {
  pid: number;
  ppid: number;
  cpu: number;
  memory: number;
  name: string;
  command: string;
}

/** Every running process with its parent, CPU (% of one core) and memory. */
export async function listProcesses(): Promise<Proc[]> {
  if (process.platform === 'win32') {
    const r = await powershell('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,CommandLine | ConvertTo-Json -Compress', 30_000);
    const perf = await powershell('Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Select-Object IDProcess,PercentProcessorTime | ConvertTo-Json -Compress', 30_000);
    try {
      const cpu = new Map((JSON.parse(perf.stdout || '[]') as { IDProcess: number; PercentProcessorTime: number }[]).map((p) => [p.IDProcess, p.PercentProcessorTime]));
      return (JSON.parse(r.stdout || '[]') as { ProcessId: number; ParentProcessId: number; Name: string; WorkingSetSize: number; CommandLine?: string }[]).map((p) => ({
        pid: p.ProcessId, ppid: p.ParentProcessId, cpu: cpu.get(p.ProcessId) ?? 0, memory: Number(p.WorkingSetSize) || 0, name: p.Name.replace(/\.exe$/i, ''), command: p.CommandLine ?? p.Name,
      }));
    } catch {
      return [];
    }
  }
  const r = await run('ps', ['-Ao', 'pid=,ppid=,pcpu=,rss=,comm=,args='], 10_000);
  const out: Proc[] = [];
  for (const line of r.stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s*(.*)$/);
    if (m) out.push({ pid: +m[1], ppid: +m[2], cpu: +m[3], memory: +m[4] * 1024, name: m[5].split('/').pop()!, command: m[6] || m[5] });
  }
  return out;
}

let lastCpu = os.cpus();
function cpuNow(): number {
  const now = os.cpus();
  let idle = 0;
  let total = 0;
  now.forEach((c, i) => {
    const p = lastCpu[i]?.times ?? c.times;
    idle += c.times.idle - p.idle;
    total += c.times.user - p.user + c.times.nice - p.nice + c.times.sys - p.sys + c.times.idle - p.idle + c.times.irq - p.irq;
  });
  lastCpu = now;
  return total ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}

export class MonitorService {
  history: HealthSample[] = [];
  rules: AlertRule[] = defaultAlertRules();
  active: ProcessAlert[] = [];
  speeds: SpeedResult[] = [];
  private notified = new Set<string>();
  private stopPoll?: () => void;
  private first?: NodeJS.Timeout;
  private unsaved = 0;
  private file = path.join(app.getPath('userData'), 'monitor.json');

  async start(intervalMs = 60_000) {
    try {
      const d = JSON.parse(await fsp.readFile(this.file, 'utf8')) as { history?: HealthSample[]; rules?: AlertRule[]; speeds?: SpeedResult[] };
      this.history = (d.history ?? []).filter((s) => s && typeof s.t === 'number');
      if (d.rules?.length) this.rules = d.rules;
      this.speeds = d.speeds ?? [];
    } catch {
      /* first run */
    }
    seedFromLegacy(this.history);
    // The first CPU reading needs a baseline, so take it a few seconds in; then once a minute through
    // the governor (history keeps its one-minute resolution while away, so the idle factor is 1).
    this.stopPoll?.();
    clearTimeout(this.first);
    this.first = setTimeout(() => {
      this.stopPoll = poll('health-history', { baseMs: intervalMs, idleFactor: 1, maxMs: intervalMs * 2 }, () => this.sample(), { feature: 'health' });
    }, 5000);
  }

  stop() {
    clearTimeout(this.first);
    this.stopPoll?.();
    this.stopPoll = undefined;
    void this.save();
    void saveHistory();
  }

  private async save() {
    await fsp.writeFile(this.file + '.tmp', JSON.stringify({ history: this.history, rules: this.rules, speeds: this.speeds.slice(-100) })).catch(() => undefined);
    await fsp.rename(this.file + '.tmp', this.file).catch(() => undefined);
  }

  async sample(): Promise<HealthSample> {
    const [procs, batt, mem] = await Promise.all([listProcesses(), readBattery().catch(() => undefined), readMemory()]);
    const top = procs.filter((p) => p.pid !== process.pid).sort((a, b) => b.cpu - a.cpu).slice(0, 6).map((p) => ({ name: p.name, cpu: Math.round(p.cpu * 10) / 10, memory: p.memory }));
    // Add the biggest memory user too, so memory alerts can see it.
    const memTop = procs.sort((a, b) => b.memory - a.memory)[0];
    if (memTop && !top.some((t) => t.name === memTop.name)) top.push({ name: memTop.name, cpu: memTop.cpu, memory: memTop.memory });
    const s: HealthSample = {
      t: Date.now(), cpu: cpuNow(), memUsed: mem.used, memTotal: mem.total,
      battery: batt && Number.isFinite(batt.percent) ? batt.percent : undefined, charging: batt ? batt.charging : undefined, top,
    };
    this.history = pushSample(this.history, s);
    this.checkAlerts();
    await recordMinute({ t: s.t, cpu: s.cpu, mem: (s.memUsed / s.memTotal) * 100, battery: s.battery, apps: s.top }).catch(() => undefined);
    // The day of samples is written every five minutes, not every minute.
    if (++this.unsaved >= 5) {
      this.unsaved = 0;
      await this.save();
    }
    return s;
  }

  private checkAlerts() {
    const quiet = new Set(monitorSettings().quietApps.map((q) => q.toLowerCase()));
    this.active = evaluateAlerts(this.history, this.rules).filter((a) => !quiet.has(a.name.toLowerCase()));
    for (const a of this.active) {
      const key = `${a.rule}:${a.name}`;
      if (this.notified.has(key)) continue;
      this.notified.add(key);
      setTimeout(() => this.notified.delete(key), 60 * 60_000);
      const what = a.rule.startsWith('cpu') || this.rules.find((r) => r.id === a.rule)?.kind === 'cpu' ? `using ${Math.round(a.value)}% CPU` : `using ${(a.value / 1024 ** 3).toFixed(1)} GB of memory`;
      // In the Island when it is on (less intrusive); a system notification otherwise.
      if (islandAlert && monitorSettings().surfaces.island) islandAlert(`${a.name} is working hard`, `${what[0].toUpperCase()}${what.slice(1)} for a while. Health can quit it.`);
      else if (Notification.isSupported()) new Notification({ title: `${a.name} is working hard`, body: `${a.name} has been ${what} for a while. Open Keeper → Health to quit it.` }).show();
    }
  }

  topToday(): Consumer[] {
    return topConsumers(this.history, Date.now() - 24 * 3600_000).slice(0, 12);
  }

  async setRules(rules: AlertRule[]) {
    this.rules = rules.filter((r) => r && (r.kind === 'cpu' || r.kind === 'memory') && r.threshold > 0 && r.minutes > 0);
    await this.save();
    return this.rules;
  }

  async speedTest(): Promise<SpeedResult> {
    const base = 'https://speed.cloudflare.com';
    // Latency: the fastest of a few tiny requests.
    let ping = Infinity;
    for (let i = 0; i < 4; i++) {
      const t = performance.now();
      await fetch(`${base}/__down?bytes=0`, { cache: 'no-store' }).then((r) => r.arrayBuffer());
      ping = Math.min(ping, performance.now() - t);
    }
    const down = async (bytes: number) => {
      const t = performance.now();
      const buf = await (await fetch(`${base}/__down?bytes=${bytes}`, { cache: 'no-store' })).arrayBuffer();
      return mbps(buf.byteLength, performance.now() - t);
    };
    const up = async (bytes: number) => {
      const body = new Uint8Array(bytes);
      const t = performance.now();
      await fetch(`${base}/__up`, { method: 'POST', body }).then((r) => r.arrayBuffer());
      return mbps(bytes, performance.now() - t);
    };
    // Warm up with a small transfer, then measure a bigger one.
    await down(1e5);
    const downMbps = Math.max(await down(1e7), await down(2.5e7));
    const upMbps = Math.max(await up(2e6), await up(5e6));
    const r: SpeedResult = { t: Date.now(), downMbps, upMbps, pingMs: Math.round(ping) };
    this.speeds = [...this.speeds, r].slice(-100);
    await this.save();
    return r;
  }
}

// ---------------------------------------------------------------- processes

function kill(pid: number): boolean {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

export async function killTree(pid: number): Promise<number> {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return 0;
  if (process.platform === 'win32') {
    const r = await run('taskkill', ['/PID', String(pid), '/T', '/F']);
    return r.ok ? (r.stdout.match(/SUCCESS/g) ?? []).length || 1 : 0;
  }
  const pids = processTree(pid, await listProcesses()).filter((p) => p !== process.pid && p !== process.ppid);
  return pids.filter(kill).length;
}

function cwdOf(pid: number): Promise<string | undefined> {
  if (process.platform === 'linux') {
    try {
      return Promise.resolve(readlinkSync(`/proc/${pid}/cwd`));
    } catch {
      return Promise.resolve(undefined);
    }
  }
  if (process.platform === 'darwin') return run('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn']).then((r) => r.stdout.split('\n').find((l) => l.startsWith('n'))?.slice(1));
  return Promise.resolve(undefined);
}

/** Stops coding-agent processes (any agent in core/agents-detect.ts) working in `cwd`, and their children. */
export async function stopAgent(cwd: string): Promise<number> {
  const procs = await listProcesses();
  const agents = procs.filter((p) => matchAgent(p)?.kind === 'cli');
  let n = 0;
  for (const p of agents) {
    const dir = await cwdOf(p.pid);
    // On Windows the working folder is not readable; match the folder in the command line instead.
    if (dir ? path.resolve(dir) === path.resolve(cwd) : p.command.includes(cwd)) n += await killTree(p.pid);
  }
  return n;
}

// ---------------------------------------------------------------- docker

export async function dockerContainers(): Promise<{ available: boolean; containers: DockerContainer[] }> {
  const r = await run('docker', ['ps', '-a', '--format', '{{json .}}'], 10_000);
  if (!r.ok) return { available: false, containers: [] };
  const containers = r.stdout.split('\n').filter(Boolean).map((l) => {
    const d = JSON.parse(l) as Record<string, string>;
    return { id: d.ID, name: d.Names, image: d.Image, state: d.State ?? (/^Up/.test(d.Status) ? 'running' : 'exited'), status: d.Status, ports: d.Ports ?? '' };
  });
  return { available: true, containers };
}

export async function dockerAction(id: string, action: 'stop' | 'start' | 'restart'): Promise<boolean> {
  if (!/^[a-zA-Z0-9][\w.-]*$/.test(id)) return false;
  return (await run('docker', [action, id], 60_000)).ok;
}

// ---------------------------------------------------------------- sensors

export async function thermals(): Promise<Thermal[] | null> {
  if (process.platform === 'linux') {
    const out: Thermal[] = [];
    try {
      for (const z of await fsp.readdir('/sys/class/thermal')) {
        if (!z.startsWith('thermal_zone')) continue;
        const [type, temp] = await Promise.all([
          fsp.readFile(`/sys/class/thermal/${z}/type`, 'utf8').catch(() => z),
          fsp.readFile(`/sys/class/thermal/${z}/temp`, 'utf8').catch(() => ''),
        ]);
        const c = Number(temp) / 1000;
        if (Number.isFinite(c) && c > 0 && c < 150) out.push({ label: type.trim(), celsius: Math.round(c) });
      }
    } catch {
      /* no thermal zones */
    }
    return out.length ? out : null;
  }
  if (process.platform === 'win32') {
    const r = await powershell('Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Select-Object InstanceName,CurrentTemperature | ConvertTo-Json -Compress', 15_000);
    try {
      const raw = JSON.parse(r.stdout);
      const list = (Array.isArray(raw) ? raw : [raw]) as { InstanceName: string; CurrentTemperature: number }[];
      const out = list.map((t) => ({ label: t.InstanceName.split('\\').pop() ?? 'Zone', celsius: Math.round(t.CurrentTemperature / 10 - 273.15) })).filter((t) => t.celsius > 0 && t.celsius < 150);
      return out.length ? out : null;
    } catch {
      return null;
    }
  }
  // macOS only exposes temperatures to administrators.
  return null;
}

export async function diskHealth(): Promise<DiskHealth[] | null> {
  const scan = await run('smartctl', ['--scan'], 10_000);
  if (scan.ok) {
    const out: DiskHealth[] = [];
    for (const line of scan.stdout.split('\n').filter(Boolean)) {
      const dev = line.split(/\s+/)[0];
      const h = await run('smartctl', ['-H', dev], 15_000);
      const passed = /PASSED|OK\b/.test(h.stdout);
      const failed = /FAILED/.test(h.stdout);
      if (passed || failed) out.push({ device: dev, healthy: passed && !failed, detail: h.stdout.split('\n').find((l) => /overall-health|SMART Health Status/i.test(l))?.trim() ?? '' });
    }
    if (out.length) return out;
  }
  if (process.platform === 'darwin') {
    const r = await run('/usr/sbin/diskutil', ['info', 'disk0'], 10_000);
    const status = r.stdout.match(/SMART Status:\s*(.+)/)?.[1]?.trim();
    return status ? [{ device: 'disk0', healthy: /Verified/i.test(status), detail: `SMART status: ${status}` }] : null;
  }
  if (process.platform === 'win32') {
    const r = await powershell('Get-PhysicalDisk | Select-Object FriendlyName,HealthStatus,OperationalStatus | ConvertTo-Json -Compress', 20_000);
    try {
      const raw = JSON.parse(r.stdout);
      return (Array.isArray(raw) ? raw : [raw]).map((d: { FriendlyName: string; HealthStatus: string; OperationalStatus: string }) => ({ device: d.FriendlyName, healthy: d.HealthStatus === 'Healthy', detail: `${d.HealthStatus} · ${d.OperationalStatus}` }));
    } catch {
      return null;
    }
  }
  return null;
}
