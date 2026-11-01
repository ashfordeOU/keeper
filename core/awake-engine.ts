// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keep Awake: sessions (for a while, until a time, while something is true),
// what each session allows (display sleep, screen saver, the lid closed),
// automatic sessions from triggers with priorities, the commands each system
// needs, the safety rules for keeping a laptop awake with its lid closed, and
// statistics. Pure: the Electron service gathers the facts and runs commands.

// ---------------------------------------------------------------- what can hold a session open

/** Things a session can last "while". All checked against a Facts snapshot. */
export type WhileKind =
  | 'app' // an app is running
  | 'appFront' // an app is running and in front
  | 'file' // a file is still being downloaded (growing, or a partial-download name exists)
  | 'folder' // a folder is still changing
  | 'cpu' // a process (or the whole computer) is busy above a threshold
  | 'audio' // sound is playing
  | 'network' // network traffic above a rate
  | 'display' // an external display is connected
  | 'power' // on the power adapter
  | 'drive' // a drive or volume is mounted
  | 'usb' // a USB device is connected
  | 'bluetooth' // a Bluetooth device is connected
  | 'wifi' // connected to a Wi-Fi network
  | 'vpn' // a VPN is connected
  | 'agent' // an AI agent or terminal session is running
  | 'job'; // a Keeper job runs (sync, backup, conversion, download)

export interface WhileCondition {
  kind: WhileKind;
  /** app, process, device, network or drive name; file or folder path (case-insensitive, partial match for names) */
  value?: string;
  /** cpu: percent; network: bytes per second */
  threshold?: number;
}

export type DisplayMode = 'keep-on' | 'allow-sleep';

export interface SessionOptions {
  /** keep the screen on, or let it sleep while the computer keeps working */
  display: DisplayMode;
  /** allow the screen saver (and screen lock) after this many minutes without input; 0 = never */
  screenSaverAfterMin: number;
  /** keep a laptop awake with its lid closed (needs a one-time administrator step on macOS) */
  closedDisplay: boolean;
  /** end the session when the battery drops below this percent while on battery; 0 = never */
  endBelowBattery: number;
  /** end when the system reports low power mode or heavy heat (thermal pressure) */
  endOnLowPowerOrHeat: boolean;
  /** end when the person puts the computer to sleep by hand */
  endOnManualSleep: boolean;
  /** only while on the power adapter */
  onlyOnPower: boolean;
  /** keep these drives spinning: touch a hidden file every `driveAliveSec` seconds */
  driveAlive: string[];
  driveAliveSec: number;
  /** nudge the pointer by one point every N seconds (for apps that judge idleness themselves); 0 = never */
  cursorEverySec: number;
  /** turn on Do Not Disturb / Focus for the session (where the system lets apps) */
  focus: boolean;
  /** notifications */
  notifyStart: boolean;
  notifyEnd: boolean;
  /** remind this many minutes before a timed session ends; 0 = no reminder */
  remindBeforeMin: number;
  sound: 'none' | 'soft' | 'chime' | 'pop';
  /** lock the screen when the session ends */
  lockAtEnd: boolean;
}

export const DEFAULT_OPTIONS: SessionOptions = {
  display: 'keep-on',
  screenSaverAfterMin: 0,
  closedDisplay: false,
  endBelowBattery: 10,
  endOnLowPowerOrHeat: true,
  endOnManualSleep: true,
  onlyOnPower: false,
  driveAlive: [],
  driveAliveSec: 120,
  cursorEverySec: 0,
  focus: false,
  notifyStart: false,
  notifyEnd: true,
  remindBeforeMin: 5,
  sound: 'soft',
  lockAtEnd: false,
};

export type SessionSource = 'manual' | 'trigger' | 'focus' | 'presentation' | 'job' | 'link' | 'shortcut' | 'cli';

export interface SessionSpec {
  /** minutes from now; undefined = no time limit */
  minutes?: number;
  /** epoch ms; wins over minutes */
  until?: number;
  /** all must stay true; the session ends when one stops being true (after `graceSec`) */
  while?: WhileCondition[];
  options?: Partial<SessionOptions>;
  source?: SessionSource;
  /** trigger id that started it */
  triggerId?: string;
  /** a label for people ("Presentation mode") */
  reason?: string;
}

export interface Session {
  id: string;
  startedAt: number;
  endsAt?: number;
  while: WhileCondition[];
  options: SessionOptions;
  source: SessionSource;
  triggerId?: string;
  reason: string;
  /** when a "while" condition was first seen false (for the grace period) */
  falseSince?: number;
  /** battery percent at start, when on battery (for the battery-use estimate) */
  batteryAtStart?: number;
  reminded?: boolean;
}

