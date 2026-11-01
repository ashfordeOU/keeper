// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Stage mode's windows: one transparent, click-through overlay per screen
// (pointer spotlight or highlight, click ripples, keystrokes, the countdown
// and the level HUD of the display keys), and one backdrop per screen at the
// desktop level, under every app. Nothing exists, and nothing runs, until one
// of them is needed; the pointer is followed only while a spotlight is on and
// only when it moves.

import { BrowserWindow, screen, type Display } from 'electron';
import { backdropHtml, overlayHtml, spotRadius, type OverlayConfig } from '../../../core/stage/overlay';
import type { StageSwitches } from '../../../core/stage/types';
import { keepUnmanaged, overlayOptions } from '../unmanaged';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const dataUrl = (html: string) => `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

interface Look { spotlight: StageSwitches['spotlight']; clicks: boolean; keys: boolean }

const overlays = new Map<number, BrowserWindow>();
const backdrops = new Map<number, BrowserWindow>();
let look: Look = { spotlight: { mode: 'off', size: 'm', dim: 55 }, clicks: false, keys: false };
let follow: NodeJS.Timeout | null = null;
let lastPoint = { x: NaN, y: NaN };
let lastDisplay = -1;
let hudTimer: NodeJS.Timeout | null = null;
let listening = false;

function makeOverlay(d: Display): BrowserWindow {
  const w = new BrowserWindow({
    ...overlayOptions('stage'),
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    transparent: true, frame: false, resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false,
    alwaysOnTop: true, fullscreenable: false, show: false, backgroundColor: '#00000000', enableLargerThanScreen: true,
    title: 'Keeper Stage overlay',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, backgroundThrottling: false, spellcheck: false },
  });
  keepUnmanaged(w, 'stage');
  w.setIgnoreMouseEvents(true);
  w.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  // Updates wait until the page is loaded and configured, so nothing sent early is lost.
  ready.set(w.id, w.loadURL(dataUrl(overlayHtml())).then(() => w.webContents.executeJavaScript(`window.stage.config(${JSON.stringify(configFor(d))})`, true)).then(() => undefined, () => undefined));
  return w;
}

const ready = new Map<number, Promise<void>>();

function configFor(d: Display): OverlayConfig {
  return { spotlight: look.spotlight, radius: spotRadius(look.spotlight.size, d.bounds.height), clicks: look.clicks, keys: look.keys, keysHere: d.id === screen.getPrimaryDisplay().id };
}

function configure(w: BrowserWindow, d: Display) {
  void exec(w, `window.stage && window.stage.config(${JSON.stringify(configFor(d))})`);
}

async function exec(w: BrowserWindow | undefined, js: string): Promise<unknown> {
  if (!w || w.isDestroyed()) return undefined;
  // A new overlay is still loading its page: wait for it instead of dropping the update.
  await ready.get(w.id);
  if (w.isDestroyed()) return undefined;
  return w.webContents.executeJavaScript(js, true).catch(() => undefined);
}

function ensureOverlays() {
  const ds = screen.getAllDisplays();
  for (const d of ds) {
    let w = overlays.get(d.id);
    if (!w || w.isDestroyed()) { w = makeOverlay(d); overlays.set(d.id, w); }
    else { w.setBounds(d.bounds); configure(w, d); }
    if (!w.isVisible()) w.showInactive();
  }
  for (const [id, w] of overlays) if (!ds.some((d) => d.id === id)) { w.destroy(); overlays.delete(id); }
  if (!listening) {
    listening = true;
    screen.on('display-added', relayout);
    screen.on('display-removed', relayout);
    screen.on('display-metrics-changed', relayout);
  }
}

function relayout() {
  if (overlays.size) ensureOverlays();
  if (backdrops.size) void showBackdrop(currentBackdrop!, currentWallpaper);
}

function closeOverlays() {
  for (const w of overlays.values()) if (!w.isDestroyed()) w.destroy();
  overlays.clear();
  ready.clear();
  if (listening && !backdrops.size) {
    listening = false;
    screen.off('display-added', relayout);
    screen.off('display-removed', relayout);
    screen.off('display-metrics-changed', relayout);
  }
}

/** Follows the pointer while a spotlight or highlight is on (60 times a second, only sending when it moved). */
function setFollow(on: boolean) {
  if (on && !follow) {
    follow = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      if (p.x === lastPoint.x && p.y === lastPoint.y) return;
      lastPoint = p;
      const d = screen.getDisplayNearestPoint(p);
      if (d.id !== lastDisplay) {
        void exec(overlays.get(lastDisplay), 'window.stage && window.stage.away()');
        lastDisplay = d.id;
      }
      void exec(overlays.get(d.id), `window.stage && window.stage.pointer(${p.x - d.bounds.x}, ${p.y - d.bounds.y})`);
    }, 16);
  } else if (!on && follow) {
    clearInterval(follow);
    follow = null;
    lastPoint = { x: NaN, y: NaN };
    lastDisplay = -1;
  }
}

const needed = () => look.spotlight.mode !== 'off' || look.clicks || look.keys;

/** Turns the overlays on or off for what Stage shows. */
export function setLook(next: Look) {
  look = next;
  if (needed()) ensureOverlays();
  else if (!hudTimer) closeOverlays();
  setFollow(look.spotlight.mode !== 'off');
}

export function clearLook() {
  setLook({ spotlight: { mode: 'off', size: 'm', dim: 55 }, clicks: false, keys: false });
}

/** A click at a point on the screen (global coordinates). */
export function showClick(x: number, y: number, right = false) {
  if (!look.clicks) return;
  const d = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
  void exec(overlays.get(d.id), `window.stage && window.stage.click(${Math.round(x - d.bounds.x)}, ${Math.round(y - d.bounds.y)}, ${right})`);
}

export function showKey(label: string) {
  if (!look.keys) return;
  void exec(overlays.get(screen.getPrimaryDisplay().id), `window.stage && window.stage.key(${JSON.stringify(label)})`);
}

/** The 3-2-1 countdown on every screen (0 hides it). */
export function showCountdown(n: number) {
  if (n > 0) ensureOverlays();
  for (const w of overlays.values()) void exec(w, `window.stage && window.stage.countdown(${n})`);
  if (n <= 0 && !needed() && !hudTimer) closeOverlays();
}

/** A short level HUD on the screen with the pointer (the display keys). */
export function showHud(text: string, pct: number) {
  ensureOverlays();
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  void exec(overlays.get(d.id), `window.stage && window.stage.hud(${JSON.stringify(text)}, ${Math.round(pct)})`);
  if (hudTimer) clearTimeout(hudTimer);
  hudTimer = setTimeout(() => { hudTimer = null; if (!needed()) closeOverlays(); }, 2000);
}

/** What each overlay shows now (the end-to-end test and diagnostics read this). */
export async function overlayState(): Promise<{ display: number; state: unknown }[]> {
  const out: { display: number; state: unknown }[] = [];
  for (const [id, w] of overlays) out.push({ display: id, state: await exec(w, 'window.stage && window.stage.state()') });
  return out;
}

export function overlayWindows(): BrowserWindow[] {
  return [...overlays.values(), ...backdrops.values()].filter((w) => !w.isDestroyed());
}

// ---------------------------------------------------------------- the backdrop

let currentBackdrop: StageSwitches['backdrop'] | null = null;
let currentWallpaper: string | undefined;

/** Sends a window to the bottom of the stack on Windows (above the desktop, below every app). */
async function winToBottom(w: BrowserWindow) {
  const h = w.getNativeWindowHandle();
  const hwnd = h.length >= 8 ? h.readBigUInt64LE(0).toString() : String(h.readUInt32LE(0));
  const { powershell } = await import('../../../core/platform');
  await powershell(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class KeeperZ { [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f); }'
[KeeperZ]::SetWindowPos([IntPtr]${hwnd}, [IntPtr]1, 0, 0, 0, 0, 0x13) | Out-Null`, 15_000);
}

