// SPDX-License-Identifier: AGPL-3.0-or-later
// Split panes as a tree: every leaf shows one terminal (or a web page, notes or
// remote files); every split lays its children side by side or one above the other.

import type { PaneNode } from './types';

let seq = 0;
export const paneId = () => `p${Date.now().toString(36)}${(++seq).toString(36)}`;

export function leaf(session: string, extra: Partial<Extract<PaneNode, { type: 'leaf' }>> = {}): PaneNode {
  return { type: 'leaf', id: extra.id ?? paneId(), session, kind: extra.kind ?? 'terminal', url: extra.url };
}

export function leaves(n: PaneNode): Extract<PaneNode, { type: 'leaf' }>[] {
  return n.type === 'leaf' ? [n] : n.children.flatMap(leaves);
}

export function findLeaf(n: PaneNode, id: string): Extract<PaneNode, { type: 'leaf' }> | undefined {
  return leaves(n).find((l) => l.id === id);
}

/** Splits pane `id`, putting `added` to its right ('row') or below it ('col'). */
export function split(root: PaneNode, id: string, dir: 'row' | 'col', added: PaneNode): PaneNode {
  const go = (n: PaneNode): PaneNode => {
    if (n.type === 'leaf') {
      if (n.id !== id) return n;
      return { type: 'split', id: paneId(), dir, children: [n, added], sizes: [0.5, 0.5] };
    }
    const i = n.children.findIndex((c) => c.type === 'leaf' && c.id === id);
    if (i >= 0 && n.dir === dir) {
      // Same direction: add a sibling and share the space evenly within the old pane's slot.
      const children = [...n.children.slice(0, i + 1), added, ...n.children.slice(i + 1)];
      const half = n.sizes[i] / 2;
      const sizes = [...n.sizes.slice(0, i), half, half, ...n.sizes.slice(i + 1)];
      return { ...n, children, sizes };
    }
    return { ...n, children: n.children.map(go) };
  };
  return go(root);
}

/** Removes pane `id`; returns null when it was the last one. */
export function close(root: PaneNode, id: string): PaneNode | null {
  const go = (n: PaneNode): PaneNode | null => {
    if (n.type === 'leaf') return n.id === id ? null : n;
    const kept: PaneNode[] = [];
    const sizes: number[] = [];
    n.children.forEach((c, i) => {
      const r = go(c);
      if (r) {
        kept.push(r);
        sizes.push(n.sizes[i]);
      }
    });
    if (!kept.length) return null;
    if (kept.length === 1) return kept[0];
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    return { ...n, children: kept, sizes: sizes.map((s) => s / total) };
  };
  return go(root);
}

/** Moves the divider after child `index` of split `id` by `delta` (a share of the split, -1..1). */
export function resize(root: PaneNode, id: string, index: number, delta: number, min = 0.08): PaneNode {
  const go = (n: PaneNode): PaneNode => {
    if (n.type === 'leaf') return n;
    if (n.id !== id) return { ...n, children: n.children.map(go) };
    if (index < 0 || index >= n.sizes.length - 1) return n;
    const sizes = [...n.sizes];
    const a = sizes[index] + delta;
    const b = sizes[index + 1] - delta;
    if (a < min || b < min) return n;
    sizes[index] = a;
    sizes[index + 1] = b;
    return { ...n, sizes };
  };
  return go(root);
}

/** Swaps two panes' contents (their places in the layout stay). */
export function swap(root: PaneNode, a: string, b: string): PaneNode {
  const la = findLeaf(root, a);
  const lb = findLeaf(root, b);
  if (!la || !lb) return root;
  const go = (n: PaneNode): PaneNode => {
    if (n.type === 'leaf') return n.id === a ? { ...lb, id: a } : n.id === b ? { ...la, id: b } : n;
    return { ...n, children: n.children.map(go) };
  };
  return go(root);
}

export function replaceLeaf(root: PaneNode, id: string, patch: Partial<Extract<PaneNode, { type: 'leaf' }>>): PaneNode {
  const go = (n: PaneNode): PaneNode => (n.type === 'leaf' ? (n.id === id ? { ...n, ...patch, type: 'leaf', id } : n) : { ...n, children: n.children.map(go) });
  return go(root);
}

/** Evens out every split. */
export function equalize(root: PaneNode): PaneNode {
  if (root.type === 'leaf') return root;
  return { ...root, children: root.children.map(equalize), sizes: root.children.map(() => 1 / root.children.length) };
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Where each leaf sits, as shares of the whole area (0..1). */
export function rects(root: PaneNode, r: Rect = { x: 0, y: 0, w: 1, h: 1 }): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const go = (n: PaneNode, box: Rect) => {
    if (n.type === 'leaf') {
      out.set(n.id, box);
      return;
    }
    let off = 0;
    n.children.forEach((c, i) => {
      const s = n.sizes[i];
      go(c, n.dir === 'row' ? { x: box.x + off * box.w, y: box.y, w: s * box.w, h: box.h } : { x: box.x, y: box.y + off * box.h, w: box.w, h: s * box.h });
      off += s;
    });
  };
  go(root, r);
  return out;
}

/** The nearest pane in a direction from pane `id`, for keyboard moves. */
export function neighbour(root: PaneNode, id: string, dir: 'left' | 'right' | 'up' | 'down'): string | undefined {
  const all = rects(root);
  const me = all.get(id);
  if (!me) return undefined;
  const cx = me.x + me.w / 2;
  const cy = me.y + me.h / 2;
  let best: { id: string; d: number } | undefined;
  for (const [other, r] of all) {
    if (other === id) continue;
    const ox = r.x + r.w / 2;
    const oy = r.y + r.h / 2;
    const ok = dir === 'left' ? r.x + r.w <= me.x + 1e-6 : dir === 'right' ? r.x >= me.x + me.w - 1e-6 : dir === 'up' ? r.y + r.h <= me.y + 1e-6 : r.y >= me.y + me.h - 1e-6;
    if (!ok) continue;
    const d = Math.hypot(ox - cx, oy - cy);
    if (!best || d < best.d) best = { id: other, d };
  }
  return best?.id;
}
