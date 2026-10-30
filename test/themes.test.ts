// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { checkTheme, contrast, parseColor, resolveMode, themeById, themeVariables, THEMES, TOKEN_KEYS } from '../core/themes';

const NOT_COLOURS = new Set(['shadow', 'shadow-pop', 'radius', 'radius-sm', 'app-bg']);
const ONLY_DARK = ['terminal', 'neon'];
const ONLY_LIGHT = ['candy', 'retro'];

describe('colour maths', () => {
  it('measures contrast like WCAG', () => {
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 1);
    expect(contrast('#fff', '#fff')).toBeCloseTo(1, 5);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThan(4.5);
  });
  it('parses hex and rgb()', () => {
    expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColor('nope')).toBeNull();
  });
});

describe('themes', () => {
  it('has at least 12 themes besides Playful and Minimal, with unique ids', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(14);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(THEMES[0].id).toBe('playful');
  });

  for (const t of THEMES) {
    describe(t.name, () => {
      it('declares its modes', () => {
        if (ONLY_DARK.includes(t.id)) expect(t.light).toBeUndefined();
        else if (ONLY_LIGHT.includes(t.id)) expect(t.dark).toBeUndefined();
        else {
          expect(t.light).toBeDefined();
          expect(t.dark).toBeDefined();
        }
      });
      for (const mode of ['light', 'dark'] as const) {
        const tok = t[mode];
        if (!tok) continue;
        it(`${mode}: every token is set and every colour parses`, () => {
          for (const k of TOKEN_KEYS) {
            expect(tok[k], k).toBeTruthy();
            if (!NOT_COLOURS.has(k)) expect(parseColor(tok[k]), `${k} = ${tok[k]}`).not.toBeNull();
          }
        });
        it(`${mode}: meets WCAG AA contrast`, () => {
          const bad = checkTheme(tok).filter((c) => c.ratio < c.min).map((c) => `${c.pair} ${c.ratio.toFixed(2)} < ${c.min}`);
          expect(bad).toEqual([]);
        });
      }
    });
  }

  it('falls back to Playful and resolves single-mode themes', () => {
    expect(themeById('nope').id).toBe('playful');
    expect(resolveMode(themeById('terminal'), 'light', false)).toBe('dark');
    expect(resolveMode(themeById('candy'), 'dark', true)).toBe('light');
    expect(resolveMode(themeById('ocean'), 'system', true)).toBe('dark');
  });

  it('applies a custom accent with readable text on it', () => {
    const v = themeVariables(themeById('ocean'), 'light', { accent: '#ffd400', corners: 'sharp', font: 'mono' });
    expect(v['--accent']).toBe('#ffd400');
    expect(contrast(v['--accent-text'], '#ffd400')).toBeGreaterThan(4.5);
    expect(v['--radius']).toBe('4px');
    expect(v['--font']).toContain('monospace');
  });
});
