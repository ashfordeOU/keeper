// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reading aloud and the reading fonts (core/read-aloud.ts, core/a11y.ts).

import type { ReadingFont } from './a11y';

export interface ReadingApi {
  /** whether this computer has a voice to read with */
  voice(): Promise<{ ok: boolean; message?: string }>;
  /** reads the text aloud with the computer's own voice (speed 0.5 to 2); stops anything already reading */
  speak(text: string, speed?: number): Promise<{ ok: boolean; message?: string }>;
  stop(): Promise<void>;
  speaking(): Promise<boolean>;
  /** a reading font's files (fetched once, checked), for the window to load; null for the theme's own */
  font(id: ReadingFont): Promise<{ family: string; faces: { weight: number; data: string }[] } | null>;
}
