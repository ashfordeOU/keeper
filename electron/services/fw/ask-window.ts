// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The firewall's Ask prompt: a small window in the top corner, one app at a
// time with every place it wants to reach. It gathers prompts for a moment,
// waits while you type (core/fw/live.ts, askTiming), and opens without taking
// the keyboard (showInactive), so it never steals focus. "Later" hides it for
// a while; the prompts stay on the firewall page and in the menu bar.

import { BrowserWindow, powerMonitor, screen } from 'electron';
import { askTiming } from '../../../core/fw/live';
import { keepUnmanaged, overlayOptions } from '../unmanaged';

export interface AskWindowDeps {
  preload: string;
  load: (win: BrowserWindow, view: string) => void;
  lockDown: (win: BrowserWindow) => void;
}

const W = 380;
const MIN_H = 160;
let H = 300;
let deps: AskWindowDeps | undefined;
let win: BrowserWindow | null = null;
let timer: NodeJS.Timeout | undefined;
let snoozedUntil = 0;
let source: () => { since?: number; count: number; enabled: boolean } = () => ({ count: 0, enabled: false });

export function initAskWindow(d: AskWindowDeps, src: typeof source) {
  deps = d;
  source = src;
}

const open = () => !!win && !win.isDestroyed() && win.isVisible();

function idleMs(): number {
  try { return powerMonitor.getSystemIdleTime() * 1000; } catch { return 60_000; }
}

function place(w: BrowserWindow) {
  const wa = screen.getPrimaryDisplay().workArea;
  // Top right, under the menu bar on a Mac; near the tray's corner elsewhere it would cover the taskbar's pop-ups, so top right everywhere.
  w.setBounds({ x: Math.round(wa.x + wa.width - W - 12), y: Math.round(wa.y + 12), width: W, height: H });
}

function make(): BrowserWindow {
  const w = new BrowserWindow({
    ...overlayOptions('ask'),
    width: W, height: H, frame: false, resizable: false, show: false, alwaysOnTop: true, transparent: true, hasShadow: true, focusable: true,
    webPreferences: { preload: deps!.preload, contextIsolation: true, sandbox: true, backgroundThrottling: true },
  });
  keepUnmanaged(w, 'ask');
  w.setAlwaysOnTop(true, 'floating');
  deps!.lockDown(w);
  deps!.load(w, 'netask');
  w.on('closed', () => { win = null; });
  return w;
}

/** Shows it without taking the keyboard. */
function show() {
  if (!deps) return;
  if (!win || win.isDestroyed()) {
    win = make();
    win.once('ready-to-show', () => { if (win && !win.isDestroyed()) { place(win); win.showInactive(); } });
    return;
  }
  place(win);
  if (!win.isVisible()) win.showInactive();
}

export function hideAsk() {
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
}

/** Called whenever the prompts change: decides whether to show, wait or hide. */
export function askChanged() {
  clearTimeout(timer);
  timer = undefined;
  const s = source();
  if (!s.enabled || !s.count) { hideAsk(); return; }
  if (open()) { win!.webContents.send('event:fw-changed'); return; }
  const t = askTiming({ now: Date.now(), pendingSince: s.since, idleMs: idleMs(), showing: false, snoozedUntil });
  if (t.show) show();
  else if (t.recheckMs !== undefined) timer = setTimeout(askChanged, Math.max(250, t.recheckMs));
}

/** "Later": quiet for a while (the prompts wait on the firewall page). */
export function askLater(minutes = 10) {
  snoozedUntil = Date.now() + minutes * 60_000;
  hideAsk();
  clearTimeout(timer);
  timer = setTimeout(askChanged, minutes * 60_000);
}

/** Opened on purpose (the menu bar's "waiting" pill): now, and this time with the keyboard. */
export function askShowNow() {
  snoozedUntil = 0;
  if (!source().count) return;
  show();
  setTimeout(() => { if (win && !win.isDestroyed()) win.focus(); }, 50);
}

/** The page measured itself: the window takes that height. */
export function askFit(height: number) {
  if (!Number.isFinite(height)) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const h = Math.round(Math.min(Math.max(MIN_H, height), wa.height - 24));
  if (h === H) return;
  H = h;
  if (win && !win.isDestroyed()) place(win);
}

export function stopAskWindow() {
  clearTimeout(timer);
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}
