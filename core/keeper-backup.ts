// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Moving Keeper to a new computer, and backing up Keeper itself: what in
// Keeper's own folder goes into a copy (everything but passwords, keys, this
// computer's own pairing and what is rebuilt anyway), the encrypted
// .keeperbackup file (AES-256-GCM, the key made from your password with
// scrypt), and the nightly copies (the last 14, "Restore Keeper to Tuesday").
// Node only, no Electron: tests run it directly.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

export const BACKUP_FORMAT = 1;
export const BACKUP_EXT = '.keeperbackup';
const MAGIC = 'KEEPERBACKUP';
/** one file larger than this is left out (it is rebuilt or downloaded again) */
export const MAX_FILE = 25 * 1024 * 1024;
/** nightly copies kept */
export const KEEP_SNAPSHOTS = 14;
/** Keeper's own folders for copies and a restore waiting for the next start */
export const SNAPSHOT_DIR = 'keeper-snapshots';
export const PENDING_DIR = 'restore-pending';

export type LeftOutWhy = 'secret' | 'this-computer' | 'rebuilt' | 'too-big' | 'system';

export const WHY_TEXT: Record<LeftOutWhy, string> = {
  secret: 'Passwords and keys: enter them again, or they come back with your system’s keychain',
  'this-computer': 'This computer’s own pairing and identity: pair the new computer again',
  rebuilt: 'Rebuilt on the new computer by itself',
  'too-big': 'Too big for a copy: downloaded or rebuilt again',
  system: 'Kept by the system for this computer only',
};

// Names (a file or a folder, at any depth) and what they are.
const SECRET = /^(secrets\.json|lock-key\.json|rclone\.conf|pro\.json|.*\.(key|pem|p12|pfx))$|secret|token|credential|private/i;
const THIS_COMPUTER = new Set(['link', 'mesh', 'unattended', 'usage-stats.json', 'instance.json', 'suite', 'session', 'Parts', 'agent-desktop']);
const REBUILT = new Set(['index.json', 'index.json.log', 'brain', 'thumbs', 'models', 'tessdata', 'components', 'remote-cache', 'rclone-cache', 'scrcpy', 'updates', 'logs', 'Crashpad', 'hex', SNAPSHOT_DIR, PENDING_DIR]);
// Chromium's own storage inside Electron's folder (cookies, caches, the key it seals data with).
const SYSTEM = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache', 'ShaderCache', 'blob_storage', 'Service Worker', 'Shared Dictionary', 'Local Storage', 'Session Storage', 'IndexedDB', 'WebStorage', 'Cookies', 'Cookies-journal', 'Network Persistent State', 'Preferences', 'TransportSecurity', 'Trust Tokens', 'Trust Tokens-journal', 'Local State', 'DIPS', 'DIPS-journal', 'shared_proto_db', 'VideoDecodeStats', 'SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile', 'Partitions', 'Dictionaries', 'Network', 'Shared Storage', 'SharedStorage', 'databases', 'File System', 'Platform Notifications', 'QuotaManager', 'QuotaManager-journal', 'Safe Browsing', 'Crash Reports', 'BrowserMetrics', 'Default']);

/** Why a path inside Keeper's folder stays out of a copy, or null when it goes in. */
export function leftOutWhy(rel: string, size = 0): LeftOutWhy | null {
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  for (const p of parts) {
    if (SYSTEM.has(p)) return 'system';
    if (REBUILT.has(p)) return 'rebuilt';
    if (THIS_COMPUTER.has(p)) return 'this-computer';
    if (SECRET.test(p)) return 'secret';
  }
  const name = parts[parts.length - 1] ?? '';
  if (/\.(tmp|lock|sock|log|crdownload|part)$/i.test(name) || name.startsWith('.')) return 'rebuilt';
  if (size > MAX_FILE) return 'too-big';
  return null;
}

export interface PlanEntry { rel: string; size: number }

export interface BackupPlan {
  files: PlanEntry[];
  bytes: number;
  /** grouped by reason: how many and the first few names */
  leftOut: { why: LeftOutWhy; text: string; count: number; examples: string[] }[];
}

/** What goes into a copy, from a list of Keeper's files. */
export function backupPlan(entries: PlanEntry[]): BackupPlan {
  const files: PlanEntry[] = [];
  const out = new Map<LeftOutWhy, string[]>();
  for (const e of entries) {
    const why = leftOutWhy(e.rel, e.size);
    if (!why) files.push(e);
    else out.set(why, [...(out.get(why) ?? []), e.rel.split(/[\\/]+/)[0]]);
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return {
    files,
    bytes: files.reduce((n, f) => n + f.size, 0),
    leftOut: [...out].map(([why, names]) => ({ why, text: WHY_TEXT[why], count: names.length, examples: [...new Set(names)].slice(0, 4) })),
  };
}

// ---------------------------------------------------------------- the .keeperbackup file

export interface BackupMeta {
  format: number;
  /** Keeper's version that made it */
  keeper: string;
  created: number;
  /** the computer it came from, in words ("Ana's MacBook · macOS") */
  from: string;
  files: number;
  bytes: number;
}

export interface BackupFile { rel: string; data: Buffer; mtime?: number }

interface Header extends BackupMeta { salt: string; iv: string; kdf: { N: number; r: number; p: number } }

const KDF = { N: 1 << 15, r: 8, p: 1 };
const keyFrom = (password: string, salt: Buffer, kdf = KDF) => scryptSync(password.normalize('NFC'), salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * kdf.N * kdf.r * 2 });

