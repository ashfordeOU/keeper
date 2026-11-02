// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What the Studio page asks of the main process (window.keeper.studio).

import type { ExportPlan, ExportSettings } from './export';
import type { PacketIndex } from './packets';
import type { BlurBox, Caption, CaptureHow, CaptureMode, Clip, EventLog, ProjectSummary, StudioProject } from './types';

export interface StudioOptions {
  mode: CaptureMode;
  mic: boolean;
  micId?: string;
  webcam: boolean;
  camId?: string;
  systemAudio: boolean;
  fps: 30 | 60;
  countdown: number;
  /** clean the screen with Stage before recording */
  stage: boolean;
  /** move Keeper's window out of the way while recording */
  hideWindow: boolean;
  /** where projects go (empty: Videos › Keeper Studio) */
  folder: string;
  /** project folders opened before, newest first */
  recent: string[];
  /** global shortcut to start and stop */
  shortcut: string;
  /** global shortcut to pause and resume */
  pauseShortcut: string;
  lastExport?: Partial<ExportSettings>;
}

/** Record and pause from anywhere. ⌘⇧2 / Ctrl+Shift+2 is Copy text from screen's, and ⌘⇧3 is the Mac's own screenshot key. */
export const STUDIO_SHORTCUT = 'CommandOrControl+Shift+9';
export const STUDIO_PAUSE_SHORTCUT = 'CommandOrControl+Shift+0';
/** The defaults before 1.0.0, which clashed with those keys: options still holding them move to the new ones. */
const OLD_DEFAULTS: Record<string, string> = { 'CommandOrControl+Shift+2': STUDIO_SHORTCUT, 'CommandOrControl+Shift+3': STUDIO_PAUSE_SHORTCUT };

export function defaultStudioOptions(): StudioOptions {
  return { mode: 'full', mic: true, webcam: false, systemAudio: false, fps: 60, countdown: 3, stage: false, hideWindow: true, folder: '', recent: [], shortcut: STUDIO_SHORTCUT, pauseShortcut: STUDIO_PAUSE_SHORTCUT };
}

export function normalizeStudioOptions(raw: unknown): StudioOptions {
  const d = defaultStudioOptions();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<StudioOptions>;
  return {
    mode: (['full', 'window', 'area'] as const).includes(r.mode as CaptureMode) ? (r.mode as CaptureMode) : d.mode,
    mic: typeof r.mic === 'boolean' ? r.mic : d.mic,
    micId: typeof r.micId === 'string' ? r.micId : undefined,
    webcam: typeof r.webcam === 'boolean' ? r.webcam : d.webcam,
    camId: typeof r.camId === 'string' ? r.camId : undefined,
    systemAudio: typeof r.systemAudio === 'boolean' ? r.systemAudio : d.systemAudio,
    fps: r.fps === 30 ? 30 : 60,
    countdown: typeof r.countdown === 'number' ? Math.max(0, Math.min(10, Math.round(r.countdown))) : d.countdown,
    stage: typeof r.stage === 'boolean' ? r.stage : d.stage,
    hideWindow: typeof r.hideWindow === 'boolean' ? r.hideWindow : d.hideWindow,
    folder: typeof r.folder === 'string' ? r.folder : '',
    recent: Array.isArray(r.recent) ? r.recent.filter((x): x is string => typeof x === 'string').slice(0, 40) : [],
    shortcut: typeof r.shortcut === 'string' ? (r.shortcut === 'CommandOrControl+Shift+2' ? OLD_DEFAULTS[r.shortcut] : r.shortcut) : d.shortcut,
    pauseShortcut: typeof r.pauseShortcut === 'string' ? (r.pauseShortcut === 'CommandOrControl+Shift+3' ? OLD_DEFAULTS[r.pauseShortcut] : r.pauseShortcut) : d.pauseShortcut,
    lastExport: r.lastExport && typeof r.lastExport === 'object' ? r.lastExport : undefined,
  };
}

