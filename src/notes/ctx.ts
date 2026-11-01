// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What every part of the Notes page shares: the open vault, its files, and
// how to open, create and change notes.

import { createContext, useContext } from 'react';
import type { OpenVault } from '../../core/api-notes';
import type { VaultFile } from '../../core/notes/vault';

export interface NotesCtx {
  vault: OpenVault;
  files: VaultFile[];
  /** bumps when any file changed (for panels that read the index) */
  rev: number;
  open(path: string, opts?: { newTab?: boolean; split?: boolean; subpath?: string; mode?: 'reading' | 'live' | 'source' }): void;
  openLink(target: string, from: string, opts?: { newTab?: boolean; split?: boolean }): void;
  refresh(): Promise<void>;
  toast(text: string): void;
  activePath: string | null;
  /** search for a query in the search panel */
  search(q: string): void;
  rename(path: string): void;
}

export const Ctx = createContext<NotesCtx | null>(null);

export function useNotes(): NotesCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('Notes context missing');
  return c;
}

export const kindOf = (p: string): 'note' | 'canvas' | 'base' | 'image' | 'pdf' | 'audio' | 'video' | 'other' => {
  const e = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
  if (e === 'md') return 'note';
  if (e === 'canvas') return 'canvas';
  if (e === 'base') return 'base';
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'avif'].includes(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm', '3gp'].includes(e)) return 'audio';
  if (['mp4', 'mov', 'mkv', 'ogv'].includes(e)) return 'video';
  return 'other';
};

/** Recent files per vault, kept in this window. */
export function recentFiles(vault: string): string[] {
  try { return JSON.parse(localStorage.getItem(`notes.recent.${vault}`) ?? '[]') as string[]; } catch { return []; }
}

export function pushRecent(vault: string, path: string) {
  try {
    const list = [path, ...recentFiles(vault).filter((p) => p !== path)].slice(0, 50);
    localStorage.setItem(`notes.recent.${vault}`, JSON.stringify(list));
  } catch { /* storage unavailable */ }
}
