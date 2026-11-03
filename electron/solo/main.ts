// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A light app: Keeper started by an app icon (`Keeper --keeper-solo=mail`), running
// only what that part needs (core/solo.ts, docs/SOLO.md). Same program, settings,
// accounts, keychain and updates as Keeper; none of the library, the Island,
// widgets, the menu bar icon, the system monitor, sync, Keeper Link or the AI.
//
//   • Keeper (or a light app) is running already: the request is handed to it and
//     this start quits. Keeper opens the page in a window of its own.
//   • Light apps switched off (Settings → Features), safe mode, or a part of
//     Keeper still running (the Island or Mail outliving a crash): Keeper itself
//     starts instead, showing only this page's window, as before.
//   • Another app icon while this runs: its part is added here (one process).
//   • Keeper itself, a link or a page this light app does not have: the light app
//     saves, stops its services, lets go of its locks and starts Keeper, which
//     opens the same windows again.

// Must stay the first import: test runs move every folder before anything reads one.
import '../test-home';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, protocol, shell } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRAND } from '../../core/brand';
import { launcherDef, launcherPage, linuxWmClass } from '../../core/launchers';
import type { NavRoute } from '../../core/nav';
import { pageFromArgv, pageFromUrl, routeOfPage } from '../../core/page-window';
import { servicesToAdd, soloAppOfPage, soloAppUserModelId, soloFromArgv, soloPlan, soloRequestOf, soloStart, soloWindowTitle, takeOverArgs, type SoloService } from '../../core/solo';
import { PART_ROLES } from '../../core/suite';
import type { AllSettings } from '../../core/settings';
import { anotherKeeperTookOver, holdInstanceLock, releaseInstanceLock, runningInstance } from '../instance';
import { installNavGuard } from '../nav-guard';
import { featureOn } from '../services/features';
import { getSecret, hasSecret, onSettings, setSecret, settings, updateSettings } from '../store';
import { roleRunning } from '../suite/channel';

const first = soloFromArgv(process.argv)!;
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const isMac = process.platform === 'darwin';
declare const __KEEPER_OFFICIAL__: boolean | undefined;
const NO_TOUR = !(typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__) && process.env.KEEPER_SKIP_TOUR === '1';

// ---------------------------------------------------------------- light app, Keeper, or hand over?

const enabled = (() => { try { return featureOn('soloApps') && featureOn(launcherDef(first)!.feature); } catch { return true; } })();
const userData = app.getPath('userData');
const partRunning = enabled && !runningInstance() ? (await Promise.all(PART_ROLES.map((r) => roleRunning(userData, r).catch(() => false)))).some(Boolean) : false;
const how = soloStart({ app: first, running: !!runningInstance(), enabled, partRunning, safeMode: process.argv.includes('--safe-mode') });

/** Set when this start handed its request to a running Keeper (or light app) and quits. */
let handedOver = false;
/** This process is the light app (not Keeper itself, not a start that handed over). */
let isSolo = false;
if (how === 'hand-over' && anotherKeeperTookOver()) {
  handedOver = true;
  app.quit();
} else if (how === 'keeper' || (how === 'hand-over' && runningInstance())) {
  // Keeper itself, showing only this page's window (its own handling of --keeper-solo).
  await import('../main');
} else {
  // Not awaited: Electron holds back 'ready' until the main script has finished loading.
  void runSolo();
}

async function runSolo() {
  isSolo = true;
  // One copy of this program per data folder (Electron's lock), and one Keeper per person (instance.ts).
  if (!app.requestSingleInstanceLock()) {
    handedOver = true;
    app.quit();
    return;
  }
  holdInstanceLock((h) => (app.isReady() ? onLaterStart(h.argv) : app.once('ready', () => onLaterStart(h.argv))));
  app.on('second-instance', (_e, argv) => onLaterStart(argv));
  app.on('will-quit', () => releaseInstanceLock());

  const plan = soloPlan([first], featureOn);
  installNavGuard(path.join(__dirname, '..', 'dist'), DEV_URL);
  protocol.registerSchemesAsPrivileged([{ scheme: 'keeper-file', privileges: { stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: false, standard: false } }]);
  // Its windows share one page process, like Keeper's; and no network process of its own (the
  // services talk to the network from this process).
  if (process.env.KEEPER_SEPARATE_PAGES !== '1') app.commandLine.appendSwitch('process-per-site');
  app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2');
  // Pages that draw little need no graphics process: drawn in software here (Studio keeps the card
  // for recording and exporting). KEEPER_SOLO_GPU=1 gives every light app the card.
  if (!plan.gpu && process.env.KEEPER_SOLO_GPU !== '1') {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('in-process-gpu');
  }
  // Its own place in the Dock, the taskbar and the app menu where the system allows:
  // Windows groups windows by app ID (its Start menu shortcut carries the same one);
  // on Linux the window class matches the desktop entry's StartupWMClass.
  if (process.platform === 'win32') app.setAppUserModelId(soloAppUserModelId(first)!);
  // Linux takes the window class (X11) and app ID (Wayland) from the desktop entry Chromium is told
  // it runs as: the app icon's own (keeper-mail.desktop), so the dock shows it apart from Keeper.
  if (process.platform === 'linux') process.env.CHROME_DESKTOP = `${linuxWmClass(first)}.desktop`;
  app.setAsDefaultProtocolClient('keeper');
  app.on('open-url', (e, url) => {
    e.preventDefault();
    if (app.isReady()) onLaterStart([process.execPath, url]);
    else app.once('ready', () => onLaterStart([process.execPath, url]));
  });

  await app.whenReady();
  if (handedOver) return;
  await start(plan.apps);
}

