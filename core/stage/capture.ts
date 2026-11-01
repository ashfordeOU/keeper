// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Is the screen being captured? Stage mode can start by itself when it is.
//
// How reliable each signal is (also in docs/STAGE.md):
//   Linux     PipeWire screen-cast streams (pw-dump): every portal-based capture
//             on Wayland, and most on X11, goes through one. Reliable.
//   all       Keeper's own screen recorder. Reliable.
//   macOS     There is no public "the screen is being captured" signal. Keeper
//             looks for the system's own capture controls (screencaptureui
//             windows) and for recorder apps that only run while recording,
//             or that are in front. Heuristic.
//   Windows   Windows has no global capture indicator. Keeper looks for
//             recorder apps (and ffmpeg with a screen grabber). Heuristic.

import type { StageCapture, StageOs } from './types';

export interface CaptureSource { label: string; reliable: boolean }

// ---------------------------------------------------------------- PipeWire (Linux)

interface PwObject { id: number; type?: string; info?: { state?: string; props?: Record<string, unknown> } | null }

const SCREEN_NAME = /screen.?cast|screencast|xdpw|meta-screen-cast|gnome-shell|kwin|screen|desktop|monitor-capture|wlr/i;
const CAMERA = /v4l2|libcamera|camera|webcam/i;

/** Screen-cast streams in pw-dump output that something is reading right now. */
export function screencastNodes(objects: PwObject[]): CaptureSource[] {
  const out: CaptureSource[] = [];
  for (const o of objects) {
    if (!o?.info || !o.type?.includes('Node')) continue;
    const p = o.info.props ?? {};
    const cls = String(p['media.class'] ?? '');
    if (!/^(Video\/Source|Stream\/Output\/Video)/.test(cls)) continue;
    const names = [p['node.name'], p['node.description'], p['media.name'], p['application.name'], p['media.role']].filter(Boolean).map(String).join(' ');
    if (p['device.api'] || CAMERA.test(names) || p['media.role'] === 'Camera') continue;
    if (!SCREEN_NAME.test(names)) continue;
    if (o.info.state && o.info.state !== 'running') continue;
    const who = String(p['application.name'] ?? p['node.description'] ?? p['node.name'] ?? 'screen cast');
    out.push({ label: `PipeWire screen cast (${who})`, reliable: true });
  }
  return out;
}

/**
 * `pw-dump --monitor` prints a JSON array whenever something changes: new or
 * changed objects in full, removed ones as `{ "id": n, "info": null }`. This
 * keeps the current set of objects from that stream.
 */
export class PwDumpStream {
  private buf = '';
  private depth = 0;
  private inStr = false;
  private esc = false;
  private start = -1;
  readonly objects = new Map<number, PwObject>();

  /** Feeds a chunk; returns true when at least one complete update arrived. */
  push(chunk: string): boolean {
    let changed = false;
    const base = this.buf.length;
    this.buf += chunk;
    for (let i = base; i < this.buf.length; i++) {
      const c = this.buf[i];
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (c === '\\') this.esc = true;
        else if (c === '"') this.inStr = false;
        continue;
      }
      if (c === '"') this.inStr = true;
      else if (c === '[' || c === '{') {
        if (this.depth === 0 && c === '[') this.start = i;
        this.depth++;
      } else if (c === ']' || c === '}') {
        this.depth = Math.max(0, this.depth - 1);
        if (this.depth === 0 && c === ']' && this.start >= 0) {
          this.apply(this.buf.slice(this.start, i + 1));
          changed = true;
          this.buf = this.buf.slice(i + 1);
          i = -1;
          this.start = -1;
        }
      }
    }
    if (this.depth === 0 && this.start < 0) this.buf = '';
    if (this.buf.length > 8 * 1024 * 1024) this.reset();
    return changed;
  }

  private apply(text: string) {
    let list: PwObject[];
    try { list = JSON.parse(text) as PwObject[]; } catch { return; }
    if (!Array.isArray(list)) return;
    for (const o of list) {
      if (!o || typeof o.id !== 'number') continue;
      if (o.info === null) { this.objects.delete(o.id); continue; }
      const prev = this.objects.get(o.id);
      this.objects.set(o.id, prev ? { ...prev, ...o, info: { ...(prev.info ?? {}), ...(o.info ?? {}), props: { ...(prev.info?.props ?? {}), ...(o.info?.props ?? {}) } } } : o);
    }
  }

  reset() {
    this.buf = '';
    this.depth = 0;
    this.inStr = false;
    this.esc = false;
    this.start = -1;
    this.objects.clear();
  }

  sources(): CaptureSource[] {
    return screencastNodes([...this.objects.values()]);
  }
}

// ---------------------------------------------------------------- recorder apps

