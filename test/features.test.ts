// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commandHidden, CORE, currentPreset, currentSet, FEATURES, featurePatch, featureStates, hiddenRoutes, isOn, presetPatch, setForPower, setPatch, snapshotSet } from '../core/features';
import { defaultSettings, type AllSettings } from '../core/settings';

const base = (): AllSettings => defaultSettings(['/home/a/Documents'], []);
const apply = (s: AllSettings, p: Partial<AllSettings>): AllSettings => ({ ...s, ...p });

describe('features', () => {
  it('every feature is well formed: unique ids, known needs, a cost and words for people', () => {
    const ids = new Set<string>();
    for (const f of FEATURES) {
      expect(ids.has(f.id), f.id).toBe(false);
      ids.add(f.id);
      expect(f.name.length).toBeGreaterThan(2);
      expect(f.description.length).toBeGreaterThan(10);
      expect(['none', 'low', 'medium', 'high']).toContain(f.cost.level);
    }
    for (const f of FEATURES) for (const r of f.requires ?? []) expect(ids.has(r), `${f.id} needs ${r}`).toBe(true);
  });

  it('starts with the defaults, through older settings where they exist', () => {
    const s = base();
    for (const f of FEATURES) if (!f.requires?.length) expect(isOn(s, f.id, 'linux'), f.id).toBe(f.always || f.defaultOn || (f.bridge ? f.bridge.get(s) : false));
    expect(isOn(s, 'library', 'linux')).toBe(true);
  });

  it('a feature is off while something it needs is off, and says what', () => {
    let s = base();
    s = apply(s, featurePatch(s, 'island', false));
    expect(s.island.enabled).toBe(false);
    const st = featureStates(s, 'linux');
    expect(st.get('media')).toMatchObject({ wanted: true, on: false, blockedBy: ['island'] });
    expect(st.get('clipboard')?.on).toBe(true); // clipboard history has its own window
  });

  it('turning a feature on turns on what it needs', () => {
    let s = base();
    s = apply(s, featurePatch(s, 'docText', false));
    expect(isOn(s, 'brain', 'linux')).toBe(false);
    s = apply(s, featurePatch(s, 'semantic', true));
    expect(s.brain.semantic).toBe(true);
    expect(isOn(s, 'docText', 'linux')).toBe(true);
    expect(isOn(s, 'semantic', 'linux')).toBe(true);
  });

  it('the library cannot be switched off', () => {
    const s = base();
    expect(featurePatch(s, 'library', false)).toEqual({});
  });

  it('presets switch everything at once and are recognised afterwards', () => {
    let s = base();
    s = apply(s, presetPatch(s, 'recommended'));
    expect(currentPreset(s)).toBe('recommended');
    s = apply(s, presetPatch(s, 'files'));
    expect(currentPreset(s)).toBe('files');
    expect(isOn(s, 'island', 'linux')).toBe(false);
    expect(s.island.enabled).toBe(false);
    expect(s.updateMode).toBe('off');
    expect(isOn(s, 'cleanup', 'linux')).toBe(true);
    s = apply(s, presetPatch(s, 'everything'));
    // Features made for other systems (Monorail is macOS only) stay off here.
    // Features only the person's own switch changes (ownChoice) keep their setting.
    expect(FEATURES.filter((f) => (!f.platforms || f.platforms.includes('linux')) && !f.ownChoice).every((f) => isOn(s, f.id, 'linux'))).toBe(true);
    expect(isOn(s, 'monorail', 'linux')).toBe(false);
    expect(s.updateMode).toBe('auto');
  });

  it('hides the pages and commands of features that are off', () => {
    let s = base();
    s = apply(s, featurePatch(s, 'health', false));
    const st = featureStates(s, 'linux');
    const routes = hiddenRoutes(st);
    expect(routes.has('health')).toBe(true);
    expect(routes.has('processes')).toBe(true); // needs health
    expect(routes.has('cleanup')).toBe(false);
    expect(commandHidden(st, 'health-check')).toBe(true);
    expect(commandHidden(st, 'cleanup')).toBe(false);
  });

  it('saves your own sets, applies them, and picks one by power source', () => {
    let s = base();
    s = apply(s, featurePatch(s, 'island', false));
    s = apply(s, featurePatch(s, 'health', false));
    const travel = snapshotSet(s, 'travel', 'Travel', 'linux');
    expect(travel.features.island).toBe(false);
    expect(travel.features.library).toBeUndefined(); // always on, not part of a set
    s = apply(s, presetPatch(s, 'everything'));
    expect(currentSet(s, [travel], 'linux')).toBeUndefined();
    s = apply(s, setPatch(s, travel));
    expect(isOn(s, 'island', 'linux')).toBe(false);
    expect(isOn(s, 'health', 'linux')).toBe(false);
    expect(s.island.enabled).toBe(false); // through the older setting
    expect(currentSet(s, [travel], 'linux')).toBe('travel');
    const ps = { featureSetOnBattery: 'travel', featureSetOnPower: 'preset:everything' };
    expect(setForPower(ps, true)).toBe('travel');
    expect(setForPower(ps, false)).toBe('preset:everything');
    expect(setForPower({ featureSetOnBattery: '', featureSetOnPower: '' }, true)).toBe('');
  });

  it('switching Keep Awake off hides its page and every keep-awake command', () => {
    let s = base();
    s = apply(s, featurePatch(s, 'keepAwake', false));
    const st = featureStates(s, 'linux');
    expect(hiddenRoutes(st).has('awake')).toBe(true);
    for (const id of ['awake', 'awake-off', 'awake-toggle', 'awake-30', 'awake-page']) expect(commandHidden(st, id), id).toBe(true);
  });
});

