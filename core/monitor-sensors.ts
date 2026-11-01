// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Graphics, fans, temperatures and power, read only through public means:
//   GPU      NVIDIA nvidia-smi everywhere; AMD (gpu_busy_percent) and Intel
//            (frequency share, an approximation) through Linux sysfs; Windows
//            "GPU Engine" performance counters; macOS the public `ioreg`
//            IOAccelerator performance statistics (utilisation only).
//   Fans     Linux hwmon fan*_input; Windows Win32_Fan where the maker fills it.
//            macOS has no public fan or temperature interface (SMC is private).
//   Power    battery discharge on every system (Linux power_supply, macOS
//            AppleSmartBattery in ioreg, Windows BatteryStatus) and the
//            processor package from Linux RAPL (powercap) when readable.
// Pure parsers; electron/services and the CLI do the reading.

export interface GpuReading {
  name: string;
  vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'other';
  /** % busy */
  util?: number;
  memUsed?: number;
  memTotal?: number;
  /** °C */
  temp?: number;
  /** watts */
  power?: number;
  /** how it was measured, for an honest label */
  source: string;
  /** an estimate rather than a measurement */
  approx?: boolean;
  /** processes using it and how much memory each holds (NVIDIA only) */
  procs?: { pid: number; name: string; memory: number }[];
}

export interface FanReading { label: string; rpm: number; max?: number }
export interface TempReading { label: string; celsius: number; critical?: number }

export interface PowerReading {
  /** battery discharge (positive) or charge (negative) in watts */
  battery?: number;
  /** processor package power from RAPL */
  package?: number;
  /** per RAPL domain (package, core, uncore, dram, psys) */
  domains?: { name: string; watts: number }[];
  source: string[];
}

export interface Sensors {
  gpus: GpuReading[];
  fans: FanReading[];
  temps: TempReading[];
  power: PowerReading;
  /** what this system cannot show, in plain words */
  limits: string[];
}

const num = (s: string | undefined) => {
  const t = String(s ?? '').trim();
  if (!t) return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
};

// ---------------------------------------------------------------- NVIDIA

export const NVIDIA_QUERY = ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw', '--format=csv,noheader,nounits'];
export const NVIDIA_PROCS = ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits'];

/** `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits` */
export function parseNvidiaSmi(csv: string, procsCsv = ''): GpuReading[] {
  const procs = parseNvidiaProcs(procsCsv);
  return csv.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, util, used, total, temp, power] = l.split(',').map((x) => x.trim());
    const MiB = 1024 * 1024;
    return {
      name, vendor: 'nvidia' as const, util: num(util), memUsed: num(used) !== undefined ? num(used)! * MiB : undefined, memTotal: num(total) !== undefined ? num(total)! * MiB : undefined,
      temp: num(temp), power: num(power), source: 'nvidia-smi', procs: procs.length ? procs : undefined,
    };
  });
}

export function parseNvidiaProcs(csv: string): { pid: number; name: string; memory: number }[] {
  return csv.split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((f) => f.length >= 3 && /^\d+$/.test(f[0]))
    .map(([pid, name, mem]) => ({ pid: Number(pid), name: name.split(/[\\/]/).pop() ?? name, memory: (num(mem) ?? 0) * 1024 * 1024 }));
}

// ---------------------------------------------------------------- Linux DRM

/** A card under /sys/class/drm as read by the service. */
export interface DrmCard {
  card: string;
  /** PCI vendor id: 0x1002 AMD, 0x8086 Intel, 0x10de NVIDIA */
  vendor: string;
  busy?: string;
  vramUsed?: string;
  vramTotal?: string;
  /** Intel: current and maximum GPU frequency in MHz */
  curFreq?: string;
  maxFreq?: string;
  name?: string;
}

