// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeps Keeper inside its own ceilings (core/limits.ts). Every 15 seconds it
// reads Keeper's processes from Electron (no extra programs, no disk) and:
//
//   • if all of Keeper stays above the processor ceiling for minutes while the
//     person is not using it, holds background work for a while, stops idle
//     service processes and says in the Island what was paused;
//   • restarts a service process past its memory ceiling (it is given its
//     settings again when it starts, and callers never notice);
//   • reloads a hidden window past its ceiling (its tabs come back from the
//     checkpoint);
//   • stops a helper program past its ceiling.
//
// Everything it does is listed on System → Keeper's processes.

import { app, BrowserWindow, powerMonitor, webContents } from 'electron';
import { readFileSync } from 'node:fs';
import { cpuStep, CPU_START, limitsFor, memoryActions, type LimitEvent, type Limits, type MemSample } from '../../core/limits';
import { jobHelpers } from '../helpers-registry';
import { holdAllWork, usage } from '../services/governor';
import { settings } from '../store';
import { logEvent } from '../resilience';
import { allHosts } from './host';

const EVERY_MS = 15_000;
let timer: NodeJS.Timeout | undefined;
let cpu = CPU_START;
const events: LimitEvent[] = [];
let notify: (title: string, detail: string) => void = () => undefined;
let lastCpu = 0;
let lastAlert: { at: number; title: string; detail: string } | undefined;

export function onLimitAlert(fn: (title: string, detail: string) => void) {
  notify = fn;
}

export function currentLimits(): Limits {
  const l = limitsFor(settings().resourceMode);
  // Tests set tiny ceilings to see each step happen.
  try {
    return process.env.KEEPER_LIMITS ? { ...l, ...JSON.parse(process.env.KEEPER_LIMITS) } : l;
  } catch {
    return l;
  }
}

export function limitEvents(): LimitEvent[] {
  return events.slice(-20).reverse();
}

function record(what: string) {
  events.push({ at: Date.now(), what });
  if (events.length > 50) events.shift();
  logEvent('limit', what);
}

const mb = (b: number) => `${Math.round(b / 1048576)} MB`;

function helperMemory(pid: number): number {
  if (process.platform !== 'linux') return 0;
  try {
    const m = readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)\s+kB/);
    return m ? Number(m[1]) * 1024 : 0;
  } catch {
    return 0;
  }
}

/** The person is working in a Keeper window right now. */
function inUse(): boolean {
  try {
    return !!BrowserWindow.getFocusedWindow() && powerMonitor.getSystemIdleTime() < 60;
  } catch {
    return false;
  }
}

export function checkLimits(now = Date.now()) {
  const l = currentLimits();
  let metrics: Electron.ProcessMetric[] = [];
  try {
    metrics = app.getAppMetrics();
  } catch {
    return;
  }
  const total = metrics.reduce((s, m) => s + (m.cpu?.percentCPUUsage ?? 0), 0);
  lastCpu = total;

  // Processor
  const step = cpuStep(cpu, total, inUse(), now, l);
  cpu = step.state;
  if (step.act) {
    const busy = usage().tasks.filter((t) => t.state !== 'idle').map((t) => t.label);
    const hosts = allHosts().filter((h) => h.pid);
    for (const h of hosts) void h.stop(true);
    const paused = [...busy, ...hosts.map((h) => h.opts.label)];
    const mins = Math.round(l.cpuHoldMs / 60_000);
    holdAllWork(l.cpuHoldMs, `Paused for ${mins} min: Keeper was busy for too long (Keeper’s processes → Resume)`);
    const detail = `Paused for ${mins} min: ${paused.length ? paused.join(', ') : 'background work'}. Resume in Keeper’s processes.`;
    record(`Used ${Math.round(total)}% processor for over ${Math.round(l.cpuSustainMs / 60_000)} min — ${detail}`);
    lastAlert = { at: now, title: 'Keeper is taking a break', detail };
    notify(lastAlert.title, detail);
    // The service processes were just stopped: nothing more to look at this time.
    return;
  }

  // Memory
  const byPid = new Map(metrics.map((m) => [m.pid, m]));
  const samples: MemSample[] = [];
  for (const h of allHosts()) {
    const m = h.pid ? byPid.get(h.pid) : undefined;
    if (m) samples.push({ id: `svc:${h.opts.name}`, kind: 'service', memory: (m.memory?.workingSetSize ?? 0) * 1024 });
  }
  for (const wc of webContents.getAllWebContents()) {
    const m = byPid.get(wc.getOSProcessId());
    const win = BrowserWindow.fromWebContents(wc);
    if (!m || !win || m.type !== 'Tab') continue;
    samples.push({ id: `window:${wc.id}`, kind: 'window', memory: (m.memory?.workingSetSize ?? 0) * 1024, visible: win.isVisible() && !win.isMinimized() });
  }
  for (const h of jobHelpers()) samples.push({ id: `helper:${h.pid}`, kind: 'helper', memory: helperMemory(h.pid) });

  for (const a of memoryActions(samples, l)) {
    if (a.kind === 'service') {
      const h = allHosts().find((x) => `svc:${x.opts.name}` === a.id);
      if (!h) continue;
      record(`${h.opts.label} grew to ${mb(a.memory)} (ceiling ${mb(a.ceiling)}): restarted it`);
      void h.restart().catch(() => undefined);
    } else if (a.kind === 'window') {
      const wc = webContents.fromId(Number(a.id.slice(7)));
      if (!wc) continue;
      record(`A hidden window grew to ${mb(a.memory)} (ceiling ${mb(a.ceiling)}): reloaded it, tabs kept`);
      wc.reload();
    } else {
      const pid = Number(a.id.slice(7));
      const name = jobHelpers().find((h) => h.pid === pid)?.name ?? 'helper';
      record(`${name} grew to ${mb(a.memory)} (ceiling ${mb(a.ceiling)}): stopped it`);
      try {
        process.kill(pid);
      } catch {
        /* already gone */
      }
    }
  }
}

export function limitsStatus() {
  return { limits: currentLimits(), events: limitEvents(), cpu: Math.round(lastCpu * 10) / 10, overSince: cpu.overSince || 0, helpers: jobHelpers().length, lastAlert };
}

export function startLimits() {
  if (timer) return;
  timer = setInterval(() => checkLimits(), EVERY_MS);
  timer.unref?.();
}

export function stopLimits() {
  clearInterval(timer);
  timer = undefined;
}
