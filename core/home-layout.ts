// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Home's layout and its one-line suggestion: which sections show and in what
// order (Edit Home), how roomy it is, the Library style, the move of older
// Home settings onto the current sections, and what, if anything, is worth
// doing now. Plain functions so they are easy to test.

/**
 * suggestions: one line when something is worth doing (low space, a finding on To do);
 * jump: recent files grouped by the project or folder they belong to;
 * today: events, tasks due and what is running (a column beside the rest on a wide window).
 */
export type HomeSectionId = 'suggestions' | 'jump' | 'today' | 'library' | 'pinned' | 'weather' | 'usage';
export type HomeDensity = 'comfortable' | 'compact' | 'spacious';

/** Bumped when the sections change; older settings are moved on by normalizeHome. */
export const HOME_LAYOUT_VERSION = 2;

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
  { id: 'suggestions', name: 'Suggestions', description: 'One line, only when something is worth doing: low space or a finding on the Fix-it List.' },
  { id: 'jump', name: 'Jump back in', description: 'Recent files, grouped by the project or folder they belong to.' },
  { id: 'today', name: 'Today', description: 'Today’s events, tasks due, and timers, Keep Awake or a recording while they run.' },
  { id: 'library', name: 'Library', description: 'All Images, All Videos, All Documents and so on, with counts.' },
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
  return { v: HOME_LAYOUT_VERSION, order: [...IDS], hidden: ['weather', 'usage'], density: 'comfortable', library: 'tiles' };
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
  return { v: HOME_LAYOUT_VERSION, order, hidden, density: x.density, library: 'tiles' };
}

/** Bad or old values fall back; older layouts are moved on; sections added later join at the end. */
export function normalizeHome(v: unknown): HomeSettings {
  const d = defaultHomeSettings();
  if (!v || typeof v !== 'object') return d;
  let x = v as Record<string, unknown>;
  if (x.v !== HOME_LAYOUT_VERSION) x = migrateHome(x);
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
 * Where each section goes: on a wide window Today is a column beside the
 * others; on a narrow one everything is one column in the person's order.
 */
export function homeColumns(h: HomeSettings, wide: boolean): { main: HomeSectionId[]; side: HomeSectionId[] } {
  const shown = visibleSections(h);
  if (!wide) return { main: shown, side: [] };
  return { main: shown.filter((id) => id !== 'today'), side: shown.filter((id) => id === 'today') };
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
   * The quiet second choice: Trust a security or privacy finding (it is
   * ignored from then on: the person knows about it and it is fine), or put
   * any other finding off for a week.
   */
  dismiss?: { label: 'Trust' | 'Not now'; finding: string; how: 'ignore' | 'snooze' };
  /** how many other things are on To do */
  more: number;
}

/** Areas whose findings the person may Trust (ignore for good) rather than fix. */
const TRUSTABLE = new Set(['security', 'privacy']);
/** "Not now" puts a finding off for this long. */
export const SNOOZE_MS = 7 * 86_400_000;

const GB = 1024 ** 3;
const SERIOUS = new Set(['critical', 'high', 'medium']);

/** Low when under 10 % free or under 15 GB free (whichever comes first on this disk). */
export function lowOnSpace(d: { free: number; total: number }): boolean {
  if (!(d.total > 0)) return false;
  return d.free / d.total < 0.1 || d.free < 15 * GB;
}

/** The one thing worth doing now, or null (and the line stays hidden). Low space comes first. */
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
  const trust = TRUSTABLE.has(f.area ?? '');
  return {
    kind: 'finding', title: f.title, detail: f.why ?? '', action: { label: 'Fix', finding: f.id },
    dismiss: { label: trust ? 'Trust' : 'Not now', finding: f.id, how: trust ? 'ignore' : 'snooze' },
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
