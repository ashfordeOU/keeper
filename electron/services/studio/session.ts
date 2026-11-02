// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One Studio recording from start to saved project: choose what to record,
// count down, start the screen, the side tracks and the event log together,
// pause and resume (paused parts are cut from the timeline), stop, and turn
// the raw parts into a project folder with automatic zooms and chapters.

import { app, screen } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { run } from '../../../core/platform';
import type { StudioOptions, StudioRecordState } from '../../../core/studio/api';
import { smoothPath, trackAt } from '../../../core/studio/cursor';
import { chaptersFrom } from '../../../core/studio/overlays';
import { clipsWithoutPauses, EventRecorder, type Region } from '../../../core/studio/record';
import { defaultStyle, newId, STUDIO_VERSION, type CaptureHow, type ProjectMeta, type StudioProject } from '../../../core/studio/types';
import { autoZooms } from '../../../core/studio/zoom';
import { displayUnderCursor, pickArea, pickWindow } from '../capture';
import { onFrontWindow, holdFrontWatch } from '../fg-watch';
import { listen, type EventSource } from '../stage/events';
import { browserScreen, ffmpegScreen, macScreen, macStudioSupport, screenSource, SideRecorder, x11Usable, type ScreenRecorder, type ScreenTarget, type SideTrack } from './capture';
import { measuredDuration, probe, remux, thumbnail } from './media';
import { newProjectDir, remember, writeJson } from './store';
import { ffmpegPath } from '../recorder';

