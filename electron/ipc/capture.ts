// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for the screen tools: text capture, screenshots, recording, the colour
// picker, the capture history and saving edited images.

import { app, ipcMain, nativeImage, shell } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import type { CaptureOptions } from '../../core/capture';
import { editedName } from '../../core/capture';
import { isInside } from '../../core/safety';
import {
  clipboardImage, colorHistory, getOptions, history, imageFromDataUrl, loadHistory, pickColor, readFile, saveHistory,
  screenshotFolder, setOptions, takeScreenshot, type ScreenshotMode,
} from '../services/capture';
import { writeImage } from '../services/clip';
import { claimShortcut } from '../services/prefs';
import { Recorder, type RecordMode, type RecordState } from '../services/recorder';
import { loadImage } from '../services/vision';

export interface CaptureContext {
  preload: string;
  langs: () => string[];
  /** folders the library indexes; edited images may only be written inside these */
  folders: () => string[];
  /** a new file appeared: index it and put it on the shelf */
  added: (p: string, shelf: boolean) => Promise<void>;
  alert: (title: string, detail?: string, p?: string) => void;
  /** recording started or stopped: update the Island and tray */
  recording: (s: RecordState) => void;
  /** open a page in the main window ("annotate:<path>") */
  navigate: (route: string) => void;
}

let recorder: Recorder | null = null;
let ctxRef: CaptureContext | null = null;

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.removeHandler(name);
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

/** Where edited images may be saved: the indexed folders, Pictures, and the screenshot folder. */
async function writableRoots(ctx: CaptureContext): Promise<string[]> {
  return [...ctx.folders(), app.getPath('pictures'), await screenshotFolder()];
}

async function allowed(ctx: CaptureContext, p: string): Promise<boolean> {
  const roots = await writableRoots(ctx);
  return path.isAbsolute(p) && roots.some((r) => isInside(p, r) || path.resolve(path.dirname(p)) === path.resolve(r));
}

/** Takes a screenshot; throws so callers can show the problem their own way. */
export async function screenshot(mode: ScreenshotMode, o: { timer?: number } = {}): Promise<string | null> {
  const ctx = ctxRef!;
  const p = await takeScreenshot(mode, ctx.preload, o);
  if (!p) return null;
  await ctx.added(p, true);
  ctx.alert('Screenshot saved', path.basename(p), p);
  const opts = await getOptions();
  if (opts.annotateAfterScreenshot) ctx.navigate(`annotate:${p}`);
  else if (opts.quickPreview) {
    const { showPreview } = await more();
    showPreview(p, nativeImage.createFromPath(p), {
      preload: ctx.preload, seconds: opts.quickSeconds,
      actions: { annotate: (f) => ctx.navigate(`annotate:${f}`), share: (f) => shareCapture(f), pin: (f) => pinCapture(f), problem: (m) => ctx.alert('Something went wrong', m) },
    });
  }
  return p;
}

/** Uploads a screenshot to the person's own storage and copies the link. */
async function shareCapture(p: string) {
  const { settings } = await import('../store');
  if (settings().island.upload.kind === 'none') throw new Error('Choose where links go first: Island settings → Upload & share (your own WebDAV server or storage bucket).');
  return (await import('../services/share-link')).shareFile(p);
}

async function pinCapture(p: string) {
  return (await more()).pinImage(p, ctxRef!.preload);
}

export async function startRecording(mode: RecordMode, opts: { mic?: boolean; systemAudio?: boolean; countdown?: number } = {}): Promise<RecordState> {
  const ctx = ctxRef!;
  if (!recorder) return { recording: false };
  if (recorder.state.recording) return recorder.state;
  const s = await recorder.start(mode, { ...opts, onCountdown: (n) => ctx.alert(`Recording in ${n}…`, 'Stop it from the Island, the tray or the shortcut') });
  if (s.error) throw new Error(`Recording could not start: ${s.error}`);
  return s;
}

/** Studio's recorder: the Island's and tray's Stop end it too, and it counts as recording. */
let studio: { active(): boolean; since(): number | undefined; stop(): Promise<unknown> } | null = null;
export function setStudioRecorder(s: typeof studio) {
  studio = s;
}

export async function stopRecording(): Promise<string | null> {
  const ctx = ctxRef!;
  if (studio?.active() && !recorder?.state.recording) {
    await studio.stop();
    return null;
  }
  const p = (await recorder?.stop()) ?? null;
  if (p) {
    await ctx.added(p, true);
    ctx.alert('Recording saved', path.basename(p), p);
  }
  return p;
}

export async function toggleRecording(mode: RecordMode = 'full'): Promise<RecordState> {
  if (studio?.active() && !recorder?.state.recording) {
    await studio.stop();
    return recordingState();
  }
  if (recorder?.state.recording) {
    await stopRecording();
    return recorder.state;
  }
  return startRecording(mode);
}

export function recordingState(): RecordState {
  if (studio?.active() && !recorder?.state.recording) return { recording: true, since: studio.since() };
  return recorder?.state ?? { recording: false };
}

export async function colorPick() {
  const ctx = ctxRef!;
  const c = await pickColor(ctx.preload);
  if (c) ctx.alert(`Copied ${c.hex}`, `${c.rgb} · ${c.hsl}`);
  return c;
}

