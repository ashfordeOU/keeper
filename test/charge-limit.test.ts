// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  chargePlan, defaultChargeSettings, normalizeChargeSettings, parseBehaviour, planWords, startFor, surfaceNote, sysfsTemp, thresholdFiles, thresholdPlan, tripEnd, udevRule,
  vendorApp, writeCommands, type SysfsBattery,
} from '../core/charge-limit';

const bat = (p: Partial<SysfsBattery> = {}): SysfsBattery => ({ name: 'BAT0', endFile: 'charge_control_end_threshold', startFile: 'charge_control_start_threshold', end: 100, start: 0, ...p });

describe('settings', () => {
  it('keeps the limit between 50 and 100 and heat between 35° and 50°', () => {
    expect(defaultChargeSettings()).toEqual({ limit: 80, tripUntil: 0, heat: false, hotC: 40 });
    expect(normalizeChargeSettings({ limit: 20, hotC: 90, heat: true } as never)).toEqual({ limit: 50, tripUntil: 0, heat: true, hotC: 50 });
    expect(normalizeChargeSettings({ limit: 'x' } as never).limit).toBe(80);
    expect(normalizeChargeSettings(undefined).limit).toBe(80);
  });
});

describe('Linux thresholds', () => {
  it('finds the new and the older file names', () => {
    expect(thresholdFiles(['capacity', 'charge_control_end_threshold', 'charge_control_start_threshold', 'charge_behaviour'])).toEqual({ endFile: 'charge_control_end_threshold', startFile: 'charge_control_start_threshold', behaviourFile: 'charge_behaviour' });
    expect(thresholdFiles(['charge_stop_threshold', 'charge_start_threshold'])).toEqual({ endFile: 'charge_stop_threshold', startFile: 'charge_start_threshold', behaviourFile: undefined });
    expect(thresholdFiles(['capacity'])).toEqual({ endFile: undefined, startFile: undefined, behaviourFile: undefined });
  });
  it('reads charge_behaviour and the battery’s temperature', () => {
    expect(parseBehaviour('[auto] inhibit-charge force-discharge')).toEqual({ current: 'auto', choices: ['auto', 'inhibit-charge', 'force-discharge'] });
    expect(parseBehaviour('inhibit-charge')).toEqual({ current: 'inhibit-charge', choices: ['inhibit-charge'] });
    expect(sysfsTemp('412')).toBe(41);
    expect(sysfsTemp('')).toBeUndefined();
    expect(sysfsTemp(undefined)).toBeUndefined();
  });
  it('starts again a few percent below the limit, and at any level with no limit', () => {
    expect(startFor(80)).toBe(75);
    expect(startFor(100)).toBe(0);
    expect(startFor(3)).toBe(0);
  });
  it('writes in an order every driver accepts', () => {
    expect(thresholdPlan(bat(), 80)).toEqual([{ file: 'charge_control_start_threshold', value: '75' }, { file: 'charge_control_end_threshold', value: '80' }]);
    // Raising past the current end: the end goes up first.
    expect(thresholdPlan(bat({ end: 60, start: 55 }), 90)).toEqual([{ file: 'charge_control_end_threshold', value: '90' }, { file: 'charge_control_start_threshold', value: '85' }]);
    // Lowering below the current start: the start comes down first.
    expect(thresholdPlan(bat({ end: 90, start: 85 }), 60)).toEqual([{ file: 'charge_control_start_threshold', value: '55' }, { file: 'charge_control_end_threshold', value: '60' }]);
    expect(thresholdPlan(bat({ startFile: undefined }), 80)).toEqual([{ file: 'charge_control_end_threshold', value: '80' }]);
    expect(thresholdPlan(bat({ endFile: undefined }), 80)).toEqual([]);
  });
  it('builds administrator commands from checked names only', () => {
    expect(writeCommands('', bat(), [{ file: 'charge_control_end_threshold', value: '80' }])).toEqual([{ file: 'sh', args: ['-c', 'printf %s 80 > /sys/class/power_supply/BAT0/charge_control_end_threshold'], admin: true }]);
    expect(() => writeCommands('', bat({ name: 'BAT0; rm -rf /' }), [])).toThrow();
    expect(() => writeCommands('', bat(), [{ file: '../../etc/passwd', value: '1' }])).toThrow();
    expect(() => writeCommands('', bat(), [{ file: 'charge_behaviour', value: 'auto; reboot' }])).toThrow();
  });
  it('writes a udev rule that keeps the limit, and lets the group change it when allowed', () => {
    const r = udevRule(bat({ behaviourFile: 'charge_behaviour' }), 80, 1000);
    expect(r).toContain('KERNEL=="BAT0"');
    expect(r).toContain('ATTR{charge_control_start_threshold}="75", ATTR{charge_control_end_threshold}="80"');
    expect(r).toContain('RUN+="/bin/chgrp 1000 /sys%p/charge_control_end_threshold /sys%p/charge_control_start_threshold /sys%p/charge_behaviour"');
    expect(udevRule(bat(), 80)).not.toContain('chgrp');
  });
});

