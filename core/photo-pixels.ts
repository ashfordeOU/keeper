// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The photo editor's pixel work that sharp has no single operation for, in
// plain TypeScript on raw interleaved pixels (3 or 4 channels): tone curves,
// vibrance and per-colour changes, vignette and grain, spot healing, cloning
// and red eye, a keystone warp, the cut-out's edge (a guided filter that follows
// the picture, the refine brush, softening) and putting a subject on a new
// background with a shadow. Pure, so it is tested without pictures on disk.

import type { Band, MaskStroke, PictureStats } from './photo-edit';
import { BANDS, project, squareToQuad } from './photo-edit';

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- tones

/** A smooth curve through points (0–255), monotone between them so it never bends back: 256 values. */
export function curveLut(points: [number, number][]): Uint8Array {
  const lut = new Uint8Array(256);
  const p = [...points].sort((a, b) => a[0] - b[0]);
  if (p.length < 2) { for (let i = 0; i < 256; i++) lut[i] = i; return lut; }
  if (p[0][0] > 0) p.unshift([0, p[0][1]]);
  if (p[p.length - 1][0] < 255) p.push([255, p[p.length - 1][1]]);
  const n = p.length;
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / Math.max(1e-6, p[i + 1][0] - p[i][0]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  // Fritsch–Carlson: keep it monotone.
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let k = 0;
  for (let x = 0; x < 256; x++) {
    while (k < n - 2 && x > p[k + 1][0]) k++;
    const [x0, y0] = p[k];
    const [x1, y1] = p[k + 1];
    const h = x1 - x0 || 1;
    const t = Math.max(0, Math.min(1, (x - x0) / h));
    const t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[k + 1];
    lut[x] = Math.round(clamp8(y));
  }
  return lut;
}

/** Highlights, shadows, whites and blacks (−100 to 100) and a tone curve, as one 256-value table. */
export function toneLut(o: { highlights: number; shadows: number; whites: number; blacks: number; curve: [number, number][] }): Uint8Array {
  const curve = o.curve.length ? curveLut(o.curve) : null;
  const lut = new Uint8Array(256);
  const bk = o.blacks / 100 * 0.12;
  const wh = o.whites / 100 * 0.12;
  for (let i = 0; i < 256; i++) {
    let x = i / 255;
    // Black and white points: below zero the ends are clipped sooner, above they are lifted or pushed.
    const lo = bk < 0 ? -bk : 0, outLo = bk > 0 ? bk : 0;
    const hi = wh > 0 ? 1 - wh : 1, outHi = wh < 0 ? 1 + wh : 1;
    x = outLo + ((Math.max(0, Math.min(1, (x - lo) / (hi - lo)))) * (outHi - outLo));
    // Shadows and highlights: smooth lifts centred on the dark and the light thirds.
    x += (o.shadows / 100) * 0.2 * x * (1 - x) * (1 - x) * 6.75;
    x += (o.highlights / 100) * 0.2 * x * x * (1 - x) * 6.75;
    const v = Math.round(clamp8(x * 255));
    lut[i] = curve ? curve[v] : v;
  }
  return lut;
}

export const isIdentity = (lut: Uint8Array) => lut.every((v, i) => v === i);

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s <= 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  const hh = h / 360;
  return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)];
}

/** How much a hue belongs to each colour band (weights add up to 1 between neighbours). */
export function bandWeights(hue: number): number[] {
  const w = new Array(BANDS.length).fill(0);
  const hs = BANDS.map((b) => b.hue);
  const h = ((hue % 360) + 360) % 360;
  for (let i = 0; i < hs.length; i++) {
    const a = hs[i], b = i + 1 < hs.length ? hs[i + 1] : hs[0] + 360;
    const hh = h < a ? h + 360 : h;
    if (hh >= a && hh <= b) { const t = (hh - a) / (b - a); w[i] = 1 - t; w[(i + 1) % hs.length] += t; break; }
  }
  return w;
}

/**
 * Tones, vibrance and per-colour hue, saturation and lightness in one pass over
 * the colour channels. `ch` is 3 or 4 (the fourth channel is left alone).
 */
