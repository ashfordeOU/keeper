// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Side by Side (core/panes.ts): sides in routes, comparing two folders, the sync plan, and walking a side.
import { describe, expect, it } from 'vitest';
import {
  compareFolders, decodePane, diffCounts, diffLabel, encodePane, newTabRoute, pairKey, paneChild, paneParent, panesRoute, paneTitle, planSummary,
  rootedStore, samePane, syncPlan, walkSide, type CompareItem,
} from '../core/panes';
import { MemoryStore } from '../core/sync/ports';

const T = 1_700_000_000_000;
const f = (rel: string, size: number, mtime = T): CompareItem => ({ rel, isDir: false, size, mtime });
const d = (rel: string): CompareItem => ({ rel, isDir: true, size: 0, mtime: T });

describe('sides in a route', () => {
  it('keeps local paths as they are and connections as @id:path', () => {
    expect(encodePane({ kind: 'local', path: '/Users/ana/Downloads' })).toBe('/Users/ana/Downloads');
    expect(encodePane({ kind: 'local', path: 'C:\\Users\\Ana' })).toBe('C:\\Users\\Ana');
    expect(encodePane({ kind: 'remote', id: 'nas1', path: 'Photos/../Backups/' })).toBe('@nas1:/Backups');
    expect(decodePane('@nas1:/Backups/2026')).toEqual({ kind: 'remote', id: 'nas1', path: '/Backups/2026' });
    expect(decodePane('C:\\Users\\Ana')).toEqual({ kind: 'local', path: 'C:\\Users\\Ana' });
    expect(decodePane('@:/x')).toBeNull();
    expect(decodePane(undefined)).toBeNull();
    expect(panesRoute({ kind: 'local', path: '/a' }, { kind: 'remote', id: 'x', path: '/' })).toEqual({ name: 'panes', arg: '/a', q: '@x:/' });
    expect(samePane({ kind: 'remote', id: 'x', path: '/a/' }, { kind: 'remote', id: 'x', path: '/a' })).toBe(true);
  });

  it('goes up and in on every kind of path', () => {
    expect(paneParent({ kind: 'local', path: '/Users/ana' })).toEqual({ kind: 'local', path: '/Users' });
    expect(paneParent({ kind: 'local', path: '/Users' })).toEqual({ kind: 'local', path: '/' });
    expect(paneParent({ kind: 'local', path: '/' })).toBeNull();
    expect(paneParent({ kind: 'local', path: 'C:\\Users' }, '\\')).toEqual({ kind: 'local', path: 'C:\\' });
    expect(paneParent({ kind: 'local', path: 'C:\\' }, '\\')).toBeNull();
    expect(paneParent({ kind: 'remote', id: 'n', path: '/a/b' })).toEqual({ kind: 'remote', id: 'n', path: '/a' });
    expect(paneParent({ kind: 'remote', id: 'n', path: '/' })).toBeNull();
    expect(paneChild({ kind: 'local', path: '/' }, 'tmp')).toEqual({ kind: 'local', path: '/tmp' });
    expect(paneChild({ kind: 'local', path: 'C:\\Users' }, 'Ana', '\\')).toEqual({ kind: 'local', path: 'C:\\Users\\Ana' });
    expect(paneChild({ kind: 'remote', id: 'n', path: '/' }, 'Photos')).toEqual({ kind: 'remote', id: 'n', path: '/Photos' });
    expect(paneTitle({ kind: 'remote', id: 'n', path: '/' }, 'Studio NAS')).toBe('Studio NAS');
    expect(paneTitle({ kind: 'local', path: '/Users/ana/Downloads/' })).toBe('Downloads');
  });

  it('a new tab on a folder opens the same folder; elsewhere Hello', () => {
    expect(newTabRoute({ name: 'browse', arg: '/x' })).toEqual({ name: 'browse', arg: '/x', q: undefined });
    expect(newTabRoute({ name: 'panes', arg: '/a', q: '/b' })).toEqual({ name: 'panes', arg: '/a', q: '/b' });
    expect(newTabRoute({ name: 'remote' })).toEqual({ name: 'home' });
    expect(newTabRoute({ name: 'settings' })).toEqual({ name: 'home' });
  });
});

