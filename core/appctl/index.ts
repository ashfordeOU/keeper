// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Per-app controls: the exact commands, scripts and file contents for limiting,
// routing and tuning one app at a time. Pure and tested; the Electron service
// runs them. Every input that reaches a script is checked here first (paths,
// names, numbers), and every control says honestly what each system can do.

export type AppOs = 'darwin' | 'win32' | 'linux';

export interface AppRef {
  /** display name */
  name: string;
  /** full path to the program (exe, .app bundle or binary) */
  path?: string;
  pid?: number;
  /** macOS bundle identifier */
  bundleId?: string;
  /** Linux .desktop id (firefox.desktop) or Windows AppUserModelID */
  appId?: string;
}

export type ControlId =
  | 'network' | 'bandwidth' | 'vpn' | 'dns' | 'priority' | 'cpuLimit' | 'memLimit' | 'suspend' | 'autoSuspend'
  | 'startAtLogin' | 'notifications' | 'appearance' | 'language' | 'volume' | 'gpu' | 'defaultFor' | 'keepAwake' | 'privacy';

export type Support = 'yes' | 'partial' | 'guide' | 'no';

export interface ControlInfo {
  id: ControlId;
  title: string;
  description: string;
  support: Record<AppOs, Support>;
  /** what each system can and cannot do, in plain words */
  notes: Partial<Record<AppOs, string>>;
  admin: Partial<Record<AppOs, boolean>>;
}

