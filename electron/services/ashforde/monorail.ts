// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Monorail alongside Keeper (macOS): finding it, installing and updating it
// from its GitHub releases (checksum and code signature checked, the
// certificate pinned after the first install), following its state.json,
// driving it through monorail:// links and its local API, and offering its
// tools to AI apps through Keeper's MCP server with the person's permission.
//
// Nothing here runs unless the "monorail" feature is on (off by default) and
// the computer is a Mac. While on, the only background work is one file watch
// on Monorail's folder and an update check once a day.

import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { existsSync, promises as fsp, watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, shell } from 'electron';
import {
  MONORAIL, MONORAIL_TOOLS, TOOL_PREFIX, avoidSlider, checkSignature, checksumFor, compareVersions, connectPatch, describeState, describeToolCall,
  findClashes, isAppStoreEdition, isMonorailBundleId, keeperAccelerators, missingFloatRules, spotlightQuery, monorailShortcuts, monorailThemeFor, monorailUrl, newestRelease, parseCodesign, parseState,
  pickAssets, sliderBand, versionOf, withFloatRules, withOverlayRules, type MonorailLink, type MonorailSettings, type MonorailState, type Release,
} from '../../../core/ashforde/monorail';
import { TugGuard, selfUpdating, shouldPushTheme, updatesBy, withSuggestions } from '../../../core/ashforde/coexist';
import { DEFAULT_ASHFORDE_PREFS, type AshfordePrefs, type MonorailStatus } from '../../../core/api-ashforde';
import type { Placement } from '../../../core/island-place';

export interface MonorailDeps {
  /** Keeper's settings (for shortcuts and the theme) */
  settings(): Record<string, unknown> & { theme?: string; themeSeasons?: boolean };
  broadcast(channel: string, ...args: unknown[]): void;
  alert(title: string, detail?: string): void;
  /** the person's answer to an AI app's request ('once' | 'always' | 'deny') */
  approve(client: string, action: string, description: string, destructive: boolean): Promise<'once' | 'always' | 'deny'>;
  /** extra global shortcuts Keeper holds that are not in its settings */
  fixedShortcuts?: Record<string, string>;
}

const HOME = os.homedir();
// KEEPER_MONORAIL_DIR: the Mac test kit points a Keeper in a throwaway home at the real Monorail's folder.
const supportDir = () => process.env.KEEPER_MONORAIL_DIR || path.join(HOME, 'Library', 'Application Support', MONORAIL.supportDir);
const settingsFile = () => path.join(supportDir(), 'settings.json');
const stateFile = () => path.join(supportDir(), 'state.json');
const prefsFile = () => path.join(app.getPath('userData'), 'ashforde.json');

interface Stored {
  prefs: AshfordePrefs;
  /** SHA-256 of the certificate the installed copy is signed with (trusted on first install) */
  certPin?: string;
  lastCheck?: number;
  update?: MonorailStatus['update'];
  /** theme Keeper last gave Monorail, so a theme the person picked in Monorail is not fought over */
  lastTheme?: string;
}

let deps: MonorailDeps | null = null;
let stored: Stored = { prefs: { ...DEFAULT_ASHFORDE_PREFS } };
let enabled = false;
let watcher: FSWatcher | null = null;
let updateTimer: NodeJS.Timeout | null = null;
let state: MonorailState | undefined;
let busy: MonorailStatus['busy'];
let lastError: string | undefined;
let detected: { path?: string; version?: string; bundleId?: string; at: number } | null = null;
let signature: MonorailStatus['signature'];
let mSettings: MonorailSettings = {};
const listeners = new Set<(s: MonorailState | undefined) => void>();
/** told about every state.json change while the switch is on (Focus and presentation follow it), whatever the Island shows */
const rawListeners = new Set<(s: MonorailState | undefined) => void>();
/** state.json read at most this often: a Monorail writing it in a loop cannot keep Keeper busy */
const readGuard = new TugGuard(40, 10_000, 30_000);
let guardTimer: NodeJS.Timeout | null = null;
export const readLoopsStopped = () => readGuard.trips;

// ---------------------------------------------------------------- small helpers

