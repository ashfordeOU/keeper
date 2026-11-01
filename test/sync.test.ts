// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chunkBuffer, chunkFile, SYNC_CHUNKS } from '../core/sync/chunker';
import { FolderSync, type FolderConfig } from '../core/sync/engine';
import { conflictName, emptyState, isConflictName, scanFolder } from '../core/sync/folder';
import { IgnoreMatcher } from '../core/sync/ignore';
import { SyncNode } from '../core/sync/node';
import { MemoryNetwork } from '../core/sync/ports';
import { keepVersions, listVersions, parseVersionRel, versionRel } from '../core/sync/versions';
import { compareVV, mergeVV } from '../core/sync/vv';

const tmps: string[] = [];
async function tmp() {
  const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-sync-'));
  tmps.push(d);
  return d;
}
afterEach(async () => {
  for (const d of tmps.splice(0)) await fsp.rm(d, { recursive: true, force: true });
});

// Deterministic "random" bytes so chunk boundaries are reproducible.
function bytes(n: number, seed = 1) {
  const b = Buffer.alloc(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    b[i] = s >>> 24;
  }
  return b;
}

const ago = (ms: number) => new Date(Date.now() - ms);
async function write(root: string, rel: string, data: string | Buffer) {
  const p = path.join(root, ...rel.split('/'));
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, data);
  // Older than the "still being written" window.
  await fsp.utimes(p, ago(10_000), ago(10_000));
}
const read = (root: string, rel: string) => fsp.readFile(path.join(root, ...rel.split('/')), 'utf8');
const exists = (root: string, rel: string) => fsp.stat(path.join(root, ...rel.split('/'))).then(() => true, () => false);

describe('chunker', () => {
  it('cuts by content: inserting a byte only changes the chunks around it', () => {
    const a = bytes(3 << 20);
    const b = Buffer.concat([a.subarray(0, 1_000_000), Buffer.from([42]), a.subarray(1_000_000)]);
    const ca = chunkBuffer(a).map((c) => c.hash);
    const cb = chunkBuffer(b).map((c) => c.hash);
    const shared = cb.filter((h) => ca.includes(h)).length;
    expect(ca.length).toBeGreaterThan(20);
    expect(cb.length - shared).toBeLessThanOrEqual(2);
  });
  it('keeps chunk sizes within bounds', () => {
    const cs = chunkBuffer(bytes(4 << 20, 7));
    for (const c of cs.slice(0, -1)) {
      expect(c.size).toBeGreaterThanOrEqual(SYNC_CHUNKS.min);
      expect(c.size).toBeLessThanOrEqual(SYNC_CHUNKS.max);
    }
  });
  it('streams a file into the same chunks as the buffer', async () => {
    const d = await tmp();
    const data = bytes(2_500_000, 3);
    await fsp.writeFile(path.join(d, 'f'), data);
    const r = await chunkFile(path.join(d, 'f'));
    expect(r.chunks.map((c) => c.hash)).toEqual(chunkBuffer(data).map((c) => c.hash));
    expect(r.size).toBe(data.length);
  });
});

describe('ignore patterns', () => {
  const m = new IgnoreMatcher(['*.tmp', 'build/', '/top.txt', '!keep.tmp', 'docs/**/draft*']);
  it('works like a .gitignore', () => {
    expect(m.ignored('a.tmp')).toBe(true);
    expect(m.ignored('x/keep.tmp')).toBe(false);
    expect(m.ignored('build/out.js')).toBe(true);
    expect(m.ignored('src/build/x')).toBe(true);
    expect(m.ignored('top.txt')).toBe(true);
    expect(m.ignored('sub/top.txt')).toBe(false);
    expect(m.ignored('docs/a/b/draft-1.md')).toBe(true);
    expect(m.ignored('notes.md')).toBe(false);
  });
  it('always leaves out Keeper’s own files and system clutter', () => {
    expect(m.ignored('.keeper-versions/a~20260101-000000.txt')).toBe(true);
    expect(m.ignored('.DS_Store')).toBe(true);
    expect(m.ignored('a/.f.txt.keeper-part')).toBe(true);
  });
});

