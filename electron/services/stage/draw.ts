// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Draw on screen: one see-through sheet per screen, over every app, while the
// person draws; the screen with the pointer has the tool bar. Nothing exists
// until the shortcut is pressed, and everything is gone when drawing ends
// (Esc, Done, or the shortcut again). A screen recording (Studio, or any other
// recorder) picks the ink up like anything else on screen.

import { app, BrowserWindow, screen } from 'electron';
import { drawHtml, normalizeDrawSettings, type DrawConfig, type DrawSettings } from '../../../core/stage/draw';
import { onFloat } from '../floats';
import { keepUnmanaged, overlayOptions } from '../unmanaged';

const isMac = process.platform === 'darwin';
const sheets = new Map<number, BrowserWindow>();
const ready = new Map<number, Promise<void>>();
let current: DrawSettings | null = null;
let save: ((patch: Partial<DrawSettings>) => void) | null = null;
let changed: ((on: boolean) => void) | null = null;

/** The shortcut as the person sees it ("⌃⌥⇧D" on a Mac, "Ctrl+Alt+Shift+D" elsewhere). */
export function shortcutLabel(acc: string): string {
  if (!acc) return 'Esc';
  if (!isMac) return acc.replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl');
  const map: Record<string, string> = { CommandOrControl: '⌘', CmdOrCtrl: '⌘', Command: '⌘', Cmd: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧' };
  return acc.split('+').map((k) => map[k] ?? k).join('');
}

async function exec(w: BrowserWindow | undefined, js: string): Promise<unknown> {
  if (!w || w.isDestroyed()) return undefined;
  await ready.get(w.id);
  if (w.isDestroyed()) return undefined;
  return w.webContents.executeJavaScript(js, true).catch(() => undefined);
}

function sheetFor(d: Electron.Display, cfg: DrawSettings, withBar: boolean, preload: string): BrowserWindow {
  const w = new BrowserWindow({
    ...overlayOptions('stage'),
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    transparent: true, frame: false, resizable: false, movable: false, hasShadow: false, show: false,
    alwaysOnTop: true, enableLargerThanScreen: true, backgroundColor: '#00000000',
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
  });
  keepUnmanaged(w, 'stage');
  w.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  const conf: DrawConfig = { colors: cfg.colors, color: cfg.color, tool: cfg.tool, width: cfg.width, fade: cfg.fade, fadeSeconds: cfg.fadeSeconds, toolbar: withBar, mac: isMac, shortcutLabel: shortcutLabel(cfg.shortcut) };
  onFloat(w, (action, arg) => {
    if (action === 'exit') void setDrawing(false);
    // The tool bar's choices are remembered for next time.
    else if (action === 'tool' && typeof arg === 'string') remember({ tool: arg as DrawSettings['tool'] });
    else if (action === 'color' && typeof arg === 'string') remember({ color: arg });
    else if (action === 'width' && typeof arg === 'number') remember({ width: arg });
    else if (action === 'fade' && typeof arg === 'boolean') remember({ fade: arg });
  });
  ready.set(w.id, w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(drawHtml())}`)
    .then(() => w.webContents.executeJavaScript(`window.draw.config(${JSON.stringify(conf)})`, true))
    .then(() => undefined, () => undefined));
  return w;
}

function remember(patch: Partial<DrawSettings>) {
  if (!current) return;
  current = normalizeDrawSettings({ ...current, ...patch });
  save?.(patch);
}

export function drawing(): boolean {
  return sheets.size > 0;
}

/** Wiring from Stage: where the settings are kept and who hears when drawing starts and ends. */
export function setDrawHooks(h: { save: (patch: Partial<DrawSettings>) => void; changed: (on: boolean) => void }) {
  save = h.save;
  changed = h.changed;
}

/** Starts drawing on every screen (true), ends it (false); returns whether it is on. */
export async function setDrawing(on: boolean, cfg?: DrawSettings, preload?: string): Promise<boolean> {
  if (!on) {
    if (!sheets.size) return false;
    for (const w of sheets.values()) if (!w.isDestroyed()) w.destroy();
    sheets.clear();
    ready.clear();
    changed?.(false);
    return false;
  }
  if (sheets.size) return true;
  if (!cfg || !preload) return false;
  current = cfg;
  const here = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  for (const d of screen.getAllDisplays()) sheets.set(d.id, sheetFor(d, cfg, d.id === here.id, preload));
  await Promise.all([...sheets.values()].map((w) => ready.get(w.id)));
  for (const [id, w] of sheets) {
    if (w.isDestroyed()) continue;
    if (id === here.id) {
      // The sheet under the pointer takes the keys (Esc, Undo, the tool keys).
      if (isMac) app.focus({ steal: true });
      w.show();
      w.focus();
    } else w.showInactive();
  }
  changed?.(true);
  return true;
}

export async function toggleDrawing(cfg: DrawSettings, preload: string): Promise<boolean> {
  return setDrawing(!drawing(), cfg, preload);
}

/** What each sheet holds now (the end-to-end test and diagnostics read this). */
export async function drawState(): Promise<{ on: boolean; sheets: { display: number; state: unknown }[] }> {
  const out: { display: number; state: unknown }[] = [];
  for (const [id, w] of sheets) out.push({ display: id, state: await exec(w, 'window.draw && window.draw.state()') });
  return { on: drawing(), sheets: out };
}

/** For the end-to-end test: the sheet under the pointer, to send it keys and strokes. */
export function drawWindows(): BrowserWindow[] {
  return [...sheets.values()].filter((w) => !w.isDestroyed());
}