/** A password good enough for a file that may travel: 8 characters or more. */
export function passwordProblem(pw: string, again?: string): string | null {
  if (pw.length < 8) return 'Use 8 characters or more';
  if (again !== undefined && pw !== again) return 'The two passwords are not the same';
  return null;
}

/** Packs Keeper's files into one encrypted .keeperbackup (header in the clear, the rest sealed). */
export function packBackup(files: BackupFile[], meta: Omit<BackupMeta, 'format' | 'files' | 'bytes'>, password: string, kdf = KDF): Buffer {
  const index = files.map((f) => ({ rel: f.rel.replace(/\\/g, '/'), size: f.data.length, mtime: f.mtime }));
  const body = Buffer.concat([Buffer.from(JSON.stringify(index) + '\n'), ...files.map((f) => f.data)]);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header: Header = { format: BACKUP_FORMAT, ...meta, files: files.length, bytes: body.length, salt: salt.toString('base64'), iv: iv.toString('base64'), kdf };
  const head = Buffer.from(`${MAGIC} ${BACKUP_FORMAT}\n${JSON.stringify(header)}\n`);
  const c = createCipheriv('aes-256-gcm', keyFrom(password, salt, kdf), iv);
  c.setAAD(head);
  const sealed = Buffer.concat([c.update(gzipSync(body)), c.final()]);
  return Buffer.concat([head, sealed, c.getAuthTag()]);
}

function readHeader(buf: Buffer): { header: Header; headLen: number } {
  const first = buf.indexOf(0x0a);
  const second = first < 0 ? -1 : buf.indexOf(0x0a, first + 1);
  if (first < 0 || second < 0 || !buf.subarray(0, first).toString().startsWith(MAGIC)) throw new Error('That file isn’t a Keeper backup.');
  let header: Header;
  try { header = JSON.parse(buf.subarray(first + 1, second).toString()); } catch { throw new Error('That file isn’t a Keeper backup.'); }
  if (typeof header.format !== 'number' || header.format > BACKUP_FORMAT) throw new Error('This backup was made by a newer Keeper. Update Keeper first, then try again.');
  return { header, headLen: second + 1 };
}

/** What a backup says about itself, without the password. */
export function backupMeta(buf: Buffer): BackupMeta {
  const { header } = readHeader(buf);
  return { format: header.format, keeper: header.keeper, created: header.created, from: header.from, files: header.files, bytes: header.bytes };
}

/** Opens a .keeperbackup; a wrong password or a changed file says so plainly. */
export function unpackBackup(buf: Buffer, password: string): { meta: BackupMeta; files: BackupFile[] } {
  const { header, headLen } = readHeader(buf);
  if (buf.length < headLen + 16) throw new Error('This backup is cut short.');
  const d = createDecipheriv('aes-256-gcm', keyFrom(password, Buffer.from(header.salt, 'base64'), header.kdf ?? KDF), Buffer.from(header.iv, 'base64'));
  d.setAAD(buf.subarray(0, headLen));
  d.setAuthTag(buf.subarray(buf.length - 16));
  let body: Buffer;
  try {
    body = gunzipSync(Buffer.concat([d.update(buf.subarray(headLen, buf.length - 16)), d.final()]));
  } catch {
    throw new Error('That password doesn’t open this backup (or the file was changed).');
  }
  const nl = body.indexOf(0x0a);
  const index = JSON.parse(body.subarray(0, nl).toString()) as { rel: string; size: number; mtime?: number }[];
  const files: BackupFile[] = [];
  let at = nl + 1;
  for (const e of index) {
    const rel = safeRel(e.rel);
    files.push({ rel, data: body.subarray(at, at + e.size), mtime: e.mtime });
    at += e.size;
  }
  return { meta: backupMeta(buf), files };
}

/** A relative path that stays inside Keeper's folder, and never one of the parts a copy leaves out. */
export function safeRel(rel: string): string {
  const r = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!r || r.split('/').some((p) => p === '..' || p === '' || p === '.') || /^[A-Za-z]:/.test(r) || /\0/.test(r)) throw new Error('This backup has a file outside Keeper’s folder.');
  if (leftOutWhy(r) && leftOutWhy(r) !== 'too-big') throw new Error('This backup has a file a copy never holds.');
  return r;
}

// ---------------------------------------------------------------- nightly copies

/** The folder name of a day's copy: 2026-11-03. */
export function snapshotName(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The copies to remove: all but the newest `keep`. Names that are not dates are left alone. */
export function snapshotsToDrop(names: string[], keep = KEEP_SNAPSHOTS): string[] {
  const days = names.filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse();
  return days.slice(keep);
}

/** "Today", "Yesterday", "Tuesday" (this week) or "3 Nov". */
export function snapshotLabel(name: string, now: number): string {
  const [y, m, d] = name.split('-').map(Number);
  const t = new Date(y, m - 1, d).getTime();
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const days = Math.round((start - t) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return new Date(t).toLocaleDateString('en-GB', { weekday: 'long' });
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Whether a nightly copy is due: none today yet. */
export function snapshotDue(names: string[], now: number): boolean {
  return !names.includes(snapshotName(now));
}

/** The name of a backup file: "Keeper backup 2026-11-04.keeperbackup". */
export function backupFileName(now: number): string {
  return `Keeper backup ${snapshotName(now)}${BACKUP_EXT}`;
}
