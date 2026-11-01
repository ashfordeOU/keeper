// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Turning Keeper's rules into what each operating system enforces, and
// reading back what the system blocked. Pure text in, text out: commands are
// built as argument lists or quoted carefully, so an app path or host name can
// never become a command of its own.
//
//   Windows   Windows Defender Firewall rules per program (New-NetFirewallRule),
//             optional "block outbound unless allowed", blocked attempts from
//             Security event 5157 (Filtering Platform Connection auditing).
//   Linux     an nftables table "keeper" (addresses, ports, users, and app
//             cgroups where the kernel supports socket cgroupv2 matching), plus
//             OpenSnitch rule files when its daemon is installed.
//   macOS     a pf anchor "com.ashforde.keeper" (addresses and ports, all apps);
//             per-app decisions need the Network Extension filter (see docs).

import { familyOf } from '../net/addr';
import type { FwRule, RuleGroup } from './rules';
import { parsePorts } from './rules';

export type Platform = 'win32' | 'linux' | 'darwin';

/** What Keeper can enforce here, honestly. Shown in the interface. */
export interface Capabilities {
  perAppBlocking: boolean;
  perAppAlerts: boolean;
  hostRules: 'dns' | 'resolved-addresses' | 'filter';
  inbound: boolean;
  dnsFiltering: boolean;
  needsAdmin: boolean;
  notes: string[];
}

export function capabilities(platform: Platform, opts: { filterExtension?: boolean; opensnitch?: boolean; cgroupMatch?: boolean } = {}): Capabilities {
  if (platform === 'win32') {
    return {
      perAppBlocking: true, perAppAlerts: true, hostRules: 'resolved-addresses', inbound: true, dnsFiltering: true, needsAdmin: true,
      notes: [
        'Rules become Windows Defender Firewall rules for each program, so they keep working while Keeper is closed.',
        'Windows rules match addresses, not names: Keeper looks up each host and refreshes its addresses as they change.',
        'Alerts come from Windows’ own log of blocked connections, so the first attempt is refused and the app retries after you allow it.',
      ],
    };
  }
  if (platform === 'linux') {
    return {
      perAppBlocking: !!opts.opensnitch || !!opts.cgroupMatch, perAppAlerts: !!opts.opensnitch, hostRules: opts.opensnitch ? 'filter' : 'dns', inbound: true, dnsFiltering: true, needsAdmin: true,
      notes: opts.opensnitch
        ? ['OpenSnitch is installed: Keeper writes its rules for it, so every app is checked by its daemon.', 'For pop-up alerts per connection, keep OpenSnitch’s own alert window running.']
        : ['Address and port rules are enforced with nftables for all apps.', 'Per-app rules need either the kernel’s cgroup matching (apps started from Keeper) or OpenSnitch.', 'Host rules work through Keeper’s DNS filter.'],
    };
  }
  return {
    perAppBlocking: !!opts.filterExtension, perAppAlerts: !!opts.filterExtension, hostRules: opts.filterExtension ? 'filter' : 'dns', inbound: !!opts.filterExtension, dnsFiltering: true, needsAdmin: true,
    notes: opts.filterExtension
      ? ['Keeper’s network filter is active: every app’s connections are checked as they happen.']
      : [
        'Per-app blocking on macOS needs a network filter extension, which Apple only allows in apps signed with a Developer ID that Apple has granted the content-filter permission. Builds without it watch every connection and can block addresses, ports and hosts for all apps.',
        'Host rules work through Keeper’s DNS filter; address and port rules through the system packet filter (pf).',
      ],
  };
}

// ---------------------------------------------------------------- Windows

/** A PowerShell single-quoted literal: only ' needs doubling, nothing inside is ever run. */
export const psq = (s: string) => `'${String(s).replace(/['‘’‚‛]/g, "''")}'`;

const ruleName = (r: FwRule) => `Keeper ${r.id}`;

