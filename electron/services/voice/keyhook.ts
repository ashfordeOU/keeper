// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Hold-to-talk needs to know when a key goes up, which global shortcuts can't
// tell. Each system's own public way of listening to the keyboard:
//   macOS   a listen-only event tap in keeper-helper (Input Monitoring permission)
//   Windows a low-level keyboard hook (WH_KEYBOARD_LL) in a small PowerShell-hosted C# program
//   Linux   the keyboard's /dev/input device when readable (the "input" group),
//           otherwise raw key events from the X server (xinput, X11 sessions)
//   Wayland without either: no hook; the shortcut toggles instead (said on the page)
// Listen-only everywhere: the key still reaches the app in front.

import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, promises as fsp, type ReadStream } from 'node:fs';
import { ESC_CODES, KEY_CODES, keyboardsFromProcDevices, parseHookLine, parseInputEvents, Xi2Reader } from '../../../core/voice/keys';
import type { HoldKey } from '../../../core/voice/types';
import { run } from '../../../core/platform';
import { permissionNeeded } from '../permission-nudge';

export type HookEvent = 'down' | 'up' | 'esc';
export interface HookResult { ok: boolean; how: string; note?: string }

export interface KeyHook {
  start(key: HoldKey, on: (e: HookEvent) => void): Promise<HookResult>;
  stop(): void;
}

// ---------------------------------------------------------------- macOS

class MacHook implements KeyHook {
  private abort?: AbortController;
  async start(key: HoldKey, on: (e: HookEvent) => void): Promise<HookResult> {
    const { helperPath } = await import('../platform/mac');
    const { HelperClient } = await import('../platform/helper-client');
    const bin = helperPath();
    if (!bin) return { ok: false, how: 'none', note: 'keeper-helper is missing from this copy of Keeper' };
    const code = KEY_CODES.mac[key];
    if (code === undefined) return { ok: false, how: 'none', note: 'That key cannot be listened to on macOS' };
    // Its own helper process: this call never ends while the hook runs.
    const client = new HelperClient(bin, [], 5_000);
    this.abort = new AbortController();
    return new Promise<HookResult>((resolve) => {
      let ready = false;
      client.call('voice.keys', { code, esc: ESC_CODES.mac, fn: key === 'fn' }, {
        signal: this.abort!.signal,
        onDelta: (d) => {
          if (d === 'ready') { ready = true; resolve({ ok: true, how: 'event tap' }); return; }
          const m = parseHookLine(d);
          if (m) on(m.code === 'esc' ? 'esc' : m.down ? 'down' : 'up');
        },
      }).catch((e: Error) => {
        if (!ready && /permission|not permitted|denied/i.test(e.message)) permissionNeeded('input', 'dictationHold');
        if (!ready) resolve({ ok: false, how: 'event tap', note: /permission|not permitted|denied/i.test(e.message) ? 'Allow Keeper in System Settings → Privacy & Security → Input Monitoring' : e.message });
      });
    });
  }
  stop() { this.abort?.abort(); this.abort = undefined; }
}

// ---------------------------------------------------------------- Windows