// ---------------------------------------------------------------- facts the platform layer gathers

export interface Facts {
  now: number;
  onPower: boolean;
  battery?: number;
  charging?: boolean;
  lowPowerMode?: boolean;
  /** 'nominal' | 'fair' | 'serious' | 'critical' */
  thermal?: string;
  externalDisplays: number;
  mirroring?: boolean;
  apps: string[];
  frontApp?: string;
  /** name → cpu percent of one core */
  processCpu?: Record<string, number>;
  cpu: number;
  audioPlaying?: boolean;
  audioOutput?: string;
  netBytesPerSec?: number;
  usb: string[];
  bluetooth: string[];
  volumes: string[];
  ssid?: string;
  interfaces: string[];
  ips: string[];
  dns: string[];
  idleSec: number;
  agentsRunning: number;
  terminalSessions: number;
  keeperJobs: string[];
  downloadsActive: number;
  calendarBusy?: boolean;
  /** path → { size, mtime } for files and folders sessions watch */
  paths?: Record<string, { exists: boolean; size: number; mtime: number; partial?: boolean }>;
}

const lc = (s: string) => s.trim().toLowerCase();
const listHas = (list: string[], v?: string) => !!v && v.trim() !== '' && list.some((x) => lc(x).includes(lc(v)));

export function isVpnInterface(name: string): boolean {
  return /^(utun\d+|tun\d*|tap\d*|wg\d*|ppp\d*|ipsec\d*|gpd\d*|nordlynx|tailscale\d*|zt\w*|proton\d*|mullvad\w*|vpn\w*|cscotun\d*)$/i.test(name);
}

/** Is a "while" condition true right now? Files and folders count as true while they change within the last `quietSec`. */
export function conditionHolds(c: WhileCondition, f: Facts, quietSec = 60): boolean {
  switch (c.kind) {
    case 'app': return listHas(f.apps, c.value);
    case 'appFront': return listHas(f.apps, c.value) && !!f.frontApp && lc(f.frontApp).includes(lc(c.value ?? ''));
    case 'file': {
      const p = c.value ? f.paths?.[c.value] : undefined;
      if (!p) return true; // not looked at yet
      if (p.partial) return true;
      return p.exists && f.now - p.mtime < quietSec * 1000;
    }
    case 'folder': {
      const p = c.value ? f.paths?.[c.value] : undefined;
      if (!p) return true;
      return p.exists && f.now - p.mtime < quietSec * 1000;
    }
    case 'cpu': {
      const t = c.threshold ?? 50;
      if (c.value) return Object.entries(f.processCpu ?? {}).some(([n, v]) => lc(n).includes(lc(c.value!)) && v >= t);
      return f.cpu >= t;
    }
    case 'audio': return !!f.audioPlaying;
    case 'network': return (f.netBytesPerSec ?? 0) >= (c.threshold ?? 50_000);
    case 'display': return f.externalDisplays > 0;
    case 'power': return f.onPower;
    case 'drive': return listHas(f.volumes, c.value);
    case 'usb': return listHas(f.usb, c.value);
    case 'bluetooth': return listHas(f.bluetooth, c.value);
    case 'wifi': return !!f.ssid && !!c.value && lc(f.ssid) === lc(c.value);
    case 'vpn': return f.interfaces.some(isVpnInterface);
    case 'agent': return f.agentsRunning + f.terminalSessions > 0;
    case 'job': return c.value ? f.keeperJobs.some((j) => lc(j).includes(lc(c.value!))) || (lc(c.value) === 'download' && f.downloadsActive > 0) : f.keeperJobs.length + f.downloadsActive > 0;
  }
}

/** Which facts a set of conditions needs, so the platform layer only asks for those. */
export function factsNeeded(conds: { kind: string }[]): Set<string> {
  return new Set(conds.map((c) => c.kind));
}

// ---------------------------------------------------------------- sessions

export function newSession(spec: SessionSpec, defaults: SessionOptions, now: number, id: string, battery?: { percent: number; onPower: boolean }): Session {
  const endsAt = spec.until ?? (spec.minutes && spec.minutes > 0 ? now + spec.minutes * 60_000 : undefined);
  return {
    id,
    startedAt: now,
    endsAt,
    while: spec.while ?? [],
    options: { ...defaults, ...(spec.options ?? {}) },
    source: spec.source ?? 'manual',
    triggerId: spec.triggerId,
    reason: spec.reason ?? describeSpec(spec),
    batteryAtStart: battery && !battery.onPower ? battery.percent : undefined,
  };
}

