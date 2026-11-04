// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The photo editor: an edit is a small recipe (turn, straighten, perspective,
// crop, light and colour, retouching, hidden areas, cut out with a new
// background, size, canvas, text and shapes, and how to save) applied to the
// untouched original, so every change can be undone and Revert brings the
// original back. Pure: the recipe, its geometry and the numbers sharp needs.
// electron/services/photo-edit.ts renders it; core/photo-pixels.ts has the
// pixel work and core/photo-formats.ts the formats.

import { SAVE_IDS, canSave, extensionFor, sameFormatAs, formatInfo, type ColourProfile, type MetadataMode, type SaveFormat } from './photo-formats';

export { EDITABLE, extensionFor } from './photo-formats';

export type RedactKind = 'blur' | 'pixelate' | 'box';
export type PhotoFormat = 'same' | SaveFormat;
export type Band = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';
export const BANDS: { id: Band; label: string; hue: number; swatch: string }[] = [
  { id: 'red', label: 'Reds', hue: 0, swatch: '#e5484d' },
  { id: 'orange', label: 'Oranges', hue: 30, swatch: '#f08c2e' },
  { id: 'yellow', label: 'Yellows', hue: 60, swatch: '#e8c547' },
  { id: 'green', label: 'Greens', hue: 120, swatch: '#46a758' },
  { id: 'aqua', label: 'Aquas', hue: 180, swatch: '#3fb6c4' },
  { id: 'blue', label: 'Blues', hue: 225, swatch: '#3e63dd' },
  { id: 'purple', label: 'Purples', hue: 275, swatch: '#8e4ec6' },
  { id: 'magenta', label: 'Magentas', hue: 320, swatch: '#d6409f' },
];

/** A rectangle as fractions (0–1) of the picture it sits on. */
export interface Rect { x: number; y: number; w: number; h: number }

export type RetouchKind = 'heal' | 'clone' | 'redeye';
/** A retouched spot: x, y and r as fractions of the cropped picture (r of its shorter side); clone copies from sx, sy. */
export interface Spot { kind: RetouchKind; x: number; y: number; r: number; sx?: number; sy?: number }

/** A brush stroke on the cut-out's edge: keep (paint the subject back) or remove; points as fractions of the cropped picture, r of its shorter side. */
export interface MaskStroke { keep: boolean; r: number; pts: number[] }

export type BackgroundKind = 'clear' | 'colour' | 'gradient' | 'blur' | 'picture';
export interface Background {
  kind: BackgroundKind;
  colour: string;
  /** the gradient's second colour */
  colour2: string;
  /** gradient direction in degrees (0: top to bottom) */
  angle: number;
  /** how much the original background is blurred, 0–100 */
  blur: number;
  /** a picture filling the background */
  picture?: string;
  /** a soft shadow under the subject, 0–100 (0: none) */
  shadow: number;
}

export type FontKind = 'sans' | 'serif' | 'mono' | 'round';
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';
export type WatermarkPlace = 'br' | 'bl' | 'tr' | 'tl' | 'c' | 'tile';
/** Things added on top, as fractions of the finished picture (size: of its shorter side). */
export type Overlay =
  | { kind: 'text'; text: string; x: number; y: number; size: number; colour: string; font: FontKind; bold: boolean; shadow: boolean }
  | { kind: 'shape'; shape: ShapeKind; x: number; y: number; w: number; h: number; colour: string; width: number; fill: boolean }
  | { kind: 'sticker'; emoji: string; x: number; y: number; size: number }
  | { kind: 'watermark'; text: string; place: WatermarkPlace; size: number; opacity: number; colour: string }
  | { kind: 'frame'; style: 'plain' | 'double' | 'print'; size: number; colour: string };

