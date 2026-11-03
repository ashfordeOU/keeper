// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper picks up where it was, whatever happens:
//
//   • every window's tabs, pages, scroll positions and unsent drafts are kept
//     in a checkpoint on disk (two generations with checksums, written within
//     a second of a change and again on quit);
//   • a page that crashes is reloaded once, with its tabs put back;
//   • a small watchdog process notices if Keeper itself stops unexpectedly and
//     starts it again (into safe mode after repeated crashes);
//   • crash reports stay on this computer (Settings → Keeper's processes).

import { errorText, ignorable, throttle } from '../core/quiet-errors';
import { app, BrowserWindow, crashReporter, dialog, ipcMain, nativeTheme, screen, shell, type WebContents } from 'electron';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeSync } from 'node:fs';
import path from 'node:path';
import { encodeCheckpoint, pickCheckpoint, recentCrashes } from '../core/checkpoint';
import { emptyWindow, sanitizeWindow, type SessionSnapshot, type WindowState } from '../core/session';
import { registerSvcIpc } from './svc';
import { instancePaths } from './instance';

declare const __KEEPER_OFFICIAL__: boolean | undefined;
const OFFICIAL_BUILD = typeof __KEEPER_OFFICIAL__ === 'boolean' ? __KEEPER_OFFICIAL__ : false;

// Crash reports are written locally only, never uploaded (start before the app is ready).
try {
  crashReporter.start({ uploadToServer: false, compress: true });
} catch {
  /* not available in this build */
}

const dir = () => path.join(app.getPath('userData'), 'session');
const genFile = (n: 0 | 1) => path.join(dir(), `session-${n}.json`);
const runningFile = () => path.join(dir(), 'running.json');
const crashesFile = () => path.join(dir(), 'crashes.json');
const logFile = () => path.join(dir(), 'log.jsonl');

export const SAFE_MODE = process.argv.includes('--safe-mode');

// ---------------------------------------------------------------- small, durable writes

function writeAtomic(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the log Keeper keeps about itself

export interface LogEntry { at: number; kind: string; detail: string }
let logCache: LogEntry[] | null = null;

/** Something went wrong, for crash reports (opt-in): what kind, where, and the error (never shown or logged from here). */
export type Problem =
  | { kind: 'exception' | 'rejection'; process: 'main'; error: unknown }
  | { kind: 'window-error'; process: string; text: string; stack?: string }
  | { kind: 'window-crash'; process: string; reason: string };
const problemListeners = new Set<(p: Problem) => void>();
/** Crash reports listen here; listeners must not throw (they are called while handling an error). */
export function onProblem(fn: (p: Problem) => void): () => void {
  problemListeners.add(fn);
  return () => problemListeners.delete(fn);
}
function problem(p: Problem) {
  for (const l of problemListeners) {
    try { l(p); } catch { /* a listener failing must never make it worse */ }
  }
}

export function logEvent(kind: string, detail: string) {
  const entry = { at: Date.now(), kind, detail: detail.slice(0, 2000) };
  const all = [...readLog(), entry].slice(-200);
  logCache = all;
  try {
    writeAtomic(logFile(), all.map((e) => JSON.stringify(e)).join('\n') + '\n');
  } catch {
    /* the log is best-effort */
  }
}

export function readLog(): LogEntry[] {
  if (logCache) return logCache;
  const t = readText(logFile()) ?? '';
  logCache = t.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as LogEntry]; } catch { return []; } });
  return logCache;
}

/** Crash dumps Chromium wrote (kept on this computer). */
export function crashDumps(): { name: string; at: number; size: number }[] {
  const out: { name: string; at: number; size: number }[] = [];
  const walk = (d: string, depth: number) => {
    let names: string[] = [];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      const p = path.join(d, n);
      try {
        const st = statSync(p);
        if (st.isDirectory() && depth < 3) walk(p, depth + 1);
        else if (n.endsWith('.dmp')) out.push({ name: n, at: st.mtimeMs, size: st.size });
      } catch { /* gone */ }
    }
  };
  try { walk(app.getPath('crashDumps'), 0); } catch { /* none */ }
  return out.sort((a, b) => b.at - a.at).slice(0, 50);
}

