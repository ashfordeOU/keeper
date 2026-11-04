// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Snap windows: moves the window in front, and every window of a saved layout,
// with each system's own public window calls (the ones the computer-use tools
// use to list and raise windows, electron/services/computer-os.ts):
//
//   macOS    System Events (JavaScript for Automation): a window's position and
//            size (Accessibility permission)
//   Windows  user32 through PowerShell: GetWindowRect / SetWindowPos, in
//            physical pixels (converted from Electron's points)
//   Linux    wmctrl, or xdotool, on X11. Wayland does not let one app move
//            another's windows: the page says so and nothing is registered
//
// Nothing runs while the part is off: its shortcuts are registered only while
// it is on, and the screen watcher for "restore when screens change" only
// while that setting is on too.

import { screen, shell, systemPreferences } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { displaySetKey, displaySetName, captureLayout, insideFrame, parseFrameExtents, layoutForScreens, normalizeLayouts, normalizeSnapSettings, planRestore, SNAP_ACTIONS, snapAvailability, snapShortcutsActive, targetRect, type LiveWindow, type Rect, type SnapAction, type SnapAvailability, type SnapLayout } from '../../core/snap';
import type { SnapApi, SnapStatus } from '../../core/api-snap';
import { run } from '../../core/platform';
import { settings, updateSettings } from '../store';
import { featureOn, onFeature } from './features';
import { permissionNeeded } from './permission-nudge';
import { monorailState, onRawState } from './ashforde/monorail';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isWayland = () => process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY) && !process.env.DISPLAY;

function onPath(cmd: string): boolean {
  return (process.env.PATH ?? '').split(path.delimiter).some((d) => d && existsSync(path.join(d, cmd)));
}

export function availability(): SnapAvailability {
  return snapAvailability({
    platform: process.platform,
    wayland: isWayland(),
    tools: process.platform === 'linux' ? onPath('wmctrl') || onPath('xdotool') : undefined,
    accessibility: isMac ? systemPreferences.isTrustedAccessibilityClient(false) : undefined,
    monorail: isMac && featureOn('monorail') && !!monorailState(),
    desktop: process.env.XDG_CURRENT_DESKTOP,
  });
}

// ---------------------------------------------------------------- screens

const works = (): Rect[] => screen.getAllDisplays().map((d) => d.workArea);
const screensNow = () => screen.getAllDisplays().map((d) => d.bounds);

// ---------------------------------------------------------------- the system's window calls

async function jxa(script: string): Promise<unknown> {
  const r = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], 8000);
  if (!r.ok) {
    if (/not allowed|1002|-1719|assistive/i.test(r.stderr ?? '')) {
      permissionNeeded('accessibility', 'snapWindows');
      throw new Error('Allow Keeper in System Settings → Privacy & Security → Accessibility.');
    }
    throw new Error((r.stderr || 'System Events did not answer').split('\n')[0]);
  }
  return JSON.parse(r.stdout.trim() || 'null');
}

async function ps(script: string): Promise<unknown> {
  const { psRun } = await import('./ps-host');
  const r = await psRun(script, 10_000);
  if (!r.ok) throw new Error('PowerShell did not answer');
  const t = r.stdout.trim();
  return t ? JSON.parse(t) : null;
}

const PS_SNAP = `
if (-not ('KeeperSnap' -as [type])) { Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public class KeeperSnap {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
 [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 public static void Place(IntPtr h, int x, int y, int w, int hh) { if (IsZoomed(h) || IsIconic(h)) ShowWindow(h, 9); SetWindowPos(h, IntPtr.Zero, x, y, w, hh, 0x0014); }
}
'@ }`;

const toInt = (r: Rect) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
// Electron works in points; Windows' window calls in physical pixels.
const winToPx = (r: Rect): Rect => (isWin ? screen.dipToScreenRect(null, toInt(r)) : r);
const winFromPx = (r: Rect): Rect => (isWin ? screen.screenToDipRect(null, toInt(r)) : r);

