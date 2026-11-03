// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Components: the heavy, optional parts of Keeper (ffmpeg, ONNX Runtime, rclone)
// that the standard ("core") installer leaves out and Keeper downloads when a
// feature that needs one is switched on. The "offline" installer (…-full) has
// them all inside. See docs/COMPONENTS.md.
//
// Each release carries, per platform and processor:
//   components-<platform>-<arch>.json                 the manifest (below)
//   keeper-component-<name>-<platform>-<arch>.tar.gz  one archive per component
// and SHA256SUMS.txt lists them all, so the release's Sigstore signature covers them.
// A component is only ever used with the Keeper version it was built with.
//
// Pure functions and data: shared by the main process, the interface and tests.

import layout from './component-layout.json';
import { DEVELOPER_ID_SIGNER } from './update-verify';

export type ComponentId = 'ffmpeg' | 'onnxruntime' | 'rclone';

export interface ComponentUse {
  feature: string;
  /** the feature works without it, except for this part */
  partly?: string;
}

export interface ComponentDef {
  id: ComponentId;
  name: string;
  description: string;
  /** features that need it */
  uses: ComponentUse[];
  /** rough download and installed size (MB) before the manifest is read; by "platform-arch", then "*" */
  approxMb: Record<string, [download: number, disk: number]>;
  /** the "Check" command that proves it runs */
  check: string[];
}

export const COMPONENTS: ComponentDef[] = [
  {
    id: 'ffmpeg',
    name: 'Video and audio engine (ffmpeg)',
    description: 'Records the screen and meetings, converts video and sound, reads speech for transcription and saves downloaded videos.',
    uses: [
      { feature: 'studio' },
      { feature: 'capture', partly: 'screen recording' },
      { feature: 'meetings' },
      { feature: 'dictation', partly: 'reading sound files' },
      { feature: 'speechModel' },
      { feature: 'videoDownload' },
      { feature: 'convert', partly: 'video and audio' },
    ],
    approxMb: { 'darwin-arm64': [19, 44], 'darwin-x64': [21, 48], 'linux-x64': [30, 77], 'linux-arm64': [26, 66], 'win32-x64': [33, 90], '*': [30, 77] },
    check: ['-hide_banner', '-version'],
  },
  {
    id: 'onnxruntime',
    name: 'On-device AI models (ONNX Runtime)',
    description: 'Runs background removal, face finding, the built-in speech model and search by meaning on this computer.',
    uses: [
      { feature: 'speechModel' },
      { feature: 'semantic' },
      { feature: 'faces' },
      { feature: 'convert', partly: 'background removal' },
      { feature: 'dictation', partly: 'the built-in speech model' },
      { feature: 'meetings', partly: 'the built-in speech model' },
    ],
    approxMb: { 'darwin-arm64': [13, 45], 'linux-x64': [18, 46], 'linux-arm64': [16, 40], 'win32-x64': [16, 40], '*': [18, 46] },
    check: [],
  },
  {
    id: 'rclone',
    name: 'Cloud storage connector (rclone)',
    description: 'Connects Google Drive, Dropbox, OneDrive, S3 and 70 other cloud services. Servers (SFTP, FTP, WebDAV, SMB) work without it.',
    uses: [
      { feature: 'remote', partly: 'cloud services' },
      { feature: 'sync', partly: 'cloud mirrors' },
    ],
    approxMb: { 'darwin-arm64': [31, 88], 'darwin-x64': [32, 92], 'linux-x64': [30, 85], 'linux-arm64': [28, 80], 'win32-x64': [31, 88], '*': [30, 85] },
    check: ['version'],
  },
];

export const componentDef = (id: string) => COMPONENTS.find((c) => c.id === id);
export const isComponentId = (id: string): id is ComponentId => COMPONENTS.some((c) => c.id === id);

// ---------------------------------------------------------------- layout (shared with scripts/components.mjs)

