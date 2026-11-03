// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Blocking distractions while you focus. The lists, schedules and passes live
// in focus-block.json; how strict it is lives in the settings. While a block
// is on, sites go to:
//   - the browser extension, which opens Keeper's gentle block page instead,
//   - the firewall's DNS filter (when it runs), which covers every other app;
// and apps are watched through the front-window helper (fg-watch.ts): a
// blocked app coming to the front gets a small Keeper window over it, or is
// closed when the person chose that. Nothing runs while no block is on: one
// timer waits for the next schedule edge, and only while a schedule exists.

import { app, BrowserWindow, screen } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { BlockedApp, FocusBlockApi, FocusBlockStatus } from '../../core/api-focus';
import {
  activeBlock, appFor, blockLine, blockedTodayCount, browserBlock, cleanFocusBlockData, clock, countBlocked, emptyFocusBlockData, livePasses, nextChange,
  normalizeFocusBlockOptions, stopEarly, takePass, withPasses, type ActiveBlock, type BlockList, type BlockSchedule, type FocusBlockData,
} from '../../core/focus-block';
import { settings } from '../store';
import { focusBrowsers, setBrowserFocusBlock } from './browser-tabs';
import { featureOn, onFeature } from './features';
import { frontWatchAvailable, frontWindow, holdFrontWatch, onFrontWindow, type FrontWindow } from './fg-watch';
import { dnsFilterRunning, setFocusSites } from './fw';
import { keepUnmanaged, overlayOptions } from './unmanaged';

export interface FocusBlockDeps {
  preload: string;
  lockDown(win: BrowserWindow): void;
  broadcast(channel: string, ...args: unknown[]): void;
  /** a Focus session is running, and when it ends (0 for a stopwatch) */
  focus(): { on: boolean; endsAt: number };
  alert(title: string, detail: string): void;
  /** closes an app gracefully (Quit, not Force Quit) */
  quitApp(pid: number): Promise<boolean>;
  runningApps(): Promise<string[]>;
}

const FEATURE = 'focusBlock';
declare const __KEEPER_OFFICIAL__: boolean | undefined;
/** The test hook (testFront) never works in an official build. */
const TESTABLE = !(typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__);
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
let deps: FocusBlockDeps | undefined;
let data: FocusBlockData = emptyFocusBlockData();
let loaded = false;
let timer: NodeJS.Timeout | undefined;
let current: ActiveBlock | undefined;
let releaseFront: (() => void) | undefined;
let offFront: (() => void) | undefined;
let win: BrowserWindow | null = null;
let shown: { app: string; pid?: number } | undefined;
let lastLine = '';

const file = () => path.join(app.getPath('userData'), 'focus-block.json');
const options = () => normalizeFocusBlockOptions(settings().focusBlock);

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    data = cleanFocusBlockData(JSON.parse(await fsp.readFile(file(), 'utf8')));
  } catch {
    data = emptyFocusBlockData();
  }
}

let saving: Promise<void> = Promise.resolve();
function save() {
  const text = JSON.stringify(data, null, 1);
  saving = saving.then(async () => {
    await fsp.writeFile(`${file()}.tmp`, text, { mode: 0o600 });
    await fsp.rename(`${file()}.tmp`, file());
  }).catch(() => undefined);
  return saving;
}

function ctx() {
  const f = deps?.focus() ?? { on: false, endsAt: 0 };
  return { now: Date.now(), focusOn: f.on, focusEndsAt: f.endsAt };
}

/** The block as it is now, passes taken out. */
function computeBlock(): ActiveBlock {
  const c = ctx();
  if (!featureOn(FEATURE)) return { on: false, sites: [], apps: [], reasons: [], strict: false, lists: [] };
  return withPasses(activeBlock(data, options(), c), data.passes, c.now);
}