export interface PhotoRecipe {
  v: 1;
  /** quarter turns clockwise */
  turns: 0 | 1 | 2 | 3;
  flip: boolean;
  /** small turn to level the horizon, degrees (−45 to 45); the edges are cropped away */
  straighten: number;
  /** keystone, −100 to 100: lines leaning together (up or down, left or right) stand straight */
  perspectiveV: number;
  perspectiveH: number;
  /** of the turned and straightened picture */
  crop?: Rect;
  /** −100 to 100 */
  exposure: number;
  contrast: number;
  saturation: number;
  /** cooler (−) or warmer (+) */
  temperature: number;
  /** greener (−) or pinker (+) */
  tint: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  vibrance: number;
  /** local contrast; below zero softens */
  clarity: number;
  /** 0 to 100 */
  sharpen: number;
  noise: number;
  /** −100 (dark corners) to 100 (light corners) */
  vignette: number;
  grain: number;
  /** per colour: hue shift, saturation and lightness, −100 to 100 */
  hsl: Partial<Record<Band, [number, number, number]>>;
  /** the tone curve's points, 0–255, sorted by x (empty: straight) */
  curve: [number, number][];
  /** the look last chosen (its name is shown; the sliders hold its values) */
  look?: string;
  /** healed, cloned and red-eye spots */
  retouch: Spot[];
  /** areas blurred, pixelated or covered, as fractions of the cropped picture */
  redact: (Rect & { kind: RedactKind })[];
  /** the subject cut out from its background (on this computer, with a downloadable model) */
  cutout: boolean;
  /** 'best' uses the larger model when it is downloaded */
  cutoutQuality: 'fast' | 'best';
  /** softens the cut-out's edge, 0–100 */
  feather: number;
  /** shrinks (−) or grows (+) the cut-out, −100 to 100 */
  edge: number;
  strokes: MaskStroke[];
  background: Background;
  /** exact size in pixels after cropping (0: as it is; one side alone keeps the shape); takes the place of maxSide */
  width: number;
  height: number;
  /** longest side in pixels (0: as it is) */
  maxSide: number;
  /** more canvas around the picture, as fractions of its width (left, right) and height (top, bottom) */
  extend: { t: number; r: number; b: number; l: number; colour: string };
  overlays: Overlay[];
  format: PhotoFormat;
  /** 1–100; 0: the format's own default */
  quality: number;
  profile: ColourProfile;
  metadata: MetadataMode;
  /** a moving picture (GIF, WebP): every frame, or the first only */
  frames: 'all' | 'first';
}

export const defaultBackground = (): Background => ({ kind: 'clear', colour: '#ffffff', colour2: '#d9e4f5', angle: 0, blur: 50, shadow: 0 });

/** A recipe that changes nothing (its keys in the order normalizeRecipe writes them, so the two compare equal as text). */
export const defaultRecipe = (): PhotoRecipe => ({
  v: 1, turns: 0, flip: false, straighten: 0, perspectiveV: 0, perspectiveH: 0,
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temperature: 0, tint: 0, saturation: 0, vibrance: 0, clarity: 0, sharpen: 0, noise: 0, vignette: 0, grain: 0,
  hsl: {}, curve: [], retouch: [], redact: [],
  cutout: false, cutoutQuality: 'best', feather: 0, edge: 0, strokes: [], background: defaultBackground(),
  width: 0, height: 0, maxSide: 0, extend: { t: 0, r: 0, b: 0, l: 0, colour: 'clear' }, overlays: [],
  format: 'same', quality: 0, profile: 'keep', metadata: 'keep', frames: 'all',
});

/** The adjustment sliders. */
export const ADJUST_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'saturation', 'vibrance', 'clarity', 'sharpen', 'noise', 'vignette', 'grain'] as const;
export type AdjustKey = (typeof ADJUST_KEYS)[number];
const POSITIVE: AdjustKey[] = ['sharpen', 'noise', 'grain'];
export const isPositiveOnly = (k: AdjustKey) => POSITIVE.includes(k);

const clampN = (v: unknown, lo: number, hi: number, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const clampRect = (r: Partial<Rect> | undefined): Rect | undefined => {
  if (!r || typeof r !== 'object') return undefined;
  const x = clampN(r.x, 0, 1);
  const y = clampN(r.y, 0, 1);
  const w = clampN(r.w, 0, 1 - x);
  const h = clampN(r.h, 0, 1 - y);
  return w > 0.005 && h > 0.005 ? { x, y, w, h } : undefined;
};
const HEX = /^#[0-9a-f]{6}$/i;
const colourOr = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
// eslint-disable-next-line no-control-regex
const textOf = (v: unknown, max = 200) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, max) : '');
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

