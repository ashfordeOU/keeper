// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The AI usage and subscription tracker's interface (electron/services/usage-tracker.ts).

import type { GlanceUsage, MenuBarLabel } from './usage-tracker/label';
import type { Account, AccountState, ProviderId, TrackerSettings } from './usage-tracker/model';
import type { HistoryPoint, PriorityItem, PrioritySummary } from './usage-tracker/priority';
import type { ReceiptGuess, Reminder } from './usage-tracker/subscriptions';

export interface AccountView extends Account {
  /** a key is kept for it in the system keychain (or for this session) */
  hasKey: boolean;
  /** Keeper reads this account's status line */
  statusLineOn?: boolean;
}

export interface UsageOverview {
  /** the tracker feature is on */
  on: boolean;
  settings: TrackerSettings;
  accounts: AccountView[];
  states: Record<string, AccountState>;
  items: PriorityItem[];
  summary: PrioritySummary;
  label: MenuBarLabel;
  /** when the next look happens (ms since epoch) */
  nextUpdateAt?: number;
  /** the last week of each limit, for sparklines */
  recent: Record<string, HistoryPoint[]>;
  /** account id → YYYY-MM → US dollars */
  costs: Record<string, Record<string, number>>;
  subscriptions: { monthly: Record<string, number>; upcoming: Reminder[] };
  /** keys could only be kept until Keeper quits (no system keychain) */
  keysInMemory: boolean;
}

export interface DetectedAccount {
  provider: ProviderId;
  name: string;
  configDir: string;
  /** already added */
  added: boolean;
}

export interface AccountInput extends Partial<Omit<Account, 'createdAt'>> {
  provider: ProviderId;
  name: string;
}

export interface AiUsageApi {
  overview(): Promise<UsageOverview>;
  /** look again now (one account, or all) */
  refresh(accountId?: string): Promise<UsageOverview>;
  /** add or change an account; `key` is stored in the keychain ('' removes it, undefined keeps it) */
  saveAccount(a: AccountInput, key?: string): Promise<AccountView[]>;
  removeAccount(id: string): Promise<AccountView[]>;
  reorder(ids: string[]): Promise<AccountView[]>;
  setSettings(patch: Partial<TrackerSettings>): Promise<TrackerSettings>;
  /** full history (up to 90 days) for the Usage page */
  history(days?: number): Promise<Record<string, HistoryPoint[]>>;
  /** asks where to save, then writes history and monthly costs as CSV */
  exportCsv(): Promise<{ path?: string; rows: number }>;
  /** coding tools' config folders found on this computer */
  detect(): Promise<DetectedAccount[]>;
  /** reads the 5-hour and weekly limits from the tool's status line (changes its settings file; undoable) */
  setStatusLine(accountId: string, on: boolean): Promise<{ ok: boolean; message: string }>;
  /** receipts from AI services in Mail (sender, subject and preview only) */
  scanReceipts(): Promise<ReceiptGuess[]>;
  openPage(tab?: string): Promise<void>;
  /** what the AI usage card in the owl's glance and the short label show right now (tests, Settings preview) */
  glanceState(): Promise<{ card?: GlanceUsage; text: string; tooltip: string; notices: string[] }>;
}