describe('version vectors', () => {
  it('order and merge', () => {
    expect(compareVV({ a: 2 }, { a: 1 })).toBe('newer');
    expect(compareVV({ a: 1 }, { a: 1, b: 1 })).toBe('older');
    expect(compareVV({ a: 2, b: 1 }, { a: 1, b: 2 })).toBe('concurrent');
    expect(mergeVV({ a: 2, b: 1 }, { a: 1, b: 3 })).toEqual({ a: 2, b: 3 });
  });
});

describe('names', () => {
  it('conflict copies keep the extension and say who and when', () => {
    const n = conflictName('photos/cat.jpg', 'Anna’s laptop', new Date(2026, 9, 31, 14, 5).getTime());
    expect(n).toBe('photos/cat (conflict, Anna’s laptop, 2026-10-31 14.05).jpg');
    expect(isConflictName(n)).toBe(true);
  });
  it('version names round-trip', () => {
    const t = Date.UTC(2026, 9, 31, 14, 5, 9);
    const v = versionRel('a/b/report.final.pdf', t);
    expect(v).toBe('a/b/report.final~20261031-140509.pdf');
    expect(parseVersionRel(v)).toEqual({ rel: 'a/b/report.final.pdf', time: t });
  });
});

describe('version thinning', () => {
  const now = Date.UTC(2026, 9, 31, 12);
  const H = 3600_000;
  it('staggered keeps one an hour, then one a day', () => {
    const times = [10 * 60_000, 2 * H + 10 * 60_000, 2 * H + 20 * 60_000, 30 * H, 31 * H, 40 * 24 * H].map((a) => now - a);
    const keep = keepVersions(times, { type: 'staggered', maxDays: 365 }, now);
    expect(keep.has(now - 10 * 60_000)).toBe(true);
    expect([now - 2 * H - 10 * 60_000, now - 2 * H - 20 * 60_000].filter((t) => keep.has(t)).length).toBe(1);
    expect(keep.has(now - 40 * 24 * H)).toBe(true);
  });
  it('simple and trash-can rules', () => {
    expect(keepVersions([1, 2, 3, 4], { type: 'simple', keep: 2 }, now)).toEqual(new Set([4, 3]));
    expect(keepVersions([now - 2 * 24 * H, now - 10 * 24 * H], { type: 'trashcan', days: 7 }, now)).toEqual(new Set([now - 2 * 24 * H]));
  });
});

// ---------------------------------------------------------------- devices syncing

async function device(net: MemoryNetwork, id: string, folder = 'f1', mode: FolderConfig['mode'] = 'two-way', devices = ['A', 'B', 'C']) {
  const root = await tmp();
  const t = net.join(id);
  const node = new SyncNode(t);
  const f = new FolderSync({ id: folder, root, mode, devices: devices.filter((d) => d !== id), ignore: [], versioning: { type: 'trashcan', days: 30 } }, emptyState(folder, id), {
    deviceName: (d) => `Device ${d}`,
    save: async () => undefined,
  });
  node.add(f);
  return { id, root, node, f, net };
}

/** Scan everyone, then sync everyone, a few times over (like the app's loop). */
async function settle(devs: Awaited<ReturnType<typeof device>>[], rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    for (const d of devs) await d.node.scanAll();
    for (const d of devs) await d.node.syncAll();
  }
}

