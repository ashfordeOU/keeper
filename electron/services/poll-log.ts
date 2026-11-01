// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// KEEPER_POLL_LOG=1: what Keeper's regular checks cost, for finding idle work
// on a computer where nobody can attach a profiler (the Mac test kit's
// performance check turns it on). Each governor poll run is logged with its
// name, wall time, main-process processor time and the programs it started;
// programs started outside any poll are counted too, by name. Off by default:
// nothing is wrapped or measured then.

import { AsyncLocalStorage } from 'node:async_hooks';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import type { PollStat, PollLog } from '../../core/api-usage';

export const pollLogOn = /^(1|true|yes)$/i.test(process.env.KEEPER_POLL_LOG ?? '');

const current = new AsyncLocalStorage<string>();
const stats = new Map<string, PollStat>();
const outside = new Map<string, number>();
const since = Date.now();

function stat(name: string): PollStat {
  let s = stats.get(name);
  if (!s) { s = { name, runs: 0, wallMs: 0, cpuMs: 0, spawns: 0, programs: {} }; stats.set(name, s); }
  return s;
}

function noteSpawn(file: unknown) {
  const prog = path.basename(String(file ?? '?'));
  const poll = current.getStore();
  if (poll) {
    const s = stat(poll);
    s.spawns++;
    s.programs[prog] = (s.programs[prog] ?? 0) + 1;
  } else outside.set(prog, (outside.get(prog) ?? 0) + 1);
}

if (pollLogOn) {
  // Count every program Keeper starts and which poll (if any) started it.
  const cp = childProcess as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const fn of ['spawn', 'execFile', 'exec', 'fork']) {
    const orig = cp[fn];
    if (typeof orig !== 'function') continue;
    try {
      cp[fn] = function (this: unknown, ...a: unknown[]) {
        noteSpawn(fn === 'exec' ? String(a[0]).split(/\s+/)[0] : a[0]);
        return orig.apply(this, a);
      };
    } catch {
      /* read-only in this runtime: counts stay at zero */
    }
  }
  // ES-module imports of child_process see the wrapped functions too.
  try { syncBuiltinESMExports(); } catch { /* bundled as CommonJS: nothing to sync */ }
}

/** Runs one poll, measured when KEEPER_POLL_LOG is on. */
export async function measuredRun(name: string, fn: () => unknown): Promise<void> {
  if (!pollLogOn) { await fn(); return; }
  const s = stat(name);
  const t0 = performance.now();
  const c0 = process.cpuUsage();
  const spawns0 = s.spawns;
  try {
    await current.run(name, async () => { await fn(); });
  } finally {
    const wall = performance.now() - t0;
    const c = process.cpuUsage(c0);
    const cpu = (c.user + c.system) / 1000;
    s.runs++;
    s.wallMs += wall;
    s.cpuMs += cpu;
    const started = s.spawns - spawns0;
    console.log(`[poll] ${name} ${wall.toFixed(1)}ms wall, ${cpu.toFixed(1)}ms cpu${started ? `, started ${started}: ${Object.keys(s.programs).join(' ')}` : ''}`);
  }
}

/** Totals since start, costliest first (main-process time plus about 15 ms per program started). */
export function pollLog(): PollLog | undefined {
  if (!pollLogOn) return undefined;
  const cost = (p: PollStat) => p.cpuMs + p.spawns * 15;
  return {
    since,
    polls: [...stats.values()].map((p) => ({ ...p, wallMs: Math.round(p.wallMs), cpuMs: Math.round(p.cpuMs * 10) / 10, programs: { ...p.programs } })).sort((a, b) => cost(b) - cost(a)),
    outside: [...outside.entries()].map(([program, count]) => ({ program, count })).sort((a, b) => b.count - a.count),
  };
}
