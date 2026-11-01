// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Per-tab and per-site browser controls through Keeper's browser extension.
//
//   extension ⇄ (native messaging) ⇄ `keeper browser-host` ⇄ (local socket) ⇄ Keeper app
//
// The extension reports its open tabs and what each page talks to; Keeper
// sends back commands (mute, sleep, site permissions, blocking rules, proxy).
// This file is the shared protocol and the pure parts: command checking,
// blocking-rule generation and PAC scripts. Tested without a browser.

export type BrowserCap = 'tabs' | 'mute' | 'discard' | 'contentSettings' | 'dnr' | 'cookies' | 'proxy' | 'memory';

export interface BrowserTab {
  id: number;
  windowId: number;
  url: string;
  title: string;
  active: boolean;
  audible: boolean;
  muted: boolean;
  discarded: boolean;
  incognito: boolean;
  /** third-party hosts this page talked to, with request counts */
  parties?: { host: string; requests: number; blocked?: number }[];
  /** bytes transferred by this tab since it loaded (an estimate from response headers) */
  bytes?: number;
  requests?: number;
  /** JS heap of the page in bytes when the browser exposes it (estimate) */
  memory?: number;
}

export interface BrowserSession {
  id: string;
  /** "Chrome 131", "Firefox 133", "Edge 131" */
  browser: string;
  caps: BrowserCap[];
  tabs: BrowserTab[];
  seen: number;
}

export type ContentType = 'camera' | 'microphone' | 'location' | 'notifications' | 'javascript' | 'cookies' | 'popups' | 'images' | 'sound' | 'automaticDownloads';
export type ContentValue = 'allow' | 'block' | 'ask' | 'default' | 'session_only';

export type TabCommand =
  | { cmd: 'list' }
  | { cmd: 'mute'; tabId: number; muted: boolean }
  | { cmd: 'discard'; tabId: number }
  | { cmd: 'close'; tabId: number }
  | { cmd: 'focus'; tabId: number }
  | { cmd: 'reload'; tabId: number }
  | { cmd: 'contentSetting'; type: ContentType; pattern: string; setting: ContentValue }
  | { cmd: 'getContentSettings'; url: string }
  | { cmd: 'clearSiteData'; origin: string; what: ('cookies' | 'cache' | 'localStorage')[] }
  | { cmd: 'thirdPartyCookies'; block: boolean }
  | { cmd: 'setBlockRules'; rules: DnrRule[] }
  | { cmd: 'setSiteBlocking'; site: string; on: boolean }
  | { cmd: 'setProxy'; pac: string | null }
  | { cmd: 'tabInfo'; tabId: number };

/** Messages from the extension (through the host). Messages without `kind` are the original page reports. */
export type ExtensionMessage =
  | { kind: 'hello'; browser: string; version: string; caps: BrowserCap[] }
  | { kind: 'tabs'; tabs: BrowserTab[] }
  | { kind: 'reply'; reqId: string; ok: boolean; result?: unknown; error?: string }
  | { kind: 'report'; site: string; thirdParties: { host: string; requests: number }[]; at: number; browser?: string };

/** Message to the extension. */
export interface HostCommand {
  kind: 'cmd';
  reqId: string;
  command: TabCommand;
}

const CONTENT: ContentType[] = ['camera', 'microphone', 'location', 'notifications', 'javascript', 'cookies', 'popups', 'images', 'sound', 'automaticDownloads'];
const VALUES: ContentValue[] = ['allow', 'block', 'ask', 'default', 'session_only'];

export const CONTENT_LABEL: Record<ContentType, string> = {
  camera: 'Camera', microphone: 'Microphone', location: 'Location', notifications: 'Notifications', javascript: 'JavaScript',
  cookies: 'Cookies', popups: 'Pop-ups', images: 'Images', sound: 'Sound', automaticDownloads: 'Automatic downloads',
};

/** Which settings each content type accepts (Chrome's contentSettings rules). */
export function allowedValues(t: ContentType): ContentValue[] {
  if (t === 'camera' || t === 'microphone' || t === 'location' || t === 'notifications' || t === 'automaticDownloads') return ['allow', 'block', 'ask', 'default'];
  if (t === 'cookies') return ['allow', 'block', 'session_only', 'default'];
  return ['allow', 'block', 'default'];
}

