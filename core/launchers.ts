// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Separate app icons: "Keeper Mail", "Keeper Calendar", "Keeper Notes", "Keeper Files"
// and the others that people can pin to the Dock, the Start menu or their app launcher.
// Each starts that part of Keeper on its own, as a light app (core/solo.ts): only what
// it needs runs, unless Keeper itself is open already, in which case it simply opens
// its page in a window of Keeper's (core/page-window.ts). They need Keeper installed
// and share its settings, accounts and updates.
//
// What each system gets (made on request from Settings → Features, removed there too):
//   macOS    a small app ("Keeper Mail.app") that ships inside Keeper.app, in
//            Contents/Library/Launchers, copied to ~/Applications (or /Applications);
//            it starts Keeper with --keeper-solo=mail, or opens keeper://open/mail in a
//            Keeper that is running. Built by build/mac-launchers.cjs.
//   Windows  a Start menu shortcut ("Keeper Mail.lnk") to Keeper with --keeper-solo=mail and
//            an app ID of its own, so its window groups apart from Keeper's on the taskbar.
//   Linux    a desktop entry (keeper-mail.desktop) in ~/.local/share/applications, with a
//            window class of its own (StartupWMClass) so the dock shows it apart.
// No Electron here: electron/services/launchers.ts does the work.

import type { SoloService } from './solo';

export interface LauncherDef {
  /** which app icon: its files, its switch (--keeper-solo=<page>) and its bundle are named after it */
  page: 'mail' | 'calendar' | 'reminders' | 'planner' | 'notes' | 'files' | 'studio' | 'terminal' | 'rdc';
  /** the page its window shows (core/nav.ts), when it is not `page` */
  opens?: string;
  /** "Keeper Mail" */
  name: string;
  /** what the system shows under the name, or as a tooltip */
  comment: string;
  /** the badge's colour on its icon */
  color: string;
  /** macOS bundle identifier, and the Windows app ID its windows group under */
  bundleId: string;
  /** the feature (core/features.ts) that owns its page: the icon is offered only while it is on */
  feature: string;
  /** what runs when it starts on its own (core/solo.ts) */
  services: SoloService[];
  /** the sidebar symbol on its badge (src/components/Icon.tsx) */
  icon: string;
}

export const LAUNCHERS: LauncherDef[] = [
  { page: 'mail', name: 'Keeper Mail', comment: 'Your mail in a light app of its own', color: '#2f7cf6', bundleId: 'io.github.ashfordeou.keeper.mail', feature: 'mail', services: ['pim'], icon: 'mail' },
  { page: 'calendar', name: 'Keeper Calendar', comment: 'Your calendars in a light app of their own', color: '#ef4b3f', bundleId: 'io.github.ashfordeou.keeper.calendar', feature: 'calendars', services: ['pim'], icon: 'calendar' },
  { page: 'notes', name: 'Keeper Notes', comment: 'Your notes in a light app of their own', color: '#f2a516', bundleId: 'io.github.ashfordeou.keeper.notes', feature: 'notes', services: ['notes'], icon: 'document' },
  { page: 'reminders', name: 'Keeper Reminders', comment: 'Your to-do lists in a light app of their own', color: '#7a5af5', bundleId: 'io.github.ashfordeou.keeper.reminders', feature: 'calendars', services: ['pim'], icon: 'listCheck' },
  { page: 'planner', name: 'Keeper Planner', comment: 'Your day and week in a light app of their own', color: '#0f9d8a', bundleId: 'io.github.ashfordeou.keeper.planner', feature: 'planner', services: ['pim'], icon: 'columns' },
  { page: 'files', opens: 'browse', name: 'Keeper Files', comment: 'Your files in a light app of their own', color: '#5b6b7f', bundleId: 'io.github.ashfordeou.keeper.files', feature: 'library', services: ['library'], icon: 'folder' },
  { page: 'studio', name: 'Keeper Studio', comment: 'Record and edit the screen in a light app of its own', color: '#e0457b', bundleId: 'io.github.ashfordeou.keeper.studio', feature: 'studio', services: ['studio'], icon: 'video' },
  { page: 'terminal', name: 'Keeper Terminal', comment: 'Terminals and SSH in a light app of their own', color: '#2d3440', bundleId: 'io.github.ashfordeou.keeper.terminal', feature: 'terminal', services: ['terminal'], icon: 'terminal' },
  { page: 'rdc', name: 'Keeper Remote Desktops', comment: 'Other computers in a light app of their own', color: '#1f9e5a', bundleId: 'io.github.ashfordeou.keeper.rdc', feature: 'remoteDesktops', services: ['rdc'], icon: 'laptop' },
];

