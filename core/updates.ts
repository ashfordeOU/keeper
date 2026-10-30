// SPDX-License-Identifier: AGPL-3.0-or-later
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
