import { mkdirSync, mkdtempSync, existsSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanTarget, expandRoots, measureTarget } from '../core/cleanup/engine';
import { fileCleanupGroups } from '../core/cleanup/files';
import { cacheTargets, type CacheTarget } from '../core/cleanup/targets';
import { checkRemovable } from '../core/safety';
import { DAY, NOW, file } from './helpers';

function sandbox() {
  const home = mkdtempSync(path.join(tmpdir(), 'keeper-home-'));
  const cache = path.join(home, '.cache');
  mkdirSync(path.join(cache, 'app', 'sub'), { recursive: true });
  writeFileSync(path.join(cache, 'app', 'sub', 'a.bin'), Buffer.alloc(1000));
  mkdirSync(path.join(cache, 'keepme'), { recursive: true });
  writeFileSync(path.join(cache, 'keepme', 'b.bin'), Buffer.alloc(500));
  writeFileSync(path.join(cache, 'fresh.tmp'), Buffer.alloc(10));
  const old = (Date.now() - 3 * DAY) / 1000;
  writeFileSync(path.join(cache, 'old.tmp'), Buffer.alloc(20));
  utimesSync(path.join(cache, 'old.tmp'), old, old);
  return { home, cache };
}

const target = (cache: string, over: Partial<CacheTarget> = {}): CacheTarget => ({
  id: 't', name: 'T', description: '', icon: '', safety: 'safe', mode: 'cache', preselect: true, roots: [cache], exclude: ['keepme'], ...over,
});

describe('cleanup engine', () => {
  it('measures and cleans contents, respecting excludes', async () => {
    const { home, cache } = sandbox();
    const t = target(cache);
    const m = await measureTarget(t);
    expect(m.size).toBe(1030);
    const out = await cleanTarget(t, { platform: process.platform, home });
    expect(out.freed).toBe(1030);
    expect(existsSync(path.join(cache, 'app'))).toBe(false);
    expect(existsSync(path.join(cache, 'keepme', 'b.bin'))).toBe(true);
    expect(existsSync(cache)).toBe(true);
  });

  it('keeps files created or changed recently', async () => {
    const { home, cache } = sandbox();
    // old.tmp has an old mtime but was just created (like files an installer unpacks): it stays.
    const kept = await cleanTarget(target(cache, { keepNewerThanMs: DAY, exclude: ['keepme', 'app'] }), { platform: process.platform, home });
    expect(kept.removed).toBe(0);
    expect(existsSync(path.join(cache, 'old.tmp'))).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    const gone = await cleanTarget(target(cache, { keepNewerThanMs: 5, exclude: ['keepme', 'app'] }), { platform: process.platform, home });
    expect(gone.removedPaths.map((p) => path.basename(p)).sort()).toEqual(['fresh.tmp', 'old.tmp']);
  });

  it('dry run removes nothing', async () => {
    const { home, cache } = sandbox();
    const out = await cleanTarget(target(cache), { platform: process.platform, home }, { dryRun: true });
    expect(out.freed).toBe(1030);
    expect(existsSync(path.join(cache, 'app', 'sub', 'a.bin'))).toBe(true);
  });

  it('expands * and drops nested roots', async () => {
    const { cache } = sandbox();
    const roots = await expandRoots([path.join(cache, '*', 'sub'), path.join(cache, 'app'), path.join(cache, 'missing')]);
    expect(roots).toEqual([path.join(cache, 'app')]);
  });

  it('every platform has a catalogue', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const t = cacheTargets({ platform, home: '/h' });
      expect(t.length).toBeGreaterThan(4);
      expect(new Set(t.map((x) => x.id)).size).toBe(t.length);
      expect(t.find((x) => x.mode === 'bin')).toBeTruthy();
    }
  });
});

describe('safety', () => {
  it('refuses the home folder, protected folders, links and things outside the root', async () => {
    const { home, cache } = sandbox();
    const ctx = { platform: process.platform, home };
    expect((await checkRemovable(home, ctx)).ok).toBe(false);
    expect((await checkRemovable('/', ctx)).ok).toBe(false);
    expect((await checkRemovable('relative/path', ctx)).ok).toBe(false);
    mkdirSync(path.join(home, 'Documents'));
    expect((await checkRemovable(path.join(home, 'Documents'), ctx)).ok).toBe(false);
    symlinkSync(path.join(home, 'Documents'), path.join(cache, 'link'));
    expect(await checkRemovable(path.join(cache, 'link'), ctx)).toMatchObject({ ok: false, reason: 'symbolic links are skipped' });
    expect((await checkRemovable(path.join(cache, 'app'), ctx, [cache])).ok).toBe(true);
    expect((await checkRemovable(path.join(cache, 'app'), ctx, [path.join(home, 'elsewhere')])).ok).toBe(false);
    expect((await checkRemovable(path.join(cache, 'app'), { ...ctx, excluded: [cache] })).ok).toBe(false);
  });
});

describe('file cleanup cards', () => {
  it('finds old installers, forgotten downloads, old screenshots, big old videos and empty files', () => {
    const files = [
      file('/u/Downloads/Zoom.pkg', { mtime: NOW - 20 * DAY, root: 'Downloads' }),
      file('/u/Downloads/old.pdf', { mtime: NOW - 200 * DAY, root: 'Downloads' }),
      file('/u/Downloads/new.pdf', { mtime: NOW - 2 * DAY, root: 'Downloads' }),
      file('/u/Desktop/Screenshot 2026-01-01 at 1.00.00.png', { mtime: NOW - 100 * DAY, root: 'Desktop' }),
      file('/u/Movies/trip.mov', { size: 900 * 1024 * 1024, mtime: NOW - 400 * DAY, root: 'Movies' }),
      file('/u/Documents/blank.txt', { size: 0, root: 'Documents' }),
      file('/u/Downloads/archive.zip', { mtime: NOW - 30 * DAY, root: 'Downloads' }),
      file('/u/Downloads/movie.mkv.crdownload', { mtime: NOW - 10 * DAY, root: 'Downloads' }),
    ];
    const groups = fileCleanupGroups(files, { now: NOW, dirExists: (p) => p === '/u/Downloads/archive' });
    const by = Object.fromEntries(groups.map((g) => [g.id, g.items!.map((f) => f.name)]));
    expect(by['old-installers']).toEqual(['Zoom.pkg']);
    expect(by['old-downloads']).toEqual(['old.pdf']);
    expect(by['old-screenshots']).toHaveLength(1);
    expect(by['big-old-videos']).toEqual(['trip.mov']);
    expect(by['empty-files']).toEqual(['blank.txt']);
    expect(by['unpacked-archives']).toEqual(['archive.zip']);
    expect(by['partial-downloads']).toEqual(['movie.mkv.crdownload']);
  });
});
