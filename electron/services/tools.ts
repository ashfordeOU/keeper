// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// System helpers behind the Toolbox (network details, OS tweaks, quarantine
// and permission resets) and "Tidy this folder".

import { BrowserWindow, dialog } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NetworkInfo, Tweak } from '../../core/api-x';
import type { FileIndex } from '../../core/indexer';
import { moveFile, type Journal } from '../../core/journal';
import { powershell, run } from '../../core/platform';
import { uniqueName } from '../../core/rules';
import { planTidy, summarizeTidy, type TidyMode } from '../../core/tidy';
import type { CleanResult, JournalOp } from '../../core/types';

export function networkInfo(): NetworkInfo {
  const interfaces: NetworkInfo['interfaces'] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) interfaces.push({ name, address: a.address, family: a.family === 'IPv6' ? 'IPv6' : 'IPv4', mac: a.mac, internal: a.internal });
  }
  return { hostname: os.hostname(), interfaces: interfaces.sort((a, b) => Number(a.internal) - Number(b.internal) || a.family.localeCompare(b.family)) };
}

export async function publicIp(): Promise<string> {
  const res = await fetch('https://api.ipify.org?format=json');
  if (!res.ok) throw new Error('Could not reach the address service');
  return ((await res.json()) as { ip: string }).ip;
}

// ---------------------------------------------------------------- OS tweaks

const defaultsBool = async (domain: string, key: string) => /^(1|true|YES)$/i.test((await run('/usr/bin/defaults', ['read', domain, key])).stdout.trim());

async function macTweaks(): Promise<Tweak[]> {
  const delay = parseFloat((await run('/usr/bin/defaults', ['read', 'com.apple.dock', 'autohide-delay'])).stdout) || 0.5;
  return [
    { id: 'finder-hidden', label: 'Show hidden files in Finder', description: 'Files whose names start with a dot become visible.', kind: 'toggle', value: await defaultsBool('com.apple.finder', 'AppleShowAllFiles'), confirm: 'Finder will restart.' },
    { id: 'finder-extensions', label: 'Always show file extensions', description: 'Show “.pdf”, “.jpg” and so on everywhere.', kind: 'toggle', value: await defaultsBool('NSGlobalDomain', 'AppleShowAllExtensions'), confirm: 'Finder will restart.' },
    { id: 'dock-autohide', label: 'Hide the Dock automatically', description: 'The Dock slides away until you move the pointer to it.', kind: 'toggle', value: await defaultsBool('com.apple.dock', 'autohide'), confirm: 'The Dock will restart.' },
    { id: 'dock-delay', label: 'Dock show delay (seconds)', description: '0 makes a hidden Dock appear instantly. The system default is 0.5.', kind: 'number', value: delay, confirm: 'The Dock will restart.' },
    { id: 'screenshot-shadow', label: 'Window screenshots without shadow', description: 'Screenshots of a single window leave out the drop shadow.', kind: 'toggle', value: await defaultsBool('com.apple.screencapture', 'disable-shadow'), confirm: 'The screenshot service will restart.' },
    { id: 'restart-finder', label: 'Restart Finder', description: 'Fixes a Finder that stopped responding.', kind: 'action', confirm: 'Finder windows will close and reopen.' },
    { id: 'mac-natural-scroll', label: 'Natural scrolling', description: 'Content follows your fingers. macOS uses one setting for the mouse and the trackpad.', kind: 'toggle', value: (await run('/usr/bin/defaults', ['read', '-g', 'com.apple.swipescrolldirection'])).stdout.trim() !== '0' },
    { id: 'mac-wheel-speed', label: 'Mouse wheel speed', description: '0 to 5; higher scrolls further per notch (the system default is about 0.3). Applies after you log out and back in.', kind: 'number', value: parseFloat((await run('/usr/bin/defaults', ['read', '-g', 'com.apple.scrollwheel.scaling'])).stdout) || 0.3125 },
    { id: 'mac-key-repeat', label: 'Faster key repeat', description: 'Held keys repeat sooner and faster than the System Settings slider allows.', kind: 'toggle', value: (parseFloat((await run('/usr/bin/defaults', ['read', '-g', 'KeyRepeat'])).stdout) || 6) <= 2 },
  ];
}

async function winRegDword(key: string, name: string): Promise<number | undefined> {
  const r = await run('reg', ['query', key, '/v', name]);
  const m = r.stdout.match(/REG_DWORD\s+0x([0-9a-f]+)/i);
  return m ? parseInt(m[1], 16) : undefined;
}

const ADV = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced';

