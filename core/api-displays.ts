// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Displays as the window sees them (core/display-modes.ts has the logic).

import type { DisplayInfo } from './display-control';
import type { BrightnessSettings, DisplayPreset, ModeChoice, ScreenInfo } from './display-modes';

export interface DisplaysState {
  screens: ScreenInfo[];
  /** this computer cannot list or change modes here, and why, in plain words */
  note?: string;
  presets: DisplayPreset[];
  /** the preset made for the screens connected now, if any */
  presetForNow?: string;
  /** a change waits for Keep: when it switches back by itself */
  revertAt?: number;
  confirmSeconds: number;
}

export interface BrightnessState {
  settings: BrightnessSettings;
  /** the built-in screen's level now, where the system tells it */
  builtIn?: number;
  /** following the built-in screen works here (it has one, and its level can be read) */
  canFollow: boolean;
  followNote?: string;
  /** plugged-in monitors that answer over DDC/CI */
  monitors: DisplayInfo[];
  monitorsNote?: string;
}

export interface DisplaysApi {
  state(): Promise<DisplaysState>;
  /** switches one screen; it switches back unless keep() comes in time */
  setMode(screen: string, mode: ModeChoice): Promise<{ ok: boolean; message: string; revertAt?: number }>;
  keep(): Promise<DisplaysState>;
  revert(): Promise<DisplaysState>;
  savePreset(name: string): Promise<DisplaysState>;
  removePreset(id: string): Promise<DisplaysState>;
  applyPreset(id: string): Promise<{ ok: boolean; message: string; revertAt?: number }>;
  setPresetAuto(id: string, auto: boolean): Promise<DisplaysState>;
  brightness(): Promise<BrightnessState>;
  setBrightness(patch: Partial<BrightnessSettings>): Promise<BrightnessState>;
}