describe('what to do now', () => {
  const s = { ...defaultChargeSettings(), heat: true };
  const now = Date.UTC(2026, 10, 4, 12);
  it('follows the limit, a trip and the heat, with a gap before resuming', () => {
    expect(chargePlan(s, now, 30)).toEqual({ end: 80, pause: false, reason: 'limit' });
    expect(chargePlan({ ...s, tripUntil: now + 1000 }, now, 45)).toEqual({ end: 100, pause: false, reason: 'trip' });
    expect(chargePlan(s, now, 41)).toEqual({ end: 80, pause: true, reason: 'heat' });
    expect(chargePlan(s, now, 39, true).pause).toBe(true);
    expect(chargePlan(s, now, 37, true).pause).toBe(false);
    expect(chargePlan({ ...s, heat: false }, now, 45).pause).toBe(false);
    expect(chargePlan({ ...s, limit: 100 }, now, 20).reason).toBe('off');
  });
  it('says it in a short line', () => {
    expect(planWords(chargePlan(s, now, 30), s)).toBe('Stops charging at 80%');
    expect(planWords(chargePlan(s, now, 42), s, 42)).toBe('Charging paused while the battery is warm (42°C)');
    expect(planWords({ end: 100, pause: false, reason: 'trip' }, { ...s, tripUntil: now }, undefined, () => 'Thu 09:00')).toBe('Full charge until Thu 09:00, then back to 80%');
  });
  it('ends a trip charge tomorrow morning, at least 12 hours away', () => {
    const at = new Date(2026, 10, 4, 22, 0).getTime();
    const end = new Date(tripEnd(at));
    expect(end.getDate()).toBe(5);
    expect(tripEnd(at) - at).toBeGreaterThanOrEqual(11 * 3600_000);
    const early = new Date(2026, 10, 4, 1, 0).getTime();
    expect(tripEnd(early) - early).toBeGreaterThanOrEqual(12 * 3600_000);
  });
});

describe('Windows: the maker’s app', () => {
  it('finds an installed app by name, else names it with a store search', () => {
    expect(vendorApp('LENOVO', [{ Name: 'Lenovo Vantage', AppID: 'E046963F.LenovoCompanion_k1h2ywk1493x8!App' }, { Name: 'Notepad', AppID: 'x' }])).toEqual({ maker: 'LENOVO', name: 'Lenovo Vantage', appId: 'E046963F.LenovoCompanion_k1h2ywk1493x8!App' });
    expect(vendorApp('ASUSTeK COMPUTER INC.', [])).toEqual({ maker: 'ASUSTeK COMPUTER INC.', name: 'MyASUS', store: 'ms-windows-store://search/?query=MyASUS' });
    expect(vendorApp('Dell Inc.', [{ Name: 'Dell Optimizer', AppID: 'd' }])?.appId).toBe('d');
    expect(vendorApp('Some Maker', [])).toBeNull();
  });
  it('points Surface owners to the firmware', () => {
    expect(surfaceNote('Microsoft Corporation', 'Surface Laptop 5')).toMatch(/UEFI/);
    expect(surfaceNote('Dell Inc.', 'XPS 13')).toBeUndefined();
  });
});