const WIN_HOOK = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Threading;
public static class KeeperKeys {
  delegate IntPtr Proc(int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc p, IntPtr h, uint t);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr h; public uint m; public IntPtr w; public IntPtr l; public uint t; public int x; public int y; }
  static Proc keep; static IntPtr hook; static int target; static bool isDown;
  static void Say(string s) { Console.Out.WriteLine(s); Console.Out.Flush(); }
  static IntPtr Cb(int n, IntPtr w, IntPtr l) {
    if (n >= 0) {
      int vk = Marshal.ReadInt32(l); int msg = (int)w;
      bool down = msg == 0x100 || msg == 0x104; bool up = msg == 0x101 || msg == 0x105;
      if (vk == target) { if (down && !isDown) { isDown = true; Say("key " + vk + " down"); } else if (up) { isDown = false; Say("key " + vk + " up"); } }
      else if (vk == 0x1B && down) Say("key esc down");
    }
    return CallNextHookEx(hook, n, w, l);
  }
  public static void Run(int vk) {
    target = vk; keep = Cb;
    new Thread(() => { Console.In.ReadToEnd(); Environment.Exit(0); }) { IsBackground = true }.Start();
    hook = SetWindowsHookEx(13, keep, GetModuleHandle(null), 0);
    if (hook == IntPtr.Zero) { Say("error hook"); return; }
    Say("ready");
    MSG m; while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) {}
  }
}
'@
[KeeperKeys]::Run(__VK__)
`;

class WinHook implements KeyHook {
  private p?: ChildProcess;
  async start(key: HoldKey, on: (e: HookEvent) => void): Promise<HookResult> {
    const vk = KEY_CODES.win[key];
    if (vk === undefined || vk < 0) return { ok: false, how: 'none', note: 'Windows does not report that key to apps; choose another' };
    const ps = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const script = WIN_HOOK.replace('__VK__', String(vk));
    const p = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.p = p;
    return new Promise<HookResult>((resolve) => {
      let buf = '';
      let ready = false;
      const t = setTimeout(() => { if (!ready) { resolve({ ok: false, how: 'keyboard hook', note: 'The keyboard hook did not start' }); this.stop(); } }, 15_000);
      p.stdout!.setEncoding('utf8');
      p.stdout!.on('data', (d: string) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line === 'ready') { ready = true; clearTimeout(t); resolve({ ok: true, how: 'keyboard hook' }); continue; }
          if (line.startsWith('error')) { clearTimeout(t); resolve({ ok: false, how: 'keyboard hook', note: 'Windows refused the keyboard hook' }); continue; }
          const m = parseHookLine(line);
          if (m) on(m.code === 'esc' ? 'esc' : m.down ? 'down' : 'up');
        }
      });
      p.on('exit', () => { clearTimeout(t); if (!ready) resolve({ ok: false, how: 'keyboard hook', note: 'PowerShell stopped' }); });
      p.on('error', () => { clearTimeout(t); resolve({ ok: false, how: 'keyboard hook', note: 'PowerShell is not available' }); });
    });
  }
  stop() { try { this.p?.stdin?.end(); this.p?.kill(); } catch { /* gone */ } this.p = undefined; }
}

// ---------------------------------------------------------------- Linux

class LinuxHook implements KeyHook {
  private streams: ReadStream[] = [];
  private xi?: ChildProcess;

  async start(key: HoldKey, on: (e: HookEvent) => void): Promise<HookResult> {
    const code = KEY_CODES.linux[key];
    // 1. The keyboard devices themselves, when this user may read them (works on Wayland and X11 alike).
    const devs = keyboardsFromProcDevices(await fsp.readFile('/proc/bus/input/devices', 'utf8').catch(() => ''));
    const readable: string[] = [];
    for (const d of devs) if (await fsp.access(d, 4).then(() => true, () => false)) readable.push(d);
    if (readable.length) {
      let isDown = false;
      for (const d of readable) {
        const s = createReadStream(d, { highWaterMark: 24 * 64 });
        s.on('data', (chunk) => {
          for (const e of parseInputEvents(chunk as Buffer)) {
            if (e.code === code) { if (e.down !== isDown) { isDown = e.down; on(e.down ? 'down' : 'up'); } }
            else if (e.code === ESC_CODES.linux && e.down) on('esc');
          }
        });
        s.on('error', () => undefined);
        this.streams.push(s);
      }
      return { ok: true, how: `keyboard device (${readable.length})` };
    }
    // 2. X11: raw key events for every app from the X server.
    if (process.env.DISPLAY && (await run('xinput', ['--version'], 3000)).ok && process.env.XDG_SESSION_TYPE !== 'wayland') {
      const p = spawn('xinput', ['test-xi2', '--root'], { stdio: ['ignore', 'pipe', 'ignore'] });
      this.xi = p;
      let isDown = false;
      const x = new Xi2Reader((kc, down) => {
        if (kc === code + 8) { if (down !== isDown) { isDown = down; on(down ? 'down' : 'up'); } }
        else if (kc === ESC_CODES.linux + 8 && down) on('esc');
      });
      let buf = '';
      p.stdout!.setEncoding('utf8');
      p.stdout!.on('data', (d: string) => {
        buf += d;
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const l of lines) x.line(l);
      });
      p.on('error', () => undefined);
      return { ok: true, how: 'X11 raw key events' };
    }
    const wayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
    return {
      ok: false,
      how: 'none',
      note: wayland
        ? 'Wayland keeps key releases private. Join the “input” group (sudo usermod -aG input $USER, then sign in again) for hold-to-talk; until then the shortcut starts and stops dictation.'
        : 'Install xinput, or join the “input” group, for hold-to-talk; until then the shortcut starts and stops dictation.',
    };
  }
  stop() {
    for (const s of this.streams) s.destroy();
    this.streams = [];
    this.xi?.kill();
    this.xi = undefined;
  }
}

export function makeKeyHook(platform = process.platform): KeyHook {
  return platform === 'darwin' ? new MacHook() : platform === 'win32' ? new WinHook() : new LinuxHook();
}
