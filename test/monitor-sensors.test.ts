// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { ancestors, isSecretVar, parseAuthenticode, parseCodesign, parseEnviron, parsePackageOwner, parsePsEnv, redactEnv } from '../core/monitor-procinfo';
import {
  linuxBatteryWatts, parseDrmCards, parseHwmon, parseIoregGpu, parseMacBatteryPower, parseNvidiaSmi, parseWinFans, parseWinGpuCounters, raplWatts, sensorLimits, winBatteryWatts,
} from '../core/monitor-sensors';

describe('graphics', () => {
  it('reads nvidia-smi with its processes', () => {
    const g = parseNvidiaSmi('NVIDIA GeForce RTX 4070, 37, 2048, 12282, 55, 41.20\n', '1234, /usr/bin/python3, 1500\nbad line');
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ vendor: 'nvidia', util: 37, temp: 55, power: 41.2, memUsed: 2048 * 1048576, memTotal: 12282 * 1048576 });
    expect(g[0].procs).toEqual([{ pid: 1234, name: 'python3', memory: 1500 * 1048576 }]);
  });

  it('reads AMD busy percent and estimates Intel from its clock', () => {
    const g = parseDrmCards([
      { card: 'card0', vendor: '0x1002\n', busy: '42\n', vramUsed: '1000', vramTotal: '8000' },
      { card: 'card1', vendor: '0x8086', curFreq: '600', maxFreq: '1200' },
      { card: 'card2', vendor: '0x10de' },
    ]);
    expect(g).toEqual([
      expect.objectContaining({ vendor: 'amd', util: 42, memUsed: 1000, memTotal: 8000 }),
      expect.objectContaining({ vendor: 'intel', util: 50, approx: true }),
    ]);
  });

  it('sums Windows GPU engine counters per engine and takes the busiest', () => {
    const r = parseWinGpuCounters([
      { InstanceName: 'pid_100_luid_0x0_0x1_phys_0_eng_0_engtype_3d', CookedValue: 20 },
      { InstanceName: 'pid_200_luid_0x0_0x1_phys_0_eng_0_engtype_3d', CookedValue: 15 },
      { InstanceName: 'pid_200_luid_0x0_0x1_phys_0_eng_1_engtype_videodecode', CookedValue: 30 },
    ]);
    expect(r.util).toBe(35);
    expect(r.perPid.get(200)).toBe(30);
  });

  it('reads the public macOS registry', () => {
    const out = `+-o AGXAcceleratorG15X  <class AGXAcceleratorG15X>\n    "PerformanceStatistics" = {"In use system memory"=734003200,"Device Utilization %"=27,"Renderer Utilization %"=25}\n    "model" = "Apple M3 Pro"\n`;
    expect(parseIoregGpu(out)).toEqual([expect.objectContaining({ name: 'Apple M3 Pro', vendor: 'apple', util: 27, memUsed: 734003200 })]);
    expect(parseIoregGpu('+-o IOAccelerator\n "nothing" = 1')).toEqual([]);
  });
});

describe('power', () => {
  it('Mac battery: amperage × voltage, with unsigned negatives', () => {
    expect(parseMacBatteryPower('"InstantAmperage" = 18446744073709550616\n"Voltage" = 12000')).toBeCloseTo(12);
    expect(parseMacBatteryPower('"InstantAmperage" = 500\n"Voltage" = 12000')).toBeCloseTo(-6);
    expect(parseMacBatteryPower('nothing')).toBeUndefined();
  });

  it('Linux battery from power_now or current × voltage', () => {
    expect(linuxBatteryWatts({ status: 'Discharging', power_now: '8500000' })).toBe(8.5);
    expect(linuxBatteryWatts({ status: 'Charging', current_now: '1000000', voltage_now: '12000000' })).toBe(-12);
    expect(linuxBatteryWatts({ status: 'Full' })).toBeUndefined();
  });

  it('RAPL watts from energy counters, wrapping', () => {
    expect(raplWatts(1_000_000, 6_000_000, 1000)).toBe(5);
    expect(raplWatts(9_000_000, 1_000_000, 1000, 10_000_000)).toBe(2);
    expect(raplWatts(9, 1, 1000)).toBeUndefined();
  });

  it('Windows battery rates in milliwatts', () => {
    expect(winBatteryWatts([{ Discharging: true, DischargeRate: 9500 }])).toBe(9.5);
    expect(winBatteryWatts([{ Discharging: false, ChargeRate: 30000 }])).toBe(-30);
    expect(winBatteryWatts([])).toBeUndefined();
  });
});

