// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A part of Keeper in a process of its own: `Keeper --keeper-role=island` or
// `--keeper-role=widgets` (docs/SUITE.md). It owns only its windows. What they
// ask for (window.keeper.*) is answered by the app over the suite channel;
// the events the app sends its windows reach these windows too.
//
//   • one copy per part (its own lock), no Dock icon, its own Chromium storage;
//   • if the app stops, the windows stay as they are and the part reconnects
//     when the app is back (the watchdog starts it again); calls made meanwhile
//     wait a little, then fail politely;
//   • if the app does not come back (it was quit for good, or Force Quit on a
//     Mac), the part closes too after a while.

// Must stay the first import: test runs move every folder before anything reads one.
import '../test-home';
import { app, BrowserWindow, ipcMain, nativeImage, shell, webContents } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EXIT_ALREADY_RUNNING, ORPHAN_GRACE_MS, roleOf, type PartRole, type SenderInfo, type SuiteMessage } from '../../core/suite';
import type { AllSettings } from '../../core/settings';
import { installNavGuard } from '../nav-guard';
import { adoptSettings, setSettingsWriter } from '../store';
import { ownUsage } from './metrics';
import { connect, readCoreInfo, suiteDir, takeRoleLock, type Peer } from './channel';

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
if (!(typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__) && cdpBase > 0) app.commandLine.appendSwitch('remote-debugging-port', String(cdpBase + (role === 'island' ? 0 : 1)));
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

async function onMessage(m: SuiteMessage, onWelcome: () => void) {
  switch (m.t) {
    case 'welcome':
      adoptSettings(m.settings as AllSettings);
      forward(m.channels, m.sends);
      welcomed = true;
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

/** The app is gone: wait for it to come back, but not for ever. */
function orphaned() {
  clearTimeout(orphanTimer);
  clearInterval(stoppedTimer);
  const since = Date.now();
  orphanTimer = setTimeout(() => { if (!welcomed) app.quit(); }, Number(process.env.KEEPER_PART_GRACE_MS) || ORPHAN_GRACE_MS);
  // The watchdog says Keeper was stopped on purpose (Force Quit on a Mac) and will not be started again: go now.
  stoppedTimer = setInterval(() => {
    if (welcomed) return clearInterval(stoppedTimer);
    try {
      const r = JSON.parse(readFileSync(path.join(suiteDir(userData), 'app-stopped.json'), 'utf8')) as { at?: number };
      if ((r.at ?? 0) >= since - 30_000) app.quit();
    } catch { /* not stopped on purpose */ }
  }, 2000);
}
let stoppedTimer: NodeJS.Timeout | undefined;

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

if (lock) {
  app.on('window-all-closed', () => { /* a part with nothing to show waits for the app to say so */ });
  app.on('second-instance', () => undefined);
  void app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock?.hide();
    setSettingsWriter((patch) => call('settings.set', [patch]) as Promise<AllSettings>);
    // The windows open once the app has answered (their first calls need it); after the app
    // comes back from a crash they are only put in place again.
    let show: (() => void) | null = null;
    let starting = false;
    void connectLoop(() => {
      if (show) return show();
      if (starting) return;
      starting = true;
      void (role === 'island' ? startIsland() : startWidgets()).then((s) => { show = s; s(); });
    });
    // Never started by the app, or the app is gone before it answered: do not linger.
    orphaned();
  });
  app.on('will-quit', () => lock.close());
}
