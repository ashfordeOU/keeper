// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Backgrounds behind the picture, all drawn from numbers (no pictures from
// anywhere else): soft colour fields, gradients, gentle waves and fine grain.
// The same seed always draws the same background.

import type { Background } from './types';

export interface BackgroundPreset {
  id: string;
  name: string;
  /** a soft field of colour blobs, a linear gradient, or layered waves */
  kind: 'field' | 'linear' | 'waves';
  colors: string[];
  /** base colour under the blobs and waves */
  base: string;
  grain?: number;
  seed: number;
}

export const BACKGROUNDS: BackgroundPreset[] = [
  { id: 'aurora', name: 'Aurora', kind: 'field', base: '#0d1430', colors: ['#3b82f6', '#8b5cf6', '#06b6d4', '#22c55e'], grain: 0.05, seed: 11 },
  { id: 'dusk', name: 'Dusk', kind: 'field', base: '#2a0f2f', colors: ['#f97316', '#ec4899', '#8b5cf6', '#facc15'], grain: 0.05, seed: 23 },
  { id: 'lagoon', name: 'Lagoon', kind: 'field', base: '#062a33', colors: ['#14b8a6', '#0ea5e9', '#a3e635', '#2563eb'], grain: 0.04, seed: 37 },
  { id: 'peach', name: 'Peach', kind: 'field', base: '#fde7d9', colors: ['#fdba74', '#f9a8d4', '#fcd34d', '#c4b5fd'], grain: 0.03, seed: 41 },
  { id: 'mint', name: 'Mint', kind: 'field', base: '#e8f7ef', colors: ['#86efac', '#67e8f9', '#bef264', '#a5b4fc'], grain: 0.03, seed: 53 },
  { id: 'ember', name: 'Ember', kind: 'waves', base: '#1c0a05', colors: ['#7c2d12', '#c2410c', '#f97316', '#fdba74'], grain: 0.04, seed: 61 },
  { id: 'tide', name: 'Tide', kind: 'waves', base: '#04122b', colors: ['#1e3a8a', '#1d4ed8', '#3b82f6', '#93c5fd'], grain: 0.04, seed: 67 },
  { id: 'meadow', name: 'Meadow', kind: 'waves', base: '#052e16', colors: ['#166534', '#16a34a', '#4ade80', '#d9f99d'], grain: 0.04, seed: 71 },
  { id: 'graphite', name: 'Graphite', kind: 'linear', base: '#18181b', colors: ['#3f3f46', '#09090b'], grain: 0.06, seed: 79 },
  { id: 'paper', name: 'Paper', kind: 'linear', base: '#f5f5f4', colors: ['#fafaf9', '#e7e5e4'], grain: 0.05, seed: 83 },
  { id: 'sky', name: 'Sky', kind: 'linear', base: '#bae6fd', colors: ['#e0f2fe', '#7dd3fc'], grain: 0.02, seed: 89 },
  { id: 'night', name: 'Night', kind: 'linear', base: '#0b1020', colors: ['#1e1b4b', '#020617'], grain: 0.05, seed: 97 },
];

export function presetById(id: string): BackgroundPreset {
  return BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0];
}

/** A small, fast, repeatable random number generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The blobs of a colour field, in 0–1 coordinates. */
export function fieldBlobs(p: BackgroundPreset): { x: number; y: number; r: number; color: string }[] {
  const r = rng(p.seed);
  return p.colors.flatMap((color) => [0, 1].map(() => ({ x: r() * 1.2 - 0.1, y: r() * 1.2 - 0.1, r: 0.45 + r() * 0.5, color })));
}

/** A short CSS for a swatch of the background (the picker's little squares). */
export function swatchCss(b: Background): string {
  if (b.kind === 'solid') return b.color;
  if (b.kind === 'gradient') return `linear-gradient(${b.angle}deg, ${b.from}, ${b.to})`;
  const p = presetById(b.id);
  if (p.kind === 'linear') return `linear-gradient(160deg, ${p.colors[0]}, ${p.colors[1]})`;
  if (p.kind === 'waves') return `linear-gradient(180deg, ${p.base} 20%, ${p.colors[1]} 55%, ${p.colors[3]})`;
  return fieldBlobs(p).slice(0, 4).map((o) => `radial-gradient(circle at ${Math.round(o.x * 100)}% ${Math.round(o.y * 100)}%, ${o.color} 0%, transparent ${Math.round(o.r * 70)}%)`).join(', ') + `, ${p.base}`;
}

/** Does text read better dark or light over it (for the editor's labels). */
export function isLight(b: Background): boolean {
  const hex = b.kind === 'solid' ? b.color : b.kind === 'gradient' ? b.from : presetById(b.id).base;
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return false;
  const [r, g, bl] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl > 0.6;
}
