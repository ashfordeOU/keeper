// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Disks, system health, processes, listening servers, ejecting drives and
// saved Wi-Fi networks — read through each OS's own command-line tools.

import { powerMonitor } from 'electron';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import type { HealthReport } from '../../core/api';
import { powershell, run } from '../../core/platform';
import type { DiskInfo } from '../../core/types';

// ---------------------------------------------------------------- disks

export async function disks(): Promise<DiskInfo[]> {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const r = await powershell('Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2 or DriveType=3" | Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress');
    try {
      const raw = JSON.parse(r.stdout || '[]');
      const list = (Array.isArray(raw) ? raw : [raw]) as { DeviceID: string; VolumeName?: string; Size: number; FreeSpace: number }[];
      return list.filter((d) => d.Size).map((d) => ({ mount: d.DeviceID + '\\', label: d.VolumeName ? `${d.VolumeName} (${d.DeviceID})` : `Disk ${d.DeviceID}`, total: d.Size, free: d.FreeSpace, system: home.toUpperCase().startsWith(d.DeviceID.toUpperCase()) }));
    } catch {
      return [];
    }
  }
  const r = await run('df', ['-kP']);
  const out: DiskInfo[] = [];
  for (const line of r.stdout.split('\n').slice(1)) {
    const m = line.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/);
    if (!m) continue;
    const [, dev, total, , avail, mount] = m;
    if (!dev.startsWith('/dev/') && dev !== 'overlay') continue;
    if (/^\/(System\/Volumes\/(VM|Preboot|Update|xarts|iSCPreboot|Hardware)|boot|snap)/.test(mount) || /\/dev\/loop/.test(dev)) continue;
    const label = mount === '/' ? (process.platform === 'darwin' ? 'Macintosh HD' : 'System') : mount.split('/').pop()!;
    const system = mount === '/' || (mount === '/System/Volumes/Data' && process.platform === 'darwin');
    if (mount === '/System/Volumes/Data') continue; // same space as "/" on APFS
    out.push({ mount, label, total: +total * 1024, free: +avail * 1024, system });
  }
  return out;
}

// ---------------------------------------------------------------- health

let lastCpu = os.cpus();

function cpuPercent(): number {
  const now = os.cpus();
  let idle = 0;
  let total = 0;
  now.forEach((c, i) => {
    const p = lastCpu[i]?.times ?? c.times;
    const d = (k: keyof typeof c.times) => c.times[k] - p[k];
    idle += d('idle');
    total += d('user') + d('nice') + d('sys') + d('idle') + d('irq');
  });
  lastCpu = now;
  return total ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}

async function processes(): Promise<HealthReport['processes']> {
  if (process.platform === 'win32') {
    const r = await powershell('Get-Process | Sort-Object CPU -Descending | Select-Object -First 25 Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Json -Compress', 20_000);
    try {
      const list = JSON.parse(r.stdout || '[]') as { Id: number; ProcessName: string; CPU?: number; WorkingSet64: number }[];
      return list.map((p) => ({ pid: p.Id, name: p.ProcessName, cpu: Math.round((p.CPU ?? 0) * 10) / 10, memory: p.WorkingSet64 }));
    } catch {
      return [];
    }
  }
  const r = await run('ps', ['-Ao', 'pid=,pcpu=,rss=,comm=']);
  return r.stdout
    .split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ pid: +m[1], cpu: +m[2], memory: +m[3] * 1024, name: m[4].split('/').pop()! }))
    .sort((a, b) => b.cpu - a.cpu || b.memory - a.memory)
    .slice(0, 25);
}

let macBatteryDetail: { at: number; cycles?: number; health?: number } | undefined;

