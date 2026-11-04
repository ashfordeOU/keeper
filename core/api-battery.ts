// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Battery care as the window sees it (core/charge-limit.ts has the logic).

import type { ChargePlan, ChargeSettings, VendorApp } from './charge-limit';

export interface BatteryCareStatus {
  platform: string;
  settings: ChargeSettings;
  /** null: no battery */
  battery: { percent: number; charging: boolean; plugged: boolean; temp?: number } | null;
  /** how this computer sets a limit: Linux thresholds, the maker's app on Windows, the system on a Mac */
  support: 'linux' | 'windows' | 'mac' | 'none';
  /** Keeper can set the limit here */
  canLimit: boolean;
  /** Keeper can pause charging while hot */
  canPause: boolean;
  /** Keeper may change it without an administrator prompt (needed for a trip and heat) */
  withoutAsking: boolean;
  /** the limit the battery has now, as the system reports it */
  current?: number;
  /** the limit is kept after a restart */
  kept?: boolean;
  plan?: ChargePlan;
  /** Windows: the maker's app that sets the limit */
  vendor?: VendorApp;
  note?: string;
  /** what went wrong last time, in plain words */
  message?: string;
}

export interface BatteryCareApi {
  status(): Promise<BatteryCareStatus>;
  /** sets the limit (100 = none) under one administrator prompt; `withoutAsking` lets Keeper change it later by itself */
  apply(limit: number, opts?: { withoutAsking?: boolean }): Promise<{ ok: boolean; message: string }>;
  /** charge to full until tomorrow morning, then back to the limit */
  setTrip(on: boolean): Promise<BatteryCareStatus>;
  /** pause charging while the battery is warm */
  setHeat(on: boolean): Promise<BatteryCareStatus>;
  /** Battery settings on a Mac; the maker's app (or a store search for it) on Windows */
  openSettings(): Promise<void>;
}
