// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Backing up and moving Keeper itself (core/keeper-backup.ts has the rules and
// the file format): a .keeperbackup file sealed with a password, sending it to
// another of your computers over Keeper Link, a copy each night (the last 14)
// while the part is on, and putting one back. A restore is staged in Keeper's
// folder and put in place at the next start, before anything reads its files,
// with what it replaces kept as a copy first (so a restore can be undone).

import { app, BrowserWindow, dialog } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  backupFileName, backupMeta, leftOutWhy, backupPlan, BACKUP_EXT, KEEP_SNAPSHOTS, packBackup, PENDING_DIR, passwordProblem, safeRel, snapshotDue, snapshotLabel, snapshotName, SNAPSHOT_DIR, snapshotsToDrop, unpackBackup,
  type BackupFile, type BackupMeta, type BackupPlan, type PlanEntry,
} from '../../core/keeper-backup';
import type { KeeperBackupApi, KeeperBackupStatus } from '../../core/api-keeper-backup';
import { onFeature } from './features';

const root = () => app.getPath('userData');
const snapDir = () => path.join(root(), SNAPSHOT_DIR);
const pendingDir = () => path.join(root(), PENDING_DIR);

/** Every file in Keeper's folder, relative, with its size (links are not followed). */
async function walk(dir = root(), base = ''): Promise<PlanEntry[]> {
  const out: PlanEntry[] = [];
  const ents = await fsp.readdir(path.join(dir, base), { withFileTypes: true }).catch(() => []);
  for (const e of ents) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isSymbolicLink()) continue;
    // A folder a copy leaves out whole (caches, the index) is listed once, not read.
    if (e.isDirectory() && leftOutWhy(rel)) out.push({ rel, size: 0 });
    else if (e.isDirectory()) out.push(...(await walk(dir, rel)));
    else if (e.isFile()) {
      const st = await fsp.stat(path.join(dir, rel)).catch(() => null);
      if (st) out.push({ rel, size: st.size });
    }
  }
  return out;
}

async function plan(): Promise<BackupPlan> {
  // A folder the plan leaves out whole is not read at all (caches can hold thousands of files).
  return backupPlan(await walk());
}

async function readFiles(p: BackupPlan, from = root()): Promise<BackupFile[]> {
  const out: BackupFile[] = [];
  for (const f of p.files) {
    const data = await fsp.readFile(path.join(from, f.rel)).catch(() => null);
    if (data) out.push({ rel: f.rel, data, mtime: (await fsp.stat(path.join(from, f.rel)).catch(() => null))?.mtimeMs });
  }
  return out;
}

const thisComputer = () => `${os.hostname().replace(/\.local$/, '')} · ${process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'}`;

async function makeBackup(password: string): Promise<Buffer> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  return packBackup(await readFiles(await plan()), { keeper: app.getVersion(), created: Date.now(), from: thisComputer() }, password);
}

const win = () => BrowserWindow.getFocusedWindow() ?? undefined;

// ---------------------------------------------------------------- nightly copies

async function snapshots(): Promise<{ name: string; label: string; bytes: number }[]> {
  const names = (await fsp.readdir(snapDir()).catch(() => [] as string[])).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse();
  const out = [];
  for (const n of names) {
    const files = await walk(path.join(snapDir(), n));
    out.push({ name: n, label: snapshotLabel(n, Date.now()), bytes: files.reduce((a, f) => a + f.size, 0) });
  }
  return out;
}

/** Copies Keeper's files (as a backup would hold them) into today's folder, and drops the oldest. */
export async function snapshotNow(name = snapshotName(Date.now())): Promise<string> {
  const p = await plan();
  const dest = path.join(snapDir(), name);
  const tmp = `${dest}.part`;
  await fsp.rm(tmp, { recursive: true, force: true });
  for (const f of p.files) {
    const to = path.join(tmp, f.rel);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(path.join(root(), f.rel), to).catch(() => undefined);
  }
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.mkdir(snapDir(), { recursive: true });
  await fsp.rename(tmp, dest);
  for (const old of snapshotsToDrop(await fsp.readdir(snapDir()).catch(() => []), KEEP_SNAPSHOTS)) await fsp.rm(path.join(snapDir(), old), { recursive: true, force: true });
  return name;
}

let timer: NodeJS.Timeout | undefined;
let first: NodeJS.Timeout | undefined;
async function snapshotIfDue() {
  const names = await fsp.readdir(snapDir()).catch(() => [] as string[]);
  if (snapshotDue(names, Date.now())) await snapshotNow().catch((e) => console.error('keeper copy failed', e));
}

/** While the part is on: a look two minutes after start, then every six hours (one copy a day). Off: no timers. */
export function startKeeperBackup() {
  onFeature('keeperBackup', (on) => {
    clearTimeout(first);
    clearInterval(timer);
    if (!on) return;
    first = setTimeout(() => void snapshotIfDue(), 120_000);
    timer = setInterval(() => void snapshotIfDue(), 6 * 3_600_000);
    timer.unref?.();
    first.unref?.();
  }, { now: true });
}