export function describeWhile(c: WhileCondition): string {
  const v = c.value ? `“${c.value}”` : '';
  switch (c.kind) {
    case 'app': return `while ${v} is running`;
    case 'appFront': return `while ${v} is in front`;
    case 'file': return `while ${c.value ? c.value.split(/[\\/]/).pop() : 'the file'} downloads`;
    case 'folder': return `while ${c.value ? c.value.split(/[\\/]/).pop() : 'the folder'} keeps changing`;
    case 'cpu': return c.value ? `while ${v} uses more than ${c.threshold ?? 50}% of a processor` : `while the processor is above ${c.threshold ?? 50}%`;
    case 'audio': return 'while sound is playing';
    case 'network': return `while the network moves more than ${fmtRate(c.threshold ?? 50_000)}`;
    case 'display': return 'while an external display is connected';
    case 'power': return 'while plugged into power';
    case 'drive': return `while ${v} is connected`;
    case 'usb': return `while the USB device ${v} is connected`;
    case 'bluetooth': return `while ${v} is connected over Bluetooth`;
    case 'wifi': return `while on the Wi-Fi network ${v}`;
    case 'vpn': return 'while a VPN is connected';
    case 'agent': return 'while an AI agent or terminal session runs';
    case 'job': return c.value ? `while Keeper is busy with ${c.value}` : 'while Keeper has work running';
  }
}

