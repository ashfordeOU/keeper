// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Tabs for the main window. Any page opens in a new tab with a middle-click or
// ⌘/Ctrl-click (or "Open in New Tab"); each tab keeps its own page, Back and
// Forward, scroll and drafts, and everything comes back after a restart or a
// crash. With a single tab the strip stays out of the way.

import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { isMac, useStore, type Route } from '../state';
import type { Tab } from '../../core/session';
import { Icon } from './Icon';
import { ContextMenu, type MenuItem } from './ui';
import '../styles/tabs.css';

/** Connection names of remote desktop tabs (filled in by the viewers, src/screens/RemoteDesktopSession.tsx). */
export const rdcTabNames = new Map<string, string>();

const TITLES: Record<string, [string, string]> = {
  home: ['Home', 'home'], recents: ['Recents', 'clock'], library: ['Library', 'grid'], screenshots: ['Screenshots', 'screenshot'], search: ['Search', 'search'],
  saved: ['Saved search', 'search'], browse: ['Browse', 'folder'], downloads: ['Downloaded From', 'down'], source: ['Downloads', 'down'], tag: ['Tag', 'tag'],
  duplicates: ['Duplicates', 'dupes'], cleanup: ['Clean Up', 'broom'], space: ['Space Map', 'map'], large: ['Large Files', 'weight'], startup: ['Startup Items', 'power'],
  apps: ['Applications', 'app'], protection: ['Protection', 'shield'], rules: ['Automations', 'rules'], history: ['History', 'history'], assistant: ['Assistant', 'assistant'],
  island: ['Island', 'island'], settings: ['Settings', 'settings'], tools: ['Toolbox', 'terminal'], health: ['Health', 'bolt'], capture: ['Capture', 'screenshot'],
  annotate: ['Annotate', 'screenshot'], convert: ['Convert', 'refresh'], widgets: ['Widgets', 'grid'], weather: ['Weather', 'sun'], network: ['Network', 'globe'], trash: ['Trash', 'trash'],
  remote: ['Cloud & Servers', 'cloud'], terminal: ['Terminal', 'terminal'], sync: ['Sync & Backup', 'refresh'], devices: ['Devices', 'laptop'], netactivity: ['Network Activity', 'globe'],
  rdc: ['Remote Desktops', 'laptop'], vpn: ['VPN', 'lock'], mesh: ['Mesh', 'graph'], agents: ['Agents', 'agent'], graph: ['Knowledge Graph', 'graph'], mail: ['Mail', 'mail'], calendar: ['Calendar', 'calendar'], reminders: ['Reminders', 'check'], alarms: ['Alarms', 'timer'],
};

const SHELVES: Record<string, string> = { image: 'Images', video: 'Videos', audio: 'Music', document: 'Documents', archive: 'Archives', installer: 'Installers', app: 'Apps', code: 'Code', other: 'Other' };

export function tabTitle(r: Route): { title: string; icon: string } {
  const [name, icon] = TITLES[r.name] ?? [r.name, 'folder'];
  if (r.name === 'search' && r.q) return { title: `“${r.q}”`, icon };
  if (r.name === 'browse' && r.arg) return { title: r.arg.split(/[\\/]/).filter(Boolean).pop() ?? r.arg, icon };
  if (r.name === 'library' && r.arg) return { title: SHELVES[r.arg] ?? r.arg, icon };
  if (r.name === 'tag' && r.arg) return { title: `#${r.arg}`, icon };
  // A remote desktop in a tab is called after its connection.
  if (r.name === 'rdc' && r.q && (r.arg === 'vnc' || r.arg === 'web')) return { title: rdcTabNames.get(r.q) ?? 'Remote desktop', icon: r.arg === 'web' ? 'globe' : 'laptop' };
  return { title: name, icon };
}