function normOverlay(o: unknown): Overlay | undefined {
  if (!o || typeof o !== 'object') return undefined;
  const x = o as Record<string, unknown>;
  const f = (k: string, lo = 0, hi = 1, d = 0.5) => r4(clampN(x[k], lo, hi, d));
  switch (x.kind) {
    case 'text': { const text = textOf(x.text); return text.trim() ? { kind: 'text', text, x: f('x'), y: f('y'), size: f('size', 0.01, 0.5, 0.08), colour: colourOr(x.colour, '#ffffff'), font: oneOf(x.font, ['sans', 'serif', 'mono', 'round'] as const, 'sans'), bold: x.bold === true, shadow: x.shadow !== false } : undefined; }
    case 'shape': return { kind: 'shape', shape: oneOf(x.shape, ['rect', 'ellipse', 'line', 'arrow'] as const, 'rect'), x: f('x', 0, 1, 0.3), y: f('y', 0, 1, 0.3), w: f('w', -1, 1, 0.3), h: f('h', -1, 1, 0.3), colour: colourOr(x.colour, '#ffffff'), width: f('width', 0.001, 0.1, 0.008), fill: x.fill === true };
    case 'sticker': { const emoji = textOf(x.emoji, 16); return emoji.trim() ? { kind: 'sticker', emoji, x: f('x'), y: f('y'), size: f('size', 0.02, 0.8, 0.15) } : undefined; }
    case 'watermark': { const text = textOf(x.text, 120); return text.trim() ? { kind: 'watermark', text, place: oneOf(x.place, ['br', 'bl', 'tr', 'tl', 'c', 'tile'] as const, 'br'), size: f('size', 0.01, 0.2, 0.035), opacity: f('opacity', 0.05, 1, 0.5), colour: colourOr(x.colour, '#ffffff') } : undefined; }
    case 'frame': return { kind: 'frame', style: oneOf(x.style, ['plain', 'double', 'print'] as const, 'plain'), size: f('size', 0.005, 0.2, 0.03), colour: colourOr(x.colour, '#ffffff') };
    default: return undefined;
  }
}

