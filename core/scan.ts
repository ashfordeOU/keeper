// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Turning a photo of a page into a flat scan: find the page's four corners,
// pull it straight (perspective correction) and clean it to crisp black and
// white even under uneven light. Pure pixel maths, no native code.

export interface Pt { x: number; y: number }
/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

/** Otsu's threshold of 8-bit grey values. */
export function otsu(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let at = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; at = t; }
  }
  return at;
}

/** A 5×5 box blur (grey), to quiet paper texture before looking for the page. */
export function boxBlur(gray: Uint8Array, w: number, h: number, r = 2): Uint8Array {
  const tmp = new Float32Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += gray[y * w + xx]; n++; } }
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } }
    out[y * w + x] = Math.round(s / n);
  }
  return out;
}

/**
 * Finds the page in a (small) grey picture: the largest bright region that
 * is clearly smaller than the whole picture, and its four corners. Null when
 * no page stands out (the photo is already just the page, or too busy).
 */
export function findPage(gray: Uint8Array, w: number, h: number): Quad | null {
  const g = boxBlur(gray, w, h);
  const t = otsu(g);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) mask[i] = g[i] > t ? 1 : 0;
  // Largest connected bright region.
  const label = new Int32Array(w * h).fill(-1);
  let bestId = -1, bestSize = 0;
  const stack: number[] = [];
  let id = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    let size = 0;
    stack.push(i);
    label[i] = id;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w, y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && mask[q] && label[q] < 0) { label[q] = id; stack.push(q); }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
    id++;
  }
  const area = w * h;
  if (bestId < 0 || bestSize < area * 0.12 || bestSize > area * 0.97) return null;
  let tl = { x: 0, y: 0, v: Infinity }, br = { x: 0, y: 0, v: -Infinity }, tr = { x: 0, y: 0, v: -Infinity }, bl = { x: 0, y: 0, v: Infinity };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (label[y * w + x] !== bestId) continue;
    const s = x + y, d = x - y;
    if (s < tl.v) tl = { x, y, v: s };
    if (s > br.v) br = { x, y, v: s };
    if (d > tr.v) tr = { x, y, v: d };
    if (d < bl.v) bl = { x, y, v: d };
  }
  const quad: Quad = [{ x: tl.x, y: tl.y }, { x: tr.x, y: tr.y }, { x: br.x, y: br.y }, { x: bl.x, y: bl.y }];
  // A real page has some width and height and its region fills most of its outline.
  const [qw, qh] = quadSize(quad);
  if (qw < w * 0.2 || qh < h * 0.2) return null;
  if (bestSize < polygonArea(quad) * 0.75) return null;
  return quad;
}

export function polygonArea(q: Pt[]): number {
  let s = 0;
  for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s) / 2;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Width and height of the flattened page: the longer of each pair of opposite edges. */
export function quadSize(q: Quad): [number, number] {
  return [Math.round(Math.max(dist(q[0], q[1]), dist(q[3], q[2]))), Math.round(Math.max(dist(q[0], q[3]), dist(q[1], q[2])))];
}

export const scaleQuad = (q: Quad, s: number): Quad => q.map((p) => ({ x: p.x * s, y: p.y * s })) as Quad;

/** The 3×3 projective map (row-major, h33 = 1) that sends `from[i]` to `to[i]`. */
export function homography(from: Pt[], to: Pt[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    const d = A[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('The corners do not make a page');
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / d;
      if (!f) continue;
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return [...b.map((v, i) => v / A[i][i]), 1];
}

export function applyH(H: number[], x: number, y: number): Pt {
  const d = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / d, y: (H[3] * x + H[4] * y + H[5]) / d };
}

/**
 * Pulls the page inside `quad` straight into an outW × outH picture
 * (bilinear sampling). `src` has `ch` channels per pixel.
 */
export function warpPerspective(src: Uint8Array, w: number, h: number, ch: number, quad: Quad, outW: number, outH: number): Uint8Array {
  const H = homography([{ x: 0, y: 0 }, { x: outW - 1, y: 0 }, { x: outW - 1, y: outH - 1 }, { x: 0, y: outH - 1 }], quad);
  const out = new Uint8Array(outW * outH * ch);
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const p = applyH(H, x, y);
    const x0 = Math.max(0, Math.min(w - 2, Math.floor(p.x)));
    const y0 = Math.max(0, Math.min(h - 2, Math.floor(p.y)));
    const fx = Math.max(0, Math.min(1, p.x - x0));
    const fy = Math.max(0, Math.min(1, p.y - y0));
    const o = (y * outW + x) * ch;
    for (let c = 0; c < ch; c++) {
      const a = src[(y0 * w + x0) * ch + c], b = src[(y0 * w + x0 + 1) * ch + c];
      const d = src[((y0 + 1) * w + x0) * ch + c], e = src[((y0 + 1) * w + x0 + 1) * ch + c];
      out[o + c] = Math.round(a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + d * (1 - fx) * fy + e * fx * fy);
    }
  }
  return out;
}

/**
 * Black and white that copes with shadows: each pixel is compared with the
 * average of its neighbourhood (an integral image keeps it fast).
 */
export function adaptiveThreshold(gray: Uint8Array, w: number, h: number, radius = Math.max(8, Math.round(Math.min(w, h) / 40)), offset = 12): Uint8Array {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
      const n = (x1 - x0 + 1) * (y1 - y0 + 1);
      const s = integral[(y1 + 1) * (w + 1) + x1 + 1] - integral[y0 * (w + 1) + x1 + 1] - integral[(y1 + 1) * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      out[y * w + x] = gray[y * w + x] < s / n - offset ? 0 : 255;
    }
  }
  return out;
}

/** The photos a phone says it took for one scan: plain file names of pictures only, at most 60. */
export function phoneScanFiles(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  return names
    .map((n) => String(n))
    .filter((n) => n && !/[\\/]/.test(n) && n !== '.' && n !== '..' && /\.(jpe?g|png|heic|heif|webp)$/i.test(n))
    .slice(0, 60);
}
