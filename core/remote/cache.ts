// SPDX-License-Identifier: AGPL-3.0-or-later
// The download cache for files opened from connections: kept under a size
// limit by removing what was used longest ago. Files kept offline on purpose
// and files open right now are never removed.

export interface CachedFile {
  path: string;
  size: number;
  /** last used, ms since epoch */
  used: number;
}

/** Which files to remove so the total fits in `limit` bytes, oldest use first. */
export function evictionPlan(files: CachedFile[], limit: number, keep: (p: string) => boolean = () => false): string[] {
  let total = files.reduce((n, f) => n + f.size, 0);
  if (total <= limit) return [];
  const out: string[] = [];
  for (const f of [...files].sort((a, b) => a.used - b.used)) {
    if (total <= limit) break;
    if (keep(f.path)) continue;
    out.push(f.path);
    total -= f.size;
  }
  return out;
}

/** A stable cache key for a remote file: connection, path, size and date, so a changed file is fetched again. */
export function cacheKey(id: string, p: string, size: number, mtime: number): string {
  let h = 2166136261;
  for (const ch of `${id}\u0000${p}\u0000${size}\u0000${Math.floor(mtime / 1000)}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}
