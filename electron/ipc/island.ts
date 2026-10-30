// SPDX-License-Identifier: AGPL-3.0-or-later
// The Island's windows (one per display when asked), the clipboard picker,
// desktop widgets, their shortcuts and IPC.

import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, type WebContents } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { ShelfAction } from '../../core/api';
import { kindOf } from '../../core/classify';
import type { FileIndex } from '../../core/indexer';
import { normalizeWidgets, type WidgetConfig } from '../../core/widgets';
import type { FileService } from '../services/files';
import type { IslandService } from '../services/island';
import { settings, updateSettings } from '../store';

export interface IslandContext {
  islandSvc: IslandService;
  files: FileService;
  index: FileIndex;
  preload: string;
  lockDown(win: BrowserWindow): void;
  broadcast(channel: string, ...args: unknown[]): void;
  updateTray(): void;
  ocrImage?(img: Electron.NativeImage): Promise<string>;
  resize?(paths: string[], width: number): Promise<string[]>;
}

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

function loadView(win: BrowserWindow, query: Record<string, string>) {
  if (DEV_URL) void win.loadURL(`${DEV_URL}?${new URLSearchParams(query)}`);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
}

let ctx: IslandContext;

// ---------------------------------------------------------------- Island windows

const COLLAPSED = { width: 380, height: 64 };
const EXPANDED = { width: 700, height: 380 };

export class IslandWindows {
  private wins = new Map<number, BrowserWindow>();
  private expanded = new Set<number>();
  private hidden = false;

  private bounds(display: Electron.Display, expanded: boolean) {
    const s = settings().island;
    const size = expanded ? EXPANDED : COLLAPSED;
    if (s.edge === 'left' || s.edge === 'right') {
      const x = s.edge === 'left' ? display.bounds.x : display.bounds.x + display.bounds.width - size.width;
      return { x, y: Math.round(display.workArea.y + display.workArea.height * 0.3), ...size };
    }
    return { x: Math.round(display.bounds.x + (display.bounds.width - size.width) / 2), y: display.bounds.y, ...size };
  }

  private displays(): Electron.Display[] {
    return settings().island.displays === 'all' ? screen.getAllDisplays() : [screen.getPrimaryDisplay()];
  }

  /** Creates, moves or removes Island windows to match settings and the connected displays. */
  ensure(reposition = false) {
    const s = settings().island;
    if (!s.enabled) return this.destroyAll();
    const wanted = this.displays();
    for (const [id, win] of this.wins) {
      if (!wanted.some((d) => d.id === id) || win.isDestroyed()) {
        if (!win.isDestroyed()) win.destroy();
        this.wins.delete(id);
      }
    }
    for (const d of wanted) {
      const existing = this.wins.get(d.id);
      if (existing) {
        if (reposition) existing.setBounds(this.bounds(d, this.expanded.has(d.id)), false);
        continue;
      }
      const win = new BrowserWindow({
        ...this.bounds(d, false), frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true,
        fullscreenable: false, hasShadow: false, focusable: true, show: false, backgroundColor: '#00000000',
        webPreferences: { preload: ctx.preload, contextIsolation: true, sandbox: true },
      });
      win.setAlwaysOnTop(true, 'status');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
      ctx.lockDown(win);
      loadView(win, { view: 'island', display: String(d.id) });
      win.once('ready-to-show', () => { if (!this.hidden) win.showInactive(); });
      win.on('closed', () => { this.wins.delete(d.id); this.expanded.delete(d.id); });
      this.wins.set(d.id, win);
    }
  }

  destroyAll() {
    for (const w of this.wins.values()) if (!w.isDestroyed()) w.destroy();
    this.wins.clear();
    this.expanded.clear();
  }

  setExpanded(sender: WebContents, v: boolean) {
    for (const [id, win] of this.wins) {
      if (win.webContents !== sender) continue;
      const d = screen.getAllDisplays().find((x) => x.id === id) ?? screen.getPrimaryDisplay();
      if (v) this.expanded.add(id);
      else this.expanded.delete(id);
      win.setBounds(this.bounds(d, v), false);
      if (v) win.focus();
    }
  }

  setHidden(hidden: boolean) {
    this.hidden = hidden;
    for (const w of this.wins.values()) {
      if (w.isDestroyed()) continue;
      if (hidden) w.hide();
      else w.showInactive();
    }
  }

  /** Opens the Island on the display under the pointer, on a given tab. */
  openOn(tab: string) {
    this.setHidden(false);
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const win = this.wins.get(d.id) ?? [...this.wins.values()][0];
    if (!win) return;
    win.webContents.send('event:island-open', tab);
  }

