// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A sidebar section that opens and closes on a click of its title and stays
// the way the person left it. Each section has its own colour.

import { useState, useSyncExternalStore } from 'react';
import { Icon } from './Icon';
import { ContextMenu, type MenuItem } from './ui';
import { useStore } from '../state';

const KEY = 'sidebar.closed';
const listeners = new Set<() => void>();

function load(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

let closed = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify([...closed]));
  } catch {
    /* storage unavailable: still works until Keeper quits */
  }
  for (const l of listeners) l();
}

export function setSectionOpen(id: string, open: boolean) {
  closed = new Set(closed);
  if (open) closed.delete(id);
  else closed.add(id);
  save();
}

/** Opens or closes every section at once. */
export function setAllSections(ids: string[], open: boolean) {
  closed = open ? new Set() : new Set(ids);
  save();
}

function useClosed(): Set<string> {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => closed);
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
  tidy: '#22c55e',
  system: '#f97316',
  more: '#6366f1',
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
  const isClosed = useClosed().has(id);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { settings, updateSettings, go } = useStore();
  // Hidden or moved with "Customize sidebar…".
  if (settings?.sidebarHidden?.includes(`section:${id}`)) return null;
  const at = settings?.sidebarOrder?.indexOf(id) ?? -1;
  const order = settings?.sidebarOrder?.length ? 100 + (at < 0 ? 50 : at) : undefined;
  return (
    <div
      {...rest}
      className={`nav-section ${isClosed ? 'closed' : ''} ${className ?? ''}`}
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
        <span className="nav-title-text"><i className="sec-dot" />{title}</span>
        <Icon name="chevronDown" size={12} className="nav-chevron" />
      </button>
      {/* A closed section keeps showing the page you are on, so you never lose your place. */}
      <div className="nav-items">{children}</div>
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
