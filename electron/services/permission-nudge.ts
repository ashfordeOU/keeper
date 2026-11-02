// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A feature needs a system permission now: the open Keeper windows show
// "Open Permissions" with that row highlighted (Settings → Permissions)
// instead of a surprise prompt in the middle of a task. Kept tiny (no store,
// no services) so any feature can import it.

import { BrowserWindow } from 'electron';

let fallbackPrompt: () => boolean = () => true;

/** Set by the Permissions IPC: whether the person skipped setting everything up (then the system's own question still shows). */
export function setPromptFallback(fn: () => boolean) {
  fallbackPrompt = fn;
}

/**
 * Points the person to the permission (by its id in core/permissions.ts).
 * Returns whether the caller should still show the system's own question:
 * only when the person did not choose "Set up everything now".
 */
export function permissionNeeded(id: string, feature?: string): boolean {
  let seen = false;
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      const u = w.webContents.getURL();
      const main = !u.includes('view=') || u.includes('view=app');
      // The main window, and the menu-bar pop-over, which shows a line of its own.
      if (main || u.includes('view=sysmon-popover')) w.webContents.send('event:permission-needed', { id, feature });
      if (main && w.isVisible() && !w.isMinimized()) seen = true;
    }
  } catch {
    /* no windows (tests, early start) */
  }
  // Keeper is in the menu bar with no window open (most of the day): the Island or a notification says it.
  if (!seen) try { elsewhere?.(id, feature); } catch { /* nothing else to tell */ }
  try { return fallbackPrompt(); } catch { return true; }
}

let elsewhere: ((id: string, feature?: string) => void) | null = null;
const lastElsewhere = new Map<string, number>();

/** How to reach the person when no Keeper window is open (set by the main process: the Island, else a notification). */
export function setNudgeElsewhere(fn: (id: string, feature?: string) => void) {
  elsewhere = (id, feature) => {
    if (Date.now() - (lastElsewhere.get(id) ?? 0) < 10 * 60_000) return;
    lastElsewhere.set(id, Date.now());
    fn(id, feature);
  };
}