/** PowerShell for one rule (addresses already resolved for host rules). Returns null when Windows cannot express it. */
export function windowsRuleScript(r: FwRule, resolved: string[] = []): string | null {
  if (r.app !== 'any' && r.app.group && r.app.group !== 'any') return null;
  const dirs = r.direction === 'both' ? ['Outbound', 'Inbound'] : [r.direction === 'out' ? 'Outbound' : 'Inbound'];
  const remote = r.ip ? [r.ip] : r.host && r.host !== 'any' ? resolved : [];
  if (r.host && r.host !== 'any' && !remote.length) return null;
  const ports = parsePorts(r.port);
  const lines: string[] = [];
  for (const d of dirs) {
    const args = [
      `-Name ${psq(`${ruleName(r)} ${d}`)}`,
      `-DisplayName ${psq(`Keeper: ${r.note ?? r.id}`)}`,
      `-Group ${psq('Keeper')}`,
      `-Direction ${d}`,
      `-Action ${r.verdict === 'allow' ? 'Allow' : 'Block'}`,
      `-Enabled ${r.enabled ? 'True' : 'False'}`,
    ];
    if (r.app !== 'any' && r.app.path) args.push(`-Program ${psq(r.app.path)}`);
    if (r.proto && r.proto !== 'any') args.push(`-Protocol ${r.proto === 'icmp' ? 'ICMPv4' : r.proto.toUpperCase()}`);
    if (ports) {
      const p = ports.lo === ports.hi ? String(ports.lo) : `${ports.lo}-${ports.hi}`;
      args.push(`${d === 'Outbound' ? '-RemotePort' : '-LocalPort'} ${psq(p)}`);
      if (!r.proto || r.proto === 'any') args.push('-Protocol TCP');
    }
    if (remote.length) args.push(`-RemoteAddress @(${remote.map(psq).join(',')})`);
    lines.push(`Remove-NetFirewallRule -Name ${psq(`${ruleName(r)} ${d}`)} -ErrorAction SilentlyContinue`);
    lines.push(`New-NetFirewallRule ${args.join(' ')} | Out-Null`);
  }
  return lines.join('\n');
}

/**
 * "Block everything that has no rule": outbound default to block, after
 * allowing the parts of Windows that must reach the network (updates, time,
 * name lookups, network setup) so the computer keeps working.
 */
export function windowsDefaultBlockScript(on: boolean): string {
  if (!on) return 'Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Allow';
  const essentials = [
    ['%SystemRoot%\\System32\\svchost.exe', 'Windows services (updates, time, name lookups, network setup)'],
    ['%SystemRoot%\\System32\\lsass.exe', 'Sign-in and domain authentication'],
    ['%SystemRoot%\\System32\\wuauclt.exe', 'Windows Update'],
    ['%SystemRoot%\\System32\\smartscreen.exe', 'SmartScreen'],
    ['%ProgramFiles%\\Windows Defender\\MsMpEng.exe', 'Microsoft Defender'],
  ];
  const keep = essentials.map(([p, why], i) => `New-NetFirewallRule -Name ${psq(`Keeper essential ${i}`)} -DisplayName ${psq(`Keeper: ${why}`)} -Group ${psq('Keeper')} -Direction Outbound -Action Allow -Program ${psq(p)} -ErrorAction SilentlyContinue | Out-Null`);
  return [...keep, 'Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Block'].join('\n');
}

/** Turns on the audit events Keeper reads (blocked connections, with the program). */
export const WINDOWS_AUDIT_ON = 'auditpol /set /subcategory:"Filtering Platform Connection" /failure:enable';
/** Removes everything Keeper added and restores outbound "allow". */
export const WINDOWS_UNINSTALL = ["Get-NetFirewallRule -Group 'Keeper' -ErrorAction SilentlyContinue | Remove-NetFirewallRule", 'Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Allow', 'auditpol /set /subcategory:"Filtering Platform Connection" /failure:disable'].join('\n');

export interface BlockedAttempt {
  t: number;
  app?: string;
  pid?: number;
  direction: 'out' | 'in';
  local?: string;
  localPort?: number;
  remote: string;
  remotePort?: number;
  proto?: 'tcp' | 'udp' | 'icmp';
}

const PROTO: Record<string, BlockedAttempt['proto']> = { '6': 'tcp', '17': 'udp', '1': 'icmp', '58': 'icmp' };

/** Reads Security event 5157 ("The Windows Filtering Platform has blocked a connection") as XML (Get-WinEvent … .ToXml()). */
export function parseEvent5157(xml: string): BlockedAttempt | null {
  if (!/<EventID>5157<\/EventID>/.test(xml)) return null;
  const field = (n: string) => xml.match(new RegExp(`<Data Name=['"]${n}['"]>([^<]*)</Data>`))?.[1];
  const time = xml.match(/SystemTime=['"]([^'"]+)['"]/)?.[1];
  const app = field('Application');
  // Windows writes device paths (\device\harddiskvolume3\…); keep them, the UI matches on file name too.
  const dir = field('Direction') ?? '';
  return {
    t: time ? Date.parse(time) : Date.now(),
    app: app || undefined,
    pid: field('ProcessID') ? Number(field('ProcessID')) : undefined,
    direction: /%%14592|inbound/i.test(dir) ? 'in' : 'out',
    local: field('SourceAddress'),
    localPort: field('SourcePort') ? Number(field('SourcePort')) : undefined,
    remote: field('DestAddress') ?? '',
    remotePort: field('DestPort') ? Number(field('DestPort')) : undefined,
    proto: PROTO[field('Protocol') ?? ''],
  };
}

