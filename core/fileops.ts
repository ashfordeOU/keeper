// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copying and moving files between folders, the way Finder and File Explorer
// do it: what clashes with a name already there, what cannot be done at all
// (a folder into itself), and a plain reason when the system says no.
// Plain functions so they are easy to test.

import path from 'node:path';

/** What to do when an item with the same name is already in the folder. */
export type ConflictChoice = 'replace' | 'keep' | 'skip';

export interface TransferOptions {
  /** what to do with a name already there ('keep' both by default) */
  conflict?: ConflictChoice;
  /** an id the renderer picks, so its progress events can be told apart */
  job?: string;
  /** the History entry's title */
  title?: string;
}

export interface TransferProgress {
  job?: string;
  op: 'copy' | 'move';
  done: number;
  total: number;
  name: string;
}

export interface TransferStep {
  from: string;
  /** where it would go (before any "keep both" renaming) */
  to: string;
  /** a reason it cannot be done at all */
  refuse?: string;
  /** already in that folder (a move there does nothing) */
  same?: boolean;
  /** an item with that name is already there */
  clash?: boolean;
}

/** true when b is a or inside it (on Windows and macOS, names ignore case). */
export function within(a: string, b: string, caseless = process.platform !== 'linux'): boolean {
  const norm = (p: string) => {
    const r = path.resolve(p);
    return caseless ? r.toLowerCase() : r;
  };
  const A = norm(a), B = norm(b);
  return B === A || B.startsWith(A.endsWith(path.sep) ? A : A + path.sep);
}

/** What copying or moving these items into dir would do, item by item. */
export function planTransfer(op: 'copy' | 'move', paths: string[], dir: string, exists: (p: string) => boolean): TransferStep[] {
  return paths.map((from) => {
    const to = path.join(dir, path.basename(from));
    if (within(from, dir)) return { from, to, refuse: `${path.basename(from)}: a folder can’t go inside itself` };
    const same = path.resolve(path.dirname(from)) === path.resolve(dir);
    if (same && op === 'move') return { from, to, same: true };
    // A copy into its own folder always keeps both ("name 2"), as in Finder.
    return { from, to, clash: !same && exists(to) };
  });
}

/** The names that clash, for the "replace, keep both or skip" question. */
export function clashes(steps: TransferStep[]): string[] {
  return steps.filter((s) => s.clash && !s.refuse).map((s) => path.basename(s.to));
}

/** A system error as people say it. */
export function transferError(e: unknown, op: 'copy' | 'move', dir: string): string {
  const code = (e as NodeJS.ErrnoException)?.code;
  const where = path.basename(dir) || dir;
  switch (code) {
    case 'EACCES':
    case 'EPERM': return `no permission to ${op === 'move' ? 'move it' : 'write'} ${op === 'move' ? `into “${where}” (or out of its folder)` : `in “${where}”`}`;
    case 'EROFS': return `“${where}” is read-only`;
    case 'ENOSPC': return `not enough free space in “${where}”`;
    case 'ENOENT': return 'it is no longer there';
    case 'EBUSY': return 'it is in use by another app';
    case 'ENAMETOOLONG': return 'the name is too long for that disk';
    case 'EXDEV': return 'it could not be moved to that disk';
    default: return e instanceof Error ? e.message : `could not be ${op === 'move' ? 'moved' : 'copied'}`;
  }
}
