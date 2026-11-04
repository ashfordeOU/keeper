// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's Inbox: a few things caught today, kept in memory.

import type { InboxApi } from '../core/api-inbox';
import { addToInbox, newInboxItem, type InboxItem } from '../core/inbox';

export function mockInbox(emit: (channel: string, ...args: unknown[]) => void): { inbox: InboxApi } {
  const now = Date.now();
  let items: InboxItem[] = [
    newInboxItem({ text: 'Ask Sam about the venue for the 14th', source: 'card' }, now - 40 * 60_000, 'demo-1')!,
    newInboxItem({ text: 'https://example.org/articles/slow-mornings', source: 'card' }, now - 2 * 3_600_000, 'demo-2')!,
    newInboxItem({ text: 'Renew the bike insurance before Friday', kind: 'voice', source: 'card' }, now - 5 * 3_600_000, 'demo-3')!,
  ];
  let n = 10;
  const changed = () => emit('inbox-changed', items.length);
  return {
    inbox: {
      list: async () => [...items],
      add: async (input) => { const it = newInboxItem(input, Date.now(), `demo-${n++}`); if (it) { items = addToInbox(items, it); changed(); } return it; },
      remove: async (id) => { items = items.filter((i) => i.id !== id); changed(); },
      restore: async (item) => { items = addToInbox(items, item).sort((a, b) => b.at - a.at); changed(); },
      card: async () => undefined,
    },
  };
}