export const CONTROLS: ControlInfo[] = [
  { id: 'network', title: 'Network access', description: 'Allow or block this app from the internet (a firewall rule).', support: { darwin: 'yes', win32: 'yes', linux: 'yes' }, notes: { linux: 'A rule in Keeper\'s firewall; how it is enforced on Linux (OpenSnitch or nftables) is shown on the Firewall page.' }, admin: { darwin: true, win32: true, linux: true } },
  { id: 'bandwidth', title: 'Bandwidth limit', description: 'Cap how fast this app can upload.', support: { darwin: 'partial', win32: 'yes', linux: 'yes' }, notes: { win32: 'Windows QoS policy by program name; limits sending (upload) only.', linux: 'cgroup + nftables mark + tc HTB; limits sending (upload) only.', darwin: 'macOS has no per-app shaping: Keeper limits by the ports the app uses (pf + dummynet), which also affects other apps on those ports.' }, admin: { darwin: true, win32: true, linux: true } },
  { id: 'vpn', title: 'Route through VPN', description: 'Send this app through the VPN, or around it (split tunnelling).', support: { darwin: 'guide', win32: 'guide', linux: 'yes' }, notes: { linux: 'cgroup + firewall mark + a routing rule.', win32: 'Windows has no per-app routing; use your VPN app\'s split tunnelling (WireGuard: AllowedIPs; many VPN apps have an app list).', darwin: 'macOS only allows per-app VPN with MDM profiles; use your VPN app\'s split tunnelling.' }, admin: { linux: true } },
  { id: 'dns', title: 'DNS filter exception', description: 'Let this app skip Keeper\'s DNS blocklists.', support: { darwin: 'no', win32: 'no', linux: 'no' }, notes: { darwin: 'Not possible yet: Keeper\'s DNS filter sees each lookup but not which app made it. Pause the blocklist for a site in the Firewall page instead.', win32: 'Not possible yet: Keeper\'s DNS filter sees each lookup but not which app made it. Pause the blocklist for a site in the Firewall page instead.', linux: 'Not possible yet: Keeper\'s DNS filter sees each lookup but not which app made it. Pause the blocklist for a site in the Firewall page instead.' }, admin: {} },
  { id: 'privacy', title: 'Camera, microphone and location', description: 'Which sensitive things this app may use.', support: { darwin: 'guide', win32: 'partial', linux: 'partial' }, notes: { darwin: 'macOS only lets you grant these in System Settings ▸ Privacy & Security; Keeper can reset an app\'s answers (tccutil reset).', win32: 'Per-app switches for Store apps; desktop apps share one switch.', linux: 'Flatpak apps: flatpak permission-set. Other apps are not sandboxed.' }, admin: {} },
  { id: 'priority', title: 'CPU priority', description: 'Give this app more or less of the processor when it is busy.', support: { darwin: 'yes', win32: 'yes', linux: 'yes' }, notes: { darwin: 'renice, plus taskpolicy for background mode (efficiency cores on Apple silicon).', linux: 'Raising priority above normal needs an administrator.' }, admin: {} },
  { id: 'cpuLimit', title: 'CPU limit', description: 'Never let this app use more than a share of the processor.', support: { darwin: 'partial', win32: 'yes', linux: 'yes' }, notes: { win32: 'A job object with a CPU rate cap.', linux: 'cgroup v2 cpu.max.', darwin: 'macOS has no hard limit; Keeper can put the app in background mode (taskpolicy -b), which slows it down a lot when other work is waiting.' }, admin: { linux: false } },
  { id: 'memLimit', title: 'Memory limit', description: 'Stop this app growing past a size.', support: { darwin: 'no', win32: 'yes', linux: 'yes' }, notes: { darwin: 'Not possible on macOS for normal apps.', win32: 'Job object memory limit: the app is told it is out of memory past the limit.', linux: 'cgroup v2 memory.max: the kernel reclaims memory, then stops the app if it goes past.' }, admin: {} },
  { id: 'suspend', title: 'Pause and resume', description: 'Freeze the app completely (it uses no CPU) and wake it later.', support: { darwin: 'yes', win32: 'yes', linux: 'yes' }, notes: {}, admin: {} },
  { id: 'autoSuspend', title: 'Pause in the background', description: 'Pause the app a few minutes after you switch away from it, resume when you come back.', support: { darwin: 'yes', win32: 'no', linux: 'no' }, notes: { win32: 'Not yet: Keeper hears which app is in front only on macOS. Use Pause and resume.', linux: 'Not yet: Keeper hears which app is in front only on macOS (Wayland does not tell other apps). Use Pause and resume.' }, admin: {} },
  { id: 'startAtLogin', title: 'Start at login', description: 'Open this app when you sign in.', support: { darwin: 'yes', win32: 'yes', linux: 'yes' }, notes: {}, admin: {} },
  { id: 'notifications', title: 'Notifications', description: 'Allow or silence this app\'s notifications.', support: { darwin: 'guide', win32: 'yes', linux: 'yes' }, notes: { darwin: 'macOS keeps notification permissions private; Keeper opens the right page in System Settings.', win32: 'Uses the app\'s AppUserModelID; desktop apps without one cannot be switched individually.', linux: 'GNOME per-app notification settings.' }, admin: {} },
  { id: 'appearance', title: 'Always light', description: 'Keep this app light even when the system is dark.', support: { darwin: 'yes', win32: 'no', linux: 'partial' }, notes: { win32: 'Windows has no per-app override.', linux: 'GTK apps: Keeper can start the app with GTK_THEME=Adwaita:light from its launcher.' }, admin: {} },
  { id: 'language', title: 'App language', description: 'Use a different language in this app only.', support: { darwin: 'yes', win32: 'no', linux: 'partial' }, notes: { win32: 'Windows has no per-app language for desktop apps.', linux: 'Keeper can start the app with LANGUAGE set from its launcher.' }, admin: {} },
  { id: 'volume', title: 'App volume', description: 'Set this app\'s volume separately.', support: { darwin: 'no', win32: 'yes', linux: 'yes' }, notes: { darwin: 'macOS has no per-app volume without installing an audio driver; Keeper does not install one.', win32: 'Core Audio session volume.', linux: 'PipeWire / PulseAudio stream volume (pactl).' }, admin: {} },
  { id: 'gpu', title: 'Graphics card', description: 'Run this app on the power-saving or high-performance graphics.', support: { darwin: 'no', win32: 'yes', linux: 'partial' }, notes: { darwin: 'macOS chooses automatically.', linux: 'Keeper can start the app with DRI_PRIME=1 / __NV_PRIME_RENDER_OFFLOAD=1 from its launcher.' }, admin: {} },
  { id: 'defaultFor', title: 'Default app for file types', description: 'Open these kinds of files with this app.', support: { darwin: 'yes', win32: 'guide', linux: 'yes' }, notes: { win32: 'Windows protects default-app choices; Keeper opens Settings ▸ Default apps at the right place.' }, admin: {} },
  { id: 'keepAwake', title: 'Keep awake while running', description: 'Stop the computer sleeping while this app is open.', support: { darwin: 'yes', win32: 'yes', linux: 'yes' }, notes: {}, admin: {} },
];

