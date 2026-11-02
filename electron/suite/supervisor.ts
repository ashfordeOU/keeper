// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Starts, stops and restarts Keeper's parts (the Island, desktop widgets, Mail and calendars), each
// as Keeper's own program with `--keeper-role=<part>`, following the rules in
// core/suite.ts: a part that stops unexpectedly comes back after a wait that
// grows with each crash in a row; one that keeps crashing is left stopped and
// the suite page says so, with a Restart button.
//
// If the app itself stops, the parts keep running (they are not its children
// in any way that would end them) and wait for it; the watchdog starts the app
// again and the parts reconnect to it. A part already running when the app
// starts is adopted, never started twice.

import { app, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_POLICY, EXIT_ALREADY_RUNNING, PARTS, ROLE_FLAG, initialStatus, separateByDefault, restartExit, step, type PartAction, type PartEvent, type PartRole, type PartStatus } from '../../core/suite';
import type { SuitePart } from '../../core/api-suite';
import { normalizeWidgets } from '../../core/widgets';
import { featureOn, onFeature } from '../services/features';
import { onSettings, settings } from '../store';
import { roleRunning, suiteDir } from './channel';
import { ownUsage } from './metrics';
import { onPartBye, onPartHello, partCommand, partConnected, partPid } from './hub';

const SAFE_MODE = process.argv.includes('--safe-mode');

/**
 * Parts in processes of their own (the default), or all in the app's process as
 * before (KEEPER_SUITE=shared, or Settings → Features → "Run parts separately" off).
 * Decided at start; a change applies at the next start.
 */
export const separateAtStart = (() => {
  const env = process.env.KEEPER_SUITE;
  if (env === 'shared') return false;
  if (env === 'separate') return true;
  try {
    return separateByDefault(settings());
  } catch {
    return true;
  }
})();

interface Slot { status: PartStatus; child?: ChildProcess; timer?: NodeJS.Timeout; startTimer?: NodeJS.Timeout; restarting?: boolean; adoptTimer?: NodeJS.Timeout }

const slots = new Map<PartRole, Slot>(PARTS.map((p) => [p.role, { status: initialStatus() }]));
const changeListeners = new Set<() => void>();
export const onPartsChanged = (fn: () => void) => { changeListeners.add(fn); return () => changeListeners.delete(fn); };
const changed = () => { for (const fn of changeListeners) fn(); };
let started = false;
let quitting = false;

function log(role: PartRole, what: string) {
  if (process.env.KEEPER_SUITE_LOG === '1') console.log(`[suite] ${role}: ${what}`);
}

/** Does the person want this part running now? */
export function partWanted(role: PartRole): boolean {
  if (!separateAtStart || SAFE_MODE || quitting) return false;
  if (role === 'island') return featureOn('island') && settings().island.enabled !== false;
  if (role === 'widgets') return featureOn('widgets') && normalizeWidgets(settings().widgets).length > 0;
  if (role === 'mail') return partOn('mail');
  return false;
}

/** Any of the part's features is switched on. */
const partOn = (role: PartRole) => PARTS.find((p) => p.role === role)!.features.some((f) => featureOn(f));

/** Keeper's own program and the arguments that start a part (a development run passes the app's folder). */
function command(role: PartRole): [string, string[]] {
  const args = [
    ...(app.isPackaged ? [] : [app.getAppPath()]),
    `${ROLE_FLAG}${role}`,
    `--user-data-dir=${app.getPath('userData')}`,
    ...process.argv.filter((a) => a === '--no-sandbox' || a.startsWith('--ozone-platform')),
    // Mail shows no web pages at all, so on Linux it needs none of Chromium's zygote processes, which
    // would otherwise start with it only to fork pages it never opens (about 20 MB). Without pages
    // there is nothing for the sandbox to hold, and Chromium allows no zygote only without it.
    ...(role === 'mail' && process.platform === 'linux' ? ['--no-zygote', ...(process.argv.includes('--no-sandbox') ? [] : ['--no-sandbox'])] : []),
  ];
  // An AppImage runs from a temporary mount that goes when the app quits: start from the file itself.
  if (process.env.APPIMAGE) return [process.env.APPIMAGE, args.filter((a) => a !== app.getAppPath())];
  return [process.execPath, args];
}

function dispatch(role: PartRole, e: PartEvent) {
  const slot = slots.get(role)!;
  const { status, action } = step(slot.status, e, Date.now(), DEFAULT_POLICY);
  const before = slot.status.state;
  slot.status = status;
  if (before !== status.state) log(role, `${before} → ${status.state} (${e.type})`);
  act(role, action);
  changed();
}

