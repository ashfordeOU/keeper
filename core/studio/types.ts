// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Studio: screen recordings that keep their raw parts apart (the picture
// without the pointer, the pointer's path, clicks and keys, the microphone,
// the computer's sound, the camera) and an editor that turns them into a
// finished video. A project is a folder: project.json (this file's shapes),
// events.json (the event log) and the tracks it names.

import type { Mod } from '../stage/overlay';

export const STUDIO_VERSION = 1;
export const PROJECT_EXT = '.keeperstudio';

export type CaptureMode = 'full' | 'window' | 'area';
/** what recorded the picture */
export type CaptureHow = 'screencapturekit' | 'ffmpeg' | 'browser' | 'fixture';

/**
 * Everything that happened while recording, in milliseconds from the
 * recording's start (pauses removed) and in the video's own pixels.
 */
export interface EventLog {
  /** pointer samples, flat: t, x, y, t, x, y … (about 60 a second while it moves) */
  moves: number[];
  clicks: { t: number; x: number; y: number; right?: boolean }[];
  keys: { t: number; key: string; mods: Mod[] }[];
  scrolls: { t: number; x: number; y: number; dy: number }[];
  /** the app (and window) in front changed */
  focus: { t: number; app: string; title?: string }[];
}

export interface TrackFile {
  /** file name inside the project folder */
  file: string;
  /** how long after the recording's start this track begins (ms; may be negative) */
  offset: number;
}

export interface ProjectMeta {
  createdAt: number;
  /** length of the screen track (ms) */
  duration: number;
  /** the screen track's pixels */
  width: number;
  height: number;
  fps: number;
  /** pixels per screen point (2 on a Retina display) */
  scale: number;
  platform: NodeJS.Platform | 'browser';
  mode: CaptureMode;
  how: CaptureHow;
  /** the system pointer is part of the picture (it could not be left out), so Studio draws none of its own by default */
  cursorInVideo: boolean;
  screen: TrackFile;
  mic?: TrackFile;
  system?: TrackFile;
  webcam?: TrackFile & { width?: number; height?: number };
  /** things the recording could not do here, said plainly in the editor */
  notes?: string[];
}

/** A kept part of the recording, in the screen track's time (ms). Clips never overlap and stay in order. */
export interface Clip { id: string; start: number; end: number; speed: number }

/** A zoom, in the screen track's time. */
export interface Zoom {
  id: string;
  start: number;
  end: number;
  /** 1 = no zoom; 2 = twice as close */
  scale: number;
  /** follow the pointer while zoomed, or hold on `x`, `y` */
  follow: boolean;
  /** fixed focus, 0–1 across the picture */
  x?: number;
  y?: number;
  /** made by the automatic zooms (replaced when they are made again) */
  auto?: boolean;
}

/** A part of the picture blurred for privacy, 0–1 across the picture, in the screen track's time. */
export interface BlurBox { id: string; start: number; end: number; x: number; y: number; w: number; h: number; auto?: boolean; label?: string }

export interface Caption { start: number; end: number; text: string }
export interface Chapter { t: number; title: string }

export interface Timeline {
  clips: Clip[];
  zooms: Zoom[];
  blurs: BlurBox[];
  captions: Caption[];
  chapters: Chapter[];
}

export type Aspect = 'source' | '16:9' | '9:16' | '1:1' | '4:5';

export type Background =
  | { kind: 'preset'; id: string }
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number };

export interface FrameStyle {
  background: Background;
  /** space around the picture, as a share of the frame's shorter side (0–0.25) */
  padding: number;
  /** corner radius at 1080 lines */
  radius: number;
  /** shadow strength 0–1 */
  shadow: number;
  /** a thin light edge around the picture, like a window's border */
  inset: boolean;
  aspect: Aspect;
  /** in a frame much narrower or wider than the recording, show the part around the pointer and follow it */
  reframe: boolean;
}

