// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { asSidebarMode, isRail, pickVisible, recordUse, useScore, SIDEBAR_AUTO_BELOW } from '../core/sidebar-layout';
import { defaultSettings, mergeSettings } from '../core/settings';

const DAY = 86_400_000;

describe('the sidebar rail', () => {
  it('is automatic by window width', () => {
    expect(isRail({ mode: 'auto', windowWidth: SIDEBAR_AUTO_BELOW - 1, pinned: null })).toBe(true);
    expect(isRail({ mode: 'auto', windowWidth: 1440, pinned: null })).toBe(false);
  });
  it('follows Always full and Always compact', () => {
    expect(isRail({ mode: 'full', windowWidth: 500, pinned: false })).toBe(false);
    expect(isRail({ mode: 'compact', windowWidth: 2000, pinned: null })).toBe(true);
  });
  it('the pin wins over the automatic choice', () => {
    expect(isRail({ mode: 'auto', windowWidth: 600, pinned: true })).toBe(false);
    expect(isRail({ mode: 'compact', windowWidth: 2000, pinned: true })).toBe(false);
    expect(isRail({ mode: 'auto', windowWidth: 2000, pinned: false })).toBe(true);
  });
  it('settings fall back to defaults', () => {
    const base = defaultSettings([], []);
    expect(base.sidebarMode).toBe('auto');
    expect(base.sidebarSectionLimit).toBe(5);
    const m = mergeSettings(base, { sidebarMode: 'tiny', sidebarSectionLimit: -4 });
    expect(m.sidebarMode).toBe('auto');
    expect(m.sidebarSectionLimit).toBe(0);
    expect(asSidebarMode('compact')).toBe('compact');
  });
});

describe('compacting long sections', () => {
  const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const now = 100 * DAY;
  it('shows the first ones on a fresh install', () => {
    expect([...pickVisible(keys, {}, 5, null, now)]).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('shows the most used, and the page you are on', () => {
    let u = {};
    for (let i = 0; i < 4; i++) u = recordUse(u, 'h', now - i * 1000);
    u = recordUse(u, 'g', now);
    const v = pickVisible(keys, u, 3, 'f', now);
    expect(v.has('h') && v.has('g') && v.has('a') && v.has('f')).toBe(true);
    expect(v.size).toBe(4);
  });
  it('never hides just one item, and 0 shows everything', () => {
    expect(pickVisible(keys.slice(0, 6), {}, 5, null, now).size).toBe(6);
    expect(pickVisible(keys, {}, 0, null, now).size).toBe(8);
  });
  it('older uses count for less', () => {
    const old = recordUse({}, 'x', now - 60 * DAY);
    const fresh = recordUse({}, 'y', now);
    expect(useScore(fresh.y, now)).toBeGreaterThan(useScore(old.x, now));
  });
  it('keeps the usage list small', () => {
    let u = {};
    for (let i = 0; i < 320; i++) u = recordUse(u, `k${i}`, i);
    expect(Object.keys(u).length).toBe(300);
    expect('k0' in u).toBe(false);
  });
});

describe('sections split from another', () => {
  it('Connect starts hidden where Devices was hidden, once, and sits after it in a custom order', async () => {
    const { splitSidebarSections } = await import('../core/file-types');
    expect(splitSidebarSections({ sidebarHidden: ['section:devices', 'nav:health'], sidebarOrder: ['tidy', 'devices', 'ai'] }, [])).toEqual({ sidebarHidden: ['section:devices', 'nav:health', 'section:connect'], sidebarOrder: ['tidy', 'devices', 'connect', 'ai'], sidebarSplits: ['connect'] });
    // Done already: the person's own choice stays (Connect shown again although Devices is hidden).
    expect(splitSidebarSections({ sidebarHidden: ['section:devices'], sidebarOrder: [] }, ['connect']).sidebarHidden).toEqual(['section:devices']);
    expect(splitSidebarSections({ sidebarHidden: [], sidebarOrder: [] }, []).sidebarHidden).toEqual([]);
  });
  it('old settings get the split once through mergeSettings; new ones start with it done', async () => {
    const { defaultSettings, mergeSettings } = await import('../core/settings');
    const base = defaultSettings([], []);
    expect(base.sidebarSplits).toEqual(['connect']);
    const old = mergeSettings(base, { sidebarHidden: ['section:devices'] });
    expect(old.sidebarHidden).toContain('section:connect');
    const again = mergeSettings(base, { ...old, sidebarHidden: ['section:devices'] });
    expect(again.sidebarHidden).not.toContain('section:connect');
  });
});
