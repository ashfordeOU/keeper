// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Home's layout and its one-line suggestion: which sections show and in what
// order (Edit Home), how roomy it is, the Library style, the move of older
// Home settings onto the current sections, and what, if anything, is worth
// doing now. Plain functions so they are easy to test.

import { calmOf } from './attention';

/**
 * folders: the front door, Desktop, Documents and Downloads as big tiles;
 * search: a search box, with the file types (Documents, Pictures…) under it;
 * suggestions: one line when something is worth doing (low space, a finding on To do);
 * jump: recent files grouped by the project or folder they belong to;
 * today: what now? Now and next, the top three tasks, mail to answer, the Inbox,
 *        one Fix-it item and Focus (core/today.ts), at the top of Hello since version 4.
 */
export type HomeSectionId = 'folders' | 'suggestions' | 'jump' | 'search' | 'today' | 'library' | 'pinned' | 'weather' | 'usage';
export type HomeDensity = 'comfortable' | 'compact' | 'spacious';

/** Bumped when the sections change; older settings are moved on by normalizeHome. */
export const HOME_LAYOUT_VERSION = 4;

export interface HomeSettings {
  v: number;
  /** every section, in the person's order */
  order: HomeSectionId[];
  hidden: HomeSectionId[];
  density: HomeDensity;
  /** the Library as tiles with counts, or a row of small chips */
  library: 'tiles' | 'chips';
}

export const HOME_SECTIONS: { id: HomeSectionId; name: string; description: string }[] = [
  { id: 'today', name: 'Today', description: 'What now: events, your top three tasks, mail to answer and the Inbox.' },
  { id: 'folders', name: 'Your folders', description: 'Desktop, Documents and Downloads as big tiles, with how much is in each.' },
  { id: 'suggestions', name: 'Suggestions', description: 'One line, only when something is worth doing: low space or a finding on the Fix-it List.' },
  { id: 'jump', name: 'Jump back in', description: 'Recent files, grouped by the project or folder they belong to.' },
  { id: 'search', name: 'Find a file', description: 'A search box, and Documents, Pictures and the other types under it.' },
  { id: 'library', name: 'By type', description: 'Pictures, Videos, Documents and so on as tiles, with counts.' },
  { id: 'pinned', name: 'Pinned folders', description: 'Folders you pinned to Favorites.' },
  { id: 'weather', name: 'Weather', description: 'The full forecast card (the header always has a small chip).' },
  { id: 'usage', name: 'Storage', description: 'How the disk is used, by kind of file.' },
];

export const HOME_DENSITIES: { id: HomeDensity; label: string }[] = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact', label: 'Compact' },
  { id: 'spacious', label: 'Spacious' },
];

/** How many recent files Jump back in reads to find the groups (one quick query). */
export const RECENT_READ = 60;

const IDS = HOME_SECTIONS.map((s) => s.id);
const isId = (s: unknown): s is HomeSectionId => IDS.includes(s as HomeSectionId);

export function defaultHomeSettings(): HomeSettings {
  return { v: HOME_LAYOUT_VERSION, order: [...IDS], hidden: ['library', 'weather', 'usage'], density: 'comfortable', library: 'tiles' };
}

/** Sections of the first Home (before Jump back in and Today) and what they became. */
const RENAMED: Record<string, HomeSectionId> = { attention: 'suggestions', recent: 'jump', calendar: 'today' };

/**
 * Settings from the first Home: Attention becomes Suggestions, Recent becomes
 * Jump back in and Calendar today becomes the Today column, in the same place.
 * Today is shown (it was off by default before); what else was hidden stays
 * hidden; the order is kept; the Library moves to tiles, its new default.
 */
export function migrateHome(x: Record<string, unknown>): Record<string, unknown> {
  const map = (a: unknown): HomeSectionId[] => (Array.isArray(a) ? a.map((s) => (typeof s === 'string' ? RENAMED[s] ?? s : s)).filter(isId) : []);
  const order = [...new Set(map(x.order))];
  // Today follows Jump back in when Calendar today was not in the list.
  if (!order.includes('today')) order.splice(order.includes('jump') ? order.indexOf('jump') + 1 : order.length, 0, 'today');
  const hidden = Array.isArray(x.hidden) ? map(x.hidden).filter((id) => id !== 'today') : undefined;
  return { v: 2, order, hidden, density: x.density, library: 'tiles' };
}