export const controlInfo = (id: ControlId) => CONTROLS.find((c) => c.id === id)!;

// ---------------------------------------------------------------- input checks

/** A program path Keeper will put into a script: absolute, no quotes or control characters. */
export function safePath(p: string | undefined, os: AppOs): string {
  if (!p) throw new Error('This app\'s location is not known');
  const abs = os === 'win32' ? /^[a-zA-Z]:\\/.test(p) : p.startsWith('/');
  if (!abs || /["'`$\0\n\r;|&<>]/.test(p) || p.length > 1024) throw new Error('Keeper will not use that app path in a command');
  return p;
}

export function safeName(s: string): string {
  const n = s.replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 60);
  if (!n) throw new Error('That name cannot be used');
  return n;
}

export function safeBundleId(id: string | undefined): string {
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9.-]{1,200}$/.test(id)) throw new Error('This app has no usable bundle identifier');
  return id;
}

export function safePid(pid: number | undefined): number {
  if (!Number.isInteger(pid) || (pid as number) <= 1) throw new Error('The app is not running');
  return pid as number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));
const psq = (s: string) => `'${s.replace(/['‘’‚‛]/g, '$&$&')}'`;
const exeName = (p: string) => p.split(/[\\/]/).pop()!;
/** short stable tag for names, cgroups and marks */
export function appTag(app: AppRef): string {
  const base = (app.bundleId ?? app.path ?? app.name).toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < base.length; i++) h = Math.imul(h ^ base.charCodeAt(i), 16777619) >>> 0;
  return `k${h.toString(36)}`;
}
/** a firewall mark per app, 0x4b000000 range so it cannot clash with VPN marks in common use */
export const appMark = (app: AppRef) => 0x4b000000 + (parseInt(appTag(app).slice(1), 36) % 0xffff);

export interface Cmd { file: string; args: string[]; admin?: boolean }
export interface Plan {
  /** commands to run, in order */
  cmds: Cmd[];
  /** commands that undo it */
  undo: Cmd[];
  /** what the person is told */
  note?: string;
  /** files to write (path → contents) before the commands */
  files?: { path: string; content: string }[];
  removeFiles?: string[];
}

// ---------------------------------------------------------------- bandwidth

/** Windows: a QoS policy that caps what the program sends. */
export function winQos(app: AppRef, kbps: number): Plan {
  const exe = exeName(safePath(app.path, 'win32'));
  const name = `Keeper ${appTag(app)}`;
  const bps = clamp(kbps, 8, 10_000_000) * 1000;
  const set = `Remove-NetQosPolicy -Name ${psq(name)} -PolicyStore ActiveStore -Confirm:$false -ErrorAction SilentlyContinue; New-NetQosPolicy -Name ${psq(name)} -AppPathNameMatchCondition ${psq(exe)} -ThrottleRateActionBitsPerSecond ${bps} -PolicyStore ActiveStore | Out-Null`;
  const undo = `Remove-NetQosPolicy -Name ${psq(name)} -PolicyStore ActiveStore -Confirm:$false -ErrorAction SilentlyContinue`;
  return { cmds: [{ file: 'powershell', args: ['-NoProfile', '-Command', set], admin: true }], undo: [{ file: 'powershell', args: ['-NoProfile', '-Command', undo], admin: true }], note: 'Limits upload only; lasts until restart (Keeper puts it back when it starts).' };
}