export function describeSpec(spec: SessionSpec): string {
  const parts: string[] = [];
  if (spec.until) parts.push(`until ${new Date(spec.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  else if (spec.minutes) parts.push(`for ${fmtDuration(spec.minutes * 60_000)}`);
  for (const c of spec.while ?? []) parts.push(describeWhile(c));
  const s = parts.join(', ');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Until you turn it off';
}

export type Verdict =
  | { end: true; why: string }
  | { end: false; remind?: boolean; displayAllowed: boolean; screenSaverNow: boolean };

/**
 * What to do now. Ends on: time up, a "while" condition false for longer than
 * `graceSec`, low battery, low power or heat, unplugged when "only on power".
 */
export function evaluate(s: Session, f: Facts, graceSec = 30): Verdict {
  const o = s.options;
  if (s.endsAt && f.now >= s.endsAt) return { end: true, why: 'Time is up' };
  if (o.endBelowBattery > 0 && !f.onPower && f.battery !== undefined && f.battery < o.endBelowBattery) return { end: true, why: `Battery below ${o.endBelowBattery}%` };
  if (o.endOnLowPowerOrHeat && f.lowPowerMode) return { end: true, why: 'Low Power Mode is on' };
  if (o.endOnLowPowerOrHeat && (f.thermal === 'serious' || f.thermal === 'critical')) return { end: true, why: 'The computer is running hot' };
  if (o.onlyOnPower && !f.onPower) return { end: true, why: 'Unplugged from power' };
  const failing = s.while.find((c) => !conditionHolds(c, f));
  if (failing) {
    const since = s.falseSince ?? f.now;
    if (f.now - since >= graceSec * 1000) return { end: true, why: `No longer ${describeWhile(failing).replace(/^while /, '')}` };
  }
  const remind = !!s.endsAt && o.remindBeforeMin > 0 && !s.reminded && s.endsAt - f.now <= o.remindBeforeMin * 60_000;
  const screenSaverNow = o.screenSaverAfterMin > 0 && f.idleSec >= o.screenSaverAfterMin * 60;
  return { end: false, remind, displayAllowed: o.display === 'allow-sleep' || screenSaverNow, screenSaverNow };
}

/** Records when a "while" condition first went false (and clears it when they hold again). */
export function trackFalse(s: Session, f: Facts): Session {
  const failing = s.while.some((c) => !conditionHolds(c, f));
  if (failing && s.falseSince === undefined) return { ...s, falseSince: f.now };
  if (!failing && s.falseSince !== undefined) return { ...s, falseSince: undefined };
  return s;
}

/** Adds time to a running session ("extend by 30 minutes"); an open-ended one gets a limit from now. */
export function extend(s: Session, minutes: number, now: number): Session {
  const base = s.endsAt && s.endsAt > now ? s.endsAt : now;
  return { ...s, endsAt: base + minutes * 60_000, reminded: false };
}

export function remainingMs(s: Session | undefined, now: number): number | undefined {
  return s?.endsAt ? Math.max(0, s.endsAt - now) : undefined;
}

// ---------------------------------------------------------------- triggers (automatic sessions)

export type TriggerKind =
  | WhileKind
  | 'schedule' // days and a time window
  | 'battery' // battery above / charging (with AND/OR power)
  | 'mirroring' // display mirroring active
  | 'ip' // an IP address of this computer matches
  | 'dns' // a DNS server in use matches
  | 'audioOutput' // headphones or another output in use
  | 'idle' // nobody has touched the computer for N minutes
  | 'calendar' // a calendar event is going on
  | 'downloads'; // any download in progress

export interface TriggerCondition {
  kind: TriggerKind;
  value?: string;
  threshold?: number;
  /** schedule: 0 = Sunday … 6 = Saturday */
  days?: number[];
  /** schedule: "09:00" */
  from?: string;
  to?: string;
  /** battery: also require the adapter (true) or battery power (false) */
  power?: boolean;
  /** negate ("while NOT on the office Wi-Fi") */
  not?: boolean;
}

export interface AwakeRule {
  id: string;
  name: string;
  enabled: boolean;
  /** all conditions (AND) or any of them (OR) */
  match: 'all' | 'any';
  conditions: TriggerCondition[];
  /** session options for sessions this trigger starts */
  options?: Partial<SessionOptions>;
  /** lower number = higher priority; the highest-priority matching trigger's options apply */
  priority: number;
  /** after you end its session by hand, wait this many minutes before it may start again; 0 = until the conditions change */
  reactivateAfterMin: number;
}

function hm(s: string | undefined, dflt: number): number {
  const m = s?.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : dflt;
}

export function triggerConditionHolds(c: TriggerCondition, f: Facts): boolean {
  let v: boolean;
  switch (c.kind) {
    case 'schedule': {
      const d = new Date(f.now);
      const day = d.getDay();
      const min = d.getHours() * 60 + d.getMinutes();
      const from = hm(c.from, 0);
      const to = hm(c.to, 24 * 60);
      const days = c.days?.length ? c.days : [0, 1, 2, 3, 4, 5, 6];
      // A window that crosses midnight (22:00–06:00) belongs to the day it starts.
      if (from <= to) v = days.includes(day) && min >= from && min < to;
      else v = (days.includes(day) && min >= from) || (days.includes((day + 6) % 7) && min < to);
      break;
    }
    case 'battery': {
      const above = (f.battery ?? 100) >= (c.threshold ?? 0);
      const charging = c.value === 'charging' ? !!f.charging || f.onPower : true;
      const power = c.power === undefined ? true : c.power === f.onPower;
      v = above && charging && power;
      break;
    }
    case 'mirroring': v = !!f.mirroring; break;
    case 'ip': v = !!c.value && f.ips.some((ip) => ipMatches(ip, c.value!)); break;
    case 'dns': v = !!c.value && f.dns.some((d) => lc(d) === lc(c.value!)); break;
    case 'audioOutput': v = !!f.audioOutput && (!c.value || lc(f.audioOutput).includes(lc(c.value))); break;
    case 'idle': v = f.idleSec >= (c.threshold ?? 5) * 60; break;
    case 'calendar': v = !!f.calendarBusy; break;
    case 'downloads': v = f.downloadsActive > 0; break;
    default: v = conditionHolds({ kind: c.kind, value: c.value, threshold: c.threshold }, f, 120);
  }
  return c.not ? !v : v;
}

/** "192.168.1.*", "10.0.0.0/8" or an exact address. */
export function ipMatches(ip: string, pattern: string): boolean {
  const p = pattern.trim();
  if (p.includes('/')) {
    const [base, bitsS] = p.split('/');
    const bits = Number(bitsS);
    const toN = (a: string) => a.split('.').reduce((n, o) => (n << 8) + (Number(o) & 255), 0) >>> 0;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(base) || !(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (toN(ip) & mask) === (toN(base) & mask);
  }
  if (p.includes('*')) return new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i').test(ip);
  return lc(ip) === lc(p);
}

export function ruleMatches(r: AwakeRule, f: Facts): boolean {
  if (!r.enabled || !r.conditions.length) return false;
  return r.match === 'any' ? r.conditions.some((c) => triggerConditionHolds(c, f)) : r.conditions.every((c) => triggerConditionHolds(c, f));
}

/** The matching triggers, highest priority first. */
export function matchingRules(rules: AwakeRule[], f: Facts, snoozed: Record<string, number> = {}): AwakeRule[] {
  return rules
    .filter((r) => !(snoozed[r.id] && snoozed[r.id] > f.now))
    .filter((r) => ruleMatches(r, f))
    .sort((a, b) => a.priority - b.priority);
}

export function describeCondition(c: TriggerCondition): string {
  const not = c.not ? 'not ' : '';
  switch (c.kind) {
    case 'schedule': {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const days = c.days?.length && c.days.length < 7 ? c.days.map((d) => names[d]).join(', ') : 'every day';
      return `${not}${days}, ${c.from ?? '00:00'}–${c.to ?? '24:00'}`;
    }
    case 'battery': return `${not}battery ${c.threshold ? `at ${c.threshold}% or more` : ''}${c.value === 'charging' ? ' and charging' : ''}${c.power === true ? ' on power' : c.power === false ? ' on battery' : ''}`.replace(/\s+/g, ' ').trim();
    case 'mirroring': return `${not}mirroring a display`;
    case 'ip': return `${not}this computer's address is ${c.value}`;
    case 'dns': return `${not}using the DNS server ${c.value}`;
    case 'audioOutput': return c.value ? `${not}sound goes to ${c.value}` : `${not}headphones or another output in use`;
    case 'idle': return `${not}idle for ${c.threshold ?? 5} minutes`;
    case 'calendar': return `${not}in a calendar event`;
    case 'downloads': return `${not}a download is in progress`;
    default: return (c.not ? 'not ' : '') + describeWhile({ kind: c.kind, value: c.value, threshold: c.threshold }).replace(/^while /, '');
  }
}

