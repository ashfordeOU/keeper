// SPDX-License-Identifier: AGPL-3.0-or-later
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

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { lowerPriority } from './governor';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

let state: boolean | undefined;
const appListeners = new Set<(app: string) => void>();

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
while (true) {
  let v = 'no';
  try {
    const p = se.processes.whose({ frontmost: true })[0];
    const app = p.name();
    if (app !== lastApp) { lastApp = app; console.log('app:' + app); }
    if (p.windows.length && p.windows[0].attributes['AXFullScreen'].value() === true) v = 'yes';
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
 [DllImport("user32.dll")] public static extern IntPtr GetShellWindow(); }
'@
Add-Type -AssemblyName System.Windows.Forms
$last = ''
while ($true) {
  $v = 'no'
  $h = [KeeperFgw]::GetForegroundWindow()
  if ($h -ne [IntPtr]::Zero -and $h -ne [KeeperFgw]::GetShellWindow()) {
    $r = New-Object KeeperFgw+R
    if ([KeeperFgw]::GetWindowRect($h, [ref]$r)) {
      $s = [System.Windows.Forms.Screen]::FromHandle($h).Bounds
      if ($r.l -le $s.Left -and $r.t -le $s.Top -and $r.r -ge $s.Right -and $r.b -ge $s.Bottom) { $v = 'yes' }
    }
  }
  if ($v -ne $last) { $last = $v; [Console]::Out.WriteLine($v); [Console]::Out.Flush() }
  Start-Sleep -Milliseconds 2000
}`;

function stop() {
  for (const h of helpers) h.kill();
  helpers = [];
  state = undefined;
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
  const spy = own(spawn('xprop', ['-spy', '-id', id, '_NET_WM_STATE'], { stdio: ['ignore', 'pipe', 'ignore'] }));
  stateSpy = spy;
  lines(spy, 'stdout', (l) => { if (stateSpy === spy) state = /_NET_WM_STATE_FULLSCREEN/.test(l); });
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
      });
    } else if (isWin) {
      const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      lines(own(spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_SCRIPT], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })), 'stdout', (l) => { if (l === 'yes' || l === 'no') state = l === 'yes'; });
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
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (Date.now() - lastAsked >= 30_000) stop(); }, 31_000);
  // Still starting: say "not full screen" rather than start a second program to ask.
  return state ?? false;
}

// Helpers watching with -spy would outlive Keeper otherwise.
process.on('exit', stop);

export function stopFullscreenWatch() {
  clearTimeout(idleTimer);
  stop();
}