/** Linux: the app's processes go in a cgroup; nftables marks its packets; tc limits the mark. */
export function linuxShape(app: AppRef, kbps: number, iface: string, cgroupRel: string): Plan {
  if (!/^[a-zA-Z0-9_.-]{1,15}$/.test(iface)) throw new Error('Bad network interface name');
  if (!/^[a-zA-Z0-9_./-]+$/.test(cgroupRel) || cgroupRel.includes('..')) throw new Error('Bad cgroup');
  const mark = appMark(app);
  const minor = (mark & 0xfff) + 16;
  const rate = clamp(kbps, 8, 10_000_000);
  const level = cgroupRel.split('/').filter(Boolean).length;
  const script = [
    `tc qdisc show dev ${iface} | grep -q 'htb 1:' || tc qdisc replace dev ${iface} root handle 1: htb default 1`,
    `tc class replace dev ${iface} parent 1: classid 1:1 htb rate 10gbit`,
    `tc class replace dev ${iface} parent 1: classid 1:${minor.toString(16)} htb rate ${rate}kbit ceil ${rate}kbit`,
    `tc filter replace dev ${iface} parent 1: protocol all prio 1 handle ${mark} fw flowid 1:${minor.toString(16)}`,
    `nft add table inet keeper_app 2>/dev/null; nft 'add chain inet keeper_app out { type route hook output priority mangle; }' 2>/dev/null; true`,
    `nft add rule inet keeper_app out socket cgroupv2 level ${level} '"${cgroupRel}"' meta mark set ${mark} comment '"${appTag(app)}"'`,
  ].join(' && ');
  const undo = [
    `h=$(nft -a list chain inet keeper_app out 2>/dev/null | grep '"${appTag(app)}"' | sed -n 's/.*# handle //p'); for x in $h; do nft delete rule inet keeper_app out handle $x; done`,
    `tc filter del dev ${iface} parent 1: protocol all prio 1 handle ${mark} fw 2>/dev/null`,
    `tc class del dev ${iface} classid 1:${minor.toString(16)} 2>/dev/null; true`,
  ].join('; ');
  return { cmds: [{ file: 'sh', args: ['-c', script], admin: true }], undo: [{ file: 'sh', args: ['-c', undo], admin: true }], note: 'Limits upload only. The app must be in Keeper\'s cgroup (Keeper moves it when the limit is set and when it starts again).' };
}

/** macOS: dummynet pipe on the ports the app uses (shared with other apps on those ports). */
export function macShape(app: AppRef, kbps: number, ports: number[]): Plan {
  const list = [...new Set(ports.filter((p) => Number.isInteger(p) && p > 0 && p < 65536))].slice(0, 20);
  if (!list.length) throw new Error('Keeper needs the ports this app uses (see Network Activity)');
  const pipe = (appMark(app) % 60000) + 1000;
  const rate = clamp(kbps, 8, 10_000_000);
  const anchor = `com.ashforde.keeper/${appTag(app)}`;
  const rules = `dummynet out proto { tcp udp } from any to any port { ${list.join(' ')} } pipe ${pipe}\\n`;
  const script = `dnctl pipe ${pipe} config bw ${rate}Kbit/s && printf '${rules}' | pfctl -a ${anchor} -f - && pfctl -E 2>/dev/null; true`;
  const undo = `pfctl -a ${anchor} -F all 2>/dev/null; dnctl pipe delete ${pipe} 2>/dev/null; true`;
  return { cmds: [{ file: 'sh', args: ['-c', script], admin: true }], undo: [{ file: 'sh', args: ['-c', undo], admin: true }], note: `Limited by port (${list.join(', ')}), so other apps using these ports are slowed too.` };
}

// ---------------------------------------------------------------- VPN routing (Linux)

