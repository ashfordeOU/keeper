// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Studio's work with the bundled ffmpeg: what a file holds, copying the
// coded picture out for the export, loudness over time (to find silences),
// still frames (thumbnails, privacy scan) and joining or fixing tracks.

import { spawn } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { extractArgs, parseFramecrc, webCodecFor, type PacketIndex } from '../../../core/studio/packets';
import { ffmpegPath } from '../recorder';

export interface RunResult { ok: boolean; code: number | null; stdout: string; stderr: string }

/** Runs the bundled ffmpeg; stdout is kept (as text) up to `maxOut` bytes. */
export function ffmpeg(args: string[], o: { timeout?: number; signal?: AbortSignal; maxOut?: number; onStderr?: (s: string) => void } = {}): Promise<RunResult> {
  const bin = ffmpegPath() ?? 'ffmpeg';
  return new Promise((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-nostdin', '-y', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const max = o.maxOut ?? 64 * 1024 * 1024;
    child.stdout.on('data', (d: Buffer) => { if (out.length < max) out += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { const s = d.toString('utf8'); err = (err + s).slice(-20000); o.onStderr?.(s); });
    const timer = o.timeout ? setTimeout(() => child.kill('SIGKILL'), o.timeout) : undefined;
    const abort = () => child.kill('SIGKILL');
    o.signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: null, stdout: out, stderr: String(e) }); });
    child.on('close', (code) => { clearTimeout(timer); o.signal?.removeEventListener('abort', abort); resolve({ ok: code === 0, code, stdout: out, stderr: err }); });
  });
}

/** Raw bytes from ffmpeg's stdout (audio samples). */
export function ffmpegBytes(args: string[], timeout = 10 * 60_000): Promise<Buffer | null> {
  const bin = ffmpegPath() ?? 'ffmpeg';
  return new Promise((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const parts: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => parts.push(d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? Buffer.concat(parts) : null); });
  });
}

export interface Probe { duration: number; video?: { codec: string; width: number; height: number; fps: number }; audio: boolean; start: number }

/** What `ffmpeg -i` says about a file. */
export function parseProbe(text: string): Probe {
  const d = text.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const duration = d ? (+d[1] * 3600 + +d[2] * 60 + +d[3]) * 1000 : 0;
  const start = +(text.match(/start: (-?[\d.]+)/)?.[1] ?? 0) * 1000;
  const v = text.match(/Stream #\d+:\d+[^:]*: Video: (\w+)[^\n]*?, (\d{2,5})x(\d{2,5})[^\n]*/);
  const fps = v ? +(v[0].match(/([\d.]+) fps/)?.[1] ?? v[0].match(/([\d.]+) tbr/)?.[1] ?? 30) : 30;
  return { duration, start, video: v ? { codec: v[1], width: +v[2], height: +v[3], fps } : undefined, audio: /Stream #\d+:\d+[^:]*: Audio:/.test(text) };
}

export async function probe(file: string): Promise<Probe> {
  const r = await ffmpeg(['-i', file], { timeout: 60_000 });
  return parseProbe(r.stderr);
}

/** Length in ms, read by decoding when the file does not say (a recording cut short). */
export async function measuredDuration(file: string): Promise<number> {
  const p = await probe(file);
  if (p.duration > 0) return p.duration;
  const r = await ffmpeg(['-i', file, '-map', '0:v:0?', '-map', '0:a:0?', '-f', 'null', '-'], { timeout: 10 * 60_000 });
  const times = [...r.stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  const last = times[times.length - 1];
  return last ? (+last[1] * 3600 + +last[2] * 60 + +last[3]) * 1000 : 0;
}

/**
 * Copies a video track's coded frames into `<cache>/<name>.bin` with an index,
 * once; later exports reuse them while the source is unchanged.
 */
export async function packetIndex(file: string, cacheDir: string, name: string): Promise<{ index: PacketIndex; bin: string }> {
  await fsp.mkdir(cacheDir, { recursive: true });
  const bin = path.join(cacheDir, `${name}.bin`);
  const idx = path.join(cacheDir, `${name}.json`);
  const st = await fsp.stat(file);
  try {
    const cached = JSON.parse(await fsp.readFile(idx, 'utf8')) as PacketIndex & { mtime: number; size: number };
    if (cached.mtime === st.mtimeMs && cached.size === st.size && existsSync(bin)) return { index: cached, bin };
  } catch { /* not made yet */ }
  const pr = await probe(file);
  const codec = pr.video?.codec ?? 'h264';
  const r = await ffmpeg(['-loglevel', 'error', ...extractArgs(file, bin, codec)], { timeout: 30 * 60_000 });
  if (!r.ok) throw new Error(`The recording’s picture could not be read (${r.stderr.trim().split('\n').pop() ?? 'ffmpeg failed'})`);
  const parsed = parseFramecrc(r.stdout);
  const fh = await fsp.open(bin, 'r');
  const head = Buffer.alloc(Math.min(4096, parsed.packets[0]?.size ?? 0));
  try { await fh.read(head, 0, head.length, 0); } finally { await fh.close(); }
  const webcodec = webCodecFor(parsed.codec || codec, head);
  if (!webcodec) throw new Error(`Studio cannot read ${parsed.codec || codec} pictures yet`);
  const index: PacketIndex = { codec: parsed.codec || codec, width: parsed.width || pr.video?.width || 0, height: parsed.height || pr.video?.height || 0, packets: parsed.packets, webcodec };
  await fsp.writeFile(idx, JSON.stringify({ ...index, mtime: st.mtimeMs, size: st.size }));
  return { index, bin };
}

/** Loudness every `stepMs` (RMS 0–1) of a sound file. */
export async function levels(file: string, stepMs = 50): Promise<number[]> {
  const rate = 8000;
  const raw = await ffmpegBytes(['-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1']);
  if (!raw) return [];
  const per = Math.round((rate * stepMs) / 1000);
  const n = Math.floor(raw.length / 2);
  const out: number[] = [];
  for (let i = 0; i < n; i += per) {
    let sum = 0;
    const end = Math.min(n, i + per);
    for (let j = i; j < end; j++) { const v = raw.readInt16LE(j * 2) / 32768; sum += v * v; }
    out.push(+Math.sqrt(sum / Math.max(1, end - i)).toFixed(4));
  }
  return out;
}

/** A still frame as PNG (for the privacy scan), `width` wide. */
export async function frameAt(file: string, ms: number, width?: number): Promise<Buffer | null> {
  return ffmpegBytes(['-ss', (ms / 1000).toFixed(3), '-i', file, '-frames:v', '1', ...(width ? ['-vf', `scale=${width}:-2`] : []), '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], 60_000);
}

export async function thumbnail(file: string, out: string, ms: number): Promise<boolean> {
  const r = await ffmpeg(['-loglevel', 'error', '-ss', (ms / 1000).toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', out], { timeout: 60_000 });
  return r.ok;
}

/** Re-muxes a recording so players know its length and can seek (MediaRecorder leaves both out). */
export async function remux(src: string, dest: string, o: { audioOnly?: boolean; videoOnly?: boolean; faststart?: boolean } = {}): Promise<boolean> {
  const maps = o.audioOnly ? ['-map', '0:a:0', '-vn'] : o.videoOnly ? ['-map', '0:v:0', '-an'] : ['-map', '0'];
  const r = await ffmpeg(['-loglevel', 'error', '-i', src, ...maps, '-c', 'copy', ...(o.faststart ? ['-movflags', '+faststart'] : []), dest], { timeout: 30 * 60_000 });
  return r.ok && existsSync(dest);
}
