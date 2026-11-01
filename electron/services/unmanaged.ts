// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's overlays and floating windows (the Island, pop-overs, the voice
// pill, cues, the launcher, Stage's overlays, widgets, Quick Connect) are not
// ordinary windows, and window arrangers must leave them alone: tilers that
// work through Accessibility (Monorail and others) manage only windows whose
// subrole is AXStandardWindow, FancyZones skips tool windows, and i3 and
// similar float toolbar windows.
//
//   macOS    an NSPanel (type 'panel': a floating, non-activating subrole), hidden
//            from Mission Control, never minimisable or full-screen
//   Windows  a tool window (type 'toolbar'): not in Alt-Tab or the taskbar
//   Linux    _NET_WM_WINDOW_TYPE_TOOLBAR, which tiling window managers float
//
// Each kind also keeps a fixed title (pages cannot change it), which Monorail's
// float rules match (core/ashforde/monorail.ts, OVERLAY_RULES).

import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { OVERLAY_TITLES, type OverlayKind } from '../../core/ashforde/monorail';

export type { OverlayKind };

/**
 * Options for a new overlay window. `panel: false` keeps an ordinary window type
 * where the window already has its own (the desktop-level wallpaper, a Linux
 * desktop widget), and only adds the title and the rest.
 */
export function overlayOptions(kind: OverlayKind, o: { panel?: boolean } = {}): BrowserWindowConstructorOptions {
  const panel = o.panel !== false;
  const type = !panel ? undefined : process.platform === 'darwin' ? 'panel' : 'toolbar';
  return {
    title: OVERLAY_TITLES[kind],
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    ...(type ? { type } : {}),
  };
}

/** After creation: the title stays fixed, and macOS leaves it out of Mission Control. */
export function keepUnmanaged(win: BrowserWindow, kind: OverlayKind) {
  const title = OVERLAY_TITLES[kind];
  win.on('page-title-updated', (e) => e.preventDefault());
  win.setTitle(title);
  if (process.platform === 'darwin') {
    try { win.setHiddenInMissionControl(true); } catch { /* older Electron */ }
  }
}
