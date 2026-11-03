// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's windows (one per display when asked), the clipboard picker,
// their shortcuts and IPC. Desktop widgets live in ./widgets.ts.

import { app, BrowserWindow, dialog, globalShortcut, ipcMain, powerMonitor, screen, type WebContents } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { ShelfAction } from '../../core/api';
import { kindOf } from '../../core/classify';
import type { FileIndex } from '../../core/indexer';
import type { FileService } from '../services/files';
import type { IslandService } from '../services/island';
import { placementFor, placementPreview, refreshPlaceEnv, wantedDisplays } from '../services/island-place';
import { onFrontAppChange } from '../services/fg-watch';
import { featureOn } from '../services/features';
import { keepUnmanaged, overlayOptions } from '../services/unmanaged';
import { TugGuard } from '../../core/ashforde/coexist';
import { onSettings, settings } from '../store';
import { islandUsesPanel } from '../../core/island-size';

export interface IslandContext {
  islandSvc: IslandService;
  files: FileService;
  index: FileIndex;
  preload: string;
  lockDown(win: BrowserWindow): void;
  broadcast(channel: string, ...args: unknown[]): void;
  updateTray(): void;
  /** macOS shows text next to the menu-bar icon */
  setTrayTitle?(title: string): void;
  ocrImage?(img: Electron.NativeImage): Promise<string>;
  resize?(paths: string[], width: number): Promise<string[]>;
}

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

function loadView(win: BrowserWindow, query: Record<string, string>) {
  if (DEV_URL) void win.loadURL(`${DEV_URL}?${new URLSearchParams(query)}`);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
}

let ctx: IslandContext;
/** What the windows need (in the app, and in the Island's own process). */
let winCtx: Pick<IslandContext, 'preload' | 'lockDown'>;

/**
 * When the Island runs in a process of its own (electron/suite/part.ts), the app's
 * IslandWindows hands everything to that process instead (electron/suite/remote.ts).
 */
export interface IslandRemote {
  ensure(reposition: boolean): void;
  setHidden(hidden: boolean): void;
  openOn(tab: string): void;
  send(channel: string, ...args: unknown[]): void;
  count(): number;
  openClips(): void;
  hideClips(): Promise<void>;
  toggleClips(): void;
}
let remote: IslandRemote | null = null;
export function setIslandRemote(r: IslandRemote | null) {
  remote = r;
}

// ---------------------------------------------------------------- Island windows

