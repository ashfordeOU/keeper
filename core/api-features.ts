// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings → Features: switch parts of Keeper on and off (see core/features.ts).

import type { PresetId } from './features';

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
}