/** Linux split tunnelling: packets from the app's cgroup are marked and routed via `table` (the VPN's or main to bypass it). */
export function linuxRoute(app: AppRef, mode: 'vpn' | 'bypass', cgroupRel: string, vpnIface: string): Plan {
  if (!/^[a-zA-Z0-9_.-]{1,15}$/.test(vpnIface)) throw new Error('Bad VPN interface name');
  if (!/^[a-zA-Z0-9_./-]+$/.test(cgroupRel) || cgroupRel.includes('..')) throw new Error('Bad cgroup');
  const mark = appMark(app) + 0x10000;
  const table = 4000 + (mark % 1000);
  const level = cgroupRel.split('/').filter(Boolean).length;
  const route = mode === 'vpn' ? `ip route replace default dev ${vpnIface} table ${table}` : `ip route show default table main | head -1 | xargs -r -I{} sh -c 'ip route replace {} table ${table}'`;
  const script = [
    route,
    `ip rule del fwmark ${mark} 2>/dev/null; ip rule add fwmark ${mark} table ${table} priority 90`,
    `nft add table inet keeper_app 2>/dev/null; nft 'add chain inet keeper_app out { type route hook output priority mangle; }' 2>/dev/null; true`,
    `nft add rule inet keeper_app out socket cgroupv2 level ${level} '"${cgroupRel}"' meta mark set ${mark} comment '"${appTag(app)}-route"'`,
  ].join(' && ');
  const undo = [
    `h=$(nft -a list chain inet keeper_app out 2>/dev/null | grep '"${appTag(app)}-route"' | sed -n 's/.*# handle //p'); for x in $h; do nft delete rule inet keeper_app out handle $x; done`,
    `ip rule del fwmark ${mark} 2>/dev/null; ip route flush table ${table} 2>/dev/null; true`,
  ].join('; ');
  return { cmds: [{ file: 'sh', args: ['-c', script], admin: true }], undo: [{ file: 'sh', args: ['-c', undo], admin: true }], note: mode === 'vpn' ? `Only this app uses ${vpnIface}.` : 'This app goes around the VPN.' };
}

// ---------------------------------------------------------------- CPU and memory

export type Priority = 'low' | 'below' | 'normal' | 'above' | 'high';
const NICE: Record<Priority, number> = { low: 19, below: 10, normal: 0, above: -5, high: -10 };
const WIN_PRIO: Record<Priority, string> = { low: 'Idle', below: 'BelowNormal', normal: 'Normal', above: 'AboveNormal', high: 'High' };

export function priorityPlan(app: AppRef, p: Priority, os: AppOs): Plan {
  const pid = safePid(app.pid);
  if (os === 'win32') {
    const s = (v: Priority) => `(Get-Process -Id ${pid}).PriorityClass = ${psq(WIN_PRIO[v])}`;
    return { cmds: [{ file: 'powershell', args: ['-NoProfile', '-Command', s(p)], admin: p === 'high' }], undo: [{ file: 'powershell', args: ['-NoProfile', '-Command', s('normal')] }] };
  }
  const cmds: Cmd[] = [{ file: 'renice', args: ['-n', String(NICE[p]), '-p', String(pid)], admin: NICE[p] < 0 }];
  const undo: Cmd[] = [{ file: 'renice', args: ['-n', '0', '-p', String(pid)], admin: true }];
  if (os === 'darwin') {
    if (p === 'low') cmds.push({ file: '/usr/sbin/taskpolicy', args: ['-b', '-p', String(pid)] });
    undo.unshift({ file: '/usr/sbin/taskpolicy', args: ['-B', '-p', String(pid)] });
  }
  return { cmds, undo, note: os === 'darwin' && p === 'low' ? 'Background mode: the app runs on efficiency cores and gets less disk and network time.' : undefined };
}

/** Linux cgroup v2: the files to write (relative to the cgroup) for CPU and memory limits. */
export function cgroupWrites(o: { cpuPercent?: number; memMB?: number; cores?: number }): { file: string; value: string }[] {
  const out: { file: string; value: string }[] = [];
  if (o.cpuPercent !== undefined) {
    const period = 100_000;
    const pct = clamp(o.cpuPercent, 1, 100 * Math.max(1, o.cores ?? 1));
    out.push({ file: 'cpu.max', value: o.cpuPercent >= 100 * (o.cores ?? 1) ? `max ${period}` : `${Math.round((pct / 100) * period)} ${period}` });
  }
  if (o.memMB !== undefined) out.push({ file: 'memory.max', value: o.memMB <= 0 ? 'max' : String(clamp(o.memMB, 16, 1 << 22) * 1024 * 1024) });
  return out;
}

/** cgroup v2 cpu.max → percent of one core (or undefined for no limit). */
export function parseCpuMax(s: string): number | undefined {
  const [q, p] = s.trim().split(/\s+/);
  if (q === 'max' || !p) return undefined;
  return Math.round((Number(q) / Number(p)) * 100);
}

