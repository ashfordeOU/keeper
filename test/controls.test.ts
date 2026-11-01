// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CONTROLS, CONTROL_BY_ID, PRESETS } from '../core/controls/catalog';
import { batch, ctxParse, dnsChoiceOf, parse, ps, readSpec, setSteps, sh, winPerAppScript } from '../core/controls/cmds';
import { autoPlan, doable, isWeakening, matches, planPreset, planValues, undoChanges, weakeningWarning } from '../core/controls/plan';
import type { ControlState, Ctx, LogEntry, Step } from '../core/controls/types';
import { resolveLink } from '../core/guide/links';

const linux: Ctx = { os: 'linux', nmConnection: 'Home Wi-Fi', iface: 'wlp2s0', linuxFirewall: 'ufw', gnome: true, tools: { nmcli: true, bluetoothctl: true, rfkill: true, pactl: true, gsettings: true, systemctl: true, ethtool: true, pkexec: true } };
const mac: Ctx = { os: 'darwin', macWifiDevice: 'en0', macService: 'Wi-Fi' };
const win: Ctx = { os: 'win32', winAdapter: 'Wi-Fi' };
const scripts = (s: Step[] | null) => (s ?? []).map((x) => ('script' in x ? x.script : 'cmd' in x ? [x.cmd, ...x.args].join(' ') : `${x.id}=${String(x.value)}`)).join('\n');

describe('catalog', () => {
  it('covers every group and system, with honest notes where Keeper cannot switch it', () => {
    const ids = new Set<string>();
    for (const c of CONTROLS) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      for (const os of ['darwin', 'win32', 'linux'] as const) expect(['direct', 'admin', 'guide', 'none']).toContain(c.support[os].how);
      if (c.kind === 'choice') expect(c.choices?.length).toBeGreaterThan(1);
      if (c.weaker !== undefined && c.kind === 'bool') expect(typeof c.weaker).toBe('boolean');
    }
    for (const g of ['network', 'firewall', 'privacy', 'security']) expect(CONTROLS.some((c) => c.group === g)).toBe(true);
  });

  it('every control that sends people to Settings has a page to open on that system', () => {
    for (const c of CONTROLS) for (const os of ['darwin', 'win32', 'linux'] as const) {
      if (c.support[os].how !== 'guide') continue;
      expect(c.topic, `${c.id} needs a topic`).toBeTruthy();
      expect(resolveLink(c.topic!, os, os === 'linux' ? 'gnome' : 'other'), `${c.id} on ${os}`).toBeTruthy();
    }
  });

  it('every system switch that is direct or admin has a way to change it with a typical setup', () => {
    for (const c of CONTROLS) {
      if (c.keeper) continue;
      for (const [os, ctx] of [['darwin', mac], ['win32', win], ['linux', linux]] as const) {
        const how = c.support[os].how;
        if (how !== 'direct' && how !== 'admin') continue;
        const v = c.kind === 'choice' ? c.choices![1].value : true;
        expect(setSteps(c.id, v, ctx), `${c.id} on ${os}`).not.toBeNull();
      }
    }
  });

  it('admin controls really go through the administrator, direct ones do not', () => {
    for (const c of CONTROLS) {
      if (c.keeper) continue;
      for (const [os, ctx] of [['darwin', mac], ['win32', win], ['linux', linux]] as const) {
        const steps = setSteps(c.id, c.kind === 'choice' ? c.choices![1].value : true, ctx);
        if (!steps) continue;
        const admin = steps.some((s) => s.kind === 'admin-sh' || s.kind === 'admin-ps');
        if (c.support[os].how === 'admin') expect(admin, `${c.id} on ${os}`).toBe(true);
        if (c.support[os].how === 'direct') expect(admin, `${c.id} on ${os}`).toBe(false);
      }
    }
  });

  it('presets only name known controls with values they take', () => {
    for (const p of PRESETS) for (const [id, v] of Object.entries(p.values)) {
      const d = CONTROL_BY_ID.get(id);
      expect(d, `${p.id}: ${id}`).toBeTruthy();
      if (d!.kind === 'choice') expect(d!.choices!.map((c) => c.value)).toContain(v);
      else expect(typeof v).toBe('boolean');
    }
  });
});

