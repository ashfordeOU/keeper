// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Separate app icons for Mail, Calendar and Notes (core/launchers.ts): made on
// request from Settings → Features, and removed there. Keeper only ever removes
// what it made itself (checked by the bundle identifier, the shortcut's
// arguments or the desktop entry's X-Keeper-Launcher line).

import { app, ipcMain, shell } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isOurDesktopEntry, isOurMacLauncher, isOurShortcut, LAUNCHERS, launcherDef, launcherPlan, type LauncherContext, type LauncherPlan, type LauncherState } from '../../core/launchers';

const run = (cmd: string, args: string[]) => new Promise<boolean>((resolve) => {
  execFile(cmd, args, { timeout: 20_000 }, (e) => resolve(!e));
});

/** Where things are on this computer. */
export function launcherContext(): LauncherContext {
  const platform = process.platform;
  const packaged = app.isPackaged;
  // The program a launcher starts: the AppImage itself (not its temporary mount), the portable
  // Keeper.exe the person keeps (not the copy it unpacks), or the installed program.
  const exe = process.env.APPIMAGE || process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  // A development copy runs as `electron <folder>`: the folder goes first.
  const exeArgs = packaged ? [] : [app.getAppPath()];
  const appBundle = platform === 'darwin' && packaged ? path.resolve(process.execPath, '..', '..', '..') : undefined;
  let systemApplications = false;
  if (appBundle?.startsWith('/Applications/')) {
    try { fs.accessSync('/Applications', fs.constants.W_OK); systemApplications = true; } catch { /* ~/Applications */ }
  }
  return {
    platform, home: os.homedir(), exe, exeArgs, appBundle, systemApplications,
    appData: platform === 'win32' ? app.getPath('appData') : undefined,
    dataHome: process.env.XDG_DATA_HOME || undefined,
    iconDir: path.join(app.getPath('userData'), 'launchers'),
  };
}

/** The icon Keeper ships for a launcher (inside the app's archive; read with Electron's fs). */
const shippedIcon = (page: string, ext: 'png' | 'ico') => path.join(__dirname, '..', 'build', 'launchers', `keeper-${page}.${ext}`);

function read(p: string): string | null {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

/** Whether what is at the plan's place is a launcher Keeper made. */
function ours(plan: LauncherPlan): boolean {
  if (plan.kind === 'mac-app') return isOurMacLauncher(read(path.join(plan.target, 'Contents', 'Info.plist')) ?? '', plan.page);
  if (plan.kind === 'linux-desktop') return isOurDesktopEntry(read(plan.target) ?? '', plan.page);
  try { return isOurShortcut(shell.readShortcutLink(plan.target), plan.page); } catch { return false; }
}

function stateOf(page: string, c = launcherContext()): LauncherState {
  const l = launcherDef(page);
  if (!l) return { page, name: page, path: '', installed: false, unavailable: 'Only Mail, Calendar and Notes have app icons of their own' };
  const plan = launcherPlan(page, c);
  if ('unavailable' in plan) return { page, name: l.name, path: '', installed: false, unavailable: plan.unavailable };
  const there = fs.existsSync(plan.target);
  const mine = there && ours(plan);
  const missing = plan.kind === 'mac-app' && !fs.existsSync(plan.source) ? 'Not in this copy of Keeper' : undefined;
  return { page, name: l.name, path: plan.target, installed: mine, ...(there && !mine ? { foreign: true } : {}), ...(missing && !mine ? { unavailable: missing } : {}) };
}

export function listLaunchers(): LauncherState[] {
  const c = launcherContext();
  return LAUNCHERS.map((l) => stateOf(l.page, c));
}

export async function addLauncher(page: string): Promise<LauncherState[]> {
  const c = launcherContext();
  const plan = launcherPlan(page, c);
  if ('unavailable' in plan) throw new Error(plan.unavailable);
  if (fs.existsSync(plan.target) && !ours(plan)) throw new Error(`Something else is already called ${plan.name} there; Keeper leaves it alone`);
  fs.mkdirSync(path.dirname(plan.target), { recursive: true });
  if (plan.kind === 'mac-app') {
    if (!fs.existsSync(plan.source)) throw new Error('This copy of Keeper has no separate app icons');
    fs.rmSync(plan.target, { recursive: true, force: true });
    // ditto keeps the bundle exactly as signed.
    if (!(await run('/usr/bin/ditto', [plan.source, plan.target]))) throw new Error(`Could not copy ${plan.name} to ${path.dirname(plan.target)}`);
    // Launchpad and Spotlight hear of it now rather than at their next look.
    void run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', plan.target]);
  } else if (plan.kind === 'win-shortcut') {
    fs.mkdirSync(path.dirname(plan.icon), { recursive: true });
    fs.writeFileSync(plan.icon, fs.readFileSync(shippedIcon(page, 'ico')));
    const ok = shell.writeShortcutLink(plan.target, 'create', { target: plan.exe, args: plan.args, description: plan.description, icon: plan.icon, iconIndex: 0, cwd: path.dirname(plan.exe) });
    if (!ok) throw new Error(`Could not add ${plan.name} to the Start menu`);
  } else {
    fs.mkdirSync(path.dirname(plan.icon), { recursive: true });
    fs.writeFileSync(plan.icon, fs.readFileSync(shippedIcon(page, 'png')));
    fs.writeFileSync(plan.target, plan.content, { mode: 0o755 });
    void run('update-desktop-database', [path.dirname(plan.target)]);
  }
  return listLaunchers();
}

export async function removeLauncher(page: string): Promise<LauncherState[]> {
  const plan = launcherPlan(page, launcherContext());
  if ('unavailable' in plan || !fs.existsSync(plan.target)) return listLaunchers();
  if (!ours(plan)) throw new Error(`${plan.name} there was not made by Keeper; it stays`);
  if (plan.kind === 'mac-app') fs.rmSync(plan.target, { recursive: true, force: true });
  else {
    fs.rmSync(plan.target, { force: true });
    fs.rmSync(plan.icon, { force: true });
    if (plan.kind === 'linux-desktop') void run('update-desktop-database', [path.dirname(plan.target)]);
  }
  return listLaunchers();
}

/**
 * macOS: launchers copied to Applications by an older Keeper are replaced by this version's
 * (they are copies, so they do not update with Keeper by themselves).
 */
export async function refreshLaunchers() {
  if (process.platform !== 'darwin' || !app.isPackaged) return;
  const c = launcherContext();
  for (const l of LAUNCHERS) {
    const plan = launcherPlan(l.page, c);
    if ('unavailable' in plan || plan.kind !== 'mac-app' || !fs.existsSync(plan.target) || !ours(plan) || !fs.existsSync(plan.source)) continue;
    const version = (p: string) => /<key>CFBundleVersion<\/key>\s*<string>([^<]*)<\/string>/.exec(read(path.join(p, 'Contents', 'Info.plist')) ?? '')?.[1];
    if (version(plan.target) !== version(plan.source)) await addLauncher(l.page).catch(() => undefined);
  }
}

export function registerLaunchersIpc() {
  ipcMain.handle('launchers.list', () => listLaunchers());
  ipcMain.handle('launchers.add', (_e, page: unknown) => addLauncher(String(page)));
  ipcMain.handle('launchers.remove', (_e, page: unknown) => removeLauncher(String(page)));
  ipcMain.handle('launchers.reveal', (_e, page: unknown) => {
    const s = stateOf(String(page));
    if (s.installed && s.path) shell.showItemInFolder(s.path);
  });
  setTimeout(() => void refreshLaunchers(), 20_000).unref?.();
}
