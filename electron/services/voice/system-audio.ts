// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The computer's own sound (the other people in a call), as 16 kHz mono:
//   Linux   the default output's monitor source (PipeWire or PulseAudio) through parec or pw-record
//   macOS   ScreenCaptureKit audio in keeper-helper (Screen Recording permission; macOS 13+)
//   Windows WASAPI loopback, captured by the capture window (Electron's loopback audio)
// Each returns a stop function; samples arrive through `on`.

import { spawn, type ChildProcess } from 'node:child_process';
import { run } from '../../../core/platform';

export interface SystemAudio { stop(): void; how: string }

export async function linuxMonitor(): Promise<string | null> {
  const r = await run('pactl', ['get-default-sink'], 3000);
  if (r.ok && r.stdout.trim()) return `${r.stdout.trim()}.monitor`;
  const info = await run('pactl', ['info'], 3000);
  const sink = /Default Sink:\s*(\S+)/.exec(info.stdout)?.[1];
  return sink ? `${sink}.monitor` : null;
}

function pcmStream(p: ChildProcess, on: (s: Float32Array) => void) {
  let carry = Buffer.alloc(0);
  p.stdout!.on('data', (d: Buffer) => {
    const buf = carry.length ? Buffer.concat([carry, d]) : d;
    const n = buf.length >> 2;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(i * 4);
    carry = Buffer.from(buf.subarray(n * 4));
    if (n) on(out);
  });
}

async function startLinux(on: (s: Float32Array) => void): Promise<SystemAudio | { error: string }> {
  const src = await linuxMonitor();
  if (!src) return { error: 'No sound server answered (PipeWire or PulseAudio), so the computer’s sound can’t be recorded' };
  const tries: [string, string[]][] = [
    ['parec', ['-d', src, '--format=float32le', '--rate=16000', '--channels=1', '--raw', '--latency-msec=100']],
    ['pw-record', ['--target', src, '--format', 'f32', '--rate', '16000', '--channels', '1', '-']],
  ];
  for (const [cmd, args] of tries) {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const ok = await new Promise<boolean>((resolve) => {
      p.once('error', () => resolve(false));
      p.once('exit', () => resolve(false));
      p.stdout!.once('data', () => resolve(true));
      setTimeout(() => resolve(p.exitCode === null), 1500);
    });
    if (!ok) { p.kill(); continue; }
    pcmStream(p, on);
    return { stop: () => p.kill(), how: `${cmd} from ${src}` };
  }
  return { error: 'Install pulseaudio-utils (parec) or pipewire (pw-record) to record the computer’s sound' };
}

async function startMac(on: (s: Float32Array) => void): Promise<SystemAudio | { error: string }> {
  const { helperPath } = await import('../platform/mac');
  const { HelperClient } = await import('../platform/helper-client');
  const bin = helperPath();
  if (!bin) return { error: 'keeper-helper is missing from this copy of Keeper' };
  const client = new HelperClient(bin, [], 5_000);
  const abort = new AbortController();
  return new Promise((resolve) => {
    let started = false;
    client.call('voice.systemAudio', { rate: 16000 }, {
      signal: abort.signal,
      onDelta: (d) => {
        if (d === 'ready') { started = true; resolve({ stop: () => abort.abort(), how: 'ScreenCaptureKit' }); return; }
        const b = Buffer.from(d, 'base64');
        const out = new Float32Array(b.length >> 2);
        for (let i = 0; i < out.length; i++) out[i] = b.readFloatLE(i * 4);
        on(out);
      },
    }).catch((e: Error) => {
      if (!started) resolve({ error: /permission|declined|denied|TCC/i.test(e.message) ? 'Allow Keeper in System Settings → Privacy & Security → Screen & System Audio Recording' : e.message });
    });
  });
}

/** Starts recording the computer's sound in the main process (Linux, macOS). Windows records it in the capture window. */
export async function startSystemAudio(on: (s: Float32Array) => void, platform = process.platform): Promise<SystemAudio | { error: string } | 'renderer'> {
  if (platform === 'win32') return 'renderer';
  if (platform === 'darwin') return startMac(on);
  return startLinux(on);
}
