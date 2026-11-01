// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Stage mode's write-ahead journal. Every change is written down (with the
// value it replaces) before it is made, and undone newest first when Stage
// ends, when Keeper starts again after a crash, or by the watchdog when
// Keeper's process disappears. A setting the person changed by hand while
// Stage was on is left as they set it.

import type { JournalEntry, StageJournal } from './types';
import { isValueTarget } from './targets';

export function newJournal(pid: number, preset: string, now = Date.now()): StageJournal {
  return { pid, startedAt: now, preset, entries: [] };
}

/** Adds a change as "pending" (before it is made). Returns its sequence number. */
export function addPending(j: StageJournal, e: Omit<JournalEntry, 'seq' | 'state' | 'at'>, now = Date.now()): number {
  const seq = j.entries.reduce((m, x) => Math.max(m, x.seq), 0) + 1;
  j.entries.push({ ...e, seq, state: 'pending', at: now });
  return seq;
}

export function markApplied(j: StageJournal, seq: number, patch: Partial<Pick<JournalEntry, 'target' | 'applied'>> = {}) {
  const e = j.entries.find((x) => x.seq === seq);
  if (e) Object.assign(e, patch, { state: 'applied' as const });
}

/** Drops a change that turned out not to be needed or failed before anything changed. */
export function dropEntry(j: StageJournal, seq: number) {
  j.entries = j.entries.filter((x) => x.seq !== seq);
}

/** Newest first. Pending changes are included: they may have happened before a crash. */
export function revertOrder(j: StageJournal): JournalEntry[] {
  return [...j.entries].sort((a, b) => b.seq - a.seq);
}

/**
 * What to do with one setting when putting things back, given its value now:
 *   restore  it still holds what Stage set: put the old value back
 *   already  it already holds the old value (the watchdog, or a crash before the change)
 *   left     the person changed it while Stage was on: leave it alone
 *   unknown  it could not be read: put the old value back only if Stage surely set it
 */
export function decide(e: JournalEntry, current: string | null): 'restore' | 'already' | 'left' | 'unknown' {
  if (!isValueTarget(e.target) || e.prior === undefined || e.applied === undefined) return 'restore';
  if (current === null) return 'unknown';
  if (current === e.prior) return 'already';
  if (current === e.applied) return 'restore';
  return 'left';
}

/** Parses a journal read from disk; anything malformed is ignored. */
export function parseJournal(text: string): StageJournal | null {
  try {
    const j = JSON.parse(text) as StageJournal;
    if (!j || typeof j !== 'object' || !Array.isArray(j.entries) || typeof j.pid !== 'number') return null;
    j.entries = j.entries.filter((e) => e && typeof e.seq === 'number' && e.target && typeof e.target === 'object' && typeof e.target.t === 'string');
    return j;
  } catch {
    return null;
  }
}

/** Two switches never change the same setting twice (the first one's old value is the real one). */
export function alreadyChanged(j: StageJournal, key: (e: JournalEntry) => string | null, k: string): boolean {
  return j.entries.some((e) => key(e) === k);
}
