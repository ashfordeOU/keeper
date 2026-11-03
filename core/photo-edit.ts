// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The light photo editor: an edit is a small recipe (turn, straighten, crop,
// light and colour, blurred or covered areas, size and format, cut out) applied
// to the untouched original, so every change can be undone and Revert brings the
// original back. Pure: the recipe, its geometry and the numbers sharp needs.
// electron/services/photo-edit.ts renders it.

export type RedactKind = 'blur' | 'pixelate' | 'box';
export type PhotoFormat = 'same' | 'jpeg' | 'png' | 'webp';

/** A rectangle as fractions (0–1) of the picture it sits on. */
export interface Rect { x: number; y: number; w: number; h: number }

export interface PhotoRecipe {
  v: 1;
  /** quarter turns clockwise */
  turns: 0 | 1 | 2 | 3;
  flip: boolean;
  /** small turn to level the horizon, degrees (−45 to 45); the edges are cropped away */
  straighten: number;
  /** of the turned and straightened picture */
  crop?: Rect;
  /** −100 to 100 */
  exposure: number;
  contrast: number;
  saturation: number;
  /** cooler (−) or warmer (+) */
  temperature: number;
  /** areas blurred, pixelated or covered, as fractions of the cropped picture */
  redact: (Rect & { kind: RedactKind })[];
  /** longest side in pixels (0: as it is) */
  maxSide: number;
  format: PhotoFormat;
  /** the subject cut out from its background (on this computer, with the downloadable model) */
  cutout: boolean;
}

export const defaultRecipe = (): PhotoRecipe => ({ v: 1, turns: 0, flip: false, straighten: 0, exposure: 0, contrast: 0, saturation: 0, temperature: 0, redact: [], maxSide: 0, format: 'same', cutout: false });

