// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The free programs Keeper can start for protocols it does not draw itself,
// and for letting others reach this computer. Each lists the program names to
// look for on each system and how to install it there.

export type Os = 'win32' | 'darwin' | 'linux';

export interface EngineDef {
  id: string;
  name: string;
  /** what Keeper uses it for */
  for: string;
  license: string;
  url: string;
  /** program names (or full paths) to look for, best first */
  bins: Partial<Record<Os, string[]>>;
  /** how to install it on each system ('' = comes with the system) */
  install: Partial<Record<Os, string>>;
  /** used to host (let others reach this computer) rather than to connect */
  hosting?: boolean;
}

export interface EngineInfo extends Omit<EngineDef, 'bins' | 'install'> {
  found: boolean;
  path?: string;
  /** the program name that was found */
  bin?: string;
  hint?: string;
  /** not for this system */
  na?: boolean;
}

const WIN_SYS = 'C:\\Windows\\System32\\';

export const ENGINES: EngineDef[] = [
  {
    id: 'freerdp', name: 'FreeRDP', for: 'Remote Desktop (RDP) sessions in their own window', license: 'Apache-2.0', url: 'https://www.freerdp.com',
    bins: { linux: ['xfreerdp3', 'sdl-freerdp3', 'xfreerdp', 'sdl-freerdp', 'wlfreerdp3', 'wlfreerdp'], darwin: ['sdl-freerdp3', 'xfreerdp3', 'sdl-freerdp', 'xfreerdp'], win32: ['wfreerdp'] },
    install: { linux: 'sudo apt install freerdp3-x11   (Fedora: sudo dnf install freerdp)', darwin: 'brew install freerdp', win32: 'Not needed: Windows has its own Remote Desktop Connection' },
  },
  {
    id: 'mstsc', name: 'Remote Desktop Connection (mstsc)', for: 'Remote Desktop (RDP) on Windows', license: 'Part of Windows', url: 'https://learn.microsoft.com/windows-server/administration/windows-commands/mstsc',
    bins: { win32: [`${WIN_SYS}mstsc.exe`, 'mstsc'] }, install: { win32: '' },
  },
  {
    id: 'vncviewer', name: 'TigerVNC viewer', for: 'VNC in its own window (Keeper also shows VNC in a tab)', license: 'GPL-2.0', url: 'https://tigervnc.org',
    bins: { linux: ['vncviewer', 'xtigervncviewer'], darwin: ['vncviewer', '/Applications/TigerVNC Viewer.app/Contents/MacOS/TigerVNC Viewer'], win32: ['vncviewer', 'vncviewer64'] },
    install: { linux: 'sudo apt install tigervnc-viewer', darwin: 'brew install --cask tigervnc-viewer', win32: 'winget install TigerVNC.TigerVNC' },
  },
  {
    id: 'ssh', name: 'OpenSSH client', for: 'SSH terminals, jump hosts and tunnels', license: 'BSD', url: 'https://www.openssh.com',
    bins: { linux: ['ssh'], darwin: ['ssh', '/usr/bin/ssh'], win32: [`${WIN_SYS}OpenSSH\\ssh.exe`, 'ssh'] },
    install: { linux: 'sudo apt install openssh-client', darwin: '', win32: 'Settings → System → Optional features → OpenSSH Client' },
  },
  {
    id: 'mosh', name: 'Mosh', for: 'Terminals that survive roaming and sleep', license: 'GPL-3.0', url: 'https://mosh.org',
    bins: { linux: ['mosh'], darwin: ['mosh'] }, install: { linux: 'sudo apt install mosh', darwin: 'brew install mosh', win32: 'Use it inside WSL: sudo apt install mosh' },
  },
  {
    id: 'telnet', name: 'Telnet client', for: 'Telnet consoles (switches, old devices)', license: 'BSD', url: 'https://www.gnu.org/software/inetutils/',
    bins: { linux: ['telnet', 'plink'], darwin: ['telnet', 'plink'], win32: [`${WIN_SYS}telnet.exe`, 'telnet', 'plink'] },
    install: { linux: 'sudo apt install telnet', darwin: 'brew install telnet', win32: 'Settings → System → Optional features → Telnet Client (or PuTTY’s plink)' },
  },
  {
    id: 'serial', name: 'Serial terminal (picocom, minicom, screen, cu or plink)', for: 'Serial consoles over USB or COM ports', license: 'GPL-2.0', url: 'https://github.com/npat-efault/picocom',
    bins: { linux: ['picocom', 'minicom', 'screen', 'cu', 'plink'], darwin: ['picocom', 'minicom', 'screen', 'cu'], win32: ['plink'] },
    install: { linux: 'sudo apt install picocom', darwin: 'brew install picocom   (screen comes with macOS)', win32: 'winget install PuTTY.PuTTY   (for plink)' },
  },
  {
    id: 'remote-viewer', name: 'virt-viewer (remote-viewer)', for: 'SPICE consoles of virtual machines', license: 'GPL-2.0', url: 'https://gitlab.com/virt-viewer/virt-viewer',
    bins: { linux: ['remote-viewer'], darwin: ['remote-viewer'], win32: ['remote-viewer', 'C:\\Program Files\\VirtViewer v11.0-256\\bin\\remote-viewer.exe'] },
    install: { linux: 'sudo apt install virt-viewer', darwin: 'brew install virt-viewer (from a third-party tap)', win32: 'winget install RedHat.VirtViewer' },
  },
  {
    id: 'x2goclient', name: 'X2Go client', for: 'X2Go / NX desktops over SSH', license: 'GPL-2.0', url: 'https://wiki.x2go.org/doku.php/download:start',
    bins: { linux: ['x2goclient'], darwin: ['/Applications/x2goclient.app/Contents/MacOS/x2goclient', 'x2goclient'], win32: ['x2goclient', 'C:\\Program Files (x86)\\x2goclient\\x2goclient.exe'] },
    install: { linux: 'sudo apt install x2goclient', darwin: 'Download it from wiki.x2go.org', win32: 'Download it from wiki.x2go.org' },
  },
  {
    id: 'pwsh', name: 'PowerShell', for: 'PowerShell remoting (Enter-PSSession over WinRM)', license: 'MIT', url: 'https://learn.microsoft.com/powershell/scripting/install/installing-powershell',
    bins: { linux: ['pwsh'], darwin: ['pwsh'], win32: [`${WIN_SYS}WindowsPowerShell\\v1.0\\powershell.exe`, 'pwsh', 'powershell'] },
    install: { linux: 'See learn.microsoft.com → Install PowerShell on Linux', darwin: 'brew install --cask powershell', win32: '' },
  },
  // ---- hosting: letting others reach this computer
  {
    id: 'x11vnc', name: 'x11vnc', for: 'Share this screen over VNC (X11 desktops)', license: 'GPL-2.0', url: 'https://github.com/LibVNC/x11vnc', hosting: true,
    bins: { linux: ['x11vnc'] }, install: { linux: 'sudo apt install x11vnc' },
  },
  {
    id: 'wayvnc', name: 'wayvnc', for: 'Share this screen over VNC (Wayland desktops based on wlroots)', license: 'ISC', url: 'https://github.com/any1/wayvnc', hosting: true,
    bins: { linux: ['wayvnc'] }, install: { linux: 'sudo apt install wayvnc' },
  },
  {
    id: 'grdctl', name: 'GNOME Remote Desktop', for: 'Share this screen over RDP or VNC (GNOME)', license: 'GPL-2.0', url: 'https://gitlab.gnome.org/GNOME/gnome-remote-desktop', hosting: true,
    bins: { linux: ['grdctl'] }, install: { linux: 'sudo apt install gnome-remote-desktop' },
  },
  {
    id: 'krdpserver', name: 'KRdp', for: 'Share this screen over RDP (KDE Plasma 6.1+)', license: 'LGPL-2.1', url: 'https://invent.kde.org/plasma/krdp', hosting: true,
    bins: { linux: ['krdpserver'] }, install: { linux: 'sudo apt install krdp' },
  },
];

export const engineDef = (id: string) => ENGINES.find((e) => e.id === id);

/** How the list looks on one system, once Keeper knows which names were found. */
export function engineInfo(def: EngineDef, os: Os, found: { path: string; bin: string } | null): EngineInfo {
  const { bins, install, ...rest } = def;
  const na = !bins[os]?.length;
  return { ...rest, found: !!found, path: found?.path, bin: found?.bin, hint: install[os] || (na ? 'Not available on this system' : undefined), na };
}
