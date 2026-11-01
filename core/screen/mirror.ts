// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Phones on the computer's screen.
//
//   Android  scrcpy (Apache-2.0) with its own adb: mirror and control over USB
//            or Wi-Fi, drop files and apps in, clipboard both ways, record.
//            Downloaded on first use from the project's releases, checked
//            against the SHA-256 pinned here before it ever runs.
//   iPhone   iOS lets other devices *show* its screen through AirPlay, never
//            control it. A Mac has an AirPlay receiver built in (macOS 12+);
//            on Linux Keeper uses UxPlay (GPL-3.0, a separate program from the
//            system's package manager); on Windows UxPlay has to be installed by hand.

export const SCRCPY_VERSION = '5.0.1';

export interface PinnedFile {
  file: string;
  sha256: string;
  /** archive kind, for unpacking */
  kind: 'tar.gz' | 'zip';
}

/** From the release's published SHA-256 sums (github.com/Genymobile/scrcpy/releases/tag/v5.0.1). */
export const SCRCPY_FILES: Record<string, PinnedFile> = {
  'linux-x64': { file: `scrcpy-linux-x86_64-v${SCRCPY_VERSION}.tar.gz`, sha256: '9f969d30cc574816077edecda65719c1c70b0aee1df1ba5fa00779ac07b8fd6e', kind: 'tar.gz' },
  'darwin-arm64': { file: `scrcpy-macos-aarch64-v${SCRCPY_VERSION}.tar.gz`, sha256: '33611e51977a8289e2e124b220f727895181ef2eb9060e0987a4dc2db9cf0d6b', kind: 'tar.gz' },
  'darwin-x64': { file: `scrcpy-macos-x86_64-v${SCRCPY_VERSION}.tar.gz`, sha256: '31a5467a9e907f162b093267cbbab1276b15c6e709c2ea8159566a8d165beb50', kind: 'tar.gz' },
  'win32-x64': { file: `scrcpy-win64-v${SCRCPY_VERSION}.zip`, sha256: 'b12a2c4ee8be317422451fc7dcf8ee20a71b5ea7ef9ad73ddd825a25316227a5', kind: 'zip' },
  'win32-arm64': { file: `scrcpy-winarm64-v${SCRCPY_VERSION}.zip`, sha256: '16c3fc2068df64946f670e3504b4752073ebae47a416a45b46e79a5ab19c689b', kind: 'zip' },
  'win32-ia32': { file: `scrcpy-win32-v${SCRCPY_VERSION}.zip`, sha256: '0cb65ebf1bce892fa4d1502d699af0c7a1a7f24d7febcb9ef72894e3f23fc2ad', kind: 'zip' },
};

export function scrcpyDownload(platform: string, arch: string): (PinnedFile & { url: string }) | null {
  const f = SCRCPY_FILES[`${platform}-${arch}`];
  return f ? { ...f, url: `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/${f.file}` } : null;
}

/** Where there is no official build (Linux on ARM), the system's package is the way. */
export function scrcpyPackageHint(platform: string): string | null {
  if (platform === 'linux') return 'sudo apt install scrcpy   (or: sudo dnf install scrcpy, sudo pacman -S scrcpy)';
  if (platform === 'darwin') return 'brew install scrcpy';
  return null;
}

export interface AndroidDevice {
  serial: string;
  state: 'device' | 'unauthorized' | 'offline' | string;
  model?: string;
  product?: string;
  /** connected over Wi-Fi (adb over TCP) */
  wifi: boolean;
}

/** `adb devices -l` */
export function parseAdbDevices(out: string): AndroidDevice[] {
  const list: AndroidDevice[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim() || /^List of devices/.test(line) || line.startsWith('*')) continue;
    const m = line.match(/^(\S+)\s+(\S+)(.*)$/);
    if (!m) continue;
    const kv = Object.fromEntries([...m[3].matchAll(/(\w+):(\S+)/g)].map((x) => [x[1], x[2]]));
    list.push({ serial: m[1], state: m[2], model: kv.model?.replace(/_/g, ' '), product: kv.product, wifi: /:\d+$/.test(m[1]) || m[1].includes('._adb-tls-connect._tcp') });
  }
  return list;
}

export interface MirrorOptions {
  serial: string;
  title?: string;
  /** longest side in pixels, 0 = the phone's own */
  maxSize?: number;
  /** megabits per second */
  bitrateMbps?: number;
  maxFps?: number;
  viewOnly?: boolean;
  stayAwake?: boolean;
  screenOff?: boolean;
  /** save an .mp4 or .mkv while mirroring */
  record?: string;
  /** play the phone's sound on the computer (Android 11+) */
  audio?: boolean;
  /** use the phone's camera instead of its screen */
  camera?: 'back' | 'front';
}

