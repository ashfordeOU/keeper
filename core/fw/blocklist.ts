// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Blocklists: lists of domains or addresses to refuse, in the formats people
// publish them in (hosts files, plain domain lists, ad-blocker domain rules,
// address and range lists), and fast lookups over them.

import { familyOf, parseCidr, unmapV4, v4ToInt, v6ToBig } from '../net/addr';

export type ListFormat = 'hosts' | 'domains' | 'adblock' | 'ips' | 'auto';

export interface ParsedList {
  domains: string[];
  /** exceptions (ad-blocker "@@||example.com^") */
  allow: string[];
  cidrs: string[];
  skipped: number;
}

const DOMAIN = /^(?=.{1,253}$)(?:(?!-)[a-z0-9_-]{1,63}(?<!-)\.)+[a-z][a-z0-9-]{0,62}$/;
const SINKS = new Set(['0.0.0.0', '127.0.0.1', '::', '::1', '0', 'localhost']);
const NOT_BLOCKED = new Set(['localhost', 'localhost.localdomain', 'local', 'broadcasthost', 'ip6-localhost', 'ip6-loopback', '0.0.0.0']);

export function detectFormat(text: string): Exclude<ListFormat, 'auto'> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('!')).slice(0, 200);
  let hosts = 0, adb = 0, ips = 0;
  for (const l of lines) {
    if (/^\|\||^@@\|\|/.test(l)) adb++;
    else if (/^(0\.0\.0\.0|127\.0\.0\.1|::1?|0)\s+\S/.test(l)) hosts++;
    else if (familyOf(l.split('/')[0]) && !/\s/.test(l)) ips++;
  }
  if (adb >= hosts && adb >= ips && adb > 0) return 'adblock';
  if (hosts >= ips && hosts > 0) return 'hosts';
  if (ips > 0) return 'ips';
  return 'domains';
}

export function parseList(text: string, format: ListFormat = 'auto'): ParsedList {
  const f = format === 'auto' ? detectFormat(text) : format;
  const out: ParsedList = { domains: [], allow: [], cidrs: [], skipped: 0 };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith('!') || line.startsWith('[')) continue;
    if (f === 'adblock') {
      const m = line.match(/^(@@)?\|\|([^\^\/$*]+)\^?(\$.*)?$/);
      // Only whole-domain rules apply to DNS; cosmetic and path rules are for browsers.
      if (!m || (m[3] && !/^\$(important|all|document|third-party)?$/.test(m[3]))) { out.skipped++; continue; }
      const d = m[2].toLowerCase();
      if (!DOMAIN.test(d)) { out.skipped++; continue; }
      (m[1] ? out.allow : out.domains).push(d);
    } else if (f === 'hosts') {
      const parts = line.split(/\s+/);
      if (parts.length < 2 || !SINKS.has(parts[0])) { out.skipped++; continue; }
      for (const d of parts.slice(1).map((x) => x.toLowerCase())) if (!NOT_BLOCKED.has(d) && DOMAIN.test(d)) out.domains.push(d);
    } else if (f === 'ips') {
      const v = line.split(/[\s;,]/)[0];
      const c = parseCidr(v.includes('/') ? v : `${v}/${familyOf(v) === 6 ? 128 : 32}`);
      if (c) out.cidrs.push(`${c.net}/${c.prefix}`); else out.skipped++;
    } else {
      const d = line.split(/\s+/)[0].toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
      if (DOMAIN.test(d)) out.domains.push(d); else out.skipped++;
    }
  }
  return out;
}

/** Domain set with "this domain and all its subdomains" lookups; allow entries win. */
export class DomainSet {
  private blocked = new Map<string, string>();
  private allowed = new Set<string>();
  get size() { return this.blocked.size; }
  add(domains: Iterable<string>, listId: string) { for (const d of domains) if (!this.blocked.has(d)) this.blocked.set(d, listId); }
  allow(domains: Iterable<string>) { for (const d of domains) this.allowed.add(d); }
  remove(domain: string) { this.blocked.delete(domain); }
  /** The list that blocks `host` (checking each parent domain), or undefined. */
  match(host: string): string | undefined {
    let h = host.toLowerCase().replace(/\.$/, '');
    for (;;) {
      if (this.allowed.has(h)) return undefined;
      const hit = this.blocked.get(h);
      if (hit) return hit;
      const i = h.indexOf('.');
      if (i < 0) return undefined;
      h = h.slice(i + 1);
    }
  }
}

