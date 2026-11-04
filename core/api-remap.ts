// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mouse buttons and app shortcuts as the window sees them (core/input-remap.ts has the logic).

import type { MouseButton, RemapAvailability } from './input-remap';

export interface InputRemapStatus {
  availability: RemapAvailability;
  /** how Keeper hears the mouse now ("event tap", "mouse hook", "X11 raw button events"); empty: not listening */
  listening: string;
  /** why it is not listening, when it should be */
  note: string;
  /** the app in front, as Keeper sees it (to fill in a new app shortcut) */
  front: string;
  /** the last button heard, and what it sent */
  lastPress: { button: MouseButton; at: number; sent?: string } | null;
}

export interface InputRemapApi {
  status(): Promise<InputRemapStatus>;
  /** names of the apps open now, to pick from */
  runningApps(): Promise<string[]>;
  /** test hook (only with KEEPER_INPUT_TEST, never in official builds): a button pressed in the app in front */
  testPress?(button: MouseButton): Promise<InputRemapStatus['lastPress']>;
}