/**
 * Home as the front door (version 3): Your folders comes first and Find a file
 * follows Jump back in; the type tiles (once "Library") step back, since the
 * same types sit under the search box. The rest of the order and what was
 * hidden stay as the person left them.
 */
export function migrateHomeV3(x: Record<string, unknown>): Record<string, unknown> {
  const order = (Array.isArray(x.order) ? x.order : []).filter((s): s is HomeSectionId => isId(s) && s !== 'folders' && s !== 'search');
  order.unshift('folders');
  const j = order.indexOf('jump');
  order.splice(j < 0 ? 1 : j + 1, 0, 'search');
  const hidden = Array.isArray(x.hidden) ? [...new Set([...x.hidden.filter(isId), 'library' as HomeSectionId])] : undefined;
  return { ...x, v: 3, order, hidden };
}

/**
 * Today as the top of Hello (version 4): Today moves to the top, where it
 * answers "what now?", and files follow under it. If the person had hidden
 * Today, it stays hidden; the rest of the order is kept.
 */
export function migrateHomeV4(x: Record<string, unknown>): Record<string, unknown> {
  const order = (Array.isArray(x.order) ? x.order : []).filter((s): s is HomeSectionId => isId(s) && s !== 'today');
  return { ...x, v: HOME_LAYOUT_VERSION, order: ['today', ...order] };
}

/** Bad or old values fall back; older layouts are moved on; sections added later join at the end. */
export function normalizeHome(v: unknown): HomeSettings {
  const d = defaultHomeSettings();
  if (!v || typeof v !== 'object') return d;
  let x = v as Record<string, unknown>;
  if (x.v !== HOME_LAYOUT_VERSION && x.v !== 2 && x.v !== 3) x = migrateHome(x);
  if (x.v === 2) x = migrateHomeV3(x);
  if (x.v === 3) x = migrateHomeV4(x);
  const known = (a: unknown): HomeSectionId[] => (Array.isArray(a) ? a.filter(isId) : []);
  const order = [...new Set(known(x.order))];
  for (const id of IDS) if (!order.includes(id)) order.push(id);
  return {
    v: HOME_LAYOUT_VERSION,
    order,
    hidden: Array.isArray(x.hidden) ? [...new Set(known(x.hidden))] : d.hidden,
    density: HOME_DENSITIES.some((o) => o.id === x.density) ? (x.density as HomeDensity) : d.density,
    library: x.library === 'chips' ? 'chips' : 'tiles',
  };
}

/** The sections Home draws, in order. */
export function visibleSections(h: HomeSettings): HomeSectionId[] {
  return h.order.filter((id) => !h.hidden.includes(id));
}

/** Moves a section one place up (-1) or down (1). */
export function moveSection(h: HomeSettings, id: HomeSectionId, by: -1 | 1): HomeSettings {
  const i = h.order.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= h.order.length) return h;
  const order = [...h.order];
  [order[i], order[j]] = [order[j], order[i]];
  return { ...h, order };
}

export function setSectionShown(h: HomeSettings, id: HomeSectionId, shown: boolean): HomeSettings {
  return { ...h, hidden: shown ? h.hidden.filter((x) => x !== id) : [...new Set([...h.hidden, id])] };
}

/**
 * The sections Hello draws, in the person's order. Today is part of the page
 * (its top, by default), not a column beside it, so a wide and a narrow window
 * read the same way down; only the cards inside Today sit side by side.
 * The Suggestions line steps aside while Today shows its own Fix-it card.
 */
export function homeSections(h: HomeSettings, todayHasFixit: boolean): HomeSectionId[] {
  const shown = visibleSections(h);
  return todayHasFixit && shown.includes('today') ? shown.filter((id) => id !== 'suggestions') : shown;
}

// ---------------------------------------------------------------- the suggestion line

export interface AttentionInput {
  disk?: { free: number; total: number; label?: string };
  /** open findings on To do, most important first */
  findings?: { id: string; title: string; severity: string; why?: string; area?: string }[];
}

