// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The sidebar's own state on this computer: its width, whether the person
// pinned it open (or folded it to the rail), and how often each item is used,
// which decides what a long section shows first. Kept in localStorage, shared
// by every window.

import { useSyncExternalStore } from 'react';
import { clampSize } from '../core/splitter';
import { recordUse, SIDEBAR_DEFAULT, SIDEBAR_RANGE, type NavUsage } from '../core/sidebar-layout';

interface SidebarLocal { width: number; pinned: boolean | null; usage: NavUsage }

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable: still works until Keeper quits */ }
}

let state: SidebarLocal = {
  width: clampSize(read('sidebar.width', SIDEBAR_DEFAULT), SIDEBAR_RANGE),
  pinned: read<boolean | null>('sidebar.pinned', null),
  usage: read<NavUsage>('sidebar.usage', {}),
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (patch: Partial<SidebarLocal>) => { state = { ...state, ...patch }; emit(); };

export function useSidebarLocal(): SidebarLocal {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);
}

export function setSidebarWidth(px: number) {
  const w = clampSize(px, SIDEBAR_RANGE);
  write('sidebar.width', w);
  set({ width: w });
}

/** true keeps the sidebar open, false folds it to the rail, null goes back to the setting. */
export function setSidebarPinned(p: boolean | null) {
  write('sidebar.pinned', p);
  set({ pinned: p });
}

export function noteNavUse(key: string) {
  const usage = recordUse(state.usage, key, Date.now());
  write('sidebar.usage', usage);
  set({ usage });
}

// Every click on a sidebar item counts, whichever part of the sidebar drew it.
if (typeof window !== 'undefined') {
  window.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('.sidebar .nav-item');
    const key = el?.dataset.navKey ?? el?.getAttribute('title');
    if (key) noteNavUse(key);
  }, true);
}

/** Automated test runs see every item, so their selectors keep working (a test can opt in with sidebar.compactInTests). */
export function compactionAllowed(): boolean {
  try {
    return !navigator.webdriver || localStorage.getItem('sidebar.compactInTests') === '1';
  } catch {
    return true;
  }
}
