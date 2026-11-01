// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reading key presses and clicks for Stage's keystroke and click overlays.
// Linux (X11): `xinput test-xi2 --root` raw events plus `xmodmap -pke` for key
// names. Windows: a small low-level hook prints "K vk mods" and "C x y right".
// macOS: Keeper's helper streams JSON (see Stage.swift).

import type { KeyEvent, Mod } from './overlay';

export type InputEvent = ({ t: 'key' } & KeyEvent) | { t: 'click'; x?: number; y?: number; right: boolean };

/** `xmodmap -pke`: "keycode  38 = a A a A" → 38 → "a". */
export function parseXmodmap(out: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const m of out.matchAll(/^keycode\s+(\d+)\s*=\s*(\S+)/gm)) map.set(+m[1], m[2]);
  return map;
}

const X_NAMES: Record<string, string> = {
  Return: 'Return', KP_Enter: 'Return', Escape: 'Escape', Tab: 'Tab', ISO_Left_Tab: 'Tab', space: 'Space', BackSpace: 'Backspace', Delete: 'Delete',
  Left: 'Left', Right: 'Right', Up: 'Up', Down: 'Down', Home: 'Home', End: 'End', Prior: 'PageUp', Next: 'PageDown',
  minus: '-', equal: '=', comma: ',', period: '.', slash: '/', backslash: '\\', semicolon: ';', apostrophe: "'", grave: '`', bracketleft: '[', bracketright: ']',
};

const X_MODS: Record<string, Mod> = { Control_L: 'ctrl', Control_R: 'ctrl', Alt_L: 'alt', Alt_R: 'alt', Meta_L: 'alt', Meta_R: 'alt', ISO_Level3_Shift: 'alt', Shift_L: 'shift', Shift_R: 'shift', Super_L: 'cmd', Super_R: 'cmd' };

export function xKeyName(sym: string): string {
  return X_NAMES[sym] ?? (X_MODS[sym] ? sym : sym.length === 1 ? sym : sym.replace(/^KP_/, ''));
}

/**
 * Reads `xinput test-xi2 --root` output. Raw events reach the root window
 * whichever window has focus; they carry no modifier state, so the modifiers
 * are tracked from their own presses and releases. The same press reported by
 * a master and a slave device counts once.
 */
export class XinputParser {
  private buf = '';
  private cur: { type: number; detail?: number } | null = null;
  private held = new Set<Mod>();
  private last = { key: '', at: 0 };

  constructor(private keymap: Map<number, string>, private emit: (e: InputEvent) => void, private now = () => Date.now()) {}

  push(chunk: string) {
    this.buf += chunk;
    const lines = this.buf.split('\n');
    this.buf = lines.pop() ?? '';
    for (const line of lines) this.line(line);
  }

  private line(line: string) {
    const ev = line.match(/^EVENT type (\d+)/);
    if (ev) { this.flush(); this.cur = { type: +ev[1] }; return; }
    const d = line.match(/^\s+detail:\s*(\d+)/);
    if (d && this.cur) { this.cur.detail = +d[1]; this.flush(); }
  }

  private flush() {
    const c = this.cur;
    this.cur = null;
    if (!c || c.detail === undefined) return;
    const key = `${c.type}:${c.detail}`;
    const t = this.now();
    if (this.last.key === key && t - this.last.at < 15) return;
    this.last = { key, at: t };
    if (c.type === 13 || c.type === 14) {
      const sym = this.keymap.get(c.detail) ?? '';
      const mod = X_MODS[sym];
      if (mod) { if (c.type === 13) this.held.add(mod); else this.held.delete(mod); return; }
      if (c.type === 13 && sym) this.emit({ t: 'key', key: xKeyName(sym), mods: [...this.held] });
    } else if (c.type === 15 && (c.detail === 1 || c.detail === 3)) {
      this.emit({ t: 'click', right: c.detail === 3 });
    }
  }
}

