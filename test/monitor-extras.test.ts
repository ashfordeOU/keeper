// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { joinStats, parseDf, parsePs, parseSize, parseStats, safeContainerId } from '../core/monitor-containers';
import { appNapCmd, parseAppNap, parseAssertions, parseTopPower } from '../core/monitor-energy';
import { linuxDefaultSinkCmd, linuxMuteCmd, parseLinuxSinks, parseLinuxStreams, parseWinMixer, winMixerSet } from '../core/monitor-mixer';
import { shareCardLayout, sparkPoints } from '../core/monitor-share';
import { matchProc, procChanges, procRegex, procsCsv, type ProcRow } from '../core/procs';
import { lmStudioModels, ollamaPs, USAGE_TOOLS } from '../core/island-tools/usage';

const MB = 1024 * 1024;

describe('containers', () => {
  it('parses sizes from both engines', () => {
    expect(parseSize('12.5MiB')).toBe(12.5 * MB);
    expect(parseSize('1.2kB')).toBe(1200);
    expect(parseSize('500MB (40%)')).toBe(500e6);
    expect(parseSize('0B')).toBe(0);
    expect(parseSize(42)).toBe(42);
  });

  it('reads docker JSON lines and joins stats', () => {
    const ps = parsePs('{"ID":"a1b2c3d4e5f6789","Names":"db","Image":"postgres:16","State":"running","Status":"Up 3 hours","Ports":"5432/tcp"}\n{"ID":"ffff","Names":"old","Image":"node","Status":"Exited (0)","Ports":""}');
    expect(ps.map((c) => [c.id, c.state])).toEqual([['a1b2c3d4e5f6', 'running'], ['ffff', 'exited']]);
    const st = parseStats('{"ID":"a1b2c3d4e5f6","CPUPerc":"12.50%","MemUsage":"100MiB / 2GiB","NetIO":"1kB / 2kB","BlockIO":"3MB / 4MB","PIDs":"9"}');
    const j = joinStats(ps, st);
    expect(j[0]).toMatchObject({ name: 'db', cpu: 12.5, memUsed: 100 * MB, memLimit: 2 * 1024 * MB, netIn: 1000, netOut: 2000, blockRead: 3e6, pids: 9 });
  });

  it('reads podman JSON arrays', () => {
    const ps = parsePs('[{"Id":"abcdef1234567890","Names":["web"],"Image":"nginx","State":"running","Status":"Up","Ports":[{"host_port":8080,"container_port":80}]}]');
    expect(ps[0]).toMatchObject({ id: 'abcdef123456', name: 'web', ports: '8080->80' });
    const st = parseStats('[{"id":"abcdef123456","name":"web","cpu_percent":"3.1%","mem_usage":"20MB / 1GB","net_io":"0B / 0B","block_io":"0B / 0B","pids":"2"}]');
    expect(st.get('abcdef123456')?.cpu).toBe(3.1);
  });

  it('reads system df', () => {
    const d = parseDf('{"Type":"Images","TotalCount":"5","Active":"2","Size":"1.5GB","Reclaimable":"500MB (33%)"}');
    expect(d[0]).toEqual({ type: 'Images', total: 5, active: 2, size: 1.5e9, reclaimable: 500e6 });
    expect(parseDf('[{"Type":"Volumes","Total":3,"Active":1,"RawSize":1000,"RawReclaimable":10}]')[0]).toMatchObject({ size: 1000, reclaimable: 10 });
  });

  it('only accepts safe ids', () => {
    expect(safeContainerId('web-1')).toBe(true);
    expect(safeContainerId('--rm')).toBe(false);
    expect(safeContainerId('a; rm -rf /')).toBe(false);
  });
});

describe('volume mixer', () => {
  const pactl = `Sink Input #41
\tDriver: protocol-native.c
\tMute: no
\tVolume: front-left: 52428 /  80% / -5.81 dB,   front-right: 52428 /  80% / -5.81 dB
\tProperties:
\t\tapplication.name = "Firefox"
\t\tapplication.process.id = "1234"
Sink Input #42
\tMute: yes
\tVolume: mono: 65536 / 100%
\tProperties:
\t\tmedia.name = "Playback"
`;
  it('reads PipeWire/PulseAudio streams with mute', () => {
    expect(parseLinuxStreams(pactl)).toEqual([
      { id: '41', pid: 1234, name: 'Firefox', volume: 80, muted: false },
      { id: '42', pid: undefined, name: 'Playback', volume: 100, muted: true },
    ]);
  });

  it('reads sinks and the default', () => {
    const s = parseLinuxSinks('47\talsa_output.pci.analog-stereo\tPipeWire\ts32le 2ch 48000Hz\tRUNNING\n52\tbluez_output.AA\tPipeWire\n', 'bluez_output.AA\n', 'Sink #47\n\tName: alsa_output.pci.analog-stereo\n\tDescription: Built-in Audio\n');
    expect(s).toEqual([{ id: 'alsa_output.pci.analog-stereo', name: 'Built-in Audio', default: false }, { id: 'bluez_output.AA', name: 'bluez_output.AA', default: true }]);
    expect(linuxMuteCmd('41', true).args).toEqual(['set-sink-input-mute', '41', '1']);
    expect(() => linuxDefaultSinkCmd('x; rm')).toThrow();
  });

  it('reads the Windows helper output and builds safe calls', () => {
    expect(parseWinMixer('100\t80\t0\tchrome\r\n100\t70\t0\tchrome\n200\t50\t1\tSpotify\n')).toEqual([
      { id: '100', pid: 100, name: 'chrome', volume: 80, muted: false },
      { id: '200', pid: 200, name: 'Spotify', volume: 50, muted: true },
    ]);
    expect(winMixerSet(12, 150, true)).toMatch(/\[KMix\]::Set\(12, 100, 1\)$/);
    expect(winMixerSet(12, undefined, undefined)).toMatch(/Set\(12, -1, -1\)$/);
    expect(() => winMixerSet(-1)).toThrow();
  });
});

