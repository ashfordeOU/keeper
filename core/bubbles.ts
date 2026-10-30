// SPDX-License-Identifier: AGPL-3.0-or-later
// The Space Map's bubble view: circles sized by folder size, packed into a
// box, with a tiny physics step so bubbles can be dragged, thrown and bump.

export interface Bubble<T = unknown> {
  item: T;
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  /** being dragged: physics leaves it where the pointer puts it */
  held?: boolean;
}

/**
 * Radii proportional to the square root of size (so area matches size),
 * scaled so the circles fill about `fill` of the box, then placed on a
 * spiral from the centre, biggest first, without overlapping.
 */
export function packBubbles<T>(items: { size: number; item: T }[], w: number, h: number, fill = 0.5): Bubble<T>[] {
  const list = items.filter((i) => i.size > 0).sort((a, b) => b.size - a.size);
  if (!list.length || w <= 0 || h <= 0) return [];
  const total = list.reduce((n, i) => n + i.size, 0);
  // If the greedy spiral cannot fit everything, shrink a little and try again.
  for (let scale = 1; scale > 0.2; scale *= 0.9) {
    const k = Math.sqrt((w * h * fill * scale) / (Math.PI * total));
    const minR = Math.min(w, h) * 0.03 * Math.sqrt(scale);
    const placed: Bubble<T>[] = [];
    let ok = true;
    for (const it of list) {
      const r = Math.min(Math.max(minR, Math.sqrt(it.size) * k), Math.min(w, h) / 2 - 1);
      let spot: { x: number; y: number } | undefined;
      for (let step = 0; step < 6000 && !spot; step++) {
        const a = step * 0.3;
        const d = step * 0.8;
        const x = clamp(w / 2 + Math.cos(a) * d, r, w - r);
        const y = clamp(h / 2 + Math.sin(a) * d * (h / w), r, h - r);
        if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + r + 2)) spot = { x, y };
      }
      if (!spot) {
        ok = false;
        break;
      }
      placed.push({ item: it.item, x: spot.x, y: spot.y, r, vx: 0, vy: 0 });
    }
    if (ok) return placed;
  }
  return [];
}

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

/**
 * One physics tick: move by velocity, apply friction, bounce off walls, and push overlapping bubbles apart (elastic-ish).
 * Returns true while anything is still moving noticeably.
 */
export function stepBubbles<T>(bs: Bubble<T>[], w: number, h: number, dt = 1): boolean {
  let moving = false;
  for (const b of bs) {
    if (b.held) continue;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vx *= 0.94;
    b.vy *= 0.94;
    if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.7; }
    if (b.x > w - b.r) { b.x = w - b.r; b.vx = -Math.abs(b.vx) * 0.7; }
    if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.7; }
    if (b.y > h - b.r) { b.y = h - b.r; b.vy = -Math.abs(b.vy) * 0.7; }
    if (Math.abs(b.vx) + Math.abs(b.vy) > 0.05) moving = true;
    else {
      b.vx = 0;
      b.vy = 0;
    }
  }
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i];
      const b = bs[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const overlap = a.r + b.r + 1 - dist;
      if (overlap <= 0) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      // Heavier (bigger) bubbles move less.
      const ma = a.r * a.r;
      const mb = b.r * b.r;
      const sa = a.held ? 0 : b.held ? 1 : mb / (ma + mb);
      const sb = b.held ? 0 : a.held ? 1 : ma / (ma + mb);
      a.x -= nx * overlap * sa;
      a.y -= ny * overlap * sa;
      b.x += nx * overlap * sb;
      b.y += ny * overlap * sb;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) {
        const imp = -rel * 0.9;
        if (!a.held) { a.vx -= nx * imp * sa; a.vy -= ny * imp * sa; }
        if (!b.held) { b.vx += nx * imp * sb; b.vy += ny * imp * sb; }
      }
      if (overlap > 0.5) moving = true;
    }
  }
  return moving;
}

export function bubbleAt<T>(bs: Bubble<T>[], x: number, y: number): Bubble<T> | undefined {
  for (let i = bs.length - 1; i >= 0; i--) if (Math.hypot(bs[i].x - x, bs[i].y - y) <= bs[i].r) return bs[i];
  return undefined;
}
