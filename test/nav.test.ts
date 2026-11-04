// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One map of pages (core/nav.ts): old routes still land somewhere, every part
// has a section, the sidebar's sections are the Features groups, and a page has
// one name in the sidebar, the palette and its own title.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURES, NAV_GROUPS } from '../core/features';
import { HUB_TABS, hubOf, listedPages, NAV_PAGES, navPage, navSections, pageOf, resolveRoute, titleOf } from '../core/nav';

const root = path.resolve(__dirname, '..');

describe('route aliases', () => {
  it('send the old places to the new ones', () => {
    expect(resolveRoute({ name: 'settings', arg: 'processes' })).toEqual({ name: 'health', arg: 'keeper' });
    expect(resolveRoute({ name: 'settings', arg: 'monitor' })).toEqual({ name: 'health', arg: 'settings' });
    expect(resolveRoute({ name: 'browsers' })).toEqual({ name: 'health', arg: 'apps' });
    expect(resolveRoute({ name: 'protection', arg: 'watch' })).toEqual({ name: 'security', arg: 'watch' });
  });
  it('leave everything else alone (the merged pages keep their routes as tabs)', () => {
    for (const name of ['controls', 'catalog', 'appcontrols', 'firewall', 'netactivity', 'vpn', 'protection', 'startup', 'apps', 'mesh', 'todo', 'history']) {
      const r = { name };
      expect(resolveRoute(r)).toBe(r);
    }
    const s = { name: 'settings', arg: 'appearance' };
    expect(resolveRoute(s)).toBe(s);
  });
  it('find the merged page and the tab of each old route', () => {
    expect(hubOf({ name: 'catalog' })).toMatchObject({ hub: 'controls', tab: { label: 'Hidden system settings' } });
    expect(hubOf({ name: 'appcontrols' })?.hub).toBe('controls');
    expect(hubOf({ name: 'firewall', arg: 'connections' })?.hub).toBe('security');
    expect(hubOf({ name: 'vpn' })?.hub).toBe('security');
    expect(hubOf({ name: 'apps' })?.hub).toBe('startup');
    expect(hubOf({ name: 'devices', arg: 'phone' })?.tab.label).toBe('Phone');
    expect(hubOf({ name: 'mesh' })?.hub).toBe('devices');
    expect(hubOf({ name: 'health' })).toBeUndefined();
  });
  it('give each old route its page title', () => {
    expect(titleOf({ name: 'catalog' })).toBe('System Controls');
    expect(titleOf({ name: 'protection' })).toBe('Privacy & Security');
    expect(titleOf({ name: 'netactivity' })).toBe('Privacy & Security');
    expect(titleOf({ name: 'apps' })).toBe('Startup & Apps');
    expect(titleOf({ name: 'todo' })).toBe('Fix-it List');
    // The Library's old pages are Everywhere + a type chip (core/file-types.ts).
    expect(titleOf(resolveRoute({ name: 'downloads' }))).toBe('From the Web');
    expect(titleOf(resolveRoute({ name: 'screenshots' }))).toBe('Everywhere');
    expect(pageOf({ name: 'sync', arg: 'backups' })?.label).toBe('Backups');
  });
  it('cover every route the window knows', () => {
    const state = fs.readFileSync(path.join(root, 'src/state.tsx'), 'utf8');
    const names = [...state.match(/export type RouteName =([\s\S]*?);/)![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    // Pages reached from a file or a place rather than from the sidebar or palette.
    const elsewhere = new Set(['library', 'screenshots', 'downloads', 'search', 'source', 'tag', 'saved', 'annotate', 'network', 'trash']);
    const missing = names.filter((n) => !elsewhere.has(n) && !pageOf({ name: n }) && !hubOf({ name: n }));
    expect(missing).toEqual([]);
  });
});

describe('one taxonomy', () => {
  it('every part has a section, and every section is a Features group', () => {
    const groups = new Set(NAV_GROUPS.map((g) => g.id));
    expect(FEATURES.filter((f) => !f.navGroup || !groups.has(f.navGroup)).map((f) => f.id)).toEqual([]);
  });
  it('agrees with the setup groups (core/feature-tiers.ts) wherever both name one', () => {
    const SAME: Record<string, string> = { privacy: 'security', mail: 'pim' };
    const differ = FEATURES.filter((f) => f.setup && (SAME[f.setup] ?? f.setup) !== f.navGroup).map((f) => `${f.id}: setup ${f.setup}, sidebar ${f.navGroup}`);
    expect(differ).toEqual([]);
  });
  it('the sidebar sections follow the Features groups, in their order', () => {
    const order = NAV_GROUPS.map((g) => g.id);
    const ids = navSections().map((s) => s.id);
    expect(ids).toEqual(order.filter((g) => ids.includes(g)));
    // Files has no rows of its own: its places come from Places (folders, then Locations), its types are chips.
    expect(ids).toEqual(['notes', 'tidy', 'sync', 'computer', 'security', 'devices', 'ai', 'screen', 'desktop']);
  });
  it('a page’s section holds the part that owns it', () => {
    const wrong: string[] = [];
    for (const p of NAV_PAGES) {
      if (p.group === 'top' || p.group === 'none') continue;
      const owner = FEATURES.find((f) => f.routes?.includes(p.route.name)) ?? FEATURES.find((f) => f.id === p.feature);
      const within = NAV_GROUPS.find((g) => g.id === owner?.navGroup)?.within;
      if (owner && owner.navGroup !== p.group && within !== p.group) wrong.push(`${p.label}: page in ${p.group}, part ${owner.id} in ${owner.navGroup}`);
    }
    expect(wrong).toEqual([]);
  });
  it('Weather and Places & Tracks are out of the top block, which holds Home and Recents only', () => {
    expect(NAV_PAGES.filter((p) => p.group === 'top').map((p) => p.label)).toEqual(['Hello', 'Recents']);
    expect(pageOf({ name: 'weather' })?.group).toBe('desktop');
    expect(pageOf({ name: 'tracks' })?.group).toBe('desktop');
  });
});

describe('names', () => {
  const MINOR = new Set(['&', 'and', 'by', 'from', 'of', 'to', 'in', 'on', 'for', 'a', 'the']);
  it('are unique and in title case', () => {
    const labels = NAV_PAGES.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
    const bad = labels.filter((l) => l.split(/\s+/).some((w, i) => /^[a-z]/.test(w) && (i === 0 || !MINOR.has(w))));
    expect(bad).toEqual([]);
  });
  it('tabs are in sentence case', () => {
    const bad = Object.values(HUB_TABS).flat().map((t) => t.label).filter((l) => l.split(/\s+/).slice(1).some((w) => /^[A-Z][a-z]/.test(w)));
    expect(bad).toEqual([]);
  });
  it('a page’s title is its name in the sidebar and the palette', () => {
    // Screen file → its page (merged pages show their own title, so their tabs are not listed).
    const SCREENS: Record<string, string> = {
      'NotesHub.tsx': 'noteshub', 'Cleanup.tsx': 'cleanup', 'Duplicates.tsx': 'duplicates', 'Space.tsx': 'space', 'Large.tsx': 'large',
      'Convert.tsx': 'convert', 'Rules.tsx': 'rules', 'History.tsx': 'history', 'Health.tsx': 'health', 'KeepAwake.tsx': 'awake', 'Devices.tsx': 'devices',
      'RemoteDesktop.tsx': 'rdc', 'Assistant.tsx': 'assistant', 'Agents.tsx': 'agents', 'usage/UsagePage.tsx': 'aiusage', 'Dictation.tsx': 'dictation', 'Meetings.tsx': 'meetings',
      'Tools.tsx': 'tools', 'Widgets.tsx': 'widgets', 'Ambience.tsx': 'ambience', 'Tracks.tsx': 'tracks',
      'Cues.tsx': 'cues', 'RemoteOverview.tsx': 'remote', 'Security.tsx': 'security',
    };
    const wrong: string[] = [];
    for (const [file, id] of Object.entries(SCREENS)) {
      const src = fs.readFileSync(path.join(root, 'src/screens', file), 'utf8');
      const want = NAV_PAGES.find((p) => p.id === id)!.label;
      for (const m of src.matchAll(/PageHead title="([^"]+)"/g)) if (m[1] !== want) wrong.push(`${file}: "${m[1]}", sidebar says "${want}"`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('merged pages (cuts and merges)', () => {
  it('Screen holds Capture, Record (Studio) and Present (Stage); the Toolbox leaves the sidebar', () => {
    expect(HUB_TABS.screen.map((t) => `${t.route.name}:${t.label}`)).toEqual(['capture:Capture', 'studio:Record', 'stage:Present']);
    expect(hubOf({ name: 'studio' })?.hub).toBe('screen');
    expect(hubOf({ name: 'stage', arg: 'draw' })?.hub).toBe('screen');
    expect(navSections().find((g) => g.id === 'screen')!.pages.map((p) => p.label)).toEqual(['Screen']);
    expect(navPage('tools')?.group).toBe('none');
  });
  it('old page ids still open their page (windows, app icons, keeper://open links)', () => {
    expect(navPage('capture')?.id).toBe('screen');
    expect(navPage('studio')?.route).toEqual({ name: 'studio' });
    expect(pageOf({ name: 'studio' })?.id).toBe('studio');
  });
  it('a page that became a tab is listed once, as the tab', () => {
    const listed = listedPages().map((p) => p.id);
    for (const p of NAV_PAGES.filter((x) => x.inHub)) {
      expect(listed).not.toContain(p.id);
      expect(HUB_TABS[p.inHub!].some((t) => t.route.name === p.route.name), p.id).toBe(true);
      expect(p.group).toBe('none');
    }
  });
});
