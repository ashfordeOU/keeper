// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Two small windows, in the manner of a native app: "Software Update" (opened
// by Check for Updates… in the menu bar, the app menu and the command palette,
// and by an automatic check in "Ask before installing" mode) and "About Keeper".
// Each is made when asked for and destroyed when closed; asking again while one
// is open brings it to the front. What the update window says for each state is
// worked out in core/update-window.ts; the update itself is ./updater.ts.

import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import path from 'node:path';
import type { UpdateStatus } from '../../core/api-x';
import { updateChannel } from '../../core/update-window';
import { settings, updateSettings } from '../store';
import { checkForUpdates, downloadUpdate, onUpdateStatus, scheduleUpdate, updateStatus } from './updater';

export interface UpdateWindowDeps {
  preload: string;
  load: (win: BrowserWindow, view: string) => void;
  lockDown: (win: BrowserWindow) => void;
  showMain: (route?: string) => void;
}

export interface AboutInfo {
  version: string;
  channel: 'Beta' | 'Stable';
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
}

let deps: UpdateWindowDeps | null = null;
let updateWin: BrowserWindow | null = null;
let aboutWin: BrowserWindow | null = null;
/** "Install and Relaunch" was pressed: relaunch as soon as the download is ready. */
let relaunchWhenReady = false;

function small(view: 'update' | 'about', title: string, width: number, height: number): BrowserWindow {
  const win = new BrowserWindow({
    width, height, useContentSize: true, center: true, show: false, title,
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16161a' : '#f6f5f2',
    autoHideMenuBar: true,
    // Linux shows this in the taskbar; macOS and Windows use the packaged app icon.
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: deps!.preload, contextIsolation: true, sandbox: true, backgroundThrottling: true },
  });
  // A plain native title bar with this title, and no menu bar inside the window on Windows and Linux.
  if (process.platform !== 'darwin') win.removeMenu();
  win.on('page-title-updated', (e) => e.preventDefault());
  deps!.lockDown(win);
  deps!.load(win, view);
  return win;
}

function bringUp(win: BrowserWindow, focus: boolean) {
  if (win.isMinimized()) win.restore();
  // From the menu bar Keeper may have no window in front (and no Dock icon): come forward.
  if (focus && process.platform === 'darwin') app.focus({ steal: true });
  if (focus) {
    win.show();
    win.focus();
  } else win.showInactive();
}

/**
 * Opens (or brings forward) the Software Update window. `check`: look for a new
 * version now (not while one is downloading or waiting to go in). `focus`: false
 * when an automatic check opens it, so it does not take the keyboard from you.
 */
export function openUpdateWindow(o: { check?: boolean; focus?: boolean } = {}) {
  if (!deps) return;
  const focus = o.focus !== false;
  if (o.check !== false) {
    const s = updateStatus().state;
    if (s !== 'checking' && s !== 'downloading' && s !== 'ready' && s !== 'installing') void checkForUpdates(true);
  }
  if (updateWin && !updateWin.isDestroyed()) {
    bringUp(updateWin, focus);
    return;
  }
  const win = small('update', 'Software Update', 420, 300);
  updateWin = win;
  win.once('ready-to-show', () => bringUp(win, focus));
  win.on('closed', () => {
    if (updateWin === win) updateWin = null;
  });
}

export function openAboutWindow() {
  if (!deps) return;
  if (aboutWin && !aboutWin.isDestroyed()) {
    bringUp(aboutWin, true);
    return;
  }
  const win = small('about', 'About Keeper', 340, 420);
  aboutWin = win;
  win.once('ready-to-show', () => bringUp(win, true));
  win.on('closed', () => {
    if (aboutWin === win) aboutWin = null;
  });
}

/** Downloads the update and relaunches into it, like "Install and Relaunch" in a native app. */
export async function installAndRelaunch(): Promise<UpdateStatus> {
  const s = updateStatus();
  if (s.state === 'ready') return scheduleUpdate('now');
  if (s.state !== 'available') return s;
  // Copies that cannot replace themselves open the download instead (downloadUpdate does that).
  relaunchWhenReady = !!s.canInstall && s.method !== 'manager';
  return downloadUpdate();
}

export function aboutInfo(): AboutInfo {
  const s = settings();
  const version = app.getVersion();
  return {
    version, channel: updateChannel(version, s.updateBeta, s.updateBetaChosen),
    electron: process.versions.electron ?? '', chrome: process.versions.chrome ?? '', node: process.versions.node ?? '',
    platform: process.platform, arch: process.arch,
  };
}

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

export function registerUpdateWindowIpc(d: UpdateWindowDeps) {
  deps = d;
  onUpdateStatus((s) => {
    if (!relaunchWhenReady) return;
    if (s.state === 'ready') {
      relaunchWhenReady = false;
      // After the updater has finished its own "ready" work.
      setTimeout(() => void scheduleUpdate('now'), 0);
    } else if (s.state !== 'available' && s.state !== 'downloading') relaunchWhenReady = false;
  });
  handle('appInfo.openUpdateWindow', (check?: boolean) => openUpdateWindow({ check: check !== false }));
  handle('appInfo.installAndRelaunch', () => installAndRelaunch());
  handle('appInfo.skipVersion', async (version: string) => {
    if (typeof version === 'string' && version) await updateSettings({ updateSkip: version.replace(/^v/i, '') });
    updateWin?.close();
  });
  handle('appInfo.openUpdateSettings', () => {
    d.showMain('settings:updates');
    updateWin?.close();
  });
  handle('appInfo.openAbout', () => openAboutWindow());
  handle('appInfo.about', () => aboutInfo());
}
