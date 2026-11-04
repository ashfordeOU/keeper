// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Desktop widgets: one small window each, on the desktop layer, and their IPC.
// Moved here from ipc/island.ts (same windows, same settings, same IPC names),
// plus arrange mode (drag with snapping) and a tint that follows the wallpaper.

import { BrowserWindow, ipcMain, screen, type WebContents } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { kindOf } from '../../core/classify';
import { normalizeWidgets, snapBounds, type WidgetConfig } from '../../core/widgets';
import { featureOn } from '../services/features';
import { settings, updateSettings } from '../store';
import { keepUnmanaged, overlayOptions } from '../services/unmanaged';

export interface WidgetsContext {
  preload: string;
  lockDown(win: BrowserWindow): void;
  broadcast(channel: string, ...args: unknown[]): void;
}

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

function loadView(win: BrowserWindow, query: Record<string, string>) {
  if (DEV_URL) void win.loadURL(`${DEV_URL}?${new URLSearchParams(query)}`);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
}

let ctx: WidgetsContext | null = null;

/**
 * When the widgets run in a process of their own (electron/suite/part.ts), the app
 * hands the windows' work to it (electron/suite/remote.ts).
 */
export interface WidgetsRemote {
  sync(): void;
  arrange(on: boolean): void;
  tint(color: string | null): void;
  count(): number;
}
let remote: WidgetsRemote | null = null;
export function setWidgetsRemote(r: WidgetsRemote | null) {
  remote = r;
}
const widgetWins = new Map<string, BrowserWindow>();
const saveTimers = new Map<string, NodeJS.Timeout>();
let arranging = false;
let tint: string | null = null;

function widgetFor(sender: WebContents): string | undefined {
  for (const [id, w] of widgetWins) if (!w.isDestroyed() && w.webContents === sender) return id;
  return undefined;
}

/** Where a dragged widget lands in arrange mode: snapped to edges and its neighbours. */
function snapped(id: string, b: Electron.Rectangle): Electron.Rectangle {
  const area = screen.getDisplayMatching(b).workArea;
  const others = [...widgetWins].filter(([x, w]) => x !== id && !w.isDestroyed()).map(([, w]) => w.getBounds());
  return snapBounds(b, others, area);
}

function openWidget(cfg: WidgetConfig) {
  const c = ctx!;
  const movable = arranging || !cfg.locked;
  const existing = widgetWins.get(cfg.id);
  if (existing && !existing.isDestroyed()) {
    existing.setMovable(movable);
    existing.setResizable(movable);
    existing.setVisibleOnAllWorkspaces(cfg.allWorkspaces);
    const b = existing.getBounds();
    if (b.width !== cfg.bounds.width || b.height !== cfg.bounds.height) existing.setBounds({ ...b, width: cfg.bounds.width, height: cfg.bounds.height });
    existing.webContents.send('event:widgets-changed');
    return;
  }
  const win = new BrowserWindow({
    ...overlayOptions('widget', { panel: process.platform !== 'linux' }),
    ...cfg.bounds, frame: false, transparent: true, resizable: movable, movable, skipTaskbar: true, alwaysOnTop: false,
    minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false, show: false, backgroundColor: '#00000000',
    // On Linux a desktop-type window sits under ordinary windows, like a real desktop widget.
    ...(process.platform === 'linux' ? { type: 'desktop' } : {}),
    webPreferences: { preload: c.preload, contextIsolation: true, sandbox: true },
  });
  keepUnmanaged(win, 'widget');
  win.setVisibleOnAllWorkspaces(cfg.allWorkspaces);
  c.lockDown(win);
  loadView(win, { view: 'widget', id: cfg.id });
  win.once('ready-to-show', () => win.showInactive());
  const remember = () => {
    clearTimeout(saveTimers.get(cfg.id));
    saveTimers.set(cfg.id, setTimeout(() => {
      if (win.isDestroyed()) return;
      let b = win.getBounds();
      if (arranging) {
        const s = snapped(cfg.id, b);
        if (s.x !== b.x || s.y !== b.y) { win.setBounds(s, false); b = s; }
      }
      const list = normalizeWidgets(settings().widgets).map((w) => (w.id === cfg.id ? { ...w, bounds: b } : w));
      void updateSettings({ widgets: list });
    }, arranging ? 250 : 500));
  };
  win.on('moved', remember);
  win.on('resized', remember);
  win.on('closed', () => widgetWins.delete(cfg.id));
  widgetWins.set(cfg.id, win);
}