export function describeRule(r: AwakeRule): string {
  return r.conditions.map(describeCondition).join(r.match === 'any' ? ' or ' : ' and ');
}

/** Older keep-awake rules (one condition each) become triggers. */
export function migrateOldTriggers(old: { id: string; kind: string; enabled: boolean; value?: string; threshold?: number; allowDisplaySleep?: boolean }[]): AwakeRule[] {
  return old.map((t, i) => ({
    id: t.id,
    name: describeCondition({ kind: t.kind as TriggerKind, value: t.value, threshold: t.threshold }).replace(/^./, (c) => c.toUpperCase()),
    enabled: t.enabled,
    match: 'all',
    conditions: [{ kind: t.kind as TriggerKind, value: t.value, threshold: t.threshold }],
    options: t.allowDisplaySleep ? { display: 'allow-sleep' } : undefined,
    priority: i,
    reactivateAfterMin: 0,
  }));
}

// ---------------------------------------------------------------- the commands each system needs

export type Platform = 'darwin' | 'win32' | 'linux' | string;

/** macOS: `caffeinate` that dies with Keeper (-w pid), as a fallback when the helper's power assertions are not there. */
export function caffeinateArgs(o: Pick<SessionOptions, 'display'>, keeperPid: number, onlySystem = false): string[] {
  const args = ['-i'];
  if (!onlySystem && o.display === 'keep-on') args.push('-d');
  args.push('-m', '-w', String(keeperPid));
  return args;
}

/** Linux: hold `systemd-inhibit` while the session runs (killed at the end; dies with Keeper through its parent). */
export function systemdInhibitArgs(o: Pick<SessionOptions, 'display' | 'closedDisplay'>, why: string): string[] {
  const what = ['sleep'];
  if (o.display === 'keep-on') what.push('idle');
  if (o.closedDisplay) what.push('handle-lid-switch');
  return ['--what=' + what.join(':'), '--who=Keeper', `--why=${why.slice(0, 120)}`, '--mode=block', 'sleep', 'infinity'];
}

/** Windows: a tiny PowerShell that holds SetThreadExecutionState and exits when Keeper does. */
export function windowsHoldScript(o: Pick<SessionOptions, 'display'>, keeperPid: number): string {
  // ES_CONTINUOUS 0x80000000 | ES_SYSTEM_REQUIRED 0x1 | ES_DISPLAY_REQUIRED 0x2 | ES_AWAYMODE_REQUIRED 0x40 (not used: it changes sleep into away mode).
  // Written in decimal: PowerShell reads 0x80000003 as a negative Int32, which [uint32] refuses.
  const flags = o.display === 'keep-on' ? '2147483651' : '2147483649';
  return [
    "Add-Type -Name P -Namespace K -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);'",
    `[void][K.P]::SetThreadExecutionState([uint32]${flags})`,
    `while (Get-Process -Id ${Math.floor(keeperPid)} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 5 }`,
    '[void][K.P]::SetThreadExecutionState([uint32]2147483648)',
  ].join('; ');
}

/** macOS closed-lid mode: `pmset -a disablesleep 1|0` (run with administrator rights). */
export function pmsetDisableSleep(on: boolean): string[] {
  return ['-a', 'disablesleep', on ? '1' : '0'];
}

