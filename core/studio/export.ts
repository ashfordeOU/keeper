// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Exporting: presets for where the video is going, the plan for one export
// (size, frame rate, frames, how the picture is encoded) and the bundled
// ffmpeg's arguments that put the picture, the sound (cut and sped up to
// match the timeline, evened out and cleaned) and the chapters together.

import { outputSize, type Size } from './layout';
import { outputDuration } from './timeline';
import type { Aspect, AudioStyle, Clip } from './types';

export type ExportFormat = 'mp4' | 'hevc' | 'webm' | 'gif';
export type Quality = 'high' | 'balanced' | 'small';

export interface ExportSettings {
  format: ExportFormat;
  /** the shorter side: 480, 720, 1080, 1440 or 2160 */
  lines: number;
  fps: number;
  quality: Quality;
  /** write an .srt beside the video */
  srt: boolean;
  /** chapters inside the file (MP4, WebM) */
  chapters: boolean;
}

export interface ExportPreset { id: string; name: string; detail: string; settings: ExportSettings; aspect?: Aspect }

const s = (format: ExportFormat, lines: number, fps: number, quality: Quality = 'high'): ExportSettings => ({ format, lines, fps, quality, srt: false, chapters: true });

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'standard', name: 'Standard', detail: 'MP4 · 1080p · 60 fps — video sites, presentations', settings: s('mp4', 1080, 60) },
  { id: 'crisp', name: 'Crisp 4K', detail: 'MP4 · 2160p · 60 fps — the sharpest, for big screens', settings: s('mp4', 2160, 60) },
  { id: 'share', name: 'Quick share', detail: 'MP4 · 720p · 30 fps — chat, email, tickets', settings: s('mp4', 720, 30, 'small') },
  { id: 'vertical', name: 'Vertical', detail: 'MP4 · 1080×1920 · 30 fps — short video apps', settings: s('mp4', 1080, 30), aspect: '9:16' },
  { id: 'square', name: 'Square', detail: 'MP4 · 1080×1080 · 30 fps — feeds', settings: s('mp4', 1080, 30), aspect: '1:1' },
  { id: 'hevc', name: 'Small HEVC', detail: 'HEVC (H.265) · 1080p · 60 fps — half the size, newer players', settings: s('hevc', 1080, 60, 'balanced') },
  { id: 'web', name: 'Web', detail: 'WebM (VP9) · 1080p · 30 fps — for web pages', settings: s('webm', 1080, 30, 'balanced') },
  { id: 'gif', name: 'GIF', detail: 'GIF · 480p · 15 fps — docs, READMEs, anywhere', settings: s('gif', 480, 15, 'balanced') },
];

export const LINE_CHOICES = [480, 720, 1080, 1440, 2160];
export const FPS_CHOICES = [15, 24, 30, 60];

export function normalizeExport(raw: Partial<ExportSettings> | undefined): ExportSettings {
  const d = EXPORT_PRESETS[0].settings;
  const r = raw ?? {};
  const format = (['mp4', 'hevc', 'webm', 'gif'] as const).includes(r.format as ExportFormat) ? (r.format as ExportFormat) : d.format;
  let lines = LINE_CHOICES.includes(r.lines as number) ? (r.lines as number) : d.lines;
  let fps = FPS_CHOICES.includes(r.fps as number) ? (r.fps as number) : d.fps;
  if (format === 'gif') { lines = Math.min(lines, 720); fps = Math.min(fps, 24); }
  return { format, lines, fps, quality: (['high', 'balanced', 'small'] as const).includes(r.quality as Quality) ? (r.quality as Quality) : d.quality, srt: !!r.srt, chapters: r.chapters ?? true };
}

/** How the picture leaves the page: H.264 when the page can make it, otherwise VP9/VP8 for ffmpeg to turn into the final format. */
export type Intermediate = 'h264' | 'vp9' | 'vp8';

