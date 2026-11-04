// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { appKey, forget, linuxMoveCmd, macStreams, newStreamEvent, normalizeSoundRules, remember, rulePlan, sinkIndex, streamSinks } from '../core/sound-rules';

const INPUTS = `Sink Input #41
\tDriver: protocol-native.c
\tSink: 47
\tMute: no
\tVolume: front-left: 52428 /  80% / -5.81 dB
\tProperties:
\t\tapplication.name = "Music Player"
Sink Input #42
\tSink: 52
\tMute: yes
`;

describe('one name per app', () => {
  it('folds the names an app’s streams use', () => {
    expect(appKey('Firefox')).toBe('firefox');
    expect(appKey('firefox-bin')).toBe('firefox');
    expect(appKey('Spotify.exe')).toBe('spotify');
    expect(appKey('  Music   Player ')).toBe('music player');
  });
});

describe('remembering', () => {
  it('keeps a volume, mute or output, and drops a rule that is back to plain', () => {
    let r = remember({}, { name: 'Music Player' }, { volume: 35 });
    expect(r).toEqual({ 'music player': { volume: 35 } });
    r = remember(r, { name: 'Music Player' }, { output: 'bluez_output.AA' });
    expect(r).toEqual({ 'music player': { volume: 35, output: 'bluez_output.AA' } });
    r = remember(r, { name: 'music player' }, { muted: true });
    expect(r['music player']).toEqual({ volume: 35, output: 'bluez_output.AA', muted: true });
    r = remember({ a: { volume: 50 } }, { name: 'A' }, { volume: 100 });
    expect(r).toEqual({});
    expect(remember({}, { name: 'B' }, { volume: 400 })).toEqual({ b: { volume: 150 } });
    expect(forget({ 'music player': { volume: 3 } }, 'Music Player')).toEqual({});
  });
  it('cleans what it reads back', () => {
    expect(normalizeSoundRules({ Firefox: { volume: '70', muted: 'yes', output: 'alsa_output.x' }, bad: { output: 'a b; rm' }, empty: {} })).toEqual({ firefox: { volume: 70, output: 'alsa_output.x' } });
    expect(normalizeSoundRules('nonsense')).toEqual({});
  });
});

describe('setting it again', () => {
  const rules = { 'music player': { volume: 35, output: 'bluez_output.AA' }, quiet: { muted: true } };
  const streams = [
    { id: '41', name: 'Music Player', volume: 80, muted: false, output: 'alsa_output.analog' },
    { id: '43', name: 'Quiet', volume: 100, muted: true },
    { id: '44', name: 'Other', volume: 100, muted: false },
  ];
  it('changes only new streams of remembered apps, only what differs, only to outputs that exist', () => {
    expect(rulePlan(rules, streams, new Set(), ['alsa_output.analog', 'bluez_output.AA'])).toEqual([{ id: '41', volume: 35, output: 'bluez_output.AA' }]);
    expect(rulePlan(rules, streams, new Set(['41']), ['bluez_output.AA'])).toEqual([]);
    expect(rulePlan(rules, streams, new Set(), ['alsa_output.analog'])).toEqual([{ id: '41', volume: 35 }]);
  });
});

describe('Linux and macOS details', () => {
  it('reads which output each stream plays to', () => {
    expect([...streamSinks(INPUTS)]).toEqual([['41', '47'], ['42', '52']]);
    expect([...sinkIndex('47\talsa_output.analog\tPipeWire\ts16le\n52\tbluez_output.AA\tPipeWire\n')]).toEqual([['47', 'alsa_output.analog'], ['52', 'bluez_output.AA']]);
  });
  it('moves a stream with checked names only', () => {
    expect(linuxMoveCmd('41', 'bluez_output.AA')).toEqual({ file: 'pactl', args: ['move-sink-input', '41', 'bluez_output.AA'] });
    expect(() => linuxMoveCmd('41; reboot', 'x')).toThrow();
    expect(() => linuxMoveCmd('41', 'x y')).toThrow();
  });
  it('hears a new app start playing', () => {
    expect(newStreamEvent("Event 'new' on sink-input #42")).toBe(true);
    expect(newStreamEvent("Event 'change' on sink-input #42")).toBe(false);
    expect(newStreamEvent("Event 'new' on client #9")).toBe(false);
  });
  it('turns keeper-helper’s list into mixer rows', () => {
    expect(macStreams([{ pid: 501, name: 'Music', volume: 0.4 }, { pid: 501, name: 'Music helper' }, { pid: 0, name: 'x' }, { pid: 700, bundleId: 'com.example.radio', muted: true }])).toEqual([
      { id: '700', pid: 700, name: 'com.example.radio', volume: 100, muted: true },
      { id: '501', pid: 501, name: 'Music', volume: 40, muted: false },
    ]);
  });
});