// ---------------------------------------------------------------- the light app

const running = new Set<SoloService>();
const apps: string[] = [];
const stops: (() => Promise<unknown> | unknown)[] = [];
let openPageWindow: typeof import('../services/page-windows').openPageWindow;
let pageWindows: typeof import('../services/page-windows').pageWindows;
let quitting = false;

const preload = () => path.join(__dirname, 'preload.cjs');
const capturePreload = () => path.join(__dirname, 'capture-preload.cjs');
/** An app icon's own picture (build/launchers), for its windows and, on a Mac, the Dock. */
const iconOf = (app: string) => path.join(__dirname, '..', 'build', 'launchers', `keeper-${app}.png`);

function broadcast(channel: string, ...args: unknown[]) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(`event:${channel}`, ...args);
}

function lockDown(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!DEV_URL || !url.startsWith(DEV_URL)) e.preventDefault();
  });
}

function load(win: BrowserWindow, view: string, query: Record<string, string> = {}) {
  const extra: Record<string, string> = { ...query, solo: '1', ...(NO_TOUR ? { notour: '1' } : {}) };
  if (DEV_URL) void win.loadURL(`${DEV_URL}?${new URLSearchParams({ view, ...extra })}`);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { view, ...extra } });
}

/** An alert: there is no Island here, so a system notification that opens the page it is about. */
function notify(title: string, detail?: string, route?: string) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body: detail ?? '', silent: false });
  n.on('click', () => show(route ?? launcherPage(launcherDef(apps[0])!)));
  n.show();
}

/** A page (or a place in one: "calendar:2026-11-03"): here when one of this light app's, otherwise in Keeper. */
function show(route?: string) {
  const r = route ? routeFromText(route) : { name: launcherPage(launcherDef(apps[0])!) };
  if (!openPageWindow(r)) void handToKeeper(route ? [`--keeper-open=${r.name}`] : []);
}

function routeFromText(t: string): NavRoute {
  const i = t.indexOf(':');
  return i < 0 ? { name: t } : { name: t.slice(0, i), arg: t.slice(i + 1) };
}

/** The pages this light app has windows for. */
const ownPages = () => apps.map((a) => launcherPage(launcherDef(a)!));

async function start(list: string[]) {
  const { initResilience } = await import('../resilience');
  // Tabs and drafts survive a crash; the watchdog starts the light app again (it runs with the same command).
  initResilience({ preload, lockDown, restore: () => false, main: () => null });
  const { registerFileProtocol, registerPreviewIpc } = await import('../ipc/preview');
  registerFileProtocol();
  registerPreviewIpc();
  registerCommonIpc();
  const pw = await import('../services/page-windows');
  openPageWindow = pw.openPageWindow;
  pageWindows = pw.pageWindows;
  pw.registerPageWindows({
    preload, lockDown, load,
    own: (key) => {
      const a = soloAppOfPage(key);
      return a && apps.includes(a.page) ? { title: soloWindowTitle(a.page), icon: iconOf(a.page) } : undefined;
    },
    // A page another app icon has joins this light app; any other page needs Keeper.
    divert: (route, key) => {
      const a = soloAppOfPage(key);
      if (a && featureOn(a.feature)) {
        if (apps.includes(a.page)) return false;
        // Its services first, then its window (add opens it).
        void add(a.page, route);
        return true;
      }
      void handToKeeper([`--keeper-open=${key}`]);
      return true;
    },
  });
  Menu.setApplicationMenu(appMenu());
  if (isMac) {
    try { app.dock?.setIcon(nativeImage.createFromPath(iconOf(list[0]))); } catch { /* no Dock */ }
  }
  for (const a of list) await add(a);
  // Settings changed here reach the windows (look, theme, language).
  onSettings((next) => broadcast('settings-changed', next));
  // macOS: a click on the Dock icon with every window closed opens the first page again.
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().some((w) => w.isVisible())) show(); });
}

