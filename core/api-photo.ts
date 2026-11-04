// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The photo editor as the window sees it (core/photo-edit.ts has the recipe).

import type { CutoutModelId } from './cutout-models';
import type { PhotoRecipe } from './photo-edit';
import type { SaveFormat } from './photo-formats';
import type { Look } from './photo-presets';

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
  /** which cut-out models are downloaded */
  models: Record<CutoutModelId, boolean>;
  /** how it was opened: sharp, system, embedded (a RAW file's own preview), heif, psd, svg… */
  via: string;
  /** a plain sentence when the picture is not shown as it is (a RAW preview, a flattened Photoshop file) */
  note?: string;
  /** frames of a moving picture */
  frames?: number;
  /** it has see-through parts */
  alpha: boolean;
  /** its details say where it was taken */
  hasLocation: boolean;
  /** formats this computer can save, and why not where it cannot */
  formats: { id: SaveFormat; ok: boolean; why?: string }[];
}

export interface RecentPicture { path: string; name: string; at: number }

export interface PhotoApi {
  info(path: string): Promise<PhotoInfo>;
  /** the recipe on a smaller copy, as a data URL (things added on top are drawn by the window); `before` shows the same framing without the edits */
  preview(path: string, recipe: PhotoRecipe, o?: { before?: boolean }): Promise<{ url: string; width: number; height: number }>;
  /** 'replace' keeps the original for Revert (a new format always makes a copy); 'copy' writes "<name> (edited)" beside it */
  save(path: string, recipe: PhotoRecipe, mode: 'replace' | 'copy'): Promise<{ path: string; copy: boolean }>;
  /** the original back, as it was before the first save */
  revert(path: string): Promise<{ path: string; copy: boolean }>;
  /** light, contrast, colour and white balance suggested for this picture */
  auto(path: string, recipe: PhotoRecipe): Promise<Partial<PhotoRecipe>>;
  /** the person's own looks */
  looks(): Promise<Look[]>;
  saveLook(name: string, recipe: PhotoRecipe): Promise<Look[]>;
  deleteLook(id: string): Promise<Look[]>;
  /** downloads a cut-out model (progress arrives as task 'photo-model') */
  downloadModel(id: CutoutModelId): Promise<void>;
  removeModel(id: CutoutModelId): Promise<void>;
  /** pictures opened lately, newest first (only those still there) */
  recent(): Promise<RecentPicture[]>;
}