function run(cmd: string, args: string[], timeout = 15_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? Number((err as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

async function writeJsonAtomic(file: string, data: unknown) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.keeper.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}

async function loadStored() {
  try {
    const j = JSON.parse(await fsp.readFile(prefsFile(), 'utf8')) as Partial<Stored>;
    stored = { ...j, prefs: { ...DEFAULT_ASHFORDE_PREFS, ...(j.prefs ?? {}) } };
  } catch {
    stored = { prefs: { ...DEFAULT_ASHFORDE_PREFS } };
  }
}

const saveStored = () => writeJsonAtomic(prefsFile(), stored).catch(() => undefined);

export const isMac = () => process.platform === 'darwin';

function macMajor(): number {
  // Darwin 22 = macOS 13, 23 = 14, 24 = 15, 25 = 26.
  const d = Number(os.release().split('.')[0]);
  return d >= 25 ? d + 1 : d - 9;
}

function supported(): { ok: boolean; reason?: string } {
  if (!isMac()) return { ok: false, reason: 'Monorail runs on macOS for now. Coming when Monorail supports Windows and Linux.' };
  if (macMajor() < MONORAIL.minMacOS) return { ok: false, reason: `Monorail needs macOS ${MONORAIL.minMacOS} (Ventura) or later.` };
  return { ok: true };
}

// ---------------------------------------------------------------- finding it

const candidates = () => [
  '/Applications/Monorail.app', path.join(HOME, 'Applications', 'Monorail.app'),
  `/Applications/${MONORAIL.legacyName}.app`, path.join(HOME, 'Applications', `${MONORAIL.legacyName}.app`),
];

async function bundleId(appPath: string): Promise<string | undefined> {
  const r = await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')], 5000);
  return r.code === 0 ? r.stdout.trim() : undefined;
}

async function detect(force = false): Promise<{ path?: string; version?: string; bundleId?: string }> {
  if (!isMac()) return {};
  if (detected && !force && Date.now() - detected.at < 30_000) return detected;
  let found: string | undefined;
  let foundId: string | undefined;
  for (const c of candidates()) {
    if (!existsSync(c)) continue;
    const id = await bundleId(c);
    if (isMonorailBundleId(id)) { found = c; foundId = id; break; }
  }
  if (!found) {
    // Somewhere else (a Downloads folder, another disk): Spotlight knows.
    const r = await run('/usr/bin/mdfind', [spotlightQuery()], 5000);
    found = r.stdout.split('\n').map((l) => l.trim()).find((l) => l.endsWith('.app') && !l.includes('/.Trash/'));
    if (found) foundId = await bundleId(found);
  }
  let version: string | undefined;
  if (found) {
    const r = await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(found, 'Contents', 'Info.plist')], 5000);
    version = r.code === 0 ? r.stdout.trim() : undefined;
  }
  detected = { path: found, version, bundleId: foundId, at: Date.now() };
  return detected;
}

/** The identifier of the installed Monorail (today's when none is found). */
async function installedId(): Promise<string> {
  return (await detect()).bundleId ?? MONORAIL.bundleId;
}

async function running(): Promise<boolean> {
  if (!isMac()) return false;
  const r = await run('/usr/bin/pgrep', ['-x', 'Monorail'], 3000);
  if (r.code === 0) return true;
  return (await run('/usr/bin/pgrep', ['-x', MONORAIL.legacyName], 3000)).code === 0;
}

async function readMonorailSettings(): Promise<MonorailSettings> {
  try {
    mSettings = JSON.parse(await fsp.readFile(settingsFile(), 'utf8')) as MonorailSettings;
  } catch {
    mSettings = {};
  }
  return mSettings;
}

/** Changes Monorail's settings.json (it reloads it at once). A copy of the original is kept once. */
async function patchMonorailSettings(fn: (s: MonorailSettings & Record<string, unknown>) => MonorailSettings & Record<string, unknown>): Promise<void> {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(await fsp.readFile(settingsFile(), 'utf8')) as Record<string, unknown>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Monorail’s settings file could not be read, so Keeper left it alone.');
  }
  const backup = `${settingsFile()}.before-keeper`;
  if (Object.keys(raw).length && !existsSync(backup)) await fsp.writeFile(backup, JSON.stringify(raw, null, 2)).catch(() => undefined);
  const next = fn(raw as MonorailSettings & Record<string, unknown>);
  if (JSON.stringify(next) === JSON.stringify(raw)) return;
  await writeJsonAtomic(settingsFile(), next);
  mSettings = next;
}

