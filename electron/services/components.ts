// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Components in the app: where they are, downloading them for switched-on
// features, keeping them in step with app updates, and freeing the space.
// Nothing here blocks startup: the first look happens a while after launch.
//
//   ensureComponentsFor(featureIds)  what the welcome tour's preset and first use call
//   onComponentsChanged(fn)          the interface refreshes (event "components-changed")
//
// See docs/COMPONENTS.md.

import { app, net } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { backgroundPlan, componentDef, COMPONENTS, componentsFor, isComponentId, offlineTotal, usable, componentRequirements, type ComponentId, type ComponentInfo } from '../../core/components';
import { feedAllowed } from '../../core/updates';
import { designatedRequirement } from '../../core/update-verify';
import { run } from '../../core/platform';
import { ComponentInstaller, isOfflineError } from './component-installer';
import { componentContext, componentsRoot, configureComponentPaths, locateComponent, onnxRuntime } from '../../core/component-paths';

const RAW_FEED = process.env.KEEPER_COMPONENTS_FEED?.replace(/\/$/, '');
const FEED = feedAllowed(RAW_FEED) ? RAW_FEED : undefined;

let installer: ComponentInstaller | null = null;
let onFeatures: () => string[] = () => [];
let listeners: (() => void)[] = [];
let notice: (title: string, detail?: string) => void = () => undefined;
let lastEmit = 0;
let pendingEmit: NodeJS.Timeout | undefined;
const waitingForNetwork = new Set<ComponentId>();
let onlineTimer: NodeJS.Timeout | undefined;

/** Progress comes in quickly: the interface hears about it at most five times a second. */
function emit() {
  const now = Date.now();
  if (now - lastEmit >= 200) {
    lastEmit = now;
    for (const fn of listeners) fn();
    return;
  }
  if (!pendingEmit) pendingEmit = setTimeout(() => { pendingEmit = undefined; emit(); }, 200 - (now - lastEmit));
}

export function onComponentsChanged(fn: () => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter((x) => x !== fn); };
}

/** The bundle of the running app (macOS). */
const appBundle = () => path.resolve(path.dirname(app.getPath('exe')), '..', '..');

/** macOS: every program in a component must be signed like this copy of Keeper (the updater's check). */
async function verifySignatures(files: string[]) {
  if (process.platform !== 'darwin' || !files.length) return;
  const mine = await run('/usr/bin/codesign', ['-d', '-r-', appBundle()], 60_000);
  // This copy's signer, or Ashforde's Developer ID (the bridge from the self-signed certificate).
  const requirements = componentRequirements(designatedRequirement(`${mine.stdout}\n${mine.stderr}`));
  for (const f of files) {
    const valid = await run('/usr/bin/codesign', ['--verify', '--strict', f], 60_000);
    if (!valid.ok) throw new Error(`${path.basename(f)} is not validly signed; it was not installed (${(valid.stderr || valid.stdout).trim().split('\n')[0]})`);
    if (!requirements.length) continue;
    let same = false;
    for (const r of requirements) if ((same = (await run('/usr/bin/codesign', ['--verify', `-R=${r}`, f], 60_000)).ok)) break;
    if (!same) throw new Error(`${path.basename(f)} is not signed by the same developer as this copy of Keeper; it was not installed`);
  }
}

async function stripQuarantine(dir: string) {
  if (process.platform === 'darwin') await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', dir], 60_000);
}

/** Called once at start (cheap): paths only. Downloads wait for later. */
export function initComponents(o: { onFeatures: () => string[]; notice?: (title: string, detail?: string) => void; previousVersion?: string }) {
  configureComponentPaths({
    userData: app.getPath('userData'), version: app.getVersion(), resourcesPath: process.resourcesPath, appPath: app.getAppPath(),
    packaged: app.isPackaged, platform: process.platform, arch: process.arch, dev: !app.isPackaged,
  });
  onFeatures = o.onFeatures;
  notice = o.notice ?? notice;
  installer = new ComponentInstaller({
    ctx: componentContext,
    fetch: ((url: string, init?: RequestInit) => net.fetch(url, init as never)) as typeof fetch,
    feed: FEED,
    onChange: emit,
    verifySignatures,
    stripQuarantine,
    userAgent: `Keeper/${app.getVersion()}`,
  });
  // A while after start, never during it: after an update, the parts the person uses follow the app.
  const previous = o.previousVersion;
  setTimeout(() => void afterStart(previous), Number(process.env.KEEPER_COMPONENTS_DELAY_MS ?? 30_000)).unref?.();
}

async function afterStart(previousVersion: string | undefined) {
  const statePath = path.join(componentsRoot(), 'state.json');
  let state: { lastVersion?: string } = {};
  try { state = JSON.parse(await fsp.readFile(statePath, 'utf8')); } catch { /* first time */ }
  const before = state.lastVersion ?? previousVersion;
  const plan = backgroundPlan({ previousVersion: before, currentVersion: app.getVersion(), onFeatures: onFeatures(), infos: list(), platform: process.platform, arch: process.arch });
  await fsp.mkdir(path.dirname(statePath), { recursive: true }).catch(() => undefined);
  await fsp.writeFile(statePath, JSON.stringify({ lastVersion: app.getVersion() })).catch(() => undefined);
  if (!plan.length) return;
  notice('Keeper is downloading the parts you use', `${plan.map((id) => componentDef(id)?.name).join(', ')}: this version of Keeper downloads them separately. Everything else works meanwhile.`);
  for (const id of plan) await download(id).catch(() => undefined);
}

