// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Exports: a hidden page draws every frame from the timeline exactly as the
// preview does, encodes them with the page's own video encoder (hardware
// where the system has it) and streams them here; the bundled ffmpeg then
// adds the sound (cut and sped up to match), chapters, and makes the final
// MP4, HEVC, WebM or GIF. Cancelling stops both at once.

import { BrowserWindow } from 'electron';
import { createWriteStream, existsSync, promises as fsp, type WriteStream } from 'node:fs';
import path from 'node:path';
import type { ExportJob, ExportWork } from '../../../core/studio/api';
import { exportPlan, extensionFor, finishArgs, type AudioInput, type ExportPlan, type ExportSettings } from '../../../core/studio/export';
import { captionsOnOutput, chaptersOnOutput, ffmetadata, toSrt } from '../../../core/studio/overlays';
import type { StudioProject } from '../../../core/studio/types';
import { uniqueName } from '../../../core/rules';
import { allowRoot, fileUrl } from '../preview';
import { ffmpeg, packetIndex } from './media';
import { inProject, readEvents } from './store';

export interface ExporterCtx {
  /** the app's own preload (the hidden page uses window.keeper) */
  preload: string;
  /** loads the app's page with a query in a window */
  load(win: BrowserWindow, query: Record<string, string>): Promise<void>;
  changed(job: ExportJob): void;
  /** a finished file: index it and put it on the shelf */
  added(p: string): void;
}

interface Running {
  job: ExportJob;
  project: StudioProject;
  plan: ExportPlan;
  win: BrowserWindow | null;
  out: WriteStream | null;
  video: string;
  work: ExportWork | null;
  abort: AbortController;
  cancelled: boolean;
  lastTick: { at: number; done: number };
}

let hevcHw: string | null | undefined;
async function hardwareHevc(): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined;
  if (hevcHw === undefined) {
    const r = await ffmpeg(['-encoders'], { timeout: 15_000 });
    hevcHw = /hevc_videotoolbox/.test(r.stdout) ? 'hevc_videotoolbox' : null;
  }
  return hevcHw ?? undefined;
}

export class Exporter {
  private jobs = new Map<string, Running>();
  constructor(private ctx: ExporterCtx) {}

  state(id: string): ExportJob | null {
    return this.jobs.get(id)?.job ?? null;
  }

  private update(r: Running, patch: Partial<ExportJob>) {
    r.job = { ...r.job, ...patch };
    this.ctx.changed(r.job);
  }

  async start(dir: string, project: StudioProject, raw: Partial<ExportSettings>, can: { h264: boolean; vp9: boolean }): Promise<ExportJob> {
    const plan = exportPlan({ width: project.meta.width, height: project.meta.height }, project.style.frame.aspect, project.timeline.clips, raw, can);
    const id = `x${Date.now().toString(36)}`;
    const work = path.join(dir, 'cache', `export-${id}`);
    await fsp.mkdir(work, { recursive: true });
    const video = path.join(work, plan.intermediate === 'h264' ? 'video.h264' : 'video.ivf');
    const r: Running = {
      job: { id, dir, phase: 'preparing', progress: 0, frames: plan.frames, done: 0, startedAt: Date.now() },
      project, plan, win: null, out: null, video, work: null, abort: new AbortController(), cancelled: false, lastTick: { at: Date.now(), done: 0 },
    };
    this.jobs.set(id, r);
    this.ctx.changed(r.job);
    void this.prepare(r).catch((e: unknown) => this.fail(r, e));
    return r.job;
  }

