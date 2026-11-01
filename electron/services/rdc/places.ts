// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote Desktops outside the page: the quick-connect window behind a global
// shortcut, the tray menu, .rdp/.vnc files from the file manager, and where
// live sessions open. What appears where is the person's choice (RdcPlaces).

import { app, BrowserWindow, Notification, screen } from 'electron';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeText, detectFormat, importText } from '../../../core/rdc/formats';
import { connectionFileFromArgv, DEFAULT_PLACES, fileMenuPlan, normalizePlaces, trayEntries, type RdcPlaces, type TrayEntry } from '../../../core/rdc/places';
import type { ConnectResult, Connection } from '../../../core/rdc/types';
import { run } from '../../../core/platform';
import { featureOn } from '../features';
import { keepUnmanaged, overlayOptions } from '../unmanaged';

export interface PlacesDeps {
  preload: string;
  /** show the main window, optionally on a page */
  showMain(route?: string): void;
  /** opens a page in a new tab of the main window (or a window of its own) */
  openTab(route: { name: string; arg?: string; q?: string }, ownWindow: boolean): void;
  connect(target: string | Connection, opts?: { external?: boolean; password?: string }): Promise<ConnectResult>;
  disconnect(sid: string): void;
  list(): Promise<{ connections: Connection[]; sessions: import('../../../core/rdc/types').RdcSession[] }>;
  /** what is in memory now (never waits: the tray menu is built from it) */
  snapshot(): { connections: Connection[]; sessions: import('../../../core/rdc/types').RdcSession[] };
  importConn(c: Omit<Connection, 'id' | 'created'>, secret?: string): Promise<Connection>;
}

let deps: PlacesDeps | null = null;
let places: RdcPlaces = { ...DEFAULT_PLACES };
let quickWin: BrowserWindow | null = null;
const trayListeners = new Set<() => void>();
const file = () => path.join(app.getPath('userData'), 'rdc', 'places.json');

export function onRdcTrayChange(fn: () => void) {
  trayListeners.add(fn);
  return () => trayListeners.delete(fn);
}

let trayTimer: NodeJS.Timeout | undefined;
export function rdcTrayChanged() {
  clearTimeout(trayTimer);
  trayTimer = setTimeout(() => trayListeners.forEach((f) => f()), 300);
}

/** Asks main.ts to register its shortcuts again (they are all re-registered together). */
let reRegister: (() => void) | null = null;
export function setShortcutRefresher(fn: () => void) { reRegister = fn; }

export async function loadPlaces(): Promise<RdcPlaces> {
  try { places = normalizePlaces(JSON.parse(await fsp.readFile(file(), 'utf8'))); } catch { places = { ...DEFAULT_PLACES }; }
  return places;
}

export const currentPlaces = () => places;

export async function setPlaces(patch: Partial<RdcPlaces>): Promise<RdcPlaces> {
  const before = places;
  places = normalizePlaces({ ...places, ...patch });
  await fsp.mkdir(path.dirname(file()), { recursive: true });
  await fsp.writeFile(file(), JSON.stringify(places, null, 1));
  if (before.shortcut !== places.shortcut || before.accelerator !== places.accelerator) reRegister?.();
  if (before.tray !== places.tray) rdcTrayChanged();
  if (before.files !== places.files) void fileMenu(places.files).catch(() => undefined);
  return places;
}

// ---------------------------------------------------------------- the quick-connect window

/** For main.ts's registerShortcuts: the quick-connect shortcut, while the feature and the place are on. */
export function rdcShortcut(): { accelerator: string; run: () => void } | null {
  if (!featureOn('remoteDesktops') || !places.shortcut) return null;
  return { accelerator: places.accelerator, run: () => showQuick() };
}

export function showQuick() {
  if (!deps) return;
  if (quickWin && !quickWin.isDestroyed()) {
    quickWin.show();
    quickWin.focus();
    return;
  }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = 580;
  const height = 420;
  quickWin = new BrowserWindow({
    ...overlayOptions('quickConnect'),
    width, height, x: Math.round(d.x + (d.width - width) / 2), y: Math.round(d.y + d.height * 0.18),
    frame: false, resizable: false, show: false, alwaysOnTop: true, skipTaskbar: true, title: 'Quick Connect — Keeper',
    backgroundColor: '#00000000', transparent: process.platform !== 'linux',
    webPreferences: { preload: deps.preload, contextIsolation: true, sandbox: true },
  });
  keepUnmanaged(quickWin, 'quickConnect');
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) void quickWin.loadURL(`${dev}?view=rdc-quick`);
  else void quickWin.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { view: 'rdc-quick' } });
  quickWin.once('ready-to-show', () => { quickWin?.show(); quickWin?.focus(); });
  // Gone when it loses focus, like the system's own launchers.
  quickWin.on('blur', () => { if (!process.env.KEEPER_E2E_KEEP_QUICK) quickWin?.close(); });
  quickWin.on('closed', () => { quickWin = null; });
}

export function closeQuick() {
  quickWin?.close();
}

/** After a connect: VNC and web consoles open in a tab (or their own window), as the person chose. */
export function openResult(r: ConnectResult) {
  if (!deps || !r.route) return;
  deps.openTab(r.route, places.sessions === 'window');
}

// ---------------------------------------------------------------- the tray

