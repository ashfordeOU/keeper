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
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      const u = w.webContents.getURL();
      if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:permission-needed', { id, feature });
    }
  } catch {
    /* no windows (tests, early start) */
  }
  try { return fallbackPrompt(); } catch { return true; }
}
