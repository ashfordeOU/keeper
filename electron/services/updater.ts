// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper updates itself from GitHub Releases.
//
//   Windows installer, Linux AppImage  electron-updater downloads and swaps in place
//   macOS (.dmg)                       Keeper downloads the new dmg, copies the app
//                                      next to itself and swaps it on quit
//   Linux .deb / .rpm                  downloaded, then installed with the system's
//                                      own password prompt (pkexec)
//   portable / tar.gz / from source    tells you, and opens the right download
//
// The person chooses: install automatically, ask first, or only check on demand.

import { app, net, Notification, shell } from 'electron';
import { spawn } from 'node:child_process';
import { constants, createWriteStream, existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UpdateStatus } from '../../core/api-x';
import { run } from '../../core/platform';
import { detectInstallSource, INSTALL_SOURCES } from '../../core/install-source';
import { compareVersions, pickAsset, pickRelease, releaseFor, versionNotes, type GhAsset, type GhRelease, type InstallKind, type VersionNote } from '../../core/updates';
import { settings, updateSettings } from '../store';

const REPO = 'ashfordeOU/keeper';
const RELEASES = `https://github.com/${REPO}/releases`;
const CHECK_EVERY = 6 * 3600_000;
/**
 * A different place to read releases from: a company mirror, or a local folder
 * served over HTTP for testing. It must contain releases.json (the GitHub
 * releases list format) and the latest*.yml files next to the installers.
 */
const FEED = process.env.KEEPER_UPDATE_FEED?.replace(/\/$/, '');

let status: UpdateStatus = { state: 'idle', current: app.getVersion() };
let listeners: ((s: UpdateStatus) => void)[] = [];
let kind: InstallKind = 'source';
let release: GhRelease | undefined;
let asset: GhAsset | undefined;
let downloaded: string | undefined;
let notifiedFor = '';
let installOnQuit = false;
let eu: typeof import('electron-updater').autoUpdater | null = null;
let notify: (s: UpdateStatus) => void = () => undefined;

function set(s: Partial<UpdateStatus>) {
  status = { ...status, ...s, current: app.getVersion() };
  listeners.forEach((l) => l(status));
}

export function onUpdateStatus(fn: (s: UpdateStatus) => void) {
  listeners.push(fn);
  return () => (listeners = listeners.filter((l) => l !== fn));
}

export function updateStatus(): UpdateStatus {
  return status;
}

// ---------------------------------------------------------------- how was Keeper installed?

async function detectKind(): Promise<InstallKind> {
  if (!app.isPackaged) return 'source';
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : 'nsis';
  if (process.env.APPIMAGE) return 'appimage';
  const exe = process.execPath;
  if ((await run('dpkg', ['-S', exe], 5000)).ok) return 'deb';
  if ((await run('rpm', ['-qf', exe], 5000)).ok) return 'rpm';
  return 'tar';
}

// A copy that Scoop, Chocolatey, Flatpak, Snap, the AUR or Keeper's apt/dnf
// repositories installed is updated by them, so Keeper only says how.
const source = detectInstallSource(process.execPath, process.env, process.platform, existsSync);
const managed = app.isPackaged && !INSTALL_SOURCES[source].selfUpdate;

function methodFor(k: InstallKind): Pick<UpdateStatus, 'method' | 'canInstall' | 'manager'> {
  if (managed) return { method: 'manager', canInstall: false, manager: { label: INSTALL_SOURCES[source].label, command: INSTALL_SOURCES[source].updateCommand } };
  if (k === 'nsis' || k === 'appimage' || k === 'mac') return { method: 'in-place', canInstall: true };
  if (k === 'deb' || k === 'rpm') return { method: 'package', canInstall: true };
  return { method: 'manual', canInstall: false };
}

// ---------------------------------------------------------------- checking

async function fetchReleases(): Promise<GhRelease[]> {
  const res = await net.fetch(FEED ? `${FEED}/releases.json` : `https://api.github.com/repos/${REPO}/releases?per_page=20`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': `Keeper/${app.getVersion()}` },
  });
  if (!res.ok) throw new Error(res.status === 403 ? 'GitHub is limiting requests right now; try again in a while' : `GitHub returned ${res.status}`);
  return (await res.json()) as GhRelease[];
}

