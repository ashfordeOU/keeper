// SPDX-License-Identifier: AGPL-3.0-or-later
// Which package manager (if any) installed this copy of Keeper. A copy that a
// package manager owns should be updated by that package manager, not replace
// itself. Pure: the caller passes the executable path, the environment, the
// platform and a way to test whether a path exists.

export type InstallSource = 'brew' | 'winget' | 'scoop' | 'choco' | 'flatpak' | 'snap' | 'aur' | 'apt-repo' | 'dnf-repo' | 'direct';

export interface InstallSourceInfo {
  label: string;
  /** true when Keeper's own updater should install updates; false when the package manager does */
  selfUpdate: boolean;
  /** the command that updates Keeper, for "Update with …" hints */
  updateCommand?: string;
}

export const INSTALL_SOURCES: Record<InstallSource, InstallSourceInfo> = {
  // The cask declares auto_updates, so Keeper replaces itself as a downloaded copy would.
  brew: { label: 'Homebrew', selfUpdate: true, updateCommand: 'brew upgrade --cask keeper' },
  // winget runs the same per-user installer and reads the version back from Windows, so self-updates keep it right.
  winget: { label: 'winget', selfUpdate: true, updateCommand: 'winget upgrade Ashforde.Keeper' },
  scoop: { label: 'Scoop', selfUpdate: false, updateCommand: 'scoop update keeper' },
  choco: { label: 'Chocolatey', selfUpdate: false, updateCommand: 'choco upgrade keeper-files' },
  flatpak: { label: 'Flatpak', selfUpdate: false, updateCommand: 'flatpak update io.github.ashfordeou.keeper' },
  snap: { label: 'Snap', selfUpdate: false, updateCommand: 'sudo snap refresh keeper' },
  aur: { label: 'the AUR', selfUpdate: false, updateCommand: 'yay -Syu keeper-bin' },
  'apt-repo': { label: 'Keeper’s apt repository', selfUpdate: false, updateCommand: 'sudo apt update && sudo apt upgrade keeper' },
  'dnf-repo': { label: 'Keeper’s dnf repository', selfUpdate: false, updateCommand: 'sudo dnf upgrade keeper' },
  direct: { label: 'a download from GitHub', selfUpdate: true },
};

type Env = Record<string, string | undefined>;

export function detectInstallSource(
  execPath: string,
  env: Env,
  platform: string,
  exists: (p: string) => boolean = () => false,
): InstallSource {
  if (platform === 'darwin') return detectMac(execPath, env, exists);
  if (platform === 'win32') return detectWindows(execPath, env, exists);
  if (platform === 'linux') return detectLinux(execPath, env, exists);
  return 'direct';
}

function detectMac(execPath: string, env: Env, exists: (p: string) => boolean): InstallSource {
  if (execPath.includes('/Caskroom/')) return 'brew';
  // Homebrew moves the app into /Applications but keeps its own record in Caskroom/keeper.
  // Apps opened from Finder have no HOMEBREW_PREFIX, so the usual prefixes are checked too.
  const prefixes = [env.HOMEBREW_PREFIX, '/opt/homebrew', '/usr/local'].filter((p): p is string => !!p);
  if (prefixes.some((p) => exists(`${p.replace(/\/+$/, '')}/Caskroom/keeper`))) return 'brew';
  return 'direct';
}

function detectWindows(execPath: string, env: Env, exists: (p: string) => boolean): InstallSource {
  const p = execPath.replace(/\//g, '\\').toLowerCase();
  if (p.includes('\\scoop\\apps\\')) return 'scoop';
  if (p.includes('\\chocolatey\\lib\\')) return 'choco';
  if (p.includes('\\microsoft\\winget\\packages\\')) return 'winget';
  const dir = execPath.replace(/[\\/][^\\/]*$/, '');
  if (exists(`${dir}\\.installed-by-winget`)) return 'winget';
  // Chocolatey runs Keeper's installer into Program Files and keeps the package under lib\keeper-files.
  const choco = env.ChocolateyInstall || env.CHOCOLATEYINSTALL || 'C:\\ProgramData\\chocolatey';
  if (p.includes('\\program files') && exists(`${choco.replace(/[\\/]+$/, '')}\\lib\\keeper-files`)) return 'choco';
  return 'direct';
}

function detectLinux(execPath: string, env: Env, exists: (p: string) => boolean): InstallSource {
  if (env.FLATPAK_ID || exists('/.flatpak-info')) return 'flatpak';
  if ((env.SNAP && env.SNAP_NAME) || execPath.startsWith('/snap/')) return 'snap';
  // An AppImage or an unpacked .tar.gz is always updated by Keeper itself.
  if (env.APPIMAGE || !execPath.startsWith('/opt/Keeper/')) return 'direct';
  // The keeper-bin package (packaging/aur) installs its licence folder; Debian and Fedora packages do not.
  if (exists('/usr/share/licenses/keeper-bin')) return 'aur';
  if (exists('/etc/apt/sources.list.d/keeper.list') || exists('/etc/apt/sources.list.d/keeper.sources')) return 'apt-repo';
  if (exists('/etc/yum.repos.d/keeper.repo') || exists('/etc/zypp/repos.d/keeper.repo')) return 'dnf-repo';
  return 'direct';
}