/** Adds one app icon's part (its services, once) and opens its window. */
async function add(appId: string, route?: NavRoute) {
  const l = launcherDef(appId);
  if (!l) return;
  if (!apps.includes(appId)) apps.push(appId);
  for (const s of servicesToAdd([...running], appId)) {
    running.add(s);
    try {
      await startService(s);
    } catch (e) {
      console.error('[solo] could not start', s, e);
    }
  }
  openPageWindow(route ?? { name: launcherPage(l) });
}

async function startService(s: SoloService) {
  if (s === 'pim') {
    const { registerPimWindowIpc } = await import('../ipc/pim-window');
    const pim = await import('../services/pim');
    registerPimWindowIpc();
    await pim.startPim({
      broadcast,
      alert: (title, detail, kind, ref) => notify(title, detail, kind === 'mail' && ref ? `mail:${ref}` : undefined),
      badge: (n) => { try { app.setBadgeCount(n); } catch { /* not on this desktop */ } },
      // No Island here: its views of mail and calendars wait for Keeper.
      islandEvents: () => undefined,
      islandTimers: () => undefined,
      show: (route) => show(route),
      islandCalendarUrl: () => settings().island.calendarUrl,
    });
    stops.push(() => pim.stopPim());
  } else if (s === 'notes') {
    const { registerNotesIpc } = await import('../ipc/notes');
    const { registerJournalIpc } = await import('../ipc/journal');
    const { allowRoot } = await import('../services/preview');
    registerNotesIpc({ broadcast, allowRoot });
    registerJournalIpc();
  } else if (s === 'terminal') {
    const t = await import('../ipc/terminal');
    t.registerTerminalIpc({ preload: preload(), alert: (title, detail) => notify(title, detail), getSecret, setSecret });
    stops.push(() => t.stopTerminal());
  } else if (s === 'rdc') {
    const { registerRdcIpc } = await import('../ipc/rdc');
    registerRdcIpc({
      broadcast, preload: preload(), showMain: (route) => show(route),
      // A session opens in the Remote Desktops window (as a tab there).
      openTab: (route, ownWindow) => {
        openPageWindow({ name: 'rdc' });
        const w = pageWindows().get('rdc');
        if (w) setTimeout(() => w.webContents.send('event:navigate-tab', { ...route, window: ownWindow }), w.webContents.isLoading() ? 800 : 0);
      },
    });
    const rdc = await import('../services/rdc');
    stops.push(() => rdc.stopRdc());
  } else if (s === 'studio') {
    const st = await import('../ipc/studio');
    st.registerStudioIpc({
      preload: preload(), capturePreload: capturePreload(), broadcast, show: (route) => show(route),
      load: async (win, query) => {
        lockDown(win);
        if (DEV_URL) await win.loadURL(`${DEV_URL}?${new URLSearchParams(query)}`);
        else await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
      },
      alert: (title, detail) => notify(title, detail),
      // No Island, tray, Stage or library here: the recording shows in Studio's own window.
      recording: () => undefined,
      updateTray: () => undefined,
      stage: async () => undefined,
      added: () => undefined,
      reregister: () => undefined,
      minimize: () => undefined,
    });
    stops.push(() => st.stopStudio());
  } else if (s === 'library') {
    const lib = await import('./library');
    stops.push(await lib.startLibrary({ broadcast }));
  }
}