// ---------------------------------------------------------------- its local API

export async function apiCall(method: 'GET' | 'POST', route: string, body?: Record<string, unknown>, timeout = 4000): Promise<unknown> {
  const [token, port] = await Promise.all([
    fsp.readFile(path.join(supportDir(), 'api-token'), 'utf8').then((s) => s.trim()).catch(() => ''),
    fsp.readFile(path.join(supportDir(), 'api-port'), 'utf8').then((s) => Number(s.trim())).catch(() => 0),
  ]);
  if (!token || !port) throw new Error('Monorail’s local API is off. Connect Keeper to Monorail in Settings → Ashforde apps.');
  const r = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Monorail answered ${r.status}`);
  return j;
}

async function apiReady(): Promise<boolean> {
  try {
    await apiCall('GET', '/state', undefined, 1500);
    return true;
  } catch {
    return false;
  }
}

/** Opens a monorail:// link without bringing Monorail to the front. */
export function openLink(l: MonorailLink): Promise<boolean> {
  if (!isMac() || !detected?.path) return Promise.resolve(false);
  return new Promise((resolve) => {
    const p = spawn('/usr/bin/open', ['-g', monorailUrl(l)], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

// ---------------------------------------------------------------- following its state

function readState() {
  if (!readGuard.allow('state')) {
    // Too many changes too fast: one read once things calm down, nothing before.
    if (!guardTimer) guardTimer = setTimeout(() => { guardTimer = null; readState(); }, 30_000);
    guardTimer.unref?.();
    return;
  }
  void fsp.readFile(stateFile(), 'utf8').then((t) => {
    const s = parseState(t);
    if (JSON.stringify(s ?? undefined) === JSON.stringify(state)) return;
    state = s ?? undefined;
    tell();
    if (enabled) for (const l of rawListeners) l(state);
    deps?.broadcast('ashforde-changed');
  }, () => undefined);
}

function startWatch() {
  stopWatch();
  if (!existsSync(supportDir())) return;
  let timer: NodeJS.Timeout | null = null;
  try {
    // state.json is replaced (written atomically), so watch the folder, not the file.
    watcher = watch(supportDir(), { persistent: false }, (_ev, name) => {
      if (name && name !== 'state.json' && name !== 'settings.json') return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (name === 'settings.json') void readMonorailSettings().then(() => deps?.broadcast('ashforde-changed'));
        else readState();
      }, 250);
    });
    watcher.on('error', () => stopWatch());
  } catch {
    watcher = null;
  }
  readState();
}

function stopWatch() {
  watcher?.close();
  watcher = null;
}

/** The Island hears about Monorail's state only while the person wants it there. */
function tell() {
  const shown = enabled && stored.prefs.showInIsland ? state : undefined;
  for (const l of listeners) l(shown);
}

export function onMonorailState(fn: (s: MonorailState | undefined) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function onRawState(fn: (s: MonorailState | undefined) => void): () => void {
  rawListeners.add(fn);
  return () => rawListeners.delete(fn);
}

export function monorailState(): MonorailState | undefined {
  return enabled ? state : undefined;
}

export const monorailLine = () => (state ? describeState(state) : undefined);

// ---------------------------------------------------------------- status

export async function status(force = false): Promise<MonorailStatus> {
  const sup = supported();
  const base: MonorailStatus = { supported: sup.ok, unsupportedReason: sup.reason, installed: false, running: false, connected: false, apiReady: false, clashes: [], sliderAtTop: false, busy, error: lastError, update: stored.update, lastCheck: stored.lastCheck };
  if (!sup.ok) return base;
  const d = await detect(force);
  if (!d.path) return base;
  const [isRunning, ms] = await Promise.all([running(), readMonorailSettings()]);
  const ready = isRunning && ms.localAPI ? await apiReady() : false;
  const update = stored.update && d.version && compareVersions(stored.update.version, d.version) > 0 ? stored.update : undefined;
  return {
    ...base,
    installed: true,
    path: d.path,
    version: d.version,
    running: isRunning,
    connected: !!ms.localAPI && !!ms.publishState,
    apiReady: ready,
    state: isRunning ? state : undefined,
    update,
    signature,
    clashes: clashes(),
    updatesBy: updatesBy(ms),
    sliderAtTop: !!sliderBand(ms, { x: 0, y: 0, width: 1440, height: 900 }),
  };
}

function clashes() {
  if (!deps) return [];
  const keeper = keeperAccelerators(deps.settings(), deps.fixedShortcuts);
  const theirs = monorailShortcuts(mSettings);
  return withSuggestions(findClashes(keeper, theirs), keeper, theirs);
}

/** Monorail's own updater is in the middle of swapping the app (its relaunch script, or the copy it keeps meanwhile). */
async function updatingItself(): Promise<boolean> {
  const p = detected?.path;
  const previousExists = !!p && existsSync(`${p}.previous`);
  const scriptRunning = (await run('/usr/bin/pgrep', ['-f', 'monorail-update'], 3000)).code === 0;
  return selfUpdating({ previousExists, scriptRunning });
}

function setBusy(step?: string, progress?: number) {
  busy = step ? { step, progress } : undefined;
  deps?.broadcast('ashforde-changed');
}

// ---------------------------------------------------------------- install, update, remove

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Keeper' }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(r.status === 403 ? 'GitHub is limiting requests from this network; try again in a little while.' : `GitHub answered ${r.status}`);
  return r.json();
}

async function latestRelease(): Promise<Release> {
  const list = (await fetchJson(`https://api.github.com/repos/${MONORAIL.repo}/releases?per_page=10`)) as Release[];
  const r = newestRelease(list);
  if (!r) throw new Error('No Monorail release with an app and checksums was found.');
  return r;
}

