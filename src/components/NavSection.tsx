// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A sidebar section that opens and closes on a click of its title and stays
// the way the person left it. Places and the everyday suite sections start open,
// the rest folded (only their titles show, plus the page you are on); the person
// opens the ones they want. Each section has its own colour. A long section
// shows its most used items and "Show all" (Settings → Sidebar); the page you
// are on always stays in view.

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { pickVisible, SECTION_LIMIT_DEFAULT } from '../../core/sidebar-layout';
import { compactionAllowed, useSidebarLocal } from '../sidebar-state';
import { Icon } from './Icon';
import { ContextMenu, type MenuItem } from './ui';
import { useStore } from '../state';

// `all:<id>` for a long section showing all its items (kept under the old key).
const KEY = 'sidebar.closed';
// Sections the person opened; every other section starts folded.
const OPEN_KEY = 'sidebar.opened';
const listeners = new Set<() => void>();

/** Open for someone who has not opened or closed any section yet (Balanced): the rest show their titles only. */
export const DEFAULT_OPEN = ['library', 'favorites', 'locations', 'pim', 'tidy', 'computer', 'security'];

function load(key: string, fallback: string[] = []): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw === null ? fallback : (JSON.parse(raw) as string[]));
  } catch {
    return new Set(fallback);
  }
}

let closed = load(KEY);
let opened = load(OPEN_KEY, DEFAULT_OPEN);

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify([...closed]));
    localStorage.setItem(OPEN_KEY, JSON.stringify([...opened]));
  } catch {
    /* storage unavailable: still works until Keeper quits */
  }
  for (const l of listeners) l();
}

export function setSectionOpen(id: string, open: boolean) {
  opened = new Set(opened);
  if (open) opened.add(id);
  else opened.delete(id);
  save();
}

/** Opens or closes every section at once (each one's "Show all" stays as it was). */
export function setAllSections(ids: string[], open: boolean) {
  opened = new Set(open ? ids : []);
  save();
}

/** Folded unless the person opened it. Automated test runs see every section open, so their selectors keep working. */
function sectionClosed(id: string): boolean {
  return compactionAllowed() && !opened.has(id);
}

/** A long section shows all its items, or only its most used ones. */
export function setSectionAll(id: string, all: boolean) {
  closed = new Set(closed);
  if (all) closed.add(`all:${id}`);
  else closed.delete(`all:${id}`);
  save();
}

const navKeyOf = (row: HTMLElement): string => {
  const b = row.matches('.nav-item') ? row : row.querySelector<HTMLElement>('.nav-item');
  return b?.dataset.navKey || b?.getAttribute('title') || b?.textContent || '';
};

function useClosed(): Set<string> {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => closed);
}

function useOpened(): Set<string> {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => opened);
}

/** Section colours, in the order they appear; themes may override --sec-<id>. */
export const SECTION_COLOR: Record<string, string> = {
  library: '#e5487f',
  saved: '#3b82f6',
  favorites: '#f59e0b',
  locations: '#14b8a6',
  cloud: '#0ea5e9',
  devices: '#10b981',
  sync: '#10b981',
  pim: '#e8590c',
  tags: '#8b5cf6',
  notes: '#eab308',
  tidy: '#22c55e',
  computer: '#f97316',
  security: '#ef4444',
  ai: '#6366f1',
  screen: '#06b6d4',
  desktop: '#d946ef',
};

/** Section names for Customize sidebar (the suite sections take theirs from core/features.ts NAV_GROUPS). */
export const SECTION_NAMES: Record<string, string> = {
  library: 'Library', saved: 'Saved searches', favorites: 'Favorites', locations: 'Locations', cloud: 'Cloud & Servers', devices: 'Devices', sync: 'Sync & Backup',
  pim: 'Mail & Calendar', tags: 'Tags', notes: 'Notes', tidy: 'Tidy', computer: 'Computer', security: 'Privacy & Security', ai: 'AI', screen: 'Screen', desktop: 'Desktop',
};

export const SECTION_IDS = Object.keys(SECTION_COLOR);

