// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places on this computer: favourite folders, cloud drives, disks, network
// shares and servers announcing themselves on the network; Connect to Server,
// ejecting, the Trash / Recycle Bin, and sharing (AirDrop and friends).

import { BrowserWindow, dialog, ShareMenu, shell } from 'electron';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { existsSync, promises as fsp, readdirSync, statSync, watch as watchDir } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ConnectRequest, ConnectResult, ShareTarget, TrashItem, TrashListing } from '../../core/api-places';
import type { Journal } from '../../core/journal';
import {
  buildMdnsQuery, buildTrashInfo, classifyMounts, detectCloud, favoriteFolders, MDNS_SERVICES, parseLsblk, parseMacMount, parseMdnsResponse,
  parseProcMounts, parseServerAddress, parseTrashInfo, parseWinDisks, serversFromRecords, type DiscoveredServer, type MdnsRecord, type Place, type PlacesModel,
} from '../../core/places';
import { powershell, run } from '../../core/platform';
import { uniqueName } from '../../core/rules';
import { settings, updateSettings } from '../store';
import { poll } from './governor';

const home = () => os.homedir();
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

const listDir = (d: string) => {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
};

/** statfs can hang on a server that went away; never wait for it more than a moment. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<T>((r) => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t));
}

async function sizes(p: Place): Promise<Place> {
  if (p.total !== undefined) return p;
  const st = await withTimeout(fsp.statfs(p.path).then((s) => s, () => null), 1500, null);
  return st ? { ...p, total: st.blocks * st.bsize, free: st.bavail * st.bsize } : p;
}

// ---------------------------------------------------------------- the model

async function computerName(): Promise<string> {
  if (isMac) {
    const r = await run('/usr/sbin/scutil', ['--get', 'ComputerName'], 3000);
    if (r.ok && r.stdout.trim()) return r.stdout.trim();
  }
  return os.hostname().replace(/\.local$/, '');
}

/** plist <key>Name</key><true/> / <string>…</string> lookups, enough for diskutil's output. */
function plistValue(xml: string, key: string): string | boolean | undefined {
  const m = xml.match(new RegExp(`<key>${key}</key>\\s*<(true|false|string|integer)\\s*/?>([^<]*)`));
  if (!m) return undefined;
  if (m[1] === 'true') return true;
  if (m[1] === 'false') return false;
  return m[2];
}

const diskInfo = new Map<string, Awaited<ReturnType<typeof run>>>();

async function macDisks(): Promise<{ volumes: Place[]; network: Place[] }> {
  const mounts = parseMacMount((await run('/sbin/mount', [], 5000)).stdout);
  const images = new Set<string>();
  const removable = new Set<string>();
  const optical = new Set<string>();
  const labels = new Map<string, string>();
  const vols = mounts.filter((m) => m.mount === '/' || m.mount.startsWith('/Volumes/')).filter((m) => m.device.startsWith('/dev/'));
  for (const k of [...diskInfo.keys()]) if (!vols.some((m) => `${m.device}\u0000${m.mount}` === k)) diskInfo.delete(k);
  await Promise.all(vols.map(async (m) => {
    // A mounted volume's kind and name do not change: diskutil runs once per mount, not on every look.
    const key = `${m.device}\u0000${m.mount}`;
    let r = diskInfo.get(key);
    if (!r) {
      r = await run('/usr/sbin/diskutil', ['info', '-plist', m.mount], 5000);
      if (r.ok) diskInfo.set(key, r);
    }
    if (!r.ok) return;
    const proto = plistValue(r.stdout, 'BusProtocol') ?? plistValue(r.stdout, 'Protocol');
    if (proto === 'Disk Image' || plistValue(r.stdout, 'VirtualOrPhysical') === 'Virtual' && m.mount !== '/') images.add(m.mount);
    if (plistValue(r.stdout, 'RemovableMedia') === true || plistValue(r.stdout, 'Ejectable') === true || plistValue(r.stdout, 'Internal') === false) removable.add(m.mount);
    if (plistValue(r.stdout, 'OpticalDeviceType')) optical.add(m.mount);
    const name = plistValue(r.stdout, 'VolumeName');
    if (typeof name === 'string' && name) labels.set(m.mount, name);
  }));
  return classifyMounts('darwin', mounts, { images, removable, optical, labels });
}

