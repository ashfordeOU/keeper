// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// How to read and change each Quick Control on each system: the commands, and
// the parsers for what they print. Pure: nothing here runs anything, so every
// builder and parser is tested with recorded output.

import type { ControlValue, Ctx, Os, Step } from './types';

// ---------------------------------------------------------------- quoting

/** One argument for /bin/sh, safe whatever it contains. */
export const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** A PowerShell string literal; PowerShell also treats curly quotes as quotes. */
export const ps = (s: string) => `'${s.replace(/(['‘’‚‛])/g, '$1$1')}'`;

const SFW = '/usr/libexec/ApplicationFirewall/socketfilterfw';
const DIAG_PLIST = '/Library/Application Support/CrashReporter/DiagnosticMessagesHistory.plist';
const SU_PLIST = '/Library/Preferences/com.apple.SoftwareUpdate';
const CONSENT = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore';
const DNS: Record<string, { v4: string[]; doh: string; dot: string }> = {
  quad9: { v4: ['9.9.9.9', '149.112.112.112'], doh: 'https://dns.quad9.net/dns-query', dot: 'dns.quad9.net' },
  cloudflare: { v4: ['1.1.1.1', '1.0.0.1'], doh: 'https://cloudflare-dns.com/dns-query', dot: 'cloudflare-dns.com' },
};

