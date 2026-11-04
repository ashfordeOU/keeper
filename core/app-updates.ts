// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// App updates: which installed apps have a newer version, read from each app's
// own update feed (a Sparkle appcast on macOS) and from the package managers
// people already use (Homebrew, winget, Flatpak, Snap, apt, dnf), and how each
// one is updated. Keeper never repackages or mirrors anyone's app: an update
// runs through the package manager (which checks its own signatures) or opens
// the maker's own download after its signature has been checked.
// Pure: the main process (electron/services/app-updates.ts) runs the commands.

import type { Finding } from './guide/types';

export type UpdateSource = 'feed' | 'brew' | 'brewCask' | 'winget' | 'flatpak' | 'snap' | 'apt' | 'dnf';

export const SOURCE_LABEL: Record<UpdateSource, string> = {
  feed: 'From the maker',
  brew: 'Homebrew',
  brewCask: 'Homebrew',
  winget: 'winget',
  flatpak: 'Flatpak',
  snap: 'Snap',
  apt: 'System packages',
  dnf: 'System packages',
};

/** One command, never text typed by a person; `admin` runs it under one administrator prompt. */
export interface UpdateCmd { file: string; args: string[]; admin?: boolean }

export type UpdateAction =
  /** a package manager updates it */
  | { kind: 'run'; cmd: UpdateCmd }
  /** the maker's own download, checked against the app's signing key before it opens */
  | { kind: 'download'; url: string; edSignature: string; publicKey: string; length?: number }
  /** the maker's page or download, opened in the browser (no key to check it with) */
  | { kind: 'open'; url: string };

export interface AppUpdate {
  /** stable: source + package id */
  id: string;
  name: string;
  installed: string;
  latest: string;
  source: UpdateSource;
  /** the maker or the package says it fixes a security problem */
  security?: boolean;
  action: UpdateAction;
  /** what is new, on the maker's site */
  notes?: string;
  /** where the app is, when known */
  path?: string;
}

export interface UpdatesState {
  checkedAt: number;
  updates: AppUpdate[];
  /** system packages counted, not listed one by one (hundreds of libraries) */
  system?: { count: number; security: number; manager: 'apt' | 'dnf' };
  /** what could not be checked, in plain words */
  notes: string[];
  /** apps from the App Store, which update only there */
  storeApps: number;
}

export const emptyUpdates = (): UpdatesState => ({ checkedAt: 0, updates: [], notes: [], storeApps: 0 });

// ---------------------------------------------------------------- versions

const parts = (v: string) => {
  const [main, pre] = v.trim().replace(/^v(?=\d)/i, '').split(/[-+~]/, 2);
  return { nums: main.split(/[._]/).map((p) => p.match(/^\d+/)?.[0]).map((n) => (n === undefined ? -1 : Number(n))), pre: pre ?? '' };
};

/** Compares two version strings: negative when a is older, 0 when equal, positive when newer. Pre-releases come before the release. */
export function compareVersions(a: string, b: string): number {
  if (a.trim() === b.trim()) return 0;
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (x.pre && !y.pre) return -1;
  if (!x.pre && y.pre) return 1;
  return x.pre.localeCompare(y.pre, 'en', { numeric: true });
}

// ---------------------------------------------------------------- Sparkle appcasts (macOS)

