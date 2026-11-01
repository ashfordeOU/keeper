// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sound, screens and accessories: system volume, display brightness (built-in
// and external monitors over DDC/CI), wireless-device batteries, and the
// snapshot the automatic keep-awake rules look at.

import { fullscreenNow } from './fg-watch';
import { powerMonitor, screen } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DevicesState } from '../../core/api';
import { parseLsusb, parseMacSsid, parseMacUsb, parseNetshSsid, parseNmcliSsid, type SystemSnapshot } from '../../core/awake';
import { powershell, run } from '../../core/platform';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

// ---------------------------------------------------------------- volume

/** Windows Core Audio through a tiny C# shim compiled by PowerShell on first use. */
const WIN_AUDIO = `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class KeeperAudio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null; Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null; var epvid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv)); return epv;
  }
  public static float Get() { float v = -1; Vol().GetMasterVolumeLevelScalar(out v); return v; }
  public static void Set(float v) { Vol().SetMasterVolumeLevelScalar(v, System.Guid.Empty); }
  public static bool Muted() { bool m; Vol().GetMute(out m); return m; }
  public static void Mute(bool m) { Vol().SetMute(m, System.Guid.Empty); }
}
'@
`;

export async function getVolume(): Promise<{ volume?: number; muted?: boolean }> {
  if (isMac) {
    const r = await run('/usr/bin/osascript', ['-e', 'get volume settings'], 4000);
    const v = r.stdout.match(/output volume:(\d+)/)?.[1];
    const m = r.stdout.match(/output muted:(true|false)/)?.[1];
    return { volume: v ? +v : undefined, muted: m ? m === 'true' : undefined };
  }
  if (isWin) {
    const r = await powershell(`${WIN_AUDIO}; "$([math]::Round([KeeperAudio]::Get()*100)) $([KeeperAudio]::Muted())"`, 15_000);
    const [v, m] = r.stdout.trim().split(/\s+/);
    return { volume: Number.isFinite(+v) ? +v : undefined, muted: m ? /true/i.test(m) : undefined };
  }
  const r = await run('pactl', ['get-sink-volume', '@DEFAULT_SINK@'], 3000);
  const mute = await run('pactl', ['get-sink-mute', '@DEFAULT_SINK@'], 3000);
  if (r.ok) return { volume: +(r.stdout.match(/(\d+)%/)?.[1] ?? NaN), muted: /yes/.test(mute.stdout) };
  const a = await run('amixer', ['get', 'Master'], 3000);
  return { volume: a.ok ? +(a.stdout.match(/\[(\d+)%\]/)?.[1] ?? NaN) : undefined, muted: a.ok ? /\[off\]/.test(a.stdout) : undefined };
}

