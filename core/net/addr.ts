// SPDX-License-Identifier: AGPL-3.0-or-later
// IP addresses as numbers: parsing, prefixes, and what kind of place an
// address is (this computer, the local network, the internet).

import type { AddrScope } from './types';

/** "1.2.3.4" → 0x01020304, or null. */
export function v4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

export function intToV4(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** "2001:db8::1" (also "::ffff:1.2.3.4", and "%zone" is ignored) → 128-bit BigInt, or null. */
export function v6ToBig(ip: string): bigint | null {
  let s = ip.replace(/%.*$/, '').replace(/^\[|\]$/g, '');
  if (!s.includes(':')) return null;
  // An embedded IPv4 tail becomes two groups.
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = v4ToInt(tail[1]);
    if (n === null) return null;
    s = s.slice(0, -tail[1].length) + ((n >>> 16).toString(16)) + ':' + ((n & 0xffff).toString(16));
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - rest.length;
  if (missing < (halves.length === 2 ? 1 : 0)) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  let out = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    out = (out << 16n) | BigInt(parseInt(g, 16));
  }
  return out;
}

export function bigToV6(n: bigint): string {
  const g: string[] = [];
  for (let i = 7; i >= 0; i--) g.push(((n >> BigInt(i * 16)) & 0xffffn).toString(16));
  // Shorten the longest run of zero groups to "::".
  let best = -1, bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (g[i] !== '0') { i++; continue; }
    let j = i;
    while (j < 8 && g[j] === '0') j++;
    if (j - i > bestLen && j - i > 1) { best = i; bestLen = j - i; }
    i = j;
  }
  if (best < 0) return g.join(':');
  return `${g.slice(0, best).join(':')}::${g.slice(best + bestLen).join(':')}`;
}

export function familyOf(ip: string): 4 | 6 | 0 {
  if (v4ToInt(ip) !== null) return 4;
  if (v6ToBig(ip) !== null) return 6;
  return 0;
}

/** An IPv4-mapped IPv6 address ("::ffff:1.2.3.4") as plain IPv4. */
export function unmapV4(ip: string): string {
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (m) return m[1];
  const h = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (h) return intToV4(((parseInt(h[1], 16) << 16) | parseInt(h[2], 16)) >>> 0);
  return ip;
}

/** Whether `ip` is inside `net/prefix`. */
export function inPrefix(ip: string, net: string, prefix: number): boolean {
  const a4 = v4ToInt(ip);
  const n4 = v4ToInt(net);
  if (a4 !== null && n4 !== null) {
    if (prefix <= 0) return true;
    const mask = prefix >= 32 ? 0xffffffff : (~((1 << (32 - prefix)) - 1)) >>> 0;
    return ((a4 & mask) >>> 0) === ((n4 & mask) >>> 0);
  }
  const a6 = v6ToBig(ip);
  const n6 = v6ToBig(net);
  if (a6 === null || n6 === null) return false;
  if (prefix <= 0) return true;
  const shift = BigInt(128 - Math.min(128, prefix));
  return a6 >> shift === n6 >> shift;
}

/** "10.0.0.0/8" → { net, prefix }; a bare address gets the full length. */
export function parseCidr(s: string): { net: string; prefix: number; family: 4 | 6 } | null {
  const [net, p] = s.trim().split('/');
  const fam = familyOf(net);
  if (!fam) return null;
  const max = fam === 4 ? 32 : 128;
  const prefix = p === undefined ? max : Number(p);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  return { net, prefix, family: fam };
}

/** Netmask "255.255.255.0" → 24 (non-contiguous masks give the count of leading ones). */
export function maskToPrefix(mask: string): number {
  const n = v4ToInt(mask);
  if (n === null) return 0;
  let bits = 0;
  for (let i = 31; i >= 0 && (n >>> i) & 1; i--) bits++;
  return bits;
}

const PRIVATE_V4: [string, number][] = [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10]];

/** What kind of place an address is. */
export function scopeOf(ipIn: string): AddrScope {
  const ip = unmapV4(ipIn);
  const n = v4ToInt(ip);
  if (n !== null) {
    if (n === 0) return 'unspecified';
    if (inPrefix(ip, '127.0.0.0', 8)) return 'loopback';
    if (inPrefix(ip, '169.254.0.0', 16)) return 'link';
    if (inPrefix(ip, '224.0.0.0', 4) || n === 0xffffffff) return 'multicast';
    if (PRIVATE_V4.some(([net, p]) => inPrefix(ip, net, p))) return 'lan';
    return 'internet';
  }
  const b = v6ToBig(ip);
  if (b === null) return 'internet';
  if (b === 0n) return 'unspecified';
  if (b === 1n) return 'loopback';
  if (inPrefix(ip, 'fe80::', 10)) return 'link';
  if (inPrefix(ip, 'ff00::', 8)) return 'multicast';
  if (inPrefix(ip, 'fc00::', 7)) return 'lan';
  return 'internet';
}

/** Linux /proc/net hex address: "0100007F:1F90" (v4, little-endian) or 32 hex chars (v6, four little-endian words). */
export function procHexAddr(hex: string): { ip: string; port: number } {
  const [a, p] = hex.split(':');
  const port = parseInt(p, 16);
  if (a.length === 8) {
    const n = parseInt(a, 16);
    return { ip: [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255].join('.'), port };
  }
  let big = 0n;
  for (let w = 0; w < 4; w++) {
    const word = a.slice(w * 8, w * 8 + 8);
    // Each 32-bit word is stored little-endian.
    const bytes = word.match(/../g)!.reverse().join('');
    big = (big << 32n) | BigInt('0x' + bytes);
  }
  return { ip: unmapV4(bigToV6(big)), port };
}

/** "1.2.3.4:443", "[2001:db8::1]:443", "2001:db8::1.443" (BSD style) → parts. */
export function splitHostPort(s: string): { host: string; port?: number } {
  const t = s.trim();
  const br = t.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (br) return { host: br[1], port: br[2] ? Number(br[2]) : undefined };
  if (t === '*' || t === '*:*') return { host: '*' };
  const colons = (t.match(/:/g) ?? []).length;
  if (colons === 1) {
    const [h, p] = t.split(':');
    return { host: h, port: p === '*' ? undefined : Number(p) };
  }
  if (colons > 1) {
    // IPv6: a trailing ".port" (BSD netstat) or ":port" when the rest still parses.
    const dot = t.match(/^(.*)\.(\d+|\*)$/);
    if (dot && v6ToBig(dot[1]) !== null) return { host: dot[1], port: dot[2] === '*' ? undefined : Number(dot[2]) };
    const last = t.lastIndexOf(':');
    const h = t.slice(0, last);
    const p = t.slice(last + 1);
    if (/^\d+$/.test(p) && v6ToBig(h) !== null && v6ToBig(t) === null) return { host: h, port: Number(p) };
    return { host: t };
  }
  const dot = t.match(/^(\d+\.\d+\.\d+\.\d+)\.(\d+|\*)$/);
  if (dot) return { host: dot[1], port: dot[2] === '*' ? undefined : Number(dot[2]) };
  return { host: t };
}