const VK: Record<number, string> = {
  0x08: 'Backspace', 0x09: 'Tab', 0x0d: 'Return', 0x1b: 'Escape', 0x20: 'Space', 0x21: 'PageUp', 0x22: 'PageDown', 0x23: 'End', 0x24: 'Home',
  0x25: 'Left', 0x26: 'Up', 0x27: 'Right', 0x28: 'Down', 0x2e: 'Delete', 0xba: ';', 0xbb: '=', 0xbc: ',', 0xbd: '-', 0xbe: '.', 0xbf: '/', 0xc0: '`', 0xdb: '[', 0xdc: '\\', 0xdd: ']', 0xde: "'",
};

export function vkName(vk: number): string {
  if ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a)) return String.fromCharCode(vk);
  if (vk >= 0x70 && vk <= 0x7b) return `F${vk - 0x6f}`;
  if ([0x10, 0x11, 0x12, 0x5b, 0x5c, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0x14].includes(vk)) return 'Shift';
  return VK[vk] ?? `Key${vk}`;
}

/** One line from the Windows hook: "K 65 ctrl,shift" or "C 120 340 0". */
export function parseWinHookLine(line: string): InputEvent | null {
  const k = line.match(/^K (\d+) ?([a-z,]*)/);
  if (k) return { t: 'key', key: vkName(+k[1]), mods: k[2].split(',').filter((m): m is Mod => ['ctrl', 'alt', 'shift', 'cmd'].includes(m)) };
  const c = line.match(/^C (-?\d+) (-?\d+) ([01])/);
  if (c) return { t: 'click', x: +c[1], y: +c[2], right: c[3] === '1' };
  return null;
}

/** One line from the macOS helper's stream. */
export function parseMacEvent(text: string): InputEvent | null {
  try {
    const o = JSON.parse(text) as { t: string; key?: string; mods?: Mod[]; x?: number; y?: number; right?: boolean };
    if (o.t === 'key' && o.key) return { t: 'key', key: o.key, mods: o.mods ?? [] };
    if (o.t === 'click') return { t: 'click', x: o.x, y: o.y, right: !!o.right };
  } catch { /* not ours */ }
  return null;
}

/** The Windows low-level keyboard and mouse hook (runs in a hidden PowerShell until Keeper stops it). */
export const WIN_HOOK = `Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Windows.Forms;
public class KeeperHook {
  delegate IntPtr Proc(int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc p, IntPtr m, uint t);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern short GetKeyState(int k);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
  static Proc kp, mp; static IntPtr kh, mh;
  static bool Down(int k) { return (GetKeyState(k) & 0x8000) != 0; }
  static IntPtr K(int n, IntPtr w, IntPtr l) {
    if (n >= 0 && ((int)w == 0x100 || (int)w == 0x104)) {
      int vk = Marshal.ReadInt32(l); var m = new System.Collections.Generic.List<string>();
      if (Down(0x11)) m.Add("ctrl"); if (Down(0x12)) m.Add("alt"); if (Down(0x10)) m.Add("shift"); if (Down(0x5B) || Down(0x5C)) m.Add("cmd");
      Console.WriteLine("K " + vk + " " + string.Join(",", m)); Console.Out.Flush();
    }
    return CallNextHookEx(kh, n, w, l);
  }
  static IntPtr M(int n, IntPtr w, IntPtr l) {
    if (n >= 0 && ((int)w == 0x201 || (int)w == 0x204)) { int x = Marshal.ReadInt32(l); int y = Marshal.ReadInt32(l, 4); Console.WriteLine("C " + x + " " + y + " " + ((int)w == 0x204 ? 1 : 0)); Console.Out.Flush(); }
    return CallNextHookEx(mh, n, w, l);
  }
  public static void Run() { kp = K; mp = M; var h = GetModuleHandle(null); kh = SetWindowsHookEx(13, kp, h, 0); mh = SetWindowsHookEx(14, mp, h, 0); Application.Run(); }
}
'@
[KeeperHook]::Run()`;
