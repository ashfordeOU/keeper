// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Quick Search as a launcher: the apps on this computer (read on first use
// and kept for ten minutes, no watchers), opening them, your saved links and
// commands, and what you opened before (core/launcher/frecency.ts), so the
// things you use rise to the top. Nothing here runs while Quick Search is
// closed, and nothing leaves the computer.

import { app, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, promises as fsp, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appNameFromPath, dedupeApps, execArgv, isNoiseShortcut, parseDesktopEntry, type LaunchApp } from '../../core/launcher/apps';
import { cleanBook, recordUse, useBonus, type UseBook } from '../../core/launcher/frecency';
import { buildLink, commandLine, normalizeLauncher, type LauncherSettings, type QuickLink, type UserCommand } from '../../core/launcher/links';
import { powershell, run } from '../../core/platform';
import { settings, updateSettings } from '../store';

const APPS_TTL = 10 * 60_000;
let appsCache: { at: number; list: LaunchApp[] } | null = null;
let building: Promise<LaunchApp[]> | null = null;

// ---------------------------------------------------------------- finding apps

async function readdirSafe(dir: string): Promise<string[]> {
  try { return await fsp.readdir(dir); } catch { return []; }
}

async function macApps(): Promise<LaunchApp[]> {
  const home = os.homedir();
  const dirs = [path.join(home, 'Applications'), '/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities', '/System/Library/CoreServices/Applications'];
  const out: LaunchApp[] = [];
  for (const d of dirs) {
    for (const n of await readdirSafe(d)) {
      if (n.endsWith('.app')) out.push({ id: path.join(d, n), name: appNameFromPath(n), path: path.join(d, n) });
      // One level of folders inside /Applications ("Adobe Photoshop 2025/Adobe Photoshop 2025.app").
      else if (d === '/Applications' && !n.startsWith('.')) {
        for (const m of await readdirSafe(path.join(d, n))) if (m.endsWith('.app')) out.push({ id: path.join(d, n, m), name: appNameFromPath(m), path: path.join(d, n, m) });
      }
    }
  }
  return out;
}

async function walkLnk(dir: string, out: LaunchApp[], depth = 0) {
  if (depth > 4) return;
  let ents: import('node:fs').Dirent[] = [];
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkLnk(p, out, depth + 1);
    else if (/\.(lnk|url)$/i.test(e.name)) {
      const name = appNameFromPath(e.name).replace(/\.url$/i, '');
      if (!isNoiseShortcut(name)) out.push({ id: p, name, path: p });
    }
  }
}

async function winApps(): Promise<LaunchApp[]> {
  const out: LaunchApp[] = [];
  const roots = [path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs')];
  for (const r of roots) await walkLnk(r, out);
  // Store apps (and everything else on the Start menu) by their app id.
  const r = await powershell('Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress', 20_000).catch(() => null);
  if (r?.ok && r.stdout.trim()) {
    try {
      const raw = JSON.parse(r.stdout) as { Name: string; AppID: string } | { Name: string; AppID: string }[];
      for (const a of Array.isArray(raw) ? raw : [raw]) {
        // Only those with no shortcut of their own (Store apps have a "!" in their id).
        if (a?.Name && a.AppID && a.AppID.includes('!') && !isNoiseShortcut(a.Name)) out.push({ id: `store:${a.AppID}`, name: a.Name, path: '', exec: [a.AppID] });
      }
    } catch { /* not JSON */ }
  }
  return out;
}

function xdgAppDirs(): string[] {
  const home = os.homedir();
  const dataHome = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  const dataDirs = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean);
  const dirs = [dataHome, ...dataDirs, path.join(home, '.local/share/flatpak/exports/share'), '/var/lib/flatpak/exports/share'].map((d) => path.join(d, 'applications'));
  dirs.push('/var/lib/snapd/desktop/applications');
  return [...new Set(dirs)];
}

