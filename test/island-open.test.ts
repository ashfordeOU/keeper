// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// How the Island opens and closes: sweeps along the menu bar, what holds it open, which spring, and the hover delay's new default.
import { describe, expect, it } from 'vitest';
import { CLOSE_GRACE_MS, HOVER_DWELL_MS, addSample, isSweep, mayClose, migrateHoverDelay, motionFor, progressOf } from '../core/island-open';
import { defaultSettings, mergeSettings } from '../core/settings';

describe('open model', () => {
  it('opens after a short rest and closes after a short grace', () => {
    expect(HOVER_DWELL_MS).toBe(140);
    expect(CLOSE_GRACE_MS).toBe(220);
  });

  it('tells a sweep along the menu bar from a visit', () => {
    let s = addSample([], { x: 0, y: 5, t: 0 });
    s = addSample(s, { x: 40, y: 5, t: 20 });
    s = addSample(s, { x: 90, y: 6, t: 40 });
    expect(isSweep(s, 45)).toBe(true);
    // Coming straight up to the notch is a visit, however fast.
    let up = addSample([], { x: 500, y: 300, t: 0 });
    up = addSample(up, { x: 505, y: 150, t: 30 });
    up = addSample(up, { x: 506, y: 10, t: 60 });
    expect(isSweep(up, 60)).toBe(false);
    // Slowly along the bar is a visit too, and an old sweep no longer counts.
    let slow = addSample([], { x: 0, y: 5, t: 0 });
    slow = addSample(slow, { x: 20, y: 5, t: 40 });
    expect(isSweep(slow, 40)).toBe(false);
    expect(isSweep(s, 400)).toBe(false);
  });

  it('keeps only recent pointer samples', () => {
    let s = addSample([], { x: 0, y: 0, t: 0 });
    for (let i = 1; i < 20; i++) s = addSample(s, { x: i, y: 0, t: i * 10 });
    expect(s.length).toBeLessThanOrEqual(8);
    expect(s[s.length - 1].t).toBe(190);
    expect(s[0].t).toBeGreaterThanOrEqual(190 - 120);
  });

  it('never closes while a menu is open, a field has the keyboard, something is dragged or a button is held', () => {
    expect(mayClose({})).toBe(true);
    expect(mayClose({ menuOpen: true })).toBe(false);
    expect(mayClose({ fieldFocused: true })).toBe(false);
    expect(mayClose({ dragging: true })).toBe(false);
    expect(mayClose({ pressed: true })).toBe(false);
  });

  it('chooses the spring for each change', () => {
    expect(motionFor({ view: 'compact' }, { view: 'compact', breath: true })).toBe('breath');
    expect(motionFor({ view: 'compact', breath: true }, { view: 'panel' })).toBe('open');
    expect(motionFor({ view: 'compact' }, { view: 'live' })).toBe('live');
    expect(motionFor({ view: 'panel' }, { view: 'compact' })).toBe('close');
    expect(motionFor({ view: 'live' }, { view: 'compact' })).toBe('close');
    expect(motionFor({ view: 'panel' }, { view: 'panel' })).toBe('view');
    expect(motionFor({ view: 'live' }, { view: 'panel' })).toBe('open');
    expect(motionFor({ view: 'compact' }, { view: 'compact' })).toBe('wing');
  });

  it('measures how far the shape has come along the side that changes most', () => {
    expect(progressOf({ w: 200, h: 32 }, { w: 600, h: 300 }, { w: 200 + 0.6 * 400, h: 100 })).toBeCloseTo(0.6);
    expect(progressOf({ w: 600, h: 300 }, { w: 200, h: 32 }, { w: 600, h: 300 })).toBe(0);
    expect(progressOf({ w: 600, h: 300 }, { w: 600, h: 300 }, { w: 600, h: 300 })).toBe(1);
  });

  it('moves an untouched 250 ms delay to 140 once, and keeps a delay the person chose', () => {
    expect(migrateHoverDelay(250, true)).toBe(140);
    expect(migrateHoverDelay(250, false)).toBe(250);
    expect(migrateHoverDelay(400, true)).toBe(400);
    expect(migrateHoverDelay(undefined, true)).toBe(140);
    expect(migrateHoverDelay(5000, false)).toBe(1000);
    const base = defaultSettings([], []);
    expect(base.island.hoverDelayMs).toBe(140);
    const old = mergeSettings(base, { island: { enabled: true, hoverDelayMs: 250 } });
    expect(old.island.hoverDelayMs).toBe(140);
    expect(old.island.openModel).toBe(1);
    const chose250Later = mergeSettings(base, { island: { enabled: true, hoverDelayMs: 250, openModel: 1 } });
    expect(chose250Later.island.hoverDelayMs).toBe(250);
    expect(mergeSettings(base, { island: { enabled: true, hoverDelayMs: 600 } }).island.hoverDelayMs).toBe(600);
  });
});
