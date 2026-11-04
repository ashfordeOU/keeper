// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mouse buttons and app shortcuts (experimental, off until switched on).
//
//   Mouse buttons  each system's own public way of hearing the middle and side
//                  buttons, the same ways hold-to-talk hears a key (voice/keyhook.ts):
//     macOS    keeper-helper's voice.mouse event tap (Input Monitoring); with
//              "take over" a default tap that stops the button's own action
//     Windows  a low-level mouse hook (WH_MOUSE_LL) in a small PowerShell-hosted
//              C# program; with "take over" it swallows the mapped buttons
//     Linux    the mouse's /dev/input device when readable (the "input" group),
//              else xinput's raw button events on X11; listen-only
//   App shortcuts  a global shortcut registered only while its app is in front
//                  (the front-window watch, fg-watch.ts), so other apps keep the keys
//   Sending keys   the injector remote control and computer use use (screen/injector.ts)
//
// Nothing runs while the part is off, or while it has no buttons (no hook) or no
// app shortcuts (no front-window watch).

import { screen } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync, promises as fsp, type ReadStream } from 'node:fs';
import path from 'node:path';
import type { InputRemapApi, InputRemapStatus } from '../../core/api-remap';
import { mappingFor, miceFromProcDevices, normalizeInputRemap, parseButtonLine, RawButtonReader, remapAvailability, remapsFor, sendEvents, buttonFromLinuxCode, type MouseButton } from '../../core/input-remap';
import { parseInputEvents } from '../../core/voice/keys';
import type { HostDisplay, InputEvent } from '../../core/screen/types';
import { settings } from '../store';
import { featureOn, onFeature } from './features';
import { frontWindow, holdFrontWatch, onFrontWindow, type FrontWindow } from './fg-watch';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const wayland = () => process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY) && !process.env.DISPLAY;
const onPath = (cmd: string) => (process.env.PATH ?? '').split(path.delimiter).some((d) => d && existsSync(path.join(d, cmd)));
const conf = () => normalizeInputRemap(settings().inputRemap);
declare const __KEEPER_OFFICIAL__: boolean | undefined;
/** The test hook (testPress) never works in an official build. */
const TESTABLE = !(typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__);

let reregister: () => void = () => undefined;
let hook: { stop(): void; how: string } | null = null;
let hookNote = '';
let releaseWatch: (() => void) | null = null;
let offFront: (() => void) | null = null;
let lastFrontKey = '';
let lastPress: { button: MouseButton; at: number; sent?: string } | null = null;

async function inputReadable(): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  const mice = miceFromProcDevices(await fsp.readFile('/proc/bus/input/devices', 'utf8').catch(() => ''));
  for (const d of mice) if (await fsp.access(d, 4).then(() => true, () => false)) return true;
  return false;
}

async function availability() {
  const { systemPreferences } = await import('electron');
  let helper = false;
  if (isMac) { const { helperPath } = await import('./platform/mac'); helper = !!helperPath(); }
  return remapAvailability({
    platform: process.platform,
    wayland: wayland(),
    inputReadable: await inputReadable(),
    xinput: process.platform === 'linux' && !wayland() && onPath('xinput'),
    xdotool: process.platform === 'linux' ? onPath('xdotool') : undefined,
    helper,
    accessibility: isMac ? systemPreferences.isTrustedAccessibilityClient(false) : undefined,
  });
}

// ---------------------------------------------------------------- sending keys

function hostDisplay(): HostDisplay {
  const d = screen.getPrimaryDisplay();
  return { id: String(d.id), label: 'Screen', x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, scale: d.scaleFactor, primary: true };
}

async function send(events: InputEvent[]) {
  const { injector } = await import('./screen/injector');
  injector().send(events, hostDisplay());
}

/** A button was pressed: its job in the app in front, if it has one. */
async function pressed(button: MouseButton) {
  if (!featureOn('mouseButtons')) return;
  const front: Partial<FrontWindow> = frontWindow() ?? await (async () => { const { frontWindow: ask } = await import('./computer-os'); return ask(); })().catch(() => ({}));
  const m = mappingFor(conf().mouse, button, front);
  lastPress = { button, at: Date.now(), sent: m?.keys };
  if (m) await send(sendEvents(m.keys, process.platform));
}

