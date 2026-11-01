// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Better text capture with the built-in reader (Tesseract) on Windows and
// Linux: clean the picture first (grey, stretch the contrast, turn light text
// on dark into dark on light, then black and white at the best threshold), and
// tell the reader how the text is laid out. Handwriting goes to the system's
// recognizer where there is one (Windows.Media.Ocr, macOS Vision). Pure.

export type OcrEngine = 'auto' | 'system' | 'builtin';
export type OcrLayout = 'auto' | 'block' | 'line' | 'word' | 'sparse' | 'column';

/** Tesseract page segmentation modes for each layout. */
export function psmFor(layout: OcrLayout | undefined): string {
  return { auto: '3', block: '6', line: '7', word: '8', sparse: '11', column: '4' }[layout ?? 'auto'];
}

/** Grey levels (0–255) from a 4-bytes-per-pixel bitmap (RGBA or BGRA: the average does not care). */
export function toGray(px: Uint8Array | Buffer, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (px[i] + px[i + 1] + px[i + 2]) / 3;
  return out;
}

/** Otsu's threshold: the grey level that best splits text from background. */
export function otsu(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const g of gray) hist[g]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

/** Most pixels darker than the threshold: light text on a dark background (dark mode, terminals). */
export function isDarkBackground(gray: Uint8Array, threshold: number): boolean {
  let dark = 0;
  for (const g of gray) if (g <= threshold) dark++;
  return dark > gray.length / 2;
}

/**
 * Black text on white, ready for the reader. Returns RGBA (alpha 255).
 * `keepGrey` stretches contrast without binarising (better for handwriting and photos).
 */
export function enhanceForOcr(px: Uint8Array | Buffer, width: number, height: number, o: { keepGrey?: boolean } = {}): Uint8Array {
  const gray = toGray(px, width, height);
  const t = otsu(gray);
  const invert = isDarkBackground(gray, t);
  let lo = 255;
  let hi = 0;
  for (const g of gray) { if (g < lo) lo = g; if (g > hi) hi = g; }
  const span = Math.max(1, hi - lo);
  const out = new Uint8Array(width * height * 4);
  for (let j = 0, i = 0; j < gray.length; j++, i += 4) {
    let v: number;
    if (o.keepGrey) v = Math.round(((gray[j] - lo) / span) * 255);
    else v = gray[j] > t ? 255 : 0;
    if (invert) v = 255 - v;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return out;
}

/** How much to scale a crop: the reader likes letters about 30 px tall. */
export function scaleFor(width: number, height: number, accurate: boolean): number {
  const longest = Math.max(width, height);
  if (accurate) return longest < 1200 ? Math.min(3, 1800 / Math.max(1, longest)) : 1;
  return longest > 1400 ? 1400 / longest : 1;
}

/** Which engine reads this capture. */
export function pickEngine(o: { engine?: OcrEngine; handwriting?: boolean; systemAvailable: boolean }): 'system' | 'builtin' {
  if (o.engine === 'builtin' || !o.systemAvailable) return 'builtin';
  if (o.engine === 'system' || o.handwriting) return 'system';
  return 'system';
}

/** Reader parameters for a layout (spaces kept inside lines; a dictionary-light mode for codes). */
export function tesseractParams(layout: OcrLayout | undefined, o: { keepSpaces?: boolean } = {}): Record<string, string> {
  return { tessedit_pageseg_mode: psmFor(layout), preserve_interword_spaces: o.keepSpaces === false ? '0' : '1', user_defined_dpi: '300' };
}