const clampN = (v: unknown, lo: number, hi: number, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const clampRect = (r: Partial<Rect> | undefined): Rect | undefined => {
  if (!r) return undefined;
  const x = clampN(r.x, 0, 1);
  const y = clampN(r.y, 0, 1);
  const w = clampN(r.w, 0, 1 - x);
  const h = clampN(r.h, 0, 1 - y);
  return w > 0.005 && h > 0.005 ? { x, y, w, h } : undefined;
};

export function normalizeRecipe(v: unknown): PhotoRecipe {
  const d = defaultRecipe();
  if (!v || typeof v !== 'object') return d;
  const r = v as Partial<PhotoRecipe>;
  const crop = clampRect(r.crop);
  const full = crop && crop.x < 0.001 && crop.y < 0.001 && crop.w > 0.999 && crop.h > 0.999;
  return {
    v: 1,
    turns: ([0, 1, 2, 3] as const).includes(r.turns as 0) ? (r.turns as PhotoRecipe['turns']) : 0,
    flip: r.flip === true,
    straighten: clampN(r.straighten, -45, 45),
    ...(crop && !full ? { crop } : {}),
    exposure: clampN(r.exposure, -100, 100),
    contrast: clampN(r.contrast, -100, 100),
    saturation: clampN(r.saturation, -100, 100),
    temperature: clampN(r.temperature, -100, 100),
    redact: (Array.isArray(r.redact) ? r.redact : []).map((x) => ({ ...clampRect(x), kind: (['blur', 'pixelate', 'box'] as const).includes(x?.kind as RedactKind) ? x.kind : 'blur' })).filter((x): x is Rect & { kind: RedactKind } => x.w !== undefined).slice(0, 50),
    maxSide: [0, 640, 1080, 1600, 2048, 3840].includes(r.maxSide as number) ? (r.maxSide as number) : 0,
    format: (['same', 'jpeg', 'png', 'webp'] as const).includes(r.format as PhotoFormat) ? (r.format as PhotoFormat) : 'same',
    cutout: r.cutout === true,
  };
}

/** Nothing would change. */
export function isUnchanged(r: PhotoRecipe): boolean {
  return JSON.stringify(normalizeRecipe(r)) === JSON.stringify(defaultRecipe());
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

/** Crop shapes offered: free, the original's, square and common photo shapes. */
export const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: 'Square', ratio: 1 },
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

// ---------------------------------------------------------------- light and colour

/** Exposure as a brightness factor: ±100 is about ±1.5 stops. */
export const exposureFactor = (e: number) => Math.round(2 ** ((e / 100) * 1.5) * 1000) / 1000;

/** Contrast as sharp's linear(a, b) around mid-grey. */
export function contrastLinear(c: number): { a: number; b: number } {
  const a = c >= 0 ? 1 + (c / 100) * 0.8 : 1 + (c / 100) * 0.6;
  return { a: Math.round(a * 1000) / 1000, b: Math.round(128 * (1 - a) * 1000) / 1000 };
}

export const saturationFactor = (s: number) => Math.round((1 + s / 100) * 1000) / 1000;

/** Warmer adds red and takes blue; cooler the other way. A 3 × 3 colour matrix for sharp's recomb. */
export function temperatureMatrix(t: number): [[number, number, number], [number, number, number], [number, number, number]] {
  const k = t / 100;
  const r = 1 + 0.18 * k;
  const g = 1 + 0.04 * k;
  const b = 1 - 0.2 * k;
  const q = (v: number) => Math.round(v * 1000) / 1000;
  return [[q(r), 0, 0], [0, q(g), 0], [0, 0, q(b)]];
}

// ---------------------------------------------------------------- words and names

/** "Turned · Cropped · Brighter · Warmer · 2 areas hidden" for the Revert line. */
export function describeRecipe(r: PhotoRecipe): string {
  const out: string[] = [];
  if (r.turns || r.flip || r.straighten) out.push(r.straighten ? 'Straightened' : r.flip && !r.turns ? 'Flipped' : 'Turned');
  if (r.crop) out.push('Cropped');
  if (r.exposure) out.push(r.exposure > 0 ? 'Brighter' : 'Darker');
  if (r.contrast) out.push(r.contrast > 0 ? 'More contrast' : 'Less contrast');
  if (r.saturation) out.push(r.saturation > 0 ? 'More colour' : r.saturation <= -100 ? 'Black and white' : 'Less colour');
  if (r.temperature) out.push(r.temperature > 0 ? 'Warmer' : 'Cooler');
  if (r.redact.length) out.push(`${r.redact.length} area${r.redact.length === 1 ? '' : 's'} hidden`);
  if (r.cutout) out.push('Background removed');
  if (r.maxSide) out.push(`Resized to ${r.maxSide} px`);
  if (r.format !== 'same') out.push(r.format.toUpperCase());
  return out.join(' · ') || 'No changes';
}

const EXT: Record<Exclude<PhotoFormat, 'same'>, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

/** The format a result is written in: what was asked, PNG when cut out (it needs see-through), else the original's (pictures sharp cannot write become JPEG). */
export function outputFormat(r: PhotoRecipe, ext: string): Exclude<PhotoFormat, 'same'> {
  if (r.format !== 'same') return r.cutout && r.format === 'jpeg' ? 'png' : r.format;
  if (r.cutout) return 'png';
  const e = ext.toLowerCase().replace(/^\./, '');
  return e === 'png' ? 'png' : e === 'webp' ? 'webp' : 'jpeg';
}

export const extensionFor = (f: Exclude<PhotoFormat, 'same'>) => EXT[f];

/** Saving over the original keeps its name, unless the format changes (then it is a copy). */
export function replaceKeepsName(r: PhotoRecipe, ext: string): boolean {
  const e = ext.toLowerCase().replace(/^\./, '');
  const out = outputFormat(r, ext);
  return EXT[out] === e || (out === 'jpeg' && e === 'jpeg');
}

/** "Holiday.jpg" → "Holiday (edited).png" */
export function copyName(base: string, f: Exclude<PhotoFormat, 'same'>): string {
  const stem = base.replace(/\.[^.]+$/, '').replace(/ \(edited(?: \d+)?\)$/, '');
  return `${stem} (edited).${EXT[f]}`;
}

/** Pictures the editor opens. */
export const EDITABLE = /\.(jpe?g|png|webp|gif|tiff?|bmp|avif|heic|heif)$/i;