/** The window in front: an id the move calls understand, and where it is in points. */
async function frontWindow(): Promise<{ id: string; app: string; bounds: Rect } | null> {
  if (isMac) {
    const r = (await jxa(`const se=Application('System Events');const p=se.processes.whose({frontmost:true})[0];const w=p.windows[0];const a=w.position(),b=w.size();JSON.stringify({id:p.unixId()+':0',app:p.name(),x:a[0],y:a[1],width:b[0],height:b[1]})`)) as ({ id: string; app: string } & Rect) | null;
    return r ? { id: r.id, app: r.app, bounds: { x: r.x, y: r.y, width: r.width, height: r.height } } : null;
  }
  if (isWin) {
    const r = (await ps(`${PS_SNAP}
$h=[KeeperSnap]::GetForegroundWindow(); $r=New-Object KeeperSnap+RECT; [void][KeeperSnap]::GetWindowRect($h,[ref]$r); $p=0; [void][KeeperSnap]::GetWindowThreadProcessId($h,[ref]$p)
$n=''; try { $n=(Get-Process -Id $p).ProcessName } catch {}
@{ id=[string]$h; app=$n; x=$r.L; y=$r.T; width=$r.R-$r.L; height=$r.B-$r.T } | ConvertTo-Json -Compress`)) as ({ id: string; app: string } & Rect) | null;
    return r && r.id !== '0' ? { id: r.id, app: r.app, bounds: winFromPx(r) } : null;
  }
  const a = await run('xdotool', ['getactivewindow'], 3000);
  const id = a.ok ? a.stdout.trim() : '';
  if (!/^\d+$/.test(id)) return null;
  const g = await run('xdotool', ['getwindowgeometry', '--shell', id], 3000);
  if (!g.ok) return null;
  const v = (k: string) => Number((new RegExp(`^${k}=(-?\\d+)`, 'm').exec(g.stdout) || [])[1]);
  const bounds = { x: v('X'), y: v('Y'), width: v('WIDTH'), height: v('HEIGHT') };
  return Number.isFinite(bounds.width) && bounds.width > 0 ? { id, app: '', bounds } : null;
}

/** Every ordinary window with where it is (for saving and restoring layouts). */
async function listWindows(): Promise<LiveWindow[]> {
  if (isMac) {
    return ((await jxa(`const se=Application('System Events');const out=[];for(const p of se.processes.whose({backgroundOnly:false})()){let ws=[];try{ws=p.windows()}catch(e){}for(let i=0;i<ws.length&&i<12;i++){try{const a=ws[i].position(),b=ws[i].size();let t='';try{t=ws[i].name()||''}catch(e){}out.push({id:p.unixId()+':'+i,app:p.name(),title:t,bounds:{x:a[0],y:a[1],width:b[0],height:b[1]}})}catch(e){}}}JSON.stringify(out)`)) as LiveWindow[] | null) ?? [];
  }
  if (isWin) {
    const r = (await ps(`${PS_SNAP}
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { $r=New-Object KeeperSnap+RECT; [void][KeeperSnap]::GetWindowRect($_.MainWindowHandle,[ref]$r); @{ id=[string]$_.MainWindowHandle; app=$_.ProcessName; title=$_.MainWindowTitle; bounds=@{ x=$r.L; y=$r.T; width=$r.R-$r.L; height=$r.B-$r.T } } } | ConvertTo-Json -Compress -Depth 4`)) as LiveWindow[] | LiveWindow | null;
    return (Array.isArray(r) ? r : r ? [r] : []).map((w) => ({ ...w, bounds: winFromPx(w.bounds) }));
  }
  const w = await run('wmctrl', ['-lpG'], 3000);
  if (!w.ok) throw new Error('Saving layouts needs wmctrl on X11.');
  const out: LiveWindow[] = [];
  const { promises: fsp } = await import('node:fs');
  const hasXprop = onPath('xprop');
  for (const line of w.stdout.split('\n')) {
    // id desktop pid x y w h host title
    const m = line.match(/^(0x[0-9a-f]+)\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+\S+\s+(.*)$/i);
    if (!m || m[2] === '-1') continue;
    const pid = Number(m[3]);
    const app = pid ? (await fsp.readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '')).trim() : '';
    // wmctrl gives the window's own box; the frame around it is part of where it sits.
    const f = parseFrameExtents(hasXprop ? (await run('xprop', ['-id', m[1], '_NET_FRAME_EXTENTS'], 2000)).stdout : '');
    out.push({ id: m[1], app, title: m[8], bounds: { x: +m[4] - f.left, y: +m[5] - f.top, width: +m[6] + f.left + f.right, height: +m[7] + f.top + f.bottom } });
  }
  return out;
}