/** Address ranges, searched by binary search over sorted, merged intervals. */
export class IpSet {
  private v4: [number, number, string][] = [];
  private v6: [bigint, bigint, string][] = [];
  add(cidrs: Iterable<string>, listId: string) {
    for (const s of cidrs) {
      const c = parseCidr(s);
      if (!c) continue;
      if (c.family === 4) {
        const n = v4ToInt(c.net)!;
        const size = 2 ** (32 - c.prefix);
        const lo = Math.floor(n / size) * size;
        this.v4.push([lo, lo + size - 1, listId]);
      } else {
        const n = v6ToBig(c.net)!;
        const size = 1n << BigInt(128 - c.prefix);
        const lo = (n / size) * size;
        this.v6.push([lo, lo + size - 1n, listId]);
      }
    }
    this.v4.sort((a, b) => a[0] - b[0]);
    this.v6.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  get size() { return this.v4.length + this.v6.length; }
  match(ipIn: string): string | undefined {
    const ip = unmapV4(ipIn);
    if (familyOf(ip) === 4) {
      const n = v4ToInt(ip)!;
      // Ranges may overlap; check the candidates whose start is ≤ n (the list is sorted by start).
      let lo = 0, hi = this.v4.length - 1, at = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (this.v4[m][0] <= n) { at = m; lo = m + 1; } else hi = m - 1; }
      for (let i = at; i >= 0 && i > at - 64; i--) if (this.v4[i][1] >= n) return this.v4[i][2];
      return undefined;
    }
    const n = v6ToBig(ip);
    if (n === null) return undefined;
    for (const [a, b, id] of this.v6) if (a <= n && n <= b) return id;
    return undefined;
  }
}

export interface ListInfo {
  id: string;
  name: string;
  topic: 'ads' | 'trackers' | 'malware' | 'telemetry' | 'adult' | 'social' | 'gambling' | 'custom';
  url: string;
  format: ListFormat;
  /** what it is, in a sentence */
  description: string;
  licence: string;
  /** off unless the person turns it on */
  enabled?: boolean;
  /** pinned checksum: an update with a different checksum is refused until the person accepts it */
  sha256?: string;
  updated?: number;
  entries?: number;
  error?: string;
}

/** A curated starting set, by topic. Each is downloaded only when switched on, and checked daily. */
export const CURATED_LISTS: ListInfo[] = [
  { id: 'stevenblack', name: 'Unified hosts (ads and malware)', topic: 'ads', url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts', format: 'hosts', description: 'A widely used combined list of ad, tracking and malware domains.', licence: 'MIT' },
  { id: 'hagezi-pro', name: 'Multi PRO (ads, trackers, telemetry)', topic: 'trackers', url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/pro.txt', format: 'domains', description: 'Balanced blocking of ads, tracking and telemetry with few false alarms.', licence: 'GPL-3.0' },
  { id: 'hagezi-tif', name: 'Threat intelligence (malware, phishing)', topic: 'malware', url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/tif.txt', format: 'domains', description: 'Domains used for malware, phishing, scams and crypto-jacking.', licence: 'GPL-3.0' },
  { id: 'hagezi-native-apple', name: 'Apple telemetry', topic: 'telemetry', url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/native.apple.txt', format: 'domains', description: 'Apple device tracking and telemetry domains.', licence: 'GPL-3.0' },
  { id: 'hagezi-native-winoffice', name: 'Windows and Office telemetry', topic: 'telemetry', url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/native.winoffice.txt', format: 'domains', description: 'Windows and Microsoft Office telemetry domains.', licence: 'GPL-3.0' },
  { id: 'hagezi-gambling', name: 'Gambling', topic: 'gambling', url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/gambling.txt', format: 'domains', description: 'Online gambling sites.', licence: 'GPL-3.0' },
  { id: 'firehol-level1', name: 'Attack sources (addresses)', topic: 'malware', url: 'https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset', format: 'ips', description: 'Address ranges currently used for attacks; safe to block entirely.', licence: 'See source' },
];
