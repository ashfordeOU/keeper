// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Volume and brightness feedback in the Island: Keeper hears level changes
// from the system and shows its own small level next to the system's pop-up.
// Nothing polls on a timer:
//   Linux    `pactl subscribe` (sound server events) and `udevadm monitor` (backlight)
//   Windows  one PowerShell: the speakers' volume-change callback (Core Audio)
//            and the WMI brightness event
//   macOS    keeper-helper: Core Audio listeners; the brightness keys through a
//            listen-only event tap when allowed (Input Monitoring)
// The system's own pop-up stays: replacing it on macOS needs private APIs,
// and on Windows and Linux it belongs to the desktop.

import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { backlightPercent, hudChange, isBacklightEvent, pactlEventKind, parsePactlVolume, type HudEvent, type HudLevel } from '../../core/island-hud';
import { run } from '../../core/platform';
import { lowerPriority } from './governor';
import { psExe } from './ps-host';

const WIN_HUD = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolumeCallback { [PreserveSig] int OnNotify(IntPtr pNotify); }
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolumeX {
  int RegisterControlChangeNotify(IAudioEndpointVolumeCallback cb); int UnregisterControlChangeNotify(IAudioEndpointVolumeCallback cb);
  int GetChannelCount(out int n); int SetMasterVolumeLevel(float l, Guid g); int SetMasterVolumeLevelScalar(float l, Guid g);
  int GetMasterVolumeLevel(out float l); int GetMasterVolumeLevelScalar(out float l);
  int a(); int b(); int c(); int d(); int SetMute(bool m, Guid g); int GetMute(out bool m);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceX { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumeratorX { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDeviceX d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class KeeperHudEnum { }
[ComVisible(true)] public class KeeperHudCb : IAudioEndpointVolumeCallback {
  public IAudioEndpointVolumeX Vol;
  public int OnNotify(IntPtr p) { float v; bool m; Vol.GetMasterVolumeLevelScalar(out v); Vol.GetMute(out m);
    Console.Out.WriteLine("{\\"kind\\":\\"volume\\",\\"value\\":" + Math.Round(v * 100) + ",\\"muted\\":" + (m ? "true" : "false") + "}"); Console.Out.Flush(); return 0; }
}
public static class KeeperHud {
  public static KeeperHudCb Start() {
    var e = (IMMDeviceEnumeratorX)(new KeeperHudEnum()); IMMDeviceX d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d));
    var id = typeof(IAudioEndpointVolumeX).GUID; object o; Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, IntPtr.Zero, out o));
    var cb = new KeeperHudCb(); cb.Vol = (IAudioEndpointVolumeX)o; cb.Vol.RegisterControlChangeNotify(cb); cb.OnNotify(IntPtr.Zero); return cb;
  }
}
'@
$keep = [KeeperHud]::Start()
try {
  Register-WmiEvent -Namespace root\\wmi -Query "SELECT * FROM WmiMonitorBrightnessEvent" -SourceIdentifier KeeperBrightness -ErrorAction Stop | Out-Null
  while ($true) {
    $ev = Wait-Event -SourceIdentifier KeeperBrightness -Timeout 3600
    if ($ev) { [Console]::Out.WriteLine('{"kind":"brightness","value":' + [int]$ev.SourceEventArgs.NewEvent.Brightness + '}'); [Console]::Out.Flush(); Remove-Event -EventIdentifier $ev.EventIdentifier }
  }
} catch { while ($true) { Start-Sleep -Seconds 3600 } }
`;

export class HudWatcher {
  private kids: ChildProcess[] = [];
  private last = new Map<string, HudLevel>();
  private stopMac?: AbortController;
  private timer?: NodeJS.Timeout;
  /** how levels are heard here, in plain words (for Settings) */
  how = '';

  constructor(private onEvent: (e: HudEvent) => void) {}

  private feed(level: HudLevel) {
    const key = `${level.kind}:${level.device ?? ''}`;
    const prev = this.last.get(key);
    this.last.set(key, level);
    const e = hudChange(prev, level);
    if (e) this.onEvent(e);
  }

  private own(c: ChildProcess) {
    this.kids.push(c);
    lowerPriority(c);
    c.on('error', () => undefined);
    c.on('exit', () => { this.kids = this.kids.filter((k) => k !== c); });
    return c;
  }

  private lines(c: ChildProcess, fn: (l: string) => void) {
    let buf = '';
    c.stdout?.setEncoding('utf8');
    c.stdout?.on('data', (d: string) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { fn(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    });
  }

  async start(o: { brightnessKeys?: boolean } = {}): Promise<boolean> {
    if (this.kids.length || this.stopMac) return true;
    if (process.platform === 'linux') return this.startLinux();
    if (process.platform === 'win32') {
      const c = this.own(spawn(psExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_HUD], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }));
      this.lines(c, (l) => this.onJson(l));
      this.how = 'Windows tells Keeper when the volume or brightness changes.';
      return true;
    }
    const { macHelperStream } = await import('./platform/mac');
    const ac = new AbortController();
    this.stopMac = ac;
    this.how = o.brightnessKeys ? 'macOS tells Keeper when the volume changes; brightness keys are heard with Input Monitoring.' : 'macOS tells Keeper when the volume changes.';
    macHelperStream('hud.watch', { keys: !!o.brightnessKeys }, (t) => this.onJson(t), ac.signal).catch(() => { if (this.stopMac === ac) this.stopMac = undefined; });
    return true;
  }

  private onJson(l: string) {
    try {
      const o = JSON.parse(l) as { kind?: string; value?: number; muted?: boolean; direction?: number };
      if (o.kind === 'volume' && typeof o.value === 'number') this.feed({ kind: 'volume', value: o.value, muted: o.muted });
      else if (o.kind === 'brightness') {
        // macOS without a readable value (Apple silicon): step from the last known level so the bar still moves.
        if (typeof o.value !== 'number' && !this.last.has('brightness:')) this.last.set('brightness:', { kind: 'brightness', value: 50 });
        const prev = this.last.get('brightness:')?.value ?? 50;
        const value = typeof o.value === 'number' ? o.value : Math.max(0, Math.min(100, prev + 6.25 * (o.direction ?? 0)));
        this.feed({ kind: 'brightness', value });
      }
    } catch {
      /* not a level */
    }
  }

  private async startLinux(): Promise<boolean> {
    // Baselines first, so the first real change shows (not the start).
    const readVolume = async () => {
      const v = await run('pactl', ['get-sink-volume', '@DEFAULT_SINK@'], 2000);
      const m = await run('pactl', ['get-sink-mute', '@DEFAULT_SINK@'], 2000);
      const value = parsePactlVolume(v.stdout);
      if (v.ok && value !== undefined) this.feed({ kind: 'volume', value, muted: /yes/.test(m.stdout) });
    };
    const readBacklight = async () => {
      const dir = '/sys/class/backlight';
      const devs = await fsp.readdir(dir).catch(() => [] as string[]);
      if (!devs.length) return;
      const d = path.join(dir, devs[0]);
      const [cur, max] = await Promise.all([fsp.readFile(path.join(d, 'actual_brightness'), 'utf8').catch(() => fsp.readFile(path.join(d, 'brightness'), 'utf8')), fsp.readFile(path.join(d, 'max_brightness'), 'utf8')]).catch(() => ['', '']);
      const value = backlightPercent(cur, max);
      if (value !== undefined) this.feed({ kind: 'brightness', value });
    };
    await readVolume();
    await readBacklight();
    let pending: NodeJS.Timeout | undefined;
    try {
      const pa = this.own(spawn('pactl', ['subscribe'], { stdio: ['ignore', 'pipe', 'ignore'] }));
      this.lines(pa, (l) => {
        if (pactlEventKind(l) !== 'sink' && pactlEventKind(l) !== 'server') return;
        // Key repeats come in bursts; one read after they settle.
        clearTimeout(pending);
        pending = setTimeout(() => void readVolume(), 60);
      });
    } catch { /* no PulseAudio/PipeWire */ }
    try {
      const ud = this.own(spawn('udevadm', ['monitor', '--udev', '--subsystem-match=backlight'], { stdio: ['ignore', 'pipe', 'ignore'] }));
      this.lines(ud, (l) => { if (isBacklightEvent(l)) void readBacklight(); });
    } catch { /* no udev */ }
    this.how = 'The sound server and the backlight tell Keeper when levels change.';
    return this.kids.length > 0;
  }

  /** A level Keeper itself just set (the Island's sliders) becomes the new baseline without a pop-up. */
  quietly(level: HudLevel) {
    this.last.set(`${level.kind}:${level.device ?? ''}`, level);
  }

  stop() {
    for (const k of this.kids) k.kill();
    this.kids = [];
    this.stopMac?.abort();
    this.stopMac = undefined;
    clearTimeout(this.timer);
    this.last.clear();
  }
}
