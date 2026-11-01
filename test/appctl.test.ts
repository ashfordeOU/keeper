// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  CONTROLS, appMark, appTag, autoSuspendStep, cgroupWrites, defaultForCmd, linuxAutostart, linuxRoute, linuxShape, linuxVolumeCmd, macAppearanceCmd, macLanguageCmd,
  macLoginAgent, macShape, notificationsCmd, parseCpuMax, parseSinkInputs, priorityPlan, safePath, showPlan, suspendCmd, winGpuCmd, winJob, winQos, winRunKey, winVolumeScript,
} from '../core/appctl';
import { posixBatch, powershellBatch, appleQ } from '../electron/services/elevate';

const win = { name: 'Chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', pid: 1234 };
const lin = { name: 'firefox', path: '/usr/lib/firefox/firefox', pid: 4242, appId: 'firefox.desktop' };
const mac = { name: 'Safari', path: '/Applications/Safari.app', pid: 777, bundleId: 'com.apple.Safari' };

describe('per-app control catalogue', () => {
  it('says honestly what each system supports', () => {
    for (const c of CONTROLS) for (const os of ['darwin', 'win32', 'linux'] as const) {
      expect(['yes', 'partial', 'guide', 'no']).toContain(c.support[os]);
      if (c.support[os] !== 'yes') expect(c.notes[os], `${c.id} ${os} needs a note`).toBeTruthy();
    }
  });
});

describe('input checks', () => {
  it('refuses paths that could break out of a script', () => {
    expect(() => safePath('/tmp/x"; rm -rf /', 'linux')).toThrow();
    expect(() => safePath('relative/path', 'linux')).toThrow();
    expect(() => safePath("C:\\a'b.exe", 'win32')).toThrow();
    expect(safePath(win.path, 'win32')).toBe(win.path);
    expect(() => priorityPlan({ name: 'x' }, 'low', 'linux')).toThrow(/not running/);
    expect(appTag(win)).toMatch(/^k[0-9a-z]+$/);
    expect(appMark(win)).toBeGreaterThanOrEqual(0x4b000000);
  });
});

describe('bandwidth', () => {
  it('Windows QoS by program name, with undo', () => {
    const p = winQos(win, 512);
    const script = p.cmds[0].args[2];
    expect(script).toContain("-AppPathNameMatchCondition 'chrome.exe'");
    expect(script).toContain('-ThrottleRateActionBitsPerSecond 512000');
    expect(p.cmds[0].admin).toBe(true);
    expect(p.undo[0].args[2]).toContain('Remove-NetQosPolicy');
  });
  it('Linux tc + nftables cgroup mark', () => {
    const p = linuxShape(lin, 1000, 'wlan0', 'keeper/kabc');
    const s = p.cmds[0].args[1];
    expect(s).toContain('htb rate 1000kbit ceil 1000kbit');
    expect(s).toContain(`socket cgroupv2 level 2 '"keeper/kabc"' meta mark set ${appMark(lin)}`);
    expect(() => linuxShape(lin, 10, 'eth0; reboot', 'keeper/x')).toThrow();
    expect(() => linuxShape(lin, 10, 'eth0', '../../etc')).toThrow();
  });
  it('macOS by port with an honest note', () => {
    const p = macShape(mac, 256, [443, 443, 99999, 8080]);
    expect(p.cmds[0].args[1]).toContain('port { 443 8080 }');
    expect(p.cmds[0].args[1]).toContain('bw 256Kbit/s');
    expect(p.note).toMatch(/other apps/);
    expect(() => macShape(mac, 256, [])).toThrow(/ports/);
  });
  it('Linux VPN routing by cgroup', () => {
    const p = linuxRoute(lin, 'vpn', 'user.slice/app.scope', 'wg0');
    expect(p.cmds[0].args[1]).toMatch(/ip route replace default dev wg0 table \d+/);
    expect(p.cmds[0].args[1]).toMatch(/ip rule add fwmark \d+ table \d+/);
    expect(p.undo[0].args[1]).toContain('ip rule del fwmark');
  });
});

describe('CPU and memory', () => {
  it('priority per system', () => {
    expect(priorityPlan(lin, 'below', 'linux').cmds[0]).toEqual({ file: 'renice', args: ['-n', '10', '-p', '4242'], admin: false });
    expect(priorityPlan(lin, 'high', 'linux').cmds[0].admin).toBe(true);
    expect(priorityPlan(mac, 'low', 'darwin').cmds[1]).toEqual({ file: '/usr/sbin/taskpolicy', args: ['-b', '-p', '777'] });
    expect(priorityPlan(win, 'below', 'win32').cmds[0].args[2]).toBe("(Get-Process -Id 1234).PriorityClass = 'BelowNormal'");
  });
  it('cgroup v2 files', () => {
    expect(cgroupWrites({ cpuPercent: 50 })).toEqual([{ file: 'cpu.max', value: '50000 100000' }]);
    expect(cgroupWrites({ cpuPercent: 400, cores: 4 })).toEqual([{ file: 'cpu.max', value: 'max 100000' }]);
    expect(cgroupWrites({ memMB: 512 })).toEqual([{ file: 'memory.max', value: String(512 * 1024 * 1024) }]);
    expect(cgroupWrites({ memMB: 0 })).toEqual([{ file: 'memory.max', value: 'max' }]);
    expect(parseCpuMax('25000 100000')).toBe(25);
    expect(parseCpuMax('max 100000')).toBeUndefined();
  });
  it('Windows job object script', () => {
    const p = winJob(win, { cpuPercent: 30, memMB: 1024 });
    const s = p.cmds[0].args[2];
    expect(s).toContain('[KJ]::Limit(1234, 3000, 1024)');
    expect(s).toContain('CreateJobObject');
    expect(p.note).toMatch(/until the app quits/);
  });
  it('pause and resume', () => {
    expect(suspendCmd(lin, 'linux', false)).toEqual({ file: 'kill', args: ['-STOP', '4242'] });
    expect(suspendCmd(lin, 'linux', true)).toEqual({ file: 'kill', args: ['-CONT', '4242'] });
    expect(suspendCmd(win, 'win32', false).args[2]).toContain('NtSuspendProcess');
  });
  it('auto-pause decisions', () => {
    const now = 10 * 60_000;
    const r = autoSuspendStep(now, 'Mail', [
      { key: 'Slack', afterMin: 5, hiddenSince: 0, paused: false },
      { key: 'Mail', afterMin: 5, paused: true },
      { key: 'Teams', afterMin: 5, paused: false },
    ]);
    expect(r.pause).toEqual(['Slack']);
    expect(r.resume).toEqual(['Mail']);
    expect(r.hidden.Teams).toBe(now);
  });
});

