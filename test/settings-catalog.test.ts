// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  CATALOG, catalogCounts, catalogFor, searchCatalog, settingById, validateCatalog,
  readCmd, parseRead, writeCmds, removeCmds, backupCmd, afterCmds, showCmd, validateValue, UNSET,
} from '../core/settings-catalog';
import { exportProfile, parseProfile, previewProfile } from '../core/settings-catalog/profile';
import { parseGVariant, parseRegQuery, sysctlPersistScript, toGVariant } from '../core/settings-catalog/ops';
import type { ReadResult } from '../core/settings-catalog';

const get = (id: string) => {
  const s = settingById(id);
  if (!s) throw new Error(`missing ${id}`);
  return s;
};

describe('settings catalogue', () => {
  it('has hundreds of complete, unique entries', () => {
    expect(validateCatalog()).toEqual([]);
    const n = catalogCounts();
    expect(CATALOG.length).toBeGreaterThanOrEqual(350);
    expect(n.darwin).toBeGreaterThanOrEqual(100);
    expect(n.win32).toBeGreaterThanOrEqual(100);
    expect(n.linux).toBeGreaterThanOrEqual(100);
    expect(new Set(CATALOG.map((s) => s.id)).size).toBe(CATALOG.length);
  });

  it('catches broken entries', () => {
    const bad = { ...get('mac.finder.hidden'), sources: [] };
    expect(validateCatalog([bad, bad]).join('\n')).toMatch(/duplicate id[\s\S]*sources/);
  });

  it('searches titles, keywords and technical names', () => {
    expect(searchCatalog('hidden files', 'darwin')[0].id).toBe('mac.finder.hidden');
    expect(searchCatalog('swappiness').map((s) => s.id)).toContain('linux.kernel.swappiness');
    expect(searchCatalog('HideFileExt').map((s) => s.id)).toEqual(['win.explorer.extensions']);
    expect(searchCatalog('dark mode', 'win32').length).toBeGreaterThan(0);
    expect(catalogFor('linux').every((s) => s.os === 'linux')).toBe(true);
  });
});

describe('macOS commands', () => {
  it('defaults read/write/delete with exact argument lists', () => {
    const s = get('mac.finder.hidden');
    expect(readCmd(s.op)).toEqual({ file: '/usr/bin/defaults', args: ['read', 'com.apple.finder', 'AppleShowAllFiles'] });
    expect(writeCmds(s, 'true')).toEqual([{ file: '/usr/bin/defaults', args: ['write', 'com.apple.finder', 'AppleShowAllFiles', '-bool', 'true'], admin: false }]);
    expect(removeCmds(s)[0].args).toEqual(['delete', 'com.apple.finder', 'AppleShowAllFiles']);
    expect(afterCmds(s.after)).toEqual([{ file: '/usr/bin/killall', args: ['Finder'] }]);
    expect(parseRead(s, '1\n', true)).toBe('true');
    expect(parseRead(s, '', false)).toBeUndefined();
    expect(backupCmd(s.op, '/tmp/x.plist')?.args).toEqual(['export', 'com.apple.finder', '/tmp/x.plist']);
  });

  it('current-host keys and pmset', () => {
    expect(writeCmds(get('mac.menubar.battery'), 'true')[0].args.slice(0, 2)).toEqual(['-currentHost', 'write']);
    const p = get('mac.power.displaysleep');
    expect(writeCmds(p, '15')).toEqual([{ file: '/usr/bin/pmset', args: ['-a', 'displaysleep', '15'], admin: true }]);
    expect(parseRead(p, 'Battery Power:\n displaysleep         2\nAC Power:\n displaysleep         10\n', true)).toBe('2');
  });

  it('unset removes the value (dark mode)', () => {
    const s = get('mac.appearance.mode');
    expect(validateValue(s, UNSET)).toBeNull();
    expect(writeCmds(s, UNSET)[0].args[0]).toBe('delete');
  });

  it('text values cannot carry shell syntax and previews are quoted', () => {
    const s = get('mac.shots.location');
    expect(validateValue(s, '~/Pictures/Shots')).toBeNull();
    expect(validateValue(s, '/tmp; rm -rf ~')).toMatch(/characters/);
    expect(validateValue(s, '$(whoami)')).toMatch(/characters/);
    expect(showCmd({ file: '/usr/bin/defaults', args: ['write', 'x', 'y', '-string', "it's here"], admin: true })).toBe(`(as administrator) /usr/bin/defaults write x y -string 'it'\\''s here'`);
  });

  it('numbers respect limits', () => {
    const s = get('mac.dock.size');
    expect(validateValue(s, '200')).toMatch(/At most/);
    expect(validateValue(s, '40.5')).toMatch(/whole/);
    expect(validateValue(get('mac.dock.autohide.delay'), '0.15')).toBeNull();
  });
});