// ---------------------------------------------------------------- did Keeper stop unexpectedly last time?

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Read once at start: was the last run ended by something other than quitting? */
export const lastRun = (() => {
  const prev = (() => { try { return JSON.parse(readText(runningFile()) ?? 'null') as { pid: number; started: number } | null; } catch { return null; } })();
  const unclean = !!prev && prev.pid !== process.pid && !pidAlive(prev.pid);
  return { unclean, prevStarted: prev?.started ?? 0 };
})();

function markRunning() {
  try {
    writeAtomic(runningFile(), JSON.stringify({ pid: process.pid, started: Date.now() }));
  } catch { /* read-only profile */ }
}

/** Called on a normal quit: the next start is not treated as a crash. */
export function markCleanExit() {
  flushNow();
  try {
    writeAtomic(runningFile(), 'null');
  } catch { /* nothing to do */ }
}

// ---------------------------------------------------------------- the checkpoint

let snapshot: SessionSnapshot = { version: 1, savedAt: 0, windows: [] };
let gen = 0;
let writeTimer: NodeJS.Timeout | undefined;
let dirty = false;

function loadSnapshot() {
  const best = pickCheckpoint([readText(genFile(0)), readText(genFile(1))]);
  if (best) {
    snapshot = best.snapshot;
    gen = best.gen;
  }
}

function flushNow() {
  clearTimeout(writeTimer);
  if (!dirty) return;
  dirty = false;
  gen++;
  snapshot.savedAt = Date.now();
  try {
    // Alternate between two files: one of them is always whole.
    writeAtomic(genFile((gen % 2) as 0 | 1), encodeCheckpoint(snapshot, gen));
  } catch (e) {
    logEvent('checkpoint', `could not save the session: ${(e as Error).message}`);
  }
}

function saveWindow(w: WindowState) {
  const clean = sanitizeWindow(w, w.key);
  const i = snapshot.windows.findIndex((x) => x.key === clean.key);
  if (i >= 0) snapshot.windows[i] = clean;
  else snapshot.windows.push(clean);
  dirty = true;
  clearTimeout(writeTimer);
  // Within a second of any change, so a crash loses at most that second.
  writeTimer = setTimeout(flushNow, 700);
}

function dropWindow(key: string) {
  if (key === 'main') return;
  snapshot.windows = snapshot.windows.filter((w) => w.key !== key);
  dirty = true;
  flushNow();
}

/** What a window should open with. Restoring can be turned off (Settings → Reopen where I left off). */
function initialFor(key: string, restore: boolean): WindowState | null {
  if (!restore) return null;
  return snapshot.windows.find((w) => w.key === key) ?? null;
}

// ---------------------------------------------------------------- windows a tab was moved into

export interface ResilienceDeps {
  preload: () => string;
  lockDown: (w: BrowserWindow) => void;
  /** Reopen where I left off */
  restore: () => boolean;
  /** the main window, to send tabs back into */
  main: () => BrowserWindow | null;
}

let deps: ResilienceDeps;
const extraWindows = new Map<string, BrowserWindow>();
const pendingWindows = new Map<string, WindowState>();

/** Pages in windows of their own (electron/services/page-windows.ts), by session key ("page:mail"). */
const pageWindows = new Map<string, BrowserWindow>();

/**
 * The main window, its extra windows and page windows keep their place and drafts in the session
 * (a page window: what it shows and what was typed in it); small windows (the Island, widgets…) do not.
 */
function hasSession(wc: WebContents): boolean {
  const url = wc.getURL();
  return !/[?&]view=/.test(url) || /[?&]view=(app|page)\b/.test(url);
}

function keyOf(wc: WebContents): string {
  for (const [k, w] of extraWindows) if (!w.isDestroyed() && w.webContents === wc) return k;
  for (const [k, w] of pageWindows) if (!w.isDestroyed() && w.webContents === wc) return k;
  return 'main';
}