/** GNOME/GTK keep network mounts made with gio under /run/user/<uid>/gvfs. */
function gvfsMounts(): Place[] {
  const dir = `/run/user/${process.getuid?.() ?? 1000}/gvfs`;
  return listDir(dir).map((n) => {
    const kv = Object.fromEntries(n.replace(/^[^:]+:/, '').split(',').map((p) => p.split('=') as [string, string]));
    const proto = n.split(':')[0].replace(/-share$/, '');
    const server = kv.server ?? kv.host ?? n;
    const share = kv.share ?? kv.prefix?.replace(/^%2F/, '') ?? '';
    return { id: `net:${dir}/${n}`, name: share ? `${share} on ${server}` : server, path: `${dir}/${n}`, kind: 'network' as const, icon: 'globe', volume: 'network' as const, ejectable: true, protocol: proto === 'dav' ? 'webdav' : proto, server };
  });
}

async function linuxDisks(): Promise<{ volumes: Place[]; network: Place[] }> {
  const mounts = parseProcMounts(await fsp.readFile('/proc/mounts', 'utf8').catch(() => ''));
  const blk = parseLsblk((await run('lsblk', ['-J', '-b', '-o', 'NAME,PATH,RM,HOTPLUG,TYPE,MOUNTPOINT,LABEL'], 5000)).stdout);
  const { volumes, network } = classifyMounts('linux', mounts, blk);
  return { volumes, network: [...network, ...gvfsMounts()] };
}

let winDrives: { letter: string; label: string }[] = [];

async function winDisks(): Promise<{ volumes: Place[]; network: Place[] }> {
  const r = await powershell('Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,VolumeName,ProviderName,Size,FreeSpace | ConvertTo-Json -Compress', 20_000);
  const parsed = parseWinDisks(r.stdout);
  winDrives = parsed.drives;
  return parsed;
}

let lastModel: PlacesModel | null = null;

export async function listPlaces(): Promise<PlacesModel> {
  const s = settings();
  const disks = isMac ? await macDisks() : isWin ? await winDisks() : await linuxDisks();
  const exists = (p: string) => existsSync(p);
  const hidden = new Set(s.hiddenPlaces ?? []);
  const favorites = favoriteFolders(process.platform, home(), exists);
  // Folders the person pinned join the favourites.
  for (const p of s.pinned) if (!favorites.some((f) => f.path === p)) favorites.push({ id: `pin:${p}`, name: path.basename(p) || p, path: p, kind: 'folder', icon: 'folder' });
  const cloud = detectCloud({ platform: process.platform, home: home(), env: process.env, list: listDir, exists, drives: winDrives });
  const [volumes, network] = await Promise.all([Promise.all(disks.volumes.map(sizes)), Promise.all(disks.network.map(sizes))]);
  const icloud = cloud.find((c) => c.provider === 'iCloud Drive');
  const model: PlacesModel = {
    computerName: await computerName(),
    home: home(),
    favorites: favorites.filter((p) => !hidden.has(p.id)),
    cloud: cloud.filter((p) => !hidden.has(p.id)),
    volumes,
    network,
    shared: icloud ? { id: 'shared', name: 'Shared', path: icloud.path, kind: 'shared', icon: 'island' } : undefined,
    airdrop: isMac,
  };
  lastModel = model;
  return model;
}

/** Network drives and cloud folders the library should not walk (unless the person asks). */
export function remoteFolders(): string[] {
  if (!lastModel) return [];
  return [...lastModel.network.map((n) => n.path), ...lastModel.cloud.map((c) => c.path)];
}

