// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The pure side of the media tools: ffmpeg arguments for merging, cropping,
// flipping, resizing, subtitles, replacing sound and cleaning up audio; what a
// file contains (read from ffmpeg's own report); transcripts as text, SRT and
// WebVTT; and the post-processing of the on-device face detector.

// ---------------------------------------------------------------- merging

export interface StreamFacts {
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  fps?: number;
  sampleRate?: number;
}

/**
 * Clips can be joined without re-encoding only when every one has the same
 * codecs, picture size and frame rate (otherwise players stutter or stop).
 */
export function canJoinWithoutReencode(clips: StreamFacts[]): boolean {
  if (clips.length < 2) return true;
  const a = clips[0];
  return clips.every((c) => c.videoCodec === a.videoCodec && c.audioCodec === a.audioCodec && c.width === a.width && c.height === a.height && Math.abs((c.fps ?? 0) - (a.fps ?? 0)) < 0.01 && c.sampleRate === a.sampleRate);
}

/** The list file the concat demuxer reads; quotes in names are escaped the way it expects. */
export function concatList(files: string[]): string {
  return files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`).join('\n') + '\n';
}

/**
 * A filter graph that scales every clip to the first one's size (letterboxed),
 * gives each a sound track (silence where there is none) and joins them.
 */
export function concatFilter(n: number, width: number, height: number, hasAudio: boolean[], durations: number[] = []): string {
  const parts: string[] = [];
  const pairs: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`);
    // Silence as long as the clip: an endless one would keep the join from ever finishing.
    parts.push(hasAudio[i] ? `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]` : `anullsrc=r=48000:cl=stereo:d=${Math.max(0.05, durations[i] ?? 0.05).toFixed(3)}[a${i}]`);
    pairs.push(`[v${i}][a${i}]`);
  }
  return `${parts.join(';')};${pairs.join('')}concat=n=${n}:v=1:a=1[v][a]`;
}

// ---------------------------------------------------------------- picture

export function cropFilter(c: { width: number; height: number; x: number; y: number }): string {
  const w = Math.max(2, Math.round(c.width / 2) * 2);
  const h = Math.max(2, Math.round(c.height / 2) * 2);
  return `crop=${w}:${h}:${Math.max(0, Math.round(c.x))}:${Math.max(0, Math.round(c.y))}`;
}

/** A centred crop to an aspect ratio such as 1:1, 9:16 or 16:9. */
export function aspectCrop(width: number, height: number, ratio: string): { width: number; height: number; x: number; y: number } {
  const [a, b] = ratio.split(':').map(Number);
  if (!(a > 0 && b > 0)) throw new Error('Use a ratio like 16:9');
  const target = a / b;
  let w = width;
  let h = Math.round(width / target);
  if (h > height) {
    h = height;
    w = Math.round(height * target);
  }
  return { width: w, height: h, x: Math.round((width - w) / 2), y: Math.round((height - h) / 2) };
}

export function flipFilter(axis: 'h' | 'v' | 'both'): string {
  return axis === 'h' ? 'hflip' : axis === 'v' ? 'vflip' : 'hflip,vflip';
}

/** Exact size, or fit inside it (keeping the shape) with bars, or fill it and cut the overflow. */
export function resizeFilter(width: number, height: number, mode: 'exact' | 'fit' | 'fill'): string {
  const w = Math.max(2, Math.round(width / 2) * 2);
  const h = Math.max(2, Math.round(height / 2) * 2);
  if (mode === 'exact') return `scale=${w}:${h},setsar=1`;
  if (mode === 'fit') return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
}

// ---------------------------------------------------------------- subtitles

/**
 * The subtitles filter takes a path inside a filter graph, where : \ ' , [ ]
 * and ; all mean something. Windows drive letters need their colon escaped too.
 */