/** Windows: a job object with a CPU rate and/or memory cap; the job lives as long as the app does. */
export function winJob(app: AppRef, o: { cpuPercent?: number; memMB?: number }): Plan {
  const pid = safePid(app.pid);
  const cpu = o.cpuPercent ? clamp(o.cpuPercent, 1, 100) * 100 : 0;
  const mem = o.memMB ? clamp(o.memMB, 16, 1 << 22) : 0;
  const src = `using System;using System.Runtime.InteropServices;public static class KJ{
[DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern IntPtr CreateJobObject(IntPtr a,string n);
[DllImport("kernel32.dll")]static extern bool SetInformationJobObject(IntPtr j,int c,IntPtr i,uint l);
[DllImport("kernel32.dll")]static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);
[DllImport("kernel32.dll")]static extern IntPtr OpenProcess(uint a,bool i,int p);
[StructLayout(LayoutKind.Sequential)]struct CPU{public uint Flags;public uint Rate;}
[StructLayout(LayoutKind.Sequential)]struct BASIC{public long a;public long b;public uint LimitFlags;public UIntPtr c;public UIntPtr d;public uint e;public UIntPtr f;public uint g;public uint h;}
[StructLayout(LayoutKind.Sequential)]struct IO{public ulong a;public ulong b;public ulong c;public ulong d;public ulong e;public ulong f;}
[StructLayout(LayoutKind.Sequential)]struct EXT{public BASIC Basic;public IO Io;public UIntPtr ProcessMemoryLimit;public UIntPtr JobMemoryLimit;public UIntPtr PeakProcessMemoryUsed;public UIntPtr PeakJobMemoryUsed;}
static void Set<T>(IntPtr j,int c,T v){int n=Marshal.SizeOf(typeof(T));IntPtr p=Marshal.AllocHGlobal(n);Marshal.StructureToPtr(v,p,false);if(!SetInformationJobObject(j,c,p,(uint)n))throw new Exception("SetInformationJobObject "+Marshal.GetLastWin32Error());Marshal.FreeHGlobal(p);}
public static void Limit(int pid,uint cpu,ulong memMB){IntPtr j=CreateJobObject(IntPtr.Zero,null);
if(cpu>0)Set(j,15,new CPU{Flags=1|4,Rate=cpu});
if(memMB>0){var e=new EXT();e.Basic.LimitFlags=0x100;e.ProcessMemoryLimit=(UIntPtr)(memMB*1024*1024);Set(j,9,e);}
IntPtr h=OpenProcess(0x1F0FFF,false,pid);if(h==IntPtr.Zero||!AssignProcessToJobObject(j,h))throw new Exception("AssignProcessToJobObject "+Marshal.GetLastWin32Error());}}`;
  const script = `Add-Type -TypeDefinition @'\n${src}\n'@; [KJ]::Limit(${pid}, ${cpu}, ${mem})`;
  return { cmds: [{ file: 'powershell', args: ['-NoProfile', '-Command', script] }], undo: [], note: 'Windows keeps the limit until the app quits (a job cannot be removed from a running app). Restart the app to lift it.' };
}

// ---------------------------------------------------------------- pause

export function suspendCmd(app: AppRef, os: AppOs, resume: boolean): Cmd {
  const pid = safePid(app.pid);
  if (os === 'win32') {
    const src = `using System;using System.Runtime.InteropServices;public static class KS{[DllImport("ntdll.dll")]public static extern int NtSuspendProcess(IntPtr h);[DllImport("ntdll.dll")]public static extern int NtResumeProcess(IntPtr h);[DllImport("kernel32.dll")]public static extern IntPtr OpenProcess(uint a,bool i,int p);}`;
    return { file: 'powershell', args: ['-NoProfile', '-Command', `Add-Type -TypeDefinition '${src}'; $h=[KS]::OpenProcess(0x800,$false,${pid}); [void][KS]::${resume ? 'NtResumeProcess' : 'NtSuspendProcess'}($h)`] };
  }
  return { file: 'kill', args: [resume ? '-CONT' : '-STOP', String(pid)] };
}

