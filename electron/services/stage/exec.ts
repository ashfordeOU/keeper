// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Runs Stage mode's changes on this system: settings (through the commands in
// core/stage/targets.ts), hiding and quitting apps, the screen size, the
// wallpaper for the blurred backdrop, and the facts the plan needs.

import { spawn } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { nativeImage } from 'electron';
import { powershell, run } from '../../../core/platform';
import { chooseMode, dedupe, parseWinModes, parseWlrRandr, parseXrandr } from '../../../core/stage/display';
import type { StageEnv } from '../../../core/stage/plan';
import { macShowAppsScript, MAC_VISIBLE_APPS, osq, parseMacAppList, parseRead, psq, readCmd, winModesScript, winSetModeScript, writeCmds, type Cmd } from '../../../core/stage/targets';
import type { ActionTarget, StageDisplayMode, StageOs, ValueTarget } from '../../../core/stage/types';
import { macHelperCall } from '../platform/mac';

const OS = process.platform as StageOs;
const OSA = '/usr/bin/osascript';

export async function runCmd(c: Cmd, timeout = 20_000) {
  return 'ps' in c ? powershell(c.ps, timeout) : run(c.cmd, c.args, timeout);
}

export async function readValue(t: ValueTarget): Promise<string | null> {
  const r = await runCmd(readCmd(t), 25_000);
  return parseRead(t, r.ok, r.stdout);
}

export async function writeValue(t: ValueTarget, v: string): Promise<boolean> {
  let ok = true;
  for (const c of writeCmds(t, v)) {
    const r = await runCmd(c, 25_000);
    // killall exits non-zero when Finder or the Dock was not running; that is fine.
    if (!r.ok && !('cmd' in c && c.cmd.endsWith('killall'))) ok = false;
  }
  return ok;
}

// ---------------------------------------------------------------- facts for the plan

function onPath(tool: string): boolean {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) if (dir && existsSync(path.join(dir, tool))) return true;
  return false;
}

let envCache: { at: number; env: StageEnv } | null = null;

export async function gatherEnv(): Promise<StageEnv> {
  if (envCache && Date.now() - envCache.at < 60_000) return envCache.env;
  const env: StageEnv = { os: OS, desktop: (process.env.XDG_CURRENT_DESKTOP ?? '').toLowerCase(), wayland: process.env.XDG_SESSION_TYPE === 'wayland', tools: [], schemas: [], extensions: [] };
  if (OS === 'linux') {
    env.tools = ['gsettings', 'gnome-extensions', 'xfconf-query', 'qdbus', 'qdbus6', 'xdotool', 'wmctrl', 'xrandr', 'wlr-randr', 'playerctl', 'pw-dump', 'xinput', 'xmodmap', 'pgrep'].filter(onPath);
    if (env.tools.includes('gsettings')) env.schemas = (await run('gsettings', ['list-schemas'], 5000)).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    if (env.tools.includes('gnome-extensions')) env.extensions = (await run('gnome-extensions', ['list'], 5000)).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  envCache = { at: Date.now(), env };
  return env;
}

// ---------------------------------------------------------------- hiding other apps

/** Window ids (Windows HWNDs, X11 ids) or app names (macOS) that were hidden. */
export interface Hidden { ids: string[]; how: 'mac' | 'win' | 'x11'; bundles?: string[] }

const WIN_WINDOWS = (mode: 'except' | 'only', names: string[], self: number) => `Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public class KeeperWins {
  delegate bool CB(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(CB cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr h, out int p);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  public static List<string> Hide(string[] names, bool only, int self) {
    var fg = GetForegroundWindow(); int fgp; GetWindowThreadProcessId(fg, out fgp);
    var set = new HashSet<string>(names, StringComparer.OrdinalIgnoreCase); var hidden = new List<string>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h) || IsIconic(h) || GetWindow(h, 4) != IntPtr.Zero || GetWindowTextLength(h) == 0) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;
      int pid; GetWindowThreadProcessId(h, out pid);
      if (pid == self || (!only && pid == fgp)) return true;
      string name = ""; try { name = System.Diagnostics.Process.GetProcessById(pid).ProcessName; } catch { return true; }
      if (name == "explorer" && !only) return true;
      if (set.Contains(name) != only) return true;
      if (ShowWindow(h, 7)) hidden.Add(h.ToInt64().ToString());
      return true;
    }, IntPtr.Zero);
    return hidden;
  }
}
'@
[KeeperWins]::Hide(@(${names.map(psq).join(',') || "''"}), $${mode === 'only'}, ${self}) -join ','`;

async function x11Windows(): Promise<{ id: string; pid: number; desk: string; name: string }[]> {
  const r = await run('wmctrl', ['-lp'], 5000);
  const out: { id: string; pid: number; desk: string; name: string }[] = [];
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^(0x[0-9a-f]+)\s+(-?\d+)\s+(\d+)\s/i);
    if (!m) continue;
    const name = await fsp.readFile(`/proc/${m[3]}/comm`, 'utf8').then((s) => s.trim(), () => '');
    out.push({ id: m[1], pid: +m[3], desk: m[2], name });
  }
  return out;
}

