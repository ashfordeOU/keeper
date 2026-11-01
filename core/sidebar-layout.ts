// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The sidebar's layout: when it is an icons-only rail, how wide it is, and
// which items a long section shows before "Show all" (the ones used most and
// most recently, plus the page you are on). Plain functions so they are easy
// to test.

import type { SplitterRange } from './splitter';

/** Settings → Sidebar → Layout. */
export type SidebarMode = 'auto' | 'full' | 'compact';

export const SIDEBAR_MODES: { id: SidebarMode; label: string }[] = [
  { id: 'auto', label: 'Automatic' },
  { id: 'full', label: 'Always full' },
  { id: 'compact', label: 'Always compact' },
];

export const SIDEBAR_RAIL = 56;
export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 360;
export const SIDEBAR_DEFAULT = 228;
/** Automatic turns into the rail below this window width. */
export const SIDEBAR_AUTO_BELOW = 960;
export const SECTION_LIMIT_DEFAULT = 5;

export const SIDEBAR_RANGE: SplitterRange = { min: SIDEBAR_MIN, max: SIDEBAR_MAX, def: SIDEBAR_DEFAULT, grow: 'right' };

export function asSidebarMode(v: unknown): SidebarMode {
  return v === 'full' || v === 'compact' ? v : 'auto';
}

/**
 * Whether the sidebar is the rail. `pinned` is the person's own choice from the
 * pin button, ⌘⌥S / Ctrl+Alt+S or dragging the edge (true: open, false: rail,
 * null: none yet); "Always full" ignores it.
 */
export function isRail(o: { mode: SidebarMode; windowWidth: number; pinned: boolean | null }): boolean {
  if (o.mode === 'full') return false;
  if (o.pinned !== null) return !o.pinned;
  return o.mode === 'compact' || o.windowWidth < SIDEBAR_AUTO_BELOW;
}

export interface NavUse { n: number; last: number }
export type NavUsage = Record<string, NavUse>;

const HALF_LIFE = 14 * 86_400_000;
const MAX_KEYS = 300;

/** Counts one use of a sidebar item (old uses count for less, so the list follows what you use now). */
export function recordUse(u: NavUsage, key: string, now: number): NavUsage {
  const prev = u[key];
  const n = prev ? prev.n * Math.pow(0.5, Math.max(0, now - prev.last) / HALF_LIFE) + 1 : 1;
  const next: NavUsage = { ...u, [key]: { n, last: now } };
  const keys = Object.keys(next);
  if (keys.length > MAX_KEYS) for (const k of keys.sort((a, b) => next[a].last - next[b].last).slice(0, keys.length - MAX_KEYS)) delete next[k];
  return next;
}

/** How much an item has been used lately: decayed count plus a little for being recent. */
export function useScore(u: NavUse | undefined, now: number): number {
  if (!u) return 0;
  const age = Math.max(0, now - u.last);
  return u.n * Math.pow(0.5, age / HALF_LIFE) + (age < 86_400_000 ? 0.5 : 0);
}

/**
 * The items a section shows when compacted: the `limit` most used (ties keep
 * the section's own order, so a fresh install shows the first ones), and the
 * page you are on. Nothing is hidden when only one item would be.
 */
export function pickVisible(keys: string[], usage: NavUsage, limit: number, active: string | null, now: number): Set<string> {
  if (limit <= 0 || keys.length <= limit + 1) return new Set(keys);
  const ranked = keys.map((k, i) => ({ k, i, s: useScore(usage[k], now) })).sort((a, b) => b.s - a.s || a.i - b.i);
  const keep = new Set(ranked.slice(0, limit).map((x) => x.k));
  if (active && keys.includes(active)) keep.add(active);
  return keep;
}
