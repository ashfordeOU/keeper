// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The interface's view of wallpaper, vibes, ambient sound and folder icons
// (window.keeper.ambience). See electron/services/wallpaper/.

import type { AmbienceSettings, Vibe, VibeRule } from '../vibes';
import type { SoundMix } from './ambient';
import type { FolderIconRecord, FolderIconSpec } from './folder-icons';
import type { RenderPolicy } from './policy';
import type { NamedPalette, WallpaperSource, WallpaperStrategy } from './types';

export interface AmbienceDisplay {
  id: string;
  label: string;
  primary: boolean;
  width: number;
  height: number;
  scaleFactor: number;
  source: WallpaperSource;
  /** what the window on this display is doing right now */
  live: { strategy: WallpaperStrategy; running: boolean; fps: number; scale: number; reason?: string; error?: string } | null;
}

export interface AmbienceState {
  settings: AmbienceSettings;
  displays: AmbienceDisplay[];
  /** how the wallpaper reaches this desktop, and why */
  strategy: WallpaperStrategy;
  strategyNote: string;
  /** the vibe the schedule picks now, and why */
  scheduled: { vibe: string | null; rule: string | null };
  /** whether each feature switch is on */
  features: { wallpaper: boolean; vibes: boolean; ambientSound: boolean; folderIcons: boolean };
  /** what can be done on this system */
  caps: { live: boolean; still: boolean; folderIcons: boolean; folderIconsHow: string; lockScreen: string };
  platform: NodeJS.Platform;
}

export interface WallpaperCost {
  /** per display: renderer processor use (% of one core), frames drawn per second and average draw time */
  displays: { id: string; cpu: number; fps: number; frameMs: number; gpuMemoryKb?: number; running: boolean }[];
  /** the GPU process, shared by every Keeper window */
  gpuCpu: number;
  sampledMs: number;
}

/** What a wallpaper window is told to show. */
export interface WallpaperFrame {
  display: string;
  source: WallpaperSource;
  palette: NamedPalette;
  policy: RenderPolicy;
  /** a still frame is being captured: draw one frame at full quality, then stop */
  still?: boolean;
}

export interface AmbienceApi {
  state(): Promise<AmbienceState>;
  /** change any settings (wallpaper options, surfaces, shortcuts, sound, schedule); returns the new state */
  set(patch: Partial<AmbienceSettings>): Promise<AmbienceState>;
  /** choose the wallpaper for every display ('all') or one */
  setWallpaper(display: string | 'all', source: WallpaperSource): Promise<AmbienceState>;
  /** play or pause the live wallpaper */
  setPlaying(on: boolean): Promise<AmbienceState>;
  surprise(): Promise<AmbienceState>;
  /** switch to a vibe (cross-fading wallpaper and sound) */
  applyVibe(id: string): Promise<AmbienceState>;
  stepVibe(dir: 1 | -1): Promise<AmbienceState>;
  saveVibe(v: Vibe): Promise<AmbienceState>;
  removeVibe(id: string): Promise<AmbienceState>;
  /** a new vibe from what is on screen and playing now */
  captureVibe(name: string, emoji?: string): Promise<AmbienceState>;
  /** put the starter vibes back as they came */
  resetStarters(): Promise<AmbienceState>;
  saveRules(rules: VibeRule[]): Promise<AmbienceState>;
  savePalette(p: NamedPalette): Promise<AmbienceState>;
  removePalette(id: string): Promise<AmbienceState>;
  /** choose a video, picture or folder for the wallpaper */
  pickMedia(kind: 'video' | 'image' | 'folder'): Promise<string | null>;
  /** set the ordinary desktop picture to a still frame of the wallpaper now */
  setStill(): Promise<{ ok: boolean; path?: string; how?: string; error?: string }>;
  /** put back the desktop picture from before Keeper first changed it */
  restoreDesktop(): Promise<{ ok: boolean; error?: string }>;
  /** processor and GPU cost of the wallpaper, measured over a couple of seconds */
  cost(): Promise<WallpaperCost>;

  setMix(mix: SoundMix, master?: number): Promise<AmbienceState>;
  setSoundPlaying(on: boolean): Promise<AmbienceState>;
  /** stop the sound after this many minutes (0 or null clears the timer) */
  sleep(minutes: number | null): Promise<AmbienceState>;
  /** the floating sound mixer */
  openMixer(): Promise<void>;
  closeMixer(): Promise<void>;

  pickFolders(): Promise<string[]>;
  /** give folders an icon; `png` is the 512 px picture the interface drew */
  applyFolderIcon(folders: string[], spec: FolderIconSpec, png: string): Promise<{ done: string[]; failed: { folder: string; error: string }[] }>;
  restoreFolderIcon(folders: string[]): Promise<{ done: string[]; failed: { folder: string; error: string }[] }>;
  folderIcons(): Promise<FolderIconRecord[]>;

  /** the tray's Desktop & Vibes submenu as it is now (labels only) */
  trayPreview(): Promise<{ label?: string; checked?: boolean; enabled: boolean; submenu?: unknown[] }[]>;
  /** inside a wallpaper window: what to show */
  frame(): Promise<WallpaperFrame | null>;
  /** inside a wallpaper window: how fast it really draws (for the cost card) */
  report(stats: { fps: number; frameMs: number }): void;
  /** inside a wallpaper window: the first frame is on screen (for still capture) */
  ready(): void;
}
