// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Studio across the system: the page's IPC, its global shortcuts (start and
// stop, pause and resume), the tray's Stop and Pause, the Island's stop
// button (shared with the plain recorder), and the hidden export page.

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { writePaths } from '../services/clip';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ExportJob, StudioOptions, StudioRecordState, StudioSupport } from '../../core/studio/api';
import type { ExportSettings } from '../../core/studio/export';
import { captionsFrom, sampleTimes, sensitiveBoxes, blursFromSamples } from '../../core/studio/overlays';
import { PROJECT_EXT, type Clip, type StudioProject } from '../../core/studio/types';
import { featureOn } from '../services/features';
import { startJob, type JobHandle } from '../services/governor';
import { allowRoot, fileUrl } from '../services/preview';
import { ffmpegPath } from '../services/recorder';
import { Exporter } from '../services/studio/exporter';
import { frameAt, levels } from '../services/studio/media';
import { screenHow, StudioSession } from '../services/studio/session';
import { checkedDir, inProject, listProjects, readEvents, readProject, remember, removeProject, saveProject, setStudioOptions, studioOptions } from '../services/studio/store';
import { x11Usable } from '../services/studio/capture';

export interface StudioCtx {
  /** the app's preload */
  preload: string;
  /** the screen pickers' and recording page's preload */
  capturePreload: string;
  broadcast(channel: string, ...args: unknown[]): void;
  alert(title: string, detail?: string): void;
  show(route?: string): void;
  load(win: BrowserWindow, query: Record<string, string>): Promise<void>;
  /** the Island and tray show a recording (and its Stop) */
  recording(on: boolean, since?: number): void;
  updateTray(): void;
  stage(on: boolean): Promise<void>;
  /** a new file: index it and put it on the shelf */
  added(p: string): void;
  reregister(): void;
  /** moves Keeper's main window out of the way (it comes back when the recording is saved) */
  minimize(): void;
}

let session: StudioSession | null = null;
let exporter: Exporter | null = null;
let ctx: StudioCtx;
/** the window was moved away for this recording */
let hidden = false;

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.removeHandler(name);
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

/** Is a Studio recording running (for the Island's Stop and the busy check)? */
export function studioRecording(): boolean {
  return !!session && session.active;
}

export async function studioStop(): Promise<StudioRecordState | null> {
  return session ? session.stop() : null;
}

export async function studioToggle(): Promise<void> {
  if (!session) return;
  if (session.active) { await session.stop(); return; }
  await session.record(await studioOptions());
}

function togglePause() {
  if (!session) return;
  if (session.state.phase === 'paused') session.resume();
  else if (session.state.phase === 'recording') session.pause();
}

async function support(): Promise<StudioSupport> {
  const { how, note } = await screenHow();
  const wayland = process.platform === 'linux' && !x11Usable();
  const input = process.platform === 'linux'
    ? (wayland ? { clicks: false, keys: false, note: 'Wayland does not share clicks and keys with apps.' } : { clicks: true, keys: true, note: 'Clicks and keys need the xinput tool.' })
    : process.platform === 'darwin' ? { clicks: true, keys: true, note: 'Clicks and keys need Input Monitoring permission.' } : { clicks: true, keys: true };
  return {
    platform: process.platform,
    screen: { how, cursorHidden: how !== 'browser', note },
    input,
    systemAudio: process.platform === 'win32' || (process.platform === 'darwin' && how === 'screencapturekit'),
    ffmpeg: !!ffmpegPath(),
    wayland,
  };
}

async function opened(dir: string) {
  const d = await checkedDir(dir);
  allowRoot(d);
  const project = await readProject(d);
  const events = await readEvents(d);
  const url = (f?: { file: string }) => (f && existsSync(inProject(d, f.file)) ? fileUrl(inProject(d, f.file)) : undefined);
  await remember(d);
  return { dir: d, project, events, urls: { screen: url(project.meta.screen)!, mic: url(project.meta.mic), system: url(project.meta.system), webcam: url(project.meta.webcam) } };
}