async function linuxApps(): Promise<LaunchApp[]> {
  const out: LaunchApp[] = [];
  const locale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || 'en_US';
  const desktop = process.env.XDG_CURRENT_DESKTOP || '';
  const seen = new Set<string>();
  for (const dir of xdgAppDirs()) {
    for (const n of await readdirSafe(dir)) {
      // The first folder with a file of a given name wins (the person's own come first).
      if (!n.endsWith('.desktop') || seen.has(n)) continue;
      seen.add(n);
      const text = await fsp.readFile(path.join(dir, n), 'utf8').catch(() => '');
      const e = parseDesktopEntry(text, locale, desktop);
      if (!e || e.hidden || !e.exec) continue;
      const argv = execArgv(e.exec, { name: e.name, icon: e.icon });
      if (!argv) continue;
      out.push({ id: `desktop:${n}`, name: e.name, path: path.join(dir, n), keywords: [e.genericName, e.keywords].filter(Boolean).join(' ') || undefined, exec: argv, icon: e.icon, terminal: e.terminal });
    }
  }
  return out;
}

/** The apps Quick Search can open (cached for ten minutes; a stale list is used while a new one is read). */
export async function launchApps(): Promise<LaunchApp[]> {
  if (appsCache && Date.now() - appsCache.at < APPS_TTL) return appsCache.list;
  building ??= (async () => {
    try {
      const raw = process.platform === 'darwin' ? await macApps() : process.platform === 'win32' ? await winApps() : await linuxApps();
      const list = dedupeApps(raw);
      appsCache = { at: Date.now(), list };
      return list;
    } finally {
      building = null;
    }
  })();
  // A stale list answers at once; the fresh one is used next time.
  if (appsCache) return appsCache.list;
  return building;
}

/** Forget the cached list (the feature was switched off). */
export function forgetApps() { appsCache = null; iconCache.clear(); }

// ---------------------------------------------------------------- icons

const iconCache = new Map<string, string>();

function linuxIconFile(name: string): string | undefined {
  if (path.isAbsolute(name)) return existsSync(name) ? name : undefined;
  const bases = [path.join(os.homedir(), '.local/share/icons'), '/usr/share/icons', '/usr/local/share/icons', '/var/lib/flatpak/exports/share/icons', path.join(os.homedir(), '.local/share/flatpak/exports/share/icons')];
  for (const b of bases) {
    for (const size of ['48x48', '64x64', '32x32', '128x128', '256x256']) {
      const p = path.join(b, 'hicolor', size, 'apps', `${name}.png`);
      if (existsSync(p)) return p;
    }
  }
  for (const p of [`/usr/share/pixmaps/${name}.png`]) if (existsSync(p)) return p;
  return undefined;
}

/** A small picture of an app (a data: URL), or undefined. */
export async function appIcon(a: LaunchApp): Promise<string | undefined> {
  const hit = iconCache.get(a.id);
  if (hit !== undefined) return hit || undefined;
  let url = '';
  try {
    if (process.platform === 'linux') {
      const f = a.icon ? linuxIconFile(a.icon) : undefined;
      if (f) url = `data:image/png;base64,${(await fsp.readFile(f)).toString('base64')}`;
    } else if (a.path) {
      const img = await app.getFileIcon(a.path, { size: 'normal' });
      if (!img.isEmpty()) url = img.toDataURL();
    }
  } catch { /* no icon */ }
  iconCache.set(a.id, url);
  return url || undefined;
}

// ---------------------------------------------------------------- what you used before

const usesFile = () => path.join(app.getPath('userData'), 'launcher-uses.json');
let uses: UseBook | null = null;
let saveTimer: NodeJS.Timeout | undefined;

function book(): UseBook {
  if (uses) return uses;
  try { uses = cleanBook(JSON.parse(readFileSync(usesFile(), 'utf8'))); } catch { uses = {}; }
  return uses;
}

export function noteUse(id: string) {
  uses = recordUse(book(), id, Date.now());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void fsp.writeFile(usesFile(), JSON.stringify(uses)).catch(() => undefined); }, 1500);
}

