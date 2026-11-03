// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Browsers: which ones are installed, their profiles, the extensions in each
// and what those extensions may do, whether passwords are saved there (Keeper
// never reads them), sign-in sync and DNS over HTTPS. Pure parsing; the
// Electron side finds the files.

import type { BrowserExtension, BrowserProfile } from './types';

type Plat = 'darwin' | 'win32' | 'linux' | string;

export interface BrowserDef {
  name: string;
  engine: BrowserProfile['engine'];
  /** the folder holding "Local State" (Chromium) or profiles.ini (Firefox), per system */
  root: (home: string, platform: Plat, env: Record<string, string | undefined>) => string | undefined;
}

const j = (...p: string[]) => p.join('/').replace(/\/+/g, '/');
const win = (env: Record<string, string | undefined>, home: string) => ({ local: env.LOCALAPPDATA || `${home}/AppData/Local`, roaming: env.APPDATA || `${home}/AppData/Roaming` });

export const BROWSERS: BrowserDef[] = [
  { name: 'Chrome', engine: 'chromium', root: (h, p, e) => (p === 'darwin' ? j(h, 'Library/Application Support/Google/Chrome') : p === 'win32' ? j(win(e, h).local, 'Google/Chrome/User Data') : j(h, '.config/google-chrome')) },
  { name: 'Chromium', engine: 'chromium', root: (h, p, e) => (p === 'darwin' ? j(h, 'Library/Application Support/Chromium') : p === 'win32' ? j(win(e, h).local, 'Chromium/User Data') : j(h, '.config/chromium')) },
  { name: 'Edge', engine: 'chromium', root: (h, p, e) => (p === 'darwin' ? j(h, 'Library/Application Support/Microsoft Edge') : p === 'win32' ? j(win(e, h).local, 'Microsoft/Edge/User Data') : j(h, '.config/microsoft-edge')) },
  { name: 'Brave', engine: 'chromium', root: (h, p, e) => (p === 'darwin' ? j(h, 'Library/Application Support/BraveSoftware/Brave-Browser') : p === 'win32' ? j(win(e, h).local, 'BraveSoftware/Brave-Browser/User Data') : j(h, '.config/BraveSoftware/Brave-Browser')) },
  { name: 'Vivaldi', engine: 'chromium', root: (h, p, e) => (p === 'darwin' ? j(h, 'Library/Application Support/Vivaldi') : p === 'win32' ? j(win(e, h).local, 'Vivaldi/User Data') : j(h, '.config/vivaldi')) },
  { name: 'Opera', engine: 'chromium', root: (h, p, e) => (p === 'darwin' ? j(h, 'Library/Application Support/com.operasoftware.Opera') : p === 'win32' ? j(win(e, h).roaming, 'Opera Software/Opera Stable') : j(h, '.config/opera')) },
  { name: 'Arc', engine: 'chromium', root: (h, p, e) => (p === 'darwin' ? j(h, 'Library/Application Support/Arc/User Data') : p === 'win32' ? j(win(e, h).local, 'Packages/TheBrowserCompany.Arc_ttt1ap7aakyb4/LocalCache/Local/Arc/User Data') : undefined) },
  { name: 'Firefox', engine: 'firefox', root: (h, p, e) => (p === 'darwin' ? j(h, 'Library/Application Support/Firefox') : p === 'win32' ? j(win(e, h).roaming, 'Mozilla/Firefox') : j(h, '.mozilla/firefox')) },
  { name: 'Safari', engine: 'webkit', root: (h, p) => (p === 'darwin' ? j(h, 'Library/Safari') : undefined) },
];

// ---------------------------------------------------------------- extension risk

const ALL_SITES = /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*|\*:\/\/\*\/|file:\/\/\/\*)$/;

