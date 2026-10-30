// SPDX-License-Identifier: AGPL-3.0-or-later
// The main window: sidebar, search bar, the current page, and the inspector.

import { Component, useEffect, useState, type ReactNode } from 'react';
import type { FileKind } from '../core/types';
import { api } from './api';
import { CommandPalette } from './components/CommandPalette';
import { Icon } from './components/Icon';
import { Inspector } from './components/Inspector';
import { Player } from './components/Player';
import { KIND_COLOR } from './components/ui';
import { Apps } from './screens/Apps';
import { Assistant } from './screens/Assistant';
import { Browse } from './screens/Browse';
import { Cleanup } from './screens/Cleanup';
import { Downloads } from './screens/Downloads';
import { Duplicates } from './screens/Duplicates';
import { Health } from './screens/Health';
import { Weather } from './screens/Weather';
import { useT } from './i18n';
import { History } from './screens/History';
import { Home } from './screens/Home';
import { IslandSettings } from './screens/IslandSettings';
import { Widgets } from './screens/Widgets';
import { Large } from './screens/Large';
import { Library } from './screens/Library';
import { Protection } from './screens/Protection';
import { Rules } from './screens/Rules';
import { Search } from './screens/Search';
import { Settings } from './screens/Settings';
import { Space } from './screens/Space';
import { Startup } from './screens/Startup';
import { Tools } from './screens/Tools';
import { Convert } from './screens/Convert';
import { Capture } from './screens/Capture';
import { Annotate } from './screens/Annotate';
import { mod, shift, useAsync, useStore, type Route, type RouteName } from './state';
import { QuickLookHost } from './preview/QuickLook';

const SHELVES: FileKind[] = ['image', 'video', 'audio', 'document', 'archive', 'installer', 'app'];

function NavItem({ route, icon, label, count, color }: { route: Route; icon?: string; label: string; count?: number | string; color?: string }) {
  const { route: cur, go } = useStore();
  const active = cur.name === route.name && (cur.arg ?? '') === (route.arg ?? '');
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={() => go(route)} title={label}>
      {color ? <span className="dot" style={{ background: color }} /> : <Icon name={icon ?? 'folder'} size={15} />}
      <span className="label ellipsis">{label}</span>
      {count !== undefined ? <span className="count">{count}</span> : null}
    </button>
  );
}