// ---------------------------------------------------------------- the mouse hooks

const WIN_MOUSE = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Threading;
public static class KeeperMouse {
  delegate IntPtr Proc(int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc p, IntPtr h, uint t);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr h; public uint m; public IntPtr w; public IntPtr l; public uint t; public int x; public int y; }
  static Proc keep; static IntPtr hook; static int[] take;
  static void Say(string s) { Console.Out.WriteLine(s); Console.Out.Flush(); }
  static IntPtr Cb(int n, IntPtr w, IntPtr l) {
    if (n >= 0) {
      int msg = (int)w; int data = Marshal.ReadInt32(l, 8); int flags = Marshal.ReadInt32(l, 12);
      int b = 0; bool down = false;
      if (msg == 0x207 || msg == 0x208) { b = 2; down = msg == 0x207; }
      else if (msg == 0x20B || msg == 0x20C) { int x = (data >> 16) & 0xFFFF; b = x == 1 ? 3 : x == 2 ? 4 : 0; down = msg == 0x20B; }
      // Clicks Keeper itself sent are let through untouched.
      if (b != 0 && (flags & 1) == 0) {
        Say("btn " + b + (down ? " down" : " up"));
        if (Array.IndexOf(take, b) >= 0) return (IntPtr)1;
      }
    }
    return CallNextHookEx(hook, n, w, l);
  }
  public static void Run(int[] t) {
    take = t; keep = Cb;
    new Thread(() => { Console.In.ReadToEnd(); Environment.Exit(0); }) { IsBackground = true }.Start();
    hook = SetWindowsHookEx(14, keep, GetModuleHandle(null), 0);
    if (hook == IntPtr.Zero) { Say("error hook"); return; }
    Say("ready");
    MSG m; while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) {}
  }
}
'@
[KeeperMouse]::Run(@(__TAKE__))
`;

const BUTTON_NUMBER: Record<MouseButton, number> = { middle: 2, back: 3, forward: 4 };

function lines(p: ChildProcess, on: (l: string) => void) {
  let buf = '';
  p.stdout!.setEncoding('utf8');
  p.stdout!.on('data', (d: string) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) on(l); }
  });
}

async function startHook(): Promise<void> {
  stopHook();
  const c = conf();
  const used = new Set(c.mouse.filter((m) => m.keys).map((m) => m.button));
  if (!used.size) return;
  const take = c.takeOver ? [...used].map((b) => BUTTON_NUMBER[b]) : [];
  const onDown = (b: MouseButton) => { if (used.has(b)) void pressed(b); };
  if (isMac) {
    const { helperPath } = await import('./platform/mac');
    const { HelperClient } = await import('./platform/helper-client');
    const bin = helperPath();
    if (!bin) { hookNote = 'keeper-helper is missing from this copy of Keeper'; return; }
    const client = new HelperClient(bin, [], 5_000);
    const abort = new AbortController();
    hook = { stop: () => abort.abort(), how: 'event tap' };
    void client.call('voice.mouse', { take }, {
      signal: abort.signal,
      onDelta: (d) => { if (d === 'ready') { hookNote = ''; return; } const m = parseButtonLine(String(d)); if (m?.down) onDown(m.button); },
    }).catch((e: Error) => { hookNote = /permission|Input Monitoring/i.test(e.message) ? 'Allow Keeper in System Settings → Privacy & Security → Input Monitoring' : e.message; });
    return;
  }
  if (isWin) {
    const ps = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const script = WIN_MOUSE.replace('__TAKE__', take.join(',') || '0');
    const p = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    hook = { stop: () => { try { p.stdin?.end(); p.kill(); } catch { /* gone */ } }, how: 'mouse hook' };
    lines(p, (l) => { if (l.startsWith('error')) hookNote = 'Windows refused the mouse hook'; const m = parseButtonLine(l); if (m?.down) onDown(m.button); });
    p.on('error', () => { hookNote = 'PowerShell is not available'; });
    return;
  }
  // Linux: the mice themselves when readable (Wayland and X11), else X11's raw button events.
  const mice = miceFromProcDevices(await fsp.readFile('/proc/bus/input/devices', 'utf8').catch(() => ''));
  const readable: string[] = [];
  for (const d of mice) if (await fsp.access(d, 4).then(() => true, () => false)) readable.push(d);
  if (readable.length) {
    const streams: ReadStream[] = readable.map((d) => {
      const s = createReadStream(d, { highWaterMark: 24 * 64 });
      s.on('data', (chunk) => { for (const e of parseInputEvents(chunk as Buffer)) { const b = e.down ? buttonFromLinuxCode(e.code) : null; if (b) onDown(b); } });
      s.on('error', () => undefined);
      return s;
    });
    hook = { stop: () => streams.forEach((s) => s.destroy()), how: `mouse device (${readable.length})` };
    return;
  }
  if (!wayland() && onPath('xinput')) {
    const p = spawn('xinput', ['test-xi2', '--root'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const r = new RawButtonReader(onDown);
    lines(p, (l) => r.line(l));
    p.on('error', () => undefined);
    hook = { stop: () => p.kill(), how: 'X11 raw button events' };
    return;
  }
  hookNote = 'Listening to the mouse needs xinput, or the “input” group.';
}

function stopHook() {
  hook?.stop();
  hook = null;
  hookNote = '';
}

// ---------------------------------------------------------------- app shortcuts

/** The app shortcuts for the app in front, registered with Keeper's own shortcuts (main.ts). */
export function registerRemapShortcuts(reg: (acc: string, fn: () => void, owner?: string) => void) {
  const now = featureOn('mouseButtons') ? remapsFor(conf().keys, frontWindow()) : [];
  // What is registered now, so a change of app in front re-registers only when it matters.
  lastFrontKey = now.map((k) => k.id).join(',');
  for (const k of now) reg(k.from, () => void send(sendEvents(k.to, process.platform, k.from)), `In ${k.app}: ${k.from}`);
}

/** Watches the app in front only while there are app shortcuts; re-registers when it changes. */
function syncWatch() {
  const want = featureOn('mouseButtons') && conf().keys.some((k) => k.app && k.from && k.to);
  if (want && !releaseWatch) {
    releaseWatch = holdFrontWatch();
    offFront = onFrontWindow((w) => {
      const key = remapsFor(conf().keys, w).map((k) => k.id).join(',');
      if (key !== lastFrontKey) reregister();
    });
  } else if (!want && releaseWatch) {
    releaseWatch();
    offFront?.();
    releaseWatch = offFront = null;
    lastFrontKey = '';
  }
}

function sync() {
  syncWatch();
  if (featureOn('mouseButtons')) void startHook(); else stopHook();
  reregister();
}

/** Settings changed: buttons, app shortcuts or taking over. */
export function inputRemapChanged() {
  if (featureOn('mouseButtons')) sync();
}

export function startInputRemap(rereg: () => void) {
  reregister = rereg;
  onFeature('mouseButtons', () => sync(), { now: false });
  if (featureOn('mouseButtons')) sync();
}

export function stopInputRemap() {
  stopHook();
  releaseWatch?.();
  offFront?.();
  releaseWatch = offFront = null;
}

async function status(): Promise<InputRemapStatus> {
  return { availability: await availability(), listening: hook?.how ?? '', note: hookNote, front: frontWindow()?.app ?? '', lastPress };
}

export const inputRemapApi: InputRemapApi = {
  status,
  runningApps: async () => {
    const { apps } = await import('./procs');
    return [...new Set((await apps()).map((a) => a.name))].sort((a, b) => a.localeCompare(b)).slice(0, 200);
  },
  // Only for end-to-end tests (KEEPER_INPUT_TEST, never in official builds): a button pressed in the app in front.
  testPress: async (b: MouseButton) => {
    if (!TESTABLE || process.env.KEEPER_INPUT_TEST !== '1') return null;
    await pressed(b);
    return lastPress;
  },
};