async function download(url: string, to: string, label: string): Promise<Buffer> {
  const r = await fetch(url, { headers: { 'User-Agent': 'Keeper' }, signal: AbortSignal.timeout(10 * 60_000) });
  if (!r.ok || !r.body) throw new Error(`Downloading ${label} failed (${r.status}).`);
  const total = Number(r.headers.get('content-length')) || 0;
  const chunks: Buffer[] = [];
  let got = 0;
  let lastPct = -1;
  for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(c));
    got += c.length;
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; setBusy(`Downloading ${label}`, pct / 100); }
  }
  const buf = Buffer.concat(chunks);
  await fsp.writeFile(to, buf);
  return buf;
}

/** The SHA-256 of the leaf certificate an app is signed with. */
async function certFingerprint(appPath: string, dir: string): Promise<string | undefined> {
  const prefix = path.join(dir, 'cert');
  await run('/usr/bin/codesign', ['-d', `--extract-certificates=${prefix}`, appPath], 15_000);
  try {
    return createHash('sha256').update(await fsp.readFile(`${prefix}0`)).digest('hex');
  } catch {
    return undefined;
  }
}

async function verifyApp(appPath: string, dir: string): Promise<{ ok: boolean; reason: string; fingerprint?: string }> {
  const strict = await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], 60_000);
  if (strict.code !== 0) return { ok: false, reason: `Its code signature is broken: ${strict.stderr.trim().split('\n').pop() ?? 'unknown error'}` };
  const info = await run('/usr/bin/codesign', ['-dvv', appPath], 15_000);
  const fingerprint = await certFingerprint(appPath, dir);
  return { ...checkSignature(parseCodesign(info.stderr + info.stdout), fingerprint, stored.certPin), fingerprint };
}

async function quitRunning() {
  if (!(await running())) return;
  await run('/usr/bin/osascript', ['-e', `quit app id "${await installedId()}"`], 8000);
  for (let i = 0; i < 20 && (await running()); i++) await new Promise((r) => setTimeout(r, 250));
  if (await running()) await run('/usr/bin/pkill', ['-x', 'Monorail'], 3000);
}