async function x11Active(): Promise<string | null> {
  const r = await run('xdotool', ['getactivewindow'], 2000);
  return /^\d+$/.test(r.stdout.trim()) ? `0x${Number(r.stdout.trim()).toString(16)}` : null;
}

const sameX = (a: string, b: string | null) => !!b && parseInt(a, 16) === parseInt(b, 16);

async function x11Minimize(id: string) {
  const r = await run('xdotool', ['windowminimize', id], 3000);
  if (!r.ok) await run('wmctrl', ['-i', '-r', id, '-b', 'add,hidden'], 3000);
}

/**
 * Hides app windows: every app except the front one and those that stay on
 * screen ("except"), or only the named apps ("only").
 */
export async function hideApps(mode: 'except' | 'only', names: string[], staying: (app: string) => boolean): Promise<Hidden | null> {
  if (OS === 'darwin') {
    const list = parseMacAppList((await run(OSA, ['-e', MAC_VISIBLE_APPS], 8000)).stdout);
    const front = (await run(OSA, ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'], 4000)).stdout.trim();
    const apps = list.filter((a) => (mode === 'only' ? names.some((n) => n.toLowerCase() === a.name.toLowerCase()) : a.name !== front && a.name !== 'Finder' && !staying(a.name)));
    if (!apps.length) return { ids: [], bundles: [], how: 'mac' };
    const script = apps.map((a) => `set visible of process ${osq(a.name)} to false`).join('\n');
    await run(OSA, ['-e', `tell application "System Events"\n${script}\nend tell`], 10_000);
    // Bundle ids too, so Stop and the crash watchdog find each app again even if its name is not unique.
    return { ids: apps.map((a) => a.name), bundles: apps.map((a) => a.bundle), how: 'mac' };
  }
  if (OS === 'win32') {
    const keepNames = mode === 'only' ? names : (await import('../devices')).runningApps().then((r) => r.filter(staying));
    const r = await powershell(WIN_WINDOWS(mode, await keepNames, process.pid), 20_000);
    return { ids: r.stdout.trim().split(',').filter((x) => /^\d+$/.test(x)), how: 'win' };
  }
  if (!onPath('wmctrl')) return null;
  const active = await x11Active();
  const ids: string[] = [];
  for (const w of await x11Windows()) {
    if (w.desk === '-1' || w.pid === process.pid || sameX(w.id, active) && mode === 'except') continue;
    const want = mode === 'only' ? names.some((n) => n.toLowerCase() === w.name.toLowerCase()) : !staying(w.name);
    if (!want) continue;
    await x11Minimize(w.id);
    ids.push(w.id);
  }
  return { ids, how: 'x11' };
}

/** Brings hidden apps back, then puts the app that is in front now back in front. */
export async function showApps(h: Extract<ActionTarget, { t: 'apps-hidden' }>) {
  if (!h.ids.length) return;
  if (h.how === 'mac') {
    const front = (await run(OSA, ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'], 4000)).stdout.trim();
    await run(OSA, ['-e', macShowAppsScript(h.ids, h.bundles)], 10_000);
    if (front) await run(OSA, ['-e', `tell application "System Events" to set frontmost of process ${osq(front)} to true`], 4000);
  } else if (h.how === 'win') {
    const ids = h.ids.filter((x) => /^\d+$/.test(x));
    await powershell(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class KeeperShow { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); }'
foreach ($h in @(${ids.join(',') || '0'})) { if ($h -and [KeeperShow]::IsIconic([IntPtr]$h)) { [KeeperShow]::ShowWindow([IntPtr]$h, 4) | Out-Null } }`, 15_000);
  } else {
    const active = await x11Active();
    for (const id of [...h.ids].reverse()) {
      const r = await run('xdotool', ['windowmap', id], 3000);
      if (!r.ok) await run('wmctrl', ['-i', '-r', id, '-b', 'remove,hidden'], 3000);
    }
    if (active) await run('xdotool', ['windowactivate', active], 3000);
  }
}

// ---------------------------------------------------------------- quitting apps

export async function quitApps(names: string[]): Promise<{ name: string; path?: string }[]> {
  const quit: { name: string; path?: string }[] = [];
  for (const name of names) {
    if (OS === 'darwin') {
      const p = (await run(OSA, ['-e', `POSIX path of (path to application ${osq(name)})`], 4000)).stdout.trim();
      const running = (await run(OSA, ['-e', `application ${osq(name)} is running`], 4000)).stdout.trim() === 'true';
      if (!running) continue;
      await run(OSA, ['-e', `tell application ${osq(name)} to quit`], 15_000);
      quit.push({ name, path: p || undefined });
    } else if (OS === 'win32') {
      const r = await powershell(`$p = Get-Process -Name ${psq(name.replace(/\.exe$/i, ''))} -ErrorAction SilentlyContinue; if ($p) { ($p | Select-Object -First 1).Path; $p | ForEach-Object { $_.CloseMainWindow() | Out-Null } }`, 15_000);
      if (r.stdout.trim()) quit.push({ name, path: r.stdout.trim().split(/\r?\n/)[0] });
    } else {
      const pids = (await run('pgrep', ['-x', name], 3000)).stdout.split('\n').map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
      if (!pids.length) continue;
      const exe = await fsp.readlink(`/proc/${pids[0]}/exe`).catch(() => undefined);
      for (const pid of pids) try { process.kill(+pid, 'SIGTERM'); } catch { /* gone */ }
      quit.push({ name, path: exe });
    }
  }
  return quit;
}

export async function reopenApps(apps: { name: string; path?: string }[]) {
  for (const a of apps) {
    try {
      if (OS === 'darwin') await run('/usr/bin/open', a.path ? ['-g', a.path] : ['-g', '-a', a.name], 8000);
      else if (a.path) spawn(a.path, [], { detached: true, stdio: 'ignore', windowsHide: false }).on('error', () => undefined).unref();
    } catch {
      /* it may have moved */
    }
  }
}

// ---------------------------------------------------------------- the screen size

export interface ModeTarget { display: string; how: 'mac' | 'win' | 'xrandr' | 'wlr'; modes: StageDisplayMode[] }

export async function displayModes(): Promise<ModeTarget | null> {
  if (OS === 'darwin') {
    const r = await macHelperCall<{ display: number; modes: StageDisplayMode[] }>('stage.modes', {}, 8000).catch(() => null);
    return r ? { display: String(r.display), how: 'mac', modes: dedupe(r.modes.map((m) => ({ ...m, id: String(m.id) }))) } : null;
  }
  if (OS === 'win32') {
    const r = await powershell(winModesScript(''), 20_000);
    return r.ok ? { display: '', how: 'win', modes: parseWinModes(r.stdout) } : null;
  }
  if (onPath('xrandr') && process.env.DISPLAY) {
    const outs = parseXrandr((await run('xrandr', ['--query'], 8000)).stdout);
    const o = outs.find((x) => x.primary) ?? outs[0];
    return o ? { display: o.output, how: 'xrandr', modes: dedupe(o.modes) } : null;
  }
  if (onPath('wlr-randr')) {
    const outs = parseWlrRandr((await run('wlr-randr', [], 8000)).stdout);
    const o = outs[0];
    return o ? { display: o.output, how: 'wlr', modes: dedupe(o.modes) } : null;
  }
  return null;
}

export async function setMode(t: { display: string; how: ModeTarget['how'] }, m: StageDisplayMode): Promise<boolean> {
  if (t.how === 'mac') return !!(await macHelperCall('stage.setMode', { display: Number(t.display), modeId: Number(m.id), width: m.width, hidpi: m.hidpi }, 10_000).catch(() => null));
  if (t.how === 'win') return /^\s*0\s*$/.test((await powershell(winSetModeScript(t.display, m.width, m.height, m.refresh), 20_000)).stdout);
  if (t.how === 'xrandr') return (await run('xrandr', ['--output', t.display, '--mode', `${m.width}x${m.height}`, ...(m.refresh ? ['--rate', String(m.refresh)] : [])], 10_000)).ok;
  return (await run('wlr-randr', ['--output', t.display, '--mode', `${m.width}x${m.height}${m.refresh ? `@${m.refresh}Hz` : ''}`], 10_000)).ok;
}

export { chooseMode };

// ---------------------------------------------------------------- the wallpaper (for the blurred backdrop)

async function wallpaperPath(): Promise<string | undefined> {
  if (OS === 'darwin') return (await run(OSA, ['-e', 'tell application "System Events" to get picture of current desktop'], 4000)).stdout.trim() || undefined;
  if (OS === 'win32') {
    const r = await powershell(`(Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallPaper).WallPaper`, 8000);
    const p = r.stdout.trim();
    const transcoded = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
    return p && existsSync(p) ? p : existsSync(transcoded) ? transcoded : undefined;
  }
  for (const key of ['picture-uri-dark', 'picture-uri']) {
    const r = await run('gsettings', ['get', 'org.gnome.desktop.background', key], 3000);
    const uri = r.stdout.trim().replace(/^'|'$/g, '');
    if (uri.startsWith('file://')) {
      const p = decodeURIComponent(uri.slice(7));
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

/** A small copy of the wallpaper (it is blurred anyway), as a data URL; undefined when it cannot be read. */
export async function wallpaperThumb(): Promise<string | undefined> {
  const p = await wallpaperPath().catch(() => undefined);
  if (!p) return undefined;
  const img = nativeImage.createFromPath(p);
  if (img.isEmpty()) return undefined;
  const small = img.resize({ width: 480, quality: 'good' });
  return `data:image/jpeg;base64,${small.toJPEG(70).toString('base64')}`;
}

/** macOS: the pointer size from Accessibility settings (1 = normal), when readable. */
export async function macCursorSize(): Promise<number | undefined> {
  const r = await macHelperCall<{ size: number | null }>('stage.cursorSize', {}, 4000).catch(() => null);
  if (typeof r?.size === 'number') return r.size;
  const d = await run('/usr/bin/defaults', ['read', 'com.apple.universalaccess', 'mouseDriverCursorSize'], 3000);
  return d.ok && Number.isFinite(Number(d.stdout.trim())) ? Number(d.stdout.trim()) : undefined;
}