export function normalizeRecipe(v: unknown): PhotoRecipe {
  const d = defaultRecipe();
  if (!v || typeof v !== 'object') return d;
  const r = v as Partial<PhotoRecipe> & Record<string, unknown>;
  const crop = clampRect(r.crop);
  const full = crop && crop.x < 0.001 && crop.y < 0.001 && crop.w > 0.999 && crop.h > 0.999;
  const adj = {} as Record<AdjustKey, number>;
  for (const k of ADJUST_KEYS) adj[k] = Math.round(clampN(r[k], POSITIVE.includes(k) ? 0 : -100, 100));
  const hsl: PhotoRecipe['hsl'] = {};
  if (r.hsl && typeof r.hsl === 'object') {
    for (const b of BANDS) {
      const t = (r.hsl as Record<string, unknown>)[b.id];
      if (Array.isArray(t)) {
        const tri = [0, 1, 2].map((i) => Math.round(clampN(t[i], -100, 100))) as [number, number, number];
        if (tri.some((n) => n)) hsl[b.id] = tri;
      }
    }
  }
  const curve = (Array.isArray(r.curve) ? r.curve : [])
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2)
    .map(([x, y]) => [Math.round(clampN(x, 0, 255)), Math.round(clampN(y, 0, 255))] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, a) => i === 0 || p[0] > a[i - 1][0])
    .slice(0, 16);
  const straightCurve = curve.every(([x, y]) => x === y);
  const bg = (r.background ?? {}) as Partial<Background>;
  const background: Background = {
    kind: oneOf(bg.kind, ['clear', 'colour', 'gradient', 'blur', 'picture'] as const, 'clear'),
    colour: colourOr(bg.colour, d.background.colour),
    colour2: colourOr(bg.colour2, d.background.colour2),
    angle: Math.round(clampN(bg.angle, 0, 359)),
    blur: Math.round(clampN(bg.blur, 0, 100, 50)),
    ...(typeof bg.picture === 'string' && bg.picture.length < 4096 && bg.picture ? { picture: bg.picture } : {}),
    shadow: Math.round(clampN(bg.shadow, 0, 100)),
  };
  if (background.kind === 'picture' && !background.picture) background.kind = 'clear';
  const ex = (r.extend ?? {}) as Partial<PhotoRecipe['extend']>;
  const fmt = r.format === 'same' || SAVE_IDS.includes(r.format as SaveFormat) ? (r.format as PhotoFormat) : 'same';
  const spots = (Array.isArray(r.retouch) ? r.retouch : []).map((s): Spot | undefined => {
    if (!s || typeof s !== 'object') return undefined;
    const kind = oneOf(s.kind, ['heal', 'clone', 'redeye'] as const, 'heal');
    const out: Spot = { kind, x: r4(clampN(s.x, 0, 1)), y: r4(clampN(s.y, 0, 1)), r: r4(clampN(s.r, 0.002, 0.25, 0.03)) };
    if (kind === 'clone') { out.sx = r4(clampN(s.sx, 0, 1, out.x)); out.sy = r4(clampN(s.sy, 0, 1, out.y)); }
    return out;
  }).filter((s): s is Spot => !!s).slice(0, 200);
  const strokes = (Array.isArray(r.strokes) ? r.strokes : []).map((s): MaskStroke | undefined => {
    if (!s || typeof s !== 'object' || !Array.isArray(s.pts)) return undefined;
    const pts = s.pts.slice(0, 2000).map((n) => r4(clampN(n, 0, 1)));
    if (pts.length < 2) return undefined;
    return { keep: s.keep === true, r: r4(clampN(s.r, 0.002, 0.3, 0.03)), pts: pts.length % 2 ? pts.slice(0, -1) : pts };
  }).filter((s): s is MaskStroke => !!s).slice(0, 200);
  return {
    v: 1,
    turns: ([0, 1, 2, 3] as const).includes(r.turns as 0) ? (r.turns as PhotoRecipe['turns']) : 0,
    flip: r.flip === true,
    straighten: clampN(r.straighten, -45, 45),
    perspectiveV: Math.round(clampN(r.perspectiveV, -100, 100)),
    perspectiveH: Math.round(clampN(r.perspectiveH, -100, 100)),
    ...(crop && !full ? { crop } : {}),
    ...adj,
    hsl,
    curve: curve.length >= 2 && !straightCurve ? curve : [],
    ...(typeof r.look === 'string' && r.look ? { look: textOf(r.look, 60) } : {}),
    retouch: spots,
    redact: (Array.isArray(r.redact) ? r.redact : []).map((x) => ({ ...clampRect(x), kind: (['blur', 'pixelate', 'box'] as const).includes(x?.kind as RedactKind) ? x.kind : 'blur' })).filter((x): x is Rect & { kind: RedactKind } => x.w !== undefined).slice(0, 50),
    cutout: r.cutout === true,
    cutoutQuality: r.cutoutQuality === 'fast' ? 'fast' : 'best',
    feather: Math.round(clampN(r.feather, 0, 100)),
    edge: Math.round(clampN(r.edge, -100, 100)),
    strokes,
    background,
    width: Math.round(clampN(r.width, 0, 30000)),
    height: Math.round(clampN(r.height, 0, 30000)),
    maxSide: Math.round(clampN(r.maxSide, 0, 30000)),
    extend: { t: r4(clampN(ex.t, 0, 2)), r: r4(clampN(ex.r, 0, 2)), b: r4(clampN(ex.b, 0, 2)), l: r4(clampN(ex.l, 0, 2)), colour: ex.colour === 'clear' ? 'clear' : colourOr(ex.colour, 'clear') },
    overlays: (Array.isArray(r.overlays) ? r.overlays : []).map(normOverlay).filter((o): o is Overlay => !!o).slice(0, 100),
    format: fmt,
    quality: Math.round(clampN(r.quality, 0, 100)),
    profile: r.profile === 'srgb' ? 'srgb' : 'keep',
    metadata: oneOf(r.metadata, ['keep', 'no-location', 'strip'] as const, 'keep'),
    frames: r.frames === 'first' ? 'first' : 'all',
  };
}

/** The parts of a recipe that change pixels (save options and names left out). */
function pixelPart(r: PhotoRecipe) {
  const { format: _f, quality: _q, profile: _p, metadata: _m, frames: _fr, look: _l, cutoutQuality: _cq, ...rest } = r;
  return rest;
}

/** Nothing would change. */
export function isUnchanged(r: PhotoRecipe): boolean {
  const n = normalizeRecipe(r);
  return JSON.stringify(pixelPart(n)) === JSON.stringify(pixelPart(defaultRecipe())) && n.format === 'same';
}

export const hasAdjustments = (r: PhotoRecipe) => ADJUST_KEYS.some((k) => r[k]) || Object.keys(r.hsl).length > 0 || r.curve.length > 0;

/** The finished picture is see-through somewhere. */
export function seeThrough(r: PhotoRecipe, sourceAlpha: boolean): boolean {
  if (r.extend.colour === 'clear' && (r.extend.t || r.extend.r || r.extend.b || r.extend.l)) return true;
  if (r.cutout) return r.background.kind === 'clear';
  return sourceAlpha;
}

