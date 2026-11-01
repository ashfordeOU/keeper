// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Calls in the Island: which apps hold the microphone, the titles that tell a
// browser call apart, and muting — the system's microphone (works for every
// app) or the call app's own shortcut (so the app's mute button agrees).

import { callAppFor, type CallState } from '../../core/island-calls';
import { powershell, run } from '../../core/platform';
import { frontWindow } from './fg-watch';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

/** macOS: apps using a microphone, from keeper-helper (per app on macOS 14.2+). */
export async function macMicApps(): Promise<string[]> {
  if (!isMac) return [];
  try {
    const { macHelperCall } = await import('./platform/mac');
    const r = await macHelperCall<{ apps: { name: string; bundle: string }[] }>('calls.micApps', {}, 4000);
    return [...new Set(r.apps.map((a) => a.name || a.bundle).filter(Boolean))];
  } catch {
    return [];
  }
}

/** Titles that can reveal a browser call: the window in front and the browser extension's tabs. */
export async function callTitles(): Promise<string[]> {
  const out: string[] = [];
  const f = frontWindow();
  if (f?.title) out.push(f.title);
  try {
    const { allTabs } = await import('./browser-tabs');
    for (const t of allTabs()) if (t.audible || t.active) out.push(`${t.title} ${t.url}`);
  } catch {
    /* no browser linked */
  }
  return out;
}

const WIN_MIC = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAEV { int a(); int b(); int c(); int d(); int e(); int f(); int g(); int h(); int i(); int j(); int k();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, Guid g); int GetMute(out bool m); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMD { int Activate(ref Guid id, int ctx, int p, out IAEV v); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDE { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMD d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDE { }
public class KeeperMic {
  static IAEV V() { var e = new MMDE() as IMMDE; IMMD d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(1, 1, out d)); var id = typeof(IAEV).GUID; IAEV v; Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, 0, out v)); return v; }
  public static bool Muted() { bool m; V().GetMute(out m); return m; }
  public static void Mute(bool m) { V().SetMute(m, Guid.Empty); }
}
'@`;

/** Mutes or unmutes the default microphone for every app. */
export async function setSystemMicMuted(muted: boolean): Promise<void> {
  if (isMac) {
    try {
      const { macHelperCall } = await import('./platform/mac');
      await macHelperCall('calls.mute', { muted }, 4000);
      return;
    } catch {
      // Without the helper: the input volume (AppleScript keeps no separate mute).
      await run('/usr/bin/osascript', ['-e', `set volume input volume ${muted ? 0 : 75}`], 4000);
      return;
    }
  }
  if (isWin) {
    const r = await powershell(`${WIN_MIC}; [KeeperMic]::Mute($${muted})`, 15_000);
    if (!r.ok) throw new Error('Windows did not let Keeper mute the microphone');
    return;
  }
  if (!(await run('pactl', ['set-source-mute', '@DEFAULT_SOURCE@', muted ? '1' : '0'], 3000)).ok) {
    if (!(await run('amixer', ['set', 'Capture', muted ? 'nocap' : 'cap'], 3000)).ok) throw new Error('Could not reach the sound server to mute the microphone');
  }
}

export async function systemMicMuted(): Promise<boolean | undefined> {
  if (isMac) {
    try {
      const { macHelperCall } = await import('./platform/mac');
      return (await macHelperCall<{ muted: boolean }>('calls.muted', {}, 4000)).muted;
    } catch {
      const r = await run('/usr/bin/osascript', ['-e', 'input volume of (get volume settings)'], 4000);
      return r.ok ? Number(r.stdout.trim()) === 0 : undefined;
    }
  }
  if (isWin) {
    const r = await powershell(`${WIN_MIC}; [KeeperMic]::Muted()`, 15_000);
    return r.ok ? /true/i.test(r.stdout) : undefined;
  }
  const r = await run('pactl', ['get-source-mute', '@DEFAULT_SOURCE@'], 3000);
  return r.ok ? /yes/i.test(r.stdout) : undefined;
}

/** The call app's own mute shortcut: brings the app forward and presses it. */
export async function muteInApp(call: CallState): Promise<boolean> {
  const app = callAppFor(call.owner);
  if (!app?.muteKey) return false;
  const combo = isMac ? app.muteKey.mac : app.muteKey.other;
  const parts = combo.split('+');
  const key = parts.pop()!.toLowerCase();
  if (isMac) {
    const mods = parts.map((p) => ({ Command: 'command down', Shift: 'shift down', Control: 'control down', Alt: 'option down' })[p]).filter(Boolean).join(', ');
    const target = call.owner.replace(/"/g, '');
    const script = `tell application "${target}" to activate\ndelay 0.15\ntell application "System Events" to keystroke "${key === 'space' ? ' ' : key}"${mods ? ` using {${mods}}` : ''}`;
    return (await run('/usr/bin/osascript', ['-e', script], 5000)).ok;
  }
  if (isWin) {
    const sk = parts.map((p) => ({ Control: '^', Shift: '+', Alt: '%' })[p] ?? '').join('') + (key === 'space' ? ' ' : key);
    const name = call.owner.replace(/'/g, '');
    const r = await powershell(`$p = Get-Process -Name '${name}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { $w = New-Object -ComObject WScript.Shell; [void]$w.AppActivate($p.Id); Start-Sleep -Milliseconds 150; $w.SendKeys('${sk}'); 'ok' }`, 10_000);
    return /ok/.test(r.stdout);
  }
  const xkey = [...parts.map((p) => ({ Control: 'ctrl', Shift: 'shift', Alt: 'alt', Command: 'super' })[p] ?? p.toLowerCase()), key].join('+');
  const r = await run('xdotool', ['search', '--onlyvisible', '--class', call.owner, 'windowactivate', '--sync', 'key', '--clearmodifiers', xkey], 5000);
  return r.ok;
}