async function battery(): Promise<HealthReport['battery']> {
  if (process.platform === 'darwin') {
    const r = await run('/usr/bin/pmset', ['-g', 'batt'], 5000);
    const m = r.stdout.match(/(\d+)%;\s*(\w[\w ]*);/);
    if (!m) return undefined;
    // Cycles and health change over weeks; the history samples every minute, so ioreg runs at most every half hour.
    if (!macBatteryDetail || Date.now() - macBatteryDetail.at > 30 * 60_000) {
      const prof = await run('/usr/sbin/ioreg', ['-rn', 'AppleSmartBattery'], 5000);
      const num = (k: string) => Number(prof.stdout.match(new RegExp(`"${k}" = (\\d+)`))?.[1]);
      const design = num('DesignCapacity');
      const max = num('AppleRawMaxCapacity') || num('NominalChargeCapacity');
      macBatteryDetail = { at: Date.now(), cycles: num('CycleCount') || undefined, health: design && max ? Math.round((max / design) * 100) : undefined };
    }
    return { percent: +m[1], charging: /charging|charged|finishing/i.test(m[2]) && !/discharging/i.test(m[2]), cycles: macBatteryDetail.cycles, health: macBatteryDetail.health };
  }
  if (process.platform === 'win32') {
    const r = await powershell('Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress', 10_000);
    try {
      const b = JSON.parse(r.stdout);
      const one = Array.isArray(b) ? b[0] : b;
      return one ? { percent: one.EstimatedChargeRemaining, charging: one.BatteryStatus === 2 || one.BatteryStatus >= 6 } : undefined;
    } catch {
      return undefined;
    }
  }
  try {
    const dir = '/sys/class/power_supply';
    const bat = (await fsp.readdir(dir)).find((d) => /^BAT/.test(d));
    if (!bat) return undefined;
    const read = (f: string) => fsp.readFile(`${dir}/${bat}/${f}`, 'utf8').then((s) => s.trim()).catch(() => '');
    const [cap, status, full, design, cycles] = await Promise.all([read('capacity'), read('status'), read('energy_full'), read('energy_full_design'), read('cycle_count')]);
    return { percent: +cap, charging: /charging|full/i.test(status) && !/discharging/i.test(status), health: full && design ? Math.round((+full / +design) * 100) : undefined, cycles: cycles ? +cycles : undefined };
  } catch {
    return undefined;
  }
}

/** What is keeping the computer awake right now. */
async function awakeBlockers(): Promise<string[]> {
  if (process.platform === 'darwin') {
    const r = await run('/usr/bin/pmset', ['-g', 'assertions'], 5000);
    return [...r.stdout.matchAll(/pid \d+\(([^)]+)\):.*?(PreventUserIdleSystemSleep|PreventUserIdleDisplaySleep|PreventSystemSleep).*?named: "([^"]+)"/g)].map((m) => `${m[1]} — ${m[3]}`);
  }
  if (process.platform === 'win32') {
    const r = await run('powercfg', ['/requests'], 10_000);
    return r.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^[A-Z]+:$/.test(l) && l !== 'None.');
  }
  const r = await run('systemd-inhibit', ['--list', '--no-legend', '--no-pager'], 5000);
  return r.stdout.split('\n').map((l) => l.trim().split(/\s{2,}/)).filter((c) => c.length >= 5 && /sleep|idle/.test(c[4] ?? '')).map((c) => `${c[0]} — ${c[5] ?? c[4]}`);
}