describe('fans and temperatures', () => {
  it('reads hwmon chips', () => {
    const r = parseHwmon([
      { name: 'thinkpad', files: { fan1_input: '2400', fan1_label: 'CPU fan', temp1_input: '61000' } },
      { name: 'coretemp', files: { temp1_input: '72500', temp1_label: 'Package id 0', temp1_crit: '100000', temp2_input: '200000' } },
    ]);
    expect(r.fans).toEqual([{ label: 'CPU fan', rpm: 2400, max: undefined }]);
    expect(r.temps[0]).toEqual({ label: 'coretemp · Package id 0', celsius: 72.5, critical: 100 });
    expect(r.temps).toHaveLength(2);
  });

  it('reads Windows fans only when filled in', () => {
    expect(parseWinFans([{ Name: 'CPU Fan', DesiredSpeed: 1800 }, { Name: 'Case', DesiredSpeed: 0 }])).toEqual([{ label: 'CPU Fan', rpm: 1800 }]);
  });

  it('explains what each system cannot show', () => {
    const none = { gpus: [], fans: [], temps: [], power: { source: [] } };
    expect(sensorLimits('darwin', none).join(' ')).toMatch(/SMC/);
    expect(sensorLimits('win32', none).join(' ')).toMatch(/kernel driver/);
    expect(sensorLimits('linux', none).join(' ')).toMatch(/RAPL/);
  });
});

describe('process inspector extras', () => {
  it('hides secrets even when values are shown', () => {
    const env = parseEnviron('PATH=/bin\0HOME=/h\0GITHUB_TOKEN=abc\0DATABASE_URL=postgres://u:p@h/db\0MY_VAR=hello\0WEIRD=sk-abcdefghijklmnopqrstuvwx\0');
    const hidden = redactEnv(env);
    expect(hidden.find((v) => v.name === 'PATH')?.value).toBe('/bin');
    expect(hidden.find((v) => v.name === 'MY_VAR')?.value).toBeUndefined();
    const shown = redactEnv(env, { reveal: true });
    expect(shown.find((v) => v.name === 'MY_VAR')?.value).toBe('hello');
    expect(shown.find((v) => v.name === 'GITHUB_TOKEN')).toMatchObject({ value: undefined, secret: true });
    expect(shown.find((v) => v.name === 'DATABASE_URL')?.secret).toBe(true);
    expect(shown.find((v) => v.name === 'WEIRD')?.secret).toBe(true);
    expect(redactEnv(env, { reveal: true, revealSecrets: true }).find((v) => v.name === 'GITHUB_TOKEN')?.value).toBe('abc');
    expect(isSecretVar('SHELL', '/bin/zsh')).toBe(false);
  });

  it('reads environment from macOS ps -E', () => {
    expect(parsePsEnv('/usr/bin/foo -x PATH=/bin HOME=/Users/a b c LANG=en', '/usr/bin/foo -x')).toEqual([['PATH', '/bin'], ['HOME', '/Users/a b c'], ['LANG', 'en']]);
  });

  it('walks the parent chain', () => {
    const p = [{ pid: 1, ppid: 0, name: 'init' }, { pid: 5, ppid: 1, name: 'sh' }, { pid: 9, ppid: 5, name: 'node' }];
    expect(ancestors(9, p)).toEqual([{ pid: 5, name: 'sh' }, { pid: 1, name: 'init' }]);
    expect(ancestors(1, p)).toEqual([]);
  });

  it('reads codesign output', () => {
    const d = 'Executable=/Applications/X.app/Contents/MacOS/X\nIdentifier=com.example.x\nCodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1\nAuthority=Developer ID Application: Example (AB12CD34EF)\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTeamIdentifier=AB12CD34EF\nNotarization Ticket=stapled';
    const s = parseCodesign(d, true, '<key>com.apple.security.app-sandbox</key><true/>');
    expect(s).toMatchObject({ valid: true, signed: true, teamId: 'AB12CD34EF', identifier: 'com.example.x', hardenedRuntime: true, sandboxed: true, notarized: true });
    expect(s.signer).toContain('Developer ID Application');
    expect(parseCodesign('code object is not signed at all', false)).toMatchObject({ signed: false, valid: false });
    expect(parseCodesign('Signature=adhoc\nTeamIdentifier=not set', true)).toMatchObject({ signed: true, signer: 'Ad hoc (no identity)', teamId: undefined });
  });

  it('reads Authenticode results', () => {
    expect(parseAuthenticode('{"Status":0,"IsOSBinary":true,"Subject":"CN=Microsoft Windows, O=Microsoft Corporation"}')).toMatchObject({ valid: true, signer: 'Microsoft Windows', platform: true });
    expect(parseAuthenticode('{"Status":2,"StatusMessage":"The file is not digitally signed."}')).toMatchObject({ valid: false, signed: false });
    expect(parseAuthenticode('{"Status":"HashMismatch","Subject":"CN=\\"Acme, Inc.\\""}')).toMatchObject({ valid: false, signed: true });
    expect(parseAuthenticode('nope').valid).toBe(false);
  });

  it('reads package owners on Linux', () => {
    expect(parsePackageOwner('dpkg', 'coreutils: /usr/bin/ls\n')).toMatchObject({ valid: true, identifier: 'coreutils' });
    expect(parsePackageOwner('dpkg', 'dpkg-query: no path found matching pattern /opt/x')).toMatchObject({ valid: false });
    expect(parsePackageOwner('rpm', 'bash-5.2.15-1.fc38.x86_64')).toMatchObject({ valid: true });
    expect(parsePackageOwner('rpm', 'file /opt/x is not owned by any package')).toMatchObject({ valid: false });
    expect(parsePackageOwner('pacman', '/usr/bin/ls is owned by coreutils 9.4-3')).toMatchObject({ identifier: 'coreutils 9.4-3' });
  });
});
