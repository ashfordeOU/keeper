// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Looks: a handful of Keeper's own one-click styles, and the person's own saved
// ones. A look sets only the light and colour sliders (never the crop, the cut
// out or anything added), so it is undone like any other change.

import { ADJUST_KEYS, BANDS, defaultRecipe, normalizeRecipe, type AdjustKey, type Band, type PhotoRecipe } from './photo-edit';

export interface Look {
  id: string;
  name: string;
  /** a few words under the name */
  line?: string;
  values: Partial<Pick<PhotoRecipe, AdjustKey | 'hsl' | 'curve'>>;
  own?: boolean;
}

export const LOOKS: Look[] = [
  { id: 'clear-day', name: 'Clear day', line: 'Brighter, crisp, true colour', values: { exposure: 8, contrast: 12, highlights: -15, shadows: 15, vibrance: 20, clarity: 15 } },
  { id: 'golden', name: 'Golden hour', line: 'Warm and soft', values: { temperature: 28, tint: 4, highlights: -20, shadows: 10, vibrance: 15, saturation: 5, vignette: -15, hsl: { orange: [0, 10, 5], yellow: [-10, 10, 0] } } },
  { id: 'cool-morning', name: 'Cool morning', line: 'Fresh blue light', values: { temperature: -22, exposure: 5, contrast: -5, highlights: -10, saturation: -5, hsl: { blue: [0, 15, 0], aqua: [0, 10, 0] } } },
  { id: 'soft-film', name: 'Soft film', line: 'Faded blacks, gentle grain', values: { contrast: -15, blacks: 30, vibrance: -10, grain: 25, curve: [[0, 22], [64, 70], [192, 196], [255, 245]] } },
  { id: 'vivid', name: 'Vivid', line: 'Bold colour for travel', values: { contrast: 20, vibrance: 35, saturation: 10, clarity: 20, whites: 10, blacks: -10 } },
  { id: 'quiet', name: 'Quiet', line: 'Muted, calm tones', values: { contrast: -10, saturation: -35, highlights: -10, shadows: 10, tint: 4, temperature: 5 } },
  { id: 'mono', name: 'Mono', line: 'Black and white, rich tones', values: { saturation: -100, contrast: 25, clarity: 15, whites: 10, blacks: -12 } },
  { id: 'mono-soft', name: 'Silver', line: 'Soft black and white', values: { saturation: -100, contrast: -10, highlights: -20, shadows: 20, grain: 15, curve: [[0, 18], [128, 132], [255, 240]] } },
];

/** A recipe with a look's values in place of the current light and colour (the rest kept). */
export function applyLook(r: PhotoRecipe, look: Look): PhotoRecipe {
  const d = defaultRecipe();
  const next: PhotoRecipe = { ...r, hsl: {}, curve: [], look: look.name };
  for (const k of ADJUST_KEYS) next[k] = (look.values[k] as number | undefined) ?? d[k];
  if (look.values.hsl) next.hsl = { ...look.values.hsl };
  if (look.values.curve) next.curve = look.values.curve.map((p) => [p[0], p[1]] as [number, number]);
  return normalizeRecipe(next);
}

/** The current light and colour as a new look of the person's own. */
export function lookFrom(r: PhotoRecipe, name: string): Look {
  const values: Look['values'] = {};
  for (const k of ADJUST_KEYS) if (r[k]) values[k] = r[k];
  if (Object.keys(r.hsl).length) values.hsl = { ...r.hsl };
  if (r.curve.length) values.curve = r.curve.map((p) => [p[0], p[1]] as [number, number]);
  const clean = name.trim().slice(0, 40) || 'My look';
  return { id: `own-${clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'look'}`, name: clean, values, own: true };
}

/** Own looks read back from disk, cleaned (anything odd is dropped). */
export function cleanLooks(v: unknown): Look[] {
  if (!Array.isArray(v)) return [];
  const out: Look[] = [];
  for (const x of v.slice(0, 50)) {
    if (!x || typeof x !== 'object' || typeof (x as Look).name !== 'string') continue;
    const r = normalizeRecipe({ ...(x as Look).values });
    const look = lookFrom(r, (x as Look).name);
    if (!out.some((o) => o.id === look.id)) out.push(look);
  }
  return out;
}

/** Is this look what the sliders show now? */
export function isLookApplied(r: PhotoRecipe, look: Look): boolean {
  const a = applyLook(r, look);
  return ADJUST_KEYS.every((k) => a[k] === r[k]) && JSON.stringify(a.hsl) === JSON.stringify(r.hsl) && JSON.stringify(a.curve) === JSON.stringify(r.curve);
}

export const bandIds = (): Band[] => BANDS.map((b) => b.id);
