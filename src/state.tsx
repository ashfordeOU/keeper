// SPDX-License-Identifier: AGPL-3.0-or-later
// App-wide state: the current page, selection, inspector, music player,
// settings and toasts. Small enough that plain React context does the job.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SystemInfo } from '../core/api';
import type { AllSettings } from '../core/settings';
import type { CleanResult, FileEntry } from '../core/types';
import { api } from './api';
import { applyTheme, onSystemAppearance } from './theme';
import { formatBytes } from '../core/format';

export type RouteName =
  | 'home' | 'recents' | 'library' | 'screenshots' | 'search' | 'browse' | 'downloads' | 'source' | 'tag' | 'saved'
  | 'duplicates' | 'cleanup' | 'space' | 'large' | 'startup' | 'apps' | 'protection' | 'rules' | 'history'
  | 'assistant' | 'island' | 'settings' | 'tools' | 'health' | 'capture' | 'annotate' | 'convert' | 'widgets' | 'weather' | 'network' | 'trash';

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
}

interface Store {
  route: Route;
  go(r: Route): void;
  back(): void;
  canBack: boolean;
  info: SystemInfo | null;
  settings: AllSettings | null;
  updateSettings(patch: Partial<AllSettings>): Promise<void>;
  selection: string[];
  setSelection(paths: string[]): void;
  inspector: boolean;
  setInspector(v: boolean): void;
  focused: FileEntry | null;
  setFocused(f: FileEntry | null): void;
  playing: FileEntry | null;
  play(f: FileEntry | null): void;
  view: 'grid' | 'list';
  setView(v: 'grid' | 'list'): void;
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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const history = useRef<Route[]>([]);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [settings, setSettings] = useState<AllSettings | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [inspector, setInspectorState] = useState<boolean>(() => load('inspector', true));
  const [focused, setFocused] = useState<FileEntry | null>(null);
  const [playing, play] = useState<FileEntry | null>(null);
  const [view, setViewState] = useState<'grid' | 'list'>(() => load('view', 'grid'));
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
        const [name, arg] = r.split(':');
        setRoute({ name: name as RouteName, arg });
      }),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  // Apply the theme, look and appearance to the document (and again when the system goes light or dark).
  useEffect(() => {
    if (!settings) return;
    applyTheme(settings);
    return onSystemAppearance(() => applyTheme(settings));
  }, [settings]);

  const go = useCallback((r: Route) => {
    setRoute((cur) => {
      if (cur.name !== r.name || cur.arg !== r.arg || cur.q !== r.q) history.current.push(cur);
      return r;
    });
    setSelection([]);
  }, []);

  const back = useCallback(() => {
    const prev = history.current.pop();
    if (prev) setRoute(prev);
  }, []);

  const updateSettings = useCallback(async (patch: Partial<AllSettings>) => {
    setSettings(await api.settings.set(patch));
  }, []);

  const toast = useCallback((text: string, action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 8000 : 4000);
  }, []);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const trash = useCallback(async (paths: string[], title?: string) => {
    const r = await api.files.trash(paths, title);
    refresh();
    setSelection([]);
    const msg = r.failed ? `Moved ${r.removed} to the Trash, ${r.failed} could not be moved` : `Moved ${r.removed} item${r.removed === 1 ? '' : 's'} to the Trash · ${formatBytes(r.freed)} freed`;
    toast(msg, r.journalId ? { label: 'Undo', run: () => void api.history.undo(r.journalId!).then(refresh) } : undefined);
    return r;
  }, [refresh, toast]);

  const store = useMemo<Store>(() => ({
    route, go, back, canBack: history.current.length > 0, info, settings, updateSettings, selection, setSelection,
    inspector, setInspector: (v) => { setInspectorState(v); save('inspector', v); },
    focused, setFocused, playing, play,
    view, setView: (v) => { setViewState(v); save('view', v); },
    cardSize, setCardSize: (n) => { const c = Math.max(100, Math.min(280, n)); setCardSizeState(c); save('cardSize', c); },
    toasts, toast, version, refresh, trash,
  }), [route, go, back, info, settings, updateSettings, selection, inspector, focused, playing, view, cardSize, toasts, toast, version, refresh, trash]);

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
