// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The ordinary desktop picture (set, read back, restore) and folder icons on
// each system. With KEEPER_AMBIENCE_DRYRUN=<file>, commands that would change
// the system are written to that file instead (the end-to-end tests use it).

import { appendFileSync, existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { powershell, run } from '../../../core/platform';
import { linuxDesktop, linuxGetCommand, linuxSetCommands, macSetScript, pathFromUri, unquoteGsettings, windowsSetScript, WINDOWS_GET_SCRIPT, type Cmd } from '../../../core/scenes/desktop-cmds';
import { desktopIniWithIcon, directoryFileWithIcon, gioSetArgs, gioUnsetArgs, parseGioIcon, type FolderIconRecord } from '../../../core/scenes/folder-icons';

const DRY = process.env.KEEPER_AMBIENCE_DRYRUN;

function dry(line: string) {
  if (DRY) appendFileSync(DRY, `${new Date().toISOString()} ${line}\n`);
}

async function exec(c: Cmd, timeout = 15_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  if (DRY) { dry(`cmd ${c.file} ${c.args.join(' ')}`); return { ok: true, stdout: '', stderr: '' }; }
  return run(c.file, c.args, timeout);
}

async function mac<T>(method: string, params: unknown): Promise<T> {
  if (DRY) { dry(`helper ${method} ${JSON.stringify(params)}`); return { ok: true } as T; }
  const { macHelperCall } = await import('../platform/mac');
  return macHelperCall<T>(method, params, 20_000);
}

const isWayland = () => process.env.XDG_SESSION_TYPE === 'wayland' || (!!process.env.WAYLAND_DISPLAY && process.env.XDG_SESSION_TYPE !== 'x11');
const desk = () => linuxDesktop(process.env.XDG_CURRENT_DESKTOP, process.env.DESKTOP_SESSION);

// ---------------------------------------------------------------- desktop picture

/** The desktop picture now (to restore later); null when it cannot be read. */
export async function getDesktopPicture(): Promise<string | null> {
  if (DRY) { dry('get desktop picture'); return '/usr/share/backgrounds/original.png'; }
  try {
    if (process.platform === 'darwin') {
      const r = await mac<{ path?: string }>('desktop.getImage', {}).catch(async () => {
        const o = await run('/usr/bin/osascript', ['-e', 'tell application "System Events" to get picture of desktop 1']);
        return { path: o.ok ? o.stdout.trim() : undefined };
      });
      return r.path || null;
    }
    if (process.platform === 'win32') {
      const r = await powershell(WINDOWS_GET_SCRIPT);
      return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
    }
    const c = linuxGetCommand(desk());
    if (!c) return null;
    const r = await run(c.file, c.args);
    return r.ok && r.stdout.trim() ? pathFromUri(unquoteGsettings(r.stdout)) : null;
  } catch {
    return null;
  }
}

/** Sets the ordinary desktop picture on every display. */
export async function setDesktopPicture(imagePath: string): Promise<{ ok: boolean; how: string; error?: string }> {
  if (process.platform === 'darwin') {
    try {
      await mac('desktop.setImage', { path: imagePath });
      return { ok: true, how: 'NSWorkspace (every display; the lock screen follows on macOS 14 and later)' };
    } catch {
      const r = DRY ? { ok: true, stderr: '' } : await run('/usr/bin/osascript', ['-e', macSetScript(imagePath)]);
      return r.ok ? { ok: true, how: 'System Events' } : { ok: false, how: 'System Events', error: r.stderr.trim() || 'macOS did not allow it (Privacy & Security → Automation)' };
    }
  }
  if (process.platform === 'win32') {
    if (DRY) { dry(`cmd powershell SystemParametersInfo SPI_SETDESKWALLPAPER ${imagePath}`); return { ok: true, how: 'SystemParametersInfo' }; }
    const r = await powershell(windowsSetScript(imagePath));
    return r.stdout.includes('ok') ? { ok: true, how: 'SystemParametersInfo' } : { ok: false, how: 'SystemParametersInfo', error: r.stderr.trim() || 'Windows refused the picture' };
  }
  const errors: string[] = [];
  for (const c of linuxSetCommands(desk(), imagePath, isWayland())) {
    const r = await exec(c);
    if (r.ok) {
      // GNOME has light and dark pictures: set both (the second command in the list).
      if (c.file === 'gsettings' && c.args.includes('picture-uri')) {
        const dark = linuxSetCommands(desk(), imagePath, false).find((x) => x.args.includes('picture-uri-dark'));
        if (dark) await exec(dark);
      }
      return { ok: true, how: c.file === 'gdbus' ? 'the desktop portal' : c.file };
    }
    errors.push(`${c.file}: ${(r.stderr || 'not available').trim().split('\n')[0]}`);
  }
  return { ok: false, how: 'none', error: errors.join('; ') };
}

// ---------------------------------------------------------------- folder icons

async function attrib(args: string[]) {
  if (DRY) { dry(`cmd attrib ${args.join(' ')}`); return; }
  await run('attrib', args);
}

/**
 * Gives a folder a custom icon. `png` is the picture, `ico` the same as a
 * Windows icon; both are kept in Keeper's folder (`store`).
 */
export async function applyFolderIcon(folder: string, pngFile: string, icoFile: string): Promise<{ ok: boolean; previous: FolderIconRecord['previous']; error?: string }> {
  const previous: FolderIconRecord['previous'] = {};
  try {
    const st = await fsp.stat(folder);
    if (!st.isDirectory()) return { ok: false, previous, error: 'Not a folder' };
  } catch {
    return { ok: false, previous, error: 'Folder not found' };
  }
  try {
    if (process.platform === 'darwin') {
      await mac('desktop.setFolderIcon', { path: folder, image: pngFile });
      return { ok: true, previous };
    }
    if (process.platform === 'win32') {
      const ini = path.join(folder, 'desktop.ini');
      previous.desktopIni = existsSync(ini) ? await fsp.readFile(ini, 'utf8').catch(() => null) : null;
      if (!DRY) {
        // attrib prints the attribute letters before the path ("     S    C:\…").
        const a = await run('attrib', [folder]);
        const i = a.stdout.toLowerCase().indexOf(folder.toLowerCase());
        previous.folderWasSystem = i > 0 && a.stdout.slice(0, i).includes('S');
      }
      if (existsSync(ini)) await attrib(['-s', '-h', ini]);
      await fsp.writeFile(ini, desktopIniWithIcon(previous.desktopIni, icoFile), 'utf8');
      // Explorer reads desktop.ini only in folders marked System (or Read-only); the file itself is hidden.
      await attrib(['+s', '+h', ini]);
      await attrib(['+s', folder]);
      return { ok: true, previous };
    }
    // Linux: KDE reads .directory; the GIO attribute covers GNOME Files, Nemo, Caja and Thunar.
    if (desk() === 'kde') {
      const dir = path.join(folder, '.directory');
      previous.directoryFile = existsSync(dir) ? await fsp.readFile(dir, 'utf8').catch(() => null) : null;
      await fsp.writeFile(dir, directoryFileWithIcon(previous.directoryFile, pngFile));
      return { ok: true, previous };
    }
    if (!DRY) {
      const cur = await run('gio', ['info', '-a', 'metadata::custom-icon', folder]);
      previous.gioIcon = cur.ok ? parseGioIcon(cur.stdout) : null;
    } else previous.gioIcon = null;
    const r = await exec({ file: 'gio', args: gioSetArgs(folder, pngFile) });
    return r.ok ? { ok: true, previous } : { ok: false, previous, error: r.stderr.trim() || 'gio is not installed' };
  } catch (e) {
    return { ok: false, previous, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Puts a folder's original icon back. */
export async function restoreFolderIcon(rec: FolderIconRecord): Promise<{ ok: boolean; error?: string }> {
  try {
    if (process.platform === 'darwin') {
      await mac('desktop.setFolderIcon', { path: rec.folder, image: null });
      return { ok: true };
    }
    if (process.platform === 'win32') {
      const ini = path.join(rec.folder, 'desktop.ini');
      if (existsSync(ini)) await attrib(['-s', '-h', ini]);
      if (rec.previous.desktopIni) {
        await fsp.writeFile(ini, rec.previous.desktopIni, 'utf8');
        await attrib(['+s', '+h', ini]);
      } else {
        await fsp.rm(ini, { force: true });
        if (!rec.previous.folderWasSystem) await attrib(['-s', rec.folder]);
      }
      return { ok: true };
    }
    if (rec.previous.directoryFile !== undefined) {
      const dir = path.join(rec.folder, '.directory');
      if (rec.previous.directoryFile) await fsp.writeFile(dir, rec.previous.directoryFile);
      else await fsp.rm(dir, { force: true });
      return { ok: true };
    }
    const r = rec.previous.gioIcon
      ? await exec({ file: 'gio', args: ['set', rec.folder, 'metadata::custom-icon', rec.previous.gioIcon] })
      : await exec({ file: 'gio', args: gioUnsetArgs(rec.folder) });
    return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim() || 'gio failed' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** What custom folder icons are possible here, in words for the page. */
export function folderIconsHow(): string {
  if (process.platform === 'darwin') return 'Finder icons, set with NSWorkspace (removing one restores the original).';
  if (process.platform === 'win32') return 'Explorer icons, through the folder’s desktop.ini (Explorer may take a moment to refresh).';
  return desk() === 'kde' ? 'Dolphin icons, through the folder’s .directory file.' : 'File manager icons (GNOME Files, Nemo, Caja, Thunar) through the GIO custom-icon attribute.';
}

export function lockScreenNote(): string {
  if (process.platform === 'darwin') return 'The lock screen shows the desktop picture on macOS 14 and later.';
  if (process.platform === 'win32') return 'Windows keeps its own lock screen picture; apps can set it only with administrator policy or as a Store app, so Keeper leaves it alone.';
  return 'GNOME and KDE show a blurred desktop picture on the lock screen; other desktops have their own setting.';
}
