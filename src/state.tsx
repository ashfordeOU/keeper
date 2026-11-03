// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// App-wide state: the current page, selection, inspector, music player,
// settings and toasts. Small enough that plain React context does the job.

import { linkInMessage } from '../core/settings-links';
import { expireToast, pushToast, toastLife } from './lib/toasts';
import { rememberRoute, scrollMap, seedScroll, setPlaceMemory, startPlace, onScrollChanged } from './place';
import { IS_PAGE_WINDOW, IS_SOLO, openInWindow, PAGE_WINDOW_PAGE, PAGE_WINDOW_START } from './page-window';
import { soloKeepsRoute } from '../core/solo';
import { activeTab, closeOthers, closeTab, closeToRight, detachTab, duplicateTab, emptyWindow, goBack, goForward, moveTab, navigate, newTab, openTab, pinTab, reopenClosed, selectTab, type Tab, type WindowState } from '../core/session';
import type { SessionInitial } from '../core/api-session';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SystemInfo } from '../core/api';
import type { AllSettings } from '../core/settings';
import type { CleanResult, FileEntry } from '../core/types';
import { api } from './api';
import { applyTheme, onNewDay, onSystemAppearance } from './theme';
import { applyA11y } from './a11y';
import { formatBytes } from '../core/format';
import { asInspectorMode, clampInspectorWidth, inspectorVisible, nextForced, INSPECTOR_DEFAULT_WIDTH } from '../core/inspector';
import { resolveView, viewScope, type FileView } from '../core/folder-view';
import { resolveRoute } from '../core/nav';

export type RouteName =
  | 'home' | 'recents' | 'library' | 'screenshots' | 'search' | 'browse' | 'downloads' | 'source' | 'tag' | 'saved'
  | 'duplicates' | 'cleanup' | 'space' | 'large' | 'startup' | 'apps' | 'protection' | 'rules' | 'history'
  | 'assistant' | 'island' | 'settings' | 'tools' | 'health' | 'capture' | 'annotate' | 'convert' | 'widgets' | 'ambience' | 'weather' | 'network' | 'trash' | 'remote' | 'terminal' | 'sync' | 'devices' | 'netactivity' | 'vpn' | 'firewall' | 'agents' | 'graph' | 'mail' | 'calendar' | 'reminders' | 'planner' | 'alarms' | 'todo' | 'awake' | 'stage' | 'controls' | 'catalog' | 'appcontrols' | 'browsers' | 'noteshub' | 'notes' | 'rdc' | 'mesh' | 'tracks'
  | 'cues' | 'dictation' | 'meetings' | 'aiusage' | 'studio' | 'security' | 'snippets' | 'blocking' | 'time' | 'journal' | 'reader' | 'alerts';

/** Pages that list files, where the Inspector can show. */
export const FILE_ROUTES: RouteName[] = ['home', 'recents', 'library', 'screenshots', 'source', 'tag', 'search', 'saved', 'browse', 'downloads', 'large'];

export interface Route {
  name: RouteName;
  /** kind for library, source id, tag, saved search id, folder for browse */
  arg?: string;
  /** search text */
  q?: string;
}

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  /** the same message asked for again while showing (shown as ×N) */
  count: number;
  at: number;
}

export interface TabsApi {
  tabs: Tab[];
  active: string;
  /** opens a page in a new tab (in the background when asked) */
  open(r: Route, opts?: { background?: boolean }): void;
  select(id: string): void;
  close(id: string): void;
  reopenClosed(): void;
  closedCount: number;
  move(id: string, to: number): void;
  pin(id: string, pinned: boolean): void;
  duplicate(id: string): void;
  closeOthers(id: string): void;
  closeToRight(id: string): void;
  /** moves a tab into a window of its own */
  toWindow(id: string): void;
}