/** Windows lid action ("do nothing" = 0) for both power sources, and the commands that put the old values back. */
export function powercfgLid(ac: number, dc: number): string[][] {
  return [
    ['/setacvalueindex', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION', String(ac)],
    ['/setdcvalueindex', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION', String(dc)],
    ['/setactive', 'SCHEME_CURRENT'],
  ];
}

/** `powercfg /q SCHEME_CURRENT SUB_BUTTONS LIDACTION` → current AC and DC values. */
export function parsePowercfgLid(out: string): { ac: number; dc: number } | undefined {
  const ac = out.match(/Current AC Power Setting Index:\s*0x([0-9a-f]+)/i);
  const dc = out.match(/Current DC Power Setting Index:\s*0x([0-9a-f]+)/i);
  if (!ac || !dc) return undefined;
  return { ac: parseInt(ac[1], 16), dc: parseInt(dc[1], 16) };
}

/** `pmset -g` → is sleep disabled right now (SleepDisabled 1)? */
export function parsePmsetSleepDisabled(out: string): boolean {
  return /SleepDisabled\s+1/.test(out);
}

export interface Blocker {
  who: string;
  what: string;
  why?: string;
}

/** `pmset -g assertions` → who holds which assertion. */
export function parsePmsetAssertions(out: string): Blocker[] {
  const res: Blocker[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/pid\s+\d+\(([^)]+)\):\s+\[[^\]]+\]\s+[\d:]+\s+(\w+)\s+named:\s+"([^"]*)"/);
    if (m) res.push({ who: m[1], what: m[2], why: m[3] || undefined });
  }
  return res;
}

/** `powercfg /requests` → who keeps which part awake. */
export function parsePowercfgRequests(out: string): Blocker[] {
  const res: Blocker[] = [];
  let section = '';
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^[A-Z]+:$/.test(line)) { section = line.slice(0, -1); continue; }
    if (!line || /^None\.?$/i.test(line)) continue;
    const m = line.match(/^\[(\w+)\]\s+(.+)$/);
    if (m && section) res.push({ who: m[2].split('\\').pop() ?? m[2], what: section.toLowerCase(), why: m[1] });
    else if (res.length && section && !line.startsWith('[')) res[res.length - 1].why = line;
  }
  return res;
}

/** `systemd-inhibit --list --no-pager` → who blocks what. */
export function parseSystemdInhibit(out: string): Blocker[] {
  const res: Blocker[] = [];
  for (const line of out.split('\n')) {
    // WHO UID USER PID COMM WHAT WHY MODE
    const m = /^(.+?)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+?)\s+(block|delay)\s*$/.exec(line.trim());
    if (m) res.push({ who: m[1], what: m[6], why: m[7] });
  }
  return res;
}

// ---------------------------------------------------------------- closed-lid safety

export interface LidSafety {
  /** keep closed-lid mode on? */
  ok: boolean;
  why?: string;
}

/** Closed-lid sessions end themselves: on low battery, heat, or when Keeper is about to quit. */
export function closedDisplaySafe(f: Pick<Facts, 'battery' | 'onPower' | 'thermal' | 'lowPowerMode'>, minBattery = 20): LidSafety {
  if (!f.onPower && (f.battery ?? 100) < minBattery) return { ok: false, why: `Battery below ${minBattery}% with the lid closed` };
  if (f.thermal === 'serious' || f.thermal === 'critical') return { ok: false, why: 'The computer is getting hot with the lid closed' };
  if (f.lowPowerMode) return { ok: false, why: 'Low Power Mode is on' };
  return { ok: true };
}

/** What Keeper must undo on its next start if it ended without cleaning up. */
export interface RestoreRecord {
  platform: Platform;
  /** macOS: sleep was enabled before (disablesleep 0 must be restored) */
  macDisableSleep?: boolean;
  /** Windows: the lid actions before */
  winLid?: { ac: number; dc: number };
  /** GNOME: the notification banners setting before */
  gnomeBanners?: boolean;
  at: number;
}

// ---------------------------------------------------------------- statistics

export interface SessionRecord {
  start: number;
  end: number;
  source: SessionSource;
  reason: string;
  why: string;
  /** battery percent used while on battery, when known */
  batteryUsed?: number;
}

export interface AwakeStats {
  sessions: number;
  totalMs: number;
  longestMs: number;
  averageMs: number;
  /** last 7 days, oldest first: ms awake per day */
  week: number[];
  bySource: Record<string, number>;
  batteryUsed: number;
}

