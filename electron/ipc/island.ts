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
import { keepUnmanaged, overlayOptions } from '../services/unmanaged';
import { settings } from '../store';

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
  private snaps = new Map<number, number[]>();
  /**
   * macOS: windows are allowed past the menu bar (to sit in the notch). If the
   * system keeps moving one anyway, the Island goes back to the older, stable
   * placement below the menu bar rather than drifting around the screen.
   */
  private belowBarFallback = false;
  private expanded = new Set<number>();
  private hidden = false;
  private follow: NodeJS.Timeout | null = null;
  /** the size the pill asked for, so a closed Island covers nothing but itself */
  private sizes = new Map<number, { width: number; height: number }>();

  // Where it goes is worked out in core/island-place.ts: the notch, menu and
  // top bars, taskbars, the camera, a turned tablet, and the nudge from Settings.
  private bounds(display: Electron.Display, expanded: boolean) {
    const p = placementFor(display);
    if (expanded) return p.expanded;
    const want = this.sizes.get(display.id);
    if (!want) return p.collapsed;
    const c = p.collapsed;
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
    const now = Date.now();
    const recent = (this.snaps.get(id) ?? []).filter((t) => now - t < 10_000);
    recent.push(now);
    this.snaps.set(id, recent);
    logPlace(id, 'moved by the system, putting back', r, got);
    if (recent.length > 12 && process.platform === 'darwin' && !this.belowBarFallback) {
      // A tug of war with the window server: the stable placement below the menu bar instead.
      console.warn('[island] macOS keeps moving the Island; placing it below the menu bar from now on');
      this.belowBarFallback = true;
      this.destroyAll();
      setImmediate(() => this.ensure(true));
      return;
    }
    setImmediate(() => { if (!win.isDestroyed()) this.place(id, win, r, 'put back'); });
  }

  /** The pill's own size; the closed window shrinks to it (and grows back when the pill does). */
  setCollapsedSize(sender: WebContents, width: number, height: number) {
    for (const [id, win] of this.wins) {
      if (win.webContents !== sender || win.isDestroyed()) continue;
      const prev = this.sizes.get(id);
      if (prev && Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) return;
      this.sizes.set(id, { width, height });
      if (!this.expanded.has(id)) this.place(id, win, this.bounds(this.displayOf(id), false), 'pill size');
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
    const s = settings().island;
    if (!s.enabled) return this.destroyAll();
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
        // Not an ordinary window: window arrangers (Monorail, tilers, FancyZones) leave it alone.
        ...overlayOptions('island'),
        ...first, frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true,
        fullscreenable: false, hasShadow: false, focusable: false, show: false, backgroundColor: '#00000000',
        // macOS would otherwise push the window below the menu bar, away from the notch.
        enableLargerThanScreen: process.platform === 'darwin' && !this.belowBarFallback,
        webPreferences: { preload: ctx.preload, contextIsolation: true, sandbox: true },
      });
      keepUnmanaged(win, 'island');
      win.setAlwaysOnTop(true, 'status');
      // Clicks pass through the clear space around the pill to whatever is underneath.
      clickThrough(win, true);
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
      ctx.lockDown(win);
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
    this.want.clear();
  }

  setExpanded(sender: WebContents, v: boolean) {
    for (const [id, win] of this.wins) {
      if (win.webContents !== sender) continue;
      const d = this.displayOf(id);
      if (v) this.expanded.add(id);
      else this.expanded.delete(id);
      this.place(id, win, this.bounds(d, v), v ? 'expand' : 'collapse');
      clickThrough(win, !v);
      // Only the open Island takes the keyboard; the closed pill never takes focus from the app in front.
      win.setFocusable(v);
      if (v) win.focus();
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
      ...overlayOptions('clips'),
      width: w, height: h, frame: false, transparent: true, resizable: false, show: false, skipTaskbar: true, alwaysOnTop: true,
      fullscreenable: false, hasShadow: false, webPreferences: { preload: ctx.preload, contextIsolation: true, sandbox: true },
    });
    keepUnmanaged(clips, 'clips');
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

  // Time left on a keep-awake session, next to the menu-bar icon (macOS).
  if (process.platform === 'darwin') {
    let last = '';
    setInterval(() => {
      const a = svc.awake;
      const left = a.on && a.until ? Math.max(0, a.until - Date.now()) : 0;
      const title = a.on ? (left ? `☕ ${left >= 3_600_000 ? `${Math.floor(left / 3_600_000)}h${String(Math.round((left % 3_600_000) / 60_000)).padStart(2, '0')}` : `${Math.ceil(left / 60_000)}m`}` : '☕') : '';
      if (title !== last) c.setTrayTitle?.((last = title));
    }, 15_000);
  }

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
  ipcMain.on('island.setSize', (e, w: number, hgt: number) => { if (Number.isFinite(w) && Number.isFinite(hgt)) islandWindows.setCollapsedSize(e.sender, w, hgt); });
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
  reg(s.pasteShortcut, () => (clipsWindowOpen() ? hideClips() : openClips()));
  reg(s.shelfShortcut, () => islandWindows.openOn('shelf'));
  // Opens the Island from anywhere, on the screen with the pointer.
  // While a Keeper window is in front its own ⌘⌥I / Ctrl+Alt+I (Show/Hide Inspector) wins: a system-wide
  // shortcut never reaches the page, so it is passed on.
  reg(s.openShortcut ?? '', () => {
    const f = BrowserWindow.getFocusedWindow();
    const url = f && !f.isDestroyed() ? f.webContents.getURL() : '';
    if (url && (!url.includes('view=') || /[?&]view=app\b/.test(url)) && /^CommandOrControl\+Alt\+I$/i.test(s.openShortcut ?? '')) { f!.webContents.send('event:toggle-inspector'); return; }
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