/** A contentSettings pattern for a site and all its subdomains: "https://www.example.com/a" → "*://*.www.example.com/*". */
export function sitePattern(urlOrHost: string): string {
  let host = urlOrHost.trim();
  try {
    if (/^[a-z]+:\/\//i.test(host)) host = new URL(host).hostname;
  } catch {
    /* use as given */
  }
  host = host.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9.-]+$/.test(host) || host.length > 253 || !host.includes('.') && host !== 'localhost') throw new Error('Not a site name');
  return `*://*.${host}/*`;
}

const isTab = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;

/** Checks a command before it is sent to the browser. Throws with a plain message. */
export function checkCommand(c: TabCommand): TabCommand {
  switch (c.cmd) {
    case 'list': return c;
    case 'mute': case 'discard': case 'close': case 'focus': case 'reload': case 'tabInfo':
      if (!isTab(c.tabId)) throw new Error('No such tab');
      return c.cmd === 'mute' ? { cmd: 'mute', tabId: c.tabId, muted: !!c.muted } : c;
    case 'contentSetting':
      if (!CONTENT.includes(c.type)) throw new Error('Unknown permission');
      if (!VALUES.includes(c.setting) || !allowedValues(c.type).includes(c.setting)) throw new Error('Not a valid choice for that permission');
      return { ...c, pattern: c.pattern.startsWith('*://') ? c.pattern : sitePattern(c.pattern) };
    case 'getContentSettings':
      if (!/^https?:\/\//.test(c.url)) throw new Error('Only web pages have site settings');
      return c;
    case 'clearSiteData': {
      const u = new URL(c.origin);
      if (!/^https?:$/.test(u.protocol)) throw new Error('Only web sites');
      return { cmd: 'clearSiteData', origin: u.origin, what: c.what.filter((w) => ['cookies', 'cache', 'localStorage'].includes(w)) };
    }
    case 'thirdPartyCookies': return { cmd: 'thirdPartyCookies', block: !!c.block };
    case 'setBlockRules':
      if (!Array.isArray(c.rules) || c.rules.length > MAX_DYNAMIC_RULES) throw new Error('Too many rules');
      return c;
    case 'setSiteBlocking': sitePattern(c.site); return c;
    case 'setProxy':
      if (c.pac !== null && (typeof c.pac !== 'string' || c.pac.length > 200_000 || !/function\s+FindProxyForURL/.test(c.pac))) throw new Error('Not a proxy script');
      return c;
  }
  throw new Error('Unknown command');
}

// ---------------------------------------------------------------- blocking rules

export interface DnrRule {
  id: number;
  priority: number;
  action: { type: 'block' | 'allow' | 'allowAllRequests' };
  condition: { requestDomains?: string[]; initiatorDomains?: string[]; excludedInitiatorDomains?: string[]; domainType?: 'thirdParty' | 'firstParty'; resourceTypes?: string[] };
}

/** Chrome allows 30 000 dynamic rules; Keeper stays well under. */
export const MAX_DYNAMIC_RULES = 5000;
const DOMAINS_PER_RULE = 1000;

/**
 * declarativeNetRequest rules from Keeper's blocklists: blocked domains are
 * grouped (one rule per thousand domains), sites the person allowed get
 * higher-priority allow rules so they work normally.
 */
export function buildBlockRules(blocked: Iterable<string>, opts: { allowSites?: string[]; thirdPartyOnly?: boolean } = {}): DnrRule[] {
  const clean = [...new Set([...blocked].map((d) => d.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '')).filter((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)))].sort();
  const rules: DnrRule[] = [];
  let id = 1;
  for (const s of opts.allowSites ?? []) {
    const host = s.toLowerCase().replace(/^\*\./, '');
    if (!/^[a-z0-9.-]+$/.test(host)) continue;
    rules.push({ id: id++, priority: 2, action: { type: 'allowAllRequests' }, condition: { requestDomains: [host], resourceTypes: ['main_frame', 'sub_frame'] } });
  }
  for (let i = 0; i < clean.length && rules.length < MAX_DYNAMIC_RULES; i += DOMAINS_PER_RULE) {
    rules.push({ id: id++, priority: 1, action: { type: 'block' }, condition: { requestDomains: clean.slice(i, i + DOMAINS_PER_RULE), ...(opts.thirdPartyOnly !== false ? { domainType: 'thirdParty' } : {}) } });
  }
  return rules;
}