export interface CursorStyle {
  show: boolean;
  /** 1 = the size it was on screen */
  size: number;
  /** 0 = raw path, 1 = very smooth */
  smoothing: number;
  hideIdle: boolean;
  /** how long it stays still before fading out (ms) */
  idleMs: number;
  ripple: boolean;
  /** 0–1: blur on fast moves and on zoom pans */
  motionBlur: number;
  look: 'arrow' | 'dot';
}

export interface ZoomStyle {
  /** depth for automatic zooms */
  depth: number;
  /** ease in and out (ms) */
  ease: number;
}

export interface CameraStyle {
  show: boolean;
  shape: 'circle' | 'rounded' | 'square';
  /** share of the frame's shorter side */
  size: number;
  corner: 'br' | 'bl' | 'tr' | 'tl';
  /** moves to the other side when the pointer comes near */
  autoMove: boolean;
  mirror: boolean;
}

export interface AudioStyle {
  mic: boolean;
  system: boolean;
  /** even loudness (EBU R128) */
  normalize: boolean;
  /** gentle noise reduction on the microphone */
  denoise: boolean;
  micVolume: number;
  systemVolume: number;
}

export interface OverlayStyle {
  /** burn captions into the picture */
  captions: boolean;
  /** show keyboard shortcuts as badges */
  keys: boolean;
  /** only shortcuts (with ⌘, Ctrl or Alt), not ordinary typing */
  shortcutsOnly: boolean;
}

export interface StudioStyle {
  frame: FrameStyle;
  cursor: CursorStyle;
  zoom: ZoomStyle;
  camera: CameraStyle;
  audio: AudioStyle;
  overlay: OverlayStyle;
}

export interface StudioProject {
  version: number;
  id: string;
  name: string;
  meta: ProjectMeta;
  timeline: Timeline;
  style: StudioStyle;
  /** last saved */
  updatedAt: number;
}

/** A project in the recent list. */
export interface ProjectSummary {
  dir: string;
  id: string;
  name: string;
  duration: number;
  createdAt: number;
  updatedAt: number;
  width: number;
  height: number;
  thumb?: string;
}

export const emptyEvents = (): EventLog => ({ moves: [], clicks: [], keys: [], scrolls: [], focus: [] });

export function defaultStyle(): StudioStyle {
  return {
    frame: { background: { kind: 'preset', id: 'aurora' }, padding: 0.07, radius: 14, shadow: 0.6, inset: true, aspect: 'source', reframe: true },
    cursor: { show: true, size: 1.6, smoothing: 0.55, hideIdle: true, idleMs: 2500, ripple: true, motionBlur: 0.4, look: 'arrow' },
    zoom: { depth: 1.8, ease: 650 },
    camera: { show: true, shape: 'circle', size: 0.2, corner: 'br', autoMove: true, mirror: true },
    audio: { mic: true, system: true, normalize: true, denoise: true, micVolume: 1, systemVolume: 0.8 },
    overlay: { captions: false, keys: true, shortcutsOnly: true },
  };
}

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const ASPECTS: readonly Aspect[] = ['source', '16:9', '9:16', '1:1', '4:5'];

function normBackground(v: unknown): Background {
  const b = obj(v);
  if (b.kind === 'solid' && typeof b.color === 'string') return { kind: 'solid', color: b.color };
  if (b.kind === 'gradient' && typeof b.from === 'string' && typeof b.to === 'string') return { kind: 'gradient', from: b.from, to: b.to, angle: num(b.angle, 135) };
  if (b.kind === 'preset' && typeof b.id === 'string') return { kind: 'preset', id: b.id };
  return defaultStyle().frame.background;
}

