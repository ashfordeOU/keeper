// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Battery care: stop charging at a limit (80% by default) so a laptop that is
// plugged in most of the day keeps its battery healthy for longer, charge to
// full once for a trip, and pause charging while the battery is hot.
//
//   Linux    the kernel's charge thresholds in sysfs (ThinkPad, ASUS, Framework,
//            Dell, Huawei, LG, MSI, Samsung, System76 and others):
//            charge_control_end_threshold / _start_threshold (or the older
//            charge_stop_threshold / charge_start_threshold), and
//            charge_behaviour for pausing. Written under one administrator
//            prompt, kept after a restart by a udev rule.
//   Windows  no common interface: the maker's own app (Lenovo Vantage, MyASUS,
//            Dell Power Manager…) is found and opened.
//   macOS    the system manages charging (Optimised Battery Charging). A fixed
//            limit would need private hardware writes from a helper running as
//            root, which Keeper does not do; it opens Battery settings.
// Pure: the main process reads and writes (electron/services/charge-limit.ts).

export interface ChargeSettings {
  /** stop charging at this percent (50–100); 100 = no limit */
  limit: number;
  /** charge to full until this time (0 = not now) */
  tripUntil: number;
  /** pause charging while the battery is hot (Linux, where Keeper may change it without asking) */
  heat: boolean;
  /** what counts as hot, °C */
  hotC: number;
}

export const LIMITS = [60, 70, 80, 90, 100] as const;

export const defaultChargeSettings = (): ChargeSettings => ({ limit: 80, tripUntil: 0, heat: false, hotC: 40 });

export function normalizeChargeSettings(o: Partial<ChargeSettings> | undefined): ChargeSettings {
  const d = defaultChargeSettings();
  const v = { ...d, ...(o && typeof o === 'object' ? o : {}) };
  const limit = Math.round(Number(v.limit));
  return {
    limit: Number.isFinite(limit) ? Math.max(50, Math.min(100, limit)) : d.limit,
    tripUntil: Number(v.tripUntil) > 0 ? Number(v.tripUntil) : 0,
    heat: v.heat === true,
    hotC: Math.max(35, Math.min(50, Math.round(Number(v.hotC) || d.hotC))),
  };
}

// ---------------------------------------------------------------- Linux sysfs

/** The threshold files one battery has (names differ between kernels and drivers). */
export interface SysfsBattery {
  name: string;
  /** charge_control_end_threshold or charge_stop_threshold */
  endFile?: string;
  startFile?: string;
  /** charge_behaviour, with the values it accepts */
  behaviourFile?: string;
  behaviours?: string[];
  end?: number;
  start?: number;
  behaviour?: string;
  capacity?: number;
  status?: string;
  /** °C, where the battery reports it */
  temp?: number;
}

/** Which threshold files a battery directory lists. */
export function thresholdFiles(files: string[]): Pick<SysfsBattery, 'endFile' | 'startFile' | 'behaviourFile'> {
  const has = (n: string) => files.includes(n);
  return {
    endFile: has('charge_control_end_threshold') ? 'charge_control_end_threshold' : has('charge_stop_threshold') ? 'charge_stop_threshold' : undefined,
    startFile: has('charge_control_start_threshold') ? 'charge_control_start_threshold' : has('charge_start_threshold') ? 'charge_start_threshold' : undefined,
    behaviourFile: has('charge_behaviour') ? 'charge_behaviour' : undefined,
  };
}

/** `charge_behaviour` reads "[auto] inhibit-charge force-discharge": the choices and the one in use. */
export function parseBehaviour(text: string): { current?: string; choices: string[] } {
  const choices = text.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/^\[|\]$/g, ''));
  // Some drivers print only the value in use, with no brackets.
  const current = text.match(/\[([\w-]+)\]/)?.[1] ?? (choices.length === 1 ? choices[0] : undefined);
  return { current, choices };
}

/** A battery's own temperature in sysfs is in tenths of a degree. */
export const sysfsTemp = (raw: string | undefined) => {
  const n = Number(raw);
  return Number.isFinite(n) && raw?.trim() ? Math.round(n / 10) : undefined;
};