  send(channel: string, ...args: unknown[]) {
    for (const w of this.wins.values()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  }

  count() {
    return this.wins.size;
  }
}

export const islandWindows = new IslandWindows();

// ---------------------------------------------------------------- clipboard picker

let clips: BrowserWindow | null = null;

export function openClips() {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const w = 460;
  const h = 520;
  if (!clips || clips.isDestroyed()) {
    clips = new BrowserWindow({
      width: w, height: h, frame: false, transparent: true, resizable: false, show: false, skipTaskbar: true, alwaysOnTop: true,
      fullscreenable: false, hasShadow: false, webPreferences: { preload: ctx.preload, contextIsolation: true, sandbox: true },
    });
    ctx.lockDown(clips);
    loadView(clips, { view: 'clips' });
    clips.on('blur', () => clips?.hide());
    clips.on('closed', () => (clips = null));
  }
  const p = screen.getCursorScreenPoint();
  // Near the pointer, kept on screen.
  const x = Math.min(Math.max(d.workArea.x, p.x - w / 2), d.workArea.x + d.workArea.width - w);
  const y = Math.min(Math.max(d.workArea.y, p.y - 40), d.workArea.y + d.workArea.height - h);
  clips.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h });
  clips.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  clips.show();
  clips.focus();
  clips.webContents.send('event:island-changed');
}

function hideClips() {
  if (!clips || clips.isDestroyed() || !clips.isVisible()) return;
  clips.hide();
  // Give focus back to the app the user was in, so the paste lands there.
  if (process.platform === 'darwin') app.hide();
}

export const clipsWindowOpen = () => !!clips && !clips.isDestroyed() && clips.isVisible();

// ---------------------------------------------------------------- widgets

const widgetWins = new Map<string, BrowserWindow>();
const saveTimers = new Map<string, NodeJS.Timeout>();

function widgetFor(sender: WebContents): string | undefined {
  for (const [id, w] of widgetWins) if (!w.isDestroyed() && w.webContents === sender) return id;
  return undefined;
}

function openWidget(cfg: WidgetConfig) {
  const existing = widgetWins.get(cfg.id);
  if (existing && !existing.isDestroyed()) {
    existing.setMovable(!cfg.locked);
    existing.setResizable(!cfg.locked);
    existing.setVisibleOnAllWorkspaces(cfg.allWorkspaces);
    existing.webContents.send('event:widgets-changed');
    return;
  }
  const win = new BrowserWindow({
    ...cfg.bounds, frame: false, transparent: true, resizable: !cfg.locked, movable: !cfg.locked, skipTaskbar: true, alwaysOnTop: false,
    minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false, show: false, backgroundColor: '#00000000',
    // On Linux a desktop-type window sits under ordinary windows, like a real desktop widget.
    type: process.platform === 'linux' ? 'desktop' : undefined,
    webPreferences: { preload: ctx.preload, contextIsolation: true, sandbox: true },
  });
  win.setVisibleOnAllWorkspaces(cfg.allWorkspaces);
  ctx.lockDown(win);
  loadView(win, { view: 'widget', id: cfg.id });
  win.once('ready-to-show', () => win.showInactive());
  const remember = () => {
    clearTimeout(saveTimers.get(cfg.id));
    saveTimers.set(cfg.id, setTimeout(() => {
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      const list = normalizeWidgets(settings().widgets).map((w) => (w.id === cfg.id ? { ...w, bounds: b } : w));
      void updateSettings({ widgets: list });
    }, 500));
  };
  win.on('moved', remember);
  win.on('resized', remember);
  win.on('closed', () => widgetWins.delete(cfg.id));
  widgetWins.set(cfg.id, win);
}

/** Opens, updates and closes widget windows to match settings. */
export function syncWidgets() {
  const list = normalizeWidgets(settings().widgets);
  for (const [id, w] of widgetWins) {
    if (!list.some((x) => x.id === id)) {
      if (!w.isDestroyed()) w.destroy();
      widgetWins.delete(id);
    }
  }
  for (const cfg of list) openWidget(cfg);
}

export const widgetWindowCount = () => widgetWins.size;