/** "running": it only runs while recording. "front": it counts while it is the app in front. */
export interface RecorderApp { name: string; when: 'running' | 'front' }

export const RECORDERS: Record<StageOs, RecorderApp[]> = {
  darwin: [
    { name: 'screencaptureui', when: 'running' }, { name: 'OBS', when: 'front' }, { name: 'Loom', when: 'front' }, { name: 'Screen Studio', when: 'front' },
    { name: 'CleanShot X', when: 'front' }, { name: 'Kap', when: 'front' }, { name: 'ScreenFlow', when: 'front' }, { name: 'Camtasia', when: 'front' },
    { name: 'QuickTime Player', when: 'front' }, { name: 'Movavi Screen Recorder', when: 'front' }, { name: 'Capto', when: 'front' },
  ],
  win32: [
    { name: 'obs64', when: 'front' }, { name: 'obs32', when: 'front' }, { name: 'Loom', when: 'front' }, { name: 'ScreenToGif', when: 'front' },
    { name: 'CamRecorder', when: 'running' }, { name: 'CamtasiaStudio', when: 'front' }, { name: 'bdcam', when: 'front' }, { name: 'Clipchamp', when: 'front' },
    { name: 'ScreenClippingHost', when: 'running' },
  ],
  linux: [
    { name: 'obs', when: 'front' }, { name: 'simplescreenrecorder', when: 'front' }, { name: 'kazam', when: 'front' }, { name: 'peek', when: 'front' },
    { name: 'vokoscreenNG', when: 'front' }, { name: 'kooha', when: 'front' }, { name: 'gpu-screen-recorder', when: 'running' }, { name: 'wf-recorder', when: 'running' },
    { name: 'wl-screenrec', when: 'running' }, { name: 'recordmydesktop', when: 'running' },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/\.(exe|app)$/, '').trim();

/** Recorder apps among the running ones, and the one in front. */
export function recorderSources(os: StageOs, running: string[], front: string | undefined, extra: string[] = []): CaptureSource[] {
  const list = [...RECORDERS[os], ...extra.filter(Boolean).map((name) => ({ name, when: 'running' as const }))];
  const run = new Set(running.map(norm));
  const f = front ? norm(front) : '';
  const out: CaptureSource[] = [];
  for (const r of list) {
    const n = norm(r.name);
    if (r.when === 'running' && run.has(n)) out.push({ label: n === 'screencaptureui' ? 'The system’s screen recording is on' : `${r.name} is running`, reliable: false });
    else if (r.when === 'front' && f === n) out.push({ label: `${r.name} is in front`, reliable: false });
  }
  return out;
}

/** ffmpeg (or gstreamer) with a screen grabber on its command line. */
export function grabberSources(commandLines: string[]): CaptureSource[] {
  return commandLines.some((c) => /\b(x11grab|gdigrab|ddagrab|avfoundation|kmsgrab|ximagesrc|pipewiresrc)\b/.test(c) && /ffmpeg|gst-launch/.test(c))
    ? [{ label: 'A command-line screen recorder is running', reliable: false }]
    : [];
}

/** macOS window list from the helper: the system's own capture controls sit in the menu bar. */
export function macWindowSources(windows: { owner: string; layer: number }[]): CaptureSource[] {
  return windows.some((w) => /^(screencaptureui|Screenshot)$/.test(w.owner) && w.layer >= 20)
    ? [{ label: 'The system’s screen recording controls are showing', reliable: false }]
    : [];
}

// ---------------------------------------------------------------- deciding

export interface CaptureTracker { positives: number; negatives: number; active: boolean }

export const newTracker = (): CaptureTracker => ({ positives: 0, negatives: 0, active: false });

/**
 * One look. A reliable signal counts at once; a heuristic one needs two looks
 * in a row. Capture ends after three empty looks in a row, so a recorder that
 * briefly loses focus does not end Stage.
 */
export function track(t: CaptureTracker, sources: CaptureSource[]): CaptureTracker {
  if (sources.length) {
    const positives = t.positives + 1;
    return { positives, negatives: 0, active: t.active || sources.some((s) => s.reliable) || positives >= 2 };
  }
  const negatives = t.negatives + 1;
  return { positives: 0, negatives, active: t.active && negatives < 3 };
}

export function methodFor(os: StageOs): string {
  if (os === 'linux') return 'PipeWire screen-cast streams (reliable), Keeper’s recorder, and known recorder apps (a guess)';
  if (os === 'darwin') return 'Keeper’s recorder (reliable), the system’s capture controls and known recorder apps in front (a guess: macOS has no public signal)';
  return 'Keeper’s recorder (reliable) and known recorder apps (a guess: Windows has no public signal)';
}

export function captureView(os: StageOs, t: CaptureTracker, sources: CaptureSource[]): StageCapture {
  return { active: t.active, sources, method: methodFor(os) };
}