export function parseDrmCards(cards: DrmCard[]): GpuReading[] {
  const out: GpuReading[] = [];
  for (const c of cards) {
    const v = c.vendor.trim().toLowerCase();
    if (v === '0x1002') {
      out.push({ name: c.name ?? `AMD graphics (${c.card})`, vendor: 'amd', util: num(c.busy), memUsed: num(c.vramUsed), memTotal: num(c.vramTotal), source: 'amdgpu sysfs' });
    } else if (v === '0x8086') {
      const cur = num(c.curFreq);
      const max = num(c.maxFreq);
      // i915/xe publish no busy figure without root (perf); the clock's share of its maximum tracks load closely enough to show.
      out.push({ name: c.name ?? `Intel graphics (${c.card})`, vendor: 'intel', util: cur !== undefined && max ? Math.round(Math.min(100, (cur / max) * 100)) : undefined, source: 'i915 frequency', approx: true });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Windows

/**
 * `Get-Counter '\GPU Engine(*)\Utilization Percentage'` as JSON lines of
 * { Path, CookedValue }. The busiest engine type (3D, video, copy) per adapter
 * is the GPU's use, summed over processes (as Task Manager does).
 */
export function parseWinGpuCounters(rows: { Path?: string; InstanceName?: string; CookedValue?: number }[]): { util: number; perPid: Map<number, number> } {
  const byEngine = new Map<string, number>();
  const perPid = new Map<number, number>();
  for (const r of rows) {
    const inst = (r.InstanceName ?? r.Path ?? '').toLowerCase();
    const v = Number(r.CookedValue) || 0;
    const engine = inst.match(/engtype_([a-z0-9]+)/)?.[1] ?? 'other';
    const luid = inst.match(/luid_(0x[0-9a-f]+_0x[0-9a-f]+)/)?.[1] ?? '';
    const key = `${luid}:${engine}`;
    byEngine.set(key, (byEngine.get(key) ?? 0) + v);
    const pid = Number(inst.match(/pid_(\d+)/)?.[1]);
    if (pid) perPid.set(pid, Math.max(perPid.get(pid) ?? 0, v));
  }
  const util = Math.min(100, Math.max(0, ...byEngine.values()));
  return { util: Math.round(util * 10) / 10, perPid };
}

// ---------------------------------------------------------------- macOS

/**
 * `ioreg -r -d 1 -w 0 -c IOAccelerator`: the public registry carries a
 * PerformanceStatistics dictionary with "Device Utilization %" on Apple
 * silicon and many Intel/AMD Macs. No private framework involved.
 */
export function parseIoregGpu(text: string): GpuReading[] {
  const out: GpuReading[] = [];
  const blocks = text.split(/\n(?=\+-o )/);
  for (const b of blocks) {
    const util = b.match(/"Device Utilization %"\s*=\s*(\d+)/)?.[1];
    if (util === undefined) continue;
    const name = b.match(/"model"\s*=\s*"([^"]+)"/)?.[1] ?? b.match(/"IOGLBundleName"\s*=\s*"([^"]+)"/)?.[1] ?? b.match(/\+-o\s+(\S+)/)?.[1] ?? 'Graphics';
    const used = b.match(/"(?:In use system memory|vramUsedBytes)"\s*=\s*(\d+)/)?.[1];
    out.push({ name, vendor: /AGX|Apple/i.test(b) ? 'apple' : /AMD|ATI/i.test(b) ? 'amd' : /Intel/i.test(b) ? 'intel' : 'other', util: Number(util), memUsed: used ? Number(used) : undefined, source: 'ioreg IOAccelerator', approx: false });
  }
  return out;
}

/** `ioreg -rn AppleSmartBattery`: InstantAmperage (mA, negative while discharging) × Voltage (mV). */
export function parseMacBatteryPower(text: string): number | undefined {
  const amp = text.match(/"InstantAmperage"\s*=\s*(-?\d+)/)?.[1] ?? text.match(/"Amperage"\s*=\s*(-?\d+)/)?.[1];
  const volt = text.match(/"Voltage"\s*=\s*(\d+)/)?.[1];
  if (amp === undefined || volt === undefined) return undefined;
  // ioreg prints negative numbers as unsigned 64-bit values; BigInt keeps them exact.
  let big = BigInt(amp);
  if (big >= 2n ** 63n) big -= 2n ** 64n;
  const a = Number(big);
  const watts = (-a * Number(volt)) / 1e6;
  return Math.round(watts * 100) / 100;
}

// ---------------------------------------------------------------- Linux power

/** A /sys/class/power_supply/BAT*: power_now (µW), or current_now (µA) × voltage_now (µV). Positive = discharging. */
export function linuxBatteryWatts(f: { status?: string; power_now?: string; current_now?: string; voltage_now?: string }): number | undefined {
  const p = num(f.power_now);
  let w: number | undefined;
  if (p !== undefined) w = p / 1e6;
  else {
    const c = num(f.current_now);
    const v = num(f.voltage_now);
    if (c !== undefined && v !== undefined) w = (c * v) / 1e12;
  }
  if (w === undefined) return undefined;
  const charging = /charging/i.test(f.status ?? '') && !/discharging/i.test(f.status ?? '');
  return Math.round((charging ? -Math.abs(w) : Math.abs(w)) * 100) / 100;
}

/** Watts from two RAPL energy_uj readings (wrapping at max_energy_range_uj). */
export function raplWatts(prevUj: number, nowUj: number, ms: number, maxRangeUj?: number): number | undefined {
  if (ms <= 0) return undefined;
  let d = nowUj - prevUj;
  if (d < 0) d = maxRangeUj ? d + maxRangeUj : NaN;
  if (!Number.isFinite(d)) return undefined;
  return Math.round((d / 1e6 / (ms / 1000)) * 100) / 100;
}

/** Windows `Get-CimInstance -Namespace root/wmi BatteryStatus`: DischargeRate / ChargeRate in mW. */
export function winBatteryWatts(rows: { DischargeRate?: number; ChargeRate?: number; Discharging?: boolean }[]): number | undefined {
  let w = 0;
  let any = false;
  for (const r of rows) {
    if (r.Discharging && r.DischargeRate) {
      w += r.DischargeRate / 1000;
      any = true;
    } else if (r.ChargeRate) {
      w -= r.ChargeRate / 1000;
      any = true;
    }
  }
  return any ? Math.round(w * 100) / 100 : undefined;
}

// ---------------------------------------------------------------- Linux hwmon

/** One hwmon chip as read by the service: its name and the files it has. */
export interface HwmonChip { name: string; files: Record<string, string> }

export function parseHwmon(chips: HwmonChip[]): { fans: FanReading[]; temps: TempReading[] } {
  const fans: FanReading[] = [];
  const temps: TempReading[] = [];
  for (const c of chips) {
    for (const [file, value] of Object.entries(c.files)) {
      const fan = file.match(/^fan(\d+)_input$/);
      if (fan) {
        const rpm = num(value);
        if (rpm === undefined) continue;
        const label = c.files[`fan${fan[1]}_label`]?.trim() || `${c.name} fan ${fan[1]}`;
        fans.push({ label, rpm, max: num(c.files[`fan${fan[1]}_max`]) });
      }
      const t = file.match(/^temp(\d+)_input$/);
      if (t) {
        const mc = num(value);
        if (mc === undefined) continue;
        const celsius = Math.round(mc / 100) / 10;
        if (celsius <= -40 || celsius >= 150) continue;
        const label = c.files[`temp${t[1]}_label`]?.trim() || `${c.name} ${t[1]}`;
        const crit = num(c.files[`temp${t[1]}_crit`]);
        temps.push({ label: label.startsWith(c.name) ? label : `${c.name} · ${label}`, celsius, critical: crit !== undefined ? Math.round(crit / 1000) : undefined });
      }
    }
  }
  return { fans: fans.sort((a, b) => a.label.localeCompare(b.label)), temps: temps.sort((a, b) => b.celsius - a.celsius) };
}

/** Windows `Win32_Fan` (DesiredSpeed is rarely filled; when it is, it is rpm). */
export function parseWinFans(rows: { Name?: string; DeviceID?: string; DesiredSpeed?: number; ActiveCooling?: boolean }[]): FanReading[] {
  return rows.filter((r) => Number(r.DesiredSpeed) > 0).map((r, i) => ({ label: r.Name || r.DeviceID || `Fan ${i + 1}`, rpm: Number(r.DesiredSpeed) }));
}

/** What each system cannot show, so the page explains rather than hides. */
export function sensorLimits(platform: NodeJS.Platform, s: Pick<Sensors, 'gpus' | 'fans' | 'temps' | 'power'>): string[] {
  const out: string[] = [];
  if (platform === 'darwin') {
    out.push('macOS has no public way to read fan speeds or most temperatures (they sit behind the private SMC interface), so Keeper does not show them. Fan control is not offered on any system.');
    if (!s.gpus.length) out.push('This Mac does not publish graphics utilisation in its public registry.');
  }
  if (platform === 'win32') {
    if (!s.fans.length) out.push('Windows reports fan speeds only when the computer maker fills them in (most do not); reading them otherwise needs a kernel driver, which Keeper does not install.');
    if (!s.temps.length) out.push('This PC does not publish temperatures through the standard ACPI thermal zones.');
  }
  if (platform === 'linux') {
    if (!s.fans.length) out.push('No fan sensors are exposed through hwmon on this computer.');
    if (s.power.package === undefined) out.push('Processor package power (RAPL) is readable only by administrators on most distributions (chmod a+r /sys/class/powercap/intel-rapl:0/energy_uj to allow it).');
  }
  if (!s.gpus.length) out.push('No graphics card that Keeper can read was found (NVIDIA needs nvidia-smi installed).');
  if (s.power.battery === undefined && s.power.package === undefined) out.push('Power draw is shown on battery-powered computers and, on Linux, from RAPL.');
  return out;
}
