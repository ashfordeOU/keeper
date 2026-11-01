// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { addMinute, appKey, decode, emptyStore, encode, importLegacy, mergePoint, peaks, pickTier, prune, query, series, toCsv, topApps, type MinuteReading } from '../core/monitor-history';

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const T0 = Date.UTC(2026, 0, 1);

const r = (t: number, cpu: number, extra: Partial<MinuteReading> = {}): MinuteReading => ({ t, cpu, mem: 50, ...extra });

describe('monitor history rollups', () => {
  it('rolls minutes into 5-minute, hourly and daily points with averages and peaks', () => {
    const s = emptyStore();
    for (let i = 0; i < 10; i++) addMinute(s, r(T0 + i * MIN, i * 10));
    expect(s.tiers['1m']).toHaveLength(10);
    expect(s.tiers['5m']).toHaveLength(2);
    expect(s.tiers['5m'][0].cpu).toBeCloseTo(20); // 0,10,20,30,40
    expect(s.tiers['5m'][0].cpuMax).toBe(40);
    expect(s.tiers['1h']).toHaveLength(1);
    expect(s.tiers['1h'][0].cpu).toBeCloseTo(45);
    expect(s.tiers['1h'][0].cpuMax).toBe(90);
    expect(s.tiers['1h'][0].n).toBe(10);
    expect(s.tiers['1d'][0].n).toBe(10);
  });

  it('treats missing readings as not measured, not zero', () => {
    const s = emptyStore();
    addMinute(s, r(T0, 10, { gpu: 40 }));
    addMinute(s, r(T0 + MIN, 30));
    expect(s.tiers['5m'][0].gpu).toBe(40);
    expect(Number.isNaN(s.tiers['5m'][0].power)).toBe(true);
  });

  it('ignores the same minute twice (a restart)', () => {
    const s = emptyStore();
    addMinute(s, r(T0, 10));
    addMinute(s, r(T0 + 20_000, 90));
    expect(s.tiers['1m']).toHaveLength(1);
    expect(s.tiers['1h'][0].n).toBe(1);
  });

  it('mergePoint weights by count', () => {
    const a = { ...emptyStore().tiers['1m'][0], t: 0, n: 3, cpu: 10, cpuMax: 10, mem: 1, memMax: 1, netIn: NaN, netOut: NaN, diskR: NaN, diskW: NaN, gpu: NaN, power: NaN, temp: NaN, battery: NaN };
    const b = { ...a, n: 1, cpu: 50, cpuMax: 80 };
    const m = mergePoint(a, b);
    expect(m.cpu).toBeCloseTo(20);
    expect(m.cpuMax).toBe(80);
    expect(m.n).toBe(4);
  });

  it('drops old points per tier and honours the retention setting', () => {
    const s = emptyStore();
    addMinute(s, r(T0, 10));
    addMinute(s, r(T0 + 3 * D, 10));
    expect(s.tiers['1m'].map((p) => p.t)).toEqual([T0 + 3 * D]);
    expect(s.tiers['1h']).toHaveLength(2);
    prune(s, T0 + 40 * D, 30);
    expect(s.tiers['1h']).toHaveLength(0);
    expect(s.tiers['5m']).toHaveLength(0);
  });

  it('chooses the finest tier that covers the range', () => {
    const s = emptyStore();
    for (let t = T0; t < T0 + 3 * D; t += MIN) addMinute(s, r(t, 20));
    const now = T0 + 3 * D;
    expect(pickTier(s, now - H, now)).toBe('1m');
    expect(pickTier(s, now - 2.5 * D, now, 1000)).toBe('5m');
    expect(pickTier(s, now - 3 * D, now, 100)).toBe('1h');
    expect(pickTier(s, now - 3 * D, now, 50)).toBe('1d');
    const q = query(s, now - 6 * H, now, 600);
    expect(q.tier).toBe('1m');
    expect(series(q, 'cpu', now - 6 * H, now)).toHaveLength(360);
  });

  it('series leaves gaps where nothing was recorded', () => {
    const s = emptyStore();
    addMinute(s, r(T0, 10));
    addMinute(s, r(T0 + 5 * MIN, 30));
    const q = query(s, T0, T0 + 10 * MIN, 600);
    const v = series(q, 'cpu', T0, T0 + 10 * MIN);
    expect(v[0]).toBe(10);
    expect(v[1]).toBeNull();
    expect(v[5]).toBe(30);
  });

  it('finds peaks with their time', () => {
    const s = emptyStore();
    addMinute(s, r(T0, 10, { netIn: 100 }));
    addMinute(s, r(T0 + MIN, 95, { netIn: 5000 }));
    const p = peaks(query(s, T0, T0 + H));
    expect(p.find((x) => x.metric === 'cpu')).toMatchObject({ value: 95, t: T0 + MIN });
    expect(p.find((x) => x.metric === 'netIn')?.value).toBe(5000);
  });

  it('keeps per-app hours and ranks by processor time', () => {
    const s = emptyStore();
    for (let i = 0; i < 30; i++) addMinute(s, r(T0 + i * MIN, 50, { apps: [{ name: 'Browser Helper (Renderer)', cpu: 40, memory: 1e9 }, { name: 'code.exe', cpu: 10, memory: 2e9 }] }));
    const top = topApps(s, T0, T0 + H);
    expect(top[0]).toMatchObject({ name: 'Browser', minutes: 30, cpuMinutes: 12, avgCpu: 40, peakMem: 1e9 });
    expect(top[1].name).toBe('code');
    expect(appKey('Editor Helper (GPU)')).toBe('Editor');
  });

  it('encodes compactly and decodes exactly; a damaged file reads as empty', () => {
    const s = emptyStore();
    for (let i = 0; i < 100; i++) addMinute(s, r(T0 + i * MIN, i % 100, { netIn: i * 1000, temp: 50 }));
    const bin = encode(s);
    const back = decode(bin);
    expect(back.tiers['1m']).toHaveLength(100);
    expect(back.tiers['1m'][42].cpu).toBe(42);
    expect(back.tiers['1m'][42].netIn).toBe(42000);
    expect(Number.isNaN(back.tiers['1m'][42].gpu)).toBe(true);
    expect(back.tiers['1h'][0].n).toBe(60);
    // About 54 bytes a point.
    expect(bin.byteLength).toBeLessThan(130 * 60);
    expect(decode(new Uint8Array([1, 2, 3, 4, 5])).tiers['1m']).toHaveLength(0);
    expect(decode(bin.slice(0, 200)).tiers['1m']).toHaveLength(0);
  });

  it('a year of history fits in about a megabyte', () => {
    const s = emptyStore();
    const now = T0 + 365 * D;
    for (let t = T0; t < now - 14 * D; t += H) addMinute(s, r(t, 10));
    for (let t = now - 14 * D; t < now; t += MIN) addMinute(s, r(t, 10));
    expect(encode(s).byteLength).toBeLessThan(1.5 * 1024 * 1024);
  });

  it('exports CSV with a header and blanks for missing values', () => {
    const s = emptyStore();
    addMinute(s, r(T0, 12.345));
    const csv = toCsv(query(s, T0, T0 + MIN));
    const [head, row] = csv.trim().split('\n');
    expect(head.startsWith('time,cpu,cpuMax,mem')).toBe(true);
    expect(row).toContain('12.35');
    expect(row).toContain(',,');
  });

  it('imports the old one-day samples once', () => {
    const s = importLegacy(emptyStore(), [{ t: T0, cpu: 5, memUsed: 1, memTotal: 4, top: [] }, { t: T0 + MIN, cpu: 7, memUsed: 2, memTotal: 4 }]);
    expect(s.tiers['1m']).toHaveLength(2);
    expect(s.tiers['1m'][1].mem).toBe(50);
    importLegacy(s, [{ t: T0 + 2 * MIN, cpu: 1, memUsed: 1, memTotal: 1 }]);
    expect(s.tiers['1m']).toHaveLength(2);
  });
});
