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
  /** read this computer's own calendars (macOS Calendar, Windows Calendar or Outlook, the Linux desktop's) */
  systemCalendars?: boolean;
  /** public holidays of this country as a calendar ('' = none) */
  holidayCountry?: string;
  /** a birthdays calendar made from your contacts */
  birthdays?: boolean;
  /** client IDs registered for this build (or entered here) */
  clients?: { google?: string; googleSecret?: string; microsoft?: string };
}
