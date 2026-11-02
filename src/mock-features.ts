// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo of Settings → Features in the browser preview.

import type { FeatureRow, FeaturesApi } from '../core/api-features';
import { FEATURES, featurePatch, featureStates, PRESETS, presetName, presetPatch, setPatch, snapshotSet } from '../core/features';
import type { AllSettings } from '../core/settings';

export function mockFeatures(get: () => AllSettings, apply: (patch: Partial<AllSettings>) => void): FeaturesApi {
  const sets = () => ({ sets: get().featureSets ?? [], onBattery: get().featureSetOnBattery ?? '', onPower: get().featureSetOnPower ?? '' });
  const rows = (): FeatureRow[] => {
    const st = featureStates(get(), 'darwin');
    return FEATURES.map((f) => st.get(f.id)!);
  };
  return {
    list: async () => rows(),
    set: async (id, on) => { apply(featurePatch(get(), id, on)); return rows(); },
    preset: async (id) => { apply(presetPatch(get(), id)); return rows(); },
    sets: async () => sets(),
    saveSet: async (name, id) => {
      const set = snapshotSet(get(), id || `set${Date.now().toString(36)}`, name, 'darwin');
      const list = get().featureSets ?? [];
      apply({ featureSets: list.some((x) => x.id === set.id) ? list.map((x) => (x.id === set.id ? set : x)) : [...list, set] });
      return sets();
    },
    removeSet: async (id) => { apply({ featureSets: (get().featureSets ?? []).filter((x) => x.id !== id) }); return sets(); },
    applySet: async (ref) => {
      if (ref.startsWith('preset:')) { const p = PRESETS.find((x) => `preset:${x.id}` === `preset:${presetName(ref.slice(7))}`); if (p) apply(presetPatch(get(), p.id)); return rows(); }
      const set = (get().featureSets ?? []).find((x) => x.id === ref);
      if (set) apply(setPatch(get(), set));
      return rows();
    },
    setPowerSets: async (b, p) => { apply({ featureSetOnBattery: b, featureSetOnPower: p }); return sets(); },
    // A pretend computer: the Island's checks and Keep Awake's (only while a session runs).
    live: async () => FEATURES.map((f) => ({ id: f.id, checks: ({ island: [{ name: 'island.housekeeping', everyMs: 10_000, runs: 42 }, { name: 'island.devices', everyMs: 60_000, runs: 7 }], clipboard: [{ name: 'island.clipboard', everyMs: 700, runs: 610 }], media: [{ name: 'island.media', everyMs: 15_000, runs: 30 }], calendar: [{ name: 'island.calendar', everyMs: 900_000, runs: 1 }] } as Record<string, { name: string; everyMs: number | null; runs: number }[]>)[f.id] ?? [] })),
  };
}
