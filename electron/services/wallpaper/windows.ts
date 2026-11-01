// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The live wallpaper's windows: one per display, on the desktop layer, behind
// the icons. They draw only when someone can see them; the governor decides
// (asleep, locked, full screen, battery, low power, heat, Keeper's processes →
// Stop all work), and the renderer also stops when Chromium reports the window
// hidden or covered (document.visibilityState).

import { app, BrowserWindow, ipcMain, screen, session, type WebContents } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { paletteById, sceneById } from '../../../core/scenes/catalog';
import type { WallpaperCost, WallpaperFrame } from '../../../core/scenes/api';
import { renderPolicy, strategyFor, type RenderPolicy } from '../../../core/scenes/policy';
import type { WallpaperSource, WallpaperStrategy } from '../../../core/scenes/types';
import { wallpaperFor } from '../../../core/vibes';
import { conditions, onChange, poll, track, workHeldUntil } from '../governor';
import { featureOn } from '../features';
import { fullscreenNow } from '../fg-watch';
import { allowRoot } from '../preview';
import { ambience } from './store';
import { attachBehindIcons } from './workerw';
import { keepUnmanaged, overlayOptions } from '../unmanaged';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

function viewUrl(query: Record<string, string>): { url?: string; file?: string; query?: Record<string, string> } {
  if (DEV_URL) return { url: `${DEV_URL}?${new URLSearchParams(query)}` };
  return { file: path.join(__dirname, '..', 'dist', 'index.html'), query };
}

function load(win: BrowserWindow, query: Record<string, string>) {
  const u = viewUrl(query);
  if (u.url) void win.loadURL(u.url);
  else void win.loadFile(u.file!, { query: u.query });
}

interface Live {
  win: BrowserWindow;
  display: string;
  strategy: WallpaperStrategy;
  sourceKey: string;
  policy: RenderPolicy;
  stats: { fps: number; frameMs: number; at: number };
  error?: string;
}

let preload = '';
let lockDown: (w: BrowserWindow) => void = () => undefined;
const live = new Map<string, Live>();
let userPaused = false;
let fullscreen = false;
let stopCover: (() => void) | null = null;
let offGov: (() => void) | null = null;
let tracker: ReturnType<typeof track> | null = null;
let onStateChange: () => void = () => undefined;
let fallbackStill: (reason: string) => void = () => undefined;

export function initWallpaperWindows(o: { preload: string; lockDown(w: BrowserWindow): void; changed(): void; fallbackStill(reason: string): void }) {
  preload = o.preload;
  lockDown = o.lockDown;
  onStateChange = o.changed;
  fallbackStill = o.fallbackStill;
  tracker = track('wallpaper', 'Live wallpaper', 'scan');
  ipcMain.handle('ambience.frame', (e) => frameFor(e.sender));
  ipcMain.on('ambience.report', (e, s: { fps: number; frameMs: number }) => {
    for (const l of live.values()) if (l.win.webContents === e.sender) l.stats = { fps: Number(s?.fps) || 0, frameMs: Number(s?.frameMs) || 0, at: Date.now() };
  });
  screen.on('display-added', () => syncWallpaper());
  screen.on('display-removed', () => syncWallpaper());
  screen.on('display-metrics-changed', () => syncWallpaper(true));
}

export function strategyHere(): WallpaperStrategy {
  return strategyFor({
    platform: process.platform,
    sessionType: process.env.XDG_SESSION_TYPE,
    waylandDisplay: !!process.env.WAYLAND_DISPLAY,
    x11Display: !!process.env.DISPLAY,
    ozoneX11: app.commandLine.getSwitchValue('ozone-platform') === 'x11',
  }, ambience().wallpaper.forceStill);
}

