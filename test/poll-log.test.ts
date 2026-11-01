// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// KEEPER_POLL_LOG=1: each regular check's cost and the programs it started.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { topPollers } from '../scripts/mac-test/src/areas/usage';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.restoreAllMocks(); });

describe('poll log', () => {
  it('is off unless asked for, and then measures nothing', async () => {
    vi.stubEnv('KEEPER_POLL_LOG', '');
    const m = await import('../electron/services/poll-log');
    let ran = 0;
    await m.measuredRun('x', () => { ran++; });
    expect(ran).toBe(1);
    expect(m.pollLog()).toBeUndefined();
  });

  it('counts runs, time and the programs each check starts', async () => {
    vi.stubEnv('KEEPER_POLL_LOG', '1');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const m = await import('../electron/services/poll-log');
    const cp = await import('node:child_process');
    const run = () => new Promise<void>((resolve) => cp.execFile(process.execPath, ['-e', '0'], () => resolve()));
    await m.measuredRun('island.media', async () => { await run(); await run(); });
    await m.measuredRun('island.media', () => undefined);
    await m.measuredRun('island.tick', () => undefined);
    await run(); // outside any check
    const log = m.pollLog()!;
    const media = log.polls.find((p) => p.name === 'island.media')!;
    expect(media.runs).toBe(2);
    expect(media.spawns).toBe(2);
    expect(Object.values(media.programs)).toEqual([2]);
    expect(log.polls[0].name).toBe('island.media');
    expect(log.outside.reduce((s, o) => s + o.count, 0)).toBe(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^\[poll\] island\.media [\d.]+ms wall, [\d.]+ms cpu, started 2: /));
  });

  it('the Mac test lists the costliest checks of the measured window', () => {
    const before = { polls: [{ name: 'a', runs: 1, wallMs: 10, cpuMs: 1, spawns: 1, programs: { osascript: 1 } }], outside: [{ program: 'ps', count: 2 }] };
    const after = { polls: [{ name: 'a', runs: 3, wallMs: 30, cpuMs: 3, spawns: 3, programs: { osascript: 3 } }, { name: 'b', runs: 4, wallMs: 4, cpuMs: 8, spawns: 0, programs: {} as Record<string, number> }, { name: 'c', runs: 0, wallMs: 0, cpuMs: 0, spawns: 0, programs: {} as Record<string, number> }], outside: [{ program: 'ps', count: 5 }] };
    const t = topPollers(before, after);
    expect(t.polls.map((p) => [p.name, p.runs, p.costMs, p.programs])).toEqual([['a', 2, 32, { osascript: 2 }], ['b', 4, 8, {}]]);
    expect(t.outside).toEqual([{ program: 'ps', count: 3 }]);
    expect(topPollers(undefined, undefined).polls).toEqual([]);
  });
});
