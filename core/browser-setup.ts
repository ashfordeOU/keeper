// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Setting up Keeper's browser extension: which browsers are on this computer,
// whether Keeper is registered with each (native messaging) and whether the
// extension is connected, and how to open each browser's extensions page.
//
// Browsers do not let an app add an extension by itself (only company
// policies can, and Keeper does not use them). So Keeper does every step it
// may — registering itself, opening the right page, showing the folder — and
// the person does the one click the browser keeps for them. Once the
// extension is published in the stores (STORE_LISTINGS), that click is
// "Add to Chrome" on the store page.

import type { BrowserSession } from './browser-tabs';
import { hostManifestLocations } from './security/nativemsg';

export type SetupBrowserId = 'chrome' | 'chromium' | 'edge' | 'brave' | 'vivaldi' | 'opera' | 'arc' | 'firefox' | 'safari';

/**
 * Store pages for the extension. Empty until it is published there; when set,
 * "Add to …" opens the listing and adding it is one click (TODO in browser-extension/README.md).
 */
export const STORE_LISTINGS: { chromeWebStore: string; edgeAddons: string; firefoxAddons: string } = {
  chromeWebStore: '',
  edgeAddons: '',
  firefoxAddons: '',
};

interface Def {
  id: SetupBrowserId;
  name: string;
  engine: 'chromium' | 'firefox' | 'webkit';
  /** the browser's own extensions page */
  page: string;
  /** macOS app name (for `open -a`) */
  mac: string;
  /** Windows App Paths name (for `start`) */
  win?: string;
  /** Linux commands, first found wins */
  linux?: string[];
  /** which native-messaging location it reads (hostManifestLocations' browser name) */
  host?: string;
}

export const SETUP_BROWSERS: Def[] = [
  { id: 'chrome', name: 'Chrome', engine: 'chromium', page: 'chrome://extensions', mac: 'Google Chrome', win: 'chrome', linux: ['google-chrome', 'google-chrome-stable'], host: 'Chrome' },
  { id: 'edge', name: 'Edge', engine: 'chromium', page: 'edge://extensions', mac: 'Microsoft Edge', win: 'msedge', linux: ['microsoft-edge', 'microsoft-edge-stable'], host: 'Edge' },
  { id: 'brave', name: 'Brave', engine: 'chromium', page: 'brave://extensions', mac: 'Brave Browser', win: 'brave', linux: ['brave-browser', 'brave'], host: 'Brave' },
  { id: 'vivaldi', name: 'Vivaldi', engine: 'chromium', page: 'vivaldi://extensions', mac: 'Vivaldi', win: 'vivaldi', linux: ['vivaldi', 'vivaldi-stable'], host: 'Vivaldi' },
  { id: 'opera', name: 'Opera', engine: 'chromium', page: 'opera://extensions', mac: 'Opera', win: 'opera', linux: ['opera'], host: 'Chrome' },
  { id: 'arc', name: 'Arc', engine: 'chromium', page: 'arc://extensions', mac: 'Arc', win: 'arc', host: 'Arc' },
  { id: 'chromium', name: 'Chromium', engine: 'chromium', page: 'chrome://extensions', mac: 'Chromium', win: 'chromium', linux: ['chromium', 'chromium-browser'], host: 'Chromium' },
  { id: 'firefox', name: 'Firefox', engine: 'firefox', page: 'about:debugging#/runtime/this-firefox', mac: 'Firefox', win: 'firefox', linux: ['firefox'], host: 'Firefox' },
  { id: 'safari', name: 'Safari', engine: 'webkit', page: '', mac: 'Safari' },
];

export const setupDef = (id: string) => SETUP_BROWSERS.find((b) => b.id === id);

/** Where Keeper's native-messaging registration for this browser lives (falls back to Chrome's, which Opera and others read). */
export function hostLocationFor(platform: string, home: string, id: SetupBrowserId) {
  const def = setupDef(id);
  if (!def?.host) return undefined;
  const all = hostManifestLocations(platform, home);
  return all.find((l) => l.browser === def.host) ?? all.find((l) => l.browser === 'Chrome' && def.engine === 'chromium');
}

const j = (...p: string[]) => p.join('/').replace(/\/+/g, '/');

