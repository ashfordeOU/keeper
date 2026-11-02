// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A part of Keeper in a process of its own: `Keeper --keeper-role=island`,
// `--keeper-role=widgets` or `--keeper-role=mail` (docs/SUITE.md). The Island and
// widgets own only their windows: what they ask for (window.keeper.*) is
// answered by the app over the suite channel, and the events the app sends its
// windows reach these windows too. Mail and calendars has no windows: it runs
// mail sync, send later, snoozes and alerts here, and the app asks it.
//
//   • one copy per part (its own lock), no Dock icon, its own Chromium storage;
//   • if the app stops, the part carries on (the windows stay as they are) and
//     reconnects when the app is back (the watchdog starts it again); window
//     calls made meanwhile wait a little, then fail politely;
//   • if the app does not come back (Force Quit on a Mac), the part stays; the
//     next time a person uses one of its windows, Keeper is started again;
//   • a normal quit of Keeper (and an update) closes every part.

// Must stay the first import: test runs move every folder before anything reads one.
import '../test-home';
import { app, BrowserWindow, ipcMain, nativeImage, shell, webContents } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { EXIT_ALREADY_RUNNING, ORPHAN_GRACE_MS, roleOf, type PartRole, type SenderInfo, type SuiteMessage } from '../../core/suite';
import type { AllSettings } from '../../core/settings';
import { installNavGuard } from '../nav-guard';
import { adoptSettings, setSettingsWriter, settings } from '../store';
import { ownUsage } from './metrics';
import { connect, readCoreInfo, suiteDir, takeRoleLock, type CoreInfo, type Peer } from './channel';

const role = roleOf(process.argv) as PartRole;
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const userData = app.getPath('userData');

// Chromium keeps its own storage (local storage, caches) per profile, and two
// processes must never share one: each part has its own beside the app's.
app.setPath('sessionData', path.join(userData, 'Parts', role));
// Small windows that draw little: no graphics process of their own (KEEPER_PART_GPU=1 gives them one).
if (process.env.KEEPER_PART_GPU !== '1') {
  app.disableHardwareAcceleration();
  // Drawn in software inside this process, rather than in a graphics process of its own.
  app.commandLine.appendSwitch('in-process-gpu');
}
// No separate network process either: a part only ever talks to the app.
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2');
installNavGuard(path.join(__dirname, '..', 'dist'), DEV_URL);
declare const __KEEPER_OFFICIAL__: boolean | undefined;
// Tests only (never official builds): a fixed debugging port per part, so a test can drive its windows.
const cdpBase = Number(process.env.KEEPER_PART_CDP_PORT_BASE);
if (!(typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__) && cdpBase > 0 && role !== 'mail') app.commandLine.appendSwitch('remote-debugging-port', String(cdpBase + (role === 'island' ? 0 : 1)));
// Only Keeper itself has a Dock icon and an entry in the app switcher.
try { if (process.platform === 'darwin') app.setActivationPolicy('accessory'); } catch { /* before launch on older systems */ }

const lock = await takeRoleLock(userData, role);
if (!lock) {
  // Another copy of this part is running already: it is the one the app talks to.
  app.exit(EXIT_ALREADY_RUNNING);
}

const preload = path.join(__dirname, 'preload.cjs');

function lockDown(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!DEV_URL || !url.startsWith(DEV_URL)) e.preventDefault();
  });
}

// ---------------------------------------------------------------- the channel to the app

let peer: Peer | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
/** Calls made while the app is away wait for it (a crashed app is back within seconds). */
const waiting: (() => void)[] = [];
const forwarded = new Set<string>();
const forwardedSends = new Set<string>();
const local = new Set<string>();
let orphanTimer: NodeJS.Timeout | undefined;
let welcomed = false;

// Every handler this part registers itself is answered here; everything else goes to the app.
const origHandle = ipcMain.handle.bind(ipcMain);
(ipcMain as { handle: unknown }).handle = (channel: string, fn: (...a: never[]) => unknown) => {
  local.add(channel);
  if (forwarded.has(channel)) { ipcMain.removeHandler(channel); forwarded.delete(channel); }
  origHandle(channel, fn as never);
};

const senderOf = (wc: Electron.WebContents): SenderInfo => ({ id: wc.id, url: wc.getURL() });

