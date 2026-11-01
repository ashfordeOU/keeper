// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { alertIcon, alertPresentation, alertWorthShowing, mayExpand, shortTitle, type ExpandTrigger } from '../core/island-expand';
import { place, type DisplayInfo } from '../core/island-place';

describe('when the Island may drop down over windows', () => {
  const notch = { notch: true };
  it('only the person’s own actions expand it; everything automatic stays inside the bar', () => {
    for (const t of ['hover', 'click', 'shortcut', 'gesture', 'drag', 'tray'] as ExpandTrigger[]) expect(mayExpand(t, notch), t).toBe(true);
    for (const t of ['alert', 'voice', 'agent', 'activity'] as ExpandTrigger[]) {
      expect(mayExpand(t, notch), t).toBe(false);
      expect(mayExpand(t, { notch: false }), `${t} without a notch`).toBe(false);
    }
    // Banners only when chosen, and only for alerts.
    expect(mayExpand('alert', { notch: true, alertStyle: 'banner' })).toBe(true);
    expect(mayExpand('voice', { notch: true, alertStyle: 'banner' })).toBe(false);
  });
  it('time-sensitive alerts show; guide findings and general information wait on To do', () => {
    for (const k of ['download', 'screenshot', 'focus', 'agent', 'battery', 'call', 'cue', 'notification'] as const) expect(alertWorthShowing({ kind: k }), k).toBe(true);
    expect(alertWorthShowing({ kind: 'info' })).toBe(false);
    expect(alertWorthShowing({ kind: 'disk' })).toBe(false);
    expect(alertWorthShowing({ kind: 'info' }, { showInfo: true })).toBe(true);
    expect(alertPresentation({ kind: 'info' }, notch)).toBe('hidden');
    expect(alertPresentation({ kind: 'download' }, notch)).toBe('inline');
    expect(alertPresentation({ kind: 'download' }, { notch: false })).toBe('inline');
    expect(alertPresentation({ kind: 'download' }, { notch: true, alertStyle: 'banner' })).toBe('banner');
  });
  it('fits a short title in a wing', () => {
    expect(shortTitle('Download finished')).toBe('Download finished');
    expect(shortTitle('Nothing is backed up and your disk is nearly full', 22)).toBe('Nothing is backed up…');
    expect(shortTitle('Supercalifragilisticexpialidocious', 10).length).toBe(10);
    expect(alertIcon('download')).toBe('down');
  });
});

describe('the open Island on a notched Mac (220 × 38 pt notch, 39 pt menu bar)', () => {
  // An M4 Max 16-inch: the helper reports the exact notch rectangle.
  const d: DisplayInfo = { id: 1, internal: true, primary: true, scaleFactor: 2, rotation: 0, bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 39, width: 1728, height: 1078 } } as DisplayInfo;
  const p = place(d, { platform: 'darwin', macModel: 'Mac16,6', notchRects: { 1: { x: 754, y: 0, width: 220, height: 38 } } });
  it('drops down centred on the notch, from the top of the screen, and the closed pill is centred too', () => {
    expect(p.anchor).toBe('notch');
    const notchCentre = 754 + 110;
    expect(p.expanded.x + p.expanded.width / 2).toBe(notchCentre);
    expect(p.collapsed.x + p.collapsed.width / 2).toBe(notchCentre);
    expect(p.expanded.y).toBe(0);
    // Closed (and while alerts, voice or activities show), the pill stays inside the menu bar's height;
    // the window then shrinks to the pill (Island.tsx asks for exactly the pill's size).
    expect(p.pill.height).toBeLessThanOrEqual(39);
  });
});
