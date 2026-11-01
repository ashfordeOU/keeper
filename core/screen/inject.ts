// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What the host runs to move the pointer and press keys, per OS, built from
// sanitised events. Pure, so the exact commands are tested; the Electron side
// only spawns them.
//
//   Linux (X11)   xdotool (XTest), one process per batch of events
//   Windows       one long-lived PowerShell that loads a few lines of C# for
//                 SendInput / SetCursorPos, fed one JSON event per line
//   macOS         keeper-helper's CGEvent methods (input.*), over its JSON lines

import { comboKeys, macKeycode, modCodes, toHostPoint, winVk, WIN_EXTENDED, xKeysym, type HostOs } from './input';
import type { HostDisplay, InputEvent } from './types';

// ---------------------------------------------------------------- Linux / XTest

const xButton = (b: 0 | 1 | 2) => (b === 0 ? 1 : b === 1 ? 2 : 3);

/** xdotool argument lists for a batch; typed text always goes in a call of its own (it takes every word after it). */
export function xdotoolBatches(events: InputEvent[], d: HostDisplay): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
  };
  let last = '';
  const move = (x: number, y: number) => {
    const p = toHostPoint(d, x, y, 'linux');
    const at = `${p.x},${p.y}`;
    // Only when it really moves: a move between press and release can turn a click into a tiny drag.
    if (at === last) return;
    last = at;
    cur.push('mousemove', String(p.x), String(p.y));
  };
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const next = events[i + 1];
    // A press followed at once by its release in the same place is a click (or a tap): send it as one,
    // which every X desktop handles, instead of two halves some drop.
    if (e.t === 'down' && next?.t === 'up' && next.button === e.button && toHostPoint(d, next.x, next.y, 'linux').x === toHostPoint(d, e.x, e.y, 'linux').x && toHostPoint(d, next.x, next.y, 'linux').y === toHostPoint(d, e.x, e.y, 'linux').y) {
      move(e.x, e.y);
      cur.push('click', String(xButton(e.button)));
      i++;
      continue;
    }
    switch (e.t) {
      case 'move':
        move(e.x, e.y);
        break;
      case 'down':
      case 'up':
        move(e.x, e.y);
        cur.push(e.t === 'down' ? 'mousedown' : 'mouseup', String(xButton(e.button)));
        // A press on a window that is not focused moves the focus first; give that a moment,
        // or some desktops drop the release and the click never happens.
        if (e.t === 'down') cur.push('sleep', '0.04');
        break;
      case 'wheel': {
        move(e.x, e.y);
        const v = Math.round(Math.abs(e.dy));
        const h = Math.round(Math.abs(e.dx));
        if (v) cur.push('click', '--repeat', String(v), '--delay', '0', e.dy > 0 ? '5' : '4');
        if (h) cur.push('click', '--repeat', String(h), '--delay', '0', e.dx > 0 ? '7' : '6');
        break;
      }
      case 'key': {
        const sym = xKeysym(e.code);
        if (sym) cur.push(e.down ? 'keydown' : 'keyup', sym);
        break;
      }
      case 'combo': {
        const syms = comboKeys(e.combo, 'linux').map(xKeysym).filter((s): s is string => !!s);
        if (syms.length) cur.push('key', syms.join('+'));
        break;
      }
      case 'text':
        flush();
        out.push(['type', '--delay', '2', '--', e.text]);
        break;
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- Windows / SendInput

/** One line for the PowerShell host per event; positions already in device pixels. */
export function winLines(events: InputEvent[], d: HostDisplay): string[] {
  const out: string[] = [];
  const at = (x: number, y: number) => toHostPoint(d, x, y, 'win32');
  const key = (code: string, down: boolean) => {
    const vk = winVk(code);
    if (vk !== undefined) out.push(JSON.stringify({ k: vk, d: down ? 1 : 0, e: WIN_EXTENDED.has(vk) ? 1 : 0 }));
  };
  for (const e of events) {
    if (e.t === 'move') out.push(JSON.stringify({ m: at(e.x, e.y) }));
    else if (e.t === 'down' || e.t === 'up') out.push(JSON.stringify({ m: at(e.x, e.y) }), JSON.stringify({ b: e.button, d: e.t === 'down' ? 1 : 0 }));
    else if (e.t === 'wheel') out.push(JSON.stringify({ m: at(e.x, e.y) }), JSON.stringify({ w: Math.round(-e.dy * 120), h: Math.round(e.dx * 120) }));
    else if (e.t === 'key') key(e.code, e.down);
    else if (e.t === 'text') out.push(JSON.stringify({ t: e.text }));
    else if (e.t === 'combo') {
      if (e.combo === 'ctrl-alt-del') {
        // Windows keeps Ctrl+Alt+Del for itself (the secure attention sequence); the closest an app may do is Task Manager.
        out.push(JSON.stringify({ sas: 1 }));
        continue;
      }
      const ks = comboKeys(e.combo, 'win32');
      for (const k of ks) key(k, true);
      for (const k of [...ks].reverse()) key(k, false);
    }
  }
  return out;
}

/** The PowerShell host: reads JSON lines on stdin and acts on each. */
export const WIN_INPUT_HOST = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KIn {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  public static void Init() { try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch {} }
  public static void Move(int x, int y) { SetCursorPos(x, y); }
  static void Send(INPUT i) { SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))); }
  public static void Button(int b, bool down) {
    uint f = b == 0 ? (down ? 0x2u : 0x4u) : b == 1 ? (down ? 0x20u : 0x40u) : (down ? 0x8u : 0x10u);
    var i = new INPUT { type = 0 }; i.u.mi.dwFlags = f; Send(i);
  }
  public static void Wheel(int v, int h) {
    if (v != 0) { var i = new INPUT { type = 0 }; i.u.mi.dwFlags = 0x800; i.u.mi.mouseData = (uint)v; Send(i); }
    if (h != 0) { var i = new INPUT { type = 0 }; i.u.mi.dwFlags = 0x1000; i.u.mi.mouseData = (uint)h; Send(i); }
  }
  public static void Key(int vk, bool down, bool ext) {
    var i = new INPUT { type = 1 }; i.u.ki.wVk = (ushort)vk; i.u.ki.dwFlags = (down ? 0u : 0x2u) | (ext ? 0x1u : 0u); Send(i);
  }
  public static void Text(string s) {
    foreach (char c in s) {
      var a = new INPUT { type = 1 }; a.u.ki.wScan = c; a.u.ki.dwFlags = 0x4; Send(a);
      var b = new INPUT { type = 1 }; b.u.ki.wScan = c; b.u.ki.dwFlags = 0x4 | 0x2; Send(b);
    }
  }
}
'@
[KIn]::Init()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $e = $line | ConvertFrom-Json
    if ($null -ne $e.m) { [KIn]::Move([int]$e.m.x, [int]$e.m.y) }
    elseif ($null -ne $e.b) { [KIn]::Button([int]$e.b, [bool][int]$e.d) }
    elseif ($null -ne $e.w) { [KIn]::Wheel([int]$e.w, [int]$e.h) }
    elseif ($null -ne $e.k) { [KIn]::Key([int]$e.k, [bool][int]$e.d, [bool][int]$e.e) }
    elseif ($null -ne $e.t) { [KIn]::Text([string]$e.t) }
    elseif ($null -ne $e.sas) { Start-Process taskmgr.exe }
  } catch { [Console]::Error.WriteLine($_.Exception.Message) }
}
`;

// ---------------------------------------------------------------- macOS / CGEvent

export interface MacInputCall {
  method: 'input.move' | 'input.button' | 'input.wheel' | 'input.key' | 'input.text';
  params: Record<string, unknown>;
}

/** keeper-helper calls; positions in points, keys as macOS virtual key codes with modifier flags. */
export function macCalls(events: InputEvent[], d: HostDisplay): MacInputCall[] {
  const out: MacInputCall[] = [];
  const at = (x: number, y: number) => toHostPoint(d, x, y, 'darwin');
  const key = (code: string, down: boolean, mods: string[] = []) => {
    const kc = macKeycode(code);
    if (kc !== undefined) out.push({ method: 'input.key', params: { code: kc, down, mods } });
  };
  for (const e of events) {
    if (e.t === 'move') out.push({ method: 'input.move', params: at(e.x, e.y) });
    else if (e.t === 'down' || e.t === 'up') out.push({ method: 'input.button', params: { ...at(e.x, e.y), button: e.button, down: e.t === 'down' } });
    else if (e.t === 'wheel') out.push({ method: 'input.wheel', params: { ...at(e.x, e.y), dx: Math.round(-e.dx), dy: Math.round(-e.dy) } });
    else if (e.t === 'key') key(e.code, e.down, modCodes(e.mods).map((m) => m.replace(/Left$/, '').toLowerCase()));
    else if (e.t === 'text') out.push({ method: 'input.text', params: { text: e.text } });
    else if (e.t === 'combo') {
      const ks = comboKeys(e.combo, 'darwin');
      for (const k of ks) key(k, true);
      for (const k of [...ks].reverse()) key(k, false);
    }
  }
  return out;
}

export function hostOs(platform: string): HostOs | null {
  return platform === 'linux' || platform === 'win32' || platform === 'darwin' ? platform : null;
}
