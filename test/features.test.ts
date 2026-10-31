import { describe, expect, it } from 'vitest';
import { commandHidden, currentPreset, FEATURES, featurePatch, featureStates, hiddenRoutes, isOn, presetPatch } from '../core/features';
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
    expect(currentPreset(s)).toBe('balanced');
    s = apply(s, presetPatch(s, 'files'));
    expect(currentPreset(s)).toBe('files');
    expect(isOn(s, 'island', 'linux')).toBe(false);
    expect(s.island.enabled).toBe(false);
    expect(s.updateMode).toBe('off');
    expect(isOn(s, 'cleanup', 'linux')).toBe(true);
    s = apply(s, presetPatch(s, 'everything'));
    expect(FEATURES.every((f) => isOn(s, f.id, 'linux'))).toBe(true);
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
});
