// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Folder boxes as the windows see them (core/folder-boxes.ts has the logic).

import type { BoxGroup, BoxItem, BoxSort, TidyPlan } from './folder-boxes';

export interface BoxesStatus {
  /** this computer's desktop folder */
  desktop: string;
  /** the system has no desktop layer for other apps (Wayland): boxes may float over windows */
  floats: boolean;
  tidyOffered: boolean;
}

export interface BoxesApi {
  status(): Promise<BoxesStatus>;
  /** what a box shows: its folder's files, sorted and filtered (only folders boxes show, and the desktop) */
  list(folder: string, sort?: BoxSort, show?: BoxGroup | 'all'): Promise<BoxItem[]>;
  open(path: string): Promise<boolean>;
  reveal(path: string): Promise<void>;
  /** what "Tidy my desktop into boxes" would move, without moving anything */
  planTidy(): Promise<TidyPlan>;
  /** moves the files as planned and adds a box for each folder; one step in History */
  tidy(): Promise<{ moved: number; boxes: number; journalId?: string }>;
}
