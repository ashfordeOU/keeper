// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Palettes from a photo (k-means on its pixels) and from Keeper's themes.

import { luminance, parseColor, toHex } from '../themes';
import type { Palette } from './types';

/** A seeded random number generator, so a photo always gives the same palette. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * The four main colours of a picture, darkest first. `rgba` is ImageData-style
 * bytes; only every `step`th pixel is looked at, and transparent ones are skipped.
 */
export function paletteFromPixels(rgba: ArrayLike<number>, opts: { k?: number; step?: number; iterations?: number } = {}): Palette {
  const k = opts.k ?? 4;
  const step = Math.max(1, opts.step ?? 4);
  const pts: [number, number, number][] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4 * step) if (rgba[i + 3] > 127) pts.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  if (!pts.length) return ['#111111', '#444444', '#999999', '#eeeeee'];
  const rand = rng(pts.length);
  // k-means++ start: spread the first centres apart.
  const centres: [number, number, number][] = [pts[Math.floor(rand() * pts.length)]];
  const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  while (centres.length < k) {
    const dist = pts.map((p) => Math.min(...centres.map((c) => d2(p, c))));
    const total = dist.reduce((a, b) => a + b, 0);
    if (!total) { centres.push([...pts[Math.floor(rand() * pts.length)]] as [number, number, number]); continue; }
    let r = rand() * total;
    let i = 0;
    while (i < dist.length - 1 && (r -= dist[i]) > 0) i++;
    centres.push([...pts[i]] as [number, number, number]);
  }
  const counts = new Array(k).fill(0);
  for (let it = 0; it < (opts.iterations ?? 8); it++) {
    const sums = centres.map(() => [0, 0, 0]);
    counts.fill(0);
    for (const p of pts) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < k; c++) { const d = d2(p, centres[c]); if (d < bd) { bd = d; best = c; } }
      counts[best]++;
      sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2];
    }
    for (let c = 0; c < k; c++) if (counts[c]) centres[c] = [sums[c][0] / counts[c], sums[c][1] / counts[c], sums[c][2] / counts[c]];
  }
  const hexes = centres.map(([r, g, b]) => toHex({ r: Math.round(r), g: Math.round(g), b: Math.round(b), a: 1 }));
  return sortByLightness(hexes).slice(0, 4) as Palette;
}

export function sortByLightness(colors: string[]): string[] {
  return [...colors].sort((a, b) => luminance(parseColor(a)!) - luminance(parseColor(b)!));
}
