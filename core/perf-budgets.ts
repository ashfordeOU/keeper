// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What each running part of Keeper may use, shown to people (Settings →
// Battery and speed, About) and enforced by the build (test/e2e/perf-budget.cjs
// reads the same file, core/perf-budgets.json). The live view uses the
// system's working set per process; the build checks memory Keeper allocates
// itself, which is steadier between machines.

import budgets from './perf-budgets.json';
import type { KeeperProcess } from './api-session';

export interface LiveBudget { memoryMB: number; cpuPct: number }

export const TARGETS = budgets.targets;
export const LIVE: Record<string, LiveBudget> = budgets.live;

/** The budget a process is measured against: its own (a service or part by name), else its kind's. */
export function budgetKey(p: Pick<KeeperProcess, 'id' | 'kind'>): string {
  if (LIVE[p.id]) return p.id;
  if (p.id.startsWith('part:') || p.id.startsWith('svc:')) return 'service';
  if (p.kind === 'utility') return 'helper';
  return LIVE[p.kind] ? p.kind : 'helper';
}

export interface PartCost {
  id: string;
  label: string;
  memoryMB: number;
  cpuPct: number;
  budget: LiveBudget;
  /** over its memory or processor budget */
  over: 'memory' | 'cpu' | null;
  feature?: string;
}

const mb = (b: number) => b / 1048576;

/** Chromium names its helpers in code words ("network.mojom.NetworkService"): plain words instead. */
export function plainLabel(p: Pick<KeeperProcess, 'label' | 'kind'>): string {
  if (p.kind !== 'helper' && p.kind !== 'utility') return p.label;
  if (/network/i.test(p.label)) return 'Network helper';
  if (/audio/i.test(p.label)) return 'Sound helper';
  if (/storage/i.test(p.label)) return 'Storage helper';
  if (/\./.test(p.label) || /^[a-z]+[A-Z]/.test(p.label)) return 'Helper';
  return p.label;
}

/** Each running part with what it uses and its budget, the heaviest first. Not running: left out. */
export function partCosts(list: KeeperProcess[]): PartCost[] {
  return list
    .filter((p) => p.pid && p.state !== 'stopped')
    .map((p) => {
      const budget = LIVE[budgetKey(p)];
      const memoryMB = Math.round(mb(p.memory));
      const cpuPct = Math.round(p.cpu * 10) / 10;
      const over = memoryMB > budget.memoryMB ? 'memory' : cpuPct > budget.cpuPct ? 'cpu' : null;
      return { id: p.id, label: plainLabel(p), memoryMB, cpuPct, budget, over, ...(p.feature ? { feature: p.feature } : {}) } as PartCost;
    })
    .sort((a, b) => b.memoryMB - a.memoryMB);
}

/** "Keeper is using 410 MB" (all its processes together). */
export function usingLine(list: KeeperProcess[]): string {
  const total = list.filter((p) => p.pid).reduce((n, p) => n + p.memory, 0);
  const m = mb(total);
  return `Keeper is using ${m >= 1024 ? `${(m / 1024).toFixed(1)} GB` : `${Math.round(m)} MB`}`;
}

/** "Island 48 MB · 0.1% processor". */
export function costLine(c: PartCost): string {
  return `${c.memoryMB} MB · ${c.cpuPct.toFixed(1)}% processor`;
}

/** What to say about a part against its budget. */
export function budgetLine(c: PartCost): string {
  if (c.over === 'memory') return `Over its ${c.budget.memoryMB} MB`;
  if (c.over === 'cpu') return `Busier than its ${c.budget.cpuPct}%`;
  return 'Within its budget';
}

/** The build's per-part budgets for memory Keeper allocates itself (MB), by group. */
export const CI_ANON_MB: Record<string, number> = budgets.ci.anonMB;

/** The group a measured process belongs to in the build's check (perf-budget.cjs uses the same rule). */
export function ciGroup(p: { type: string; name?: string }): string {
  if (p.type === 'Part') return (p.name ?? '').split(' ')[0] || 'helpers';
  if (p.type === 'Browser') return 'main';
  if (p.type === 'Tab') return 'windows';
  if (p.type === 'GPU') return 'gpu';
  return 'helpers';
}
