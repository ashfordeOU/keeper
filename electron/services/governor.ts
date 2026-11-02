// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One place that decides when Keeper's background work may run and how often
// its regular checks look at things. It watches the battery, the locked
// screen, sleep, heat, how long the computer has been idle, Keeper's own
// processor use and the person's chosen mode, and tells everything else.
//
//   await whenIdle('embed')        wait until this kind of work may run
//   await pace('ocr')              a short pause between two items
//   poll('media', rule, fn)        a regular check that slows down when nobody looks
//   track('ocr', 'Reading text')   shows up in Settings → Performance

import { jobHelpers, trackHelper } from '../helpers-registry';
import { DEFAULT_LIMITS } from '../../core/limits';
import { app, BrowserWindow, powerMonitor } from 'electron';
import { execFile, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { decide, DEFAULT_CONDITIONS, pollDelay, restMs, type Conditions, type PollRule, type WorkKind } from '../../core/governor';
import { settings } from '../store';
import { featureOn, onFeaturesChanged } from './features';
import { measuredRun, pollLog } from './poll-log';
import { lastMemory } from './memory';

export type { WorkKind } from '../../core/governor';

let started = false;
let locked = false;
let suspended = false;
let thermal: Conditions['thermal'] = 'nominal';
let lowPower = false;
const listeners = new Set<() => void>();

// Keeper's own processor use, sampled at most every few seconds and only when asked.
let cpuAt = 0;
let cpuPct = 0;
function keeperCpu(): number {
  if (Date.now() - cpuAt < 4000) return cpuPct;
  cpuAt = Date.now();
  try {
    cpuPct = app.getAppMetrics().reduce((s, m) => s + (m.cpu?.percentCPUUsage ?? 0), 0);
  } catch {
    cpuPct = 0;
  }
  return cpuPct;
}

function mainVisible(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized() && /view=app|index\.html$|:\d+\/?$/.test(w.webContents.getURL()));
}

declare const __KEEPER_OFFICIAL__: boolean | undefined;
/**
 * Tests only (never in official builds): KEEPER_TEST_CONDITIONS='{"onBattery":true,"idleSec":0}'
 * pretends the computer is in that state, so the performance check can measure "on battery"
 * and "at the computer" under a virtual display.
 */
const TEST_CONDITIONS: Partial<Conditions> = (() => {
  if (typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__) return {};
  try { return JSON.parse(process.env.KEEPER_TEST_CONDITIONS || '{}') as Partial<Conditions>; } catch { return {}; }
})();

// Read at most once a second: asking the system how long it has been idle is not free
// (on Linux an X server round trip), and background work asks before every item.
let cached: { at: number; c: Conditions } | null = null;

export function conditions(): Conditions {
  if (cached && Date.now() - cached.at < 1000) return cached.c;
  const c = readConditions();
  if (started) cached = { at: Date.now(), c };
  return c;
}

function readConditions(): Conditions {
  if (!started) return { ...DEFAULT_CONDITIONS, mode: settings().resourceMode ?? 'balanced', boost: boosted(), ...TEST_CONDITIONS };
  // macOS: its "free" figure is small even when all is well (the file cache and compressed memory
  // count as used), so memory pressure decides, as Activity Monitor shows it. Elsewhere: what is
  // really available (Linux MemAvailable). The last shared reading, at most 30 s old: this answers at once.
  const mem = lastMemory(30_000);
  const memoryLow = process.platform === 'darwin'
    ? mem.pressure === 'warning' || mem.pressure === 'critical'
    : (mem.available ?? os.freemem()) < Math.min(512 * 1048576, mem.total * 0.05);
  noticeMemory(memoryLow);
  return {
    mode: settings().resourceMode ?? 'balanced',
    onBattery: powerMonitor.isOnBatteryPower(),
    lowPower,
    thermal,
    idleSec: powerMonitor.getSystemIdleTime(),
    locked,
    suspended,
    windowVisible: mainVisible(),
    keeperCpu: keeperCpu(),
    memoryLow,
    boost: boosted(),
    ...TEST_CONDITIONS,
  };
}

function changed() {
  cached = null;
  for (const l of listeners) l();
}

