// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// How the Island opens and closes (pure; src/island/Island.tsx drives it):
// the pointer arrives and the shape "breathes" (grows a little) at once, then
// opens after a short rest unless the pointer was only sweeping along the menu
// bar; it closes a moment after the pointer leaves, never while a menu is open,
// a field has the keyboard, something is dragged or a button is held. Which
// spring each change uses is chosen here too.

/** Rest on the Island this long before it opens (the setting's default; it ranges 0–1000 ms). */
export const HOVER_DWELL_MS = 140;
/** The default before the open model (settings from then that still say this get the new default once). */
export const OLD_HOVER_DWELL_MS = 250;
/** After the pointer leaves, the open Island waits this long before closing (coming back cancels it). */
export const CLOSE_GRACE_MS = 220;
/** Closing: the content fades out this long before the shape starts to shrink. */
export const CONTENT_FADE_OUT_MS = 80;
/** Opening: the content fades in over this long, from when the shape is this far open. */
export const CONTENT_FADE_IN_MS = 160;
export const CONTENT_REVEAL_AT = 0.6;
/** Moving across faster than this (px per ms, mostly sideways) is a sweep along the menu bar, not a visit. */
export const SWEEP_PX_PER_MS = 1.2;
/** How much the shape grows while the pointer rests on it (pt at scale 1): wider and taller. */
export const BREATH = { w: 12, h: 6 } as const;

export interface PointerSample { x: number; y: number; t: number }

/** Keeps the last few pointer positions (newest last), dropping ones older than `keepMs`. */
export function addSample(samples: PointerSample[], s: PointerSample, keepMs = 120, max = 8): PointerSample[] {
  const out = samples.filter((p) => s.t - p.t <= keepMs && p.t <= s.t);
  out.push(s);
  return out.length > max ? out.slice(out.length - max) : out;
}

/** The pointer's sideways speed over the last `windowMs` (px per ms), and whether it moved mostly sideways. */
export function sideways(samples: readonly PointerSample[], now: number, windowMs = 80): { speed: number; mostlySideways: boolean } {
  const recent = samples.filter((p) => now - p.t <= windowMs);
  if (recent.length < 2) return { speed: 0, mostlySideways: false };
  const a = recent[0];
  const b = recent[recent.length - 1];
  const dt = Math.max(1, b.t - a.t);
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return { speed: dx / dt, mostlySideways: dx > 2 * dy };
}

/** The pointer is passing along the menu bar: show the breath, but do not open. */
export function isSweep(samples: readonly PointerSample[], now: number): boolean {
  const s = sideways(samples, now);
  return s.mostlySideways && s.speed > SWEEP_PX_PER_MS;
}

/** What keeps the open Island open after the pointer left. */
export interface Holds {
  menuOpen?: boolean;
  fieldFocused?: boolean;
  dragging?: boolean;
  pressed?: boolean;
}

/** Whether the open Island may close now that the pointer has left (and the grace has passed). */
export function mayClose(h: Holds): boolean {
  return !(h.menuOpen || h.fieldFocused || h.dragging || h.pressed);
}

export type IslandView = 'compact' | 'alert' | 'live' | 'panel';
export type Motion = 'breath' | 'open' | 'close' | 'view' | 'wing' | 'live';

/**
 * Which spring a change of shape uses: opening (from the closed pill), closing (no bounce), one view's size
 * to another's, the closed wings changing (or the breath), and a card or alert.
 */
export function motionFor(from: { view: IslandView; breath?: boolean }, to: { view: IslandView; breath?: boolean }): Motion {
  if (from.view === 'compact' && to.view === 'compact') return from.breath !== to.breath ? 'breath' : 'wing';
  if (to.view === 'compact') return 'close';
  if (from.view === 'compact') return to.view === 'panel' ? 'open' : 'live';
  if (from.view === to.view) return 'view';
  return to.view === 'panel' ? 'open' : 'live';
}

/** How far a box has gone from where it started to its target (0–1), along the side that changes most. */
export function progressOf(from: { w: number; h: number }, to: { w: number; h: number }, now: { w: number; h: number }): number {
  const dh = to.h - from.h;
  const dw = to.w - from.w;
  const [d, x0, x] = Math.abs(dh) >= Math.abs(dw) ? [dh, from.h, now.h] : [dw, from.w, now.w];
  if (Math.abs(d) < 0.5) return 1;
  return Math.max(0, Math.min(1, (x - x0) / d));
}

/**
 * The hover delay from settings: settings from before the open model that still have the old default
 * (250 ms) get the new one (140 ms) once; a delay the person chose is kept.
 */
export function migrateHoverDelay(v: unknown, fromBefore: boolean): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1000, Math.round(v))) : HOVER_DWELL_MS;
  return fromBefore && n === OLD_HOVER_DWELL_MS ? HOVER_DWELL_MS : n;
}