/** The page an app icon's window shows. */
export const launcherPage = (l: LauncherDef) => l.opens ?? l.page;

/** The switch that starts an app icon's part of Keeper on its own: `--keeper-solo=mail`. */
export const SOLO_SWITCH = '--keeper-solo';

export const launcherDef = (page: string) => LAUNCHERS.find((l) => l.page === page);

/** What the interface shows for each launcher. */
export interface LauncherState {
  page: string;
  name: string;
  /** where it is (or would be) made */
  path: string;
  installed: boolean;
  /** made by someone else at that place (Keeper leaves it alone) */
  foreign?: boolean;
  /** it cannot be made on this computer, and why */
  unavailable?: string;
}

/** The calls the interface makes (Settings → Features). */
export interface LaunchersApi {
  list(): Promise<LauncherState[]>;
  add(page: string): Promise<LauncherState[]>;
  remove(page: string): Promise<LauncherState[]>;
  /** shows it in Finder, File Explorer or the file manager */
  reveal(page: string): Promise<void>;
}

/** Where things are on this computer, as the main process sees them. */
export interface LauncherContext {
  platform: string;
  home: string;
  /** Keeper's program: Keeper.exe, the AppImage, /opt/Keeper/keeper */
  exe: string;
  /** what goes before --keeper-open (a development copy: the app's folder) */
  exeArgs?: string[];
  /** macOS: Keeper.app */
  appBundle?: string;
  /** Windows: %APPDATA% (Roaming) */
  appData?: string;
  /** Linux: $XDG_DATA_HOME */
  dataHome?: string;
  /** macOS: put it in /Applications rather than ~/Applications (when Keeper is there and it can be written) */
  systemApplications?: boolean;
  /** where Keeper keeps the launchers' icons it copied out (Windows, Linux) */
  iconDir: string;
}

export type LauncherPlan =
  | { kind: 'mac-app'; page: string; name: string; source: string; target: string; bundleId: string }
  | { kind: 'win-shortcut'; page: string; name: string; target: string; exe: string; args: string; icon: string; description: string; appUserModelId: string }
  | { kind: 'linux-desktop'; page: string; name: string; target: string; icon: string; content: string };

/** "Keeper Mail.app", in Keeper.app or in Applications. */
export const macBundleName = (l: LauncherDef) => `${l.name}.app`;

/** A path joined in the style of the platform it is for (tests ask about Windows from Linux too). */
function join(platform: string, ...parts: string[]): string {
  const sep = platform === 'win32' ? '\\' : '/';
  return parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, ''))).filter(Boolean).join(sep);
}

/** Quotes one argument of a desktop entry's Exec line (freedesktop Desktop Entry Specification). */
export function desktopExecArg(s: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `"${s.replace(/(["`$\\])/g, '\\$1')}"`;
}