export function applyColour(data: Uint8Array, ch: number, o: { lut?: Uint8Array; vibrance?: number; hsl?: Partial<Record<Band, [number, number, number]>> }): void {
  const lut = o.lut && !isIdentity(o.lut) ? o.lut : null;
  const vib = (o.vibrance ?? 0) / 100;
  const bands = o.hsl && Object.keys(o.hsl).length ? BANDS.map((b) => o.hsl![b.id] ?? [0, 0, 0]) : null;
  if (!lut && !vib && !bands) return;
  for (let i = 0; i < data.length; i += ch) {
    let r = data[i], g = data[i + 1], b = data[i + 2];
    if (lut) { r = lut[r]; g = lut[g]; b = lut[b]; }
    if (vib) {
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max ? (max - min) / max : 0;
      // Muted colours gain most; skin-like oranges a little less.
      const amt = vib > 0 ? vib * (1 - sat) * 0.9 : vib;
      const mean = (r + g + b) / 3;
      r = mean + (r - mean) * (1 + amt); g = mean + (g - mean) * (1 + amt); b = mean + (b - mean) * (1 + amt);
    }
    if (bands) {
      let [h, s, l] = rgbToHsl(clamp8(r) / 255, clamp8(g) / 255, clamp8(b) / 255);
      if (s > 0.02) {
        const w = bandWeights(h);
        let dh = 0, ds = 0, dl = 0;
        for (let k = 0; k < w.length; k++) if (w[k]) { dh += w[k] * bands[k][0]; ds += w[k] * bands[k][1]; dl += w[k] * bands[k][2]; }
        const strength = Math.min(1, s * 3);
        h += (dh / 100) * 30 * strength;
        s = Math.max(0, Math.min(1, s * (1 + (ds / 100) * strength)));
        l = Math.max(0, Math.min(1, l + (dl / 100) * 0.25 * strength * (1 - Math.abs(2 * l - 1))));
        [r, g, b] = hslToRgb(h, s, l).map((v) => v * 255) as [number, number, number];
      }
    }
    data[i] = clamp8(Math.round(r)); data[i + 1] = clamp8(Math.round(g)); data[i + 2] = clamp8(Math.round(b));
  }
}

/** Local contrast: the picture minus a blurred copy, added back (k > 0 clearer, k < 0 softer). */
export function mixDetail(data: Uint8Array, blurred: Uint8Array, ch: number, k: number): void {
  for (let i = 0; i < data.length; i += ch) for (let c = 0; c < 3; c++) data[i + c] = clamp8(Math.round(data[i + c] + k * (data[i + c] - blurred[i + c])));
}

/** Darker (amount < 0) or lighter (> 0) corners, following the picture's shape. */
export function vignette(data: Uint8Array, ch: number, w: number, h: number, amount: number): void {
  if (!amount) return;
  const a = amount / 100;
  const cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) {
    const dy = (y - cy) / cy;
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / cx;
      const t = smooth(0.35, 1.45, Math.sqrt(dx * dx + dy * dy));
      if (!t) continue;
      const i = (y * w + x) * ch;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c];
        data[i + c] = clamp8(Math.round(a < 0 ? v * (1 + a * 0.75 * t) : v + (255 - v) * a * 0.6 * t));
      }
    }
  }
}

/** Film grain: soft, even noise, the same every time for the same picture size (so previews match the saved file). */
export function grain(data: Uint8Array, ch: number, w: number, h: number, amount: number): void {
  if (!amount) return;
  const cell = Math.max(1, Math.round(Math.min(w, h) / 1200));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const noise = new Float32Array(gw * gh);
  let s = 0x9e3779b9 ^ (w * 31 + h);
  for (let i = 0; i < noise.length; i++) {
    // xorshift, two draws averaged: a softer, roughly bell-shaped noise
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    const a = (s >>> 0) / 4294967296;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    noise[i] = a + (s >>> 0) / 4294967296 - 1;
  }
  const k = (amount / 100) * 40;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = noise[Math.floor(y / cell) * gw + Math.floor(x / cell)] * k;
    const i = (y * w + x) * ch;
    // Strongest in the mid-tones, as film is.
    const l = (data[i] + data[i + 1] + data[i + 2]) / 765;
    const m = n * (0.4 + 2.4 * l * (1 - l));
    data[i] = clamp8(Math.round(data[i] + m)); data[i + 1] = clamp8(Math.round(data[i + 1] + m)); data[i + 2] = clamp8(Math.round(data[i + 2] + m));
  }
}

// ---------------------------------------------------------------- statistics