// ---------------------------------------------------------------- watching for changes

let watchTimer: NodeJS.Timeout | undefined;
let lastKey = '';

/**
 * A cheap sign that disks or servers changed, read without starting any
 * program: the mount table on Linux, /Volumes on a Mac, the drive letters on
 * Windows. Only when it changes does the full (slower) listing run.
 */
async function mountSignature(): Promise<string> {
  if (isMac) return listDir('/Volumes').join('|');
  if (isWin) {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const present = await Promise.all(letters.map((l) => withTimeout(fsp.stat(`${l}:\\`).then(() => l, () => ''), 1000, '')));
    return present.join('');
  }
  const mounts = await fsp.readFile('/proc/self/mountinfo', 'utf8').catch(() => '');
  return mounts.split('\n').map((l) => l.split(' ')[4]).join('|') + '#' + listDir(`/run/user/${process.getuid?.() ?? 1000}/gvfs`).join('|');
}

let stopWatch: (() => void) | undefined;
let lastSig = '';
let lastFull = 0;

export function watchPlaces(onChange: () => void) {
  const full = async () => {
    lastFull = Date.now();
    try {
      const m = await listPlaces();
      const key = JSON.stringify([m.volumes.map((v) => v.path), m.network.map((n) => n.path), m.cloud.map((c) => c.path)]);
      if (lastKey && key !== lastKey) onChange();
      lastKey = key;
    } catch {
      /* try again next time */
    }
  };
  const tick = async () => {
    const sig = await mountSignature().catch(() => '');
    // Cloud folders appear without a mount: a full look every few minutes catches them.
    if (sig !== lastSig || Date.now() - lastFull > 5 * 60_000) {
      lastSig = sig;
      await full();
    }
  };
  stopWatch?.();
  clearInterval(watchTimer);
  // On a Mac, /Volumes changes the moment a disk comes or goes, so the regular look can be rare.
  let volWatch: import('node:fs').FSWatcher | undefined;
  if (isMac) {
    try {
      volWatch = watchDir('/Volumes', () => void tick());
    } catch {
      volWatch = undefined;
    }
  }
  const stopPoll = poll('places.mounts', { baseMs: volWatch ? 30_000 : 4000, idleFactor: volWatch ? 2 : 8, pauseWhenLocked: true }, tick, { feature: 'places' });
  stopWatch = () => { stopPoll(); volWatch?.close(); };
}

// ---------------------------------------------------------------- eject

export async function eject(p: string): Promise<{ ok: boolean; message?: string }> {
  const model = lastModel ?? (await listPlaces());
  const place = [...model.volumes, ...model.network].find((x) => x.path === p);
  if (!place || !place.ejectable) return { ok: false, message: 'That disk cannot be ejected' };
  let ok = false;
  if (isMac) {
    ok = (await run('/usr/sbin/diskutil', [place.kind === 'network' ? 'unmount' : 'eject', p], 60_000)).ok;
    if (!ok) ok = (await run('/sbin/umount', [p], 30_000)).ok;
  } else if (isWin) {
    const letter = p.slice(0, 2);
    if (place.kind === 'network') ok = (await run('net', ['use', letter, '/delete', '/y'], 30_000)).ok;
    else {
      const r = await powershell(`(New-Object -comObject Shell.Application).Namespace(17).ParseName('${letter}').InvokeVerb('Eject'); Start-Sleep -Milliseconds 800; if (Test-Path '${letter}\\') { exit 1 }`, 30_000);
      ok = r.ok;
    }
  } else if (p.includes('/gvfs/')) {
    ok = (await run('gio', ['mount', '-u', p], 30_000)).ok;
  } else {
    ok = (await run('gio', ['mount', '-e', p], 30_000)).ok;
    if (!ok) {
      const dev = (await fsp.readFile('/proc/mounts', 'utf8')).split('\n').map((l) => l.split(' ')).find((x) => x[1] === p.replace(/ /g, '\\040'))?.[0];
      if (dev) {
        ok = (await run('udisksctl', ['unmount', '-b', dev], 30_000)).ok;
        if (ok) await run('udisksctl', ['power-off', '-b', dev.replace(/p?\d+$/, '')], 30_000);
      } else ok = (await run('umount', [p], 30_000)).ok;
    }
  }
  await listPlaces().catch(() => undefined);
  return ok ? { ok } : { ok, message: `Could not eject ${place.name}. Close any files that are open on it and try again.` };
}