describe('macOS energy', () => {
  it('takes the second top sample', () => {
    const top = 'Processes: 1\nPID    COMMAND          POWER\n1      launchd          0.0\n\nPID    COMMAND          POWER\n512    Browser Helper   38.2\n140    WindowServer     21.4\n';
    expect(parseTopPower(top)).toEqual([{ pid: 512, name: 'Browser Helper', power: 38.2 }, { pid: 140, name: 'WindowServer', power: 21.4 }]);
  });
  it('reads assertions per process', () => {
    const a = 'Listed by owning process:\n   pid 640(Music): [0x0001] 00:12:01 PreventUserIdleSystemSleep named: "Playing audio"\n   pid 820(Call): [0x0002] 00:01:00 PreventUserIdleDisplaySleep named: "Call in progress"\n';
    expect(parseAssertions(a).get(640)).toEqual(['PreventUserIdleSystemSleep: Playing audio']);
  });
  it('App Nap switch', () => {
    expect(parseAppNap('1\n')).toBe(false);
    expect(parseAppNap('')).toBe(true);
    expect(appNapCmd('com.example.app', false).args).toEqual(['write', 'com.example.app', 'NSAppSleepDisabled', '-bool', 'YES']);
    expect(appNapCmd('com.example.app', true).args).toEqual(['delete', 'com.example.app', 'NSAppSleepDisabled']);
    expect(() => appNapCmd('-x', true)).toThrow();
  });
});

describe('share card', () => {
  const r = { t: Date.UTC(2026, 9, 31, 12), cpu: 42, perCore: [1, 2, 3, 4], memUsed: 8 * 1024 ** 3, memTotal: 16 * 1024 ** 3, netIn: 1000, netOut: 10, gpu: 30 };
  it('lays out one tile per measured reading in a grid', () => {
    const l = shareCardLayout(r, [r, { ...r, cpu: 60 }], { theme: 'dark' });
    expect(l.width).toBe(1200);
    expect(l.tiles.map((t) => t.metric)).toEqual(['cpu', 'mem', 'net', 'gpu']);
    expect(l.tiles[0].value).toBe('42%');
    expect(l.tiles[3].y).toBeGreaterThan(l.tiles[0].y);
    for (const t of l.tiles) expect(t.x + t.w).toBeLessThanOrEqual(1200);
    expect(shareCardLayout(r, [], { theme: 'transparent' }).colors.bg).toBe('rgba(0,0,0,0)');
  });
  it('sparkline points stay in their box', () => {
    const p = sparkPoints([0, 50, 100, undefined], 100, { x: 10, y: 10, w: 30, h: 20 });
    expect(p).toEqual([[10, 30], [20, 20], [30, 10]]);
  });
});

describe('process list extras', () => {
  const row = (pid: number, name: string, extra: Partial<ProcRow> = {}): ProcRow => ({ pid, ppid: 1, name, mine: true, cpu: 0, memory: 0, ...extra });
  it('filters by /regex/', () => {
    expect(procRegex('/^node$/')).toBeInstanceOf(RegExp);
    expect(procRegex('/[/')).toBeNull();
    expect(procRegex('node')).toBeNull();
    expect(matchProc(row(1, 'node', { command: 'node vite' }), '/vi+te/')).toBe(true);
    expect(matchProc(row(1, 'NODE'), '/^node$/')).toBe(true);
    expect(matchProc(row(1, 'NODE'), '/^node$/s')).toBe(false);
  });
  it('marks new and ended processes', () => {
    const now = 1_000_000;
    const c = procChanges([row(1, 'a', { started: 1 }), row(2, 'b', { started: 2 })], [row(1, 'a', { started: 1 }), row(3, 'c', { started: now - 1000 })], now);
    expect([...c.fresh]).toEqual([3]);
    expect(c.ended).toEqual([{ pid: 2, name: 'b' }]);
    expect(procChanges([], [row(1, 'a')], now).ended).toEqual([]);
  });
  it('exports CSV with quoting', () => {
    const csv = procsCsv([row(5, 'my, app', { command: 'say "hi"' })]);
    expect(csv.split('\n')[1]).toContain('"my, app"');
    expect(csv).toContain('"say ""hi"""');
  });
});

describe('local model usage', () => {
  it('Ollama loaded models', () => {
    const w = ollamaPs({ models: [{ name: 'llama3.2:3b', size: 3 * 1024 ** 3, size_vram: 3 * 1024 ** 3, expires_at: new Date(Date.now() + 300_000).toISOString() }] });
    expect(w[0].label).toBe('llama3.2:3b · 3.0 GB in graphics memory');
    expect(w[0].resetsAt).toBeGreaterThan(Date.now());
    expect(ollamaPs({})).toEqual([]);
  });
  it('LM Studio loaded models only', () => {
    expect(lmStudioModels({ data: [{ id: 'qwen', state: 'loaded', max_context_length: 32768 }, { id: 'x', state: 'not-loaded' }] })).toEqual([{ label: 'qwen loaded · 32k context' }]);
  });
  it('the first two usage tools stay where agent detection expects them', () => {
    expect(USAGE_TOOLS.slice(0, 2).map((t) => t.id)).toEqual([USAGE_TOOLS[0].id, 'codex']);
    expect(USAGE_TOOLS.some((t) => t.id === 'ollama')).toBe(true);
  });
});