async function moveWindow(id: string, to: Rect): Promise<void> {
  const r = toInt(to);
  if (isMac) {
    const [pid, idx] = id.split(':').map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(idx)) throw new Error('Unknown window');
    // Size, then place, then size again: some apps refuse a size that would not fit where the window was.
    await jxa(`const se=Application('System Events');const p=se.processes.whose({unixId:${pid}})[0];const w=p.windows[${idx}];w.size=[${r.width},${r.height}];w.position=[${r.x},${r.y}];w.size=[${r.width},${r.height}];JSON.stringify(true)`);
    return;
  }
  if (isWin) {
    if (!/^\d+$/.test(id)) throw new Error('Unknown window');
    const p = winToPx(r);
    await ps(`${PS_SNAP}
[KeeperSnap]::Place([IntPtr]${id}, ${p.x}, ${p.y}, ${p.width}, ${p.height}); 'true'`);
    return;
  }
  if (!/^(0x[0-9a-f]+|\d+)$/i.test(id)) throw new Error('Unknown window');
  const hex = id.startsWith('0x') ? id : `0x${Number(id).toString(16)}`;
  // The size asked for is the window's own; its frame (title bar, borders) comes on top.
  const frame = parseFrameExtents(onPath('xprop') ? (await run('xprop', ['-id', hex, '_NET_FRAME_EXTENTS'], 2000)).stdout : '');
  const c = insideFrame(r, frame);
  if (onPath('wmctrl')) {
    await run('wmctrl', ['-i', '-r', hex, '-b', 'remove,maximized_vert,maximized_horz'], 3000);
    const m = await run('wmctrl', ['-i', '-r', hex, '-e', `0,${c.x},${c.y},${c.width},${c.height}`], 3000);
    if (m.ok) return;
  }
  const dec = String(Number(id));
  const a = await run('xdotool', ['windowsize', dec, String(c.width), String(c.height), 'windowmove', dec, String(c.x), String(c.y)], 3000);
  if (!a.ok) throw new Error('The window could not be moved');
}

// ---------------------------------------------------------------- actions