export function strategyNote(s: WallpaperStrategy): string {
  if (s === 'desktop-window') return process.platform === 'darwin' ? 'A window at desktop level on each display, behind the icons.' : 'A desktop-type window on each display (X11), behind the icons.';
  if (s === 'workerw') return 'A window placed behind the desktop icons (the WorkerW technique: undocumented by Microsoft but used by live-wallpaper apps for years). If Windows refuses, Keeper sets a still frame instead.';
  if (s === 'still') return process.platform === 'linux' ? 'Wayland gives apps no desktop layer, so Keeper sets a still frame as the desktop picture (through the desktop portal or your desktop’s setting) and refreshes it now and then.' : 'A still frame is set as the desktop picture.';
  return 'Live wallpapers are not available here.';
}

const keyOf = (s: WallpaperSource) => JSON.stringify(s);

function policyNow(): RenderPolicy {
  return renderPolicy({ ...ambience().wallpaper, enabled: !userPaused }, conditions(), { fullscreen }, workHeldUntil() > 0);
}

function sendPolicy(l: Live) {
  const p = policyNow();
  const changed = p.run !== l.policy.run || p.fps !== l.policy.fps || p.scale !== l.policy.scale;
  l.policy = p;
  if (changed && !l.win.isDestroyed()) l.win.webContents.send('event:wallpaper-policy', p);
  // Web pages have no renderer of ours: freeze them by throttling and muting instead.
  if (changed && l.sourceKey.includes('"kind":"web"') && !l.win.isDestroyed()) {
    l.win.webContents.setBackgroundThrottling(true);
    l.win.webContents.setFrameRate(p.run ? Math.max(1, p.fps) : 1);
  }
  return changed;
}

function refreshPolicies() {
  let any = false;
  for (const l of live.values()) any = sendPolicy(l) || any;
  const running = [...live.values()].some((l) => l.policy.run);
  tracker?.set(live.size ? (running ? 'working' : 'waiting') : 'idle', { detail: live.size ? policyNow().reason : undefined });
  if (any) onStateChange();
}

function frameFor(sender: WebContents): WallpaperFrame | null {
  for (const l of live.values()) {
    if (l.win.webContents !== sender) continue;
    const a = ambience();
    const source = wallpaperFor(a.wallpaper, l.display);
    return { display: l.display, source, palette: paletteById(source.kind === 'scene' ? source.palette : 'polar', a.palettes), policy: l.policy };
  }
  for (const s of stills.values()) if (s.win.webContents === sender) return s.frame;
  return null;
}

function allowSource(src: WallpaperSource) {
  if (src.kind === 'video' || src.kind === 'image') allowRoot(path.dirname(src.path));
  if (src.kind === 'folder') allowRoot(src.path);
}

function webSession() {
  // A separate, in-memory session: a web wallpaper never sees Keeper's cookies, and may not ask for anything.
  const s = session.fromPartition('keeper-wallpaper-web');
  s.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  return s;
}

function createWindow(d: Electron.Display, src: WallpaperSource, strategy: WallpaperStrategy): Live {
  const isWeb = src.kind === 'web';
  const win = new BrowserWindow({
    ...overlayOptions('wallpaper', { panel: false }),
    ...d.bounds, frame: false, transparent: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, focusable: false, hasShadow: false, show: false, enableLargerThanScreen: true, backgroundColor: '#000000',
    type: strategy === 'desktop-window' ? 'desktop' : undefined,
    webPreferences: isWeb
      ? { session: webSession(), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: true, autoplayPolicy: 'user-gesture-required' }
      : { preload, contextIsolation: true, sandbox: true, backgroundThrottling: true },
  });
  keepUnmanaged(win, 'wallpaper');
  win.setIgnoreMouseEvents(true);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  if (isWeb) {
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const origin = new URL(src.url).origin;
    win.webContents.on('will-navigate', (e, url) => { try { if (new URL(url).origin !== origin) e.preventDefault(); } catch { e.preventDefault(); } });
    void win.loadURL(src.url);
  } else {
    lockDown(win);
    load(win, { view: 'wallpaper', display: String(d.id) });
  }
  const l: Live = { win, display: String(d.id), strategy, sourceKey: keyOf(src), policy: { run: false, fps: 0, scale: 1 }, stats: { fps: 0, frameMs: 0, at: 0 } };
  win.once('ready-to-show', async () => {
    if (win.isDestroyed()) return;
    win.showInactive();
    if (strategy === 'workerw') {
      // Coordinates for SetWindowPos are physical pixels.
      const phys = screen.dipToScreenRect(null, d.bounds);
      const r = await attachBehindIcons(win.getNativeWindowHandle(), phys);
      if (!r.ok) { l.error = r.error; fallbackStill(r.error ?? 'Windows refused the wallpaper window'); }
    }
    sendPolicy(l);
    onStateChange();
  });
  win.on('closed', () => { if (live.get(l.display) === l) live.delete(l.display); });
  return l;
}