// ---------------------------------------------------------------- connect to server

async function remember(address: string) {
  const list = [address, ...(settings().recentServers ?? []).filter((a) => a !== address)].slice(0, 12);
  await updateSettings({ recentServers: list });
}

export async function recentServers(): Promise<string[]> {
  return settings().recentServers ?? [];
}

export async function forgetServer(address: string): Promise<string[]> {
  const list = (settings().recentServers ?? []).filter((a) => a !== address);
  await updateSettings({ recentServers: list });
  return list;
}

function runWithInput(file: string, args: string[], input: string, timeout = 60_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const t = setTimeout(() => child.kill(), timeout);
    child.on('error', () => resolve({ ok: false, out: 'not available' }));
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, out });
    });
    child.stdin.end(input);
  });
}

export async function connect(req: ConnectRequest): Promise<ConnectResult> {
  const a = parseServerAddress(req.address);
  if (!a) return { ok: false, message: 'That does not look like a server address. Try smb://server/share or \\\\server\\share.' };
  const before = new Set([...(lastModel?.network ?? []).map((n) => n.path)]);
  let result: ConnectResult;
  if (isMac) {
    // The system mounts it and asks for the name and password itself, with the keychain.
    const url = req.user && !a.user ? a.url.replace('://', `://${encodeURIComponent(req.user)}@`) : a.url;
    const r = await run('/usr/bin/open', [url], 15_000);
    result = r.ok ? { ok: true, path: a.share ? `/Volumes/${a.share.split('/').pop()}` : undefined, message: 'Connecting… your Mac may ask for a name and password.' } : { ok: false, message: 'The server did not answer' };
  } else if (isWin) {
    if (a.protocol === 'smb' && a.unc) {
      if (!a.share) {
        await run('explorer.exe', [a.unc], 10_000);
        result = { ok: true, message: 'Opened the server in File Explorer to choose a shared folder.' };
      } else {
        const args = ['use', '*', a.unc, ...(req.password ? [req.password] : []), ...(req.user || a.user ? [`/user:${req.user ?? a.user}`] : []), '/persistent:no'];
        const r = await run('net', args, 60_000);
        const letter = (r.stdout + r.stderr).match(/\b([A-Z]):/)?.[1];
        result = r.ok ? { ok: true, path: letter ? `${letter}:\\` : a.unc } : { ok: false, message: (r.stderr || r.stdout).trim().split('\n')[0] || 'Could not connect' };
      }
    } else if (a.protocol === 'webdav' || a.protocol === 'webdavs') {
      const r = await run('net', ['use', '*', a.url, ...(req.password ? [req.password] : []), ...(req.user ? [`/user:${req.user}`] : [])], 60_000);
      const letter = r.stdout.match(/\b([A-Z]):/)?.[1];
      result = r.ok ? { ok: true, path: letter ? `${letter}:\\` : undefined } : { ok: false, message: 'Could not connect to the WebDAV server' };
    } else {
      await shell.openExternal(a.url);
      result = { ok: true, message: 'Opened with the app your system uses for this kind of server.' };
    }
  } else {
    // gio asks for user, domain and password on its input when the server wants them.
    const r = await runWithInput('gio', ['mount', a.url], `${req.user ?? a.user ?? ''}\n\n${req.password ?? ''}\n`, 60_000);
    const already = /already mounted/i.test(r.out);
    if (r.ok || already) {
      await listPlaces().catch(() => undefined);
      const added = (lastModel?.network ?? []).find((n) => !before.has(n.path) || (n.server === a.host && (!a.share || n.name.startsWith(a.share))));
      result = { ok: true, path: added?.path };
    } else result = { ok: false, message: r.out.trim().split('\n').pop() || 'Could not connect' };
  }
  if (result.ok && req.remember !== false) await remember(req.address.trim());
  return result;
}

