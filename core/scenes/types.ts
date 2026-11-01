// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What a live wallpaper shows: a scene drawn in code, the person's own video,
// picture, folder of pictures, or a web page.

export type SceneCategory = 'Atmosphere' | 'Fluid' | 'Geometry' | 'Weather' | 'Light' | 'Life';

/** Four colours, darkest to brightest, that recolour a scene (and tint widgets). */
export type Palette = [string, string, string, string];

export interface NamedPalette {
  id: string;
  name: string;
  colors: Palette;
  /** made by the person (from a photo or by hand) */
  custom?: boolean;
}

/** The controls every scene has. All 0..1 except speed (0..3) and scale (0.25..4). */
export interface SceneParams {
  speed: number;
  intensity: number;
  scale: number;
  grain: number;
  vignette: number;
  /** a number that changes the look without changing the scene ("Shuffle") */
  seed: number;
}

export type ImageMotion = 'still' | 'drift' | 'breathe';

export type WallpaperSource =
  | { kind: 'none' }
  | { kind: 'scene'; scene: string; palette: string; params: SceneParams }
  | { kind: 'video'; path: string; muted: true; rate?: number }
  | { kind: 'image'; path: string; motion: ImageMotion }
  | { kind: 'folder'; path: string; interval: number; motion: ImageMotion; shuffle: boolean }
  | { kind: 'web'; url: string };

export type WallpaperKind = WallpaperSource['kind'];

/**
 * How the wallpaper reaches the desktop on this computer:
 *  desktop-window  a window at desktop level, behind the icons (macOS, Linux X11)
 *  workerw         a window placed inside the Windows desktop behind the icons
 *  still           a still frame set as the ordinary desktop picture (Wayland, or a fallback)
 *  off             nothing can be shown
 */
export type WallpaperStrategy = 'desktop-window' | 'workerw' | 'still' | 'off';

export type FrameRate = 15 | 24 | 30 | 60;
export type Quality = 'efficient' | 'balanced' | 'full';

export interface WallpaperSettings {
  /** show the live wallpaper (the feature switch is separate; this is "playing") */
  enabled: boolean;
  /** used on every display that has no choice of its own */
  default: WallpaperSource;
  /** display id → its own wallpaper ('none' leaves that display alone) */
  perDisplay: Record<string, WallpaperSource>;
  fps: FrameRate;
  quality: Quality;
  pauseOnBattery: boolean;
  /** on battery but not paused: half the frame rate at half resolution */
  saveOnBattery: boolean;
  pauseInFullscreen: boolean;
  pauseOnLowPower: boolean;
  /** also set the ordinary desktop picture (and so the lock screen, where it follows) to a still frame */
  matchDesktopPicture: boolean;
  /** never use a live window; always set a still frame (for systems where it misbehaves) */
  forceStill: boolean;
}
