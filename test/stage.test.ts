// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { PwDumpStream, grabberSources, macWindowSources, newTracker, recorderSources, screencastNodes, track } from '../core/stage/capture';
import { chooseMode, dedupe, parseWinModes, parseWlrRandr, parseXrandr } from '../core/stage/display';
import { addPending, decide, dropEntry, markApplied, newJournal, parseJournal, revertOrder } from '../core/stage/journal';
import { parseMacEvent, parseWinHookLine, parseXmodmap, vkName, XinputParser, type InputEvent } from '../core/stage/keys';
import { backdropHtml, keyLabel, overlayHtml, showKey, spotRadius } from '../core/stage/overlay';
import { planStage, staysOnScreen, SWITCHES, type StageEnv } from '../core/stage/plan';
import { BUILT_IN, copyPreset, countOn, defaultStageSettings, LEGACY_PRESENTATION, NO_SWITCHES, normalizeStageSettings } from '../core/stage/presets';
import { redactIsland } from '../core/stage/private';
import { parseRead, readCmd, restoreScript, targetKey, UNSET, winSetModeScript, writeCmds } from '../core/stage/targets';
import type { JournalEntry, StageSwitches } from '../core/stage/types';
import { inputLabel, inputsFromCapabilities, inputsFromDdcutilCapabilities, parseDdcutilInput, stepLevel } from '../core/display-control';
import type { IslandState } from '../core/api';

const env = (p: Partial<StageEnv> = {}): StageEnv => ({ os: 'linux', desktop: 'ubuntu:gnome', wayland: false, tools: ['gsettings', 'gnome-extensions', 'wmctrl', 'xdotool', 'xinput', 'xrandr'], schemas: ['org.gnome.desktop.interface', 'org.gnome.desktop.sound', 'org.gnome.shell.extensions.dash-to-dock'], extensions: ['ding@rastersoft.com'], ...p });
const sw = (p: Partial<StageSwitches>): StageSwitches => ({ ...structuredClone(NO_SWITCHES), ...p });

describe('presets and settings', () => {
  it('comes with Recording, Presenting and Screenshot, each a different set of switches', () => {
    const s = defaultStageSettings();
    expect(s.presets.map((p) => p.id)).toEqual(['recording', 'presenting', 'screenshot']);
    expect(s.presets.every((p) => p.builtIn)).toBe(true);
    expect(countOn(BUILT_IN[0].switches)).toBeGreaterThan(countOn(BUILT_IN[1].switches));
    expect(BUILT_IN[0].countdown).toBe(3);
  });
  it('keeps your edits to built-in presets, adds missing ones back and drops junk', () => {
    const edited = { ...BUILT_IN[1], switches: { ...BUILT_IN[1].switches, clicks: true } };
    const n = normalizeStageSettings({ presets: [edited, { id: 'bad id!', name: 7 }, null], preset: 'nope', shortcut: 5, auto: { preset: 'presenting', extraApps: ['X', 3] }, displayKeys: { step: 999 } });
    expect(n.presets.map((p) => p.id)).toEqual(['recording', 'presenting', 'screenshot', 'custom-2']);
    expect(n.presets.find((p) => p.id === 'presenting')!.switches.clicks).toBe(true);
    expect(n.preset).toBe('recording');
    expect(n.shortcut).toBe(defaultStageSettings().shortcut);
    expect(n.auto.preset).toBe('presenting');
    expect(n.auto.extraApps).toEqual(['X']);
    expect(n.displayKeys.step).toBe(50);
  });
  it('clamps and validates switch values', () => {
    const n = normalizeStageSettings({ presets: [{ id: 'mine', name: 'Mine', switches: { backdrop: { kind: 'blur', color: 'red' }, spotlight: { mode: 'laser', dim: 500 }, resolution: { mode: 'set', width: 10 }, apps: [{ name: ' Slack ', action: 'quit', reopen: true }, { name: '' }] }, countdown: 99 }] });
    const p = n.presets.find((x) => x.id === 'mine')!;
    expect(p.switches.backdrop).toEqual({ kind: 'blur', color: NO_SWITCHES.backdrop.color, color2: NO_SWITCHES.backdrop.color2 });
    expect(p.switches.spotlight).toEqual({ mode: 'off', size: 'm', dim: 90 });
    expect(p.switches.resolution).toEqual({ mode: 'set', width: 640, height: 1080 });
    expect(p.switches.apps).toEqual([{ name: 'Slack', action: 'quit', reopen: true }]);
    expect(p.countdown).toBe(10);
  });
  it('copies a preset under a free id', () => {
    const c = copyPreset(BUILT_IN[0], 'Demo', [...BUILT_IN, { ...BUILT_IN[0], id: 'custom-1' }]);
    expect(c.id).toBe('custom-2');
    expect(c.builtIn).toBeUndefined();
    expect(c.switches).toEqual(BUILT_IN[0].switches);
  });
  it('keeps presentation mode exactly as it was: awake and no desktop icons', () => {
    expect(countOn(LEGACY_PRESENTATION.switches)).toBe(2);
    expect(LEGACY_PRESENTATION.switches.keepAwake && LEGACY_PRESENTATION.switches.hideDesktopIcons).toBe(true);
  });
});

