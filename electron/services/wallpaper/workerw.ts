// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Windows: putting a window behind the desktop icons.
//
// Windows has no public "desktop layer" for apps. The common technique (used
// for years by well-known live-wallpaper apps, and undocumented but stable from
// Windows 7 to 11) is:
//   1. send message 0x052C to the "Progman" window; Explorer then creates a
//      "WorkerW" window between the wallpaper and the icons (SHELLDLL_DefView);
//   2. find that WorkerW (Windows 10: the top-level WorkerW after the one that
//      holds SHELLDLL_DefView; Windows 11 24H2: a WorkerW child of Progman);
//   3. SetParent our window into it and size it in that window's coordinates.
// If any step fails (Explorer replaced, a shell that is not Explorer), the
// caller falls back to setting a still frame as the ordinary desktop picture.

import { powershell } from '../../../core/platform';

const SCRIPT = (hwnd: string, x: number, y: number, w: number, h: number) => `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class KeeperWorkerW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string n);
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string n);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr c, IntPtr p);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  public static IntPtr Find() {
    IntPtr progman = FindWindow("Progman", null);
    IntPtr r;
    SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(0x1), 0, 1000, out r);
    SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out r);
    IntPtr worker = IntPtr.Zero;
    EnumWindows((top, l) => {
      if (FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) worker = FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
      return true;
    }, IntPtr.Zero);
    if (worker == IntPtr.Zero) worker = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
    return worker;
  }
}
'@
$w = [KeeperWorkerW]::Find()
if ($w -eq [IntPtr]::Zero) { 'no-workerw'; exit }
$me = [IntPtr]::new([Int64]${hwnd})
[void][KeeperWorkerW]::SetParent($me, $w)
$vx = [KeeperWorkerW]::GetSystemMetrics(76); $vy = [KeeperWorkerW]::GetSystemMetrics(77)
# SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW
[void][KeeperWorkerW]::SetWindowPos($me, [IntPtr]::Zero, ${x} - $vx, ${y} - $vy, ${w}, ${h}, 0x0054)
'ok'
`;

/** The window handle Electron gives as a Buffer, as a decimal string. */
export function hwndOf(buf: Buffer): string {
  return buf.length >= 8 ? buf.readBigUInt64LE(0).toString() : String(buf.readUInt32LE(0));
}

/** Parents a window into the desktop behind the icons. `rect` is in physical screen pixels. */
export async function attachBehindIcons(handle: Buffer, rect: { x: number; y: number; width: number; height: number }): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const r = await powershell(SCRIPT(hwndOf(handle), Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)), 20_000);
  if (r.stdout.includes('ok')) return { ok: true };
  return { ok: false, error: r.stdout.includes('no-workerw') ? 'The desktop did not make room for a wallpaper window (Explorer is not the shell, or it changed)' : (r.stderr.trim().split('\n')[0] || 'Could not reach the desktop') };
}