// ---------------------------------------------------------------- geometry

/** The size after quarter turns. */
export function turnedSize(w: number, h: number, turns: number): { w: number; h: number } {
  return turns % 2 ? { w: h, h: w } : { w, h };
}

/**
 * Straightening turns the picture by a small angle; the largest upright
 * rectangle of the same shape that stays inside is kept (no empty corners).
 * Returns that rectangle within the turned canvas sharp makes.
 */
export function straightenBox(w: number, h: number, deg: number): { canvasW: number; canvasH: number; left: number; top: number; width: number; height: number } {
  const a = Math.abs((deg * Math.PI) / 180);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const canvasW = Math.ceil(w * cos + h * sin);
  const canvasH = Math.ceil(w * sin + h * cos);
  if (a < 1e-6) return { canvasW: w, canvasH: h, left: 0, top: 0, width: w, height: h };
  // Scale k so a k·w × k·h rectangle fits inside the turned w × h one.
  const k = Math.min(1 / (cos + (h / w) * sin), 1 / (cos + (w / h) * sin));
  const width = Math.max(1, Math.floor(w * k));
  const height = Math.max(1, Math.floor(h * k));
  return { canvasW, canvasH, left: Math.max(0, Math.floor((canvasW - width) / 2)), top: Math.max(0, Math.floor((canvasH - height) / 2)), width: Math.min(width, canvasW), height: Math.min(height, canvasH) };
}

/** A fraction rectangle in pixels of a w × h picture, at least 1 × 1 and inside it. */
export function toPixels(r: Rect, w: number, h: number): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.min(w - 1, Math.round(r.x * w)));
  const top = Math.max(0, Math.min(h - 1, Math.round(r.y * h)));
  return { left, top, width: Math.max(1, Math.min(w - left, Math.round(r.w * w))), height: Math.max(1, Math.min(h - top, Math.round(r.h * h))) };
}

/** Width and height that fit a longest side (never larger than they are). */
export function fitSide(w: number, h: number, max: number): { w: number; h: number } {
  if (!max || Math.max(w, h) <= max) return { w, h };
  const k = max / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** The output size of a w × h picture: an exact size (one side alone keeps the shape), else a longest side. */
export function outputSize(w: number, h: number, r: Pick<PhotoRecipe, 'width' | 'height' | 'maxSide'>): { w: number; h: number } {
  if (r.width && r.height) return { w: r.width, h: r.height };
  if (r.width) return { w: r.width, h: Math.max(1, Math.round((r.width * h) / w)) };
  if (r.height) return { w: Math.max(1, Math.round((r.height * w) / h)), h: r.height };
  return fitSide(w, h, r.maxSide);
}

/** Typing one side with the shape locked: the other side follows. */
export function lockedSize(w: number, h: number, side: 'w' | 'h', value: number): { w: number; h: number } {
  const v = Math.max(1, Math.round(value));
  return side === 'w' ? { w: v, h: Math.max(1, Math.round((v * h) / w)) } : { w: Math.max(1, Math.round((v * w) / h)), h: v };
}

/** Extra canvas in pixels around a w × h picture. */
export function extendPixels(w: number, h: number, e: PhotoRecipe['extend']): { top: number; right: number; bottom: number; left: number } {
  return { top: Math.round(e.t * h), right: Math.round(e.r * w), bottom: Math.round(e.b * h), left: Math.round(e.l * w) };
}

/** Crop shapes offered: free, square and common photo shapes. */
export const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: 'Square', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

/** The largest centred crop of a shape (width ÷ height, in pixels) in a w × h picture. */
export function aspectCrop(w: number, h: number, ratio: number): Rect {
  const cw = Math.min(w, h * ratio);
  const ch = cw / ratio;
  return { x: (w - cw) / 2 / w, y: (h - ch) / 2 / h, w: cw / w, h: ch / h };
}

/**
 * Keystone: the part of a w × h picture that is stretched to fill it again
 * (top-left, top-right, bottom-right, bottom-left). v > 0 pulls in the top
 * (a building photographed from below, leaning together at the top), v < 0 the
 * bottom; h > 0 the left side, h < 0 the right. Always inside the picture, so
 * no empty corners appear.
 */
export function keystoneQuad(w: number, h: number, v: number, hz: number): [number, number][] {
  const kv = (Math.abs(v) / 100) * 0.3 * w;
  const kh = (Math.abs(hz) / 100) * 0.3 * h;
  const top = v > 0 ? kv : 0, bottom = v < 0 ? kv : 0, left = hz > 0 ? kh : 0, right = hz < 0 ? kh : 0;
  return [[top, left], [w - top, right], [w - bottom, h - right], [bottom, h - left]];
}

/** The 3 × 3 projective matrix taking the unit square's corners to four points (row-major, last entry 1). */
export function squareToQuad(q: [number, number][]): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, hh = 0;
  if (Math.abs(dx3) > 1e-12 || Math.abs(dy3) > 1e-12) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    hh = (dx1 * dy3 - dx3 * dy1) / den;
  }
  return [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh, 1];
}