/** Files whose presence means the browser is installed (or has been used) here. */
export function installMarkers(platform: string, home: string, env: Record<string, string | undefined>, id: SetupBrowserId): string[] {
  const def = setupDef(id)!;
  if (platform === 'darwin') {
    const support = j(home, 'Library/Application Support');
    const data: Record<SetupBrowserId, string> = {
      chrome: 'Google/Chrome', chromium: 'Chromium', edge: 'Microsoft Edge', brave: 'BraveSoftware/Brave-Browser', vivaldi: 'Vivaldi',
      opera: 'com.operasoftware.Opera', arc: 'Arc/User Data', firefox: 'Firefox', safari: '',
    };
    const apps = [`/Applications/${def.mac}.app`, j(home, `Applications/${def.mac}.app`)];
    if (id === 'safari') return ['/Applications/Safari.app', '/System/Applications/Safari.app', '/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app'];
    return [...apps, j(support, data[id])];
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || j(home, 'AppData/Local');
    const roaming = env.APPDATA || j(home, 'AppData/Roaming');
    const pf = env.ProgramFiles || 'C:/Program Files';
    const pf86 = env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
    const m: Record<SetupBrowserId, string[]> = {
      chrome: [j(local, 'Google/Chrome/User Data'), j(pf, 'Google/Chrome/Application/chrome.exe'), j(pf86, 'Google/Chrome/Application/chrome.exe')],
      chromium: [j(local, 'Chromium/User Data')],
      edge: [j(local, 'Microsoft/Edge/User Data'), j(pf86, 'Microsoft/Edge/Application/msedge.exe'), j(pf, 'Microsoft/Edge/Application/msedge.exe')],
      brave: [j(local, 'BraveSoftware/Brave-Browser/User Data'), j(pf, 'BraveSoftware/Brave-Browser/Application/brave.exe')],
      vivaldi: [j(local, 'Vivaldi/User Data'), j(local, 'Vivaldi/Application/vivaldi.exe')],
      opera: [j(roaming, 'Opera Software/Opera Stable'), j(local, 'Programs/Opera/opera.exe')],
      arc: [j(local, 'Packages/TheBrowserCompany.Arc_ttt1ap7aakyb4')],
      firefox: [j(roaming, 'Mozilla/Firefox'), j(pf, 'Mozilla Firefox/firefox.exe'), j(pf86, 'Mozilla Firefox/firefox.exe')],
      safari: [],
    };
    return m[id];
  }
  const cfg = env.XDG_CONFIG_HOME || j(home, '.config');
  const m: Record<SetupBrowserId, string[]> = {
    chrome: [j(cfg, 'google-chrome')], chromium: [j(cfg, 'chromium'), j(home, 'snap/chromium')], edge: [j(cfg, 'microsoft-edge')],
    brave: [j(cfg, 'BraveSoftware/Brave-Browser')], vivaldi: [j(cfg, 'vivaldi')], opera: [j(cfg, 'opera')], arc: [],
    firefox: [j(home, '.mozilla/firefox'), j(home, 'snap/firefox')], safari: [],
  };
  const bins = (def.linux ?? []).flatMap((b) => [`/usr/bin/${b}`, `/usr/local/bin/${b}`, `/snap/bin/${b}`]);
  return [...m[id], ...bins];
}

export interface DetectedBrowser {
  id: SetupBrowserId;
  name: string;
  engine: 'chromium' | 'firefox' | 'webkit';
  /** Keeper can work with it (Safari not yet) */
  supported: boolean;
  /** Keeper is registered with it (native messaging) */
  linked: boolean;
  /** the extension is talking to Keeper right now */
  connected: boolean;
}

/** Which session (by the name the extension reports, "Chrome 131", "Edge 131") belongs to which browser. */
export function sessionBrowserId(reported: string): SetupBrowserId | undefined {
  const n = reported.toLowerCase();
  if (/firefox/.test(n)) return 'firefox';
  if (/edge|edg\b/.test(n)) return 'edge';
  if (/opera|opr\b/.test(n)) return 'opera';
  if (/brave/.test(n)) return 'brave';
  if (/vivaldi/.test(n)) return 'vivaldi';
  if (/\barc\b/.test(n)) return 'arc';
  if (/chromium/.test(n)) return 'chromium';
  if (/chrome/.test(n)) return 'chrome';
  if (/safari/.test(n)) return 'safari';
  return undefined;
}

