// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The settings registry: search with synonyms, reset, the Changed view, export
// without secrets, the import preview, deep links and plain words.

import { describe, expect, it } from 'vitest';
import { defaultSettings, type AllSettings } from '../core/settings';
import {
  changedSettings, copyProblems, defaultValue, exportSettings, getPath, groupHits, isChanged, jargonIn, parseSettingsArg, patchFor, previewImport, resetPatch,
  searchSettings, sectionRows, SECTIONS, SETTINGS, settingDef,
} from '../core/settings-schema';

const base = (): AllSettings => defaultSettings(['/home/me/Documents'], []);

describe('the registry', () => {
  it('has unique ids, real sections, and paths that exist in the settings with their defaults', () => {
    const ids = SETTINGS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sections = new Set(SECTIONS.map((s) => s.id));
    expect(SETTINGS.filter((d) => !sections.has(d.section)).map((d) => d.id)).toEqual([]);
    const d = defaultSettings([], []);
    const missing = SETTINGS.filter((x) => x.path && !['restorePlace', 'tabs', 'themeSeasons'].includes(x.path) && getPath(d, x.path) === undefined).map((x) => x.id);
    expect(missing).toEqual([]);
    expect(defaultValue(settingDef('appearance')!)).toBe(d.appearance);
    expect(defaultValue(settingDef('island.hoverOpen')!)).toBe(d.island.hoverOpen);
  });
  it('has 13 sections, General first, each with Basic rows before its Advanced ones', () => {
    expect(SECTIONS).toHaveLength(13);
    expect(SECTIONS[0].id).toBe('general');
    for (const s of SECTIONS) expect(sectionRows(s.id, 'linux').basic.length, s.id).toBeGreaterThan(0);
    expect(sectionRows('files', 'linux').advanced.map((d) => d.id)).toContain('includeRemote');
    expect(sectionRows('island', 'darwin').advanced.map((d) => d.id)).not.toContain('island.x11OnWayland');
  });
  it('panels draw the rows inside them', () => {
    for (const d of SETTINGS.filter((x) => x.inPanel)) expect(settingDef(d.inPanel!)?.kind, d.id).toBe('panel');
  });
});

describe('search', () => {
  const ids = (q: string, s: AllSettings | null = base(), platform = 'linux') => searchSettings(q, s, platform).map((h) => h.id);
  it('finds a setting by what people call it', () => {
    expect(ids('dark mode')[0]).toBe('appearance');
    expect(ids('telemetry')).toContain('usageStats');
    expect(ids('hotkey')).toContain('quickSearchShortcut');
    expect(ids('startup')).toContain('login');
    expect(ids('notch')).toContain('island.enabled');
    expect(ids('ocr')).toContain('ocrEnabled');
    expect(ids('inspector')).toContain('inspectorMode');
  });
  it('finds Advanced rows too, marked as such, with their breadcrumbs', () => {
    const h = searchSettings('xwayland', base(), 'linux').find((x) => x.id === 'island.x11OnWayland')!;
    expect(h.advanced).toBe(true);
    expect(h.crumbs).toEqual(['The Island', 'Compatibility mode (XWayland)']);
    const sc = searchSettings('open the shelf', base(), 'linux').find((x) => x.id === 'island.shelfShortcut')!;
    expect(sc.crumbs).toEqual(['The Island', 'Shortcuts', 'Open the shelf']);
  });
  it('says when the part a result needs is off', () => {
    const s = { ...base(), features: { mail: false, calendars: false } };
    const h = searchSettings('signature', s, 'linux').find((x) => x.id === 'pim')!;
    expect(h.off).toEqual({ feature: 'mail', name: 'Mail' });
  });
  it('finds parts and permissions', () => {
    const hits = searchSettings('firewall', base(), 'linux');
    expect(hits.some((h) => h.kind === 'feature' && h.id === 'firewall')).toBe(true);
    expect(searchSettings('screen recording', base(), 'darwin', [{ id: 'screen', name: 'Screen Recording' }]).some((h) => h.section === 'privacy')).toBe(true);
  });
  it('shows at most three per section, with how many more', () => {
    const g = groupHits(searchSettings('island', base(), 'linux'), 3);
    const isl = g.find((x) => x.section === 'island')!;
    expect(isl.hits).toHaveLength(3);
    expect(isl.more).toBeGreaterThan(0);
  });
  it('has nothing for nonsense', () => {
    expect(searchSettings('qqzzxx', base(), 'linux')).toEqual([]);
  });
});

describe('reset and Changed', () => {
  it('lists what differs from how Keeper came, and resets it', () => {
    let s = base();
    expect(changedSettings(s, 'linux')).toEqual([]);
    s = { ...s, ...patchFor(s, 'appearance', 'dark'), ...patchFor(s, 'oldDownloadDays', 30) };
    s = { ...s, ...patchFor(s, 'island.hoverOpen', false) };
    expect(changedSettings(s, 'linux').map((d) => d.id).sort()).toEqual(['appearance', 'island.hoverOpen', 'oldDownloadDays']);
    const p = resetPatch(s, changedSettings(s, 'linux'));
    const after = { ...s, ...p };
    expect(after.appearance).toBe('system');
    expect(after.island.hoverOpen).toBe(true);
    expect(after.island.edge).toBe(s.island.edge);
    expect(changedSettings(after, 'linux')).toEqual([]);
  });
  it('never touches folders, accounts or keys', () => {
    const s = { ...base(), folders: ['/x'], excluded: ['/y'] };
    expect(isChanged(s, settingDef('folders')!)).toBe(false);
    expect(resetPatch(s, SETTINGS)).not.toHaveProperty('folders');
    expect(resetPatch(s, SETTINGS)).not.toHaveProperty('excluded');
  });
});