async function installRelease(kind: 'install' | 'update'): Promise<MonorailStatus> {
  const sup = supported();
  if (!sup.ok) throw new Error(sup.reason);
  if (busy) throw new Error('Monorail is already being installed.');
  if (kind === 'update' && isAppStoreEdition((await detect(true)).bundleId)) {
    throw new Error('This Monorail came from the Mac App Store, which keeps it up to date.');
  }
  lastError = undefined;
  if (kind === 'update' && (await updatingItself())) throw new Error('Monorail is updating itself right now. Keeper leaves it to finish; check again in a minute.');
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-monorail-'));
  try {
    setBusy('Finding the latest release');
    const rel = await latestRelease();
    const assets = pickAssets(rel)!;
    const sums = await (await fetch(assets.sums.browser_download_url, { headers: { 'User-Agent': 'Keeper' }, signal: AbortSignal.timeout(30_000) })).text();
    const want = checksumFor(sums, assets.archive.name);
    if (!want) throw new Error('The release lists no checksum for the app, so Keeper did not install it.');
    const zip = path.join(tmp, assets.archive.name);
    const buf = await download(assets.archive.browser_download_url, zip, `Monorail ${versionOf(rel.tag_name)}`);
    setBusy('Checking the download');
    const got = createHash('sha256').update(buf).digest('hex');
    if (got !== want) throw new Error('The download does not match the release’s checksum, so Keeper did not install it.');
    const out = path.join(tmp, 'x');
    await fsp.mkdir(out);
    const unzip = await run('/usr/bin/ditto', ['-x', '-k', zip, out], 120_000);
    if (unzip.code !== 0) throw new Error('The download could not be opened.');
    const appName = (await fsp.readdir(out)).find((n) => n.endsWith('.app'));
    if (!appName) throw new Error('The download has no app in it.');
    const fresh = path.join(out, appName);
    setBusy('Checking the signature');
    const v = await verifyApp(fresh, tmp);
    if (!v.ok) throw new Error(`Keeper did not install it. ${v.reason}`);

    setBusy(kind === 'update' ? 'Updating Monorail' : 'Installing Monorail');
    const old = (await detect(true)).path;
    const wasRunning = await running();
    if (await updatingItself()) throw new Error('Monorail started updating itself meanwhile, so Keeper stopped. Its own update finishes the job.');
    await quitRunning();
    const dest = old && path.basename(old) === 'Monorail.app' ? old : (await canWrite('/Applications')) ? '/Applications/Monorail.app' : path.join(HOME, 'Applications', 'Monorail.app');
    if (old) await shell.trashItem(old).catch(() => fsp.rm(old, { recursive: true, force: true }));
    if (existsSync(dest)) await shell.trashItem(dest).catch(() => undefined);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const copy = await run('/usr/bin/ditto', [fresh, dest], 120_000);
    if (copy.code !== 0) throw new Error(`Copying Monorail to ${path.dirname(dest)} failed.`);
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', dest], 15_000);

    // Trust on first install: later updates must come with the very same certificate.
    if (v.fingerprint) stored.certPin = v.fingerprint;
    stored.update = undefined;
    stored.lastCheck = Date.now();
    await saveStored();
    signature = { ok: true, reason: v.reason };
    detected = null;
    if (kind === 'install' || wasRunning) await run('/usr/bin/open', ['-g', '-b', await installedId()], 10_000);
    deps?.alert(kind === 'update' ? `Monorail ${versionOf(rel.tag_name)} is installed` : 'Monorail is installed', kind === 'install' ? 'Allow it in Accessibility when macOS asks, so it can arrange your windows.' : undefined);
    if (enabled) startWatch();
    return status(true);
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    setBusy();
    void fsp.rm(tmp, { recursive: true, force: true });
  }
}

async function canWrite(dir: string) {
  try {
    await fsp.access(dir, 2 /* W_OK */);
    return true;
  } catch {
    return false;
  }
}

export const install = () => installRelease('install');
export const update = () => installRelease('update');

export async function checkUpdate(): Promise<MonorailStatus> {
  const d = await detect(true);
  try {
    const rel = await latestRelease();
    const v = versionOf(rel.tag_name);
    stored.lastCheck = Date.now();
    // The App Store edition is updated by the App Store, never from GitHub.
    stored.update = d.version && !isAppStoreEdition(d.bundleId) && compareVersions(v, d.version) > 0
      ? { version: v, notes: rel.body?.slice(0, 2000), url: rel.html_url } : undefined;
    await saveStored();
    lastError = undefined;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }
  return status(true);
}

export async function uninstall(removeSettings = false): Promise<MonorailStatus> {
  const d = await detect(true);
  stopWatch();
  await quitRunning();
  if (d.path) await shell.trashItem(d.path);
  if (removeSettings && existsSync(supportDir())) await shell.trashItem(supportDir()).catch(() => undefined);
  stored.certPin = undefined;
  stored.update = undefined;
  await saveStored();
  detected = null;
  state = undefined;
  return status(true);
}