/** Light, colour and spread of a picture, for auto enhance. */
export function pictureStats(data: Uint8Array, ch: number): PictureStats {
  const hist = new Uint32Array(256);
  let r = 0, g = 0, b = 0, sat = 0, n = 0;
  const step = Math.max(1, Math.floor(data.length / ch / 250_000)) * ch;
  for (let i = 0; i < data.length; i += step) {
    if (ch === 4 && data[i + 3] < 128) continue;
    const R = data[i], G = data[i + 1], B = data[i + 2];
    r += R; g += G; b += B; n++;
    hist[Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B)]++;
    const max = Math.max(R, G, B);
    sat += max ? (max - Math.min(R, G, B)) / max : 0;
  }
  const pct = (p: number) => { let acc = 0; const want = n * p; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= want) return i; } return 255; };
  n = Math.max(1, n);
  return { mean: [r / n, g / n, b / n], p1: pct(0.01), p50: pct(0.5), p99: pct(0.99), sat: sat / n };
}

// ---------------------------------------------------------------- retouching

/** Heals a round spot (a blemish, a speck of dust, a small object): the best-matching nearby patch is blended in, its colour matched at the edge. */
export function healSpot(data: Uint8Array, ch: number, w: number, h: number, cx: number, cy: number, r: number): void {
  const R = Math.max(2, r);
  const ring: [number, number][] = [];
  for (let dy = -Math.ceil(R * 1.5); dy <= Math.ceil(R * 1.5); dy++) for (let dx = -Math.ceil(R * 1.5); dx <= Math.ceil(R * 1.5); dx++) {
    const d = Math.hypot(dx, dy);
    if (d >= R * 1.1 && d <= R * 1.5) ring.push([dx, dy]);
  }
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const px = (x: number, y: number, c: number) => data[(Math.round(y) * w + Math.round(x)) * ch + c];
  // Candidates around the spot; the one whose surroundings look most like the spot's own surroundings wins.
  let best: { sx: number; sy: number; err: number } | null = null;
  for (const dist of [2.4, 3.2, 4.2]) for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const sx = cx + Math.cos(a) * R * dist, sy = cy + Math.sin(a) * R * dist;
    if (!inside(sx - R * 1.5, sy - R * 1.5) || !inside(sx + R * 1.5, sy + R * 1.5)) continue;
    let err = 0, cnt = 0;
    for (const [dx, dy] of ring) {
      const tx = cx + dx, ty = cy + dy;
      if (!inside(tx, ty)) continue;
      for (let c = 0; c < 3; c++) { const e = px(tx, ty, c) - px(sx + dx, sy + dy, c); err += e * e; }
      cnt++;
    }
    if (cnt && (!best || err / cnt < best.err)) best = { sx, sy, err: err / cnt };
  }
  if (!best) { fillFromRing(data, ch, w, h, cx, cy, R); return; }
  // Colour match: the difference between the two surroundings is added back.
  const diff = [0, 0, 0];
  let cnt = 0;
  for (const [dx, dy] of ring) {
    const tx = cx + dx, ty = cy + dy;
    if (!inside(tx, ty)) continue;
    for (let c = 0; c < 3; c++) diff[c] += px(tx, ty, c) - px(best.sx + dx, best.sy + dy, c);
    cnt++;
  }
  for (let c = 0; c < 3; c++) diff[c] /= Math.max(1, cnt);
  copyDisc(data, ch, w, h, cx, cy, best.sx, best.sy, R, diff);
}

/** Copies a soft-edged disc from (sx, sy) to (cx, cy), optionally shifting its colour. */
export function copyDisc(data: Uint8Array, ch: number, w: number, h: number, cx: number, cy: number, sx: number, sy: number, r: number, shift: number[] = [0, 0, 0]): void {
  const R = Math.ceil(r * 1.3);
  const src = new Uint8Array(data);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const tx = Math.round(cx + dx), ty = Math.round(cy + dy);
    const fx = Math.round(sx + dx), fy = Math.round(sy + dy);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h || fx < 0 || fy < 0 || fx >= w || fy >= h) continue;
    const wt = 1 - smooth(r * 0.75, r * 1.3, Math.hypot(dx, dy));
    if (wt <= 0) continue;
    const t = (ty * w + tx) * ch, f = (fy * w + fx) * ch;
    for (let c = 0; c < 3; c++) data[t + c] = clamp8(Math.round(src[t + c] * (1 - wt) + (src[f + c] + shift[c]) * wt));
  }
}