/** Each permission's weight and plain-English meaning. */
const PERM: Record<string, [number, string]> = {
  debugger: [35, 'can take full control of pages through the debugger'],
  proxy: [25, 'can route all your browsing through a server of its choosing'],
  nativeMessaging: [15, 'can talk to programs installed on your computer'],
  webRequest: [12, 'can watch every request your browser makes'],
  webRequestBlocking: [8, 'can change or block requests'],
  declarativeNetRequestWithHostAccess: [8, 'can redirect requests'],
  cookies: [15, 'can read your cookies, which keep you signed in'],
  management: [15, 'can turn other extensions on and off'],
  history: [10, 'can read your browsing history'],
  clipboardRead: [10, 'can read what you copy'],
  privacy: [8, 'can change privacy settings'],
  downloads: [6, 'can start and see downloads'],
  tabs: [4, 'can see the address of every tab'],
  webNavigation: [4, 'can see every page you go to'],
  scripting: [6, 'can run its own code in pages'],
  geolocation: [6, 'can ask for your location'],
  desktopCapture: [12, 'can record your screen'],
  tabCapture: [10, 'can record what is in a tab'],
  identity: [5, 'can sign in to services on your behalf'],
};

/** What one permission lets an extension do, in plain words. */
export function permissionMeaning(p: string): string {
  if (ALL_SITES.test(p)) return 'read and change every website you visit';
  if (/:\/\//.test(p)) return `read and change ${p.replace(/^\*:\/\//, '').replace(/\/\*$/, '')}`;
  const known = PERM[p]?.[1];
  if (known) return known.replace(/^can /, '');
  const plain: Record<string, string> = { storage: 'keep its own settings and data', alarms: 'run on a schedule', notifications: 'show notifications', contextMenus: 'add items to the right-click menu', activeTab: 'see the page you are on when you press its button', offscreen: 'work in the background', sidePanel: 'show a side panel', unlimitedStorage: 'store any amount of data', declarativeNetRequest: 'block or change requests by rules', bookmarks: 'read and change bookmarks', topSites: 'see your most visited sites', idle: 'know when you are away', power: 'keep the computer awake', webNavigation: 'see every page you go to' };
  return plain[p] ?? 'a browser permission';
}

/** Store pages, where the browser has one. */
export function extensionStoreUrl(browser: string, id: string, fromStore?: boolean): string | undefined {
  if (fromStore === false) return undefined;
  if (browser === 'Firefox') return `https://addons.mozilla.org/firefox/addon/${encodeURIComponent(id)}/`;
  if (browser === 'Edge') return `https://microsoftedge.microsoft.com/addons/detail/${id}`;
  if (browser === 'Safari') return undefined;
  return /^[a-p]{32}$/.test(id) ? `https://chromewebstore.google.com/detail/${id}` : undefined;
}

/** The browser's own page for an extension (opened in that browser). */
export function extensionPageUrl(browser: string, id: string): string {
  if (browser === 'Firefox') return 'about:addons';
  return `chrome://extensions/?id=${id}`;
}

/**
 * A manifest's "__MSG_appName__" name from its _locales/<locale>/messages.json.
 * `messages` returns a locale's messages.json text (or undefined). Keys match
 * without regard to case, as browsers do.
 */
export function localizedName(raw: string | undefined, messages: ((locale: string) => string | undefined) | undefined, defaultLocale?: string, prefer: string[] = []): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/^__MSG_(\w+?)__$/);
  if (!m) return raw;
  if (!messages) return undefined;
  const key = m[1].toLowerCase();
  const tried = new Set<string>();
  for (const loc of [...prefer, defaultLocale, 'en', 'en_US', 'en_GB'].filter((x): x is string => !!x)) {
    if (tried.has(loc)) continue;
    tried.add(loc);
    const text = messages(loc);
    if (!text) continue;
    try {
      const json = JSON.parse(text.replace(/^\uFEFF/, '')) as Record<string, { message?: string }>;
      const hit = Object.entries(json).find(([k]) => k.toLowerCase() === key)?.[1]?.message;
      if (hit && !/^__MSG_/.test(hit)) return hit.trim();
    } catch {
      /* a broken messages file: try the next locale */
    }
  }
  return undefined;
}