/** What every page needs: settings, features, a few system calls, and this light app itself. */
function registerCommonIpc() {
  const handle = (name: string, fn: (...args: never[]) => unknown) => ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
  handle('system.info', () => ({ platform: process.platform, arch: process.arch, osVersion: os.release(), appVersion: app.getVersion(), home: os.homedir(), sep: path.sep }));
  handle('system.openExternal', async (url: string) => {
    if (url.startsWith('keeper://')) return onLaterStart([process.execPath, url]);
    if (/^(https?|mailto):/.test(url)) await shell.openExternal(url);
  });
  handle('settings.get', () => settings());
  handle('settings.set', (patch: Partial<AllSettings>) => updateSettings(patch));
  handle('settings.setSecret', (name: string, value: string) => setSecret(name, value));
  handle('settings.hasSecret', (name: string) => hasSecret(name));
  ipcMain.handle('settings.pickFolder', async (e) => {
    const owner = BrowserWindow.fromWebContents(e.sender);
    const r = owner ? await dialog.showOpenDialog(owner, { properties: ['openDirectory', 'createDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  void import('../services/features').then((f) => {
    handle('features.list', () => f.listFeatures());
    handle('features.set', (id: string, on: boolean) => f.setFeature(id, on));
    f.onFeaturesChanged(() => broadcast('features-changed'));
  });
  void import('../services/native-apps').then((n) => {
    handle('native.open', (kind: unknown, params: unknown) => n.nativeOpen(kind, params));
    handle('native.apps', (refresh?: boolean) => n.nativeApps(!!refresh));
  });
  void import('../ipc/permissions').then((p) => p.registerPermissionsIpc());
  handle('solo.info', () => ({ apps: [...apps], names: apps.map((a) => soloWindowTitle(a)) }));
  handle('solo.openKeeper', (route?: string) => handToKeeper(typeof route === 'string' && route ? [`--keeper-open=${route.split(':')[0]}`] : []));
}

/** The usual menus, with Open Keeper (Keeper takes over these windows). */
function appMenu(): Menu {
  const openKeeper: Electron.MenuItemConstructorOptions = { label: `Open ${BRAND}`, click: () => void handToKeeper([]) };
  return Menu.buildFromTemplate([
    ...(isMac ? [{
      label: soloWindowTitle(first),
      submenu: [
        openKeeper,
        { type: 'separator' as const },
        { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const, label: `Quit ${soloWindowTitle(first)}` },
      ],
    }] : [{ label: 'File', submenu: [openKeeper, { type: 'separator' as const }, { role: 'quit' as const }] }]),
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]);
}

// ---------------------------------------------------------------- later starts, and handing over

/** Another start of Keeper while this light app runs (an app icon, Keeper itself, a link…). */
function onLaterStart(argv: string[]) {
  if (quitting) return;
  const req = soloRequestOf(argv, (a) => pageFromArgv(a) ?? pageFromUrl(a.find((x) => x.startsWith('keeper://')) ?? ''));
  if (req.kind === 'add' && featureOn(launcherDef(req.app)!.feature)) {
    const page = pageFromArgv(argv) ?? pageFromUrl(argv.find((x) => x.startsWith('keeper://')) ?? '');
    const route = page ? routeOfPage(page) ?? undefined : undefined;
    void add(req.app, route);
    return;
  }
  void handToKeeper(argsOf(argv));
}

/** A later start's own arguments: without the program, and without a development copy's folder. */
function argsOf(argv: string[]): string[] {
  const appPath = app.getAppPath();
  return argv.slice(1).filter((a) => path.resolve(a) !== appPath && a !== '.');
}

/**
 * Keeper itself takes over: the windows' places are saved, the services stop (Mail saves what
 * it was doing), the locks are let go, and Keeper starts with the request and the pages that were
 * open here, which it opens again. This process then quits: never two with the same services.
 */
async function handToKeeper(request: string[]) {
  if (quitting) return;
  quitting = true;
  const { setQuitting, markCleanExit } = await import('../resilience');
  setQuitting();
  const pages = pageWindows ? [...pageWindows().keys()].filter((k) => ownPages().includes(k)) : [];
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.close();
  await Promise.race([Promise.allSettled(stops.map((s) => s())), new Promise((r) => setTimeout(r, 4000))]);
  markCleanExit();
  releaseInstanceLock();
  app.releaseSingleInstanceLock();
  // Debugging flags from a test runner stay with this process.
  const keep = process.argv.slice(1).filter((a) => /^--(user-data-dir|no-sandbox|enable-logging)/.test(a) && !request.some((r) => r.split('=')[0] === a.split('=')[0]));
  const exe = process.env.APPIMAGE || process.execPath;
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), ...keep, ...takeOverArgs(request, pages)];
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_DESKTOP;
  try {
    spawn(exe, args, { detached: true, stdio: 'ignore', env, cwd: existsSync(os.homedir()) ? os.homedir() : undefined }).unref();
  } catch (e) {
    console.error('[solo] could not start Keeper', (e as Error).message);
  }
  app.exit(0);
}

// A light app quits when its last window closes (on a Mac it stays in the Dock until quit, like any app).
app.on('window-all-closed', () => {
  if (handedOver || quitting || (isMac && !process.env.KEEPER_SOLO_QUIT_ON_CLOSE)) return;
  if (isSolo) app.quit();
});

app.on('before-quit', (e) => {
  if (!isSolo || handedOver || quitting || !stops.length) return;
  e.preventDefault();
  quitting = true;
  void Promise.race([Promise.allSettled(stops.map((s) => s())), new Promise((r) => setTimeout(r, 3000))]).finally(() => app.exit(0));
});