describe('parsers (recorded output)', () => {
  it('macOS', () => {
    expect(parse.macAirportPower('Wi-Fi Power (en0): On\n')).toBe(true);
    expect(parse.macAirportPower('Wi-Fi Power (en0): Off\n')).toBe(false);
    expect(parse.macAirDropDisabled('The domain/default pair of (com.apple.NetworkBrowser, DisableAirDrop) does not exist\n')).toBe(true);
    expect(parse.macAirDropDisabled('1\n')).toBe(false);
    expect(parse.macIpv6('DHCP Configuration\nIP address: 192.168.1.20\nIPv6: Automatic\nIPv6 IP address: none\n')).toBe(true);
    expect(parse.macIpv6('IPv6: Off\n')).toBe(false);
    expect(parse.pmsetWomp('System-wide power settings:\nCurrently in use:\n standby              1\n womp                 1\n')).toBe(true);
    expect(parse.pmsetWomp(' womp                 0\n')).toBe(false);
    expect(parse.sfwGlobal('Firewall is enabled. (State = 1)\n')).toBe(true);
    expect(parse.sfwGlobal('Firewall is disabled. (State = 0)\n')).toBe(false);
    expect(parse.sfwStealth('Firewall stealth mode is on\n')).toBe(true);
    expect(parse.sfwStealth('Stealth mode disabled\n')).toBe(false);
    expect(parse.sfwBlockAll('Firewall has block all state set to enabled.\n')).toBe(true);
    expect(parse.sfwBlockAll('Firewall has block all state set to disabled.\n')).toBe(false);
    expect(parse.sfwBlockAll('Block all DISABLED!\n')).toBe(false);
    expect(parse.sfwBlockAll('Block all ENABLED!\n')).toBe(true);
    expect(parse.spctl('assessments enabled\n')).toBe(true);
    expect(parse.spctl('assessments disabled\n')).toBe(false);
    expect(parse.defaultsBool('1\n')).toBe(true);
    expect(parse.defaultsBool('0\n')).toBe(false);
    expect(parse.defaultsBool('The domain/default pair of (x, y) does not exist')).toBeNull();
  });

  it('macOS: the Wi-Fi device and the service carrying the default route', () => {
    const ports = 'Hardware Port: Ethernet\nDevice: en1\nEthernet Address: aa\n\nHardware Port: Wi-Fi\nDevice: en0\nEthernet Address: bb\n\nHardware Port: Thunderbolt Bridge\nDevice: bridge0\n';
    expect(ctxParse.mac(ports, '   route to: default\ndestination: default\n  interface: en0\n')).toEqual({ macWifiDevice: 'en0', macService: 'Wi-Fi' });
    expect(ctxParse.mac(ports, '  interface: en1\n').macService).toBe('Ethernet');
  });

  it('Linux', () => {
    expect(parse.nmRadio('enabled\n')).toBe(true);
    expect(parse.nmRadio('disabled\n')).toBe(false);
    expect(parse.btShow('Controller 00:11:22 (public)\n\tName: box\n\tPowered: yes\n\tDiscoverable: no\n', 'Powered')).toBe(true);
    expect(parse.btShow('\tPowered: yes\n\tDiscoverable: no\n', 'Discoverable')).toBe(false);
    expect(parse.rfkillJson('{"rfkilldevices":[{"id":0,"type":"wlan","device":"phy0","soft":"blocked","hard":"unblocked"},{"id":1,"type":"bluetooth","device":"hci0","soft":"blocked","hard":"unblocked"}]}')).toEqual([{ type: 'wlan', soft: true, hard: false }, { type: 'bluetooth', soft: true, hard: false }]);
    expect(parse.ufwConf('# comment\nENABLED=yes\nLOGLEVEL=low\n')).toBe(true);
    expect(parse.ufwConf('ENABLED=no\n')).toBe(false);
    expect(parse.systemctlActive('inactive\n')).toBe(false);
    expect(parse.systemctlEnabled('enabled\n')).toBe(true);
    expect(parse.systemctlEnabled('masked\n')).toBe(false);
    expect(parse.ethtoolWol('Settings for enp3s0:\n\tSupports Wake-on: pumbg\n\tWake-on: d\n')).toBe(false);
    expect(parse.ethtoolWol('\tSupports Wake-on: pumbg\n\tWake-on: g\n')).toBe(true);
    expect(parse.lsmodHas('snd 1 0 - Live 0x0\nuvcvideo 135168 0 - Live 0x0\n', 'uvcvideo')).toBe(true);
    expect(parse.pactlMute('Mute: yes\n')).toBe(true);
    expect(parse.gsettingsBool('true\n')).toBe(true);
  });

  it('Linux: the main connection, not VPNs, bridges or loopback (names with colons kept)', () => {
    const out = 'lo:loopback:lo\nwg0:wireguard:wg0\ndocker0:bridge:docker0\nCafe\\: Free:802-11-wireless:wlp2s0\n';
    expect(ctxParse.linux(out)).toEqual({ nmConnection: 'Cafe: Free', iface: 'wlp2s0' });
    expect(ctxParse.linux('Wired:802-3-ethernet:enp3s0\nHome:802-11-wireless:wlp2s0\n').iface).toBe('enp3s0');
    expect(ctxParse.linux('')).toEqual({ nmConnection: undefined, iface: undefined });
  });

  it('encrypted DNS: which service', () => {
    expect(dnsChoiceOf(['9.9.9.9#dns.quad9.net'], true)).toBe('quad9');
    expect(dnsChoiceOf(['1.1.1.1'], true)).toBe('cloudflare');
    expect(dnsChoiceOf(['8.8.8.8'], true)).toBe('other');
    expect(dnsChoiceOf(['9.9.9.9'], false)).toBe('off');
  });

  it('readers parse what the system prints', () => {
    const enc = readSpec('encryptedDns', linux)!;
    expect(enc.parse('2\n9.9.9.9#dns.quad9.net,149.112.112.112#dns.quad9.net\n')).toBe('quad9');
    expect(enc.parse('-1\n\n')).toBe('off');
    expect(readSpec('airplane', linux)!.parse('{"rfkilldevices":[{"type":"wlan","soft":"blocked","hard":"unblocked"}]}')).toBe(true);
    expect(readSpec('microphone', linux)!.parse('Mute: yes')).toBe(false);
    expect(readSpec('hotspot', linux)!.parse('Hotspot:802-11-wireless:wlp2s0\n')).toBe(true);
    expect(readSpec('camera', win)!.parse('Deny\n')).toBe(false);
    expect(readSpec('camera', win)!.parse('Allow\n')).toBe(true);
    expect(readSpec('camera', win)!.parse('none\n')).toBeNull();
    expect(readSpec('publicNetwork', win)!.parse('Public\n')).toBe(true);
    expect(readSpec('publicNetwork', win)!.parse('Private\n')).toBe(false);
    expect(readSpec('diagnostics', win)!.parse('1\n')).toBe(false);
    expect(readSpec('diagnostics', win)!.parse('3\n')).toBe(true);
    expect(readSpec('encryptedDns', win)!.parse('enc 9.9.9.9,149.112.112.112\n')).toBe('quad9');
    expect(readSpec('encryptedDns', win)!.parse('plain 192.168.1.1\n')).toBe('off');
    expect(readSpec('wifi', win)!.parse('On\n')).toBe(true);
    expect(readSpec('defenderRealtime', win)!.parse('False\n')).toBe(false);
  });

  it('no reader when the tool is missing', () => {
    expect(readSpec('wifi', { ...linux, tools: {} })).toBeNull();
    expect(readSpec('osFirewall', { ...linux, linuxFirewall: 'none' })).toBeNull();
    expect(setSteps('wifi', true, { ...linux, tools: {} })).toBeNull();
  });
});

