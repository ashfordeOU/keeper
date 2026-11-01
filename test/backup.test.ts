// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupRepo, keepSnapshots } from '../core/sync/backup';
import { mirror, type MirrorState } from '../core/sync/mirror';
import { FolderStore, MemoryStore } from '../core/sync/ports';

const FAST = { N: 1 << 10, r: 8, p: 1 };
const tmps: string[] = [];
async function tmp() {
  const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-bk-'));
  tmps.push(d);
  return d;
}
afterEach(async () => {
  for (const d of tmps.splice(0)) await fsp.rm(d, { recursive: true, force: true });
});

function bytes(n: number, seed = 1) {
  const b = Buffer.alloc(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    b[i] = s >>> 24;
  }
  return b;
}

async function sampleFolder() {
  const d = await tmp();
  await fsp.mkdir(path.join(d, 'Holiday'), { recursive: true });
  await fsp.writeFile(path.join(d, 'notes.txt'), 'remember the milk\n'.repeat(200));
  await fsp.writeFile(path.join(d, 'Holiday', 'beach.raw'), bytes(3_000_000, 4));
  await fsp.writeFile(path.join(d, 'Holiday', 'copy of beach.raw'), bytes(3_000_000, 4));
  await fsp.writeFile(path.join(d, 'empty.txt'), '');
  return d;
}

describe('encrypted, deduplicated backups', () => {
  it('backs up and restores byte for byte, and a second backup uploads almost nothing', async () => {
    const src = await sampleFolder();
    const store = new MemoryStore();
    const { repo, recovery } = await BackupRepo.init(store, 'correct horse', { kdf: FAST });
    repo.packSize = 1 << 20;
    const first = await repo.backup({ Files: src });
    expect(first.stats.files).toBe(4);
    // The two identical photos are stored once (plus compression of the text).
    expect(store.written).toBeLessThan(3_000_000 + 200_000);
    const before = store.written;
    const second = await repo.backup({ Files: src });
    expect(second.stats.newBytes).toBe(0);
    expect(store.written - before).toBeLessThan(10_000);

    const out = await tmp();
    const again = await BackupRepo.open(store, { recovery });
    const r = await again.restore(second.name, out);
    expect(r.files).toBe(4);
    expect((await fsp.readFile(path.join(out, 'Files', 'Holiday', 'beach.raw'))).equals(bytes(3_000_000, 4))).toBe(true);
    expect(await fsp.readFile(path.join(out, 'Files', 'notes.txt'), 'utf8')).toBe('remember the milk\n'.repeat(200));
    expect((await fsp.stat(path.join(out, 'Files', 'empty.txt'))).size).toBe(0);
    expect((await again.snapshots()).length).toBe(2);
  });

  it('a changed file only adds its changed pieces', async () => {
    const src = await sampleFolder();
    const store = new MemoryStore();
    const { repo } = await BackupRepo.init(store, 'pw', { kdf: FAST });
    await repo.backup({ Files: src });
    const big = bytes(3_000_000, 4);
    await fsp.writeFile(path.join(src, 'Holiday', 'beach.raw'), Buffer.concat([big.subarray(0, 1_500_000), Buffer.from('X'), big.subarray(1_500_000)]));
    const s = await repo.backup({ Files: src });
    expect(s.stats.newBytes).toBeGreaterThan(0);
    expect(s.stats.newBytes).toBeLessThan(3 * 4 << 20);
    expect(s.stats.newBytes).toBeLessThan(big.length);
  });

  it('restores just one file or folder', async () => {
    const src = await sampleFolder();
    const store = new MemoryStore();
    const { repo } = await BackupRepo.init(store, 'pw', { kdf: FAST });
    const s = await repo.backup({ Files: src });
    const out = await tmp();
    const r = await repo.restore(s.name, out, { include: ['Files/Holiday'] });
    expect(r.files).toBe(2);
    expect(await fsp.stat(path.join(out, 'Files', 'notes.txt')).then(() => true, () => false)).toBe(false);
  });

  it('the wrong password does not open it, and nothing readable is stored', async () => {
    const src = await sampleFolder();
    const store = new MemoryStore();
    const { repo } = await BackupRepo.init(store, 'right', { kdf: FAST });
    await repo.backup({ Files: src });
    await expect(BackupRepo.open(store, { password: 'wrong' })).rejects.toMatchObject({ code: 'wrong-key' });
    for (const [p, f] of store.files) {
      if (p === 'keeper-backup.json') continue;
      expect(f.data.includes(Buffer.from('remember the milk'))).toBe(false);
      expect(f.data.includes(Buffer.from('beach'))).toBe(false);
    }
  });

  it('notices damage', async () => {
    const src = await sampleFolder();
    const store = new MemoryStore();
    const { repo } = await BackupRepo.init(store, 'pw', { kdf: FAST });
    const s = await repo.backup({ Files: src });
    expect((await repo.verify({ full: true })).ok).toBe(true);
    const pack = [...store.files.keys()].find((k) => k.startsWith('packs/'))!;
    store.files.get(pack)!.data[100] ^= 0xff;
    const fresh = await BackupRepo.open(store, { password: 'pw' });
    const v = await fresh.verify({ full: true });
    expect(v.ok).toBe(false);
    await expect(fresh.restore(s.name, await tmp())).rejects.toMatchObject({ code: 'damaged' });
  });

  it('works on a folder (a drive or a NAS) too', async () => {
    const src = await sampleFolder();
    const dest = await tmp();
    const { repo } = await BackupRepo.init(new FolderStore(dest), 'pw', { kdf: FAST });
    const s = await repo.backup({ Files: src });
    const out = await tmp();
    expect((await (await BackupRepo.open(new FolderStore(dest), { password: 'pw' })).restore(s.name, out)).files).toBe(4);
  });

  it('retention keeps the newest of each day, week and month and frees what nothing uses', async () => {
    const day = 24 * 3600_000;
    const now = new Date(2026, 9, 31, 12).getTime();
    const snaps = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, time: now - i * day }));
    const keep = keepSnapshots(snaps, { last: 2, daily: 7, weekly: 4, monthly: 3 });
    expect(keep.has('s0') && keep.has('s1') && keep.has('s6')).toBe(true);
    expect(keep.size).toBeLessThan(16);
    // The newest backup of September (30 days back) stands for that month.
    expect(keep.has('s31')).toBe(true);
    expect(keep.has('s59')).toBe(false);

    const src = await sampleFolder();
    const store = new MemoryStore();
    const { repo } = await BackupRepo.init(store, 'pw', { kdf: FAST });
    // Small packs, so the photos' pieces are not in the same pack as the note that stays.
    repo.packSize = 1 << 20;
    await repo.backup({ Files: src }, { now: now - 3 * day });
    await fsp.rm(path.join(src, 'Holiday'), { recursive: true });
    await repo.backup({ Files: src }, { now });
    const r = await repo.forget({ last: 1 });
    expect(r.removed.length).toBe(1);
    expect(r.freedBytes).toBeGreaterThan(1_000_000);
    expect((await repo.verify({ full: true })).ok).toBe(true);
  });
});

