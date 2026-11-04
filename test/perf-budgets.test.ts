// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import type { KeeperProcess } from '../core/api-session';
import { budgetKey, budgetLine, CI_ANON_MB, ciGroup, costLine, LIVE, partCosts, TARGETS, usingLine } from '../core/perf-budgets';

const MB = 1048576;
const p = (id: string, kind: KeeperProcess['kind'], mb: number, cpu = 0, extra: Partial<KeeperProcess> = {}): KeeperProcess => ({ id, label: id, kind, pid: 1, state: 'running', cpu, memory: mb * MB, canStop: false, canRestart: false, ...extra });

describe('performance budgets', () => {
  it('has a budget for every kind of process and the targets from the plan', () => {
    for (const k of ['main', 'window', 'gpu', 'service', 'helper']) expect(LIVE[k].memoryMB).toBeGreaterThan(0);
    expect(TARGETS).toEqual({ coldStartSeconds: 2, idleCpuPct: 0.5, mainMemoryMB: 250, wakeupsPerSecond: 1 });
    expect(Object.keys(CI_ANON_MB).sort()).toEqual(['gpu', 'helpers', 'island', 'mail', 'main', 'widgets', 'windows']);
  });

  it('measures each part against its own budget, or its kind’s', () => {
    expect(budgetKey(p('part:island', 'service', 1))).toBe('part:island');
    expect(budgetKey(p('svc:brain', 'service', 1))).toBe('service');
    expect(budgetKey(p('helper:9', 'utility', 1))).toBe('helper');
    expect(budgetKey(p('window:3', 'window', 1))).toBe('window');
  });

  it('lists running parts heaviest first, says which are over, and adds them up', () => {
    const list = [p('main', 'main', 180, 0.4), p('part:island', 'service', 300, 0.1, { label: 'Island', feature: 'island' }), p('svc:x', 'service', 50, 0, { pid: undefined, state: 'idle' })];
    const c = partCosts(list);
    expect(c.map((x) => x.id)).toEqual(['part:island', 'main']);
    expect(c[0]).toMatchObject({ over: 'memory', feature: 'island' });
    expect(budgetLine(c[0])).toBe('Over its 250 MB');
    expect(budgetLine(c[1])).toBe('Within its budget');
    expect(costLine(c[1])).toBe('180 MB · 0.4% processor');
    expect(usingLine(list)).toBe('Keeper is using 480 MB');
    expect(usingLine([p('main', 'main', 1600)])).toBe('Keeper is using 1.6 GB');
    expect(budgetLine({ ...c[1], over: 'cpu' })).toBe('Busier than its 2%');
  });

  it('names Chromium’s helpers in plain words', () => {
    expect(partCosts([p('helper:7', 'utility', 20, 0, { label: 'network.mojom.NetworkService' })])[0].label).toBe('Network helper');
    expect(partCosts([p('helper:8', 'utility', 20, 0, { label: 'video_capture.mojom.VideoCaptureService' })])[0].label).toBe('Helper');
  });

  it('groups measured processes the way the build checks them', () => {
    expect(ciGroup({ type: 'Part', name: 'island renderer' })).toBe('island');
    expect(ciGroup({ type: 'Browser' })).toBe('main');
    expect(ciGroup({ type: 'Tab', name: 'app' })).toBe('windows');
    expect(ciGroup({ type: 'Utility', name: 'network' })).toBe('helpers');
  });
});