export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call once the app is ready. */
export function startGovernor() {
  if (started) return;
  started = true;
  powerMonitor.on('lock-screen', () => { locked = true; changed(); });
  powerMonitor.on('unlock-screen', () => { locked = false; changed(); });
  powerMonitor.on('suspend', () => { suspended = true; changed(); });
  powerMonitor.on('resume', () => { suspended = false; changed(); });
  powerMonitor.on('on-ac', changed);
  powerMonitor.on('on-battery', changed);
  powerMonitor.on('user-did-become-active', changed);
  powerMonitor.on('thermal-state-change', (e: { state?: string } | string) => {
    const s = typeof e === 'string' ? e : e?.state;
    thermal = s === 'fair' || s === 'serious' || s === 'critical' ? s : 'nominal';
    changed();
  });
  powerMonitor.on('speed-limit-change', (e: { limit?: number } | number) => {
    const limit = typeof e === 'number' ? e : e?.limit ?? 100;
    lowPower = limit < 70;
    changed();
  });
  app.on('browser-window-created', (_e, w) => {
    for (const ev of ['show', 'hide', 'minimize', 'restore'] as const) w.on(ev as 'show', changed);
  });
}

// ---------------------------------------------------------------- "Stop all background work now"

let heldUntil = 0;
let holdTimer: NodeJS.Timeout | undefined;
let holdReason = 'Stopped by you (Keeper’s processes → Resume)';

/** Holds every piece of background work (indexing, reading text, sync, backups, regular checks) until resumed or the time is up. */
export function holdAllWork(ms = 60 * 60_000, reason = 'Stopped by you (Keeper’s processes → Resume)') {
  holdReason = reason;
  heldUntil = Date.now() + ms;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => resumeAllWork(), ms);
  holdTimer.unref?.();
  changed();
}

export function resumeAllWork() {
  if (!heldUntil) return;
  heldUntil = 0;
  clearTimeout(holdTimer);
  changed();
}

/** When held work starts again on its own (0: not held). */
export function workHeldUntil(): number {
  return heldUntil > Date.now() ? heldUntil : 0;
}

/** May this kind of work run right now? With a reason for the settings page when not. */
export function canWork(kind: WorkKind) {
  if (workHeldUntil()) return { ok: false as const, reason: holdReason };
  // Too many helper programs (video conversion, text recognition…) at once: new background work waits.
  if (jobHelpers().length >= DEFAULT_LIMITS.maxHelpers) return { ok: false as const, reason: `${jobHelpers().length} helper programs already running` };
  return decide(kind, conditions());
}

// ---------------------------------------------------------------- "Speed up now"

let boostUntil = 0;
let boostTimer: NodeJS.Timeout | undefined;
const boosted = () => boostUntil > Date.now();

/** Lets background work run at full speed for a while (Home → "Speed up now"), even on battery. */
export function boostWork(ms = 30 * 60_000) {
  boostUntil = Date.now() + ms;
  clearTimeout(boostTimer);
  boostTimer = setTimeout(() => { boostUntil = 0; changed(); }, ms);
  boostTimer.unref?.();
  changed();
}

/** Until when background work is sped up (0: not). */
export function workBoostedUntil(): number {
  return boosted() ? boostUntil : 0;
}

/** Resolves when this kind of work may run. */
export function whenIdle(kind: WorkKind, signal?: AbortSignal): Promise<void> {
  if (canWork(kind).ok) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const done = () => {
      off();
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const check = () => {
      if (signal?.aborted || canWork(kind).ok) return done();
      clearTimeout(timer);
      // Idle time and Keeper's own use change without an event: look again now and then.
      timer = setTimeout(check, 15_000);
    };
    const off = onChange(check);
    signal?.addEventListener('abort', done);
    check();
  });
}

// All background work shares one allowance: each item's rest is added to a common clock, and the
// next item of any kind starts after it. Reading text, download sources and the brain at once
// therefore take a fifth of the time between them, not a fifth each.
let gate = 0;

/**
 * Pauses for one stream of background work (a queue, a scan): each pause keeps the work to its
 * share of the time (core/governor dutyCycle), measured from when this stream last came back
 * from a pause. After an item that took 200 ms, at a fifth of the time, it rests 800 ms.
 * Waits while the work should not run at all. Call it before each item.
 */
