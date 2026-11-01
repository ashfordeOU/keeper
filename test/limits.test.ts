// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { CPU_START, cpuStep, DEFAULT_LIMITS as L, limitsFor, memoryActions } from '../core/limits';

describe('processor ceiling', () => {
  it('steps back only after staying above the ceiling for the whole stretch', () => {
    let s = CPU_START;
    let r = cpuStep(s, 80, false, 1_000, L);
    expect(r.act).toBe(false);
    s = r.state;
    r = cpuStep(s, 80, false, 1_000 + L.cpuSustainMs - 1, L);
    expect(r.act).toBe(false);
    r = cpuStep(r.state, 80, false, 1_000 + L.cpuSustainMs, L);
    expect(r.act).toBe(true);
    // not again straight away
    let t = 1_000 + L.cpuSustainMs;
    let again = r.state;
    for (let i = 0; i < 10; i++) { t += 15_000; const x = cpuStep(again, 90, false, t, L); expect(x.act).toBe(false); again = x.state; }
  });
  it('a dip below the ceiling starts the count again', () => {
    let s = cpuStep(CPU_START, 80, false, 0, L).state;
    s = cpuStep(s, 5, false, 60_000, L).state;
    expect(cpuStep(s, 80, false, L.cpuSustainMs + 1, L).act).toBe(false);
  });
  it('never holds back what the person is doing in Keeper', () => {
    let s = CPU_START;
    for (let t = 0; t < 10 * 60_000; t += 15_000) { const r = cpuStep(s, 300, true, t, L); expect(r.act).toBe(false); s = r.state; }
  });
  it('minimal mode is stricter, performance looser', () => {
    expect(limitsFor('minimal').cpuCeiling).toBeLessThan(L.cpuCeiling);
    expect(limitsFor('performance').cpuCeiling).toBeGreaterThan(L.cpuCeiling);
  });
});

describe('memory ceilings', () => {
  it('restarts services, reloads hidden windows, stops helpers — never a visible window', () => {
    const big = 4e9;
    const a = memoryActions([
      { id: 'svc:net', kind: 'service', memory: big },
      { id: 'window:1', kind: 'window', memory: big, visible: true },
      { id: 'window:2', kind: 'window', memory: big, visible: false },
      { id: 'helper:9', kind: 'helper', memory: big },
      { id: 'svc:ok', kind: 'service', memory: 10e6 },
    ], L);
    expect(a.map((x) => `${x.id}:${x.action}`)).toEqual(['svc:net:restart', 'window:2:reload', 'helper:9:stop']);
  });
});