/** Applies a projective matrix to a point. */
export function project(m: number[], x: number, y: number): [number, number] {
  const z = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / z, (m[3] * x + m[4] * y + m[5]) / z];
}

// ---------------------------------------------------------------- light and colour

/** Exposure as a brightness factor: ±100 is about ±1.5 stops. */
export const exposureFactor = (e: number) => Math.round(2 ** ((e / 100) * 1.5) * 1000) / 1000;

/** Contrast as sharp's linear(a, b) around mid-grey. */
export function contrastLinear(c: number): { a: number; b: number } {
  const a = c >= 0 ? 1 + (c / 100) * 0.8 : 1 + (c / 100) * 0.6;
  return { a: Math.round(a * 1000) / 1000, b: Math.round(128 * (1 - a) * 1000) / 1000 };
}

export const saturationFactor = (s: number) => Math.round((1 + s / 100) * 1000) / 1000;

/** Warmer adds red and takes blue; cooler the other way; tint moves between green and pink. A 3 × 3 colour matrix for sharp's recomb. */
export function temperatureMatrix(t: number, tint = 0): [[number, number, number], [number, number, number], [number, number, number]] {
  const k = t / 100;
  const m = tint / 100;
  const r = 1 + 0.18 * k + 0.06 * m;
  const g = 1 + 0.04 * k - 0.14 * m;
  const b = 1 - 0.2 * k + 0.06 * m;
  const q = (v: number) => Math.round(v * 1000) / 1000;
  return [[q(r), 0, 0], [0, q(g), 0], [0, 0, q(b)]];
}

/**
 * The warmth and tint that make a picked colour neutral grey. The picked colour
 * already has the current white balance in it, so that is taken out first.
 */
export function whiteBalanceFor(rgb: [number, number, number], current: { temperature: number; tint: number }): { temperature: number; tint: number } {
  const [r, g, b] = rgb.map((v) => Math.max(1, v));
  const mat = temperatureMatrix(current.temperature, current.tint);
  const r0 = r / mat[0][0], g0 = g / mat[1][1], b0 = b / mat[2][2];
  let best = { temperature: 0, tint: 0, err: Infinity };
  const test = (t: number, m: number) => {
    const x = temperatureMatrix(t, m);
    const R = r0 * x[0][0], G = g0 * x[1][1], B = b0 * x[2][2];
    const mean = (R + G + B) / 3;
    const err = ((R - mean) ** 2 + (G - mean) ** 2 + (B - mean) ** 2) / (mean * mean) + (t * t + m * m) * 1e-9;
    if (err < best.err) best = { temperature: t, tint: m, err };
  };
  for (let t = -100; t <= 100; t += 10) for (let m = -100; m <= 100; m += 10) test(t, m);
  const c = { ...best };
  for (let t = c.temperature - 10; t <= c.temperature + 10; t += 1) for (let m = c.tint - 10; m <= c.tint + 10; m += 1) if (Math.abs(t) <= 100 && Math.abs(m) <= 100) test(t, m);
  return { temperature: best.temperature, tint: best.tint };
}

export interface PictureStats {
  /** mean of each channel, 0–255 */
  mean: [number, number, number];
  /** luminance at the 1st, 50th and 99th percentile, 0–255 */
  p1: number;
  p50: number;
  p99: number;
  /** average saturation, 0–1 */
  sat: number;
}

