// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The before/after sliders: where the divider sits, as a percentage of the picture.
// Pure: used by site.js in the browser and by test/site.test.ts.

/** The divider's place (0–100) for a pointer at clientX over a box at left with width. */
export function fromPointer(clientX, left, width) {
  if (!(width > 0)) return 50;
  return clamp(((clientX - left) / width) * 100);
}

/** The divider's place after a key press; null when the key does nothing. */
export function fromKey(value, key, big = false) {
  const step = big ? 10 : 2;
  switch (key) {
    case 'ArrowLeft': case 'ArrowDown': return clamp(value - step);
    case 'ArrowRight': case 'ArrowUp': return clamp(value + step);
    case 'PageDown': return clamp(value - 10);
    case 'PageUp': return clamp(value + 10);
    case 'Home': return 0;
    case 'End': return 100;
    default: return null;
  }
}

export const clamp = (v) => Math.round(Math.min(100, Math.max(0, Number.isFinite(v) ? v : 50)) * 10) / 10;
