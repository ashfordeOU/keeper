// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The main window: sidebar, search bar, the current page, and the inspector.

import { TabStrip } from './components/TabStrip';
import { RecoveryNotice } from './components/RecoveryNotice';
import { Alarms, RingHost } from './pim/Alarms';
import { Calendar } from './pim/Calendar';
import { Mail } from './pim/Mail';
import { PimSidebar } from './pim/PimSidebar';
import { Reminders } from './pim/Reminders';
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type { FileKind } from '../core/types';
import { api } from './api';
import { CommandPalette } from './components/CommandPalette';
import { Icon } from './components/Icon';
import { OwlMark } from './components/OwlMark';
import { UpdateBanner, WhatsNew } from './components/Updates';
import { Inspector } from './components/Inspector';
import { FeatureOff, navKey, useHiddenRoutes } from './features';
import { NavSection } from './components/NavSection';
import { TerminalApp } from './terminal/TerminalApp';
import { useTT } from './terminal/strings';
import { usePlaceMemory } from './place';
import { PlacesSidebar } from './components/PlacesSidebar';
import { Player } from './components/Player';
import { ContextMenu, KIND_COLOR } from './components/ui';
import { Apps } from './screens/Apps';
import { Assistant } from './screens/Assistant';
import { Agents } from './screens/Agents';
import { Graph } from './screens/Graph';
import { ApprovalHost } from './components/ApprovalHost';
import { Browse } from './screens/Browse';
import { Cleanup } from './screens/Cleanup';
import { Downloads } from './screens/Downloads';
import { Duplicates } from './screens/Duplicates';
import { Health } from './screens/Health';
import { KeepAwake } from './screens/KeepAwake';
import { Controls } from './screens/Controls';
import { Catalog } from './screens/Catalog';
import { AppControls } from './screens/AppControls';
import { Browsers } from './screens/Browsers';
import { Weather } from './screens/Weather';
// Places & Tracks (with its map) loads the first time the page opens.
const Tracks = lazy(() => import('./screens/Tracks').then((m) => ({ default: m.Tracks })));
import { useSurface } from './screens/TracksSurfaces';
import { useT } from './i18n';
import { History } from './screens/History';
import { Home } from './screens/Home';
import { IslandSettings } from './screens/IslandSettings';
import { Widgets } from './screens/Widgets';
// Wallpaper & Vibes loads the first time the page opens.
const Ambience = lazy(() => import('./screens/Ambience').then((m) => ({ default: m.Ambience })));
import { Large } from './screens/Large';
import { Library } from './screens/Library';
import { Security } from './screens/Security';
import { Todo } from './screens/Todo';
import { CoachHost, GuideHost, RouteHints, TourHost, useTodoCount } from './guide';
import { Rules } from './screens/Rules';
import { Search } from './screens/Search';
import { Settings } from './screens/Settings';
import { Space } from './screens/Space';
import { Startup } from './screens/Startup';
import { Tools } from './screens/Tools';
import { Convert } from './screens/Convert';
import { Capture } from './screens/Capture';
import { Annotate } from './screens/Annotate';
import { Network } from './screens/Network';
import { Trash } from './screens/Trash';
import { Remote } from './screens/Remote';
import { NetActivity } from './screens/NetActivity';
import { Vpn } from './screens/Vpn';
import { Firewall, FirewallAlerts } from './screens/Firewall';
import { Sync } from './screens/Sync';
import { NotesHub } from './screens/NotesHub';
// Notes (with its editor) loads the first time the page opens.
const NotesApp = lazy(() => import('./notes/NotesApp').then((m) => ({ default: m.NotesApp })));
// Cues (notes and checklists tied to an app, a site or a time) load the first time the page opens.
const CuesPage = lazy(() => import('./screens/Cues').then((m) => ({ default: m.Cues })));
const Dictation = lazy(() => import('./screens/Dictation').then((m) => ({ default: m.Dictation })));
const Meetings = lazy(() => import('./screens/Meetings').then((m) => ({ default: m.Meetings })));
// Stage mode's page (presets and settings) loads the first time it opens.
const StagePage = lazy(() => import('./screens/Stage').then((m) => ({ default: m.Stage })));
import { CloudSidebar } from './components/CloudSidebar';
import { DevicesSidebar, LinkPrompts } from './components/LinkParts';
import { ScreenPrompts } from './screen/ScreenParts';
import { Devices } from './screens/Devices';
// Keeper Mesh and Remote Desktops (with its session views) load the first time their pages open.
const Mesh = lazy(() => import('./screens/Mesh').then((m) => ({ default: m.Mesh })));
const RemoteDesktops = lazy(() => import('./screens/RemoteDesktop').then((m) => ({ default: m.RemoteDesktops })));
import { ForceQuitHost } from './screens/Processes';
import { mod, shift, useAsync, useStore, type Route, type RouteName } from './state';
import { QuickLookHost } from './preview/QuickLook';
import { toggleThemePatch } from './theme';

