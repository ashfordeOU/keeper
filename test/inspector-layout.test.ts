// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { asInspectorMode, clampInspectorWidth, inspectorRange, inspectorVisible, maxInspectorWidth, nextForced, INSPECTOR_DEFAULT_WIDTH, INSPECTOR_MIN_WIDTH } from '../core/inspector';
import { clampSize, dragSize, splitterKey } from '../core/splitter';
import { sanitizeWindow, emptyWindow } from '../core/session';
import { defaultSettings, mergeSettings } from '../core/settings';

describe('when the Inspector shows', () => {
  const v = (mode: 'selection' | 'always' | 'never', hasSelection: boolean, forced: boolean | null = null, filePage = true) => inspectorVisible({ mode, hasSelection, filePage, forced });
  it('shows only with a selection by default', () => {
    expect(v('selection', false)).toBe(false);
    expect(v('selection', true)).toBe(true);
  });
  it('follows always and never', () => {
    expect(v('always', false)).toBe(true);
    expect(v('never', true)).toBe(false);
  });
  it('never shows off file pages', () => expect(v('always', true, true, false)).toBe(false));
  it('the toggle wins until the selection starts or ends', () => {
    expect(v('selection', true, false)).toBe(false);
    expect(v('selection', false, true)).toBe(true);
    expect(nextForced(false, 'selection', true, true)).toBe(false);
    expect(nextForced(false, 'selection', true, false)).toBe(null);
    expect(nextForced(true, 'selection', false, true)).toBe(null);
    expect(nextForced(false, 'always', true, false)).toBe(false);
  });
  it('reads unknown modes as the default', () => {
    expect(asInspectorMode('x')).toBe('selection');
    expect(asInspectorMode('never')).toBe('never');
  });
});

describe('Inspector width', () => {
  it('stays between the min and max, and leaves the page room', () => {
    expect(clampInspectorWidth(50)).toBe(INSPECTOR_MIN_WIDTH);
    expect(clampInspectorWidth(5000)).toBe(640);
    expect(clampInspectorWidth('wide')).toBe(INSPECTOR_DEFAULT_WIDTH);
    expect(maxInspectorWidth(1000)).toBe(1000 - 228 - 420);
    expect(maxInspectorWidth(500)).toBe(INSPECTOR_MIN_WIDTH);
  });
  it('is kept per window in the saved session, and bad values are dropped', () => {
    const w = { ...emptyWindow('main'), inspectorWidth: 377.4 };
    expect(sanitizeWindow(w).inspectorWidth).toBe(377);
    expect(sanitizeWindow({ ...w, inspectorWidth: 'x' }).inspectorWidth).toBeUndefined();
    expect(sanitizeWindow({ ...w, inspectorWidth: 99999 }).inspectorWidth).toBeUndefined();
  });
  it('the setting falls back to "when selected"', () => {
    const base = defaultSettings([], []);
    expect(base.inspectorMode).toBe('selection');
    expect(mergeSettings(base, { inspectorMode: 'sometimes' }).inspectorMode).toBe('selection');
    expect(mergeSettings(base, { inspectorMode: 'always' }).inspectorMode).toBe('always');
  });
});

describe('the splitter', () => {
  const r = inspectorRange();
  it('drags toward the panel side to grow', () => {
    expect(dragSize(300, 1000, 950, 'left')).toBe(350);
    expect(dragSize(220, 220, 260, 'right')).toBe(260);
  });
  it('moves with the arrow keys, Home, End and Enter', () => {
    expect(splitterKey(300, 'ArrowLeft', false, r)).toBe(316);
    expect(splitterKey(300, 'ArrowRight', true, r)).toBe(INSPECTOR_MIN_WIDTH);
    expect(splitterKey(300, 'Home', false, r)).toBe(r.min);
    expect(splitterKey(300, 'End', false, r)).toBe(r.max);
    expect(splitterKey(500, 'Enter', false, r)).toBe(r.def);
    expect(splitterKey(300, 'a', false, r)).toBeNull();
    const side = { min: 180, max: 360, def: 228, grow: 'right' as const };
    expect(splitterKey(228, 'ArrowRight', false, side)).toBe(244);
  });
  it('clamps', () => expect(clampSize(NaN, { min: 10, max: 20 })).toBe(10));
});
