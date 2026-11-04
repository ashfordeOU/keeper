// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo of modes in the browser preview (core/modes.ts does the work).

import type { ModesApi } from '../core/api-modes';
import { modeOf, previewSwitch, resetModePatch, startSession, switchPatch } from '../core/modes';
import type { AllSettings } from '../core/settings';

export function mockModes(get: () => AllSettings, apply: (patch: Partial<AllSettings>) => void): ModesApi {
  const ctx = { platform: 'darwin' };
  return {
    preview: async (to) => previewSwitch(get(), to, ctx, 'darwin'),
    switch: async (to) => { apply(switchPatch(get(), to, ctx, Date.now(), 'darwin')); return modeOf(get()); },
    reset: async () => { apply(resetModePatch(get(), ctx)); return modeOf(get()); },
    focus: async (minutes) => { const s = startSession(minutes); apply({ modeSession: s }); return s; },
    endFocus: async () => { apply({ modeSession: null }); },
  };
}
