// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  accelToCombo, appMatches, buttonFromLinuxCode, buttonFromNumber, buttonFromX11, buttonPresets, defaultInputRemap, mappingFor, miceFromProcDevices, normalizeInputRemap, parseButtonLine,
  RawButtonReader, remapAvailability, remapsFor, sendEvents, type MouseButton,
} from '../core/input-remap';
import { parseInputEvents } from '../core/voice/keys';

describe('mouse buttons: how each system names them', () => {
  it('Linux codes, X11 numbers and the Mac and Windows hooks’ lines', () => {
    expect([0x112, 0x113, 0x114, 0x115, 0x116, 0x110].map(buttonFromLinuxCode)).toEqual(['middle', 'back', 'forward', 'forward', 'back', null]);
    expect([1, 2, 3, 8, 9].map(buttonFromX11)).toEqual([null, 'middle', null, 'back', 'forward']);
    expect([2, 3, 4, 5].map(buttonFromNumber)).toEqual(['middle', 'back', 'forward', null]);
    expect(parseButtonLine('btn 3 down')).toEqual({ button: 'back', down: true });
    expect(parseButtonLine('btn 4 up')).toEqual({ button: 'forward', down: false });
    expect(parseButtonLine('ready')).toBeNull();
  });
  it('finds the mice in /proc/bus/input/devices', () => {
    const text = 'I: Bus=0003\nN: Name="Keyboard"\nH: Handlers=sysrq kbd event3\n\nI: Bus=0003\nN: Name="USB Mouse"\nH: Handlers=mouse0 event5\n\nN: Name="Touchpad"\nH: Handlers=event7 mouse1\n';
    expect(miceFromProcDevices(text)).toEqual(['/dev/input/event5', '/dev/input/event7']);
  });
  it('reads a side button press from a mouse device’s events', () => {
    const rec = (type: number, code: number, value: number) => { const b = new Uint8Array(24); const dv = new DataView(b.buffer); dv.setUint16(16, type, true); dv.setUint16(18, code, true); dv.setInt32(20, value, true); return b; };
    const buf = new Uint8Array([...rec(2, 0, 5), ...rec(1, 0x113, 1), ...rec(1, 0x113, 0)]);
    expect(parseInputEvents(buf).map((e) => [buttonFromLinuxCode(e.code), e.down])).toEqual([['back', true], ['back', false]]);
  });
  it('reads presses from xinput’s raw events, ignoring motion and releases', () => {
    const got: MouseButton[] = [];
    const r = new RawButtonReader((b) => got.push(b));
    for (const l of ['EVENT type 17 (RawMotion)', '    detail: 0', 'EVENT type 15 (RawButtonPress)', '    device: 2 (11)', '    detail: 8', 'EVENT type 16 (RawButtonRelease)', '    detail: 8', 'EVENT type 15 (RawButtonPress)', '    detail: 1', 'EVENT type 15 (RawButtonPress)', '    detail: 9']) r.line(l);
    expect(got).toEqual(['back', 'forward']);
  });
});

