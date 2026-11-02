// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Memory in use as each system's own monitor counts it: vm_stat and the helper's
// counters on a Mac (Activity Monitor's figures), /proc/meminfo on Linux.
import { describe, expect, it } from 'vitest';
import { basicMemory, linuxMemory, macMemory, memoryDetail, memoryTone, parseVmStat, pressureFromLevel } from '../core/memory';
import { glanceCards } from '../core/glance';
import { defaultMonitorSettings, strainOf, trayTooltip, type LiveReading } from '../core/monitor-tray';
import { parseSwapusage } from '../core/procs';

const GiB = 1024 ** 3;
const TOTAL = 36 * GiB;

// A 36 GB Apple silicon Mac under heavy load. Activity Monitor at the same moment:
// App Memory 8.49 GB, Wired 6.37 GB, Compressed 16.39 GB, Cached Files 3.81 GB,
// Swap Used 24.63 GB. Keeper used to say 35.6 GB of 36 GB (total − free pages).
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               26214.
Pages active:                            400000.
Pages inactive:                          390093.
Pages speculative:                        16000.
Pages throttled:                              0.
Pages wired down:                        417464.
Pages purgeable:                          12000.
"Translation faults":                 912345678.
Pages copy-on-write:                   23456789.
Pages zero filled:                    456789012.
Pages reactivated:                     34567890.
Pages purged:                           1234567.
File-backed pages:                       237692.
Anonymous pages:                         568401.
Pages stored in compressor:             3612345.
Pages occupied by compressor:           1074135.
Decompressions:                        45678901.
Compressions:                          56789012.
Pageins:                               12345678.
Pageouts:                                123456.
Swapins:                                3456789.
Swapouts:                               4567890.
`;
const SWAPUSAGE = 'total = 25600.00M  used = 25221.12M  free = 378.88M  (encrypted)';

const MEMINFO = `MemTotal:       32763148 kB
MemFree:          812344 kB
MemAvailable:   19876544 kB
Buffers:          402112 kB
Cached:         17012388 kB
SwapCached:        12344 kB
Active:         12345678 kB
Inactive:       14567890 kB
SwapTotal:       8388604 kB
SwapFree:        6291452 kB
`;

describe('vm_stat', () => {
  it('reads the page size and the counters Activity Monitor uses, in bytes', () => {
    const v = parseVmStat(VM_STAT);
    expect(v.pageSize).toBe(16384);
    expect(v.free).toBe(26214 * 16384);
    expect(v.internal).toBe(568401 * 16384);
    expect(v.external).toBe(237692 * 16384);
    expect(v.purgeable).toBe(12000 * 16384);
    expect(v.wired).toBe(417464 * 16384);
    // Pages the compressor occupies, not the (larger) number of pages stored in it.
    expect(v.compressed).toBe(1074135 * 16384);
  });

  it('reads Intel Macs too (4 KB pages)', () => {
    const v = parseVmStat('Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free:   1000.\nAnonymous pages:   2000.\nPages wired down:   300.\nPages occupied by compressor:   10.\n');
    expect(v).toMatchObject({ pageSize: 4096, free: 4096000, internal: 8192000, wired: 1228800, compressed: 40960 });
    expect(v.purgeable).toBeUndefined();
  });

  it('gives nothing for output it does not recognise', () => {
    expect(parseVmStat('')).toEqual({});
    expect(macMemory({ ...parseVmStat('vm_stat: command not found'), total: TOTAL })).toBeUndefined();
  });
});

describe('macOS memory in use', () => {
  const swap = parseSwapusage(SWAPUSAGE);
  const m = macMemory({ ...parseVmStat(VM_STAT), total: TOTAL, swapTotal: swap.total, swapUsed: swap.used, pressureLevel: 4 })!;

  it('matches Activity Monitor part by part', () => {
    expect(m.app! / GiB).toBeCloseTo(8.49, 2);
    expect(m.wired! / GiB).toBeCloseTo(6.37, 2);
    expect(m.compressed! / GiB).toBeCloseTo(16.39, 2);
    expect(m.cached! / GiB).toBeCloseTo(3.81, 2);
    expect(m.swapUsed! / GiB).toBeCloseTo(24.63, 2);
    expect(m.pressure).toBe('critical');
  });

  it('counts App Memory + Wired + Compressed as used, not the file cache', () => {
    expect(m.used).toBe(m.app! + m.wired! + m.compressed!);
    // Activity Monitor said "Memory Used 32.13 GB"; its parts add up to 31.25 GB.
    expect(Math.abs(m.used / GiB - 32.13)).toBeLessThan(1);
    expect(m.available).toBe(TOTAL - m.used);
    // What Keeper used to show: total − free pages.
    const old = TOTAL - parseVmStat(VM_STAT).free!;
    expect(old / GiB).toBeCloseTo(35.6, 1);
    expect(m.used).toBeLessThan(old - 4 * GiB);
  });

  it('takes the helper’s bytes the same way', () => {
    const fromHelper = macMemory({ total: TOTAL, internal: 10 * GiB, purgeable: 1 * GiB, external: 3 * GiB, wired: 4 * GiB, compressed: 2 * GiB, free: 1 * GiB, pressureLevel: 1 })!;
    expect(fromHelper).toMatchObject({ used: 15 * GiB, app: 9 * GiB, cached: 4 * GiB, pressure: 'normal' });
  });

  it('never says more than all of it is used', () => {
    expect(macMemory({ total: 8 * GiB, internal: 6 * GiB, wired: 2 * GiB, compressed: 2 * GiB })!.used).toBe(8 * GiB);
  });
});

describe('memory pressure', () => {
  it('maps kern.memorystatus_vm_pressure_level', () => {
    expect(pressureFromLevel(1)).toBe('normal');
    expect(pressureFromLevel(2)).toBe('warning');
    expect(pressureFromLevel(4)).toBe('critical');
    expect(pressureFromLevel(0)).toBeUndefined();
    expect(pressureFromLevel(undefined)).toBeUndefined();
  });

  it('colours by pressure when there is one, else by how full memory is', () => {
    // A Mac nearly full of cache under normal pressure is fine; a half-full one under critical pressure is not.
    expect(memoryTone({ used: 35 * GiB, total: TOTAL, pressure: 'normal' })).toBe('ok');
    expect(memoryTone({ used: 18 * GiB, total: TOTAL, pressure: 'warning' })).toBe('warn');
    expect(memoryTone({ used: 18 * GiB, total: TOTAL, pressure: 'critical' })).toBe('bad');
    expect(memoryTone({ used: 18 * GiB, total: TOTAL })).toBe('ok');
    expect(memoryTone({ used: 28 * GiB, total: TOTAL })).toBe('warn');
    expect(memoryTone({ used: 33 * GiB, total: TOTAL })).toBe('bad');
  });

  it('colours the menu-bar reading and the glance the same way', () => {
    const r: LiveReading = { t: 0, cpu: 5, memUsed: 35 * GiB, memTotal: TOTAL, memPressure: 'normal' };
    expect(strainOf('mem', r)).toBe('ok');
    expect(strainOf('mem', { ...r, memUsed: 18 * GiB, memPressure: 'critical' })).toBe('high');
    expect(strainOf('mem', { ...r, memPressure: undefined })).toBe('high');
    const card = (memPressure?: 'normal' | 'warning' | 'critical') => glanceCards({ now: 0, system: { cpu: 5, memUsed: 34 * GiB, memTotal: TOTAL, memPressure } }, ['system'])[0];
    expect(card('normal').tone).toBe('ok');
    expect(card('warning').tone).toBe('warn');
    expect(card('critical').tone).toBe('bad');
    expect(card(undefined).tone).toBe('warn');
  });
});

describe('the explaining line', () => {
  it('names the cache, swap and compressed memory', () => {
    const swap = parseSwapusage(SWAPUSAGE);
    const m = macMemory({ ...parseVmStat(VM_STAT), total: TOTAL, swapUsed: swap.used, pressureLevel: 2 })!;
    expect(memoryDetail(m)).toBe('Cached 3.8 GB · Swap 24.6 GB · Compressed 16.4 GB');
    expect(memoryDetail(m, true)).toBe('Cached 3.8 GB · Swap 24.6 GB · Compressed 16.4 GB · pressure warning');
    expect(memoryDetail({})).toBe('');
  });

  it('goes into the menu-bar tooltip and the glance card', () => {
    const r: LiveReading = { t: 0, cpu: 5, memUsed: 32 * GiB, memTotal: TOTAL, memCached: 3.81 * GiB, swapUsed: 24.63 * GiB, memCompressed: 16.39 * GiB };
    expect(trayTooltip(r, defaultMonitorSettings().tray)).toContain('Memory: 89% (Cached 3.8 GB · Swap 24.6 GB · Compressed 16.4 GB)');
    const c = glanceCards({ now: 0, system: { cpu: 5, memUsed: 32 * GiB, memTotal: TOTAL, memPressure: 'normal', memDetail: 'Cached 3.8 GB' } }, ['system'])[0];
    expect(c.hint).toContain('Cached 3.8 GB');
    expect(c.hint).toContain('pressure normal');
  });
});

describe('Linux and Windows', () => {
  it('Linux: used is MemTotal − MemAvailable, not − MemFree', () => {
    const m = linuxMemory(MEMINFO)!;
    expect(m.total).toBe(32763148 * 1024);
    expect(m.available).toBe(19876544 * 1024);
    expect(m.used).toBe((32763148 - 19876544) * 1024);
    expect(m.cached).toBe((17012388 + 402112) * 1024);
    expect(m.swapTotal).toBe(8388604 * 1024);
    expect(m.swapUsed).toBe((8388604 - 6291452) * 1024);
    expect(m.pressure).toBeUndefined();
  });

  it('Linux without MemAvailable (old kernels) estimates it from free, buffers and cache', () => {
    const m = linuxMemory('MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 250 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n')!;
    expect(m.used).toBe(600 * 1024);
    expect(m.swapTotal).toBeUndefined();
    expect(linuxMemory('')).toBeUndefined();
  });

  it('Windows: total − free', () => {
    expect(basicMemory(16 * GiB, 6 * GiB)).toEqual({ total: 16 * GiB, used: 10 * GiB, available: 6 * GiB });
  });
});

describe('the shared reader', () => {
  it('reads this machine once for callers close together', async () => {
    const { lastMemory, readMemory } = await import('../electron/services/memory');
    const [a, b] = await Promise.all([readMemory(), readMemory()]);
    expect(a).toBe(b);
    expect(a.total).toBeGreaterThan(0);
    expect(a.used).toBeGreaterThan(0);
    expect(a.used).toBeLessThanOrEqual(a.total);
    expect(await readMemory()).toBe(a);
    expect(lastMemory()).toBe(a);
  });
});
