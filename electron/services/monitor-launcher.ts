// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The tool launcher: a shortcut from any app opens a small search box over
// everything; picking a tool opens it in a small window that shows only that
// tool (or in the main window, if the person prefers). Also the standard
// output folder that tools write their results to.

import { app, BrowserWindow, globalShortcut, nativeTheme, screen } from 'electron';
import { existsSync, promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseToolId, standardOutputDir } from '../../core/tool-catalog';
import { launcherTools } from '../../core/tool-catalog';
import { TOOL_INFO } from '../../core/convert-types';
import { setStandardOutput } from './convert-shared';
import { featureOn, onFeature } from './features';
import { monitorSettings, onMonitorSettings } from './monitor-settings';
import { keepUnmanaged, overlayOptions } from './unmanaged';

export interface LauncherDeps {
  preload: string;
  lockDown: (win: BrowserWindow) => void;
  showMain: (route?: string) => void;
  devUrl?: string;
}

let deps: LauncherDeps | null = null;
let launcher: BrowserWindow | null = null;
const toolWins = new Map<string, BrowserWindow>();
let registered = '';
let recent: string[] | null = null;

const recentFile = () => path.join(app.getPath('userData'), 'launcher-recent.json');

function loadQuery(win: BrowserWindow, query: Record<string, string>) {
  if (deps?.devUrl) void win.loadURL(`${deps.devUrl}?${new URLSearchParams(query)}`);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
}

export function recentTools(): string[] {
  if (!recent) {
    try {
      const r = JSON.parse(readFileSync(recentFile(), 'utf8'));
      recent = Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string').slice(0, 12) : [];
    } catch {
      recent = [];
    }
  }
  return recent;
}

function remember(id: string) {
  recent = [id, ...recentTools().filter((x) => x !== id)].slice(0, 12);
  void fsp.writeFile(recentFile(), JSON.stringify(recent)).catch(() => undefined);
}

export function toggleLauncher() {
  if (!deps || !featureOn('toolLauncher')) return;
  if (launcher && !launcher.isDestroyed() && launcher.isVisible()) {
    launcher.hide();
    return;
  }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const w = 620;
  const h = 440;
  if (!launcher || launcher.isDestroyed()) {
    launcher = new BrowserWindow({
      ...overlayOptions('launcher'),
      width: w, height: h, frame: false, transparent: true, resizable: false, show: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, hasShadow: false,
      webPreferences: { preload: deps.preload, contextIsolation: true, sandbox: true },
    });
    keepUnmanaged(launcher, 'launcher');
    deps.lockDown(launcher);
    loadQuery(launcher, { view: 'launcher' });
    launcher.on('blur', () => {
      if (!launcher?.webContents.isDevToolsOpened()) launcher?.hide();
    });
    launcher.on('closed', () => (launcher = null));
  }
  launcher.setBounds({ x: Math.round(d.workArea.x + (d.workArea.width - w) / 2), y: Math.round(d.workArea.y + d.workArea.height * 0.2), width: w, height: h });
  launcher.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  launcher.show();
  launcher.focus();
  launcher.webContents.send('event:launcher-shown');
}

/** Opens one tool: its own small window (default), or the main window for pages and when the person prefers. */
export function openTool(id: string) {
  if (!deps) return;
  const parsed = parseToolId(id);
  const tool = launcherTools((f) => featureOn(f)).find((t) => t.id === id);
  if (!parsed || !tool) return;
  remember(id);
  launcher?.hide();
  if (parsed.kind === 'page' || !monitorSettings().toolWindows) {
    const route = parsed.kind === 'page' ? parsed.ref : parsed.kind === 'convert' ? `convert:${JSON.stringify({ tool: parsed.ref })}` : `tools:${parsed.ref}`;
    deps.showMain(route);
    return;
  }
  const open = toolWins.get(id);
  if (open && !open.isDestroyed()) {
    open.show();
    open.focus();
    return;
  }
  const size = tool.size ?? { w: 560, h: 560 };
  const pt = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(pt).workArea;
  // Each new window steps down a little from the last, so they do not hide each other.
  const n = toolWins.size;
  const win = new BrowserWindow({
    width: size.w, height: size.h, minWidth: 360, minHeight: 300, show: false, title: `${tool.name} — Keeper`,
    x: Math.round(wa.x + (wa.width - size.w) / 2 + n * 24), y: Math.round(wa.y + (wa.height - size.h) / 3 + n * 24),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16161a' : '#f6f5f2',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: deps.preload, contextIsolation: true, sandbox: true, backgroundThrottling: true },
  });
  deps.lockDown(win);
  win.setMenuBarVisibility(false);
  loadQuery(win, { view: 'tool', id });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => toolWins.delete(id));
  toolWins.set(id, win);
}

export function openToolWindows(): string[] {
  return [...toolWins.keys()];
}

/** Registers the launcher's global shortcut. Call from the place that registers every shortcut (it clears them first). */
export function registerLauncherShortcut() {
  registered = '';
  const s = monitorSettings();
  if (!featureOn('toolLauncher') || !s.surfaces.launcher || !s.launcherShortcut) return;
  try {
    if (globalShortcut.register(s.launcherShortcut, toggleLauncher)) registered = s.launcherShortcut;
  } catch {
    /* taken or invalid */
  }
}

/** The shortcut that is really registered ('' when taken by another app or off). */
export function launcherShortcutActive(): string {
  return registered;
}

export function initLauncher(d: LauncherDeps) {
  deps = d;
  setStandardOutput((tool) => standardOutput((TOOL_INFO as Record<string, { label: string }>)[tool]?.label));
  const again = () => {
    if (registered) {
      try {
        globalShortcut.unregister(registered);
      } catch {
        /* already gone */
      }
    }
    registerLauncherShortcut();
  };
  onFeature('toolLauncher', (on) => {
    again();
    if (!on) {
      launcher?.destroy();
      launcher = null;
    }
  });
  onMonitorSettings((next, prev) => {
    if (next.launcherShortcut !== prev.launcherShortcut || next.surfaces.launcher !== prev.surfaces.launcher) again();
  });
}

// ---------------------------------------------------------------- standard output folder

/** Where a tool's results go under the person's output setting; undefined keeps the tool's usual place (next to the originals). */
export function standardOutput(label?: string): string | undefined {
  return standardOutputDir(monitorSettings().output, app.getPath('downloads'), label, new Date(), path.join, existsSync);
}
