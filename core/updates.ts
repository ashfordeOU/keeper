// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Finding a newer Keeper on GitHub Releases and the right installer for this
// computer. Pure functions, shared by the app and its tests.

export interface GhAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface GhRelease {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at?: string | null;
  assets: GhAsset[];
}

/** How this copy of Keeper was installed, which decides how it can update. */
export type InstallKind = 'nsis' | 'portable' | 'mac' | 'appimage' | 'deb' | 'rpm' | 'tar' | 'source';

/** "v1.2.3-beta.2" -> [1, 2, 3, pre] ; returns null when it is not a version. */
export function parseVersion(v: string): { nums: number[]; pre: string } | null {
  const m = v.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] ?? '' };
}

/** Semantic-version comparison: 1 when a is newer, -1 when older, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1;
  // A release is newer than its own pre-releases.
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  const ap = x.pre.split('.');
  const bp = y.pre.split('.');
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === undefined) return -1;
    if (bp[i] === undefined) return 1;
    const an = /^\d+$/.test(ap[i]);
    const bn = /^\d+$/.test(bp[i]);
    if (an && bn && +ap[i] !== +bp[i]) return +ap[i] > +bp[i] ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    if (ap[i] !== bp[i]) return ap[i] > bp[i] ? 1 : -1;
  }
  return 0;
}

/**
 * Whether to offer pre-releases. A beta (a version with a hyphen, 1.2.0-beta.1)
 * follows the beta line unless the person turned betas off themselves;
 * `chosen` says the setting came from them rather than the default.
 */
export function wantsBeta(current: string, beta: boolean | undefined, chosen = false): boolean {
  if (chosen) return !!beta;
  return !!beta || current.includes('-');
}

/** The newest published release that is newer than `current` (pre-releases only when asked for). */
export function pickRelease(releases: GhRelease[], current: string, beta = false): GhRelease | undefined {
  return releases
    .filter((r) => !r.draft && (beta || !r.prerelease) && parseVersion(r.tag_name) && compareVersions(r.tag_name, current) > 0)
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
}

/** The release for exactly this version, for "What's new". */
export function releaseFor(releases: GhRelease[], version: string): GhRelease | undefined {
  return releases.find((r) => !r.draft && compareVersions(r.tag_name, version) === 0);
}

/**
 * The installer a person on this computer should download. File names follow
 * electron-builder.yml: Keeper-mac-arm64.dmg, Keeper-setup-x64.exe,
 * Keeper-linux-x86_64.AppImage, Keeper-linux-amd64.deb, Keeper-linux-x86_64.rpm …
 */
export function pickAsset(assets: GhAsset[], platform: string, arch: string, kind: InstallKind): GhAsset | undefined {
  const a = assets.filter((x) => !/\.(blockmap|yml|yaml|sig|sha256)$/i.test(x.name));
  const archRe = (() => {
    if (arch === 'arm64') return /(arm64|aarch64)/i;
    if (arch === 'ia32') return /(ia32|i386|x86(?!_64))/i;
    return /(x64|x86_64|amd64)/i;
  })();
  const byArch = (list: GhAsset[]) => list.find((x) => archRe.test(x.name)) ?? (list.length === 1 && !/(arm64|aarch64|x64|x86_64|amd64)/i.test(list[0].name) ? list[0] : undefined);
  const ext = (re: RegExp) => a.filter((x) => re.test(x.name));
  if (platform === 'darwin') return byArch(ext(/\.dmg$/i)) ?? byArch(ext(/-mac-.*\.zip$/i));
  if (platform === 'win32') {
    if (kind === 'portable') return ext(/portable.*\.exe$/i)[0];
    const setups = ext(/setup.*\.exe$/i);
    // Windows on ARM runs x64 installers when there is no native one.
    return byArch(setups) ?? (arch === 'arm64' ? setups.find((x) => /x64/i.test(x.name)) : undefined) ?? setups[0];
  }
  const map: Record<string, RegExp> = { appimage: /\.AppImage$/i, deb: /\.deb$/i, rpm: /\.rpm$/i, tar: /\.tar\.gz$/i };
  return byArch(ext(map[kind] ?? /\.AppImage$/i));
}

/** Release notes are Markdown; this keeps them readable as plain text where Markdown is not rendered. */
export function notesToText(md: string): string {
  return md
    .replace(/\r/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A few short lines from release notes, for a hover card: the first bullet
 * points (or sentences), plain text, each kept to one line.
 */
export function shortNotes(md: string, max = 4, width = 90): string[] {
  const text = (md ?? '').replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const clean = (s: string) =>
    s.replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2').replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\s*\(#\d+\)|\s+by @[\w-]+.*$|\s+in https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  const cut = (s: string) => (s.length > width ? s.slice(0, width - 1).replace(/\s+\S*$/, '') + '…' : s);
  const bullets = text.split('\n').filter((l) => /^\s*[-*•]\s+/.test(l)).map((l) => clean(l.replace(/^\s*[-*•]\s+/, ''))).filter(Boolean);
  if (bullets.length) return bullets.slice(0, max).map(cut);
  const sentences = clean(text.replace(/^#{1,6}.*$/gm, ' ')).split(/(?<=[.!?])\s+/).filter((s) => s.length > 3);
  return sentences.slice(0, max).map(cut);
}

export interface VersionNote {
  version: string;
  date?: string;
  url: string;
  /** a few short lines for a hover card */
  short: string[];
  prerelease: boolean;
}

/** Notes for every version newer than `current` (and `current` itself), newest first. */
export function versionNotes(releases: GhRelease[], current: string, beta = false, limit = 6): VersionNote[] {
  return releases
    .filter((r) => !r.draft && (beta || !r.prerelease) && parseVersion(r.tag_name) && compareVersions(r.tag_name, current) >= 0)
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))
    .slice(0, limit)
    .map((r) => ({ version: r.tag_name.replace(/^v/i, ''), date: r.published_at ?? undefined, url: r.html_url, short: shortNotes(r.body ?? ''), prerelease: r.prerelease }));
}

/** Where updates may come from: https, or http on this computer only (a test feed). */
export function feedAllowed(feed: string | undefined): boolean {
  if (!feed) return false;
  try {
    const u = new URL(feed);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}
