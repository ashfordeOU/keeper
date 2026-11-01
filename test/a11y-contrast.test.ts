// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Accessibility: every theme's text and muted text reads on every surface it
// sits on (WCAG AA: 4.5:1 for normal text, 3:1 for large text and for the
// colours that mark controls and states), in light and dark.

import { describe, expect, it } from 'vitest';
import { contrast, over, parseColor, THEMES, toHex, type Tokens } from '../core/themes';

/** A translucent token painted over the surface under it. */
const flat = (top: string, under: string) => toHex(over(parseColor(top)!, parseColor(under)!));

/** The opaque surfaces text sits on: the window, cards and panels, sunk areas, and a hovered row on each. */
function surfaces(k: Tokens): Record<string, string> {
  return {
    bg: k.bg, 'bg-elev': k['bg-elev'], 'bg-sunk': k['bg-sunk'],
    'bg-hover on bg-elev': flat(k['bg-hover'], k['bg-elev']), 'bg-hover on bg': flat(k['bg-hover'], k.bg), 'bg-hover on bg-sunk': flat(k['bg-hover'], k['bg-sunk']),
  };
}

/** Mixes two colours in sRGB, as CSS color-mix(in srgb, a, b t) does. */
function mix(a: string, b: string, t: number): string {
  const x = parseColor(a)!;
  const y = parseColor(b)!;
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t, a: 1 });
}

/** A selected row or card (muted text there switches to text-2: src/styles/a11y.css). */
const selected = (k: Tokens) => flat(k['accent-soft'], k['bg-elev']);

function failures(k: Tokens): string[] {
  const bad: string[] = [];
  const need = (what: string, fg: string, bg: string, min: number) => {
    const r = contrast(fg, bg);
    if (r < min) bad.push(`${what}: ${r.toFixed(2)} < ${min}`);
  };
  for (const [name, bg] of Object.entries(surfaces(k))) {
    // Normal-size text: body, secondary and muted (meta lines, captions, counts).
    for (const fg of ['text', 'text-2', 'text-3'] as const) need(`${fg} on ${name}`, k[fg], bg, 4.5);
  }
  for (const [name, bg] of Object.entries(surfaces(k)).slice(0, 3)) {
    // Controls and states: the accent (focus rings, switches, links), and the status colours.
    for (const fg of ['accent', 'danger', 'ok', 'warn'] as const) need(`${fg} on ${name}`, k[fg], bg, 3);
  }
  // Status text on its own soft tint (badges, chips): the colour pulled 35% toward the text (src/styles/a11y.css).
  for (const c of ['ok', 'warn', 'danger', 'accent'] as const) {
    const ink = mix(k[c], k.text, 0.35);
    for (const [name, bg] of Object.entries(surfaces(k)).slice(0, 3)) need(`${c} ink on ${c}-soft over ${name}`, ink, flat(k[`${c}-soft`], bg), 4.5);
  }
  need('text on a selected row', k.text, selected(k), 4.5);
  need('text-2 on a selected row', k['text-2'], selected(k), 4.5);
  need('accent-text on accent', k['accent-text'], k.accent, 4.5);
  need('island text', k['island-text'], k['island-bg'], 4.5);
  need('island accent text', k['island-accent-text'], k['island-accent'], 4.5);
  // Large text (headings at 18px+, the Island's big numbers) only needs 3:1, which normal text already covers.
  return bad;
}

describe('theme contrast (WCAG AA)', () => {
  it('covers all 38 themes', () => {
    expect(THEMES.length).toBe(38);
  });
  for (const t of THEMES) {
    for (const mode of ['light', 'dark'] as const) {
      const k = t[mode];
      if (!k) continue;
      it(`${t.id} (${mode}): text, muted text and controls are readable`, () => {
        expect(failures(k)).toEqual([]);
      });
    }
  }
});