export interface Pacer {
  (kind: WorkKind, signal?: AbortSignal): Promise<void>;
  /** The stream has run out of work: the time until its next pause is not counted as work. */
  idle(): void;
}

export function pacer(): Pacer {
  let resumedAt: number | undefined;
  const p = async (kind: WorkKind, signal?: AbortSignal) => {
    // More than ten seconds since the last pause: the stream was idle (or one huge item), not counted.
    const since = resumedAt === undefined ? 0 : Date.now() - resumedAt;
    const worked = since > 10_000 ? 0 : since;
    await whenIdle(kind, signal);
    const now = Date.now();
    gate = Math.max(gate, now) + restMs(kind, conditions(), worked);
    // Never more than a minute ahead (many streams at once, or a long wait just ended).
    gate = Math.min(gate, now + 60_000);
    const ms = gate - now;
    if (ms > 0 && !signal?.aborted) await new Promise((r) => setTimeout(r, ms));
    resumedAt = Date.now();
  };
  return Object.assign(p, { idle: () => { resumedAt = undefined; } });
}

// One stream per kind for callers that do not keep their own pacer.
const shared = new Map<WorkKind, Pacer>();

/** A pause between two items of background work (see pacer); one stream per kind. */
export function pace(kind: WorkKind, signal?: AbortSignal): Promise<void> {
  let p = shared.get(kind);
  if (!p) shared.set(kind, (p = pacer()));
  return p(kind, signal);
}

// ---------------------------------------------------------------- regular checks

interface Poller { name: string; rule: PollRule | (() => PollRule); fn: () => unknown; timer?: NodeJS.Timeout; running: boolean; stopped: boolean; runs: number; paused?: boolean; stop?: () => void; features?: string[] }
const pollers = new Map<string, Poller>();

function schedule(p: Poller) {
  clearTimeout(p.timer);
  if (p.stopped) return;
  // A feature that is off has no timer at all; switching it on starts the check again. Held work waits too.
  const ms = workHeldUntil() || p.features?.some((f) => !featureOn(f)) ? null : pollDelay(typeof p.rule === 'function' ? p.rule() : p.rule, conditions());
  // Paused (locked or asleep): the next change of conditions starts it again.
  if (ms === null) {
    p.paused = true;
    return;
  }
  p.timer = setTimeout(async () => {
    if (p.running) return schedule(p);
    p.running = true;
    try {
      p.runs++;
      await measuredRun(p.name, p.fn);
    } catch {
      /* the next look will try again */
    } finally {
      p.running = false;
      schedule(p);
    }
  }, ms);
}

/**
 * A regular check that slows down when the person is away and stops while the
 * screen is locked (if the rule says so). Runs once straight away. Returns a
 * stop function. Calling it again with the same name replaces the old one.
 */
export function poll(name: string, rule: PollRule | (() => PollRule), fn: () => unknown, opts: { now?: boolean; feature?: string | string[] } = {}): () => void {
  pollers.get(name)?.stop?.();
  const features = opts.feature === undefined ? undefined : Array.isArray(opts.feature) ? opts.feature : [opts.feature];
  const p: Poller = { name, rule, fn, running: false, stopped: false, runs: 0, features };
  p.stop = () => { p.stopped = true; clearTimeout(p.timer); pollers.delete(name); };
  pollers.set(name, p);
  if (opts.now !== false && !features?.some((f) => !featureOn(f))) void Promise.resolve().then(() => measuredRun(name, fn)).catch(() => undefined);
  schedule(p);
  return p.stop;
}

/** Look again right away (after the person did something that changes the answer). */
export function pollNow(name: string) {
  const p = pollers.get(name);
  if (!p || p.stopped) return;
  clearTimeout(p.timer);
  p.timer = setTimeout(async () => {
    if (p.running) return;
    p.running = true;
    try { await measuredRun(p.name, p.fn); } catch { /* ignore */ } finally { p.running = false; schedule(p); }
  }, 0);
}

// Switching features on or off starts and stops their checks.
onFeaturesChanged(changed);