async function winTweaks(): Promise<Tweak[]> {
  return [
    { id: 'win-extensions', label: 'Show file extensions', description: 'Show “.pdf”, “.jpg” and so on in File Explorer.', kind: 'toggle', value: (await winRegDword(ADV, 'HideFileExt')) === 0, confirm: 'File Explorer will refresh.' },
    { id: 'win-hidden', label: 'Show hidden files', description: 'Hidden files and folders become visible in File Explorer.', kind: 'toggle', value: (await winRegDword(ADV, 'Hidden')) === 1, confirm: 'File Explorer will refresh.' },
    { id: 'restart-explorer', label: 'Restart File Explorer', description: 'Fixes a stuck taskbar or Explorer window.', kind: 'action', confirm: 'The taskbar and Explorer windows will restart.' },
    { id: 'win-wheel-lines', label: 'Lines per mouse-wheel notch', description: 'How far one notch of the wheel scrolls (Windows default: 3).', kind: 'number', value: Number((await run('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WheelScrollLines'])).stdout.match(/REG_SZ\s+(\d+)/)?.[1] ?? 3) },
    { id: 'win-mouse-reverse', label: 'Reverse the mouse wheel (natural scrolling)', description: 'Only the mouse wheel; the touchpad keeps its own setting. Asks for administrator, then unplug and plug the mouse back in.', kind: 'toggle', value: /FlipFlopWheel\s+REG_DWORD\s+0x1/.test((await powershell("Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\HID' -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -eq 'Device Parameters' -and ($_.GetValue('FlipFlopWheel') -ne $null) } | Select-Object -First 1 | ForEach-Object { 'FlipFlopWheel REG_DWORD 0x' + $_.GetValue('FlipFlopWheel') }")).stdout), confirm: 'Windows will ask for administrator permission.' },
  ];
}

async function linuxTweaks(): Promise<Tweak[]> {
  const r = await run('gsettings', ['get', 'org.gtk.Settings.FileChooser', 'show-hidden']);
  if (!r.ok) return [];
  const out: Tweak[] = [{ id: 'gtk-hidden', label: 'Show hidden files in file dialogs', description: 'Open and Save dialogs show dot-files.', kind: 'toggle', value: r.stdout.trim() === 'true' }];
  // GNOME keeps the mouse and the touchpad apart, so each can scroll its own way.
  const mouse = await run('gsettings', ['get', 'org.gnome.desktop.peripherals.mouse', 'natural-scroll']);
  if (mouse.ok) {
    const pad = await run('gsettings', ['get', 'org.gnome.desktop.peripherals.touchpad', 'natural-scroll']);
    const speed = await run('gsettings', ['get', 'org.gnome.desktop.peripherals.mouse', 'speed']);
    out.push(
      { id: 'gnome-mouse-natural', label: 'Natural scrolling for the mouse', description: 'Only the mouse wheel; the touchpad keeps its own setting.', kind: 'toggle', value: mouse.stdout.trim() === 'true' },
      { id: 'gnome-touchpad-natural', label: 'Natural scrolling for the touchpad', description: 'Only the touchpad.', kind: 'toggle', value: pad.stdout.trim() === 'true' },
      { id: 'gnome-mouse-speed', label: 'Mouse pointer speed', description: 'From -1 (slow) to 1 (fast).', kind: 'number', value: parseFloat(speed.stdout) || 0 },
    );
  }
  return out;
}

export async function tweaks(): Promise<Tweak[]> {
  if (process.platform === 'darwin') return macTweaks();
  if (process.platform === 'win32') return winTweaks();
  return linuxTweaks();
}

