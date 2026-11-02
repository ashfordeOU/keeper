// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { cpuBudget, decide, DEFAULT_CONDITIONS, dutyCycle, paceMs, pollDelay, restMs, type Conditions } from '../core/governor';

const c = (patch: Partial<Conditions> = {}): Conditions => ({ ...DEFAULT_CONDITIONS, ...patch });

describe('when background work may run', () => {
  it('balanced: on battery the library stays right and filling in details waits for the charger', () => {
    expect(decide('text', c()).ok).toBe(true);
    expect(decide('embed', c()).ok).toBe(true);
    expect(decide('scan', c({ onBattery: true })).ok).toBe(true);
    expect(decide('sources', c({ onBattery: true })).ok).toBe(true);
    for (const k of ['details', 'text', 'thumbs', 'ocr', 'hash', 'embed'] as const) {
      const d = decide(k, c({ onBattery: true }));
      expect(d.ok).toBe(false);
      expect(d.reason).toMatch(/paused on battery/i);
    }
  });

  it('"Speed up now" lets everything run, even on battery, but never while asleep or very hot', () => {
    expect(decide('ocr', c({ onBattery: true, boost: true })).ok).toBe(true);
    expect(decide('text', c({ mode: 'minimal', boost: true })).ok).toBe(true);
    expect(decide('text', c({ boost: true, suspended: true })).ok).toBe(false);
    expect(restMs('ocr', c({ onBattery: true, boost: true }), 1000)).toBe(0);
  });

  it('keeps background work to a small share of the time while the person works', () => {
    // At the computer on mains power: a fifth of the time for quick reads, a tenth for heavy work.
    expect(dutyCycle('text', c())).toBe(0.2);
    expect(dutyCycle('ocr', c())).toBe(0.1);
    // An item that took 100 ms rests 400 ms (text) or 900 ms (heavy).
    expect(restMs('text', c(), 100)).toBe(400);
    expect(restMs('embed', c(), 100)).toBe(900);
    // Away: most of the time; on battery or in minimal mode: very little.
    expect(dutyCycle('text', c({ idleSec: 600 }))).toBeGreaterThan(dutyCycle('text', c()));
    expect(dutyCycle('text', c({ onBattery: true }))).toBeLessThanOrEqual(0.1);
    expect(dutyCycle('ocr', c({ mode: 'minimal' }))).toBeLessThanOrEqual(0.05);
    // Never less than the old gap, never more than half a minute, nothing in performance mode.
    expect(restMs('text', c(), 0)).toBe(paceMs('text', c()));
    expect(restMs('text', c(), 60_000)).toBe(30_000);
    expect(restMs('text', c({ mode: 'performance' }), 5000)).toBe(0);
  });

  it('never works while asleep or very hot, whatever the mode', () => {
    for (const mode of ['minimal', 'balanced', 'performance'] as const) {
      expect(decide('scan', c({ mode, suspended: true })).ok).toBe(false);
      expect(decide('ocr', c({ mode, thermal: 'critical' })).ok).toBe(false);
    }
  });

  it('heavy work pauses when hot or short of memory; light work carries on', () => {
    expect(decide('ocr', c({ thermal: 'serious' })).ok).toBe(false);
    expect(decide('hash', c({ memoryLow: true })).ok).toBe(false);
    expect(decide('sources', c({ thermal: 'serious', memoryLow: true })).ok).toBe(true);
  });

  it('minimal: only what keeps the library right, the rest when away on mains power', () => {
    expect(decide('scan', c({ mode: 'minimal', onBattery: true })).ok).toBe(true);
    expect(decide('text', c({ mode: 'minimal', idleSec: 5 })).reason).toMatch(/idle/);
    expect(decide('text', c({ mode: 'minimal', idleSec: 300 })).ok).toBe(true);
    expect(decide('ocr', c({ mode: 'minimal', locked: true })).ok).toBe(true);
    expect(decide('ocr', c({ mode: 'minimal', locked: true, onBattery: true })).ok).toBe(false);
    // The system's low power mode behaves like minimal.
    expect(decide('text', c({ lowPower: true, idleSec: 5 })).ok).toBe(false);
  });

  it('backs off when Keeper itself is over its processor budget', () => {
    expect(decide('text', c({ keeperCpu: cpuBudget(c()) * 2 })).ok).toBe(false);
    expect(decide('text', c({ keeperCpu: cpuBudget(c()) })).ok).toBe(true);
    expect(paceMs('text', c({ keeperCpu: cpuBudget(c()) * 4 }))).toBeGreaterThan(paceMs('text', c()));
  });

  it('performance does everything at once, and budgets follow the situation', () => {
    expect(decide('embed', c({ mode: 'performance', onBattery: true, keeperCpu: 300 })).ok).toBe(true);
    expect(paceMs('ocr', c({ mode: 'performance' }))).toBe(0);
    expect(cpuBudget(c({ locked: true }))).toBeGreaterThan(cpuBudget(c()));
    expect(cpuBudget(c({ onBattery: true }))).toBeLessThan(cpuBudget(c()));
    // Gaps between files are shorter when nobody is at the computer, longer on battery.
    expect(paceMs('ocr', c({ idleSec: 600 }))).toBeLessThan(paceMs('ocr', c()));
    expect(paceMs('text', c({ onBattery: true }))).toBeGreaterThan(paceMs('text', c()));
  });
});

describe('how often regular checks look', () => {
  const rule = { baseMs: 1000, idleFactor: 4, pauseWhenLocked: true };
  it('looks at the base rate while someone is there', () => {
    expect(pollDelay(rule, c())).toBe(1000);
  });
  it('slows down when nobody is there, on battery and in minimal mode', () => {
    expect(pollDelay(rule, c({ idleSec: 120 }))).toBe(4000);
    expect(pollDelay(rule, c({ onBattery: true }))).toBe(1500);
    expect(pollDelay(rule, c({ mode: 'minimal' }))).toBe(2000);
  });
  it('pauses while locked or asleep when asked, and respects the ceiling', () => {
    expect(pollDelay(rule, c({ locked: true }))).toBeNull();
    expect(pollDelay({ baseMs: 1000 }, c({ locked: true }))).toBe(4000);
    expect(pollDelay({ baseMs: 1000 }, c({ suspended: true }))).toBeNull();
    expect(pollDelay({ baseMs: 10 * 60_000, maxMs: 15 * 60_000 }, c({ idleSec: 999 }))).toBe(15 * 60_000);
  });
  it('performance keeps the base rate', () => {
    expect(pollDelay(rule, c({ mode: 'performance', idleSec: 999, onBattery: true }))).toBe(1000);
  });
});

describe('microphone in use on Windows, from reg.exe', () => {
  it('lists apps whose LastUsedTimeStop is 0', async () => {
    const { parseRegMicInUse } = await import('../core/awake');
    const out = [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Program Files#Zoom#bin#Zoom.exe',
      '    LastUsedTimeStop    REG_QWORD    0x0',
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Tools#old.exe',
      '    LastUsedTimeStop    REG_QWORD    0x1d9a6b3c1e2f000',
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe',
      '    LastUsedTimeStop    REG_QWORD    0x0',
      '',
      'End of search: 3 match(es) found.',
    ].join('\r\n');
    expect(parseRegMicInUse(out)).toEqual(['Zoom', 'Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe']);
    expect(parseRegMicInUse('ERROR: The system was unable to find the specified registry key or value.')).toEqual([]);
  });
});
