// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { arrowHead, boxFrom, defaultDrawSettings, drawHtml, inkAlpha, normalizeDrawSettings, thinPoints, DRAW_SHORTCUT } from '../core/stage/draw';
import { normalizeStageSettings } from '../core/stage/presets';

describe('draw on screen', () => {
  it('has sensible settings and reads bad ones leniently', () => {
    const d = defaultDrawSettings();
    expect(d.shortcut).toBe(DRAW_SHORTCUT);
    expect(d.colors).toHaveLength(6);
    const n = normalizeDrawSettings({ colors: ['#000000'], color: 'red', tool: 'laser', width: 99, fade: 'yes', fadeSeconds: 400 });
    expect(n.colors).toEqual(d.colors);
    expect(n.color).toBe(d.colors[0]);
    expect(n.tool).toBe('pen');
    expect(n.width).toBe(6);
    expect(n.fade).toBe(false);
    expect(n.fadeSeconds).toBe(30);
    expect(normalizeDrawSettings({ tool: 'spotlight', fade: true, fadeSeconds: 2 })).toMatchObject({ tool: 'spotlight', fade: true, fadeSeconds: 2 });
  });
  it('is part of Stage settings', () => {
    expect(normalizeStageSettings(undefined).draw).toEqual(defaultDrawSettings());
    expect(normalizeStageSettings({ draw: { fade: true } }).draw.fade).toBe(true);
  });
  it('fades ink after it has stayed a while', () => {
    expect(inkAlpha(1000, 1500, 3000)).toBe(1);
    expect(inkAlpha(1000, 4350, 3000, 700)).toBeCloseTo(0.5, 5);
    expect(inkAlpha(1000, 10_000, 3000)).toBe(0);
    expect(inkAlpha(0, 10_000, 3000)).toBe(1);
  });
  it('draws arrow heads, boxes and thinner lines', () => {
    const [a, b] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(a.x).toBeLessThan(100);
    expect(a.y).toBeCloseTo(-b.y, 6);
    expect(boxFrom({ x: 10, y: 50 }, { x: 0, y: 20 })).toEqual({ x: 0, y: 20, w: 10, h: 30 });
    expect(thinPoints([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 3, y: 0 }, { x: 3.2, y: 0 }])).toEqual([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3.2, y: 0 }]);
  });
  it('the sheet is self-contained', () => {
    const html = drawHtml();
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('role="toolbar"');
    expect(html).not.toMatch(/https?:\/\//);
    for (const k of ['undo', 'clear', 'state', 'config']) expect(html).toContain(`${k}:`);
  });
});
