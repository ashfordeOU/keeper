// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Focus blocking as the window sees it (core/focus-block.ts has the logic).

import type { ActiveBlock, BlockList, BlockPass, BlockSchedule, FocusBlockData, FocusBlockOptions } from './focus-block';

export interface FocusBlockStatus {
  data: FocusBlockData;
  options: FocusBlockOptions;
  /** what is blocked now (passes already taken out) */
  block: ActiveBlock;
  passes: BlockPass[];
  blockedToday: number;
  /** the firewall's DNS filter is answering, so sites are blocked for every app */
  dnsFilter: boolean;
  /** linked browsers that show Keeper's block page */
  browsers: string[];
  /** Keeper can see the app in front here (not on Wayland) */
  appsSupported: boolean;
  /** a Focus session runs now */
  focusOn: boolean;
}

/** What the small block window shows over a blocked app. */
export interface BlockedApp {
  app: string;
  line: string;
  until?: number;
  strict: boolean;
  passMinutes: number;
  waitSeconds: number;
}

export interface FocusBlockApi {
  status(): Promise<FocusBlockStatus>;
  saveList(list: BlockList): Promise<FocusBlockStatus>;
  removeList(id: string): Promise<FocusBlockStatus>;
  saveSchedule(s: BlockSchedule): Promise<FocusBlockStatus>;
  removeSchedule(id: string): Promise<FocusBlockStatus>;
  /** the list Focus sessions block (null: none) */
  setFocusList(id: string | null): Promise<FocusBlockStatus>;
  /** blocks a list now, for a number of minutes */
  start(listId: string, minutes: number, strict?: boolean): Promise<FocusBlockStatus>;
  /** ends the block early (refused in strict mode) */
  stop(): Promise<FocusBlockStatus>;
  /** "let me in for a few minutes" for a site or an app (refused in strict mode) */
  pass(target: string): Promise<{ ok: boolean; until?: number; message?: string }>;
  /** names of the apps open now, to add to a list */
  runningApps(): Promise<string[]>;
  /** the block window: what it shows, closing the app, and hiding the window */
  blockedApp(): Promise<BlockedApp | null>;
  closeApp(): Promise<void>;
  dismiss(): Promise<void>;
  /** test hook (only with KEEPER_FOCUS_TEST, never in official builds): pretend this app came to the front */
  testFront?(app: string): Promise<void>;
}
