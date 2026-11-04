// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// App updates: looks for newer versions of installed apps (each Mac app's own
// update feed, Homebrew, winget, Flatpak, Snap, apt or dnf), keeps the last
// answer in <userData>/app-updates.json, puts one row on the Fix-it List, and
// updates an app through its package manager or the maker's own download after
// checking the maker's signature. Nothing runs while the part is off; with it
// on, one look a day (Settings → General → App updates), slower while you are away and
// never while the screen is locked.

import { app, shell } from 'electron';
import { existsSync, promises as fsp, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppUpdatesApi, AppUpdatesView } from '../../core/api-app-updates';
import {
  appUpdateFindings, checkDue, emptyUpdates, feedUpdate, mergeUpdates, normalizeAppUpdateSettings, ownApp, parseAppcast, parseAptUpgradable, parseBrewOutdated,
  parseDnfCheckUpdate, parseFlatpakUpdates, parseSnapRefresh, parseWingetUpgrade, safeUrl, type AppUpdate, type UpdatesState,
} from '../../core/app-updates';
import { downloadName, ed25519Valid } from '../../core/app-updates-verify';
import { run } from '../../core/platform';
import { settings } from '../store';
import { featureOn, onFeature } from './features';
import { poll } from './governor';
import { refresh as refreshGuide, registerFindings } from './guide';

const FEATURE = 'appUpdates';
const OS = process.platform;
const file = () => path.join(app.getPath('userData'), 'app-updates.json');
const options = () => normalizeAppUpdateSettings(settings().appUpdates);

let data: UpdatesState | null = null;
let checking: Promise<UpdatesState> | null = null;
const busy = new Set<string>();
let broadcast: (channel: string) => void = () => undefined;

function load(): UpdatesState {
  if (data) return data;
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as UpdatesState;
    data = { ...emptyUpdates(), ...raw, updates: Array.isArray(raw.updates) ? raw.updates : [], notes: Array.isArray(raw.notes) ? raw.notes : [] };
  } catch {
    data = emptyUpdates();
  }
  return data;
}