// ---------------------------------------------------------------- proxy

/** A PAC script sending only the listed sites through a proxy; everything else goes direct. */
export function buildPac(sites: string[], proxy: { type: 'PROXY' | 'SOCKS5' | 'HTTPS'; host: string; port: number }): string {
  if (!/^[a-zA-Z0-9.-]+$/.test(proxy.host) || !Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) throw new Error('Not a proxy address');
  const list = sites.map((s) => s.toLowerCase().replace(/^\*\./, '')).filter((s) => /^[a-z0-9.-]+$/.test(s));
  return `function FindProxyForURL(url, host) {
  var sites = ${JSON.stringify(list)};
  for (var i = 0; i < sites.length; i++) {
    if (host === sites[i] || dnsDomainIs(host, '.' + sites[i])) return '${proxy.type} ${proxy.host}:${proxy.port}';
  }
  return 'DIRECT';
}`;
}

// ---------------------------------------------------------------- views

/** All tabs across browsers, heaviest first, for the "Browsers" view. */
export function flattenTabs(sessions: BrowserSession[]): (BrowserTab & { session: string; browser: string })[] {
  return sessions.flatMap((s) => s.tabs.map((t) => ({ ...t, session: s.id, browser: s.browser })))
    .sort((a, b) => Number(b.audible) - Number(a.audible) || (b.bytes ?? 0) - (a.bytes ?? 0) || a.title.localeCompare(b.title));
}

/** Parses an incoming extension message; legacy page reports (no kind) become 'report'. */
export function parseExtensionMessage(m: unknown): ExtensionMessage | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (o.kind === 'hello' && typeof o.browser === 'string') return { kind: 'hello', browser: o.browser.slice(0, 60), version: String(o.version ?? ''), caps: (Array.isArray(o.caps) ? o.caps : []).filter((c): c is BrowserCap => typeof c === 'string') };
  if (o.kind === 'tabs' && Array.isArray(o.tabs)) return { kind: 'tabs', tabs: (o.tabs as BrowserTab[]).slice(0, 2000).filter((t) => isTab(t?.id) && typeof t.url === 'string') };
  if (o.kind === 'reply' && typeof o.reqId === 'string') return { kind: 'reply', reqId: o.reqId, ok: !!o.ok, result: o.result, error: typeof o.error === 'string' ? o.error : undefined };
  if ((o.kind === undefined || o.kind === 'report') && typeof o.site === 'string' && Array.isArray(o.thirdParties)) return { kind: 'report', site: o.site, thirdParties: o.thirdParties as { host: string; requests: number }[], at: Number(o.at) || Date.now(), browser: typeof o.browser === 'string' ? o.browser : undefined };
  return null;
}

/** What each browser can do, in plain words (shown on the Browsers page). */
export const BROWSER_LIMITS = [
  { browser: 'Chrome, Edge, Brave, Vivaldi, Opera', text: 'Everything: tabs, mute, sleep, site permissions (camera, microphone, location, notifications, JavaScript, cookies), blocking rules and per-site proxy.' },
  { browser: 'Firefox', text: 'Tabs, mute, sleep, blocking rules, cookies and per-site proxy. Firefox has no contentSettings API, so camera, microphone, location and JavaScript per site are changed in Firefox\'s own site settings (the padlock in the address bar).' },
  { browser: 'Safari', text: 'Not linked yet. A Safari extension can only talk to an app it is packaged inside and must be built with Xcode and signed by Apple; scripts/build-safari-extension.sh makes the Xcode project from the same extension on a Mac, but Keeper does not ship it yet.' },
];