describe('folder sync between devices', () => {
  it('creates, changes, renames and deletes across two devices', async () => {
    const net = new MemoryNetwork();
    const a = await device(net, 'A', 'f1', 'two-way', ['A', 'B']);
    const b = await device(net, 'B', 'f1', 'two-way', ['A', 'B']);
    await write(a.root, 'docs/hello.txt', 'hello');
    await write(a.root, 'big.bin', bytes(1_200_000, 5));
    await settle([a, b]);
    expect(await read(b.root, 'docs/hello.txt')).toBe('hello');
    expect((await fsp.readFile(path.join(b.root, 'big.bin'))).equals(bytes(1_200_000, 5))).toBe(true);

    // Change on B comes back to A; the old text is kept as a version on A.
    await write(b.root, 'docs/hello.txt', 'hello again');
    await settle([a, b]);
    expect(await read(a.root, 'docs/hello.txt')).toBe('hello again');
    expect((await listVersions(a.root, 'docs/hello.txt')).length).toBe(1);

    // A rename moves no bytes: everything is already there.
    await fsp.rename(path.join(a.root, 'big.bin'), path.join(a.root, 'moved.bin'));
    await fsp.utimes(path.join(a.root, 'moved.bin'), ago(10_000), ago(10_000));
    for (const d of [a, b]) await d.node.scanAll();
    const rounds = await b.node.syncAll();
    expect(rounds.reduce((n, r) => n + r.bytes, 0)).toBe(0);
    await settle([a, b]);
    expect(await exists(b.root, 'moved.bin')).toBe(true);
    expect(await exists(b.root, 'big.bin')).toBe(false);
    // Deleted files are kept as versions, never just gone.
    expect((await listVersions(b.root, 'big.bin')).length).toBe(1);
  });

  it('a small edit to a big file moves only the changed pieces', async () => {
    const net = new MemoryNetwork();
    const a = await device(net, 'A', 'f1', 'two-way', ['A', 'B']);
    const b = await device(net, 'B', 'f1', 'two-way', ['A', 'B']);
    const big = bytes(3 << 20, 9);
    await write(a.root, 'v.bin', big);
    await settle([a, b]);
    const edited = Buffer.concat([big.subarray(0, 2_000_000), Buffer.from('EDIT'), big.subarray(2_000_000)]);
    await write(a.root, 'v.bin', edited);
    await a.node.scanAll();
    const r = await b.node.syncAll();
    const moved = r.reduce((n, x) => n + x.bytes, 0);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(600 << 10);
    expect((await fsp.readFile(path.join(b.root, 'v.bin'))).equals(edited)).toBe(true);
  });

  it('when both change the same file, both versions are kept', async () => {
    const net = new MemoryNetwork();
    const a = await device(net, 'A', 'f1', 'two-way', ['A', 'B']);
    const b = await device(net, 'B', 'f1', 'two-way', ['A', 'B']);
    await write(a.root, 'note.txt', 'v1');
    await settle([a, b]);
    net.setOnline('B', false);
    await write(a.root, 'note.txt', 'from A');
    const p = path.join(b.root, 'note.txt');
    await fsp.writeFile(p, 'from B');
    await fsp.utimes(p, ago(5000), ago(5000));
    await a.node.scanAll();
    await b.node.scanAll();
    net.setOnline('B', true);
    await settle([a, b]);
    for (const d of [a, b]) {
      const names = (await fsp.readdir(d.root)).filter((n) => !n.startsWith('.'));
      expect(names.length).toBe(2);
      const copy = names.find((n) => n.includes('(conflict'))!;
      expect(copy).toBeTruthy();
      // B's edit is later, so it keeps the name; A's is the conflict copy.
      expect(await read(d.root, 'note.txt')).toBe('from B');
      expect(await read(d.root, copy)).toBe('from A');
    }
  });

  it('three devices end up the same, including through a device in the middle', async () => {
    const net = new MemoryNetwork();
    const a = await device(net, 'A');
    const b = await device(net, 'B');
    const c = await device(net, 'C');
    // A and C never meet directly: B carries changes between them.
    net.setOnline('C', false);
    await write(a.root, 'a.txt', 'from a');
    await settle([a, b]);
    net.setOnline('A', false);
    net.setOnline('C', true);
    await write(c.root, 'c.txt', 'from c');
    await settle([b, c]);
    net.setOnline('C', false);
    net.setOnline('A', true);
    await settle([a, b]);
    for (const d of [a, b]) expect((await fsp.readdir(d.root)).filter((n) => !n.startsWith('.')).sort()).toEqual(['a.txt', 'c.txt']);
    net.setOnline('C', true);
    await settle([a, b, c]);
    expect((await fsp.readdir(c.root)).filter((n) => !n.startsWith('.')).sort()).toEqual(['a.txt', 'c.txt']);
  });

  it('send-only and receive-only folders', async () => {
    const net = new MemoryNetwork();
    const a = await device(net, 'A', 'f1', 'send-only', ['A', 'B']);
    const b = await device(net, 'B', 'f1', 'receive-only', ['A', 'B']);
    await write(a.root, 'x.txt', 'out');
    await write(b.root, 'local.txt', 'mine');
    await settle([a, b]);
    expect(await read(b.root, 'x.txt')).toBe('out');
    expect(await exists(a.root, 'local.txt')).toBe(false);
  });

  it('never writes into a locked folder', async () => {
    const net = new MemoryNetwork();
    const a = await device(net, 'A', 'f1', 'two-way', ['A', 'B']);
    const b = await device(net, 'B', 'f1', 'two-way', ['A', 'B']);
    await write(a.root, 'Secret/plan.txt', 'p');
    await fsp.writeFile(path.join(b.root, 'Secret.keeperlock'), 'locked');
    await fsp.utimes(path.join(b.root, 'Secret.keeperlock'), ago(10_000), ago(10_000));
    await settle([a, b]);
    expect(await exists(b.root, 'Secret/plan.txt')).toBe(false);
  });

  it('resumes a copy that was cut off', async () => {
    const net = new MemoryNetwork();
    const a = await device(net, 'A', 'f1', 'two-way', ['A', 'B']);
    const b = await device(net, 'B', 'f1', 'two-way', ['A', 'B']);
    const big = bytes(6 << 20, 11);
    await write(a.root, 'big.bin', big);
    await a.node.scanAll();
    // Cut the network after a few pieces.
    let pieces = 0;
    const orig = (a.f as unknown as { serve: FolderSync['serve'] }).serve.bind(a.f);
    a.f.serve = async (peer, m, p) => {
      if (m === 'block' && ++pieces === 40) net.setOnline('A', false);
      return orig(peer, m, p);
    };
    await b.node.syncAll();
    expect(await exists(b.root, 'big.bin')).toBe(false);
    const side = JSON.parse(await fsp.readFile(path.join(b.root, '.big.bin.keeper-part.json'), 'utf8'));
    expect(side.bytes).toBeGreaterThan(0);
    net.setOnline('A', true);
    pieces = -1e9;
    const r = await b.node.syncAll();
    expect((await fsp.readFile(path.join(b.root, 'big.bin'))).equals(big)).toBe(true);
    expect(r.reduce((n, x) => n + x.bytes, 0)).toBeLessThan(big.length);
  });
});