/**
 * A page window keeps its own session under "page:<page>", apart from the main window's tabs.
 * Closed by the person, it is forgotten (the next one starts fresh on its page); lost with Keeper
 * (a crash, an update), it opens with what it showed and what was typed the next time it opens.
 */
export function adoptPageWindow(page: string, win: BrowserWindow) {
  const key = `page:${page}`;
  pageWindows.set(key, win);
  win.on('closed', () => {
    if (pageWindows.get(key) === win) pageWindows.delete(key);
    if (!quittingNow) dropWindow(key);
  });
}

function openWindow(key: string, state?: WindowState) {
  if (state) pendingWindows.set(key, state);
  const b = state?.bounds;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const win = new BrowserWindow({
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    width: b?.width ?? 1100, height: b?.height ?? 760, x: b?.x ?? area.x + 60, y: b?.y ?? area.y + 60,
    minWidth: 760, minHeight: 520, show: false, title: 'Keeper',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111114' : '#f6f5f2',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ddd' : '#333', height: 52 },
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: { preload: deps.preload(), contextIsolation: true, sandbox: true },
  });
  deps.lockDown(win);
  const dev = process.env.VITE_DEV_SERVER_URL;
  // Automated tests can skip the first-run tour; official builds ignore this.
  const noTour = !OFFICIAL_BUILD && process.env.KEEPER_SKIP_TOUR === '1';
  if (dev) void win.loadURL(`${dev}?view=app&win=${key}${noTour ? '&notour=1' : ''}`);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { view: 'app', win: key, ...(noTour ? { notour: '1' } : {}) } });
  win.once('ready-to-show', () => win.show());
  const remember = () => { const s = snapshot.windows.find((w) => w.key === key); if (s && !win.isDestroyed()) saveWindow({ ...s, bounds: win.getBounds() }); };
  win.on('moved', remember);
  win.on('resized', remember);
  win.on('closed', () => {
    extraWindows.delete(key);
    // A window closed by the person is gone; one lost with Keeper comes back.
    if (!quittingNow) dropWindow(key);
  });
  extraWindows.set(key, win);
  return win;
}

let quittingNow = false;
export function setQuitting() {
  quittingNow = true;
}

/** Opens the windows that were open last time, beside the main window. */
export function restoreExtraWindows() {
  if (!deps.restore()) return;
  // Page windows open when their page is asked for again (a launcher, the menu), not at every start.
  for (const w of snapshot.windows) if (w.key !== 'main' && !w.key.startsWith('page:') && !extraWindows.has(w.key)) openWindow(w.key);
}

// ---------------------------------------------------------------- crashed or frozen pages

const recentRendererCrashes = new Map<string, number[]>();
/** windows reloaded after a crash: told so when they ask what to open with */
const reloadedKeys = new Set<string>();

