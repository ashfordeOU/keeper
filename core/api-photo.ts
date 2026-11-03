// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The light photo editor as the window sees it (core/photo-edit.ts has the recipe).

import type { PhotoRecipe } from './photo-edit';

export interface PhotoInfo {
  path: string;
  name: string;
  /** the original's size, upright */
  width: number;
  height: number;
  /** bytes on disk now */
  size: number;
  /** saved over the original earlier: its recipe, so the sliders open where they were */
  edited?: { recipe: PhotoRecipe; savedAt: number; summary: string };
  /** removing the background: ready, the part to download first, or Convert is off */
  cutout: 'ready' | 'download' | 'off';
}

export interface PhotoApi {
  info(path: string): Promise<PhotoInfo>;
  /** the recipe on a smaller copy, as a data URL */
  preview(path: string, recipe: PhotoRecipe): Promise<{ url: string; width: number; height: number }>;
  /** 'replace' keeps the original for Revert (a new format always makes a copy); 'copy' writes "<name> (edited)" beside it */
  save(path: string, recipe: PhotoRecipe, mode: 'replace' | 'copy'): Promise<{ path: string; copy: boolean }>;
  /** the original back, as it was before the first save */
  revert(path: string): Promise<{ path: string; copy: boolean }>;
}