/** One argument of a Windows command line, quoted when it has spaces. */
export function winArg(s: string): string {
  return /[\s"]/.test(s) ? `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"` : s;
}

/** Where each app icon goes in the app menu (freedesktop main categories). */
const CATEGORIES: Partial<Record<LauncherDef['page'], string>> = {
  notes: 'Office;Utility;', files: 'System;FileTools;FileManager;', studio: 'AudioVideo;Video;', terminal: 'System;TerminalEmulator;', rdc: 'Network;RemoteAccess;',
};

/** The window class an app icon's windows have on Linux when it runs on its own ("keeper-mail"). */
export const linuxWmClass = (page: string) => `keeper-${page}`;

/** The desktop entry for a launcher (Linux). */
export function desktopEntry(l: LauncherDef, exe: string, icon: string, exeArgs: string[] = []): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${l.name}`,
    `Comment=${l.comment}`,
    `Exec=${[exe, ...exeArgs].map(desktopExecArg).join(' ')} ${SOLO_SWITCH}=${l.page}`,
    `Icon=${icon}`,
    'Terminal=false',
    `Categories=${CATEGORIES[l.page] ?? 'Office;'}`,
    // Started on its own, its window has a class of its own, so the dock shows it apart from Keeper.
    `StartupWMClass=${linuxWmClass(l.page)}`,
    `X-Keeper-Launcher=${l.page}`,
    '',
  ].join('\n');
}

/** What making a launcher means on this computer, or why it cannot be made. */
export function launcherPlan(page: string, c: LauncherContext): LauncherPlan | { unavailable: string } {
  const l = launcherDef(page);
  if (!l) return { unavailable: 'This part of Keeper has no app icon of its own' };
  if (c.platform === 'darwin') {
    if (!c.appBundle) return { unavailable: 'Available in the installed Keeper app' };
    const apps = c.systemApplications ? '/Applications' : join('darwin', c.home, 'Applications');
    return { kind: 'mac-app', page, name: l.name, source: join('darwin', c.appBundle, 'Contents', 'Library', 'Launchers', macBundleName(l)), target: join('darwin', apps, macBundleName(l)), bundleId: l.bundleId };
  }
  if (c.platform === 'win32') {
    const appData = c.appData ?? join('win32', c.home, 'AppData', 'Roaming');
    return {
      kind: 'win-shortcut', page, name: l.name, exe: c.exe, args: [...(c.exeArgs ?? []).map(winArg), `${SOLO_SWITCH}=${page}`].join(' '), description: l.comment, appUserModelId: l.bundleId,
      target: join('win32', appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${l.name}.lnk`),
      icon: join('win32', c.iconDir, `keeper-${page}.ico`),
    };
  }
  if (c.platform === 'linux') {
    const data = c.dataHome || join('linux', c.home, '.local', 'share');
    const icon = join('linux', c.iconDir, `keeper-${page}.png`);
    return { kind: 'linux-desktop', page, name: l.name, target: join('linux', data, 'applications', `keeper-${page}.desktop`), icon, content: desktopEntry(l, c.exe, icon, c.exeArgs) };
  }
  return { unavailable: 'Not available on this system' };
}

/** Whether a file at a launcher's place is one Keeper made (so removing it never deletes someone else's). */
export function isOurDesktopEntry(text: string, page: string): boolean {
  return new RegExp(`^X-Keeper-Launcher=${page}$`, 'm').test(text);
}

/** Whether a Windows shortcut is one of Keeper's launchers (its arguments name the page; older ones used --keeper-open). */
export function isOurShortcut(link: { args?: string } | null | undefined, page: string): boolean {
  if (!link || typeof link.args !== 'string') return false;
  const args = link.args.split(/\s+/);
  return args.includes(`${SOLO_SWITCH}=${page}`) || args.includes(`--keeper-open=${page}`);
}

/** Whether an Info.plist is one of Keeper's launchers (by its bundle identifier). */
export function isOurMacLauncher(infoPlist: string, page: string): boolean {
  const l = launcherDef(page);
  return !!l && new RegExp(`<key>CFBundleIdentifier</key>\\s*<string>${l.bundleId.replace(/\./g, '\\.')}</string>`).test(infoPlist);
}