async function save(next: UpdatesState) {
  data = next;
  const tmp = `${file()}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(next)).catch(() => undefined);
  await fsp.rename(tmp, file()).catch(() => undefined);
  broadcast('app-updates-changed');
  void refreshGuide('appUpdates');
}

function sourcesWords(): string {
  if (OS === 'darwin') return 'Each app’s own update feed and Homebrew';
  if (OS === 'win32') return 'winget, the Windows package manager';
  return 'Flatpak, Snap and your system’s packages';
}

const view = (): AppUpdatesView => ({ ...load(), checking: !!checking, busy: [...busy], sources: sourcesWords() });

// ---------------------------------------------------------------- looking

async function fetchText(url: string, max = 2 * 1024 * 1024): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'follow', headers: { 'user-agent': `Keeper/${app.getVersion()} (update check)` } });
    if (!r.ok || !safeUrl(r.url || url)) return null;
    const text = await r.text();
    return text.length > max ? null : text;
  } catch {
    return null;
  }
}

function brewPath(): string | null {
  for (const p of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew', '/home/linuxbrew/.linuxbrew/bin/brew']) if (existsSync(p)) return p;
  return null;
}

async function macFeeds(notes: string[]): Promise<{ updates: AppUpdate[]; store: number }> {
  const { listApps } = await import('./apps');
  const apps = await listApps();
  const macVersion = (await run('/usr/bin/sw_vers', ['-productVersion'], 4000)).stdout.trim() || undefined;
  const feeds = apps.filter((a) => a.feedUrl && !a.store && !a.system && !ownApp(a.id));
  const insecure = feeds.filter((a) => !safeUrl(a.feedUrl));
  if (insecure.length) notes.push(`${insecure.length} app${insecure.length === 1 ? ' checks' : 's check'} for updates over a plain connection, so Keeper leaves ${insecure.length === 1 ? 'it' : 'them'} to update ${insecure.length === 1 ? 'itself' : 'themselves'}: ${insecure.slice(0, 3).map((a) => a.name).join(', ')}.`);
  const out: AppUpdate[] = [];
  const queue = feeds.filter((a) => safeUrl(a.feedUrl));
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      const xml = await fetchText(a.feedUrl!);
      const u = xml ? feedUpdate({ id: a.id, name: a.name, path: a.path, version: a.version, build: a.build, feedUrl: a.feedUrl!, publicKey: a.edKey }, parseAppcast(xml), macVersion) : null;
      if (u) out.push(u);
    }
  }));
  return { updates: out, store: apps.filter((a) => a.store).length };
}

async function brewUpdates(notes: string[]): Promise<AppUpdate[]> {
  const brew = brewPath();
  if (!brew) return [];
  const r = await run(brew, ['outdated', '--json=v2', ...(options().selfUpdating ? ['--greedy'] : [])], 180_000);
  if (!r.stdout.trim()) {
    if (!r.ok) notes.push('Homebrew did not answer.');
    return [];
  }
  return parseBrewOutdated(r.stdout).map((u) => (u.action.kind === 'run' ? { ...u, action: { kind: 'run' as const, cmd: { ...u.action.cmd, file: brew } } } : u));
}

async function check(): Promise<UpdatesState> {
  const notes: string[] = [];
  const lists: AppUpdate[][] = [];
  let storeApps = 0;
  let system: UpdatesState['system'];
  if (OS === 'darwin') {
    const f = await macFeeds(notes);
    lists.push(f.updates);
    storeApps = f.store;
    lists.push(await brewUpdates(notes));
  } else if (OS === 'win32') {
    const r = await run('winget', ['upgrade', '--accept-source-agreements'], 180_000);
    if (!r.stdout.trim() && !r.ok) notes.push('winget is not installed. It comes with the App Installer from the Microsoft Store.');
    else lists.push(parseWingetUpgrade(r.stdout));
  } else {
    const [fpList, fpUp] = await Promise.all([run('flatpak', ['list', '--app', '--columns=application,version'], 30_000), run('flatpak', ['remote-ls', '--updates', '--app', '--columns=application,version,name'], 120_000)]);
    if (fpList.ok) lists.push(parseFlatpakUpdates(fpList.stdout, fpUp.stdout));
    const [snRef, snList] = await Promise.all([run('snap', ['refresh', '--list'], 60_000), run('snap', ['list'], 30_000)]);
    if (snRef.ok || snRef.stdout.trim()) lists.push(parseSnapRefresh(snRef.stdout, snList.stdout));
    const apt = await run('apt', ['list', '--upgradable'], 60_000);
    if (apt.ok && apt.stdout.includes('[')) {
      const p = parseAptUpgradable(apt.stdout);
      if (p.length) system = { count: p.length, security: p.filter((x) => x.security).length, manager: 'apt' };
      notes.push('System packages are counted as of the last time your system refreshed its package lists.');
    } else {
      const dnf = await run('dnf', ['check-update', '-q'], 120_000);
      if (dnf.stdout.trim()) {
        const sec = await run('dnf', ['updateinfo', 'list', '--security', '-q'], 60_000);
        const p = parseDnfCheckUpdate(dnf.stdout, sec.stdout);
        if (p.length) system = { count: p.length, security: p.filter((x) => x.security).length, manager: 'dnf' };
      }
    }
    const brew = brewPath();
    if (brew) lists.push(await brewUpdates(notes));
  }
  const next: UpdatesState = { checkedAt: Date.now(), updates: mergeUpdates(lists), system, notes, storeApps };
  await save(next);
  return next;
}

function checkNow(): Promise<UpdatesState> {
  checking ??= (async () => {
    broadcast('app-updates-changed');
    try { return await check(); } finally { checking = null; }
  })();
  return checking;
}

// ---------------------------------------------------------------- updating

const RUNNERS = new Set(['brew', 'winget', 'flatpak', 'snap']);

async function runUpdate(u: AppUpdate): Promise<{ ok: boolean; message: string }> {
  if (u.action.kind !== 'run') return { ok: false, message: 'This one opens the maker’s download' };
  const cmd = u.action.cmd;
  const base = path.basename(cmd.file).replace(/\.exe$/i, '');
  if (!RUNNERS.has(base)) return { ok: false, message: 'Keeper does not run that program' };
  const { runCmds } = await import('./elevate');
  const r = await runCmds([cmd], 30 * 60_000);
  return r.ok ? { ok: true, message: `${u.name} is up to date` } : { ok: false, message: r.message };
}

/** The maker's download, saved to Downloads, checked against the key inside the installed app, then opened. */
async function downloadUpdate(u: AppUpdate): Promise<{ ok: boolean; message: string }> {
  if (u.action.kind !== 'download' || !safeUrl(u.action.url)) return { ok: false, message: 'There is no safe download for this one' };
  const r = await fetch(u.action.url, { signal: AbortSignal.timeout(20 * 60_000), redirect: 'follow' });
  if (!r.ok || !safeUrl(r.url || u.action.url)) return { ok: false, message: 'The download did not start' };
  const body = Buffer.from(await r.arrayBuffer());
  if (u.action.length && body.length !== u.action.length) return { ok: false, message: 'The download is not the size the maker lists; it was not opened' };
  if (!ed25519Valid(u.action.publicKey, u.action.edSignature, body)) return { ok: false, message: 'The download does not carry the maker’s signature; it was not opened' };
  const dir = app.getPath('downloads') || path.join(os.homedir(), 'Downloads');
  let dest = path.join(dir, downloadName(r.url || u.action.url, `${u.name} ${u.latest}`));
  for (let i = 2; existsSync(dest); i++) dest = path.join(dir, `${path.parse(dest).name.replace(/ \(\d+\)$/, '')} (${i})${path.extname(dest)}`);
  await fsp.writeFile(dest, body);
  const err = await shell.openPath(dest);
  return { ok: !err, message: err ? `Saved to Downloads; open it to install (${err})` : `Checked and opened. Follow the steps to replace ${u.name}.` };
}

async function update(id: string): Promise<{ ok: boolean; message: string }> {
  if (!featureOn(FEATURE)) return { ok: false, message: 'App updates are off' };
  const u = load().updates.find((x) => x.id === id);
  if (!u) return { ok: false, message: 'That update is no longer listed' };
  if (busy.has(id)) return { ok: false, message: 'Already updating' };
  busy.add(id);
  broadcast('app-updates-changed');
  try {
    let res: { ok: boolean; message: string };
    if (u.action.kind === 'open') {
      if (!safeUrl(u.action.url)) return { ok: false, message: 'There is no safe page for this one' };
      await shell.openExternal(u.action.url);
      return { ok: true, message: `Opened ${u.name}’s download page` };
    }
    res = u.action.kind === 'run' ? await runUpdate(u) : await downloadUpdate(u).catch((e) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    // A package manager's update is done: the row goes. A download still needs the person to install it.
    if (res.ok && u.action.kind === 'run') await save({ ...load(), updates: load().updates.filter((x) => x.id !== id) });
    return res;
  } finally {
    busy.delete(id);
    broadcast('app-updates-changed');
  }
}

async function updateAll() {
  let done = 0;
  let failed = 0;
  let last = '';
  for (const u of load().updates.filter((x) => x.action.kind === 'run')) {
    const r = await update(u.id);
    if (r.ok) done++;
    else { failed++; last = r.message; }
  }
  return { ok: failed === 0, done, failed, message: failed ? `${done} updated, ${failed} not: ${last}` : `${done} app${done === 1 ? '' : 's'} updated` };
}

async function openSystemUpdater(): Promise<{ ok: boolean; message: string }> {
  if (OS === 'darwin') { await shell.openExternal('x-apple.systempreferences:com.apple.Software-Update-Settings.extension'); return { ok: true, message: 'Opened Software Update' }; }
  if (OS === 'win32') { await shell.openExternal('ms-settings:windowsupdate'); return { ok: true, message: 'Opened Windows Update' }; }
  const { spawn } = await import('node:child_process');
  for (const [cmd, args] of [['gnome-software', ['--mode=updates']], ['update-manager', []], ['plasma-discover', ['--mode', 'Update']], ['mintupdate', []]] as [string, string[]][]) {
    const which = await run('which', [cmd], 3000);
    if (!which.ok) continue;
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref();
    return { ok: true, message: 'Opened your system’s updater' };
  }
  const m = load().system?.manager === 'dnf' ? 'sudo dnf upgrade' : 'sudo apt upgrade';
  return { ok: false, message: `No updater app was found. In a terminal, run: ${m}` };
}

async function openStore() {
  await shell.openExternal(OS === 'darwin' ? 'macappstore://showUpdatesPage' : 'ms-windows-store://downloadsandupdates');
}

export const appUpdatesApi: AppUpdatesApi = {
  state: async () => view(),
  check: async () => { if (featureOn(FEATURE)) await checkNow(); return view(); },
  update,
  updateAll,
  openSystemUpdater,
  openStore,
};

// ---------------------------------------------------------------- schedule

let stopPoll: (() => void) | undefined;

function schedule(on: boolean) {
  stopPoll?.();
  stopPoll = undefined;
  if (!on) return;
  // One look every half hour whether a check is due; the check itself runs once a day by default.
  stopPoll = poll('appUpdates.check', { baseMs: 30 * 60_000, pauseWhenLocked: true, idleFactor: 2 }, () => {
    const o = options();
    if (o.auto && checkDue(load().checkedAt, o.everyHours)) return checkNow();
    return undefined;
  }, { feature: FEATURE, now: false });
}

export function startAppUpdates(d: { broadcast: (channel: string) => void }) {
  broadcast = d.broadcast;
  registerFindings('appUpdates', () => (featureOn(FEATURE) ? appUpdateFindings(load()) : []));
  onFeature(FEATURE, schedule, { now: true });
}
