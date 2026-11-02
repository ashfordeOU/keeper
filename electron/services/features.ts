// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Features in the main process: ask before starting anything, and start or
// stop when the person switches a feature in Settings → Features.
//
//   if (featureOn('widgets')) …
//   onFeature('widgets', (on) => (on ? startWidgets() : stopWidgets()), { now: true })

import { powerMonitor } from 'electron';
import { featureDef, featurePatch, FEATURES, featureStates, PRESETS, presetName, presetPatch, setForPower, setPatch, snapshotSet, type FeatureSet, type FeatureState, type PresetId } from '../../core/features';
import { onSettings, settings, updateSettings } from '../store';
import { loginItemOn, setLoginItem } from './login-item';

let states: Map<string, FeatureState> | null = null;
const handlers = new Map<string, Set<(on: boolean) => void>>();
const anyChange = new Set<() => void>();

// Safe mode (after repeated crashes, or chosen in Keeper's processes): everything but the
// library is off for this run only; the saved settings are not changed.
const SAFE_MODE = process.argv.includes('--safe-mode');
const effective = (s: ReturnType<typeof settings>) => (SAFE_MODE ? { ...s, ...presetPatch(s, 'files') } : s);

function current(): Map<string, FeatureState> {
  states ??= featureStates(effective(settings()));
  return states;
}

export function featureOn(id: string): boolean {
  const st = current().get(id);
  // A misspelt id would read as always on: in tests and unpackaged runs it is an error, as with onFeature.
  if (!st && !featureDef(id) && (process.env.VITEST || !app.isPackaged)) throw new Error(`Unknown feature "${id}": add it to core/features.ts`);
  return st?.on ?? true;
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
  states = featureStates(effective(next));
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

const externalOff = new Map<string, () => boolean>();
/** Something outside Keeper's settings keeps a feature off: an environment variable or an administrator's policy file (usage stats). */
export function setExternalOff(id: string, fn: () => boolean) {
  externalOff.set(id, fn);
}

export function listFeatures(): FeatureRow[] {
  const st = current();
  const login = loginItemOn();
  return FEATURES.map((f) => {
    const s = st.get(f.id)!;
    if (externalOff.get(f.id)?.()) return { id: f.id, wanted: s.wanted, on: false };
    // Start at login lives with the system, not in Keeper's settings.
    if (f.id === 'login' && login !== undefined) return { id: f.id, wanted: login, on: login };
    return { id: f.id, wanted: s.wanted, on: s.on, blockedBy: s.blockedBy };
  });
}

export async function setFeature(id: string, on: boolean): Promise<FeatureRow[]> {
  if (id === 'login') await setLoginItem(on);
  const patch = featurePatch(settings(), id, on);
  if (Object.keys(patch).length) await updateSettings(patch);
  return listFeatures();
}

export async function applyPreset(preset: PresetId): Promise<FeatureRow[]> {
  const patch = presetPatch(settings(), preset);
  if (Object.keys(patch).length) await updateSettings(patch);
  const loginOn = featureStates(settings()).get('login')?.wanted ?? false;
  await setLoginItem(loginOn);
  return listFeatures();
}

// ---------------------------------------------------------------- your own sets, and sets by power source

export function featureSets(): { sets: FeatureSet[]; onBattery: string; onPower: string } {
  const s = settings();
  return { sets: s.featureSets ?? [], onBattery: s.featureSetOnBattery ?? '', onPower: s.featureSetOnPower ?? '' };
}

/** Saves the current choices as a set (or replaces the set with this id). */
export async function saveFeatureSet(name: string, id?: string) {
  const s = settings();
  const set = snapshotSet(s, id || `set${Date.now().toString(36)}`, name);
  const list = s.featureSets ?? [];
  await updateSettings({ featureSets: list.some((x) => x.id === set.id) ? list.map((x) => (x.id === set.id ? set : x)) : [...list, set] });
  return featureSets();
}

export async function removeFeatureSet(id: string) {
  const s = settings();
  await updateSettings({
    featureSets: (s.featureSets ?? []).filter((x) => x.id !== id),
    featureSetOnBattery: s.featureSetOnBattery === id ? '' : s.featureSetOnBattery,
    featureSetOnPower: s.featureSetOnPower === id ? '' : s.featureSetOnPower,
  });
  return featureSets();
}

/** A saved set's id, or "preset:minimal" and the like. */
export async function applyFeatureSet(ref: string): Promise<FeatureRow[]> {
  if (ref.startsWith('preset:')) {
    const id = ref.slice(7) as PresetId;
    if (PRESETS.some((p) => p.id === presetName(id))) return applyPreset(presetName(id));
    return listFeatures();
  }
  const set = (settings().featureSets ?? []).find((x) => x.id === ref);
  if (!set) throw new Error('That set no longer exists.');
  const patch = setPatch(settings(), set);
  if (Object.keys(patch).length) await updateSettings(patch);
  return listFeatures();
}

export async function setPowerSets(onBattery: string, onPower: string) {
  await updateSettings({ featureSetOnBattery: onBattery, featureSetOnPower: onPower });
  return featureSets();
}

/** Switches sets when the computer is plugged in or unplugged (only when the person chose sets for that). */
export function startPowerSets() {
  const apply = (battery: boolean) => {
    const ref = setForPower(settings(), battery);
    if (ref) void applyFeatureSet(ref).catch(() => undefined);
  };
  powerMonitor.on('on-battery', () => apply(true));
  powerMonitor.on('on-ac', () => apply(false));
}

// ---------------------------------------------------------------- what each feature costs right now

export interface FeatureLive {
  id: string;
  /** regular checks the feature has running, and how often they look now (null = paused) */
  checks: { name: string; everyMs: number | null; runs: number }[];
  /** background work it has registered */
  tasks: { label: string; state: string }[];
}

export async function liveCosts(): Promise<FeatureLive[]> {
  const { usage } = await import('./governor');
  const u = usage();
  return FEATURES.map((f) => ({
    id: f.id,
    checks: u.checks.filter((c) => c.features?.includes(f.id)).map(({ name, everyMs, runs }) => ({ name, everyMs, runs })),
    tasks: [],
  }));
}