/** For shortcuts, the tray and links: problems show in the Island instead of a blocking dialog. */
export function quietly<T>(fn: () => Promise<T>): void {
  fn().catch((e: unknown) => ctxRef?.alert('Something went wrong', e instanceof Error ? e.message : String(e)));
}

/** Global shortcuts for screenshots, recording and the colour picker (called after the app's own). */
export async function registerCaptureShortcuts() {
  const o = await getOptions();
  // Taken or not valid: reported in Settings → Shortcuts.
  claimShortcut(o.screenshotShortcut, () => quietly(() => screenshot('area')), 'Screenshot');
  claimShortcut(o.recordShortcut, () => quietly(() => toggleRecording('full')), 'Record the screen');
  claimShortcut(o.colorShortcut, () => quietly(() => colorPick()), 'Pick a color');
  // Pinned pictures: the key that makes see-through ones clickable is only held while one is see-through.
  pinKey = o.pinShortcut;
  moreMod?.reclaimPinKey(pinKey);
}

// Capture's extras (scrolling capture, pins, previews) load the first time one is used.
let moreMod: typeof import('../services/capture-more') | null = null;
let pinKey = '';
async function more() {
  if (!moreMod) {
    moreMod = await import('../services/capture-more');
    moreMod.reclaimPinKey(pinKey);
  }
  return moreMod;
}

export function registerCaptureIpc(ctx: CaptureContext) {
  ctxRef = ctx;
  recorder = new Recorder(ctx.preload, (s) => ctx.recording(s));
  void loadHistory();

  // `capture.text` stays in main.ts (it also shows the result in the Island).
  handle('capture.clipboardImage', () => clipboardImage(ctx.langs()));
  handle('capture.readFile', (p: string) => readFile(p, ctx.langs()));
  handle('capture.screenshot', (mode: ScreenshotMode = 'full', o?: { timer?: number }) => screenshot(mode, { timer: typeof o?.timer === 'number' ? o.timer : undefined }));
  handle('capture.stopScroll', async () => (await more()).stopScrolling());
  handle('capture.pin', async (p: string) => {
    if (!(await allowed(ctx, p))) throw new Error('Keeper can only pin pictures from your library folders and screenshots.');
    return pinCapture(p);
  });
  handle('capture.pins', async () => (await more()).pinList());
  handle('capture.setPin', async (id: string, patch: { opacity?: number; through?: boolean; close?: boolean }) => (await more()).setPin(String(id), patch ?? {}));
  handle('capture.closePins', async () => (await more()).closePins());
  handle('capture.clickablePins', async () => (await more()).clickableAgain());
  handle('capture.share', async (p: string) => {
    if (!(await allowed(ctx, p))) throw new Error('Keeper can only upload pictures from your library folders and screenshots.');
    return shareCapture(p);
  });
  handle('capture.previews', async () => (await more()).previewState());
  handle('capture.closePreviews', async () => (await more()).closePreviews());
  handle('capture.record', (mode: RecordMode = 'full', opts?: { mic?: boolean; systemAudio?: boolean; countdown?: number }) => startRecording(mode, opts));
  handle('capture.stopRecording', () => stopRecording());
  handle('capture.recordState', () => recordingState());
  handle('capture.color', () => colorPick());
  handle('capture.colors', async () => {
    await loadHistory();
    return colorHistory();
  });
  handle('capture.history', async () => loadHistory());
  handle('capture.removeHistory', async (id: string) => {
    await loadHistory();
    history.remove(id);
    saveHistory();
  });
  handle('capture.clearHistory', async () => {
    await loadHistory();
    history.clear();
    saveHistory();
  });
  handle('capture.options', () => getOptions());
  handle('capture.setOptions', async (patch: Partial<CaptureOptions>) => {
    const o = await setOptions(patch);
    await registerCaptureShortcuts();
    return o;
  });
  handle('capture.openLink', async (url: string) => {
    if (/^https?:\/\/\S+$/i.test(url)) await shell.openExternal(url);
  });

  // Images for the editor: full resolution, only from places the library knows.
  handle('files.readImage', async (p: string) => {
    if (!(await allowed(ctx, p))) throw new Error('Keeper can only edit images in your library folders.');
    const img = await loadImage(p, 8000);
    if (!img) throw new Error('This file cannot be opened as an image.');
    return img.toDataURL();
  });
  /** Saves an edited image. A path to an existing image saves next to it as "name (edited).png". */
  handle('files.writeImage', async (target: string, dataUrl: string) => {
    const img = imageFromDataUrl(dataUrl);
    let dest = target;
    if (!target || existsSync(target)) {
      const dir = target ? path.dirname(target) : await screenshotFolder();
      const base = target ? path.basename(target) : 'Screenshot.png';
      dest = path.join(dir, editedName(base, (n) => existsSync(path.join(dir, n))));
    }
    if (!dest.toLowerCase().endsWith('.png')) dest += '.png';
    if (!(await allowed(ctx, dest))) throw new Error('Keeper can only save images inside your library folders.');
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, img.toPNG());
    await ctx.added(dest, false);
    return dest;
  });
  handle('files.copyImage', async (dataUrl: string) => {
    await writeImage(imageFromDataUrl(dataUrl));
  });
}
