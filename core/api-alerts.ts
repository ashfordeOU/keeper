// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Alerts to your phone as the window sees them (core/phone-alerts.ts has the logic).

import type { AlertChannel, AlertSource, PhoneAlertSettings } from './phone-alerts';

export interface AlertChannelStatus extends AlertChannel {
  /** a token is saved in the keychain */
  hasSecret: boolean;
  /** the keychain is there but would not open it */
  secretLocked?: boolean;
  /** the last delivery */
  last?: { at: number; ok: boolean; message?: string };
}

export interface AlertLogEntry {
  at: number;
  channel: string;
  title: string;
  sources: AlertSource[];
  ok: boolean;
  message?: string;
  test?: boolean;
}

export interface PhoneAlertsOverview {
  channels: AlertChannelStatus[];
  settings: PhoneAlertSettings;
  /** the last deliveries, newest first */
  log: AlertLogEntry[];
  /** alerts waiting to go out together */
  waiting: number;
  /** Mail accounts that can send (for e-mail channels) */
  accounts: { id: string; label: string; email?: string }[];
  /** tokens can only be kept in memory (no keychain on this computer) */
  memoryOnly: boolean;
}

export interface PhoneAlertsApi {
  overview(): Promise<PhoneAlertsOverview>;
  /** adds or changes a channel; `secret` replaces the saved token when given ('' removes it) */
  save(channel: AlertChannel, secret?: string): Promise<PhoneAlertsOverview>;
  remove(id: string): Promise<PhoneAlertsOverview>;
  /** sends a test message now; resolves with what happened */
  test(id: string): Promise<{ ok: boolean; message: string }>;
  setBatch(seconds: number): Promise<PhoneAlertsOverview>;
}