export interface ExportPlan {
  settings: ExportSettings;
  out: Size;
  fps: number;
  /** the finished video's length (ms) */
  duration: number;
  frames: number;
  intermediate: Intermediate;
  /** bits per second for the page's encoder */
  bitrate: number;
  /** the intermediate is the final picture (no second encode) */
  copyVideo: boolean;
  /** WebCodecs codec string */
  codec: string;
}

const BPP: Record<Quality, number> = { high: 0.11, balanced: 0.075, small: 0.05 };

/** H.264 level for a frame size and rate (so the encoder accepts 4K at 60). */
export function avcCodec(out: Size, fps: number): string {
  const mbps = (Math.ceil(out.width / 16) * Math.ceil(out.height / 16)) * fps;
  const level = mbps <= 245760 ? '28' : mbps <= 522240 ? '32' : mbps <= 983040 ? '33' : mbps <= 2073600 ? '34' : '3C';
  return `avc1.6400${level}`;
}

export function exportPlan(src: Size, aspect: Aspect, clips: Clip[], raw: Partial<ExportSettings>, can: { h264: boolean; vp9: boolean }): ExportPlan {
  const settings = normalizeExport(raw);
  const out = outputSize(aspect, src, settings.lines);
  const duration = outputDuration(clips);
  const fps = settings.fps;
  const frames = Math.max(1, Math.ceil((duration * fps) / 1000));
  const final = settings.format === 'mp4' && can.h264 ? 'h264' : settings.format === 'webm' && can.vp9 ? 'vp9' : null;
  const intermediate: Intermediate = final ?? (can.h264 ? 'h264' : can.vp9 ? 'vp9' : 'vp8');
  const copyVideo = final !== null;
  // a second encode follows: keep the first close to lossless
  const bpp = copyVideo ? BPP[settings.quality] : 0.22;
  const bitrate = Math.round(Math.min(160e6, Math.max(1.5e6, out.width * out.height * fps * bpp)));
  const codec = intermediate === 'h264' ? avcCodec(out, fps) : intermediate === 'vp9' ? 'vp09.00.41.08' : 'vp8';
  return { settings, out, fps, duration, frames, intermediate, bitrate, copyVideo, codec };
}

/** Time of frame n of the finished video (ms). */
export const frameTime = (n: number, fps: number) => (n * 1000) / fps;

export interface AudioInput { path: string; offset: number; volume: number; denoise: boolean }

const sec = (ms: number) => (ms / 1000).toFixed(3);

/** atempo takes 0.5–100 per filter; chain them for slower. */
export function atempo(speed: number): string {
  if (Math.abs(speed - 1) < 1e-3) return '';
  const parts: string[] = [];
  let v = speed;
  while (v < 0.5) { parts.push('atempo=0.5'); v /= 0.5; }
  parts.push(`atempo=${+v.toFixed(4)}`);
  return parts.join(',');
}

/**
 * The audio half of the filter graph: each track lined up with the recording
 * (its offset), cleaned, cut into the kept clips, sped up to match, joined,
 * mixed with the others and evened out. `first` is the first audio input's
 * index. Returns the graph and the label to map, or null with no sound.
 */
