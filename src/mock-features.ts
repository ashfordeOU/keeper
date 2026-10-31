// SPDX-License-Identifier: AGPL-3.0-or-later
// Demo of Settings → Features in the browser preview.

import type { FeatureRow, FeaturesApi } from '../core/api-features';
import { FEATURES, featurePatch, featureStates, presetPatch } from '../core/features';
import type { AllSettings } from '../core/settings';

export function mockFeatures(get: () => AllSettings, apply: (patch: Partial<AllSettings>) => void): FeaturesApi {
  const rows = (): FeatureRow[] => {
    const st = featureStates(get(), 'darwin');
    return FEATURES.map((f) => st.get(f.id)!);
  };
  return {
    list: async () => rows(),
    set: async (id, on) => { apply(featurePatch(get(), id, on)); return rows(); },
    preset: async (id) => { apply(presetPatch(get(), id)); return rows(); },
  };
}