async function photosIn(folder: string): Promise<string[]> {
  try {
    const names = await fsp.readdir(folder);
    return names.filter((n) => !n.startsWith('.') && kindOf(n) === 'image' && !/\.(svg|ico|icns|psd|xcf)$/i.test(n)).slice(0, 500).map((n) => path.join(folder, n));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- IPC & shortcuts

export function registerIslandIpc(c: IslandContext) {
  ctx = c;
  const svc = c.islandSvc;
  svc.hooks = {
    compress: (paths) => c.files.compress(paths),
    readText: async (paths) => {
      const out: { path: string; text: string }[] = [];
      for (const p of paths) {
        let text = c.index.files.get(p)?.text ?? '';
        if (!text && kindOf(path.basename(p)) === 'image' && c.ocrImage) {
          const { loadImage } = await import('../services/vision');
          const img = await loadImage(p);
          if (img) text = await c.ocrImage(img);
        }
        if (!text && /\.(txt|md|csv|json|log)$/i.test(p)) text = (await fsp.readFile(p, 'utf8').catch(() => '')).slice(0, 100_000);
        out.push({ path: p, text });
      }
      return out;
    },
    move: (paths, dir) => c.files.move(paths, dir, 'Moved from the shelf'),
    copy: (paths, dir) => c.files.copy(paths, dir),
    resize: c.resize,
    ocrImage: c.ocrImage,
    pickFolder: async () => {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    },
    confirm: async (message, detail) => (await dialog.showMessageBox({ type: 'question', buttons: ['Run', 'Cancel'], defaultId: 0, cancelId: 1, message, detail })).response === 0,
    onVisibility: (hidden) => islandWindows.setHidden(hidden),
  };

  const h = (name: string, fn: (...args: never[]) => unknown) => ipcMain.handle(name, (_e, ...args) => fn(...(args as never[])));
  h('island.createShelf', (name?: string) => svc.createShelf(name));
  h('island.selectShelf', (id: string) => svc.selectShelf(id));
  h('island.renameShelf', (id: string, name: string) => svc.renameShelf(id, name));
  h('island.setShelfColor', (id: string, color: string) => svc.setShelfColor(id, color));
  h('island.pinShelf', (id: string) => { svc.pinShelf(id); c.updateTray(); });
  h('island.closeShelf', (id: string) => { svc.closeShelf(id); c.updateTray(); });
  h('island.reopenShelf', (id: string) => svc.reopenShelf(id));
  h('island.moveShelfItem', (from: number, to: number) => svc.moveShelfItem(from, to));
  h('island.renameShelfItem', (p: string, name: string) => svc.renameShelfItem(p, name));
  h('island.shelfAction', (action: ShelfAction, arg?: string, paths?: string[]) => svc.shelfAction(action, arg, paths));
  h('island.updateClip', (id: string, patch: { note?: string }) => svc.updateClip(id, patch));
  h('island.toggleClipCollection', (id: string, name: string) => svc.toggleClipCollection(id, name));
  h('island.pasteClip', async (id: string) => {
    hideClips();
    await svc.pasteClip(id);
  });
  h('island.exportClips', async () => {
    const r = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), `Keeper clipboard ${new Date().toISOString().slice(0, 10)}.json`), filters: [{ name: 'Keeper clipboard backup', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, svc.clips.export());
    return r.filePath;
  });
  h('island.importClips', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Keeper clipboard backup', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return 0;
    return svc.importClips(await fsp.readFile(r.filePaths[0], 'utf8'));
  });
  h('island.openClips', () => openClips());
  ipcMain.on('island.closeClips', () => hideClips());
  h('island.openShelf', () => islandWindows.openOn('shelf'));
  h('island.hide', (hidden: boolean) => svc.hide(hidden));
  h('island.setVolume', (v: number) => svc.setVolume(v));
  h('island.setMuted', (m: boolean) => svc.setMuted(m));
  h('island.setBrightness', (id: string, v: number) => svc.setBrightness(id, v));
  h('island.refreshDevices', () => svc.refreshDevices());
  h('island.awakeStatus', () => svc.awakeStatus());

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
  ipcMain.handle('widgets.current', (e) => {
    const id = widgetFor(e.sender);
    return normalizeWidgets(settings().widgets).find((w) => w.id === id) ?? null;
  });

  // Follow displays being connected and disconnected.
  screen.on('display-added', () => islandWindows.ensure(true));
  screen.on('display-removed', () => islandWindows.ensure(true));
  screen.on('display-metrics-changed', () => islandWindows.ensure(true));
}

/** Called by main.ts after it registers its own shortcuts (it clears all of them first). */
export function registerIslandShortcuts() {
  const s = settings().island;
  const reg = (acc: string, fn: () => void) => {
    try {
      if (acc && !globalShortcut.isRegistered(acc)) globalShortcut.register(acc, fn);
    } catch {
      /* invalid or taken by another app */
    }
  };
  reg(s.pasteShortcut, () => (clipsWindowOpen() ? hideClips() : openClips()));
  reg(s.shelfShortcut, () => islandWindows.openOn('shelf'));
  reg(s.hideShortcut, () => ctx.islandSvc.hide(!ctx.islandSvc.hidden));
  reg(s.awakeShortcut, () => {
    const on = !ctx.islandSvc.awake.on;
    ctx.islandSvc.keepAwake(on);
    ctx.islandSvc.alert({ kind: 'info', title: on ? 'Keeping awake' : 'Keep awake off', detail: on ? 'Until you turn it off' : undefined });
    ctx.updateTray();
  });
}
