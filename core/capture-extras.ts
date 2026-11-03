// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The pure parts of Capture's extras: finding how far a page moved between two
// frames and stitching the frames of a scrolling capture into one tall
// picture, a window's soft shadow on a see-through background, and the small
// choices (self-timer, pinned picture opacity, the after-capture preview).
// Pictures are raw 4-bytes-per-pixel buffers with alpha last (BGRA or RGBA:
// nothing here depends on the colour order).

export interface Bitmap {
  data: Uint8Array;
  width: number;
  height: number;
}

const BINS = 48;

/** Each row as a short profile: the brightness of BINS column groups. */
export function rowProfiles(img: Bitmap): Float32Array {
  const { data, width, height } = img;
  const out = new Float32Array(height * BINS);
  const per = width / BINS;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let b = 0; b < BINS; b++) {
      const x0 = Math.floor(b * per);
      const x1 = Math.max(x0 + 1, Math.floor((b + 1) * per));
      let sum = 0;
      for (let x = x0; x < x1; x++) {
        const i = row + x * 4;
        sum += data[i] + data[i + 1] + data[i + 2];
      }
      out[y * BINS + b] = sum / ((x1 - x0) * 3);
    }
  }
  return out;
}

function rowDiff(a: Float32Array, ra: number, b: Float32Array, rb: number): number {
  let d = 0;
  const oa = ra * BINS;
  const ob = rb * BINS;
  for (let k = 0; k < BINS; k++) d += Math.abs(a[oa + k] - b[ob + k]);
  return d / BINS;
}

