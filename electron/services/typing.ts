// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Listening to what is typed in any app, for typed snippets and for the paste
// queue's "each ⌘V / Ctrl+V takes the next one". It runs only while one of
// them needs it (nothing at all otherwise), listens only (every key still
// reaches the app in front), and keeps nothing: the last few characters live
// in memory to spot an abbreviation, and are dropped at Enter, a click or a
// shortcut. Each system's own public way, as Dictation's talk key uses:
//   macOS    a listen-only event tap in keeper-helper (voice.typed; Input Monitoring).
//            Secure Input (password fields) stops it by itself.
//   Windows  a low-level keyboard hook (WH_KEYBOARD_LL) and mouse hook in a small
//            PowerShell-hosted C# program; characters through the layout in use.
//   Linux    the keyboard's /dev/input device when readable (the "input" group),
//            otherwise raw key events from the X server (xinput, X11 sessions).
//            Wayland without the "input" group: not possible (said on the page).

import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, promises as fsp, type ReadStream } from 'node:fs';
import { keyboardsFromProcDevices, parseInputEvents, Xi2Reader } from '../../core/voice/keys';
import { LinuxKeyReader, parseTypedLine, parseXmodmap, type TypedEvent } from '../../core/typing/keys';
import { run } from '../../core/platform';
import { permissionNeeded } from './permission-nudge';

export interface ListenStatus {
  on: boolean;
  /** how it listens ("event tap", "keyboard hook", "keyboard device", "X11 raw key events") */
  how?: string;
  /** why it can't, in plain words */
  note?: string;
}

type Listener = (e: TypedEvent) => void;

interface Source { stop(): void }

// ---------------------------------------------------------------- macOS

async function macSource(on: Listener): Promise<{ src?: Source; status: ListenStatus }> {
  const { helperPath } = await import('./platform/mac');
  const { HelperClient } = await import('./platform/helper-client');
  const bin = helperPath();
  if (!bin) return { status: { on: false, note: 'keeper-helper is missing from this copy of Keeper' } };
  const client = new HelperClient(bin, [], 5_000);
  const abort = new AbortController();
  return new Promise((resolve) => {
    let ready = false;
    client.call('voice.typed', {}, {
      signal: abort.signal,
      onDelta: (d) => {
        if (d === 'ready') { ready = true; resolve({ src: { stop: () => abort.abort() }, status: { on: true, how: 'event tap' } }); return; }
        const e = parseTypedLine(d);
        if (e) on(e);
      },
    }).catch((e: Error) => {
      const denied = /permission|not permitted|denied/i.test(e.message);
      if (!ready && denied) permissionNeeded('input', 'textSnippets');
      if (!ready) resolve({ status: { on: false, how: 'event tap', note: denied ? 'Allow Keeper in System Settings → Privacy & Security → Input Monitoring' : e.message } });
    });
  });
}

// ---------------------------------------------------------------- Windows

