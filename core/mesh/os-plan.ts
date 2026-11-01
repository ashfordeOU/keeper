// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The exact commands that put the mesh into the operating system, per system:
// the interface, routes, names (split DNS), exit node (forwarding and NAT),
// the kill switch, and the access rules. Pure: nothing here runs anything.
// The privileged helper (electron/services/mesh/helper.ts) checks every step
// against plan-guard.ts before it runs it, and every "up" has a matching
// "down" in cleanupPlan(), which is also what runs after a crash.

import { familyOf, parseCidr } from '../net/addr';
import { complement, type AclEntry, type PortRange } from './rules';

export type MeshOS = 'linux' | 'darwin' | 'win32';

export interface Step {
  file: string;
  args: string[];
  /** given to the command on standard input (never on the command line) */
  stdin?: string;
  /** a "down" step: carry on if it fails (the thing may already be gone) */
  ignoreError?: boolean;
  /** extra environment (only WG_* names pass the guard) */
  env?: Record<string, string>;
}

export interface IfaceCtx {
  os: MeshOS;
  /** km-<4 hex> on Linux, utunN on macOS, "Keeper-<name>" on Windows */
  iface: string;
  impl: 'kernel' | 'wireguard-go' | 'wireguard-nt';
  a6: string;
  a4?: string;
  prefix6: string;
  prefix4?: string;
  mtu: number;
  /** setconf text (Linux kernel), UAPI text (wireguard-go) or the full file (Windows) */
  conf: string;
  /** wireguard-go or wireguard.exe, a verified path */
  bin?: string;
  /** the wg tool, when there is one */
  wg?: string;
  /** Windows: where the tunnel file is written (its name is the tunnel's name) */
  confPath?: string;
  /** this kernel has no IPv6 (some containers and minimal kernels): IPv4 only */
  noV6?: boolean;
}

/** The fixed names Keeper uses in the OS, so cleanup finds exactly its own things. */
export const NAMES = {
  nftAcl: 'keeper_mesh_acl',
  nftNat: 'keeper_mesh_nat',
  nftKill: 'keeper_mesh_kill',
  pfAnchor: 'com.apple/250.KeeperMesh',
  pfKill: 'com.apple/251.KeeperMeshKill',
  winGroup: 'Keeper Mesh',
  winNat: 'KeeperMesh',
  nrpt: 'Keeper Mesh',
  hostsBegin: '# BEGIN Keeper Mesh (managed by Keeper; do not edit)',
  hostsEnd: '# END Keeper Mesh',
};

/** A Linux interface name for a network: km- plus 4 hex digits (at most 15 characters). */
export const linuxIface = (netId: string) => `km-${netId.slice(0, 4)}`;
/** A Windows tunnel name (also its adapter's name). */
export const windowsTunnel = (name: string) => `Keeper-${name.replace(/[^A-Za-z0-9_=+.-]/g, '').slice(0, 24) || 'Mesh'}`;