export function audioGraph(tracks: AudioInput[], clips: Clip[], recordingMs: number, style: Pick<AudioStyle, 'normalize'>, first: number): { graph: string; label: string } | null {
  if (!tracks.length || !clips.length) return null;
  const parts: string[] = [];
  const outs: string[] = [];
  tracks.forEach((t, i) => {
    const inp = `[${first + i}:a]`;
    const pre: string[] = ['aresample=48000', 'aformat=channel_layouts=stereo'];
    if (t.offset > 0) pre.push(`adelay=${Math.round(t.offset)}:all=1`);
    else if (t.offset < 0) pre.push(`atrim=start=${sec(-t.offset)}`, 'asetpts=PTS-STARTPTS');
    pre.push(`apad=whole_dur=${sec(recordingMs)}`);
    if (t.denoise) pre.push('highpass=f=80', 'afftdn=nf=-25');
    if (Math.abs(t.volume - 1) > 1e-3) pre.push(`volume=${t.volume.toFixed(3)}`);
    const n = clips.length;
    parts.push(`${inp}${pre.join(',')}${n > 1 ? `,asplit=${n}${clips.map((_, j) => `[t${i}s${j}]`).join('')}` : `[t${i}s0]`}`);
    clips.forEach((c, j) => {
      const tempo = atempo(c.speed);
      parts.push(`[t${i}s${j}]atrim=start=${sec(c.start)}:end=${sec(c.end)},asetpts=PTS-STARTPTS${tempo ? ',' + tempo : ''}[t${i}c${j}]`);
    });
    parts.push(`${clips.map((_, j) => `[t${i}c${j}]`).join('')}${n > 1 ? `concat=n=${n}:v=0:a=1` : 'anull'}[t${i}]`);
    outs.push(`[t${i}]`);
  });
  const mixed = outs.length > 1 ? `${outs.join('')}amix=inputs=${outs.length}:normalize=0:duration=longest` : `${outs[0]}anull`;
  const tail = style.normalize ? ',loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000' : '';
  parts.push(`${mixed}${tail}[aout]`);
  return { graph: parts.join(';'), label: '[aout]' };
}

export interface FinishInputs {
  /** the page's encoded picture */
  video: string;
  audio: AudioInput[];
  /** an ffmetadata file with chapters */
  meta?: string;
}

/** ffmpeg's arguments for the final file. `hw` names a hardware HEVC encoder when there is one (a Mac's). */
export function finishArgs(plan: ExportPlan, inp: FinishInputs, clips: Clip[], recordingMs: number, audio: Pick<AudioStyle, 'normalize'>, out: string, hw?: { hevc?: string }): string[] {
  const { settings: st, fps } = plan;
  const args: string[] = [];
  if (plan.intermediate === 'h264') args.push('-framerate', String(fps), '-f', 'h264', '-i', inp.video);
  else args.push('-i', inp.video);
  const gif = st.format === 'gif';
  const tracks = gif ? [] : inp.audio;
  for (const a of tracks) args.push('-i', a.path);
  const metaIndex = 1 + tracks.length;
  const meta = inp.meta && st.chapters && !gif;
  if (meta) args.push('-f', 'ffmetadata', '-i', inp.meta!);
  const ag = audioGraph(tracks, clips, recordingMs, audio, 1);
  const secs = sec(plan.duration);
  if (gif) {
    const colors = st.quality === 'small' ? 64 : st.quality === 'balanced' ? 128 : 256;
    args.push('-filter_complex', `[0:v]fps=${fps},split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle[v]`, '-map', '[v]', '-loop', '0');
  } else {
    if (ag) args.push('-filter_complex', ag.graph, '-map', '0:v:0', '-map', ag.label);
    else args.push('-map', '0:v:0');
    if (meta) args.push('-map_metadata', String(metaIndex), '-map_chapters', String(metaIndex));
    const crf = { high: 18, balanced: 23, small: 28 }[st.quality];
    if (st.format === 'mp4') {
      if (plan.copyVideo) args.push('-c:v', 'copy');
      else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p');
      args.push('-movflags', '+faststart');
      if (ag) args.push('-c:a', 'aac', '-b:a', '192k');
    } else if (st.format === 'hevc') {
      if (hw?.hevc) args.push('-c:v', hw.hevc, '-q:v', String({ high: 70, balanced: 58, small: 45 }[st.quality]));
      else args.push('-c:v', 'libx265', '-preset', 'fast', '-crf', String(crf + 4), '-x265-params', 'log-level=error');
      args.push('-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-movflags', '+faststart');
      if (ag) args.push('-c:a', 'aac', '-b:a', '192k');
    } else {
      if (plan.copyVideo) args.push('-c:v', 'copy');
      else args.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf + 12), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4');
      if (ag) args.push('-c:a', 'libopus', '-b:a', '128k');
    }
  }
  args.push('-t', secs, out);
  return args;
}

export function extensionFor(f: ExportFormat): string {
  return f === 'gif' ? 'gif' : f === 'webm' ? 'webm' : 'mp4';
}