/** Which encrypted DNS service a list of server addresses belongs to. */
export function dnsChoiceOf(addrs: string[], encrypted: boolean): string {
  if (!encrypted) return 'off';
  for (const [k, v] of Object.entries(DNS)) if (addrs.some((a) => v.v4.includes(a.replace(/#.*$/, '')))) return k;
  return 'other';
}

// ---------------------------------------------------------------- parsers

const yes = (s: string) => /^(1|yes|on|true|enabled)$/i.test(s.trim());

export const parse = {
  macAirportPower: (out: string): boolean | null => (/:\s*On\b/i.test(out) ? true : /:\s*Off\b/i.test(out) ? false : null),
  macAirDropDisabled: (out: string): boolean | null => {
    const t = out.trim();
    if (!t || /does not exist/i.test(t)) return true; // never set: AirDrop is available
    return !yes(t);
  },
  macIpv6: (out: string): boolean | null => {
    const m = out.match(/^IPv6:\s*(.+)$/m);
    return m ? !/off/i.test(m[1]) : null;
  },
  pmsetWomp: (out: string): boolean | null => {
    const m = out.match(/^\s*womp\s+(\d)/m);
    return m ? m[1] === '1' : null;
  },
  sfwGlobal: (out: string): boolean | null => (/enabled|State = [12]/i.test(out) ? true : /disabled|State = 0/i.test(out) ? false : null),
  sfwStealth: (out: string): boolean | null => (/stealth mode (is )?(on|enabled)/i.test(out) ? true : /stealth mode (is )?(off|disabled)/i.test(out) ? false : null),
  // "Block all ENABLED!" (older) or "Firewall has block all state set to enabled." (newer)
  sfwBlockAll: (out: string): boolean | null => (/block all (state set to |is )?enabled/i.test(out) ? true : /block all (state set to |is )?disabled/i.test(out) ? false : null),
  spctl: (out: string): boolean | null => (/assessments enabled/i.test(out) ? true : /assessments disabled/i.test(out) ? false : null),
  defaultsBool: (out: string): boolean | null => {
    const t = out.trim();
    if (!t || /does not exist/i.test(t)) return null;
    return yes(t);
  },
  macHardwarePorts: (out: string): { port: string; device: string }[] => {
    const res: { port: string; device: string }[] = [];
    for (const block of out.split(/\n\s*\n/)) {
      const port = block.match(/Hardware Port:\s*(.+)/)?.[1]?.trim();
      const device = block.match(/Device:\s*(\S+)/)?.[1];
      if (port && device) res.push({ port, device });
    }
    return res;
  },
  macDefaultIface: (out: string): string | undefined => out.match(/interface:\s*(\S+)/)?.[1],

  nmRadio: (out: string): boolean | null => (/^enabled/.test(out.trim()) ? true : /^disabled/.test(out.trim()) ? false : null),
  nmActive: (out: string): { name: string; type: string; device: string }[] =>
    out.split('\n').map((l) => l.split(/(?<!\\):/).map((x) => x.replace(/\\:/g, ':'))).filter((p) => p.length >= 3 && p[0]).map(([name, type, device]) => ({ name, type, device })),
  /** nmcli -g a,b connection show X prints one value per line */
  nmFields: (out: string): string[] => out.split('\n').map((l) => l.trim()),
  rfkillJson: (out: string): { type: string; soft: boolean; hard: boolean }[] => {
    try {
      const j = JSON.parse(out) as Record<string, { type: string; soft: string; hard: string }[]>;
      return Object.values(j).flat().map((d) => ({ type: d.type, soft: d.soft === 'blocked', hard: d.hard === 'blocked' }));
    } catch {
      return [];
    }
  },
  btShow: (out: string, field: 'Powered' | 'Discoverable'): boolean | null => {
    const m = out.match(new RegExp(`^\\s*${field}:\\s*(yes|no)`, 'm'));
    return m ? m[1] === 'yes' : null;
  },
  ufwConf: (out: string): boolean | null => {
    const m = out.match(/^ENABLED\s*=\s*(\w+)/m);
    return m ? yes(m[1]) : null;
  },
  systemctlActive: (out: string): boolean | null => (/^active/m.test(out) ? true : /^(inactive|failed|unknown)/m.test(out) ? false : null),
  systemctlEnabled: (out: string): boolean | null => (/^enabled/m.test(out) ? true : /^(disabled|masked|static)/m.test(out) ? false : null),
  ethtoolWol: (out: string): boolean | null => {
    const m = out.match(/^\s*Wake-on:\s*(\w+)/m);
    return m ? m[1] !== 'd' : null;
  },
  lsmodHas: (out: string, mod: string) => new RegExp(`^${mod}\\s`, 'm').test(out),
  pactlMute: (out: string): boolean | null => (/Mute:\s*yes/i.test(out) ? true : /Mute:\s*no/i.test(out) ? false : null),
  gsettingsBool: (out: string): boolean | null => (out.trim() === 'true' ? true : out.trim() === 'false' ? false : null),

  /** Windows scripts print one word: On/Off, True/False, Allow/Deny, a number or a name. */
  word: (out: string) => out.trim().split(/\s+/)[0] ?? '',
};

// ---------------------------------------------------------------- Windows helpers

/** Loads the radio API (the switch behind Quick Settings) and finds the radio of one kind. */
const winRadio = (kind: 'WiFi' | 'Bluetooth') => `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
[Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Radios.RadioAccessStatus,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Radios.RadioState,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null
Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
$radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
$r = $radios | Where-Object { $_.Kind -eq '${kind}' } | Select-Object -First 1`;

const winReg = (key: string, name: string) => `$v = (Get-ItemProperty -Path ${ps(key)} -Name ${ps(name)} -ErrorAction SilentlyContinue).${name}; if ($null -eq $v) { 'none' } else { "$v" }`;
const winSetReg = (key: string, name: string, value: string | number) =>
  `New-Item -Path ${ps(key)} -Force -ErrorAction SilentlyContinue | Out-Null; Set-ItemProperty -Path ${ps(key)} -Name ${ps(name)} -Value ${typeof value === 'number' ? value : ps(value)}${typeof value === 'number' ? ' -Type DWord' : ''}`;

// ---------------------------------------------------------------- reading

export interface ReadSpec {
  step: Step;
  parse: (out: string) => ControlValue | null;
}

const cmd = (c: string, ...args: string[]): Step => ({ kind: 'cmd', cmd: c, args });
const pss = (script: string): Step => ({ kind: 'ps', script });

/** How to read a control here; null when it cannot be read (or is Keeper's own). */
export function readSpec(id: string, ctx: Ctx): ReadSpec | null {
  const os = ctx.os;
  if (os === 'darwin') {
    const dev = ctx.macWifiDevice;
    const svc = ctx.macService;
    switch (id) {
      case 'wifi': return dev ? { step: cmd('networksetup', '-getairportpower', dev), parse: parse.macAirportPower } : null;
      case 'airdrop': return { step: cmd('defaults', 'read', 'com.apple.NetworkBrowser', 'DisableAirDrop'), parse: parse.macAirDropDisabled };
      case 'ipv6': return svc ? { step: cmd('networksetup', '-getinfo', svc), parse: parse.macIpv6 } : null;
      case 'wakeOnLan': return { step: cmd('pmset', '-g'), parse: parse.pmsetWomp };
      case 'osFirewall': return { step: cmd(SFW, '--getglobalstate'), parse: parse.sfwGlobal };
      case 'stealth': return { step: cmd(SFW, '--getstealthmode'), parse: parse.sfwStealth };
      case 'blockIncoming': return { step: cmd(SFW, '--getblockall'), parse: parse.sfwBlockAll };
      case 'gatekeeper': return { step: cmd('spctl', '--status'), parse: parse.spctl };
      case 'diagnostics': return { step: cmd('defaults', 'read', DIAG_PLIST, 'AutoSubmit'), parse: parse.defaultsBool };
      case 'autoUpdates': return { step: cmd('defaults', 'read', SU_PLIST, 'AutomaticCheckEnabled'), parse: parse.defaultsBool };
    }
    return null;
  }
  if (os === 'linux') {
    const conn = ctx.nmConnection;
    const t = ctx.tools ?? {};
    switch (id) {
      case 'wifi': return t.nmcli ? { step: cmd('nmcli', 'radio', 'wifi'), parse: parse.nmRadio } : null;
      case 'bluetooth': return t.bluetoothctl ? { step: cmd('bluetoothctl', 'show'), parse: (o) => parse.btShow(o, 'Powered') } : null;
      case 'bluetoothDiscoverable': return t.bluetoothctl ? { step: cmd('bluetoothctl', 'show'), parse: (o) => parse.btShow(o, 'Discoverable') } : null;
      case 'airplane': return t.rfkill ? { step: cmd('rfkill', '-J'), parse: (o) => { const d = parse.rfkillJson(o); return d.length ? d.every((x) => x.soft || x.hard) : null; } } : null;
      case 'encryptedDns': return t.nmcli && conn ? { step: cmd('nmcli', '-g', 'connection.dns-over-tls,ipv4.dns', 'connection', 'show', conn), parse: (o) => { const [tls, dns] = parse.nmFields(o); return dnsChoiceOf((dns ?? '').split(/[,\s]+/).filter(Boolean), tls === '2' || tls === 'yes'); } } : null;
      case 'ipv6': return t.nmcli && conn ? { step: cmd('nmcli', '-g', 'ipv6.method', 'connection', 'show', conn), parse: (o) => (o.trim() ? o.trim() !== 'disabled' && o.trim() !== 'ignore' : null) } : null;
      case 'hotspot': return t.nmcli ? { step: cmd('nmcli', '-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show', '--active'), parse: (o) => parse.nmActive(o).some((c) => /^Hotspot/i.test(c.name)) } : null;
      case 'wakeOnLan': return t.ethtool && ctx.iface && /^(en|eth)/.test(ctx.iface) ? { step: cmd('ethtool', ctx.iface), parse: parse.ethtoolWol } : null;
      case 'osFirewall':
        if (ctx.linuxFirewall === 'ufw') return { step: cmd('cat', '/etc/ufw/ufw.conf'), parse: parse.ufwConf };
        if (ctx.linuxFirewall === 'firewalld') return { step: cmd('systemctl', 'is-active', 'firewalld'), parse: parse.systemctlActive };
        return null;
      case 'camera': return { step: cmd('cat', '/proc/modules'), parse: (o) => parse.lsmodHas(o, 'uvcvideo') };
      case 'microphone': return t.pactl ? { step: cmd('pactl', 'get-source-mute', '@DEFAULT_SOURCE@'), parse: (o) => { const m = parse.pactlMute(o); return m === null ? null : !m; } } : null;
      case 'lockOnSleep': return ctx.gnome && t.gsettings ? { step: cmd('gsettings', 'get', 'org.gnome.desktop.screensaver', 'lock-enabled'), parse: parse.gsettingsBool } : null;
      case 'diagnostics': return t.systemctl ? { step: cmd('systemctl', 'is-enabled', 'apport'), parse: parse.systemctlEnabled } : null;
      case 'autoUpdates': return t.systemctl ? { step: cmd('systemctl', 'is-enabled', 'unattended-upgrades'), parse: parse.systemctlEnabled } : null;
    }
    return null;
  }
  // Windows
  const a = ctx.winAdapter;
  const onOff = (o: string) => { const w = parse.word(o); return /^on$/i.test(w) ? true : /^off$/i.test(w) ? false : null; };
  const tf = (o: string) => { const w = parse.word(o); return /^true$/i.test(w) ? true : /^false$/i.test(w) ? false : null; };
  const allow = (o: string) => { const w = parse.word(o); return /^allow$/i.test(w) ? true : /^deny$/i.test(w) ? false : null; };
  const dword = (o: string) => { const w = parse.word(o); return /^\d+$/.test(w) ? w !== '0' : null; };
  switch (id) {
    case 'wifi': return { step: pss(`${winRadio('WiFi')}\nif ($r) { "$($r.State)" } else { 'none' }`), parse: onOff };
    case 'bluetooth': return { step: pss(`${winRadio('Bluetooth')}\nif ($r) { "$($r.State)" } else { 'none' }`), parse: onOff };
    case 'encryptedDns': return a ? { step: pss(`$s = (Get-DnsClientServerAddress -InterfaceAlias ${ps(a)} -AddressFamily IPv4).ServerAddresses; $d = @(Get-DnsClientDohServerAddress -ErrorAction SilentlyContinue | Where-Object { $s -contains $_.ServerAddress -and $_.AutoUpgrade }); if ($d.Count) { 'enc ' + ($s -join ',') } else { 'plain ' + ($s -join ',') }`), parse: (o) => { const [kind, list] = o.trim().split(/\s+/); return kind ? dnsChoiceOf((list ?? '').split(','), kind === 'enc') : null; } } : null;
    case 'ipv6': return a ? { step: pss(`"$((Get-NetAdapterBinding -Name ${ps(a)} -ComponentID ms_tcpip6).Enabled)"`), parse: tf } : null;
    case 'publicNetwork': return a ? { step: pss(`"$((Get-NetConnectionProfile -InterfaceAlias ${ps(a)}).NetworkCategory)"`), parse: (o) => { const w = parse.word(o); return /^public$/i.test(w) ? true : /^(private|domain)/i.test(w) ? false : null; } } : null;
    case 'osFirewall': return { step: pss(`"$(@(Get-NetFirewallProfile | Where-Object { -not $_.Enabled }).Count -eq 0)"`), parse: tf };
    case 'blockIncoming': return { step: pss(`"$((Get-NetFirewallProfile -Name Public).AllowInboundRules -eq 'False')"`), parse: tf };
    case 'camera': return { step: pss(winReg(`${CONSENT}\\webcam`, 'Value')), parse: allow };
    case 'microphone': return { step: pss(winReg(`${CONSENT}\\microphone`, 'Value')), parse: allow };
    case 'location': return { step: pss(winReg(`${CONSENT}\\location`, 'Value')), parse: allow };
    case 'advertisingId': return { step: pss(winReg('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', 'Enabled')), parse: dword };
    case 'clipboardHistory': return { step: pss(winReg('HKCU:\\Software\\Microsoft\\Clipboard', 'EnableClipboardHistory')), parse: dword };
    case 'clipboardSync': return { step: pss(winReg('HKCU:\\Software\\Microsoft\\Clipboard', 'EnableCloudClipboard')), parse: dword };
    case 'activityHistory': return { step: pss(winReg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'PublishUserActivities')), parse: dword };
    case 'diagnostics': return { step: pss(winReg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry')), parse: (o) => { const w = parse.word(o); return /^\d+$/.test(w) ? Number(w) >= 3 : null; } };
    case 'defenderRealtime': return { step: pss(`"$((Get-MpComputerStatus).RealTimeProtectionEnabled)"`), parse: tf };
  }
  return null;
}

// ---------------------------------------------------------------- changing

/** The steps that set a control to a value here; null when this system cannot (use the guide). */
export function setSteps(id: string, value: ControlValue, ctx: Ctx): Step[] | null {
  const on = value === true;
  const os = ctx.os;
  if (os === 'darwin') {
    const dev = ctx.macWifiDevice;
    const svc = ctx.macService;
    switch (id) {
      case 'wifi': return dev ? [cmd('networksetup', '-setairportpower', dev, on ? 'on' : 'off')] : null;
      case 'airdrop': return [cmd('defaults', 'write', 'com.apple.NetworkBrowser', 'DisableAirDrop', '-bool', on ? 'NO' : 'YES')];
      case 'ipv6': return svc ? [{ kind: 'admin-sh', script: `/usr/sbin/networksetup ${on ? '-setv6automatic' : '-setv6off'} ${sh(svc)}` }] : null;
      case 'wakeOnLan': return [{ kind: 'admin-sh', script: `/usr/bin/pmset -a womp ${on ? 1 : 0}` }];
      case 'osFirewall': return [{ kind: 'admin-sh', script: `${SFW} --setglobalstate ${on ? 'on' : 'off'}` }];
      case 'stealth': return [{ kind: 'admin-sh', script: `${SFW} --setstealthmode ${on ? 'on' : 'off'}` }];
      case 'blockIncoming': return [{ kind: 'admin-sh', script: `${SFW} --setblockall ${on ? 'on' : 'off'}` }];
      case 'gatekeeper': return [{ kind: 'admin-sh', script: `/usr/sbin/spctl ${on ? '--global-enable' : '--global-disable'}` }];
      case 'diagnostics': return [{ kind: 'admin-sh', script: `/usr/bin/defaults write ${sh(DIAG_PLIST)} AutoSubmit -bool ${on ? 'YES' : 'NO'}` }];
      case 'autoUpdates': return [{ kind: 'admin-sh', script: ['AutomaticCheckEnabled', 'AutomaticDownload', 'CriticalUpdateInstall'].map((k) => `/usr/bin/defaults write ${SU_PLIST} ${k} -bool ${on ? 'YES' : 'NO'}`).join(' && ') }];
    }
    return null;
  }
  if (os === 'linux') {
    const conn = ctx.nmConnection;
    const t = ctx.tools ?? {};
    switch (id) {
      case 'wifi': return t.nmcli ? [cmd('nmcli', 'radio', 'wifi', on ? 'on' : 'off')] : null;
      case 'bluetooth': return t.bluetoothctl ? [cmd('bluetoothctl', 'power', on ? 'on' : 'off')] : null;
      case 'bluetoothDiscoverable': return t.bluetoothctl ? [cmd('bluetoothctl', 'discoverable', on ? 'on' : 'off')] : null;
      case 'airplane': {
        if (!t.nmcli) return null;
        const steps: Step[] = [cmd('nmcli', 'radio', 'all', on ? 'off' : 'on')];
        if (t.bluetoothctl) steps.push(cmd('bluetoothctl', 'power', on ? 'off' : 'on'));
        return steps;
      }
      case 'encryptedDns': {
        if (!t.nmcli || !conn) return null;
        const d = typeof value === 'string' ? DNS[value] : undefined;
        if (value === 'off') return [{ kind: 'admin-sh', script: `nmcli connection modify ${sh(conn)} connection.dns-over-tls -1 ipv4.ignore-auto-dns no ipv4.dns '' && nmcli connection up ${sh(conn)}` }];
        if (!d) return null;
        return [{ kind: 'admin-sh', script: `nmcli connection modify ${sh(conn)} ipv4.dns ${sh(d.v4.map((x) => `${x}#${d.dot}`).join(' '))} ipv4.ignore-auto-dns yes connection.dns-over-tls 2 && nmcli connection up ${sh(conn)}` }];
      }
      case 'ipv6': return t.nmcli && conn ? [{ kind: 'admin-sh', script: `nmcli connection modify ${sh(conn)} ipv6.method ${on ? 'auto' : 'disabled'} && nmcli connection up ${sh(conn)}` }] : null;
      case 'hotspot': return t.nmcli ? [on ? cmd('nmcli', 'device', 'wifi', 'hotspot') : cmd('nmcli', 'connection', 'down', 'Hotspot')] : null;
      case 'wakeOnLan': return t.ethtool && ctx.iface ? [{ kind: 'admin-sh', script: `ethtool -s ${sh(ctx.iface)} wol ${on ? 'g' : 'd'}` }] : null;
      case 'osFirewall':
        if (ctx.linuxFirewall === 'ufw') return [{ kind: 'admin-sh', script: on ? 'ufw --force enable' : 'ufw disable' }];
        if (ctx.linuxFirewall === 'firewalld') return [{ kind: 'admin-sh', script: `systemctl ${on ? 'enable' : 'disable'} --now firewalld` }];
        return null;
      case 'camera': return [{ kind: 'admin-sh', script: on ? 'modprobe uvcvideo' : 'modprobe -r uvcvideo' }];
      case 'microphone': return t.pactl ? [cmd('pactl', 'set-source-mute', '@DEFAULT_SOURCE@', on ? '0' : '1')] : null;
      case 'lockOnSleep': return ctx.gnome && t.gsettings ? [cmd('gsettings', 'set', 'org.gnome.desktop.screensaver', 'lock-enabled', on ? 'true' : 'false')] : null;
      case 'diagnostics': return t.systemctl ? [{ kind: 'admin-sh', script: `systemctl ${on ? 'enable' : 'disable'} --now apport.service 2>/dev/null; systemctl ${on ? 'enable' : 'disable'} --now whoopsie.service 2>/dev/null; true` }] : null;
      case 'autoUpdates': return t.systemctl ? [{ kind: 'admin-sh', script: `systemctl ${on ? 'enable' : 'disable'} --now unattended-upgrades.service` }] : null;
    }
    return null;
  }
  const a = ctx.winAdapter;
  switch (id) {
    case 'wifi': return [pss(`${winRadio('WiFi')}\nif ($r) { Await ($r.SetStateAsync([Windows.Devices.Radios.RadioState]::${on ? 'On' : 'Off'})) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null }`)];
    case 'bluetooth': return [pss(`${winRadio('Bluetooth')}\nif ($r) { Await ($r.SetStateAsync([Windows.Devices.Radios.RadioState]::${on ? 'On' : 'Off'})) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null }`)];
    case 'encryptedDns': {
      if (!a) return null;
      if (value === 'off') return [{ kind: 'admin-ps', script: `Set-DnsClientServerAddress -InterfaceAlias ${ps(a)} -ResetServerAddresses` }];
      const d = typeof value === 'string' ? DNS[value] : undefined;
      if (!d) return null;
      return [{ kind: 'admin-ps', script: [...d.v4.map((ip) => `Add-DnsClientDohServerAddress -ServerAddress ${ps(ip)} -DohTemplate ${ps(d.doh)} -AllowFallbackToUdp $false -AutoUpgrade $true -ErrorAction SilentlyContinue | Out-Null`), `Set-DnsClientServerAddress -InterfaceAlias ${ps(a)} -ServerAddresses (${d.v4.map(ps).join(',')})`].join('; ') }];
    }
    case 'ipv6': return a ? [{ kind: 'admin-ps', script: `${on ? 'Enable' : 'Disable'}-NetAdapterBinding -Name ${ps(a)} -ComponentID ms_tcpip6` }] : null;
    case 'publicNetwork': return a ? [{ kind: 'admin-ps', script: `Set-NetConnectionProfile -InterfaceAlias ${ps(a)} -NetworkCategory ${on ? 'Public' : 'Private'}` }] : null;
    case 'osFirewall': return [{ kind: 'admin-ps', script: `Set-NetFirewallProfile -All -Enabled ${on ? 'True' : 'False'}` }];
    case 'blockIncoming': return [{ kind: 'admin-ps', script: on ? 'Set-NetFirewallProfile -All -DefaultInboundAction Block -AllowInboundRules False' : 'Set-NetFirewallProfile -All -AllowInboundRules True' }];
    case 'camera': return [pss(winSetReg(`${CONSENT}\\webcam`, 'Value', on ? 'Allow' : 'Deny'))];
    case 'microphone': return [pss(winSetReg(`${CONSENT}\\microphone`, 'Value', on ? 'Allow' : 'Deny'))];
    case 'location': return [pss(winSetReg(`${CONSENT}\\location`, 'Value', on ? 'Allow' : 'Deny'))];
    case 'advertisingId': return [pss(winSetReg('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', 'Enabled', on ? 1 : 0))];
    case 'clipboardHistory': return [pss(winSetReg('HKCU:\\Software\\Microsoft\\Clipboard', 'EnableClipboardHistory', on ? 1 : 0))];
    case 'clipboardSync': return [pss(`${winSetReg('HKCU:\\Software\\Microsoft\\Clipboard', 'EnableCloudClipboard', on ? 1 : 0)}; ${winSetReg('HKCU:\\Software\\Microsoft\\Clipboard', 'CloudClipboardAutomaticUpload', on ? 1 : 0)}`)];
    case 'activityHistory': return [{ kind: 'admin-ps', script: `${winSetReg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'PublishUserActivities', on ? 1 : 0)}; ${winSetReg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'UploadUserActivities', on ? 1 : 0)}` }];
    case 'diagnostics': return [{ kind: 'admin-ps', script: winSetReg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry', on ? 3 : 1) }];
    case 'defenderRealtime': return [{ kind: 'admin-ps', script: `Set-MpPreference -DisableRealtimeMonitoring $${on ? 'false' : 'true'}` }];
  }
  return null;
}

/**
 * Many changes, as few administrator prompts as possible: plain steps run one
 * by one; every administrator shell step becomes one script (one prompt), and
 * so do every elevated PowerShell step.
 */
export function batch(steps: Step[]): { plain: Step[]; adminSh?: string; adminPs?: string } {
  const plain = steps.filter((s) => s.kind === 'cmd' || s.kind === 'ps' || s.kind === 'keeper');
  const sh_ = steps.filter((s): s is Extract<Step, { kind: 'admin-sh' }> => s.kind === 'admin-sh').map((s) => s.script);
  const ps_ = steps.filter((s): s is Extract<Step, { kind: 'admin-ps' }> => s.kind === 'admin-ps').map((s) => s.script);
  return {
    plain,
    // Each part runs even if one before it fails; the script fails if any did.
    adminSh: sh_.length ? `rc=0; ${sh_.map((x) => `{ ${x}; } || rc=1`).join('; ')}; exit $rc` : undefined,
    adminPs: ps_.length ? `$ErrorActionPreference = 'Stop'; $failed = 0; ${ps_.map((x) => `try { ${x} } catch { $failed++ }`).join('; ')}; exit $failed` : undefined,
  };
}

/**
 * Windows: allow or deny one desktop app (by its .exe path) a capability such as
 * webcam or microphone, for this user. Store apps are changed in Settings.
 */
export function winPerAppScript(capability: string, exePath: string, allowed: boolean): string | null {
  if (!/^[A-Za-z]+$/.test(capability) || !/^[A-Za-z]:\\/.test(exePath) || /[\r\n]/.test(exePath)) return null;
  return winSetReg(`${CONSENT}\\${capability}\\NonPackaged\\${exePath.replace(/\\/g, '#')}`, 'Value', allowed ? 'Allow' : 'Deny');
}

// ---------------------------------------------------------------- the system's shape

export const ctxParse = {
  /** macOS: the Wi-Fi device and the service that carries the default route */
  mac(hardwarePorts: string, routeGet: string): Pick<Ctx, 'macWifiDevice' | 'macService'> {
    const ports = parse.macHardwarePorts(hardwarePorts);
    const wifi = ports.find((p) => /wi-?fi|airport/i.test(p.port));
    const iface = parse.macDefaultIface(routeGet);
    const svc = ports.find((p) => p.device === iface)?.port ?? wifi?.port;
    return { macWifiDevice: wifi?.device, macService: svc };
  },
  /** Linux: the main active connection (not loopback, bridges or VPN tunnels) */
  linux(nmActive: string): Pick<Ctx, 'nmConnection' | 'iface'> {
    const list = parse.nmActive(nmActive).filter((c) => c.device && !/^(lo|docker|virbr|br-|veth)/.test(c.device) && !/(vpn|wireguard|tun|bridge|loopback)/i.test(c.type));
    const best = list.find((c) => /ethernet/.test(c.type)) ?? list.find((c) => /wireless/.test(c.type)) ?? list[0];
    return { nmConnection: best?.name, iface: best?.device };
  },
};

export const CTX_SCRIPTS = {
  winAdapter: `$r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1; if ($r) { $r.InterfaceAlias } else { '' }`,
};

export type { Os };