/** Looks again: applies the block where it changed and waits for the next change. */
export function evaluate() {
  if (!deps) return;
  clearTimeout(timer);
  timer = undefined;
  const now = Date.now();
  if (data.passes.some((p) => p.until <= now)) { data = { ...data, passes: livePasses(data, now) }; void save(); }
  const b = computeBlock();
  const before = current;
  current = b;
  setFocusSites(b.sites);
  setBrowserFocusBlock(browserBlock(b, options()));
  watchApps(b.on && b.apps.length > 0);
  if (!b.on) closeWindow();
  // The Island says when blocking starts and ends (not for every small change).
  const line = b.on ? blockLine(b) : '';
  if (b.on && !before?.on) deps.alert('Blocking distractions', `${b.lists.join(', ')}${b.until ? ` until ${clock(b.until)}` : ''}`);
  else if (!b.on && before?.on) deps.alert('Blocking has ended', 'Everything is open again.');
  if (line !== lastLine || JSON.stringify(before) !== JSON.stringify(b)) deps.broadcast('focusblock-changed');
  lastLine = line;
  if (!featureOn(FEATURE)) return;
  const next = nextChange(data, ctx());
  if (next !== undefined) {
    timer = setTimeout(evaluate, Math.max(500, Math.min(next - Date.now() + 250, 2 ** 31 - 1)));
    timer.unref?.();
  }
}

// ---------------------------------------------------------------- apps

function watchApps(on: boolean) {
  if (on && !releaseFront && frontWatchAvailable()) {
    releaseFront = holdFrontWatch();
    offFront = onFrontWindow((w) => void onFront(w));
    const f = frontWindow();
    if (f) void onFront(f);
  } else if (!on && releaseFront) {
    releaseFront();
    offFront?.();
    releaseFront = undefined;
    offFront = undefined;
  }
}

async function onFront(w: FrontWindow) {
  const b = current;
  if (!b?.on || !b.apps.length || !deps) return;
  if (/^(keeper|electron)$/i.test(w.app)) return;
  const hit = appFor(w, b.apps);
  if (!hit) {
    // Another app came forward: the block window goes with the blocked one.
    if (shown && win && !win.isDestroyed() && !win.isFocused()) closeWindow();
    return;
  }
  data = countBlocked(data, Date.now());
  void save();
  if (options().closeApps && w.pid) {
    const ok = await deps.quitApp(w.pid);
    deps.alert(ok ? `Closed ${w.app}` : `${w.app} is blocked`, b.until ? `Blocked until ${clock(b.until)}` : 'Blocked while you focus');
    return;
  }
  shown = { app: hit, pid: w.pid };
  openWindow(w);
}

function openWindow(w: FrontWindow) {
  if (!deps) return;
  const d = w.bounds ? screen.getDisplayMatching({ x: w.bounds.x, y: w.bounds.y, width: Math.max(1, w.bounds.width), height: Math.max(1, w.bounds.height) }) : screen.getPrimaryDisplay();
  const W = 420;
  const H = 300;
  const bounds = { x: Math.round(d.workArea.x + (d.workArea.width - W) / 2), y: Math.round(d.workArea.y + (d.workArea.height - H) / 3), width: W, height: H };
  if (win && !win.isDestroyed()) {
    win.setBounds(bounds);
    win.webContents.send('event:focusblock-changed');
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    ...overlayOptions('blocked'),
    ...bounds, frame: false, transparent: true, resizable: false, show: false, alwaysOnTop: true, hasShadow: true,
    webPreferences: { preload: deps.preload, contextIsolation: true, sandbox: true },
  });
  keepUnmanaged(win, 'blocked');
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  deps.lockDown(win);
  if (DEV_URL) void win.loadURL(`${DEV_URL}?view=blocked`);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { view: 'blocked' } });
  win.on('closed', () => { win = null; shown = undefined; });
  win.once('ready-to-show', () => { win?.show(); win?.focus(); });
}

function closeWindow() {
  shown = undefined;
  if (win && !win.isDestroyed()) win.close();
  win = null;
}

// ---------------------------------------------------------------- the window's calls

async function status(): Promise<FocusBlockStatus> {
  await load();
  const now = Date.now();
  return {
    data, options: options(), block: current ?? computeBlock(), passes: livePasses(data, now), blockedToday: blockedTodayCount(data, now),
    dnsFilter: dnsFilterRunning(), browsers: focusBrowsers(), appsSupported: frontWatchAvailable(), focusOn: deps?.focus().on ?? false,
  };
}

async function change(fn: (d: FocusBlockData) => FocusBlockData): Promise<FocusBlockStatus> {
  await load();
  data = cleanFocusBlockData(fn(data));
  await save();
  evaluate();
  return status();
}