export function NavSection({ id, title, children, className, menuItems = [], ...rest }: {
  id: string;
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** extra entries for the title's right-click menu */
  menuItems?: MenuItem[];
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>) {
  const closedSet = useClosed();
  useOpened();
  const isClosed = sectionClosed(id);
  const showAll = closedSet.has(`all:${id}`);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { settings, updateSettings, go } = useStore();
  const { usage } = useSidebarLocal();
  const limit = compactionAllowed() ? settings?.sidebarSectionLimit ?? SECTION_LIMIT_DEFAULT : 0;
  const itemsRef = useRef<HTMLDivElement>(null);
  const [counts, setCounts] = useState({ total: 0, more: 0, measured: false });
  // Marks the items beyond the most used ones (they hide until "Show all"); runs again when the items change.
  useLayoutEffect(() => {
    const el = itemsRef.current;
    if (!el) return;
    const apply = () => {
      const rows = [...el.children].filter((c) => c.matches('.nav-item') || c.querySelector('.nav-item')) as HTMLElement[];
      const keys = rows.map(navKeyOf);
      const activeRow = rows.find((r) => r.matches('.nav-item.active') || r.querySelector('.nav-item.active'));
      const keep = pickVisible(keys, usage, limit, activeRow ? navKeyOf(activeRow) : null, Date.now());
      let more = 0;
      rows.forEach((r, i) => { const m = !keep.has(keys[i]); if (m) more++; if (r.hasAttribute('data-more') !== m) r.toggleAttribute('data-more', m); });
      setCounts((c) => (c.total === rows.length && c.more === more && c.measured ? c : { total: rows.length, more, measured: true }));
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, [usage, limit]);
  // Hidden or moved with "Customize sidebar…".
  if (settings?.sidebarHidden?.includes(`section:${id}`)) return null;
  const at = settings?.sidebarOrder?.indexOf(id) ?? -1;
  const order = settings?.sidebarOrder?.length ? 100 + (at < 0 ? 50 : at) : undefined;
  return (
    <div
      {...rest}
      className={`nav-section ${isClosed ? 'closed' : ''} ${showAll ? 'show-all' : ''} ${className ?? ''}`}
      data-section={id}
      // Every page in it is off: the title goes too.
      hidden={counts.total === 0 && counts.measured ? true : undefined}
      style={{ ['--sec' as string]: `var(--sec-${id}, ${SECTION_COLOR[id] ?? 'var(--accent)'})`, order }}
    >
      <button
        className="nav-title"
        aria-expanded={!isClosed}
        title={isClosed ? 'Show' : 'Hide'}
        // Alt/Option-click opens or closes every section, as in the system file manager.
        onClick={(e) => (e.altKey ? setAllSections(SECTION_IDS, isClosed) : setSectionOpen(id, isClosed))}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      >
        <span className="nav-title-text"><i className="sec-dot" /><span className="nav-title-label">{title}</span></span>
        <Icon name="chevronDown" size={12} className="nav-chevron" />
      </button>
      {/* A closed section keeps showing the page you are on, so you never lose your place. */}
      <div className="nav-items" ref={itemsRef}>{children}</div>
      {counts.more > 0 && !isClosed ? (
        <button className="nav-more" aria-expanded={showAll} data-testid={`nav-more-${id}`} title={showAll ? 'Show only the ones you use most' : `Show all ${counts.total}`} onClick={() => setSectionAll(id, !showAll)}>
          <Icon name={showAll ? 'minus' : 'plus'} size={14} />
          <span className="label">{showAll ? 'Show fewer' : `Show all (${counts.total})`}</span>
        </button>
      ) : null}
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: isClosed ? 'Show This Section' : 'Hide This Section', icon: 'chevronDown', run: () => setSectionOpen(id, isClosed) },
            { label: 'Show All Sections', icon: 'plus', run: () => setAllSections(SECTION_IDS, true) },
            { label: 'Hide All Sections', icon: 'minus', run: () => setAllSections(SECTION_IDS, false) },
            ...menuItems,
            { sep: true, label: '' },
            { label: 'Remove from Sidebar', icon: 'close', run: () => settings && void updateSettings({ sidebarHidden: [...(settings.sidebarHidden ?? []), `section:${id}`] }) },
            { label: 'Customize Sidebar…', icon: 'settings', run: () => go({ name: 'settings', arg: 'sidebar' }) },
          ]}
        />
      ) : null}
    </div>
  );
}
