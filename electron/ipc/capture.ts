// SPDX-License-Identifier: AGPL-3.0-or-later
// IPC for the screen tools: text capture, screenshots, recording, the colour
// picker, the capture history and saving edited images.

import { app, dialog, globalShortcut, ipcMain, shell } from 'electron';
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

export async function screenshot(mode: ScreenshotMode): Promise<string | null> {
  const ctx = ctxRef!;
  try {
    const p = await takeScreenshot(mode, ctx.preload);
    if (!p) return null;
    await ctx.added(p, true);
    ctx.alert('Screenshot saved', path.basename(p), p);
    if ((await getOptions()).annotateAfterScreenshot) ctx.navigate(`annotate:${p}`);
    return p;
  } catch (e) {
    dialog.showErrorBox('Screenshot', e instanceof Error ? e.message : String(e));
    return null;
  }
}

export async function toggleRecording(mode: RecordMode = 'full'): Promise<RecordState> {
  const ctx = ctxRef!;
  if (!recorder) return { recording: false };
  if (recorder.state.recording) {
    const p = await recorder.stop();
    if (p) {
      await ctx.added(p, true);
      ctx.alert('Recording saved', path.basename(p), p);
    }
    return recorder.state;
  }
  try {
    return await recorder.start(mode, { onCountdown: (n) => ctx.alert(`Recording in ${n}…`, 'Stop it from the Island, the tray or the shortcut') });
  } catch (e) {
    dialog.showErrorBox('Screen recording', e instanceof Error ? e.message : String(e));
    return recorder.state;
  }
}

export function recordingState(): RecordState {
  return recorder?.state ?? { recording: false };
}

export async function colorPick() {
  const ctx = ctxRef!;
  try {
    const c = await pickColor(ctx.preload);
    if (c) ctx.alert(`Copied ${c.hex}`, `${c.rgb} · ${c.hsl}`);
    return c;
  } catch (e) {
    dialog.showErrorBox('Colour picker', e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** Global shortcuts for screenshots, recording and the colour picker (called after the app's own). */
export async function registerCaptureShortcuts() {
  const o = await getOptions();
  const reg = (acc: string, fn: () => void) => {
    try {
      if (acc && !globalShortcut.isRegistered(acc)) globalShortcut.register(acc, fn);
    } catch {
      /* invalid or taken */
    }
  };
  reg(o.screenshotShortcut, () => void screenshot('area'));
  reg(o.recordShortcut, () => void toggleRecording('full'));
  reg(o.colorShortcut, () => void colorPick());
}

export function registerCaptureIpc(ctx: CaptureContext) {
  ctxRef = ctx;
  recorder = new Recorder(ctx.preload, (s) => ctx.recording(s));
  void loadHistory();

  // `capture.text` stays in main.ts (it also shows the result in the Island).
  handle('capture.clipboardImage', () => clipboardImage(ctx.langs()));
  handle('capture.readFile', (p: string) => readFile(p, ctx.langs()));
  handle('capture.screenshot', (mode: ScreenshotMode = 'full') => screenshot(mode));
  handle('capture.record', (mode: RecordMode = 'full', opts?: { mic?: boolean; systemAudio?: boolean; countdown?: number }) =>
    recorder!.state.recording ? recorder!.state : recorder!.start(mode, { ...opts, onCountdown: (n) => ctx.alert(`Recording in ${n}…`) }));
  handle('capture.stopRecording', async () => {
    const p = await recorder!.stop();
    if (p) {
      await ctx.added(p, true);
      ctx.alert('Recording saved', path.basename(p), p);
    }
    return p;
  });
  handle('capture.recordState', () => recorder!.state);
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
