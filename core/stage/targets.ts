// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// How Stage reads, changes and puts back each kind of system setting, as
// commands (no Electron, so the tests and the crash watchdog's script use the
// same commands the app runs).

import type { JournalEntry, StageOs, ValueTarget } from './types';

/** A command to run: a program with arguments, or a PowerShell script on Windows. */
export type Cmd = { cmd: string; args: string[] } | { ps: string };

/** A setting that was not set before (restoring it removes it again). */
export const UNSET = '<unset>';

const OSA = '/usr/bin/osascript';
const DEFAULTS = '/usr/bin/defaults';
const KILLALL = '/usr/bin/killall';

/** PowerShell single-quoted string. */
export const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** POSIX shell single-quoted string. */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** AppleScript string literal. */
export const osq = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const OSA_PROP = {
  'dock-autohide': { get: 'tell application "System Events" to get autohide of dock preferences', set: (v: string) => `tell application "System Events" to set autohide of dock preferences to ${v === 'true'}` },
  'menubar-autohide': { get: 'tell application "System Events" to get autohide menu bar of dock preferences', set: (v: string) => `tell application "System Events" to set autohide menu bar of dock preferences to ${v === 'true'}` },
  'alert-volume': { get: 'alert volume of (get volume settings)', set: (v: string) => `set volume alert volume ${Math.max(0, Math.min(100, Math.round(Number(v) || 0)))}` },
} as const;

const WIN_TASKBAR = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class KeeperAppBar {
  [StructLayout(LayoutKind.Sequential)] public struct ABD { public int cbSize; public IntPtr hWnd; public uint cb; public uint edge; public int l, t, r, b; public IntPtr lParam; }
  [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref ABD d);
  static ABD D() { var d = new ABD(); d.cbSize = Marshal.SizeOf(d); d.hWnd = FindWindow("Shell_TrayWnd", null); return d; }
  [DllImport("user32.dll")] static extern IntPtr FindWindow(string c, string w);
  public static bool Get() { var d = D(); return ((uint)SHAppBarMessage(4, ref d) & 1) == 1; }
  public static void Set(bool hide) { var d = D(); d.lParam = (IntPtr)(hide ? 1 : 2); SHAppBarMessage(10, ref d); }
}
'@`;

const WIN_ICONS = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class KeeperDesk {
  [DllImport("user32.dll")] static extern IntPtr FindWindow(string c, string w);
  [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string w);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  static IntPtr View() {
    var v = FindWindowEx(FindWindow("Progman", null), IntPtr.Zero, "SHELLDLL_DefView", null);
    var w = IntPtr.Zero;
    while (v == IntPtr.Zero && (w = FindWindowEx(IntPtr.Zero, w, "WorkerW", null)) != IntPtr.Zero) v = FindWindowEx(w, IntPtr.Zero, "SHELLDLL_DefView", null);
    return v;
  }
  public static bool Shown() { var l = FindWindowEx(View(), IntPtr.Zero, "SysListView32", null); return l != IntPtr.Zero && IsWindowVisible(l); }
  public static void Set(bool show) { if (Shown() != show) SendMessage(View(), 0x111, (IntPtr)0x7402, IntPtr.Zero); }
}
'@`;