export interface LayoutFile { from: 'unpacked' | 'resources' | 'modules'; path: string; to: string; strip?: boolean; optional?: boolean }
export interface LayoutEntry { id: ComponentId; probe: string; files: LayoutFile[]; unavailable?: string[] }
export const LAYOUT = (layout as unknown as { components: LayoutEntry[] }).components;

/** `${exe}`, `${platform}` and `${arch}` filled in. */
export function expand(p: string, platform: string, arch: string): string {
  return p.replace(/\$\{exe\}/g, platform === 'win32' ? '.exe' : '').replace(/\$\{platform\}/g, platform).replace(/\$\{arch\}/g, arch);
}

/** Whether a component is built for this system at all (ONNX Runtime has no Intel Mac build). */
export function componentAvailable(id: ComponentId, platform: string, arch: string): boolean {
  const l = LAYOUT.find((x) => x.id === id);
  return !!l && !(l.unavailable ?? []).includes(`${platform}-${arch}`);
}

/** The file a component is found by, relative to its folder (the program, or the native library). */
export function probePath(id: ComponentId, platform: string, arch: string): string {
  const l = LAYOUT.find((x) => x.id === id);
  if (!l) throw new Error(`Unknown component ${id}`);
  return expand(l.probe, platform, arch);
}

// ---------------------------------------------------------------- features → components

/**
 * The components the given features need. `partly: false` leaves out the ones a
 * feature only needs for one part (Convert works on pictures without ffmpeg).
 */
export function componentsFor(featureIds: string[], o: { partly?: boolean; platform?: string; arch?: string } = {}): ComponentId[] {
  const want = new Set(featureIds);
  return COMPONENTS.filter((c) => c.uses.some((u) => want.has(u.feature) && (o.partly !== false || !u.partly)))
    .filter((c) => !o.platform || !o.arch || componentAvailable(c.id, o.platform, o.arch))
    .map((c) => c.id);
}

/** What a feature needs from each component, for its row in Settings → Features. */
export function featureNeeds(featureId: string): { id: ComponentId; partly?: string }[] {
  const out: { id: ComponentId; partly?: string }[] = [];
  for (const c of COMPONENTS) for (const u of c.uses) if (u.feature === featureId) out.push({ id: c.id, partly: u.partly });
  return out;
}

// ---------------------------------------------------------------- release assets and the manifest

export const MANIFEST_SCHEMA = 1;
export const componentAsset = (id: string, platform: string, arch: string) => `keeper-component-${id}-${platform}-${arch}.tar.gz`;
export const manifestAsset = (platform: string, arch: string) => `components-${platform}-${arch}.json`;
export const isComponentAsset = (name: string) => /^keeper-component-|^components-[a-z0-9]+-[a-z0-9]+\.json$/i.test(name);

/** Where a version's assets are: its GitHub release, or `<feed>/v<version>` (a mirror, or a local server in tests). */
export function releaseBase(version: string, feed?: string): string {
  const v = `v${version.replace(/^v/i, '')}`;
  return feed ? `${feed.replace(/\/+$/, '')}/${v}` : `https://github.com/ashfordeOU/keeper/releases/download/${v}`;
}

export interface ManifestFile {
  /** relative to the component's folder, with forward slashes */
  path: string;
  size: number;
  sha256: string;
  /** octal permission bits, e.g. 0o755 */
  mode: number;
  /** a symbolic link to this (relative) target instead of a file */
  link?: string;
}

export interface ManifestEntry {
  name: ComponentId;
  /** always the Keeper version it was built with */
  version: string;
  /** the archive's release asset name */
  file: string;
  sha256: string;
  /** bytes to download */
  size: number;
  /** bytes once unpacked */
  unpackedSize: number;
  /** the features that use it (informational; the app's own table decides) */
  features: string[];
  files: ManifestFile[];
}