/** Opens, updates and closes widget windows to match settings. */
export function syncWidgets() {
  if (remote) return remote.sync();
  if (!ctx) return;
  // Desktop widgets switched off in Settings → Features: every widget window closes.
  // Folder boxes have their own switch too (Settings → Features → Folder boxes).
  const list = featureOn('widgets') ? normalizeWidgets(settings().widgets).filter((w) => w.kind !== 'folder' || featureOn('folderBoxes')) : [];
  for (const [id, w] of widgetWins) {
    if (!list.some((x) => x.id === id)) {
      if (!w.isDestroyed()) w.destroy();
      widgetWins.delete(id);
    }
  }
  for (const cfg of list) openWidget(cfg);
}

export const widgetWindowCount = () => (remote ? remote.count() : widgetWins.size);

/** Arrange mode: every widget can be dragged (even locked ones) and snaps to edges and neighbours. */
export function setArranging(on: boolean) {
  arranging = on;
  remote?.arrange(on);
  syncWidgets();
  for (const w of widgetWins.values()) if (!w.isDestroyed()) w.webContents.send('event:widgets-arrange', on);
  ctx?.broadcast('widgets-arrange', on);
}

/** The colour "tinted" widgets use (the wallpaper's palette); null follows the theme's accent. */
export function setWidgetTint(color: string | null) {
  if (color === tint) return;
  tint = color;
  remote?.tint(color);
  for (const w of widgetWins.values()) if (!w.isDestroyed()) w.webContents.send('event:widgets-changed');
}

/** Replace every widget at once (a vibe's layout). */
export async function replaceWidgets(list: WidgetConfig[]) {
  await updateSettings({ widgets: normalizeWidgets(list) });
  syncWidgets();
  ctx?.broadcast('widgets-changed');
}

async function photosIn(folder: string): Promise<string[]> {
  try {
    const names = await fsp.readdir(folder);
    return names.filter((n) => !n.startsWith('.') && kindOf(n) === 'image' && !/\.(svg|ico|icns|psd|xcf)$/i.test(n)).slice(0, 500).map((n) => path.join(folder, n));
  } catch {
    return [];
  }
}

/** The widget windows' own calls, answered where the windows are (the app, or the widgets' process). */
export function registerWidgetWindowIpc(c: WidgetsContext) {
  ctx = c;
  ipcMain.handle('widgets.current', (e) => {
    const id = widgetFor(e.sender);
    return normalizeWidgets(settings().widgets).find((w) => w.id === id) ?? null;
  });
  ipcMain.handle('widgets.arranging', () => arranging);
  ipcMain.handle('widgets.tint', () => tint);
}

export function registerWidgetsIpc(c: WidgetsContext) {
  ctx = c;
  const h = (name: string, fn: (...args: never[]) => unknown) => ipcMain.handle(name, (_e, ...args) => fn(...(args as never[])));
  h('widgets.list', () => normalizeWidgets(settings().widgets));
  h('widgets.save', async (w: WidgetConfig) => {
    const list = normalizeWidgets(settings().widgets);
    const next = list.some((x) => x.id === w.id) ? list.map((x) => (x.id === w.id ? w : x)) : [...list, w];
    const saved = normalizeWidgets((await updateSettings({ widgets: next })).widgets);
    syncWidgets();
    c.broadcast('widgets-changed');
    return saved;
  });
  h('widgets.remove', async (id: string) => {
    const saved = normalizeWidgets((await updateSettings({ widgets: normalizeWidgets(settings().widgets).filter((w) => w.id !== id) })).widgets);
    syncWidgets();
    c.broadcast('widgets-changed');
    return saved;
  });
  h('widgets.photos', (folder: string) => photosIn(folder));
  h('widgets.arrange', (on: boolean) => { setArranging(!!on); return arranging; });
  // The widgets' process answers these itself for its windows; the app keeps them for its own pages.
  ipcMain.handle('widgets.current', (e) => {
    const id = widgetFor(e.sender);
    return normalizeWidgets(settings().widgets).find((w) => w.id === id) ?? null;
  });
  h('widgets.arranging', () => arranging);
  h('widgets.tint', () => tint);
  // Typing into a widget (the Week's "+ add", the world clock's city field): desktop-layer
  // windows open without focus, so the field asks for the keyboard when it is clicked.
  ipcMain.handle('widgets.focus', (e) => {
    const id = widgetFor(e.sender);
    const win = id ? widgetWins.get(id) : undefined;
    if (!win || win.isDestroyed()) return false;
    win.focus();
    win.webContents.focus();
    return true;
  });
}

/** In the widgets' process: what the app said (arrange mode, the tint). */
export function applyWidgetsState(state: { arranging?: boolean; tint?: string | null }) {
  if (state.tint !== undefined && state.tint !== tint) {
    tint = state.tint;
    for (const w of widgetWins.values()) if (!w.isDestroyed()) w.webContents.send('event:widgets-changed');
  }
  if (state.arranging !== undefined && state.arranging !== arranging) {
    arranging = state.arranging;
    syncWidgets();
    for (const w of widgetWins.values()) if (!w.isDestroyed()) w.webContents.send('event:widgets-arrange', arranging);
  }
}
