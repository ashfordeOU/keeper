// SPDX-License-Identifier: AGPL-3.0-or-later
// App updates from GitHub Releases: checked once a day, downloaded in the
// background and installed when Keeper quits. Builds that cannot update
// themselves (running from source, deb/rpm packages) say so instead.

import { app } from 'electron';
import type { UpdateStatus } from '../../core/api-x';

let status: UpdateStatus = { state: 'idle' };
let updater: typeof import('electron-updater').autoUpdater | null = null;
let listeners: ((s: UpdateStatus) => void)[] = [];

function set(s: UpdateStatus) {
  status = { ...s, checkedAt: s.checkedAt ?? status.checkedAt };
  listeners.forEach((l) => l(status));
}

function supported(): boolean {
  if (!app.isPackaged) return false;
  // On Linux only the AppImage can replace itself; packages update through the system.
  if (process.platform === 'linux' && !process.env.APPIMAGE) return false;
  return true;
}

export function onUpdateStatus(fn: (s: UpdateStatus) => void) {
  listeners.push(fn);
  return () => (listeners = listeners.filter((l) => l !== fn));
}

export async function initUpdater(enabled: () => boolean) {
  if (!supported()) {
    set({ state: 'unsupported', message: app.isPackaged ? 'This package is updated by your system’s package manager.' : 'Updates are off when running from source.' });
    return;
  }
  const { autoUpdater } = await import('electron-updater');
  updater = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => set({ state: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => set({ state: 'none', checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => set({ ...status, state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version, checkedAt: Date.now(), message: 'Installs when you quit Keeper' }));
  autoUpdater.on('error', (e) => set({ state: 'error', message: e?.message?.split('\n')[0] ?? 'Update failed', checkedAt: Date.now() }));
  const check = () => { if (enabled()) void autoUpdater.checkForUpdates().catch(() => undefined); };
  setTimeout(check, 60_000);
  setInterval(check, 24 * 3600_000);
}

export function updateStatus(): UpdateStatus {
  return status;
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!updater) return status;
  set({ state: 'checking' });
  try {
    await updater.checkForUpdates();
  } catch (e) {
    set({ state: 'error', message: e instanceof Error ? e.message.split('\n')[0] : String(e), checkedAt: Date.now() });
  }
  return status;
}

export function installUpdate() {
  if (updater && status.state === 'ready') updater.quitAndInstall();
}
