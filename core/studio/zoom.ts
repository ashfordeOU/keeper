// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Zooms: made automatically from where the clicking and typing happen, and the
// camera that carries them out. The camera eases in and out of each zoom,
// follows the pointer while zoomed (only once it nears the edge of the view,
// so the picture is not always moving), and in a tall or square frame keeps
// the part of the screen around the pointer in view.

import { springStep, TRACK_HZ, trackAt, type Track } from './cursor';
import { newId, type EventLog, type Zoom } from './types';

export interface AutoZoomOptions {
  /** how close (1 = none) */
  depth: number;
  /** events further apart than this start a new zoom (ms) */
  gap?: number;
  /** zoom in this long before the first event (ms) */
  lead?: number;
  /** stay this long after the last event (ms) */
  hold?: number;
  /** shortest zoom (ms) */
  minLength?: number;
  /** ignore typing (only clicks) */
  clicksOnly?: boolean;
}

interface Act { t: number; x: number; y: number; kind: 'click' | 'key' }

/** Typing that is not a shortcut, as activity at the pointer's spot. */
function activity(ev: EventLog, clicksOnly: boolean, pointerAt: (t: number) => [number, number]): Act[] {
  const acts: Act[] = ev.clicks.filter((c) => !c.right).map((c) => ({ t: c.t, x: c.x, y: c.y, kind: 'click' as const }));
  if (!clicksOnly) {
    // a run of at least 3 keys within 1.5 s each is typing
    const keys = ev.keys.filter((k) => !k.mods.some((m) => m === 'cmd' || m === 'ctrl'));
    let run: typeof keys = [];
    const flush = () => {
      if (run.length >= 3) for (const k of run) { const [x, y] = pointerAt(k.t); if (Number.isFinite(x)) acts.push({ t: k.t, x, y, kind: 'key' }); }
      run = [];
    };
    for (const k of keys) { if (run.length && k.t - run[run.length - 1].t > 1500) flush(); run.push(k); }
    flush();
  }
  return acts.sort((a, b) => a.t - b.t);
}

/**
 * Zooms from the event log: clicks and typing close together in time make one
 * zoom, from a little before the first to a while after the last.
 */
export function autoZooms(ev: EventLog, duration: number, size: { width: number; height: number }, o: AutoZoomOptions, pointerAt: (t: number) => [number, number] = () => [NaN, NaN]): Zoom[] {
  const gap = o.gap ?? 2600, lead = o.lead ?? 700, hold = o.hold ?? 1600, minLength = o.minLength ?? 1800;
  const acts = activity(ev, !!o.clicksOnly, pointerAt);
  const groups: Act[][] = [];
  for (const a of acts) {
    const g = groups[groups.length - 1];
    // a click far across the screen right after another still joins: the camera pans there
    if (g && a.t - g[g.length - 1].t <= gap) g.push(a);
    else groups.push([a]);
  }
  const zooms: Zoom[] = [];
  for (const g of groups) {
    let start = Math.max(0, g[0].t - lead);
    let end = Math.min(duration, g[g.length - 1].t + hold);
    if (end - start < minLength) end = Math.min(duration, start + minLength);
    if (end - start < 400) continue;
    const prev = zooms[zooms.length - 1];
    if (prev && start - prev.end < 900) { prev.end = Math.max(prev.end, end); continue; }
    start = prev ? Math.max(start, prev.end) : start;
    // spread out (a wide area of clicks) zooms less, so it all stays in view
    const xs = g.map((a) => a.x), ys = g.map((a) => a.y);
    const spread = Math.max((Math.max(...xs) - Math.min(...xs)) / size.width, (Math.max(...ys) - Math.min(...ys)) / size.height);
    const scale = Math.max(1.25, Math.min(o.depth, 1 / Math.max(0.2, spread + 0.25)));
    const typing = g.every((a) => a.kind === 'key');
    zooms.push({ id: newId('z'), start, end, scale: +(typing ? Math.min(scale, Math.max(1.25, o.depth * 0.85)) : scale).toFixed(2), follow: true, auto: true });
  }
  return zooms;
}

/** smootherstep: eases in and out with no jolt at either end. */
export const ease = (k: number) => { const x = Math.min(1, Math.max(0, k)); return x * x * x * (x * (x * 6 - 15) + 10); };

