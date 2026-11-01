// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mesh addresses. Every network gets its own IPv6 unique-local /48 (RFC 4193,
// fd00::/8), picked from a hash of the network id, so two people's networks
// almost never clash with each other or with a home router. Every device gets
// a stable address in it from a hash of the network id and its device id: the
// same device always has the same address, on every peer, with nobody handing
// addresses out. IPv4 is optional: one /16 inside the shared address space
// 100.64.0.0/10 (RFC 6598), skipping any range a local route already uses.

import crypto from 'node:crypto';
import { bigToV6, familyOf, inPrefix, intToV4, parseCidr, v4ToInt, v6ToBig } from '../net/addr';

const h = (...parts: string[]) => crypto.createHash('sha256').update(parts.join('\0')).digest();

/** The network's IPv6 /48: "fdXX:XXXX:XXXX::/48". */
export function networkPrefix6(netId: string): string {
  const b = h('keeper-mesh-ula', netId);
  let n = 0xfdn;
  for (let i = 0; i < 5; i++) n = (n << 8n) | BigInt(b[i]);
  return `${bigToV6(n << 80n)}/48`;
}

/** A device's IPv6 address: the network's /48, subnet 0, and 64 bits from the device id. */
export function deviceAddr6(netId: string, deviceId: string): string {
  const p = v6ToBig(networkPrefix6(netId).split('/')[0])!;
  const b = h('keeper-mesh-iid', netId, deviceId);
  let iid = 0n;
  for (let i = 0; i < 8; i++) iid = (iid << 8n) | BigInt(b[i]);
  // Never ::0 or ::1 (kept for the network itself).
  if (iid < 2n) iid += 2n;
  return bigToV6(p | iid);
}

/** The 64 /16 networks inside 100.64.0.0/10, starting at a place picked by the network id. */
export function candidates4(netId: string): string[] {
  const start = h('keeper-mesh-v4', netId)[0] % 64;
  return Array.from({ length: 64 }, (_, i) => `100.${64 + ((start + i) % 64)}.0.0/16`);
}

/** Whether two prefixes share any address. */
export function overlaps(a: string, b: string): boolean {
  const x = parseCidr(a);
  const y = parseCidr(b);
  if (!x || !y || x.family !== y.family) return false;
  const p = Math.min(x.prefix, y.prefix);
  return inPrefix(x.net, y.net, p);
}

/**
 * Local routes and addresses that would clash with `prefix`. The default route
 * never clashes (a more specific route wins); anything else that overlaps does.
 */
export function conflicts(prefix: string, local: string[]): string[] {
  return local.filter((c) => {
    const p = parseCidr(c);
    return !!p && p.prefix > 0 && overlaps(prefix, c);
  });
}

/** The network's IPv4 /16, or null when every one clashes with something here. */
export function networkPrefix4(netId: string, local: string[] = []): string | null {
  return candidates4(netId).find((c) => conflicts(c, local).length === 0) ?? null;
}

/**
 * A device's IPv4 address in the network's /16. If another device already
 * has it (`taken`), the next address in a sequence picked by the same hash is
 * used, so every device that sees the same members works out the same answer.
 */
export function deviceAddr4(prefix4: string, netId: string, deviceId: string, taken: Iterable<string> = []): string {
  const base = v4ToInt(prefix4.split('/')[0])!;
  const used = new Set(taken);
  for (let i = 0; i < 1000; i++) {
    const b = h('keeper-mesh-host4', netId, deviceId, String(i));
    // 1 … 65534, never the network or broadcast address, and never x.x.0.1 (kept for the network itself)
    const host = 2 + (b.readUInt32BE(0) % 65532);
    const ip = intToV4((base + host) >>> 0);
    if (!used.has(ip)) return ip;
  }
  throw new Error('This network has no free IPv4 address left');
}

/** Whether an address belongs to any of these mesh prefixes. */
export function inMesh(ip: string, prefixes: string[]): boolean {
  return prefixes.some((p) => {
    const c = parseCidr(p);
    return !!c && familyOf(ip) === c.family && inPrefix(ip, c.net, c.prefix);
  });
}

/** Keeper Mesh's address ranges in general: the shared /10 and unique-local IPv6. For labels only. */
export function looksLikeMesh(ip: string, known: string[] = []): boolean {
  if (known.length) return inMesh(ip, known);
  return inPrefix(ip, '100.64.0.0', 10) || /^fd[0-9a-f]{2}:/i.test(ip);
}

/** A DNS label for a device name: "Ana's MacBook Pro" → "anas-macbook-pro". */
export function dnsLabel(name: string, taken: Iterable<string> = []): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'device';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** A valid suffix for mesh names: one or more DNS labels, no leading dot. */
export function cleanSuffix(s: string): string {
  const t = s.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(t)) throw new Error('Use letters, digits and dashes for the name ending, like keeper or home.arpa');
  if (['local', 'localhost', 'com', 'net', 'org'].includes(t)) throw new Error(`.${t} is used by something else; pick another ending`);
  return t;
}

/** A random network id: 16 hex characters. */
export const newNetworkId = () => crypto.randomBytes(8).toString('hex');
