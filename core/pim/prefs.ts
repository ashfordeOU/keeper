// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
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