/** Opens, updates and closes wallpaper windows to match the settings and the connected displays. */
export function syncWallpaper(reposition = false) {
  const a = ambience();
  const strategy = strategyHere();
  const want = featureOn('wallpaper') && a.wallpaper.enabled && (strategy === 'desktop-window' || strategy === 'workerw');
  const displays = want ? screen.getAllDisplays() : [];
  const ids = new Set<string>();
  for (const d of displays) {
    const src = wallpaperFor(a.wallpaper, d.id);
    if (src.kind === 'none') continue;
    allowSource(src);
    const id = String(d.id);
    ids.add(id);
    const cur = live.get(id);
    const k = keyOf(src);
    // A web page and our own renderer are different windows; anything else swaps in place (with a cross-fade).
    if (cur && !cur.win.isDestroyed() && (cur.sourceKey.includes('"kind":"web"') === (src.kind === 'web')) && (src.kind !== 'web' || cur.sourceKey === k)) {
      if (cur.sourceKey !== k) { cur.sourceKey = k; cur.win.webContents.send('event:wallpaper-frame'); }
      if (reposition) cur.win.setBounds(d.bounds);
      continue;
    }
    if (cur && !cur.win.isDestroyed()) cur.win.destroy();
    live.set(id, createWindow(d, src, strategy));
  }
  for (const [id, l] of live) if (!ids.has(id)) { if (!l.win.isDestroyed()) l.win.destroy(); live.delete(id); }
  // Only while there are windows: one small check for full-screen apps, and the governor's events.
  if (live.size && !stopCover) {
    stopCover = poll('wallpaper-cover', { baseMs: 2500, pauseWhenLocked: true, idleFactor: 3, maxMs: 15_000 }, () => {
      // Also picks up idle time, which changes without an event (slower drawing while away).
      fullscreen = ambience().wallpaper.pauseInFullscreen ? fullscreenNow() ?? false : false;
      refreshPolicies();
    }, { feature: 'wallpaper' });
    offGov = onChange(refreshPolicies);
  } else if (!live.size && stopCover) {
    stopCover();
    stopCover = null;
    offGov?.();
    offGov = null;
    fullscreen = false;
  }
  refreshPolicies();
  onStateChange();
}

/** Pause or play without closing the windows (the last frame stays on the desktop). */
export function setUserPaused(p: boolean) {
  userPaused = p;
  refreshPolicies();
}

export const wallpaperPaused = () => userPaused;

export function stopWallpaper() {
  for (const l of live.values()) if (!l.win.isDestroyed()) l.win.destroy();
  live.clear();
  stopCover?.();
  stopCover = null;
  offGov?.();
  offGov = null;
}

export function liveInfo(display: string): { strategy: WallpaperStrategy; running: boolean; fps: number; scale: number; reason?: string; error?: string } | null {
  const l = live.get(display);
  if (!l || l.win.isDestroyed()) return null;
  return { strategy: l.strategy, running: l.policy.run, fps: l.policy.fps, scale: l.policy.scale, reason: l.policy.reason, error: l.error };
}

export const liveWindowCount = () => live.size;