/** Programs listening on a local TCP port (dev servers, databases, …). */
async function listening(): Promise<HealthReport['listening']> {
  if (process.platform === 'win32') {
    const r = await powershell('Get-NetTCPConnection -State Listen | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress', 15_000);
    const procs = await powershell('Get-Process | Select-Object Id,ProcessName | ConvertTo-Json -Compress', 15_000);
    try {
      const names = new Map((JSON.parse(procs.stdout) as { Id: number; ProcessName: string }[]).map((p) => [p.Id, p.ProcessName]));
      const raw = JSON.parse(r.stdout || '[]');
      const list = (Array.isArray(raw) ? raw : [raw]) as { LocalPort: number; OwningProcess: number }[];
      return dedupePorts(list.filter((x) => x.LocalPort >= 1024).map((x) => ({ port: x.LocalPort, pid: x.OwningProcess, name: names.get(x.OwningProcess) ?? '?' })));
    } catch {
      return [];
    }
  }
  const r = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'], 8000);
  if (r.ok) {
    const out: HealthReport['listening'] = [];
    let pid = 0;
    let name = '';
    for (const line of r.stdout.split('\n')) {
      if (line[0] === 'p') pid = +line.slice(1);
      else if (line[0] === 'c') name = line.slice(1);
      else if (line[0] === 'n') {
        const port = +(line.match(/:(\d+)$/)?.[1] ?? 0);
        if (port >= 1024) out.push({ port, pid, name });
      }
    }
    return dedupePorts(out);
  }
  const ss = await run('ss', ['-ltnpH'], 5000);
  return dedupePorts(
    ss.stdout.split('\n').map((l) => {
      const port = +(l.match(/:(\d+)\s/)?.[1] ?? 0);
      const m = l.match(/users:\(\("([^"]+)",pid=(\d+)/);
      return { port, pid: m ? +m[2] : 0, name: m?.[1] ?? '?' };
    }).filter((x) => x.port >= 1024),
  );
}

function dedupePorts(list: HealthReport['listening']) {
  const seen = new Set<number>();
  return list.filter((x) => (seen.has(x.port) ? false : (seen.add(x.port), true))).sort((a, b) => a.port - b.port);
}

export async function health(): Promise<HealthReport> {
  const [procs, bat, blockers, ports] = await Promise.all([processes(), battery(), awakeBlockers(), listening()]);
  return {
    cpuPercent: cpuPercent(),
    cores: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? '',
    memory: { total: os.totalmem(), free: os.freemem() },
    uptimeSec: os.uptime(),
    loadAvg: os.loadavg(),
    battery: bat ?? (powerMonitor.isOnBatteryPower() ? { percent: NaN, charging: false } : undefined),
    processes: procs,
    awakeBlockers: blockers,
    listening: ports,
  };
}

export { battery as readBattery };

export function killProcess(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false;
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- drives

export async function ejectAll(): Promise<{ ejected: string[]; failed: string[] }> {
  const ejected: string[] = [];
  const failed: string[] = [];
  if (process.platform === 'darwin') {
    const r = await run('/usr/sbin/diskutil', ['list', '-plist', 'external', 'physical']);
    const disksList = [...r.stdout.matchAll(/<key>WholeDisks<\/key>\s*<array>([\s\S]*?)<\/array>/g)].flatMap((m) => [...m[1].matchAll(/<string>([^<]+)<\/string>/g)].map((x) => x[1]));
    for (const d of disksList) ((await run('/usr/sbin/diskutil', ['eject', d])).ok ? ejected : failed).push(d);
  } else if (process.platform === 'win32') {
    const r = await powershell('$s=New-Object -comObject Shell.Application; Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2" | ForEach-Object { $s.Namespace(17).ParseName($_.DeviceID).InvokeVerb("Eject"); $_.DeviceID }');
    ejected.push(...r.stdout.split(/\r?\n/).filter(Boolean));
  } else {
    const r = await run('lsblk', ['-J', '-o', 'NAME,MOUNTPOINT,RM,HOTPLUG,TYPE']);
    try {
      const data = JSON.parse(r.stdout) as { blockdevices: { name: string; rm: boolean | string; hotplug: boolean | string; type: string; children?: { name: string; mountpoint: string | null }[] }[] };
      for (const dev of data.blockdevices) {
        const removable = dev.rm === true || dev.rm === '1' || dev.hotplug === true || dev.hotplug === '1';
        if (!removable || dev.type !== 'disk') continue;
        for (const part of dev.children ?? []) if (part.mountpoint) await run('udisksctl', ['unmount', '-b', `/dev/${part.name}`]);
        ((await run('udisksctl', ['power-off', '-b', `/dev/${dev.name}`])).ok ? ejected : failed).push(dev.name);
      }
    } catch {
      /* no lsblk */
    }
  }
  return { ejected, failed };
}

/** Saved Wi-Fi networks and (where the OS allows without a prompt) their passwords. */
export async function wifiNetworks(): Promise<{ ssid: string; password?: string }[]> {
  if (process.platform === 'win32') {
    const r = await run('netsh', ['wlan', 'show', 'profiles']);
    const names = [...r.stdout.matchAll(/:\s(.+)\r?$/gm)].map((m) => m[1].trim()).filter(Boolean);
    const out = [];
    for (const n of names.slice(0, 30)) {
      const d = await run('netsh', ['wlan', 'show', 'profile', `name=${n}`, 'key=clear']);
      out.push({ ssid: n, password: d.stdout.match(/Key Content\s*:\s(.+)/)?.[1]?.trim() });
    }
    return out;
  }
  if (process.platform === 'linux') {
    const r = await run('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show']);
    const names = r.stdout.split('\n').filter((l) => /:802-11-wireless$/.test(l)).map((l) => l.replace(/:802-11-wireless$/, '').replace(/\\:/g, ':'));
    const out = [];
    for (const n of names) {
      const d = await run('nmcli', ['-s', '-g', '802-11-wireless-security.psk', 'connection', 'show', n]);
      out.push({ ssid: n, password: d.stdout.trim() || undefined });
    }
    return out;
  }
  // macOS: passwords live in the keychain and need the user's approval per network.
  const r = await run('/usr/sbin/networksetup', ['-listpreferredwirelessnetworks', 'en0']);
  return r.stdout.split('\n').slice(1).map((l) => l.trim()).filter(Boolean).map((ssid) => ({ ssid }));
}
