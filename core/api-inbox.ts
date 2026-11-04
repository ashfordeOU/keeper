// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Inbox's calls (core/inbox.ts, electron/ipc/inbox.ts): what was caught,
// and the small card the shortcut opens from any app.

import type { InboxInput, InboxItem } from './inbox';

export interface InboxApi {
  /** everything waiting to be sorted, newest first */
  list(): Promise<InboxItem[]>;
  /** catches one thing; null when there was nothing in it */
  add(input: InboxInput): Promise<InboxItem | null>;
  remove(id: string): Promise<void>;
  /** puts a sorted or deleted item back (Undo) */
  restore(item: InboxItem): Promise<void>;
  /** the small card: open it (from the shortcut, the tray or the palette), close it, or step it aside for a screenshot */
  card(action: 'open' | 'close' | 'hide' | 'show'): Promise<void>;
}