/**
 * The start threshold that goes with a limit: a few percent below it, so the
 * battery does not top up for every percent it loses. 100 means no limit, and
 * the start threshold goes back to 0 (charge whenever it is not full).
 */
export const startFor = (end: number) => (end >= 100 ? 0 : Math.max(0, end - 5));

/** One threshold write: the file (inside the battery's directory) and the value. */
export interface ThresholdWrite { file: string; value: string }

/**
 * The writes, in an order every driver accepts: some refuse an end below the
 * current start (or a start above the current end), so the one that moves
 * "outwards" goes first.
 */
export function thresholdPlan(b: SysfsBattery, end: number): ThresholdWrite[] {
  if (!b.endFile) return [];
  const e = Math.max(1, Math.min(100, Math.round(end)));
  const writes: ThresholdWrite[] = [];
  const endW = { file: b.endFile, value: String(e) };
  if (!b.startFile) return [endW];
  const s = startFor(e);
  const startW = { file: b.startFile, value: String(s) };
  // Lowering: the start must come down first; raising: the end must go up first.
  if (b.start !== undefined && b.start >= e) writes.push(startW, endW);
  else if (b.end !== undefined && s >= b.end) writes.push(endW, startW);
  else writes.push(startW, endW);
  return writes;
}

const BAT = /^[A-Za-z0-9_.-]{1,32}$/;
const FILE = /^(charge_control_(end|start)_threshold|charge_(stop|start)_threshold|charge_behaviour)$/;

/** Shell-free commands for the administrator prompt: `sh -c 'printf %s 80 > /sys/…'` with checked names only. */
export function writeCommands(root: string, b: SysfsBattery, writes: ThresholdWrite[]): { file: string; args: string[]; admin: true }[] {
  if (!BAT.test(b.name)) throw new Error('Not a battery name');
  return writes.map((w) => {
    if (!FILE.test(w.file) || !/^[\w-]{1,20}$/.test(w.value)) throw new Error('Not a charge setting');
    return { file: 'sh', args: ['-c', `printf %s ${w.value} > ${root}/sys/class/power_supply/${b.name}/${w.file}`], admin: true as const };
  });
}

/**
 * The udev rule that sets the limit again after a restart (most laptops forget
 * it), and, when allowed, lets the person's own group change it without an
 * administrator prompt (needed for a trip and for pausing while hot).
 */
export function udevRule(b: SysfsBattery, end: number, group?: number): string {
  if (!BAT.test(b.name) || !b.endFile) throw new Error('Not a battery name');
  const attrs = [b.startFile ? `ATTR{${b.startFile}}="${startFor(end)}"` : '', `ATTR{${b.endFile}}="${Math.round(end)}"`].filter(Boolean);
  const files = [b.endFile, b.startFile, b.behaviourFile].filter(Boolean).map((f) => `/sys%p/${f}`).join(' ');
  const run = group !== undefined && Number.isInteger(group) && group >= 0 ? `, RUN+="/bin/chgrp ${group} ${files}", RUN+="/bin/chmod g+w ${files}"` : '';
  return `# Keeper battery care: stop charging at ${Math.round(end)}%. Remove this file to go back to the system's own charging.\nSUBSYSTEM=="power_supply", KERNEL=="${b.name}", ${attrs.join(', ')}${run}\n`;
}

export const UDEV_RULE_FILE = '90-keeper-battery-care.rules';

// ---------------------------------------------------------------- what to do now

export type ChargeReason = 'limit' | 'trip' | 'heat' | 'off';

export interface ChargePlan {
  /** the end threshold to have now */
  end: number;
  /** pause charging entirely (too hot) */
  pause: boolean;
  reason: ChargeReason;
}

/**
 * What the battery should do now: a trip charges to full until it ends; a hot
 * battery pauses (and stays paused until it is 3° cooler, so it does not flip
 * every minute); else the limit.
 */
