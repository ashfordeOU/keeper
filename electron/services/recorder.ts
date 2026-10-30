// SPDX-License-Identifier: AGPL-3.0-or-later
// Screen recording: the whole screen, one window or an area, with optional
// microphone and system sound. A hidden page records with the browser's
// MediaRecorder and streams chunks here; when it stops, ffmpeg (bundled)
// crops an area, fixes the length metadata and converts to MP4.

import { app, BrowserWindow, desktopCapturer, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, promises as fsp, type WriteStream } from 'node:fs';
import path from 'node:path';
import { recordingName } from '../../core/capture';
import { uniqueName } from '../../core/rules';
import { displayUnderCursor, getOptions, pickArea, pickWindow, remember, type Rect } from './capture';

export type RecordMode = 'full' | 'window' | 'area';

export interface RecordState {
  recording: boolean;
  since?: number;
  mode?: RecordMode;
  /** the finished file, once saved */
  path?: string;
  error?: string;
}

const RECORDER_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
let rec, streams = [];
keeperRecorder.onStart(async (cfg) => {
  try {
    const video = await navigator.mediaDevices.getUserMedia({
      audio: cfg.systemAudio ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: cfg.sourceId, maxFrameRate: cfg.fps || 30 } },
    });
    streams.push(video);
    const tracks = [...video.getVideoTracks()];
    const audio = [...video.getAudioTracks()];
    if (cfg.mic) {
      try { const m = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); streams.push(m); audio.push(...m.getAudioTracks()); } catch (e) {}
    }
    if (audio.length > 1) {
      const ctx = new AudioContext(); const dest = ctx.createMediaStreamDestination();
      for (const t of audio) ctx.createMediaStreamSource(new MediaStream([t])).connect(dest);
      tracks.push(...dest.stream.getAudioTracks());
    } else tracks.push(...audio);
    const stream = new MediaStream(tracks);
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    rec = new MediaRecorder(stream, { mimeType: types.find((t) => MediaRecorder.isTypeSupported(t)), videoBitsPerSecond: 8000000 });
    rec.ondataavailable = async (e) => { if (e.data && e.data.size) keeperRecorder.chunk(await e.data.arrayBuffer()); };
    rec.onstop = () => { streams.forEach((s) => s.getTracks().forEach((t) => t.stop())); setTimeout(() => keeperRecorder.done(), 300); };
    rec.start(1000);
    keeperRecorder.started();
  } catch (e) { keeperRecorder.error(String(e && e.message || e)); }
});
keeperRecorder.onStop(() => { if (rec && rec.state !== 'inactive') rec.stop(); else keeperRecorder.done(); });
</script></body></html>`;

/** The bundled ffmpeg binary, or one on the PATH. */
export function ffmpegPath(): string | null {
  try {
    // Kept outside the bundle so its own path logic still works; packaged builds unpack it from the archive.
    const p = (require('ffmpeg-static') as string | null)?.replace('app.asar', 'app.asar.unpacked');
    if (p && existsSync(p)) return p;
  } catch {
    /* not installed */
  }
  return null;
}

export function runFfmpeg(args: string[], timeout = 30 * 60_000): Promise<boolean> {
  const bin = ffmpegPath() ?? 'ffmpeg';
  return new Promise((resolve) => {
    execFile(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err) => resolve(!err));
  });
}

export class Recorder {
  state: RecordState = { recording: false };
  private win: BrowserWindow | null = null;
  private out: WriteStream | null = null;
  private tmp = '';
  private area: { rect: Rect; scale: number } | null = null;
  private finished: ((p: string | null) => void) | null = null;

  constructor(private preload: string, private onChange: (s: RecordState) => void) {
    ipcMain.on('recorder.chunk', (e, buf: ArrayBuffer) => {
      if (e.sender === this.win?.webContents && this.out) this.out.write(Buffer.from(buf));
    });
    ipcMain.on('recorder.done', (e) => {
      if (e.sender === this.win?.webContents) void this.finish();
    });
    ipcMain.on('recorder.error', (e, msg: string) => {
      if (e.sender !== this.win?.webContents) return;
      this.state = { recording: false, error: msg };
      this.cleanup();
      this.onChange(this.state);
      this.finished?.(null);
    });
  }

  private async folder(): Promise<string> {
    const o = await getOptions();
    const dir = o.recordingFolder || app.getPath('videos');
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  }

  /** Starts recording. Resolves once the recording is actually running (or was cancelled). */
  async start(mode: RecordMode, opts: { mic?: boolean; systemAudio?: boolean; countdown?: number; onCountdown?: (n: number) => void } = {}): Promise<RecordState> {
    if (this.state.recording) return this.state;
    const o = await getOptions();
    let sourceId: string | undefined;
    this.area = null;
    if (mode === 'window') {
      const w = await pickWindow(this.preload);
      if (!w) return this.state;
      sourceId = w.id;
    } else {
      const display = displayUnderCursor();
      if (mode === 'area') {
        const picked = await pickArea(this.preload, 'Drag over the area to record');
        if (!picked) return this.state;
        this.area = { rect: picked.rect, scale: picked.scale };
      }
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
      sourceId = (sources.find((s) => s.display_id === String(display.id)) ?? sources[0])?.id;
    }
    if (!sourceId) throw new Error('No screen to record was found.');

    for (let n = opts.countdown ?? 3; n > 0; n--) {
      opts.onCountdown?.(n);
      await new Promise((r) => setTimeout(r, 1000));
    }

    const dir = await this.folder();
    this.tmp = path.join(dir, `.keeper-recording-${Date.now()}.webm`);
    this.out = createWriteStream(this.tmp);
    this.win = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    const page = path.join(app.getPath('userData'), 'recorder.html');
    await fsp.writeFile(page, RECORDER_PAGE);
    await this.win.loadFile(page);
    const started = new Promise<boolean>((resolve) => {
      const ok = (e: Electron.IpcMainEvent) => { if (e.sender === this.win?.webContents) { cleanup(); resolve(true); } };
      const bad = (e: Electron.IpcMainEvent) => { if (e.sender === this.win?.webContents) { cleanup(); resolve(false); } };
      const cleanup = () => { ipcMain.removeListener('recorder.started', ok); ipcMain.removeListener('recorder.error', bad); };
      ipcMain.on('recorder.started', ok);
      ipcMain.on('recorder.error', bad);
    });
    this.win.webContents.send('recorder.start', {
      sourceId,
      mic: opts.mic ?? o.recordMic,
      // System sound can be captured on Windows and Linux; macOS does not allow it without a driver.
      systemAudio: (opts.systemAudio ?? o.recordSystemAudio) && process.platform !== 'darwin',
      fps: 30,
    });
    if (!(await started)) return this.state;
    this.state = { recording: true, since: Date.now(), mode };
    this.onChange(this.state);
    return this.state;
  }

  /** Stops and saves. Resolves with the saved file. */
  stop(): Promise<string | null> {
    if (!this.state.recording || !this.win) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.finished = resolve;
      this.win!.webContents.send('recorder.stop');
    });
  }

  private async finish() {
    const tmp = this.tmp;
    await new Promise<void>((r) => (this.out ? this.out.end(() => r()) : r()));
    this.out = null;
    const mode = this.state.mode;
    this.cleanup();
    const o = await getOptions();
    const dir = path.dirname(tmp);
    const wantMp4 = o.recordMp4 && (ffmpegPath() !== null);
    const final = uniqueName(path.join(dir, recordingName(new Date(), wantMp4 ? 'mp4' : 'webm')), existsSync);
    let ok = false;
    const crop = this.area ? `crop=${Math.round(this.area.rect.w * this.area.scale / 2) * 2}:${Math.round(this.area.rect.h * this.area.scale / 2) * 2}:${Math.round(this.area.rect.x * this.area.scale)}:${Math.round(this.area.rect.y * this.area.scale)}` : '';
    if (wantMp4) {
      ok = await runFfmpeg(['-i', tmp, ...(crop ? ['-vf', crop] : []), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '160k', final]);
    } else if (ffmpegPath()) {
      // Re-mux so players know the length (MediaRecorder leaves it out), cropping if asked.
      ok = await runFfmpeg(['-i', tmp, ...(crop ? ['-vf', crop, '-c:v', 'libvpx-vp9', '-b:v', '6M'] : ['-c', 'copy']), final]);
    }
    if (!ok) await fsp.rename(tmp, final.replace(/\.mp4$/, '.webm'));
    else await fsp.rm(tmp, { force: true });
    const saved = ok ? final : final.replace(/\.mp4$/, '.webm');
    this.state = { recording: false, path: saved, mode };
    await remember({ kind: 'recording', value: path.basename(saved), path: saved });
    this.onChange(this.state);
    this.finished?.(saved);
    this.finished = null;
  }

  private cleanup() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
