// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Journal mode (core/notes/journal.ts): the calls Notes does not already have.

import type { VaultInfo } from './api-notes';

export interface JournalApi {
  /** a "Journal" vault in Documents (made if needed), without asking where */
  makeVault(): Promise<VaultInfo>;
  /** copies photos into the vault beside an entry (asks for them when no paths are given); returns their vault paths */
  addPhotos(vault: string, notePath: string, paths?: string[]): Promise<string[]>;
}