function Sidebar() {
  const { settings, version, info, updateSettings } = useStore();
  const t = useT();
  const totals = useAsync(() => api.library.totals(), [version]);
  const tags = useAsync(() => api.library.tags(), [version]);
  const short = (n?: number) => (n === undefined ? undefined : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
  return (
    <aside className="sidebar">
      <div className="brand"><div className="logo"><Icon name="home" size={15} stroke={2.2} /></div><span>Keeper</span></div>
      <NavItem route={{ name: 'home' }} icon="home" label={t('nav.home')} />
      <NavItem route={{ name: 'recents' }} icon="clock" label={t('nav.recents')} />
      <NavItem route={{ name: 'browse', arg: info?.home }} icon="folder" label={t('nav.browse')} />
      <NavItem route={{ name: 'downloads' }} icon="down" label={t('nav.downloads')} />
      <NavItem route={{ name: 'weather' }} icon="sun" label={t('nav.weather')} />

      <div className="nav-section">
        <div className="nav-title">{t('section.library')}</div>
        {SHELVES.map((k) => <NavItem key={k} route={{ name: 'library', arg: k }} color={KIND_COLOR[k]} label={t(`kind.${k}`)} count={short(totals.data?.[k].count)} />)}
        <NavItem route={{ name: 'screenshots' }} icon="screenshot" label={t('kind.screenshot')} />
      </div>

      {settings?.savedSearches.length ? (
        <div className="nav-section">
          <div className="nav-title">{t('section.saved')}</div>
          {settings.savedSearches.map((s) => <NavItem key={s.id} route={{ name: 'search', q: s.text, arg: s.id }} icon="search" label={s.name} />)}
        </div>
      ) : null}

      {settings?.pinned.length ? (
        <div className="nav-section">
          <div className="nav-title">{t('section.pinned')}</div>
          {settings.pinned.map((p) => (
            <div key={p} onContextMenu={(e) => { e.preventDefault(); void updateSettings({ pinned: settings.pinned.filter((x) => x !== p) }); }}>
              <NavItem route={{ name: 'browse', arg: p }} icon="folder" label={p.split(/[\\/]/).pop() || p} />
            </div>
          ))}
        </div>
      ) : null}

      {tags.data?.length ? (
        <div className="nav-section">
          <div className="nav-title">{t('section.tags')}</div>
          {tags.data.slice(0, 8).map((t) => <NavItem key={t.tag} route={{ name: 'tag', arg: t.tag }} icon="tag" label={t.tag} count={t.count} />)}
        </div>
      ) : null}

      <div className="nav-section">
        <div className="nav-title">{t('section.tidy')}</div>
        <NavItem route={{ name: 'cleanup' }} icon="broom" label={t('nav.cleanup')} />
        <NavItem route={{ name: 'duplicates' }} icon="dupes" label={t('nav.duplicates')} />
        <NavItem route={{ name: 'space' }} icon="map" label={t('nav.space')} />
        <NavItem route={{ name: 'large' }} icon="weight" label={t('nav.large')} />
        <NavItem route={{ name: 'convert' }} icon="refresh" label={t('nav.convert')} />
        <NavItem route={{ name: 'rules' }} icon="rules" label={t('nav.rules')} />
      </div>

      <div className="nav-section">
        <div className="nav-title">{t('section.system')}</div>
        <NavItem route={{ name: 'health' }} icon="bolt" label={t('nav.health')} />
        <NavItem route={{ name: 'startup' }} icon="power" label={t('nav.startup')} />
        <NavItem route={{ name: 'apps' }} icon="app" label={t('nav.apps')} />
        <NavItem route={{ name: 'protection' }} icon="shield" label={t('nav.protection')} />
      </div>

      <div className="nav-section">
        <div className="nav-title">{t('section.more')}</div>
        <NavItem route={{ name: 'assistant' }} icon="assistant" label={t('nav.assistant')} />
        <NavItem route={{ name: 'capture' }} icon="screenshot" label={t('nav.capture')} />
        <NavItem route={{ name: 'tools' }} icon="terminal" label={t('nav.toolbox')} />
        <NavItem route={{ name: 'island' }} icon="island" label={t('nav.island')} />
        <NavItem route={{ name: 'widgets' }} icon="grid" label={t('nav.widgets')} />
        <NavItem route={{ name: 'history' }} icon="history" label={t('nav.history')} />
        <NavItem route={{ name: 'settings' }} icon="settings" label={t('nav.settings')} />
      </div>
    </aside>
  );
}

function TopBar({ onPalette }: { onPalette: () => void }) {
  const { route, go, back, canBack, settings, updateSettings } = useStore();
  const t = useT();
  const [text, setText] = useState(route.name === 'search' ? route.q ?? '' : '');
  useEffect(() => {
    if (route.name === 'search') setText(route.q ?? '');
  }, [route]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        document.getElementById('search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <header className="topbar">
      <button className="btn ghost icon sm" disabled={!canBack} onClick={back} title="Back"><Icon name="chevronLeft" size={16} /></button>
      <div className="searchbox">
        <Icon name="search" size={15} />
        <input
          id="search"
          value={text}
          placeholder={t('search.placeholder')}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) go({ name: 'search', q: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setText(''); (e.target as HTMLInputElement).blur(); }
          }}
        />
        <kbd>{mod}F</kbd>
      </div>
      <div className="spacer" />
      <Player />
      <button className="btn ghost icon" title={`Command palette (${mod}K)`} onClick={onPalette}><Icon name="sparkle" size={16} /></button>
      <button
        className="btn ghost icon"
        title={`Switch look (${mod}${shift}T)`}
        onClick={() => settings && void updateSettings({ look: settings.look === 'playful' ? 'minimal' : 'playful' })}
      >
        <Icon name="palette" size={16} />
      </button>
    </header>
  );
}

