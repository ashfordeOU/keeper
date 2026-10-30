// SPDX-License-Identifier: AGPL-3.0-or-later
// Installed applications: size, version, when they were last opened, and
// removal — through the app's own uninstaller on Windows, the Trash on macOS
// (with its leftover support files), and the package manager on Linux.

import { shell } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { powershell, run } from '../../core/platform';
import type { AppInfo, CleanResult } from '../../core/types';

let cache: { at: number; list: AppInfo[] } | null = null;

async function macApps(): Promise<AppInfo[]> {
  const dirs = ['/Applications', path.join(os.homedir(), 'Applications'), '/Applications/Utilities'];
  const apps: string[] = [];
  for (const d of dirs) {
    try {
      for (const n of await fsp.readdir(d)) if (n.endsWith('.app')) apps.push(path.join(d, n));
    } catch {
      /* folder missing */
    }
  }
  const lastUsed = new Map<string, number>();
  const sizes = new Map<string, number>();
  for (let i = 0; i < apps.length; i += 40) {
    const chunk = apps.slice(i, i + 40);
    const [md, du] = await Promise.all([run('/usr/bin/mdls', ['-raw', '-name', 'kMDItemLastUsedDate', ...chunk], 20_000), run('/usr/bin/du', ['-sk', ...chunk], 60_000)]);
    md.stdout.split('\0').forEach((v, j) => { const t = Date.parse(v.replace(' +0000', 'Z').replace(' ', 'T')); if (chunk[j] && Number.isFinite(t)) lastUsed.set(chunk[j], t); });
    for (const line of du.stdout.split('\n')) {
      const m = line.match(/^(\d+)\s+(.+)$/);
      if (m) sizes.set(m[2], +m[1] * 1024);
    }
  }
  const out: AppInfo[] = [];
  for (const p of apps) {
    const plist = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(p, 'Contents', 'Info.plist')], 5000);
    let info: Record<string, string> = {};
    try { info = JSON.parse(plist.stdout); } catch { /* unreadable */ }
    out.push({
      id: info.CFBundleIdentifier ?? p,
      name: info.CFBundleDisplayName ?? info.CFBundleName ?? path.basename(p, '.app'),
      path: p,
      version: info.CFBundleShortVersionString,
      size: sizes.get(p) ?? 0,
      lastUsed: lastUsed.get(p) ?? 0,
      system: (info.CFBundleIdentifier ?? '').startsWith('com.apple.'),
    });
  }
  return out;
}