export interface ComponentManifest {
  schema: number;
  version: string;
  platform: string;
  arch: string;
  components: ManifestEntry[];
}

const HEX64 = /^[0-9a-f]{64}$/;

/** A safe relative path: no absolute paths, no "..", no backslashes, no empty parts. */
export function safeRelative(p: string): boolean {
  if (typeof p !== 'string' || !p || p.startsWith('/') || p.includes('\\') || /^[a-zA-Z]:/.test(p) || p.includes('\0')) return false;
  return p.split('/').every((s) => s && s !== '..' && s !== '.');
}

/** Reads and checks a manifest; throws with a plain reason when anything is off. */
export function parseManifest(text: string): ComponentManifest {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('The component list is not valid JSON');
  }
  const m = j as Partial<ComponentManifest>;
  if (!m || typeof m !== 'object') throw new Error('The component list is empty');
  if (m.schema !== MANIFEST_SCHEMA) throw new Error(`The component list has format ${String(m.schema)}; this Keeper reads format ${MANIFEST_SCHEMA}`);
  if (typeof m.version !== 'string' || typeof m.platform !== 'string' || typeof m.arch !== 'string' || !Array.isArray(m.components)) throw new Error('The component list is missing its version, system or components');
  for (const c of m.components) {
    const bad = (why: string) => new Error(`The component list's entry for ${String(c?.name)} ${why}`);
    if (!c || !isComponentId(c.name)) throw bad('names an unknown component');
    if (c.version !== m.version) throw bad(`is for Keeper ${c.version}, not ${m.version}`);
    if (c.file !== componentAsset(c.name, m.platform, m.arch)) throw bad(`points at ${c.file}`);
    if (!HEX64.test(c.sha256)) throw bad('has no valid checksum');
    if (!Number.isSafeInteger(c.size) || c.size <= 0 || !Number.isSafeInteger(c.unpackedSize) || c.unpackedSize <= 0) throw bad('has no valid size');
    if (!Array.isArray(c.files) || !c.files.length) throw bad('lists no files');
    for (const f of c.files) {
      if (!safeRelative(f.path)) throw bad(`has an unsafe path (${String(f.path)})`);
      if (f.link !== undefined) {
        if (typeof f.link !== 'string' || !safeRelative(joinRel(dirOf(f.path), f.link))) throw bad(`has a link that leaves its folder (${f.path})`);
      } else if (!HEX64.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0) throw bad(`has no valid checksum for ${f.path}`);
      if (!Number.isInteger(f.mode) || f.mode < 0 || f.mode > 0o777) throw bad(`has an invalid mode for ${f.path}`);
    }
    if (!Array.isArray(c.features)) c.features = [];
  }
  return m as ComponentManifest;
}

const dirOf = (p: string) => p.split('/').slice(0, -1).join('/');
/** Joins and normalises relative paths; '' when it climbs above the start. */
export function joinRel(base: string, rel: string): string {
  const out: string[] = [];
  for (const s of `${base}/${rel}`.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') {
      if (!out.length) return '';
      out.pop();
    } else out.push(s);
  }
  return out.join('/');
}

/** Why a manifest cannot be used by this copy of Keeper, or null when it can. Versions must match exactly. */
export function manifestProblem(m: ComponentManifest, appVersion: string, platform: string, arch: string): string | null {
  const v = appVersion.replace(/^v/i, '');
  if (m.version.replace(/^v/i, '') !== v) return `The components are for Keeper ${m.version}, but this is Keeper ${v}`;
  if (m.platform !== platform || m.arch !== arch) return `The components are for ${m.platform}-${m.arch}, not ${platform}-${arch}`;
  return null;
}

/** An installed component can only be used by the exact Keeper version it came with. */
export const versionMatches = (installed: string | undefined, appVersion: string) => !!installed && installed.replace(/^v/i, '') === appVersion.replace(/^v/i, '');

// ---------------------------------------------------------------- state, as the interface sees it

