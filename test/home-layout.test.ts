// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { attention, defaultHomeSettings, headerLine, HOME_LAYOUT_VERSION, homeSections, lowOnSpace, migrateHome, migrateHomeV3, migrateHomeV4, moveSection, normalizeHome, setSectionShown, visibleSections } from '../core/home-layout';
import { defaultSettings, mergeSettings } from '../core/settings';

const GB = 1024 ** 3;
const fmt = (b: number) => `${Math.round(b / GB)} GB`;

describe('Home layout', () => {
  it('starts with Today, then your folders, suggestions, Jump back in, Find a file and pinned; type tiles, weather and storage are off', () => {
    expect(visibleSections(defaultHomeSettings())).toEqual(['today', 'folders', 'suggestions', 'jump', 'search', 'pinned']);
    expect(defaultSettings([], []).home.library).toBe('tiles');
  });
  it('reorders, shows and hides', () => {
    let h = moveSection(defaultHomeSettings(), 'folders', 1);
    expect(h.order.slice(0, 3)).toEqual(['today', 'suggestions', 'folders']);
    h = moveSection(h, 'suggestions', 1);
    expect(moveSection(h, 'today', -1)).toBe(h);
    h = setSectionShown(h, 'weather', true);
    h = setSectionShown(h, 'library', true);
    h = setSectionShown(h, 'search', false);
    expect(visibleSections(h)).toEqual(['today', 'folders', 'suggestions', 'jump', 'library', 'pinned', 'weather']);
  });
  it('lets Today’s Fix-it card stand in for the suggestion line, only while Today shows', () => {
    const h = defaultHomeSettings();
    expect(homeSections(h, true)).toEqual(['today', 'folders', 'jump', 'search', 'pinned']);
    expect(homeSections(h, false)).toEqual(['today', 'folders', 'suggestions', 'jump', 'search', 'pinned']);
    expect(homeSections(setSectionShown(h, 'today', false), true)).toEqual(['folders', 'suggestions', 'jump', 'search', 'pinned']);
  });
  it('cleans up stored values and adds new sections at the end', () => {
    const h = normalizeHome({ v: 3, order: ['jump', 'bogus', 'jump'], hidden: ['x', 'library'], density: 'huge', library: 'chips' });
    expect(h.order.slice(0, 2)).toEqual(['today', 'jump']);
    expect(h.order).toHaveLength(9);
    expect(h.hidden).toEqual(['library']);
    expect(h.density).toBe('comfortable');
    expect(h.library).toBe('chips');
    expect(mergeSettings(defaultSettings([], []), { home: 'nonsense' }).home).toEqual(defaultHomeSettings());
  });
});

describe('moving older Home settings on', () => {
  it('the first Home’s defaults become the new defaults', () => {
    const old = { order: ['attention', 'library', 'recent', 'pinned', 'weather', 'usage', 'calendar'], hidden: ['weather', 'usage', 'calendar'], density: 'comfortable', library: 'chips', recent: 'all', recentView: 'grid' };
    const h = normalizeHome(old);
    expect(h.v).toBe(HOME_LAYOUT_VERSION);
    // Calendar today was last; it becomes Today in the same place (a column on a wide window anyway).
    expect(h.order).toEqual(['today', 'folders', 'suggestions', 'library', 'jump', 'search', 'pinned', 'weather', 'usage']);
    expect(visibleSections(h)).toEqual(['today', 'folders', 'suggestions', 'jump', 'search', 'pinned']);
    expect(h.library).toBe('tiles');
    expect('recent' in h).toBe(false);
  });
  it('keeps the person’s order, spacing and hidden sections, and shows Today', () => {
    const h = normalizeHome({ order: ['recent', 'pinned', 'attention', 'library'], hidden: ['attention', 'calendar', 'pinned'], density: 'compact', library: 'tiles' });
    expect(h.order.slice(0, 5)).toEqual(['today', 'folders', 'jump', 'search', 'pinned']);
    expect(h.hidden).toEqual(['suggestions', 'pinned', 'library']);
    expect(h.density).toBe('compact');
  });
  it('runs once: settings already moved on are left as they are', () => {
    const once = normalizeHome({ order: ['recent'], hidden: [] });
    const hidden = setSectionShown(once, 'today', false);
    expect(normalizeHome(JSON.parse(JSON.stringify(hidden))).hidden).toEqual(['library', 'today']);
    expect(migrateHome({ order: ['calendar', 'recent'] }).order).toEqual(['today', 'jump']);
  });
  it('is applied when settings are read', () => {
    const s = mergeSettings(defaultSettings([], []), { home: { order: ['recent', 'attention'], hidden: [] } });
    expect(s.home.order.slice(0, 4)).toEqual(['today', 'folders', 'jump', 'search']);
  });
  it('Home as the front door: your folders first, Find a file after Jump back in, the type tiles step back', () => {
    const v2 = { v: 2, order: ['suggestions', 'jump', 'today', 'library', 'pinned', 'weather', 'usage'], hidden: ['weather'], density: 'compact', library: 'chips' };
    const h = normalizeHome(v2);
    expect(h.v).toBe(4);
    expect(h.order).toEqual(['today', 'folders', 'suggestions', 'jump', 'search', 'library', 'pinned', 'weather', 'usage']);
    expect(h.hidden).toEqual(['weather', 'library']);
    expect(h.density).toBe('compact');
    expect(h.library).toBe('chips');
    // Someone who moved Jump back in last gets Find a file after it; no Jump back in puts it second.
    expect(migrateHomeV3({ v: 2, order: ['today', 'jump'] }).order).toEqual(['folders', 'today', 'jump', 'search']);
    expect(migrateHomeV3({ v: 2, order: ['today'] }).order).toEqual(['folders', 'search', 'today']);
    // Runs once: a layout with Your folders moved down keeps it there.
    const moved = moveSection(h, 'folders', 1);
    expect(normalizeHome(JSON.parse(JSON.stringify(moved))).order.slice(0, 3)).toEqual(['today', 'suggestions', 'folders']);
  });
  it('Today as the top of Hello: Today moves first, the rest keep their order, a hidden Today stays hidden', () => {
    expect(migrateHomeV4({ v: 3, order: ['folders', 'jump', 'today', 'search'] }).order).toEqual(['today', 'folders', 'jump', 'search']);
    const h = normalizeHome({ v: 3, order: ['jump', 'folders', 'today'], hidden: ['today'], density: 'spacious', library: 'tiles' });
    expect(h.v).toBe(4);
    expect(h.order.slice(0, 3)).toEqual(['today', 'jump', 'folders']);
    expect(h.hidden).toEqual(['today']);
    expect(h.density).toBe('spacious');
    // Runs once: Today moved down by the person stays down.
    const down = moveSection(h, 'today', 1);
    expect(normalizeHome(JSON.parse(JSON.stringify(down))).order.slice(0, 2)).toEqual(['jump', 'today']);
  });
});

