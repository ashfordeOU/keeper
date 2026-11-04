// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Modes as the window sees them (core/modes.ts has the logic; electron/services/modes.ts applies them).

import type { ModeChoice, ModePreview, ModeSession, ModeState } from './modes';

export interface ModesApi {
  /** what switching would change, before anything changes */
  preview(to: ModeChoice): Promise<ModePreview>;
  /** switch: the person's changes in the mode they leave are kept for it */
  switch(to: ModeChoice): Promise<ModeState>;
  /** the mode as it comes: the person's changes in it are dropped */
  reset(): Promise<ModeState>;
  /** Focus for a number of minutes over any mode: notices wait, the timer runs, and it ends by itself */
  focus(minutes: number): Promise<ModeSession>;
  endFocus(): Promise<void>;
}