export async function showBackdrop(b: StageSwitches['backdrop'], wallpaper?: string) {
  currentBackdrop = b;
  currentWallpaper = wallpaper;
  const html = dataUrl(backdropHtml(b, wallpaper));
  const ds = screen.getAllDisplays();
  for (const d of ds) {
    let w = backdrops.get(d.id);
    if (!w || w.isDestroyed()) {
      w = new BrowserWindow({
        ...overlayOptions('backdrop', { panel: false }),
        x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
        frame: false, resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false, show: false, fullscreenable: false,
        backgroundColor: '#111111', enableLargerThanScreen: true, title: 'Keeper Stage backdrop',
        // The desktop level sits under every app (above the wallpaper) on macOS and Linux; Windows is sent to the bottom below.
        ...(isWin ? {} : { type: 'desktop' as const }),
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, spellcheck: false },
      });
      keepUnmanaged(w, 'backdrop');
      w.setIgnoreMouseEvents(true);
      if (isMac) w.setVisibleOnAllWorkspaces(true);
      backdrops.set(d.id, w);
    } else w.setBounds(d.bounds);
    await w.loadURL(html).catch(() => undefined);
    w.showInactive();
    if (isWin) await winToBottom(w).catch(() => undefined);
  }
  for (const [id, w] of backdrops) if (!ds.some((d) => d.id === id)) { w.destroy(); backdrops.delete(id); }
  if (!listening) {
    listening = true;
    screen.on('display-added', relayout);
    screen.on('display-removed', relayout);
    screen.on('display-metrics-changed', relayout);
  }
}

export function hideBackdrop() {
  for (const w of backdrops.values()) if (!w.isDestroyed()) w.destroy();
  backdrops.clear();
  currentBackdrop = null;
  if (!overlays.size && listening) {
    listening = false;
    screen.off('display-added', relayout);
    screen.off('display-removed', relayout);
    screen.off('display-metrics-changed', relayout);
  }
}

export function backdropCount() {
  return [...backdrops.values()].filter((w) => !w.isDestroyed() && w.isVisible()).length;
}
