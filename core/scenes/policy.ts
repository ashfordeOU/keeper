// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// When the live wallpaper may draw, how often and how sharply, and how it
// reaches the desktop on each system. Pure, so the rules are tested; the main
// process feeds them the governor's conditions (electron/services/governor.ts).

import type { Conditions } from '../governor';
import type { FrameRate, Quality, WallpaperSettings, WallpaperSource, WallpaperStrategy } from './types';

export interface RenderPolicy {
  /** draw at all */
  run: boolean;
  /** frames per second while running (video plays at its own rate; this caps scenes) */
  fps: number;
  /** fraction of the display's pixels drawn (the picture is scaled up) */
  scale: number;
  /** plain-English reason when paused or reduced */
  reason?: string;
}

export interface CoverState {
  /** the app in front is in full screen */
  fullscreen: boolean;
  /** no part of this display's desktop is visible (Chromium's occlusion tracking reports this to the renderer too) */
  occluded?: boolean;
}

const QUALITY_SCALE: Record<Quality, number> = { efficient: 0.5, balanced: 0.75, full: 1 };

/**
 * The wallpaper renders only when someone can see it: never while asleep or
 * locked, and not under a full-screen app, on battery or in low power mode when
 * the person asked for that. On battery without pausing it saves energy:
 * half the frame rate (at most 30) at half the resolution.
 */
export function renderPolicy(s: Pick<WallpaperSettings, 'enabled' | 'fps' | 'quality' | 'pauseOnBattery' | 'saveOnBattery' | 'pauseInFullscreen' | 'pauseOnLowPower'>, c: Conditions, cover: CoverState, held = false): RenderPolicy {
  const off = (reason: string): RenderPolicy => ({ run: false, fps: 0, scale: QUALITY_SCALE[s.quality] ?? 0.75, reason });
  if (!s.enabled) return off('Paused by you');
  if (held) return off('All background work is stopped (Keeper’s processes)');
  if (c.suspended) return off('The computer is asleep');
  if (c.locked) return off('The screen is locked');
  if (cover.fullscreen && s.pauseInFullscreen) return off('An app is in full screen');
  if (cover.occluded) return off('The desktop is covered');
  if (c.thermal === 'critical' || c.thermal === 'serious') return off('The computer is running hot');
  if (c.lowPower && s.pauseOnLowPower) return off('Low power mode is on');
  if (c.onBattery && s.pauseOnBattery) return off('On battery');
  let fps: number = s.fps;
  let scale = QUALITY_SCALE[s.quality] ?? 0.75;
  let reason: string | undefined;
  if (c.mode === 'minimal') { fps = Math.min(fps, 15); scale = Math.min(scale, 0.5); reason = 'Minimal resource mode'; }
  if ((c.onBattery || c.lowPower) && s.saveOnBattery) {
    fps = Math.min(30, Math.max(10, Math.round(fps / 2)));
    scale = Math.min(scale, 0.5);
    reason = c.lowPower ? 'Saving energy (low power mode)' : 'Saving energy on battery';
  }
  // Nobody at the keyboard for a while: a slower, still pleasant drift.
  if (c.idleSec >= 300 && c.mode !== 'performance') { fps = Math.min(fps, 15); reason ??= 'Slower while you are away'; }
  return { run: true, fps, scale, reason };
}

export interface PlatformEnv {
  platform: NodeJS.Platform;
  /** XDG_SESSION_TYPE */
  sessionType?: string;
  /** Keeper itself runs through XWayland (Settings → Island can choose that) */
  ozoneX11?: boolean;
  /** WAYLAND_DISPLAY is set */
  waylandDisplay?: boolean;
  /** an X display is reachable */
  x11Display?: boolean;
}

/** How the wallpaper reaches the desktop here, before any attempt (a failed attempt falls back to still). */
export function strategyFor(env: PlatformEnv, forceStill = false): WallpaperStrategy {
  if (env.platform === 'darwin') return forceStill ? 'still' : 'desktop-window';
  if (env.platform === 'win32') return forceStill ? 'still' : 'workerw';
  if (env.platform === 'linux') {
    const wayland = env.sessionType === 'wayland' || (!!env.waylandDisplay && env.sessionType !== 'x11');
    // Wayland compositors give ordinary apps no desktop layer (GNOME needs an extension, KDE a plugin):
    // a still frame through the desktop portal or the desktop's own setting instead.
    if (wayland) return 'still';
    if (!env.x11Display) return 'still';
    return forceStill ? 'still' : 'desktop-window';
  }
  return 'off';
}

/** How often a still-frame wallpaper is refreshed (it is a picture, so rarely: a scene slowly changes). */
export function stillRefreshMs(src: WallpaperSource): number | null {
  if (src.kind === 'scene') return 30 * 60_000;
  if (src.kind === 'folder') return Math.max(60_000, src.interval * 1000);
  return null;
}

/** Frame interval for a rate, in ms. */
export function frameInterval(fps: number): number {
  return fps > 0 ? 1000 / fps : Infinity;
}

export const FRAME_RATES: FrameRate[] = [15, 24, 30, 60];