/** scrcpy's command line. Numbers are bounded; the serial and paths are passed as separate arguments, never through a shell. */
export function scrcpyArgs(o: MirrorOptions): string[] {
  if (!/^[\w.:\-]+$/.test(o.serial)) throw new Error('That does not look like a phone serial');
  const a = ['--serial', o.serial, '--window-title', (o.title ?? 'Phone').slice(0, 80)];
  if (o.maxSize) a.push(`--max-size=${Math.max(320, Math.min(4096, Math.round(o.maxSize)))}`);
  if (o.bitrateMbps) a.push(`--video-bit-rate=${Math.max(1, Math.min(64, Math.round(o.bitrateMbps)))}M`);
  if (o.maxFps) a.push(`--max-fps=${Math.max(5, Math.min(120, Math.round(o.maxFps)))}`);
  if (o.viewOnly) a.push('--no-control');
  if (o.stayAwake && !o.viewOnly) a.push('--stay-awake');
  if (o.screenOff && !o.viewOnly) a.push('--turn-screen-off');
  if (o.record) a.push(`--record=${o.record}`);
  if (o.audio === false) a.push('--no-audio');
  if (o.camera) a.push('--video-source=camera', `--camera-facing=${o.camera}`);
  return a;
}

/** `adb pair <host:port> <code>` (Android 11+ wireless debugging) — checked so nothing odd reaches adb. */
export function adbPairArgs(hostPort: string, code: string): string[] {
  if (!/^[\w.\-]+:\d{2,5}$/.test(hostPort) && !/^\[[0-9a-f:]+\]:\d{2,5}$/i.test(hostPort)) throw new Error('Type the address and port shown on the phone, like 192.168.1.20:37123');
  if (!/^\d{6}$/.test(code)) throw new Error('The pairing code is the six digits shown on the phone');
  return ['pair', hostPort, code];
}

export function adbConnectArgs(hostPort: string): string[] {
  if (!/^[\w.\-]+:\d{2,5}$/.test(hostPort)) throw new Error('Type the address and port shown under Wireless debugging');
  return ['connect', hostPort];
}

/** Dropping files on a phone: apps are installed, everything else goes to Download. */
export function adbDropArgs(serial: string, file: string): string[] {
  return /\.apks?$/i.test(file) ? ['-s', serial, 'install', '-r', file] : ['-s', serial, 'push', file, '/sdcard/Download/'];
}

// ---------------------------------------------------------------- AirPlay (iPhone, iPad)

export interface AirPlayPlan {
  how: 'system' | 'uxplay' | 'install' | 'manual';
  detail: string;
  /** a command the person can run, or a settings link to open */
  command?: string;
  open?: string;
}

export function airplayPlan(platform: string, uxplayPath?: string | null, osRelease?: string): AirPlayPlan {
  if (platform === 'darwin') {
    const major = Number((osRelease ?? '').split('.')[0]) || 0;
    // macOS 12 Monterey is Darwin 21.
    if (major && major < 21) return { how: 'manual', detail: 'Showing an iPhone on this Mac needs macOS 12 or later.' };
    return { how: 'system', detail: 'Turn on AirPlay Receiver in System Settings → General → AirDrop & Handoff, then on the iPhone open Control Center → Screen Mirroring and pick this Mac.', open: 'x-apple.systempreferences:com.apple.AirDrop-Handoff-Settings.extension' };
  }
  if (platform === 'linux') {
    if (uxplayPath) return { how: 'uxplay', detail: 'Keeper starts an AirPlay receiver. On the iPhone open Control Center → Screen Mirroring and pick this computer. The iPhone can be watched, not controlled.' };
    return { how: 'install', detail: 'Install the free UxPlay receiver once (it is a separate program, GPL-3.0), then Keeper starts it for you.', command: 'sudo apt install uxplay   (Fedora: sudo dnf install uxplay, Arch: yay -S uxplay)' };
  }
  if (platform === 'win32') {
    if (uxplayPath) return { how: 'uxplay', detail: 'Keeper starts UxPlay. On the iPhone open Control Center → Screen Mirroring and pick this computer.' };
    return { how: 'manual', detail: 'Install UxPlay for Windows (with Bonjour) from its project page, then Keeper starts it for you. The iPhone can be watched, not controlled.', open: 'https://github.com/FDH2/UxPlay' };
  }
  return { how: 'manual', detail: 'Not available on this system.' };
}

/** UxPlay's command line: the name the iPhone shows, and a window title. */
export function uxplayArgs(name: string): string[] {
  const n = name.replace(/[^\w .'\-]/g, '').trim().slice(0, 40) || 'Keeper';
  // -nh: show exactly this name (no "@hostname" added).
  return ['-n', n, '-nh'];
}