function act(role: PartRole, a: PartAction) {
  const slot = slots.get(role)!;
  if (a.do === 'spawn') void spawnPart(role);
  else if (a.do === 'stop') void stopPart(role);
  else if (a.do === 'schedule') {
    clearTimeout(slot.timer);
    slot.timer = setTimeout(() => dispatch(role, { type: 'timer' }), a.inMs);
    slot.timer.unref?.();
  }
}

async function spawnPart(role: PartRole, retry = false) {
  const slot = slots.get(role)!;
  if (!retry) {
    clearTimeout(slot.startTimer);
    slot.startTimer = setTimeout(() => dispatch(role, { type: 'startTimeout' }), DEFAULT_POLICY.startTimeoutMs);
    slot.startTimer.unref?.();
  }
  // Already connected (it outlived an earlier run of the app and came back): adopt it.
  if (partConnected(role)) return dispatch(role, { type: 'hello', pid: partPid(role)! });
  // Running but not connected yet: it finds this run of the app within a second or two.
  if (await roleRunning(app.getPath('userData'), role)) { log(role, 'already running, waiting for it'); return; }
  const [exe, args] = command(role);
  const env: NodeJS.ProcessEnv = { ...process.env, KEEPER_PART_OF: String(process.pid) };
  delete env.ELECTRON_RUN_AS_NODE;
  let child: ChildProcess;
  try {
    child = spawn(exe, args, { detached: true, stdio: process.env.KEEPER_SUITE_LOG === '1' ? 'inherit' : 'ignore', env, windowsHide: false });
  } catch (e) {
    dispatch(role, { type: 'exited', reason: `could not start: ${(e as Error).message}` });
    return;
  }
  child.unref();
  slot.child = child;
  if (child.pid) dispatch(role, { type: 'spawned', pid: child.pid });
  child.once('error', (e) => { if (slot.child === child) { slot.child = undefined; dispatch(role, { type: 'exited', reason: `could not start: ${e.message}` }); } });
  child.once('exit', (code, signal) => {
    if (slot.child !== child) return;
    slot.child = undefined;
    // Another copy holds the part's lock: it is the one that will connect.
    // (A copy that was just told to quit may still hold it: try again in a moment.)
    if (code === EXIT_ALREADY_RUNNING) {
      log(role, 'another copy is running; waiting for it');
      setTimeout(() => { if (slot.status.state === 'starting' && !slot.child && !partConnected(role)) void spawnPart(role, true); }, 1500).unref?.();
      return;
    }
    // Still connected means the process that exited was not the one serving (cannot happen, but never count it twice).
    if (partConnected(role) && partPid(role) !== child.pid) return;
    exited(role, signal ? `stopped by ${signal}` : `exited with code ${code}`);
  });
}

function exited(role: PartRole, reason: string) {
  const slot = slots.get(role)!;
  clearTimeout(slot.startTimer);
  clearTimeout(slot.adoptTimer);
  const restarting = slot.restarting && !quitting;
  slot.restarting = false;
  if (quitting) slot.status = { ...slot.status, wanted: false };
  const st = slot.status;
  const expected = restarting || quitting || (st.state === 'stopping' && !st.wanted);
  dispatch(role, restarting ? restartExit(st) : { type: 'exited', reason, expected });
  if (!expected) logCrash(role, reason);
}

function logCrash(role: PartRole, reason: string) {
  void import('../resilience').then((r) => r.logEvent('part-stopped', `${role}: ${reason}`)).catch(() => undefined);
}

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

async function stopPart(role: PartRole) {
  const slot = slots.get(role)!;
  clearTimeout(slot.startTimer);
  const pid = slot.child?.pid ?? partPid(role) ?? slot.status.pid;
  if (partConnected(role)) await partCommand(role, 'quit', [], 3000).catch(() => undefined);
  // It closes its windows and leaves; if it does not within three seconds, it is ended.
  setTimeout(() => {
    if (pid && alive(pid) && slots.get(role)!.status.pid === pid) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    // A part that was not our child (adopted) reports no exit: its connection closing is the sign.
    if (!slot.child && slot.status.state === 'stopping' && !partConnected(role)) exited(role, 'stopped');
  }, 3000).unref?.();
}

onPartHello((role, pid) => {
  const slot = slots.get(role);
  if (!slot) return;
  clearTimeout(slot.startTimer);
  clearTimeout(slot.adoptTimer);
  // A part that outlived an earlier run: if it is not wanted (or the parts run in the app now), it is told to go.
  if (!started) {
    slot.status = { ...slot.status, wanted: partWanted(role) };
  }
  dispatch(role, { type: 'hello', pid });
});

