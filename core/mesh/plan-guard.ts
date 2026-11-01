// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What the privileged mesh helper agrees to run. The helper runs as the
// administrator, so it must not become a way for any program running as you
// to do anything else as the administrator. It runs only steps that touch
// Keeper's own interfaces, its own firewall tables and anchors, its own DNS
// files and the forwarding switches; everything else is refused. Pure, so it
// is tested on every system.

import { familyOf, parseCidr } from '../net/addr';
import { NAMES, type MeshOS, type Step } from './os-plan';

export interface GuardOpts {
  os: MeshOS;
  /** the verified wireguard-go the helper may start (it checks the hash itself) */
  wgGo?: string;
  /** the wg tool (a system path) */
  wg?: string;
}

const IFACE: Record<'linux' | 'darwin', RegExp> = { linux: /^km-[0-9a-f]{4}$/, darwin: /^utun\d{1,3}$/ };
const isCidr = (s: string) => !!parseCidr(s);
const isIp = (s: string) => familyOf(s) !== 0;
const WAN = /^[A-Za-z0-9._-]{1,15}$/;
const SYSCTL = new Set(['net.ipv4.ip_forward', 'net.ipv6.conf.all.forwarding', 'net.inet.ip.forwarding', 'net.inet6.ip6.forwarding']);
const SUFFIX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Returns why a step is refused, or null when it may run. */
export function checkStep(s: Step, o: GuardOpts): string | null {
  if (o.os === 'win32') return 'the helper does not run on Windows';
  const ifc = IFACE[o.os];
  const a = s.args;
  const iface = (x: string | undefined) => !!x && ifc.test(x);
  for (const k of Object.keys(s.env ?? {})) if (!/^WG_[A-Z_]+$/.test(k)) return `environment ${k} not allowed`;
  if (a.some((x) => typeof x !== 'string' || x.includes('\0'))) return 'bad argument';
  switch (s.file) {
    case o.wgGo:
      return a.length === 1 && iface(a[0]) ? null : 'wireguard-go: only an interface name';
    case 'uapi':
      return a.length === 1 && iface(a[0]) && typeof s.stdin === 'string' && /^(set|get)=1\n/.test(s.stdin) ? null : 'uapi: bad request';
    case 'wg':
    case o.wg:
      return a.length === 3 && ['setconf', 'syncconf'].includes(a[0]) && iface(a[1]) && a[2] === '/dev/stdin' ? null : a.length === 3 && a[0] === 'show' && iface(a[1]) && a[2] === 'dump' ? null : 'wg: not allowed';
    case 'ip':
      return checkIp(a, iface);
    case 'nft':
      if (a.length === 4 && a[0] === 'delete' && a[1] === 'table' && a[2] === 'inet' && isOurTable(a[3])) return null;
      if (a.length === 2 && a[0] === '-f' && a[1] === '-' && typeof s.stdin === 'string') return nftOnlyOurs(s.stdin);
      return 'nft: not allowed';
    case 'resolvectl':
      if (a.length === 2 && a[0] === 'revert' && iface(a[1])) return null;
      if (a.length === 3 && a[0] === 'dns' && iface(a[1]) && isDnsServer(a[2])) return null;
      if (a.length === 3 && a[0] === 'domain' && iface(a[1]) && (a[2] === '~.' || (a[2].startsWith('~') && SUFFIX.test(a[2].slice(1))))) return null;
      if (a.length === 3 && a[0] === 'default-route' && iface(a[1]) && ['yes', 'no'].includes(a[2])) return null;
      return 'resolvectl: not allowed';
    case 'sysctl': {
      const m = a.length === 2 && a[0] === '-w' ? a[1].match(/^([a-z0-9._]+)=([01])$/) : null;
      return m && SYSCTL.has(m[1]) ? null : 'sysctl: not allowed';
    }
    case 'ifconfig':
      return a.length >= 2 && iface(a[0]) && a.slice(1).every((x) => /^(inet6?|prefixlen|alias|-alias|mtu|up|down|\d{1,5})$/.test(x) || isIp(x) || isCidr(x)) ? null : 'ifconfig: not allowed';
    case 'route': {
      if (a[0] !== '-q' || a[1] !== '-n' || !['add', 'delete'].includes(a[2]) || !['-inet', '-inet6'].includes(a[3]) || !isCidr(a[4])) return 'route: not allowed';
      const rest = a.slice(5);
      if (rest.length === 2 && rest[0] === '-interface' && iface(rest[1])) return null;
      // a host route that keeps Keeper's own packets off the tunnel
      if (rest.length <= 1 && /\/(32|128)$/.test(a[4]) && (rest.length === 0 || isIp(rest[0]))) return null;
      return 'route: not allowed';
    }
    case 'pfctl':
      if (a.length === 1 && a[0] === '-E') return null;
      if (a.length === 4 && a[0] === '-a' && isOurAnchor(a[1]) && ((a[2] === '-f' && a[3] === '-') || (a[2] === '-F' && a[3] === 'all'))) return null;
      return 'pfctl: not allowed';
    case 'networksetup':
      return a.length >= 3 && a[0] === '-setdnsservers' && /^[^\0\n]{1,64}$/.test(a[1]) && a.slice(2).every((x) => x === 'Empty' || isIp(x)) ? null : 'networksetup: not allowed';
    case 'mkdir':
      return a.length === 2 && a[0] === '-p' && a[1] === '/etc/resolver' ? null : 'mkdir: not allowed';
    case 'tee':
      return a.length === 1 && ourFile(a[0]) && typeof s.stdin === 'string' && s.stdin.length < 1_000_000 ? null : 'tee: not allowed';
    case 'rm':
      return a.length === 2 && a[0] === '-f' && (ourFile(a[1]) && a[1] !== '/etc/hosts' || new RegExp(`^/var/run/wireguard/(km-[0-9a-f]{4}|utun\\d{1,3})\\.sock$`).test(a[1])) ? null : 'rm: not allowed';
    default:
      return `${s.file}: not allowed`;
  }
}