export async function setVolume(v: number): Promise<void> {
  const n = Math.max(0, Math.min(100, Math.round(v)));
  if (isMac) await run('/usr/bin/osascript', ['-e', `set volume output volume ${n}`]);
  else if (isWin) await powershell(`${WIN_AUDIO}; [KeeperAudio]::Set(${n / 100})`, 15_000);
  else if (!(await run('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${n}%`])).ok) await run('amixer', ['set', 'Master', `${n}%`]);
}

export async function setMuted(m: boolean): Promise<void> {
  if (isMac) await run('/usr/bin/osascript', ['-e', `set volume output muted ${m}`]);
  else if (isWin) await powershell(`${WIN_AUDIO}; [KeeperAudio]::Mute($${m})`, 15_000);
  else if (!(await run('pactl', ['set-sink-mute', '@DEFAULT_SINK@', m ? '1' : '0'])).ok) await run('amixer', ['set', 'Master', m ? 'mute' : 'unmute']);
}

// ---------------------------------------------------------------- brightness

/** Windows external monitors: DDC/CI through dxva2. */
const WIN_DDC = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public class KeeperDdc {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct PM { public IntPtr h; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string d; }
  delegate bool MonEnum(IntPtr m, IntPtr dc, IntPtr r, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonEnum cb, IntPtr p);
  [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr m, out uint n);
  [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr m, uint n, [Out] PM[] a);
  [DllImport("dxva2.dll")] static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr h, byte code, IntPtr t, out uint cur, out uint max);
  [DllImport("dxva2.dll")] static extern bool SetVCPFeature(IntPtr h, byte code, uint v);
  public static List<PM> All() {
    var list = new List<PM>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (m, dc, r, p) => { uint n; if (GetNumberOfPhysicalMonitorsFromHMONITOR(m, out n) && n > 0) { var a = new PM[n]; if (GetPhysicalMonitorsFromHMONITOR(m, n, a)) list.AddRange(a); } return true; }, IntPtr.Zero);
    return list;
  }
  public static string List() { var s = ""; int i = 0; foreach (var m in All()) { uint c, x; var ok = GetVCPFeatureAndVCPFeatureReply(m.h, 0x10, IntPtr.Zero, out c, out x); s += i + "\\t" + m.d + "\\t" + (ok ? (c * 100 / Math.Max(1u, x)).ToString() : "") + "\\n"; i++; } return s; }
  public static bool Set(int i, uint v) { var a = All(); return i < a.Count && SetVCPFeature(a[i].h, 0x10, v); }
}
'@
`;

let ddcHelper: string | null | undefined;
async function macDdcHelper(): Promise<string | null> {
  if (ddcHelper !== undefined) return ddcHelper;
  for (const p of ['/opt/homebrew/bin/m1ddc', '/usr/local/bin/m1ddc', '/opt/homebrew/bin/ddcctl', '/usr/local/bin/ddcctl']) if (existsSync(p)) return (ddcHelper = p);
  return (ddcHelper = null);
}

export async function monitors(): Promise<{ list: DevicesState['monitors']; ddc?: string }> {
  const list: DevicesState['monitors'] = [];
  let ddc: string | undefined;
  if (isWin) {
    const internal = await powershell('(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1).CurrentBrightness', 10_000);
    if (internal.stdout.trim()) list.push({ id: 'internal', name: 'Built-in display', brightness: +internal.stdout.trim(), external: false });
    const ext = await powershell(`${WIN_DDC}; [KeeperDdc]::List()`, 20_000);
    for (const line of ext.stdout.split(/\r?\n/).filter(Boolean)) {
      const [i, name, b] = line.split('\t');
      list.push({ id: `ddc:${i}`, name: name || `Display ${+i + 1}`, brightness: b ? +b : undefined, external: true });
    }
    ddc = 'DDC/CI';
  } else if (isMac) {
    const helper = await macDdcHelper();
    if (helper?.endsWith('m1ddc')) {
      const r = await run(helper, ['display', 'list'], 5000);
      for (const m of r.stdout.matchAll(/\[(\d+)\]\s*([^\n(]+)/g)) {
        const cur = await run(helper, ['display', m[1], 'get', 'luminance'], 5000);
        list.push({ id: `m1ddc:${m[1]}`, name: m[2].trim(), brightness: Number.isFinite(+cur.stdout.trim()) ? +cur.stdout.trim() : undefined, external: true });
      }
      ddc = 'm1ddc';
    } else if (helper) {
      list.push({ id: 'ddcctl:1', name: 'External display', external: true });
      ddc = 'ddcctl';
    } else ddc = 'To change external monitors, install m1ddc (Apple silicon) or ddcctl (Intel)';
  } else {
    const bl = await run('brightnessctl', ['-m'], 3000);
    if (bl.ok) {
      const f = bl.stdout.trim().split(',');
      if (f[3]) list.push({ id: 'internal', name: 'Built-in display', brightness: parseInt(f[3], 10), external: false });
    }
    const det = await run('ddcutil', ['detect', '--brief'], 15_000);
    if (det.ok) {
      ddc = 'ddcutil';
      for (const m of det.stdout.matchAll(/Display (\d+)[\s\S]*?Monitor:\s*([^\n]+)/g)) {
        const cur = await run('ddcutil', ['--display', m[1], 'getvcp', '10', '--brief'], 8000);
        const v = cur.stdout.trim().split(/\s+/);
        list.push({ id: `ddcutil:${m[1]}`, name: m[2].split(':').slice(1).join(' ').trim() || `Display ${m[1]}`, brightness: v[3] && v[4] ? Math.round((+v[3] / +v[4]) * 100) : undefined, external: true });
      }
    } else ddc = 'Install ddcutil to change external monitors';
  }
  return { list, ddc };
}

export async function setBrightness(id: string, value: number): Promise<void> {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const [kind, n] = id.split(':');
  if (id === 'internal') {
    if (isWin) await powershell(`(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1) | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1; Brightness=${v}}`, 10_000);
    else if (!isMac) await run('brightnessctl', ['set', `${v}%`]);
    return;
  }
  if (kind === 'ddc') await powershell(`${WIN_DDC}; [KeeperDdc]::Set(${+n}, ${v})`, 20_000);
  else if (kind === 'm1ddc') await run((await macDdcHelper())!, ['display', n, 'set', 'luminance', String(v)]);
  else if (kind === 'ddcctl') await run((await macDdcHelper())!, ['-d', n, '-b', String(v)]);
  else if (kind === 'ddcutil') await run('ddcutil', ['--display', n, 'setvcp', '10', String(v)], 15_000);
}

// ---------------------------------------------------------------- wireless batteries

export async function bluetoothBatteries(): Promise<DevicesState['bluetooth']> {
  const out: DevicesState['bluetooth'] = [];
  if (isMac) {
    const r = await run('/usr/sbin/ioreg', ['-r', '-l', '-k', 'BatteryPercent'], 5000);
    for (const block of r.stdout.split(/\n(?=\+-o )/)) {
      const name = block.match(/"Product" = "([^"]+)"/)?.[1];
      const pct = block.match(/"BatteryPercent" = (\d+)/)?.[1];
      if (name && pct) out.push({ name, percent: +pct });
    }
    const sp = await run('/usr/sbin/system_profiler', ['SPBluetoothDataType', '-json'], 15_000);
    try {
      const data = JSON.parse(sp.stdout) as { SPBluetoothDataType?: { device_connected?: Record<string, Record<string, string>>[] }[] };
      for (const group of data.SPBluetoothDataType?.[0]?.device_connected ?? []) {
        for (const [name, d] of Object.entries(group)) {
          for (const [k, v] of Object.entries(d)) {
            const m = /device_batteryLevel(Left|Right|Case|Main)?/.exec(k);
            if (m && /\d+%/.test(v)) out.push({ name: m[1] && m[1] !== 'Main' ? `${name} (${m[1].toLowerCase()})` : name, percent: parseInt(v, 10) });
          }
        }
      }
    } catch {
      /* no Bluetooth details */
    }
  } else if (isWin) {
    const r = await powershell(`Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction SilentlyContinue | ForEach-Object { $b = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2' -ErrorAction SilentlyContinue).Data; if ($b -ne $null) { "$($_.FriendlyName)\`t$b" } }`, 20_000);
    for (const l of r.stdout.split(/\r?\n/).filter(Boolean)) {
      const [name, pct] = l.split('\t');
      if (name && Number.isFinite(+pct)) out.push({ name, percent: +pct });
    }
  } else {
    const r = await run('upower', ['-d'], 5000);
    for (const block of r.stdout.split(/\n(?=Device: )/)) {
      if (/power_supply|DisplayDevice|line_power/.test(block.split('\n')[0])) continue;
      const name = block.match(/model:\s+(.+)/)?.[1]?.trim();
      const pct = block.match(/percentage:\s+(\d+)/)?.[1];
      if (name && pct) out.push({ name, percent: +pct });
    }
  }
  const seen = new Set<string>();
  return out.filter((d) => (seen.has(d.name) ? false : (seen.add(d.name), true)));
}