/** One broken page must never take the whole window down. */
class PageBoundary extends Component<{ children: ReactNode; route: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { route: string }) {
    if (prev.route !== this.props.route && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty">
        <Icon name="warning" size={36} />
        <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>This page ran into a problem</div>
        <div className="small mono" style={{ maxWidth: 520 }}>{this.state.error.message}</div>
        <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}

function Page() {
  const { route } = useStore();
  const pages: Record<RouteName, () => React.ReactElement> = {
    home: () => <Home />,
    recents: () => <Library />,
    library: () => <Library />,
    screenshots: () => <Library />,
    source: () => <Library />,
    tag: () => <Library />,
    saved: () => <Search />,
    search: () => <Search />,
    browse: () => <Browse />,
    downloads: () => <Downloads />,
    duplicates: () => <Duplicates />,
    cleanup: () => <Cleanup />,
    space: () => <Space />,
    large: () => <Large />,
    startup: () => <Startup />,
    apps: () => <Apps />,
    protection: () => <Protection />,
    rules: () => <Rules />,
    history: () => <History />,
    assistant: () => <Assistant />,
    island: () => <IslandSettings />,
    widgets: () => <Widgets />,
    settings: () => <Settings />,
    tools: () => <Tools />,
    convert: () => <Convert />,
    health: () => <Health />,
    weather: () => <Weather />,
    capture: () => <Capture />,
    annotate: () => <Annotate />,
  };
  return pages[route.name]();
}

export function App() {
  const store = useStore();
  const [palette, setPalette] = useState(false);
  const fileRoutes: RouteName[] = ['home', 'recents', 'library', 'screenshots', 'source', 'tag', 'search', 'saved', 'browse', 'downloads', 'large'];
  const showInspector = store.inspector && fileRoutes.includes(store.route.name);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (cmd && k === 'k') { e.preventDefault(); setPalette((p) => !p); }
      else if (cmd && e.shiftKey && k === 't' && store.settings) { e.preventDefault(); void store.updateSettings({ look: store.settings.look === 'playful' ? 'minimal' : 'playful' }); }
      else if (cmd && e.shiftKey && k === 'd') { e.preventDefault(); store.go({ name: 'duplicates' }); }
      else if (cmd && e.shiftKey && k === 'k') { e.preventDefault(); store.go({ name: 'cleanup' }); }
      else if (cmd && e.shiftKey && k === 'j') { e.preventDefault(); store.go({ name: 'downloads' }); }
      else if (cmd && e.shiftKey && k === 'c') {
        const files = store.selection;
        if (files.length) { e.preventDefault(); void api.library.readText(files).then((r) => { const t = r.map((x) => x.text).filter(Boolean).join('\n\n'); if (t) { void api.files.copyText(t); store.toast(`Copied text from ${r.filter((x) => x.text).length} file(s)`); } else store.toast('No text found in the selection'); }); }
      }
      else if (cmd && !e.shiftKey && k === 'i') { e.preventDefault(); store.setInspector(!store.inspector); }
      else if (cmd && k === '1') { e.preventDefault(); store.setView('grid'); }
      else if (cmd && k === '2') { e.preventDefault(); store.setView('list'); }
      else if (cmd && (k === '=' || k === '+')) { e.preventDefault(); store.setCardSize(store.cardSize + 20); }
      else if (cmd && k === '-') { e.preventDefault(); store.setCardSize(store.cardSize - 20); }
      else if (cmd && k === '[') { e.preventDefault(); store.back(); }
      else if (cmd && k === ',') { e.preventDefault(); store.go({ name: 'settings' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  return (
    <div className="shell" style={{ gridTemplateColumns: `var(--sidebar) 1fr ${showInspector ? 'var(--inspector)' : '0px'}` }}>
      <Sidebar />
      <main className="main">
        <TopBar onPalette={() => setPalette(true)} />
        <div className="content"><PageBoundary route={`${store.route.name}:${store.route.arg ?? ''}:${store.route.q ?? ''}`}><Page /></PageBoundary></div>
      </main>
      {showInspector ? <Inspector /> : <div />}
      {palette ? <CommandPalette onClose={() => setPalette(false)} /> : null}
      <QuickLookHost />
      <div className="toast-stack">
        {store.toasts.map((t) => (
          <div className="toast" key={t.id}>
            <span>{t.text}</span>
            {t.action ? <button className="btn sm" onClick={t.action.run}>{t.action.label}</button> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