/**
 * The browsers found here, in a stable order, with whether each is linked
 * and connected. A session that only says "Chrome" (some Chromium browsers
 * report themselves that way) counts for Chrome when Chrome is installed, or
 * for the only Chromium browser that is otherwise not connected.
 */
export function detectBrowsers(o: { platform: string; home: string; env?: Record<string, string | undefined>; exists: (p: string) => boolean; linked: (id: SetupBrowserId) => boolean; sessions: Pick<BrowserSession, 'browser'>[] }): DetectedBrowser[] {
  const env = o.env ?? {};
  const found = SETUP_BROWSERS.filter((b) => (b.id !== 'safari' || o.platform === 'darwin') && installMarkers(o.platform, o.home, env, b.id).some((p) => o.exists(p)));
  const connected = new Set<SetupBrowserId>();
  for (const s of o.sessions) {
    let id = sessionBrowserId(s.browser);
    if (id === 'chrome' && !found.some((b) => b.id === 'chrome')) {
      const other = found.filter((b) => b.engine === 'chromium' && !connected.has(b.id));
      if (other.length === 1) id = other[0].id;
    }
    if (id) connected.add(id);
  }
  return found.map((b) => ({ id: b.id, name: b.name, engine: b.engine, supported: b.engine !== 'webkit', linked: b.engine !== 'webkit' && o.linked(b.id), connected: connected.has(b.id) }));
}

/** The store page "Add to …" opens, when the extension is published there. */
export function storeListing(id: SetupBrowserId, listings = STORE_LISTINGS): string | undefined {
  const def = setupDef(id);
  if (!def) return undefined;
  if (def.engine === 'firefox') return listings.firefoxAddons || undefined;
  if (id === 'edge') return listings.edgeAddons || listings.chromeWebStore || undefined;
  if (def.engine === 'chromium') return listings.chromeWebStore || undefined;
  return undefined;
}

/** Commands that open `url` in that browser; the first that works is used. */
export function openInBrowser(platform: string, id: SetupBrowserId, url: string): { file: string; args: string[]; verbatim?: boolean; detached?: boolean }[] {
  const def = setupDef(id);
  if (!def) return [];
  // Only Keeper's own fixed pages and store addresses come here; anything else is refused.
  if (!/^(chrome|edge|brave|vivaldi|opera|arc|about):[\w/#-]*$|^https:\/\/[\w./?=&%-]+$/.test(url)) return [];
  if (platform === 'darwin') return [{ file: 'open', args: ['-a', def.mac, url] }];
  if (platform === 'win32') return def.win ? [{ file: 'cmd.exe', args: ['/d', '/c', 'start', '""', def.win, `"${url}"`], verbatim: true }] : [];
  // On Linux the browser itself is started (it may keep running), so it is left to run on its own.
  return (def.linux ?? []).map((b) => ({ file: b, args: [url], detached: true }));
}

/** Copy of the extension in a folder that is easy to pick in a file dialog (not inside the app). */
export function extensionCopyFolder(userData: string, engine: 'chromium' | 'firefox'): string {
  return j(userData, engine === 'firefox' ? 'browser-extension-firefox' : 'browser-extension');
}

/** The steps for adding the extension by hand, in plain words, for that browser. */
export function unpackedSteps(id: SetupBrowserId): { title: string; detail: string }[] {
  const def = setupDef(id);
  if (!def) return [];
  if (def.engine === 'firefox') {
    return [
      { title: 'Keeper opens Firefox’s add-on page', detail: `If it did not open, type ${def.page.split('#')[0]} in the address bar and choose “This Firefox”.` },
      { title: 'Click “Load Temporary Add-on…”', detail: 'It is near the top of the page.' },
      { title: 'Choose the manifest.json Keeper just showed you', detail: 'Keeper opened its folder and copied the path, so you can paste it in the file dialog. Firefox forgets add-ons loaded this way when it quits, until Keeper’s add-on is on Firefox Add-ons.' },
    ];
  }
  return [
    { title: `Keeper opens ${def.name}’s extensions page`, detail: `If it did not open, type ${def.page} in the address bar.` },
    { title: 'Turn on Developer mode', detail: id === 'opera' ? 'The switch is at the top right of the page.' : 'The switch is at the top right.' },
    { title: 'Click “Load unpacked” and choose the folder Keeper just showed you', detail: 'Keeper opened the folder and copied its path; in the file dialog you can paste it (on a Mac, press ⇧⌘G first).' },
  ];
}
