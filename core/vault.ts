// SPDX-License-Identifier: AGPL-3.0-or-later
// Locked folders. A folder is encrypted into one file next to it
// ("Taxes.keeperlock"), checked by decrypting every byte back, and only then is
// the original removed. Unlocking does the same in reverse. Pure Node, shared by
// the app, the CLI and the tests.
//
// File layout
//   "KEEPERLOCK\0\1"  12 bytes
//   header length     u32 BE, then the header as JSON (no names, no sizes)
//   file data         per file, chunks of  iv(12) | ciphertext | tag(16)
//   manifest          iv(12) | ciphertext | tag(16)   (names, sizes, hashes…)
//   trailer           manifest offset u64 BE | manifest length u32 BE | "KLEND\0\0\1"
//
// Everything is AES-256-GCM with a random 256-bit key per folder. That key is
// stored only "wrapped": encrypted with a key from the person's password, the
// recovery key, or a key kept by the operating system's keychain.

import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto';
import { promises as fsp, type Stats } from 'node:fs';
import path from 'node:path';
export { passwordStrength } from './vault-ui';
import { checkRemovable, isInside, protectedRoots, samePath, type SafetyContext } from './safety';

export const VAULT_EXT = '.keeperlock';
const MAGIC = Buffer.from('KEEPERLOCK\x00\x01', 'latin1');
const END = Buffer.from('KLEND\x00\x00\x01', 'latin1');
const IV = 12;
const TAG = 16;
const TRAILER = 8 + 4 + END.length;
export const DEFAULT_CHUNK = 1 << 20;
/** Strong enough to make guessing slow (about a third of a second per try). */
export const KDF_DEFAULT = { N: 1 << 17, r: 8, p: 1 };

export type WrapKind = 'device' | 'password' | 'recovery';

export interface KdfParams {
  salt: string;
  N: number;
  r: number;
  p: number;
}

export interface Wrap {
  kind: WrapKind;
  kdf?: KdfParams;
  /** which computer's keychain key wraps it */
  deviceId?: string;
  iv: string;
  ct: string;
  tag: string;
}

export interface VaultHeader {
  v: 1;
  id: string;
  created: number;
  chunk: number;
  wraps: Wrap[];
}

export interface VaultEntry {
  /** relative path inside the folder, always with "/" */
  p: string;
  t: 'f' | 'd' | 'l';
  size: number;
  mtime: number;
  mode: number;
  sha256?: string;
  /** link target, for symbolic links */
  target?: string;
  /** where the file's first chunk starts */
  off?: number;
}

export interface Manifest {
  name: string;
  files: number;
  folders: number;
  bytes: number;
  entries: VaultEntry[];
}

export interface VaultProgress {
  phase: 'scan' | 'encrypt' | 'verify' | 'remove' | 'decrypt';
  done: number;
  total: number;
  file?: string;
}

export type VaultErrorCode = 'wrong-key' | 'tampered' | 'format' | 'changed' | 'exists' | 'refused' | 'cancelled' | 'unsupported';