/** Reads the Windows Firewall log (pfirewall.log, W3C format) for DROP lines. */
export function parseFirewallLog(text: string): BlockedAttempt[] {
  let fields: string[] = ['date', 'time', 'action', 'protocol', 'src-ip', 'dst-ip', 'src-port', 'dst-port', 'size', 'tcpflags', 'tcpsyn', 'tcpack', 'tcpwin', 'icmptype', 'icmpcode', 'info', 'path', 'pid'];
  const out: BlockedAttempt[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#Fields:')) { fields = line.slice(8).trim().split(/\s+/); continue; }
    if (!line || line.startsWith('#')) continue;
    const v = line.trim().split(/\s+/);
    const g = (k: string) => { const i = fields.indexOf(k); const x = i >= 0 ? v[i] : undefined; return x === '-' ? undefined : x; };
    if (g('action') !== 'DROP') continue;
    const path = g('path');
    out.push({
      t: Date.parse(`${g('date')}T${g('time')}`) || Date.now(),
      direction: path === 'RECEIVE' ? 'in' : 'out',
      local: g('src-ip'),
      localPort: g('src-port') ? Number(g('src-port')) : undefined,
      remote: g('dst-ip') ?? '',
      remotePort: g('dst-port') ? Number(g('dst-port')) : undefined,
      proto: (g('protocol') ?? '').toLowerCase() as BlockedAttempt['proto'],
      pid: g('pid') ? Number(g('pid')) : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------- Linux nftables

const nftStr = (s: string) => `"${s.replace(/["\\]/g, '')}"`;

/** One nftables rule line for the "keeper" table, or null when nftables cannot express it (per-app without cgroup, host names). */
export function nftRule(r: FwRule, opts: { cgroupOf?: (app: FwRule['app']) => string | undefined; uidOf?: (app: FwRule['app']) => number | undefined } = {}): string | null {
  if (!r.enabled) return null;
  if (r.host && r.host !== 'any') return null; // names are handled by the DNS filter
  const m: string[] = [];
  if (r.app !== 'any' && !(r.app.group === 'any')) {
    const cg = opts.cgroupOf?.(r.app);
    const uid = opts.uidOf?.(r.app);
    if (cg) m.push(`socket cgroupv2 level ${cg.split('/').filter(Boolean).length} ${nftStr(cg)}`);
    else if (uid !== undefined) m.push(`meta skuid ${uid}`);
    else return null;
  }
  if (r.ip) {
    const fam = familyOf(r.ip.split('/')[0]);
    if (!fam) return null;
    m.push(`${fam === 6 ? 'ip6' : 'ip'} ${r.direction === 'in' ? 'saddr' : 'daddr'} ${r.ip.replace(/[^0-9a-f.:/]/gi, '')}`);
  }
  const ports = parsePorts(r.port);
  const proto = r.proto && r.proto !== 'any' ? r.proto : ports ? 'tcp' : undefined;
  if (proto === 'icmp') m.push('meta l4proto { icmp, ipv6-icmp }');
  else if (proto && ports) m.push(`${proto} ${r.direction === 'in' ? 'dport' : 'dport'} ${ports.lo === ports.hi ? ports.lo : `${ports.lo}-${ports.hi}`}`);
  else if (proto) m.push(`meta l4proto ${proto}`);
  const verdict = r.verdict === 'allow' ? 'accept' : `log prefix ${nftStr(`keeper-deny ${r.id.replace(/[^a-z0-9-]/gi, '').slice(0, 20)} `)} group 7 drop`;
  return `${m.join(' ')} ${verdict}`.trim();
}

/** The whole nftables table, replaced atomically (nft -f). Output and input chains; established traffic always passes. */
export function nftTable(groups: RuleGroup[], opts: Parameters<typeof nftRule>[1] & { defaultOutbound?: 'accept' | 'drop' } = {}): string {
  const outRules: string[] = [];
  const inRules: string[] = [];
  // nftables takes the first match: deny before allow, so the documented "deny wins" holds for equal rules.
  const live = groups.filter((g) => g.enabled).flatMap((g) => g.rules).filter((r) => r.enabled);
  const ordered = [...live.filter((r) => r.verdict === 'deny'), ...live.filter((r) => r.verdict === 'allow')];
  for (const r of ordered) {
    const line = nftRule(r, opts);
    if (!line) continue;
    if (r.direction !== 'in') outRules.push(`    ${line}`);
    if (r.direction !== 'out') inRules.push(`    ${line}`);
  }
  return [
    'table inet keeper',
    'delete table inet keeper',
    'table inet keeper {',
    '  chain output {',
    '    type filter hook output priority 0; policy accept;',
    '    ct state established,related accept',
    '    oifname "lo" accept',
    ...outRules,
    ...(opts.defaultOutbound === 'drop' ? ['    udp dport 53 accept', '    log prefix "keeper-default " group 7 drop'] : []),
    '  }',
    '  chain input {',
    '    type filter hook input priority 0; policy accept;',
    '    ct state established,related accept',
    '    iifname "lo" accept',
    ...inRules,
    '  }',
    '}',
    '',
  ].join('\n');
}

/** An OpenSnitch rule file for one Keeper rule (its daemon then enforces it for every app). */
export function opensnitchRule(r: FwRule): { file: string; json: string } | null {
  const ops: { type: string; operand: string; sensitive: boolean; data: string }[] = [];
  if (r.app !== 'any') {
    if (r.app.group) return null;
    if (!r.app.path) return null;
    ops.push({ type: 'simple', operand: 'process.path', sensitive: false, data: r.app.path });
  }
  if (r.host && r.host !== 'any') {
    const h = r.host.replace(/^=/, '');
    ops.push(r.host.startsWith('=') ? { type: 'simple', operand: 'dest.host', sensitive: false, data: h }
      : { type: 'regexp', operand: 'dest.host', sensitive: false, data: `^(.*\\.)?${h.replace(/^\*\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` });
  }
  if (r.ip) ops.push({ type: r.ip.includes('/') ? 'network' : 'simple', operand: r.ip.includes('/') ? 'dest.network' : 'dest.ip', sensitive: false, data: r.ip });
  const ports = parsePorts(r.port);
  if (ports) ops.push(ports.lo === ports.hi ? { type: 'simple', operand: 'dest.port', sensitive: false, data: String(ports.lo) } : { type: 'regexp', operand: 'dest.port', sensitive: false, data: `^(${Array.from({ length: Math.min(200, ports.hi - ports.lo + 1) }, (_, i) => ports.lo + i).join('|')})$` });
  if (r.proto && r.proto !== 'any') ops.push({ type: 'simple', operand: 'protocol', sensitive: false, data: r.proto });
  if (!ops.length) return null;
  const operator = ops.length === 1 ? ops[0] : { type: 'list', operand: 'list', sensitive: false, data: '', list: ops };
  const name = `keeper-${r.id.replace(/[^a-z0-9-]/gi, '')}`;
  return {
    file: `${name}.json`,
    json: JSON.stringify({ created: new Date(r.created).toISOString(), updated: new Date().toISOString(), name, enabled: r.enabled, precedence: r.priority === 'high', action: r.verdict, duration: 'always', operator }, null, 2),
  };
}

// ---------------------------------------------------------------- macOS pf

export const PF_ANCHOR = 'com.ashforde.keeper';

/** pf rules for the anchor (addresses and ports; pf cannot tell apps apart). */
export function pfRules(groups: RuleGroup[]): string {
  const lines: string[] = [];
  const live = groups.filter((g) => g.enabled).flatMap((g) => g.rules).filter((r) => r.enabled && (r.app === 'any' || r.app.group === 'any') && !(r.host && r.host !== 'any') && r.ip);
  // pf takes the last matching rule unless "quick": deny with quick so it wins.
  for (const r of [...live.filter((x) => x.verdict === 'allow'), ...live.filter((x) => x.verdict === 'deny')]) {
    const ip = r.ip!.replace(/[^0-9a-f.:/]/gi, '');
    const ports = parsePorts(r.port);
    const proto = r.proto && r.proto !== 'any' ? ` proto ${r.proto}` : ports ? ' proto tcp' : '';
    const port = ports ? ` port ${ports.lo === ports.hi ? ports.lo : `${ports.lo}:${ports.hi}`}` : '';
    const dir = r.direction === 'both' ? '' : r.direction === 'out' ? ' out' : ' in';
    lines.push(`${r.verdict === 'deny' ? 'block drop' : 'pass'}${dir} quick${proto} ${r.direction === 'in' ? 'from' : 'to'} ${ip}${port}`);
  }
  return lines.join('\n') + '\n';
}
