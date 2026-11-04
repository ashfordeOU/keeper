// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  autoPreset, backlightPercent, defaultDisplaysSettings, linuxBuiltIn, linuxModeCmd, modeKey, normalizeDisplaysSettings, parseKscreen, pickMode, presetChanges, presetFromNow,
  rateWords, sameMode, scheduledLevel, setKey, sizesOf, sizeWords, syncWrites, targetLevel, type ScreenInfo,
} from '../core/display-modes';

const mac: ScreenInfo = {
  id: '1', name: 'Built-in Retina Display', main: true, builtIn: true, how: 'mac',
  modes: [
    { id: '10', width: 1512, height: 982, refresh: 120, hidpi: true, current: true },
    { id: '11', width: 1512, height: 982, refresh: 60, hidpi: true },
    { id: '12', width: 1512, height: 982, refresh: 60 },
    { id: '13', width: 1800, height: 1169, refresh: 120, hidpi: true },
    { id: '14', width: 1024, height: 665, refresh: 120, hidpi: true },
  ],
};
const ext: ScreenInfo = { id: 'HDMI-1', name: 'HDMI 1', main: false, builtIn: false, how: 'xrandr', modes: [{ width: 3840, height: 2160, refresh: 60, current: true }, { width: 3840, height: 2160, refresh: 30 }, { width: 2560, height: 1440, refresh: 59.95 }] };

describe('modes', () => {
  it('groups modes by size, biggest first, with their refresh rates and sharpness', () => {
    expect(sizesOf(mac.modes)).toEqual([
      { width: 1800, height: 1169, rates: [120], hidpi: true, lowres: false },
      { width: 1512, height: 982, rates: [120, 60], hidpi: true, lowres: true },
      { width: 1024, height: 665, rates: [120], hidpi: true, lowres: false },
    ]);
  });
  it('picks the mode for a size, rate and sharpness', () => {
    expect(pickMode(mac.modes, { width: 1512, height: 982, refresh: 60, hidpi: false })?.id).toBe('12');
    expect(pickMode(mac.modes, { width: 1512, height: 982, refresh: 60, hidpi: true })?.id).toBe('11');
    expect(pickMode(mac.modes, { width: 1512, height: 982 })?.id).toBe('10');
    expect(pickMode(ext.modes, { width: 2560, height: 1440, refresh: 60 })?.refresh).toBe(59.95);
    expect(pickMode(ext.modes, { width: 1280, height: 720 })).toBeNull();
  });
  it('says sizes and rates plainly', () => {
    expect(sizeWords({ width: 1512, height: 982, hidpi: true })).toBe('1512 × 982 (sharp)');
    expect(rateWords(59.95)).toBe('59.95 Hz');
    expect(rateWords(60)).toBe('60 Hz');
    expect(rateWords(undefined)).toBe('Automatic');
    expect(modeKey({ width: 1, height: 2, refresh: 60, hidpi: true })).toBe('1x2@60h');
    expect(sameMode({ width: 1, height: 2, refresh: 59.95 }, { width: 1, height: 2, refresh: 60 })).toBe(true);
  });
  it('reads kscreen-doctor, built-in panels and makes safe commands', () => {
    const out = '\x1b[01;32mOutput: \x1b[0;0m1 eDP-1 enabled connected priority 1 Panel\n\tModes: 0:1920x1200@60*! 1:1920x1200@48 2:1280x800@60\nOutput: 2 HDMI-A-1 disabled disconnected\n';
    const k = parseKscreen(out);
    expect(k).toHaveLength(1);
    expect(k[0]).toMatchObject({ output: 'eDP-1', builtIn: true });
    expect(k[0].modes[0]).toEqual({ kid: '0', width: 1920, height: 1200, refresh: 60, current: true });
    expect(linuxBuiltIn('eDP-1') && linuxBuiltIn('LVDS1') && !linuxBuiltIn('HDMI-1')).toBe(true);
    expect(linuxModeCmd('xrandr', 'HDMI-1', { width: 2560, height: 1440, refresh: 59.95 })).toEqual({ file: 'xrandr', args: ['--output', 'HDMI-1', '--mode', '2560x1440', '--rate', '59.95'] });
    expect(linuxModeCmd('wlr', 'DP-2', { width: 1920, height: 1080, refresh: 60 })).toEqual({ file: 'wlr-randr', args: ['--output', 'DP-2', '--mode', '1920x1080@60Hz'] });
    expect(linuxModeCmd('kscreen', 'eDP-1', { width: 1280, height: 800, refresh: 60, kid: '2' } as never)).toEqual({ file: 'kscreen-doctor', args: ['output.eDP-1.mode.2'] });
    expect(() => linuxModeCmd('xrandr', 'HDMI-1; reboot', { width: 1, height: 1 })).toThrow();
  });
});

