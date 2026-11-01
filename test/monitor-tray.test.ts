// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  defaultMonitorSettings, drawText, inkFor, metricText, metricValue, normalizeMonitorSettings, pushRing, renderIcon, scaleFor, shortRate, strainOf, textWidth, toBgra, trayTitle, trayTooltip,
  type LiveReading,
} from '../core/monitor-tray';

const GB = 1024 ** 3;
const reading: LiveReading = { t: 0, cpu: 23.4, memUsed: 6 * GB, memTotal: 16 * GB, netIn: 1.5 * 1024 * 1024, netOut: 40 * 1024, diskR: 2048, diskW: 0, gpu: 91, temp: 82.4, power: 7.25, battery: 15, charging: false };
const S = defaultMonitorSettings().tray;

describe('menu-bar readings', () => {
  it('formats short rates in bytes and bits', () => {
    expect(shortRate(512)).toBe('512B');
    expect(shortRate(1536)).toBe('1.5K');
    expect(shortRate(150 * 1024 * 1024)).toBe('150M');
    expect(shortRate(1_000_000 / 8, 'bits')).toBe('1.0M');
    expect(shortRate(undefined)).toBe('–');
  });

  it('writes each metric', () => {
    expect(metricText('cpu', reading, S)).toBe('23%');
    expect(metricText('mem', reading, S)).toBe('38%');
    expect(metricText('mem', reading, { ...S, memShows: 'free' })).toBe('63%');
    expect(metricText('net', reading, S)).toBe('↓1.5M ↑40K');
    expect(metricText('temp', reading, S)).toBe('82°');
    expect(metricText('temp', reading, { ...S, tempUnit: 'f' })).toBe('180°');
    expect(metricText('power', reading, S)).toBe('7.3W');
    expect(metricText('gpu', { ...reading, gpu: undefined }, S)).toBe('–');
    expect(trayTitle(['cpu', 'mem'], reading, S)).toBe('23%  38%');
    expect(trayTitle(['cpu'], reading, S, true)).toBe('CPU 23%');
    expect(trayTooltip(reading, S)).toContain('Processor: 23%');
    expect(metricValue('disk', reading)).toBe(2048);
  });

  it('turns amber and red under strain', () => {
    expect(strainOf('cpu', reading)).toBe('ok');
    expect(strainOf('cpu', { ...reading, cpu: 70 })).toBe('warn');
    expect(strainOf('gpu', reading)).toBe('high');
    expect(strainOf('temp', reading)).toBe('warn');
    expect(strainOf('battery', reading)).toBe('warn');
    expect(strainOf('battery', { ...reading, charging: true })).toBe('ok');
    expect(inkFor('high', false, true)).toEqual([235, 64, 52, 255]);
    expect(inkFor('high', true, false)).toEqual([240, 240, 240, 255]);
  });

  it('scales sparklines: percentages to 100, rates to their own peak', () => {
    expect(scaleFor('cpu', [5])).toBe(100);
    expect(scaleFor('net', [1e6, 2e6])).toBeCloseTo(2.3e6);
    expect(scaleFor('net', [0])).toBe(64 * 1024);
  });

  it('draws text and a sparkline into a bitmap', () => {
    const b = renderIcon({ width: 32, height: 32, values: [0, 50, 100], max: 100, text: '42%', color: [255, 0, 0, 255] });
    expect(b.data.length).toBe(32 * 32 * 4);
    const alpha = (x: number, y: number) => b.data[(y * 32 + x) * 4 + 3];
    // The last column (100) is filled to the top of the graph area; the first (0) has its 1-pixel floor.
    expect(alpha(31, 12)).toBe(255);
    expect(alpha(31, 31)).toBeGreaterThan(0);
    expect(alpha(29, 20)).toBe(0);
    // Some text pixels at the top.
    let lit = 0;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 32; x++) if (alpha(x, y)) lit++;
    expect(lit).toBeGreaterThan(20);
    expect(textWidth('42%', 2)).toBe(22);
  });

  it('graph-only and text-only pictures', () => {
    const g = renderIcon({ width: 10, height: 10, values: [100], max: 100, color: [0, 0, 0, 255], graph: false, text: '1' });
    expect(g.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
    const blank = renderIcon({ width: 4, height: 4, values: [], max: 1, color: [0, 0, 0, 255] });
    expect(blank.data.every((v) => v === 0)).toBe(true);
    const b = { width: 3, height: 5, data: new Uint8Array(60) };
    drawText(b, '1', 0, 0, [9, 8, 7, 255]);
    expect(b.data[4 * 1 + 3]).toBe(255);
  });

  it('converts to BGRA for the system', () => {
    const out = toBgra({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 4]) });
    expect([...out]).toEqual([3, 2, 1, 4]);
  });

  it('normalises settings leniently', () => {
    const d = normalizeMonitorSettings({ tray: { metrics: ['cpu', 'bogus', 'cpu', 'gpu'], intervalSec: 7, layout: 'separate' }, retentionDays: 12, output: { mode: 'dated' }, quietApps: ['A', 3] });
    expect(d.tray.metrics).toEqual(['cpu', 'gpu']);
    expect(d.tray.intervalSec).toBe(2);
    expect(d.tray.layout).toBe('separate');
    expect(d.retentionDays).toBe(365);
    expect(d.output.mode).toBe('dated');
    expect(d.quietApps).toEqual(['A']);
    expect(d.surfaces.tray).toBe(false);
    expect(normalizeMonitorSettings({ tray: { metrics: [] } }).tray.metrics).toEqual(['cpu', 'mem', 'net']);
  });

  it('keeps a bounded ring', () => {
    const r: number[] = [];
    for (let i = 0; i < 10; i++) pushRing(r, i, 4);
    expect(r).toEqual([6, 7, 8, 9]);
  });
});
