// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Accessibility preferences (Settings → Accessibility): motion, text size and
// focus outlines. Every window applies them from the shared settings.

export type MotionPref = 'system' | 'reduce' | 'full';

export interface A11ySettings {
  /** follow the system's "reduce motion", or always reduce, or always animate */
  motion: MotionPref;
  /** how much larger the interface draws (1 = normal) */
  textScale: number;
  /** show focus outlines on every focused control, not only after using the keyboard */
  focusAlways: boolean;
  /** larger text wraps to the window instead of zooming the whole window */
  reflow?: boolean;
  /** a font made for reading (downloaded once when chosen) */
  readingFont?: ReadingFont;
  /** line height for reading (0: the theme's own) */
  lineSpacing?: number;
  /** extra space between letters, in em (0: none) */
  letterSpacing?: number;
  /** buttons and switches at least 44 pixels tall */
  bigTargets?: boolean;
}

export type ReadingFont = 'theme' | 'hyperlegible' | 'dyslexic';

export const TEXT_SCALES = [1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export const LINE_SPACINGS = [0, 1.4, 1.6, 1.8] as const;
export const LETTER_SPACINGS = [0, 0.04, 0.08] as const;

export function defaultA11y(): A11ySettings {
  return { motion: 'system', textScale: 1, focusAlways: false, reflow: false, readingFont: 'theme', lineSpacing: 0, letterSpacing: 0, bigTargets: false };
}

/** Fonts made for reading, under the SIL Open Font License, fetched on first use with their fingerprints checked. */
export const READING_FONTS: Record<Exclude<ReadingFont, 'theme'>, { name: string; family: string; line: string; files: { weight: number; file: string; sha256: string; bytes: number }[] }> = {
  hyperlegible: {
    name: 'Atkinson Hyperlegible', family: 'Keeper Reading Hyperlegible', line: 'Letters that are hard to mix up, made for low vision.',
    files: [
      { weight: 400, file: 'atkinson-hyperlegible-latin-400-normal.woff2', sha256: 'b09653e3ba9d95e26da5c408979f40451990a4573ce5f96abe6982e2fcb09e6c', bytes: 17184 },
      { weight: 700, file: 'atkinson-hyperlegible-latin-700-normal.woff2', sha256: 'd8e8b1e0e929651439e25e23ade4b9d6cac073f2444aadb8e8b85431726c2036', bytes: 17616 },
    ],
  },
  dyslexic: {
    name: 'OpenDyslexic', family: 'Keeper Reading Dyslexic', line: 'Weighted letters some people with dyslexia find easier.',
    files: [
      { weight: 400, file: 'opendyslexic-latin-400-normal.woff2', sha256: 'f007004af3cda5d8076e57c943f8cc8d00a0da25988b1ae1048683d60e7cac1a', bytes: 115280 },
      { weight: 700, file: 'opendyslexic-latin-700-normal.woff2', sha256: 'dd9fa9c7991113b0dddefe9506a30ad26b48e302b7a8fb91719a4726e8fde85b', bytes: 120356 },
    ],
  },
};

/** Where each font file comes from (a pinned package version on a public mirror). */
export function readingFontUrl(file: string, base = 'https://cdn.jsdelivr.net/npm'): string {
  return file.startsWith('atkinson') ? `${base}/@fontsource/atkinson-hyperlegible@5.0.8/files/${file}` : `${base}/@fontsource/opendyslexic@5.0.0/files/${file}`;
}

export function normalizeA11y(v: unknown): A11ySettings {
  const d = defaultA11y();
  if (!v || typeof v !== 'object') return d;
  const r = v as Partial<A11ySettings>;
  const motion: MotionPref = r.motion === 'reduce' || r.motion === 'full' ? r.motion : 'system';
  const scale = typeof r.textScale === 'number' && Number.isFinite(r.textScale) ? Math.min(2, Math.max(1, r.textScale)) : 1;
  const pick = <T extends number>(v: unknown, list: readonly T[]): T => (list.includes(v as T) ? (v as T) : list[0]);
  return {
    motion, textScale: Math.round(scale * 100) / 100, focusAlways: r.focusAlways === true, reflow: r.reflow === true,
    readingFont: r.readingFont === 'hyperlegible' || r.readingFont === 'dyslexic' ? r.readingFont : 'theme',
    lineSpacing: pick(r.lineSpacing, LINE_SPACINGS), letterSpacing: pick(r.letterSpacing, LETTER_SPACINGS), bigTargets: r.bigTargets === true,
  };
}

/** Whether motion should be reduced, given the preference and what the system asks for. */
export function reduceMotion(pref: MotionPref | undefined, systemReduces: boolean): boolean {
  return pref === 'reduce' || ((pref ?? 'system') === 'system' && systemReduces);
}