const newId = () => Math.random().toString(36).slice(2, 10);

export const focusBlockApi: FocusBlockApi = {
  status,
  saveList: (l: BlockList) => change((d) => {
    const list = { ...l, id: l.id || newId() };
    return { ...d, lists: d.lists.some((x) => x.id === list.id) ? d.lists.map((x) => (x.id === list.id ? list : x)) : [...d.lists, list] };
  }),
  removeList: (id) => change((d) => {
    if (current?.on && current.strict && (d.manual?.listId === id || d.focusList === id || d.schedules.some((s) => s.listId === id && s.on))) throw new Error('Strict mode is on: lists in use can change after the block ends.');
    return { ...d, lists: d.lists.filter((l) => l.id !== id), schedules: d.schedules.filter((s) => s.listId !== id), focusList: d.focusList === id ? null : d.focusList };
  }),
  saveSchedule: (s: BlockSchedule) => change((d) => {
    const sc = { ...s, id: s.id || newId() };
    return { ...d, schedules: d.schedules.some((x) => x.id === sc.id) ? d.schedules.map((x) => (x.id === sc.id ? sc : x)) : [...d.schedules, sc] };
  }),
  removeSchedule: (id) => change((d) => {
    if (current?.on && current.strict && current.reasons.some((r) => r.kind === 'schedule')) throw new Error('Strict mode is on: schedules can change after the block ends.');
    return { ...d, schedules: d.schedules.filter((s) => s.id !== id) };
  }),
  setFocusList: (id) => change((d) => ({ ...d, focusList: id })),
  start: (listId, minutes, strict) => change((d) => ({ ...d, skipUntil: undefined, manual: { listId, until: Date.now() + Math.max(1, Math.min(24 * 60, Math.round(minutes))) * 60_000, strict: !!strict } })),
  async stop() {
    await load();
    const r = stopEarly(data, current ?? computeBlock(), Date.now());
    if ('error' in r) throw new Error(r.error);
    return change(() => r.data);
  },
  async pass(target) {
    await load();
    const b = activeBlock(data, options(), ctx());
    const r = takePass(data, b, options(), target, Date.now());
    if ('error' in r) return { ok: false, message: r.error };
    data = r.data;
    await save();
    evaluate();
    return { ok: true, until: r.until };
  },
  runningApps: () => deps?.runningApps() ?? Promise.resolve([]),
  async blockedApp(): Promise<BlockedApp | null> {
    const b = current;
    if (!shown || !b?.on) return null;
    const o = options();
    return { app: shown.app, line: blockLine(b), until: b.until, strict: b.strict, passMinutes: o.passMinutes, waitSeconds: o.waitSeconds };
  },
  async closeApp() {
    const pid = shown?.pid;
    closeWindow();
    if (pid) await deps?.quitApp(pid);
  },
  async dismiss() {
    closeWindow();
  },
  async testFront(appName: string) {
    if (!TESTABLE || !process.env.KEEPER_FOCUS_TEST) return;
    await onFront({ app: appName, title: appName, pid: 0, at: Date.now() });
  },
};

/** A pass asked for by the browser's block page (keeper/focus.pass). */
export function passForSite(site: string) {
  return focusBlockApi.pass(site);
}

/** A Focus session started or ended: its block follows, and "ended early" is forgotten with the session. */
export function focusChanged(on: boolean) {
  if (!deps) return;
  if (!on && data.skipFocus) { data = { ...data, skipFocus: undefined }; void save(); }
  if (featureOn(FEATURE) || current?.on) evaluate();
}

/** Why the running Focus session cannot be stopped (strict blocking), or nothing. */
export function focusStopRefusal(): string | undefined {
  const b = current;
  if (!b?.on || !b.strict || !b.reasons.some((r) => r.kind === 'focus')) return undefined;
  return 'The session and its blocking end on time. Quitting Keeper, or an administrator on this computer, can still end it.';
}

export async function startFocusBlock(d: FocusBlockDeps) {
  deps = d;
  onFeature(FEATURE, (on) => {
    if (on) void load().then(evaluate);
    else evaluate();
  }, { now: true });
}

export function stopFocusBlock() {
  clearTimeout(timer);
  watchApps(false);
  closeWindow();
  setFocusSites([]);
}