/** Fills a disc smoothly from its rim (when there is nothing nearby to copy from, at the very edge of a picture). */
function fillFromRing(data: Uint8Array, ch: number, w: number, h: number, cx: number, cy: number, r: number): void {
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const d = Math.hypot(dx, dy);
    if (d > r) continue;
    const tx = Math.round(cx + dx), ty = Math.round(cy + dy);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
    // The four rim points straight out from this one, weighted by nearness.
    const acc = [0, 0, 0];
    let wsum = 0;
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const span = Math.sqrt(Math.max(0, r * r - (ux ? dy * dy : dx * dx)));
      const ex = Math.round(ux ? cx + ux * (span + 1) : tx), ey = Math.round(uy ? cy + uy * (span + 1) : ty);
      if (ex < 0 || ey < 0 || ex >= w || ey >= h) continue;
      const wt = 1 / Math.max(1, Math.hypot(ex - tx, ey - ty));
      const i = (ey * w + ex) * ch;
      for (let c = 0; c < 3; c++) acc[c] += data[i + c] * wt;
      wsum += wt;
    }
    if (!wsum) continue;
    const t = (ty * w + tx) * ch;
    for (let c = 0; c < 3; c++) data[t + c] = Math.round(acc[c] / wsum);
  }
}

/** Takes the red out of red eyes within a disc, leaving other colours alone. */
export function redEye(data: Uint8Array, ch: number, w: number, h: number, cx: number, cy: number, r: number): number {
  let fixed = 0;
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = Math.round(cx + dx), y = Math.round(cy + dy);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const wt = 1 - smooth(r * 0.7, r, Math.hypot(dx, dy));
    if (wt <= 0) continue;
    const i = (y * w + x) * ch;
    const R0 = data[i], G = data[i + 1], B = data[i + 2];
    const other = Math.max(G, B);
    if (R0 > 50 && R0 > other * 1.5) {
      const dark = (G + B) / 2;
      data[i] = Math.round(R0 * (1 - wt) + dark * 0.9 * wt);
      fixed++;
    }
  }
  return fixed;
}

// ---------------------------------------------------------------- geometry

/** Stretches the part of a picture inside a four-cornered shape to fill w × h again (keystone fix), with smooth sampling. */
export function warpQuad(src: Uint8Array, ch: number, w: number, h: number, quad: [number, number][]): Uint8Array {
  const m = squareToQuad(quad);
  const out = new Uint8Array(w * h * ch);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const [sx0, sy0] = project(m, (x + 0.5) / w, v);
      const sx = Math.max(0, Math.min(w - 1.001, sx0 - 0.5)), sy = Math.max(0, Math.min(h - 1.001, sy0 - 0.5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const a = (y0 * w + x0) * ch, b = a + ch, c = a + w * ch, d = c + ch;
      const o = (y * w + x) * ch;
      for (let k = 0; k < ch; k++) out[o + k] = Math.round((src[a + k] * (1 - fx) + src[b + k] * fx) * (1 - fy) + (src[c + k] * (1 - fx) + src[d + k] * fx) * fy);
    }
  }
  return out;
}

// ---------------------------------------------------------------- the cut-out's edge

/** Box sums of a w × h grid with radius r, through a summed-area table. */
function boxMean(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += a[y * w + x]; sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/**
 * A guided filter: the rough mask from the model follows the picture's own
 * edges (hair, fur, the outline against the sky). `guide` is grey 0–1, `mask` 0–1.
 */
export function guidedFilter(guide: Float32Array, mask: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h;
  const mI = boxMean(guide, w, h, r);
  const mP = boxMean(mask, w, h, r);
  const ip = new Float32Array(n), ii = new Float32Array(n);
  for (let i = 0; i < n; i++) { ip[i] = guide[i] * mask[i]; ii[i] = guide[i] * guide[i]; }
  const mIP = boxMean(ip, w, h, r);
  const mII = boxMean(ii, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mIP[i] - mI[i] * mP[i];
    const v = mII[i] - mI[i] * mI[i];
    a[i] = cov / (v + eps);
    b[i] = mP[i] - a[i] * mI[i];
  }
  const ma = boxMean(a, w, h, r), mb = boxMean(b, w, h, r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(1, ma[i] * guide[i] + mb[i]));
  return out;
}

/**
 * Grows (edge > 0) or shrinks (< 0) a soft mask and sharpens its ramp: the
 * mask is re-levelled around a moved middle. `edge` is −100 to 100.
 */
export function alphaLevels(alpha: Uint8Array, edge: number): void {
  if (!edge) return;
  const mid = 0.5 - (edge / 100) * 0.42;
  const soft = 0.18;
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(smooth(mid - soft, mid + soft, i / 255) * 255);
  for (let i = 0; i < alpha.length; i++) alpha[i] = lut[alpha[i]];
}

/** The refine brush: keep strokes paint the subject back, remove strokes take it away, with soft edges. Points are fractions of w × h. */
export function paintStrokes(alpha: Uint8Array, w: number, h: number, strokes: MaskStroke[]): void {
  const short = Math.min(w, h);
  for (const s of strokes) {
    const r = Math.max(1, s.r * short);
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < s.pts.length; i += 2) pts.push([s.pts[i] * w, s.pts[i + 1] * h]);
    if (pts.length === 1) pts.push(pts[0]);
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
      const minX = Math.max(0, Math.floor(Math.min(ax, bx) - r)), maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r));
      const minY = Math.max(0, Math.floor(Math.min(ay, by) - r)), maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / len2));
        const d = Math.hypot(x + 0.5 - (ax + t * dx), y + 0.5 - (ay + t * dy));
        const wt = 1 - smooth(r * 0.7, r, d);
        if (wt <= 0) continue;
        const i = y * w + x;
        alpha[i] = s.keep ? Math.max(alpha[i], Math.round(255 * wt)) : Math.min(alpha[i], Math.round(255 * (1 - wt)));
      }
    }
  }
}