export interface Attention {
  kind: 'space' | 'finding';
  title: string;
  detail: string;
  action: { label: string; route?: string; finding?: string };
  /**
   * The quiet second choice: Trust a security or privacy finding (the same
   * Trust as on the Fix-it List: this exact item is known and fine, and it
   * comes back if it changes), or put any other finding off for a week.
   */
  dismiss?: { label: 'Trust' | 'Not now'; finding: string; how: 'trust' | 'snooze' };
  /** how many other things are on To do */
  more: number;
}

/** Areas whose findings the person may Trust rather than fix. */
const TRUSTABLE = new Set(['security', 'privacy']);
/** "Not now" puts a finding off for this long. */
export const SNOOZE_MS = 7 * 86_400_000;

const GB = 1024 ** 3;

/** Low when under 10 % free or under 15 GB free (whichever comes first on this disk). */
export function lowOnSpace(d: { free: number; total: number }): boolean {
  if (!(d.total > 0)) return false;
  return d.free / d.total < 0.1 || d.free < 15 * GB;
}

/** The one thing worth doing now, or null (and the line stays hidden). Low space comes first. */
export function attention(i: AttentionInput, fmt: (bytes: number) => string): Attention | null {
  // One attention model (core/attention.ts): the Fix-it List's own "space is low" item is this same line.
  const serious = (i.findings ?? []).filter((f) => calmOf(f.severity) !== 'fyi');
  if (i.disk && lowOnSpace(i.disk)) {
    const others = serious.filter((f) => f.id !== 'space:low');
    return {
      kind: 'space',
      title: `Free up space on ${i.disk.label ?? 'your disk'}`,
      detail: `${fmt(i.disk.free)} free of ${fmt(i.disk.total)}. Caches, old installers, forgotten downloads and duplicates are checked before anything goes to the Trash.`,
      action: { label: 'Free up space', route: 'cleanup' },
      more: others.length,
    };
  }
  const f = serious[0];
  if (!f) return null;
  const trust = TRUSTABLE.has(f.area ?? '');
  return {
    kind: 'finding', title: f.title, detail: f.why ?? '', action: { label: 'Fix', finding: f.id },
    dismiss: { label: trust ? 'Trust' : 'Not now', finding: f.id, how: trust ? 'trust' : 'snooze' },
    more: serious.length - 1,
  };
}

/** The quiet line under the greeting: "261,766 files · 98 GB free" (the weather chip follows it). */
export function headerLine(o: { files?: number; indexing?: boolean; free?: number; found?: number; expected?: number; background?: { pending: number; state: 'working' | 'waiting' | 'idle'; reason?: string } }, fmt: (bytes: number) => string): string {
  const parts: string[] = [];
  if (o.indexing) parts.push(readingLine(o.found, o.expected));
  else {
    if (o.files !== undefined) parts.push(`${o.files.toLocaleString()} file${o.files === 1 ? '' : 's'}`);
    const bg = backgroundLine(o.background);
    if (bg) parts.push(bg);
  }
  if (o.free !== undefined) parts.push(`${fmt(o.free)} free`);
  return parts.join(' · ');
}

/** "Reading your folders · 120,000 of ~270,000" (or "· 120,000 so far" the first time). */
export function readingLine(found?: number, expected?: number): string {
  if (!found) return 'Reading your folders…';
  // Past last time's count, the estimate is no use any more.
  if (expected && expected > found) return `Reading your folders · ${found.toLocaleString()} of ~${expected.toLocaleString()}`;
  return `Reading your folders · ${found.toLocaleString()} so far`;
}

/** What the background reading is doing, in a few words; empty when there is nothing to say. */
export function backgroundLine(b?: { pending: number; state: 'working' | 'waiting' | 'idle'; reason?: string }): string {
  if (!b || b.pending <= 0 || b.state === 'idle') return '';
  if (b.state === 'waiting') {
    const r = b.reason ?? '';
    if (/battery/i.test(r)) return 'Paused on battery';
    if (/idle|break|while you work/i.test(r)) return 'Waiting until you’re idle';
    return r ? r.split(':')[0] : 'Waiting';
  }
  return `Reading details · ${b.pending.toLocaleString()} to go`;
}