describe('mouse buttons and app shortcuts: what applies now', () => {
  it('matches an app by name, bundle id, program or window class, ignoring case', () => {
    expect(appMatches('notes', { app: 'Notes' })).toBe(true);
    expect(appMatches('com.apple.Notes', { app: 'Notes', appId: 'com.apple.Notes' })).toBe(true);
    expect(appMatches('firefox', { app: 'firefox.exe', appId: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' })).toBe(true);
    expect(appMatches('code', { app: 'Xcode' })).toBe(false);
    expect(appMatches('', { app: 'Anything' })).toBe(true);
  });
  it('a button’s job in the app in front comes before its every-app job', () => {
    const list = [
      { id: '1', button: 'back' as const, app: '', keys: 'Alt+Left' },
      { id: '2', button: 'back' as const, app: 'Editor', keys: 'Control+Z' },
      { id: '3', button: 'forward' as const, app: '', keys: '' },
    ];
    expect(mappingFor(list, 'back', { app: 'Editor' })?.id).toBe('2');
    expect(mappingFor(list, 'back', { app: 'Browser' })?.id).toBe('1');
    expect(mappingFor(list, 'forward', { app: 'Browser' })).toBeUndefined();
    expect(mappingFor(list, 'middle', { app: 'Browser' })).toBeUndefined();
  });
  it('app shortcuts apply only in their app, and only when complete', () => {
    const keys = [{ id: 'a', app: 'Notes', from: 'Control+D', to: 'Control+Shift+D' }, { id: 'b', app: 'Notes', from: '', to: 'X' }, { id: 'c', app: 'Mail', from: 'Control+D', to: 'Delete' }];
    expect(remapsFor(keys, { app: 'notes' }).map((k) => k.id)).toEqual(['a']);
    expect(remapsFor(keys, undefined)).toEqual([]);
  });
});

describe('sending keys', () => {
  it('accelerators become the computer tools’ combos, ⌘ on a Mac and Ctrl elsewhere', () => {
    expect(accelToCombo('CommandOrControl+Shift+T', 'darwin')).toBe('cmd+shift+t');
    expect(accelToCombo('CommandOrControl+Shift+T', 'linux')).toBe('ctrl+shift+t');
    expect(accelToCombo('Alt+Left', 'win32')).toBe('alt+left');
    expect(accelToCombo('Command+[', 'darwin')).toBe('cmd+[');
    expect(accelToCombo('Super+Tab', 'win32')).toBe('super+tab');
  });
  it('presses the modifiers, the key, and lets go in reverse order', () => {
    expect(sendEvents('Control+Shift+D', 'linux')).toEqual([
      { t: 'key', code: 'ControlLeft', down: true },
      { t: 'key', code: 'ShiftLeft', down: true },
      { t: 'key', code: 'KeyD', key: 'd', down: true, mods: { ctrl: true, shift: true } },
      { t: 'key', code: 'KeyD', key: 'd', down: false, mods: { ctrl: true, shift: true } },
      { t: 'key', code: 'ShiftLeft', down: false },
      { t: 'key', code: 'ControlLeft', down: false },
    ]);
  });
  it('lets go of the held shortcut’s modifiers that the new keys do not use first', () => {
    const ev = sendEvents('Delete', 'linux', 'Control+Alt+D');
    expect(ev.slice(0, 2)).toEqual([{ t: 'key', code: 'ControlLeft', down: false }, { t: 'key', code: 'AltLeft', down: false }]);
    expect(ev[2]).toMatchObject({ code: 'Delete', down: true });
    expect(sendEvents('Control+Shift+D', 'linux', 'Control+D')[0]).toEqual({ t: 'key', code: 'ControlLeft', down: true });
  });
  it('ready-made jobs use each system’s own keys', () => {
    expect(buttonPresets('darwin').find((p) => p.id === 'back')?.keys).toBe('Command+[');
    expect(buttonPresets('linux').find((p) => p.id === 'back')?.keys).toBe('Alt+Left');
    for (const p of buttonPresets('win32')) expect(() => sendEvents(p.keys, 'win32')).not.toThrow();
  });
});

describe('settings and what each system allows', () => {
  it('starts empty, never takes a button over unless asked, and drops broken rows', () => {
    expect(defaultInputRemap()).toEqual({ mouse: [], keys: [], takeOver: false });
    expect(normalizeInputRemap({ mouse: [{ id: 'x', button: 'side9', keys: 'A' }, { id: 'y', button: 'back', app: ' Mail ', keys: 'Alt+Left' }], keys: [null, { app: 'A', from: 'B', to: 'C' }], takeOver: 'yes' })).toEqual({
      mouse: [{ id: 'y', button: 'back', app: 'Mail', keys: 'Alt+Left' }], keys: [{ id: 'k0', app: 'A', from: 'B', to: 'C' }], takeOver: false,
    });
  });
  it('says what works, what needs a step, and what cannot be done', () => {
    expect(remapAvailability({ platform: 'darwin', helper: true, accessibility: true })).toMatchObject({ mouse: { state: 'ready' }, keys: { state: 'ready' }, canTakeOver: true });
    expect(remapAvailability({ platform: 'darwin', helper: true, accessibility: false }).keys.state).toBe('permission');
    expect(remapAvailability({ platform: 'win32' }).canTakeOver).toBe(true);
    const x11 = remapAvailability({ platform: 'linux', xinput: true, xdotool: true });
    expect(x11.mouse.state).toBe('ready');
    expect(x11.mouse.line).toMatch(/still does its own thing/);
    expect(x11.canTakeOver).toBe(false);
    expect(remapAvailability({ platform: 'linux', xdotool: true }).mouse.state).toBe('setup');
    const wl = remapAvailability({ platform: 'linux', wayland: true });
    expect(wl.keys.state).toBe('unsupported');
    expect(wl.mouse.hint).toMatch(/input/);
  });
});