export async function snapFront(action: SnapAction): Promise<{ ok: boolean; message?: string }> {
  if (!featureOn('snapWindows')) return { ok: false, message: 'Snap windows is switched off in Settings → Features.' };
  const a = availability();
  if (a.state !== 'ready' && a.state !== 'permission') return { ok: false, message: a.line };
  try {
    const w = await frontWindow();
    if (!w) return { ok: false, message: 'No window is in front.' };
    const to = targetRect(action, w.bounds, works(), normalizeSnapSettings(settings().snap).gap);
    await moveWindow(w.id, to);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const layouts = () => normalizeLayouts(settings().snapLayouts);

async function status(): Promise<SnapStatus> {
  const s = screensNow();
  const taken: SnapStatus['taken'] = {};
  try {
    const { shortcutStatus } = await import('./prefs');
    const sc = normalizeSnapSettings(settings().snap).shortcuts;
    for (const st of shortcutStatus()) {
      if (st.state === 'ok' || !st.owner.startsWith('Snap: ')) continue;
      const a = SNAP_ACTIONS.find((x) => sc[x.id] && `Snap: ${x.label}` === st.owner);
      if (a) taken[a.id] = st.state === 'invalid' ? 'not a valid shortcut' : st.takenBy ?? 'another app';
    }
  } catch { /* no shortcut book yet */ }
  return { availability: availability(), layouts: layouts(), screens: { key: displaySetKey(s), name: displaySetName(s), count: s.length }, taken };
}

async function saveLayout(name: string): Promise<SnapStatus> {
  const a = availability();
  if (a.state === 'wayland' || a.state === 'missing' || a.state === 'unsupported') throw new Error(a.line);
  const s = screensNow();
  const layout = captureLayout(await listWindows(), works(), String(name ?? ''), s);
  if (!layout.windows.length) throw new Error('No windows to keep yet. Open the apps you use, then save.');
  // One layout per name and set of screens: saving "Docked" again replaces it.
  const rest = layouts().filter((l) => !(l.screens === layout.screens && l.name.toLowerCase() === layout.name.toLowerCase()));
  await updateSettings({ snapLayouts: [layout, ...rest].slice(0, 30) });
  return status();
}

async function restore(layout: SnapLayout): Promise<{ moved: number; missing: string[] }> {
  const live = await listWindows();
  const plan = planRestore(layout, live, works());
  let moved = 0;
  for (const p of plan) {
    try { await moveWindow(p.id, p.to); moved++; } catch { /* that window went away */ }
  }
  const placed = new Set(plan.map((p) => p.app.toLowerCase()));
  const missing = [...new Set(layout.windows.map((w) => w.app).filter((a) => !placed.has(a.toLowerCase())))];
  return { moved, missing };
}

export const snapApi: SnapApi = {
  status,
  run: (action) => snapFront(action),
  saveLayout,
  restoreLayout: async (id) => {
    if (!featureOn('snapWindows')) throw new Error('Snap windows is switched off in Settings → Features.');
    const l = layouts().find((x) => x.id === id);
    if (!l) throw new Error('That layout is gone.');
    return restore(l);
  },
  renameLayout: async (id, name) => {
    const n = String(name ?? '').trim().slice(0, 60);
    if (n) await updateSettings({ snapLayouts: layouts().map((l) => (l.id === id ? { ...l, name: n } : l)) });
    return status();
  },
  removeLayout: async (id) => {
    await updateSettings({ snapLayouts: layouts().filter((l) => l.id !== id) });
    return status();
  },
  openPermission: async () => {
    if (isMac) await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  },
};

// ---------------------------------------------------------------- shortcuts and screens

/** Each action's shortcut, while the part is on and this computer lets Keeper move windows. */
export function registerSnapShortcuts(reg: (acc: string, fn: () => void, owner?: string) => void) {
  if (!featureOn('snapWindows') || !snapShortcutsActive(availability())) return;
  const sc = normalizeSnapSettings(settings().snap).shortcuts;
  for (const a of SNAP_ACTIONS) if (sc[a.id]) reg(sc[a.id], () => void snapFront(a.id), `Snap: ${a.label}`);
}

let watching = false;
let restoreTimer: NodeJS.Timeout | undefined;
const screensChanged = () => {
  clearTimeout(restoreTimer);
  // Screens settle for a moment after being plugged in; windows move by themselves first.
  restoreTimer = setTimeout(() => {
    if (!featureOn('snapWindows') || !normalizeSnapSettings(settings().snap).restoreOnChange) return;
    const l = layoutForScreens(layouts(), displaySetKey(screensNow()));
    if (l) void restore(l).catch(() => undefined);
  }, 2500);
};

/** Watches the screens only while the part and "restore when screens change" are both on. */
export function syncSnapWatch() {
  const want = featureOn('snapWindows') && normalizeSnapSettings(settings().snap).restoreOnChange;
  if (want === watching) return;
  watching = want;
  if (want) {
    screen.on('display-added', screensChanged);
    screen.on('display-removed', screensChanged);
  } else {
    screen.removeListener('display-added', screensChanged);
    screen.removeListener('display-removed', screensChanged);
    clearTimeout(restoreTimer);
  }
}

/** reregister: Keeper's own shortcut registration (main.ts), so Monorail starting or quitting hands the keys over. */
export function startSnap(reregister: () => void) {
  onFeature('snapWindows', () => syncSnapWatch(), { now: true });
  if (!isMac) return;
  let had = !!monorailState();
  onRawState((m) => {
    if (!!m === had) return;
    had = !!m;
    if (featureOn('snapWindows')) reregister();
  });
}