function checkIp(a: string[], iface: (x?: string) => boolean): string | null {
  const fam = a[0] === '-4' || a[0] === '-6' ? a[0] : null;
  const b = fam ? a.slice(1) : a;
  if (!fam && b[0] === 'link') {
    if (b.length === 6 && b[1] === 'add' && b[2] === 'dev' && iface(b[3]) && b[4] === 'type' && b[5] === 'wireguard') return null;
    if (b.length === 4 && b[1] === 'delete' && b[2] === 'dev' && iface(b[3])) return null;
    if (b[1] === 'set' && b[2] === 'dev' && iface(b[3]) && b.slice(4).every((x) => /^(mtu|up|down|\d{3,5})$/.test(x))) return null;
    return 'ip link: not allowed';
  }
  if (fam && b[0] === 'address' && ['add', 'delete'].includes(b[1]) && isCidr(b[2]) && b[3] === 'dev' && iface(b[4]) && b.length === 5) return null;
  if (fam && b[0] === 'route' && ['replace', 'delete', 'add'].includes(b[1]) && isCidr(b[2])) {
    const rest = b.slice(3);
    if (rest.length === 2 && rest[0] === 'dev' && iface(rest[1])) return null;
    if (b[1] === 'delete' && rest.length === 0 && /\/(32|128)$/.test(b[2])) return null;
    // host routes for Keeper's own packets: /32 or /128 via the old gateway
    if (/\/(32|128)$/.test(b[2]) && rest[0] === 'via' && isIp(rest[1]) && (rest.length === 2 || (rest.length === 4 && rest[2] === 'dev' && WAN.test(rest[3])))) return null;
  }
  return 'ip: not allowed';
}

/** "ip", "1.2.3.4:5053" or "[fd00::1]:5053". */
function isDnsServer(x: string): boolean {
  if (isIp(x)) return true;
  const v6 = x.match(/^\[([^\]]+)\]:(\d{1,5})$/);
  if (v6) return familyOf(v6[1]) === 6;
  const v4 = x.match(/^([\d.]+):(\d{1,5})$/);
  return !!v4 && familyOf(v4[1]) === 4;
}

const isOurTable = (t: string) => [NAMES.nftAcl, NAMES.nftNat, NAMES.nftKill].includes(t);
const isOurAnchor = (a: string) => a === NAMES.pfKill || a.startsWith(NAMES.pfAnchor + '/') && /^[A-Za-z0-9./]+$/.test(a);

/** /etc/resolver/<suffix> and /etc/hosts only. */
function ourFile(p: string): boolean {
  if (p === '/etc/hosts') return true;
  const m = p.match(/^\/etc\/resolver\/(.+)$/);
  return !!m && SUFFIX.test(m[1]) && !['local', 'localhost'].includes(m[1]);
}

/** An nft script may only make, change or delete Keeper's own tables. */
function nftOnlyOurs(script: string): string | null {
  const lines = script.split('\n').map((l) => l.trim()).filter(Boolean);
  let depth = 0;
  for (const l of lines) {
    if (depth === 0) {
      const m = l.match(/^(delete\s+)?table\s+inet\s+([a-z_]+)\s*(\{)?$/);
      if (!m || !isOurTable(m[2])) return `nft: only Keeper's tables (${l.slice(0, 60)})`;
    }
    if (/\b(include|flush\s+ruleset)\b/.test(l)) return 'nft: not allowed';
    depth += (l.match(/\{/g) ?? []).length - (l.match(/\}/g) ?? []).length;
    if (depth < 0) return 'nft: bad script';
  }
  return depth === 0 ? null : 'nft: bad script';
}

/** Checks a whole plan; the first refusal stops it. */
export function checkPlan(steps: Step[], o: GuardOpts): string | null {
  for (const s of steps) {
    const why = checkStep(s, o);
    if (why) return why;
  }
  return null;
}