function watchContents(wc: WebContents) {
  // Tab shortcuts reach the page before the default menu turns ⌘W into "close window".
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || input.alt) return;
    const url = wc.getURL();
    if (!/[?&]view=app\b/.test(url) && /[?&]view=/.test(url)) return;
    const mod = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
    const k = input.key.toLowerCase();
    if (!mod || (k !== 't' && k !== 'w') || (k === 'w' && input.shift)) return;
    e.preventDefault();
    wc.send('event:tab-key', { key: k, shift: input.shift });
  });
  wc.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit') return;
    const win = BrowserWindow.fromWebContents(wc);
    if (!win || win.isDestroyed()) return;
    const key = keyOf(wc);
    // Keeper's windows share one page process, so one crash stops them all at once: each is
    // counted on its own (the Island, Quick Search and widgets are not the main window).
    const view = /[?&]view=([^&#]+)/.exec(wc.getURL())?.[1] ?? 'app';
    const session = hasSession(wc);
    const countKey = session ? key : `${view}:${wc.id}`;
    logEvent('page-crashed', `${session ? key : view}: ${d.reason} (exit code ${d.exitCode})`);
    problem({ kind: 'window-crash', process: view === 'island' ? 'island' : view === 'widget' ? 'widgets' : 'window', reason: d.reason });
    const times = [...(recentRendererCrashes.get(countKey) ?? []), Date.now()].filter((t) => Date.now() - t < 60_000);
    recentRendererCrashes.set(countKey, times);
    if (times.length <= 1) {
      // Once: reload straight away; the checkpoint puts every tab back.
      flushNow();
      if (session) reloadedKeys.add(key);
      wc.reload();
      return;
    }
    void dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Reload', 'Close Window'], defaultId: 0, cancelId: 1,
      message: 'This Keeper window stopped working',
      detail: 'It stopped twice within a minute. Reloading opens your tabs where they were. Keeper’s other windows and background work are not affected.',
    }).then((r) => { if (r.response === 0) wc.reload(); else win.close(); });
  });
  const win = BrowserWindow.fromWebContents(wc);
  if (!win) return;
  let frozenTimer: NodeJS.Timeout | undefined;
  win.on('unresponsive', () => {
    frozenTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      logEvent('page-frozen', keyOf(wc));
      void dialog.showMessageBox(win, {
        type: 'warning', buttons: ['Wait', 'Reload'], defaultId: 0, cancelId: 0,
        message: 'This Keeper window is not responding',
        detail: 'Reloading puts your tabs back where they were.',
      }).then((r) => { if (r.response === 1 && !win.isDestroyed()) { flushNow(); wc.forcefullyCrashRenderer(); wc.reload(); } });
    }, 8000);
  });
  win.on('responsive', () => clearTimeout(frozenTimer));
}

// ---------------------------------------------------------------- the watchdog

/** The command that starts Keeper again (an AppImage restarts from its file, not its temporary mount). */
export function relaunchCommand(): string[] {
  if (process.env.APPIMAGE) return [process.env.APPIMAGE];
  // Debugging flags from a test runner or a developer are not carried over.
  const args = process.argv.slice(1).filter((a) => a !== '--safe-mode' && !a.startsWith('--remote-debugging') && !a.startsWith('--inspect') && a !== '--hidden');
  return [process.execPath, ...args, ...(process.env.KEEPER_WATCHDOG_EXTRA ? process.env.KEEPER_WATCHDOG_EXTRA.split(' ') : [])];
}