/** Processor use of each wallpaper window and the GPU process, measured over `ms`. */
export async function measureCost(ms = 2000): Promise<WallpaperCost> {
  app.getAppMetrics();
  await new Promise((r) => setTimeout(r, ms));
  const metrics = app.getAppMetrics();
  const byPid = new Map(metrics.map((m) => [m.pid, m]));
  const gpu = metrics.find((m) => m.type === 'GPU');
  return {
    displays: [...live.values()].filter((l) => !l.win.isDestroyed()).map((l) => {
      const m = byPid.get(l.win.webContents.getOSProcessId());
      return { id: l.display, cpu: Math.round((m?.cpu.percentCPUUsage ?? 0) * 10) / 10, fps: Math.round(l.stats.fps * 10) / 10, frameMs: Math.round(l.stats.frameMs * 100) / 100, running: l.policy.run };
    }),
    gpuCpu: Math.round((gpu?.cpu.percentCPUUsage ?? 0) * 10) / 10,
    sampledMs: ms,
  };
}

// ---------------------------------------------------------------- still frames

const stills = new Map<WebContents, { win: BrowserWindow; frame: WallpaperFrame }>();

/**
 * Draws one frame of a wallpaper off screen and saves it as a PNG. Pictures
 * are used as they are; scenes, videos and web pages are captured.
 */
export async function captureStill(src: WallpaperSource, outDir: string): Promise<string> {
  await fsp.mkdir(outDir, { recursive: true });
  if (src.kind === 'image') return src.path;
  const d = screen.getPrimaryDisplay();
  const scale = Math.min(d.scaleFactor, 3840 / d.size.width);
  const width = Math.round(d.size.width);
  const height = Math.round(d.size.height);
  allowSource(src);
  const win = new BrowserWindow({
    width, height, show: false, frame: false, enableLargerThanScreen: true,
    webPreferences: src.kind === 'web' ? { offscreen: true, session: webSession(), sandbox: true, contextIsolation: true } : { offscreen: true, preload, sandbox: true, contextIsolation: true },
  });
  win.webContents.setZoomFactor(1);
  const a = ambience();
  const frame: WallpaperFrame = { display: 'still', source: src, palette: paletteById(src.kind === 'scene' ? src.palette : 'polar', a.palettes), policy: { run: true, fps: 30, scale: Math.min(1, scale) }, still: true };
  stills.set(win.webContents, { win, frame });
  try {
    const ready = new Promise<void>((resolve) => {
      const done = () => resolve();
      const t = setTimeout(done, src.kind === 'web' ? 6000 : 4000);
      const onReady = (e: Electron.IpcMainEvent) => {
        if (e.sender !== win.webContents) return;
        ipcMain.removeListener('ambience.ready', onReady);
        clearTimeout(t);
        setTimeout(done, 150);
      };
      ipcMain.on('ambience.ready', onReady);
      win.once('closed', () => ipcMain.removeListener('ambience.ready', onReady));
      if (src.kind === 'web') win.webContents.once('did-finish-load', () => { clearTimeout(t); setTimeout(done, 1500); });
    });
    if (src.kind === 'web') void win.loadURL(src.url);
    else load(win, { view: 'wallpaper', display: 'still', still: '1' });
    await ready;
    const img = await win.webContents.capturePage();
    const name = `still-${src.kind === 'scene' ? sceneById(src.scene)?.id ?? 'scene' : src.kind}-${Date.now().toString(36)}.png`;
    const out = path.join(outDir, name);
    await fsp.writeFile(out, img.toPNG());
    // Keep the last few; the desktop may still be showing the previous one for a moment.
    const old = (await fsp.readdir(outDir)).filter((n) => n.startsWith('still-') && n !== name).sort();
    for (const n of old.slice(0, Math.max(0, old.length - 2))) await fsp.rm(path.join(outDir, n), { force: true });
    return out;
  } finally {
    stills.delete(win.webContents);
    if (!win.isDestroyed()) win.destroy();
  }
}
