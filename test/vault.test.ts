// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { randomBytes } from 'node:crypto';
import { promises as fsp, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attemptDelay, checkLockable, extractVault, isPartialName, isRecoveryKeyShape, listVault, lockFolder, makeWraps, newDataKey, newRecoveryKey,
  normalizeRecoveryKey, passwordStrength, readHeader, unlockFolder, unwrapKey, VAULT_EXT, VaultError, verifyVault,
} from '../core/vault';

// Quick key stretching in tests; the app uses the slow default.
const FAST = { N: 1 << 10, r: 8, p: 1 };
let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-vault-'));
});
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

async function makeFolder(name = 'Secret Stuff'): Promise<{ dir: string; files: Record<string, Buffer> }> {
  const dir = path.join(root, name);
  const files: Record<string, Buffer> = {
    'notes.txt': Buffer.from('my bank pin is 1234'),
    'empty.bin': Buffer.alloc(0),
    'photos/beach.jpg': randomBytes(300_000),
    'photos/2024/ünïcødé 日本 😀.txt': Buffer.from('unicode name'),
    'deep/a/b/c/d.bin': randomBytes(5000),
  };
  for (const [rel, data] of Object.entries(files)) {
    await fsp.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fsp.writeFile(path.join(dir, rel), data);
  }
  await fsp.mkdir(path.join(dir, 'empty folder'), { recursive: true });
  return { dir, files };
}

async function readTree(dir: string): Promise<Record<string, Buffer>> {
  const out: Record<string, Buffer> = {};
  const walk = async (d: string, rel: string) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(d, e.name), r);
      else if (e.isFile()) out[r] = await fsp.readFile(path.join(d, e.name));
    }
  };
  await walk(dir, '');
  return out;
}

async function lockWithPassword(dir: string, password = 'correct horse battery staple', extra: Partial<Parameters<typeof lockFolder>[1]> = {}) {
  const dataKey = newDataKey();
  const recovery = newRecoveryKey();
  const wraps = await makeWraps(dataKey, { password, recovery }, FAST);
  const r = await lockFolder(dir, { dataKey, wraps, chunk: 64 * 1024, ...extra });
  return { ...r, dataKey, recovery, password };
}