/** Auto-pause: given what is in front, which watched apps to pause and which to wake. */
export function autoSuspendStep(now: number, front: string, watched: { key: string; afterMin: number; hiddenSince?: number; paused: boolean }[]): { pause: string[]; resume: string[]; hidden: Record<string, number | undefined> } {
  const pause: string[] = [];
  const resume: string[] = [];
  const hidden: Record<string, number | undefined> = {};
  for (const w of watched) {
    const inFront = front.toLowerCase().includes(w.key.toLowerCase()) || w.key.toLowerCase().includes(front.toLowerCase() || '\0');
    if (inFront) {
      hidden[w.key] = undefined;
      if (w.paused) resume.push(w.key);
      continue;
    }
    const since = w.hiddenSince ?? now;
    hidden[w.key] = since;
    if (!w.paused && now - since >= w.afterMin * 60_000) pause.push(w.key);
  }
  return { pause, resume, hidden };
}

// ---------------------------------------------------------------- login, notifications, look

export function macLoginAgent(app: AppRef): { label: string; file: string; content: string } {
  const p = safePath(app.path, 'darwin');
  const label = `com.ashforde.keeper.login.${appTag(app)}`;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-g</string><string>${esc(p)}</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>
`;
  return { label, file: `Library/LaunchAgents/${label}.plist`, content };
}

export function winRunKey(app: AppRef, on: boolean): Cmd {
  const p = safePath(app.path, 'win32');
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  const name = safeName(app.name);
  return on ? { file: 'reg', args: ['add', key, '/v', name, '/t', 'REG_SZ', '/d', `"${p}"`, '/f'] } : { file: 'reg', args: ['delete', key, '/v', name, '/f'] };
}

export function linuxAutostart(app: AppRef): { file: string; content: string } {
  const p = safePath(app.path, 'linux');
  const name = safeName(app.name);
  return {
    file: `.config/autostart/keeper-${appTag(app)}.desktop`,
    content: `[Desktop Entry]\nType=Application\nName=${name}\nExec="${p}"\nX-GNOME-Autostart-enabled=true\nX-Keeper-Managed=true\n`,
  };
}

export function notificationsCmd(app: AppRef, on: boolean, os: AppOs): Cmd | null {
  if (os === 'win32') {
    const id = app.appId;
    if (!id || !/^[A-Za-z0-9._!{}\\ -]{1,200}$/.test(id)) return null;
    return { file: 'reg', args: ['add', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\${id}`, '/v', 'Enabled', '/t', 'REG_DWORD', '/d', on ? '1' : '0', '/f'] };
  }
  if (os === 'linux') {
    const id = (app.appId ?? '').replace(/\.desktop$/, '');
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) return null;
    const slug = id.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return { file: 'gsettings', args: ['set', `org.gnome.desktop.notifications.application:/org/gnome/desktop/notifications/application/${slug}/`, 'enable', on ? 'true' : 'false'] };
  }
  return null;
}

export function macAppearanceCmd(app: AppRef, alwaysLight: boolean): Cmd {
  const id = safeBundleId(app.bundleId);
  return alwaysLight ? { file: '/usr/bin/defaults', args: ['write', id, 'NSRequiresAquaSystemAppearance', '-bool', 'true'] } : { file: '/usr/bin/defaults', args: ['delete', id, 'NSRequiresAquaSystemAppearance'] };
}

export function macLanguageCmd(app: AppRef, lang: string | null): Cmd {
  const id = safeBundleId(app.bundleId);
  if (lang === null) return { file: '/usr/bin/defaults', args: ['delete', id, 'AppleLanguages'] };
  if (!/^[a-z]{2,3}([-_][A-Za-z]{2,4})?$/.test(lang)) throw new Error('Not a language code');
  return { file: '/usr/bin/defaults', args: ['write', id, 'AppleLanguages', '-array', lang] };
}

export function winGpuCmd(app: AppRef, pref: 0 | 1 | 2 | null): Cmd {
  const p = safePath(app.path, 'win32');
  const key = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
  return pref === null ? { file: 'reg', args: ['delete', key, '/v', p, '/f'] } : { file: 'reg', args: ['add', key, '/v', p, '/t', 'REG_SZ', '/d', `GpuPreference=${pref};`, '/f'] };
}

// ---------------------------------------------------------------- volume

