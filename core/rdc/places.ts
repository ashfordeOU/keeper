// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where Remote Desktops appear outside the page: a global quick-connect
// shortcut, the command palette, the tray menu (recent and favourite
// connections, what is open now), .rdp and .vnc files opened from the file
// manager (double-click, and a right-click "Connect with Keeper"), and whether
// live sessions open as Keeper tabs or in windows of their own. The person
// chooses each one; the main-window page stays the home for settings and details.

import type { Connection, RdcSession } from './types';

export interface RdcPlaces {
  /** a keyboard shortcut that opens the quick-connect box from anywhere */
  shortcut: boolean;
  accelerator: string;
  palette: boolean;
  tray: boolean;
  /** .rdp and .vnc files open in Keeper, with "Connect with Keeper" in the file manager's right-click menu */
  files: boolean;
  /** VNC, Remote Desktop and web consoles open as a tab in the main window, or in a window of their own */
  sessions: 'tab' | 'window';
  /** Remote Desktop (RDP) is drawn in Keeper (its engine is downloaded on first use) rather than the outside app */
  rdpInTab: boolean;
}

export const DEFAULT_PLACES: RdcPlaces = { shortcut: true, accelerator: 'CommandOrControl+Alt+E', palette: true, tray: true, files: true, sessions: 'tab', rdpInTab: true };

export function normalizePlaces(raw: unknown): RdcPlaces {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<RdcPlaces>;
  const b = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const acc = typeof o.accelerator === 'string' && /^[\w+]{1,60}$/.test(o.accelerator) && /\+/.test(o.accelerator) ? o.accelerator : DEFAULT_PLACES.accelerator;
  return {
    shortcut: b(o.shortcut, DEFAULT_PLACES.shortcut),
    accelerator: acc,
    palette: b(o.palette, DEFAULT_PLACES.palette),
    tray: b(o.tray, DEFAULT_PLACES.tray),
    files: b(o.files, DEFAULT_PLACES.files),
    sessions: o.sessions === 'window' ? 'window' : 'tab',
    rdpInTab: b(o.rdpInTab, DEFAULT_PLACES.rdpInTab),
  };
}

export type TrayEntry =
  | { separator: true }
  | { label: string; action?: 'quick' | 'connect' | 'disconnect' | 'show' | 'page'; arg?: string; enabled?: boolean; submenu?: TrayEntry[] };

/** The tray menu's Remote Desktops part: favourites, recent ones, what is open now, Quick Connect. */
export function trayEntries(conns: Connection[], sessions: RdcSession[], places: RdcPlaces, recentCount = 5): TrayEntry[] {
  if (!places.tray) return [];
  const favs = conns.filter((c) => c.favourite).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 10);
  const recent = conns.filter((c) => c.lastUsed && !c.favourite).sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0)).slice(0, recentCount);
  const open = sessions.filter((s) => s.state === 'connected' || s.state === 'connecting');
  const item = (c: Connection): TrayEntry => ({ label: c.name, action: 'connect', arg: c.id });
  const sub: TrayEntry[] = [{ label: 'Quick Connect…', action: 'quick' }];
  if (favs.length) sub.push({ separator: true }, { label: 'Favourites', enabled: false }, ...favs.map(item));
  if (recent.length) sub.push({ separator: true }, { label: 'Recent', enabled: false }, ...recent.map(item));
  if (open.length) {
    sub.push({ separator: true }, { label: 'Open now', enabled: false });
    for (const s of open) sub.push({ label: s.name, submenu: [...(s.kind !== 'external' ? [{ label: 'Show', action: 'show' as const, arg: s.id }] : []), { label: 'Disconnect', action: 'disconnect', arg: s.id }] });
  }
  sub.push({ separator: true }, { label: 'All Connections…', action: 'page' });
  return [{ label: open.length ? `Remote Desktops (${open.length} open)` : 'Remote Desktops', submenu: sub }];
}