/** Auto enhance: sensible light, contrast, white balance and colour from a picture's statistics. */
export function autoAdjust(s: PictureStats): Pick<PhotoRecipe, 'exposure' | 'contrast' | 'whites' | 'blacks' | 'shadows' | 'highlights' | 'temperature' | 'tint' | 'vibrance'> {
  const clamp = (v: number, lo = -100, hi = 100) => Math.round(Math.max(lo, Math.min(hi, v)));
  // Middle grey around 118: ±100 is ±1.5 stops; only part of the way, so it never looks pushed.
  const stops = Math.log2(118 / Math.max(8, s.p50));
  const exposure = clamp((stops / 1.5) * 100 * 0.6, -50, 50);
  const blacks = clamp(-(s.p1 - 4) * 1.4, -50, 50);
  const whites = clamp((250 - s.p99) * 1.2, -50, 50);
  const range = s.p99 - s.p1;
  const contrast = clamp(range < 160 ? (160 - range) / 3 : 0, 0, 30);
  const shadows = clamp(s.p50 < 90 ? (90 - s.p50) / 2 : 0, 0, 40);
  const highlights = clamp(s.p99 > 252 ? -25 : 0, -40, 0);
  // Grey world, gently: a colour cast is pulled half way to neutral.
  const wb = whiteBalanceFor(s.mean, { temperature: 0, tint: 0 });
  const vibrance = clamp(s.sat < 0.25 ? 25 : s.sat < 0.4 ? 12 : 0, 0, 30);
  return { exposure, contrast, whites, blacks, shadows, highlights, temperature: Math.round(wb.temperature / 2), tint: Math.round(wb.tint / 2), vibrance };
}

// ---------------------------------------------------------------- words and names

const signWord = (v: number, up: string, down: string) => (v > 0 ? up : down);

/** "Turned · Cropped · Brighter · Warmer · 2 areas hidden" for the Revert line. */
export function describeRecipe(r: PhotoRecipe): string {
  const out: string[] = [];
  if (r.turns || r.flip || r.straighten) out.push(r.straighten ? 'Straightened' : r.flip && !r.turns ? 'Flipped' : 'Turned');
  if (r.perspectiveV || r.perspectiveH) out.push('Perspective fixed');
  if (r.crop) out.push('Cropped');
  if (r.look) out.push(r.look);
  if (r.exposure) out.push(signWord(r.exposure, 'Brighter', 'Darker'));
  if (r.contrast) out.push(signWord(r.contrast, 'More contrast', 'Less contrast'));
  if (r.highlights || r.shadows || r.whites || r.blacks || r.curve.length) out.push('Tones');
  if (r.saturation) out.push(r.saturation > 0 ? 'More colour' : r.saturation <= -100 ? 'Black and white' : 'Less colour');
  if (r.vibrance) out.push(signWord(r.vibrance, 'Richer', 'Muted'));
  if (r.temperature) out.push(signWord(r.temperature, 'Warmer', 'Cooler'));
  if (r.tint) out.push('Tinted');
  if (Object.keys(r.hsl).length) out.push('Colours tuned');
  if (r.clarity) out.push(signWord(r.clarity, 'Clearer', 'Softer'));
  if (r.sharpen) out.push('Sharpened');
  if (r.noise) out.push('Less noise');
  if (r.vignette) out.push('Vignette');
  if (r.grain) out.push('Grain');
  if (r.retouch.length) out.push(`${r.retouch.length} spot${r.retouch.length === 1 ? '' : 's'} retouched`);
  if (r.redact.length) out.push(`${r.redact.length} area${r.redact.length === 1 ? '' : 's'} hidden`);
  if (r.cutout) out.push(r.background.kind === 'clear' ? 'Background removed' : 'New background');
  if (r.width || r.height) out.push(`Resized to ${r.width || 'auto'} × ${r.height || 'auto'}`);
  else if (r.maxSide) out.push(`Resized to ${r.maxSide} px`);
  if (r.extend.t || r.extend.r || r.extend.b || r.extend.l) out.push('More canvas');
  const n = r.overlays.length;
  if (n) out.push(`${n} thing${n === 1 ? '' : 's'} added`);
  if (r.format !== 'same') out.push(formatInfo(r.format).label);
  return out.join(' · ') || 'No changes';
}

const LABELS: Record<string, string> = {
  exposure: 'Light', contrast: 'Contrast', highlights: 'Highlights', shadows: 'Shadows', whites: 'Whites', blacks: 'Blacks', temperature: 'Warmth', tint: 'Tint', saturation: 'Colour', vibrance: 'Vibrance',
  clarity: 'Clarity', sharpen: 'Sharpen', noise: 'Noise', vignette: 'Vignette', grain: 'Grain', straighten: 'Straighten', perspectiveV: 'Perspective', perspectiveH: 'Perspective',
};