describe('locking and unlocking', () => {
  it('round-trips nested folders, empty files and folders, binary data and unicode names', async () => {
    const { dir, files } = await makeFolder();
    const r = await lockWithPassword(dir);
    expect(r.vault).toBe(dir + VAULT_EXT);
    expect(r.leftovers).toBe(false);
    await expect(fsp.stat(dir)).rejects.toThrow();
    expect(r.manifest.files).toBe(Object.keys(files).length);

    const header = await readHeader(r.vault);
    const key = await unwrapKey(header, { password: r.password });
    const u = await unlockFolder(r.vault, key);
    expect(u.folder).toBe(dir);
    const back = await readTree(dir);
    expect(Object.keys(back).sort()).toEqual(Object.keys(files).sort());
    for (const [k, v] of Object.entries(files)) expect(back[k].equals(v)).toBe(true);
    expect((await fsp.stat(path.join(dir, 'empty folder'))).isDirectory()).toBe(true);
    await expect(fsp.stat(r.vault)).rejects.toThrow();
  });

  it('keeps modification times', async () => {
    const { dir } = await makeFolder();
    const when = new Date(2020, 1, 2, 3, 4, 5);
    await fsp.utimes(path.join(dir, 'notes.txt'), when, when);
    const r = await lockWithPassword(dir);
    await unlockFolder(r.vault, r.dataKey);
    expect(Math.abs((await fsp.stat(path.join(dir, 'notes.txt'))).mtimeMs - when.getTime())).toBeLessThan(1000);
  });

  it('streams a large file in chunks', async () => {
    const dir = path.join(root, 'Big');
    await fsp.mkdir(dir);
    const big = randomBytes(30 * 1024 * 1024 + 123);
    await fsp.writeFile(path.join(dir, 'big.bin'), big);
    const dataKey = newDataKey();
    const wraps = await makeWraps(dataKey, { password: 'pw-for-big' }, FAST);
    const phases = new Set<string>();
    const r = await lockFolder(dir, { dataKey, wraps, onProgress: (p) => phases.add(p.phase) });
    expect([...phases]).toEqual(expect.arrayContaining(['scan', 'encrypt', 'verify', 'remove']));
    await unlockFolder(r.vault, dataKey);
    expect(readFileSync(path.join(dir, 'big.bin')).equals(big)).toBe(true);
  });

  it('does not show names or contents in the locked file', async () => {
    const { dir } = await makeFolder();
    const r = await lockWithPassword(dir);
    const raw = readFileSync(r.vault);
    for (const needle of ['notes.txt', 'beach.jpg', 'photos', 'my bank pin', 'ünïcødé', 'empty folder']) {
      expect(raw.includes(Buffer.from(needle))).toBe(false);
    }
  });

  it('unlocks with the recovery key, however it is typed', async () => {
    const { dir, files } = await makeFolder();
    const r = await lockWithPassword(dir);
    const typed = r.recovery.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
    const key = await unwrapKey(await readHeader(r.vault), { recovery: typed });
    await unlockFolder(r.vault, key);
    expect((await readTree(dir))['notes.txt'].equals(files['notes.txt'])).toBe(true);
  });

  it('unlocks with this computer’s key', async () => {
    const { dir } = await makeFolder();
    const dataKey = newDataKey();
    const deviceKey = randomBytes(32);
    const wraps = await makeWraps(dataKey, { deviceKey, deviceId: 'mac-1', recovery: newRecoveryKey() }, FAST);
    const r = await lockFolder(dir, { dataKey, wraps });
    const header = await readHeader(r.vault);
    expect(header.wraps.map((w) => w.kind).sort()).toEqual(['device', 'recovery']);
    expect((await unwrapKey(header, { deviceKey })).equals(dataKey)).toBe(true);
    await expect(unwrapKey(header, { deviceKey: randomBytes(32) })).rejects.toMatchObject({ code: 'wrong-key' });
  });

  it('refuses a wrong password or recovery key', async () => {
    const { dir } = await makeFolder();
    const r = await lockWithPassword(dir);
    const header = await readHeader(r.vault);
    await expect(unwrapKey(header, { password: 'nope' })).rejects.toBeInstanceOf(VaultError);
    await expect(unwrapKey(header, { recovery: newRecoveryKey() })).rejects.toMatchObject({ code: 'wrong-key' });
    await expect(unwrapKey(header, {})).rejects.toMatchObject({ code: 'wrong-key' });
  });

  it('notices a changed byte, and leaves the locked file in place', async () => {
    const { dir } = await makeFolder();
    const r = await lockWithPassword(dir);
    const raw = readFileSync(r.vault);
    const header = await readHeader(r.vault);
    // Flip one byte in the middle of the file data.
    const at = Math.floor(raw.length / 2);
    raw[at] ^= 0x01;
    await fsp.writeFile(r.vault, raw);
    const key = await unwrapKey(header, { password: r.password });
    await expect(verifyVault(r.vault, key)).rejects.toMatchObject({ code: 'tampered' });
    await expect(unlockFolder(r.vault, key)).rejects.toMatchObject({ code: 'tampered' });
    expect((await fsp.stat(r.vault)).size).toBe(raw.length);
    // No half-restored folder is left behind.
    expect((await fsp.readdir(root)).sort()).toEqual([path.basename(r.vault)]);
  });

  it('notices a changed header or a cut-off file', async () => {
    const { dir } = await makeFolder();
    const r = await lockWithPassword(dir);
    const raw = readFileSync(r.vault);
    await fsp.writeFile(r.vault, raw.subarray(0, raw.length - 40));
    await expect(listVault(r.vault, r.dataKey)).rejects.toMatchObject({ code: 'tampered' });
    // Changing the chunk size in the header breaks the manifest's check.
    const s = raw.toString('latin1').replace('"chunk":65536', '"chunk":65537');
    await fsp.writeFile(r.vault, Buffer.from(s, 'latin1'));
    await expect(listVault(r.vault, r.dataKey)).rejects.toMatchObject({ code: 'tampered' });
  });

  it('keeps the original folder when something fails before the end', async () => {
    const { dir, files } = await makeFolder();
    await expect(lockWithPassword(dir, 'pw', { beforeFinalize: () => { throw new Error('power cut'); } })).rejects.toThrow('power cut');
    const back = await readTree(dir);
    for (const [k, v] of Object.entries(files)) expect(back[k].equals(v)).toBe(true);
    // The unfinished locked file is cleaned up.
    expect(await fsp.readdir(root)).toEqual([path.basename(dir)]);
  });

  it('keeps the original folder when cancelled', async () => {
    const { dir } = await makeFolder();
    const ac = new AbortController();
    ac.abort();
    await expect(lockWithPassword(dir, 'pw', { signal: ac.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(await fsp.readdir(root)).toEqual([path.basename(dir)]);
  });

  it('a locked file left over from a crash does not affect the original folder', async () => {
    const { dir, files } = await makeFolder();
    // Simulate a crash after writing: an unfinished file sits next to the folder.
    const partial = path.join(root, `.${path.basename(dir)}${VAULT_EXT}.partial-0123abcd`);
    await fsp.writeFile(partial, 'half written');
    expect(isPartialName(path.basename(partial))).toBe(true);
    const back = await readTree(dir);
    for (const [k, v] of Object.entries(files)) expect(back[k].equals(v)).toBe(true);
    // Locking again still works.
    const r = await lockWithPassword(dir);
    expect(r.vault).toBe(dir + VAULT_EXT);
  });

  it('refuses to lock when a locked file with that name is already there', async () => {
    const { dir } = await makeFolder();
    await fsp.writeFile(dir + VAULT_EXT, 'x');
    await expect(lockWithPassword(dir)).rejects.toMatchObject({ code: 'exists' });
    expect((await fsp.stat(dir)).isDirectory()).toBe(true);
  });

  it('unlocks next to an existing folder of the same name without touching it', async () => {
    const { dir } = await makeFolder('Taxes');
    const r = await lockWithPassword(dir);
    await fsp.mkdir(dir);
    await fsp.writeFile(path.join(dir, 'new.txt'), 'new');
    const u = await unlockFolder(r.vault, r.dataKey);
    expect(path.basename(u.folder)).toBe('Taxes (unlocked)');
    expect(await fsp.readdir(dir)).toEqual(['new.txt']);
  });

  it('extracts into a fresh folder and lists contents without unlocking', async () => {
    const { dir, files } = await makeFolder();
    const r = await lockWithPassword(dir);
    const m = await listVault(r.vault, r.dataKey);
    expect(m.entries.filter((e) => e.t === 'f').map((e) => e.p).sort()).toEqual(Object.keys(files).sort());
    const out = path.join(root, 'copy');
    await extractVault(r.vault, r.dataKey, out);
    expect((await readTree(out))['photos/beach.jpg'].equals(files['photos/beach.jpg'])).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('stores symbolic links as links', async () => {
    const { dir } = await makeFolder();
    await fsp.symlink('notes.txt', path.join(dir, 'link-to-notes'));
    const r = await lockWithPassword(dir);
    await unlockFolder(r.vault, r.dataKey);
    expect(await fsp.readlink(path.join(dir, 'link-to-notes'))).toBe('notes.txt');
  });
});

describe('keys and passwords', () => {
  it('makes recovery keys that are easy to read and type', () => {
    const k = newRecoveryKey();
    expect(k).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(isRecoveryKeyShape(k.toLowerCase())).toBe(true);
    expect(isRecoveryKeyShape('hello')).toBe(false);
    expect(normalizeRecoveryKey('ab-cd o i l')).toBe('ABCD011');
    expect(newRecoveryKey()).not.toBe(k);
  });

  it('rates passwords', () => {
    expect(passwordStrength('').score).toBe(0);
    expect(passwordStrength('password1').score).toBe(0);
    expect(passwordStrength('aaaaaaaaaaaa').score).toBeLessThanOrEqual(1);
    expect(passwordStrength('Tr0ub4dor&3').score).toBeGreaterThanOrEqual(2);
    expect(passwordStrength('correct horse battery staple').score).toBe(4);
  });

  it('slows down guessing after a few wrong tries', () => {
    expect(attemptDelay(0)).toBe(0);
    expect(attemptDelay(2)).toBe(0);
    expect(attemptDelay(3)).toBe(1000);
    expect(attemptDelay(6)).toBe(8000);
    expect(attemptDelay(50)).toBe(300_000);
  });
});

describe('what may be locked', () => {
  it('refuses roots, the home folder, main folders and folders that hold them', async () => {
    const home = await fsp.realpath(root);
    const ctx = { platform: process.platform, home };
    await fsp.mkdir(path.join(home, 'Documents', 'Taxes'), { recursive: true });
    expect((await checkLockable(path.parse(home).root, ctx)).ok).toBe(false);
    expect((await checkLockable(home, ctx)).ok).toBe(false);
    expect((await checkLockable(path.join(home, 'Documents'), ctx)).ok).toBe(false);
    expect((await checkLockable(path.dirname(home), ctx)).ok).toBe(false);
    const app = path.join(home, 'Documents', 'Taxes');
    expect((await checkLockable(app, ctx, [path.join(app, 'Keeper.app')])).ok).toBe(false);
    // On macOS the temporary folder sits under /private, a system folder.
    if (process.platform !== 'darwin') expect(await checkLockable(app, ctx)).toMatchObject({ ok: true });
  });
});