describe('the suggestion line', () => {
  it('stays hidden when nothing is worth doing', () => {
    expect(attention({ disk: { free: 200 * GB, total: 500 * GB }, findings: [{ id: 'a', title: 'tip', severity: 'info' }] }, fmt)).toBeNull();
  });
  it('says when space is low, first', () => {
    expect(lowOnSpace({ free: 10 * GB, total: 1000 * GB })).toBe(true);
    expect(lowOnSpace({ free: 40 * GB, total: 1000 * GB })).toBe(true);
    expect(lowOnSpace({ free: 400 * GB, total: 1000 * GB })).toBe(false);
    const a = attention({ disk: { free: 5 * GB, total: 256 * GB, label: 'Macintosh HD' }, findings: [{ id: 'f', title: 'FileVault is off', severity: 'high' }] }, fmt)!;
    expect(a.kind).toBe('space');
    expect(a.title).toContain('Macintosh HD');
    expect(a.action.route).toBe('cleanup');
    expect(a.more).toBe(1);
  });
  it('otherwise shows the most important finding', () => {
    const a = attention({ disk: { free: 300 * GB, total: 500 * GB }, findings: [{ id: 'f1', title: 'Backups are old', severity: 'medium', why: 'Last one 40 days ago' }, { id: 'f2', title: 'x', severity: 'low' }] }, fmt)!;
    expect(a).toMatchObject({ kind: 'finding', title: 'Backups are old', action: { finding: 'f1' }, dismiss: { label: 'Not now', how: 'snooze' }, more: 0 });
  });
  it('offers Trust for a security or privacy finding', () => {
    const a = attention({ findings: [{ id: 'security:perm.screen', title: 'Zoom can record the screen', severity: 'medium', area: 'privacy' }] }, fmt)!;
    expect(a.dismiss).toEqual({ label: 'Trust', finding: 'security:perm.screen', how: 'trust' });
    expect(attention({ disk: { free: 1 * GB, total: 256 * GB } }, fmt)!.dismiss).toBeUndefined();
  });
});

describe('the header line', () => {
  it('reads files and free space', () => {
    expect(headerLine({ files: 1, free: 98 * GB }, fmt)).toBe('1 file · 98 GB free');
    expect(headerLine({ indexing: true, files: 5 }, fmt)).toBe('Reading your folders…');
    // Real progress: of about how many there were last time, or how many so far the first time.
    expect(headerLine({ indexing: true, found: 120_000, expected: 270_000 }, fmt)).toBe(`Reading your folders · ${(120_000).toLocaleString()} of ~${(270_000).toLocaleString()}`);
    expect(headerLine({ indexing: true, found: 2000, expected: 0 }, fmt)).toBe(`Reading your folders · ${(2000).toLocaleString()} so far`);
    // Afterwards, why the details wait.
    expect(headerLine({ files: 3, background: { pending: 40, state: 'waiting', reason: 'Paused on battery: continues when plugged in' } }, fmt)).toBe('3 files · Paused on battery');
    expect(headerLine({ files: 3, background: { pending: 40, state: 'waiting', reason: 'Waiting until you’re idle' } }, fmt)).toBe('3 files · Waiting until you’re idle');
    expect(headerLine({ files: 3, background: { pending: 0, state: 'idle' } }, fmt)).toBe('3 files');
  });
});