/** One step of the history in a few words: what changed from a to b. */
export function describeStep(a: PhotoRecipe, b: PhotoRecipe): string {
  if (b.look && b.look !== a.look) return `Look: ${b.look}`;
  const changed = (Object.keys(b) as (keyof PhotoRecipe)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  if (!changed.length) return 'No change';
  if (changed.length > 3 && changed.every((x) => (ADJUST_KEYS as readonly string[]).includes(x as string))) return 'Auto enhance';
  const k = changed[0];
  if (k in LABELS && typeof b[k] === 'number') { const v = b[k] as number; return `${LABELS[k]} ${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}${k === 'straighten' ? '°' : ''}`; }
  if (k === 'turns') return b.turns === (a.turns + 1) % 4 ? 'Turned right' : 'Turned left';
  if (k === 'flip') return 'Flipped';
  if (k === 'crop') return b.crop ? 'Cropped' : 'Crop reset';
  if (k === 'hsl') return 'Colour mix';
  if (k === 'curve') return 'Tone curve';
  if (k === 'retouch') return b.retouch.length > a.retouch.length ? ({ heal: 'Spot healed', clone: 'Spot cloned', redeye: 'Red eye fixed' } as const)[b.retouch[b.retouch.length - 1].kind] : 'Spot removed';
  if (k === 'redact') return b.redact.length > a.redact.length ? 'Area hidden' : 'Area shown again';
  if (k === 'cutout') return b.cutout ? 'Background removed' : 'Background back';
  if (k === 'strokes') return b.strokes.length > a.strokes.length ? (b.strokes[b.strokes.length - 1].keep ? 'Edge: kept an area' : 'Edge: removed an area') : 'Edge brush undone';
  if (k === 'feather') return `Soft edge ${b.feather}`;
  if (k === 'edge') return `Edge ${b.edge > 0 ? '+' : ''}${b.edge}`;
  if (k === 'background') return `Background: ${({ clear: 'see-through', colour: 'colour', gradient: 'gradient', blur: 'blurred', picture: 'picture' } as const)[b.background.kind]}${b.background.shadow && !a.background.shadow ? ', shadow' : ''}`;
  if (k === 'overlays') return b.overlays.length > a.overlays.length ? `Added ${({ text: 'text', shape: 'a shape', sticker: 'a sticker', watermark: 'a watermark', frame: 'a frame' } as const)[b.overlays[b.overlays.length - 1].kind]}` : b.overlays.length < a.overlays.length ? 'Removed an item' : 'Changed an item';
  if (k === 'width' || k === 'height' || k === 'maxSide') return 'Resized';
  if (k === 'extend') return 'Canvas';
  if (k === 'format' || k === 'quality' || k === 'profile' || k === 'metadata' || k === 'frames') return 'Save options';
  return 'Edit';
}

/**
 * The format a result is written in: what was asked, else the original's; a
 * picture whose own format this computer cannot write becomes JPEG; when it must stay
 * see-through, a format that can.
 */
export function outputFormat(r: PhotoRecipe, ext: string, alpha = false, platform = 'any'): SaveFormat {
  let want: SaveFormat = r.format !== 'same' ? r.format : sameFormatAs(`x.${ext.replace(/^\./, '')}`);
  // An original this computer cannot write again (HEIC off a Mac) becomes JPEG; a format asked for by name is refused with a reason instead.
  if (r.format === 'same' && platform !== 'any' && !canSave(want, platform).ok) want = 'jpeg';
  if (seeThrough(r, alpha) && !formatInfo(want).alpha) return 'png';
  return want;
}

/** Saving over the original keeps its name, unless the format changes (then it is a copy). */
export function replaceKeepsName(r: PhotoRecipe, ext: string, alpha = false, platform = 'any'): boolean {
  const e = ext.toLowerCase().replace(/^\./, '');
  const out = outputFormat(r, ext, alpha, platform);
  const mine = extensionFor(out);
  return mine === e || (out === 'jpeg' && ['jpeg', 'jpe', 'jfif'].includes(e)) || (out === 'tiff' && e === 'tif') || (out === 'heic' && ['heif', 'hif'].includes(e));
}

/** "Holiday.jpg" → "Holiday (edited).png" */
export function copyName(base: string, f: SaveFormat): string {
  const stem = base.replace(/\.[^.]+$/, '').replace(/ \(edited(?: \d+)?\)$/, '');
  return `${stem} (edited).${extensionFor(f)}`;
}
