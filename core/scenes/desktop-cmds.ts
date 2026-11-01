// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The commands that set (and read back) the ordinary desktop picture on each
// system, as data so they can be tested. electron/services/wallpaper/desktop.ts runs them.

import { fileUri } from './folder-icons';

export type LinuxDesktop = 'gnome' | 'cinnamon' | 'mate' | 'kde' | 'xfce' | 'other';

export function linuxDesktop(xdgCurrentDesktop = '', desktopSession = ''): LinuxDesktop {
  const s = `${xdgCurrentDesktop}:${desktopSession}`.toLowerCase();
  if (/kde|plasma/.test(s)) return 'kde';
  if (/cinnamon/.test(s)) return 'cinnamon';
  if (/mate/.test(s)) return 'mate';
  if (/xfce/.test(s)) return 'xfce';
  if (/gnome|unity|budgie|pantheon|ubuntu|pop|cosmic/.test(s)) return 'gnome';
  return 'other';
}

export interface Cmd { file: string; args: string[] }

/**
 * Ways to set the picture, best first. The desktop portal comes first on
 * Wayland (the sanctioned route for apps there; it may ask once), then each
 * desktop's own setting.
 */
export function linuxSetCommands(desk: LinuxDesktop, imagePath: string, wayland: boolean): Cmd[] {
  const uri = fileUri(imagePath);
  const portal: Cmd = {
    file: 'gdbus',
    args: ['call', '--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop', '--method', 'org.freedesktop.portal.Wallpaper.SetWallpaperURI', '', uri, "{'show-preview': <false>, 'set-on': <'background'>}"],
  };
  const gnome: Cmd[] = [
    { file: 'gsettings', args: ['set', 'org.gnome.desktop.background', 'picture-uri', uri] },
    { file: 'gsettings', args: ['set', 'org.gnome.desktop.background', 'picture-uri-dark', uri] },
  ];
  const own: Record<LinuxDesktop, Cmd[]> = {
    gnome,
    cinnamon: [{ file: 'gsettings', args: ['set', 'org.cinnamon.desktop.background', 'picture-uri', uri] }],
    mate: [{ file: 'gsettings', args: ['set', 'org.mate.background', 'picture-filename', imagePath] }],
    kde: [{ file: 'plasma-apply-wallpaperimage', args: [imagePath] }],
    xfce: [{ file: 'xfconf-query', args: ['-c', 'xfce4-desktop', '-p', '/backdrop/screen0/monitor0/workspace0/last-image', '-s', imagePath] }],
    other: gnome,
  };
  return wayland ? [portal, ...own[desk]] : [...own[desk], portal];
}

/** How to read the current picture back, to restore it later. */
export function linuxGetCommand(desk: LinuxDesktop): Cmd | null {
  if (desk === 'gnome' || desk === 'other') return { file: 'gsettings', args: ['get', 'org.gnome.desktop.background', 'picture-uri'] };
  if (desk === 'cinnamon') return { file: 'gsettings', args: ['get', 'org.cinnamon.desktop.background', 'picture-uri'] };
  if (desk === 'mate') return { file: 'gsettings', args: ['get', 'org.mate.background', 'picture-filename'] };
  if (desk === 'xfce') return { file: 'xfconf-query', args: ['-c', 'xfce4-desktop', '-p', '/backdrop/screen0/monitor0/workspace0/last-image'] };
  return null;
}

/** gsettings prints values quoted ('file:///…'); turn that back into a plain path or URI. */
export function unquoteGsettings(out: string): string {
  return out.trim().replace(/^'(.*)'$/, '$1');
}

/** The picture path from a file:// URI (or the text as it is). */
export function pathFromUri(v: string): string {
  if (!v.startsWith('file://')) return v;
  try {
    return decodeURIComponent(v.slice(7));
  } catch {
    return v.slice(7);
  }
}

/** PowerShell for Windows: set the picture with SystemParametersInfo (SPI_SETDESKWALLPAPER, saved and broadcast). */
export function windowsSetScript(imagePath: string): string {
  const p = imagePath.replace(/['‘’‚‛]/g, '$&$&');
  return `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class KeeperWp { [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SystemParametersInfo(int a, int b, string c, int d); }'
if ([KeeperWp]::SystemParametersInfo(20, 0, '${p}', 3)) { 'ok' } else { 'failed' }`;
}

export const WINDOWS_GET_SCRIPT = `(Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallPaper).WallPaper`;

/** AppleScript fallback for macOS when the helper is missing. */
export function macSetScript(imagePath: string): string {
  return `tell application "System Events" to tell every desktop to set picture to POSIX file ${JSON.stringify(imagePath)}`;
}