/** A .rdp or .vnc file Keeper was asked to open (double-click, "Open with", or the right-click "Connect with Keeper"). */
export function connectionFileFromArgv(argv: string[]): { file: string; action: 'connect' | 'edit' } | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rdc-connect' || a === '--rdc-edit') {
      const f = argv[i + 1];
      if (f && /\.(rdp|vnc)$/i.test(f)) return { file: f, action: a === '--rdc-edit' ? 'edit' : 'connect' };
    }
  }
  // A plain file argument (the file manager's default "open" for an associated type).
  const f = argv.slice(1).find((a) => !a.startsWith('-') && /\.(rdp|vnc)$/i.test(a));
  return f ? { file: f, action: 'connect' } : null;
}

/** The right-click entries Keeper adds for .rdp and .vnc files, per system (per user; no administrator needed). */
export function fileMenuPlan(os: 'win32' | 'darwin' | 'linux', exe: string, home: string): { files: { path: string; content: string; mode: number }[]; reg: string[][] } {
  if (os === 'win32') {
    const reg: string[][] = [];
    for (const ext of ['.rdp', '.vnc']) {
      const key = `HKCU\\Software\\Classes\\SystemFileAssociations\\${ext}\\shell\\KeeperConnect`;
      reg.push(['add', key, '/ve', '/d', 'Connect with Keeper', '/f']);
      reg.push(['add', key, '/v', 'Icon', '/d', exe, '/f']);
      reg.push(['add', `${key}\\command`, '/ve', '/d', `"${exe}" --rdc-connect "%1"`, '/f']);
    }
    return { files: [], reg };
  }
  if (os === 'linux') {
    const q = (s: string) => `"${s.replace(/(["`$\\])/g, '\\$1')}"`;
    return {
      reg: [],
      files: [
        { path: `${home}/.local/share/applications/keeper-rdc.desktop`, mode: 0o644, content: `[Desktop Entry]\nType=Application\nName=Keeper Remote Desktops\nComment=Connect to a computer from a .rdp or .vnc file\nExec=${q(exe)} --rdc-connect %f\nIcon=keeper\nMimeType=application/x-rdp;application/x-remote-desktop;application/x-vnc;\nNoDisplay=true\nActions=Edit;\n\n[Desktop Action Edit]\nName=Add to Remote Desktops\nExec=${q(exe)} --rdc-edit %f\n` },
        { path: `${home}/.local/share/kio/servicemenus/keeper-rdc.desktop`, mode: 0o755, content: `[Desktop Entry]\nType=Service\nMimeType=application/x-rdp;application/x-vnc;\nActions=KeeperConnect;\nX-KDE-Priority=TopLevel\n\n[Desktop Action KeeperConnect]\nName=Connect with Keeper\nIcon=keeper\nExec=${q(exe)} --rdc-connect %f\n` },
        { path: `${home}/.local/share/nautilus/scripts/Connect with Keeper`, mode: 0o755, content: `#!/bin/sh\n# Keeper: connect to the selected .rdp or .vnc file.\nfor f in "$@"; do case "$f" in *.rdp|*.RDP|*.vnc|*.VNC) exec ${q(exe)} --rdc-connect "$f" ;; esac; done\n` },
        { path: `${home}/.local/share/mime/packages/keeper-rdc.xml`, mode: 0o644, content: `<?xml version="1.0" encoding="UTF-8"?>\n<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">\n  <mime-type type="application/x-rdp"><comment>Remote Desktop connection</comment><glob pattern="*.rdp"/></mime-type>\n  <mime-type type="application/x-vnc"><comment>VNC connection</comment><glob pattern="*.vnc"/></mime-type>\n</mime-info>\n` },
      ],
    };
  }
  // macOS: the app bundle declares .rdp and .vnc (electron-builder fileAssociations); Finder's
  // "Open With → Keeper" and double-click (once chosen as the default) arrive as open-file events.
  return { files: [], reg: [] };
}