describe('offers', () => {
  it('a device sees the folders another shares with it, until it accepts them', async () => {
    const net = new MemoryNetwork();
    const a = await device(net, 'A', 'shared-1', 'two-way', ['A', 'B']);
    const bRoot = await tmp();
    const bNode = new SyncNode(net.join('B'));
    let offers = await bNode.offers();
    expect(offers).toEqual([{ peer: 'A', peerName: 'A', id: 'shared-1', label: 'shared-1' }]);
    await write(a.root, 'x.txt', 'from A');
    bNode.add(new FolderSync({ id: 'shared-1', root: bRoot, mode: 'two-way', devices: ['A'], ignore: [], versioning: { type: 'none' } }, emptyState('shared-1', 'B'), { deviceName: (d) => d, save: async () => undefined }));
    offers = await bNode.offers();
    expect(offers).toEqual([]);
    await a.node.scanAll();
    await bNode.syncAll();
    expect(await read(bRoot, 'x.txt')).toBe('from A');
  });
});

describe('scanning', () => {
  it('a touched but unchanged file keeps its version', async () => {
    const d = await tmp();
    await write(d, 'a.txt', 'same');
    const s = emptyState('f', 'A');
    await scanFolder(d, s);
    const v = s.files['a.txt'].version;
    await fsp.utimes(path.join(d, 'a.txt'), ago(5000), ago(5000));
    const r = await scanFolder(d, s);
    expect(r.changed).toEqual([]);
    expect(s.files['a.txt'].version).toEqual(v);
  });
  it('waits for files still being written', async () => {
    const d = await tmp();
    await fsp.writeFile(path.join(d, 'new.txt'), randomBytes(10));
    const s = emptyState('f', 'A');
    const r = await scanFolder(d, s);
    expect(r.busy).toEqual(['new.txt']);
    expect(s.files['new.txt']).toBeUndefined();
  });
});
