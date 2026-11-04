// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where each component (core/components.ts) is on this computer. Every feature
// finds ffmpeg, ONNX Runtime and rclone through here, never by a fixed path.
//
//   1. inside the app        the offline installer, or a copy from before components
//   2. downloaded            <userData>/components/<name>/<this exact version>
//   3. a development copy    node_modules / vendor (npm run dev; KEEPER_COMPONENTS_DEV=0 turns it off)
//
// No Electron import: the keeper command uses this too. The app calls
// configureComponentPaths() at start with its real folders.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { componentAvailable, probePath, versionMatches, type ComponentId, type ComponentState } from './components';

declare const __KEEPER_VERSION__: string | undefined;

export interface ComponentPathsContext {
  version: string;
  userData?: string;
  /** process.resourcesPath of a packaged app */
  resourcesPath?: string;
  /** the app's folder (app.getAppPath()): app.asar when packaged, the project in development */
  appPath?: string;
  packaged: boolean;
  platform: string;
  arch: string;
  /** look in node_modules and vendor/ too */
  dev: boolean;
}

/** Keeper's data folder as Electron names it (productName "Keeper"), for the command line. */
export function defaultUserData(platform: string = process.platform, env = process.env, home = os.homedir()): string {
  if (env.KEEPER_USER_DATA) return env.KEEPER_USER_DATA;
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Keeper');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Keeper');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Keeper');
}

function guess(): ComponentPathsContext {
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  const packaged = !!resourcesPath && existsSync(path.join(resourcesPath, 'app.asar'));
  return {
    version: typeof __KEEPER_VERSION__ === 'string' ? __KEEPER_VERSION__ : process.env.npm_package_version ?? '0.0.0',
    userData: defaultUserData(),
    resourcesPath,
    appPath: packaged ? path.join(resourcesPath!, 'app.asar') : process.cwd(),
    packaged,
    platform: process.platform,
    arch: process.arch,
    dev: !packaged && process.env.KEEPER_COMPONENTS_DEV !== '0',
  };
}

let ctx: ComponentPathsContext | null = null;
export function configureComponentPaths(c: Partial<ComponentPathsContext>) {
  ctx = { ...guess(), ...c };
  if (process.env.KEEPER_COMPONENTS_DEV === '0') ctx.dev = false;
}
export const componentContext = (): ComponentPathsContext => (ctx ??= guess());

export const componentsRoot = (c = componentContext()) => path.join(c.userData ?? defaultUserData(c.platform), 'components');
export const installDir = (id: ComponentId, version: string, c = componentContext()) => path.join(componentsRoot(c), id, version);
export const MARKER = 'component.json';

/** Where a component's files sit for each source, the folder its probe path is relative to. */
export function componentCandidates(id: ComponentId, c: ComponentPathsContext): { source: 'bundled' | 'installed' | 'dev'; dir: string }[] {
  const out: { source: 'bundled' | 'installed' | 'dev'; dir: string }[] = [];
  const unpacked = c.resourcesPath && path.join(c.resourcesPath, 'app.asar.unpacked');
  if (c.packaged && c.resourcesPath) {
    if (id === 'ffmpeg') out.push({ source: 'bundled', dir: path.join(unpacked!, 'node_modules', 'ffmpeg-static') });
    if (id === 'onnxruntime') out.push({ source: 'bundled', dir: unpacked! });
    if (id === 'rclone') out.push({ source: 'bundled', dir: path.join(c.resourcesPath, 'rclone') });
    if (id === 'ironrdp') out.push({ source: 'bundled', dir: path.join(c.resourcesPath, 'ironrdp') });
  }
  out.push({ source: 'installed', dir: installDir(id, c.version, c) });
  if (c.dev && c.appPath) {
    if (id === 'ffmpeg') out.push({ source: 'dev', dir: path.join(c.appPath, 'node_modules', 'ffmpeg-static') });
    if (id === 'onnxruntime') out.push({ source: 'dev', dir: c.appPath });
    if (id === 'rclone') out.push({ source: 'dev', dir: path.join(c.appPath, 'vendor', 'rclone', 'current') });
    if (id === 'ironrdp') out.push({ source: 'dev', dir: path.join(c.appPath, 'vendor', 'ironrdp', 'current') });
  }
  return out;
}

/** The version recorded in an installed component's marker. */
export function installedVersion(dir: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(path.join(dir, MARKER), 'utf8')) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

export interface Located { source: 'bundled' | 'installed' | 'dev'; dir: string; probe: string }

/** The first usable copy of a component, or null. A downloaded one must carry this version's marker. */
export function locateComponent(id: ComponentId, c = componentContext(), exists: (p: string) => boolean = existsSync): Located | null {
  if (!componentAvailable(id, c.platform, c.arch) && !c.dev) return null;
  const rel = probePath(id, c.platform, c.arch);
  for (const cand of componentCandidates(id, c)) {
    // The probe path is written from the component's own folder: node_modules/… for ONNX Runtime.
    const probe = path.join(cand.dir, ...rel.split('/'));
    if (!exists(probe)) continue;
    if (cand.source === 'installed' && !versionMatches(installedVersion(cand.dir), c.version)) continue;
    return { ...cand, probe };
  }
  return null;
}

export function componentSource(id: ComponentId, c = componentContext()): ComponentState {
  if (!componentAvailable(id, c.platform, c.arch)) return 'unavailable';
  const l = locateComponent(id, c);
  return l ? l.source : 'missing';
}

/** Thrown when a feature needs a component that is not downloaded; the interface offers the download. */
export class ComponentMissingError extends Error {
  constructor(public component: ComponentId, what: string) {
    super(`${what} needs a part of Keeper that is not downloaded yet. Download it in Settings → Features (or where the feature asks).`);
    this.name = 'ComponentMissingError';
  }
}

/** The ffmpeg program, or null when it is not here (callers may fall back to one on the PATH). */
export function ffmpegBinary(): string | null {
  return locateComponent('ffmpeg')?.probe ?? null;
}

/** The rclone program from Keeper (bundled or downloaded), or null. */
export function rcloneBinary(): string | null {
  return locateComponent('rclone')?.probe ?? null;
}

const loaded = new Map<string, unknown>();
/**
 * ONNX Runtime's module. Inside the app it loads the way it always did; a
 * downloaded copy loads from its own node_modules. Throws ComponentMissingError.
 */
export function onnxRuntime<T = typeof import('onnxruntime-node')>(what = 'This'): T {
  const l = locateComponent('onnxruntime');
  if (!l) throw new ComponentMissingError('onnxruntime', what);
  const key = l.dir;
  if (!loaded.has(key)) {
    const from = l.source === 'bundled' ? __filename : path.join(l.dir, 'index.js');
    loaded.set(key, createRequire(from)('onnxruntime-node'));
  }
  return loaded.get(key) as T;
}

/** The Remote Desktop engine's script (one JavaScript module with WebAssembly inside), or null when it is not here. */
export function ironRdpScript(): string | null {
  return locateComponent('ironrdp')?.probe ?? null;
}

/** Whether ONNX Runtime can be loaded on this computer right now (without loading it). */
export const onnxRuntimeReady = () => !!locateComponent('onnxruntime');
