// SPDX-License-Identifier: AGPL-3.0-or-later
// Squarified treemap layout (Bruls, Huizing & van Wijk) for the Space Map:
// every folder becomes a rectangle whose area matches the space it uses.

import type { Rect } from './types';

export interface Sized {
  size: number;
}

export interface Placed<T> extends Rect {
  item: T;
}

function worst(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = side * side;
  const sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}

/**
 * Lays out items (any order; sorted biggest-first internally) inside `rect`.
 * Items with no size are left out.
 */
export function squarify<T extends Sized>(items: T[], rect: Rect): Placed<T>[] {
  const list = items.filter((i) => i.size > 0).sort((a, b) => b.size - a.size);
  const total = list.reduce((n, i) => n + i.size, 0);
  if (!total || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const areas = list.map((i) => i.size * scale);
  const out: Placed<T>[] = [];
  let { x, y, w, h } = rect;
  let i = 0;
  while (i < list.length) {
    const side = Math.min(w, h);
    const row = [areas[i]];
    let j = i + 1;
    while (j < list.length && worst([...row, areas[j]], side) <= worst(row, side)) {
      row.push(areas[j]);
      j++;
    }
    const rowArea = row.reduce((a, b) => a + b, 0);
    if (w >= h) {
      // Column on the left.
      const cw = rowArea / h;
      let cy = y;
      for (let k = 0; k < row.length; k++) {
        const ch = row[k] / cw;
        out.push({ item: list[i + k], x, y: cy, w: cw, h: ch });
        cy += ch;
      }
      x += cw;
      w -= cw;
    } else {
      // Row along the top.
      const rh = rowArea / w;
      let cx = x;
      for (let k = 0; k < row.length; k++) {
        const rw = row[k] / rh;
        out.push({ item: list[i + k], x: cx, y, w: rw, h: rh });
        cx += rw;
      }
      y += rh;
      h -= rh;
    }
    i = j;
  }
  return out;
}

/** Keeps the biggest `max` items and folds the rest into one "N smaller items" entry. */
export function topWithRest<T extends Sized>(items: T[], max: number, makeRest: (rest: T[], size: number) => T): T[] {
  const sorted = [...items].sort((a, b) => b.size - a.size);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1);
  return [...head, makeRest(rest, rest.reduce((n, r) => n + r.size, 0))];
}