const contentEl = () => document.querySelector<HTMLElement>('.main > .content');

const SHELVES: FileKind[] = ['image', 'video', 'audio', 'document', 'archive', 'installer', 'app'];

/** Places & Tracks, unless its settings leave it out of the sidebar. */
function TracksNav() {
  const on = useSurface('sidebar');
  return on ? <NavItem route={{ name: 'tracks' }} icon="map" label="Places & Tracks" /> : null;
}

/** To do, with how many things are worth doing. */
function TodoNav() {
  const n = useTodoCount();
  return <NavItem route={{ name: 'todo' }} icon="check" label="To do" count={n || undefined} />;
}

function NavItem({ route, icon, label, count, color }: { route: Route; icon?: string; label: string; count?: number | string; color?: string }) {
  const { route: cur, go, settings, updateSettings, tabs } = useStore();
  const hiddenRoutes = useHiddenRoutes();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const active = cur.name === route.name && (cur.arg ?? '') === (route.arg ?? '');
  const key = navKey(route.name, route.arg);
  // Off in Settings → Features, or hidden with "Customize sidebar…" (the page you are on stays).
  if (!active && (hiddenRoutes.has(route.name) || settings?.sidebarHidden?.includes(key))) return null;
  return (
    <>
    {menu ? (
      <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
        ...(settings?.tabs !== false ? [{ label: 'Open in New Tab', icon: 'plus', run: () => tabs.open(route) }, { sep: true, label: '' }] : []),
        { label: 'Remove from Sidebar', icon: 'close', run: () => settings && void updateSettings({ sidebarHidden: [...(settings.sidebarHidden ?? []), key] }) },
        { label: 'Customize Sidebar…', icon: 'settings', run: () => go({ name: 'settings', arg: 'sidebar' }) },
      ]} />
    ) : null}
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={() => go(route)} title={label} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}>
      {color ? <span className="dot" style={{ background: color }} /> : <Icon name={icon ?? 'folder'} size={15} />}
      <span className="label ellipsis">{label}</span>
      {count !== undefined ? <span className="count">{count}</span> : null}
    </button>
    </>
  );
}