/** A row's own detail: flat rows (empty background) match anything and say little. */
function rowDetail(a: Float32Array, r: number): number {
  let lo = 255;
  let hi = 0;
  for (let k = 0; k < BINS; k++) {
    const v = a[r * BINS + k];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}

export interface ScrollMatch {
  /** how many rows the content moved up (0: it did not move) */
  shift: number;
  /** rows at the top that stayed where they were (a fixed header) */
  top: number;
  /** rows at the bottom that stayed where they were (a fixed footer) */
  bottom: number;
  /** average difference of the matched rows (0 = identical) */
  error: number;
}

const SAME = 1.5;

/**
 * How far the content moved up from `prev` to `next` (same size). A fixed
 * header and footer are found first and left out. Returns shift -1 when the two
 * frames do not overlap (the page moved more than a screen).
 */
export function findScroll(prev: Bitmap, next: Bitmap, o: { minOverlap?: number; maxError?: number } = {}): ScrollMatch {
  if (prev.width !== next.width || prev.height !== next.height) throw new Error('Frames must be the same size');
  const h = prev.height;
  const a = rowProfiles(prev);
  const b = rowProfiles(next);
  let top = 0;
  while (top < h && rowDiff(a, top, b, top) < SAME) top++;
  if (top >= h) return { shift: 0, top: h, bottom: 0, error: 0 };
  let bottom = 0;
  while (bottom < h - top && rowDiff(a, h - 1 - bottom, b, h - 1 - bottom) < SAME) bottom++;
  // A fixed band only counts when it is a band: a few identical rows inside moving content are chance.
  const lo = top;
  const hi = h - bottom;
  const span = hi - lo;
  const minOverlap = Math.max(8, Math.round(o.minOverlap ?? span * 0.12));
  const maxError = o.maxError ?? 6;
  // Rows worth comparing: the detailed ones of `next`'s moving part.
  const detailed: number[] = [];
  for (let r = lo; r < hi; r++) if (rowDetail(b, r) > 4) detailed.push(r);
  const rows = detailed.length >= 12 ? detailed : Array.from({ length: span }, (_, i) => lo + i);
  let best = { shift: -1, error: Infinity };
  for (let d = 1; d <= span - minOverlap; d++) {
    // next[r] should equal prev[r + d] for every r in the overlap.
    let sum = 0;
    let n = 0;
    const step = Math.max(1, Math.floor(rows.length / 160));
    for (let i = 0; i < rows.length; i += step) {
      const r = rows[i];
      if (r + d >= hi) break;
      sum += rowDiff(b, r, a, r + d);
      n++;
      if (n > 6 && sum / n > best.error * 1.5 && sum / n > maxError) break;
    }
    if (n < 6) continue;
    const err = sum / n;
    if (err < best.error) best = { shift: d, error: err };
  }
  if (best.shift < 0 || best.error > maxError) return { shift: -1, top, bottom, error: best.error };
  return { shift: best.shift, top, bottom, error: best.error };
}

/**
 * One tall picture from the frames of a scrolling capture: the first frame
 * down to its fixed footer, then from each next frame only the rows that came
 * into view, and the fixed footer once at the very end.
 */
export function stitch(frames: Bitmap[], matches: ScrollMatch[]): Bitmap {
  if (!frames.length) throw new Error('Nothing to stitch');
  const { width, height } = frames[0];
  const footer = Math.max(0, ...matches.map((m) => (m.shift > 0 ? m.bottom : 0)));
  const pieces: { f: number; y0: number; y1: number }[] = [{ f: 0, y0: 0, y1: height - footer }];
  for (let i = 1; i < frames.length; i++) {
    const m = matches[i - 1];
    if (!m || m.shift <= 0) continue;
    const end = height - footer;
    pieces.push({ f: i, y0: Math.max(m.top, end - m.shift), y1: end });
  }
  if (footer) pieces.push({ f: frames.length - 1, y0: height - footer, y1: height });
  const total = pieces.reduce((s, p) => s + (p.y1 - p.y0), 0);
  const out = new Uint8Array(width * total * 4);
  let y = 0;
  for (const p of pieces) {
    const src = frames[p.f].data;
    const rowBytes = width * 4;
    out.set(src.subarray(p.y0 * rowBytes, p.y1 * rowBytes), y * rowBytes);
    y += p.y1 - p.y0;
  }
  return { data: out, width, height: total };
}

/** How many wheel steps move about this many pixels (a step is roughly 50 to 100 pixels; matching takes care of the rest). */
export function wheelSteps(areaHeight: number, perStep = 80): number {
  return Math.max(1, Math.min(15, Math.round((areaHeight * 0.6) / perStep)));
}

// ---------------------------------------------------------------- window shadow

export interface ShadowOptions {
  /** blur radius in pixels */
  blur: number;
  /** how far the shadow falls down */
  offsetY: number;
  /** 0..1 */
  opacity: number;
  /** rounded corners of the window (pixels), 0 for square */
  corner: number;
}

/** Shadow sizes for a picture at this scale (2 on a Retina screen). */
export function shadowFor(scale: number, rounded: boolean): ShadowOptions {
  const s = Math.max(1, scale);
  return { blur: Math.round(28 * s), offsetY: Math.round(12 * s), opacity: 0.45, corner: rounded ? Math.round(10 * s) : 0 };
}

/** Three box blurs approximate a Gaussian; works on one channel in place. */
function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  if (r < 1) return;
  const tmp = new Float32Array(src.length);
  const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    const lines = horizontal ? h : w;
    const len = horizontal ? w : h;
    const at = (line: number, i: number) => (horizontal ? line * w + i : i * w + line);
    const win = r * 2 + 1;
    for (let line = 0; line < lines; line++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += from[at(line, Math.min(len - 1, Math.max(0, i)))];
      for (let i = 0; i < len; i++) {
        to[at(line, i)] = acc / win;
        const add = Math.min(len - 1, i + r + 1);
        const sub = Math.max(0, i - r);
        acc += from[at(line, add)] - from[at(line, sub)];
      }
    }
  };
  for (let k = 0; k < 3; k++) {
    pass(src, tmp, true);
    pass(tmp, src, false);
  }
}

/** Is this pixel outside a rounded corner of a w×h rectangle? Returns coverage 0..1. */
function cornerCoverage(x: number, y: number, w: number, h: number, r: number): number {
  if (r <= 0) return 1;
  const cx = x < r ? r : x >= w - r ? w - r : -1;
  const cy = y < r ? r : y >= h - r ? h - r : -1;
  if (cx < 0 || cy < 0) return 1;
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0, Math.min(1, r - d + 0.5));
}