interface Store {
  route: Route;
  go(r: Route): void;
  back(): void;
  canBack: boolean;
  forward(): void;
  canForward: boolean;
  /** this window's tabs (each keeps its own page, history, scroll and drafts) */
  tabs: TabsApi;
  /** text typed into a field and not yet sent, kept per tab across crashes and restarts */
  draft(field: string): string;
  setDraft(field: string, text: string): void;
  /** what this window opened with (crash, safe mode) */
  boot: SessionInitial;
  info: SystemInfo | null;
  settings: AllSettings | null;
  updateSettings(patch: Partial<AllSettings>): Promise<void>;
  selection: string[];
  setSelection(paths: string[]): void;
  /** whether the Inspector shows now (the setting, the selection and the Show/Hide toggle together) */
  inspector: boolean;
  /** Show/Hide Inspector: wins over the setting until the selection next starts or ends */
  setInspector(v: boolean): void;
  /** this window's Inspector width (kept with the window's tabs, so it comes back after a restart) */
  inspectorWidth: number;
  setInspectorWidth(px: number): void;
  focused: FileEntry | null;
  setFocused(f: FileEntry | null): void;
  playing: FileEntry | null;
  play(f: FileEntry | null): void;
  /** this page's view: icons, list, columns (real folders) or gallery; remembered per kind of page */
  view: FileView;
  setView(v: FileView): void;
  cardSize: number;
  setCardSize(n: number): void;
  toasts: Toast[];
  toast(text: string, action?: Toast['action']): void;
  /** bumps whenever files change, so lists reload */
  version: number;
  refresh(): void;
  /** trash with an Undo toast */
  trash(paths: string[], title?: string): Promise<CleanResult>;
}

const Ctx = createContext<Store | null>(null);

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

