// SPDX-License-Identifier: AGPL-3.0-or-later
// Mail and calendar settings the interface can change.

export interface PimPrefsView {
  notifyPreviews: boolean;
  notifyMail: boolean;
  undoSendSec: number;
  trustedSenders: string[];
  attachmentsFolder?: string;
  defaultAlertMin: number;
  weekStart: number;
  showWeekNumbers: boolean;
  defaultCalendar?: string;
  /** client IDs registered for this build (or entered here) */
  clients?: { google?: string; googleSecret?: string; microsoft?: string };
}