/** How far into a zoom at time t: its scale, and 0–1 of the way in. */
export function zoomLevel(zooms: Zoom[], t: number, easeMs: number): { scale: number; k: number; zoom: Zoom | null } {
  let best: { scale: number; k: number; zoom: Zoom | null } = { scale: 1, k: 0, zoom: null };
  for (const z of zooms) {
    if (t < z.start || t > z.end) continue;
    const len = z.end - z.start;
    const e = Math.min(easeMs, len / 2);
    const k = ease(Math.min((t - z.start) / e, (z.end - t) / e, 1));
    const scale = 1 + (z.scale - 1) * k;
    if (scale > best.scale) best = { scale, k, zoom: z };
  }
  return best;
}

export interface CameraTrack {
  /** center x, center y, scale per step (in recording pixels) */
  data: Float32Array;
  steps: number;
}

export interface CameraInput {
  zooms: Zoom[];
  easeMs: number;
  /** recording size */
  width: number;
  height: number;
  /** the part of the recording the frame shows at no zoom (smaller than the recording when reframing) */
  baseW: number;
  baseH: number;
  /** follow the pointer even with no zoom (reframing a tall or square frame) */
  reframe: boolean;
}

/**
 * Works out the camera for the whole recording: where it looks and how close.
 * The look point is a spring that chases the pointer once it leaves the
 * middle of the view, or a zoom's fixed spot.
 */
export function cameraPath(cursor: Track, duration: number, c: CameraInput): CameraTrack {
  const DT = 1000 / TRACK_HZ;
  const steps = Math.max(1, Math.ceil(duration / DT) + 1);
  const data = new Float32Array(steps * 3);
  let cx = c.width / 2, cy = c.height / 2, vx = 0, vy = 0;
  const omega = 6;
  for (let s = 0; s < steps; s++) {
    const t = s * DT;
    const { scale, zoom } = zoomLevel(c.zooms, t, c.easeMs);
    const vw = c.baseW / scale, vh = c.baseH / scale;
    let tx = cx, ty = cy;
    const p = trackAt(cursor, t);
    const pointer = Number.isFinite(p.x);
    if (zoom && !zoom.follow && zoom.x !== undefined && zoom.y !== undefined) {
      tx = zoom.x * c.width; ty = zoom.y * c.height;
    } else if (pointer && (zoom || c.reframe)) {
      // only chase once the pointer is outside the middle 50% of the view
      const dx = p.x - cx, dy = p.y - cy;
      const mx = vw * 0.25, my = vh * 0.25;
      tx = Math.abs(dx) > mx ? p.x - Math.sign(dx) * mx : cx;
      ty = Math.abs(dy) > my ? p.y - Math.sign(dy) * my : cy;
      // entering a zoom: aim straight at the pointer
      if (zoom && t - zoom.start < c.easeMs) { const w = 1 - (t - zoom.start) / c.easeMs; tx += (p.x - tx) * w; ty += (p.y - ty) * w; }
    } else if (!c.reframe) {
      tx = c.width / 2; ty = c.height / 2;
    }
    for (let k = 0; k < 2; k++) {
      [cx, vx] = springStep(cx, vx, tx, omega, DT / 2000);
      [cy, vy] = springStep(cy, vy, ty, omega, DT / 2000);
    }
    data[s * 3] = cx; data[s * 3 + 1] = cy; data[s * 3 + 2] = scale;
  }
  return { data, steps };
}

export interface View {
  /** the part of the recording shown, in recording pixels */
  x: number; y: number; w: number; h: number;
  scale: number;
  /** how fast the view is moving (recording pixels per second), for motion blur */
  pan: number;
}

/** The part of the recording in view at time t, kept inside the recording. */
export function viewAt(cam: CameraTrack, t: number, c: Pick<CameraInput, 'width' | 'height' | 'baseW' | 'baseH'>): View {
  const DT = 1000 / TRACK_HZ;
  const f = Math.min(cam.steps - 1, Math.max(0, t / DT));
  const i = Math.floor(f), j = Math.min(cam.steps - 1, i + 1), k = f - i;
  const at = (n: number, o: number) => cam.data[n * 3 + o];
  const cx = at(i, 0) + (at(j, 0) - at(i, 0)) * k;
  const cy = at(i, 1) + (at(j, 1) - at(i, 1)) * k;
  const scale = at(i, 2) + (at(j, 2) - at(i, 2)) * k;
  const w = c.baseW / scale, h = c.baseH / scale;
  const x = Math.min(c.width - w, Math.max(0, cx - w / 2));
  const y = Math.min(c.height - h, Math.max(0, cy - h / 2));
  const p = Math.max(0, i - 1);
  const pan = Math.hypot(at(j, 0) - at(p, 0), at(j, 1) - at(p, 1)) * TRACK_HZ / Math.max(1, j - p) * scale;
  return { x, y, w, h, scale, pan };
}