export type ComponentState =
  /** inside this installer (the offline one, or a copy from before components) */
  | 'bundled'
  /** downloaded for this version */
  | 'installed'
  /** a development copy (node_modules, vendor/) */
  | 'dev'
  | 'missing'
  /** an older version is on disk; the new one is not downloaded yet */
  | 'outdated'
  | 'downloading'
  | 'verifying'
  | 'error'
  /** no build for this system */
  | 'unavailable';

export interface ComponentInfo {
  id: ComponentId;
  name: string;
  description: string;
  state: ComponentState;
  /** the version on disk (installed or outdated) */
  version?: string;
  /** bytes to download (from the manifest, else an estimate) */
  downloadSize: number;
  /** true when downloadSize is an estimate */
  estimate: boolean;
  /** bytes it takes on disk now (0 when missing; bundled ones count toward the app) */
  sizeOnDisk: number;
  /** 0–1 while downloading */
  progress?: number;
  /** what went wrong (offline, checksum, signature…) */
  error?: string;
  /** the last error was being offline: it retries by itself when the network is back */
  offline?: boolean;
  /** features switched on that need it */
  neededBy: string[];
}

export const usable = (s: ComponentState) => s === 'bundled' || s === 'installed' || s === 'dev';

export function approxSize(id: ComponentId, platform: string, arch: string): { download: number; disk: number } {
  const d = componentDef(id);
  const [dl, disk] = d?.approxMb[`${platform}-${arch}`] ?? d?.approxMb['*'] ?? [0, 0];
  return { download: dl * 1e6, disk: disk * 1e6 };
}