export async function devicesState(): Promise<DevicesState> {
  const [vol, mon, bt] = await Promise.all([getVolume().catch(() => ({})), monitors().catch(() => ({ list: [], ddc: undefined })), bluetoothBatteries().catch(() => [])]);
  return { ...vol, monitors: mon.list, ddc: mon.ddc, bluetooth: bt };
}

// ---------------------------------------------------------------- keep-awake snapshot

let lastCpu = os.cpus();
export function cpuPercent(): number {
  const now = os.cpus();
  let idle = 0;
  let total = 0;
  now.forEach((c, i) => {
    const p = lastCpu[i]?.times ?? c.times;
    idle += c.times.idle - p.idle;
    total += c.times.user - p.user + c.times.nice - p.nice + c.times.sys - p.sys + c.times.idle - p.idle + c.times.irq - p.irq;
  });
  lastCpu = now;
  return total ? Math.round((1 - idle / total) * 100) : 0;
}

export async function runningApps(): Promise<string[]> {
  if (isWin) {
    const r = await run('tasklist', ['/FO', 'CSV', '/NH'], 10_000);
    return [...new Set(r.stdout.split(/\r?\n/).map((l) => l.split('","')[0]?.replace(/^"/, '').replace(/\.exe$/i, '')).filter(Boolean))];
  }
  const r = await run('ps', ['-Ao', 'comm='], 5000);
  return [...new Set(r.stdout.split('\n').map((l) => {
    const app = l.match(/\/([^/]+)\.app\//)?.[1];
    return app ?? l.trim().split('/').pop() ?? '';
  }).filter(Boolean))];
}

export async function usbDevices(): Promise<string[]> {
  if (isMac) return parseMacUsb((await run('/usr/sbin/system_profiler', ['SPUSBDataType', '-json'], 15_000)).stdout);
  if (isWin) return (await powershell('Get-PnpDevice -PresentOnly -Class USB,HIDClass,AudioEndpoint,Image,WPD -ErrorAction SilentlyContinue | ForEach-Object FriendlyName', 20_000)).stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return parseLsusb((await run('lsusb', [], 5000)).stdout);
}

export async function wifiName(): Promise<string | undefined> {
  if (isMac) {
    const r = await run('/usr/sbin/ipconfig', ['getsummary', 'en0'], 5000);
    return parseMacSsid(r.stdout) ?? parseMacSsid((await run('/usr/sbin/networksetup', ['-getairportnetwork', 'en0'], 5000)).stdout);
  }
  if (isWin) return parseNetshSsid((await run('netsh', ['wlan', 'show', 'interfaces'], 5000)).stdout);
  return parseNmcliSsid((await run('nmcli', ['-t', '-f', 'active,ssid', 'dev', 'wifi'], 5000)).stdout);
}

export async function mountedVolumes(): Promise<string[]> {
  if (isWin) return (await powershell('Get-CimInstance Win32_LogicalDisk | ForEach-Object { "$($_.DeviceID) $($_.VolumeName)" }', 10_000)).stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const dirs = isMac ? ['/Volumes'] : [`/media/${os.userInfo().username}`, `/run/media/${os.userInfo().username}`, '/mnt'];
  const out: string[] = [];
  for (const d of dirs) {
    try {
      for (const n of await fsp.readdir(d)) out.push(path.join(d, n));
    } catch {
      /* none */
    }
  }
  return out;
}

/** Only asks the OS for what the enabled rules need, so idle polling stays cheap. */
export async function snapshot(need: Set<string>): Promise<SystemSnapshot> {
  const displays = screen.getAllDisplays();
  return {
    // A laptop's own panel is "internal"; a desktop's main monitor is not an extra display.
    externalDisplays: Math.max(0, displays.filter((d) => !d.internal).length - (displays.some((d) => d.internal) ? 0 : 1)),
    onPower: !powerMonitor.isOnBatteryPower(),
    apps: need.has('app') ? await runningApps() : [],
    usb: need.has('usb') ? await usbDevices().catch(() => []) : [],
    ssid: need.has('wifi') ? await wifiName().catch(() => undefined) : undefined,
    interfaces: Object.keys(os.networkInterfaces()),
    cpu: cpuPercent(),
    volumes: need.has('drive') ? await mountedVolumes() : [],
  };
}

/** Writes a hidden file now and then so an external drive does not spin down. */
export async function touchDrive(dir: string): Promise<boolean> {
  try {
    await fsp.writeFile(path.join(dir, '.keeper-awake'), String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/** Is the app in front showing full screen? (best effort; false when unknown) */
export async function frontmostFullscreen(): Promise<boolean> {
  // One long-running helper answers from now on (see fg-watch.ts); the one-off checks below are the fallback.
  const watched = fullscreenNow();
  if (watched !== undefined) return watched;
  if (isMac) {
    const r = await run('/usr/bin/osascript', ['-e', 'tell application "System Events" to tell (first process whose frontmost is true) to get value of attribute "AXFullScreen" of front window'], 3000);
    return /true/.test(r.stdout);
  }
  if (isWin) {
    const r = await powershell(`Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class KeeperFg { [StructLayout(LayoutKind.Sequential)] public struct R { public int l, t, r, b; }
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
 [DllImport("user32.dll")] public static extern IntPtr GetShellWindow(); }
'@
$h=[KeeperFg]::GetForegroundWindow(); if ($h -eq [KeeperFg]::GetShellWindow()) { 'no'; return }
$r=New-Object KeeperFg+R; [KeeperFg]::GetWindowRect($h,[ref]$r) | Out-Null
Add-Type -AssemblyName System.Windows.Forms; $s=[System.Windows.Forms.Screen]::FromHandle($h).Bounds
if ($r.l -le $s.Left -and $r.t -le $s.Top -and $r.r -ge $s.Right -and $r.b -ge $s.Bottom) { 'yes' } else { 'no' }`, 8000);
    return /yes/.test(r.stdout);
  }
  const r = await run('xprop', ['-id', (await run('xdotool', ['getactivewindow'], 2000)).stdout.trim() || '0', '_NET_WM_STATE'], 2000);
  return /_NET_WM_STATE_FULLSCREEN/.test(r.stdout);
}

/** The app in front right now (for clipboard "copied from"). */
export async function frontmostApp(): Promise<string | undefined> {
  if (isMac) {
    const r = await run('/usr/bin/osascript', ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'], 2000);
    return r.stdout.trim() || undefined;
  }
  if (isWin) {
    const r = await powershell(`Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class KeeperFa { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int p); }
'@
$p=0; [KeeperFa]::GetWindowThreadProcessId([KeeperFa]::GetForegroundWindow(), [ref]$p) | Out-Null; (Get-Process -Id $p).ProcessName`, 5000);
    return r.stdout.trim() || undefined;
  }
  const pid = (await run('xdotool', ['getactivewindow', 'getwindowpid'], 2000)).stdout.trim();
  if (!/^\d+$/.test(pid)) return undefined;
  try {
    return (await fsp.readFile(`/proc/${pid}/comm`, 'utf8')).trim() || undefined;
  } catch {
    return undefined;
  }
}