onPartBye((role, pid) => {
  const slot = slots.get(role);
  if (!slot || quitting) return;
  // Our own child: its exit event says how it ended.
  if (slot.child?.pid === pid) return;
  // Adopted: gone, or only the connection dropped (it reconnects by itself)?
  clearTimeout(slot.adoptTimer);
  slot.adoptTimer = setTimeout(() => {
    if (partConnected(role)) return;
    if (alive(pid)) {
      // Running but not talking to the app for 10 s: hung. End it; the rules start it again.
      try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
      exited(role, 'stopped answering');
    } else exited(role, 'stopped unexpectedly');
  }, alive(pid) ? 10_000 : 1000);
});

/** Starts the parts that are wanted; follows the feature switches from then on. */
export function startSuite() {
  if (started) return;
  started = true;
  // Sockets of earlier runs of the app that crashed.
  if (process.platform !== 'win32') {
    try {
      const dir = suiteDir(app.getPath('userData'));
      for (const f of readdirSync(dir)) {
        const pid = Number(f.match(/^app-(\d+)\.sock$/)?.[1]);
        if (pid && pid !== process.pid && !alive(pid)) rmSync(path.join(dir, f), { force: true });
      }
    } catch { /* none */ }
  }
  refreshParts();
  for (const f of new Set(PARTS.flatMap((p) => p.features))) onFeature(f, () => refreshParts());
  onSettings((next, prev) => {
    if (next.island.enabled !== prev.island.enabled || JSON.stringify(next.widgets) !== JSON.stringify(prev.widgets)) refreshParts();
  });
  app.on('before-quit', () => stopAllParts());
}

/** Brings every part in line with what is wanted. */
export function refreshParts() {
  for (const p of PARTS) {
    const want = partWanted(p.role);
    if (slots.get(p.role)!.status.wanted !== want || (want && slots.get(p.role)!.status.state === 'off')) dispatch(p.role, { type: 'want', on: want });
  }
}

/** On a normal quit (and before an update installs): every part closes too. */
export function stopAllParts() {
  if (quitting) return;
  quitting = true;
  for (const p of PARTS) {
    const slot = slots.get(p.role)!;
    clearTimeout(slot.timer);
    slot.status = { ...slot.status, wanted: false };
    if (!partConnected(p.role)) continue;
    void partCommand(p.role, 'quit', [], 1500).catch(() => undefined);
  }
}

export function restartPart(role: PartRole) {
  const slot = slots.get(role);
  if (!slot || !slot.status.wanted) return;
  if (slot.status.state === 'running' || slot.status.state === 'starting') slot.restarting = true;
  dispatch(role, { type: 'restart' });
}

export function partStatus(role: PartRole): PartStatus {
  return slots.get(role)!.status;
}

/** Each part with its state, memory and processor use, for Settings → Features and the Processes page. */
export async function listParts(): Promise<SuitePart[]> {
  const out: SuitePart[] = [];
  for (const p of PARTS) {
    const s = slots.get(p.role)!.status;
    let memory = 0;
    let cpu = 0;
    let processes = 0;
    if (partConnected(p.role)) {
      const m = await partCommand<{ memory: number; cpu: number; processes: number }>(p.role, 'metrics', [], 2000).catch(() => null);
      if (m) ({ memory, cpu, processes } = m);
    }
    out.push({
      id: p.role, name: p.name, description: p.description, feature: p.feature,
      features: p.features, separate: separateAtStart, on: partOn(p.role), wanted: s.wanted, state: separateAtStart ? s.state : (partOn(p.role) ? 'shared' : 'off'),
      pid: s.pid, startedAt: s.startedAt, restarts: s.restarts, lastCrash: s.lastCrash, memory, cpu, processes,
    });
  }
  return out;
}

export function registerSuiteIpc() {
  ipcMain.handle('suite.parts', () => listParts());
  // The app's own processes (its services are listed apart, on the suite page and the Processes page).
  ipcMain.handle('suite.app', async () => {
    const { allHosts } = await import('../svc/host');
    const services = new Set(allHosts().map((h) => h.pid).filter(Boolean));
    return { ...ownUsage((pid) => services.has(pid)), pid: process.pid, startedAt: Math.round(Date.now() - process.uptime() * 1000) };
  });
  ipcMain.handle('suite.restart', (_e, role: PartRole) => { restartPart(role); return listParts(); });
  ipcMain.handle('suite.separate', () => ({ now: separateAtStart, next: separateByDefault(settings()), env: process.env.KEEPER_SUITE ?? null }));
}
