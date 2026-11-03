// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The website's device motion: how far the hero laptop leans with the pointer and the
// scroll, and which picture a slideshow shows next. Pure: used by site.js in the browser and
// by test/site.test.ts. None of it runs under prefers-reduced-motion.

/** The most the hero laptop leans, in degrees. */
export const MAX_TILT = 3;
/** How long a slideshow picture stays, in milliseconds. */
export const SLIDE_MS = 4200;

export const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : (lo + hi) / 2);
const round = (v) => Math.round(v * 100) / 100 || 0;

/**
 * How far the hero has scrolled out of view: 0 while its top is in place, 1 once it has
 * moved up by its own height.
 */
export function scrolled(top, height) {
  if (!(height > 0)) return 0;
  return clamp(-top / height, 0, 1);
}

/**
 * The lean of the hero laptop. The pointer turns it a little towards itself (left and right,
 * up and down); scrolling away tips it back. Never more than `max` degrees either way.
 * @param {{ x?: number|null, y?: number|null, rect: { left: number, top: number, width: number, height: number }, scroll?: number, max?: number }} p
 * @returns {{ rx: number, ry: number }} degrees around the horizontal and vertical axes
 */
export function tilt({ x = null, y = null, rect, scroll = 0, max = MAX_TILT }) {
  let nx = 0;
  let ny = 0;
  if (x != null && y != null && rect && rect.width > 0 && rect.height > 0) {
    nx = clamp(((x - rect.left) / rect.width) * 2 - 1, -1, 1);
    ny = clamp(((y - rect.top) / rect.height) * 2 - 1, -1, 1);
  }
  const ry = clamp(nx * max, -max, max);
  const rx = clamp(-ny * max * 0.6 + clamp(scroll, 0, 1) * max, -max, max);
  return { rx: round(rx), ry: round(ry) };
}

/** The slide after `i` (or before, with step -1) in a show of `n`, going round. */
export function nextSlide(i, n, step = 1) {
  if (!(n > 0)) return 0;
  return (((Math.trunc(i) || 0) + step) % n + n) % n;
}

/**
 * The parts a Build-your-Keeper slideshow walks through: those switched on, in the order
 * of the switches, starting after `current` (or at the first when it's off).
 * @param {{ id: string }[]} parts
 * @param {string[]} on ids switched on
 * @param {string|null} current id shown now
 * @returns {string|null} the id to show next, or null when nothing is on
 */
export function nextPart(parts, on, current) {
  const list = parts.map((p) => p.id).filter((id) => on.includes(id));
  if (!list.length) return null;
  const i = list.indexOf(current);
  return list[i < 0 ? 0 : nextSlide(i, list.length)];
}

/**
 * How many words of a statement are lit while it scrolls up the screen: none while its top
 * is below 85% of the window's height, all once its top has reached 35%.
 * @param {number} top the statement's top, from the top of the window
 * @param {number} viewport the window's height
 * @param {number} count words in the statement
 */
export function wordsLit(top, viewport, count) {
  if (!(viewport > 0) || !(count > 0)) return 0;
  const p = clamp((viewport * 0.85 - top) / (viewport * 0.5), 0, 1);
  return Math.round(p * count);
}