/** Looks for a newer version. `user` = the person pressed the button (works even when checks are off). */
export async function checkForUpdates(user = true): Promise<UpdateStatus> {
  if (status.state === 'downloading' || status.state === 'installing') return status;
  set({ state: 'checking', message: undefined });
  try {
    const s = settings();
    const list = await fetchReleases();
    release = pickRelease(list, app.getVersion(), s.updateBeta);
    if (!release) {
      set({ state: 'none', version: undefined, notes: undefined, checkedAt: Date.now(), message: 'Keeper is up to date' });
      return status;
    }
    asset = pickAsset(release.assets, process.platform, process.arch, kind === 'source' ? (process.platform === 'linux' ? 'appimage' : process.platform === 'darwin' ? 'mac' : 'nsis') : kind);
    const version = release.tag_name.replace(/^v/i, '');
    if (downloaded && status.version !== version) downloaded = undefined;
    set({
      state: downloaded ? 'ready' : 'available', version, notes: release.body ?? '', url: release.html_url, publishedAt: release.published_at ?? undefined,
      size: asset?.size, checkedAt: Date.now(), ...methodFor(kind),
      message: kind === 'source' ? 'You are running Keeper from source; pull the latest code to update.' : managed ? `Installed with ${INSTALL_SOURCES[source].label}; update it there.` : !asset ? 'This release has no installer for this computer yet' : undefined,
    });
    if (!asset && kind !== 'source' && !managed) set({ canInstall: false, method: 'manual' });
    if (notifiedFor !== version) {
      notifiedFor = version;
      notify(status);
    }
    // Automatic mode downloads straight away (package installs still ask for the password later).
    if (!user && s.updateMode === 'auto' && status.canInstall && !downloaded) void downloadUpdate();
  } catch (e) {
    set({ state: 'error', checkedAt: Date.now(), message: e instanceof Error ? e.message.split('\n')[0] : String(e) });
  }
  return status;
}

// ---------------------------------------------------------------- downloading

async function downloadTo(url: string, file: string, size?: number) {
  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || size || 0;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  const out = createWriteStream(tmp);
  const reader = res.body.getReader();
  let got = 0;
  let last = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.byteLength;
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
      if (total && Date.now() - last > 250) {
        last = Date.now();
        set({ state: 'downloading', percent: Math.round((got / total) * 100) });
      }
    }
  } finally {
    await new Promise<void>((r) => out.end(r));
  }
  if (total && got < total) throw new Error('The download was cut short');
  await fsp.rename(tmp, file);
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!release) await checkForUpdates();
  if (!release || status.state === 'downloading') return status;
  if (managed) return status;
  if (!status.canInstall || !asset) {
    // Portable copies, tarballs and source checkouts: hand over to the release page.
    await shell.openExternal(release.html_url);
    return status;
  }
  set({ state: 'downloading', percent: 0, message: undefined });
  try {
    if (kind === 'nsis' || kind === 'appimage') {
      eu ??= (await import('electron-updater')).autoUpdater;
      eu.autoDownload = false;
      eu.autoInstallOnAppQuit = false;
      eu.allowPrerelease = settings().updateBeta;
      eu.logger = null;
      if (FEED) eu.setFeedURL({ provider: 'generic', url: FEED });
      eu.removeAllListeners('download-progress');
      eu.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }));
      await eu.checkForUpdates();
      await eu.downloadUpdate();
      downloaded = 'electron-updater';
    } else {
      const dir = path.join(app.getPath('userData'), 'updates');
      const file = path.join(dir, asset.name);
      if (!existsSync(file) || (await fsp.stat(file)).size !== asset.size) await downloadTo(asset.browser_download_url, file, asset.size);
      downloaded = file;
      if (kind === 'mac') await stageMac(file);
    }
    const auto = settings().updateMode === 'auto';
    installOnQuit = auto && kind !== 'deb' && kind !== 'rpm';
    set({
      state: 'ready', percent: 100,
      message: kind === 'deb' || kind === 'rpm' ? 'Ready. Installing asks for your password.' : auto ? 'Installs when you quit Keeper, or restart now' : 'Ready to install',
    });
    notify(status);
  } catch (e) {
    downloaded = undefined;
    set({ state: 'error', message: e instanceof Error ? e.message.split('\n')[0] : String(e) });
  }
  return status;
}

// ---------------------------------------------------------------- macOS: swap the app bundle

let staged: { current: string; next: string } | undefined;

/** The .app bundle Keeper runs from. */
function currentBundle(): string {
  return path.resolve(process.execPath, '..', '..', '..');
}

