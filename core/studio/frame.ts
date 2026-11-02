// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One frame of the finished video, worked out from the project: which moment
// of the recording, the view (zoom and pan), the pointer, ripples, blur boxes,
// captions, shortcut badges and the camera bubble. The preview and the export
// both draw exactly this, so what you see is what you get.

import { clickPress, cursorOpacity, movementTimes, ripplesAt, smoothPath, trackAt, type Ripple, type Track } from './cursor';
import { bubbleAt, bubbleMoves, frameLayout, toFrame, type BubbleMove, type FrameLayout, type Rect, type Size } from './layout';
import { badgeAt, captionAt, keyBadges, type Badge } from './overlays';
import { outToSrc } from './timeline';
import type { EventLog, StudioProject } from './types';
import { cameraPath, ease, viewAt, type CameraTrack, type View } from './zoom';

/** Everything worked out once per edit (not per frame). */
export interface Derived {
  layout: FrameLayout;
  cursor: Track;
  moved: number[];
  camera: CameraTrack;
  badges: Badge[];
  bubble: BubbleMove[];
  key: string;
}

/** A key for what the derived data depends on, to know when to work it out again. */
export function derivedKey(p: StudioProject, out: Size): string {
  return JSON.stringify([out, p.style.frame.aspect, p.style.frame.padding, p.style.frame.reframe, p.style.cursor.smoothing, p.style.zoom, p.timeline.zooms, p.style.camera, p.style.overlay.shortcutsOnly, p.meta.duration]);
}

export function derive(p: StudioProject, ev: EventLog, out: Size, mac: boolean): Derived {
  const src = { width: p.meta.width, height: p.meta.height };
  const layout = frameLayout(p.style.frame, src, out);
  const cursor = smoothPath(ev, p.meta.duration, p.style.cursor.smoothing);
  const camera = cameraPath(cursor, p.meta.duration, { zooms: p.timeline.zooms, easeMs: p.style.zoom.ease, width: src.width, height: src.height, baseW: layout.baseW, baseH: layout.baseH, reframe: layout.reframe });
  return {
    layout, cursor, camera, moved: movementTimes(ev),
    badges: keyBadges(ev, mac, p.style.overlay.shortcutsOnly),
    bubble: bubbleMoves(ev, src, p.style.camera),
    key: derivedKey(p, out),
  };
}

export interface CursorState {
  x: number; y: number; opacity: number;
  /** frame pixels per screen point of pointer (the pointer grows with the zoom) */
  scale: number;
  /** earlier positions for motion blur (frame pixels), oldest first */ trail: { x: number; y: number }[] }

export interface FrameState {
  /** the recording's moment (ms) */
  src: number;
  view: View;
  layout: FrameLayout;
  cursor: CursorState | null;
  ripples: (Ripple & { fx: number; fy: number })[];
  blurs: Rect[];
  caption: string | null;
  badge: { label: string; count: number; k: number } | null;
  bubble: Rect | null;
  /** earlier views for motion blur on fast pans */
  viewTrail: View[];
}

/** The state of the frame at a time of the finished video. */
export function frameAt(p: StudioProject, ev: EventLog, d: Derived, outMs: number, fps = 60, hasWebcam = false): FrameState {
  const src = outToSrc(p.timeline.clips, outMs);
  const size = { width: p.meta.width, height: p.meta.height, baseW: d.layout.baseW, baseH: d.layout.baseH };
  const view = viewAt(d.camera, src, size);
  const box = d.layout.box;
  const cs = p.style.cursor;
  // how far back the blur reaches: half a frame, in the recording's time (sped-up parts blur more)
  const clip = p.timeline.clips.find((c) => src >= c.start && src <= c.end);
  const span = (500 / fps) * (clip?.speed ?? 1) * cs.motionBlur;
  let cursor: CursorState | null = null;
  if (cs.show && !p.meta.cursorInVideo) {
    const c = trackAt(d.cursor, src);
    if (Number.isFinite(c.x)) {
      const f = toFrame(c, view, box);
      const trail: { x: number; y: number }[] = [];
      if (span > 0 && c.speed * view.scale > 900) {
        for (let k = 4; k >= 1; k--) { const q = trackAt(d.cursor, src - (span * k) / 4); trail.push(toFrame(q, view, box)); }
      }
      cursor = { x: f.x, y: f.y, opacity: cursorOpacity(d.moved, src, cs), scale: cs.size * clickPress(ev, src) * p.meta.scale * (box.w / view.w), trail };
    }
  }
  const ripples = cs.ripple && cs.show ? ripplesAt(ev, src).map((r) => { const f = toFrame(r, view, box); return { ...r, fx: f.x, fy: f.y }; }) : [];
  const blurs: Rect[] = [];
  for (const b of p.timeline.blurs) {
    if (src < b.start || src > b.end) continue;
    const a = toFrame({ x: b.x * p.meta.width, y: b.y * p.meta.height }, view, box);
    const z = toFrame({ x: (b.x + b.w) * p.meta.width, y: (b.y + b.h) * p.meta.height }, view, box);
    blurs.push({ x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y });
  }
  const viewTrail: View[] = [];
  if (cs.motionBlur > 0 && view.pan > 1400) {
    for (let k = 3; k >= 1; k--) viewTrail.push(viewAt(d.camera, src - (span * k) / 3, size));
  }
  const cap = p.style.overlay.captions ? captionAt(p.timeline.captions, src) : null;
  const badge = p.style.overlay.keys ? badgeAt(d.badges, src) : null;
  return {
    src, view, layout: d.layout, cursor, ripples, blurs,
    caption: cap?.text ?? null,
    badge: badge ? { label: badge.label, count: badge.count, k: badge.k } : null,
    bubble: hasWebcam && p.style.camera.show ? bubbleAt(d.bubble, p.style.camera, d.layout.out, src, ease) : null,
    viewTrail,
  };
}