describe('the plan on each system', () => {
  it('macOS: Finder default, Dock and menu bar through System Events, alert volume', () => {
    const p = planStage(sw({ hideDesktopIcons: true, hideDock: true, hideMenuBar: true, muteAlerts: true, neutralCursor: true, dnd: true }), env({ os: 'darwin' }));
    expect(p.values.map((v) => targetKey(v.target))).toEqual(['defaults:com.apple.finder:CreateDesktop', 'osa:dock-autohide', 'osa:menubar-autohide', 'osa:alert-volume']);
    expect(p.actions).toEqual(expect.arrayContaining(['neutralCursor', 'dnd']));
  });
  it('Windows: desktop icons, taskbar, toast banners, notification sounds, pointer size', () => {
    const p = planStage(sw({ hideDesktopIcons: true, hideDock: true, hideMenuBar: true, dnd: true, muteAlerts: true, neutralCursor: true }), env({ os: 'win32' }));
    const keys = p.values.map((v) => targetKey(v.target));
    expect(keys.filter((k) => k === 'taskbar')).toHaveLength(1);
    expect(keys).toContain('desktop-icons');
    expect(keys.some((k) => k.endsWith('PushNotifications:ToastEnabled'))).toBe(true);
    expect(keys.filter((k) => k.includes('AppEvents')).length).toBeGreaterThan(3);
    expect(p.actions).not.toContain('dnd');
  });
  it('Linux GNOME: the desktop-icons extension, the dock, event sounds, pointer size', () => {
    const p = planStage(sw({ hideDesktopIcons: true, hideDock: true, muteAlerts: true, neutralCursor: true, hideMenuBar: true, keepKeeperOut: true }), env());
    expect(p.values.map((v) => targetKey(v.target))).toEqual(['ext:ding@rastersoft.com', 'gsettings:org.gnome.shell.extensions.dash-to-dock:dock-fixed', 'gsettings:org.gnome.shell.extensions.dash-to-dock:autohide', 'gsettings:org.gnome.desktop.sound:event-sounds', 'gsettings:org.gnome.desktop.interface:cursor-size']);
    expect(p.skipped.map((s) => s.switch)).toEqual(['hideMenuBar', 'keepKeeperOut']);
  });
  it('Linux KDE and Xfce, and honest skips on Wayland', () => {
    const kde = planStage(sw({ hideDock: true, hideDesktopIcons: true }), env({ desktop: 'kde', tools: ['qdbus6'], schemas: [], extensions: [] }));
    expect(kde.values[0].target).toEqual({ t: 'kde-panel', qdbus: 'qdbus6' });
    expect(kde.skipped[0].note).toMatch(/KDE/);
    const xfce = planStage(sw({ hideDesktopIcons: true }), env({ desktop: 'xfce', tools: ['xfconf-query'], schemas: [], extensions: [] }));
    expect(targetKey(xfce.values[0].target)).toBe('xfconf:xfce4-desktop:/desktop-icons/style');
    const way = planStage(sw({ hideOtherApps: true, keystrokes: 'all', clicks: true }), env({ wayland: true, tools: [] }));
    expect(way.actions).toEqual([]);
    expect(way.skipped.map((s) => s.switch)).toEqual(['hideOtherApps', 'clicks', 'keystrokes']);
  });
  it('every switch has an honest row for every system', () => {
    const ids = Object.keys(NO_SWITCHES);
    expect(SWITCHES.map((s) => s.id).sort()).toEqual(ids.sort());
    for (const s of SWITCHES) for (const os of ['darwin', 'win32', 'linux'] as const) {
      expect(['built', 'partial', 'guide', 'none']).toContain(s.support[os].how);
      if (s.support[os].how !== 'built') expect(s.support[os].note).toBeTruthy();
    }
  });
  it('recorders, call apps and the person\'s list stay on screen', () => {
    expect(staysOnScreen('obs64.exe', [], ['OBS', 'obs64'])).toBe(true);
    expect(staysOnScreen('zoom.us', [], ['zoom.us'])).toBe(true);
    expect(staysOnScreen('Keeper', [], [])).toBe(true);
    expect(staysOnScreen('Mail', ['Notes'], ['OBS'])).toBe(false);
    expect(staysOnScreen('Google Chrome Helper', ['Google Chrome'], [])).toBe(true);
  });
});

