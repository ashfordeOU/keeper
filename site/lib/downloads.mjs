// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Download links that show Keeper's own address (keeper.ashforde.org/download/mac-arm64/) while
// the files stay on GitHub Releases. One list: site/build.mjs writes a small page for each that
// sends the browser on to the file, and site.js points the Download buttons at them.
// Pure: used by site.js in the browser, by the build and by test/site.test.ts.

export const REPO = 'ashfordeOU/keeper';

/** Every download address, the file it sends you to (as the release names it) and what it is. */
export const TARGETS = [
  { slug: 'mac-arm64', file: 'Keeper-mac-arm64.dmg', os: 'mac', label: 'Mac with Apple silicon' },
  { slug: 'mac-intel', file: 'Keeper-mac-x64.dmg', os: 'mac', label: 'Mac with Intel' },
  { slug: 'mac-arm64-full', file: 'Keeper-mac-arm64-full.dmg', os: 'mac', label: 'Mac with Apple silicon, everything inside' },
  { slug: 'mac-intel-full', file: 'Keeper-mac-x64-full.dmg', os: 'mac', label: 'Mac with Intel, everything inside' },
  { slug: 'windows', file: 'Keeper-setup-x64.exe', os: 'windows', label: 'Windows' },
  { slug: 'windows-full', file: 'Keeper-setup-x64-full.exe', os: 'windows', label: 'Windows, everything inside' },
  { slug: 'linux-x64', file: 'Keeper-linux-x86_64.AppImage', os: 'linux', label: 'Linux (x64 AppImage)' },
  { slug: 'linux-arm64', file: 'Keeper-linux-arm64.AppImage', os: 'linux', label: 'Linux (ARM64 AppImage)' },
  { slug: 'deb', file: 'Keeper-linux-amd64.deb', os: 'linux', label: 'Debian and Ubuntu (x64)' },
  { slug: 'rpm', file: 'Keeper-linux-x86_64.rpm', os: 'linux', label: 'Fedora and openSUSE (x64)' },
];

/** GitHub's address for a file of the newest full release (it skips pre-releases). */
export const latestUrl = (file) => `https://github.com/${REPO}/releases/latest/download/${file}`;

/** The download address for this computer, or null when Keeper has no file for it (a phone). */
export function targetFor(os, arch) {
  if (os === 'mac') return arch === 'x64' ? 'mac-intel' : 'mac-arm64';
  if (os === 'windows') return 'windows';
  if (os === 'linux') return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  return null;
}

export const target = (slug) => TARGETS.find((t) => t.slug === slug) ?? null;

/**
 * Where a file really is. Once a full release exists GitHub's "latest" address always works;
 * before that (only test builds, marked as pre-releases) the newest release that has the file,
 * or null when none has it yet. `list` is the release list, newest first: { pre, assets: [{ n, u }] }.
 */
export function fileUrl(list, file) {
  if (list.some((r) => !r.pre)) return latestUrl(file);
  for (const r of list) {
    const a = r.assets.find((x) => x.n === file);
    if (a) return a.u;
  }
  return null;
}

/** What to do once the file is down, in three short steps. */
export const NEXT_STEPS = {
  mac: ['Open the downloaded .dmg.', 'Drag Keeper to Applications.', 'Open Keeper from Applications.'],
  windows: ['Open the downloaded setup file.', 'Keeper installs and opens by itself.', 'Find it later in the Start menu.'],
  linux: ['Make the AppImage runnable: chmod +x.', 'Double-click it, or run it from a terminal.', 'Or use the .deb or .rpm instead.'],
};

/** A plain left click goes straight to the file; with a modifier key or another button the page opens. */
export const plainClick = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
