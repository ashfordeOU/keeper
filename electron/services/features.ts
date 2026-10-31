// SPDX-License-Identifier: AGPL-3.0-or-later
// Features in the main process: ask before starting anything, and start or
// stop when the person switches a feature in Settings → Features.
//
//   if (featureOn('widgets')) …
//   onFeature('widgets', (on) => (on ? startWidgets() : stopWidgets()), { now: true })

import { app } from 'electron';
import { featureDef, featurePatch, FEATURES, featureStates, presetPatch, type FeatureState, type PresetId } from '../../core/features';
import { onSettings, settings, updateSettings } from '../store';

let states: Map<string, FeatureState> | null = null;
const handlers = new Map<string, Set<(on: boolean) => void>>();
const anyChange = new Set<() => void>();

function current(): Map<string, FeatureState> {
  states ??= featureStates(settings());
  return states;
}

export function featureOn(id: string): boolean {
  return current().get(id)?.on ?? true;
}

/** Runs `fn` whenever the feature turns on or off (and once straight away with `now`). */
export function onFeature(id: string, fn: (on: boolean) => void, opts: { now?: boolean } = {}): () => void {
  if (!featureDef(id)) throw new Error(`Unknown feature "${id}": add it to core/features.ts`);
  let set = handlers.get(id);
  if (!set) handlers.set(id, (set = new Set()));
  set.add(fn);
  if (opts.now) fn(featureOn(id));
  return () => set!.delete(fn);
}

/** Any feature changed (for the interface). */
export function onFeaturesChanged(fn: () => void): () => void {
  anyChange.add(fn);
  return () => anyChange.delete(fn);
}

onSettings((next) => {
  const prev = current();
  states = featureStates(next);
  let changed = false;
  for (const [id, st] of states) {
    if (prev.get(id)?.on === st.on) continue;
    changed = true;
    for (const fn of handlers.get(id) ?? []) {
      try {
        fn(st.on);
      } catch (e) {
        console.error(`Feature ${id}:`, e);
      }
    }
  }
  if (changed) for (const fn of anyChange) fn();
});

// ---------------------------------------------------------------- IPC

export type { FeatureRow } from '../../core/api-features';
import type { FeatureRow } from '../../core/api-features';

export function listFeatures(): FeatureRow[] {
  const st = current();
  const login = app.getLoginItemSettings?.().openAtLogin;
  return FEATURES.map((f) => {
    const s = st.get(f.id)!;
    // Start at login lives with the system, not in Keeper's settings.
    if (f.id === 'login' && login !== undefined) return { id: f.id, wanted: login, on: login };
    return { id: f.id, wanted: s.wanted, on: s.on, blockedBy: s.blockedBy };
  });
}

export async function setFeature(id: string, on: boolean): Promise<FeatureRow[]> {
  if (id === 'login') {
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  }
  const patch = featurePatch(settings(), id, on);
  if (Object.keys(patch).length) await updateSettings(patch);
  return listFeatures();
}

export async function applyPreset(preset: PresetId): Promise<FeatureRow[]> {
  const patch = presetPatch(settings(), preset);
  if (Object.keys(patch).length) await updateSettings(patch);
  const loginOn = featureStates(settings()).get('login')?.wanted ?? false;
  app.setLoginItemSettings({ openAtLogin: loginOn, args: ['--hidden'] });
  return listFeatures();
}
