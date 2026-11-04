// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Connections opened as drives (core/remote/drive.ts): rclone, already
// Keeper's way to cloud services, serves each one through its remote control
// (`mount/mount`), so Finder, File Explorer and every app see a disk. Nothing
// here runs while no drive is open; while one is, its state is read every 10
// seconds (slower when nobody is at the computer) and shown on the page and
// in the Island. Drives close when Keeper quits and, when asked, open again
// when it starts.

import { app, shell } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { driveFor, driveRemote, drivePlace, driveStatus, driveStatusText, driveSupport, macVersionFromDarwin, mountParams, type DriveFacts, type DriveStatus, type DriveSupport } from '../../../core/remote/drive';
import { settings } from '../../store';
import { featureOn, onFeature } from '../features';
import { poll } from '../governor';
import { driveDeps, list as listConnections, rcloneAvailable, setDriveOpen } from './index';
import { remoteNameFor } from './rclone';

type Emit = (channel: string, ...args: unknown[]) => void;
let emit: Emit = () => undefined;

export interface OpenDrive {
  id: string;
  name: string;
  /** the folder or drive letter it shows at */
  place: string;
  status: DriveStatus;
  /** what rclone was given as the remote (kept to ask for its numbers) */
  fs: string;
}

const open = new Map<string, OpenDrive & { release: () => void }>();
let types: string[] | null = null;
let stopPoll: (() => void) | null = null;
/** the most changes seen waiting at once in this run of sending, for the Island's ring */
const peak = new Map<string, number>();

const publicDrive = ({ release: _r, fs: _f, ...d }: OpenDrive & { release: () => void }) => d;

/** What rclone can mount with, asked once per run of rclone. */
async function mountTypes(): Promise<string[]> {
  if (types) return types;
  try {
    const rc = await (await driveDeps.rclone()).rc();
    const r = await rc.call<{ mountTypes?: string[] }>('mount/types', {}, 10_000);
    types = r.mountTypes ?? [];
  } catch {
    types = [];
  }
  return types;
}

function whichSync(cmd: string): boolean {
  return (process.env.PATH ?? '').split(path.delimiter).some((d) => d && existsSync(path.join(d, cmd)));
}

/** What this computer offers, gathered here and judged in core/remote/drive.ts. */
export async function facts(): Promise<DriveFacts> {
  const rclone = rcloneAvailable();
  const f: DriveFacts = { platform: process.platform, rclone, types: rclone ? await mountTypes() : [] };
  if (process.platform === 'darwin') {
    f.macVersion = macVersionFromDarwin(os.release());
    f.macfuse = existsSync('/Library/Filesystems/macfuse.fs') || existsSync('/Library/Filesystems/osxfuse.fs');
    f.sandboxed = !!process.mas;
  } else if (process.platform === 'win32') {
    const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, 'C:\\Program Files (x86)', 'C:\\Program Files'].filter((x): x is string => !!x);
    f.winfsp = roots.some((r) => existsSync(path.join(r, 'WinFsp', 'bin', 'winfsp-x64.dll')) || existsSync(path.join(r, 'WinFsp', 'bin', 'winfsp-a64.dll')));
    f.sandboxed = !!process.windowsStore;
  } else {
    f.fuse = existsSync('/dev/fuse') && (whichSync('fusermount3') || whichSync('fusermount'));
    f.sandboxed = !!process.env.FLATPAK_ID || !!process.env.SNAP;
  }
  return f;
}

export async function support(): Promise<DriveSupport> {
  return driveSupport(await facts());
}

export function drives(): Omit<OpenDrive, 'fs'>[] {
  return [...open.values()].map(publicDrive);
}

function opts() {
  const d = settings().drives;
  return { keepOpened: d?.keepOpened !== false, cacheGb: d?.cacheGb ?? 5 };
}

