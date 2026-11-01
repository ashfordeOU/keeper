// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What is playing right now, and play/pause/skip — through AppleScript on
// macOS, MPRIS (playerctl) on Linux and the system media session on Windows.
// Synced lyrics come from LRCLIB; only the title, artist and length are sent.

import type { NowPlaying } from '../../core/api';
import { parseLrc, type LyricLine } from '../../core/island';
import { run } from '../../core/platform';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { parseRegMicInUse } from '../../core/awake';
import { psRun } from './ps-host';

const MAC_SCRIPT = (app: string) => `if application "${app}" is running then
tell application "${app}"
if player state is stopped then return ""
set t to current track
set d to duration of t
if d > 10000 then set d to d / 1000
return (name of t) & "\\t" & (artist of t) & "\\t" & (album of t) & "\\t" & (player state as string) & "\\t" & (player position as string) & "\\t" & (d as string)
end tell
end if
return ""`;

const WIN_SCRIPT = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$await = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
function Await($op, $type) { $t = $await.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
$m = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$s = $m.GetCurrentSession()
if ($s -eq $null) { return }
ACTION
$p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
$i = $s.GetPlaybackInfo(); $tl = $s.GetTimelineProperties()
@{ app=$s.SourceAppUserModelId; title=$p.Title; artist=$p.Artist; album=$p.AlbumTitle; status=$i.PlaybackStatus.ToString(); pos=$tl.Position.TotalSeconds; dur=$tl.EndTime.TotalSeconds } | ConvertTo-Json -Compress`;

export async function nowPlaying(): Promise<NowPlaying | undefined> {
  if (process.platform === 'darwin') {
    for (const app of ['Spotify', 'Music']) {
      const r = await run('/usr/bin/osascript', ['-e', MAC_SCRIPT(app)], 4000);
      const parts = r.stdout.trim().split('\t');
      if (parts.length >= 6 && parts[0]) {
        return { app, title: parts[0], artist: parts[1], album: parts[2], playing: parts[3] === 'playing', position: parseFloat(parts[4].replace(',', '.')) || 0, duration: parseFloat(parts[5].replace(',', '.')) || 0 };
      }
    }
    return undefined;
  }
  if (process.platform === 'linux') {
    const r = await run('playerctl', ['metadata', '--format', '{{title}}\t{{artist}}\t{{album}}\t{{status}}\t{{position}}\t{{mpris:length}}\t{{mpris:artUrl}}\t{{playerName}}\t{{shuffle}}\t{{loop}}'], 3000);
    const p = r.stdout.trim().split('\t');
    if (!r.ok || !p[0]) return undefined;
    return {
      app: p[7] || 'Media', title: p[0], artist: p[1], album: p[2] || undefined, playing: p[3] === 'Playing',
      position: (+p[4] || 0) / 1e6, duration: (+p[5] || 0) / 1e6, artwork: /^https?:/.test(p[6]) ? p[6] : undefined,
      canShuffle: p[8] !== '', shuffle: p[8] === 'true', repeat: !!p[9] && p[9] !== 'None',
    };
  }
  // Asked every few seconds: a PowerShell that stays open answers far more cheaply.
  const r = await psRun(WIN_SCRIPT.replace('ACTION', ''), 8000);
  try {
    const d = JSON.parse(r.stdout) as { app: string; title: string; artist: string; album: string; status: string; pos: number; dur: number };
    if (!d.title) return undefined;
    return { app: d.app.split('!')[0].split('.').pop() ?? 'Media', title: d.title, artist: d.artist, album: d.album || undefined, playing: d.status === 'Playing', position: d.pos, duration: d.dur };
  } catch {
    return undefined;
  }
}

export async function mediaAction(app: string | undefined, action: 'toggle' | 'next' | 'previous' | 'seek', value?: number): Promise<void> {
  if (process.platform === 'darwin') {
    const target = app === 'Spotify' ? 'Spotify' : 'Music';
    const cmd = action === 'toggle' ? 'playpause' : action === 'next' ? 'next track' : action === 'previous' ? 'previous track' : `set player position to ${Math.max(0, value ?? 0)}`;
    await run('/usr/bin/osascript', ['-e', `tell application "${target}" to ${cmd}`], 4000);
  } else if (process.platform === 'linux') {
    const args = action === 'toggle' ? ['play-pause'] : action === 'next' ? ['next'] : action === 'previous' ? ['previous'] : ['position', String(Math.max(0, value ?? 0))];
    await run('playerctl', args, 3000);
  } else {
    const call = action === 'toggle' ? 'TryTogglePlayPauseAsync()' : action === 'next' ? 'TrySkipNextAsync()' : action === 'previous' ? 'TrySkipPreviousAsync()' : `TryChangePlaybackPositionAsync(${Math.round((value ?? 0) * 1e7)})`;
    await psRun(WIN_SCRIPT.replace('ACTION', `Await ($s.${call}) ([bool]) | Out-Null; return`), 8000);
  }
}

const lyricCache = new Map<string, LyricLine[] | null>();

export async function lyricsFor(np: NowPlaying): Promise<LyricLine[] | undefined> {
  const key = `${np.artist}\u0000${np.title}`;
  if (lyricCache.has(key)) return lyricCache.get(key) ?? undefined;
  const q = new URLSearchParams({ track_name: np.title, artist_name: np.artist });
  if (np.album) q.set('album_name', np.album);
  if (np.duration) q.set('duration', String(Math.round(np.duration)));
  try {
    const res = await fetch(`https://lrclib.net/api/get?${q}`, { headers: { 'user-agent': 'Keeper (https://github.com/ashfordeOU/keeper)' } });
    const data = res.ok ? ((await res.json()) as { syncedLyrics?: string | null }) : null;
    const lines = data?.syncedLyrics ? parseLrc(data.syncedLyrics) : null;
    lyricCache.set(key, lines);
    return lines ?? undefined;
  } catch {
    return undefined;
  }
}

/** Apps that are using the microphone right now (Windows and Linux). */
/**
 * Tells you when an app starts or stops using a microphone, without asking every few seconds.
 * Linux only for now (PulseAudio/PipeWire event stream); returns undefined where not available.
 */
export function watchMic(onChange: () => void, onEnd: () => void): (() => void) | undefined {
  if (process.platform !== 'linux') return undefined;
  let child: ChildProcess | undefined;
  try {
    child = spawn('pactl', ['subscribe'], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  // No pactl, or the sound server went away: fall back to regular looks.
  const ended = () => { if (!stopped) { stopped = true; clearTimeout(timer); onEnd(); } };
  child.on('error', ended);
  child.on('exit', ended);
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    if (!chunk.includes('source-output')) return;
    // Events come in bursts; one look after they settle is enough.
    clearTimeout(timer);
    timer = setTimeout(onChange, 300);
  });
  return () => { stopped = true; clearTimeout(timer); child?.kill(); };
}

export async function micInUse(): Promise<string[]> {
  if (process.platform === 'linux') {
    const r = await run('pactl', ['list', 'source-outputs'], 3000);
    return [...new Set([...r.stdout.matchAll(/application\.name = "([^"]+)"/g)].map((m) => m[1]))];
  }
  if (process.platform === 'win32') {
    // reg.exe is a small program; PowerShell would cost far more every ten seconds.
    const r = await run(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe'), ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone', '/s', '/v', 'LastUsedTimeStop'], 5000);
    return parseRegMicInUse(r.stdout);
  }
  return [];
}
