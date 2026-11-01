// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// How Chromium runs Keeper's windows, chosen before the app is ready (so a
// change in Settings → Performance applies from the next start).
//
//   • Every Keeper window (the main window, the Island, Quick Search, widgets,
//     cues…) shares one page process instead of one each (less memory for each
//     small window, and they open faster). Pages from elsewhere still get processes of their own.
//   • Minimal mode also draws without the graphics card: the graphics process
//     shrinks from about 60–80 MB to about 20 MB. A live wallpaper needs the
//     card, so while one plays the card stays in use; 3D previews say why they
//     cannot show.
//
// Measured and left out (no clear gain over the run-to-run spread, or a real cost):
// turning off more Chromium features (spare page process, back/forward cache,
// hints, media router, translate), --js-flags=--lite-mode (slower scripts for
// about 5 MB) and a smaller script heap limit (risks the page running out).

import { app } from 'electron';
import { ambience } from './services/wallpaper/store';
import { settings } from './store';

/** What applied at this start (the mode can change while Keeper runs; these wait for a restart). */
export const startedWith = { minimal: false, sharedPages: true };

export function applyPerfSwitches() {
  let mode = 'balanced';
  try {
    mode = settings().resourceMode ?? 'balanced';
  } catch {
    /* settings unreadable: the defaults */
  }
  // KEEPER_SEPARATE_PAGES=1 gives each window its own process again (for comparison and tests).
  if (process.env.KEEPER_SEPARATE_PAGES !== '1') app.commandLine.appendSwitch('process-per-site');
  else startedWith.sharedPages = false;
  if (mode !== 'minimal') return;
  startedWith.minimal = true;
  let liveWallpaper = false;
  try {
    liveWallpaper = ambience().wallpaper.enabled;
  } catch {
    /* no wallpaper settings */
  }
  if (!liveWallpaper) app.disableHardwareAcceleration();
}