/** Opens a connection as a drive and returns where it shows. */
export async function openDrive(id: string): Promise<Omit<OpenDrive, 'fs'>> {
  if (!featureOn('driveMount')) throw new Error('Drives are switched off (Settings → Features)');
  const have = open.get(id);
  if (have) return publicDrive(have);
  const c = driveDeps.find(id);
  const can = driveFor(c);
  if (!can.ok) throw new Error(can.why);
  const sup = await support();
  if (!sup.ready || !sup.mountType) throw new Error(`${sup.title}. ${sup.detail}`);
  const daemon = await driveDeps.rclone();
  const rc = await daemon.rc();
  let obscured: string | undefined;
  if (c.kind === 'webdav') {
    const pass = await driveDeps.password(id);
    // rclone wants the password in its own scrambled form; it stays in memory, never on disk.
    if (pass) obscured = (await rc.call<{ obscured: string }>('core/obscure', { clear: pass })).obscured;
  }
  const fs = driveRemote(c, remoteNameFor(id), obscured);
  const used = process.platform === 'win32'
    ? 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => existsSync(`${l}:\\`)).map((l) => `${l}:`)
    : [...open.values()].map((d) => d.place).concat((await fsp.readdir(path.join(app.getPath('home'), 'Keeper Drives')).catch(() => [] as string[])).map((n) => path.join(app.getPath('home'), 'Keeper Drives', n)));
  let place = drivePlace(process.platform, app.getPath('home'), c.name, used);
  if (process.platform !== 'win32') {
    // An empty folder left from before is used again.
    const mine = path.join(app.getPath('home'), 'Keeper Drives', path.basename(drivePlace(process.platform, app.getPath('home'), c.name, [])));
    if ((await fsp.readdir(mine).catch(() => null))?.length === 0) place = mine;
    await fsp.mkdir(place, { recursive: true });
  }
  const release = daemon.hold();
  try {
    await rc.call('mount/mount', mountParams(fs, place, sup.mountType, c.name, opts()), 60_000);
  } catch (e) {
    release();
    if (process.platform !== 'win32') await fsp.rmdir(place).catch(() => undefined);
    throw new Error(`Could not open it as a drive: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
  const d = { id, name: c.name, place, fs, status: driveStatus(null), release };
  open.set(id, d);
  await setDriveOpen(id, true);
  startPolling();
  emit('remote-drive', publicDrive(d));
  return publicDrive(d);
}

/** Closes a drive: changes still waiting are sent first (rclone waits for them). */
export async function closeDrive(id: string, opts: { remember?: boolean } = {}): Promise<void> {
  const d = open.get(id);
  if (!d) return;
  try {
    const rc = await (await driveDeps.rclone()).rc();
    await rc.call('mount/unmount', { mountPoint: d.place }, 120_000);
  } catch {
    /* rclone already stopped: the drive went with it */
  }
  open.delete(id);
  peak.delete(id);
  d.release();
  if (process.platform !== 'win32') await fsp.rmdir(d.place).catch(() => undefined);
  if (opts.remember !== false) await setDriveOpen(id, false).catch(() => undefined);
  emit('remote-drive', { id, name: d.name, place: d.place, closed: true });
  if (!open.size) {
    stopPoll?.();
    stopPoll = null;
  }
}

export async function showDrive(id: string): Promise<void> {
  const d = open.get(id);
  if (d) await shell.openPath(process.platform === 'win32' ? `${d.place}\\` : d.place);
}

async function round() {
  if (!open.size) return;
  let rc;
  try {
    rc = await (await driveDeps.rclone()).rc();
  } catch {
    return;
  }
  for (const d of open.values()) {
    const offline = driveDeps.status(d.id)?.state === 'offline';
    let s: DriveStatus;
    try {
      s = driveStatus(await rc.call('vfs/stats', { fs: d.fs }, 10_000), offline);
    } catch {
      continue;
    }
    const before = d.status;
    d.status = s;
    // The Island: a ring while changes go out, a note while they wait.
    if (s.pending) {
      const top = Math.max(peak.get(d.id) ?? 0, s.pending);
      peak.set(d.id, top);
      emit('progress', { task: 'drive', phase: `${d.name}: ${driveStatusText(s).toLowerCase()}`, done: top - s.pending, total: top });
    } else if (before.pending) {
      peak.delete(d.id);
      emit('progress', { task: 'drive', phase: 'Done', done: 1, total: 1 });
    }
    if (before.state !== s.state || before.pending !== s.pending) emit('remote-drive', publicDrive(d));
  }
}

function startPolling() {
  if (stopPoll) return;
  stopPoll = poll('remote-drives', { baseMs: 10_000, idleFactor: 3, maxMs: 60_000 }, round, { now: false, feature: 'driveMount' });
}

/** At start: drives that were open open again (when that is on); switching the part off closes them. */
export function initDrives(broadcast: Emit) {
  emit = broadcast;
  onFeature('driveMount', (on) => {
    if (!on) for (const id of [...open.keys()]) void closeDrive(id, { remember: false });
  }, { now: false });
  if (!featureOn('driveMount') || settings().drives?.reopen === false) return;
  const again = listConnections().connections.filter((c) => c.driveOpen);
  if (!again.length) return;
  // A little after start, so opening Keeper is not slowed by it.
  setTimeout(() => {
    for (const c of again) void openDrive(c.id).catch(() => undefined);
  }, 8000).unref?.();
}

/** When Keeper quits: every drive is closed (rclone sends what waits), and remembered as open for next time. */
export async function stopDrives() {
  await Promise.all([...open.keys()].map((id) => closeDrive(id, { remember: false }).catch(() => undefined)));
  types = null;
}

export const drivesApi = { support, drives, openDrive, closeDrive, showDrive };