/** Linux: `pactl list sink-inputs` → stream index per process id. */
export function parseSinkInputs(out: string): { index: number; pid?: number; name?: string; volume?: number }[] {
  const res: { index: number; pid?: number; name?: string; volume?: number }[] = [];
  for (const block of out.split(/\n(?=Sink Input #)/)) {
    const m = block.match(/Sink Input #(\d+)/);
    if (!m) continue;
    const pid = block.match(/application\.process\.id = "(\d+)"/)?.[1];
    const name = block.match(/application\.name = "([^"]*)"/)?.[1];
    const vol = block.match(/Volume:.*?(\d+)%/)?.[1];
    res.push({ index: Number(m[1]), pid: pid ? Number(pid) : undefined, name, volume: vol ? Number(vol) : undefined });
  }
  return res;
}

export function linuxVolumeCmd(index: number, percent: number): Cmd {
  return { file: 'pactl', args: ['set-sink-input-volume', String(Math.trunc(index)), `${clamp(percent, 0, 150)}%`] };
}

/** Windows: set the Core Audio session volume of every session belonging to the process. */
export function winVolumeScript(pid: number, percent: number): string {
  const v = (clamp(percent, 0, 100) / 100).toFixed(2);
  return `Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]class MMDeviceEnumerator{}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMMDeviceEnumerator{int f();int GetDefaultAudioEndpoint(int d,int r,out IMMDevice e);}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMMDevice{int Activate(ref Guid i,int c,IntPtr p,[MarshalAs(UnmanagedType.IUnknown)]out object o);}
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IAudioSessionManager2{int a();int b();int GetSessionEnumerator(out IAudioSessionEnumerator e);}
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IAudioSessionEnumerator{int GetCount(out int n);int GetSession(int i,out IAudioSessionControl2 s);}
[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IAudioSessionControl2{int a();int b();int c();int d();int e();int f();int g();int h();int i();int j();int k();int GetProcessId(out uint p);}
[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface ISimpleAudioVolume{int SetMasterVolume(float l,ref Guid g);}
public static class KV{public static int Set(uint pid,float v){var en=(IMMDeviceEnumerator)new MMDeviceEnumerator();IMMDevice d;en.GetDefaultAudioEndpoint(0,1,out d);var iid=typeof(IAudioSessionManager2).GUID;object o;d.Activate(ref iid,23,IntPtr.Zero,out o);var m=(IAudioSessionManager2)o;IAudioSessionEnumerator e;m.GetSessionEnumerator(out e);int n;e.GetCount(out n);int hit=0;
for(int i=0;i<n;i++){IAudioSessionControl2 s;e.GetSession(i,out s);uint p;s.GetProcessId(out p);if(p==pid){var g=Guid.Empty;((ISimpleAudioVolume)s).SetMasterVolume(v,ref g);hit++;}}return hit;}}
'@; [KV]::Set(${safePid(pid)}, ${v})`;
}

// ---------------------------------------------------------------- default apps

export function defaultForCmd(app: AppRef, typeId: string, os: AppOs): Cmd | null {
  if (os === 'linux') {
    if (!/^[a-z]+\/[a-zA-Z0-9.+-]+$/.test(typeId)) throw new Error('Not a MIME type (for example text/plain)');
    const desk = app.appId?.endsWith('.desktop') ? app.appId : null;
    if (!desk || !/^[A-Za-z0-9._-]+$/.test(desk)) throw new Error('This app has no .desktop file');
    return { file: 'xdg-mime', args: ['default', desk, typeId] };
  }
  if (os === 'darwin') {
    if (!/^[A-Za-z0-9.-]+$/.test(typeId)) throw new Error('Not a type identifier (for example public.plain-text)');
    const id = safeBundleId(app.bundleId);
    // Launch Services through the JavaScript bridge: no helper to install.
    const js = `ObjC.import('CoreServices'); $.LSSetDefaultRoleHandlerForContentType(${JSON.stringify(typeId)}, 0xFFFFFFFF, ${JSON.stringify(id)})`;
    return { file: '/usr/bin/osascript', args: ['-l', 'JavaScript', '-e', js] };
  }
  return null;
}

/** Shown before anything runs. */
export function showPlan(p: Plan): string[] {
  const q = (a: string) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
  return [
    ...(p.files ?? []).map((f) => `write ${f.path}`),
    ...p.cmds.map((c) => `${c.admin ? '(as administrator) ' : ''}${[c.file, ...c.args].map(q).join(' ')}`),
  ];
}
