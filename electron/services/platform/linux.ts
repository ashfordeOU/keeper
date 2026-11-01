// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Linux: registers Keeper with GNOME's and KDE's search (files in the
// person's own ~/.local/share, removed again when switched off) and serves
// results over D-Bus while Keeper runs.

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dbusServiceFile, GNOME_BUS_NAME, gnomeProviderIni, KRUNNER_BUS_NAME, krunnerDesktopFile,
} from '../../../core/platform-integrations';
import { exportProvider, type Exported, type ProviderDeps } from './dbus-providers';

const share = () => process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');

function files(kind: 'gnome' | 'krunner') {
  return kind === 'gnome'
    ? [
      { file: path.join(share(), 'gnome-shell', 'search-providers', 'keeper-search-provider.ini'), body: () => gnomeProviderIni('keeper.desktop') },
      { file: path.join(share(), 'dbus-1', 'services', `${GNOME_BUS_NAME}.service`), body: () => dbusServiceFile(GNOME_BUS_NAME, launcher()) },
    ]
    : [
      { file: path.join(share(), 'krunner', 'dbusplugins', 'keeper.desktop'), body: () => krunnerDesktopFile() },
      { file: path.join(share(), 'dbus-1', 'services', `${KRUNNER_BUS_NAME}.service`), body: () => dbusServiceFile(KRUNNER_BUS_NAME, launcher()) },
    ];
}

/** What the desktop should start when it asks for results and Keeper is not running. */
function launcher(): string {
  return process.env.APPIMAGE || process.execPath;
}

export function hasSessionBus(): boolean {
  return process.platform === 'linux' && !!process.env.DBUS_SESSION_BUS_ADDRESS;
}

export function desktopName(): string {
  return (process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '').toLowerCase();
}

const running = new Map<'gnome' | 'krunner', Exported>();

/** Installs or removes the registration files, and starts or stops serving. */
export async function setLinuxSearch(kind: 'gnome' | 'krunner', on: boolean, deps: ProviderDeps): Promise<{ ok: boolean; message?: string }> {
  if (process.platform !== 'linux') return { ok: false };
  if (!on) {
    running.get(kind)?.stop();
    running.delete(kind);
    for (const f of files(kind)) await fsp.rm(f.file, { force: true });
    return { ok: true };
  }
  for (const f of files(kind)) {
    await fsp.mkdir(path.dirname(f.file), { recursive: true });
    await fsp.writeFile(f.file, f.body());
  }
  return serve(kind, deps);
}

/** Serves results (when switched on and a session bus is there). Safe to call again. */
export async function serve(kind: 'gnome' | 'krunner', deps: ProviderDeps): Promise<{ ok: boolean; message?: string }> {
  if (running.has(kind)) return { ok: true };
  if (!hasSessionBus()) return { ok: false, message: 'No desktop session bus found' };
  try {
    running.set(kind, await exportProvider(kind, deps));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function stopLinuxSearch() {
  for (const e of running.values()) e.stop();
  running.clear();
}

/** True when the registration files are there (e.g. switched on in an earlier run). */
export async function isInstalled(kind: 'gnome' | 'krunner'): Promise<boolean> {
  for (const f of files(kind)) {
    try {
      await fsp.access(f.file);
    } catch {
      return false;
    }
  }
  return true;
}
