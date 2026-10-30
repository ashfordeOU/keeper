// SPDX-License-Identifier: AGPL-3.0-or-later
// The preview contract between the viewer and the main process.

import type { ArchiveEntry } from './archive';
import type { ExifDetails } from './exifDetails';
import type { PreviewKind } from './previewKind';

export interface PreviewInfo {
  path: string;
  name: string;
  ext: string;
  size: number;
  mtime: number;
  btime: number;
  isDir: boolean;
  kind: PreviewKind;
  /** "PNG image", "Matroska / WebM video" */
  format: string;
  mime: string;
  /** keeper-file:// address the viewer loads the file from */
  url: string;
  /** Chromium can play this video/audio as-is */
  playable?: boolean;
  exif?: ExifDetails;
  audio?: { title?: string; artist?: string; album?: string; year?: string; genre?: string; track?: string; cover?: string };
  app?: Record<string, string>;
  folder?: { files: number; folders: number; size: number; kinds: Record<string, number>; images: string[]; truncated: boolean };
}

export interface DisplayImage {
  path: string;
  url: string;
  width?: number;
  height?: number;
  /** how it was decoded: 'embedded preview', 'system', 'built-in HEIC decoder'… */
  via: string;
}

export interface PreviewApi {
  info(path: string): Promise<PreviewInfo>;
  text(path: string, maxBytes?: number): Promise<{ text: string; encoding: string; truncated: boolean; size: number }>;
  /** base64 bytes */
  bytes(path: string, offset?: number, length?: number): Promise<string>;
  archive(path: string): Promise<{ entries: ArchiveEntry[]; note?: string }>;
  /** unpacks one entry to a private temp folder and returns its path */
  extract(path: string, entry: string): Promise<string>;
  /** converts unplayable video/audio; returns a keeper-file URL */
  transcode(path: string, audioOnly?: boolean): Promise<string>;
  filmstrip(path: string, count?: number): Promise<string[]>;
  /** HEIC, RAW, PSD, JPEG XL, TGA, EXR… as a JPEG/PNG the viewer can show */
  image(path: string, maxSide?: number): Promise<DisplayImage | null>;
  /** caches a thumbnail the viewer rendered itself (PDF pages, fonts) */
  storeThumb(path: string, size: number, dataUrl: string): Promise<boolean>;
  /** keeper-file:// address of a file */
  url(path: string): string;
}