export async function launch(): Promise<MonorailStatus> {
  const d = await detect();
  if (!d.path) throw new Error('Monorail is not installed.');
  await run('/usr/bin/open', ['-b', d.bundleId ?? MONORAIL.bundleId], 10_000);
  await new Promise((r) => setTimeout(r, 800));
  if (enabled) startWatch();
  return status(true);
}

export async function quit(): Promise<MonorailStatus> {
  await quitRunning();
  return status(true);
}

/** Turns on Monorail's local API and state.json, and applies Keeper's float rules and theme when chosen. */
export async function connect(): Promise<MonorailStatus> {
  await readMonorailSettings();
  await patchMonorailSettings((s) => ({ ...s, ...connectPatch(s) }));
  await applyPrefsToMonorail();
  if (enabled) startWatch();
  // Monorail reloads its settings on its own; give its server a moment to start.
  for (let i = 0; i < 8 && (await running()) && !(await apiReady()); i++) await new Promise((r) => setTimeout(r, 400));
  return status(true);
}

/** Float rules and theme, as the person chose. Only touches Monorail once it is connected. */
async function applyPrefsToMonorail() {
  const ms = await readMonorailSettings();
  if (!ms.localAPI) return;
  const p = stored.prefs;
  const wantRules = p.floatKeeperWindows;
  if (wantRules ? missingFloatRules(ms).length > 0 : (ms.appRules ?? []).some((r) => r.ruleID?.startsWith('keeper-') && !r.ruleID.startsWith('keeper-overlay-'))) {
    await patchMonorailSettings((s) => ({ ...s, ...withFloatRules(s, wantRules) }));
  }
  if (p.matchTheme && deps) await syncTheme(deps.settings(), true);
}

/**
 * Keeper's theme → Monorail's closest theme. Only when Keeper's theme changed
 * (or the person just switched matching on): a theme picked in Monorail itself
 * is never overwritten by an unrelated change.
 */
export async function syncTheme(s: { theme?: string; themeSeasons?: boolean }, force = false) {
  if (!enabled || !stored.prefs.matchTheme || !s.theme) return;
  const want = monorailThemeFor(s.theme, !!s.themeSeasons);
  const ms = await readMonorailSettings();
  if (!ms.localAPI || !shouldPushTheme(want, stored.lastTheme, ms.theme, force)) { if (ms.theme === want) stored.lastTheme = want; return; }
  await patchMonorailSettings((x) => ({ ...x, theme: want }));
  stored.lastTheme = want;
  await saveStored();
}

// ---------------------------------------------------------------- Keeper's modes → Monorail's

/** Called by the Island when a Focus session starts or ends. */
export function focusChanged(on: boolean) {
  if (enabled && stored.prefs.followFocus) void openLink({ kind: 'focus-mode', on });
}

/** Called when Keeper's presentation mode is switched. */
export function presentationChanged(on: boolean) {
  if (enabled && stored.prefs.followPresentation) void openLink({ kind: 'presentation-mode', on });
}

/** Keeps the Island clear of the slider bar when it is at the top. */
export function adjustPlacement(p: Placement, workArea: { x: number; y: number; width: number; height: number }): Placement {
  if (!enabled || !detected?.path) return p;
  return avoidSlider(p, sliderBand(mSettings, workArea));
}

/** The top of a bar Keeper puts at the top of a screen (the sharing bar): below Monorail's slider bar when that is at the top. */
export function topClearOfSlider(workArea: { x: number; y: number; width: number; height: number }, wanted: number): number {
  if (!enabled || !detected?.path) return wanted;
  const band = sliderBand(mSettings, workArea);
  return band && wanted < band.y + band.height ? band.y + band.height + 4 : wanted;
}

/** Monorail's settings as last read (no file access). */
export const monorailSettingsNow = (): MonorailSettings => mSettings;

// ---------------------------------------------------------------- AI tools through Keeper's MCP server

export function tools() {
  if (!enabled || stored.prefs.aiTools === 'off' || !detected?.path || !mSettings.localAPI) return [];
  return MONORAIL_TOOLS.map((t) => ({
    name: `${TOOL_PREFIX}${t.name}`,
    description: `Monorail (window manager): ${t.description}`,
    inputSchema: { type: 'object', properties: t.properties, required: t.required },
    annotations: { readOnlyHint: t.readOnly, destructiveHint: !!t.destructive, openWorldHint: false, title: `Monorail: ${t.name.replace(/_/g, ' ')}` },
  }));
}

