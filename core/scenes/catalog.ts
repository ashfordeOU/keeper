// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The built-in library: scenes drawn entirely in code (no pictures, video or
// recordings from anyone else) and palettes to colour them.

import type { NamedPalette, Palette, SceneCategory, SceneParams, WallpaperSource } from './types';

export interface SceneDef {
  id: string;
  name: string;
  category: SceneCategory;
  description: string;
  /** the palette it looks best in */
  palette: string;
  /** starting controls, merged over DEFAULT_PARAMS */
  params?: Partial<SceneParams>;
  /** relative GPU cost (1 = a few hundred ALU ops per pixel); the renderer drops resolution for heavy ones on battery */
  cost: 1 | 2 | 3;
}

export const DEFAULT_PARAMS: SceneParams = { speed: 1, intensity: 0.7, scale: 1, grain: 0.15, vignette: 0.35, seed: 0 };

export const SCENES: SceneDef[] = [
  { id: 'aurora', name: 'Aurora', category: 'Atmosphere', description: 'Slow curtains of light over a night sky', palette: 'polar', cost: 2 },
  { id: 'nebula', name: 'Nebula', category: 'Atmosphere', description: 'Drifting dust and twinkling stars', palette: 'cosmos', cost: 2 },
  { id: 'mesh', name: 'Gradient mesh', category: 'Fluid', description: 'Soft colour fields that melt into each other', palette: 'peach', cost: 1 },
  { id: 'lava', name: 'Lava lamp', category: 'Fluid', description: 'Blobs that rise, merge and part', palette: 'ember', cost: 1 },
  { id: 'silk', name: 'Silk', category: 'Fluid', description: 'Folding ribbons of fabric', palette: 'orchid', cost: 2 },
  { id: 'contours', name: 'Contours', category: 'Geometry', description: 'A topographic map that slowly shifts', palette: 'paper', cost: 1, params: { grain: 0.05 } },
  { id: 'hexes', name: 'Hex field', category: 'Geometry', description: 'A honeycomb that pulses in waves', palette: 'mint', cost: 1 },
  { id: 'rain', name: 'Rain', category: 'Weather', description: 'Rain streaking past a misty window', palette: 'slate', cost: 2 },
  { id: 'snow', name: 'Snowfall', category: 'Weather', description: 'Flakes drifting down at three depths', palette: 'frost', cost: 1 },
  { id: 'ocean', name: 'Ocean', category: 'Weather', description: 'Rolling swells under an open sky', palette: 'lagoon', cost: 2 },
  { id: 'dunes', name: 'Dunes', category: 'Light', description: 'Layered sand ridges in low sun', palette: 'desert', cost: 1 },
  { id: 'rays', name: 'Light rays', category: 'Light', description: 'Sunbeams through haze', palette: 'gold', cost: 2 },
  { id: 'fireflies', name: 'Fireflies', category: 'Life', description: 'Glowing specks wandering at dusk', palette: 'dusk', cost: 1 },
  { id: 'koi', name: 'Koi pond', category: 'Life', description: 'Fish shadows gliding under ripples', palette: 'lagoon', cost: 2 },
];

export const SCENE_CATEGORIES: SceneCategory[] = ['Atmosphere', 'Fluid', 'Geometry', 'Weather', 'Light', 'Life'];

export const PALETTES: NamedPalette[] = [
  { id: 'polar', name: 'Polar', colors: ['#050b1a', '#0f3d5e', '#2bd4a4', '#c7f9ff'] },
  { id: 'cosmos', name: 'Cosmos', colors: ['#06040f', '#2a1250', '#b0388c', '#ffd9a8'] },
  { id: 'peach', name: 'Peach', colors: ['#2b1b3d', '#e2677e', '#f7a77b', '#fde6c4'] },
  { id: 'ember', name: 'Ember', colors: ['#14060a', '#7a1028', '#f05a28', '#ffd166'] },
  { id: 'orchid', name: 'Orchid', colors: ['#120b20', '#5b2a86', '#c86fc9', '#f6d9ff'] },
  { id: 'paper', name: 'Paper', colors: ['#f4efe6', '#d8cfc0', '#8b7f6c', '#3a342b'] },
  { id: 'mint', name: 'Mint', colors: ['#06201b', '#0d4d3f', '#3fd1a0', '#d8fff0'] },
  { id: 'slate', name: 'Slate', colors: ['#0c1116', '#26323d', '#6d8394', '#d6e2ea'] },
  { id: 'frost', name: 'Frost', colors: ['#0b1a2c', '#3a5f87', '#9cc6e8', '#ffffff'] },
  { id: 'lagoon', name: 'Lagoon', colors: ['#021a24', '#055e74', '#2cc3c7', '#e3fbf6'] },
  { id: 'desert', name: 'Desert', colors: ['#2a1508', '#8a4b1f', '#e09a4f', '#ffe7bf'] },
  { id: 'gold', name: 'Gold hour', colors: ['#1a1006', '#6b3d0c', '#e7a33e', '#fff1cf'] },
  { id: 'dusk', name: 'Dusk', colors: ['#070a14', '#1d2346', '#5a4f8a', '#ffe58a'] },
  { id: 'mono', name: 'Mono', colors: ['#0a0a0a', '#3a3a3a', '#9a9a9a', '#f2f2f2'] },
  { id: 'forest', name: 'Forest', colors: ['#06120a', '#1d3b23', '#5f8f4e', '#e2f0c8'] },
  { id: 'berry', name: 'Berry', colors: ['#14040e', '#5a0f3c', '#d23b6f', '#ffc2d4'] },
];