function Sidebar() {
  const { settings, version, info } = useStore();
  const t = useT();
  const tt = useTT();
  const totals = useAsync(() => api.library.totals(), [version]);
  const tags = useAsync(() => api.library.tags(), [version]);
  const short = (n?: number) => (n === undefined ? undefined : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
  return (
    <aside className="sidebar">
      <div className="brand" title="Keeper by Ashforde®"><OwlMark tile size={26} title="Keeper by Ashforde®" /><span className="brand-name">Keeper<small>by Ashforde®</small></span></div>
      <NavItem route={{ name: 'home' }} icon="home" label={t('nav.home')} />
      <NavItem route={{ name: 'recents' }} icon="clock" label={t('nav.recents')} />
      <NavItem route={{ name: 'browse', arg: info?.home }} icon="folder" label={t('nav.browse')} />
      <NavItem route={{ name: 'downloads' }} icon="down" label={t('nav.downloads')} />
      <NavItem route={{ name: 'weather' }} icon="sun" label={t('nav.weather')} />
      <TracksNav />

      <NavSection id="library" title={t('section.library')}>
        {SHELVES.map((k) => <NavItem key={k} route={{ name: 'library', arg: k }} color={KIND_COLOR[k]} label={t(`kind.${k}`)} count={short(totals.data?.[k].count)} />)}
        <NavItem route={{ name: 'screenshots' }} icon="screenshot" label={t('kind.screenshot')} />
      </NavSection>

      {settings?.savedSearches.length ? (
        <NavSection id="saved" title={t('section.saved')}>
          {settings.savedSearches.map((s) => <NavItem key={s.id} route={{ name: 'search', q: s.text, arg: s.id }} icon="search" label={s.name} />)}
        </NavSection>
      ) : null}

      {/* Favorites (pinned folders included) and Locations: disks, cloud, network, Trash. */}
      <PlacesSidebar />
      {/* Cloud services, servers, home servers and other computers. */}
      <CloudSidebar />
      {/* Paired devices and phones (Keeper Link); drop files on one to send them. */}
      <DevicesSidebar />

      {/* Mail, calendars, reminders and alarms. */}
      <PimSidebar Item={NavItem} />

      <NavSection id="sync" title="Sync & Backup">
        <NavItem route={{ name: 'sync', arg: 'folders' }} icon="refresh" label="Synced folders" />
        <NavItem route={{ name: 'sync', arg: 'backups' }} icon="shield" label="Backups" />
        <NavItem route={{ name: 'sync', arg: 'mirrors' }} icon="cloud" label="Cloud mirrors" />
        <NavItem route={{ name: 'sync', arg: 'versions' }} icon="history" label="Older versions" />
        <NavItem route={{ name: 'noteshub' }} icon="note" label="Notes Everywhere" />
      </NavSection>

      {tags.data?.length ? (
        <NavSection id="tags" title={t('section.tags')}>
          {tags.data.slice(0, 8).map((t) => <NavItem key={t.tag} route={{ name: 'tag', arg: t.tag }} icon="tag" label={t.tag} count={t.count} />)}
        </NavSection>
      ) : null}

      <NavSection id="tidy" title={t('section.tidy')}>
        <NavItem route={{ name: 'cleanup' }} icon="broom" label={t('nav.cleanup')} />
        <NavItem route={{ name: 'duplicates' }} icon="dupes" label={t('nav.duplicates')} />
        <NavItem route={{ name: 'space' }} icon="map" label={t('nav.space')} />
        <NavItem route={{ name: 'large' }} icon="weight" label={t('nav.large')} />
        <NavItem route={{ name: 'convert' }} icon="refresh" label={t('nav.convert')} />
        <NavItem route={{ name: 'rules' }} icon="rules" label={t('nav.rules')} />
      </NavSection>

      <NavSection id="system" title={t('section.system')}>
        <TodoNav />
        <NavItem route={{ name: 'health' }} icon="bolt" label={t('nav.health')} />
        <NavItem route={{ name: 'awake' }} icon="coffee" label="Keep Awake" />
        <NavItem route={{ name: 'stage' }} icon="eye" label="Stage" />
        <NavItem route={{ name: 'startup' }} icon="power" label={t('nav.startup')} />
        <NavItem route={{ name: 'apps' }} icon="app" label={t('nav.apps')} />
        <NavItem route={{ name: 'protection' }} icon="shield" label={t('nav.protection')} />
        <NavItem route={{ name: 'netactivity' }} icon="globe" label={t('nav.netactivity')} />
        <NavItem route={{ name: 'vpn' }} icon="lock" label={t('nav.vpn')} />
        <NavItem route={{ name: 'mesh' }} icon="graph" label="Mesh" />
        <NavItem route={{ name: 'firewall' }} icon="shield" label="Firewall" />
        <NavItem route={{ name: 'controls' }} icon="settings" label="Quick Controls" />
        <NavItem route={{ name: 'catalog' }} icon="settings" label="System Settings+" />
        <NavItem route={{ name: 'appcontrols' }} icon="cpu" label="App controls" />
        <NavItem route={{ name: 'browsers' }} icon="globe" label="Browser tabs" />
        <NavItem route={{ name: 'settings', arg: 'processes' }} icon="power" label="Keeper’s processes" />
      </NavSection>

      <NavSection id="more" title={t('section.more')}>
        <NavItem route={{ name: 'notes' }} icon="document" label="Notes" />
        <NavItem route={{ name: 'cues' }} icon="pin" label="Cues" />
        <NavItem route={{ name: 'assistant' }} icon="assistant" label={t('nav.assistant')} />
        <NavItem route={{ name: 'agents' }} icon="agent" label="Agents" />
        <NavItem route={{ name: 'graph' }} icon="graph" label="Knowledge Graph" />
        <NavItem route={{ name: 'capture' }} icon="screenshot" label={t('nav.capture')} />
        <NavItem route={{ name: 'dictation' }} icon="mic" label="Dictation" />
        <NavItem route={{ name: 'meetings' }} icon="calendar" label="Meetings" />
        <NavItem route={{ name: 'terminal' }} icon="terminal" label={tt('title')} />
        <NavItem route={{ name: 'rdc' }} icon="laptop" label="Remote Desktops" />
        <NavItem route={{ name: 'tools' }} icon="terminal" label={t('nav.toolbox')} />
        <NavItem route={{ name: 'island' }} icon="island" label={t('nav.island')} />
        <NavItem route={{ name: 'ambience' }} icon="palette" label="Wallpaper & Vibes" />
        <NavItem route={{ name: 'widgets' }} icon="grid" label={t('nav.widgets')} />
        <NavItem route={{ name: 'history' }} icon="history" label={t('nav.history')} />
        <NavItem route={{ name: 'settings' }} icon="settings" label={t('nav.settings')} />
      </NavSection>
    </aside>
  );
}

function TopBar({ onPalette }: { onPalette: () => void }) {
  const { route, go, back, canBack, forward, canForward, settings, updateSettings } = useStore();
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
      {canForward ? <button className="btn ghost icon sm" onClick={forward} title="Forward"><Icon name="chevronRight" size={16} /></button> : null}
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
        title={`Switch theme (${mod}${shift}T)`}
        onClick={() => settings && void updateSettings(toggleThemePatch(settings))}
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
  const hiddenRoutes = useHiddenRoutes();
  if (hiddenRoutes.has(route.name)) return <FeatureOff route={route.name} />;
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
    protection: () => <Security />,
    todo: () => <Todo />,
    rules: () => <Rules />,
    history: () => <History />,
    assistant: () => <Assistant />,
    island: () => <IslandSettings />,
    widgets: () => <Widgets />,
    ambience: () => <Suspense fallback={null}><Ambience /></Suspense>,
    settings: () => <Settings />,
    tools: () => <Tools />,
    convert: () => <Convert />,
    health: () => <Health />,
    awake: () => <KeepAwake />,
    dictation: () => <Suspense fallback={null}><Dictation key={route.arg ?? ''} initialTab={route.arg} /></Suspense>,
    meetings: () => <Suspense fallback={null}><Meetings key={route.arg ?? ''} initial={route.arg} /></Suspense>,
    stage: () => <Suspense fallback={null}><StagePage /></Suspense>,
    weather: () => <Weather />,
    tracks: () => <Suspense fallback={null}><Tracks key={route.arg?.startsWith('file:') ? route.arg : ''} /></Suspense>,
    capture: () => <Capture />,
    annotate: () => <Annotate />,
    network: () => <Network />,
    trash: () => <Trash />,
    remote: () => <Remote />,
    netactivity: () => <NetActivity />,
    agents: () => <Agents />,
    graph: () => <Graph />,
    vpn: () => <Vpn />,
    firewall: () => <Firewall />,
    controls: () => <Controls />,
    catalog: () => <Catalog />,
    appcontrols: () => <AppControls />,
    browsers: () => <Browsers />,
    sync: () => <Sync key={route.arg ?? ''} />,
    noteshub: () => <NotesHub key={route.arg ?? ''} />,
    notes: () => <Suspense fallback={null}><NotesApp /></Suspense>,
    cues: () => <Suspense fallback={null}><CuesPage /></Suspense>,
    terminal: () => <TerminalApp mode="page" startCwd={route.arg} openSession={route.q?.startsWith('session:') ? route.q.slice(8) : undefined} />,
    rdc: () => <Suspense fallback={null}><RemoteDesktops /></Suspense>,
    devices: () => <Devices />,
    mesh: () => <Suspense fallback={null}><Mesh /></Suspense>,
    mail: () => <Mail />,
    calendar: () => <Calendar />,
    reminders: () => <Reminders />,
    alarms: () => <Alarms />,
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
      else if (cmd && e.shiftKey && k === 'l' && store.settings) { e.preventDefault(); void store.updateSettings(toggleThemePatch(store.settings)); }
      // ⌘⇧. / Ctrl+Shift+. shows or hides hidden files, as in the system file manager.
      else if (cmd && e.shiftKey && (e.code === 'Period' || k === '.' || k === '>') && store.settings) { e.preventDefault(); void store.updateSettings({ showHidden: !store.settings.showHidden }); store.toast(store.settings.showHidden ? 'Hidden files are hidden' : 'Hidden files are shown'); }
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

  // Scroll positions come back too, after a page change, an update or a restart.
  usePlaceMemory(store.route, contentEl);

  return (
    <div className="shell" style={{ gridTemplateColumns: `var(--sidebar) 1fr ${showInspector ? 'var(--inspector)' : '0px'}` }}>
      <Sidebar />
      <main className="main">
        <TopBar onPalette={() => setPalette(true)} />
        {/* Tabs: middle-click or ⌘/Ctrl-click anything to open it in a new one; they survive restarts and crashes. */}
        <TabStrip />
        <RecoveryNotice />
        <div className="content"><UpdateBanner /><CoachHost route={store.route} /><RouteHints route={store.route} /><PageBoundary route={`${store.route.name}:${store.route.arg ?? ''}:${store.route.q ?? ''}`}><Page /></PageBoundary></div>
      </main>
      {showInspector ? <Inspector /> : <div />}
      {palette ? <CommandPalette onClose={() => setPalette(false)} /> : null}
      <WhatsNew />
      <QuickLookHost />
      {/* An alarm or timer that is ringing, with Snooze and Stop. */}
      <RingHost />
      <LinkPrompts />
      <ScreenPrompts />
      <ForceQuitHost />
      <FirewallAlerts />
      <ApprovalHost />
      {/* Guided fixes: the step-by-step panel and the first-run tour. */}
      <GuideHost />
      <TourHost />
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
