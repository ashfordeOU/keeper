// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Studio's recorders, each writing straight to disk as it goes:
//   - the screen: ScreenCaptureKit through keeper-helper on a Mac (no pointer,
//     60 fps, Retina pixels); the bundled ffmpeg on Windows (gdigrab) and Linux
//     X11 (x11grab), both told to leave the pointer out; otherwise the
//     browser's own capture (the pointer is then part of the picture)
//   - the microphone, the camera and (Windows) the computer's sound, each its
//     own file, from a hidden page with MediaRecorder
// Every recorder reports the wall-clock time of its first frame or sample, so
// the tracks and the event log line up.

import { BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, promises as fsp, type WriteStream } from 'node:fs';
import path from 'node:path';
import type { CaptureHow } from '../../../core/studio/types';
import type { Region } from '../../../core/studio/record';
import { ffmpegPath } from '../recorder';

export interface ScreenTarget {
  /** the recorded part of the screen in points, and pixels per point */
  region: Region;
  /** Electron's display id (a CGDirectDisplayID on a Mac) */
  displayId: number;
  /** a desktopCapturer source id (window or screen) */
  sourceId?: string;
  /** a native window id when one window is recorded */
  windowId?: number;
  /** the area inside the display, in points (area recordings) */
  rect?: { x: number; y: number; w: number; h: number };
}

export interface ScreenResult { file: string; ok: boolean; error?: string; hasAudio?: boolean }

export interface ScreenRecorder {
  how: CaptureHow;
  cursorInVideo: boolean;
  /** resolves with the wall-clock time of the first frame */
  first: Promise<number>;
  /** the recorded part, once known exactly (a Mac window's frame) */
  region: Promise<Region>;
  stop(): Promise<ScreenResult>;
  /** it ended by itself (an error, the disk filled up) */
  onEnd(fn: (r: ScreenResult) => void): void;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

// ------------------------------------------------------------------ macOS: ScreenCaptureKit

export async function macStudioSupport(): Promise<{ available: boolean; allowed: boolean } | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const { macHelperCall } = await import('../platform/mac');
    return await macHelperCall<{ available: boolean; allowed: boolean }>('studio.support', {}, 8000);
  } catch { return null; }
}

export async function macScreen(t: ScreenTarget, file: string, o: { fps: number; systemAudio: boolean }): Promise<ScreenRecorder> {
  const { macHelperCall, macHelperStream } = await import('../platform/mac');
  const token = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let gotFirst!: (n: number) => void, gotRegion!: (r: Region) => void, failed!: (e: Error) => void;
  const first = new Promise<number>((res, rej) => { gotFirst = res; failed = rej; });
  const region = new Promise<Region>((res) => { gotRegion = res; });
  const ends: ((r: ScreenResult) => void)[] = [];
  let stopping = false;
  const ac = new AbortController();
  const params = { path: file, token, fps: o.fps, displayId: t.displayId, windowId: t.windowId, rect: t.rect, systemAudio: o.systemAudio, showsCursor: false, codec: 'h264' };
  const run = macHelperStream('studio.record', params, (line) => {
    try {
      const m = JSON.parse(line) as { t: string; wall?: number; scale?: number; x?: number; y?: number; w?: number; h?: number };
      if (m.t === 'first' && typeof m.wall === 'number') gotFirst(m.wall);
      if (m.t === 'ready') gotRegion(m.w ? { x: m.x ?? t.region.x, y: m.y ?? t.region.y, w: m.w, h: m.h ?? t.region.h, scale: m.scale ?? t.region.scale } : t.region);
    } catch { /* not ours */ }
  }, ac.signal) as Promise<{ path?: string; frames?: number; audio?: boolean; error?: string }>;
  const settled = run.then((r) => ({ file, ok: !!r?.frames && !r.error, error: r?.error, hasAudio: !!r?.audio }), (e: unknown) => ({ file, ok: false, error: e instanceof Error ? e.message : String(e) }));
  void settled.then((r) => { failed(new Error(r.error ?? 'The recording stopped before it began')); if (!stopping) ends.forEach((f) => f(r)); });
  return {
    how: 'screencapturekit', cursorInVideo: false, first, region,
    stop: async () => {
      stopping = true;
      await macHelperCall('studio.stop', { token }, 10_000).catch(() => ac.abort());
      const timer = setTimeout(() => ac.abort(), 60_000);
      const r = await settled;
      clearTimeout(timer);
      return r;
    },
    onEnd: (fn) => ends.push(fn),
  };
}

