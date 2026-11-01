// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { checkTheme, contrast, hemisphereFor, parseColor, resolveMode, seasonalThemeId, seasonFor, themeById, themeCategory, themeVariables, THEMES, TOKEN_KEYS } from '../core/themes';

const NOT_COLOURS = new Set(['shadow', 'shadow-pop', 'radius', 'radius-sm', 'app-bg']);
const ONLY_DARK = ['terminal', 'neon', 'aurora', 'amber'];
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

describe('the collection', () => {
  it('has 38 themes: 28 in the main collection, 5 seasonal and 5 unique showpieces', () => {
    const count = (c: string) => THEMES.filter((t) => themeCategory(t) === c).length;
    expect(THEMES.length).toBe(38);
    expect(count('main')).toBe(28);
    expect(count('seasonal')).toBe(5);
    expect(count('unique')).toBe(5);
  });
  it('has one seasonal theme for each season', () => {
    const seasons = THEMES.filter((t) => t.season).map((t) => t.season).sort();
    expect(seasons).toEqual(['autumn', 'festive', 'spring', 'summer', 'winter']);
    for (const t of THEMES.filter((x) => x.season)) expect(themeCategory(t)).toBe('seasonal');
  });
  it('every theme has a name, a tagline and tags', () => {
    for (const t of THEMES) {
      expect(t.name.length, t.id).toBeGreaterThan(2);
      expect(t.tagline.length, t.id).toBeGreaterThan(10);
      expect(t.tags.length, t.id).toBeGreaterThan(0);
    }
  });
});

describe('following the seasons', () => {
  const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12);
  it('uses meteorological seasons in the north', () => {
    expect(seasonFor(d(2026, 1, 20), 'north')).toBe('winter');
    expect(seasonFor(d(2026, 3, 1), 'north')).toBe('spring');
    expect(seasonFor(d(2026, 7, 15), 'north')).toBe('summer');
    expect(seasonFor(d(2026, 10, 31), 'north')).toBe('autumn');
    expect(seasonFor(d(2026, 12, 1), 'north')).toBe('winter');
  });
  it('flips them south of the equator', () => {
    expect(seasonFor(d(2026, 1, 20), 'south')).toBe('summer');
    expect(seasonFor(d(2026, 4, 10), 'south')).toBe('autumn');
    expect(seasonFor(d(2026, 7, 15), 'south')).toBe('winter');
    expect(seasonFor(d(2026, 10, 31), 'south')).toBe('spring');
  });
  it('has a festive stretch at the end of the year everywhere', () => {
    for (const h of ['north', 'south'] as const) {
      expect(seasonFor(d(2026, 12, 14), h)).not.toBe('festive');
      expect(seasonFor(d(2026, 12, 15), h)).toBe('festive');
      expect(seasonFor(d(2027, 1, 6), h)).toBe('festive');
      expect(seasonFor(d(2027, 1, 7), h)).not.toBe('festive');
    }
  });
  it('maps each season to its theme', () => {
    expect(seasonalThemeId(d(2026, 1, 20), 'north')).toBe('frost');
    expect(seasonalThemeId(d(2026, 4, 20), 'north')).toBe('meadow');
    expect(seasonalThemeId(d(2026, 7, 20), 'north')).toBe('summer');
    expect(seasonalThemeId(d(2026, 10, 20), 'north')).toBe('autumn');
    expect(seasonalThemeId(d(2026, 12, 24), 'south')).toBe('festive');
    expect(seasonalThemeId(d(2026, 7, 20), 'south')).toBe('frost');
  });
  it('finds the hemisphere from latitude first, then the time zone', () => {
    expect(hemisphereFor(-33.9, 'Europe/London')).toBe('south');
    expect(hemisphereFor(51.5, 'Australia/Sydney')).toBe('north');
    expect(hemisphereFor(undefined, 'Australia/Sydney')).toBe('south');
    expect(hemisphereFor(null, 'America/Sao_Paulo')).toBe('south');
    expect(hemisphereFor(undefined, 'Pacific/Auckland')).toBe('south');
    expect(hemisphereFor(undefined, 'Africa/Johannesburg')).toBe('south');
    expect(hemisphereFor(undefined, 'Europe/Tallinn')).toBe('north');
    expect(hemisphereFor(undefined, 'Asia/Kolkata')).toBe('north');
    expect(hemisphereFor(undefined, undefined)).toBe('north');
  });
});

describe('danger buttons', () => {
  it('white text on light-mode danger and dark text on dark-mode danger both read (src/styles/themes.css)', () => {
    for (const t of THEMES) {
      if (t.light) expect(contrast('#ffffff', t.light.danger), `${t.id} light`).toBeGreaterThanOrEqual(4.5);
      if (t.dark) expect(contrast('#1a0507', t.dark.danger), `${t.id} dark`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