const WIN_CURSORS = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class KeeperCur { [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, IntPtr c, uint d); }
'@
[KeeperCur]::SystemParametersInfo(0x57, 0, [IntPtr]::Zero, 3) | Out-Null`;

const KDE_READ = 'print(panels().length ? panels()[0].hiding : "none")';
const KDE_WRITE = (v: string) => `panels().forEach(function (p) { p.hiding = ${JSON.stringify(v)} })`;

/** The command that reads a setting's current value. */
export function readCmd(t: ValueTarget): Cmd {
  switch (t.t) {
    case 'mac-defaults': return { cmd: DEFAULTS, args: ['read', t.domain, t.key] };
    case 'mac-osa': return { cmd: OSA, args: ['-e', OSA_PROP[t.prop].get] };
    case 'gsettings': return { cmd: 'gsettings', args: ['get', t.schema, t.key] };
    case 'gnome-ext': return { cmd: 'gnome-extensions', args: ['list', '--enabled'] };
    case 'xfconf': return { cmd: 'xfconf-query', args: ['-c', t.channel, '-p', t.prop] };
    case 'kde-panel': return { cmd: t.qdbus, args: ['org.kde.plasmashell', '/PlasmaShell', 'org.kde.PlasmaShell.evaluateScript', KDE_READ] };
    case 'win-reg': return { ps: `try { $v = Get-ItemPropertyValue -Path ${psq(t.path)} -Name ${psq(t.name)} -ErrorAction Stop; [string]$v } catch { '${UNSET}' }` };
    case 'win-taskbar': return { ps: `${WIN_TASKBAR}\n[KeeperAppBar]::Get()` };
    case 'win-desktop-icons': return { ps: `${WIN_ICONS}\n[KeeperDesk]::Shown()` };
  }
}

/**
 * Turns what a reader printed into the stored value. `ok` false means the
 * command failed: for `defaults` that is a key that was never set.
 */
export function parseRead(t: ValueTarget, ok: boolean, stdout: string): string | null {
  const s = stdout.trim();
  switch (t.t) {
    case 'mac-defaults':
      if (!ok) return UNSET;
      if (t.type === 'bool') return /^(1|true|yes)$/i.test(s) ? 'true' : /^(0|false|no)$/i.test(s) ? 'false' : null;
      return Number.isFinite(Number(s)) && s !== '' ? String(Number(s)) : null;
    case 'mac-osa':
      if (!ok) return null;
      if (t.prop === 'alert-volume') return Number.isFinite(Number(s)) && s !== '' ? String(Math.round(Number(s))) : null;
      return s === 'true' || s === 'false' ? s : null;
    case 'gsettings': return ok && s ? s : null;
    case 'gnome-ext': return ok ? String(s.split(/\r?\n/).map((l) => l.trim()).includes(t.uuid)) : null;
    case 'xfconf': return ok && s ? s : null;
    case 'kde-panel': return ok && s ? s : null;
    case 'win-reg': return ok ? s || UNSET : null;
    case 'win-taskbar':
    case 'win-desktop-icons': return ok && /^(true|false)$/i.test(s) ? s.toLowerCase() : null;
  }
}

/** The commands that set a value (several where the system needs a nudge to notice). */
export function writeCmds(t: ValueTarget, v: string): Cmd[] {
  switch (t.t) {
    case 'mac-defaults': {
      const set: Cmd = v === UNSET
        ? { cmd: DEFAULTS, args: ['delete', t.domain, t.key] }
        : { cmd: DEFAULTS, args: ['write', t.domain, t.key, `-${t.type}`, t.type === 'bool' ? String(v === 'true') : v] };
      return t.after ? [set, { cmd: KILLALL, args: [t.after] }] : [set];
    }
    case 'mac-osa': return [{ cmd: OSA, args: ['-e', OSA_PROP[t.prop].set(v)] }];
    case 'gsettings': return [{ cmd: 'gsettings', args: ['set', t.schema, t.key, v] }];
    case 'gnome-ext': return [{ cmd: 'gnome-extensions', args: [v === 'true' ? 'enable' : 'disable', t.uuid] }];
    case 'xfconf': return [{ cmd: 'xfconf-query', args: ['-c', t.channel, '-p', t.prop, '-n', '-t', t.type, '-s', v] }];
    case 'kde-panel': return [{ cmd: t.qdbus, args: ['org.kde.plasmashell', '/PlasmaShell', 'org.kde.PlasmaShell.evaluateScript', KDE_WRITE(v)] }];
    case 'win-reg': {
      const ps = v === UNSET
        ? `Remove-ItemProperty -Path ${psq(t.path)} -Name ${psq(t.name)} -ErrorAction SilentlyContinue`
        : `if (-not (Test-Path ${psq(t.path)})) { New-Item -Path ${psq(t.path)} -Force | Out-Null }; New-ItemProperty -Path ${psq(t.path)} -Name ${psq(t.name)} -Value ${t.type === 'DWORD' ? String(Math.round(Number(v) || 0)) : psq(v)} -PropertyType ${t.type} -Force | Out-Null`;
      return [{ ps: t.after === 'cursors' ? `${ps}\n${WIN_CURSORS}` : ps }];
    }
    case 'win-taskbar': return [{ ps: `${WIN_TASKBAR}\n[KeeperAppBar]::Set($${v === 'true'})` }];
    case 'win-desktop-icons': return [{ ps: `${WIN_ICONS}\n[KeeperDesk]::Set($${v === 'true'})` }];
  }
}

/** What the reader prints for a stored value (to compare in the watchdog's shell script). */
function rawFor(t: ValueTarget, v: string): string | null {
  if (t.t === 'mac-defaults') return v === UNSET ? null : t.type === 'bool' ? (v === 'true' ? '1' : '0') : v;
  if (t.t === 'mac-osa' || t.t === 'gsettings') return v;
  return null;
}

/** A short, stable key for a setting (two switches never fight over one). */
export function targetKey(t: ValueTarget): string {
  switch (t.t) {
    case 'mac-defaults': return `defaults:${t.domain}:${t.key}`;
    case 'mac-osa': return `osa:${t.prop}`;
    case 'gsettings': return `gsettings:${t.schema}:${t.key}`;
    case 'gnome-ext': return `ext:${t.uuid}`;
    case 'xfconf': return `xfconf:${t.channel}:${t.prop}`;
    case 'kde-panel': return 'kde-panel';
    case 'win-reg': return `reg:${t.path}:${t.name}`;
    case 'win-taskbar': return 'taskbar';
    case 'win-desktop-icons': return 'desktop-icons';
  }
}

export const isValueTarget = (t: JournalEntry['target']): t is ValueTarget => !['apps-hidden', 'apps-quit', 'music-paused', 'display-mode', 'awake', 'focus'].includes(t.t);

const shCmd = (c: Cmd) => ('ps' in c ? '' : [c.cmd, ...c.args].map(shq).join(' '));

/**
 * The script the crash watchdog runs if Keeper's process disappears while
 * Stage is on. Settings go back only if they still hold what Stage set
 * (otherwise the person changed them, and they stay as they are). Apps Stage
 * hid come back. Things that end with Keeper's process (overlays, the
 * backdrop, the keep-awake hold) need nothing.
 */
export function restoreScript(entries: JournalEntry[], os: StageOs, helper?: string): string {
  const done = [...entries].filter((e) => e.state === 'applied' || e.state === 'pending').sort((a, b) => b.seq - a.seq);
  if (os === 'win32') {
    const out: string[] = ['$ErrorActionPreference = "SilentlyContinue"'];
    for (const e of done) {
      const t = e.target;
      if (isValueTarget(t) && e.prior !== undefined && e.applied !== undefined) {
        const read = readCmd(t);
        const write = writeCmds(t, e.prior).map((c) => ('ps' in c ? c.ps : '')).join('\n');
        if ('ps' in read && t.t === 'win-reg') out.push(`$cur = & { ${read.ps} }\nif ([string]$cur -eq ${psq(e.applied)}) {\n${write}\n}`);
        else out.push(write);
      } else if (t.t === 'apps-hidden' && t.how === 'win') {
        out.push(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class KeeperShow { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); }'`);
        for (const id of t.ids) if (/^\d+$/.test(id)) out.push(`if ([KeeperShow]::IsIconic([IntPtr]${id})) { [KeeperShow]::ShowWindow([IntPtr]${id}, 4) | Out-Null }`);
      } else if (t.t === 'display-mode' && t.how === 'win') {
        out.push(winSetModeScript(t.display, t.prior.width, t.prior.height, t.prior.refresh));
      }
    }
    return out.join('\n');
  }
  const out: string[] = ['#!/bin/sh', '# Written by Keeper while Stage mode is on; run if Keeper stops unexpectedly.'];
  for (const e of done) {
    const t = e.target;
    if (isValueTarget(t) && e.prior !== undefined && e.applied !== undefined) {
      const write = writeCmds(t, e.prior).map(shCmd).filter(Boolean).join(' && ');
      const raw = rawFor(t, e.applied);
      const read = readCmd(t);
      if (raw !== null && !('ps' in read)) out.push(`[ "$(${shCmd(read)} 2>/dev/null)" = ${shq(raw)} ] && ${write}`);
      else out.push(`${write} 2>/dev/null`);
    } else if (t.t === 'apps-hidden' && t.how === 'mac') {
      for (const name of t.ids) out.push(`${shq(OSA)} -e ${shq(`tell application "System Events" to set visible of process ${osq(name)} to true`)} 2>/dev/null`);
    } else if (t.t === 'apps-hidden' && t.how === 'x11') {
      for (const id of t.ids) if (/^(0x)?[0-9a-f]+$/i.test(id)) out.push(`xdotool windowmap ${shq(id)} 2>/dev/null`);
    } else if (t.t === 'display-mode' && t.how === 'xrandr') {
      out.push(`xrandr --output ${shq(t.display)} --mode ${shq(`${t.prior.width}x${t.prior.height}`)}${t.prior.refresh ? ` --rate ${shq(String(t.prior.refresh))}` : ''} 2>/dev/null`);
    } else if (t.t === 'display-mode' && t.how === 'wlr') {
      out.push(`wlr-randr --output ${shq(t.display)} --mode ${shq(`${t.prior.width}x${t.prior.height}`)} 2>/dev/null`);
    } else if (t.t === 'display-mode' && t.how === 'mac' && helper && t.prior.modeId) {
      out.push(`printf '%s\\n' ${shq(JSON.stringify({ id: 1, method: 'stage.setMode', params: { display: Number(t.display), modeId: Number(t.prior.modeId) } }))} | ${shq(helper)} >/dev/null 2>&1`);
    }
  }
  return out.join('\n') + '\n';
}

