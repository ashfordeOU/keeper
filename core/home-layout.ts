// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Home's layout and its one "Attention" card: which sections show and in what
// order (Edit Home), how roomy it is, the Library and Recent styles, and what,
// if anything, is worth doing now. Plain functions so they are easy to test.

export type HomeSectionId = 'attention' | 'library' | 'recent' | 'pinned' | 'weather' | 'usage' | 'calendar';
export type HomeDensity = 'comfortable' | 'compact' | 'spacious';
export type RecentFilter = 'all' | 'download' | 'image' | 'video' | 'document';

export interface HomeSettings {
  /** every section, in the person's order */
  order: HomeSectionId[];
  hidden: HomeSectionId[];
  density: HomeDensity;
  /** the Library as a row of chips, or the larger tiles */
  library: 'chips' | 'tiles';
  recent: RecentFilter;
  recentView: 'grid' | 'list';
}

export const HOME_SECTIONS: { id: HomeSectionId; name: string; description: string }[] = [
  { id: 'attention', name: 'Attention', description: 'Shows only when something is worth doing: low space or a finding on To do.' },
  { id: 'library', name: 'Library', description: 'How many images, videos, documents and so on.' },
  { id: 'recent', name: 'Recent', description: 'What arrived lately, with filters.' },
  { id: 'pinned', name: 'Pinned folders', description: 'Folders you pinned to Favorites.' },
  { id: 'weather', name: 'Weather', description: 'The full forecast card (the header always has a small chip).' },
  { id: 'usage', name: 'Storage', description: 'How the disk is used, by kind of file.' },
  { id: 'calendar', name: 'Calendar today', description: 'Today’s events from your calendars.' },
];

export const HOME_DENSITIES: { id: HomeDensity; label: string }[] = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact', label: 'Compact' },
  { id: 'spacious', label: 'Spacious' },
];

export const RECENT_FILTERS: { id: RecentFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'download', label: 'Downloads' },
  { id: 'image', label: 'Photos' },
  { id: 'video', label: 'Videos' },
  { id: 'document', label: 'Documents' },
];

/** At most this many items in Recent; "See all" opens the rest. */
export const RECENT_MAX = 6;

const IDS = HOME_SECTIONS.map((s) => s.id);

export function defaultHomeSettings(): HomeSettings {
  return { order: [...IDS], hidden: ['weather', 'usage', 'calendar'], density: 'comfortable', library: 'chips', recent: 'all', recentView: 'grid' };
}

/** Bad or old values fall back; sections added later join at the end. */
export function normalizeHome(v: unknown): HomeSettings {
  const d = defaultHomeSettings();
  if (!v || typeof v !== 'object') return d;
  const x = v as Partial<HomeSettings>;
  const known = (a: unknown): HomeSectionId[] => (Array.isArray(a) ? a.filter((s): s is HomeSectionId => IDS.includes(s as HomeSectionId)) : []);
  const order = [...new Set(known(x.order))];
  for (const id of IDS) if (!order.includes(id)) order.push(id);
  return {
    order,
    hidden: Array.isArray(x.hidden) ? [...new Set(known(x.hidden))] : d.hidden,
    density: HOME_DENSITIES.some((o) => o.id === x.density) ? x.density! : d.density,
    library: x.library === 'tiles' ? 'tiles' : 'chips',
    recent: RECENT_FILTERS.some((o) => o.id === x.recent) ? x.recent! : 'all',
    recentView: x.recentView === 'list' ? 'list' : 'grid',
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

// ---------------------------------------------------------------- the Attention card

export interface AttentionInput {
  disk?: { free: number; total: number; label?: string };
  /** open findings on To do, most important first */
  findings?: { id: string; title: string; severity: string; why?: string }[];
}

export interface Attention {
  kind: 'space' | 'finding';
  title: string;
  detail: string;
  action: { label: string; route?: string; finding?: string };
  /** how many other things are on To do */
  more: number;
}

const GB = 1024 ** 3;
const SERIOUS = new Set(['critical', 'high', 'medium']);

/** Low when under 10 % free or under 15 GB free (whichever comes first on this disk). */
export function lowOnSpace(d: { free: number; total: number }): boolean {
  if (!(d.total > 0)) return false;
  return d.free / d.total < 0.1 || d.free < 15 * GB;
}

/** The one thing worth doing now, or null (and the card stays hidden). Low space comes first. */
export function attention(i: AttentionInput, fmt: (bytes: number) => string): Attention | null {
  const serious = (i.findings ?? []).filter((f) => SERIOUS.has(f.severity));
  if (i.disk && lowOnSpace(i.disk)) {
    return {
      kind: 'space',
      title: `${i.disk.label ?? 'Your disk'} is nearly full`,
      detail: `${fmt(i.disk.free)} free of ${fmt(i.disk.total)}. Caches, old installers, forgotten downloads and duplicates are checked before anything goes to the Trash.`,
      action: { label: 'Free up space', route: 'cleanup' },
      more: serious.length,
    };
  }
  const f = serious[0];
  if (!f) return null;
  return { kind: 'finding', title: f.title, detail: f.why ?? '', action: { label: 'Fix', finding: f.id }, more: serious.length - 1 };
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