function requireInstaller(): ComponentInstaller {
  if (!installer) throw new Error('Components are not ready yet');
  return installer;
}

export function list(): ComponentInfo[] {
  return installer ? installer.infos(onFeatures()) : [];
}

/** Starts (or joins) a download; when offline, tries again by itself once the network is back. */
export async function download(id: ComponentId): Promise<ComponentInfo[]> {
  if (!isComponentId(id)) throw new Error(`Unknown part: ${String(id)}`);
  try {
    await requireInstaller().install(id);
    waitingForNetwork.delete(id);
  } catch (e) {
    if ((e as { offline?: boolean }).offline || isOfflineError(e)) waitForNetwork(id);
    else if ((e as Error).message !== 'Cancelled') throw e;
  }
  return list();
}

function waitForNetwork(id: ComponentId) {
  waitingForNetwork.add(id);
  if (onlineTimer) return;
  onlineTimer = setInterval(() => {
    if (!net.isOnline()) return;
    clearInterval(onlineTimer);
    onlineTimer = undefined;
    const ids = [...waitingForNetwork];
    waitingForNetwork.clear();
    for (const x of ids) void download(x).catch(() => undefined);
  }, 15_000);
  onlineTimer.unref?.();
}

/**
 * Downloads whatever the given features need and is not here yet (the welcome
 * tour's preset, a first use, switching a feature on). Resolves when all are
 * in, or rejects with the first problem. `partly: false` skips parts a feature
 * only needs for one of its tools.
 */
export async function ensureComponentsFor(featureIds: string[], o: { partly?: boolean } = {}): Promise<ComponentInfo[]> {
  // Parts fetched on first use (Remote Desktop in a tab) wait for that use.
  const ids = componentsFor(featureIds, { partly: o.partly, platform: process.platform, arch: process.arch }).filter((x) => !componentDef(x)?.onDemand);
  const todo = list().filter((i) => ids.includes(i.id) && !usable(i.state) && i.state !== 'unavailable');
  await Promise.all(todo.map((i) => download(i.id)));
  return list();
}

/** The real sizes from this version's manifest (estimates until then); offline keeps the estimates. */
export async function sizes(): Promise<ComponentInfo[]> {
  await requireInstaller().manifest().catch(() => undefined);
  return list();
}

/** "Download everything for offline use". */
export async function downloadAll(): Promise<ComponentInfo[]> {
  await Promise.all(offlineTotal(list()).ids.map((id) => download(id)));
  return list();
}

export function cancel(id: ComponentId): ComponentInfo[] {
  requireInstaller().cancel(id);
  waitingForNetwork.delete(id);
  return list();
}

/** "Free up space": downloaded copies only (parts inside the app stay). */
export async function remove(id: ComponentId): Promise<ComponentInfo[]> {
  await requireInstaller().remove(id);
  return list();
}

export async function removeAll(): Promise<ComponentInfo[]> {
  for (const c of COMPONENTS) await requireInstaller().remove(c.id);
  return list();
}

/** Runs the component once to prove it works (ffmpeg -version, rclone version, loading ONNX Runtime). */
export async function check(id: ComponentId): Promise<{ ok: boolean; output: string; path?: string; source?: string }> {
  const l = locateComponent(id);
  if (!l) return { ok: false, output: 'Not downloaded' };
  if (id === 'onnxruntime') {
    try {
      const ort = onnxRuntime<{ env?: { versions?: { common?: string } } }>();
      return { ok: true, output: `ONNX Runtime ${ort.env?.versions?.common ?? ''}`.trim(), path: l.dir, source: l.source };
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e), path: l.dir, source: l.source };
    }
  }
  if (id === 'ironrdp') {
    // A script for the tab, not a program: its version file and size say it is the expected one.
    const version = await fsp.readFile(path.join(l.dir, 'VERSION'), 'utf8').catch(() => '');
    const size = (await fsp.stat(l.probe).catch(() => null))?.size ?? 0;
    return { ok: size > 0, output: `IronRDP ${version.trim() || '(unknown version)'}, ${Math.round(size / 1e5) / 10} MB`, path: l.probe, source: l.source };
  }
  const r = await run(l.probe, componentDef(id)!.check, 30_000);
  return { ok: r.ok, output: (r.stdout || r.stderr).trim().split('\n')[0] ?? '', path: l.probe, source: l.source };
}

/** True when the component is here; otherwise starts nothing (callers show the download). */
export const componentReady = (id: ComponentId) => !!locateComponent(id);

export const componentsFolder = () => componentsRoot();
export const hasDownloads = () => existsSync(componentsRoot());