// ---------------------------------------------------------------- new backgrounds

export const hexRgb = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** A two-colour gradient across w × h at an angle (0: top to bottom, 90: left to right), 3 channels. */
export function gradient(w: number, h: number, from: string, to: string, angle: number): Uint8Array {
  const a = hexRgb(from), b = hexRgb(to);
  const rad = (angle * Math.PI) / 180;
  const ux = Math.sin(rad), uy = Math.cos(rad);
  // Project each pixel on the direction; scale so the far corners are 0 and 1.
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => x * ux + y * uy);
  const lo = Math.min(...corners), span = Math.max(...corners) - lo || 1;
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = (x * ux + y * uy - lo) / span;
    const i = (y * w + x) * 3;
    out[i] = Math.round(a[0] + (b[0] - a[0]) * t); out[i + 1] = Math.round(a[1] + (b[1] - a[1]) * t); out[i + 2] = Math.round(a[2] + (b[2] - a[2]) * t);
  }
  return out;
}

/** Where a picture is cut from so it fills W × H without stretching (centred). */
export function coverBox(sw: number, sh: number, W: number, H: number): { left: number; top: number; width: number; height: number } {
  const k = Math.max(W / sw, H / sh);
  const width = Math.min(sw, Math.round(W / k)), height = Math.min(sh, Math.round(H / k));
  return { left: Math.floor((sw - width) / 2), top: Math.floor((sh - height) / 2), width, height };
}

/** The subject's shadow: how far down it falls, how soft and how dark, for a w × h picture and a strength of 0–100. */
export function shadowFor(w: number, h: number, strength: number): { dx: number; dy: number; sigma: number; opacity: number } {
  const short = Math.min(w, h);
  return { dx: Math.round(short * 0.012), dy: Math.round(short * 0.025), sigma: Math.max(1, short * 0.022), opacity: Math.min(0.85, (strength / 100) * 0.85) };
}

/** Shifts a one-channel mask by dx, dy (empty where it moved away from). */
export function shiftMask(a: Uint8Array, w: number, h: number, dx: number, dy: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) { const sx = x - dx; if (sx >= 0 && sx < w) out[y * w + x] = a[sy * w + sx]; }
  }
  return out;
}

/**
 * The subject (3 channels, with its alpha) over a background (3 channels),
 * with an optional shadow mask (already blurred) darkening the background.
 */
export function compose(fg: Uint8Array, alpha: Uint8Array, bg: Uint8Array, shadow?: { mask: Uint8Array; opacity: number }): Uint8Array {
  const n = alpha.length;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = alpha[i] / 255;
    const s = shadow ? 1 - (shadow.mask[i] / 255) * shadow.opacity : 1;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(fg[i * 3 + c] * a + bg[i * 3 + c] * s * (1 - a));
  }
  return out;
}

/**
 * The background blurred without the subject bleeding into it: sharp blurs the
 * picture with the background-ness as its see-through channel (so the subject
 * is left out of the average); where almost nothing of the background was near,
 * the plain blur fills in. 4 channels in, 3 out.
 */
export function blendByWeight(weighted: Uint8Array, plain: Uint8Array): Uint8Array {
  const n = weighted.length / 4;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, weighted[i * 4 + 3] / 64);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(weighted[i * 4 + c] * t + plain[i * 3 + c] * (1 - t));
  }
  return out;
}

/** The model's raw output (any range) as a 0–255 mask. */
export function normaliseMask(values: ArrayLike<number>, count: number): Uint8Array {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < count; i++) { const v = values[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const out = new Uint8Array(count);
  const span = hi - lo || 1;
  for (let i = 0; i < count; i++) out[i] = Math.round(((values[i] - lo) / span) * 255);
  return out;
}