// ---------------------------------------------------------------- putting a copy back

/** Stages files for the next start and restarts Keeper. */
async function stageAndRestart(files: BackupFile[], from: string) {
  await fsp.rm(pendingDir(), { recursive: true, force: true });
  for (const f of files) {
    const rel = safeRel(f.rel);
    const to = path.join(pendingDir(), 'files', rel);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.writeFile(to, f.data);
  }
  await fsp.writeFile(path.join(pendingDir(), 'restore.json'), JSON.stringify({ from, at: Date.now(), files: files.length }));
  // Tests start Keeper again themselves (KEEPER_TEST_NO_RELAUNCH).
  setTimeout(() => { if (!process.env.KEEPER_TEST_NO_RELAUNCH) app.relaunch(); app.exit(0); }, 400);
}

/**
 * At start, before anything reads Keeper's files: a staged restore is put in
 * place. What it replaces is first kept as a copy named "before-restore-…".
 */
export async function applyPendingRestore(): Promise<boolean> {
  const marker = path.join(pendingDir(), 'restore.json');
  if (!existsSync(marker)) return false;
  try {
    const staged = path.join(pendingDir(), 'files');
    const files = await walk(staged);
    const keep = path.join(snapDir(), `before-restore-${Date.now()}`);
    for (const f of files) {
      const rel = safeRel(f.rel);
      const dest = path.join(root(), rel);
      if (existsSync(dest)) {
        await fsp.mkdir(path.dirname(path.join(keep, rel)), { recursive: true });
        await fsp.copyFile(dest, path.join(keep, rel)).catch(() => undefined);
      }
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(path.join(staged, rel), dest);
    }
  } catch (e) {
    console.error('restore failed', e);
  }
  await fsp.rm(pendingDir(), { recursive: true, force: true }).catch(() => undefined);
  return true;
}

async function readBackupFile(file: string): Promise<Buffer> {
  const st = await fsp.stat(file);
  if (st.size > 2 * 1024 * 1024 * 1024) throw new Error('That file is too big to be a Keeper backup.');
  return fsp.readFile(file);
}

// ---------------------------------------------------------------- the window's calls

export const keeperBackupApi: KeeperBackupApi = {
  async status(): Promise<KeeperBackupStatus> {
    const p = await plan();
    return { files: p.files.length, bytes: p.bytes, leftOut: p.leftOut, snapshots: await snapshots() };
  },
  async saveFile(password: string) {
    const buf = await makeBackup(password);
    const opts = { defaultPath: path.join(app.getPath('documents'), backupFileName(Date.now())), filters: [{ name: 'Keeper backup', extensions: [BACKUP_EXT.slice(1)] }] };
    const w = win();
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, buf, { mode: 0o600 });
    return r.filePath;
  },
  async writeFile(password: string, file: string) {
    await fsp.writeFile(file, await makeBackup(password), { mode: 0o600 });
    return file;
  },
  async sendTo(device: string, password: string) {
    const buf = await makeBackup(password);
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-move-'));
    const file = path.join(dir, backupFileName(Date.now()));
    await fsp.writeFile(file, buf, { mode: 0o600 });
    const { link } = await import('./link');
    try {
      await link.sendFiles(device, [file]);
    } finally {
      setTimeout(() => void fsp.rm(dir, { recursive: true, force: true }), 10 * 60_000).unref?.();
    }
    return true;
  },
  async pickFile() {
    const opts = { properties: ['openFile' as const], filters: [{ name: 'Keeper backup', extensions: [BACKUP_EXT.slice(1)] }] };
    const w = win();
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    const file = r.filePaths[0];
    if (r.canceled || !file) return null;
    return { file, meta: backupMeta(await readBackupFile(file)) };
  },
  async inspect(file: string): Promise<BackupMeta> {
    return backupMeta(await readBackupFile(file));
  },
  async restoreFile(file: string, password: string) {
    const { meta, files } = unpackBackup(await readBackupFile(file), password);
    await stageAndRestart(files, `${meta.from}, ${new Date(meta.created).toLocaleDateString('en-GB')}`);
    return { files: files.length };
  },
  async snapshotNow() {
    await snapshotNow();
    return keeperBackupApi.status();
  },
  async restoreSnapshot(name: string) {
    if (!/^(\d{4}-\d{2}-\d{2}|before-restore-\d+)$/.test(name)) throw new Error('No such copy');
    const dir = path.join(snapDir(), name);
    const p = await walk(dir);
    const files: BackupFile[] = [];
    for (const f of p) files.push({ rel: f.rel, data: await fsp.readFile(path.join(dir, f.rel)) });
    await stageAndRestart(files, name);
    return { files: files.length };
  },
};