export async function setTweak(id: string, value?: boolean | number): Promise<Tweak[]> {
  const b = value ? 'true' : 'false';
  switch (id) {
    case 'finder-hidden':
      await run('/usr/bin/defaults', ['write', 'com.apple.finder', 'AppleShowAllFiles', '-bool', b]);
      await run('/usr/bin/killall', ['Finder']);
      break;
    case 'finder-extensions':
      await run('/usr/bin/defaults', ['write', 'NSGlobalDomain', 'AppleShowAllExtensions', '-bool', b]);
      await run('/usr/bin/killall', ['Finder']);
      break;
    case 'dock-autohide':
      await run('/usr/bin/defaults', ['write', 'com.apple.dock', 'autohide', '-bool', b]);
      await run('/usr/bin/killall', ['Dock']);
      break;
    case 'dock-delay': {
      const v = Math.max(0, Math.min(5, Number(value) || 0));
      await run('/usr/bin/defaults', ['write', 'com.apple.dock', 'autohide-delay', '-float', String(v)]);
      await run('/usr/bin/killall', ['Dock']);
      break;
    }
    case 'screenshot-shadow':
      await run('/usr/bin/defaults', ['write', 'com.apple.screencapture', 'disable-shadow', '-bool', b]);
      await run('/usr/bin/killall', ['SystemUIServer']);
      break;
    case 'restart-finder':
      await run('/usr/bin/killall', ['Finder']);
      break;
    case 'win-extensions':
      await run('reg', ['add', ADV, '/v', 'HideFileExt', '/t', 'REG_DWORD', '/d', value ? '0' : '1', '/f']);
      break;
    case 'win-hidden':
      await run('reg', ['add', ADV, '/v', 'Hidden', '/t', 'REG_DWORD', '/d', value ? '1' : '2', '/f']);
      break;
    case 'restart-explorer':
      await powershell('Stop-Process -Name explorer -Force; Start-Sleep -Milliseconds 800; if (-not (Get-Process explorer -ErrorAction SilentlyContinue)) { Start-Process explorer }');
      break;
    case 'mac-natural-scroll':
      await run('/usr/bin/defaults', ['write', '-g', 'com.apple.swipescrolldirection', '-bool', b]);
      break;
    case 'mac-wheel-speed':
      await run('/usr/bin/defaults', ['write', '-g', 'com.apple.scrollwheel.scaling', '-float', String(Math.max(0, Math.min(5, Number(value) || 0)))]);
      break;
    case 'mac-key-repeat':
      await run('/usr/bin/defaults', ['write', '-g', 'KeyRepeat', '-int', value ? '2' : '6']);
      await run('/usr/bin/defaults', ['write', '-g', 'InitialKeyRepeat', '-int', value ? '15' : '25']);
      break;
    case 'win-wheel-lines':
      await run('reg', ['add', 'HKCU\\Control Panel\\Desktop', '/v', 'WheelScrollLines', '/t', 'REG_SZ', '/d', String(Math.max(1, Math.min(100, Math.round(Number(value) || 3)))), '/f']);
      break;
    case 'win-mouse-reverse': {
      const v = value ? 1 : 0;
      const inner = `Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\HID' -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -eq 'Device Parameters' -and ($_.GetValue('FlipFlopWheel') -ne $null) } | ForEach-Object { Set-ItemProperty -Path $_.PSPath -Name FlipFlopWheel -Value ${v} }`;
      await powershell(`Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-Command',"${inner.replace(/"/g, '`"')}"`);
      break;
    }
    case 'gnome-mouse-natural':
      await run('gsettings', ['set', 'org.gnome.desktop.peripherals.mouse', 'natural-scroll', b]);
      break;
    case 'gnome-touchpad-natural':
      await run('gsettings', ['set', 'org.gnome.desktop.peripherals.touchpad', 'natural-scroll', b]);
      break;
    case 'gnome-mouse-speed':
      await run('gsettings', ['set', 'org.gnome.desktop.peripherals.mouse', 'speed', String(Math.max(-1, Math.min(1, Number(value) || 0)))]);
      break;
    case 'gtk-hidden':
      await run('gsettings', ['set', 'org.gtk.Settings.FileChooser', 'show-hidden', b]);
      await run('gsettings', ['set', 'org.gtk.gtk4.Settings.FileChooser', 'show-hidden', b]);
      break;
    default:
      throw new Error('Unknown setting');
  }
  return tweaks();
}

/** Clears the "downloaded from the internet" flag that makes macOS call an app damaged. */
export async function clearQuarantine(appPath: string): Promise<boolean> {
  if (process.platform !== 'darwin' || !appPath.endsWith('.app') || !existsSync(appPath)) return false;
  return (await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', appPath])).ok;
}

/** Resets everything an app was allowed (camera, files, screen…), so macOS asks again. */
export async function resetPermissions(bundleOrApp: string): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  let id = bundleOrApp.trim();
  if (id.endsWith('.app')) id = (await run('/usr/bin/mdls', ['-raw', '-name', 'kMDItemCFBundleIdentifier', id])).stdout.trim();
  if (!/^[A-Za-z0-9.-]+$/.test(id)) return false;
  return (await run('/usr/bin/tccutil', ['reset', 'All', id])).ok;
}

export async function pickApp(win?: BrowserWindow): Promise<string | null> {
  const r = await dialog.showOpenDialog(win!, {
    defaultPath: process.platform === 'darwin' ? '/Applications' : undefined,
    properties: ['openFile'],
    filters: process.platform === 'darwin' ? [{ name: 'Applications', extensions: ['app'] }] : undefined,
  });
  return r.canceled ? null : r.filePaths[0];
}

export async function pickFiles(win: BrowserWindow | undefined, filters?: { name: string; extensions: string[] }[]): Promise<string[]> {
  const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'], filters });
  return r.canceled ? [] : r.filePaths;
}

export async function saveAs(win: BrowserWindow | undefined, defaultName: string, content: string): Promise<string | null> {
  const r = await dialog.showSaveDialog(win!, { defaultPath: path.join(os.homedir(), 'Downloads', defaultName) });
  if (r.canceled || !r.filePath) return null;
  const m = content.match(/^data:[^;]+;base64,(.*)$/);
  await fsp.writeFile(r.filePath, m ? Buffer.from(m[1], 'base64') : content);
  return r.filePath;
}

// ---------------------------------------------------------------- tidy a folder

export async function tidyFolder(dir: string, mode: TidyMode, apply: boolean, index: FileIndex, journal: Journal) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const items = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    const st = await fsp.stat(p).catch(() => null);
    if (st) items.push({ path: p, name: e.name, isDir: st.isDirectory() && !e.name.endsWith('.app'), mtime: st.mtimeMs });
  }
  const moves = planTidy(dir, items, mode, path.sep);
  const summary = summarizeTidy(moves);
  if (!apply) return { moves, summary };
  const result: CleanResult = { freed: 0, removed: 0, failed: 0, skipped: [] };
  const ops: JournalOp[] = [];
  for (const m of moves) {
    try {
      if (!existsSync(m.dir)) {
        await fsp.mkdir(m.dir, { recursive: true });
        ops.push({ type: 'create', from: m.dir, size: 0 });
      }
      const to = uniqueName(path.join(m.dir, path.basename(m.from)), existsSync);
      await moveFile(m.from, to);
      index.rename(m.from, to);
      ops.push({ type: 'move', from: m.from, to, size: 0 });
      result.removed++;
    } catch (e) {
      result.failed++;
      result.skipped.push(`${path.basename(m.from)}: ${e instanceof Error ? e.message : 'could not be moved'}`);
    }
  }
  const entry = await journal.record(`Tidied ${path.basename(dir)} into ${summary.length} folder${summary.length === 1 ? '' : 's'}`, ops);
  result.journalId = entry?.id;
  return { moves, summary, result };
}

// ---------------------------------------------------------------- empty folders & broken links

/**
 * Folders with nothing in them (ignoring .DS_Store / desktop.ini / Thumbs.db) and
 * links that point at something that no longer exists, inside the indexed folders.
 * The indexed folders themselves are never listed.
 */
export async function emptyAndBroken(roots: string[], excluded: string[]): Promise<{ empty: string[]; broken: string[] }> {
  const empty: string[] = [];
  const broken: string[] = [];
  const junk = /^(\.ds_store|desktop\.ini|thumbs\.db|\.localized)$/i;
  const skip = /^(node_modules|\.git|\.svn|\.hg|\.venv|venv|__pycache__|\.cache|Library|AppData)$/;
  const isExcluded = (p: string) => excluded.some((e) => p === e || p.startsWith(e + path.sep));
  async function visit(dir: string, depth: number, isRoot: boolean): Promise<boolean> {
    if (depth > 12 || isExcluded(dir)) return false;
    let list;
    try {
      list = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    let hasContent = false;
    for (const e of list) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        const target = await fsp.stat(p).catch(() => null);
        if (!target) broken.push(p);
        hasContent = true;
      } else if (e.isDirectory()) {
        if (skip.test(e.name) || e.name.endsWith('.app') || e.name.endsWith('.photoslibrary')) {
          hasContent = true;
          continue;
        }
        const childEmpty = await visit(p, depth + 1, false);
        if (!childEmpty) hasContent = true;
      } else if (!junk.test(e.name)) hasContent = true;
    }
    if (!hasContent && !isRoot) {
      // Report only the outermost empty folder of an empty chain.
      for (let i = empty.length - 1; i >= 0; i--) if (empty[i].startsWith(dir + path.sep)) empty.splice(i, 1);
      empty.push(dir);
      return true;
    }
    return false;
  }
  for (const r of roots) if (existsSync(r)) await visit(r, 0, true);
  return { empty, broken };
}

/** Removes a dangling link, after checking again that it is still a link to nothing. */
export async function removeBrokenLink(p: string, roots: string[]): Promise<boolean> {
  if (!roots.some((r) => p.startsWith(r + path.sep))) return false;
  try {
    const st = await fsp.lstat(p);
    if (!st.isSymbolicLink()) return false;
    if (await fsp.stat(p).then(() => true, () => false)) return false;
    await fsp.unlink(p);
    return true;
  } catch {
    return false;
  }
}
