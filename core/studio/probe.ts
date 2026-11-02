// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reading what the bundled ffmpeg prints: a file's length, picture and sound
// (`ffmpeg -i`), and when a live screen grab took its first frame.

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

/** The `start: <seconds>` ffmpeg prints for a live input: the wall-clock time of its first frame. */
export function parseStart(stderr: string): number | null {
  const m = stderr.match(/Input #0, (?:x11grab|gdigrab)[\s\S]*?start: ([\d.]+)/);
  if (!m) return null;
  const s = +m[1];
  return s > 1e9 ? s * 1000 : null;
}