function startWatchdog() {
  // Installed copies always have one; development runs only when asked (tests use KEEPER_WATCHDOG=1).
  if (!(app.isPackaged || process.env.KEEPER_WATCHDOG === '1') || process.env.KEEPER_WATCHDOG === '0') return;
  const script = path.join(__dirname, 'watchdog.cjs');
  if (!existsSync(script)) return;
  try {
    const child = spawn(process.execPath, [script, JSON.stringify({ pid: process.pid, dir: dir(), cmd: relaunchCommand(), instance: instancePaths().file })], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    child.unref();
  } catch (e) {
    logEvent('watchdog', `could not start: ${(e as Error).message}`);
  }
}

/** Started by the watchdog after crashes: remember them, and say so once. */
function noteCrashOnStart() {
  if (!lastRun.unclean) return;
  let times: number[] = [];
  try { times = JSON.parse(readText(crashesFile()) ?? '[]') as number[]; } catch { /* first */ }
  times = [...times.filter((t) => Date.now() - t < 3600_000), Date.now()];
  try { writeAtomic(crashesFile(), JSON.stringify(times)); } catch { /* best-effort */ }
  logEvent('unexpected-exit', `Keeper stopped unexpectedly (started ${new Date(lastRun.prevStarted).toISOString()}); ${recentCrashes(times, Date.now())} time(s) in 5 minutes`);
}

// ---------------------------------------------------------------- wiring

export function initResilience(d: ResilienceDeps) {
  deps = d;
  loadSnapshot();
  noteCrashOnStart();
  markRunning();
  startWatchdog();
  if (SAFE_MODE) logEvent('safe-mode', 'started in safe mode: only the library is on');

  registerSvcIpc();
  app.on('web-contents-created', (_e, wc) => watchContents(wc));
  for (const w of BrowserWindow.getAllWindows()) watchContents(w.webContents);

  // The window asks what it should open with (synchronously, so the first frame is already right).
  ipcMain.on('session.initial', (e) => {
    // Only windows with tabs (the main window and its extra windows) have a session; the
    // Island, Quick Search and widgets start fresh and must not take the main window's state
    // (they reload together with it when their shared page process crashes).
    if (!hasSession(e.sender)) {
      e.returnValue = { key: 'view', state: null, crashed: false, safeMode: SAFE_MODE, reloaded: false };
      return;
    }
    const key = keyOf(e.sender);
    const pending = pendingWindows.get(key);
    pendingWindows.delete(key);
    const reloaded = reloadedKeys.delete(key);
    e.returnValue = {
      key,
      // A window reloaded after its page crashed always gets its tabs back.
      state: pending ?? initialFor(key, reloaded || deps.restore()),
      crashed: lastRun.unclean && !reloaded,
      safeMode: SAFE_MODE,
      reloaded,
    };
  });
  ipcMain.on('session.save', (e, w: WindowState) => { if (hasSession(e.sender)) saveWindow({ ...w, key: keyOf(e.sender) }); });
  ipcMain.handle('session.openWindow', (_e, w: WindowState) => {
    const key = `w${Date.now().toString(36)}`;
    openWindow(key, sanitizeWindow({ ...w, key }, key));
    return key;
  });
  ipcMain.handle('session.lastSession', () => snapshot.windows.length ? snapshot.savedAt : 0);
  ipcMain.handle('session.log', () => ({ log: readLog().slice().reverse(), dumps: crashDumps(), crashedLastTime: lastRun.unclean, safeMode: SAFE_MODE }));
  // Failures nobody caught: a window's, and the main process's own (logged, and shown once in the main window).
  ipcMain.handle('session.rendererError', (_e, view: string, text: string, stack?: string) => (problem({ kind: 'window-error', process: String(view) === 'island' ? 'island' : String(view).startsWith('widget') ? 'widgets' : 'window', text: String(text), stack: typeof stack === 'string' ? stack : undefined }), logEvent('renderer-error', `${String(view).slice(0, 30)}: ${String(text).slice(0, 300)}${stack ? `\n${String(stack).split('\n').slice(1, 4).join('\n')}` : ''}`)));
  const once = throttle(60_000);
  const report = (kind: string, e: unknown) => {
    if (ignorable(e)) return;
    const text = errorText(e);
    logEvent(kind, `${text}${e instanceof Error && e.stack ? `\n${e.stack.split('\n').slice(1, 4).join('\n')}` : ''}`);
    problem({ kind: kind === 'main-rejection' ? 'rejection' : 'exception', process: 'main', error: e });
    const w = deps.main();
    if (once(text) && w && !w.isDestroyed()) w.webContents.send('event:app-error', text);
  };
  process.on('unhandledRejection', (e) => report('main-rejection', e));
  process.on('uncaughtException', (e) => report('main-exception', e));
  ipcMain.handle('session.openDumps', () => shell.openPath(app.getPath('crashDumps')));
  ipcMain.handle('session.report', () => {
    const lines = [`Keeper ${app.getVersion()} on ${process.platform} ${process.arch}, Electron ${process.versions.electron}`, `Safe mode: ${SAFE_MODE}`, `Last run ended unexpectedly: ${lastRun.unclean}`, '', ...readLog().slice(-60).map((e) => `${new Date(e.at).toISOString()}  ${e.kind}  ${e.detail}`), '', `Crash dumps: ${crashDumps().length}`];
    return lines.join('\n');
  });
  ipcMain.handle('session.relaunch', (_e, safe: boolean) => {
    markCleanExit();
    app.relaunch({ args: [...process.argv.slice(1).filter((a) => a !== '--safe-mode'), ...(safe ? ['--safe-mode'] : [])] });
    app.exit(0);
  });

  // Starting fresh: a blank main window state when nothing was saved.
  if (!snapshot.windows.length) snapshot.windows.push(emptyWindow('main'));
  app.on('before-quit', () => { setQuitting(); flushNow(); });
  app.on('will-quit', () => markCleanExit());
}

/** For tests and the Processes page. */
export function sessionSnapshot(): SessionSnapshot {
  return snapshot;
}