async function winApps(): Promise<AppInfo[]> {
  const script = `$k='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'; Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName } | Select-Object PSChildName,DisplayName,DisplayVersion,Publisher,EstimatedSize,UninstallString,QuietUninstallString,InstallLocation,DisplayIcon | ConvertTo-Json -Compress`;
  const r = await powershell(script, 60_000);
  let list: Record<string, string | number>[] = [];
  try {
    const raw = JSON.parse(r.stdout || '[]');
    list = Array.isArray(raw) ? raw : [raw];
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const out: AppInfo[] = [];
  for (const a of list) {
    const name = String(a.DisplayName);
    if (seen.has(name)) continue;
    seen.add(name);
    const exe = String(a.DisplayIcon ?? '').replace(/,\d+$/, '').replace(/"/g, '');
    let lastUsed = 0;
    if (exe.toLowerCase().endsWith('.exe')) {
      try { lastUsed = (await fsp.stat(exe)).atimeMs; } catch { /* gone */ }
    }
    out.push({
      id: String(a.PSChildName),
      name,
      path: String(a.InstallLocation ?? exe ?? ''),
      version: a.DisplayVersion ? String(a.DisplayVersion) : undefined,
      publisher: a.Publisher ? String(a.Publisher) : undefined,
      size: Number(a.EstimatedSize ?? 0) * 1024,
      lastUsed,
      uninstallCommand: String(a.UninstallString ?? ''),
      system: /^(Microsoft Visual C\+\+|Windows|Microsoft \.NET)/.test(name),
    });
  }
  return out;
}

async function linuxApps(): Promise<AppInfo[]> {
  const out: AppInfo[] = [];
  const fp = await run('flatpak', ['list', '--app', '--columns=application,name,version,size']);
  if (fp.ok) {
    for (const line of fp.stdout.split('\n').filter(Boolean)) {
      const [id, name, version, size] = line.split('\t');
      const m = size?.match(/([\d.]+)\s*(kB|MB|GB)/);
      const bytes = m ? +m[1] * (m[2] === 'GB' ? 1024 ** 3 : m[2] === 'MB' ? 1024 ** 2 : 1024) : 0;
      out.push({ id: `flatpak:${id}`, name, path: id, version, size: bytes, lastUsed: 0, uninstallCommand: `flatpak uninstall -y ${id}`, system: false });
    }
  }
  const sn = await run('snap', ['list']);
  if (sn.ok) {
    for (const line of sn.stdout.split('\n').slice(1).filter(Boolean)) {
      const [name, version, , , publisher, notes] = line.split(/\s+/);
      if (/base|core|snapd/.test(notes ?? '') || /^(core\d*|snapd|bare|gnome-|gtk-common)/.test(name)) continue;
      out.push({ id: `snap:${name}`, name, path: `/snap/${name}`, version, publisher, size: 0, lastUsed: 0, uninstallCommand: `pkexec snap remove ${name}`, system: false });
    }
  }
  for (const dir of ['/usr/share/applications', path.join(os.homedir(), '.local', 'share', 'applications')]) {
    let names: string[] = [];
    try { names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.desktop')); } catch { continue; }
    for (const n of names) {
      const text = await fsp.readFile(path.join(dir, n), 'utf8').catch(() => '');
      if (/^NoDisplay=true/m.test(text) || !/^Type=Application/m.test(text)) continue;
      const name = text.match(/^Name=(.+)$/m)?.[1];
      if (!name || out.some((o) => o.name === name)) continue;
      out.push({ id: `desktop:${n}`, name, path: path.join(dir, n), size: 0, lastUsed: 0, system: dir.startsWith('/usr') });
    }
  }
  return out;
}

export async function listApps(): Promise<AppInfo[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.list;
  const list = process.platform === 'darwin' ? await macApps() : process.platform === 'win32' ? await winApps() : await linuxApps();
  list.sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), list };
  return list;
}

/** Support files an app leaves in ~/Library, matched by bundle id or exact name. */
async function macLeftovers(app: AppInfo): Promise<string[]> {
  const lib = path.join(os.homedir(), 'Library');
  const keys = [app.id, app.name].filter((k) => k && k.length > 3 && !k.startsWith('/'));
  const places = ['Application Support', 'Caches', 'Preferences', 'Logs', 'Saved Application State', 'HTTPStorages', 'WebKit', 'Containers', 'Group Containers'];
  const found: string[] = [];
  for (const place of places) {
    let names: string[] = [];
    try { names = await fsp.readdir(path.join(lib, place)); } catch { continue; }
    for (const n of names) {
      const base = n.replace(/\.(plist|savedState)$/, '');
      if (keys.some((k) => base === k || (place === 'Group Containers' && base.endsWith('.' + app.id)))) found.push(path.join(lib, place, n));
    }
  }
  return found;
}

export async function uninstall(id: string): Promise<CleanResult> {
  const app = (await listApps()).find((a) => a.id === id);
  if (!app) throw new Error('That app is no longer installed');
  if (app.system) throw new Error('System apps are left alone');
  cache = null;
  if (process.platform === 'darwin') {
    const leftovers = await macLeftovers(app);
    await shell.trashItem(app.path);
    for (const l of leftovers) await shell.trashItem(l).catch(() => undefined);
    return { freed: app.size, removed: 1 + leftovers.length, failed: 0, skipped: [] };
  }
  if (!app.uninstallCommand) throw new Error('This app has no uninstaller Keeper can run; remove it with your package manager');
  // Hand over to the app's own uninstaller and let it run its own windows.
  const child = spawn(app.uninstallCommand, { shell: true, detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return { freed: 0, removed: 0, failed: 0, skipped: ['The app’s own uninstaller has opened'] };
}
