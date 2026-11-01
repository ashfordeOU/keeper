// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote actions on your own devices, as exact commands per system: lock,
// sleep, restart, print a file on the default printer, run a command in a
// shell, and the system snapshot. Pure: the app runs the argument lists.

export interface Cmd {
  file: string;
  args: string[];
}

export type PowerAction = 'lock' | 'sleep' | 'restart';

export function powerCommand(action: PowerAction, platform: string): Cmd {
  if (platform === 'win32') {
    if (action === 'lock') return { file: 'rundll32.exe', args: ['user32.dll,LockWorkStation'] };
    if (action === 'sleep') return { file: 'rundll32.exe', args: ['powrprof.dll,SetSuspendState', '0,1,0'] };
    return { file: 'shutdown.exe', args: ['/r', '/t', '5', '/c', 'Restarted from Keeper'] };
  }
  if (platform === 'darwin') {
    if (action === 'lock') return { file: '/usr/bin/pmset', args: ['displaysleepnow'] };
    if (action === 'sleep') return { file: '/usr/bin/pmset', args: ['sleepnow'] };
    return { file: '/usr/bin/osascript', args: ['-e', 'tell application "System Events" to restart'] };
  }
  if (action === 'lock') return { file: 'loginctl', args: ['lock-session'] };
  if (action === 'sleep') return { file: 'systemctl', args: ['suspend'] };
  return { file: 'systemctl', args: ['reboot'] };
}

/** Kinds of file a paired device may send to print. On Windows printing goes through the file's
 *  own app (the shell's Print verb), so scripts, shortcuts and macro documents are never printed. */
const PRINTABLE = new Set(['pdf', 'txt', 'md', 'csv', 'log', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'heic', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'ps', 'xps', 'oxps']);
export function printable(name: string): boolean {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return !!m && PRINTABLE.has(m[1].toLowerCase());
}

/** Prints a file on the default printer. */
export function printCommand(file: string, platform: string): Cmd {
  if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${file.replace(/['‘’‚‛]/g, '$&$&')}' -Verb Print -WindowStyle Hidden`] };
  return { file: 'lp', args: ['--', file] };
}

/** A command line in the person's own shell. */
export function shellCommand(command: string, platform: string, shell = process.env.SHELL): Cmd {
  if (platform === 'win32') return { file: 'cmd.exe', args: ['/d', '/s', '/c', command] };
  return { file: shell && /^\/[\w/.-]+$/.test(shell) ? shell : '/bin/sh', args: ['-c', command] };
}

/** Output kept from a command: the start and the end of anything longer. */
export function clipOutput(s: string, max = 200_000): string {
  if (s.length <= max) return s;
  const half = Math.floor(max / 2);
  return `${s.slice(0, half)}\n… ${s.length - max} characters left out …\n${s.slice(-half)}`;
}

export interface SysInfo {
  name: string;
  os: string;
  release: string;
  arch: string;
  cpus: number;
  cpuModel: string;
  memTotal: number;
  memFree: number;
  uptime: number;
  load: number[];
  disks: { mount: string; total: number; free: number }[];
  battery?: { percent: number; charging: boolean };
  user: string;
  keeper: string;
  at: number;
}

export function sysInfoLines(s: SysInfo): [string, string][] {
  const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
  const hrs = Math.floor(s.uptime / 3600);
  return [
    ['System', `${s.os} ${s.release} (${s.arch})`],
    ['Processor', `${s.cpuModel || 'Unknown'} · ${s.cpus} cores`],
    ['Memory', `${gb(s.memTotal - s.memFree)} of ${gb(s.memTotal)} in use`],
    ['Up for', hrs >= 48 ? `${Math.floor(hrs / 24)} days` : `${hrs} h ${Math.floor((s.uptime % 3600) / 60)} min`],
    ['Load', s.load.map((x) => x.toFixed(2)).join(' · ')],
    ...s.disks.map((d) => [`Disk ${d.mount}`, `${gb(d.free)} free of ${gb(d.total)}`] as [string, string]),
    ...(s.battery ? [['Battery', `${Math.round(s.battery.percent)}%${s.battery.charging ? ', charging' : ''}`] as [string, string]] : []),
    ['Signed in', s.user],
    ['Keeper', s.keeper],
  ];
}
