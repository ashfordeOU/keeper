// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Is the app in front in full screen? Asked every few seconds by the Island
// (it hides during full-screen video and presentations). Starting a program for
// every question costs far more than the answer, so one small helper keeps
// running and reports only when the answer changes:
//
//   Linux (X11)  xprop -spy on the active window and on its state
//   macOS        one osascript (JavaScript) loop asking System Events every 2 s
//   Windows      one PowerShell loop; the window check is compiled once, not each time
//
// The helper stops when nobody has asked for half a minute (screen locked,
// setting off) and starts again on the next question. If a helper cannot run,
// callers fall back to asking the old way.
//
// The same helper also reports which app and window are in front (name, id,
// title, where it is) for Cues: holdFrontWatch() keeps it running while
// something needs that, and onFrontWindow() hears each change. Wayland has no
// shared way to ask which window is in front, so there only the browser
// extension's pages are known.

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { lowerPriority } from './governor';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

let state: boolean | undefined;
const appListeners = new Set<(app: string) => void>();

export interface FrontWindow {
  app: string;
  /** bundle id (macOS), program path (Windows) or WM_CLASS (Linux) */
  appId?: string;
  title: string;
  pid?: number;
  /** where the window is, in screen points, when the system tells */
  bounds?: { x: number; y: number; width: number; height: number };
  at: number;
}

let front: FrontWindow | undefined;
const frontListeners = new Set<(w: FrontWindow) => void>();
let holders = 0;

/** Called with the app and window in front whenever it changes (while a watch is held). */
export function onFrontWindow(fn: (w: FrontWindow) => void): () => void {
  frontListeners.add(fn);
  return () => frontListeners.delete(fn);
}

export function frontWindow(): FrontWindow | undefined {
  return front;
}

function setFront(w: Omit<FrontWindow, 'at'>) {
  if (front && front.app === w.app && front.title === w.title && front.appId === w.appId && JSON.stringify(front.bounds) === JSON.stringify(w.bounds)) return;
  front = { ...w, at: Date.now() };
  for (const fn of frontListeners) {
    try { fn(front); } catch { /* a listener's own problem */ }
  }
}

/** Keeps the front-window helper running (Cues anchored to apps need it). Returns the release. */
export function holdFrontWatch(): () => void {
  holders++;
  lastAsked = Date.now();
  if (!helpers.length) start();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    lastAsked = Date.now();
    armIdle();
  };
}

/** Is a front-window helper possible here? (no on Wayland without XWayland, or when it failed twice) */
export function frontWatchAvailable(): boolean {
  if (failures >= 2) return false;
  if (process.platform === 'linux') return !!process.env.DISPLAY;
  return true;
}

/** macOS: called when another app comes to the front (its menus are a different width). */
export function onFrontAppChange(fn: (app: string) => void): () => void {
  appListeners.add(fn);
  return () => appListeners.delete(fn);
}
let lastAsked = 0;
let helpers: ChildProcess[] = [];
let idleTimer: NodeJS.Timeout | undefined;
let failures = 0;
let startedAt = 0;

const MAC_SCRIPT = `
const se = Application('System Events');
let last = '';
let lastApp = '';
let lastInfo = '';
while (true) {
  let v = 'no';
  try {
    const p = se.processes.whose({ frontmost: true })[0];
    const app = p.name();
    if (app !== lastApp) { lastApp = app; console.log('app:' + app); }
    const w = p.windows.length ? p.windows[0] : null;
    if (w && w.attributes['AXFullScreen'].value() === true) v = 'yes';
    let info = '';
    try {
      const pos = w ? w.position() : null; const sz = w ? w.size() : null;
      info = JSON.stringify({ app: app, appId: p.bundleIdentifier(), pid: p.unixId(), title: w ? (w.name() || '') : '', bounds: pos && sz ? { x: pos[0], y: pos[1], width: sz[0], height: sz[1] } : undefined });
    } catch (e) {}
    if (info && info !== lastInfo) { lastInfo = info; console.log('win:' + info); }
  } catch (e) {}
  if (v !== last) { last = v; console.log(v); }
  delay(2);
}`;