export function formatBytes(n: number): string {
  if (!n || n < 0) return '0 MB';
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  if (n < 1e9) return `${Math.round(n / 1e6)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

/** "Download Video and audio engine (ffmpeg) (30 MB)" — the button on a feature that needs it. */
export function downloadLabel(c: Pick<ComponentInfo, 'name' | 'downloadSize' | 'estimate'>): string {
  return `Download ${c.name} (${c.estimate ? 'about ' : ''}${formatBytes(c.downloadSize)})`;
}

/** The components a switched-on feature still waits for. */
export function missingFor(featureId: string, infos: ComponentInfo[]): (ComponentInfo & { partly?: string })[] {
  return featureNeeds(featureId)
    .map((n) => ({ ...infos.find((i) => i.id === n.id)!, partly: n.partly }))
    .filter((i) => i.id && !usable(i.state) && i.state !== 'unavailable');
}

/** What "Download everything for offline use" would fetch. */
export function offlineTotal(infos: ComponentInfo[]): { ids: ComponentId[]; bytes: number } {
  const todo = infos.filter((i) => !usable(i.state) && i.state !== 'unavailable');
  return { ids: todo.map((i) => i.id), bytes: todo.reduce((n, i) => n + i.downloadSize, 0) };
}

/**
 * What to fetch by itself, in the background, without the person asking:
 * nothing on a fresh install (the welcome tour's preset or the first use asks),
 * and after an update the components of switched-on features (the new version
 * needs its own copy; an update from a build with everything inside has none yet).
 */
export function backgroundPlan(o: { previousVersion?: string; currentVersion: string; onFeatures: string[]; infos: ComponentInfo[]; platform: string; arch: string }): ComponentId[] {
  const updated = !!o.previousVersion && o.previousVersion.replace(/^v/i, '') !== o.currentVersion.replace(/^v/i, '');
  const wanted = new Set(componentsFor(o.onFeatures, { platform: o.platform, arch: o.arch }));
  return o.infos
    .filter((i) => wanted.has(i.id))
    // An older copy on disk always follows the app; otherwise only right after an update.
    .filter((i) => i.state === 'outdated' || (updated && (i.state === 'missing' || i.state === 'error')))
    .map((i) => i.id);
}

// ---------------------------------------------------------------- add-on apps (Monorail) next to the components

export interface AddonStatusLike {
  supported: boolean;
  unsupportedReason?: string;
  installed: boolean;
  version?: string;
  update?: { version: string };
  busy?: { step: string; progress?: number };
  error?: string;
  running?: boolean;
}

export type AddonAction = 'install' | 'update' | 'open' | 'uninstall';

export interface AddonRow {
  id: string;
  /** shown at all (Monorail: on a Mac only) */
  visible: boolean;
  /** the short note shown where it is hidden */
  note?: string;
  installed: boolean;
  version?: string;
  latest?: string;
  actions: AddonAction[];
  busy?: { step: string; progress?: number };
  error?: string;
  /** "Installed 1.2.0 · 1.3.0 available" */
  line: string;
}

/** The add-on row's state from Monorail's status, for the components list. */
export function addonRow(id: string, platform: string, s: AddonStatusLike | null | undefined, offeredPlatforms: string[] = ['darwin']): AddonRow {
  if (!offeredPlatforms.includes(platform)) return { id, visible: false, note: 'Monorail runs on macOS; it is not offered here.', installed: false, actions: [], line: '' };
  if (!s) return { id, visible: true, installed: false, actions: [], line: 'Checking…' };
  if (!s.supported) return { id, visible: true, note: s.unsupportedReason, installed: false, actions: [], line: s.unsupportedReason ?? 'Not supported on this Mac' };
  const latest = s.update?.version ?? (s.installed ? s.version : undefined);
  const actions: AddonAction[] = s.busy ? [] : s.installed ? [...(s.update ? (['update'] as const) : []), 'open', 'uninstall'] : ['install'];
  const line = s.busy ? `${s.busy.step}${s.busy.progress !== undefined ? ` ${Math.round(s.busy.progress * 100)}%` : '…'}`
    : s.installed ? `Installed ${s.version ?? ''}`.trim() + (s.update ? ` · ${s.update.version} available` : ' · up to date')
    : 'Not installed';
  return { id, visible: true, installed: s.installed, version: s.version, latest, actions, busy: s.busy, error: s.error, line };
}

/** The add-ons a preset may offer (never installed without the person pressing Install). */
export const OPTIONAL_ADDONS: { id: string; feature: string; platforms: string[] }[] = [{ id: 'monorail', feature: 'monorail', platforms: ['darwin'] }];

export function addonsFor(featureIds: string[], platform: string): string[] {
  return OPTIONAL_ADDONS.filter((a) => a.platforms.includes(platform) && featureIds.includes(a.feature)).map((a) => a.id);
}

// ---------------------------------------------------------------- macOS signatures

/**
 * The requirement a component's programs must meet: the app's designated
 * requirement without its `identifier "…"` clause (each program has its own
 * identifier, but the same certificate as Keeper). Undefined when the app is
 * ad-hoc signed (its requirement pins one build's hash): then only a valid
 * signature is checked, as the updater does.
 */
export function componentRequirement(appRequirement: string | undefined): string | undefined {
  if (!appRequirement || /\bcdhash\b/.test(appRequirement)) return undefined;
  const r = appRequirement
    .replace(/^\s*identifier\s+"[^"]*"\s+and\s+/, '')
    .replace(/\s+and\s+identifier\s+"[^"]*"/g, '')
    .trim();
  if (!r || /^identifier\s+"[^"]*"$/.test(r)) return undefined;
  return r;
}

/**
 * Every requirement a component's program may meet (any one is enough): the app's own
 * signer (componentRequirement), or Ashforde's Developer ID, the same bridge the updater
 * allows (core/update-verify.ts). Empty for an ad-hoc app: only a valid signature is checked.
 */
export function componentRequirements(appRequirement: string | undefined): string[] {
  const own = componentRequirement(appRequirement);
  if (!own) return [];
  return [...new Set([own, DEVELOPER_ID_SIGNER])];
}
