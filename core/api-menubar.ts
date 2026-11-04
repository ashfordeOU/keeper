// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Menu bar icons as the window sees them (core/menubar-items.ts has the logic).

import type { MenuBarAvailability, MenuBarIcon } from './menubar-items';

export interface MenuBarStatus {
  availability: MenuBarAvailability;
  /** icons right of Keeper's divider (always in view) and left of it (hidden while hiding) */
  shown: MenuBarIcon[];
  hidden: MenuBarIcon[];
  /** Keeper keeps the icons left of its divider out of sight (the setting) */
  hiding: boolean;
  /** they are shown for a moment now (a click on the divider) */
  peeking: boolean;
  /** Keeper's divider is in the menu bar */
  divider: boolean;
  /** why the list could not be read, when it could not */
  note?: string;
}

export interface MenuBarApi {
  status(): Promise<MenuBarStatus>;
  /** keep the icons left of the divider out of sight (or always show them) */
  setHiding(on: boolean): Promise<MenuBarStatus>;
  /** show the hidden icons for a moment */
  peek(): Promise<MenuBarStatus>;
  /** opens one icon's menu */
  press(id: string): Promise<boolean>;
  /** moves an icon across the divider (a ⌘-drag) */
  move(id: string, to: 'hide' | 'show'): Promise<{ ok: boolean; message?: string }>;
  /** macOS: Accessibility; Windows: the taskbar's settings */
  openSettings(): Promise<void>;
}