// A change of conditions (unlocked, back from sleep, back at the keyboard) reschedules every check.
onChange(() => {
  for (const p of pollers.values()) {
    if (p.running) continue;
    // Back from a pause (unlocked, awake again): look straight away.
    if (p.paused) {
      p.paused = false;
      pollNow(p.name);
    } else schedule(p);
  }
});

// ---------------------------------------------------------------- background tasks, for the usage card

export interface TaskInfo {
  id: string;
  label: string;
  kind: WorkKind;
  state: 'working' | 'waiting' | 'idle';
  detail?: string;
  /** items left */
  pending?: number;
}

const tasks = new Map<string, TaskInfo>();

/** Registers a background task so the person can see what it does and why it waits. */
export function track(id: string, label: string, kind: WorkKind) {
  const t: TaskInfo = { id, label, kind, state: 'idle' };
  tasks.set(id, t);
  return {
    set(state: TaskInfo['state'], patch: Partial<Pick<TaskInfo, 'detail' | 'pending'>> = {}) {
      Object.assign(t, { state, ...patch });
    },
  };
}

export function usage(): import('../../core/api-usage').KeeperUsage {
  let cpu = 0;
  let memory = 0;
  let processes = 0;
  try {
    for (const m of app.getAppMetrics()) {
      cpu += m.cpu?.percentCPUUsage ?? 0;
      // workingSetSize is in kilobytes.
      memory += (m.memory?.privateBytes ?? m.memory?.workingSetSize ?? 0) * 1024;
      processes++;
    }
  } catch {
    /* metrics unavailable */
  }
  const c = conditions();
  return {
    cpu: Math.round(cpu * 10) / 10,
    memory,
    processes,
    mode: c.mode,
    hardwareGraphics: (() => { try { return app.isHardwareAccelerationEnabled(); } catch { return undefined; } })(),
    conditions: { onBattery: c.onBattery, locked: c.locked, idleSec: c.idleSec, thermal: c.thermal, lowPower: c.lowPower, memoryLow: c.memoryLow },
    tasks: [...tasks.values()].map((t) => {
      const d = decide(t.kind, c);
      return { ...t, state: t.state === 'working' && !d.ok ? 'waiting' as const : t.state, detail: !d.ok && t.state !== 'idle' ? d.reason : t.detail };
    }),
    checks: [...pollers.values()].map((p) => ({ name: p.name, everyMs: p.features?.some((f) => !featureOn(f)) || p.paused ? null : pollDelay(typeof p.rule === 'function' ? p.rule() : p.rule, c), runs: p.runs, features: p.features })),
    pollLog: pollLog(),
  };
}

export type { KeeperUsage } from '../../core/api-usage';

/** For crash breadcrumbs: each regular check, whether it is running right now, and how often it ran. */
export function pollerSnapshot() {
  return [...pollers.values()].map((p) => ({ name: p.name, running: p.running, runs: p.runs, paused: !!p.paused }));
}

/** Helpers such as video conversion and text recognition run below normal priority. */
export function lowerPriority(child: ChildProcess | number | undefined) {
  const pid = typeof child === 'number' ? child : child?.pid;
  if (!pid) return;
  // Helpers never outlive Keeper: if Keeper is killed, the watchdog stops what is left.
  if (typeof child === 'object' && child) trackHelper(child);
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    /* not permitted: leave it */
  }
  // macOS: the background class as well (lower priority, throttled disk access, efficiency cores).
  if (process.platform === 'darwin') {
    try {
      execFile('/usr/bin/taskpolicy', ['-b', '-p', String(pid)], { timeout: 5000 }, () => undefined).unref();
    } catch {
      /* older macOS: the priority above is enough */
    }
  }
}

// ---------------------------------------------------------------- short of memory

/** Free what can be rebuilt when the computer runs short of memory. */
const relievers = new Set<() => void>();
export function onMemoryPressure(fn: () => void): () => void {
  relievers.add(fn);
  return () => relievers.delete(fn);
}

let wasLow = false;
/** Called whenever conditions are read: on the edge into "short of memory", caches let go. */
function noticeMemory(low: boolean) {
  if (low && !wasLow) relieveMemory();
  wasLow = low;
}

export function relieveMemory() {
  for (const r of relievers) {
    try {
      r();
    } catch {
      /* ignore */
    }
  }
}