// ---------------------------------------------------------------- finding servers

export function discover(timeoutMs = 2000): Promise<DiscoveredServer[]> {
  return new Promise((resolve) => {
    const records: MdnsRecord[] = [];
    const extra: DiscoveredServer[] = [];
    let sock: dgram.Socket | null = null;
    const finish = () => {
      try {
        sock?.close();
      } catch {
        /* closed */
      }
      const found = serversFromRecords(records);
      for (const e of extra) if (!found.some((f) => f.name.toLowerCase() === e.name.toLowerCase())) found.push(e);
      resolve(found.sort((a, b) => a.name.localeCompare(b.name)));
    };
    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('message', (msg) => records.push(...parseMdnsResponse(new Uint8Array(msg))));
      sock.on('error', () => finish());
      // Asking from an ordinary port makes responders answer us directly.
      sock.bind(0, () => {
        const q = buildMdnsQuery(Object.keys(MDNS_SERVICES));
        sock?.send(q, 5353, '224.0.0.251', () => undefined);
        setTimeout(() => sock?.send(q, 5353, '224.0.0.251', () => undefined), 400);
      });
    } catch {
      /* no network */
    }
    if (isWin) {
      // Windows file sharing that does not announce itself over mDNS.
      void run('net', ['view'], 4000).then((r) => {
        for (const m of r.stdout.matchAll(/^\\\\(\S+)/gm)) extra.push({ name: m[1], host: m[1], protocols: ['smb'] });
      });
    }
    setTimeout(finish, timeoutMs);
  });
}

// ---------------------------------------------------------------- folder size

export async function folderSize(dir: string): Promise<{ size: number; files: number; folders: number }> {
  let size = 0;
  let files = 0;
  let folders = 0;
  const stack = [dir];
  const started = Date.now();
  while (stack.length && Date.now() - started < 60_000) {
    const d = stack.pop()!;
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        folders++;
        stack.push(p);
      } else if (e.isFile()) {
        try {
          size += (await fsp.lstat(p)).size;
          files++;
        } catch {
          /* gone */
        }
      }
    }
  }
  return { size, files, folders };
}

// ---------------------------------------------------------------- trash

function linuxTrashDirs(): { files: string; info: string; volume: string; root: string }[] {
  const uid = process.getuid?.() ?? 1000;
  const dirs = [{ files: path.join(home(), '.local', 'share', 'Trash', 'files'), info: path.join(home(), '.local', 'share', 'Trash', 'info'), volume: 'Home', root: '/' }];
  for (const p of lastModel?.volumes ?? []) {
    for (const t of [path.join(p.path, `.Trash-${uid}`), path.join(p.path, '.Trash', String(uid))]) {
      if (p.path !== '/' && existsSync(path.join(t, 'files'))) dirs.push({ files: path.join(t, 'files'), info: path.join(t, 'info'), volume: p.name, root: p.path });
    }
  }
  return dirs;
}

function macTrashDirs(): { dir: string; volume: string }[] {
  const uid = process.getuid?.() ?? 501;
  const dirs = [{ dir: path.join(home(), '.Trash'), volume: 'Macintosh HD' }];
  for (const p of lastModel?.volumes ?? []) {
    const t = path.join(p.path, '.Trashes', String(uid));
    if (p.path !== '/' && existsSync(t)) dirs.push({ dir: t, volume: p.name });
  }
  return dirs;
}

