// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What Quick Search opened before, and how lately: things you open often and
// recently rise to the top. Each use adds one point that halves every two
// weeks, so last month's habit fades and this week's wins. Kept on this
// computer only (electron/services/launcher.ts writes it to a small file).

export interface UseRecord {
  /** points after decay, as of `at` */
  score: number;
  /** last use */
  at: number;
}

export type UseBook = Record<string, UseRecord>;

/** Points halve after this long. */
export const HALF_LIFE_MS = 14 * 86_400_000;
/** At most this many entries are kept; the weakest go first. */
export const MAX_ENTRIES = 500;

/** A record's points now. */
export function decayed(r: UseRecord | undefined, now: number): number {
  if (!r) return 0;
  const age = Math.max(0, now - r.at);
  return r.score * Math.pow(0.5, age / HALF_LIFE_MS);
}

/** Counts one use of `id` (returns a new book; the old one is left alone). */
export function recordUse(book: UseBook, id: string, now: number): UseBook {
  const next: UseBook = { ...book, [id]: { score: decayed(book[id], now) + 1, at: now } };
  const ids = Object.keys(next);
  if (ids.length <= MAX_ENTRIES) return next;
  ids.sort((a, b) => decayed(next[a], now) - decayed(next[b], now));
  for (const k of ids.slice(0, ids.length - MAX_ENTRIES)) delete next[k];
  return next;
}

/**
 * A bonus to add to a text match score: 0 for never used, about 3 for daily
 * use, at most 8, so a much better text match still wins over habit.
 */
export function useBonus(book: UseBook, id: string, now: number): number {
  const p = decayed(book[id], now);
  return p <= 0 ? 0 : Math.min(8, Math.log2(1 + p) * 2);
}

/** Reads a saved book, dropping anything malformed. */
export function cleanBook(raw: unknown): UseBook {
  const out: UseBook = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = v as Partial<UseRecord> | null;
    if (r && typeof r.score === 'number' && typeof r.at === 'number' && Number.isFinite(r.score) && Number.isFinite(r.at) && k.length < 2000) out[k] = { score: r.score, at: r.at };
  }
  return out;
}
