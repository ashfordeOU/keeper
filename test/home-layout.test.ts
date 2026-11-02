// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { attention, defaultHomeSettings, headerLine, lowOnSpace, moveSection, normalizeHome, setSectionShown, visibleSections } from '../core/home-layout';
import { defaultSettings, mergeSettings } from '../core/settings';

const GB = 1024 ** 3;
const fmt = (b: number) => `${Math.round(b / GB)} GB`;

describe('Home layout', () => {
  it('starts calm: attention, library, recent and pinned; weather, storage and calendar are off', () => {
    expect(visibleSections(defaultHomeSettings())).toEqual(['attention', 'library', 'recent', 'pinned']);
    expect(defaultSettings([], []).home.library).toBe('chips');
  });
  it('reorders, shows and hides', () => {
    let h = moveSection(defaultHomeSettings(), 'recent', -1);
    expect(h.order.slice(0, 3)).toEqual(['attention', 'recent', 'library']);
    expect(moveSection(h, 'attention', -1)).toBe(h);
    h = setSectionShown(h, 'weather', true);
    h = setSectionShown(h, 'library', false);
    expect(visibleSections(h)).toEqual(['attention', 'recent', 'pinned', 'weather']);
  });
  it('cleans up stored values and adds new sections at the end', () => {
    const h = normalizeHome({ order: ['recent', 'bogus', 'recent'], hidden: ['x', 'library'], density: 'huge', library: 'tiles', recent: 'video', recentView: 'list' });
    expect(h.order[0]).toBe('recent');
    expect(h.order).toHaveLength(7);
    expect(h.hidden).toEqual(['library']);
    expect(h.density).toBe('comfortable');
    expect(h.library).toBe('tiles');
    expect(h.recent).toBe('video');
    expect(mergeSettings(defaultSettings([], []), { home: 'nonsense' }).home).toEqual(defaultHomeSettings());
  });
});

describe('the Attention card', () => {
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
    expect(a).toMatchObject({ kind: 'finding', title: 'Backups are old', action: { finding: 'f1' }, more: 0 });
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