describe('mirroring to a cloud folder', () => {
  const ago = (p: string, ms: number) => fsp.utimes(p, new Date(Date.now() - ms), new Date(Date.now() - ms));

  it('one way up: new and changed files go up, a deletion here is deleted there', async () => {
    const local = await tmp();
    const store = new MemoryStore();
    const state: MirrorState = { files: {} };
    await fsp.writeFile(path.join(local, 'a.jpg'), 'A');
    await fsp.mkdir(path.join(local, 'trip'));
    await fsp.writeFile(path.join(local, 'trip', 'b.jpg'), 'B');
    let r = await mirror(local, store, 'Pictures', 'up', state);
    expect(r.uploaded.sort()).toEqual(['a.jpg', 'trip/b.jpg']);
    expect((await store.get('Pictures/trip/b.jpg')).toString()).toBe('B');
    await fsp.writeFile(path.join(local, 'a.jpg'), 'A2');
    await ago(path.join(local, 'a.jpg'), 5000);
    await fsp.rm(path.join(local, 'trip', 'b.jpg'));
    r = await mirror(local, store, 'Pictures', 'up', state);
    expect(r.uploaded).toEqual(['a.jpg']);
    expect(r.deletedThere).toEqual(['trip/b.jpg']);
    // Files that only exist over there are left alone in one-way mode.
    await store.put('Pictures/theirs.jpg', Buffer.from('T'));
    r = await mirror(local, store, 'Pictures', 'up', state);
    expect(await store.stat('Pictures/theirs.jpg')).toBeTruthy();
  });

  it('both ways: changes meet, a conflict keeps both', async () => {
    const local = await tmp();
    const remoteDir = await tmp();
    const store = new FolderStore(remoteDir);
    const state: MirrorState = { files: {} };
    await fsp.writeFile(path.join(local, 'doc.txt'), 'v1');
    await mirror(local, store, '', 'both', state);
    await fsp.writeFile(path.join(remoteDir, 'new-there.txt'), 'there');
    let r = await mirror(local, store, '', 'both', state);
    expect(r.downloaded).toEqual(['new-there.txt']);
    await fsp.writeFile(path.join(local, 'doc.txt'), 'here edit');
    await ago(path.join(local, 'doc.txt'), 3000);
    await fsp.writeFile(path.join(remoteDir, 'doc.txt'), 'there edit!!');
    await ago(path.join(remoteDir, 'doc.txt'), 2000);
    r = await mirror(local, store, '', 'both', state);
    expect(r.conflicts.length).toBe(1);
    expect(await fsp.readFile(path.join(local, 'doc.txt'), 'utf8')).toBe('here edit');
    expect(await fsp.readFile(path.join(local, r.conflicts[0]), 'utf8')).toBe('there edit!!');
    expect(await fsp.readFile(path.join(remoteDir, 'doc.txt'), 'utf8')).toBe('here edit');
    // Deleted there, untouched here: deleted here too, kept as a version.
    await fsp.rm(path.join(remoteDir, 'new-there.txt'));
    r = await mirror(local, store, '', 'both', state);
    expect(r.deletedHere).toEqual(['new-there.txt']);
    expect((await fsp.readdir(path.join(local, '.keeper-versions'))).length).toBeGreaterThan(0);
  });
});

