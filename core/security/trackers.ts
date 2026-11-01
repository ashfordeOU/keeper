// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Trackers and unencrypted traffic: which hosts apps and browsers talk to are
// advertising, analytics or fingerprinting services, and which connections
// send data in the clear.
//
// A small built-in list covers the most common services; the person can add
// open lists (Disconnect's services.json, GPL-3.0; EasyPrivacy, GPL-3.0 /
// CC BY-SA 3.0) which Keeper downloads only when asked.

export type TrackerCategory = 'advertising' | 'analytics' | 'social' | 'fingerprinting' | 'cryptomining' | 'telemetry';

/** Well-known services, by registrable domain. */
const BUILT_IN: Record<string, [TrackerCategory, string]> = {
  'doubleclick.net': ['advertising', 'Google Ads'],
  'googlesyndication.com': ['advertising', 'Google Ads'],
  'googleadservices.com': ['advertising', 'Google Ads'],
  'google-analytics.com': ['analytics', 'Google Analytics'],
  'googletagmanager.com': ['analytics', 'Google Tag Manager'],
  'app-measurement.com': ['analytics', 'Firebase Analytics'],
  'connect.facebook.net': ['social', 'Facebook'],
  'graph.facebook.com': ['social', 'Facebook'],
  'scorecardresearch.com': ['analytics', 'Comscore'],
  'quantserve.com': ['analytics', 'Quantcast'],
  'hotjar.com': ['analytics', 'Hotjar'],
  'mixpanel.com': ['analytics', 'Mixpanel'],
  'amplitude.com': ['analytics', 'Amplitude'],
  'segment.io': ['analytics', 'Segment'],
  'segment.com': ['analytics', 'Segment'],
  'clarity.ms': ['analytics', 'Microsoft Clarity'],
  'bat.bing.com': ['advertising', 'Microsoft Ads'],
  'criteo.com': ['advertising', 'Criteo'],
  'criteo.net': ['advertising', 'Criteo'],
  'taboola.com': ['advertising', 'Taboola'],
  'outbrain.com': ['advertising', 'Outbrain'],
  'adnxs.com': ['advertising', 'Xandr'],
  'rubiconproject.com': ['advertising', 'Magnite'],
  'pubmatic.com': ['advertising', 'PubMatic'],
  'openx.net': ['advertising', 'OpenX'],
  'casalemedia.com': ['advertising', 'Index Exchange'],
  'adsrvr.org': ['advertising', 'The Trade Desk'],
  'ads-twitter.com': ['advertising', 'X Ads'],
  'analytics.tiktok.com': ['analytics', 'TikTok'],
  'px.ads.linkedin.com': ['advertising', 'LinkedIn Ads'],
  'mc.yandex.ru': ['analytics', 'Yandex Metrica'],
  'appsflyer.com': ['analytics', 'AppsFlyer'],
  'adjust.com': ['analytics', 'Adjust'],
  'branch.io': ['analytics', 'Branch'],
  'crashlytics.com': ['telemetry', 'Crashlytics'],
  'fullstory.com': ['analytics', 'FullStory'],
  'newrelic.com': ['telemetry', 'New Relic'],
  'nr-data.net': ['telemetry', 'New Relic'],
  'datadoghq.com': ['telemetry', 'Datadog'],
  'sentry.io': ['telemetry', 'Sentry'],
  'fingerprintjs.com': ['fingerprinting', 'FingerprintJS'],
  'coinhive.com': ['cryptomining', 'Coinhive'],
};

export interface TrackerIndex {
  /** domain → [category, owner] */
  domains: Map<string, [TrackerCategory, string]>;
}

export function trackerIndex(extra: Record<string, [TrackerCategory, string]> = {}): TrackerIndex {
  return { domains: new Map(Object.entries({ ...BUILT_IN, ...extra })) };
}

/** The tracker a host belongs to (matching the host or any parent domain), if any. */
export function classifyHost(host: string | undefined, idx: TrackerIndex): { category: TrackerCategory; owner: string; domain: string } | undefined {
  if (!host) return undefined;
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join('.');
    const hit = idx.domains.get(d);
    if (hit) return { category: hit[0], owner: hit[1], domain: d };
  }
  return undefined;
}