describe('export and import', () => {
  const withSecrets = (): AllSettings => {
    const s = base();
    return {
      ...s,
      appearance: 'dark',
      lastRunVersion: '0.9.0',
      island: { ...s.island, calendarUrl: 'https://cal.example.com/private-abc.ics', upload: { ...s.island.upload, accessKeyId: 'AKIA123' } },
      brain: { ...s.brain, ...({ apiKey: 'sk-secret' } as object) },
      sync: { ...s.sync, ...({ token: 'tok' } as object) },
    } as AllSettings;
  };
  it('never includes keys, passwords, tokens, private links or (unless asked) folders', () => {
    const f = exportSettings(withSecrets(), { settings: true, parts: true, folders: false }, '1.0.0', new Date('2026-11-02T10:00:00Z'));
    const text = JSON.stringify(f);
    for (const secret of ['sk-secret', 'AKIA123', 'private-abc', '"tok"', '0.9.0', '/home/me/Documents']) expect(text).not.toContain(secret);
    expect(f.keeper).toBe('1.0.0');
    expect(f.exported).toBe('2026-11-02T10:00:00.000Z');
    expect(f.settings?.appearance).toBe('dark');
    expect(f.features).toEqual({});
    const withFolders = exportSettings(withSecrets(), { settings: true, parts: false, folders: true }, '1.0.0');
    expect(JSON.stringify(withFolders)).toContain('/home/me/Documents');
    expect(JSON.stringify(withFolders)).not.toContain('sk-secret');
  });
  it('previews what an import changes, skips what it does not know, and keeps secrets out', () => {
    const cur = base();
    const file = { keeper: '1.0.1', format: 1, exported: '', settings: { appearance: 'dark', oldDownloadDays: 45, island: { hoverOpen: false, calendarUrl: 'https://evil' }, futureThing: 1, density: 'gigantic' }, features: { link: true, keeperMesh: true } };
    const p = previewImport(cur, JSON.stringify(file), 'linux');
    expect(p.changes.map((c) => c.id).sort()).toEqual(['appearance', 'island.hoverOpen', 'oldDownloadDays']);
    expect(p.changes.find((c) => c.id === 'appearance')).toMatchObject({ from: 'Automatic', to: 'Dark' });
    expect(p.skipped).toBe(1);
    expect(p.partsOn).toContain('Private network for your devices');
    // A bad value falls back to what is there now.
    expect(p.patch.density).toBeUndefined();
    expect((p.patch.island as AllSettings['island']).calendarUrl).toBe(cur.island.calendarUrl);
  });
  it('a round trip changes nothing', () => {
    const s = { ...base(), appearance: 'dark' as const };
    const f = exportSettings(s, { settings: true, parts: true, folders: true }, '1.0.0');
    const p = previewImport(s, JSON.stringify(f), 'linux');
    expect(p.changes).toEqual([]);
    expect(Object.keys(p.patch)).toEqual([]);
  });
  it('refuses a file that is not Keeper settings', () => {
    expect(() => previewImport(base(), 'not json', 'linux')).toThrow(/isn’t Keeper settings/);
    expect(() => previewImport(base(), '{"hello":1}', 'linux')).toThrow(/isn’t Keeper settings/);
  });
});

describe('deep links', () => {
  it('open a section, a row, or an old anchor', () => {
    expect(parseSettingsArg(undefined)).toEqual({ section: 'general' });
    expect(parseSettingsArg('appearance')).toEqual({ section: 'appearance' });
    expect(parseSettingsArg('island#island.windowType')).toEqual({ section: 'island', setting: 'island.windowType' });
    expect(parseSettingsArg('permissions')).toEqual({ section: 'privacy', setting: 'permissions' });
    expect(parseSettingsArg('locked')).toEqual({ section: 'files', setting: 'lockedFolders' });
    expect(parseSettingsArg('features')).toEqual({ section: 'features' });
    expect(parseSettingsArg('accessibility')).toEqual({ section: 'accessibility' });
    expect(parseSettingsArg('ashforde')).toEqual({ section: 'features', setting: 'ashfordeApps' });
    expect(parseSettingsArg('pim')).toEqual({ section: 'pim' });
    expect(parseSettingsArg('privacy')).toEqual({ section: 'privacy' });
    expect(parseSettingsArg('changed')).toEqual({ section: 'changed' });
    expect(parseSettingsArg('showHidden')).toEqual({ section: 'files', setting: 'showHidden' });
    expect(parseSettingsArg('nonsense')).toEqual({ section: 'general' });
  });
});

describe('plain words', () => {
  it('no Basic label or help uses a banned word', () => {
    expect(copyProblems()).toEqual([]);
  });
  it('catches the banned words', () => {
    expect(jargonIn('Rebuild the index')).toEqual(['index']);
    expect(jargonIn('Use CommandOrControl+Shift+K')).toEqual(['CommandOrControl']);
    expect(jargonIn('Downloads a speech model once')).toEqual([]);
    expect(jargonIn('Which model to use')).toEqual(['model']);
  });
});