export type RecordPhase = 'idle' | 'picking' | 'countdown' | 'recording' | 'paused' | 'saving';

export interface StudioRecordState {
  phase: RecordPhase;
  /** when recording started (wall clock) */
  since?: number;
  /** recorded so far, pauses left out (ms) */
  elapsed?: number;
  countdown?: number;
  how?: CaptureHow;
  /** the project just saved */
  project?: string;
  error?: string;
  notes?: string[];
}

export interface StudioSupport {
  platform: string;
  /** how the screen will be recorded here and whether the pointer is left out of the picture */
  screen: { how: CaptureHow; cursorHidden: boolean; note?: string };
  /** clicks and keys for zooms and badges */
  input: { clicks: boolean; keys: boolean; note?: string };
  systemAudio: boolean;
  /** the bundled ffmpeg is there (needed to record on Windows and Linux, and to export) */
  ffmpeg: boolean;
  wayland: boolean;
}

export interface ExportJob {
  id: string;
  dir: string;
  phase: 'preparing' | 'rendering' | 'finishing' | 'done' | 'error' | 'cancelled';
  progress: number;
  frames: number;
  done: number;
  /** frames rendered per second */
  speed?: number;
  path?: string;
  /** the .srt written beside it */
  srt?: string;
  error?: string;
  startedAt: number;
}

/** What the hidden export page needs for one job. */
export interface ExportWork {
  id: string;
  project: StudioProject;
  events: EventLog;
  plan: ExportPlan;
  mac: boolean;
  screen: { index: PacketIndex; url: string };
  webcam?: { index: PacketIndex; url: string; offset: number };
}

export interface OpenedProject {
  dir: string;
  project: StudioProject;
  events: EventLog;
  urls: { screen: string; mic?: string; system?: string; webcam?: string };
}

export interface StudioApi {
  support(): Promise<StudioSupport>;
  options(): Promise<StudioOptions>;
  setOptions(patch: Partial<StudioOptions>): Promise<StudioOptions>;
  state(): Promise<StudioRecordState>;
  /** starts a recording (picking a window or area first if the mode asks) */
  record(o?: Partial<StudioOptions>): Promise<StudioRecordState>;
  pause(): Promise<StudioRecordState>;
  resume(): Promise<StudioRecordState>;
  /** stops and saves; the state names the new project */
  stop(): Promise<StudioRecordState>;
  /** stops and throws the recording away */
  discard(): Promise<StudioRecordState>;
  projects(): Promise<ProjectSummary[]>;
  open(dir: string): Promise<OpenedProject>;
  save(dir: string, project: StudioProject): Promise<void>;
  remove(dir: string): Promise<void>;
  reveal(dir: string): Promise<void>;
  /** opens a project folder chosen in a dialog */
  pick(): Promise<string | null>;
  /** microphone loudness every `stepMs`, for finding silences */
  levels(dir: string): Promise<{ stepMs: number; levels: number[] }>;
  /** captions from the microphone, made on this computer */
  transcribe(dir: string, o?: { language?: string }): Promise<Caption[]>;
  /** looks for email addresses, keys and tokens on screen */
  privacyScan(dir: string, clips: Clip[]): Promise<BlurBox[]>;
  /** `can`: what the page's video encoder can make (H.264, VP9) at this size */
  export(dir: string, project: StudioProject, settings: Partial<ExportSettings>, can?: { h264: boolean; vp9: boolean }): Promise<ExportJob>;
  exportState(id: string): Promise<ExportJob | null>;
  cancelExport(id: string): Promise<void>;
  copyFile(p: string): Promise<void>;
  revealFile(p: string): Promise<void>;
  // the hidden export page
  work(id: string): Promise<ExportWork>;
  workChunk(id: string, data: ArrayBuffer): Promise<void>;
  workProgress(id: string, done: number): Promise<{ cancelled: boolean }>;
  workDone(id: string, error?: string): Promise<void>;
}