/** Disconnect's services.json: { categories: { Advertising: [ { Owner: { url: [domains] } } ] } }. */
export function parseDisconnect(json: string): Record<string, [TrackerCategory, string]> {
  const out: Record<string, [TrackerCategory, string]> = {};
  let o: { categories?: Record<string, Record<string, Record<string, unknown>>[]> } = {};
  try {
    o = JSON.parse(json);
  } catch {
    return out;
  }
  const map: Record<string, TrackerCategory> = { Advertising: 'advertising', Analytics: 'analytics', Social: 'social', Fingerprinting: 'fingerprinting', FingerprintingInvasive: 'fingerprinting', FingerprintingGeneral: 'fingerprinting', Cryptomining: 'cryptomining', Content: 'analytics' };
  for (const [cat, entries] of Object.entries(o.categories ?? {})) {
    const category = map[cat];
    if (!category || cat === 'Content') continue;
    for (const entry of entries) {
      for (const [owner, sites] of Object.entries(entry)) {
        for (const domains of Object.values(sites as Record<string, unknown>)) {
          if (Array.isArray(domains)) for (const d of domains) if (typeof d === 'string') out[d.toLowerCase()] = [category, owner];
        }
      }
    }
  }
  return out;
}

/** A plain list of domains (one per line, # comments, hosts-file lines accepted). */
export function parseDomainList(text: string, category: TrackerCategory, owner = 'List'): Record<string, [TrackerCategory, string]> {
  const out: Record<string, [TrackerCategory, string]> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const d = (line.split(/\s+/).length > 1 ? line.split(/\s+/)[1] : line).replace(/^\|\||\^.*$/g, '').toLowerCase();
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) out[d] = [category, owner];
  }
  return out;
}

// ---------------------------------------------------------------- unencrypted traffic

/** Ports whose protocols send data (often passwords) in the clear. */
export const CLEARTEXT_PORTS: Record<number, string> = {
  21: 'FTP', 23: 'Telnet', 25: 'SMTP without encryption', 80: 'HTTP', 110: 'POP3', 143: 'IMAP', 389: 'LDAP', 1883: 'MQTT', 5900: 'VNC', 8080: 'HTTP',
};

export interface ConnLike {
  app: string;
  remote?: string;
  remotePort?: number;
  host?: string;
  country?: string;
  scope?: string;
  bytesIn?: number;
  bytesOut?: number;
  state?: string;
  localPort?: number;
}

export interface AppPrivacy {
  app: string;
  destinations: number;
  countries: string[];
  trackers: { owner: string; category: TrackerCategory; host: string }[];
  cleartext: { host: string; port: number; protocol: string }[];
  bytesOut: number;
}

/** Per app: how many places it talks to, which are trackers, and what goes unencrypted over the internet. */
export function appPrivacy(conns: ConnLike[], idx: TrackerIndex): AppPrivacy[] {
  const by = new Map<string, AppPrivacy & { dests: Set<string> }>();
  for (const c of conns) {
    if (!c.remote || c.scope === 'listening' || c.scope === 'loopback') continue;
    const a = by.get(c.app) ?? { app: c.app, destinations: 0, countries: [], trackers: [], cleartext: [], bytesOut: 0, dests: new Set<string>() };
    by.set(c.app, a);
    const host = c.host ?? c.remote;
    a.dests.add(host);
    if (c.country && !a.countries.includes(c.country)) a.countries.push(c.country);
    a.bytesOut += c.bytesOut ?? 0;
    const t = classifyHost(c.host, idx);
    if (t && !a.trackers.some((x) => x.owner === t.owner)) a.trackers.push({ owner: t.owner, category: t.category, host });
    const proto = c.remotePort !== undefined ? CLEARTEXT_PORTS[c.remotePort] : undefined;
    if (proto && c.scope !== 'lan' && !a.cleartext.some((x) => x.host === host && x.port === c.remotePort)) a.cleartext.push({ host, port: c.remotePort!, protocol: proto });
  }
  return [...by.values()].map(({ dests, ...a }) => ({ ...a, destinations: dests.size })).sort((x, y) => y.trackers.length - x.trackers.length || y.destinations - x.destinations);
}

/** Programs listening for connections from other machines (not just this one). */
export function exposedListeners(conns: (ConnLike & { local?: string })[]): { app: string; port: number; address: string }[] {
  const out: { app: string; port: number; address: string }[] = [];
  for (const c of conns) {
    if (c.scope !== 'listening' || c.localPort === undefined) continue;
    const addr = c.local ?? '';
    if (/^(127\.|::1$|localhost)/.test(addr)) continue;
    if (!out.some((x) => x.app === c.app && x.port === c.localPort)) out.push({ app: c.app, port: c.localPort, address: addr || '*' });
  }
  return out.sort((a, b) => a.port - b.port);
}