/** The tray's Remote Desktops items, built at once from what is in memory (never waits on files, the network or probes). */
export function rdcTrayItems(): Electron.MenuItemConstructorOptions[] {
  if (!deps || !featureOn('remoteDesktops')) return [];
  const st = deps.snapshot();
  const entries = trayEntries(st.connections, st.sessions, places);
  const say = (body: string) => Notification.isSupported() && new Notification({ title: 'Keeper', body }).show();
  const click = (e: Extract<TrayEntry, { label: string }>) => {
    const d = deps!;
    switch (e.action) {
      case 'quick': return showQuick();
      case 'page': return d.showMain('rdc');
      case 'disconnect': return d.disconnect(e.arg!);
      case 'show': return void d.list().then((st) => {
        const x = st.sessions.find((y) => y.id === e.arg);
        if (x) d.openTab(x.kind === 'terminal' ? { name: 'terminal', q: `session:${x.terminal}` } : { name: 'rdc', arg: x.kind === 'web' ? 'web' : 'vnc', q: x.id }, places.sessions === 'window' && x.kind !== 'terminal');
      });
      case 'connect': return void d.connect(e.arg!).then((r) => {
        // Questions (a password, a new host key) are asked on the page.
        if (r.needPassword || r.hostKey) d.openTab({ name: 'rdc', q: `connect:${e.arg}` }, false);
        else if (r.route) openResult(r);
        else if (r.session?.state === 'error') say(`${r.session.name}: ${r.session.error ?? 'did not connect'}`);
      }, (err: unknown) => say(err instanceof Error ? err.message : String(err)));
    }
  };
  const map = (e: TrayEntry): Electron.MenuItemConstructorOptions => ('separator' in e ? { type: 'separator' } : { label: e.label, enabled: e.enabled !== false, submenu: e.submenu?.map(map), click: e.submenu || !e.action ? undefined : () => click(e) });
  return entries.map(map);
}

/** The same menu as plain data, for the page's preview and for tests. */
export async function trayPreview(): Promise<TrayEntry[]> {
  if (!deps) return [];
  const st = deps.snapshot();
  return trayEntries(st.connections, st.sessions, places);
}

// ---------------------------------------------------------------- .rdp and .vnc files

/** Opens (or adds) a connection file; true when argv named one. */
export function handleRdcArgv(argv: string[]): boolean {
  const hit = connectionFileFromArgv(argv);
  if (!hit) return false;
  void openConnectionFile(hit.file, hit.action);
  return true;
}

export async function openConnectionFile(file: string, action: 'connect' | 'edit' = 'connect'): Promise<ConnectResult | null> {
  if (!deps) return null;
  const d = deps;
  try {
    if (!featureOn('remoteDesktops')) throw new Error('Remote Desktops are switched off (Settings → Features)');
    const text = decodeText(new Uint8Array(await fsp.readFile(file)));
    const fmt = detectFormat(text, file);
    const [it] = fmt ? importText(text, fmt, file) : [];
    if (!it) throw new Error(`${path.basename(file)} is not a connection file Keeper can read`);
    if (action === 'edit') {
      const c = await d.importConn(it.conn, it.secret);
      d.openTab({ name: 'rdc', q: `edit:${c.id}` }, false);
      return null;
    }
    const conn: Connection = { ...it.conn, id: `tmp-file-${Date.now().toString(36)}`, created: Date.now() };
    // A password the file carried (VNC files can) is used for this connection only.
    const r = await d.connect(conn, { password: it.secret });
    if (r.route) openResult(r);
    else if (r.needPassword || r.hostKey) {
      // Asked on the page: the file's connection is kept there until it opens.
      const c = await d.importConn(it.conn, it.secret);
      d.openTab({ name: 'rdc', q: `connect:${c.id}` }, false);
    } else if (r.session?.state === 'error' && Notification.isSupported()) new Notification({ title: conn.name, body: r.session.error ?? 'Did not connect' }).show();
    return r;
  } catch (e) {
    if (Notification.isSupported()) new Notification({ title: 'Keeper', body: e instanceof Error ? e.message : String(e) }).show();
    return null;
  }
}

/** "Connect with Keeper" in the file manager's right-click menu (per user, no administrator). */
export async function fileMenu(on: boolean): Promise<void> {
  const exe = process.env.APPIMAGE || process.execPath;
  const plan = fileMenuPlan(process.platform as 'linux', exe, os.homedir());
  if (process.platform === 'win32') {
    for (const args of plan.reg) {
      if (on) await run('reg', args);
    }
    if (!on) for (const ext of ['.rdp', '.vnc']) await run('reg', ['delete', `HKCU\\Software\\Classes\\SystemFileAssociations\\${ext}\\shell\\KeeperConnect`, '/f']);
    return;
  }
  for (const f of plan.files) {
    if (on) {
      await fsp.mkdir(path.dirname(f.path), { recursive: true });
      await fsp.writeFile(f.path, f.content, { mode: f.mode });
    } else await fsp.rm(f.path, { force: true });
  }
  if (process.platform === 'linux') {
    await run('update-mime-database', [path.join(os.homedir(), '.local', 'share', 'mime')], 10_000);
    await run('update-desktop-database', [path.join(os.homedir(), '.local', 'share', 'applications')], 10_000);
  }
}

// macOS sends files as events, also before the app is ready: those wait for initPlaces.
const early: string[] = [];
app.on('open-file', (e, f) => {
  if (!/\.(rdp|vnc)$/i.test(f)) return;
  e.preventDefault();
  if (deps) void openConnectionFile(f);
  else early.push(f);
});

export async function initPlaces(d: PlacesDeps) {
  deps = d;
  await loadPlaces();
  for (const f of early.splice(0)) void openConnectionFile(f);
  // Installed once while the place is on (cheap, idempotent); removed when it is switched off.
  if (places.files && featureOn('remoteDesktops') && app.isPackaged) void fileMenu(true).catch(() => undefined);
}