/** Extension ids known to be malicious: updated from a list the person subscribes to; empty until then. */
export type KnownBad = Record<string, string>;

export function scoreExtension(e: Pick<BrowserExtension, 'id' | 'permissions' | 'hostPermissions' | 'fromStore'>, known: KnownBad = {}): { risk: number; reasons: string[]; knownBad?: string } {
  if (known[e.id]) return { risk: 100, reasons: [`Listed as malicious: ${known[e.id]}`], knownBad: known[e.id] };
  const reasons: string[] = [];
  let risk = 0;
  const all = [...e.permissions, ...e.hostPermissions];
  if (all.some((p) => ALL_SITES.test(p))) {
    risk += 35;
    reasons.push('can read and change every website you visit');
  } else if (e.hostPermissions.length > 20) {
    risk += 15;
    reasons.push(`can read and change ${e.hostPermissions.length} websites`);
  }
  for (const p of e.permissions) {
    const w = PERM[p];
    if (w) {
      risk += w[0];
      reasons.push(w[1]);
    }
  }
  if (e.fromStore === false) {
    risk += 15;
    reasons.push('was not installed from the browser’s store');
  }
  return { risk: Math.min(99, risk), reasons };
}

// ---------------------------------------------------------------- Chromium

/** "Local State": the list of profiles and the DNS over HTTPS mode. */
export function parseChromiumLocalState(json: string): { profiles: { dir: string; name: string }[]; doh?: BrowserProfile['doh'] } {
  let o: { profile?: { info_cache?: Record<string, { name?: string }> }; dns_over_https?: { mode?: string } } = {};
  try {
    o = JSON.parse(json);
  } catch {
    return { profiles: [] };
  }
  const cache = o.profile?.info_cache ?? {};
  const profiles = Object.entries(cache).map(([dir, v]) => ({ dir, name: v.name ?? dir }));
  const mode = o.dns_over_https?.mode;
  return { profiles: profiles.length ? profiles : [{ dir: 'Default', name: 'Default' }], doh: mode === 'secure' ? 'secure' : mode === 'automatic' ? 'automatic' : mode === 'off' ? 'off' : undefined };
}

interface ChromiumSetting {
  manifest?: { name?: string; version?: string; permissions?: string[]; host_permissions?: string[]; optional_permissions?: string[]; default_locale?: string };
  state?: number;
  disable_reasons?: number | number[];
  from_webstore?: boolean;
  location?: number;
  was_installed_by_default?: boolean;
}

/** A profile's "Preferences" (and "Secure Preferences"): extension settings, and whether sync is signed in. */
export function parseChromiumPreferences(json: string): { settings: Record<string, ChromiumSetting>; signedIn: boolean } {
  let o: { extensions?: { settings?: Record<string, ChromiumSetting> }; account_info?: unknown[]; signin?: { allowed?: boolean }; google?: { services?: { signin_scoped_device_id?: string } } } = {};
  try {
    o = JSON.parse(json);
  } catch {
    return { settings: {}, signedIn: false };
  }
  return { settings: o.extensions?.settings ?? {}, signedIn: Array.isArray(o.account_info) && o.account_info.length > 0 };
}