/** What this window opens with: its saved tabs (after a restart, an update or a crash), or a fresh Home tab. */
function readBoot(): SessionInitial {
  const fallback: SessionInitial = { key: 'main', state: null, crashed: false, safeMode: false };
  try {
    return (api.session?.initial?.() as SessionInitial | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}

// A middle-click, or ⌘/Ctrl-click, on anything that opens a page opens it in a new tab instead.
let newTabIntent: { background: boolean; at: number } | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey) newTabIntent = { background: !e.shiftKey, at: Date.now() };
  }, true);
  window.addEventListener('mousedown', (e) => {
    // No autoscroll or paste on a middle-click over something clickable.
    if (e.button === 1 && (e.target as HTMLElement | null)?.closest('button, a, [role="button"], .nav-item')) e.preventDefault();
  }, true);
  window.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('button, a, [role="button"], .nav-item');
    if (!el || el.closest('.tab-strip')) return;
    e.preventDefault();
    newTabIntent = { background: true, at: Date.now() };
    el.click();
    newTabIntent = null;
  }, true);
}
function takeNewTabIntent(): { background: boolean } | null {
  const i = newTabIntent;
  newTabIntent = null;
  return i && Date.now() - i.at < 400 ? i : null;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  // Tabs, pages and drafts come back after an update, a restart or a crash (Settings → Reopen where I left off).
  const boot = useMemo(readBoot, []);
  const [win, setWin] = useState<WindowState>(() => {
    if (boot.state) {
      seedScroll(boot.state.scroll);
      return boot.state;
    }
    // A page in a window of its own starts on its page; the main window where it was left.
    if (PAGE_WINDOW_START) return emptyWindow(boot.key, PAGE_WINDOW_START as Route);
    const w = emptyWindow(boot.key, startPlace?.route ?? { name: 'home' });
    w.tabs[0].back = (startPlace?.history ?? []).slice(-30);
    return w;
  });
  const tab = activeTab(win);
  // Old routes that moved (Keeper's processes → Health, …) land on the new place, from links, history and restored tabs alike.
  const route = useMemo(() => resolveRoute(tab.route as Route), [tab.route]);
  const history = useRef<Route[]>([]);
  history.current = tab.back as Route[];
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [settings, setSettings] = useState<AllSettings | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [focused, setFocused] = useState<FileEntry | null>(null);
  const [inspectorForced, setInspectorForced] = useState<boolean | null>(null);
  const [inspectorWidth, setInspectorWidthState] = useState<number>(() => clampInspectorWidth(boot.state?.inspectorWidth ?? load('inspectorWidth', INSPECTOR_DEFAULT_WIDTH)));
  // Clearing the selection clears the file the Inspector follows too.
  const select = useCallback((paths: string[]) => { setSelection(paths); if (!paths.length) setFocused(null); }, []);
  const [playing, play] = useState<FileEntry | null>(null);
  // Each kind of page keeps its own view (real folders, each Library collection, everything else).
  const [views, setViews] = useState<Record<string, FileView>>(() => load('views', {}));
  const legacyView = useMemo(() => load<'grid' | 'list'>('view', 'grid'), []);
  const [cardSize, setCardSizeState] = useState<number>(() => load('cardSize', 150));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    void api.system.info().then((i) => {
      setInfo(i);
      document.documentElement.dataset.platform = i.platform;
    });
    void api.settings.get().then(setSettings);
    const offs = [
      api.on('library-changed', () => setVersion((v) => v + 1)),
      api.on('settings-changed', (next) => setSettings(next)),
      api.on('navigate', (r: string) => {
        const i = r.indexOf(':');
        const name = i < 0 ? r : r.slice(0, i);
        const arg = i < 0 ? undefined : r.slice(i + 1);
        setWin((w) => navigate(w, { name: name as RouteName, arg }));
      }),
      // A connection opened from the keeper command (keeper rdc connect …) opens in a new tab here.
      api.on('navigate-tab', (r) => {
        const { window: own, ...route } = r as Route & { window?: boolean };
        // A remote desktop the person likes in windows of its own (Remote Desktops → Places).
        if (own && api.session?.openWindow) { const t = newTab(route); void api.session.openWindow({ key: 'new', tabs: [t], active: t.id, scroll: {}, drafts: {}, closed: [] }); }
        else setWin((w) => openTab(w, route));
      }),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  // Where the main window was, for its next start (a page window's place is its own session's).
  useEffect(() => { if (!IS_PAGE_WINDOW) rememberRoute(route, tab.back as Route[]); }, [route, tab.back]);
  // Anonymous usage stats count page opens by name only (nothing is kept while they are off).
  useEffect(() => { void api.usageStats?.page(route.name).catch(() => undefined); }, [route.name]);
  useEffect(() => {
    if (settings) setPlaceMemory(settings.restorePlace !== false);
  }, [settings]);

  // Apply the theme, look and appearance to the document (and again when the system goes light or dark).
  useEffect(() => {
    if (!settings) return;
    applyTheme(settings);
    const offSystem = onSystemAppearance(() => applyTheme(settings));
    // "Follow the seasons" moves on at midnight on the day the season changes.
    const offDay = settings.themeSeasons ? onNewDay(() => applyTheme(settings)) : () => undefined;
    return () => { offSystem(); offDay(); };
  }, [settings]);
  // Settings → Accessibility: motion, text size and focus outlines, in every window.
  useEffect(() => (settings ? applyA11y(settings.a11y) : undefined), [settings]);

  // A page window has no tabs: ⌘-click and middle-click open in it as a plain click does.
  const tabsOn = settings?.tabs !== false && !IS_PAGE_WINDOW;
  const go = useCallback((r: Route) => {
    // A light app (Keeper Mail…) keeps its own part; another page opens in its app's window or in Keeper.
    if (IS_SOLO && !soloKeepsRoute(PAGE_WINDOW_PAGE, r)) { void openInWindow(r); return; }
    const intent = tabsOn ? takeNewTabIntent() : null;
    setWin((w) => (intent ? openTab(w, r, { background: intent.background }) : navigate(w, r)));
    if (!intent || !intent.background) select([]);
  }, [tabsOn, select]);

  const back = useCallback(() => setWin(goBack), []);
  const forward = useCallback(() => setWin(goForward), []);

  // Drafts: whatever was typed and not yet sent, per tab, saved with the tabs.
  const drafts = useRef<Record<string, string>>(boot.state?.drafts ?? {});
  const [draftsVersion, bumpDrafts] = useState(0);
  // Depends on draftsVersion so pages re-render (and controlled fields keep what was typed) after each change.
  const draft = useCallback((field: string) => drafts.current[`${win.active}:${field}`] ?? '', [win.active, draftsVersion]);

  // Saved within a second of any change (tabs, pages, scroll or drafts), and right away when the window goes away.
  const saveTimer = useRef<number | undefined>(undefined);
  const winRef = useRef(win);
  winRef.current = win;
  const saveNow = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    try { api.session?.save?.({ ...winRef.current, scroll: scrollMap(), drafts: drafts.current }); } catch { /* not available */ }
  }, []);
  const saveSoon = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(saveNow, 500);
  }, [saveNow]);
  const setDraft = useCallback((field: string, text: string) => {
    const k = `${winRef.current.active}:${field}`;
    if (text) drafts.current[k] = text;
    else delete drafts.current[k];
    bumpDrafts((n) => n + 1);
    saveSoon();
  }, [saveSoon]);
  useEffect(() => { saveSoon(); }, [win, saveSoon]);
  useEffect(() => {
    const off = onScrollChanged(saveSoon);
    const hide = () => { if (document.visibilityState === 'hidden') saveNow(); };
    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', hide);
    return () => { off(); window.removeEventListener('pagehide', saveNow); document.removeEventListener('visibilitychange', hide); };
  }, [saveSoon, saveNow]);

  const tabs = useMemo<TabsApi>(() => ({
    tabs: win.tabs,
    active: win.active,
    closedCount: win.closed.length,
    open: (r, o) => setWin((w) => openTab(w, r, o)),
    select: (id) => { setWin((w) => selectTab(w, id)); select([]); },
    close: (id) => {
      for (const k of Object.keys(drafts.current)) if (k.startsWith(`${id}:`)) delete drafts.current[k];
      setWin((w) => closeTab(w, id));
    },
    reopenClosed: () => setWin(reopenClosed),
    move: (id, to) => setWin((w) => moveTab(w, id, to)),
    pin: (id, p) => setWin((w) => pinTab(w, id, p)),
    duplicate: (id) => setWin((w) => { const d = duplicateTab({ ...w, drafts: drafts.current }, id); drafts.current = d.drafts; return d; }),
    closeOthers: (id) => setWin((w) => closeOthers(w, id)),
    closeToRight: (id) => setWin((w) => closeToRight(w, id)),
    toWindow: (id) => {
      const { rest, tab: moved, drafts: d } = detachTab({ ...winRef.current, drafts: drafts.current }, id);
      if (!moved) return;
      drafts.current = rest.drafts;
      setWin(rest);
      void api.session?.openWindow?.({ key: 'new', tabs: [moved], active: moved.id, scroll: scrollMap(), drafts: d, closed: [] });
    },
  }), [win]);

  const updateSettings = useCallback(async (patch: Partial<AllSettings>) => {
    setSettings(await api.settings.set(patch));
  }, []);

  const toast = useCallback((text: string, action?: Toast['action']) => {
    // A message that names a place in Keeper ("…in Settings → AI & Brain") opens it.
    if (!action) {
      const link = linkInMessage(text);
      if (link) {
        const i = link.route.indexOf(':');
        const route = { name: (i < 0 ? link.route : link.route.slice(0, i)) as RouteName, arg: i < 0 ? undefined : link.route.slice(i + 1) };
        action = { label: 'Open', run: () => setWin((w) => navigate(w, route)) };
      }
    }
    // The same text again while it shows collapses into one toast with a count.
    let id = Date.now() + Math.random();
    setToasts((t) => {
      const r = pushToast(t, text, action, Date.now(), id);
      id = r.id;
      return r.list;
    });
    setTimeout(() => setToasts((t) => expireToast(t, id, Date.now())), toastLife(!!action));
  }, []);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // A toast asked for from outside React (a failure nobody caught: src/lib/quiet-errors.ts).
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ text: string; action?: { label: string; route: string } }>).detail;
      if (!d?.text) return;
      const a = d.action;
      toast(d.text, a ? { label: a.label, run: () => { const i = a.route.indexOf(':'); go(i < 0 ? { name: a.route as RouteName } : { name: a.route.slice(0, i) as RouteName, arg: a.route.slice(i + 1) }); } } : undefined);
    };
    window.addEventListener('keeper-toast', on);
    return () => window.removeEventListener('keeper-toast', on);
  }, [toast, go]);

  const trash = useCallback(async (paths: string[], title?: string) => {
    const r = await api.files.trash(paths, title);
    refresh();
    select([]);
    const msg = r.failed ? `Moved ${r.removed} to the Trash, ${r.failed} could not be moved` : `Moved ${r.removed} item${r.removed === 1 ? '' : 's'} to the Trash · ${formatBytes(r.freed)} freed`;
    toast(msg, r.journalId ? { label: 'Undo', run: () => void api.history.undo(r.journalId!).then(refresh) } : undefined);
    return r;
  }, [refresh, toast, select]);

  // The Inspector: shown by the setting and the selection, unless Show/Hide Inspector says otherwise.
  const inspectorMode = asInspectorMode(settings?.inspectorMode);
  const hasSelection = selection.length > 0 || !!focused;
  const hadSelection = useRef(hasSelection);
  useEffect(() => {
    if (hadSelection.current === hasSelection) return;
    setInspectorForced((f) => nextForced(f, inspectorMode, hadSelection.current, hasSelection));
    hadSelection.current = hasSelection;
  }, [hasSelection, inspectorMode]);
  useEffect(() => setInspectorForced(null), [inspectorMode]);
  const inspector = inspectorVisible({ mode: inspectorMode, hasSelection, filePage: FILE_ROUTES.includes(route.name), forced: inspectorForced });
  const setInspectorWidth = useCallback((px: number) => {
    const w = clampInspectorWidth(px);
    setInspectorWidthState(w);
    save('inspectorWidth', w);
    setWin((x) => (x.inspectorWidth === w ? x : { ...x, inspectorWidth: w }));
  }, []);

  const store = useMemo<Store>(() => ({
    route, go, back, canBack: tab.back.length > 0, forward, canForward: tab.fwd.length > 0, tabs, draft, setDraft, boot,
    info, settings, updateSettings, selection, setSelection: select,
    inspector, setInspector: (v) => setInspectorForced(v), inspectorWidth, setInspectorWidth,
    focused, setFocused, playing, play,
    view: resolveView(viewScope(route), views, legacyView),
    setView: (v) => setViews((cur) => { const next = { ...cur, [viewScope(route)]: v }; save('views', next); return next; }),
    cardSize, setCardSize: (n) => { const c = Math.max(100, Math.min(280, n)); setCardSizeState(c); save('cardSize', c); },
    toasts, toast, version, refresh, trash,
  }), [route, go, back, forward, tab, tabs, draft, setDraft, boot, info, settings, updateSettings, selection, select, inspector, inspectorWidth, setInspectorWidth, focused, playing, views, legacyView, cardSize, toasts, toast, version, refresh, trash]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

/** Loads async data and reloads when deps change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, loading, error, reload: () => setN((x) => x + 1) };
}

/** Cmd on macOS, Ctrl elsewhere. */
export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
export const mod = isMac ? '⌘' : 'Ctrl+';
export const shift = isMac ? '⇧' : 'Shift+';