describe('Windows commands', () => {
  it('registry add/query/delete/export', () => {
    const s = get('win.explorer.extensions');
    expect(writeCmds(s, '0')).toEqual([{ file: 'reg', args: ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', '/v', 'HideFileExt', '/t', 'REG_DWORD', '/d', '0', '/f'], admin: false }]);
    expect(parseRegQuery('\r\nHKEY_CURRENT_USER\\...\\Advanced\r\n    HideFileExt    REG_DWORD    0x1\r\n')).toBe('1');
    expect(parseRead(s, 'ERROR: The system was unable to find the specified registry key or value.', false)).toBeUndefined();
    expect(backupCmd(s.op, 'C:\\b.reg')?.args).toEqual(['export', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'C:\\b.reg', '/y']);
  });

  it('HKLM needs an administrator; default-value keys use /ve', () => {
    expect(writeCmds(get('win.explorer.longpaths'), '1')[0].admin).toBe(true);
    const cm = get('win.explorer.classicmenu');
    expect(writeCmds(cm, '')[0].args).toContain('/ve');
    expect(writeCmds(cm, UNSET)[0].args[0]).toBe('delete');
  });

  it('services, features and power', () => {
    expect(writeCmds(get('win.service.sysmain'), 'disabled')[0]).toEqual({ file: 'sc', args: ['config', 'SysMain', 'start=', 'disabled'], admin: true });
    expect(parseRead(get('win.service.sysmain'), '        START_TYPE         : 2   AUTO_START\n', true)).toBe('auto');
    expect(writeCmds(get('win.feature.wsl'), 'on')[0].args).toEqual(['/online', '/enable-feature', '/featurename:Microsoft-Windows-Subsystem-Linux', '/all', '/norestart']);
    expect(writeCmds(get('win.power.monitor.ac'), '20')[0].args).toEqual(['/change', 'monitor-timeout-ac', '20']);
    expect(parseRead(get('win.power.monitor.ac'), 'Current AC Power Setting Index: 0x00000258\nCurrent DC Power Setting Index: 0x0000012c', true)).toBe('10');
    expect(parseRead(get('win.power.hibernate'), '    HibernateEnabled    REG_DWORD    0x0', true)).toBe('off');
  });
});

describe('Linux commands', () => {
  it('gsettings with GVariant escaping', () => {
    const s = get('linux.gnome.colorscheme');
    expect(writeCmds(s, 'prefer-dark')[0]).toEqual({ file: 'gsettings', args: ['set', 'org.gnome.desktop.interface', 'color-scheme', "'prefer-dark'"] });
    expect(parseGVariant("'prefer-dark'")).toBe('prefer-dark');
    expect(parseGVariant('uint32 300')).toBe('300');
    expect(toGVariant('string', "it's")).toBe("'it\\'s'");
    expect(removeCmds(s)[0].args).toEqual(['reset', 'org.gnome.desktop.interface', 'color-scheme']);
  });

  it('sysctl writes now and persists in Keeper\'s own file', () => {
    const cmds = writeCmds(get('linux.kernel.swappiness'), '10');
    expect(cmds[0]).toEqual({ file: 'sysctl', args: ['-w', 'vm.swappiness=10'], admin: true });
    expect(cmds[1].args[1]).toContain("echo 'vm.swappiness=10'");
    expect(writeCmds(get('linux.kernel.tcpcc'), 'bbr')[1].args[1]).toContain('net.ipv4.tcp_congestion_control=bbr');
    expect(() => sysctlPersistScript('vm.swappiness', "1'; reboot")).toThrow();
    expect(() => sysctlPersistScript('vm;x', '1')).toThrow();
  });

  it('systemd and timedatectl', () => {
    expect(writeCmds(get('linux.service.bluetooth'), 'disabled')[0]).toEqual({ file: 'systemctl', args: ['disable', '--now', 'bluetooth.service'], admin: true });
    expect(writeCmds(get('linux.service.tracker'), 'disabled')[0]).toEqual({ file: 'systemctl', args: ['--user', 'disable', '--now', 'tracker-miner-fs-3.service'], admin: false });
    expect(parseRead(get('linux.time.ntp'), 'yes\n', true)).toBe('on');
  });

  it('advice entries never produce a setter', () => {
    const s = get('linux.storage.noatime');
    expect(validateValue(s, 'x')).toMatch(/explains/);
    expect(writeCmds(s, 'x')).toEqual([]);
    expect(s.steps!.length).toBeGreaterThan(1);
  });
});

describe('setup profiles', () => {
  it('round-trips and previews without running anything', () => {
    const p = exportProfile('Laptop', 'linux', [
      { id: 'linux.gnome.colorscheme', value: 'prefer-dark' },
      { id: 'linux.gnome.tap', value: 'true' },
      { id: 'not.a.setting', value: '1' },
    ]);
    expect(p.settings).toHaveLength(2);
    const back = parseProfile(JSON.stringify({ ...p, settings: [...p.settings, { id: 'mac.finder.hidden', value: 'true' }, { id: 'linux.kernel.swappiness', value: '999' }, { id: 'zzz', value: '1' }] }));
    const current = new Map<string, ReadResult>([['linux.gnome.tap', { id: 'linux.gnome.tap', value: 'true', isDefault: false }]]);
    expect(previewProfile(back, 'linux', current).map((i) => i.status)).toEqual(['change', 'same', 'other-os', 'invalid-value', 'unknown-setting']);
    expect(() => parseProfile('{"format":"nope"}')).toThrow(/not a Keeper setup profile/);
    expect(() => parseProfile('garbage')).toThrow();
  });
});
