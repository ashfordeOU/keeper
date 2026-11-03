// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's colours (core/island-look.ts): every theme, in every mode, look and intensity, with and
// without a live colour or a custom accent, keeps all of the Island's text at WCAG AA on every part of its
// background; light themes get a light Island; the look follows the theme.

import { describe, expect, it } from 'vitest';
import { THEMES, contrast, luminance, parseColor, type ThemeMode, type Tokens } from '../core/themes';
import { ISLAND_INTENSITIES, ISLAND_LOOKS, ISLAND_PRESETS, cleanLook, islandContrast, islandPalette, islandVars, liveTint, readableTint, surfaceSamples, turnHue} from '../core/island-look';

const modes = (t: (typeof THEMES)[number]) => (['light', 'dark'] as ThemeMode[]).filter((m) => t[m]).map((m) => [m, t[m]!] as [ThemeMode, Tokens]);
const lum = (c: string) => luminance(parseColor(c)!);
const LIVES = [undefined, '#ff375f', '#30d158', '#ffd60a', '#0a84ff', '#a78bfa', '#ff9f0a'];

describe('the Island follows the theme', () => {
  it(`every theme (${THEMES.length}), mode, look, intensity and live colour keeps AA contrast`, () => {
    const bad: string[] = [];
    let n = 0;
    for (const t of THEMES) for (const [mode, tokens] of modes(t)) for (const look of ISLAND_LOOKS) for (const it of ISLAND_INTENSITIES) for (const live of LIVES) {
      const presets = look.id === 'colorful' ? ISLAND_PRESETS.map((p) => p.id) : [undefined];
      for (const preset of presets) {
        const p = islandPalette({ tokens, mode, look: look.id, lookIntensity: it.id, lookPreset: preset, live });
        n++;
        for (const c of islandContrast(p)) if (c.ratio < c.min) bad.push(`${t.id}/${mode}/${look.id}/${it.id}/${preset ?? ''}/${live ?? 'none'}: ${c.pair} ${c.ratio.toFixed(2)} < ${c.min}`);
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(bad).toEqual([]);
  });

  it('custom accents, even hard ones, still keep AA contrast', () => {
    const bad: string[] = [];
    for (const accent of ['#ffff00', '#000000', '#ffffff', '#777777', '#00ffcc', '#ff00ff', '#1a237e']) for (const t of THEMES) for (const [mode, tokens] of modes(t)) for (const look of ISLAND_LOOKS) {
      const p = islandPalette({ tokens, mode, look: look.id, lookAccent: accent, live: '#ffd60a' });
      for (const c of islandContrast(p)) if (c.ratio < c.min) bad.push(`${t.id}/${mode}/${look.id}/${accent}: ${c.pair} ${c.ratio.toFixed(2)}`);
    }
    expect(bad).toEqual([]);
  });

  it('light themes get a light Island and dark themes a dark one (Match theme)', () => {
    for (const t of THEMES) for (const [mode, tokens] of modes(t)) {
      const p = islandPalette({ tokens, mode, look: 'theme' });
      expect(p.scheme, `${t.id}/${mode}`).toBe(mode);
      if (mode === 'light') expect(Math.min(...p.stops.map(lum)), `${t.id} light`).toBeGreaterThan(0.35);
      else expect(Math.max(...p.stops.map(lum)), `${t.id} dark`).toBeLessThan(0.2);
    }
  });

  it('Dark is dark in every theme, and Colourful is a vivid gradient', () => {
    for (const t of THEMES) for (const [mode, tokens] of modes(t)) {
      expect(islandPalette({ tokens, mode, look: 'dark' }).scheme).toBe('dark');
      const c = islandPalette({ tokens, mode, look: 'colorful', lookPreset: 'lagoon' });
      expect(c.scheme).toBe('dark');
      expect(new Set(c.stops).size).toBe(3);
    }
  });

  it('the background changes with the theme', () => {
    const bg = (id: string, mode: ThemeMode) => { const t = THEMES.find((x) => x.id === id)!; return islandPalette({ tokens: t[mode]!, mode, look: 'theme' }).stops.join(); };
    const all = new Set(THEMES.flatMap((t) => modes(t).map(([m, k]) => islandPalette({ tokens: k, mode: m, look: 'theme' }).stops.join())));
    expect(all.size).toBeGreaterThan(THEMES.length);
    expect(bg('ocean', 'dark')).not.toBe(bg('sunset', 'dark'));
    expect(bg('playful', 'light')).not.toBe(bg('playful', 'dark'));
  });

  it('Bold is more colourful than Subtle', () => {
    const t = THEMES.find((x) => x.id === 'ocean')!;
    const dist = (look: 'subtle' | 'bold') => { const p = islandPalette({ tokens: t.dark!, mode: 'dark', look: 'theme', lookIntensity: look }); return contrast(p.stops[0], t.dark!['island-bg']); };
    expect(dist('bold')).toBeGreaterThan(dist('subtle'));
  });

  it('what is going on tints the Island; greys and the Dark look do not', () => {
    const t = THEMES[0];
    const plain = islandPalette({ tokens: t.dark!, mode: 'dark', look: 'theme' });
    const tinted = islandPalette({ tokens: t.dark!, mode: 'dark', look: 'theme', live: '#30d158' });
    expect(tinted.stops[0]).not.toBe(plain.stops[0]);
    expect(tinted.live).toBe('#30d158');
    expect(islandPalette({ tokens: t.dark!, mode: 'dark', look: 'theme', live: '#f5f5f7' }).stops).toEqual(plain.stops);
    expect(islandPalette({ tokens: t.dark!, mode: 'dark', look: 'dark', live: '#30d158' }).stops).toEqual(islandPalette({ tokens: t.dark!, mode: 'dark', look: 'dark' }).stops);
    expect(liveTint('#a1a1aa')).toBeUndefined();
    expect(liveTint('#ff375f')).toBe('#ff375f');
    expect(liveTint('nonsense')).toBeUndefined();
  });

  it('the custom accent leads the gradient and the buttons', () => {
    const t = THEMES.find((x) => x.id === 'minimal')!;
    const p = islandPalette({ tokens: t.dark!, mode: 'dark', look: 'theme', lookAccent: '#ff5a1f' });
    // the chosen colour, lightened only as far as it needs to show on the tinted Island
    expect(contrast(p.accent, '#ff5a1f')).toBeLessThan(2);
    expect(islandPalette({ tokens: t.dark!, mode: 'dark', look: 'theme' }).stops).not.toEqual(p.stops);
    // Keeper's own accent is used when the Island has none.
    expect(islandPalette({ tokens: t.dark!, mode: 'dark', look: 'dark', appAccent: '#38bdf8' }).accent).toBe('#38bdf8');
  });

  it('writes every variable island.css reads', () => {
    const p = islandPalette({ tokens: THEMES[0].light!, mode: 'light', look: 'theme' });
    const v = islandVars(p);
    for (const k of ['--isl-s0', '--isl-s1', '--isl-s2', '--isl-fg', '--isl-fg-2', '--isl-fg-3', '--isl-ink', '--isl-accent', '--isl-accent-text', '--isl-glow', '--isl-edge', '--isl-ok', '--isl-warn', '--isl-danger', '--isl-info', '--isl-base', '--isl-sheen']) expect(v[k], k).toBeTruthy();
    expect(surfaceSamples(p).length).toBeGreaterThan(9);
  });
});

describe('settings and helpers', () => {
  it('cleans what is read from disk', () => {
    expect(cleanLook(undefined)).toEqual({ look: 'theme', lookIntensity: 'bold', lookPreset: 'coral', lookAccent: '' });
    expect(cleanLook({ look: 'nope' as never, lookIntensity: 'loud' as never, lookPreset: 'x', lookAccent: 'red' })).toEqual({ look: 'theme', lookIntensity: 'bold', lookPreset: 'coral', lookAccent: '' });
    expect(cleanLook({ look: 'colorful', lookIntensity: 'subtle', lookPreset: 'berry', lookAccent: '#AABBCC' })).toEqual({ look: 'colorful', lookIntensity: 'subtle', lookPreset: 'berry', lookAccent: '#aabbcc' });
  });
  it('makes a colour readable by moving it toward white or black', () => {
    expect(readableTint('#ffd60a', ['#000000'])).toBe('#ffd60a');
    const onWhite = readableTint('#ffd60a', ['#ffffff']);
    expect(contrast(onWhite, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    const onBlack = readableTint('#1a1a1a', ['#000000']);
    expect(contrast(onBlack, '#000000')).toBeGreaterThanOrEqual(4.5);
  });
  it('turns hues', () => {
    expect(turnHue('#ff0000', 120)).toBe('#00ff00');
    expect(turnHue('#808080', 90)).toBe('#808080');
  });
});