function whenConnected(ms: number): Promise<Peer> {
  if (peer && welcomed) return Promise.resolve(peer);
  if (Date.now() - lastInput < 5000) wakeKeeper();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { const i = waiting.indexOf(go); if (i >= 0) waiting.splice(i, 1); reject(new Error('Keeper is starting again; try once more in a moment')); }, ms);
    const go = () => { clearTimeout(t); resolve(peer!); };
    waiting.push(go);
  });
}

async function call(channel: string, args: unknown[], sender?: SenderInfo): Promise<unknown> {
  const p = await whenConnected(15_000);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    // Generous: some of Keeper's calls read files or ask the network.
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Keeper did not answer ${channel}`)); }, 120_000);
    pending.set(id, { resolve, reject, timer });
    p.send({ t: 'call', id, channel, args, sender });
  });
}

function forward(channels: string[], sends: string[]) {
  for (const ch of channels) {
    if (local.has(ch) || forwarded.has(ch)) continue;
    forwarded.add(ch);
    origHandle(ch, (e, ...args) => call(ch, args, senderOf(e.sender)));
  }
  for (const ch of sends) {
    if (forwardedSends.has(ch) || ipcMain.listenerCount(ch) > 0) continue;
    forwardedSends.add(ch);
    ipcMain.on(ch, (e, ...args) => { peer?.send({ t: 'send', channel: ch, args, sender: senderOf(e.sender) }); });
  }
}

function deliver(channel: string, args: unknown[], to?: number) {
  if (channel === 'event:settings-changed' && args[0]) adoptSettings(args[0] as AllSettings);
  const targets = to ? [webContents.fromId(to)].filter(Boolean) : BrowserWindow.getAllWindows().map((w) => w.webContents);
  for (const wc of targets) if (wc && !wc.isDestroyed()) wc.send(channel, ...args);
}

type Commands = Record<string, (...args: never[]) => unknown>;
let commands: Commands = {};

/** Tells the app something, if it is there (what must not be missed is kept and said again on reconnecting). */
function note(name: string, args: unknown[]) {
  if (peer && welcomed) peer.send({ t: 'note', name, args });
}

async function onMessage(m: SuiteMessage, onWelcome: () => void) {
  switch (m.t) {
    case 'welcome':
      adoptSettings(m.settings as AllSettings);
      forward(m.channels, m.sends);
      welcomed = true;
      everWelcomed = true;
      awaySince = 0;
      clearTimeout(orphanTimer);
      onWelcome();
      for (const go of waiting.splice(0)) go();
      break;
    case 'denied':
      peer?.close();
      break;
    case 'channels':
      forward(m.channels, m.sends);
      break;
    case 'result': {
      const p = pending.get(m.id);
      if (!p) break;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.value);
      else p.reject(new Error(m.error));
      break;
    }
    case 'event':
      deliver(m.channel, m.args, m.to);
      break;
    case 'cmd': {
      const fn = m.name === 'quit' ? () => setTimeout(() => app.quit(), 10) : m.name === 'metrics' ? () => ownUsage() : commands[m.name];
      if (!fn) { peer?.send({ t: 'result', id: m.id, ok: false, error: `unknown command ${m.name}` }); break; }
      try {
        peer?.send({ t: 'result', id: m.id, ok: true, value: (await fn(...(m.args as never[]))) ?? null });
      } catch (e) {
        peer?.send({ t: 'result', id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      break;
    }
    case 'ping':
      peer?.send({ t: 'pong' });
      break;
    default:
      break;
  }
}

/** Connects to the app (again and again while it is away) and says who this is. */
async function connectLoop(onWelcome: () => void) {
  let wait = 300;
  for (;;) {
    const info = readCoreInfo(userData);
    if (info) {
      lastCore = info;
      try {
        const p = await connect(info.socket);
        peer = p;
        welcomed = false;
        p.onMessage((m) => void onMessage(m, onWelcome));
        p.send({ t: 'hello', role, token: info.token, pid: process.pid, version: app.getVersion() });
        wait = 300;
        await p.closedP;
        if (peer === p) peer = null;
        welcomed = false;
        for (const x of pending.values()) { clearTimeout(x.timer); x.reject(new Error('Keeper stopped while answering')); }
        pending.clear();
        orphaned();
      } catch {
        /* not there (yet) */
      }
    }
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(2000, wait * 2);
  }
}

let everWelcomed = false;
let awaySince = 0;
let lastCore: CoreInfo | null = null;
let wokeAt = 0;
/** When a person last clicked or typed in one of this part's windows (its pages also ask on their own, on timers). */
let lastInput = 0;
app.on('web-contents-created', (_e, wc) => {
  wc.on('input-event', (_ev, input) => {
    if (input.type !== 'mouseDown' && input.type !== 'keyDown' && input.type !== 'rawKeyDown') return;
    lastInput = Date.now();
    if (!welcomed) wakeKeeper();
  });
});
/** Keeper's program as this part started: an update or an uninstall changes or removes it. */
const exeStamp = (() => { try { return statSync(process.execPath).mtimeMs; } catch { return 0; } })();

/**
 * The app is gone. A part it never welcomed (started by hand, or the app went before
 * answering), or one of a development run without a watchdog, does not linger. One it did stays, whatever happened to the app: the
 * watchdog starts a crashed Keeper again, and after a Force Quit on a Mac (not started
 * again) the Island and widgets stay on screen and Mail keeps sending what was
 * scheduled. It only closes when Keeper's program itself changed or went away
 * (updated or uninstalled while the app was not there to say so).
 */
function orphaned() {
  clearTimeout(orphanTimer);
  awaySince ||= Date.now();
  const grace = Number(process.env.KEEPER_PART_GRACE_MS) || ORPHAN_GRACE_MS;
  // A development run without a watchdog has nothing that would bring the app back: do not linger there either.
  const looked = app.isPackaged || process.env.KEEPER_WATCHDOG === '1';
  if (!everWelcomed || !looked) {
    orphanTimer = setTimeout(() => { if (!welcomed) app.quit(); }, grace);
    return;
  }
  const look = () => {
    if (welcomed) return;
    let now = 0;
    try { now = statSync(process.execPath).mtimeMs; } catch { /* removed */ }
    if (now !== exeStamp) return app.quit();
    orphanTimer = setTimeout(look, grace);
  };
  orphanTimer = setTimeout(look, grace);
}

/** Stopped on purpose (the watchdog's note after a Force Quit on a Mac)? */
function appStoppedOnPurpose(): boolean {
  try {
    const r = JSON.parse(readFileSync(path.join(suiteDir(userData), 'app-stopped.json'), 'utf8')) as { at?: number };
    return (r.at ?? 0) >= awaySince - 30_000;
  } catch {
    return false;
  }
}

/**
 * A person clicked or typed in one of this part's windows while Keeper is away: start it again,
 * unless it is on its way back already (the watchdog restarts a crash within seconds).
 */
function wakeKeeper() {
  if (role === 'mail' || !everWelcomed || !awaySince || Date.now() - wokeAt < 30_000) return;
  if (!appStoppedOnPurpose() && Date.now() - awaySince < 20_000) return;
  const cmd = lastCore?.cmd;
  if (!cmd?.length) return;
  wokeAt = Date.now();
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.KEEPER_PART_OF;
  try {
    spawn(cmd[0], cmd.slice(1), { detached: true, stdio: 'ignore', env }).unref();
  } catch (e) {
    console.error('[suite] could not start Keeper', (e as Error).message);
  }
}

// ---------------------------------------------------------------- the part itself

async function startIsland() {
  const isl = await import('../ipc/island');
  isl.registerIslandWindowIpc({ preload, lockDown });
  // A file dragged out of the shelf: the drag starts from the window it left.
  ipcMain.on('files.startDrag', (e, paths: string[]) => {
    const list = (paths ?? []).filter((p) => typeof p === 'string' && existsSync(p));
    if (!list.length) return;
    const icon = nativeImage.createFromPath(list[0]);
    e.sender.startDrag({ file: list[0], files: list, icon: icon.isEmpty() ? nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=') : icon.resize({ width: 64 }) });
  });
  commands = {
    ensure: (reposition: boolean) => isl.islandWindows.ensure(!!reposition),
    setHidden: (hidden: boolean) => isl.islandWindows.setHidden(!!hidden),
    openOn: (tab: string) => isl.islandWindows.openOn(String(tab ?? 'home')),
    openClips: () => isl.openClips(),
    hideClips: () => isl.hideClips(),
    toggleClips: () => isl.toggleClips(),
    count: () => isl.islandWindows.count(),
  };
  return () => isl.islandWindows.ensure(true);
}

async function startWidgets() {
  const w = await import('../ipc/widgets');
  const broadcast = (channel: string, ...args: unknown[]) => deliver(`event:${channel}`, args);
  w.registerWidgetWindowIpc({ preload, lockDown, broadcast });
  commands = {
    sync: () => w.syncWidgets(),
    state: (s: { arranging?: boolean; tint?: string | null }) => w.applyWidgetsState(s ?? {}),
    count: () => w.widgetWindowCount(),
  };
  return () => w.syncWidgets();
}

async function startMail() {
  const m = await import('../services/pim');
  const { pimTools } = await import('../services/pim/brain-adapter');
  // The Island's views of mail and calendars: kept, and said again whenever the app (re)connects.
  const last = new Map<string, unknown[]>();
  const keep = (name: string, args: unknown[]) => { last.set(name, args); note(name, args); };
  // Passwords that live only in memory (no keychain) survive a restart of this process in the app.
  const secrets = await import('../services/pim/store');
  secrets.restoreMemorySecrets(await call('suite:mail.secrets', []).catch(() => null) as Record<string, string> | null);
  secrets.onMemorySecrets((all) => keep('secrets', [all]));
  await m.startPim({
    broadcast: (channel, ...args) => note('broadcast', [channel, ...args]),
    alert: (...args) => note('alert', args),
    islandReminders: (list) => keep('islandReminders', [list]),
    islandEvents: (evs) => keep('islandEvents', [evs]),
    islandTimers: (t) => keep('islandTimers', [t]),
    show: (route) => note('show', [route]),
    islandCalendarUrl: () => settings().island.calendarUrl,
    // Open and save pickers belong to the window the person is using, in the app.
    dialogs: {
      open: (o, none) => call('suite:dialog.open', [o, none]) as Promise<Electron.OpenDialogReturnValue>,
      save: (o, none) => call('suite:dialog.save', [o, none]) as Promise<Electron.SaveDialogReturnValue>,
    },
  });
  app.on('will-quit', (e) => {
    if (mailStopped) return;
    e.preventDefault();
    mailStopped = true;
    void Promise.race([m.stopPim(), new Promise((r) => setTimeout(r, 2000))]).finally(() => app.quit());
  });
  const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k) && typeof (o as Record<string, unknown>)[k] === 'function';
  commands = {
    pim: (method: string, args: unknown[]) => {
      if (!own(m.pim, method)) throw new Error(`unknown mail call ${method}`);
      return (m.pim as unknown as Record<string, (...a: unknown[]) => unknown>)[method](...(args ?? []));
    },
    tool: (name: string, args: unknown[]) => {
      if (!own(pimTools, name)) throw new Error(`unknown mail tool ${name}`);
      return (pimTools as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...(args ?? []));
    },
    threadOf: (id: string) => m.threadOf(id),
    logFocus: (minutes: number, taskId?: string) => m.logFocus(minutes, taskId),
    adoptIslandCalendarUrl: (url: string) => m.adoptIslandCalendarUrl(url),
  };
  return () => { for (const [name, args] of last) note(name, args); };
}
let mailStopped = false;

if (lock) {
  app.on('window-all-closed', () => { /* a part with nothing to show waits for the app to say so */ });
  app.on('second-instance', () => undefined);
  void app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock?.hide();
    // The app owns settings.json (a part without windows asks on a channel only parts reach).
    setSettingsWriter((patch) => call(role === 'mail' ? 'suite:settings.set' : 'settings.set', [patch]) as Promise<AllSettings>);
    // The windows open once the app has answered (their first calls need it); after the app
    // comes back from a crash they are only put in place again.
    let show: (() => void) | null = null;
    let starting = false;
    void connectLoop(() => {
      if (show) return show();
      if (starting) return;
      starting = true;
      void (role === 'island' ? startIsland() : role === 'widgets' ? startWidgets() : startMail()).then((s) => { show = s; s(); });
    });
    // Never started by the app, or the app is gone before it answered: do not linger.
    orphaned();
  });
  app.on('will-quit', () => lock.close());
}