export function chargePlan(s: ChargeSettings, now: number, temp?: number, pausedForHeat = false): ChargePlan {
  if (s.tripUntil > now) return { end: 100, pause: false, reason: 'trip' };
  if (s.heat && temp !== undefined && (temp >= s.hotC || (pausedForHeat && temp > s.hotC - 3))) return { end: s.limit, pause: true, reason: 'heat' };
  return { end: s.limit, pause: false, reason: s.limit >= 100 ? 'off' : 'limit' };
}

/** "Charging to 80%", "Full charge until Thu 09:00", "Paused while hot (42°)": the status line. */
export function planWords(p: ChargePlan, s: ChargeSettings, temp?: number, fmtTime: (t: number) => string = (t) => new Date(t).toLocaleString()): string {
  if (p.reason === 'trip') return `Full charge until ${fmtTime(s.tripUntil)}, then back to ${s.limit}%`;
  if (p.reason === 'heat') return `Charging paused while the battery is warm${temp !== undefined ? ` (${temp}°C)` : ''}`;
  if (p.reason === 'off') return 'Charging to 100%';
  return `Stops charging at ${s.limit}%`;
}

/** When a trip charge should end: tomorrow at this hour, at least 12 hours from now. */
export function tripEnd(now: number, hour = 9): number {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return Math.max(d.getTime(), now + 12 * 3600_000);
}

// ---------------------------------------------------------------- Windows: the maker's app

export interface VendorApp { maker: string; name: string; appId?: string; store?: string }

const VENDOR_APPS: { maker: RegExp; names: RegExp; label: string }[] = [
  { maker: /lenovo/i, names: /Lenovo (Commercial )?Vantage/i, label: 'Lenovo Vantage' },
  { maker: /asus/i, names: /MyASUS|Armoury Crate/i, label: 'MyASUS' },
  { maker: /dell/i, names: /Dell (Command \| )?Power Manager|Dell Optimizer|Dell Power Manager/i, label: 'Dell Power Manager' },
  { maker: /hp|hewlett/i, names: /HP Support Assistant|HP Battery Health Manager|myHP/i, label: 'HP Support Assistant' },
  { maker: /micro-star|msi/i, names: /MSI Center|Dragon Center/i, label: 'MSI Center' },
  { maker: /samsung/i, names: /Samsung Settings/i, label: 'Samsung Settings' },
  { maker: /huawei/i, names: /PC Manager/i, label: 'Huawei PC Manager' },
  { maker: /acer/i, names: /Acer (Care Center|Quick Access)|NitroSense|PredatorSense/i, label: 'Acer Care Center' },
  { maker: /lg electronics/i, names: /LG Control Center|LG Smart Assistant/i, label: 'LG Control Center' },
  { maker: /dynabook|toshiba/i, names: /dynabook Settings|Toshiba Settings/i, label: 'dynabook Settings' },
];

/**
 * The maker's app that sets a charge limit on this Windows laptop, from the
 * computer's maker and the Start menu's apps (`Get-StartApps`): installed (with
 * its AppID to open it) or only named, with a Microsoft Store search for it.
 */
export function vendorApp(maker: string, startApps: { Name: string; AppID: string }[]): VendorApp | null {
  for (const v of VENDOR_APPS) {
    const found = startApps.find((a) => v.names.test(a.Name ?? ''));
    if (found) return { maker: maker.trim() || v.label.split(' ')[0], name: found.Name, appId: found.AppID };
  }
  const v = VENDOR_APPS.find((x) => x.maker.test(maker));
  if (!v) return null;
  return { maker: maker.trim(), name: v.label, store: `ms-windows-store://search/?query=${encodeURIComponent(v.label)}` };
}

/** Microsoft Surface keeps its limit in the firmware (UEFI → Boot configuration → Battery limit). */
export const surfaceNote = (maker: string, model: string) => (/microsoft/i.test(maker) && /surface/i.test(model) ? 'Surface: turn on Battery Limit in the UEFI settings (restart holding Volume Up). It stops at 50%.' : undefined);