async function entrySize(p: string): Promise<{ size: number; isDir: boolean }> {
  try {
    const st = await fsp.lstat(p);
    if (!st.isDirectory()) return { size: st.size, isDir: false };
    return { size: (await folderSize(p)).size, isDir: true };
  } catch {
    return { size: 0, isDir: false };
  }
}

let journalRef: () => Journal | undefined = () => undefined;
export function useJournal(j: () => Journal | undefined) {
  journalRef = j;
}

/** Where Keeper itself sent an item: the newest trash operation for a file of that name. */
function originalFromJournal(name: string): { path: string; at: number } | undefined {
  const j = journalRef();
  if (!j) return undefined;
  for (const e of j.list()) {
    for (const op of e.ops) if (op.type === 'trash' && path.basename(op.from) === name) return { path: op.from, at: e.at };
  }
  return undefined;
}

export async function listTrash(): Promise<TrashListing> {
  if (isWin) {
    const r = await powershell(`$s = New-Object -ComObject Shell.Application; $b = $s.NameSpace(10); @($b.Items() | ForEach-Object { [pscustomobject]@{ id = $_.Path; name = $_.Name; size = [int64]$_.Size; dir = $_.IsFolder; from = $_.ExtendedProperty('System.Recycle.DeletedFrom'); at = $_.ExtendedProperty('System.Recycle.DateDeleted') } }) | ConvertTo-Json -Compress`, 60_000);
    let raw: { id: string; name: string; size: number; dir: boolean; from?: string; at?: string }[] = [];
    try {
      const j = JSON.parse(r.stdout || '[]');
      raw = Array.isArray(j) ? j : [j];
    } catch {
      raw = [];
    }
    const items: TrashItem[] = raw.filter(Boolean).map((x) => ({
      id: x.id, name: x.name, size: x.size || 0, isDir: !!x.dir, original: x.from ? path.join(x.from, x.name) : undefined,
      deletedAt: x.at ? Date.parse(String(x.at).replace(/[^\x20-\x7e]/g, '')) || undefined : undefined, volume: x.id.slice(0, 2),
    }));
    return { items, canRestore: true };
  }
  if (isMac) {
    const items: TrashItem[] = [];
    let blocked = false;
    for (const t of macTrashDirs()) {
      let names: string[];
      try {
        names = await fsp.readdir(t.dir);
      } catch {
        blocked = true;
        continue;
      }
      for (const n of names.filter((x) => x !== '.DS_Store' && x !== '.localized')) {
        const p = path.join(t.dir, n);
        const { size, isDir } = await entrySize(p);
        const known = originalFromJournal(n);
        const st = await fsp.lstat(p).catch(() => null);
        items.push({ id: p, name: n, size, isDir, original: known?.path, deletedAt: known?.at ?? st?.ctimeMs, volume: t.volume });
      }
    }
    return {
      items: items.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
      canRestore: true,
      note: blocked ? 'macOS only shows the Trash to apps with Full Disk Access (System Settings → Privacy & Security → Full Disk Access → Keeper).' : undefined,
    };
  }
  const items: TrashItem[] = [];
  for (const t of linuxTrashDirs()) {
    for (const n of listDir(t.files)) {
      const p = path.join(t.files, n);
      const info = parseTrashInfo(await fsp.readFile(path.join(t.info, `${n}.trashinfo`), 'utf8').catch(() => ''));
      const { size, isDir } = await entrySize(p);
      // Per-disk trashes store paths relative to the disk they are on.
      const original = info ? (path.isAbsolute(info.path) ? info.path : path.join(t.root, info.path)) : originalFromJournal(n)?.path;
      items.push({ id: p, name: n, size, isDir, original, deletedAt: info?.deletedAt, volume: t.volume });
    }
  }
  return { items: items.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)), canRestore: true };
}