// ---------------------------------------------------------------- every page, sidebar entry and command has an owner

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const owners = (kind: 'routes' | 'commands', id: string): string[] => {
  const hit = FEATURES.filter((f) => (f[kind] ?? []).some((c) => (c.endsWith('*') ? id.startsWith(c.slice(0, -1)) : c === id))).map((f) => f.id);
  if ((CORE[kind] as string[]).some((c) => (c.endsWith('*') ? id.startsWith(c.slice(0, -1)) : c === id))) hit.push('core');
  return hit;
};

describe('feature coverage', () => {
  it('every page (RouteName) belongs to a feature or to Keeper itself', () => {
    const union = src('src/state.tsx').match(/export type RouteName =([\s\S]*?);/)![1];
    const routes = [...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(20);
    const orphans = routes.filter((r) => !owners('routes', r).length);
    expect(orphans, `pages without an owning feature id: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every sidebar entry belongs to a feature or to Keeper itself', () => {
    const app = src('src/App.tsx');
    const navs = [...app.matchAll(/NavItem[^>]*route=\{\{ name: '([a-z]+)'/g)].map((m) => m[1]);
    expect(navs.length).toBeGreaterThan(15);
    const orphans = [...new Set(navs)].filter((r) => !owners('routes', r).length);
    expect(orphans, `sidebar entries without an owning feature id: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every command palette entry belongs to a feature or to Keeper itself', () => {
    const pal = src('src/components/CommandPalette.tsx');
    const body = pal.slice(pal.indexOf('const commands = useMemo'));
    const fixed = [...body.matchAll(/\bid: '([a-z0-9-]+)'/g)].map((m) => m[1]).filter((id) => id !== 'search' || true);
    // Template ids: `awake-${m}` → "awake-x"; `go-${label}` is checked through the pages it opens (below).
    const templ = [...body.matchAll(/\bid: `([a-z0-9-]+)\$\{/g)].map((m) => `${m[1]}x`).filter((id) => id !== 'go-x');
    const orphans = [...new Set([...fixed, ...templ])].filter((id) => !owners('commands', id).length);
    expect(orphans, `palette commands without an owning feature id: ${orphans.join(', ')}`).toEqual([]);
    // "Go to" pages
    const pages = [...pal.slice(0, pal.indexOf('export function CommandPalette')).matchAll(/\[\{ name: '([a-z]+)'/g)].map((m) => m[1]);
    expect(pages.length).toBeGreaterThan(10);
    const orphanPages = pages.filter((r) => !owners('routes', r).length);
    expect(orphanPages, `palette pages without an owning feature id: ${orphanPages.join(', ')}`).toEqual([]);
  });
});