export function sceneById(id: string): SceneDef | undefined {
  return SCENES.find((s) => s.id === id);
}

export function paletteById(id: string, custom: NamedPalette[] = []): NamedPalette {
  return custom.find((p) => p.id === id) ?? PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

export function clampParams(p: Partial<SceneParams> | undefined): SceneParams {
  const c = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const d = DEFAULT_PARAMS;
  return {
    speed: c(p?.speed, 0, 3, d.speed),
    intensity: c(p?.intensity, 0, 1, d.intensity),
    scale: c(p?.scale, 0.25, 4, d.scale),
    grain: c(p?.grain, 0, 1, d.grain),
    vignette: c(p?.vignette, 0, 1, d.vignette),
    seed: c(p?.seed, 0, 1000, d.seed),
  };
}

/** A scene wallpaper with its own palette and controls. */
export function sceneSource(id: string, palette?: string, params?: Partial<SceneParams>): WallpaperSource {
  const s = sceneById(id) ?? SCENES[0];
  return { kind: 'scene', scene: s.id, palette: palette ?? s.palette, params: clampParams({ ...DEFAULT_PARAMS, ...s.params, ...params }) };
}

/** "Surprise me": a random scene in a random palette (never the same pair twice in a row). */
export function surprise(rand: () => number = Math.random, current?: WallpaperSource, custom: NamedPalette[] = []): WallpaperSource {
  const pals = [...PALETTES, ...custom];
  for (let i = 0; i < 8; i++) {
    const s = SCENES[Math.floor(rand() * SCENES.length) % SCENES.length];
    const p = pals[Math.floor(rand() * pals.length) % pals.length];
    if (current?.kind === 'scene' && current.scene === s.id && current.palette === p.id) continue;
    return sceneSource(s.id, p.id, { seed: Math.floor(rand() * 1000) });
  }
  return sceneSource(SCENES[0].id);
}

/** Repairs a wallpaper read from disk. */
export function normalizeSource(raw: unknown): WallpaperSource {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const motion = (v: unknown) => (['still', 'drift', 'breathe'].includes(v as string) ? v as 'still' : 'still');
  switch (r.kind) {
    case 'scene': return sceneById(str(r.scene)) ? { kind: 'scene', scene: str(r.scene), palette: str(r.palette) || sceneById(str(r.scene))!.palette, params: clampParams(r.params as Partial<SceneParams>) } : sceneSource(SCENES[0].id);
    case 'video': return str(r.path) ? { kind: 'video', path: str(r.path), muted: true, rate: typeof r.rate === 'number' ? Math.min(2, Math.max(0.25, r.rate)) : undefined } : { kind: 'none' };
    case 'image': return str(r.path) ? { kind: 'image', path: str(r.path), motion: motion(r.motion) } : { kind: 'none' };
    case 'folder': return str(r.path) ? { kind: 'folder', path: str(r.path), interval: Math.max(10, Number(r.interval) || 300), motion: motion(r.motion), shuffle: r.shuffle !== false } : { kind: 'none' };
    case 'web': return /^https?:\/\//i.test(str(r.url)) ? { kind: 'web', url: str(r.url) } : { kind: 'none' };
    case 'none': return { kind: 'none' };
    default: return sceneSource(SCENES[0].id);
  }
}

export function describeSource(s: WallpaperSource): string {
  const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  switch (s.kind) {
    case 'scene': return sceneById(s.scene)?.name ?? s.scene;
    case 'video': return `Video · ${base(s.path)}`;
    case 'image': return `Picture · ${base(s.path)}`;
    case 'folder': return `Folder · ${base(s.path)}`;
    case 'web': return `Web page · ${s.url.replace(/^https?:\/\//, '').slice(0, 40)}`;
    default: return 'Nothing';
  }
}

/** A palette's four colours as 0..1 RGB triples, for the shader. */
export function paletteFloats(p: Palette): number[] {
  return p.flatMap((hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    const n = m ? parseInt(m[1], 16) : 0;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  });
}