async function stageMac(dmg: string) {
  const current = currentBundle();
  const dir = path.dirname(current);
  try {
    await fsp.access(dir, constants.W_OK);
  } catch {
    // e.g. installed by an administrator: fall back to opening the dmg so the person can drag it in.
    staged = undefined;
    return;
  }
  const mount = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-update-'));
  const attach = await run('/usr/bin/hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount], 120_000);
  if (!attach.ok) throw new Error('Could not open the downloaded disk image');
  try {
    const appName = (await fsp.readdir(mount)).find((n) => n.endsWith('.app'));
    if (!appName) throw new Error('The disk image has no app inside');
    const next = path.join(dir, `.Keeper-${status.version ?? 'update'}.app`);
    await fsp.rm(next, { recursive: true, force: true });
    const copy = await run('/usr/bin/ditto', [path.join(mount, appName), next], 300_000);
    if (!copy.ok) throw new Error('Could not copy the new version');
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', next], 30_000);
    staged = { current, next };
  } finally {
    await run('/usr/bin/hdiutil', ['detach', mount, '-quiet'], 60_000);
    await fsp.rmdir(mount).catch(() => undefined);
  }
}

/** A tiny script that waits for Keeper to exit, swaps the bundles and (optionally) reopens it. */
function swapMac(relaunch: boolean) {
  if (!staged) return false;
  const trash = path.join(os.homedir(), '.Trash', `Keeper ${app.getVersion()}.app`);
  const script = `
PID=${process.pid}
while kill -0 $PID 2>/dev/null; do sleep 0.3; done
rm -rf "${trash}"
if mv "${staged.current}" "${trash}" && mv "${staged.next}" "${staged.current}"; then
  touch "${staged.current}"
  ${relaunch ? `open "${staged.current}"` : ''}
else
  [ -d "${staged.current}" ] || mv "${trash}" "${staged.current}"
fi`;
  spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

// ---------------------------------------------------------------- installing

export async function installUpdate(): Promise<void> {
  if (status.state !== 'ready') return;
  set({ state: 'installing', message: undefined });
  try {
    if (downloaded === 'electron-updater' && eu) {
      eu.quitAndInstall(false, true);
      return;
    }
    if (kind === 'mac') {
      if (swapMac(true)) {
        app.quit();
        return;
      }
      // Could not swap in place: open the disk image so the person can drag the new version in.
      if (downloaded) await shell.openPath(downloaded);
      set({ state: 'ready', message: 'Drag Keeper into Applications to replace the old version' });
      return;
    }
    if ((kind === 'deb' || kind === 'rpm') && downloaded) {
      const args = kind === 'deb' ? ['apt-get', 'install', '-y', '--allow-downgrades', downloaded] : ['dnf', 'install', '-y', downloaded];
      let r = await run('pkexec', args, 600_000);
      if (!r.ok && kind === 'deb') r = await run('pkexec', ['dpkg', '-i', downloaded], 600_000);
      if (!r.ok && kind === 'rpm') r = await run('pkexec', ['rpm', '-U', downloaded], 600_000);
      if (!r.ok) throw new Error('The update was not installed (the password prompt was cancelled or the package manager refused)');
      app.relaunch();
      app.quit();
      return;
    }
    if (release) await shell.openExternal(release.html_url);
  } catch (e) {
    set({ state: 'error', message: e instanceof Error ? e.message.split('\n')[0] : String(e) });
  }
}

/** Called from before-quit: in automatic mode a downloaded update goes in now. */
export function installOnQuitIfReady() {
  if (!installOnQuit || status.state !== 'ready') return;
  if (downloaded === 'electron-updater' && eu) {
    eu.autoInstallOnAppQuit = true;
  } else if (kind === 'mac') {
    swapMac(false);
  }
}

export async function openReleasesPage() {
  await shell.openExternal(release?.html_url ?? `${RELEASES}/latest`);
}

// ---------------------------------------------------------------- short notes for hover cards

let notesCache: { at: number; list: VersionNote[] } | undefined;

/** Short notes for this version and every newer one, cached for an hour. */
export async function listVersionNotes(): Promise<VersionNote[]> {
  if (notesCache && Date.now() - notesCache.at < 3600_000) return notesCache.list;
  try {
    const list = versionNotes(await fetchReleases(), app.getVersion(), settings().updateBeta);
    notesCache = { at: Date.now(), list };
    return list;
  } catch {
    return notesCache?.list ?? [];
  }
}

// ---------------------------------------------------------------- after an update

/** Release notes for the version now running, once, right after an update. */
export async function whatsNew(): Promise<{ version: string; notes: string; url: string } | null> {
  const s = settings();
  const now = app.getVersion();
  const last = s.lastRunVersion;
  if (last === now) return null;
  await updateSettings({ lastRunVersion: now });
  // First run ever: nothing to announce.
  if (!last || compareVersions(now, last) <= 0) return null;
  try {
    const r = releaseFor(await fetchReleases(), now);
    return r ? { version: now, notes: r.body ?? '', url: r.html_url } : { version: now, notes: '', url: `${RELEASES}/tag/v${now}` };
  } catch {
    return { version: now, notes: '', url: `${RELEASES}/tag/v${now}` };
  }
}

// ---------------------------------------------------------------- start

export async function initUpdater(onNotify: (s: UpdateStatus) => void) {
  notify = (s) => {
    onNotify(s);
    if (!Notification.isSupported()) return;
    if (s.state === 'available') new Notification({ title: `Keeper ${s.version} is available`, body: s.method === 'manager' && s.manager?.command ? `Update with: ${s.manager.command}` : settings().updateMode === 'auto' && s.canInstall ? 'Downloading it in the background.' : 'Open Keeper to see what’s new and update.' }).show();
    else if (s.state === 'ready') new Notification({ title: `Keeper ${s.version} is ready`, body: s.message ?? 'Restart Keeper to finish updating.' }).show();
  };
  kind = await detectKind();
  set({ ...methodFor(kind), state: kind === 'source' ? 'idle' : status.state });
  const tick = () => {
    if (settings().updateMode !== 'off') void checkForUpdates(false);
  };
  setTimeout(tick, 45_000);
  setInterval(tick, CHECK_EVERY);
}
