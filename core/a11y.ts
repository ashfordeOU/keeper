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
}

export const TEXT_SCALES = [1, 1.1, 1.25, 1.5] as const;

export function defaultA11y(): A11ySettings {
  return { motion: 'system', textScale: 1, focusAlways: false };
}

export function normalizeA11y(v: unknown): A11ySettings {
  const d = defaultA11y();
  if (!v || typeof v !== 'object') return d;
  const r = v as Partial<A11ySettings>;
  const motion: MotionPref = r.motion === 'reduce' || r.motion === 'full' ? r.motion : 'system';
  const scale = typeof r.textScale === 'number' && Number.isFinite(r.textScale) ? Math.min(2, Math.max(1, r.textScale)) : 1;
  return { motion, textScale: Math.round(scale * 100) / 100, focusAlways: r.focusAlways === true };
}

/** Whether motion should be reduced, given the preference and what the system asks for. */
export function reduceMotion(pref: MotionPref | undefined, systemReduces: boolean): boolean {
  return pref === 'reduce' || ((pref ?? 'system') === 'system' && systemReduces);
}