describe('comparing two folders', () => {
  it('names each difference, from either side', () => {
    const rows = compareFolders(
      [f('same.txt', 5), f('left.txt', 1), f('newer-left.txt', 3, T + 60_000), f('newer-right.txt', 3), f('odd.txt', 7)],
      [f('same.txt', 5, T + 1500), f('right.txt', 2), f('newer-left.txt', 3), f('newer-right.txt', 4, T + 60_000), f('odd.txt', 8)],
    );
    const by = Object.fromEntries(rows.map((r) => [r.rel, r.state]));
    expect(by).toEqual({ 'same.txt': 'same', 'left.txt': 'left-only', 'right.txt': 'right-only', 'newer-left.txt': 'left-newer', 'newer-right.txt': 'right-newer', 'odd.txt': 'different' });
    expect(diffCounts(rows)).toMatchObject({ same: 1, 'left-only': 1, 'right-only': 1, different: 1 });
    expect(diffLabel('right-newer')).toBe('Newer on the right');
  });

  it('a folder on one side is one row, without its contents', () => {
    const rows = compareFolders([d('Trip'), f('Trip/a.jpg', 1), f('Trip/b/c.jpg', 1), d('Both'), f('Both/x', 1)], [d('Both'), f('Both/x', 1), f('Both/y', 2)]);
    expect(rows.map((r) => [r.rel, r.state])).toEqual([['Both', 'same'], ['Trip', 'left-only'], ['Both/x', 'same'], ['Both/y', 'right-only']]);
  });

  it('a folder here and a file there is never a simple replace', () => {
    const rows = compareFolders([d('Notes')], [f('Notes', 10)]);
    expect(rows[0].state).toBe('different');
    expect(syncPlan(rows, 'both').steps).toHaveLength(0);
  });

  it('what Keeper synced last time is the same, even with the copy’s new date', () => {
    const synced = { 'a.txt': { l: { size: 5, mtime: T }, r: { size: 5, mtime: T + 9_000_000 } } };
    expect(compareFolders([f('a.txt', 5)], [f('a.txt', 5, T + 9_000_000)], { synced })[0].state).toBe('same');
    // Changed since: compared by date again.
    expect(compareFolders([f('a.txt', 6, T + 10_000_000)], [f('a.txt', 5, T + 9_000_000)], { synced })[0].state).toBe('left-newer');
  });
});

describe('the sync plan', () => {
  const rows = compareFolders(
    [f('new-here.txt', 10), f('edited.txt', 20, T + 60_000), f('older.txt', 5), d('Album'), f('Album/1.jpg', 100), f('odd', 1)],
    [f('new-there.txt', 30), f('edited.txt', 18), f('older.txt', 6, T + 60_000), f('odd', 2)],
  );

  it('one way copies what is missing or older there and leaves newer ones alone', () => {
    const p = syncPlan(rows, 'left-to-right');
    expect(p.steps.map((s) => `${s.op}:${s.from}:${s.rel}`).sort()).toEqual(['copy:left:Album', 'copy:left:new-here.txt', 'replace:left:edited.txt']);
    expect(p.skipped.map((s) => s.rel).sort()).toEqual(['new-there.txt', 'odd', 'older.txt']);
    const sum = planSummary(p);
    expect(sum).toMatchObject({ copies: 2, replaces: 1, bytes: 30, toRight: 3, toLeft: 0 });
  });

  it('the other way, and both ways where the newer copy wins', () => {
    expect(syncPlan(rows, 'right-to-left').steps.map((s) => s.rel).sort()).toEqual(['new-there.txt', 'older.txt']);
    const both = syncPlan(rows, 'both');
    expect(both.steps.map((s) => `${s.from}:${s.rel}`).sort()).toEqual(['left:Album', 'left:edited.txt', 'left:new-here.txt', 'right:new-there.txt', 'right:older.txt']);
    expect(both.skipped).toEqual([{ rel: 'odd', why: 'Same date, other size: check it yourself' }]);
  });

  it('only the ticked rows', () => {
    expect(syncPlan(rows, 'both', new Set(['older.txt'])).steps.map((s) => s.rel)).toEqual(['older.txt']);
  });

  it('pairs are told apart by both sides, in order', () => {
    const a = { kind: 'local', path: '/a' } as const;
    const b = { kind: 'remote', id: 'n', path: '/' } as const;
    expect(pairKey(a, b)).not.toBe(pairKey(b, a));
  });
});

describe('walking a side', () => {
  const store = () => {
    const m = new MemoryStore();
    const put = (p: string, n: number, mtime = T) => m.files.set(p, { data: Buffer.alloc(n), mtime });
    put('Photos/2026/a.jpg', 3);
    put('Photos/b.jpg', 4);
    put('Photos/.DS_Store', 1);
    put('Photos/.secret', 1);
    put('Photos/x.keeper-part', 1);
    put('Docs/c.txt', 5);
    return m;
  };

  it('a folder inside a store is its own top', async () => {
    const s = rootedStore(store(), '/Photos/');
    expect((await s.list('')).map((e) => e.path).sort()).toEqual(['.DS_Store', '.secret', '2026', 'b.jpg', 'x.keeper-part']);
    expect(await s.stat('2026/a.jpg')).toMatchObject({ path: '2026/a.jpg', size: 3 });
    await s.put('new.txt', Buffer.from('hi'));
    expect((await s.get('new.txt')).toString()).toBe('hi');
    await expect(s.get('../Docs/c.txt')).rejects.toThrow(/escapes/);
  });

  it('leaves out clutter and hidden files, goes inside when asked, stops at the limit', async () => {
    const s = rootedStore(store(), 'Photos');
    const flat = await walkSide(s, { deep: false, hidden: false });
    expect(flat.items.map((i) => i.rel).sort()).toEqual(['2026', 'b.jpg']);
    const deep = await walkSide(s, { deep: true, hidden: true });
    expect(deep.items.map((i) => i.rel).sort()).toEqual(['.secret', '2026', '2026/a.jpg', 'b.jpg']);
    const cut = await walkSide(s, { deep: true, hidden: true, limit: 2 });
    expect(cut.items).toHaveLength(2);
    expect(cut.truncated).toBe(true);
  });
});