/** Studio in the tray: Stop and Pause while recording. */
export function studioTrayItems(): Electron.MenuItemConstructorOptions[] {
  if (!session || !featureOn('studio')) return [];
  const st = session.state;
  if (st.phase === 'recording' || st.phase === 'paused') {
    return [{ label: `● Studio: ${st.phase === 'paused' ? 'paused' : 'recording'}`, submenu: [
      { label: 'Stop and Edit', click: () => void session?.stop() },
      { label: st.phase === 'paused' ? 'Resume' : 'Pause', click: () => togglePause() },
      { label: 'Discard Recording', click: () => void session?.discard() },
    ] }];
  }
  return [{ label: 'Studio: Record the Screen', click: () => void studioToggle() }];
}

export async function registerStudioShortcuts(reg: (acc: string, fn: () => void, owner?: string) => void) {
  if (!featureOn('studio')) return;
  const o = await studioOptions();
  reg(o.shortcut, () => void studioToggle().catch(() => undefined), 'Studio: record');
  reg(o.pauseShortcut, () => togglePause(), 'Studio: pause');
}

/** keeper://studio/record · /stop · /pause */
export function handleStudioLink(u: URL) {
  const verb = u.pathname.replace(/^\/+/, '') || u.hostname;
  if (verb === 'stop') void session?.stop();
  else if (verb === 'pause') togglePause();
  else if (verb === 'record') void studioToggle();
  else ctx?.show('studio');
}

export function stopStudio() {
  exporter?.cancelAll();
  if (session?.active) void session.stop();
}

// A recording and each export are Keeper's work while they run (Keep Awake, Performance).
let recordingJob: JobHandle | null = null;
const exportJobs = new Map<string, JobHandle>();
function trackExport(j: ExportJob) {
  const over = j.phase === 'done' || j.phase === 'error' || j.phase === 'cancelled';
  let job = exportJobs.get(j.id);
  if (over) {
    job?.end();
    exportJobs.delete(j.id);
    return;
  }
  if (!job) exportJobs.set(j.id, (job = startJob('Studio export', { id: `studio-export-${j.id}` })));
  job.update(`${Math.round(j.progress * 100)}%`);
}