describe('builders', () => {
  it('macOS commands', () => {
    expect(scripts(setSteps('wifi', false, mac))).toBe('networksetup -setairportpower en0 off');
    expect(scripts(setSteps('airdrop', false, mac))).toBe('defaults write com.apple.NetworkBrowser DisableAirDrop -bool YES');
    expect(scripts(setSteps('stealth', true, mac))).toBe('/usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on');
    expect(scripts(setSteps('gatekeeper', true, mac))).toBe('/usr/sbin/spctl --global-enable');
    expect(scripts(setSteps('ipv6', false, mac))).toBe("/usr/sbin/networksetup -setv6off 'Wi-Fi'");
  });

  it('Linux commands', () => {
    expect(scripts(setSteps('wifi', true, linux))).toBe('nmcli radio wifi on');
    expect(scripts(setSteps('airplane', true, linux))).toBe('nmcli radio all off\nbluetoothctl power off');
    expect(scripts(setSteps('osFirewall', true, linux))).toBe('ufw --force enable');
    expect(scripts(setSteps('osFirewall', false, { ...linux, linuxFirewall: 'firewalld' }))).toBe('systemctl disable --now firewalld');
    expect(scripts(setSteps('encryptedDns', 'quad9', linux))).toBe("nmcli connection modify 'Home Wi-Fi' ipv4.dns '9.9.9.9#dns.quad9.net 149.112.112.112#dns.quad9.net' ipv4.ignore-auto-dns yes connection.dns-over-tls 2 && nmcli connection up 'Home Wi-Fi'");
    expect(scripts(setSteps('microphone', false, linux))).toBe('pactl set-source-mute @DEFAULT_SOURCE@ 1');
    expect(setSteps('encryptedDns', 'nonsense', linux)).toBeNull();
  });

  it('Windows scripts', () => {
    expect(scripts(setSteps('osFirewall', true, win))).toBe('Set-NetFirewallProfile -All -Enabled True');
    expect(scripts(setSteps('publicNetwork', true, win))).toBe("Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -NetworkCategory Public");
    expect(scripts(setSteps('camera', false, win))).toContain("ConsentStore\\webcam' -Name 'Value' -Value 'Deny'");
    expect(scripts(setSteps('encryptedDns', 'cloudflare', win))).toContain("Add-DnsClientDohServerAddress -ServerAddress '1.1.1.1' -DohTemplate 'https://cloudflare-dns.com/dns-query'");
    expect(scripts(setSteps('encryptedDns', 'off', win))).toBe("Set-DnsClientServerAddress -InterfaceAlias 'Wi-Fi' -ResetServerAddresses");
    expect(scripts(setSteps('defenderRealtime', true, win))).toBe('Set-MpPreference -DisableRealtimeMonitoring $false');
    expect(scripts(setSteps('wifi', false, win))).toContain('SetStateAsync([Windows.Devices.Radios.RadioState]::Off)');
  });

  it('names from the system cannot break out of the command', () => {
    const evil = "x'; rm -rf / #";
    const s = scripts(setSteps('ipv6', false, { ...linux, nmConnection: evil }));
    expect(s).toContain(sh(evil));
    // The shell sees one argument whatever the name holds.
    expect(execFileSync('sh', ['-c', `printf %s ${sh(evil)}`], { encoding: 'utf8' })).toBe(evil);
    expect(ps("it's ’quoted’")).toBe("'it''s ’’quoted’’'");
    const w = scripts(setSteps('publicNetwork', true, { ...win, winAdapter: "Wi-Fi'; Remove-Item C:\\ -Recurse; '" }));
    expect(w).toContain("-InterfaceAlias 'Wi-Fi''; Remove-Item C:\\ -Recurse; '''");
  });

  it('Windows per-app access by .exe path; nothing else', () => {
    expect(winPerAppScript('webcam', 'C:\\Program Files\\Zoom\\bin\\Zoom.exe', false)).toContain("ConsentStore\\webcam\\NonPackaged\\C:#Program Files#Zoom#bin#Zoom.exe' -Name 'Value' -Value 'Deny'");
    expect(winPerAppScript('web cam', 'C:\\a.exe', false)).toBeNull();
    expect(winPerAppScript('webcam', 'Zoom', false)).toBeNull();
  });
});

