// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Separate app icons for Mail, Calendar and Notes: "Keeper Mail" and the others
// that people can pin to the Dock, the Start menu or their app launcher. Each one
// only starts Keeper (hidden, if it was not running) and opens its page in a
// window of its own (core/page-window.ts). They need Keeper installed and share
// its settings, accounts and updates.
//
// What each system gets (made on request from Settings → Features, removed there too):
//   macOS    a small app ("Keeper Mail.app") that ships inside Keeper.app, in
//            Contents/Library/Launchers, copied to ~/Applications (or /Applications);
//            it opens keeper://open/mail. Built by build/mac-launchers.cjs.
//   Windows  a Start menu shortcut ("Keeper Mail.lnk") to Keeper with --keeper-open=mail.
//   Linux    a desktop entry (keeper-mail.desktop) in ~/.local/share/applications.
// No Electron here: electron/services/launchers.ts does the work.

export interface LauncherDef {
  /** the page it opens (core/nav.ts) */
  page: 'mail' | 'calendar' | 'notes';
  /** "Keeper Mail" */
  name: string;
  /** what the system shows under the name, or as a tooltip */
  comment: string;
  /** the badge's colour on its icon */
  color: string;
  /** macOS bundle identifier */
  bundleId: string;
}

export const LAUNCHERS: LauncherDef[] = [
  { page: 'mail', name: 'Keeper Mail', comment: 'Your mail in a window of its own', color: '#2f7cf6', bundleId: 'io.github.ashfordeou.keeper.mail' },
  { page: 'calendar', name: 'Keeper Calendar', comment: 'Your calendars in a window of its own', color: '#ef4b3f', bundleId: 'io.github.ashfordeou.keeper.calendar' },
  { page: 'notes', name: 'Keeper Notes', comment: 'Your notes in a window of its own', color: '#f2a516', bundleId: 'io.github.ashfordeou.keeper.notes' },
];

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
  | { kind: 'win-shortcut'; page: string; name: string; target: string; exe: string; args: string; icon: string; description: string }
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

/** The desktop entry for a launcher (Linux). */
export function desktopEntry(l: LauncherDef, exe: string, icon: string, exeArgs: string[] = []): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${l.name}`,
    `Comment=${l.comment}`,
    `Exec=${[exe, ...exeArgs].map(desktopExecArg).join(' ')} --keeper-open=${l.page}`,
    `Icon=${icon}`,
    'Terminal=false',
    `Categories=${l.page === 'notes' ? 'Office;Utility;' : 'Office;'}`,
    // Its windows are Keeper's: they group with Keeper's in the dock.
    'StartupWMClass=Keeper',
    `X-Keeper-Launcher=${l.page}`,
    '',
  ].join('\n');
}

/** What making a launcher means on this computer, or why it cannot be made. */
export function launcherPlan(page: string, c: LauncherContext): LauncherPlan | { unavailable: string } {
  const l = launcherDef(page);
  if (!l) return { unavailable: 'Only Mail, Calendar and Notes have app icons of their own' };
  if (c.platform === 'darwin') {
    if (!c.appBundle) return { unavailable: 'Available in the installed Keeper app' };
    const apps = c.systemApplications ? '/Applications' : join('darwin', c.home, 'Applications');
    return { kind: 'mac-app', page, name: l.name, source: join('darwin', c.appBundle, 'Contents', 'Library', 'Launchers', macBundleName(l)), target: join('darwin', apps, macBundleName(l)), bundleId: l.bundleId };
  }
  if (c.platform === 'win32') {
    const appData = c.appData ?? join('win32', c.home, 'AppData', 'Roaming');
    return {
      kind: 'win-shortcut', page, name: l.name, exe: c.exe, args: [...(c.exeArgs ?? []).map(winArg), `--keeper-open=${page}`].join(' '), description: l.comment,
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

/** Whether a Windows shortcut is one of Keeper's launchers (its arguments name the page). */
export function isOurShortcut(link: { args?: string } | null | undefined, page: string): boolean {
  return !!link && typeof link.args === 'string' && link.args.split(/\s+/).includes(`--keeper-open=${page}`);
}

/** Whether an Info.plist is one of Keeper's launchers (by its bundle identifier). */
export function isOurMacLauncher(infoPlist: string, page: string): boolean {
  const l = launcherDef(page);
  return !!l && new RegExp(`<key>CFBundleIdentifier</key>\\s*<string>${l.bundleId.replace(/\./g, '\\.')}</string>`).test(infoPlist);
}