export function registerStudioIpc(c: StudioCtx) {
  ctx = c;
  session = new StudioSession({
    preload: c.capturePreload,
    changed: (s) => {
      c.broadcast('studio-changed', s);
      const live = s.phase === 'recording' || s.phase === 'paused';
      c.recording(live, live ? s.since : undefined);
      if (live && !recordingJob) recordingJob = startJob('Studio recording', { id: 'studio-recording', keepAwake: true });
      else if (!live && recordingJob && s.phase === 'idle') { recordingJob.end(); recordingJob = null; }
      c.updateTray();
      // a finished recording opens in the editor; a cancelled one brings the window back
      if (s.phase === 'idle' && (s.project || hidden)) c.show(s.project ? `studio:${s.project}` : 'studio');
      if (s.phase === 'idle') hidden = false;
    },
    alert: c.alert,
    stage: c.stage,
  });
  exporter = new Exporter({ preload: c.preload, load: c.load, changed: (j: ExportJob) => { trackExport(j); c.broadcast('studio-export', j); }, added: c.added });

  handle('studio.support', () => support());
  handle('studio.options', () => studioOptions());
  handle('studio.setOptions', async (patch: Partial<StudioOptions>) => { const o = await setStudioOptions(patch); c.reregister(); return o; });
  handle('studio.state', () => session!.state);
  handle('studio.record', async (o?: Partial<StudioOptions>) => {
    if (!featureOn('studio')) throw new Error('Studio is switched off in Features.');
    const opts = o ? await setStudioOptions(o) : await studioOptions();
    if (process.platform !== 'darwin' && !ffmpegPath()) throw new Error('Keeper’s bundled ffmpeg is missing; Studio needs it to record and export.');
    // the page should not be in the picture: it comes back when the recording is saved
    if (opts.hideWindow && !session!.active) { hidden = true; c.minimize(); }
    return session!.record(opts);
  });
  handle('studio.pause', () => session!.pause());
  handle('studio.resume', () => session!.resume());
  handle('studio.stop', () => session!.stop());
  handle('studio.discard', () => session!.discard());
  handle('studio.projects', () => listProjects());
  handle('studio.open', (dir: string) => opened(dir));
  handle('studio.save', async (dir: string, p: StudioProject) => saveProject(await checkedDir(dir), p));
  handle('studio.remove', (dir: string) => removeProject(dir));
  handle('studio.reveal', async (dir: string) => { shell.showItemInFolder(await checkedDir(dir)); });
  handle('studio.pick', async () => {
    const r = await dialog.showOpenDialog({ title: 'Open a Studio project', properties: ['openDirectory'] });
    const d = r.filePaths[0];
    if (!d || !d.endsWith(PROJECT_EXT) || !existsSync(path.join(d, 'project.json'))) return null;
    await remember(d);
    return d;
  });
  handle('studio.levels', async (dir: string) => {
    const d = await checkedDir(dir);
    const p = await readProject(d);
    const track = p.meta.mic ?? p.meta.system;
    if (!track) return { stepMs: 50, levels: [] };
    const lv = await levels(inProject(d, track.file), 50);
    // onto the recording's time
    const shift = Math.round(track.offset / 50);
    const out = shift >= 0 ? [...new Array(shift).fill(0), ...lv] : lv.slice(-shift);
    return { stepMs: 50, levels: out };
  });
  handle('studio.transcribe', async (dir: string, o?: { language?: string }) => {
    const d = await checkedDir(dir);
    const p = await readProject(d);
    const track = p.meta.mic ?? p.meta.system;
    if (!track) throw new Error('This recording has no sound to make captions from.');
    const { whisper } = await import('../services/voice/engine');
    const { voiceSettings } = await import('../services/voice/store');
    const vs = voiceSettings();
    const t = await whisper().transcribe(inProject(d, track.file), {
      size: vs.meetings.model, language: o?.language ?? vs.meetings.language,
      progress: (f, label) => c.broadcast('studio-progress', { what: 'captions', fraction: f, label }),
    });
    return captionsFrom(t.segments, track.offset);
  });
  handle('studio.privacyScan', async (dir: string, clips: Clip[]) => {
    const d = await checkedDir(dir);
    const p = await readProject(d);
    const { ocrLines } = await import('../services/vision');
    const file = inProject(d, p.meta.screen.file);
    const step = 2000;
    const times = sampleTimes(clips, step, 240);
    const samples: { t: number; boxes: ReturnType<typeof sensitiveBoxes> }[] = [];
    for (let i = 0; i < times.length; i++) {
      const png = await frameAt(file, times[i]);
      if (png) {
        const lines = await ocrLines(png).catch(() => []);
        samples.push({ t: times[i], boxes: sensitiveBoxes(lines, { width: p.meta.width, height: p.meta.height }) });
      }
      c.broadcast('studio-progress', { what: 'privacy', fraction: (i + 1) / times.length });
    }
    return blursFromSamples(samples, step, p.meta.duration);
  });
  handle('studio.export', async (dir: string, p: StudioProject, settings: Partial<ExportSettings>, can?: { h264: boolean; vp9: boolean }) => {
    const d = await checkedDir(dir);
    await saveProject(d, p);
    await setStudioOptions({ lastExport: settings });
    return exporter!.start(d, p, settings, can ?? { h264: false, vp9: true });
  });
  handle('studio.exportState', (id: string) => exporter!.state(id));
  handle('studio.cancelExport', (id: string) => exporter!.cancel(id));
  handle('studio.copyFile', async (p: string) => {
    if (!existsSync(p) || !/\.(mp4|webm|gif)$/i.test(p)) throw new Error('Only an exported video can be copied.');
    // a file list (pasting into a chat or file manager attaches the file) and the path as text
    await writePaths([p]);
  });
  handle('studio.revealFile', (p: string) => { if (existsSync(p)) shell.showItemInFolder(p); });
  handle('studio.work', (id: string) => exporter!.work(id));
  handle('studio.workChunk', (id: string, data: ArrayBuffer) => exporter!.chunk(id, data));
  handle('studio.workProgress', (id: string, done: number) => exporter!.progress(id, done));
  handle('studio.workDone', (id: string, error?: string) => exporter!.done(id, error));
  app.on('before-quit', () => exporter?.cancelAll());
}
