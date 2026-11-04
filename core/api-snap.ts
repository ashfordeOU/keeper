// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Snap windows as the window sees it (core/snap.ts has the logic).

import type { SnapAction, SnapAvailability, SnapLayout } from './snap';

export interface SnapStatus {
  availability: SnapAvailability;
  layouts: SnapLayout[];
  /** this set of screens: its key and its plain name ("Docked") */
  screens: { key: string; name: string; count: number };
  /** shortcuts another app already holds, by action */
  taken: Partial<Record<SnapAction, string>>;
}

export interface SnapApi {
  status(): Promise<SnapStatus>;
  /** snaps the window in front (the shortcuts call the same) */
  run(action: SnapAction): Promise<{ ok: boolean; message?: string }>;
  /** keeps how the windows sit now, named (empty: after the screens) */
  saveLayout(name: string): Promise<SnapStatus>;
  restoreLayout(id: string): Promise<{ moved: number; missing: string[] }>;
  renameLayout(id: string, name: string): Promise<SnapStatus>;
  removeLayout(id: string): Promise<SnapStatus>;
  /** opens the system's page for the permission snapping needs */
  openPermission(): Promise<void>;
}