export class VaultError extends Error {
  constructor(public code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

// ---------------------------------------------------------------- keys

function scrypt(secret: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(secret, salt, 32, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

async function kdf(secret: string, k: KdfParams): Promise<Buffer> {
  return scrypt(secret.normalize('NFKC'), Buffer.from(k.salt, 'base64'), { N: k.N, r: k.r, p: k.p, maxmem: 256 * k.N * k.r + (32 << 20) });
}

const wrapAad = (kind: WrapKind) => Buffer.from(`keeper-wrap-v1:${kind}`);

function seal(key: Buffer, data: Buffer, aad: Buffer): { iv: Buffer; ct: Buffer; tag: Buffer } {
  const iv = randomBytes(IV);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(data), c.final()]);
  return { iv, ct, tag: c.getAuthTag() };
}

function open(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer, aad: Buffer): Buffer | null {
  try {
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(aad);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch {
    return null;
  }
}

export function newDataKey(): Buffer {
  return randomBytes(32);
}

// Crockford's base32: no I, L, O or U, so a recovery key read aloud or copied by hand survives.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 160 random bits as eight groups of four characters: "7F3K-…". */
export function newRecoveryKey(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join('-');
}

/** Spaces, dashes, case and look-alike letters do not matter when typing a recovery key back. */
export function normalizeRecoveryKey(s: string): string {
  return s.toUpperCase().replace(/[O]/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
}

export function isRecoveryKeyShape(s: string): boolean {
  const n = normalizeRecoveryKey(s);
  return n.length === 32 && [...n].every((c) => B32.includes(c));
}

export interface WrapSecrets {
  password?: string;
  recovery?: string;
  /** the keychain-held key of this computer */
  deviceKey?: Buffer;
  deviceId?: string;
}

/** Wraps the folder key once for each way it can be unlocked. */
export async function makeWraps(dataKey: Buffer, s: WrapSecrets, kdfParams: Omit<KdfParams, 'salt'> = KDF_DEFAULT): Promise<Wrap[]> {
  const out: Wrap[] = [];
  const add = (kind: WrapKind, kek: Buffer, extra: Partial<Wrap>) => {
    const { iv, ct, tag } = seal(kek, dataKey, wrapAad(kind));
    out.push({ kind, ...extra, iv: iv.toString('base64'), ct: ct.toString('base64'), tag: tag.toString('base64') });
  };
  if (s.deviceKey) add('device', s.deviceKey, { deviceId: s.deviceId });
  for (const kind of ['password', 'recovery'] as const) {
    const secret = kind === 'password' ? s.password : s.recovery && normalizeRecoveryKey(s.recovery);
    if (!secret) continue;
    const k: KdfParams = { salt: randomBytes(16).toString('base64'), ...kdfParams };
    add(kind, await kdf(secret, k), { kdf: k });
  }
  return out;
}

/** The folder key, from whichever secret is given. Throws `wrong-key` when none fits. */
export async function unwrapKey(header: VaultHeader, s: WrapSecrets): Promise<Buffer> {
  for (const w of header.wraps) {
    let kek: Buffer | undefined;
    if (w.kind === 'device' && s.deviceKey) kek = s.deviceKey;
    else if (w.kind === 'password' && s.password && w.kdf) kek = await kdf(s.password, w.kdf);
    else if (w.kind === 'recovery' && s.recovery && w.kdf) kek = await kdf(normalizeRecoveryKey(s.recovery), w.kdf);
    if (!kek) continue;
    const key = open(kek, Buffer.from(w.iv, 'base64'), Buffer.from(w.ct, 'base64'), Buffer.from(w.tag, 'base64'), wrapAad(w.kind));
    if (key && key.length === 32) return key;
  }
  throw new VaultError('wrong-key', s.recovery ? 'That recovery key does not unlock this folder.' : s.password ? 'That password is not right.' : 'This computer cannot unlock this folder.');
}

// ---------------------------------------------------------------- scanning

function checkSignal(signal?: AbortSignal) {
  if (signal?.aborted) throw new VaultError('cancelled', 'Cancelled.');
}

interface Scanned extends VaultEntry {
  abs: string;
}

/** Every file, folder and link inside `dir`, parents before children. */
async function scanTree(dir: string, signal?: AbortSignal): Promise<Scanned[]> {
  const out: Scanned[] = [];
  const walk = async (abs: string, rel: string) => {
    checkSignal(signal);
    const list = await fsp.readdir(abs, { withFileTypes: true });
    list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of list) {
      const a = path.join(abs, d.name);
      const r = rel ? `${rel}/${d.name}` : d.name;
      const st = await fsp.lstat(a);
      if (st.isSymbolicLink()) out.push({ abs: a, p: r, t: 'l', size: 0, mtime: st.mtimeMs, mode: st.mode & 0o7777, target: await fsp.readlink(a) });
      else if (st.isDirectory()) {
        out.push({ abs: a, p: r, t: 'd', size: 0, mtime: st.mtimeMs, mode: st.mode & 0o7777 });
        await walk(a, r);
      } else if (st.isFile()) out.push({ abs: a, p: r, t: 'f', size: st.size, mtime: st.mtimeMs, mode: st.mode & 0o7777 });
      else throw new VaultError('unsupported', `“${r}” is a device, socket or pipe and cannot be locked.`);
    }
  };
  await walk(dir, '');
  return out;
}

const chunksOf = (size: number, chunk: number) => Math.ceil(size / chunk);

function chunkAad(id: Buffer, file: number, idx: number, last: boolean): Buffer {
  const b = Buffer.alloc(id.length + 9);
  id.copy(b);
  b.writeUInt32BE(file, id.length);
  b.writeUInt32BE(idx, id.length + 4);
  b[id.length + 8] = last ? 1 : 0;
  return b;
}

const manifestAad = (id: Buffer, headerBytes: Buffer) => Buffer.concat([Buffer.from('keeper-manifest-v1'), id, createHash('sha256').update(headerBytes).digest()]);

// ---------------------------------------------------------------- writing

export interface WriteOptions {
  dataKey: Buffer;
  wraps: Wrap[];
  chunk?: number;
  onProgress?: (p: VaultProgress) => void;
  signal?: AbortSignal;
}

/** Encrypts `dir` into `out` (which must not exist yet). Originals are not touched. */
export async function writeVault(dir: string, out: string, o: WriteOptions): Promise<{ header: VaultHeader; manifest: Manifest; scanned: VaultEntry[] }> {
  const chunk = o.chunk ?? DEFAULT_CHUNK;
  o.onProgress?.({ phase: 'scan', done: 0, total: 0 });
  const tree = await scanTree(dir, o.signal);
  const total = tree.reduce((n, e) => n + e.size, 0);
  const idBuf = randomBytes(16);
  const header: VaultHeader = { v: 1, id: idBuf.toString('hex'), created: Date.now(), chunk, wraps: o.wraps };
  const headerBytes = Buffer.from(JSON.stringify(header));
  const fh = await fsp.open(out, 'wx', 0o600);
  let pos = 0;
  const write = async (b: Buffer) => {
    await fh.write(b, 0, b.length, pos);
    pos += b.length;
  };
  const entries: VaultEntry[] = [];
  try {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(headerBytes.length);
    await write(Buffer.concat([MAGIC, len, headerBytes]));
    let done = 0;
    let fileNo = 0;
    const buf = Buffer.allocUnsafe(chunk);
    for (const e of tree) {
      const { abs: _abs, ...entry } = e;
      if (e.t !== 'f') {
        entries.push(entry);
        continue;
      }
      const src = await fsp.open(e.abs, 'r');
      try {
        const hash = createHash('sha256');
        const n = chunksOf(e.size, chunk);
        entry.off = pos;
        for (let i = 0; i < n; i++) {
          checkSignal(o.signal);
          const want = Math.min(chunk, e.size - i * chunk);
          let got = 0;
          while (got < want) {
            const { bytesRead } = await src.read(buf, got, want - got, i * chunk + got);
            if (!bytesRead) throw new VaultError('changed', `“${e.p}” changed while it was being locked. Close any app using it and try again.`);
            got += bytesRead;
          }
          const plain = buf.subarray(0, want);
          hash.update(plain);
          const s = seal(o.dataKey, plain, chunkAad(idBuf, fileNo, i, i === n - 1));
          await write(Buffer.concat([s.iv, s.ct, s.tag]));
          done += want;
          o.onProgress?.({ phase: 'encrypt', done, total, file: e.p });
        }
        // Grew, or was rewritten while we read it?
        const after = await src.stat();
        const extra = await src.read(Buffer.alloc(1), 0, 1, e.size);
        if (extra.bytesRead || after.size !== e.size || after.mtimeMs !== e.mtime) throw new VaultError('changed', `“${e.p}” changed while it was being locked. Close any app using it and try again.`);
        entry.sha256 = hash.digest('hex');
      } finally {
        await src.close();
      }
      entries.push(entry);
      fileNo++;
    }
    const manifest: Manifest = {
      name: path.basename(dir),
      files: entries.filter((x) => x.t === 'f').length,
      folders: entries.filter((x) => x.t === 'd').length,
      bytes: total,
      entries,
    };
    const m = seal(o.dataKey, Buffer.from(JSON.stringify(manifest)), manifestAad(idBuf, headerBytes));
    const mOff = pos;
    await write(Buffer.concat([m.iv, m.ct, m.tag]));
    const t = Buffer.alloc(12);
    t.writeBigUInt64BE(BigInt(mOff));
    t.writeUInt32BE(IV + m.ct.length + TAG, 8);
    await write(Buffer.concat([t, END]));
    await fh.sync();
    return { header, manifest, scanned: tree.map(({ abs: _a, ...x }) => x) };
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------- reading

/** The plain header: which ways it can be unlocked. Says nothing about what is inside. */
export async function readHeader(file: string): Promise<VaultHeader> {
  const fh = await fsp.open(file, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length + 4);
    await fh.read(head, 0, head.length, 0);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new VaultError('format', 'This is not a Keeper locked folder.');
    const len = head.readUInt32BE(MAGIC.length);
    if (len > 1 << 20) throw new VaultError('format', 'The locked folder’s header is damaged.');
    const hb = Buffer.alloc(len);
    await fh.read(hb, 0, len, head.length);
    try {
      const h = JSON.parse(hb.toString('utf8')) as VaultHeader;
      if (h.v !== 1 || !Array.isArray(h.wraps) || !(h.chunk > 0)) throw new Error('bad');
      return h;
    } catch {
      throw new VaultError('format', 'The locked folder’s header is damaged.');
    }
  } finally {
    await fh.close();
  }
}

async function readManifest(fh: fsp.FileHandle, dataKey: Buffer): Promise<{ header: VaultHeader; manifest: Manifest; dataEnd: number }> {
  const st = await fh.stat();
  const head = Buffer.alloc(MAGIC.length + 4);
  await fh.read(head, 0, head.length, 0);
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new VaultError('format', 'This is not a Keeper locked folder.');
  const hlen = head.readUInt32BE(MAGIC.length);
  const headerBytes = Buffer.alloc(hlen);
  await fh.read(headerBytes, 0, hlen, head.length);
  let header: VaultHeader;
  try {
    header = JSON.parse(headerBytes.toString('utf8')) as VaultHeader;
  } catch {
    throw new VaultError('format', 'The locked folder’s header is damaged.');
  }
  if (st.size < head.length + hlen + TRAILER) throw new VaultError('tampered', 'The locked folder is incomplete or damaged.');
  const t = Buffer.alloc(TRAILER);
  await fh.read(t, 0, TRAILER, st.size - TRAILER);
  if (!t.subarray(12).equals(END)) throw new VaultError('tampered', 'The locked folder is incomplete or damaged.');
  const mOff = Number(t.readBigUInt64BE(0));
  const mLen = t.readUInt32BE(8);
  if (mOff + mLen !== st.size - TRAILER || mLen < IV + TAG) throw new VaultError('tampered', 'The locked folder is incomplete or damaged.');
  const mb = Buffer.alloc(mLen);
  await fh.read(mb, 0, mLen, mOff);
  const plain = open(dataKey, mb.subarray(0, IV), mb.subarray(IV, mLen - TAG), mb.subarray(mLen - TAG), manifestAad(Buffer.from(header.id, 'hex'), headerBytes));
  if (!plain) throw new VaultError('tampered', 'The locked folder has been changed or damaged, so it cannot be trusted.');
  const manifest = JSON.parse(plain.toString('utf8')) as Manifest;
  for (const e of manifest.entries) {
    // Never let an entry point outside the folder it is restored into.
    const parts = e.p.split('/');
    if (!e.p || e.p.startsWith('/') || /^[A-Za-z]:/.test(e.p) || e.p.includes('\\') || parts.some((x) => x === '..' || x === '.' || x === '')) throw new VaultError('tampered', 'The locked folder contains an unsafe path.');
  }
  return { header, manifest, dataEnd: mOff };
}

/** Decrypts every chunk of every file, hands the plain bytes to `sink` and checks each file's hash. */
async function eachFile(
  file: string,
  dataKey: Buffer,
  opts: { onProgress?: (p: VaultProgress) => void; signal?: AbortSignal; phase: 'verify' | 'decrypt' },
  sink?: (e: VaultEntry, data: Buffer | null) => Promise<void>,
  onManifest?: (m: Manifest) => Promise<void>,
): Promise<{ header: VaultHeader; manifest: Manifest }> {
  const fh = await fsp.open(file, 'r');
  try {
    const { header, manifest, dataEnd } = await readManifest(fh, dataKey);
    await onManifest?.(manifest);
    const id = Buffer.from(header.id, 'hex');
    const chunk = header.chunk;
    const buf = Buffer.allocUnsafe(chunk + IV + TAG);
    let done = 0;
    let fileNo = 0;
    for (const e of manifest.entries) {
      if (e.t !== 'f') continue;
      const n = chunksOf(e.size, chunk);
      let pos = e.off ?? 0;
      const hash = createHash('sha256');
      for (let i = 0; i < n; i++) {
        checkSignal(opts.signal);
        const plainLen = Math.min(chunk, e.size - i * chunk);
        const recLen = IV + plainLen + TAG;
        if (pos + recLen > dataEnd) throw new VaultError('tampered', 'The locked folder is incomplete or damaged.');
        const { bytesRead } = await fh.read(buf, 0, recLen, pos);
        if (bytesRead !== recLen) throw new VaultError('tampered', 'The locked folder is incomplete or damaged.');
        const plain = open(dataKey, buf.subarray(0, IV), buf.subarray(IV, IV + plainLen), buf.subarray(IV + plainLen, recLen), chunkAad(id, fileNo, i, i === n - 1));
        if (!plain) throw new VaultError('tampered', `Part of “${e.p}” has been changed or damaged inside the locked folder.`);
        hash.update(plain);
        if (sink) await sink(e, plain);
        pos += recLen;
        done += plainLen;
        opts.onProgress?.({ phase: opts.phase, done, total: manifest.bytes, file: e.p });
      }
      if (n === 0 && sink) await sink(e, null);
      if (hash.digest('hex') !== e.sha256) throw new VaultError('tampered', `“${e.p}” does not match what was locked.`);
      fileNo++;
    }
    return { header, manifest };
  } finally {
    await fh.close();
  }
}

/** Reads the whole locked folder back and checks every file. Throws if anything is off. */
export function verifyVault(file: string, dataKey: Buffer, opts: { onProgress?: (p: VaultProgress) => void; signal?: AbortSignal } = {}) {
  return eachFile(file, dataKey, { ...opts, phase: 'verify' });
}

/** What is inside (names, sizes), for a preview before unlocking. */
export async function listVault(file: string, dataKey: Buffer): Promise<Manifest> {
  const fh = await fsp.open(file, 'r');
  try {
    return (await readManifest(fh, dataKey)).manifest;
  } finally {
    await fh.close();
  }
}

/** Restores the locked folder into `dest` (which must not exist). Every file is checked as it is written. */
export async function extractVault(file: string, dataKey: Buffer, dest: string, opts: { onProgress?: (p: VaultProgress) => void; signal?: AbortSignal; platform?: NodeJS.Platform } = {}): Promise<Manifest> {
  await fsp.mkdir(dest, { recursive: false });
  const win = (opts.platform ?? process.platform) === 'win32';
  const target = (e: VaultEntry) => path.join(dest, ...e.p.split('/'));
  let current: { entry: VaultEntry; fh: fsp.FileHandle } | null = null;
  const closeCurrent = async () => {
    if (!current) return;
    const { entry, fh } = current;
    current = null;
    await fh.sync();
    await fh.close();
    const t = target(entry);
    if (!win) await fsp.chmod(t, entry.mode & 0o777).catch(() => undefined);
    await fsp.utimes(t, new Date(entry.mtime), new Date(entry.mtime)).catch(() => undefined);
  };
  const fhOf = async (e: VaultEntry) => {
    if (current?.entry === e) return current.fh;
    await closeCurrent();
    const fh = await fsp.open(target(e), 'wx', 0o600);
    current = { entry: e, fh };
    return fh;
  };
  try {
    const { manifest } = await eachFile(
      file,
      dataKey,
      { ...opts, phase: 'decrypt' },
      async (e, data) => {
        const fh = await fhOf(e);
        if (data) await fh.write(data);
      },
      // Folders first, so every file has somewhere to go.
      async (m) => {
        for (const e of m.entries) if (e.t === 'd') await fsp.mkdir(target(e), { recursive: true });
      },
    );
    await closeCurrent();
    // Links last; folder times after their contents are in place, deepest first.
    for (const e of manifest.entries) {
      if (e.t !== 'l' || e.target === undefined) continue;
      try {
        await fsp.symlink(e.target, target(e));
      } catch {
        /* Windows without the right to create links: skipped */
      }
    }
    for (const e of [...manifest.entries].reverse()) {
      if (e.t !== 'd') continue;
      if (!win) await fsp.chmod(target(e), e.mode & 0o777).catch(() => undefined);
      await fsp.utimes(target(e), new Date(e.mtime), new Date(e.mtime)).catch(() => undefined);
    }
    return manifest;
  } finally {
    if (current) await (current as { fh: fsp.FileHandle }).fh.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- lock / unlock

export function vaultPathFor(dir: string): string {
  return path.join(path.dirname(dir), path.basename(dir) + VAULT_EXT);
}

export function folderNameFor(vault: string): string {
  return path.basename(vault).replace(/\.keeperlock$/i, '');
}

async function exists(p: string): Promise<boolean> {
  return fsp.lstat(p).then(() => true, () => false);
}

const same = (a: VaultEntry[], b: VaultEntry[]) =>
  a.length === b.length && a.every((x, i) => x.p === b[i].p && x.t === b[i].t && x.size === b[i].size && x.mtime === b[i].mtime && x.target === b[i].target);

export interface LockOptions extends Omit<WriteOptions, 'dataKey' | 'wraps'> {
  dataKey: Buffer;
  wraps: Wrap[];
  /** test hook: runs after the check, before anything is renamed or removed */
  beforeFinalize?: () => Promise<void> | void;
}

export interface LockResult {
  vault: string;
  manifest: Manifest;
  /** true when the locked copy is safe but some originals could not be removed */
  leftovers: boolean;
}

/**
 * Locks `dir`: writes "<dir>.keeperlock", decrypts it all back to check it, and
 * only then removes the original folder (permanently: a copy in the Trash
 * would defeat the point). If anything fails before that, the folder is left
 * exactly as it was.
 */
export async function lockFolder(dir: string, o: LockOptions): Promise<LockResult> {
  const st: Stats = await fsp.lstat(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new VaultError('refused', 'Only real folders can be locked.');
  const vault = vaultPathFor(dir);
  if (await exists(vault)) throw new VaultError('exists', `“${path.basename(vault)}” already exists next to this folder.`);
  const tmp = path.join(path.dirname(dir), `.${path.basename(dir)}${VAULT_EXT}.partial-${randomBytes(4).toString('hex')}`);
  let manifest: Manifest;
  try {
    const w = await writeVault(dir, tmp, o);
    manifest = w.manifest;
    await verifyVault(tmp, o.dataKey, o);
    // Anything changed since we read it? Then the copy is not complete.
    const again = await scanTree(dir, o.signal);
    if (!same(again, w.scanned)) throw new VaultError('changed', 'Files in the folder changed while it was being locked. Nothing was removed; try again.');
    await o.beforeFinalize?.();
    checkSignal(o.signal);
    if (await exists(vault)) throw new VaultError('exists', `“${path.basename(vault)}” already exists next to this folder.`);
    await fsp.rename(tmp, vault);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  o.onProgress?.({ phase: 'remove', done: 0, total: manifest.files });
  let leftovers = false;
  try {
    await fsp.rm(dir, { recursive: true, force: false, maxRetries: 2 });
  } catch {
    leftovers = true;
  }
  return { vault, manifest, leftovers };
}

/** A free name next to the locked file: "Taxes", or "Taxes (unlocked)", "Taxes (unlocked 2)"… */
export async function unlockTarget(vault: string): Promise<string> {
  const dir = path.dirname(vault);
  const base = folderNameFor(vault);
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? base : i === 2 ? `${base} (unlocked)` : `${base} (unlocked ${i - 1})`;
    if (!(await exists(path.join(dir, name)))) return path.join(dir, name);
  }
  throw new VaultError('exists', 'There is no free name to unlock this folder into.');
}

/** Unlocks: restores the folder next to the locked file, checks it, then removes the locked file. */
export async function unlockFolder(vault: string, dataKey: Buffer, o: { onProgress?: (p: VaultProgress) => void; signal?: AbortSignal; keepVault?: boolean } = {}): Promise<{ folder: string; manifest: Manifest }> {
  const dest = await unlockTarget(vault);
  const tmp = path.join(path.dirname(vault), `.${path.basename(dest)}.unlocking-${randomBytes(4).toString('hex')}`);
  let manifest: Manifest;
  try {
    manifest = await extractVault(vault, dataKey, tmp, o);
    await fsp.rename(tmp, dest);
  } catch (err) {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  if (!o.keepVault) await fsp.rm(vault, { force: true });
  return { folder: dest, manifest };
}

/** Leftovers from a lock or unlock that was interrupted (a crash or power cut): safe to delete. */
export function isPartialName(name: string): boolean {
  return /^\..+\.keeperlock\.partial-[0-9a-f]{8}$/.test(name) || /^\..+\.unlocking-[0-9a-f]{8}$/.test(name);
}

// ---------------------------------------------------------------- guessing

/** Waiting time before the next try after `failures` wrong answers: none for the first three, then doubling up to five minutes. */
export function attemptDelay(failures: number): number {
  if (failures < 3) return 0;
  return Math.min(300_000, 1000 * 2 ** (failures - 3));
}

// ---------------------------------------------------------------- what may be locked

/**
 * Folders that must never be locked: drive roots, the home folder and the
 * standard folders themselves, system folders, anything that holds those, and
 * `forbidden` (Keeper's own data and the app itself).
 */
export async function checkLockable(dir: string, ctx: SafetyContext, forbidden: string[] = []): Promise<{ ok: true; real: string } | { ok: false; reason: string }> {
  const v = await checkRemovable(dir, ctx);
  if (!v.ok) return { ok: false, reason: v.reason === 'protected folder' ? 'This is one of your main folders. Lock a folder inside it instead.' : v.reason === 'symbolic links are skipped' ? 'This is a link to a folder. Lock the folder it points to.' : `This folder can’t be locked (${v.reason}).` };
  const win = ctx.platform === 'win32';
  const roots = protectedRoots(ctx);
  const system = roots.filter((r) => !samePath(r, ctx.home, win) && !isInside(r, ctx.home, win));
  for (const s of system) if (isInside(v.real, s, win)) return { ok: false, reason: 'System folders can’t be locked.' };
  for (const r of [...roots, ...forbidden]) {
    if (samePath(r, v.real, win) || isInside(r, v.real, win)) return { ok: false, reason: forbidden.includes(r) ? 'This folder holds Keeper itself or its data.' : 'This folder holds system or main folders. Lock a folder inside it instead.' };
  }
  if (path.basename(v.real).toLowerCase().endsWith(VAULT_EXT)) return { ok: false, reason: 'Folders ending in .keeperlock can’t be locked.' };
  return { ok: true, real: v.real };
}