describe('reading and writing settings', () => {
  it('reads defaults booleans and treats a missing key as unset', () => {
    const t = { t: 'mac-defaults', domain: 'com.apple.finder', key: 'CreateDesktop', type: 'bool' } as const;
    expect(parseRead(t, true, '0\n')).toBe('false');
    expect(parseRead(t, true, '1')).toBe('true');
    expect(parseRead(t, false, '')).toBe(UNSET);
    expect(writeCmds(t, UNSET)[0]).toEqual({ cmd: '/usr/bin/defaults', args: ['delete', 'com.apple.finder', 'CreateDesktop'] });
    expect(writeCmds({ ...t, after: 'Finder' }, 'false').map((c) => ('cmd' in c ? c.args : []))).toEqual([['write', 'com.apple.finder', 'CreateDesktop', '-bool', 'false'], ['Finder']]);
  });
  it('GNOME extensions read from the enabled list', () => {
    const t = { t: 'gnome-ext', uuid: 'ding@rastersoft.com' } as const;
    expect(parseRead(t, true, 'a@b\nding@rastersoft.com\n')).toBe('true');
    expect(parseRead(t, true, 'a@b\n')).toBe('false');
    expect(writeCmds(t, 'false')).toEqual([{ cmd: 'gnome-extensions', args: ['disable', 'ding@rastersoft.com'] }]);
  });
  it('Windows registry values: quoting, unset and the pointer refresh', () => {
    const t = { t: 'win-reg', path: "HKCU:\\Control Panel\\Cursors", name: 'CursorBaseSize', type: 'DWORD', after: 'cursors' } as const;
    const w = writeCmds(t, '32')[0];
    expect('ps' in w && w.ps).toMatch(/-Value 32 -PropertyType DWORD/);
    expect('ps' in w && w.ps).toMatch(/SystemParametersInfo\(0x57/);
    const r = readCmd({ ...t, name: "it's" });
    expect('ps' in r && r.ps).toContain("'it''s'");
    expect(parseRead(t, true, '<unset>\r\n')).toBe(UNSET);
  });
  it('the alert volume is a number', () => {
    const t = { t: 'mac-osa', prop: 'alert-volume' } as const;
    expect(parseRead(t, true, '75\n')).toBe('75');
    expect(parseRead(t, true, 'missing value')).toBeNull();
    expect(writeCmds(t, '0')).toEqual([{ cmd: '/usr/bin/osascript', args: ['-e', 'set volume alert volume 0'] }]);
  });
  it('Windows screen size script asks for the main display when none is given', () => {
    expect(winSetModeScript('', 1920, 1080, 60)).toContain('[KeeperMode]::Set([NullString]::Value, 1920, 1080, 60)');
  });
});

const entry = (p: Partial<JournalEntry>): JournalEntry => ({ seq: 1, switch: 'hideDock', label: 'Dock', target: { t: 'gsettings', schema: 's', key: 'k' }, prior: 'false', applied: 'true', state: 'applied', at: 0, ...p });

describe('the journal', () => {
  it('writes each change before it happens and reverts newest first', () => {
    const j = newJournal(42, 'recording', 1);
    const a = addPending(j, { switch: 'hideDock', label: 'A', target: { t: 'win-taskbar' }, prior: 'false', applied: 'true' });
    const b = addPending(j, { switch: 'muteAlerts', label: 'B', target: { t: 'focus' } });
    expect(j.entries.map((e) => e.state)).toEqual(['pending', 'pending']);
    markApplied(j, a, { applied: 'true' });
    expect(j.entries[0].state).toBe('applied');
    expect(revertOrder(j).map((e) => e.label)).toEqual(['B', 'A']);
    dropEntry(j, b);
    expect(j.entries).toHaveLength(1);
    expect(addPending(j, { switch: 'dnd', label: 'C', target: { t: 'awake' } })).toBe(2);
  });
  it('leaves a setting the person changed alone, and does nothing twice', () => {
    expect(decide(entry({}), 'true')).toBe('restore');
    expect(decide(entry({}), 'false')).toBe('already');
    expect(decide(entry({ prior: "'prefer-light'", applied: "'prefer-dark'" }), "'default'")).toBe('left');
    expect(decide(entry({}), null)).toBe('unknown');
    expect(decide(entry({ target: { t: 'awake' }, prior: undefined, applied: undefined }), null)).toBe('restore');
  });
  it('reads a journal back from disk and ignores junk', () => {
    expect(parseJournal('{oops')).toBeNull();
    expect(parseJournal(JSON.stringify({ pid: 1, startedAt: 0, preset: 'x', entries: [entry({}), { seq: 2 }, null] }))!.entries).toHaveLength(1);
  });
  it('the watchdog script restores only what still holds Stage\'s value, newest first', () => {
    const j = [
      entry({ seq: 1, label: 'icons', target: { t: 'mac-defaults', domain: 'com.apple.finder', key: 'CreateDesktop', type: 'bool', after: 'Finder' }, prior: 'true', applied: 'false' }),
      entry({ seq: 2, label: 'dock', target: { t: 'mac-osa', prop: 'dock-autohide' }, prior: 'false', applied: 'true' }),
      entry({ seq: 3, label: 'apps', target: { t: 'apps-hidden', ids: ['Mail', 'Notes "2"'], how: 'mac' } }),
    ];
    const sh = restoreScript(j, 'darwin');
    const lines = sh.split('\n');
    expect(lines[0]).toBe('#!/bin/sh');
    expect(lines.findIndex((l) => l.includes('Mail'))).toBeLessThan(lines.findIndex((l) => l.includes('dock preferences')));
    expect(sh).toContain(`[ "$('/usr/bin/defaults' 'read' 'com.apple.finder' 'CreateDesktop' 2>/dev/null)" = '0' ] && '/usr/bin/defaults' 'write' 'com.apple.finder' 'CreateDesktop' '-bool' 'true' && '/usr/bin/killall' 'Finder'`);
    expect(sh).toContain('Notes \\"2\\"');
    const ps = restoreScript([entry({ target: { t: 'win-reg', path: 'HKCU:\\X', name: 'Y', type: 'DWORD' }, prior: '1', applied: '0' }), entry({ seq: 2, target: { t: 'apps-hidden', ids: ['123', 'bad;rm'], how: 'win' } })], 'win32');
    expect(ps).toContain("if ([string]$cur -eq '0')");
    expect(ps).toContain('[IntPtr]123');
    expect(ps).not.toContain('bad;rm');
    const linux = restoreScript([entry({ target: { t: 'display-mode', display: 'HDMI-1', how: 'xrandr', prior: { width: 2560, height: 1440, refresh: 59.95 } } })], 'linux');
    expect(linux).toContain("xrandr --output 'HDMI-1' --mode '2560x1440' --rate '59.95'");
  });
});

describe('screen-capture detection', () => {
  const node = (id: number, props: Record<string, unknown>, state = 'running') => ({ id, type: 'PipeWire:Interface:Node', info: { state, props } });
  it('finds screen casts in PipeWire and ignores cameras and idle streams', () => {
    const list = [
      node(1, { 'media.class': 'Video/Source', 'node.name': 'gnome-shell-screencast', 'application.name': 'GNOME Shell' }),
      node(2, { 'media.class': 'Video/Source', 'node.name': 'v4l2_input.pci', 'device.api': 'v4l2' }),
      node(3, { 'media.class': 'Video/Source', 'node.name': 'xdpw_stream' }, 'idle'),
      node(4, { 'media.class': 'Audio/Sink', 'node.name': 'screen' }),
    ];
    expect(screencastNodes(list)).toEqual([{ label: 'PipeWire screen cast (GNOME Shell)', reliable: true }]);
  });
  it('follows pw-dump --monitor updates, split anywhere, including removals', () => {
    const s = new PwDumpStream();
    const first = JSON.stringify([node(7, { 'media.class': 'Video/Source', 'node.name': 'xdpw_stream' }, 'idle'), { id: 9, type: 'PipeWire:Interface:Client', info: { props: { x: '[]"' } } }]);
    expect(s.push(first.slice(0, 40))).toBe(false);
    expect(s.push(first.slice(40) + '\n')).toBe(true);
    expect(s.sources()).toEqual([]);
    s.push(JSON.stringify([{ id: 7, info: { state: 'running' } }]));
    expect(s.sources()).toHaveLength(1);
    s.push('[ { "id": 7, "info": null } ]');
    expect(s.sources()).toEqual([]);
  });
  it('recorder apps count when running or in front, and command-line grabbers', () => {
    expect(recorderSources('darwin', ['screencaptureui', 'OBS'], 'Finder')).toEqual([{ label: 'The system’s screen recording is on', reliable: false }]);
    expect(recorderSources('darwin', ['OBS'], 'OBS')[0].label).toBe('OBS is in front');
    expect(recorderSources('win32', ['obs64'], 'obs64.exe')).toHaveLength(1);
    expect(recorderSources('linux', ['wf-recorder'], undefined)).toHaveLength(1);
    expect(recorderSources('linux', ['myrec'], undefined, ['myrec'])).toHaveLength(1);
    expect(grabberSources(['1234 ffmpeg -f x11grab -i :0 out.mp4'])).toHaveLength(1);
    expect(grabberSources(['1234 ffmpeg -i in.mp4 out.webm'])).toHaveLength(0);
    expect(macWindowSources([{ owner: 'screencaptureui', layer: 25 }])).toHaveLength(1);
    expect(macWindowSources([{ owner: 'screencaptureui', layer: 0 }])).toHaveLength(0);
  });
  it('a reliable signal counts at once, a guess needs two looks, and capture ends after three empty looks', () => {
    let t = track(newTracker(), [{ label: 'x', reliable: false }]);
    expect(t.active).toBe(false);
    t = track(t, [{ label: 'x', reliable: false }]);
    expect(t.active).toBe(true);
    t = track(track(t, []), []);
    expect(t.active).toBe(true);
    t = track(t, []);
    expect(t.active).toBe(false);
    expect(track(newTracker(), [{ label: 'pw', reliable: true }]).active).toBe(true);
  });
});

describe('overlays and keys', () => {
  it('labels keys the way each system writes them', () => {
    expect(keyLabel({ key: 's', mods: ['shift', 'cmd'] }, true)).toBe('⇧⌘S');
    expect(keyLabel({ key: 's', mods: ['cmd', 'ctrl'] }, false)).toBe('Ctrl+Win+S');
    expect(keyLabel({ key: 'Return', mods: [] }, true)).toBe('↩');
  });
  it('"Shortcuts only" never shows ordinary typing (passwords included)', () => {
    expect(showKey('shortcuts', { key: 'a', mods: [] })).toBe(false);
    expect(showKey('shortcuts', { key: 'A', mods: ['shift'] })).toBe(false);
    expect(showKey('shortcuts', { key: 'c', mods: ['cmd'] })).toBe(true);
    expect(showKey('shortcuts', { key: 'Escape', mods: [] })).toBe(true);
    expect(showKey('all', { key: 'a', mods: [] })).toBe(true);
    expect(showKey('all', { key: 'Shift_L', mods: [] })).toBe(false);
    expect(showKey('off', { key: 'c', mods: ['cmd'] })).toBe(false);
  });
  it('sizes the spotlight from the screen', () => {
    expect(spotRadius('m', 1000)).toBe(130);
    expect(spotRadius('l', 1000)).toBeGreaterThan(spotRadius('s', 1000));
  });
  it('the overlay page has a strict policy and the drawing API', () => {
    const h = overlayHtml();
    expect(h).toContain("default-src 'none'");
    for (const fn of ['config', 'pointer', 'click', 'key', 'countdown', 'hud', 'state']) expect(h).toContain(`${fn}:function`);
  });
  it('the backdrop only takes safe colours and image data', () => {
    expect(backdropHtml({ kind: 'solid', color: '#123456', color2: '#000000' })).toContain('background:#123456');
    expect(backdropHtml({ kind: 'solid', color: 'red;}</style><script>', color2: '#000000' })).not.toContain('<script>');
    expect(backdropHtml({ kind: 'blur', color: '#111111', color2: '#222222' }, 'data:image/jpeg;base64,AAAA')).toContain('blur(48px)');
    expect(backdropHtml({ kind: 'blur', color: '#111111', color2: '#222222' }, 'javascript:alert(1)')).toContain('linear-gradient');
  });
  it('reads X11 raw key and button events, with modifiers tracked and duplicates dropped', () => {
    const out: InputEvent[] = [];
    let now = 1000;
    const keymap = parseXmodmap('keycode  37 = Control_L NoSymbol Control_L\nkeycode  39 = s S s S\nkeycode  36 = Return NoSymbol Return\n');
    const p = new XinputParser(keymap, (e) => out.push(e), () => now);
    p.push('EVENT type 13 (RawKeyPress)\n    device: 3 (11)\n    detail: 37\n');
    p.push('EVENT type 13 (RawKeyPress)\n    device: 3 (11)\n    detail: 39\nEVENT type 13 (RawKeyPress)\n    device: 2 (11)\n    detail: 39\n');
    now += 100;
    p.push('EVENT type 14 (RawKeyRelease)\n    detail: 37\nEVENT type 13 (RawKeyPress)\n    detail: 36\nEVENT type 15 (RawButtonPress)\n    detail: 3\nEVENT type 15 (RawButtonPress)\n    detail: 4\n');
    expect(out).toEqual([{ t: 'key', key: 's', mods: ['ctrl'] }, { t: 'key', key: 'Return', mods: [] }, { t: 'click', right: true }]);
  });
  it('reads the Windows hook and the macOS helper', () => {
    expect(parseWinHookLine('K 83 ctrl,shift')).toEqual({ t: 'key', key: 'S', mods: ['ctrl', 'shift'] });
    expect(parseWinHookLine('C 10 -20 1')).toEqual({ t: 'click', x: 10, y: -20, right: true });
    expect(parseWinHookLine('junk')).toBeNull();
    expect(vkName(0x70)).toBe('F1');
    expect(parseMacEvent('{"t":"key","key":"k","mods":["cmd"]}')).toEqual({ t: 'key', key: 'k', mods: ['cmd'] });
    expect(parseMacEvent('{"t":"ready"}')).toBeNull();
  });
});

describe('screen sizes', () => {
  it('reads xrandr, wlr-randr and the Windows mode list', () => {
    const x = parseXrandr('Screen 0: minimum 8 x 8\nHDMI-1 connected primary 2560x1440+0+0 (normal) 597mm x 336mm\n   2560x1440     59.95*+  74.97\n   1920x1080     60.00    50.00\n   1280x720      60.00\nDP-1 disconnected (normal)\n');
    expect(x[0]).toMatchObject({ output: 'HDMI-1', primary: true });
    expect(x[0].modes.find((m) => m.current)).toEqual({ width: 2560, height: 1440, refresh: 59.95, current: true });
    expect(x[0].modes).toHaveLength(5);
    const w = parseWlrRandr('eDP-1 "Built-in"\n  Modes:\n    1920x1200 px, 60.000000 Hz (preferred, current)\n    1280x800 px, 59.810001 Hz\n');
    expect(w[0].modes[0]).toEqual({ width: 1920, height: 1200, refresh: 60, current: true });
    const win = parseWinModes('cur 2560 1440 144\n2560 1440 144\n2560 1440 60\n1920 1080 60\n1920 1080 60\n');
    expect(win).toHaveLength(3);
    expect(win[0].current).toBe(true);
  });
  it('picks the exact size (keeping the refresh rate and HiDPI), or the largest that fits the same shape', () => {
    const modes = dedupe([
      { width: 2560, height: 1440, refresh: 144, current: true }, { width: 1920, height: 1080, refresh: 60 }, { width: 1920, height: 1080, refresh: 144 },
      { width: 1600, height: 900, refresh: 60 }, { width: 1280, height: 1024, refresh: 60 },
    ]);
    expect(chooseMode(modes, 1920, 1080)).toMatchObject({ width: 1920, refresh: 144 });
    expect(chooseMode(modes, 1700, 956)).toMatchObject({ width: 1600, height: 900 });
    expect(chooseMode(modes, 640, 480)).toBeNull();
    expect(chooseMode([{ width: 1920, height: 1080, hidpi: false }, { width: 1920, height: 1080, hidpi: true }], 1920, 1080)?.hidpi).toBe(true);
  });
});

describe('external monitor inputs', () => {
  it('reads input codes from capabilities strings and ddcutil', () => {
    expect(inputsFromCapabilities('(prot(monitor)type(LCD)vcp(02 04 10 12 60(0F 11 12 ) 62 D6(01 04))mccs_ver(2.2))')).toEqual([0x0f, 0x11, 0x12]);
    expect(inputsFromCapabilities('vcp(10 12 62)')).toEqual([]);
    expect(inputsFromDdcutilCapabilities('   Feature: 60 (Input Source)\n      Values:\n         0f: DisplayPort-1\n         11: HDMI-1\n   Feature: 62 (Audio speaker volume)\n')).toEqual([0x0f, 0x11]);
    expect(parseDdcutilInput('VCP 60 SNC x0f')).toBe(15);
    expect(parseDdcutilInput('VCP 60 SNC x0111')).toBe(0x11);
    expect(inputLabel(0x11)).toBe('HDMI 1');
    expect(inputLabel(0x99)).toBe('Input 0x99');
  });
  it('steps levels within 0–100', () => {
    expect(stepLevel(95, 10)).toBe(100);
    expect(stepLevel(undefined, -10)).toBe(40);
    expect(stepLevel(3, -10)).toBe(0);
  });
});

describe('the Island while Stage is on', () => {
  const base = {
    shelf: [{ path: '/a' }], shelves: [{ id: 's', name: 'S', color: '', items: [{ path: '/a' }] }], activeShelf: 's', closedShelves: [{ id: 'c', name: 'C', color: '', count: 2 }],
    clips: [{ id: 'c1', text: 'secret' }], events: [{ uid: 'e', title: 'Salary review', start: 1, end: 2, allDay: false, location: 'Room 4' }],
    alerts: [{ id: 'n', kind: 'notification', title: 'Message from Sam', at: 1 }, { id: 'i', kind: 'info', title: 'Hello', at: 1 }],
    agents: [{ id: 'a', tool: 'codex', project: 'p', cwd: '/home/x', state: 'working', summary: 'Reading secrets.txt', updatedAt: 1, file: 'f' }],
  } as unknown as IslandState;
  it('hides private things but keeps the rest, and shows the live activity', () => {
    const r = redactIsland(base, { hidePrivate: true, cleanClipboard: false, stage: { on: true, name: 'Recording' } });
    expect(r.clips).toEqual([]);
    expect(r.shelf).toEqual([]);
    expect(r.shelves[0].items).toEqual([]);
    expect(r.events[0]).toMatchObject({ title: 'Busy', location: undefined });
    expect(r.alerts.map((a) => a.id)).toEqual(['i']);
    expect(r.agents[0].summary).toBe('');
    expect(r.stage?.name).toBe('Recording');
    expect(base.clips).toHaveLength(1);
  });
  it('a clean clipboard alone leaves the rest alone', () => {
    const r = redactIsland(base, { hidePrivate: false, cleanClipboard: true, stage: { on: true } });
    expect(r.clips).toEqual([]);
    expect(r.events[0].title).toBe('Salary review');
  });
});
