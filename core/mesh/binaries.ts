// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Which WireGuard implementation each system uses, where it comes from, and
// the SHA-256 that every download must match before it is used, exactly as
// for cloudflared (core/link/cloudflared.ts). A file that does not match is
// deleted and never run.
//
//   Linux    the kernel's WireGuard (ip link … type wireguard) with the system's wg tool;
//            without the kernel module, wireguard-go (MIT)
//   macOS    wireguard-go (MIT) on a utun interface, started by Keeper's helper as root
//   Windows  WireGuard for Windows (MIT), whose tunnel service uses WireGuardNT
//
// WireGuard is a registered trademark of Jason A. Donenfeld. Keeper is not
// made or endorsed by the WireGuard project.

export const WIREGUARD_WINDOWS_VERSION = '1.1.1';
export const WIREGUARD_GO_VERSION = '0.0.20250522';

export interface PinnedFile {
  url: string;
  sha256: string;
  /** how it is used */
  kind: 'msi' | 'source' | 'binary';
}

/**
 * WireGuard for Windows, the official signed installers from download.wireguard.com.
 * Keeper does not ship them: it downloads the one for this computer on first use,
 * checks the hash, and asks Windows to install it (one administrator prompt).
 */
export const WIREGUARD_WINDOWS: Record<string, PinnedFile> = {
  x64: { kind: 'msi', url: `https://download.wireguard.com/windows-client/wireguard-amd64-${WIREGUARD_WINDOWS_VERSION}.msi`, sha256: '7bfed60ad61b785c914b38b61555a975488e1d3ec472dbfb2fcdf498fca75242' },
  arm64: { kind: 'msi', url: `https://download.wireguard.com/windows-client/wireguard-arm64-${WIREGUARD_WINDOWS_VERSION}.msi`, sha256: '8336335c738d4aff040fa9d11b752da65a80b6f41d3262d6ba5e82f97ebd1bd4' },
  ia32: { kind: 'msi', url: `https://download.wireguard.com/windows-client/wireguard-x86-${WIREGUARD_WINDOWS_VERSION}.msi`, sha256: 'e3ec714fbfce3ba3a416671252e16cd71517a837a7ebd18b8c24b29a441e8724' },
};

/**
 * The embeddable alternatives, for a later build that drives WireGuardNT
 * directly (no separate WireGuard app). Pinned so the seam is ready; not used yet.
 * Their licence allows shipping them only next to software that uses them
 * through their published header (see MESH_NOTICES).
 */
export const WIREGUARD_NT = { kind: 'binary' as const, url: 'https://download.wireguard.com/wireguard-nt/wireguard-nt-1.1.zip', sha256: 'dceb30a9bc4be48cce0f74160fc88a585a2c2627366e8f846fc6658f9038dace' };
export const WINTUN = { kind: 'binary' as const, url: 'https://www.wintun.net/builds/wintun-0.14.1.zip', sha256: '07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51' };

/**
 * wireguard-go has no official binaries. Keeper's release workflow builds it
 * from this exact source snapshot (hash below) and attaches the results to
 * the Keeper release; their hashes are filled in here at release time. Until
 * a hash is pinned for this system, Keeper does not download one and uses a
 * system copy instead (the distribution's or Homebrew's package), or says
 * that WireGuard is missing.
 */
export const WIREGUARD_GO_SOURCE: PinnedFile = {
  kind: 'source',
  url: `https://git.zx2c4.com/wireguard-go/snapshot/wireguard-go-${WIREGUARD_GO_VERSION}.tar.xz`,
  sha256: 'c7eeffb13e5eb43b93e54a21d78dd71414771af9e07112da5275690493695c9c',
};

/**
 * The build is reproducible: from the pinned source with
 * `go build -trimpath -ldflags="-s -w -buildid="` (CGO off, the module
 * checksums in its go.sum) the same Go version gives the same bytes. This one
 * was made twice, separately, in Keeper's test machine; the release workflow
 * should get the same hash with the same Go and can pin it below.
 */
export const WIREGUARD_GO_LOCAL_BUILD = { target: 'linux-x64', go: 'go1.24.7', sha256: '0d9d9de75250cf7e2cd9d9169a6ac075e63f944082136603ccfc7d3a4c427ef3' };

export const WIREGUARD_GO_BUILDS: Record<string, PinnedFile | undefined> = {
  'darwin-arm64': undefined,
  'darwin-x64': undefined,
  'linux-x64': undefined,
  'linux-arm64': undefined,
};

/** System places a packaged wireguard-go or wg may live (owned by the administrator). */
export const SYSTEM_DIRS = ['/usr/bin', '/usr/sbin', '/usr/local/bin', '/usr/local/sbin', '/opt/homebrew/bin', '/run/current-system/sw/bin'];

export function wireguardWindows(arch: string): PinnedFile | null {
  return WIREGUARD_WINDOWS[arch] ?? null;
}

export function wireguardGoBuild(platform: string, arch: string): PinnedFile | null {
  const f = WIREGUARD_GO_BUILDS[`${platform}-${arch}`];
  return f && /^[0-9a-f]{64}$/.test(f.sha256) ? f : null;
}

/** Entries for THIRD-PARTY-NOTICES. */
export const MESH_NOTICES: { name: string; version: string; licence: string; source: string; shipped: string; note: string }[] = [
  {
    name: 'wireguard-go',
    version: WIREGUARD_GO_VERSION,
    licence: 'MIT (Copyright (C) 2017-2025 WireGuard LLC. All Rights Reserved.)',
    source: 'https://git.zx2c4.com/wireguard-go',
    shipped: 'Downloaded on first use (macOS, and Linux without the kernel module) from Keeper’s release, built from the pinned source snapshot; or a system package.',
    note: 'MIT: the copyright notice and permission notice must accompany copies. Include the full MIT text.',
  },
  {
    name: 'WireGuard for Windows',
    version: WIREGUARD_WINDOWS_VERSION,
    licence: 'MIT (the application); it installs WireGuardNT under its own prebuilt-binaries licence',
    source: 'https://git.zx2c4.com/wireguard-windows',
    shipped: 'Not shipped. Downloaded on first use from download.wireguard.com (official signed MSI), hash-checked, installed by Windows Installer.',
    note: 'Nothing redistributed by Keeper; the MSI is fetched from the official server on the user’s computer.',
  },
  {
    name: 'WireGuardNT (wireguard.dll)',
    version: '1.1',
    licence: 'WireGuard LLC Prebuilt Binaries License',
    source: 'https://git.zx2c4.com/wireguard-nt',
    shipped: 'Not shipped (comes with WireGuard for Windows). Pinned for a later embedded variant.',
    note: 'May be redistributed only alongside software that uses it solely through wireguard.h; no reverse engineering or modification; keep notices; do not use the WireGuard name to endorse.',
  },
  {
    name: 'Wintun (wintun.dll)',
    version: '0.14.1',
    licence: 'WireGuard LLC Prebuilt Binaries License',
    source: 'https://www.wintun.net',
    shipped: 'Not shipped. Pinned for a later embedded variant.',
    note: 'Same terms as WireGuardNT: redistribution only alongside software using it through wintun.h.',
  },
  {
    name: 'WireGuard (trademark)',
    version: '',
    licence: '“WireGuard” and the “WireGuard” logo are registered trademarks of Jason A. Donenfeld.',
    source: 'https://www.wireguard.com/trademark-policy/',
    shipped: '',
    note: 'Keeper says it “uses WireGuard”; it does not use the logo or suggest endorsement.',
  },
];