/**
 * The window on a see-through background with a soft shadow under it (and
 * rounded corners when asked). The result is bigger than the picture by the
 * shadow's room on every side.
 */
export function withShadow(img: Bitmap, o: ShadowOptions): Bitmap {
  const pad = Math.ceil(o.blur * 1.5) + Math.abs(o.offsetY);
  const W = img.width + pad * 2;
  const H = img.height + pad * 2;
  // The shadow's shape: the window's coverage, moved down, then blurred.
  const shape = new Float32Array(W * H);
  for (let y = 0; y < img.height; y++) {
    const ty = y + pad + o.offsetY;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < img.width; x++) shape[ty * W + x + pad] = cornerCoverage(x, y, img.width, img.height, o.corner) * (img.data[(y * img.width + x) * 4 + 3] / 255);
  }
  boxBlur(shape, W, H, Math.max(1, Math.round(o.blur / 3)));
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) out[i * 4 + 3] = Math.round(Math.min(1, shape[i]) * o.opacity * 255);
  // The window over its shadow ("source over"; the shadow is black, so only alpha mixes).
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const si = (y * img.width + x) * 4;
      const di = ((y + pad) * W + x + pad) * 4;
      const a = (img.data[si + 3] / 255) * cornerCoverage(x, y, img.width, img.height, o.corner);
      const ba = out[di + 3] / 255;
      const oa = a + ba * (1 - a);
      if (oa <= 0) continue;
      for (let c = 0; c < 3; c++) out[di + c] = Math.round((img.data[si + c] * a) / oa);
      out[di + 3] = Math.round(oa * 255);
    }
  }
  return { data: out, width: W, height: H };
}

// ---------------------------------------------------------------- small choices

/** Self-timer choices, in seconds (0: none). */
export const TIMER_CHOICES = [0, 3, 5, 10] as const;

export function normalizeTimer(v: unknown): number {
  return TIMER_CHOICES.includes(v as (typeof TIMER_CHOICES)[number]) ? (v as number) : 0;
}

/** A pinned picture's opacity: never so faint that it is lost. */
export function pinOpacity(v: number): number {
  return Math.max(0.2, Math.min(1, Math.round(v * 20) / 20));
}

/** The opacity a number key sets: 1 → 10 %, … 9 → 90 %, 0 → 100 % (but never under 20 %). */
export function opacityForKey(key: string): number | null {
  if (!/^[0-9]$/.test(key)) return null;
  return pinOpacity(key === '0' ? 1 : Number(key) / 10);
}

/** The size a pinned picture opens at: its own size in points, but at most 60 % of the screen. */
export function pinSize(img: { width: number; height: number }, scale: number, area: { width: number; height: number }): { width: number; height: number } {
  const w = img.width / Math.max(1, scale);
  const h = img.height / Math.max(1, scale);
  const k = Math.min(1, (area.width * 0.6) / w, (area.height * 0.6) / h);
  return { width: Math.max(80, Math.round(w * k)), height: Math.max(60, Math.round(h * k)) };
}

/** The after-capture previews: newest at the bottom, at most `max` shown; the rest wait. */
export function previewStack<T>(items: T[], max = 4): { shown: T[]; more: number } {
  return { shown: items.slice(-max), more: Math.max(0, items.length - max) };
}

/** Where the preview stack sits: the bottom-right corner of the screen's free area. */
export function previewBounds(area: { x: number; y: number; width: number; height: number }, count: number, card = { width: 232, height: 158 }, gap = 12, margin = 18): { x: number; y: number; width: number; height: number } {
  const n = Math.max(1, count);
  const height = n * card.height + (n - 1) * gap + margin;
  const width = card.width + margin;
  return { x: area.x + area.width - width - margin / 2, y: area.y + area.height - height - margin / 2, width, height };
}
