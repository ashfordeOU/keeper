// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where things sit in the finished frame: its size for an aspect and a
// resolution, the picture inside the padding, the part of the recording that
// fits it, and the camera bubble (which moves out of the pointer's way).

import type { Aspect, CameraStyle, EventLog, FrameStyle } from './types';

export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; w: number; h: number }

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function aspectRatio(a: Aspect, src: Size): number {
  switch (a) {
    case '16:9': return 16 / 9;
    case '9:16': return 9 / 16;
    case '1:1': return 1;
    case '4:5': return 4 / 5;
    default: return src.width / src.height;
  }
}

/** The finished video's size: `lines` is the shorter side (720, 1080, 2160). */
export function outputSize(a: Aspect, src: Size, lines: number): Size {
  const r = aspectRatio(a, src);
  return r >= 1 ? { width: even(lines * r), height: even(lines) } : { width: even(lines), height: even(lines / r) };
}

export interface FrameLayout {
  out: Size;
  /** where the picture goes in the frame */
  box: Rect;
  /** the part of the recording shown at no zoom */
  baseW: number;
  baseH: number;
  /** reframing: the view follows the pointer even with no zoom */
  reframe: boolean;
  /** corner radius in output pixels */
  radius: number;
  /** 1 at 1080 lines */
  unit: number;
}

export function frameLayout(style: FrameStyle, src: Size, out: Size): FrameLayout {
  const unit = Math.min(out.width, out.height) / 1080;
  const pad = Math.round(style.padding * Math.min(out.width, out.height));
  const inner: Rect = { x: pad, y: pad, w: out.width - pad * 2, h: out.height - pad * 2 };
  const srcR = src.width / src.height, innerR = inner.w / inner.h;
  // Reframe when the frame's shape is far from the recording's (a tall frame for a wide screen).
  const reframe = style.reframe && Math.abs(Math.log(srcR / innerR)) > Math.log(1.25);
  let box: Rect, baseW = src.width, baseH = src.height;
  if (reframe) {
    box = inner;
    if (innerR < srcR) { baseH = src.height; baseW = src.height * innerR; } else { baseW = src.width; baseH = src.width / innerR; }
  } else if (innerR > srcR) {
    const w = inner.h * srcR;
    box = { x: inner.x + (inner.w - w) / 2, y: inner.y, w, h: inner.h };
  } else {
    const h = inner.w / srcR;
    box = { x: inner.x, y: inner.y + (inner.h - h) / 2, w: inner.w, h };
  }
  return { out, box, baseW, baseH, reframe, radius: style.radius * unit, unit };
}

export type Corner = CameraStyle['corner'];

/** The camera bubble's square in the frame for a corner. */
export function bubbleRect(cam: CameraStyle, out: Size, corner: Corner): Rect {
  const s = Math.round(cam.size * Math.min(out.width, out.height));
  const m = Math.round(Math.min(out.width, out.height) * 0.035);
  const x = corner.endsWith('l') ? m : out.width - s - m;
  const y = corner.startsWith('t') ? m : out.height - s - m;
  return { x, y, w: s, h: s };
}

const flip = (c: Corner): Corner => (c.endsWith('r') ? (c[0] + 'l') : (c[0] + 'r')) as Corner;

export interface BubbleMove { t: number; corner: Corner }

/**
 * When the camera bubble moves: the pointer coming into its corner of the
 * screen sends it to the other side, and it stays there at least 2 s.
 */
export function bubbleMoves(ev: EventLog, src: Size, cam: CameraStyle): BubbleMove[] {
  const moves: BubbleMove[] = [{ t: 0, corner: cam.corner }];
  if (!cam.autoMove) return moves;
  let cur = cam.corner;
  let since = -Infinity;
  const near = (c: Corner, x: number, y: number) => {
    const nx = x / src.width, ny = y / src.height;
    const zone = cam.size * 1.6 + 0.05;
    return (c.endsWith('l') ? nx < zone : nx > 1 - zone) && (c.startsWith('t') ? ny < zone * 1.6 : ny > 1 - zone * 1.6);
  };
  const m = ev.moves;
  for (let i = 0; i < m.length; i += 3) {
    const t = m[i];
    if (t - since < 2000) continue;
    if (near(cur, m[i + 1], m[i + 2])) {
      const next = cur === cam.corner ? flip(cam.corner) : cam.corner;
      if (near(next, m[i + 1], m[i + 2])) continue;
      cur = next;
      since = t;
      moves.push({ t, corner: cur });
    }
  }
  return moves;
}

export const BUBBLE_MOVE_MS = 450;

/** The bubble's square at time t, gliding between corners. */
export function bubbleAt(moves: BubbleMove[], cam: CameraStyle, out: Size, t: number, ease: (k: number) => number): Rect {
  let i = 0;
  while (i + 1 < moves.length && moves[i + 1].t <= t) i++;
  const to = bubbleRect(cam, out, moves[i].corner);
  if (i === 0) return to;
  const k = (t - moves[i].t) / BUBBLE_MOVE_MS;
  if (k >= 1) return to;
  const from = bubbleRect(cam, out, moves[i - 1].corner);
  const e = ease(k);
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: to.w, h: to.h };
}

/** Maps a point in the recording into the frame for a view. */
export function toFrame(p: { x: number; y: number }, view: Rect, box: Rect): { x: number; y: number } {
  return { x: box.x + ((p.x - view.x) / view.w) * box.w, y: box.y + ((p.y - view.y) / view.h) * box.h };
}
