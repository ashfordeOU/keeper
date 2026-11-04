// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's notification center: a few calm notices from different parts.

import type { NoticesApi, NoticesView } from '../core/api-notices';
import { markAllDone, markDone, openNotices, type Notice } from '../core/notices';

export function mockNotices(emit: (channel: string, ...args: unknown[]) => void): { notices: NoticesApi } {
  const now = Date.now();
  const min = 60_000;
  let items: Notice[] = [
    { id: 'n1', part: 'mail', title: 'Ana Lopez', detail: 'Homepage drafts, round 2', at: now - 4 * min, route: { name: 'mail' } },
    { id: 'n2', part: 'monitors', title: 'shop.example.com is back up', detail: 'It was down for 3 minutes', at: now - 22 * min, route: { name: 'monitors' } },
    { id: 'n3', part: 'fixit', title: 'The Trash holds 3.2 GB', detail: 'Empty it to free the space', at: now - 70 * min, route: { name: 'todo' }, held: true },
    { id: 'n4', part: 'mail', title: 'Sam Reed', detail: 'Lunch on Friday?', at: now - 95 * min, route: { name: 'mail' } },
    { id: 'n5', part: 'updates', title: 'Keeper 1.0.1 is available', detail: 'Choose it in the menu bar to see what’s new', at: now - 180 * min },
  ];
  let snoozedUntil = 0;
  const view = async (): Promise<NoticesView> => ({ items, open: openNotices(items).length, snoozedUntil: snoozedUntil > Date.now() ? snoozedUntil : 0, hold: snoozedUntil > Date.now() ? 'snoozed' : null, nextRelease: 0, systemReadable: false });
  const changed = () => emit('notices-changed', openNotices(items).length);
  return {
    notices: {
      list: view,
      done: async (id) => { items = markDone(items, id); changed(); return view(); },
      doneAll: async () => { items = markAllDone(items); changed(); return view(); },
      snoozeAll: async (ms) => { snoozedUntil = ms > 0 ? Date.now() + ms : 0; changed(); return view(); },
      clearDone: async () => { items = items.filter((n) => !n.done); changed(); return view(); },
      test: async () => { items = [{ id: `t${Date.now()}`, part: 'keeper', title: 'This is how notices look', detail: 'They gather in the bell, grouped by part.', at: Date.now() }, ...items]; changed(); return view(); },
    },
  };
}