export interface SessionCtx {
  /** the capture preload (pickers and the hidden recording page) */
  preload: string;
  changed(s: StudioRecordState): void;
  alert(title: string, detail?: string): void;
  /** Stage's clean screen on or off */
  stage(on: boolean): Promise<void>;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const recordingTitle = (d: Date) => `Recording ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;

/** Where a window is, in points (Linux: xwininfo; Windows: the window's rectangle). */
async function windowBounds(sourceId: string): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const id = Number(sourceId.split(':')[1]);
  if (!id) return null;
  if (process.platform === 'linux') {
    const r = await run('xwininfo', ['-id', String(id)], 4000).catch(() => null);
    const n = (k: string) => Number(r?.stdout.match(new RegExp(`${k}:\\s+(-?\\d+)`))?.[1] ?? NaN);
    const b = { x: n('Absolute upper-left X'), y: n('Absolute upper-left Y'), w: n('Width'), h: n('Height') };
    if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) return null;
    const s = screen.getPrimaryDisplay().scaleFactor || 1;
    return { x: b.x / s, y: b.y / s, w: b.w / s, h: b.h / s };
  }
  if (process.platform === 'win32') {
    const ps = `Add-Type -Name W -Namespace K -MemberDefinition '[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, int[] r);'; $r = New-Object int[] 4; [K.W]::GetWindowRect([System.IntPtr]${id}, $r) | Out-Null; "$($r[0]) $($r[1]) $($r[2]) $($r[3])"`;
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 8000).catch(() => null);
    const m = r?.stdout.trim().match(/^(-?\d+) (-?\d+) (-?\d+) (-?\d+)$/);
    if (!m) return null;
    const d = screen.screenToDipRect(null, { x: +m[1], y: +m[2], width: +m[3] - +m[1], height: +m[4] - +m[2] });
    return { x: d.x, y: d.y, w: d.width, h: d.height };
  }
  return null;
}

/** How the screen is recorded on this computer. */
export async function screenHow(): Promise<{ how: CaptureHow; note?: string }> {
  if (process.platform === 'darwin') {
    const s = await macStudioSupport();
    if (s?.available) return { how: 'screencapturekit', note: s.allowed ? undefined : 'macOS will ask to allow screen recording the first time.' };
    return { how: 'browser', note: 'ScreenCaptureKit is not available (macOS 13 or later and Keeper’s helper are needed), so the system pointer is part of the picture.' };
  }
  if (!ffmpegPath()) return { how: 'browser', note: 'The bundled ffmpeg is missing, so the system pointer is part of the picture.' };
  if (process.platform === 'win32') return { how: 'ffmpeg' };
  if (x11Usable()) return { how: 'ffmpeg' };
  return { how: 'browser', note: 'On Wayland, apps cannot leave the pointer out or see clicks and keys: the pointer is part of the picture, and zooms follow only what you add by hand. An X11 session records the full way.' };
}

export class StudioSession {
  state: StudioRecordState = { phase: 'idle' };
  private screenRec: ScreenRecorder | null = null;
  private side: SideRecorder | null = null;
  private events: EventRecorder | null = null;
  private input: EventSource | null = null;
  private poll: NodeJS.Timeout | null = null;
  private tick: NodeJS.Timeout | null = null;
  private offFront: (() => void) | null = null;
  private releaseFront: (() => void) | null = null;
  private dir = '';
  private startedAt = 0;
  private firstWall = 0;
  private sideStarts = new Map<string, number>();
  private sideFiles: SideTrack[] = [];
  private screenFile = '';
  private region: Region | null = null;
  private opts: StudioOptions | null = null;
  private stageOn = false;
  private cancelCountdown = false;
  private notes: string[] = [];

  constructor(private ctx: SessionCtx) {}

  get active() { return this.state.phase !== 'idle'; }

  private set(s: StudioRecordState) {
    this.state = s;
    this.ctx.changed(s);
  }

  private elapsed(): number {
    if (!this.firstWall) return 0;
    const paused = (this.events?.pauses ?? []).reduce((n, p) => n + (p.end - p.start), 0);
    const now = Date.now() - this.firstWall;
    const open = this.state.phase === 'paused' && this.pausedAt ? Date.now() - this.pausedAt : 0;
    return Math.max(0, now - paused - open);
  }
  private pausedAt = 0;

  /** Chooses what to record: the display under the pointer, a window or an area. */
  private async target(o: StudioOptions): Promise<ScreenTarget | null> {
    const display = displayUnderCursor();
    const scale = display.scaleFactor || 1;
    if (o.mode === 'area') {
      const picked = await pickArea(this.ctx.preload, 'Drag over the area to record');
      if (!picked) return null;
      const d = picked.display;
      const r = picked.rect;
      return { displayId: d.id, rect: r, region: { x: d.bounds.x + r.x, y: d.bounds.y + r.y, w: r.w, h: r.h, scale: picked.scale || d.scaleFactor || 1 } };
    }
    if (o.mode === 'window') {
      const w = await pickWindow(this.ctx.preload);
      if (!w) return null;
      const b = await windowBounds(w.id);
      const windowId = Number(w.id.split(':')[1]) || undefined;
      if (!b && process.platform !== 'darwin') throw new Error('Keeper could not tell where that window is. Record an area around it instead.');
      const region = b ? { ...b, scale } : { x: display.bounds.x, y: display.bounds.y, w: display.bounds.width, h: display.bounds.height, scale };
      return { displayId: display.id, sourceId: w.id, windowId, region };
    }
    return { displayId: display.id, region: { x: display.bounds.x, y: display.bounds.y, w: display.bounds.width, h: display.bounds.height, scale } };
  }

  async record(o: StudioOptions): Promise<StudioRecordState> {
    if (this.active) return this.state;
    this.opts = o;
    this.notes = [];
    this.cancelCountdown = false;
    this.set({ phase: 'picking' });
    let t: ScreenTarget | null;
    try { t = await this.target(o); } catch (e) { this.set({ phase: 'idle', error: e instanceof Error ? e.message : String(e) }); return this.state; }
    if (!t) { this.set({ phase: 'idle' }); return this.state; }
    if (o.stage) { await this.ctx.stage(true).catch(() => undefined); this.stageOn = true; }
    for (let n = o.countdown; n > 0; n--) {
      if (this.cancelCountdown) break;
      this.set({ phase: 'countdown', countdown: n });
      this.ctx.alert(`Recording in ${n}…`, 'Stop it from the Island, the tray or the shortcut');
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (this.cancelCountdown) { await this.endStage(); this.set({ phase: 'idle' }); return this.state; }
    try {
      await this.begin(t, o);
    } catch (e) {
      await this.teardown();
      await this.endStage();
      if (this.dir) await fsp.rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
      this.set({ phase: 'idle', error: e instanceof Error ? e.message : String(e) });
    }
    return this.state;
  }

  private async begin(t: ScreenTarget, o: StudioOptions) {
    const { how, note } = await screenHow();
    if (note) this.notes.push(note);
    this.startedAt = Date.now();
    this.dir = await newProjectDir(recordingTitle(new Date(this.startedAt)));
    this.region = t.region;
    this.events = new EventRecorder(t.region);
    // the event log: the pointer about 60 times a second, clicks and keys, the app in front
    this.poll = setInterval(() => { try { this.events?.move(screen.getCursorScreenPoint()); } catch { /* no screen */ } }, 16);
    this.input = await listen((e) => {
      if (!this.events) return;
      if (e.t === 'click') this.events.click({ x: e.x ?? screen.getCursorScreenPoint().x, y: e.y ?? screen.getCursorScreenPoint().y }, e.right);
      else this.events.key(e.key, e.mods);
    }).catch(() => null);
    setTimeout(() => { if (this.input?.error) this.notes.push(`Clicks and keys were not recorded: ${this.input.error}.`); }, 1500);
    this.releaseFront = holdFrontWatch();
    this.offFront = onFrontWindow((w) => this.events?.focus(w.app, w.title));

    // side tracks, and the screen itself when the browser records it
    const side: SideTrack[] = [];
    if (o.mic) side.push({ name: 'mic', kind: 'mic', file: path.join(this.dir, 'mic.webm'), deviceId: o.micId });
    if (o.webcam) side.push({ name: 'webcam', kind: 'webcam', file: path.join(this.dir, 'webcam.webm'), deviceId: o.camId });
    const systemSide = o.systemAudio && process.platform === 'win32' && how !== 'browser';
    if (systemSide) side.push({ name: 'system', kind: 'system', file: path.join(this.dir, 'system.webm') });
    if (o.systemAudio && process.platform === 'linux') this.notes.push('The computer’s sound cannot be recorded on Linux yet; only the microphone was.');
    let screenRec: ScreenRecorder;
    this.side = new SideRecorder(this.ctx.preload, app.getPath('userData'));
    this.sideFiles = side;
    if (how === 'browser') {
      const sourceId = t.sourceId ?? (await screenSource(t.displayId));
      if (!sourceId) throw new Error('No screen to record was found.');
      this.screenFile = path.join(this.dir, 'screen-raw.webm');
      side.push({ name: 'screen', kind: 'screen', file: this.screenFile, sourceId, systemAudio: o.systemAudio && process.platform === 'win32', fps: o.fps });
      const starts = this.side.start(side);
      screenRec = browserScreen(this.side, starts.then((m) => m.get('screen') ?? null), t, this.screenFile);
      const m = await starts;
      for (const [k, v] of m) if (v) this.sideStarts.set(k, v.wall);
    } else {
      // the side tracks first (opening a camera can take a few seconds), then the screen,
      // so the recording begins when it says it does
      const m = await this.side.start(side);
      for (const [k, v] of m) if (v) this.sideStarts.set(k, v.wall);
      this.screenFile = path.join(this.dir, how === 'ffmpeg' ? 'screen-raw.mkv' : 'screen.mp4');
      screenRec = how === 'screencapturekit'
        ? await macScreen(t, this.screenFile, { fps: o.fps, systemAudio: o.systemAudio })
        : ffmpegScreen(t, this.screenFile, { fps: o.fps });
    }
    for (const [k, err] of this.side.errors) if (k !== 'screen') this.notes.push(`The ${k === 'mic' ? 'microphone' : k === 'webcam' ? 'camera' : 'computer’s sound'} was not recorded: ${err}`);
    this.screenRec = screenRec;
    screenRec.onEnd((r) => { if (this.state.phase === 'recording' || this.state.phase === 'paused') { this.ctx.alert('The recording stopped', r.error ?? 'The screen recorder ended by itself; what was recorded is saved.'); void this.stop(); } });
    const first = await Promise.race([screenRec.first, new Promise<number>((_, rej) => setTimeout(() => rej(new Error('The screen recorder did not start.')), 20_000))]);
    this.firstWall = first;
    this.events.setStart(first);
    this.region = await screenRec.region;
    this.set({ phase: 'recording', since: first, elapsed: 0, how: screenRec.how, notes: this.notes });
    this.tick = setInterval(() => { if (this.state.phase === 'recording') this.ctx.changed({ ...this.state, elapsed: this.elapsed() }); }, 1000);
  }

  pause(): StudioRecordState {
    if (this.state.phase !== 'recording') return this.state;
    this.events?.pause();
    this.pausedAt = Date.now();
    this.set({ ...this.state, phase: 'paused', elapsed: this.elapsed() });
    return this.state;
  }

  resume(): StudioRecordState {
    if (this.state.phase !== 'paused') return this.state;
    this.events?.resume();
    this.pausedAt = 0;
    this.set({ ...this.state, phase: 'recording', elapsed: this.elapsed() });
    return this.state;
  }

  private async teardown() {
    if (this.poll) clearInterval(this.poll);
    if (this.tick) clearInterval(this.tick);
    this.poll = this.tick = null;
    this.input?.stop();
    this.input = null;
    this.offFront?.();
    this.releaseFront?.();
    this.offFront = this.releaseFront = null;
  }

  private async endStage() {
    if (this.stageOn) { this.stageOn = false; await this.ctx.stage(false).catch(() => undefined); }
  }

  /** Stops and throws the recording away. */
  async discard(): Promise<StudioRecordState> {
    if (this.state.phase === 'countdown' || this.state.phase === 'picking') { this.cancelCountdown = true; return this.state; }
    if (!this.screenRec) return this.state;
    this.set({ ...this.state, phase: 'saving' });
    await this.teardown();
    await Promise.all([this.screenRec.stop().catch(() => undefined), this.side?.stop()]);
    this.screenRec = null;
    await this.endStage();
    await fsp.rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
    this.set({ phase: 'idle' });
    return this.state;
  }

  /** Stops, and saves the project. */
  async stop(): Promise<StudioRecordState> {
    if (this.state.phase === 'countdown' || this.state.phase === 'picking') { this.cancelCountdown = true; return this.state; }
    if (!this.screenRec || this.state.phase === 'saving') return this.state;
    const how = this.screenRec.how, cursorInVideo = this.screenRec.cursorInVideo;
    this.set({ ...this.state, phase: 'saving', elapsed: this.elapsed() });
    this.events?.resume();
    await this.teardown();
    const [res] = await Promise.all([this.screenRec.stop(), this.side?.stop()]);
    this.screenRec = null;
    await this.endStage();
    try {
      const dir = await this.finish(how, cursorInVideo, res.hasAudio ?? false);
      this.set({ phase: 'idle', project: dir, notes: this.notes });
      this.ctx.alert('Recording saved', 'Opening it in Studio');
    } catch (e) {
      this.set({ phase: 'idle', error: e instanceof Error ? e.message : String(e), project: existsSync(this.dir) ? this.dir : undefined });
    }
    return this.state;
  }

  /** Turns the raw parts into a project. */
  private async finish(how: CaptureHow, cursorInVideo: boolean, screenHasAudio: boolean): Promise<string> {
    const dir = this.dir;
    const o = this.opts!;
    // the screen as an MP4 (or WebM) players can seek in
    let screenFile = this.screenFile;
    if (!existsSync(screenFile) || (await fsp.stat(screenFile)).size < 1000) throw new Error('Nothing was recorded.');
    if (screenFile.endsWith('.mkv')) {
      const mp4 = path.join(dir, 'screen.mp4');
      if (await remux(screenFile, mp4, { faststart: true })) { await fsp.rm(screenFile, { force: true }); screenFile = mp4; }
    } else if (screenFile.endsWith('-raw.webm')) {
      const webm = path.join(dir, 'screen.webm');
      if (await remux(screenFile, webm, { videoOnly: true })) {
        if (screenHasAudio) {
          const sys = path.join(dir, 'system.webm');
          if (await remux(screenFile, sys, { audioOnly: true })) this.sideStarts.set('system', this.firstWall);
        }
        await fsp.rm(screenFile, { force: true });
        screenFile = webm;
      }
    }
    // a Mac recording carries the computer's sound as its second track
    if (how === 'screencapturekit' && screenHasAudio) {
      const sys = path.join(dir, 'system.m4a');
      if (await remux(screenFile, sys, { audioOnly: true })) this.sideStarts.set('system', this.firstWall);
    }
    const info = await probe(screenFile);
    const duration = info.duration > 0 ? info.duration : await measuredDuration(screenFile);
    if (!(duration > 0) || !info.video) throw new Error('The recording could not be read back.');
    // side tracks: fixed up so they know their length
    const tracks: Partial<Record<'mic' | 'webcam' | 'system', { file: string; offset: number; width?: number; height?: number }>> = {};
    for (const t of this.sideFiles) {
      if (t.kind === 'screen' || !existsSync(t.file) || (await fsp.stat(t.file)).size < 200 || !this.sideStarts.has(t.name)) { await fsp.rm(t.file, { force: true }).catch(() => undefined); continue; }
      const fixed = t.file.replace(/\.webm$/, '.fixed.webm');
      if (await remux(t.file, fixed)) { await fsp.rename(fixed, t.file); }
      const p = t.kind === 'webcam' ? await probe(t.file) : null;
      tracks[t.kind as 'mic' | 'webcam' | 'system'] = { file: path.basename(t.file), offset: this.sideStarts.get(t.name)! - this.firstWall, width: p?.video?.width, height: p?.video?.height };
    }
    for (const n of ['system.webm', 'system.m4a']) if (existsSync(path.join(dir, n)) && !tracks.system) tracks.system = { file: n, offset: (this.sideStarts.get('system') ?? this.firstWall) - this.firstWall };
    const events = this.events!.finish(duration);
    const r = this.region!;
    // the picture may differ a little from the asked size (rounded to even pixels)
    const sx = info.video.width / (r.w * r.scale), sy = info.video.height / (r.h * r.scale);
    if (Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01) {
      for (let i = 0; i < events.moves.length; i += 3) { events.moves[i + 1] *= sx; events.moves[i + 2] *= sy; }
      for (const c of events.clicks) { c.x *= sx; c.y *= sy; }
    }
    const meta: ProjectMeta = {
      createdAt: this.startedAt, duration, width: info.video.width, height: info.video.height, fps: Math.round(info.video.fps) || o.fps, scale: r.scale * sx,
      platform: process.platform, mode: o.mode, how, cursorInVideo,
      screen: { file: path.basename(screenFile), offset: 0 },
      mic: tracks.mic, system: tracks.system, webcam: tracks.webcam,
      notes: this.notes.length ? this.notes : undefined,
    };
    const style = defaultStyle();
    style.camera.show = !!tracks.webcam;
    const cursor = smoothPath(events, duration, 0);
    const clips = clipsWithoutPauses(duration, this.events!.pauses).map((c, i) => ({ id: `c${i}`, ...c, speed: 1 }));
    const project: StudioProject = {
      version: STUDIO_VERSION, id: newId('p'), name: path.basename(dir).replace(/\.keeperstudio$/, ''), meta,
      timeline: {
        clips: clips.length ? clips : [{ id: 'c0', start: 0, end: duration, speed: 1 }],
        zooms: autoZooms(events, duration, { width: meta.width, height: meta.height }, { depth: style.zoom.depth }, (t) => { const p = trackAt(cursor, t); return [p.x, p.y]; }),
        blurs: [], captions: [], chapters: chaptersFrom(events, duration),
      },
      style, updatedAt: Date.now(),
    };
    await writeJson(path.join(dir, 'events.json'), events);
    await writeJson(path.join(dir, 'project.json'), project);
    await thumbnail(screenFile, path.join(dir, 'thumb.jpg'), Math.min(1500, duration / 2)).catch(() => false);
    await remember(dir);
    return dir;
  }
}
