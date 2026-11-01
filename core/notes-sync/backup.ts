// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Versioned snapshots of the hub: each snapshot is a list of files and the
// hash of their contents; the contents are stored once however many
// snapshots share them. Which snapshots to keep follows the same rule as
// Keeper's backups (core/sync/backup.ts).

import { keepSnapshots, type RetentionPolicy } from '../sync/backup';

export interface SnapshotManifest {
  id: string;
  time: number;
  label?: string;
  /** hub-relative path → content hash */
  files: Record<string, string>;
}

export const NOTES_RETENTION: RetentionPolicy = { last: 5, daily: 14, weekly: 8, monthly: 12, yearly: 3 };

export function snapshotId(t: number): string {
  return 'snap-' + new Date(t).toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', '');
}

/** What changed between two snapshots. */
export function diffManifests(older: SnapshotManifest | undefined, newer: SnapshotManifest): { added: string[]; changed: string[]; removed: string[] } {
  const a = older?.files ?? {};
  const b = newer.files;
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [k, h] of Object.entries(b)) if (!(k in a)) added.push(k); else if (a[k] !== h) changed.push(k);
  for (const k of Object.keys(a)) if (!(k in b)) removed.push(k);
  return { added, changed, removed };
}

/** Is the hub different from the last snapshot? */
export function needsSnapshot(last: SnapshotManifest | undefined, files: Record<string, string>): boolean {
  if (!last) return Object.keys(files).length > 0;
  const d = diffManifests(last, { id: '', time: 0, files });
  return d.added.length + d.changed.length + d.removed.length > 0;
}

/** Snapshots to delete under the retention rule, and content hashes no snapshot needs any more. */
export function pruneSnapshots(all: SnapshotManifest[], policy: RetentionPolicy = NOTES_RETENTION): { drop: string[]; orphans: (have: Iterable<string>) => string[] } {
  const keep = keepSnapshots(all.map((s) => ({ id: s.id, time: s.time })), policy);
  const drop = all.filter((s) => !keep.has(s.id)).map((s) => s.id);
  const used = new Set<string>();
  for (const s of all) if (keep.has(s.id)) for (const h of Object.values(s.files)) used.add(h);
  return { drop, orphans: (have) => [...have].filter((h) => !used.has(h)) };
}
