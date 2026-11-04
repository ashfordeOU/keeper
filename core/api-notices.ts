// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The notification center as the window sees it (core/notices.ts has the logic).

import type { Notice } from './notices';

export interface NoticesView {
  items: Notice[];
  /** open (not done) notices */
  open: number;
  /** "Snooze all" until then (0 = not snoozed) */
  snoozedUntil: number;
  /** why nothing is shown just now: snoozed, quiet hours, focus, the system's Do Not Disturb */
  hold: 'snoozed' | 'quiet' | 'focus' | 'system' | null;
  /** when held notices go out next (0 = none held) */
  nextRelease: number;
  /** the system's Do Not Disturb can be read on this computer */
  systemReadable: boolean;
}

export interface NoticesApi {
  list(): Promise<NoticesView>;
  /** done: off the open list (kept as done until the list is cleared) */
  done(id: string): Promise<NoticesView>;
  /** "Mark all done" */
  doneAll(): Promise<NoticesView>;
  /** "Snooze all 1 h": nothing is shown until then (0 ends it) */
  snoozeAll(ms: number): Promise<NoticesView>;
  /** removes done notices */
  clearDone(): Promise<NoticesView>;
  /** "Send a test notice": shown at once and listed under Keeper itself */
  test(): Promise<NoticesView>;
}