describe('login, notifications, look, language, GPU, volume, defaults', () => {
  it('start at login', () => {
    const la = macLoginAgent(mac);
    expect(la.file).toMatch(/^Library\/LaunchAgents\/com\.ashforde\.keeper\.login\.k\w+\.plist$/);
    expect(la.content).toContain('<string>/Applications/Safari.app</string>');
    expect(winRunKey(win, true).args).toEqual(['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Chrome', '/t', 'REG_SZ', '/d', `"${win.path}"`, '/f']);
    expect(winRunKey(win, false).args[0]).toBe('delete');
    expect(linuxAutostart(lin).content).toContain('Exec="/usr/lib/firefox/firefox"');
  });
  it('notifications', () => {
    expect(notificationsCmd(lin, false, 'linux')?.args).toEqual(['set', 'org.gnome.desktop.notifications.application:/org/gnome/desktop/notifications/application/firefox/', 'enable', 'false']);
    expect(notificationsCmd({ ...win, appId: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe!App' }, false, 'win32')?.args).toContain('Enabled');
    expect(notificationsCmd(win, false, 'win32')).toBeNull();
    expect(notificationsCmd(mac, false, 'darwin')).toBeNull();
  });
  it('macOS look and language per app', () => {
    expect(macAppearanceCmd(mac, true).args).toEqual(['write', 'com.apple.Safari', 'NSRequiresAquaSystemAppearance', '-bool', 'true']);
    expect(macLanguageCmd(mac, 'fr').args).toEqual(['write', 'com.apple.Safari', 'AppleLanguages', '-array', 'fr']);
    expect(macLanguageCmd(mac, null).args[0]).toBe('delete');
    expect(() => macLanguageCmd(mac, 'fr; rm')).toThrow();
    expect(() => macAppearanceCmd({ ...mac, bundleId: 'x y' }, true)).toThrow();
  });
  it('GPU preference and volume', () => {
    expect(winGpuCmd(win, 2).args).toEqual(['add', 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences', '/v', win.path, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f']);
    expect(winVolumeScript(1234, 40)).toContain('[KV]::Set(1234, 0.40)');
    const sinks = parseSinkInputs('Sink Input #12\n\tDriver: PipeWire\n\tVolume: front-left: 65536 / 100% / 0.00 dB\n\tProperties:\n\t\tapplication.name = "Firefox"\n\t\tapplication.process.id = "4242"\nSink Input #13\n\tVolume: mono: 32768 /  50%\n\t\tapplication.name = "mpv"\n');
    expect(sinks).toEqual([{ index: 12, pid: 4242, name: 'Firefox', volume: 100 }, { index: 13, pid: undefined, name: 'mpv', volume: 50 }]);
    expect(linuxVolumeCmd(12, 300).args).toEqual(['set-sink-input-volume', '12', '150%']);
  });
  it('default app for a file type', () => {
    expect(defaultForCmd(lin, 'text/plain', 'linux')).toEqual({ file: 'xdg-mime', args: ['default', 'firefox.desktop', 'text/plain'] });
    expect(defaultForCmd(mac, 'public.plain-text', 'darwin')?.args[3]).toContain('LSSetDefaultRoleHandlerForContentType("public.plain-text", 0xFFFFFFFF, "com.apple.Safari")');
    expect(() => defaultForCmd(lin, 'text/plain; rm', 'linux')).toThrow();
    expect(defaultForCmd(win, 'txt', 'win32')).toBeNull();
  });
  it('previews list files and commands', () => {
    expect(showPlan({ cmds: [{ file: 'reg', args: ['add', 'a b'], admin: true }], undo: [], files: [{ path: '/x', content: '' }] })).toEqual(['write /x', "(as administrator) reg add 'a b'"]);
  });
});

describe('elevation batches', () => {
  it('quote every argument', () => {
    expect(posixBatch([{ file: 'sysctl', args: ['-w', 'vm.swappiness=10'] }, { file: 'sh', args: ['-c', "echo 'x'"] }])).toBe(`sysctl -w vm.swappiness=10 && sh -c 'echo '\\''x'\\'''`);
    expect(powershellBatch([{ file: 'x.exe', args: ["it's"] }])).toContain("& 'x.exe' 'it''s'");
    expect(appleQ('say "hi" \\ there')).toBe('"say \\"hi\\" \\\\ there"');
  });
});
