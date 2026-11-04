// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  changedIcons, defaultMenuBarItems, dividerBitmap, dividerTitle, dragPlan, menuBarAvailability, normalizeMenuBarItems, parseStatusWindows, spacerTitle, splitByDivider, STATUS_LAYER, type StatusWindowRow,
} from '../core/menubar-items';

const row = (owner: string, pid: number, x: number, extra: Partial<StatusWindowRow> = {}): StatusWindowRow => ({ owner, pid, number: pid * 10, layer: STATUS_LAYER, x, y: 0, width: 30, height: 24, ...extra });

describe('menu bar icons: what is in the menu bar', () => {
  it('keeps status windows only, left to right, without Keeper’s own, and knows the system’s icons', () => {
    const icons = parseStatusWindows([
      row('Music', 11, 1200),
      row('Cloud Drive', 12, 900),
      row('Keeper', 99, 1000),
      row('Some window', 13, 0, { layer: 0, width: 800, height: 600 }),
      row('Control Center', 14, 1300),
      row('Huge', 15, 10, { width: 2000 }),
    ], [99]);
    expect(icons.map((i) => i.app)).toEqual(['Cloud Drive', 'Music', 'Control Center']);
    expect(icons[0]).toEqual({ id: '12:120', app: 'Cloud Drive', pid: 12, x: 900, width: 30, system: false });
    expect(icons[2].system).toBe(true);
  });
  it('icons left of the divider are hidden, those right of it in view; with no divider nothing is hidden', () => {
    const icons = parseStatusWindows([row('A', 1, -2400), row('B', 2, 980), row('C', 3, 1100)]);
    const s = splitByDivider(icons, 1050);
    expect(s.hidden.map((i) => i.app)).toEqual(['A', 'B']);
    expect(s.shown.map((i) => i.app)).toEqual(['C']);
    expect(splitByDivider(icons, undefined).hidden).toEqual([]);
  });
  it('notices an icon that changed width, not ones that came or went', () => {
    const a = parseStatusWindows([row('A', 1, 10), row('B', 2, 50)]);
    const b = parseStatusWindows([row('A', 1, 10, { width: 60 }), row('B', 2, 80, { width: 31 }), row('C', 3, 120)]);
    expect(changedIcons(a, b)).toEqual(['1:10']);
  });
});

describe('menu bar icons: the divider', () => {
  it('grows wider than the screen while hiding, and is empty (just its picture) while showing', () => {
    expect(spacerTitle(1440).length).toBeGreaterThanOrEqual(1440 / 12);
    expect(spacerTitle(6016).length).toBeLessThanOrEqual(800);
    expect(spacerTitle(0).length).toBe(20);
    expect(dividerTitle(false, false, 1440)).toBe('');
    expect(dividerTitle(false, true, 1440)).toBe('•');
    expect(dividerTitle(true, true, 1440).startsWith('• ')).toBe(true);
  });
  it('a ⌘-drag goes from the icon’s middle to just past the divider', () => {
    const icon = { id: '1:1', app: 'A', pid: 1, x: 1100, width: 30, system: false };
    expect(dragPlan(icon, { x: 1000, width: 16 }, 'hide')).toEqual({ from: { x: 1115, y: 12 }, to: { x: 994, y: 12 } });
    expect(dragPlan({ ...icon, x: 900 }, { x: 1000, width: 16 }, 'show', 11)).toEqual({ from: { x: 915, y: 11 }, to: { x: 1022, y: 11 } });
  });
  it('its picture is a template: black with alpha, at twice the size', () => {
    const b = dividerBitmap(2);
    expect(b.width).toBe(16);
    expect(b.height).toBe(32);
    expect(b.data.length).toBe(16 * 32 * 4);
    let opaque = 0;
    for (let i = 0; i < b.data.length; i += 4) { if (b.data[i + 3]) { opaque++; expect(b.data[i] + b.data[i + 1] + b.data[i + 2]).toBe(0); } }
    expect(opaque).toBeGreaterThan(40);
  });
});

describe('menu bar icons: settings and what each system allows', () => {
  it('defaults and repairs', () => {
    expect(defaultMenuBarItems()).toEqual({ hiding: true, autoHideSeconds: 15, showOnChange: false });
    expect(normalizeMenuBarItems({ hiding: false, autoHideSeconds: 7, showOnChange: true })).toEqual({ hiding: false, autoHideSeconds: 15, showOnChange: true });
    expect(normalizeMenuBarItems({ autoHideSeconds: 0 }).autoHideSeconds).toBe(0);
  });
  it('a Mac does it; macOS 26 is told about its own Menu Bar settings; Windows and Linux say how instead', () => {
    expect(menuBarAvailability({ platform: 'darwin', macMajor: 15, accessibility: true })).toMatchObject({ state: 'ready', hint: undefined });
    expect(menuBarAvailability({ platform: 'darwin', macMajor: 26, accessibility: true }).hint).toMatch(/System Settings → Menu Bar/);
    expect(menuBarAvailability({ platform: 'darwin', macMajor: 14, accessibility: false }).state).toBe('permission');
    expect(menuBarAvailability({ platform: 'win32' })).toMatchObject({ state: 'windows', hint: expect.stringMatching(/Taskbar/) });
    expect(menuBarAvailability({ platform: 'linux' }).state).toBe('unsupported');
  });
});