describe('backups to a cloud connection', () => {
  it('work through a connection’s file access (as Google Drive, OneDrive, SFTP… provide it)', async () => {
    const { Readable } = await import('node:stream');
    const { storeFromRemoteFs } = await import('../electron/services/sync/remote-adapter');
    // A stand-in for a connection: absolute paths, streams in and out, folders must exist.
    const files = new Map<string, Buffer>();
    const dirs = new Set<string>(['/']);
    const parent = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';
    const fs = {
      async list(dir: string) {
        const d = dir === '/' ? '' : dir;
        const out = new Map<string, { path: string; isDir: boolean; size: number; mtime: number }>();
        for (const [p, b] of files) if (parent(p) === (d || '/')) out.set(p, { path: p, isDir: false, size: b.length, mtime: 1 });
        for (const x of dirs) if (x !== '/' && parent(x) === (d || '/')) out.set(x, { path: x, isDir: true, size: 0, mtime: 1 });
        return [...out.values()];
      },
      async stat(p: string) {
        if (files.has(p)) return { path: p, isDir: false, size: files.get(p)!.length, mtime: 1 };
        return dirs.has(p) ? { path: p, isDir: true, size: 0, mtime: 1 } : null;
      },
      async read(p: string, o?: { start?: number; end?: number }) {
        const b = files.get(p);
        if (!b) throw new Error('missing');
        return Readable.from([o ? b.subarray(o.start ?? 0, o.end) : b]);
      },
      async write(p: string, data: NodeJS.ReadableStream) {
        if (!dirs.has(parent(p))) throw new Error(`no folder ${parent(p)}`);
        const parts: Buffer[] = [];
        for await (const c of data as AsyncIterable<Buffer>) parts.push(Buffer.from(c));
        files.set(p, Buffer.concat(parts));
      },
      async mkdir(p: string) {
        if (!dirs.has(parent(p))) throw new Error('no parent');
        dirs.add(p);
      },
      async rename(a: string, b: string) {
        files.set(b, files.get(a)!);
        files.delete(a);
      },
      async remove(p: string) {
        files.delete(p);
      },
    };
    const store = storeFromRemoteFs(fs, 'Test cloud');
    const src = await sampleFolder();
    const { repo } = await BackupRepo.init(store, 'pw', { kdf: FAST });
    const s = await repo.backup({ Files: src });
    expect([...files.keys()].some((k) => k.startsWith('/packs/'))).toBe(true);
    const out = await tmp();
    const r = await (await BackupRepo.open(store, { password: 'pw' })).restore(s.name, out);
    expect(r.files).toBe(4);
    expect((await fsp.readFile(path.join(out, 'Files', 'Holiday', 'beach.raw'))).equals(bytes(3_000_000, 4))).toBe(true);
  });
});