  private async prepare(r: Running) {
    const { dir, id } = r.job;
    const cache = path.join(dir, 'cache');
    allowRoot(dir);
    const screen = await packetIndex(inProject(dir, r.project.meta.screen.file), cache, 'screen');
    let webcam: ExportWork['webcam'];
    const cam = r.project.meta.webcam;
    if (cam && r.project.style.camera.show && existsSync(inProject(dir, cam.file))) {
      const w = await packetIndex(inProject(dir, cam.file), cache, 'webcam').catch(() => null);
      if (w) webcam = { index: w.index, url: fileUrl(w.bin), offset: cam.offset };
    }
    if (r.cancelled) return;
    r.work = { id, project: r.project, events: await readEvents(dir), plan: r.plan, mac: process.platform === 'darwin', screen: { index: screen.index, url: fileUrl(screen.bin) }, webcam };
    r.out = createWriteStream(r.video);
    this.update(r, { phase: 'rendering' });
    r.win = new BrowserWindow({ show: false, width: 640, height: 400, webPreferences: { preload: this.ctx.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    r.win.on('closed', () => {
      r.win = null;
      if (r.job.phase === 'rendering' && !r.cancelled) this.fail(r, new Error('The export page closed unexpectedly'));
    });
    await this.ctx.load(r.win, { view: 'studio-export', job: id });
  }

  work(id: string): ExportWork {
    const r = this.jobs.get(id);
    if (!r?.work) throw new Error('No such export');
    return r.work;
  }

  chunk(id: string, data: ArrayBuffer) {
    const r = this.jobs.get(id);
    if (!r?.out || r.cancelled) return;
    r.out.write(Buffer.from(data));
  }

  progress(id: string, done: number): { cancelled: boolean } {
    const r = this.jobs.get(id);
    if (!r) return { cancelled: true };
    if (r.cancelled) return { cancelled: true };
    const now = Date.now();
    const speed = now - r.lastTick.at > 400 ? ((done - r.lastTick.done) * 1000) / (now - r.lastTick.at) : r.job.speed;
    if (now - r.lastTick.at > 400) r.lastTick = { at: now, done };
    // the picture is most of the work; the final step gets the last 8%
    this.update(r, { done, progress: Math.min(0.92, (done / Math.max(1, r.plan.frames)) * 0.92), speed });
    return { cancelled: false };
  }

  async done(id: string, error?: string) {
    const r = this.jobs.get(id);
    if (!r || r.cancelled) return;
    await new Promise<void>((res) => (r.out ? r.out.end(() => res()) : res()));
    r.out = null;
    if (error) return this.fail(r, new Error(error));
    // finishing before the page closes, so its closing is not taken for a failure
    this.update(r, { phase: 'finishing', progress: 0.93 });
    if (r.win && !r.win.isDestroyed()) { const w = r.win; r.win = null; w.destroy(); }
    try {
      await this.finish(r);
    } catch (e) { this.fail(r, e); }
  }

  private async finish(r: Running) {
    const { project: p, plan } = r;
    const dir = r.job.dir;
    const work = path.dirname(r.video);
    const audio: AudioInput[] = [];
    const a = p.style.audio;
    if (a.mic && p.meta.mic && existsSync(inProject(dir, p.meta.mic.file))) audio.push({ path: inProject(dir, p.meta.mic.file), offset: p.meta.mic.offset, volume: a.micVolume, denoise: a.denoise });
    if (a.system && p.meta.system && existsSync(inProject(dir, p.meta.system.file))) audio.push({ path: inProject(dir, p.meta.system.file), offset: p.meta.system.offset, volume: a.systemVolume, denoise: false });
    let meta: string | undefined;
    const chapters = chaptersOnOutput(p.timeline.chapters, p.timeline.clips);
    if (plan.settings.chapters && chapters.length > 1) {
      meta = path.join(work, 'chapters.txt');
      await fsp.writeFile(meta, ffmetadata(chapters, plan.duration, p.name));
    }
    const parent = path.dirname(dir);
    const out = uniqueName(path.join(parent, `${p.name}.${extensionFor(plan.settings.format)}`), existsSync);
    const tmp = path.join(work, `out.${extensionFor(plan.settings.format)}`);
    const args = finishArgs(plan, { video: r.video, audio, meta }, p.timeline.clips, p.meta.duration, a, tmp, { hevc: await hardwareHevc() });
    const total = plan.duration / 1000;
    const res = await ffmpeg(['-loglevel', 'error', '-stats', ...args], {
      signal: r.abort.signal, timeout: 6 * 60 * 60_000,
      onStderr: (s) => {
        const m = [...s.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
        if (m && total > 0) this.update(r, { progress: Math.min(0.995, 0.93 + 0.07 * ((+m[1] * 3600 + +m[2] * 60 + +m[3]) / total)) });
      },
    });
    if (r.cancelled) return;
    if (!res.ok || !existsSync(tmp)) throw new Error(`The video could not be finished: ${res.stderr.trim().split('\n').slice(-2).join(' ') || 'ffmpeg failed'}`);
    await fsp.rename(tmp, out).catch(async () => { await fsp.copyFile(tmp, out); });
    let srt: string | undefined;
    if (plan.settings.srt && p.timeline.captions.length) {
      srt = out.replace(/\.[^.]+$/, '.srt');
      await fsp.writeFile(srt, toSrt(captionsOnOutput(p.timeline.captions, p.timeline.clips)));
    }
    await fsp.rm(work, { recursive: true, force: true }).catch(() => undefined);
    this.update(r, { phase: 'done', progress: 1, path: out, srt });
    this.ctx.added(out);
  }

  private fail(r: Running, e: unknown) {
    if (r.cancelled || r.job.phase === 'done') return;
    r.out?.end();
    r.out = null;
    if (r.win && !r.win.isDestroyed()) { const w = r.win; r.win = null; w.destroy(); }
    this.update(r, { phase: 'error', error: e instanceof Error ? e.message : String(e) });
    void fsp.rm(path.dirname(r.video), { recursive: true, force: true }).catch(() => undefined);
  }

  cancel(id: string) {
    const r = this.jobs.get(id);
    if (!r || r.job.phase === 'done' || r.job.phase === 'error') return;
    r.cancelled = true;
    r.abort.abort();
    r.out?.end();
    r.out = null;
    if (r.win && !r.win.isDestroyed()) { const w = r.win; r.win = null; w.destroy(); }
    this.update(r, { phase: 'cancelled' });
    setTimeout(() => void fsp.rm(path.dirname(r.video), { recursive: true, force: true }).catch(() => undefined), 500);
  }

  cancelAll() {
    for (const id of this.jobs.keys()) this.cancel(id);
  }
}
