// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail and calendar settings the interface can change.

import type { MailTemplate } from './compose-rich';
import type { UnifiedView } from './unified';

export interface SmartMailbox {
  id: string;
  name: string;
  /** a search (core/pim/search.ts) */
  query: string;
}

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
  /** sort inboxes into Important and Other (on unless false) */
  splitInbox?: boolean;
  /** which new mail drops down from the Island: Important only (default), all, or none */
  islandMail?: 'important' | 'all' | 'off';
  /** senders moved to Important or Other by hand (lower case) */
  importantSenders?: string[];
  otherSenders?: string[];
  /** sent mail unanswered for this many days is called out in Waiting for reply (default 3) */
  followUpDays?: number;
  /** the reading layout: list beside the message, or a wide list with bulk actions */
  mailLayout?: 'split' | 'wide';
  /** keyboard shortcuts: which set, and the person's own changes ("action": "key, key") */
  shortcutScheme?: 'gmail' | 'apple' | 'superhuman';
  shortcutOverrides?: Record<string, string>;
  /** keep the newest inbox messages' text on this computer for reading offline (on unless false) */
  offlineBodies?: boolean;
  /** the number on the Dock or taskbar icon: unread inbox mail, only Important, or none */
  dockBadge?: 'all' | 'important' | 'off';
  /** designed mail (newsletters, receipts) in dark mode: on a light card as made ('card', default) or darkened like the rest ('dark') */
  darkMail?: 'card' | 'dark';
  /** reading text size in pixels (⌘+ / ⌘−) */
  mailTextSize?: number;
  /** how close together the list's rows are */
  mailDensity?: 'compact' | 'comfortable' | 'roomy';
  /** only these senders drop down from the notch (addresses, @domains; empty = everyone) */
  notchSenders?: string[];
  /** senders whose mail goes straight to Junk (addresses, @domains) */
  blockedSenders?: string[];
  /** facts the person keeps for the AI ("I sign as Ana", "my team is …"); sent with AI requests */
  aiMemory?: string[];
  /** saved replies and messages */
  templates?: MailTemplate[];
  /** saved searches shown as mailboxes */
  smartMailboxes?: SmartMailbox[];
  /** your own combined mailboxes (chosen accounts' inboxes or folders as one list) */
  unifiedViews?: UnifiedView[];
  /** the sign-in code or magic link in new mail: a Copy / Open button on its notification and in the Island (on unless false) */
  codeActions?: boolean;
}