export async function callTool(name: string, args: Record<string, unknown>, client: string): Promise<{ text: string; isError?: boolean; structured?: unknown }> {
  const t = MONORAIL_TOOLS.find((x) => `${TOOL_PREFIX}${x.name}` === name);
  if (!t) return { text: `Unknown tool ${name}`, isError: true };
  if (!enabled || stored.prefs.aiTools === 'off') return { text: 'The person has not allowed AI apps to use Monorail through Keeper.', isError: true };
  if (!t.readOnly && stored.prefs.aiTools === 'ask' && deps) {
    const d = await deps.approve(client, name, describeToolCall(name, args), !!t.destructive);
    if (d === 'deny') return { text: 'The person declined. Do not try again unless they ask.', isError: true };
    if (d === 'always') await setPrefs({ aiTools: 'allow' });
  }
  try {
    const r = await apiCall(t.method, t.path, t.method === 'POST' ? args : undefined, 10_000);
    return { text: JSON.stringify(r, null, 1).slice(0, 20_000), structured: r };
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  }
}

// ---------------------------------------------------------------- prefs and the feature switch

export const prefs = () => stored.prefs;

export async function setPrefs(patch: Partial<AshfordePrefs>): Promise<AshfordePrefs> {
  stored.prefs = { ...stored.prefs, ...patch };
  await saveStored();
  if ('showInIsland' in patch) tell();
  if (enabled) {
    if ('floatKeeperWindows' in patch || ('matchTheme' in patch && patch.matchTheme)) await applyPrefsToMonorail().catch((e) => (lastError = e instanceof Error ? e.message : String(e)));
    scheduleUpdates();
  }
  deps?.broadcast('ashforde-changed');
  return stored.prefs;
}

function scheduleUpdates() {
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = null;
  if (!enabled || !stored.prefs.checkUpdates) return;
  const due = () => {
    // Monorail checks for its own updates unless that is off there: then Keeper does, never both.
    if (updatesBy(mSettings) === 'monorail') return;
    if (detected?.path && Date.now() - (stored.lastCheck ?? 0) > 86_400_000) void checkUpdate().then(() => deps?.broadcast('ashforde-changed'));
  };
  // Once a day; the first check waits ten minutes so starting Keeper stays quick.
  updateTimer = setInterval(due, 6 * 3_600_000);
  updateTimer.unref?.();
  setTimeout(due, 10 * 60_000).unref?.();
}

export async function init(d: MonorailDeps) {
  deps = d;
  await loadStored();
  // Even with the Ashforde integration off: when Monorail is installed, it must not tile the Island and Keeper's overlays.
  if (isMac()) void keepOverlaysFloating().catch(() => undefined);
}

/**
 * Adds Keeper's overlay float rules to Monorail's settings.json when Monorail
 * has one (it is installed and has run). Only appRules changes, with the usual
 * one-time copy kept as settings.json.before-keeper; Monorail reloads it by itself.
 */
export async function keepOverlaysFloating(): Promise<boolean> {
  if (!existsSync(settingsFile())) return false;
  await patchMonorailSettings((s) => ({ ...s, ...withOverlayRules(s) }));
  return true;
}

/** The "monorail" feature went on or off. Off stops everything: no watch, no timers, no tools. */
export async function setEnabled(on: boolean) {
  enabled = on && isMac();
  if (!enabled) {
    stopWatch();
    scheduleUpdates();
    state = undefined;
    tell();
    deps?.broadcast('ashforde-changed');
    return;
  }
  const d = await detect(true);
  if (d.path) {
    await readMonorailSettings();
    await keepOverlaysFloating().catch(() => undefined);
    startWatch();
    void verifyInstalled();
  }
  scheduleUpdates();
  deps?.broadcast('ashforde-changed');
}

/** Checks the installed copy's signature once (cheap; cached until it changes). */
async function verifyInstalled() {
  if (!detected?.path) return;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-monorail-'));
  try {
    const v = await verifyApp(detected.path, tmp);
    signature = { ok: v.ok, reason: v.reason };
    if (v.ok && v.fingerprint && !stored.certPin) { stored.certPin = v.fingerprint; await saveStored(); }
  } finally {
    void fsp.rm(tmp, { recursive: true, force: true });
  }
}

export const enabledNow = () => enabled;
