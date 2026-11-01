// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The glance: the pop-over under the owl in the menu bar (the tray icon on
// Windows and Linux). A left click opens it; on macOS resting the pointer on
// the owl for 400 ms opens it too (Settings → Menu bar → "Show the glance on
// hover"), and it closes shortly after the pointer has left both the owl and
// the pop-over. Its numbers are read only while it is open, through the
// governor (core/glance.ts makes the cards).

import { BrowserWindow, nativeTheme, screen, type Tray } from 'electron';
import { glanceCards, normalizeGlanceSettings, type GlanceInputs, type GlanceRecentFile, type GlanceSettings, type GlanceView } from '../../core/glance';
import { poll } from './governor';
import { unwatchLive } from './monitor-live';
import { keepUnmanaged, overlayOptions } from './unmanaged';

export type GlanceRecent = GlanceRecentFile;

export interface GlanceDeps {
  preload: string;
  load: (win: BrowserWindow, view: string) => void;
  lockDown: (win: BrowserWindow) => void;
  settings: () => Partial<GlanceSettings> | undefined;
  /** the readings; asked only while the glance is open */
  inputs: () => Promise<GlanceInputs>;
  recent: (n: number) => { list: GlanceRecent[]; total: number };
}

const W = 360;
const H = 520;
let deps: GlanceDeps | null = null;
let win: BrowserWindow | null = null;
let anchor: Tray | null = null;
let stopPoll: (() => void) | undefined;
let hoverTimer: NodeJS.Timeout | undefined;
let leaveWatch: NodeJS.Timeout | undefined;
let openedByHover = false;

export function initGlance(d: GlanceDeps) {
  deps = d;
}

export const glanceSettings = (): GlanceSettings => normalizeGlanceSettings(deps?.settings());

/** Everything the pop-over draws, read now. */
export async function glanceView(): Promise<GlanceView> {
  const s = glanceSettings();
  const inputs = deps ? await deps.inputs().catch(() => ({ now: Date.now() })) : { now: Date.now() };
  const r = deps?.recent(3) ?? { list: [], total: 0 };
  return { cards: glanceCards(inputs, s.cards), actions: s.actions, recent: r.list, moreRecent: Math.max(0, r.total - r.list.length), settings: s };
}

export const glanceOpen = () => !!win && !win.isDestroyed() && win.isVisible();

function make(): BrowserWindow {
  const w = new BrowserWindow({
    ...overlayOptions('popover'),
    width: W, height: H, frame: false, resizable: false, show: false, alwaysOnTop: true, transparent: process.platform === 'darwin',
    backgroundColor: process.platform === 'darwin' ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#1b1b20' : '#fbfbfa',
    vibrancy: process.platform === 'darwin' ? 'popover' : undefined,
    webPreferences: { preload: deps!.preload, contextIsolation: true, sandbox: true, backgroundThrottling: true },
  });
  keepUnmanaged(w, 'popover');
  deps!.lockDown(w);
  deps!.load(w, 'glance');
  w.on('blur', () => { if (!openedByHover && !w.webContents.isDevToolsOpened()) hideGlance(); });
  w.on('hide', stopLive);
  w.on('closed', () => { stopLive(); win = null; });
  return w;
}

/** Under the owl when the system says where it is; else under the pointer. */
function place(w: BrowserWindow) {
  const b = anchor && !anchor.isDestroyed() ? anchor.getBounds() : undefined;
  const pt = b && b.width ? { x: b.x + b.width / 2, y: b.y + b.height } : screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(pt).workArea;
  const x = Math.round(Math.min(Math.max(wa.x + 8, pt.x - W / 2), wa.x + wa.width - W - 8));
  const top = pt.y < wa.y + wa.height / 2;
  const y = Math.round(top ? Math.max(wa.y + 4, pt.y + 4) : Math.min(wa.y + wa.height - H - 4, pt.y - H - 4));
  w.setBounds({ x, y, width: W, height: H });
}

function startLive() {
  // Live numbers while it is open: a look every 2 s through the governor (paused while locked).
  stopPoll ??= poll('glance', { baseMs: 2000, idleFactor: 1, pauseWhenLocked: true }, async () => {
    if (!glanceOpen()) return;
    const v = await glanceView();
    if (glanceOpen()) win!.webContents.send('event:glance', v);
  });
}

function stopLive() {
  unwatchLive('glance');
  stopPoll?.();
  stopPoll = undefined;
  clearInterval(leaveWatch);
  leaveWatch = undefined;
}

export function showGlance(from?: Tray | null, how: 'click' | 'hover' = 'click') {
  if (!deps) return;
  if (from) anchor = from;
  openedByHover = how === 'hover';
  if (!win || win.isDestroyed()) win = make();
  place(win);
  if (how === 'hover') {
    win.showInactive();
    watchLeave();
  } else {
    win.show();
    win.focus();
  }
  startLive();
}

export function hideGlance() {
  clearTimeout(hoverTimer);
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
}

export function toggleGlance(from?: Tray | null) {
  if (glanceOpen() && !openedByHover) hideGlance();
  else showGlance(from, 'click');
}

const inside = (p: Electron.Point, r?: Electron.Rectangle, pad = 6) => !!r && p.x >= r.x - pad && p.x <= r.x + r.width + pad && p.y >= r.y - pad && p.y <= r.y + r.height + pad;

/** After a hover opened it: close once the pointer has been away from the owl and the pop-over for a moment. */
function watchLeave() {
  clearInterval(leaveWatch);
  let away = 0;
  leaveWatch = setInterval(() => {
    if (!glanceOpen() || !openedByHover) { clearInterval(leaveWatch); return; }
    const p = screen.getCursorScreenPoint();
    const over = inside(p, win!.getBounds(), 0) || inside(p, anchor && !anchor.isDestroyed() ? anchor.getBounds() : undefined);
    // Clicking into the glance makes it stay like a clicked one.
    if (win!.isFocused()) { openedByHover = false; clearInterval(leaveWatch); return; }
    away = over ? 0 : away + 1;
    if (away >= 3) hideGlance();
  }, 150);
}

/** Hover on the owl (macOS reports these; elsewhere they never fire). */
export function attachHover(tray: Tray) {
  tray.on('mouse-enter', () => {
    if (!glanceSettings().hover || glanceOpen()) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showGlance(tray, 'hover'), 400);
  });
  tray.on('mouse-leave', () => {
    clearTimeout(hoverTimer);
  });
}