const WIN_TYPED = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text; using System.Threading;
public static class KeeperTyped {
  delegate IntPtr Proc(int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc p, IntPtr h, uint t);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
  [DllImport("user32.dll")] static extern short GetKeyState(int k);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint t);
  [DllImport("user32.dll")] static extern int ToUnicodeEx(uint vk, uint sc, byte[] ks, StringBuilder b, int n, uint f, IntPtr hkl);
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr h; public uint m; public IntPtr w; public IntPtr l; public uint t; public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] struct KB { public uint vk; public uint scan; public uint flags; public uint time; public IntPtr extra; }
  static Proc keepK, keepM; static IntPtr hookK, hookM;
  static void Say(string s) { Console.Out.WriteLine(s); Console.Out.Flush(); }
  static bool Down(int vk) { return (GetKeyState(vk) & 0x8000) != 0; }
  static string Json(string s) {
    var b = new StringBuilder("\\"");
    foreach (char c in s) { if (c == '"' || c == '\\\\') { b.Append('\\\\'); b.Append(c); } else if (c < 0x20) b.AppendFormat("\\\\u{0:x4}", (int)c); else b.Append(c); }
    return b.Append('"').ToString();
  }
  static void Key(KB k) {
    uint vk = k.vk;
    if ((vk >= 0x10 && vk <= 0x12) || vk == 0x14 || vk == 0x5B || vk == 0x5C || (vk >= 0xA0 && vk <= 0xA5)) return;
    bool ctrl = Down(0x11), alt = Down(0x12), win = Down(0x5B) || Down(0x5C);
    if (ctrl && !alt && vk == 0x56) { Say("k paste"); return; }
    if ((ctrl && !alt) || win || (alt && !ctrl)) { Say("k reset"); return; }
    if (vk == 0x08) { Say("k back"); return; }
    if (vk == 0x0D || vk == 0x09 || vk == 0x1B || (vk >= 0x21 && vk <= 0x28) || vk == 0x2E) { Say("k reset"); return; }
    byte[] ks = new byte[256];
    if (Down(0x10)) ks[0x10] = 0x80;
    if ((GetKeyState(0x14) & 1) != 0) ks[0x14] = 1;
    if (ctrl && alt) { ks[0x11] = 0x80; ks[0x12] = 0x80; }
    IntPtr hkl = GetKeyboardLayout(GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero));
    var b = new StringBuilder(8);
    int r = ToUnicodeEx(vk, k.scan, ks, b, 8, 4, hkl);
    if (r > 0) { string s = b.ToString(0, Math.Min(r, b.Length)); if (s.Length > 0 && !char.IsControl(s[0])) Say("t " + Json(s)); else Say("k reset"); }
    else if (r == 0) Say("k reset");
  }
  static IntPtr CbK(int n, IntPtr w, IntPtr l) {
    if (n >= 0 && ((int)w == 0x100 || (int)w == 0x104)) {
      KB k = (KB)Marshal.PtrToStructure(l, typeof(KB));
      if ((k.flags & 0x10) == 0) { try { Key(k); } catch { } }
    }
    return CallNextHookEx(hookK, n, w, l);
  }
  static IntPtr CbM(int n, IntPtr w, IntPtr l) {
    if (n >= 0 && ((int)w == 0x201 || (int)w == 0x204)) Say("k reset");
    return CallNextHookEx(hookM, n, w, l);
  }
  public static void Run() {
    keepK = CbK; keepM = CbM;
    new Thread(() => { Console.In.ReadToEnd(); Environment.Exit(0); }) { IsBackground = true }.Start();
    hookK = SetWindowsHookEx(13, keepK, GetModuleHandle(null), 0);
    hookM = SetWindowsHookEx(14, keepM, GetModuleHandle(null), 0);
    if (hookK == IntPtr.Zero) { Say("error hook"); return; }
    Say("ready");
    MSG m; while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) {}
  }
}
'@
[KeeperTyped]::Run()
`;

async function winSource(on: Listener): Promise<{ src?: Source; status: ListenStatus }> {
  const ps = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const p = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WIN_TYPED, 'utf16le').toString('base64')], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const stop = () => { try { p.stdin?.end(); p.kill(); } catch { /* gone */ } };
  return new Promise((resolve) => {
    let buf = '';
    let ready = false;
    const t = setTimeout(() => { if (!ready) { stop(); resolve({ status: { on: false, how: 'keyboard hook', note: 'The keyboard listener did not start' } }); } }, 20_000);
    p.stdout!.setEncoding('utf8');
    p.stdout!.on('data', (d: string) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line === 'ready') { ready = true; clearTimeout(t); resolve({ src: { stop }, status: { on: true, how: 'keyboard hook' } }); continue; }
        if (line.startsWith('error')) { clearTimeout(t); resolve({ status: { on: false, how: 'keyboard hook', note: 'Windows refused the keyboard listener' } }); continue; }
        const e = parseTypedLine(line);
        if (e) on(e);
      }
    });
    p.on('exit', () => { clearTimeout(t); if (!ready) resolve({ status: { on: false, how: 'keyboard hook', note: 'PowerShell stopped' } }); });
    p.on('error', () => { clearTimeout(t); resolve({ status: { on: false, how: 'keyboard hook', note: 'PowerShell is not available' } }); });
  });
}

// ---------------------------------------------------------------- Linux

async function xLayout(): Promise<Map<number, [string, string]> | undefined> {
  if (!process.env.DISPLAY) return undefined;
  const r = await run('xmodmap', ['-pke'], 4000).catch(() => null);
  if (!r?.ok) return undefined;
  const m = parseXmodmap(r.stdout);
  return m.size ? m : undefined;
}

async function linuxSource(on: Listener): Promise<{ src?: Source; status: ListenStatus }> {
  const reader = new LinuxKeyReader(await xLayout());
  const devs = keyboardsFromProcDevices(await fsp.readFile('/proc/bus/input/devices', 'utf8').catch(() => ''));
  const readable: string[] = [];
  for (const d of devs) if (await fsp.access(d, 4).then(() => true, () => false)) readable.push(d);
  if (readable.length) {
    const streams: ReadStream[] = [];
    for (const d of readable) {
      const s = createReadStream(d, { highWaterMark: 24 * 64 });
      s.on('data', (chunk) => {
        for (const e of parseInputEvents(chunk as Buffer)) {
          const t = reader.key(e.code, e.down);
          if (t) on(t);
        }
      });
      s.on('error', () => undefined);
      streams.push(s);
    }
    return { src: { stop: () => { for (const s of streams) s.destroy(); } }, status: { on: true, how: `keyboard device (${readable.length})` } };
  }
  if (process.env.DISPLAY && process.env.XDG_SESSION_TYPE !== 'wayland' && (await run('xinput', ['--version'], 3000)).ok) {
    const p: ChildProcess = spawn('xinput', ['test-xi2', '--root'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const x = new Xi2Reader((kc, down) => { const t = reader.key(kc - 8, down); if (t) on(t); });
    let buf = '';
    p.stdout!.setEncoding('utf8');
    p.stdout!.on('data', (d: string) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) x.line(l);
    });
    p.on('error', () => undefined);
    return { src: { stop: () => p.kill() }, status: { on: true, how: 'X11 raw key events' } };
  }
  const wayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
  return {
    status: {
      on: false,
      how: 'none',
      note: wayland
        ? 'Wayland keeps typing private to each app. Join the “input” group (sudo usermod -aG input $USER, then sign in again) so Keeper can read the keyboard.'
        : 'Install xinput, or join the “input” group, so Keeper can read the keyboard.',
    },
  };
}

// ---------------------------------------------------------------- one listener, shared

const listeners = new Map<string, Listener>();
let source: Source | undefined;
let starting: Promise<ListenStatus> | undefined;
let status: ListenStatus = { on: false };
/** Our own keystrokes (Backspace, paste) are not the person's typing: ignored until then. */
let quietUntil = 0;

function dispatch(e: TypedEvent) {
  if (Date.now() < quietUntil) return;
  for (const fn of listeners.values()) {
    try { fn(e); } catch { /* one listener's trouble is its own */ }
  }
}

async function start(): Promise<ListenStatus> {
  if (source) return status;
  starting ??= (async () => {
    const r = process.platform === 'darwin' ? await macSource(dispatch) : process.platform === 'win32' ? await winSource(dispatch) : await linuxSource(dispatch);
    source = r.src;
    status = r.status;
    // Everyone left while it was starting.
    if (source && !listeners.size) { source.stop(); source = undefined; status = { on: false }; }
    return status;
  })().finally(() => { starting = undefined; });
  return starting;
}

/** Starts listening for this owner (shared with others); returns how it went. */
export async function listen(owner: string, fn: Listener): Promise<ListenStatus> {
  listeners.set(owner, fn);
  return start();
}

/** This owner no longer needs it; the listener stops when nobody does. */
export function unlisten(owner: string) {
  listeners.delete(owner);
  if (!listeners.size && source) {
    source.stop();
    source = undefined;
    status = { on: false };
  }
}

export function listenStatus(): ListenStatus {
  return status;
}

/** Keystrokes Keeper itself is about to send: not counted as typing for this long. */
export function quiet(ms: number) {
  quietUntil = Math.max(quietUntil, Date.now() + ms);
}