/** One extension from its manifest.json (newer Chromium keeps the manifest only on disk). */
export function chromiumExtension(id: string, manifestJson: string | undefined, setting: ChromiumSetting | undefined, known: KnownBad = {}, messages?: (locale: string) => string | undefined, prefer: string[] = []): BrowserExtension | null {
  const fromPrefs = setting?.manifest?.name;
  let m: ChromiumSetting['manifest'] & { manifest_version?: number } = setting?.manifest ?? {};
  if (manifestJson) {
    try {
      m = { ...m, ...JSON.parse(manifestJson) };
    } catch {
      /* keep what Preferences said */
    }
  }
  if (!m.name) return null;
  // Built-in component extensions (location 5/10) are part of the browser.
  if (setting?.location === 5 || setting?.location === 10) return null;
  const perms = (m.permissions ?? []).filter((p) => typeof p === 'string');
  const hosts = [...(m.host_permissions ?? []), ...perms.filter((p) => /:\/\/|<all_urls>/.test(p))];
  const permissions = perms.filter((p) => !/:\/\/|<all_urls>/.test(p));
  const disabled = setting ? (setting.state === 0 || (Array.isArray(setting.disable_reasons) ? setting.disable_reasons.length > 0 : !!setting.disable_reasons)) : false;
  const fromStore = setting?.from_webstore ?? undefined;
  const s = scoreExtension({ id, permissions, hostPermissions: hosts, fromStore }, known);
  // "__MSG_appName__": the real name is in the extension's _locales; the id only when there is no name at all.
  const name = localizedName(m.name, messages, m.default_locale, prefer) ?? (fromPrefs && !fromPrefs.startsWith('__MSG_') ? fromPrefs : undefined) ?? id;
  return { id, name, version: m.version, enabled: !disabled, permissions, hostPermissions: hosts, fromStore, ...s };
}

// ---------------------------------------------------------------- Firefox

/** profiles.ini: each [Profile*] section's Name and Path (relative to the Firefox folder when IsRelative=1). */
export function parseFirefoxProfilesIni(text: string): { name: string; path: string; relative: boolean }[] {
  const out: { name: string; path: string; relative: boolean }[] = [];
  let cur: { name?: string; path?: string; relative?: boolean } | null = null;
  const flush = () => cur?.path && out.push({ name: cur.name ?? cur.path, path: cur.path, relative: cur.relative !== false });
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[Profile\d+\]$/.test(line)) {
      flush();
      cur = {};
    } else if (/^\[/.test(line)) {
      flush();
      cur = null;
    } else if (cur) {
      const [k, ...v] = line.split('=');
      const val = v.join('=');
      if (k === 'Name') cur.name = val;
      else if (k === 'Path') cur.path = val;
      else if (k === 'IsRelative') cur.relative = val === '1';
    }
  }
  flush();
  return out;
}

/** extensions.json in a Firefox profile. */
export function parseFirefoxExtensions(json: string, known: KnownBad = {}): BrowserExtension[] {
  let o: { addons?: { id: string; type?: string; location?: string; version?: string; active?: boolean; userDisabled?: boolean; defaultLocale?: { name?: string }; userPermissions?: { permissions?: string[]; origins?: string[] }; signedState?: number }[] } = {};
  try {
    o = JSON.parse(json);
  } catch {
    return [];
  }
  const out: BrowserExtension[] = [];
  for (const a of o.addons ?? []) {
    if (a.type && a.type !== 'extension') continue;
    if (a.location && /app-system|app-builtin/.test(a.location)) continue;
    const permissions = a.userPermissions?.permissions ?? [];
    const hostPermissions = a.userPermissions?.origins ?? [];
    const fromStore = a.signedState === undefined ? undefined : a.signedState >= 2;
    const s = scoreExtension({ id: a.id, permissions, hostPermissions, fromStore }, known);
    out.push({ id: a.id, name: a.defaultLocale?.name ?? a.id, version: a.version, enabled: a.active !== false && !a.userDisabled, permissions, hostPermissions, fromStore, ...s });
  }
  return out;
}

/** prefs.js: DNS over HTTPS (network.trr.mode: 0/5 off, 2 first with fallback, 3 only). */
export function firefoxDoh(prefsJs: string): BrowserProfile['doh'] {
  const m = prefsJs.match(/user_pref\("network\.trr\.mode",\s*(\d)\)/);
  if (!m) return undefined;
  return m[1] === '3' ? 'secure' : m[1] === '2' ? 'automatic' : 'off';
}
