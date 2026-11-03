// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's Journal calls (entries themselves are ordinary demo notes).

import type { JournalApi } from '../core/api-journal';

export function mockJournal(): { journal: JournalApi } {
  return {
    journal: {
      makeVault: async () => ({ id: 'journal-demo', name: 'Journal', path: '/Users/sam/Documents/Journal', shared: false }),
      addPhotos: async () => [],
    },
  };
}
