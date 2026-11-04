// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Extensions as the window sees them (core/extensions.ts has the rules).

import type { ExtManifest, ExtPermission, PermState } from './extensions';

export interface InstalledExtension extends ExtManifest {
  checksum: string;
  enabled: boolean;
  perms: Partial<Record<ExtPermission, PermState>>;
  /** each permission in plain words */
  lines: { id: ExtPermission; text: string }[];
  installed: number;
}

export interface ExtensionsApi {
  list(): Promise<InstalledExtension[]>;
  /** asks for a folder; null when cancelled */
  pick(): Promise<string | null>;
  /** what installing that folder would add, and what it may do (nothing is copied yet) */
  preview(dir: string): Promise<ExtManifest & { checksum: string; lines: { id: ExtPermission; text: string }[]; replaces: boolean }>;
  /** installs it; with `expected`, only when its fingerprint matches */
  install(dir: string, expected?: string): Promise<InstalledExtension>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, on: boolean): Promise<void>;
  setPermission(id: string, p: ExtPermission, v: PermState): Promise<void>;
  /** the worker's address (data:) for an installed, unchanged extension */
  worker(id: string): Promise<string>;
  /** names of matching files (permission: search) */
  search(id: string, query: string): Promise<string[]>;
  /** a page from a listed site (permission: network) */
  fetch(id: string, url: string): Promise<{ status: number; text: string }>;
}