/** Fills in anything missing or out of range, so older or hand-edited projects open. */
export function normalizeStyle(raw: unknown): StudioStyle {
  const d = defaultStyle();
  const r = obj(raw);
  const f = obj(r.frame), c = obj(r.cursor), z = obj(r.zoom), cam = obj(r.camera), a = obj(r.audio), o = obj(r.overlay);
  return {
    frame: {
      background: normBackground(f.background), padding: num(f.padding, d.frame.padding, 0, 0.25), radius: num(f.radius, d.frame.radius, 0, 80),
      shadow: num(f.shadow, d.frame.shadow, 0, 1), inset: bool(f.inset, d.frame.inset), aspect: oneOf(f.aspect, ASPECTS, d.frame.aspect), reframe: bool(f.reframe, d.frame.reframe),
    },
    cursor: {
      show: bool(c.show, d.cursor.show), size: num(c.size, d.cursor.size, 0.5, 4), smoothing: num(c.smoothing, d.cursor.smoothing, 0, 1), hideIdle: bool(c.hideIdle, d.cursor.hideIdle),
      idleMs: num(c.idleMs, d.cursor.idleMs, 500, 20000), ripple: bool(c.ripple, d.cursor.ripple), motionBlur: num(c.motionBlur, d.cursor.motionBlur, 0, 1), look: oneOf(c.look, ['arrow', 'dot'] as const, d.cursor.look),
    },
    zoom: { depth: num(z.depth, d.zoom.depth, 1.1, 4), ease: num(z.ease, d.zoom.ease, 150, 2000) },
    camera: {
      show: bool(cam.show, d.camera.show), shape: oneOf(cam.shape, ['circle', 'rounded', 'square'] as const, d.camera.shape), size: num(cam.size, d.camera.size, 0.08, 0.45),
      corner: oneOf(cam.corner, ['br', 'bl', 'tr', 'tl'] as const, d.camera.corner), autoMove: bool(cam.autoMove, d.camera.autoMove), mirror: bool(cam.mirror, d.camera.mirror),
    },
    audio: {
      mic: bool(a.mic, d.audio.mic), system: bool(a.system, d.audio.system), normalize: bool(a.normalize, d.audio.normalize), denoise: bool(a.denoise, d.audio.denoise),
      micVolume: num(a.micVolume, d.audio.micVolume, 0, 3), systemVolume: num(a.systemVolume, d.audio.systemVolume, 0, 3),
    },
    overlay: { captions: bool(o.captions, d.overlay.captions), keys: bool(o.keys, d.overlay.keys), shortcutsOnly: bool(o.shortcutsOnly, d.overlay.shortcutsOnly) },
  };
}

function arr<T>(v: unknown, f: (x: Record<string, unknown>) => T | null): T[] {
  return Array.isArray(v) ? v.map((x) => f(obj(x))).filter((x): x is T => x !== null) : [];
}

let seq = 0;
/** A short id for clips, zooms and blur boxes. */
export const newId = (p = 'x') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function normalizeTimeline(raw: unknown, duration: number): Timeline {
  const r = obj(raw);
  const span = (x: Record<string, unknown>) => {
    const start = num(x.start, 0, 0, duration);
    const end = num(x.end, duration, 0, duration);
    return end > start ? { start, end } : null;
  };
  let clips = arr(r.clips, (x) => { const s = span(x); return s ? { id: String(x.id ?? newId('c')), ...s, speed: num(x.speed, 1, 0.25, 16) } : null; });
  clips.sort((a, b) => a.start - b.start);
  clips = clips.filter((c, i) => i === 0 || c.start >= clips[i - 1].end);
  if (!clips.length && !Array.isArray(r.clips)) clips = [{ id: 'c0', start: 0, end: duration, speed: 1 }];
  return {
    clips,
    zooms: arr(r.zooms, (x) => { const s = span(x); return s ? { id: String(x.id ?? newId('z')), ...s, scale: num(x.scale, 1.8, 1, 5), follow: bool(x.follow, true), x: typeof x.x === 'number' ? num(x.x, 0.5, 0, 1) : undefined, y: typeof x.y === 'number' ? num(x.y, 0.5, 0, 1) : undefined, auto: x.auto === true || undefined } : null; }),
    blurs: arr(r.blurs, (x) => { const s = span(x); return s ? { id: String(x.id ?? newId('b')), ...s, x: num(x.x, 0, 0, 1), y: num(x.y, 0, 0, 1), w: num(x.w, 0.1, 0.005, 1), h: num(x.h, 0.05, 0.005, 1), auto: x.auto === true || undefined, label: typeof x.label === 'string' ? x.label : undefined } : null; }),
    captions: arr(r.captions, (x) => { const s = span(x); return s && typeof x.text === 'string' ? { ...s, text: x.text } : null; }),
    chapters: arr(r.chapters, (x) => (typeof x.title === 'string' ? { t: num(x.t, 0, 0, duration), title: x.title } : null)),
  };
}

