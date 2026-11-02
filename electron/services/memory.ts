// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The one place Keeper reads how much memory is in use (core/memory.ts says how
// each system counts it). macOS asks keeper-helper, which is already running and
// answers from the kernel without a new process; without the helper, one
// `vm_stat` + `sysctl`. Linux reads /proc/meminfo. Readings are shared for two
// seconds, so the System view, the glance, the menu bar and the monitor together
// cost one reading.

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import { basicMemory, linuxMemory, macMemory, parseVmStat, type MacVmBytes, type MemoryStats } from '../../core/memory';
import { parseSwapusage } from '../../core/procs';
import { run } from '../../core/platform';

const FRESH_MS = 2000;

let last: { at: number; stats: MemoryStats } | undefined;
let busy: Promise<MemoryStats> | null = null;
/** The helper could not answer memory.stats (missing, or an older build): leave it alone until then. */
let helperBackoffUntil = 0;

type HelperCall = (method: string, params: unknown, timeoutMs: number) => Promise<unknown>;
let helperCall: HelperCall | undefined;
/**
 * The app hands in its keeper-helper (macOS); the `keeper` command line, which
 * shares this file without Electron, has none and reads `vm_stat` instead.
 */
export function useMemoryHelper(fn: HelperCall) {
  helperCall = fn;
  helperBackoffUntil = 0;
}

async function fromHelper(): Promise<MemoryStats | undefined> {
  if (!helperCall || Date.now() < helperBackoffUntil) return undefined;
  try {
    const r = (await helperCall('memory.stats', {}, 3000)) as Partial<MacVmBytes>;
    const m = macMemory({ ...r, total: r.total || os.totalmem() });
    if (m) return m;
    helperBackoffUntil = Date.now() + 10 * 60_000;
  } catch (e) {
    // No helper, or an older one without memory.stats: ask again much later. A slow answer: soon.
    helperBackoffUntil = Date.now() + (/not available|Unknown method/i.test(String(e)) ? 10 * 60_000 : 30_000);
  }
  return undefined;
}

async function fromVmStat(): Promise<MemoryStats | undefined> {
  const r = await run('/bin/sh', ['-c', '/usr/bin/vm_stat; echo @@KEEPER@@; /usr/sbin/sysctl -n vm.swapusage; echo @@KEEPER@@; /usr/sbin/sysctl -n kern.memorystatus_vm_pressure_level'], 4000);
  const [vm = '', swap = '', level = ''] = r.stdout.split('@@KEEPER@@\n');
  const s = parseSwapusage(swap);
  const n = level.trim() ? Number(level.trim()) : NaN;
  return macMemory({ ...parseVmStat(vm), total: os.totalmem(), swapTotal: s.total, swapUsed: s.used, pressureLevel: Number.isFinite(n) ? n : undefined });
}

async function readNow(): Promise<MemoryStats> {
  if (process.platform === 'darwin') {
    const m = (await fromHelper()) ?? (await fromVmStat().catch(() => undefined));
    if (m) return m;
  } else if (process.platform === 'linux') {
    const m = linuxMemory(await fsp.readFile('/proc/meminfo', 'utf8').catch(() => ''));
    if (m) return m;
  }
  return basicMemory(os.totalmem(), os.freemem());
}

/** Memory in use now; readings within two seconds of each other are shared. */
export function readMemory(): Promise<MemoryStats> {
  if (last && Date.now() - last.at < FRESH_MS) return Promise.resolve(last.stats);
  busy ??= readNow()
    .then((stats) => {
      last = { at: Date.now(), stats };
      return stats;
    })
    .finally(() => { busy = null; });
  return busy;
}

/**
 * For callers that must answer at once: the last reading (refreshed in the
 * background when older than maxAgeMs), or total − free before the first one.
 */
export function lastMemory(maxAgeMs = FRESH_MS): MemoryStats {
  if (!last || Date.now() - last.at >= maxAgeMs) void readMemory().catch(() => undefined);
  return last?.stats ?? basicMemory(os.totalmem(), os.freemem());
}
