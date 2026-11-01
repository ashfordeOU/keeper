// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The per-app volume mixer: every app playing sound with its own volume and
// mute, and the output device. Linux uses PipeWire / PulseAudio streams
// (pactl); Windows uses Core Audio sessions through a small C# helper that
// PowerShell compiles in memory (it extends App controls' volume code).
// macOS has no public per-app volume control: see docs/MONITOR.md.

import { parseSinkInputs } from './appctl';

export interface MixerStream {
  /** pactl sink-input index, or the Windows process id */
  id: string;
  pid?: number;
  name: string;
  /** 0–150 (Linux allows boosting above 100) */
  volume: number;
  muted: boolean;
}

export interface OutputDevice { id: string; name: string; default: boolean }

export interface MixerState {
  supported: boolean;
  streams: MixerStream[];
  outputs: OutputDevice[];
  /** output switching works here */
  canSwitchOutput: boolean;
  note?: string;
}

/** `pactl list sink-inputs`: streams with volume and mute. */
export function parseLinuxStreams(out: string): MixerStream[] {
  const base = parseSinkInputs(out);
  const blocks = out.split(/\n(?=Sink Input #)/);
  return base.map((s) => {
    const b = blocks.find((x) => x.startsWith(`Sink Input #${s.index}`) || x.includes(`Sink Input #${s.index}\n`)) ?? '';
    const name = s.name ?? b.match(/application\.process\.binary = "([^"]*)"/)?.[1] ?? b.match(/media\.name = "([^"]*)"/)?.[1] ?? `Stream ${s.index}`;
    return { id: String(s.index), pid: s.pid, name, volume: s.volume ?? 100, muted: /Mute:\s*yes/i.test(b) };
  });
}

/** `pactl list short sinks` + `pactl get-default-sink`. */
export function parseLinuxSinks(short: string, def: string, long = ''): OutputDevice[] {
  const d = def.trim();
  const desc = new Map<string, string>();
  for (const block of long.split(/\n(?=Sink #)/)) {
    const n = block.match(/^\s*Name:\s*(\S+)/m)?.[1];
    const ds = block.match(/^\s*Description:\s*(.+)$/m)?.[1];
    if (n && ds) desc.set(n, ds.trim());
  }
  return short.split('\n').map((l) => l.trim().split(/\s+/)).filter((f) => f.length >= 2).map((f) => ({ id: f[1], name: desc.get(f[1]) ?? f[1], default: f[1] === d }));
}

export function linuxMuteCmd(id: string, muted: boolean) {
  return { file: 'pactl', args: ['set-sink-input-mute', String(Math.trunc(Number(id))), muted ? '1' : '0'] };
}

export function linuxDefaultSinkCmd(name: string) {
  if (!/^[\w.:@-]+$/.test(name)) throw new Error('Not an output device name');
  return { file: 'pactl', args: ['set-default-sink', name] };
}

const COM = `using System;using System.Runtime.InteropServices;using System.Text;using System.Diagnostics;
[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]class MMDeviceEnumerator{}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMMDeviceEnumerator{int f();int GetDefaultAudioEndpoint(int d,int r,out IMMDevice e);}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMMDevice{int Activate(ref Guid i,int c,IntPtr p,[MarshalAs(UnmanagedType.IUnknown)]out object o);}
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IAudioSessionManager2{int a();int b();int GetSessionEnumerator(out IAudioSessionEnumerator e);}
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IAudioSessionEnumerator{int GetCount(out int n);int GetSession(int i,out IAudioSessionControl2 s);}
[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IAudioSessionControl2{int a();int b();int c();int d();int e();int f();int g();int h();int i();int j();int k();int GetProcessId(out uint p);}
[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface ISimpleAudioVolume{int SetMasterVolume(float l,ref Guid g);int GetMasterVolume(out float l);int SetMute(bool m,ref Guid g);int GetMute(out bool m);}
public static class KMix{
 static IAudioSessionEnumerator Sessions(){var en=(IMMDeviceEnumerator)new MMDeviceEnumerator();IMMDevice d;en.GetDefaultAudioEndpoint(0,1,out d);var iid=typeof(IAudioSessionManager2).GUID;object o;d.Activate(ref iid,23,IntPtr.Zero,out o);IAudioSessionEnumerator e;((IAudioSessionManager2)o).GetSessionEnumerator(out e);return e;}
 public static string List(){var e=Sessions();int n;e.GetCount(out n);var sb=new StringBuilder();for(int i=0;i<n;i++){IAudioSessionControl2 s;e.GetSession(i,out s);uint p;s.GetProcessId(out p);if(p==0)continue;float v;bool m;var sv=(ISimpleAudioVolume)s;sv.GetMasterVolume(out v);sv.GetMute(out m);string name="";try{name=Process.GetProcessById((int)p).ProcessName;}catch{}sb.Append(p).Append('\\t').Append((int)Math.Round(v*100)).Append('\\t').Append(m?1:0).Append('\\t').Append(name).Append('\\n');}return sb.ToString();}
 public static int Set(uint pid,int vol,int mute){var e=Sessions();int n;e.GetCount(out n);int hit=0;for(int i=0;i<n;i++){IAudioSessionControl2 s;e.GetSession(i,out s);uint p;s.GetProcessId(out p);if(p!=pid)continue;var g=Guid.Empty;var sv=(ISimpleAudioVolume)s;if(vol>=0)sv.SetMasterVolume(vol/100f,ref g);if(mute>=0)sv.SetMute(mute==1,ref g);hit++;}return hit;}
}`;

/** Windows: the C# helper, compiled once per PowerShell (the app keeps one open). */
export const WIN_MIXER_TYPE = `if (-not ('KMix' -as [type])) { Add-Type -TypeDefinition @'\n${COM}\n'@ }`;

export function winMixerList(): string {
  return `${WIN_MIXER_TYPE}; [KMix]::List()`;
}

export function winMixerSet(pid: number, volume?: number, muted?: boolean): string {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Not a process');
  const v = volume === undefined ? -1 : Math.max(0, Math.min(100, Math.round(volume)));
  const m = muted === undefined ? -1 : muted ? 1 : 0;
  return `${WIN_MIXER_TYPE}; [KMix]::Set(${pid}, ${v}, ${m})`;
}

/** The helper's output: pid, volume, mute, name per line. Sessions of one app fold together. */
export function parseWinMixer(out: string): MixerStream[] {
  const by = new Map<number, MixerStream>();
  for (const l of out.split(/\r?\n/)) {
    const [pid, vol, mute, name] = l.split('\t');
    const p = Number(pid);
    if (!p) continue;
    if (!by.has(p)) by.set(p, { id: String(p), pid: p, name: name?.trim() || `Process ${p}`, volume: Number(vol) || 0, muted: mute === '1' });
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const MAC_MIXER_NOTE = 'macOS has no public way to change one app’s volume. Process taps (macOS 14.4+) can only capture an app’s sound: changing its volume would mean muting the original and playing a copy through Keeper, which adds delay, needs the audio-capture permission and breaks when the output device changes, so Keeper does not do it. The output device can be chosen in Control Center.';