describe('one administrator prompt per batch', () => {
  it('gathers every administrator step into one script, plain steps stay separate', () => {
    const steps = [...setSteps('osFirewall', true, mac)!, ...setSteps('stealth', true, mac)!, ...setSteps('wifi', true, mac)!, ...setSteps('airdrop', false, mac)!];
    const b = batch(steps);
    expect(b.plain).toHaveLength(2);
    expect(b.adminSh).toBe('rc=0; { /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on; } || rc=1; { /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on; } || rc=1; exit $rc');
    expect(b.adminPs).toBeUndefined();
  });

  it('a failing part does not stop the rest, but the script reports it', () => {
    const b = batch([{ kind: 'admin-sh', script: 'false' }, { kind: 'admin-sh', script: 'echo second' }]);
    let code = 0;
    let out = '';
    try { out = execFileSync('sh', ['-c', b.adminSh!], { encoding: 'utf8' }); } catch (e) { code = (e as { status: number }).status; out = (e as { stdout: string }).stdout; }
    expect(code).toBe(1);
    expect(out).toBe('second\n');
    expect(execFileSync('sh', ['-c', batch([{ kind: 'admin-sh', script: 'true' }]).adminSh!], { encoding: 'utf8' })).toBe('');
  });

  it('Windows: one elevated script counting failures', () => {
    const b = batch([...setSteps('osFirewall', true, win)!, ...setSteps('ipv6', false, win)!, ...setSteps('camera', false, win)!]);
    expect(b.plain).toHaveLength(1);
    expect(b.adminPs).toMatch(/^\$ErrorActionPreference = 'Stop'; \$failed = 0; try \{ Set-NetFirewallProfile .* \} catch \{ \$failed\+\+ \}; try \{ Disable-NetAdapterBinding .* \} catch \{ \$failed\+\+ \}; exit \$failed$/);
  });
});