export function normalizeEvents(raw: unknown): EventLog {
  const r = obj(raw);
  const moves = Array.isArray(r.moves) ? (r.moves as unknown[]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) : [];
  return {
    moves: moves.slice(0, moves.length - (moves.length % 3)),
    clicks: arr(r.clicks, (x) => (typeof x.t === 'number' && typeof x.x === 'number' && typeof x.y === 'number' ? { t: x.t, x: x.x, y: x.y, right: x.right === true || undefined } : null)),
    keys: arr(r.keys, (x) => (typeof x.t === 'number' && typeof x.key === 'string' ? { t: x.t, key: x.key, mods: Array.isArray(x.mods) ? (x.mods as Mod[]).filter((m) => ['cmd', 'ctrl', 'alt', 'shift'].includes(m)) : [] } : null)),
    scrolls: arr(r.scrolls, (x) => (typeof x.t === 'number' ? { t: x.t, x: num(x.x, 0), y: num(x.y, 0), dy: num(x.dy, 0) } : null)),
    focus: arr(r.focus, (x) => (typeof x.t === 'number' && typeof x.app === 'string' ? { t: x.t, app: x.app, title: typeof x.title === 'string' ? x.title : undefined } : null)),
  };
}

export function normalizeProject(raw: unknown): StudioProject | null {
  const r = obj(raw);
  const m = obj(r.meta);
  const screen = obj(m.screen);
  if (typeof screen.file !== 'string' || typeof m.duration !== 'number' || !(m.duration > 0)) return null;
  const track = (v: unknown): TrackFile | undefined => { const t = obj(v); return typeof t.file === 'string' ? { file: t.file, offset: num(t.offset, 0) } : undefined; };
  const duration = m.duration;
  const meta: ProjectMeta = {
    createdAt: num(m.createdAt, Date.now()), duration, width: num(m.width, 1920, 2), height: num(m.height, 1080, 2), fps: num(m.fps, 30, 1, 240), scale: num(m.scale, 1, 0.5, 4),
    platform: (typeof m.platform === 'string' ? m.platform : 'linux') as ProjectMeta['platform'], mode: oneOf(m.mode, ['full', 'window', 'area'] as const, 'full'),
    how: oneOf(m.how, ['screencapturekit', 'ffmpeg', 'browser', 'fixture'] as const, 'browser'), cursorInVideo: bool(m.cursorInVideo, false),
    screen: track(screen)!, mic: track(m.mic), system: track(m.system),
    webcam: track(m.webcam) ? { ...track(m.webcam)!, width: typeof obj(m.webcam).width === 'number' ? (obj(m.webcam).width as number) : undefined, height: typeof obj(m.webcam).height === 'number' ? (obj(m.webcam).height as number) : undefined } : undefined,
    notes: Array.isArray(m.notes) ? (m.notes as unknown[]).filter((n): n is string => typeof n === 'string') : undefined,
  };
  return {
    version: STUDIO_VERSION, id: typeof r.id === 'string' ? r.id : newId('p'), name: typeof r.name === 'string' && r.name.trim() ? r.name : 'Recording',
    meta, timeline: normalizeTimeline(r.timeline, duration), style: normalizeStyle(r.style), updatedAt: num(r.updatedAt, Date.now()),
  };
}