const WIN_MODE_TYPE = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class KeeperMode {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct DM {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string n; public short sv, dv, sz, ex; public int fields; public int px, py, orient, fixedOut;
    public short color, duplex, yres, tt, coll; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string form; public short lpx; public int bpp, w, h, flags, freq;
    public int icm, icmi, media, dither, r1, r2, pw, ph; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool EnumDisplaySettings(string d, int m, ref DM dm);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string d, ref DM dm, IntPtr h, int f, IntPtr l);
  public static string Modes(string d) { var s = ""; var dm = new DM(); dm.sz = (short)Marshal.SizeOf(dm); EnumDisplaySettings(d, -1, ref dm); s += "cur " + dm.w + " " + dm.h + " " + dm.freq + "\\n"; for (int i = 0; EnumDisplaySettings(d, i, ref dm); i++) s += dm.w + " " + dm.h + " " + dm.freq + "\\n"; return s; }
  public static int Set(string d, int w, int h, int f) { var dm = new DM(); dm.sz = (short)Marshal.SizeOf(dm); EnumDisplaySettings(d, -1, ref dm); dm.w = w; dm.h = h; dm.fields = 0x80000 | 0x100000; if (f > 0) { dm.freq = f; dm.fields |= 0x400000; } return ChangeDisplaySettingsEx(d, ref dm, IntPtr.Zero, 0, IntPtr.Zero); }
}
'@`;

// [NullString]::Value, not $null: PowerShell passes $null to a string parameter as "", and EnumDisplaySettings("") finds no display.
const winDisplay = (display: string) => (display ? psq(display) : '[NullString]::Value');

/** Windows: the modes of a display ('' = the main one), for parseWinModes. */
export function winModesScript(display = ''): string {
  return `${WIN_MODE_TYPE}\n[KeeperMode]::Modes(${winDisplay(display)})`;
}

/** Windows: change one display's resolution for this session (not saved in the registry); prints 0 when it worked. */
export function winSetModeScript(display: string, width: number, height: number, refresh?: number): string {
  return `${WIN_MODE_TYPE}\n[KeeperMode]::Set(${winDisplay(display)}, ${Math.round(width)}, ${Math.round(height)}, ${Math.round(refresh ?? 0)})`;
}