/** Only paths inside a trash folder may be restored or deleted from here. */
function inTrash(p: string): boolean {
  const roots = isMac ? macTrashDirs().map((t) => t.dir) : linuxTrashDirs().map((t) => t.files);
  const real = path.resolve(p);
  return roots.some((r) => real.startsWith(path.resolve(r) + path.sep));
}

export async function restoreTrash(ids: string[]): Promise<{ restored: number; failed: string[] }> {
  let restored = 0;
  const failed: string[] = [];
  if (isWin) {
    const list = ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(',');
    const r = await powershell(`$want = @(${list}); $b = (New-Object -ComObject Shell.Application).NameSpace(10); $n = 0; foreach ($i in @($b.Items())) { if ($want -contains $i.Path) { $i.InvokeVerb('undelete'); $n++ } }; $n`, 120_000);
    restored = Number(r.stdout.trim()) || 0;
    if (restored < ids.length) failed.push(`${ids.length - restored} item(s) could not be put back`);
    return { restored, failed };
  }
  const listing = await listTrash();
  for (const id of ids) {
    const item = listing.items.find((i) => i.id === id);
    if (!item || !inTrash(id)) {
      failed.push(path.basename(id));
      continue;
    }
    let target = item.original;
    if (!target) {
      // Nothing recorded where it came from: ask.
      const win = BrowserWindow.getFocusedWindow() ?? undefined;
      const pick = await dialog.showOpenDialog(win!, { title: `Where should “${item.name}” go back to?`, properties: ['openDirectory', 'createDirectory'], defaultPath: path.join(home(), 'Desktop') });
      if (pick.canceled || !pick.filePaths[0]) {
        failed.push(item.name);
        continue;
      }
      target = path.join(pick.filePaths[0], item.name);
    }
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const dest = uniqueName(target, existsSync);
      await fsp.rename(id, dest).catch(async (e: NodeJS.ErrnoException) => {
        if (e.code !== 'EXDEV') throw e;
        await fsp.cp(id, dest, { recursive: true, preserveTimestamps: true });
        await fsp.rm(id, { recursive: true, force: true });
      });
      if (!isMac) {
        const t = linuxTrashDirs().find((d) => id.startsWith(d.files + path.sep));
        if (t) await fsp.rm(path.join(t.info, `${path.basename(id)}.trashinfo`), { force: true });
      }
      restored++;
    } catch {
      failed.push(item.name);
    }
  }
  return { restored, failed };
}

export async function removeFromTrash(ids: string[]): Promise<{ removed: number; failed: string[] }> {
  let removed = 0;
  const failed: string[] = [];
  if (isWin) {
    for (const id of ids) {
      // Each Recycle Bin item is a $R… file with a matching $I… record.
      if (!/\\\$Recycle\.Bin\\/i.test(id)) {
        failed.push(id);
        continue;
      }
      try {
        await fsp.rm(id, { recursive: true, force: true });
        await fsp.rm(path.join(path.dirname(id), path.basename(id).replace(/^\$R/i, '$I')), { force: true });
        removed++;
      } catch {
        failed.push(path.basename(id));
      }
    }
    return { removed, failed };
  }
  for (const id of ids) {
    if (!inTrash(id)) {
      failed.push(path.basename(id));
      continue;
    }
    try {
      await fsp.rm(id, { recursive: true, force: true });
      if (!isMac) {
        const t = linuxTrashDirs().find((d) => id.startsWith(d.files + path.sep));
        if (t) await fsp.rm(path.join(t.info, `${path.basename(id)}.trashinfo`), { force: true });
      }
      removed++;
    } catch {
      failed.push(path.basename(id));
    }
  }
  return { removed, failed };
}