export function TabStrip() {
  const { tabs, settings } = useStore();
  const [menu, setMenu] = useState<{ x: number; y: number; tab: Tab } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const on = settings?.tabs !== false;

  // Keyboard: ⌘T new tab, ⌘W close, ⌘⇧T reopen (passed on by the main process, which sees them first),
  // Ctrl+Tab / Ctrl+Shift+Tab next and previous, ⌃1–9 (Mac) or Alt+1–9 a tab by its place.
  useEffect(() => {
    if (!on) return;
    const offKey = api.on('tab-key' as 'navigate', ((k: { key: string; shift: boolean }) => {
      if (k.key === 't' && k.shift) tabs.reopenClosed();
      else if (k.key === 't') tabs.open({ name: 'home' });
      else if (k.key === 'w') {
        if (tabs.tabs.length > 1) tabs.close(tabs.active);
        else window.close();
      }
    }) as never);
    const onKey = (e: KeyboardEvent) => {
      const i = tabs.tabs.findIndex((t) => t.id === tabs.active);
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const n = tabs.tabs.length;
        tabs.select(tabs.tabs[(i + (e.shiftKey ? n - 1 : 1)) % n].id);
      } else if ((isMac ? e.ctrlKey && !e.metaKey : e.altKey && !e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const n = Number(e.key);
        const t = n === 9 ? tabs.tabs[tabs.tabs.length - 1] : tabs.tabs[n - 1];
        if (t) tabs.select(t.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { offKey(); window.removeEventListener('keydown', onKey); };
  }, [on, tabs]);

  if (!on || tabs.tabs.length < 2) return null;

  const items = (t: Tab): MenuItem[] => [
    { label: 'New Tab', icon: 'plus', kbd: `${isMac ? '⌘' : 'Ctrl+'}T`, run: () => tabs.open({ name: 'home' }) },
    { label: 'Duplicate Tab', icon: 'copy', run: () => tabs.duplicate(t.id) },
    { label: t.pinned ? 'Unpin Tab' : 'Pin Tab', icon: 'pin', run: () => tabs.pin(t.id, !t.pinned) },
    { label: 'Move to New Window', icon: 'external', run: () => tabs.toWindow(t.id) },
    { sep: true, label: '' },
    { label: 'Close Tab', icon: 'close', kbd: `${isMac ? '⌘' : 'Ctrl+'}W`, run: () => tabs.close(t.id) },
    { label: 'Close Other Tabs', run: () => tabs.closeOthers(t.id) },
    { label: 'Close Tabs to the Right', run: () => tabs.closeToRight(t.id) },
    ...(tabs.closedCount ? [{ label: 'Reopen Closed Tab', icon: 'undo', kbd: `${isMac ? '⌘⇧' : 'Ctrl+Shift+'}T`, run: () => tabs.reopenClosed() }] : []),
  ];

  return (
    <div className="tab-strip" ref={stripRef} role="tablist" onDragOver={(e) => { if (dragging) e.preventDefault(); }}>
      {tabs.tabs.map((t, i) => {
        const { title, icon } = tabTitle(t.route as Route);
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === tabs.active}
            className={`tab ${t.id === tabs.active ? 'on' : ''} ${t.pinned ? 'pinned' : ''} ${dragging === t.id ? 'dragging' : ''}`}
            title={title}
            draggable
            onClick={() => tabs.select(t.id)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); tabs.close(t.id); } }}
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, tab: t }); }}
            onDragStart={(e) => { setDragging(t.id); e.dataTransfer.setData('text/x-keeper-tab', t.id); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (dragging && dragging !== t.id) { e.preventDefault(); } }}
            onDrop={(e) => { e.preventDefault(); if (dragging) tabs.move(dragging, i); setDragging(null); }}
            onDragEnd={(e) => {
              // Dropped outside the window: the tab gets a window of its own.
              const outside = e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight;
              if (outside && e.dataTransfer.dropEffect === 'none' && tabs.tabs.length > 1) tabs.toWindow(t.id);
              setDragging(null);
            }}
          >
            <Icon name={icon} size={13} />
            {t.pinned ? null : <span className="tab-title ellipsis">{title}</span>}
            {t.pinned ? null : (
              <button className="tab-close" title="Close Tab" aria-label={`Close ${title}`} onClick={(e) => { e.stopPropagation(); tabs.close(t.id); }}>
                <Icon name="close" size={11} />
              </button>
            )}
          </div>
        );
      })}
      <button className="tab-new" title={`New Tab (${isMac ? '⌘' : 'Ctrl+'}T)`} onClick={() => tabs.open({ name: 'home' })}>
        <Icon name="plus" size={13} />
      </button>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={items(menu.tab)} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