/** Lets clicks fall through the window while still telling the page where the pointer is (macOS and Windows; Linux cannot forward). */
function clickThrough(win: BrowserWindow, on: boolean) {
  if (process.platform === 'linux' || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(on, on ? { forward: true } : undefined);
}

type Rect = { x: number; y: number; width: number; height: number };
const sameRect = (a: Rect, b: Rect) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;

/** KEEPER_ISLAND_LOG=1 (the Mac test kit sets it): each requested and actual Island rectangle goes to Keeper's log. */
const islandLogOn = /^(1|true|yes)$/i.test(process.env.KEEPER_ISLAND_LOG ?? '');
const placeLog: { at: number; display: number; why: string; want: Rect; got: Rect }[] = [];
function logPlace(display: number, why: string, want: Rect, got: Rect) {
  if (!islandLogOn) return;
  placeLog.push({ at: Date.now(), display, why, want, got });
  if (placeLog.length > 400) placeLog.splice(0, placeLog.length - 400);
  console.log(`[island] ${why} display ${display}: wanted ${want.x},${want.y} ${want.width}x${want.height}, got ${got.x},${got.y} ${got.width}x${got.height}${sameRect(want, got) ? '' : '  MISMATCH'}`);
}
/** For the Mac test kit and diagnostics: the latest requested and actual rectangles (empty unless KEEPER_ISLAND_LOG is on). */
export const islandPlaceLog = () => placeLog.slice();

export class IslandWindows {
  private wins = new Map<number, BrowserWindow>();
  /** where each window was put; anything that moves it elsewhere is put back */
  private want = new Map<number, Rect>();
  private tug = new TugGuard(12, 10_000, 30_000);
  /**
   * macOS: windows are allowed past the menu bar (to sit in the notch). If the
   * system keeps moving one anyway, the Island goes back to the older, stable
   * placement below the menu bar rather than drifting around the screen.
   */
  private belowBarFallback = false;
  private expanded = new Set<number>();
  /** closed windows the pointer rests on: already the open size while the Island waits to open (still click-through outside the shape) */
  private grown = new Set<number>();
  private hidden = false;
  private follow: NodeJS.Timeout | null = null;
  /** the size the page asked for, so the Island's window covers nothing but the Island, closed or open */
  private sizes = new Map<number, { width: number; height: number }>();
  /** the windows are panels (Settings → Island → Advanced → Window type on macOS; always elsewhere) */
  private panel: boolean | null = null;

  // Where it goes is worked out in core/island-place.ts: the notch, menu and
  // top bars, taskbars, the camera, a turned tablet, and the nudge from Settings.
  // The page asks for the size of what it shows; the window is that size, centred where the closed or the
  // open Island belongs and never bigger than its placement. A transparent window bigger than the Island
  // can still be drawn by the system (macOS 26 showed it as a grey frame around the open Island).
  private bounds(display: Electron.Display, expanded: boolean) {
    const p = placementFor(display);
    const c = expanded ? p.expanded : p.collapsed;
    const want = this.sizes.get(display.id);
    if (!want) return c;
    const width = Math.max(8, Math.min(c.width, Math.round(want.width)));
    const height = Math.max(4, Math.min(c.height, Math.round(want.height)));
    const x = p.edge === 'left' ? c.x : p.edge === 'right' ? c.x + c.width - width : Math.round(c.x + (c.width - width) / 2);
    const y = p.edge === 'left' || p.edge === 'right' ? Math.round(c.y + (c.height - height) / 2) : c.y;
    return { x, y, width, height };
  }

  /**
   * Keeps a rectangle on its display; on a notch the top is the display's own top,
   * whatever any arithmetic said.
   */
  private clampRect(display: Electron.Display, r: Rect): Rect {
    const B = display.bounds;
    const width = Math.min(Math.round(r.width), B.width);
    const height = Math.min(Math.round(r.height), B.height);
    const x = Math.min(Math.max(Math.round(r.x), B.x), B.x + B.width - width);
    let y = Math.min(Math.max(Math.round(r.y), B.y), B.y + B.height - height);
    const p = placementFor(display);
    if (p.anchor === 'notch' || p.anchor === 'menubar') y = B.y;
    // The fallback: never above the menu bar.
    if (this.belowBarFallback && process.platform === 'darwin') y = Math.max(y, display.workArea.y);
    return { x, y, width, height };
  }

  /** Puts an Island window exactly where it belongs and checks that it stayed there. */
  private place(id: number, win: BrowserWindow, rect: Rect, why: string) {
    if (win.isDestroyed()) return;
    const r = this.clampRect(this.displayOf(id), rect);
    this.want.set(id, r);
    win.setBounds(r, false);
    const got = win.getBounds();
    if (!sameRect(got, r)) {
      // macOS may keep the old height's bottom edge or push the frame down; once more puts it right.
      win.setBounds(r, false);
      logPlace(id, `${why} (again)`, r, win.getBounds());
    } else logPlace(id, why, r, got);
  }

  /** Something other than Keeper moved or resized the window (it is not movable): put it back. */
  private snapBack(id: number, win: BrowserWindow) {
    const r = this.want.get(id);
    if (!r || win.isDestroyed()) return;
    const got = win.getBounds();
    if (sameRect(got, r)) return;
    logPlace(id, 'moved by the system, putting back', r, got);
    // Never an endless tug of war with a window arranger or the window server: at most 12 put-backs
    // in 10 s, then 30 s of leaving it be (the same rule Keeper uses with Monorail, core/ashforde/coexist.ts).
    const trips = this.tug.trips;
    if (!this.tug.allow(String(id))) {
      if (this.tug.trips === trips) return; // still cooling down
      console.warn(`[island] display ${id}: moved ${12} times in 10 s by something else; not putting it back for 30 s`);
      if (process.platform === 'darwin' && !this.belowBarFallback) {
        // The first time on a Mac: the stable placement below the menu bar instead.
        console.warn('[island] placing the Island below the menu bar from now on');
        this.belowBarFallback = true;
        this.destroyAll();
        setImmediate(() => this.ensure(true));
      }
      return;
    }
    setImmediate(() => { if (!win.isDestroyed()) this.place(id, win, r, 'put back'); });
  }

  /** The size of what the Island shows (the pill, a card, the panel); the window follows it. */
  setShownSize(sender: WebContents, width: number, height: number) {
    for (const [id, win] of this.wins) {
      if (win.webContents !== sender || win.isDestroyed()) continue;
      const prev = this.sizes.get(id);
      if (prev && Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) return;
      this.sizes.set(id, { width, height });
      const open = this.expanded.has(id) || this.grown.has(id);
      this.place(id, win, this.bounds(this.displayOf(id), open), open ? 'open size' : 'pill size');
    }
  }

  private displays(): Electron.Display[] {
    return wantedDisplays();
  }

  private displayOf(id: number): Electron.Display {
    return screen.getAllDisplays().find((x) => x.id === id) ?? screen.getPrimaryDisplay();
  }

  /** The placement for the Island window that sent a request (the window lays itself out around the notch). */
  layoutFor(sender: WebContents) {
    for (const [id, win] of this.wins) if (win.webContents === sender) return placementFor(this.displayOf(id));
    return null;
  }

  /** "The screen with the pointer": one window that moves along, checked every 1.5 s only in that mode. */
  private followPointer(on: boolean) {
    if (on && !this.follow) {
      this.follow = setInterval(() => {
        const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        if (!this.wins.has(d.id) && this.wins.size) this.ensure(true);
      }, 1500);
      this.follow.unref?.();
    } else if (!on && this.follow) {
      clearInterval(this.follow);
      this.follow = null;
    }
  }

  /** Creates, moves or removes Island windows to match settings and the connected displays. */
  ensure(reposition = false) {
    if (remote) return remote.ensure(reposition);
    const s = settings().island;
    if (!s.enabled) return this.destroyAll();
    // Another window type is chosen: the windows are made again (a window's type is fixed when it is made).
    const panel = islandUsesPanel(process.platform, s.windowType);
    if (this.panel !== null && this.panel !== panel && this.wins.size) this.destroyAll();
    this.panel = panel;
    const wanted = this.displays();
    this.followPointer(s.displays === 'mouse');
    // Following the pointer: move the one window rather than making a new one.
    if (s.displays === 'mouse' && this.wins.size === 1 && wanted.length === 1 && !this.wins.has(wanted[0].id)) {
      const [[oldId, win]] = [...this.wins];
      this.wins.delete(oldId);
      this.expanded.delete(oldId);
      const size = this.sizes.get(oldId);
      this.sizes.delete(oldId);
      if (size) this.sizes.set(wanted[0].id, size);
      if (!win.isDestroyed()) {
        this.wins.set(wanted[0].id, win);
        this.want.delete(oldId);
        this.place(wanted[0].id, win, this.bounds(wanted[0], false), 'follow pointer');
        win.webContents.send('event:island-layout', placementFor(wanted[0]));
      }
    }
    for (const [id, win] of this.wins) {
      if (!wanted.some((d) => d.id === id) || win.isDestroyed()) {
        if (!win.isDestroyed()) win.destroy();
        this.wins.delete(id);
      }
    }
    for (const d of wanted) {
      const existing = this.wins.get(d.id);
      if (existing) {
        if (reposition) {
          this.place(d.id, existing, this.bounds(d, this.expanded.has(d.id)), 'reposition');
          existing.webContents.send('event:island-layout', placementFor(d));
        }
        continue;
      }
      const first = this.clampRect(d, this.bounds(d, false));
      const win = new BrowserWindow({
        // Not an ordinary window: window arrangers (Monorail, tilers, snapping tools) leave it alone.
        // On macOS it is a plain borderless window by default, not a panel: macOS 26 draws a grey
        // rounded backdrop behind a transparent panel's clear area, which showed as a frame around
        // the open Island. Settings → Island → Advanced can make it a panel again. Monorail floats
        // it by its fixed title either way, and any move is undone.
        ...overlayOptions('island', { panel }),
        ...first, frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true,
        fullscreenable: false, hasShadow: false, focusable: false, show: false, backgroundColor: '#00000000',
        // No corners or edge drawn by the system (macOS, Windows 11): the page draws the Island's whole shape.
        roundedCorners: false,
        // macOS would otherwise push the window below the menu bar, away from the notch.
        enableLargerThanScreen: process.platform === 'darwin' && !this.belowBarFallback,
        webPreferences: { preload: winCtx.preload, contextIsolation: true, sandbox: true },
      });
      keepUnmanaged(win, 'island');
      win.setAlwaysOnTop(true, 'status');
      // Clicks pass through the clear space around the pill to whatever is underneath.
      clickThrough(win, true);
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
      winCtx.lockDown(win);
      loadView(win, { view: 'island', display: String(d.id) });
      win.once('ready-to-show', () => { if (!this.hidden) win.showInactive(); });
      win.on('closed', () => { if (this.wins.get(d.id) === win) { this.wins.delete(d.id); this.expanded.delete(d.id); this.sizes.delete(d.id); this.want.delete(d.id); } });
      // It is not movable: any move or resize Keeper did not ask for is undone.
      for (const ev of ['moved', 'resized', 'move', 'resize'] as const) win.on(ev as 'moved', () => { if (this.wins.get(d.id) === win) this.snapBack(d.id, win); });
      this.wins.set(d.id, win);
      this.want.set(d.id, first);
      logPlace(d.id, 'created', first, win.getBounds());
    }
  }

  destroyAll() {
    this.followPointer(false);
    for (const w of this.wins.values()) if (!w.isDestroyed()) w.destroy();
    this.wins.clear();
    this.expanded.clear();
    this.grown.clear();
    this.want.clear();
    this.sizes.clear();
  }

  setExpanded(sender: WebContents, v: boolean) {
    for (const [id, win] of this.wins) {
      if (win.webContents !== sender) continue;
      const d = this.displayOf(id);
      if (v) this.expanded.add(id);
      else this.expanded.delete(id);
      this.grown.delete(id);
      this.place(id, win, this.bounds(d, v), v ? 'expand' : 'collapse');
      clickThrough(win, !v);
      // Opening never takes the keyboard (a plain window would bring Keeper, and maybe its main
      // window, to the front): the open Island takes it when a field in it is clicked (takeFocus).
      // The closed pill never takes focus from the app in front.
      if (!v) win.setFocusable(false);
    }
  }

  /**
   * The pointer rests on the closed Island (on) or left it (off): the page may grow the window to the open
   * size during the wait, so opening is only the shape's motion. Clicks still go through outside the shape
   * (setInteractive follows the pointer). Nothing moves until the page sends the size.
   */
  prepare(sender: WebContents, on: boolean) {
    for (const [id, win] of this.wins) {
      if (win.webContents !== sender || win.isDestroyed() || this.expanded.has(id)) continue;
      if (on) this.grown.add(id);
      else this.grown.delete(id);
    }
  }

  /** A field in the open Island was clicked (or the New task shortcut opened it): it takes the keyboard. */
  takeFocus(sender: WebContents) {
    for (const [id, win] of this.wins) {
      if (win.webContents !== sender || win.isDestroyed() || !this.expanded.has(id)) continue;
      win.setFocusable(true);
      if (!win.isFocused()) win.focus();
    }
  }

  /** The pointer is over the pill (true) or has left it (false) while the Island is closed. */
  setInteractive(sender: WebContents, on: boolean) {
    for (const [id, win] of this.wins) {
      if (win.webContents !== sender || this.expanded.has(id)) continue;
      clickThrough(win, !on);
    }
  }

  setHidden(hidden: boolean) {
    if (remote) return remote.setHidden(hidden);
    this.hidden = hidden;
    for (const w of this.wins.values()) {
      if (w.isDestroyed()) continue;
      if (hidden) w.hide();
      else w.showInactive();
    }
  }

  /** Opens the Island on the display under the pointer, on a given tab. */
  openOn(tab: string) {
    if (remote) return remote.openOn(tab);
    this.setHidden(false);
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const win = this.wins.get(d.id) ?? [...this.wins.values()][0];
    if (!win) return;
    win.webContents.send('event:island-open', tab);
  }

  send(channel: string, ...args: unknown[]) {
    if (remote) return remote.send(channel, ...args);
    for (const w of this.wins.values()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  }

  count() {
    if (remote) return remote.count();
    return this.wins.size;
  }
}

export const islandWindows = new IslandWindows();

// ---------------------------------------------------------------- clipboard picker

let clips: BrowserWindow | null = null;

export function openClips() {
  if (remote) return remote.openClips();
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const w = 460;
  const h = 520;
  if (!clips || clips.isDestroyed()) {
    clips = new BrowserWindow({
      ...overlayOptions('clips'),
      width: w, height: h, frame: false, transparent: true, resizable: false, show: false, skipTaskbar: true, alwaysOnTop: true,
      fullscreenable: false, hasShadow: false, webPreferences: { preload: winCtx.preload, contextIsolation: true, sandbox: true },
    });
    keepUnmanaged(clips, 'clips');
    winCtx.lockDown(clips);
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

export function hideClips(): void | Promise<void> {
  if (remote) return remote.hideClips();
  if (!clips || clips.isDestroyed() || !clips.isVisible()) return;
  clips.hide();
  // Give focus back to the app the user was in, so the paste lands there.
  if (process.platform === 'darwin') app.hide();
}

export const clipsWindowOpen = () => !!clips && !clips.isDestroyed() && clips.isVisible();

/** The clipboard picker's shortcut: open it, or close it when it is open. */
export function toggleClips() {
  if (remote) return remote.toggleClips();
  if (clipsWindowOpen()) void hideClips();
  else openClips();
}

// ---------------------------------------------------------------- IPC & shortcuts

/**
 * Keep Awake's own menu-bar item is showing (./awake). Looked up when the app registers the Island:
 * the Island's own process (electron/suite/part.ts) loads this file for its windows and must not
 * load Keep Awake (and the services behind it) with it.
 */
let awakeItemShown = () => false;

export function registerIslandIpc(c: IslandContext) {
  void import('./awake').then((m) => { awakeItemShown = m.awakeItemShown; });
  ctx = c;
  winCtx = c;
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
    await hideClips();
    await svc.pasteClip(id);
  });
  // Paste one by one: started from the clipboard picker (chosen clips) or empty (what is copied next joins).
  h('island.queueStart', async (ids?: string[]) => {
    await hideClips();
    await svc.queueStart(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : undefined);
  });
  h('island.queueNext', () => svc.queueNext());
  h('island.queueStop', () => svc.queueStop());
  h('island.pastePlain', async () => {
    await hideClips();
    await svc.pastePlain();
  });
  h('island.neverKeepFrom', (appName: string) => svc.neverKeepFrom(String(appName ?? '')));
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
  h('island.openShelf', () => islandWindows.openOn('shelf'));
  h('island.openTab', (tab: string) => islandWindows.openOn(String(tab ?? 'home')));
  h('island.hide', (hidden: boolean) => svc.hide(hidden));
  h('island.setVolume', (v: number) => svc.setVolume(v));
  h('island.setMuted', (m: boolean) => svc.setMuted(m));
  h('island.setBrightness', (id: string, v: number) => svc.setBrightness(id, v));
  h('island.refreshDevices', () => svc.refreshDevices(true));
  h('island.awakeStatus', () => svc.awakeStatus());

  // Time left on a keep-awake session, next to the menu-bar icon (macOS).
  if (process.platform === 'darwin') {
    let last = '';
    setInterval(() => {
      const a = svc.awake;
      // Keep Awake's own menu-bar item shows the time left itself: one clock, not two.
      if (awakeItemShown()) { if (last) c.setTrayTitle?.((last = '')); return; }
      const left = a.on && a.until ? Math.max(0, a.until - Date.now()) : 0;
      // Plain text beside Keeper's own owl icon (no emoji): the time left, or "Awake" when there is no end.
      const title = a.on ? (left ? (left >= 3_600_000 ? `${Math.floor(left / 3_600_000)}h${String(Math.round((left % 3_600_000) / 60_000)).padStart(2, '0')}` : `${Math.ceil(left / 60_000)}m`) : 'Awake') : '';
      if (title !== last) c.setTrayTitle?.((last = title));
    }, 15_000);
  }

  // A light trackpad tap as the Island opens: macOS through keeper-helper; without the helper (or elsewhere) nothing.
  // Always answered here, in the app, which runs the helper already: an Island in a process of its own
  // sends it over the suite channel rather than starting a second helper.
  ipcMain.on('island.haptic', () => {
    if (process.platform !== 'darwin' || settings().island.haptics === false) return;
    void import('../services/platform/mac').then((m) => m.macHelperCall('haptic.tap', {}, 2000)).catch(() => undefined);
  });

  // The windows: here, or in the Island's own process (electron/suite/part.ts).
  if (!remote) registerIslandWindowIpc(c);
  else h('island.placementPreview', async () => { await refreshPlaceEnv(); return placementPreview(); });
}

/**
 * The Island's windows themselves: where they go, their size, displays coming and
 * going. In the app, or in the Island's own process (which has only this part).
 */
export function registerIslandWindowIpc(c: Pick<IslandContext, 'preload' | 'lockDown'>) {
  winCtx = c;
  const h = (name: string, fn: (...args: never[]) => unknown) => ipcMain.handle(name, (_e, ...args) => fn(...(args as never[])));
  ipcMain.on('island.setExpanded', (e, v: boolean) => islandWindows.setExpanded(e.sender, v));
  ipcMain.on('island.setInteractive', (e, v: boolean) => islandWindows.setInteractive(e.sender, !!v));
  ipcMain.on('island.closeClips', () => void hideClips());
  // Follow displays being connected and disconnected.
  // The notch and menu bar are measured again first (a resolution change moves them).
  const replace = () => void refreshPlaceEnv().finally(() => islandWindows.ensure(true));
  screen.on('display-added', replace);
  screen.on('display-removed', replace);
  screen.on('display-metrics-changed', replace);
  powerMonitor.on('resume', replace);
  replace();
  // macOS: each app has its own menus, and icons come and go; measure again when the front app changes,
  // and move the Island only if where it goes (or how far it may grow beside the notch) changed.
  if (process.platform === 'darwin') {
    let timer: NodeJS.Timeout | undefined;
    const key = () => JSON.stringify(wantedDisplays().map((d) => { const p = placementFor(d); return [p.anchor, p.wing, p.hang, p.pill.width]; }));
    onFrontAppChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const before = key();
        void refreshPlaceEnv().then(() => { if (key() !== before) islandWindows.ensure(true); });
      }, 400);
    });
  }
  ipcMain.handle('island.layout', (e) => islandWindows.layoutFor(e.sender));
  ipcMain.on('island.takeFocus', (e) => islandWindows.takeFocus(e.sender));
  ipcMain.on('island.prepare', (e, on: unknown) => islandWindows.prepare(e.sender, on === true));
  // Window type changed in Settings → Island → Advanced: the Island's windows are made again.
  onSettings((next, prev) => { if (next.island.windowType !== prev.island.windowType && next.island.enabled) islandWindows.ensure(true); });
  ipcMain.on('island.setSize', (e, w: number, hgt: number) => { if (Number.isFinite(w) && Number.isFinite(hgt)) islandWindows.setShownSize(e.sender, w, hgt); });
  h('island.placementPreview', async () => { await refreshPlaceEnv(); return placementPreview(); });
  h('island.placeLog', () => islandPlaceLog());
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
  reg(s.pasteShortcut, () => toggleClips());
  // Paste without formatting, from any app (no shortcut until one is chosen).
  if (featureOn('clipboard')) reg(s.plainPasteShortcut ?? '', () => void ctx.islandSvc.pastePlain());
  // While a paste queue runs: its "paste the next one" shortcut (taken only then).
  if (ctx.islandSvc.queue.active) reg(s.pasteNextShortcut ?? '', () => void ctx.islandSvc.queueNext());
  reg(s.shelfShortcut, () => islandWindows.openOn('shelf'));
  // New task: the Island's Tasks with the composer focused. While a Keeper window is in front, its own
  // ⌥⌘N / Ctrl+Alt+N (New Window for This Page) wins, as ⌘⌥I does below.
  if (featureOn('islandTodos')) reg(s.taskShortcut ?? '', () => {
    const f = BrowserWindow.getFocusedWindow();
    const url = f && !f.isDestroyed() ? f.webContents.getURL() : '';
    if (url && (!url.includes('view=') || /[?&]view=(app|page)\b/.test(url)) && /^(CommandOrControl|CmdOrCtrl)\+Alt\+N$/i.test(s.taskShortcut ?? '')) { f!.webContents.send('event:open-in-window'); return; }
    islandWindows.openOn('reminders:new');
  });
  // Opens the Island from anywhere, on the screen with the pointer.
  // While a Keeper window is in front its own ⌘⌥I / Ctrl+Alt+I (Show/Hide Inspector) wins: a system-wide
  // shortcut never reaches the page, so it is passed on.
  reg(s.openShortcut ?? '', () => {
    const f = BrowserWindow.getFocusedWindow();
    const url = f && !f.isDestroyed() ? f.webContents.getURL() : '';
    if (url && (!url.includes('view=') || /[?&]view=(app|page)\b/.test(url)) && /^CommandOrControl\+Alt\+I$/i.test(s.openShortcut ?? '')) { f!.webContents.send('event:toggle-inspector'); return; }
    islandWindows.openOn('home');
  });
  // The player's controls from the keyboard's media keys, when the person wants the Island to answer them.
  if (s.mediaKeys) for (const [key, act] of [['MediaPlayPause', 'toggle'], ['MediaNextTrack', 'next'], ['MediaPreviousTrack', 'previous']] as const) reg(key, () => void ctx.islandSvc.media(act));
  reg(s.hideShortcut, () => ctx.islandSvc.hide(!ctx.islandSvc.hidden));
  reg(s.awakeShortcut, () => {
    const on = !ctx.islandSvc.awake.on;
    ctx.islandSvc.keepAwake(on);
    ctx.islandSvc.alert({ kind: 'info', title: on ? 'Keeping awake' : 'Keep awake off', detail: on ? 'Until you turn it off' : undefined });
    ctx.updateTray();
  });
}