const WIN_SCRIPT = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class KeeperFgw { [StructLayout(LayoutKind.Sequential)] public struct R { public int l, t, r, b; }
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
 [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
 [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }
'@
Add-Type -AssemblyName System.Windows.Forms
$last = ''
$lastInfo = ''
[Console]::OutputEncoding = [Text.Encoding]::UTF8
while ($true) {
  $v = 'no'
  $h = [KeeperFgw]::GetForegroundWindow()
  if ($h -ne [IntPtr]::Zero -and $h -ne [KeeperFgw]::GetShellWindow()) {
    $r = New-Object KeeperFgw+R
    if ([KeeperFgw]::GetWindowRect($h, [ref]$r)) {
      $s = [System.Windows.Forms.Screen]::FromHandle($h).Bounds
      if ($r.l -le $s.Left -and $r.t -le $s.Top -and $r.r -ge $s.Right -and $r.b -ge $s.Bottom) { $v = 'yes' }
      $sb = New-Object System.Text.StringBuilder 512
      [void][KeeperFgw]::GetWindowText($h, $sb, 512)
      $procId = [uint32]0; [void][KeeperFgw]::GetWindowThreadProcessId($h, [ref]$procId)
      $name = ''; $exe = ''
      try { $p = Get-Process -Id $procId -ErrorAction Stop; $name = $p.ProcessName; $exe = $p.Path } catch {}
      $info = @{ app = $name; appId = $exe; pid = $procId; title = $sb.ToString(); bounds = @{ x = $r.l; y = $r.t; width = $r.r - $r.l; height = $r.b - $r.t } } | ConvertTo-Json -Compress
      if ($info -ne $lastInfo) { $lastInfo = $info; [Console]::Out.WriteLine('win:' + $info); [Console]::Out.Flush() }
    }
  }
  if ($v -ne $last) { $last = $v; [Console]::Out.WriteLine($v); [Console]::Out.Flush() }
  Start-Sleep -Milliseconds 2000
}`;

function stop() {
  for (const h of helpers) h.kill();
  helpers = [];
  state = undefined;
  linuxWin = { title: '' };
}

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (Date.now() - lastAsked >= 30_000 && !holders) stop(); else armIdle(); }, 31_000);
  idleTimer.unref?.();
}

/** Front-window details reported by the helpers ("win:{json}"). */
function onWinLine(json: string) {
  try {
    const o = JSON.parse(json) as { app?: string; appId?: string; title?: string; pid?: number; bounds?: FrontWindow['bounds'] };
    if (!o.app && !o.title) return;
    setFront({ app: o.app ?? '', appId: o.appId || undefined, title: o.title ?? '', pid: o.pid, bounds: o.bounds && o.bounds.width > 0 ? o.bounds : undefined });
  } catch {
    /* a partial line */
  }
}

// Linux: the window's class and title come from the same xprop -spy as its state.
let linuxWin: { title: string; cls?: string; inst?: string; pid?: number } = { title: '' };
/** Parses one xprop line about the active window (title, class, pid, state). */
export function parseXpropLine(l: string, cur: { title: string; cls?: string; inst?: string; pid?: number }): { title: string; cls?: string; inst?: string; pid?: number } {
  const name = l.match(/^_NET_WM_NAME\(UTF8_STRING\) = "(.*)"$/) ?? l.match(/^WM_NAME\((?:STRING|COMPOUND_TEXT)\) = "(.*)"$/);
  if (name) return { ...cur, title: name[1].replace(/\\"/g, '"') };
  const cls = l.match(/^WM_CLASS\(STRING\) = "([^"]*)", "([^"]*)"$/);
  if (cls) return { ...cur, inst: cls[1], cls: cls[2] };
  const pid = l.match(/^_NET_WM_PID\(CARDINAL\) = (\d+)$/);
  if (pid) return { ...cur, pid: Number(pid[1]) };
  return cur;
}

function lines(child: ChildProcess, stream: 'stdout' | 'stderr', onLine: (l: string) => void) {
  let buf = '';
  child[stream]?.setEncoding('utf8');
  child[stream]?.on('data', (d: string) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      onLine(buf.slice(0, i).trim());
      buf = buf.slice(i + 1);
    }
  });
}

function own(child: ChildProcess): ChildProcess {
  helpers.push(child);
  lowerPriority(child);
  child.on('error', () => undefined);
  child.on('exit', () => {
    helpers = helpers.filter((h) => h !== child);
    // A helper that dies straight away cannot run here (missing tool, no permission).
    if (Date.now() - startedAt < 10_000) failures++;
    if (!helpers.length) state = undefined;
  });
  return child;
}

let stateSpy: ChildProcess | undefined;
let spyId = '';
function watchWindow(id: string) {
  // xprop repeats the active window when its other properties change.
  if (id === spyId && stateSpy && helpers.includes(stateSpy)) return;
  spyId = id;
  stateSpy?.kill();
  stateSpy = undefined;
  if (!/^0x[0-9a-f]+$/i.test(id) || /^0x0+$/i.test(id)) {
    state = false;
    return;
  }
  const spy = own(spawn('xprop', ['-spy', '-id', id, '_NET_WM_STATE', '_NET_WM_NAME', 'WM_CLASS', '_NET_WM_PID'], { stdio: ['ignore', 'pipe', 'ignore'] }));
  stateSpy = spy;
  linuxWin = { title: '' };
  lines(spy, 'stdout', (l) => {
    if (stateSpy !== spy) return;
    if (l.startsWith('_NET_WM_STATE')) { state = /_NET_WM_STATE_FULLSCREEN/.test(l); return; }
    linuxWin = parseXpropLine(l, linuxWin);
    if (linuxWin.cls || linuxWin.title) setFront({ app: linuxWin.cls ?? linuxWin.inst ?? '', appId: linuxWin.inst, title: linuxWin.title, pid: linuxWin.pid, bounds: undefined });
  });
}

function start(): boolean {
  if (failures >= 2) return false;
  startedAt = Date.now();
  try {
    if (isMac) {
      // osascript prints console.log to stderr.
      lines(own(spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_SCRIPT], { stdio: ['ignore', 'ignore', 'pipe'] })), 'stderr', (l) => {
        if (l === 'yes' || l === 'no') state = l === 'yes';
        else if (l.startsWith('app:')) for (const fn of appListeners) fn(l.slice(4));
        else if (l.startsWith('win:')) onWinLine(l.slice(4));
      });
    } else if (isWin) {
      const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      lines(own(spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_SCRIPT], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })), 'stdout', (l) => { if (l === 'yes' || l === 'no') state = l === 'yes'; else if (l.startsWith('win:')) onWinLine(l.slice(4)); });
    } else {
      // Wayland has no shared way to ask; xprop only answers under X11.
      if (!process.env.DISPLAY) return false;
      lines(own(spawn('xprop', ['-root', '-spy', '_NET_ACTIVE_WINDOW'], { stdio: ['ignore', 'pipe', 'ignore'] })), 'stdout', (l) => {
        const id = l.match(/window id # (0x[0-9a-f]+)/i)?.[1] ?? '0x0';
        watchWindow(id);
      });
    }
    return true;
  } catch {
    failures++;
    return false;
  }
}

/**
 * The latest answer from the running helper, starting it if needed. Undefined
 * while it is starting or when no helper can run here: ask the old way then.
 */
export function fullscreenNow(): boolean | undefined {
  lastAsked = Date.now();
  if (!helpers.length && !start()) return undefined;
  armIdle();
  // Still starting: say "not full screen" rather than start a second program to ask.
  return state ?? false;
}

// Helpers watching with -spy would outlive Keeper otherwise.
process.on('exit', stop);

export function stopFullscreenWatch() {
  clearTimeout(idleTimer);
  stop();
}

/** Linux: where a window is (xwininfo), asked only when a cue needs to pop up beside it. */
export async function linuxWindowBounds(): Promise<FrontWindow['bounds']> {
  if (process.platform !== 'linux' || !process.env.DISPLAY || !spyId || /^0x0+$/i.test(spyId)) return undefined;
  const { run } = await import('../../core/platform');
  const r = await run('xwininfo', ['-id', spyId], 2000);
  const n = (k: string) => Number(r.stdout.match(new RegExp(`${k}:\\s+(-?\\d+)`))?.[1]);
  const x = n('Absolute upper-left X');
  const y = n('Absolute upper-left Y');
  const width = n('Width');
  const height = n('Height');
  return [x, y, width, height].every(Number.isFinite) && width > 0 ? { x, y, width, height } : undefined;
}