export async function emptyTrash(): Promise<{ ok: boolean; message?: string }> {
  if (isWin) return { ok: (await powershell('Clear-RecycleBin -Force -ErrorAction SilentlyContinue; $true', 120_000)).ok };
  if (isMac) {
    const r = await run('/usr/bin/osascript', ['-e', 'tell application "Finder" to empty trash'], 300_000);
    return r.ok ? { ok: true } : { ok: false, message: 'macOS did not let Keeper empty the Trash. Try again from Finder.' };
  }
  const listing = await listTrash();
  const r = await removeFromTrash(listing.items.map((i) => i.id));
  return { ok: r.failed.length === 0, message: r.failed.length ? `${r.failed.length} item(s) could not be removed` : undefined };
}

/** Linux: sends a file to the Trash the freedesktop way, recording where it came from (used by tests and the CLI). */
export async function trashLinux(p: string): Promise<string> {
  const t = linuxTrashDirs()[0];
  await fsp.mkdir(t.files, { recursive: true });
  await fsp.mkdir(t.info, { recursive: true });
  const dest = uniqueName(path.join(t.files, path.basename(p)), existsSync);
  await fsp.writeFile(path.join(t.info, `${path.basename(dest)}.trashinfo`), buildTrashInfo(path.resolve(p)));
  await fsp.rename(p, dest);
  return dest;
}

// ---------------------------------------------------------------- AirDrop and sharing

export async function openAirDrop() {
  if (!isMac) return;
  const app1 = '/System/Library/CoreServices/Finder.app/Contents/Applications/AirDrop.app';
  if (existsSync(app1)) await run('/usr/bin/open', [app1], 10_000);
  else await run('/usr/bin/osascript', ['-e', 'tell application "Finder" to activate', '-e', 'tell application "System Events" to keystroke "r" using {command down, shift down}'], 10_000);
}

let kdeDevices: { id: string; name: string }[] = [];

export async function shareTargets(): Promise<ShareTarget[]> {
  if (isMac) return [{ id: 'system', name: 'Share…', kind: 'system' }, { id: 'airdrop', name: 'AirDrop', kind: 'airdrop' }];
  const out: ShareTarget[] = [{ id: 'email', name: 'Email', kind: 'email' }];
  if (!isWin) {
    const r = await run('kdeconnect-cli', ['--list-available', '--id-name-only'], 4000);
    kdeDevices = r.ok ? r.stdout.split('\n').map((l) => l.trim().match(/^(\S+)\s+(.+)$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => ({ id: m[1], name: m[2] })) : [];
    out.push(...kdeDevices.map((d) => ({ id: `kde:${d.id}`, name: `Send to ${d.name}`, kind: 'device' as const })));
  }
  return out;
}

export async function share(paths: string[], target = 'system'): Promise<{ ok: boolean; message?: string }> {
  const files = paths.filter((p) => existsSync(p) && statSync(p).isFile());
  if (!files.length) return { ok: false, message: 'Choose files to share (folders can be compressed first).' };
  if (isMac) {
    if (target === 'airdrop') {
      // The share menu's AirDrop entry is the reliable way to hand files to AirDrop.
      target = 'system';
    }
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    new ShareMenu({ filePaths: files }).popup({ window: win });
    return { ok: true };
  }
  if (target.startsWith('kde:')) {
    const id = target.slice(4);
    let ok = true;
    for (const f of files) ok = (await run('kdeconnect-cli', ['-d', id, '--share', f], 60_000)).ok && ok;
    return ok ? { ok } : { ok, message: 'The device did not accept the files' };
  }
  if (isWin) {
    // Windows has no command-line share sheet: open a new mail with the files listed, and show them.
    await shell.openExternal(`mailto:?subject=${encodeURIComponent(files.map((f) => path.basename(f)).join(', '))}`);
    shell.showItemInFolder(files[0]);
    return { ok: true, message: 'Attach the files from the folder that opened.' };
  }
  const r = await run('xdg-email', [...files.flatMap((f) => ['--attach', f])], 15_000);
  return r.ok ? { ok: true } : { ok: false, message: 'No email app is set up' };
}

