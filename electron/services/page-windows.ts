// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Any page of Keeper in a window of its own ("Open in New Window"; core/page-window.ts).
//
// A page window loads the same interface and preload as the main window
// (view=page), so every call and every broadcast event reaches it; it shows
// only its page, without the sidebar or tabs. One window per page: asking for
// a page that has a window brings that window forward. Its size and place are
// kept per page in settings (pageWindows) and fitted to the displays connected
// now. Closing one never quits Keeper.

import { app, BrowserWindow, ipcMain, nativeTheme, screen } from 'electron';
import path from 'node:path';
import { APP_NAME } from '../../core/brand';
import { cleanRoute, PAGE_WINDOW_MIN, pageWindowKey, pageWindowLabel, pageWindowTitle, placePageWindow, rememberPageWindow, type SavedPageWindow } from '../../core/page-window';
import type { NavRoute } from '../../core/nav';
import { settings, updateSettings } from '../store';
import { adoptPageWindow } from '../resilience';

export interface PageWindowDeps {
  preload: () => string;
  lockDown: (w: BrowserWindow) => void;
  /** loads the interface into a window with these query parameters */
  load: (w: BrowserWindow, view: string, extra: Record<string, string>) => void;
  /** a page window opened, or the last one closed (macOS: the Dock icon follows) */
  changed?: () => void;
}

let deps: PageWindowDeps | null = null;
const windows = new Map<string, BrowserWindow>();
let closedAt = 0;
const pending: [NavRoute, string | undefined][] = [];
/** When a page window last closed (the app does not quit for it when it was the last window). */
export const lastPageWindowClosedAt = () => closedAt;
const isMac = process.platform === 'darwin';

/** The page windows open now, by page. */
export function pageWindows(): Map<string, BrowserWindow> {
  for (const [k, w] of windows) if (w.isDestroyed()) windows.delete(k);
  return windows;
}

/** Whether a window is a page window, and for which page. */
export function pageOfWindow(w: BrowserWindow | null | undefined): string | undefined {
  if (!w) return undefined;
  for (const [k, x] of windows) if (x === w) return k;
  return undefined;
}

/** Whether any page window is on screen (macOS keeps its Dock icon for them). */
export function anyPageWindowShown(): boolean {
  return [...pageWindows().values()].some((w) => w.isVisible() || w.isMinimized());
}

const routeText = (r: NavRoute) => `${r.name}${r.arg !== undefined ? `:${r.arg}` : ''}`;

/** Remembers where a page's window is, a moment after it stops moving. */
function rememberPlace(key: string, win: BrowserWindow) {
  let timer: NodeJS.Timeout | undefined;
  const save = () => {
    clearTimeout(timer);
    if (win.isDestroyed() || win.isFullScreen()) return;
    const b = win.isMaximized() || win.isMinimized() ? win.getNormalBounds() : win.getBounds();
    const place: SavedPageWindow = { ...b, ...(win.isMaximized() ? { maximized: true } : {}) };
    const now = settings().pageWindows?.[key];
    if (now && now.x === place.x && now.y === place.y && now.width === place.width && now.height === place.height && !!now.maximized === !!place.maximized) return;
    void updateSettings({ pageWindows: rememberPageWindow(settings().pageWindows, key, place) }).catch(() => undefined);
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(save, 800); };
  for (const ev of ['moved', 'resized', 'maximize', 'unmaximize'] as const) win.on(ev as 'moved', soon);
  win.on('close', save);
}

/**
 * Opens a page in a window of its own, or brings its window forward (showing `route` there when
 * it names a place inside the page, such as one message). Returns null for a route that names no page.
 */
export function openPageWindow(route: NavRoute, label?: string): { key: string; created: boolean } | null {
  // Asked for before Keeper is ready (a link that started it): opened once it is.
  if (!deps) { pending.push([route, label]); return null; }
  const key = pageWindowKey(route);
  if (!key) return null;
  const existing = pageWindows().get(key);
  if (isMac) void app.dock?.show();
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    // A place inside the page (a message, a day): shown in the window that is already there.
    if (route.arg !== undefined) existing.webContents.send('event:navigate', routeText(route));
    return { key, created: false };
  }
  const name = pageWindowLabel(key, label);
  const cursor = screen.getCursorScreenPoint();
  const near = screen.getDisplayNearestPoint(cursor).workArea;
  const saved = settings().pageWindows?.[key];
  const b = placePageWindow(saved, screen.getAllDisplays().map((d) => d.workArea), near, windows.size % 8);
  const win = new BrowserWindow({
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    ...b, minWidth: PAGE_WINDOW_MIN.width, minHeight: PAGE_WINDOW_MIN.height, show: false, title: pageWindowTitle(name, APP_NAME),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111114' : '#f6f5f2',
    // The same frame as the main window: traffic lights in the page's top bar on a Mac, the
    // system's caption buttons over it elsewhere.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? undefined : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ddd' : '#333', height: 52 },
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: { preload: deps.preload(), contextIsolation: true, sandbox: true },
  });
  windows.set(key, win);
  adoptPageWindow(key, win);
  deps.lockDown(win);
  // Its name stays the page's ("Mail — Keeper"): in the Dock's and the Window menu's lists, the taskbar and window switchers.
  win.on('page-title-updated', (e) => e.preventDefault());
  deps.load(win, 'page', { page: key, route: routeText(route), label: name });
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    if (saved?.maximized) win.maximize();
    win.show();
    win.focus();
  });
  rememberPlace(key, win);
  win.on('closed', () => {
    closedAt = Date.now();
    if (windows.get(key) === win) windows.delete(key);
    deps?.changed?.();
  });
  win.on('show', () => deps?.changed?.());
  return { key, created: true };
}

export function registerPageWindows(d: PageWindowDeps) {
  deps = d;
  ipcMain.handle('windows.openPage', (_e, route: unknown, label?: unknown) => {
    const r = cleanRoute(route);
    return r ? openPageWindow(r, typeof label === 'string' ? label : undefined) : null;
  });
  for (const [r, l] of pending.splice(0)) openPageWindow(r, l);
  ipcMain.handle('windows.list', () => [...pageWindows().entries()].map(([key, w]) => ({ key, title: w.getTitle() })));
  // A display was unplugged: a page window left off every screen comes back onto one.
  screen.on('display-removed', () => {
    const areas = screen.getAllDisplays().map((d) => d.workArea);
    for (const w of pageWindows().values()) {
      const b = w.getBounds();
      const fitted = placePageWindow(b, areas, screen.getPrimaryDisplay().workArea);
      if (fitted.x !== b.x || fitted.y !== b.y || fitted.width !== b.width || fitted.height !== b.height) w.setBounds(fitted);
    }
  });
}