// ------------------------------------------------------------------ Windows and Linux X11: ffmpeg

/** Is the X11 grabber usable (an X display that is not a Wayland session)? */
export function x11Usable(): boolean {
  return process.platform === 'linux' && !!process.env.DISPLAY && process.env.XDG_SESSION_TYPE !== 'wayland' && !process.env.WAYLAND_DISPLAY;
}

/** The `start: <seconds>` ffmpeg prints for a live input: the wall-clock time of its first frame. */
export function parseStart(stderr: string): number | null {
  const m = stderr.match(/Input #0, (?:x11grab|gdigrab)[\s\S]*?start: ([\d.]+)/);
  if (!m) return null;
  const s = +m[1];
  return s > 1e9 ? s * 1000 : null;
}

export function ffmpegGrabArgs(platform: NodeJS.Platform, t: ScreenTarget, fps: number, file: string): string[] {
  const s = t.region.scale;
  // the grabbers work in device pixels
  const px = platform === 'win32'
    ? screen.dipToScreenRect(null, { x: t.region.x, y: t.region.y, width: t.region.w, height: t.region.h })
    : { x: Math.round(t.region.x * s), y: Math.round(t.region.y * s), width: Math.round(t.region.w * s), height: Math.round(t.region.h * s) };
  const w = even(px.width), h = even(px.height);
  const input = platform === 'win32'
    ? ['-f', 'gdigrab', '-draw_mouse', '0', '-framerate', String(fps), '-offset_x', String(px.x), '-offset_y', String(px.y), '-video_size', `${w}x${h}`, '-i', 'desktop']
    : ['-f', 'x11grab', '-draw_mouse', '0', '-framerate', String(fps), '-video_size', `${w}x${h}`, '-i', `${process.env.DISPLAY ?? ':0'}+${px.x},${px.y}`];
  return ['-hide_banner', '-loglevel', 'info', '-nostats', '-thread_queue_size', '1024', ...input, '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '18', '-g', String(fps * 2), '-pix_fmt', 'yuv420p', '-y', file];
}

export function ffmpegScreen(t: ScreenTarget, file: string, o: { fps: number }): ScreenRecorder {
  const bin = ffmpegPath();
  if (!bin) throw new Error('The bundled ffmpeg is missing, so the screen cannot be recorded this way.');
  const args = ffmpegGrabArgs(process.platform, t, o.fps, file);
  const spawnedAt = Date.now();
  const child: ChildProcess = spawn(bin, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  let gotFirst!: (n: number) => void;
  const first = new Promise<number>((res) => { gotFirst = res; });
  let known = false;
  child.stderr?.on('data', (d: Buffer) => {
    err = (err + d.toString('utf8')).slice(-30000);
    if (!known) { const s = parseStart(err); if (s) { known = true; gotFirst(s); } }
  });
  // if ffmpeg never says, the first frame came about when it started
  setTimeout(() => { if (!known) { known = true; gotFirst(spawnedAt + 150); } }, 4000).unref?.();
  const ends: ((r: ScreenResult) => void)[] = [];
  let stopping = false;
  const exited = new Promise<ScreenResult>((resolve) => {
    child.on('error', (e) => resolve({ file, ok: false, error: e.message }));
    child.on('close', (code) => resolve({ file, ok: code === 0 || stopping, error: code === 0 || stopping ? undefined : err.trim().split('\n').slice(-2).join(' ') }));
  });
  void exited.then((r) => { if (!stopping) ends.forEach((f) => f(r)); });
  return {
    how: 'ffmpeg', cursorInVideo: false, first, region: Promise.resolve(t.region),
    stop: async () => {
      stopping = true;
      // "q" lets ffmpeg finish the file properly
      try { child.stdin?.write('q'); child.stdin?.end(); } catch { /* gone */ }
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
      const r = await exited;
      clearTimeout(timer);
      return r;
    },
    onEnd: (fn) => ends.push(fn),
  };
}

// ------------------------------------------------------------------ the hidden recording page

/** The page that records with MediaRecorder: the microphone, the camera, the computer's sound and (as a fallback) the screen. */
const SIDE_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
const live = {};
const send = (track, what, detail) => keeperStudioRec.event(track, what, detail);
async function open(t) {
  if (t.kind === 'mic') return navigator.mediaDevices.getUserMedia({ audio: { deviceId: t.deviceId ? { exact: t.deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  if (t.kind === 'webcam') return navigator.mediaDevices.getUserMedia({ video: { deviceId: t.deviceId ? { exact: t.deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
  if (t.kind === 'system') {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: { mandatory: { chromeMediaSource: 'desktop', maxWidth: 2, maxHeight: 2, maxFrameRate: 1 } } });
    s.getVideoTracks().forEach((v) => { v.stop(); s.removeTrack(v); });
    return s;
  }
  return navigator.mediaDevices.getUserMedia({
    audio: t.systemAudio ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: t.sourceId, maxFrameRate: t.fps || 30, maxWidth: 7680, maxHeight: 4320 } },
  });
}
function types(kind) {
  if (kind === 'mic' || kind === 'system') return ['audio/webm;codecs=opus', 'audio/webm'];
  return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
}
keeperStudioRec.onCommand(async (cmd) => {
  if (cmd.op === 'start') {
    for (const t of cmd.tracks) {
      try {
        const stream = await open(t);
        const mime = types(t.kind).find((m) => MediaRecorder.isTypeSupported(m));
        const bits = t.kind === 'screen' ? { videoBitsPerSecond: 12000000 } : t.kind === 'webcam' ? { videoBitsPerSecond: 3000000 } : { audioBitsPerSecond: 160000 };
        const rec = new MediaRecorder(stream, { mimeType: mime, ...bits });
        live[t.name] = { rec, stream };
        rec.ondataavailable = async (e) => { if (e.data && e.data.size) keeperStudioRec.chunk(t.name, await e.data.arrayBuffer()); };
        rec.onstart = () => {
          const v = stream.getVideoTracks()[0];
          const st = v ? v.getSettings() : {};
          send(t.name, 'started', { wall: Date.now(), width: st.width, height: st.height, audio: stream.getAudioTracks().length > 0 });
        };
        rec.onerror = (e) => send(t.name, 'error', String(e.error && e.error.message || 'recording failed'));
        rec.onstop = () => { stream.getTracks().forEach((x) => x.stop()); setTimeout(() => send(t.name, 'stopped'), 200); };
        rec.start(1000);
      } catch (e) { send(t.name, 'error', String(e && e.message || e)); }
    }
  } else if (cmd.op === 'stop') {
    const names = Object.keys(live);
    if (!names.length) send('*', 'stopped');
    for (const n of names) { const r = live[n].rec; if (r.state !== 'inactive') r.stop(); else send(n, 'stopped'); }
  }
});
send('*', 'ready');
</script></body></html>`;

export type SideKind = 'mic' | 'webcam' | 'system' | 'screen';
export interface SideTrack { name: string; kind: SideKind; file: string; deviceId?: string; sourceId?: string; systemAudio?: boolean; fps?: number }
export interface SideStarted { wall: number; width?: number; height?: number; audio?: boolean }

/** Runs the hidden page and writes each track's chunks to its file. */
export class SideRecorder {
  private win: BrowserWindow | null = null;
  private files = new Map<string, WriteStream>();
  private started = new Map<string, (s: SideStarted | null) => void>();
  private stoppedWaits = new Map<string, () => void>();
  readonly errors = new Map<string, string>();
  readonly info = new Map<string, SideStarted>();
  private listeners: (() => void)[] = [];

  constructor(private preload: string, private userData: string) {}

  /** Starts every track; resolves with each one's start (null for a track that could not start). */
  async start(tracks: SideTrack[]): Promise<Map<string, SideStarted | null>> {
    const out = new Map<string, SideStarted | null>();
    if (!tracks.length) return out;
    this.win = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    const wc = this.win.webContents;
    const on = (ch: string, fn: (e: Electron.IpcMainEvent, ...a: never[]) => void) => {
      const h = (e: Electron.IpcMainEvent, ...a: unknown[]) => { if (e.sender === wc) fn(e, ...(a as never[])); };
      ipcMain.on(ch, h);
      this.listeners.push(() => ipcMain.removeListener(ch, h));
    };
    for (const t of tracks) this.files.set(t.name, createWriteStream(t.file));
    on('studio.rec.chunk', (_e, track: string, buf: ArrayBuffer) => { this.files.get(track)?.write(Buffer.from(buf)); });
    on('studio.rec.event', (_e, track: string, what: string, detail: unknown) => {
      if (what === 'started') { this.info.set(track, detail as SideStarted); this.started.get(track)?.(detail as SideStarted); }
      else if (what === 'error') { this.errors.set(track, String(detail)); this.started.get(track)?.(null); this.stoppedWaits.get(track)?.(); }
      else if (what === 'stopped') { if (track === '*') this.stoppedWaits.forEach((f) => f()); else this.stoppedWaits.get(track)?.(); }
    });
    const waits = tracks.map((t) => new Promise<void>((resolve) => {
      const timer = setTimeout(() => { this.errors.set(t.name, 'did not start in time'); out.set(t.name, null); resolve(); }, 20_000);
      this.started.set(t.name, (s) => { clearTimeout(timer); out.set(t.name, s); resolve(); });
    }));
    const page = path.join(this.userData, 'studio-recorder.html');
    await fsp.writeFile(page, SIDE_PAGE);
    await this.win.loadFile(page);
    wc.send('studio.rec.cmd', { op: 'start', tracks: tracks.map(({ file: _f, ...t }) => t) });
    await Promise.all(waits);
    return out;
  }

  /** Stops every track and closes its file. */
  async stop(): Promise<void> {
    if (!this.win) return;
    const names = [...this.files.keys()];
    const done = names.map((n) => new Promise<void>((resolve) => { this.stoppedWaits.set(n, resolve); setTimeout(resolve, 8000); }));
    if (!this.win.isDestroyed()) this.win.webContents.send('studio.rec.cmd', { op: 'stop' });
    await Promise.all(done);
    await Promise.all([...this.files.values()].map((f) => new Promise<void>((r) => f.end(() => r()))));
    this.close();
  }

  close() {
    this.listeners.forEach((f) => f());
    this.listeners = [];
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

/** The screen through the hidden page (the pointer is drawn into the picture by the system). */
export function browserScreen(side: SideRecorder, startInfo: Promise<SideStarted | null>, t: ScreenTarget, file: string): ScreenRecorder {
  const ends: ((r: ScreenResult) => void)[] = [];
  return {
    how: 'browser', cursorInVideo: true,
    first: startInfo.then((s) => { if (!s) throw new Error(side.errors.get('screen') ?? 'The screen could not be recorded'); return s.wall; }),
    region: Promise.resolve(t.region),
    stop: async () => ({ file, ok: !side.errors.has('screen'), error: side.errors.get('screen'), hasAudio: side.info.get('screen')?.audio }),
    onEnd: (fn) => ends.push(fn),
  };
}

/** A desktopCapturer source for a display (the browser fallback). */
export async function screenSource(displayId: number): Promise<string | undefined> {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
  return (sources.find((s) => s.display_id === String(displayId)) ?? sources[0])?.id;
}
