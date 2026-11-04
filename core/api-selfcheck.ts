// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Check Keeper and the problem report, as the window sees them (core/selfcheck.ts has the logic).

import type { CheckRow, ReportFile } from './selfcheck';

export interface SelfCheckApi {
  run(): Promise<{ rows: CheckRow[]; at: number }>;
  /** a row's Fix that Keeper does itself (rescan, keychain, restart:<part>, component:<id>) */
  fix(action: string): Promise<{ ok: boolean; message: string }>;
  /** every file of the problem report, already redacted, to show before saving */
  reportPreview(): Promise<ReportFile[]>;
  /** saves the report as a zip where the person chooses; nothing is sent */
  reportSave(): Promise<{ ok: boolean; path?: string; message: string }>;
}
