// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Features: switch parts of Keeper on and off (see core/features.ts).

import type { FeatureSet, PresetId } from './features';

export interface FeatureRow {
  id: string;
  /** what the person chose */
  wanted: boolean;
  /** on, and everything it needs is on */
  on: boolean;
  /** what keeps it off although it is wanted */
  blockedBy?: string[];
}

export interface FeaturesApi {
  list(): Promise<FeatureRow[]>;
  set(id: string, on: boolean): Promise<FeatureRow[]>;
  preset(id: PresetId): Promise<FeatureRow[]>;
  /** your own saved sets, and which set to use on battery and on power ('' = none, "preset:minimal" for a preset) */
  sets(): Promise<{ sets: FeatureSet[]; onBattery: string; onPower: string }>;
  saveSet(name: string, id?: string): Promise<{ sets: FeatureSet[]; onBattery: string; onPower: string }>;
  removeSet(id: string): Promise<{ sets: FeatureSet[]; onBattery: string; onPower: string }>;
  applySet(ref: string): Promise<FeatureRow[]>;
  setPowerSets(onBattery: string, onPower: string): Promise<{ sets: FeatureSet[]; onBattery: string; onPower: string }>;
  /** the checks and work each feature has running right now */
  live(): Promise<{ id: string; checks: { name: string; everyMs: number | null; runs: number }[] }[]>;
}
