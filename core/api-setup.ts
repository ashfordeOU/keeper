// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The first-run setup (src/setup/FirstRun.tsx ↔ electron/services/setup.ts).

import type { ComputerContext, PresetId } from './features';
import type { SetupApprovals } from './permissions';

export type SetupContext = ComputerContext & { musicRunning: boolean; model: string };

export interface SetupApi {
  /** what this computer is like (battery, notch, memory, coding tools, a notes vault, a local AI…) */
  context(): Promise<SetupContext>;
  /** the parts Recommended turns on here, without the found-on-this-computer extras the person removed */
  recommended(declined?: ComputerContext['declined']): Promise<string[]>;
  /** writes the choice: a preset, or exactly these parts; plus the three "Also" boxes */
  apply(choice: { preset: PresetId; declined?: ComputerContext['declined'] } | { parts: string[] }, extras?: { login?: boolean; updates?: boolean; usageStats?: boolean }): Promise<{ on: string[] }>;
  /** the approvals these parts (or the parts that are on) need, tiered */
  approvals(parts?: string[]): Promise<SetupApprovals>;
  /** setup finished or skipped: the library reads every folder from now on */
  finish(): Promise<void>;
}