const psq = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const ps = (script: string, ignoreError = false): Step => ({ file: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', script], ...(ignoreError ? { ignoreError } : {}) });
const v6net = (p: string) => parseCidr(p)!;

// ---------------------------------------------------------------- the interface

export function ifaceUp(c: IfaceCtx): Step[] {
  if (c.os === 'linux') {
    const steps: Step[] = [];
    if (c.impl === 'kernel') {
      steps.push({ file: 'ip', args: ['link', 'add', 'dev', c.iface, 'type', 'wireguard'] });
      steps.push({ file: c.wg ?? 'wg', args: ['setconf', c.iface, '/dev/stdin'], stdin: c.conf });
    } else {
      steps.push({ file: c.bin!, args: [c.iface], env: { WG_PROCESS_FOREGROUND: '0' } });
      steps.push({ file: 'uapi', args: [c.iface], stdin: c.conf });
    }
    if (!c.noV6) steps.push({ file: 'ip', args: ['-6', 'address', 'add', `${c.a6}/${v6net(c.prefix6).prefix}`, 'dev', c.iface] });
    if (c.a4 && c.prefix4) steps.push({ file: 'ip', args: ['-4', 'address', 'add', `${c.a4}/${parseCidr(c.prefix4)!.prefix}`, 'dev', c.iface] });
    steps.push({ file: 'ip', args: ['link', 'set', 'dev', c.iface, 'mtu', String(c.mtu), 'up'] });
    return steps;
  }
  if (c.os === 'darwin') {
    const steps: Step[] = [
      { file: c.bin!, args: [c.iface], env: { WG_PROCESS_FOREGROUND: '0' } },
      { file: 'uapi', args: [c.iface], stdin: c.conf },
      ...(c.noV6 ? [] : [
        { file: 'ifconfig', args: [c.iface, 'inet6', c.a6, 'prefixlen', '128', 'alias'] },
        { file: 'route', args: ['-q', '-n', 'add', '-inet6', c.prefix6, '-interface', c.iface] },
      ]),
    ];
    if (c.a4 && c.prefix4) {
      steps.push({ file: 'ifconfig', args: [c.iface, 'inet', `${c.a4}/32`, c.a4, 'alias'] });
      steps.push({ file: 'route', args: ['-q', '-n', 'add', '-inet', c.prefix4, '-interface', c.iface] });
    }
    steps.push({ file: 'ifconfig', args: [c.iface, 'mtu', String(c.mtu), 'up'] });
    return steps;
  }
  // Windows: WireGuard for Windows' tunnel service reads the whole file (addresses, routes from AllowedIPs, DNS).
  return [
    ps(`New-Item -ItemType Directory -Force -Path ${psq(dirOf(c.confPath!))} | Out-Null; Set-Content -LiteralPath ${psq(c.confPath!)} -Value ${psq(c.conf)} -Encoding ascii; icacls ${psq(c.confPath!)} /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' | Out-Null`),
    { file: c.bin!, args: ['/installtunnelservice', c.confPath!] },
  ];
}

export function ifaceDown(c: Pick<IfaceCtx, 'os' | 'iface' | 'impl' | 'bin' | 'confPath'>): Step[] {
  if (c.os === 'linux') return [{ file: 'ip', args: ['link', 'delete', 'dev', c.iface], ignoreError: true }, { file: 'rm', args: ['-f', `/var/run/wireguard/${c.iface}.sock`], ignoreError: true }];
  // Removing wireguard-go's control socket makes it exit and take the utun interface with it.
  if (c.os === 'darwin') return [{ file: 'rm', args: ['-f', `/var/run/wireguard/${c.iface}.sock`], ignoreError: true }];
  return [{ file: c.bin ?? 'wireguard', args: ['/uninstalltunnelservice', c.iface], ignoreError: true }, ...(c.confPath ? [ps(`Remove-Item -LiteralPath ${psq(c.confPath)} -Force -ErrorAction SilentlyContinue`, true)] : [])];
}

/** Updates the peers of a running interface. */
export function ifaceSync(c: IfaceCtx): Step[] {
  if (c.os === 'linux' && c.impl === 'kernel') return [{ file: c.wg ?? 'wg', args: ['syncconf', c.iface, '/dev/stdin'], stdin: c.conf }];
  if (c.os !== 'win32') return [{ file: 'uapi', args: [c.iface], stdin: c.conf }];
  // Windows: the tunnel service is given the new file.
  return [...ifaceDown(c).filter((s) => s.file !== 'powershell'), ...ifaceUp(c)];
}

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');

// ---------------------------------------------------------------- routes (subnets other devices share)

export function routesUp(os: MeshOS, iface: string, cidrs: string[]): Step[] {
  if (os === 'win32') return []; // the tunnel service adds a route for every AllowedIPs entry
  return cidrs.map((r) => {
    const fam = familyOf(parseCidr(r)!.net);
    if (os === 'linux') return { file: 'ip', args: [fam === 6 ? '-6' : '-4', 'route', 'replace', r, 'dev', iface] };
    return { file: 'route', args: ['-q', '-n', 'add', fam === 6 ? '-inet6' : '-inet', r, '-interface', iface] };
  });
}

export function routesDown(os: MeshOS, iface: string, cidrs: string[]): Step[] {
  if (os === 'win32') return [];
  return cidrs.map((r) => {
    const fam = familyOf(parseCidr(r)!.net);
    if (os === 'linux') return { file: 'ip', args: [fam === 6 ? '-6' : '-4', 'route', 'delete', r, 'dev', iface], ignoreError: true };
    return { file: 'route', args: ['-q', '-n', 'delete', fam === 6 ? '-inet6' : '-inet', r, '-interface', iface], ignoreError: true };
  });
}

// ---------------------------------------------------------------- names: split DNS

export interface DnsCtx {
  os: MeshOS;
  iface: string;
  /** the responder's address (this device's mesh address) */
  server: string;
  port: number;
  suffix: string;
}

const hostPort = (ip: string, port: number) => (port === 53 ? ip : familyOf(ip) === 6 ? `[${ip}]:${port}` : `${ip}:${port}`);

export function dnsUp(d: DnsCtx): Step[] {
  if (d.os === 'linux') return [
    { file: 'resolvectl', args: ['dns', d.iface, hostPort(d.server, d.port)] },
    { file: 'resolvectl', args: ['domain', d.iface, `~${d.suffix}`] },
  ];
  if (d.os === 'darwin') return [
    { file: 'mkdir', args: ['-p', '/etc/resolver'] },
    { file: 'tee', args: [`/etc/resolver/${d.suffix}`], stdin: `# Keeper Mesh\nnameserver ${d.server}\nport ${d.port}\n` },
  ];
  // NRPT has no port: the responder listens on 53 on Windows.
  return [ps(`Get-DnsClientNrptRule | Where-Object Comment -eq ${psq(NAMES.nrpt)} | Remove-DnsClientNrptRule -Force; Add-DnsClientNrptRule -Namespace ${psq('.' + d.suffix)} -NameServers ${psq(d.server)} -Comment ${psq(NAMES.nrpt)}; Clear-DnsClientCache`)];
}

export function dnsDown(d: Pick<DnsCtx, 'os' | 'iface' | 'suffix'>): Step[] {
  if (d.os === 'linux') return [{ file: 'resolvectl', args: ['revert', d.iface], ignoreError: true }];
  if (d.os === 'darwin') return [{ file: 'rm', args: ['-f', `/etc/resolver/${d.suffix}`], ignoreError: true }];
  return [ps(`Get-DnsClientNrptRule | Where-Object Comment -eq ${psq(NAMES.nrpt)} | Remove-DnsClientNrptRule -Force; Clear-DnsClientCache`, true)];
}

/** The hosts file with Keeper's block replaced (or removed when `entries` is empty). */
export function withHostsBlock(current: string, entries: { ip: string; names: string[] }[]): string {
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const lines = current.split(/\r?\n/);
  const out: string[] = [];
  let inside = false;
  for (const l of lines) {
    if (l.trim() === NAMES.hostsBegin) inside = true;
    else if (l.trim() === NAMES.hostsEnd) inside = false;
    else if (!inside) out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  if (entries.length) {
    out.push('', NAMES.hostsBegin);
    for (const e of entries) out.push(`${e.ip}\t${e.names.join(' ')}`);
    out.push(NAMES.hostsEnd);
  }
  return out.join(eol) + eol;
}

export const hostsPath = (os: MeshOS) => (os === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts');

export function hostsWrite(os: MeshOS, content: string): Step[] {
  if (os === 'win32') return [ps(`Set-Content -LiteralPath ${psq(hostsPath(os))} -Value ${psq(content)} -NoNewline -Encoding ascii`)];
  return [{ file: 'tee', args: [hostsPath(os)], stdin: content }];
}

// ---------------------------------------------------------------- offering this device as an exit node

export interface ExitServeCtx {
  os: MeshOS;
  iface: string;
  prefix6: string;
  prefix4?: string;
  /** the interface to the internet (macOS pf needs it) */
  wan?: string;
  noV6?: boolean;
}

export function exitServeUp(c: ExitServeCtx): Step[] {
  if (c.os === 'linux') {
    const nat = [
      `table inet ${NAMES.nftNat} {`,
      '  chain forward {',
      '    type filter hook forward priority filter; policy accept;',
      `    iifname "${c.iface}" accept`,
      `    oifname "${c.iface}" ct state established,related accept`,
      '  }',
      '  chain postrouting {',
      '    type nat hook postrouting priority srcnat; policy accept;',
      ...(c.prefix4 ? [`    ip saddr ${c.prefix4} oifname != "${c.iface}" masquerade`] : []),
      `    ip6 saddr ${c.prefix6} oifname != "${c.iface}" masquerade`,
      '  }',
      '}',
    ].join('\n');
    return [
      { file: 'sysctl', args: ['-w', 'net.ipv4.ip_forward=1'] },
      ...(c.noV6 ? [] : [{ file: 'sysctl', args: ['-w', 'net.ipv6.conf.all.forwarding=1'] }]),
      { file: 'nft', args: ['-f', '-'], stdin: `table inet ${NAMES.nftNat}\ndelete table inet ${NAMES.nftNat}\n${nat}\n` },
    ];
  }
  if (c.os === 'darwin') {
    const wan = c.wan ?? 'en0';
    const rules = [...(c.prefix4 ? [`nat on ${wan} inet from ${c.prefix4} to any -> (${wan})`] : []), `nat on ${wan} inet6 from ${c.prefix6} to any -> (${wan})`].join('\n');
    return [
      { file: 'sysctl', args: ['-w', 'net.inet.ip.forwarding=1'] },
      { file: 'sysctl', args: ['-w', 'net.inet6.ip6.forwarding=1'] },
      { file: 'pfctl', args: ['-a', NAMES.pfAnchor + '/nat', '-f', '-'], stdin: rules + '\n' },
      { file: 'pfctl', args: ['-E'] },
    ];
  }
  return [
    ps(`Set-NetIPInterface -InterfaceAlias ${psq(c.iface)} -Forwarding Enabled`),
    ...(c.prefix4 ? [ps(`Get-NetNat -Name ${psq(NAMES.winNat)} -ErrorAction SilentlyContinue | Remove-NetNat -Confirm:$false; New-NetNat -Name ${psq(NAMES.winNat)} -InternalIPInterfaceAddressPrefix ${psq(c.prefix4)} | Out-Null`)] : []),
  ];
}

/** `before` is what the forwarding switches were, so they are put back as they were. */
export function exitServeDown(c: Pick<ExitServeCtx, 'os' | 'iface' | 'noV6'>, before: { v4?: string; v6?: string } = {}): Step[] {
  if (c.os === 'linux') return [
    { file: 'nft', args: ['delete', 'table', 'inet', NAMES.nftNat], ignoreError: true },
    { file: 'sysctl', args: ['-w', `net.ipv4.ip_forward=${before.v4 ?? '0'}`], ignoreError: true },
    ...(c.noV6 ? [] : [{ file: 'sysctl', args: ['-w', `net.ipv6.conf.all.forwarding=${before.v6 ?? '0'}`], ignoreError: true }]),
  ];
  if (c.os === 'darwin') return [
    { file: 'pfctl', args: ['-a', NAMES.pfAnchor + '/nat', '-F', 'all'], ignoreError: true },
    { file: 'sysctl', args: ['-w', `net.inet.ip.forwarding=${before.v4 ?? '0'}`], ignoreError: true },
    { file: 'sysctl', args: ['-w', `net.inet6.ip6.forwarding=${before.v6 ?? '0'}`], ignoreError: true },
  ];
  return [ps(`Get-NetNat -Name ${psq(NAMES.winNat)} -ErrorAction SilentlyContinue | Remove-NetNat -Confirm:$false; Set-NetIPInterface -InterfaceAlias ${psq(c.iface)} -Forwarding Disabled -ErrorAction SilentlyContinue`, true)];
}

// ---------------------------------------------------------------- using another device as the exit node

export interface ExitUseCtx {
  os: MeshOS;
  iface: string;
  /** where Keeper's own encrypted packets go (the exit node's address, the relay): kept off the tunnel */
  bypass: string[];
  /** the gateway and interface those go through (from the routing table before the switch) */
  gw4?: string;
  gw6?: string;
  wan?: string;
  killSwitch: boolean;
  /** the local network stays reachable (printers, the router) */
  allowLan: boolean;
  lan: string[];
  /** DNS through the exit node: its mesh address */
  dns?: string;
  /** macOS: network services whose DNS servers are set (and put back) */
  services?: { name: string; before: string[] }[];
  noV6?: boolean;
}

const HALVES4 = ['0.0.0.0/1', '128.0.0.0/1'];
const HALVES6 = ['::/1', '8000::/1'];

export function exitUseUp(c: ExitUseCtx): Step[] {
  const v4 = c.bypass.filter((a) => familyOf(a) === 4);
  const v6 = c.bypass.filter((a) => familyOf(a) === 6);
  if (c.os === 'linux') {
    const steps: Step[] = [];
    for (const a of v4) if (c.gw4) steps.push({ file: 'ip', args: ['-4', 'route', 'replace', `${a}/32`, 'via', c.gw4, ...(c.wan ? ['dev', c.wan] : [])] });
    for (const a of v6) if (c.gw6) steps.push({ file: 'ip', args: ['-6', 'route', 'replace', `${a}/128`, 'via', c.gw6, ...(c.wan ? ['dev', c.wan] : [])] });
    // Two halves instead of the default route: more specific, and the old default stays for the way back.
    for (const h of HALVES4) steps.push({ file: 'ip', args: ['-4', 'route', 'replace', h, 'dev', c.iface] });
    if (!c.noV6) for (const h of HALVES6) steps.push({ file: 'ip', args: ['-6', 'route', 'replace', h, 'dev', c.iface] });
    if (c.dns) steps.push({ file: 'resolvectl', args: ['dns', c.iface, c.dns] }, { file: 'resolvectl', args: ['domain', c.iface, '~.'] }, { file: 'resolvectl', args: ['default-route', c.iface, 'yes'] });
    if (c.killSwitch) steps.push({ file: 'nft', args: ['-f', '-'], stdin: nftKill(c, v4, v6) });
    return steps;
  }
  if (c.os === 'darwin') {
    const steps: Step[] = [];
    for (const a of v4) if (c.gw4) steps.push({ file: 'route', args: ['-q', '-n', 'add', '-inet', `${a}/32`, c.gw4] });
    for (const a of v6) if (c.gw6) steps.push({ file: 'route', args: ['-q', '-n', 'add', '-inet6', `${a}/128`, c.gw6] });
    for (const h of HALVES4) steps.push({ file: 'route', args: ['-q', '-n', 'add', '-inet', h, '-interface', c.iface] });
    for (const h of HALVES6) steps.push({ file: 'route', args: ['-q', '-n', 'add', '-inet6', h, '-interface', c.iface] });
    if (c.dns) for (const s of c.services ?? []) steps.push({ file: 'networksetup', args: ['-setdnsservers', s.name, c.dns] });
    if (c.killSwitch) steps.push({ file: 'pfctl', args: ['-a', NAMES.pfKill, '-f', '-'], stdin: pfKill(c, v4, v6) }, { file: 'pfctl', args: ['-E'] });
    return steps;
  }
  // Windows: the tunnel file carries AllowedIPs = 0.0.0.0/0, ::/0 and DNS; WireGuard for Windows then routes
  // everything through it and blocks traffic that would go around it (its own kill switch).
  return [];
}

export function exitUseDown(c: ExitUseCtx): Step[] {
  const v4 = c.bypass.filter((a) => familyOf(a) === 4);
  const v6 = c.bypass.filter((a) => familyOf(a) === 6);
  if (c.os === 'linux') return [
    { file: 'nft', args: ['delete', 'table', 'inet', NAMES.nftKill], ignoreError: true },
    ...(c.dns ? [{ file: 'resolvectl', args: ['revert', c.iface], ignoreError: true }] : []),
    ...HALVES4.map((h) => ({ file: 'ip', args: ['-4', 'route', 'delete', h, 'dev', c.iface], ignoreError: true })),
    ...(c.noV6 ? [] : HALVES6.map((h) => ({ file: 'ip', args: ['-6', 'route', 'delete', h, 'dev', c.iface], ignoreError: true }))),
    ...v4.map((a) => ({ file: 'ip', args: ['-4', 'route', 'delete', `${a}/32`], ignoreError: true })),
    ...v6.map((a) => ({ file: 'ip', args: ['-6', 'route', 'delete', `${a}/128`], ignoreError: true })),
  ];
  if (c.os === 'darwin') return [
    { file: 'pfctl', args: ['-a', NAMES.pfKill, '-F', 'all'], ignoreError: true },
    ...(c.services ?? []).map((s) => ({ file: 'networksetup', args: ['-setdnsservers', s.name, ...(s.before.length ? s.before : ['Empty'])], ignoreError: true })),
    ...HALVES4.map((h) => ({ file: 'route', args: ['-q', '-n', 'delete', '-inet', h, '-interface', c.iface], ignoreError: true })),
    ...HALVES6.map((h) => ({ file: 'route', args: ['-q', '-n', 'delete', '-inet6', h, '-interface', c.iface], ignoreError: true })),
    ...v4.map((a) => ({ file: 'route', args: ['-q', '-n', 'delete', '-inet', `${a}/32`], ignoreError: true })),
    ...v6.map((a) => ({ file: 'route', args: ['-q', '-n', 'delete', '-inet6', `${a}/128`], ignoreError: true })),
  ];
  return [];
}

function nftKill(c: ExitUseCtx, v4: string[], v6: string[]): string {
  const lan4 = c.allowLan ? c.lan.filter((l) => familyOf(parseCidr(l)?.net ?? '') === 4) : [];
  const lan6 = c.allowLan ? c.lan.filter((l) => familyOf(parseCidr(l)?.net ?? '') === 6) : [];
  return [
    `table inet ${NAMES.nftKill}`,
    `delete table inet ${NAMES.nftKill}`,
    `table inet ${NAMES.nftKill} {`,
    '  chain output {',
    '    type filter hook output priority filter; policy drop;',
    '    oifname "lo" accept',
    `    oifname "${c.iface}" accept`,
    ...(v4.length ? [`    ip daddr { ${v4.join(', ')} } accept`] : []),
    ...(v6.length ? [`    ip6 daddr { ${v6.join(', ')} } accept`] : []),
    ...(lan4.length ? [`    ip daddr { ${lan4.join(', ')} } accept`] : []),
    ...(lan6.length ? [`    ip6 daddr { ${lan6.join(', ')} } accept`] : []),
    // DHCP, and IPv6 neighbour discovery, so the computer keeps its own address
    '    udp dport { 67, 547 } accept',
    '    icmpv6 type { nd-router-solicit, nd-neighbor-solicit, nd-neighbor-advert } accept',
    '  }',
    '}',
    '',
  ].join('\n');
}

function pfKill(c: ExitUseCtx, v4: string[], v6: string[]): string {
  return [
    `pass out quick on lo0 all`,
    `pass out quick on ${c.iface} all`,
    ...v4.map((a) => `pass out quick inet to ${a}`),
    ...v6.map((a) => `pass out quick inet6 to ${a}`),
    ...(c.allowLan ? c.lan.map((l) => `pass out quick ${familyOf(parseCidr(l)?.net ?? '') === 6 ? 'inet6' : 'inet'} to ${l}`) : []),
    'pass out quick proto udp to any port { 67, 547 }',
    'block drop out quick all',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- access rules (inbound, mesh interface only)

const nftPorts = (r: PortRange[]) => r.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(', ');
const pfPorts = (r: PortRange[]) => r.map(([a, b]) => (a === b ? String(a) : `${a}:${b}`)).join(' ');
const winPorts = (r: PortRange[]) => r.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(',');

export function aclUp(os: MeshOS, iface: string, entries: AclEntry[], dnsPort: number): Step[] {
  if (os === 'linux') {
    const lines = [
      `table inet ${NAMES.nftAcl}`,
      `delete table inet ${NAMES.nftAcl}`,
      `table inet ${NAMES.nftAcl} {`,
      '  chain input {',
      '    type filter hook input priority filter - 1; policy accept;',
      `    iifname != "${iface}" accept`,
      '    ct state established,related accept',
      '    icmp type echo-request accept',
      '    icmpv6 type { echo-request, nd-neighbor-solicit, nd-neighbor-advert } accept',
      `    udp dport ${dnsPort} accept`,
    ];
    for (const e of entries) {
      for (const fam of [4, 6] as const) {
        const src = e.src.filter((a) => familyOf(a) === fam);
        if (!src.length) continue;
        const sel = `${fam === 4 ? 'ip' : 'ip6'} saddr { ${src.join(', ')} }`;
        if (!e.ports) lines.push(`    ${sel}${e.proto === 'any' ? '' : ` meta l4proto ${e.proto}`} accept`);
        else for (const p of e.proto === 'any' ? ['tcp', 'udp'] : [e.proto]) lines.push(`    ${sel} ${p} dport { ${nftPorts(e.ports)} } accept`);
      }
    }
    lines.push('    drop', '  }', '}', '');
    return [{ file: 'nft', args: ['-f', '-'], stdin: lines.join('\n') }];
  }
  if (os === 'darwin') {
    const lines = [`pass in quick on ${iface} inet proto icmp all`, `pass in quick on ${iface} inet6 proto icmp6 all`, `pass in quick on ${iface} proto udp to any port ${dnsPort}`];
    for (const e of entries) {
      const src = `{ ${e.src.join(' ')} }`;
      const protos = e.proto === 'any' ? (e.ports ? ['tcp', 'udp'] : ['']) : [e.proto];
      for (const p of protos) lines.push(`pass in quick on ${iface}${p ? ` proto ${p}` : ''} from ${src} to any${e.ports ? ` port { ${pfPorts(e.ports)} }` : ''}`);
    }
    lines.push(`block drop in quick on ${iface} all`, '');
    return [{ file: 'pfctl', args: ['-a', NAMES.pfAnchor + '/acl', '-f', '-'], stdin: lines.join('\n') }, { file: 'pfctl', args: ['-E'] }];
  }
  // Windows: inbound is blocked by default; allow what the rules allow. A guest's other ports are blocked
  // explicitly too, because an app's own "allow" rule would otherwise let it in (block rules win there).
  const parts = [`Get-NetFirewallRule -Group ${psq(NAMES.winGroup)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`];
  const base = `-Group ${psq(NAMES.winGroup)} -Direction Inbound -InterfaceAlias ${psq(iface)} -Profile Any`;
  parts.push(`New-NetFirewallRule -DisplayName 'Keeper Mesh: ping' ${base} -Protocol ICMPv4 -IcmpType 8 -Action Allow | Out-Null`);
  parts.push(`New-NetFirewallRule -DisplayName 'Keeper Mesh: ping (IPv6)' ${base} -Protocol ICMPv6 -IcmpType 128 -Action Allow | Out-Null`);
  parts.push(`New-NetFirewallRule -DisplayName 'Keeper Mesh: names' ${base} -Protocol UDP -LocalPort ${dnsPort} -Action Allow | Out-Null`);
  entries.forEach((e, i) => {
    const addrs = `@(${e.src.map(psq).join(',')})`;
    if (!e.ports) parts.push(`New-NetFirewallRule -DisplayName 'Keeper Mesh: rule ${i + 1}' ${base} -RemoteAddress ${addrs}${e.proto === 'any' ? '' : ` -Protocol ${e.proto.toUpperCase()}`} -Action Allow | Out-Null`);
    else
      for (const p of e.proto === 'any' ? ['TCP', 'UDP'] : [e.proto.toUpperCase()]) {
        parts.push(`New-NetFirewallRule -DisplayName 'Keeper Mesh: rule ${i + 1} ${p}' ${base} -RemoteAddress ${addrs} -Protocol ${p} -LocalPort ${winPorts(e.ports)} -Action Allow | Out-Null`);
        // keep mesh names working: the DNS port is never in a guest's block list
        const rest = complement(p === 'UDP' ? [...e.ports, [dnsPort, dnsPort] as PortRange].sort((x, y) => x[0] - y[0]) : e.ports);
        if (rest.length) parts.push(`New-NetFirewallRule -DisplayName 'Keeper Mesh: rule ${i + 1} ${p} (other ports)' ${base} -RemoteAddress ${addrs} -Protocol ${p} -LocalPort ${winPorts(rest)} -Action Block | Out-Null`);
      }
  });
  return [ps(parts.join('; '))];
}

export function aclDown(os: MeshOS): Step[] {
  if (os === 'linux') return [{ file: 'nft', args: ['delete', 'table', 'inet', NAMES.nftAcl], ignoreError: true }];
  if (os === 'darwin') return [{ file: 'pfctl', args: ['-a', NAMES.pfAnchor + '/acl', '-F', 'all'], ignoreError: true }];
  return [ps(`Get-NetFirewallRule -Group ${psq(NAMES.winGroup)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`, true)];
}

// ---------------------------------------------------------------- putting everything back

/** Everything Keeper may have changed, as recorded while it ran. */
export interface Applied {
  os: MeshOS;
  ifaces: Pick<IfaceCtx, 'os' | 'iface' | 'impl' | 'bin' | 'confPath'>[];
  routes: { iface: string; cidrs: string[] }[];
  dns: { iface: string; suffix: string }[];
  hosts: boolean;
  exitServe?: { iface: string; before: { v4?: string; v6?: string }; noV6?: boolean };
  exitUse?: ExitUseCtx;
  acl: boolean;
}

export const emptyApplied = (os: MeshOS): Applied => ({ os, ifaces: [], routes: [], dns: [], hosts: false, acl: false });

/**
 * Undo, newest first: the kill switch and exit routes (so the internet works
 * again), DNS, routes, NAT, the firewall rules, and last the interfaces.
 * Every step may fail harmlessly (the thing is already gone), so the same
 * plan is safe to run twice, and after a crash.
 */
export function cleanupPlan(a: Applied, hostsNow?: string): Step[] {
  const steps: Step[] = [];
  if (a.exitUse) steps.push(...exitUseDown(a.exitUse));
  for (const d of a.dns) steps.push(...dnsDown({ os: a.os, iface: d.iface, suffix: d.suffix }));
  if (a.hosts && hostsNow !== undefined) steps.push(...hostsWrite(a.os, withHostsBlock(hostsNow, [])).map((s) => ({ ...s, ignoreError: true })));
  for (const r of a.routes) steps.push(...routesDown(a.os, r.iface, r.cidrs));
  if (a.exitServe) steps.push(...exitServeDown({ os: a.os, iface: a.exitServe.iface, noV6: a.exitServe.noV6 }, a.exitServe.before));
  if (a.acl) steps.push(...aclDown(a.os));
  for (const i of a.ifaces) steps.push(...ifaceDown(i));
  return steps;
}
