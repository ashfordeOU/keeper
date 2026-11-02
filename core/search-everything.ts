// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One search box for everything Keeper holds: files first (searched by the
// library), then mail, events, tasks, contacts, notes, Keeper's own features
// and pages, and system settings. Each source answers on its own with a time
// limit, so a slow one never holds the rest back. Plain functions here; the
// sources are gathered in electron/ipc/search.ts.

export type EverythingKind = 'mail' | 'event' | 'task' | 'contact' | 'note' | 'feature' | 'setting';

export interface EverythingHit {
  kind: EverythingKind;
  id: string;
  title: string;
  detail?: string;
  /** a date to show (mail sent, event start, task due) */
  when?: number;
  /** the page that shows it, as "name:arg" (as keeper://… and event:navigate take it) */
  route: string;
}

export interface EverythingGroup { kind: EverythingKind; label: string; hits: EverythingHit[] }

export interface EverythingResult {
  groups: EverythingGroup[];
  /** sources that took too long or failed this time */
  missed: EverythingKind[];
}

/** The order groups show in, after files. */
export const EVERYTHING_ORDER: EverythingKind[] = ['mail', 'event', 'task', 'contact', 'note', 'feature', 'setting'];
export const EVERYTHING_LABEL: Record<EverythingKind, string> = {
  mail: 'Mail', event: 'Events', task: 'Tasks', contact: 'Contacts', note: 'Notes', feature: 'Keeper', setting: 'System settings',
};
export const EVERYTHING_ICON: Record<EverythingKind, string> = {
  mail: 'mail', event: 'calendar', task: 'listCheck', contact: 'agent', note: 'note', feature: 'settings', setting: 'settings',
};

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The words of a query (lower case, accents dropped). */
export function queryWords(q: string): string[] {
  return norm(q).split(/\s+/).filter(Boolean);
}

/** A score when every word appears in the text (more for the title, and for word starts); -1 otherwise. */
export function scoreText(words: string[], title: string, rest = ''): number {
  if (!words.length) return -1;
  const t = norm(title);
  const all = `${t} ${norm(rest)}`;
  let score = 0;
  for (const w of words) {
    if (!all.includes(w)) return -1;
    if (t.includes(w)) score += new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t) ? 4 : 2;
    else score += 1;
  }
  // The whole title typed: first.
  return t.trim() === words.join(' ') ? score + 10 : score;
}

/** The best matches of a list, best first, at most `limit`. */
export function best<T>(items: T[], words: string[], text: (t: T) => [string, string?], limit: number): T[] {
  const scored: [number, number, T][] = [];
  items.forEach((it, i) => {
    const [title, rest] = text(it);
    const s = scoreText(words, title, rest);
    if (s >= 0) scored.push([s, i, it]);
  });
  return scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, limit).map((x) => x[2]);
}

/** Groups in the fixed order, leaving out empty ones. */
export function groupHits(hits: EverythingHit[]): EverythingGroup[] {
  return EVERYTHING_ORDER.map((kind) => ({ kind, label: EVERYTHING_LABEL[kind], hits: hits.filter((h) => h.kind === kind) })).filter((g) => g.hits.length);
}

/** Resolves with the value, or with undefined after ms (the source is then reported as missed). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(undefined); });
  });
}