export interface AppcastItem {
  /** the build number Sparkle compares (CFBundleVersion) */
  version: string;
  /** the version people see (CFBundleShortVersionString) */
  shortVersion?: string;
  url?: string;
  length?: number;
  edSignature?: string;
  notes?: string;
  minimumSystemVersion?: string;
  critical: boolean;
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name.replace(':', '\\:')}\\s*=\\s*"([^"]*)"`))?.[1] ?? tag.match(new RegExp(`\\b${name.replace(':', '\\:')}\\s*=\\s*'([^']*)'`))?.[1];
const el = (block: string, name: string) => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${name}>`))?.[1]?.trim();
const unescape = (s: string | undefined) => s?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/**
 * The newest usable item of a Sparkle appcast: items on a channel (betas) and
 * deltas are left out, and so are items for another system. No XML library:
 * appcasts are small and regular.
 */
export function parseAppcast(xml: string): AppcastItem | null {
  const items: AppcastItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    if (/<sparkle:channel>/.test(b)) continue;
    const enc = b.match(/<enclosure\b[^>]*>/)?.[0] ?? '';
    const os = attr(enc, 'sparkle:os');
    if (os && os !== 'macos') continue;
    const version = el(b, 'sparkle:version') ?? attr(enc, 'sparkle:version');
    if (!version) continue;
    const len = Number(attr(enc, 'length'));
    items.push({
      version,
      shortVersion: el(b, 'sparkle:shortVersionString') ?? attr(enc, 'sparkle:shortVersionString'),
      url: unescape(attr(enc, 'url')),
      length: Number.isFinite(len) && len > 0 ? len : undefined,
      edSignature: attr(enc, 'sparkle:edSignature'),
      notes: unescape(el(b, 'sparkle:releaseNotesLink') ?? el(b, 'sparkle:fullReleaseNotesLink') ?? undefined),
      minimumSystemVersion: el(b, 'sparkle:minimumSystemVersion'),
      critical: /<sparkle:criticalUpdate\b/.test(b) || /<sparkle:tags>[\s\S]*?<sparkle:criticalUpdate/.test(b),
    });
  }
  if (!items.length) return null;
  return items.sort((a, b) => compareVersions(b.version, a.version))[0];
}

/** Whether this Mac's system version is new enough for an item ("13.0" ≤ "14.5"). */
export const systemFits = (item: AppcastItem, macVersion: string | undefined) => !item.minimumSystemVersion || !macVersion || compareVersions(macVersion, item.minimumSystemVersion) >= 0;

/** Only https feeds and downloads: a plain http feed could be changed on the way. */
export const safeUrl = (u: string | undefined): u is string => {
  if (!u) return false;
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
};

/** An installed app with its own update feed (from its Info.plist). */
export interface FeedApp { id: string; name: string; path: string; version?: string; build?: string; feedUrl: string; publicKey?: string }

/** The update a feed offers an installed app, or null when it is up to date or the feed cannot be trusted. */
export function feedUpdate(app: FeedApp, item: AppcastItem | null, macVersion?: string): AppUpdate | null {
  if (!item || !systemFits(item, macVersion)) return null;
  // Sparkle compares build numbers; fall back to the visible version when the app has none.
  const mine = app.build ?? app.version;
  if (!mine || compareVersions(item.version, mine) <= 0) return null;
  if (item.shortVersion && app.version && compareVersions(item.shortVersion, app.version) < 0) return null;
  const action: UpdateAction | null = safeUrl(item.url) && app.publicKey && item.edSignature
    ? { kind: 'download', url: item.url, edSignature: item.edSignature, publicKey: app.publicKey, length: item.length }
    : safeUrl(item.notes) ? { kind: 'open', url: item.notes } : safeUrl(item.url) ? { kind: 'open', url: item.url } : null;
  if (!action) return null;
  return { id: `feed:${app.id}`, name: app.name, installed: app.version ?? mine, latest: item.shortVersion ?? item.version, source: 'feed', security: item.critical || undefined, action, notes: safeUrl(item.notes) ? item.notes : undefined, path: app.path };
}

/** Keeper and the other Ashforde apps update themselves (Settings → Updates and Ashforde apps). */
export const ownApp = (bundleId: string) => /^(io\.github\.ashfordeou\.|org\.ashforde\.)/i.test(bundleId);

// ---------------------------------------------------------------- package managers

const safeId = (s: string) => /^[\w@+.:/-]{1,200}$/.test(s) && !s.startsWith('-');

/** `brew outdated --json=v2`: formulae and casks (casks that update themselves are left out unless asked). */
export function parseBrewOutdated(json: string): AppUpdate[] {
  let raw: { formulae?: { name: string; installed_versions?: string[]; current_version?: string }[]; casks?: { name: string; installed_versions?: string[] | string; current_version?: string }[] };
  try { raw = JSON.parse(json); } catch { return []; }
  const out: AppUpdate[] = [];
  for (const c of raw.casks ?? []) {
    if (!safeId(c.name) || !c.current_version) continue;
    const inst = Array.isArray(c.installed_versions) ? c.installed_versions.at(-1) : c.installed_versions;
    out.push({ id: `brewCask:${c.name}`, name: c.name, installed: inst ?? '?', latest: c.current_version, source: 'brewCask', action: { kind: 'run', cmd: { file: 'brew', args: ['upgrade', '--cask', c.name] } } });
  }
  for (const f of raw.formulae ?? []) {
    if (!safeId(f.name) || !f.current_version) continue;
    out.push({ id: `brew:${f.name}`, name: f.name, installed: f.installed_versions?.at(-1) ?? '?', latest: f.current_version, source: 'brew', action: { kind: 'run', cmd: { file: 'brew', args: ['upgrade', f.name] } } });
  }
  return out;
}

/**
 * `winget upgrade`: a table whose columns are found from the header line above
 * the dashes (Name, Id, Version, Available, Source). The table ends at the
 * first empty line ("3 upgrades available." and any second table follow).
 */
export function parseWingetUpgrade(text: string): AppUpdate[] {
  const lines = text.split(/\r\n|\n|\r/);
  const sep = lines.findIndex((l) => /^-{10,}$/.test(l.trim()));
  if (sep < 1) return [];
  const starts = [...lines[sep - 1].matchAll(/\S+/g)].map((m) => m.index ?? 0);
  if (starts.length < 4) return [];
  const out: AppUpdate[] = [];
  for (const line of lines.slice(sep + 1)) {
    if (!line.trim()) break;
    let [name, id, installed, latest] = starts.map((s, i) => line.slice(s, starts[i + 1]).trim());
    // Characters wider than one column (some names) shift the cells: read from the right instead.
    if (!safeId(id ?? '') || !latest || /\s/.test(latest)) {
      const t = line.trim().split(/\s+/);
      const right = starts.length >= 5 ? 1 : 0;
      if (t.length < 4 + right) continue;
      latest = t[t.length - 1 - right];
      installed = t[t.length - 2 - right];
      id = t[t.length - 3 - right];
      name = t.slice(0, t.length - 3 - right).join(' ');
    }
    if (!safeId(id)) continue;
    out.push({ id: `winget:${id}`, name: name.replace(/…$/, '').trim() || id, installed: /^unknown$/i.test(installed) ? '?' : installed.replace(/^<\s*/, ''), latest, source: 'winget', action: { kind: 'run', cmd: { file: 'winget', args: ['upgrade', '--id', id, '--exact', '--silent', '--accept-source-agreements', '--accept-package-agreements'] } } });
  }
  return out;
}

/** `flatpak list --app --columns=application,version` and `flatpak remote-ls --updates --app --columns=application,version,name`. */
export function parseFlatpakUpdates(installed: string, updates: string): AppUpdate[] {
  const have = new Map<string, string>();
  for (const l of installed.split('\n')) {
    const [id, v] = l.split('\t');
    if (id?.trim()) have.set(id.trim(), (v ?? '').trim());
  }
  const out: AppUpdate[] = [];
  for (const l of updates.split('\n')) {
    const [id, v, name] = l.split('\t').map((x) => (x ?? '').trim());
    if (!id || !safeId(id) || !have.has(id)) continue;
    out.push({ id: `flatpak:${id}`, name: name || id, installed: have.get(id) || '?', latest: v || 'newer', source: 'flatpak', action: { kind: 'run', cmd: { file: 'flatpak', args: ['update', '-y', '--noninteractive', id] } } });
  }
  return out;
}

/** `snap refresh --list`: "Name Version Rev Size Publisher Notes"; the installed version comes from `snap list`. */
export function parseSnapRefresh(list: string, installed = ''): AppUpdate[] {
  const have = new Map<string, string>();
  for (const l of installed.split('\n').slice(1)) {
    const [n, v] = l.trim().split(/\s+/);
    if (n) have.set(n, v ?? '');
  }
  const out: AppUpdate[] = [];
  for (const l of list.split('\n').slice(1)) {
    const [name, version] = l.trim().split(/\s+/);
    if (!name || !safeId(name) || !version) continue;
    out.push({ id: `snap:${name}`, name, installed: have.get(name) || '?', latest: version, source: 'snap', action: { kind: 'run', cmd: { file: 'snap', args: ['refresh', name], admin: true } } });
  }
  return out;
}

/** `apt list --upgradable`: "name/suite version arch [upgradable from: old]"; security when the suite is a security one. */
export function parseAptUpgradable(text: string): { name: string; latest: string; installed: string; security: boolean }[] {
  const out: { name: string; latest: string; installed: string; security: boolean }[] = [];
  for (const l of text.split('\n')) {
    const m = l.match(/^([\w.+-]+)\/(\S+)\s+(\S+)\s+\S+\s+\[[^:\]]*:\s*([^\]\s]+)\]/);
    if (m) out.push({ name: m[1], latest: m[3], installed: m[4], security: /security/i.test(m[2]) });
  }
  return out;
}

/** `dnf check-update` (exit 100 when there are updates): "name.arch version repo". `dnf updateinfo list --security` names the security ones. */
export function parseDnfCheckUpdate(text: string, securityList = ''): { name: string; latest: string; security: boolean }[] {
  const sec = new Set([...securityList.matchAll(/^\S+\s+\S+\s+(\S+?)-\d[^\s]*\s*$/gm)].map((m) => m[1].replace(/\.[^.]+$/, '')));
  const out: { name: string; latest: string; security: boolean }[] = [];
  for (const l of text.split('\n')) {
    if (/^(Obsoleting|Last metadata|Security:)/.test(l)) break;
    const m = l.match(/^([\w.+-]+)\.(x86_64|aarch64|noarch|i686|armv7hl|ppc64le|s390x)\s+(\S+)\s+\S+\s*$/);
    if (m) out.push({ name: m[1], latest: m[3], security: sec.has(m[1]) });
  }
  return out;
}

// ---------------------------------------------------------------- one list

/** The same app found twice (its feed and Homebrew): the package manager wins, since it also keeps its record straight. */
export function mergeUpdates(lists: AppUpdate[][]): AppUpdate[] {
  const seen = new Map<string, AppUpdate>();
  const key = (u: AppUpdate) => u.name.toLowerCase().replace(/\.app$/, '').replace(/[^a-z0-9]/g, '');
  for (const u of lists.flat()) {
    const k = key(u);
    const prev = seen.get(k);
    if (!prev || (prev.source === 'feed' && u.source !== 'feed')) seen.set(k, prev?.security ? { ...u, security: true } : u);
  }
  return [...seen.values()].sort((a, b) => Number(!!b.security) - Number(!!a.security) || a.name.localeCompare(b.name));
}

/** Counts for the page and the Fix-it List. */
export function updateCounts(s: UpdatesState): { apps: number; security: number; system: number } {
  return { apps: s.updates.length, security: s.updates.filter((u) => u.security).length + (s.system?.security ?? 0), system: s.system?.count ?? 0 };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One calm Fix-it row: security updates first ("3 apps have security updates"), else all of them. */
export function appUpdateFindings(s: UpdatesState): Finding[] {
  const c = updateCounts(s);
  if (!c.apps && !c.system) return [];
  const sec = s.updates.filter((u) => u.security).length;
  const title = sec
    ? `${plural(sec, 'app has', 'apps have')} security updates`
    : c.apps ? `${plural(c.apps, 'app has', 'apps have')} updates` : `${plural(c.system, 'system update')} waiting`;
  return [{
    id: 'updates:apps', source: 'appUpdates', area: 'updates', severity: sec || s.system?.security ? 'medium' : 'low',
    title,
    why: 'Updates fix problems, and security updates close holes that others could use.',
    detail: s.updates.slice(0, 5).map((u) => u.name).join(', ') || undefined,
    fix: { kind: 'page', route: { name: 'apps', arg: 'updates' }, label: 'See updates' },
  }];
}

/** Whether a stored check is old enough to look again. */
export const checkDue = (checkedAt: number, everyHours: number, now = Date.now()) => now - checkedAt >= everyHours * 3600_000;

// ---------------------------------------------------------------- settings

export interface AppUpdateSettings {
  /** look on its own once a day (or every `everyHours`); off checks only when asked */
  auto: boolean;
  everyHours: number;
  /** also list apps that keep themselves up to date (Homebrew's "auto-updates" casks) */
  selfUpdating: boolean;
}

export const defaultAppUpdateSettings = (): AppUpdateSettings => ({ auto: true, everyHours: 24, selfUpdating: false });

export function normalizeAppUpdateSettings(o: Partial<AppUpdateSettings> | undefined): AppUpdateSettings {
  const d = defaultAppUpdateSettings();
  const v = { ...d, ...(o && typeof o === 'object' ? o : {}) };
  return { auto: v.auto !== false, everyHours: [6, 24, 168].includes(Number(v.everyHours)) ? Number(v.everyHours) : d.everyHours, selfUpdating: v.selfUpdating === true };
}