describe('presets', () => {
  it('keeps one preset per set of screens, whatever their order', () => {
    expect(setKey([ext, mac])).toBe(setKey([mac, ext]));
    const p = presetFromNow([mac, ext], '  Desk  ', 'p1');
    expect(p).toEqual({ id: 'p1', name: 'Desk', set: '1+HDMI-1', modes: { 1: { width: 1512, height: 982, refresh: 120, hidpi: true }, 'HDMI-1': { width: 3840, height: 2160, refresh: 60 } }, auto: false });
  });
  it('changes only what differs, and only screens that are connected', () => {
    const p = { ...presetFromNow([mac, ext], 'Desk', 'p1'), modes: { 1: { width: 1800, height: 1169, refresh: 120, hidpi: true }, 'HDMI-1': { width: 3840, height: 2160, refresh: 60 }, gone: { width: 800, height: 600 } } };
    const c = presetChanges(p, [mac, ext]);
    expect(c.map((x) => [x.screen.id, x.mode.id])).toEqual([['1', '13']]);
    expect(autoPreset([p], [mac, ext])).toBeNull();
    expect(autoPreset([{ ...p, auto: true }], [ext, mac])?.id).toBe('p1');
    expect(autoPreset([{ ...p, auto: true }], [mac])).toBeNull();
  });
});

describe('matched brightness', () => {
  const b = defaultDisplaysSettings().brightness;
  it('follows a day and evening level, also past midnight', () => {
    expect(scheduledLevel(b, 12 * 60)).toBe(80);
    expect(scheduledLevel(b, 20 * 60)).toBe(40);
    expect(scheduledLevel(b, 2 * 60)).toBe(40);
    expect(scheduledLevel({ ...b, eveningFrom: 13 * 60, eveningTo: 15 * 60 }, 14 * 60)).toBe(40);
    expect(scheduledLevel({ ...b, eveningFrom: 13 * 60, eveningTo: 15 * 60 }, 16 * 60)).toBe(80);
  });
  it('writes a monitor only when it should move by 3% or more, with its own offset', () => {
    expect(targetLevel(95, 10)).toBe(100);
    expect(targetLevel(5, -10)).toBe(0);
    expect(syncWrites(60, [{ id: 'a', last: 59 }, { id: 'b', last: 40 }, { id: 'c' }], { b: -10 })).toEqual([{ id: 'b', level: 50 }, { id: 'c', level: 60 }]);
  });
  it('reads the built-in backlight as a percent', () => {
    expect(backlightPercent('19200', '96000')).toBe(20);
    expect(backlightPercent('5', '0')).toBeUndefined();
    expect(backlightPercent(undefined, '10')).toBeUndefined();
  });
  it('cleans its settings', () => {
    const n = normalizeDisplaysSettings({ confirmSeconds: 99, brightness: { mode: 'weird', offsets: { a: 90, b: 'x' }, day: 140, eveningFrom: -60 }, presets: [{ id: 'p', name: 'x'.repeat(60), set: 'a', modes: {}, auto: 1 }, { nope: true }] } as never);
    expect(n.confirmSeconds).toBe(15);
    expect(n.brightness).toMatchObject({ mode: 'builtin', offsets: { a: 50 }, day: 100, eveningFrom: 23 * 60 });
    expect(n.presets).toEqual([{ id: 'p', name: 'x'.repeat(40), set: 'a', modes: {}, auto: false }]);
  });
});