describe('plans, warnings and undo', () => {
  const st = (rows: [string, ControlState['value'], ControlState['how']][]) => new Map(rows.map(([id, value, how]) => [id, { id, value, how }]));

  it('turning protection down is a weakening change; up is not', () => {
    expect(isWeakening(CONTROL_BY_ID.get('osFirewall'), true, false)).toBe(true);
    expect(isWeakening(CONTROL_BY_ID.get('osFirewall'), false, true)).toBe(false);
    expect(isWeakening(CONTROL_BY_ID.get('camera'), false, true)).toBe(true);
    expect(isWeakening(CONTROL_BY_ID.get('encryptedDns'), 'quad9', 'off')).toBe(true);
    expect(isWeakening(CONTROL_BY_ID.get('keeperFwMode'), 'alert', 'silent-allow')).toBe(true);
    expect(isWeakening(CONTROL_BY_ID.get('keeperFwMode'), 'alert', 'silent-deny')).toBe(false);
    expect(isWeakening(CONTROL_BY_ID.get('wifi'), true, false)).toBe(false);
    expect(isWeakening(CONTROL_BY_ID.get('defenderRealtime'), null, false)).toBe(true);
    expect(weakeningWarning(CONTROL_BY_ID.get('defenderRealtime')!, false)).toMatch(/Microsoft Defender real-time protection off makes this computer less protected\. Windows will stop checking/);
    expect(weakeningWarning(CONTROL_BY_ID.get('encryptedDns')!, 'off')).toMatch(/^Encrypted DNS for the system: Off/);
  });

  it('a preset changes only what differs, skips what this system lacks, flags weakening', () => {
    const states = st([['osFirewall', false, 'admin'], ['stealth', true, 'admin'], ['blockIncoming', true, 'admin'], ['publicNetwork', true, 'guide'], ['dnsFilter', true, 'direct'], ['camera', null, 'none']]);
    const plan = planPreset(PRESETS.find((p) => p.id === 'home')!, states);
    expect(plan.items.map((i) => [i.id, i.to, i.weakening])).toEqual([['osFirewall', true, false], ['blockIncoming', false, true], ['publicNetwork', false, true]]);
    expect(plan.same).toEqual(['dnsFilter']);
    expect(doable(plan.items).map((i) => i.id)).toEqual(['osFirewall', 'blockIncoming']);
    const lockdown = planPreset(PRESETS.find((p) => p.id === 'lockdown')!, states);
    expect(lockdown.skipped.map((s) => s.id)).toEqual(['camera']);
  });

  it('presets bound to a firewall profile never weaken on their own', () => {
    const states = st([['osFirewall', false, 'admin'], ['blockIncoming', true, 'admin'], ['dnsFilter', false, 'direct']]);
    const r = autoPlan(PRESETS.find((p) => p.id === 'home')!, states);
    expect(r.apply.map((i) => i.id)).toEqual(['osFirewall', 'dnsFilter']);
    expect(r.held.map((i) => i.id)).toEqual(['blockIncoming']);
  });

  it('apply then undo puts every known value back', () => {
    const states = st([['wifi', true, 'direct'], ['keeperFwMode', 'alert', 'direct'], ['bluetooth', null, 'direct']]);
    const plan = planValues({ wifi: false, keeperFwMode: 'silent-deny', bluetooth: false }, states);
    const entry: LogEntry = { id: '1', at: 0, title: 't', changes: plan.items.map((i) => ({ id: i.id, from: i.from, to: i.to })) };
    // the value Keeper could not read is not "restored" to a guess
    expect(undoChanges(entry)).toEqual([{ id: 'wifi', from: false, to: true }, { id: 'keeperFwMode', from: 'silent-deny', to: 'alert' }]);
    // undoing a strengthening change is itself weakening, so it is confirmed too
    const after = st([['keeperFwMode', 'silent-deny', 'direct']]);
    expect(planValues({ keeperFwMode: 'alert' }, after).items[0].weakening).toBe(false);
    const fw = st([['osFirewall', true, 'admin']]);
    expect(planValues({ osFirewall: false }, fw).items[0].weakening).toBe(true);
  });

  it('search finds by name, words in the description and group', () => {
    expect(matches(CONTROL_BY_ID.get('wifi')!, 'wi-fi')).toBe(true);
    expect(matches(CONTROL_BY_ID.get('dnsFilter')!, 'blocklists')).toBe(true);
    expect(matches(CONTROL_BY_ID.get('camera')!, 'privacy')).toBe(true);
    expect(matches(CONTROL_BY_ID.get('camera')!, 'bluetooth')).toBe(false);
  });
});