export function summarize(records: SessionRecord[], now: number): AwakeStats {
  const week = new Array(7).fill(0);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const d0 = dayStart.getTime() - 6 * 86_400_000;
  const bySource: Record<string, number> = {};
  let total = 0;
  let longest = 0;
  let battery = 0;
  for (const r of records) {
    const ms = Math.max(0, r.end - r.start);
    total += ms;
    longest = Math.max(longest, ms);
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    battery += r.batteryUsed ?? 0;
    // Spread a session over the days it covers.
    for (let i = 0; i < 7; i++) {
      const a = d0 + i * 86_400_000;
      const b = a + 86_400_000;
      week[i] += Math.max(0, Math.min(r.end, b) - Math.max(r.start, a));
    }
  }
  return { sessions: records.length, totalMs: total, longestMs: longest, averageMs: records.length ? Math.round(total / records.length) : 0, week, bySource, batteryUsed: battery };
}

/** Keeps the last `max` records. */
export function addRecord(list: SessionRecord[], r: SessionRecord, max = 500): SessionRecord[] {
  const next = [...list, r];
  return next.length > max ? next.slice(next.length - max) : next;
}

// ---------------------------------------------------------------- words and numbers

export function fmtDuration(ms: number): string {
  if (ms > 0 && ms < 59_500) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function fmtRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtRate(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB/s`;
  return `${Math.round(b / 1000)} KB/s`;
}

/** "30m", "2h", "1h30m", "90" (minutes), "until 18:30" / "18:30" → a session spec. */
export function parseDuration(text: string, now: number): { minutes?: number; until?: number } | undefined {
  const t = text.trim().toLowerCase().replace(/^for\s+/, '');
  if (!t || t === 'forever' || t === 'indefinitely') return {};
  const until = t.replace(/^until\s+/, '').match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (until) {
    let h = Number(until[1]);
    const m = Number(until[2]);
    if (until[3] === 'pm' && h < 12) h += 12;
    if (until[3] === 'am' && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return { until: d.getTime() };
  }
  const hm2 = t.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?$/);
  if (hm2 && (hm2[1] || hm2[2])) return { minutes: Math.round(Number(hm2[1] ?? 0) * 60 + Number(hm2[2] ?? 0)) };
  if (/^\d+$/.test(t)) return { minutes: Number(t) };
  return undefined;
}

// ---------------------------------------------------------------- requests from other places

/** The older Island options (minutes, until, while an app runs…) as a session. */
export function specFromOptions(o: { minutes?: number; until?: number; whileApp?: string; whileFile?: string; onlyOnPower?: boolean; allowDisplaySleep?: boolean; stopBelowBattery?: number } = {}, reason?: string): SessionSpec {
  const w: WhileCondition[] = [];
  if (o.whileApp) w.push({ kind: 'app', value: o.whileApp });
  if (o.whileFile) w.push({ kind: 'file', value: o.whileFile });
  const options: SessionSpec['options'] = {};
  if (o.allowDisplaySleep) options.display = 'allow-sleep';
  if (o.onlyOnPower) options.onlyOnPower = true;
  if (o.stopBelowBattery) options.endBelowBattery = o.stopBelowBattery;
  const source: SessionSource = reason === 'Focus session' ? 'focus' : reason === 'Presentation mode' ? 'presentation' : 'manual';
  return { minutes: o.minutes, until: o.until, while: w, options, reason, source };
}

/** CLI and link parameters → a session. */
export function specFromCli(p: Record<string, unknown>): SessionSpec {
  const now = Date.now();
  const spec: SessionSpec = { source: 'cli', while: [], options: {} };
  const dur = p.for ?? p.minutes;
  if (dur !== undefined && dur !== '') {
    const d = parseDuration(String(dur), now);
    if (!d) throw new Error(`Could not read the duration “${String(dur)}”. Try 30m, 2h, 1h30m or 90.`);
    Object.assign(spec, d);
  }
  if (p.until) {
    const d = parseDuration(`until ${String(p.until)}`, now);
    if (!d?.until) throw new Error(`Could not read the time “${String(p.until)}”. Try 18:30 or 6:30 pm.`);
    spec.until = d.until;
  }
  const whileMap: Record<string, WhileKind> = { 'while-app': 'app', 'while-file': 'file', 'while-folder': 'folder', 'while-cpu': 'cpu', 'while-usb': 'usb', 'while-wifi': 'wifi', 'while-drive': 'drive' };
  for (const [k, kind] of Object.entries(whileMap)) {
    const v = p[k] ?? p[k.replace('-', '')];
    if (v !== undefined && v !== '' && v !== true) spec.while!.push(kind === 'cpu' ? { kind, threshold: Number(v) || 50 } : { kind, value: String(v) });
  }
  for (const k of ['audio', 'power', 'display', 'vpn', 'agent', 'job', 'network', 'bluetooth'] as WhileKind[]) if (p[`while-${k}`] !== undefined || p[`while${k[0].toUpperCase()}${k.slice(1)}`] !== undefined) spec.while!.push({ kind: k });
  if (p['allow-display-sleep'] || p.display === 'sleep') spec.options!.display = 'allow-sleep';
  if (p['closed-lid'] || p.lid) spec.options!.closedDisplay = true;
  if (p['only-on-power']) spec.options!.onlyOnPower = true;
  if (p['lock-at-end']) spec.options!.lockAtEnd = true;
  if (p['end-below']) spec.options!.endBelowBattery = Number(p['end-below']) || 10;
  if (p.source === 'link') spec.source = 'link';
  return spec;
}

/** Menu-bar pictures for Keep Awake (core/awake-icons.ts); Keeper's owl first and by default. */
export const ICON_STYLES = ['owl', 'cup', 'eye', 'bolt', 'moon'] as const;
export type IconStyle = (typeof ICON_STYLES)[number];

export const DEFAULT_QUICK = [15, 30, 60, 120, 240, 480];

// ---------------------------------------------------------------- settings

export interface AwakeSettings {
  /** options new sessions start with */
  defaults: SessionOptions;
  /** the durations offered in menus, in minutes */
  quick: number[];
  triggers: AwakeRule[];
  /** a separate Keep Awake item in the menu bar / tray */
  menuItem: boolean;
  iconStyle: IconStyle;
  /** the icon was picked in Settings (an older default "cup" moves to the owl once otherwise) */
  iconChosen?: boolean;
  /** show the time left next to the menu-bar icon (macOS) */
  showRemaining: boolean;
  /** keep statistics */
  stats: boolean;
  /** macOS Focus: the names of two Shortcuts that turn Focus on and off */
  focusOnShortcut: string;
  focusOffShortcut: string;
  /** the closed-lid explanation was read and the one-time setup agreed to */
  closedDisplayAgreed: boolean;
  /** battery percent at which closed-lid mode always ends */
  closedDisplayMinBattery: number;
}

export function defaultAwakeSettings(): AwakeSettings {
  return {
    defaults: { ...DEFAULT_OPTIONS },
    quick: [...DEFAULT_QUICK],
    triggers: [],
    menuItem: false,
    iconStyle: 'owl',
    showRemaining: true,
    stats: true,
    focusOnShortcut: '',
    focusOffShortcut: '',
    closedDisplayAgreed: false,
    closedDisplayMinBattery: 20,
  };
}

/** Bad fields fall back; triggers from the older Island keep-awake rules carry over once. */
export function normalizeAwakeSettings(a: Partial<AwakeSettings> | undefined, oldTriggers?: unknown): AwakeSettings {
  const d = defaultAwakeSettings();
  const out: AwakeSettings = { ...d, ...(a ?? {}) };
  out.defaults = { ...d.defaults, ...(a?.defaults ?? {}) };
  if (!['keep-on', 'allow-sleep'].includes(out.defaults.display)) out.defaults.display = 'keep-on';
  if (!Array.isArray(out.defaults.driveAlive)) out.defaults.driveAlive = [];
  out.quick = Array.isArray(out.quick) ? out.quick.filter((n) => Number.isFinite(n) && n > 0).slice(0, 12) : d.quick;
  if (!out.quick.length) out.quick = d.quick;
  if (!ICON_STYLES.includes(out.iconStyle)) out.iconStyle = 'owl';
  // "cup" was the default before the owl; nobody picked it, so the owl takes its place.
  if (out.iconStyle === 'cup' && !out.iconChosen) out.iconStyle = 'owl';
  if (!Array.isArray(out.triggers)) out.triggers = [];
  if (!a?.triggers && Array.isArray(oldTriggers) && oldTriggers.length) out.triggers = migrateOldTriggers(oldTriggers as Parameters<typeof migrateOldTriggers>[0]);
  out.triggers = out.triggers.filter((t) => t && typeof t.id === 'string' && Array.isArray(t.conditions)).map((t, i) => ({ ...t, match: t.match === 'any' ? 'any' : 'all', priority: Number.isFinite(t.priority) ? t.priority : i, reactivateAfterMin: t.reactivateAfterMin ?? 0, enabled: t.enabled !== false, name: t.name || 'Trigger' }));
  return out;
}