export function subtitlesFilter(file: string, style?: { fontSize?: number; outline?: boolean }): string {
  const p = file.replace(/\\/g, '/').replace(/([:'\[\],;])/g, '\\$1');
  const force = style ? `:force_style='FontSize=${style.fontSize ?? 22}${style.outline === false ? '' : ',BorderStyle=1,Outline=2'}'` : '';
  return `subtitles='${p}'${force}`;
}

// ---------------------------------------------------------------- sound

/** Replace the soundtrack, or mix the new one under the original at a volume. */
export function replaceAudioArgs(mode: 'replace' | 'mix', newVolume = 1, originalVolume = 1): string[] {
  if (mode === 'replace') return ['-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest'];
  return [
    '-filter_complex', `[0:a]volume=${originalVolume}[a0];[1:a]volume=${newVolume}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]`,
    '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
  ];
}

/**
 * Noise and hum removal: an FFT denoiser, a high-pass below speech, and notch
 * filters at the mains hum (50 or 60 Hz) and its first harmonics.
 */
export function cleanAudioFilter(strength: 'light' | 'strong', hum: 0 | 50 | 60): string {
  const parts = [`highpass=f=${strength === 'strong' ? 90 : 70}`];
  if (hum) for (const k of [1, 2, 3]) parts.push(`bandreject=f=${hum * k}:width_type=q:w=30`);
  parts.push(strength === 'strong' ? 'afftdn=nr=24:nf=-30:tn=1' : 'afftdn=nr=12:nf=-40');
  parts.push('loudnorm=I=-18:TP=-1.5:LRA=11');
  return parts.join(',');
}

// ---------------------------------------------------------------- what is inside

export interface MediaInfo {
  container?: string;
  duration?: number;
  bitrateKbps?: number;
  video?: { codec: string; width?: number; height?: number; fps?: number; pixelFormat?: string; bitrateKbps?: number };
  audio?: { codec: string; sampleRate?: number; channels?: string; bitrateKbps?: number };
  subtitles: number;
  metadata: Record<string, string>;
}

/** Reads `ffmpeg -i file` output (works with the ffmpeg Keeper ships; no ffprobe needed). */
export function parseMediaInfo(stderr: string): MediaInfo {
  const info: MediaInfo = { subtitles: 0, metadata: {} };
  const input = stderr.match(/Input #0, ([^,\n]+(?:,[^,\n]+)*?), from/);
  if (input) info.container = input[1];
  const d = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (d) info.duration = +d[1] * 3600 + +d[2] * 60 + +d[3];
  const br = stderr.match(/Duration:[^\n]*bitrate:\s*(\d+)\s*kb\/s/);
  if (br) info.bitrateKbps = +br[1];
  // The container's own tags come first, indented four spaces under "Metadata:".
  const meta = stderr.split(/\n\s*Duration:/)[0].match(/Metadata:\n((?:\s{4}\S[^\n]*\n?)+)/);
  if (meta) for (const line of meta[1].split('\n')) {
    const m = line.match(/^\s{4}(\S[^:]*?)\s*:\s?(.*)$/);
    if (m && m[2]) info.metadata[m[1]] = m[2];
  }
  for (const line of stderr.split('\n')) {
    const s = line.match(/Stream #\d+:\d+.*?: (Video|Audio|Subtitle): (.*)$/);
    if (!s) continue;
    const rest = s[2];
    const codec = rest.split(/[ ,(]/)[0];
    const kbps = rest.match(/(\d+) kb\/s/);
    if (s[1] === 'Video' && !info.video) {
      const size = rest.match(/(\d{2,5})x(\d{2,5})/);
      const fps = rest.match(/([\d.]+) fps/);
      const pix = rest.match(/, (yuv[^ ,()]+|rgb[^ ,()]+|gray[^ ,()]*|nv12|p010le)/);
      info.video = { codec, width: size ? +size[1] : undefined, height: size ? +size[2] : undefined, fps: fps ? +fps[1] : undefined, pixelFormat: pix?.[1], bitrateKbps: kbps ? +kbps[1] : undefined };
    } else if (s[1] === 'Audio' && !info.audio) {
      const hz = rest.match(/(\d+) Hz/);
      const ch = rest.match(/Hz, ([^,]+)/);
      info.audio = { codec, sampleRate: hz ? +hz[1] : undefined, channels: ch?.[1].trim(), bitrateKbps: kbps ? +kbps[1] : undefined };
    } else if (s[1] === 'Subtitle') info.subtitles++;
  }
  return info;
}

export function describeMediaInfo(name: string, i: MediaInfo): string {
  const t = i.duration !== undefined ? `${Math.floor(i.duration / 60)}:${String(Math.floor(i.duration % 60)).padStart(2, '0')}` : '?';
  const lines = [name, `Length ${t}${i.bitrateKbps ? ` · ${i.bitrateKbps} kb/s overall` : ''}${i.container ? ` · ${i.container}` : ''}`];
  if (i.video) lines.push(`Video: ${i.video.codec}${i.video.width ? ` ${i.video.width}×${i.video.height}` : ''}${i.video.fps ? ` · ${i.video.fps} fps` : ''}${i.video.pixelFormat ? ` · ${i.video.pixelFormat}` : ''}${i.video.bitrateKbps ? ` · ${i.video.bitrateKbps} kb/s` : ''}`);
  if (i.audio) lines.push(`Audio: ${i.audio.codec}${i.audio.sampleRate ? ` · ${i.audio.sampleRate} Hz` : ''}${i.audio.channels ? ` · ${i.audio.channels}` : ''}${i.audio.bitrateKbps ? ` · ${i.audio.bitrateKbps} kb/s` : ''}`);
  if (i.subtitles) lines.push(`Subtitles: ${i.subtitles} track${i.subtitles === 1 ? '' : 's'}`);
  for (const [k, v] of Object.entries(i.metadata)) lines.push(`${k}: ${v}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- transcripts

export interface Segment {
  start: number;
  end: number;
  text: string;
}

function stamp(t: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`;
}

export function toSrt(segs: Segment[]): string {
  return segs.map((s, i) => `${i + 1}\n${stamp(s.start, ',')} --> ${stamp(s.end, ',')}\n${s.text.trim()}\n`).join('\n');
}

export function toWebVtt(segs: Segment[]): string {
  return `WEBVTT\n\n${segs.map((s) => `${stamp(s.start, '.')} --> ${stamp(s.end, '.')}\n${s.text.trim()}\n`).join('\n')}`;
}

export function toTimestamped(segs: Segment[]): string {
  return segs.map((s) => `[${stamp(s.start, '.').slice(0, 8)}] ${s.text.trim()}`).join('\n');
}

export function toPlain(segs: Segment[]): string {
  return segs.map((s) => s.text.trim()).filter(Boolean).join(' ').replace(/\s+([.,!?])/g, '$1');
}

/** Long transcripts become subtitles a viewer can read: at most ~42 characters per line and ~6 seconds per cue. */
export function splitForSubtitles(segs: Segment[], maxChars = 84, maxSec = 6): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    const words = s.text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const pieces: string[][] = [];
    let cur: string[] = [];
    for (const w of words) {
      if (cur.length && (cur.join(' ') + ' ' + w).length > maxChars) {
        pieces.push(cur);
        cur = [];
      }
      cur.push(w);
    }
    if (cur.length) pieces.push(cur);
    const dur = Math.max(0.5, s.end - s.start);
    const total = words.length;
    let t = s.start;
    for (const p of pieces) {
      const len = Math.min(maxSec, (dur * p.length) / total);
      out.push({ start: t, end: t + len, text: p.join(' ') });
      t += (dur * p.length) / total;
    }
  }
  return out;
}

// ---------------------------------------------------------------- faces

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
}

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return u > 0 ? inter / u : 0;
}

/** Keeps the best box of every group of overlapping ones. */
export function nonMaxSuppression(boxes: Box[], threshold = 0.3): Box[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const keep: Box[] = [];
  for (const b of sorted) if (keep.every((k) => iou(k, b) < threshold)) keep.push(b);
  return keep;
}

/**
 * The face detector's raw output: per anchor, two scores (background, face)
 * and a corner-form box in 0..1. Returns faces in picture pixels, padded a
 * little so blurring covers hairlines and chins.
 */
export function facesFromDetector(scores: Float32Array, boxes: Float32Array, width: number, height: number, minScore = 0.6, pad = 0.15): Box[] {
  const found: Box[] = [];
  const n = scores.length / 2;
  for (let i = 0; i < n; i++) {
    const s = scores[i * 2 + 1];
    if (s < minScore) continue;
    found.push({ x1: boxes[i * 4], y1: boxes[i * 4 + 1], x2: boxes[i * 4 + 2], y2: boxes[i * 4 + 3], score: s });
  }
  return nonMaxSuppression(found).map((b) => {
    const w = b.x2 - b.x1;
    const h = b.y2 - b.y1;
    return {
      x1: Math.max(0, Math.round((b.x1 - w * pad) * width)),
      y1: Math.max(0, Math.round((b.y1 - h * pad) * height)),
      x2: Math.min(width, Math.round((b.x2 + w * pad) * width)),
      y2: Math.min(height, Math.round((b.y2 + h * pad) * height)),
      score: b.score,
    };
  }).filter((b) => b.x2 - b.x1 >= 4 && b.y2 - b.y1 >= 4);
}

/** The detector wants 320×240 RGB as (value − 127) / 128, planar. */
export function detectorInput(rgb: Uint8Array | Buffer, w = 320, h = 240): Float32Array {
  const out = new Float32Array(3 * w * h);
  const plane = w * h;
  for (let i = 0; i < plane; i++) {
    out[i] = (rgb[i * 3] - 127) / 128;
    out[plane + i] = (rgb[i * 3 + 1] - 127) / 128;
    out[2 * plane + i] = (rgb[i * 3 + 2] - 127) / 128;
  }
  return out;
}

// ---------------------------------------------------------------- speech

/** The command each system uses to speak text into a file. */
export function ttsCommand(platform: string, textFile: string, outFile: string, voice?: string, rate?: number): { cmd: string; args: string[]; ext: string } | undefined {
  if (platform === 'darwin') {
    return { cmd: '/usr/bin/say', args: [...(voice ? ['-v', voice] : []), ...(rate ? ['-r', String(Math.round(175 * rate))] : []), '-f', textFile, '-o', outFile], ext: 'aiff' };
  }
  if (platform === 'win32') {
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      voice ? `try { $s.SelectVoice(${q(voice)}) } catch {}` : '',
      rate ? `$s.Rate = ${Math.max(-10, Math.min(10, Math.round((rate - 1) * 10)))}` : '',
      `$s.SetOutputToWaveFile(${q(outFile)})`,
      `$s.Speak([IO.File]::ReadAllText(${q(textFile)}, [Text.Encoding]::UTF8))`,
      '$s.Dispose()',
    ].filter(Boolean).join('; ');
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script], ext: 'wav' };
  }
  return { cmd: 'espeak-ng', args: [...(voice ? ['-v', voice] : []), ...(rate ? ['-s', String(Math.round(175 * rate))] : []), '-f', textFile, '-w', outFile], ext: 'wav' };
}
