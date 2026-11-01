// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A careful directory walker: never follows links, skips folders the user
// excluded and system bundles, and can be cancelled.

import { promises as fsp, type Dirent, type Stats } from 'node:fs';
import path from 'node:path';

export interface WalkEntry {
  path: string;
  name: string;
  dirent: Dirent;
  stats: Stats;
  depth: number;
}

export interface WalkOptions {
  /** return false to skip a folder (and everything below it) */
  enterDir?: (dir: string, name: string, depth: number) => boolean;
  /** called for every file (and for folders, when includeDirs is set) */
  onEntry: (e: WalkEntry) => void | Promise<void>;
  includeDirs?: boolean;
  showHidden?: boolean;
  maxDepth?: number;
  maxEntries?: number;
  excluded?: string[];
  signal?: AbortSignal;
  concurrency?: number;
  /** walk everything, including caches, packages and dependency folders */
  raw?: boolean;
}

/** Folders that are packages or machine-managed: listing them is slow and useless. */
export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '__pycache__', '.venv', 'venv', '.tox', '.gradle', '.idea', '.next', '.nuxt',
  '.cache', 'Caches', '.Trash', '$RECYCLE.BIN', 'System Volume Information', '.Spotlight-V100', '.fseventsd',
  '.DocumentRevisions-V100', '.TemporaryItems', 'Photos Library.photoslibrary', 'Music Library.musiclibrary',
]);

const PACKAGE_EXT = /\.(app|photoslibrary|musiclibrary|fcpbundle|imovielibrary|tvlibrary|xcarchive|bundle|framework|plugin|kext|lproj|xcodeproj|xcworkspace)$/i;

export function isPackageDir(name: string): boolean {
  return PACKAGE_EXT.test(name);
}

export async function walk(root: string, opts: WalkOptions): Promise<{ entries: number; truncated: boolean }> {
  const max = opts.maxEntries ?? Infinity;
  const excluded = (opts.excluded ?? []).map((p) => path.resolve(p).toLowerCase());
  let count = 0;
  let truncated = false;
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  const workers = Math.max(1, opts.concurrency ?? 8);

  const isExcluded = (p: string) => {
    const l = p.toLowerCase();
    return excluded.some((e) => l === e || l.startsWith(e + path.sep));
  };

  async function visit(dir: string, depth: number) {
    let list: Dirent[];
    try {
      list = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of list) {
      if (opts.signal?.aborted) return;
      if (count >= max) {
        truncated = true;
        return;
      }
      if (!opts.showHidden && d.name.startsWith('.')) continue;
      const p = path.join(dir, d.name);
      if (d.isSymbolicLink()) continue;
      if (isExcluded(p)) continue;
      if (d.isDirectory()) {
        const pkg = !opts.raw && isPackageDir(d.name);
        if (opts.includeDirs || pkg) {
          let stats: Stats;
          try {
            stats = await fsp.lstat(p);
          } catch {
            continue;
          }
          count++;
          await opts.onEntry({ path: p, name: d.name, dirent: d, stats, depth });
        }
        if (pkg || (!opts.raw && SKIP_DIRS.has(d.name))) continue;
        if (opts.maxDepth !== undefined && depth + 1 > opts.maxDepth) continue;
        if (opts.enterDir && !opts.enterDir(p, d.name, depth + 1)) continue;
        queue.push({ dir: p, depth: depth + 1 });
      } else if (d.isFile()) {
        let stats: Stats;
        try {
          stats = await fsp.lstat(p);
        } catch {
          continue;
        }
        count++;
        await opts.onEntry({ path: p, name: d.name, dirent: d, stats, depth });
      }
    }
  }

  let active = 0;
  await new Promise<void>((resolve) => {
    const pump = () => {
      if (opts.signal?.aborted || truncated) {
        if (active === 0) resolve();
        return;
      }
      while (active < workers && queue.length) {
        const next = queue.shift()!;
        active++;
        visit(next.dir, next.depth).finally(() => {
          active--;
          pump();
        });
      }
      if (active === 0 && queue.length === 0) resolve();
    };
    pump();
  });
  return { entries: count, truncated };
}

/** Total bytes and file count under a folder (does not follow links). */
export async function folderSize(dir: string, opts: { signal?: AbortSignal; keepNewerThan?: number; showHidden?: boolean } = {}): Promise<{ size: number; files: number }> {
  let size = 0;
  let files = 0;
  await walk(dir, {
    showHidden: opts.showHidden ?? true,
    signal: opts.signal,
    raw: true,
    onEntry: (e) => {
      if (!e.stats.isFile()) return;
      if (opts.keepNewerThan && Math.max(e.stats.mtimeMs, e.stats.birthtimeMs || 0) > opts.keepNewerThan) return;
      size += e.stats.size;
      files++;
    },
  });
  return { size, files };
}