export function bonusFor(id: string): number {
  return useBonus(book(), id, Date.now());
}

// ---------------------------------------------------------------- opening

export function launcherSettings(): LauncherSettings {
  return normalizeLauncher(settings().launcher);
}

async function which(cmd: string): Promise<boolean> {
  return (await run('/usr/bin/env', ['which', cmd], 3000).catch(() => ({ ok: false }))).ok;
}

/** Opens an app; throws with a plain message when it can't. */
export async function openApp(a: LaunchApp): Promise<void> {
  noteUse(`app:${a.id}`);
  if (process.platform === 'win32' && a.id.startsWith('store:') && a.exec?.[0]) {
    spawn('explorer.exe', [`shell:AppsFolder\\${a.exec[0]}`], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (process.platform === 'linux') {
    const id = a.id.replace(/^desktop:/, '').replace(/\.desktop$/, '');
    // gtk-launch follows the file's own rules (terminal apps, D-Bus activation).
    if (await which('gtk-launch')) {
      const r = await run('gtk-launch', [id], 8000);
      if (r.ok) return;
    }
    if (!a.exec?.length) throw new Error(`${a.name} has no program to start`);
    const argv = a.terminal ? ['x-terminal-emulator', '-e', ...a.exec] : a.exec;
    const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore', cwd: os.homedir() });
    child.on('error', () => undefined);
    child.unref();
    return;
  }
  const err = await shell.openPath(a.path);
  if (err) throw new Error(err);
}

export function revealApp(a: LaunchApp) {
  if (a.path) shell.showItemInFolder(a.path);
}

export async function openLink(l: QuickLink, query: string, openKeeperLink: (url: string) => void): Promise<void> {
  const url = buildLink(l, query);
  if (!url) throw new Error('Saved links open only web, mail and Keeper addresses');
  noteUse(`link:${l.id}`);
  if (url.startsWith('keeper:')) openKeeperLink(url);
  else await shell.openExternal(url);
}

export interface CommandResult { ran: boolean; ok?: boolean; output?: string }

/** Runs one of your commands, after asking (unless you said not to for this one). */
export async function runCommand(cmd: UserCommand, query: string, show: (title: string, detail: string) => void, copy: (t: string) => Promise<void>): Promise<CommandResult> {
  const line = commandLine(cmd, query, process.platform);
  if (cmd.confirm) {
    const r = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Run', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Run “${cmd.name}”?`,
      detail: `This runs on your computer:\n\n${line}`,
      checkboxLabel: 'Don’t ask again for this command',
    });
    if (r.response !== 0) return { ran: false };
    if (r.checkboxChecked) {
      const ls = launcherSettings();
      await updateSettings({ launcher: { ...ls, commands: ls.commands.map((c) => (c.id === cmd.id ? { ...c, confirm: false } : c)) } });
    }
  }
  noteUse(`command:${cmd.id}`);
  const result = await new Promise<{ ok: boolean; out: string }>((resolve) => {
    let out = '';
    const child = spawn(line, { shell: true, cwd: os.homedir(), windowsHide: true, timeout: 60_000 });
    const take = (d: Buffer) => { if (out.length < 100_000) out += d.toString('utf8'); };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    child.on('error', (e) => resolve({ ok: false, out: e.message }));
    child.on('close', (code) => resolve({ ok: code === 0, out }));
  });
  const text = result.out.trim();
  if (cmd.output === 'copy' && text) await copy(text);
  if (cmd.output === 'show' || !result.ok) show(result.ok ? cmd.name : `${cmd.name} did not finish`, text.slice(0, 400) || (result.ok ? 'Done' : 'It stopped with an error'));
  else if (cmd.output === 'copy') show(cmd.name, text ? 'Copied what it printed' : 'Done; it printed nothing');
  return { ran: true, ok: result.ok, output: text.slice(0, 4000) };
}
