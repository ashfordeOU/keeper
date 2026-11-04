// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One attention model for all of Keeper. The Fix-it List owns it: every page
// that wants to say "this is worth doing" (Home, Privacy & Security, Health)
// shows the top of the same ranked list, in the same calm words, and links to
// the Fix-it List for the rest. No page has its own severities, red rings or
// alarms. Scores, engine names and IDs are details, one click away.

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Three calm levels instead of five alarm colours. */
export type Calm = 'worth' | 'soon' | 'fyi';

export const CALM_WORD: Record<Calm, string> = {
  worth: 'Worth fixing',
  soon: 'When you have time',
  fyi: 'Good to know',
};

export function calmOf(s: Severity | string): Calm {
  return s === 'critical' || s === 'high' ? 'worth' : s === 'medium' ? 'soon' : 'fyi';
}

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export interface AttentionFinding {
  id: string;
  title: string;
  severity: Severity | string;
  why?: string;
  area?: string;
  source?: string;
  impactBytes?: number;
  status?: string;
}

export interface AttentionItem {
  id: string;
  title: string;
  why: string;
  calm: Calm;
  area?: string;
  source?: string;
}

/**
 * The ranked list every page reads: open items only, the most worth doing
 * first; among equals, what frees the most space, then by title. Items that
 * are only "good to know" are left out unless `all` is set.
 */
export function rankAttention(list: AttentionFinding[], o: { all?: boolean; areas?: string[]; sources?: string[] } = {}): AttentionItem[] {
  return list
    .filter((f) => (f.status ?? 'open') === 'open')
    .filter((f) => o.all || calmOf(f.severity) !== 'fyi')
    .filter((f) => !o.areas || o.areas.includes(f.area ?? ''))
    .filter((f) => !o.sources || o.sources.includes(f.source ?? ''))
    .sort((a, b) => (RANK[a.severity] ?? 5) - (RANK[b.severity] ?? 5) || (b.impactBytes ?? 0) - (a.impactBytes ?? 0) || a.title.localeCompare(b.title))
    .map((f) => ({ id: f.id, title: f.title, why: f.why ?? '', calm: calmOf(f.severity), area: f.area, source: f.source }));
}

/** "3 things worth fixing", "1 thing worth fixing", "Nothing worth fixing". */
export function worthLine(n: number): string {
  return n <= 0 ? 'Nothing worth fixing' : `${n} thing${n === 1 ? '' : 's'} worth fixing`;
}

/** At most this many items on a page that is not the Fix-it List. */
export const PAGE_LIMIT: Record<'home' | 'privacy' | 'health', number> = { home: 1, privacy: 3, health: 1 };

/** The slice a page shows, and how many more the Fix-it List holds. */
export function pageSlice(items: AttentionItem[], page: keyof typeof PAGE_LIMIT): { shown: AttentionItem[]; more: number } {
  const n = PAGE_LIMIT[page];
  return { shown: items.slice(0, n), more: Math.max(0, items.length - n) };
}

/**
 * A score is a detail, never a headline: a calm word for it, with no
 * "at risk" or "danger". The number itself is shown small, beside the word.
 */
export function calmScore(score: number): string {
  return score >= 90 ? 'Well protected' : score >= 70 ? 'A few things to look at' : 'Some things to look at';
}
