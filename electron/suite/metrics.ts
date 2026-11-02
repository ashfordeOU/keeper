// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What one of Keeper's programs (the app, or a part) uses, all its processes
// together. Memory is what the processes hold for themselves (private memory
// on Linux and Windows), so parts that share Keeper's libraries are not
// counted as if each had its own copy; elsewhere the resident size.

import { app } from 'electron';
import { readFileSync } from 'node:fs';

function privateOf(pid: number): number | null {
  if (process.platform !== 'linux') return null;
  try {
    const s = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const kb = (k: string) => Number(s.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
    return (kb('Private_Clean') + kb('Private_Dirty')) * 1024;
  } catch {
    return null;
  }
}

export function ownUsage(skip: (pid: number) => boolean = () => false): { memory: number; cpu: number; processes: number } {
  let memory = 0;
  let cpu = 0;
  let processes = 0;
  for (const m of app.getAppMetrics()) {
    if (skip(m.pid)) continue;
    processes++;
    const mem = m.memory as Electron.MemoryInfo & { privateBytes?: number };
    memory += privateOf(m.pid) ?? (mem.privateBytes ? mem.privateBytes * 1024 : (mem.workingSetSize ?? 0) * 1024);
    cpu += m.cpu?.percentCPUUsage ?? 0;
  }
  return { memory, cpu, processes };
}
