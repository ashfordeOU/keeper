// SPDX-License-Identifier: AGPL-3.0-or-later
// Measures and cleans cache targets. Caches are deleted for good (they rebuild,
// and moving them to the Trash would free nothing); everything the user made
// goes to the Trash through the platform layer, never through here.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { checkRemovable, isInside, type SafetyContext } from '../safety';
import { walk } from '../walk';
import type { CacheTarget } from './targets';

/** Resolves `*` segments to every matching sub-folder that exists. */
export async function expandRoots(patterns: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const pattern of patterns) {
    const parts = pattern.split(/[\\/]/);
    const star = parts.indexOf('*');
    if (star < 0) {
      if (await isRealDir(pattern)) out.push(pattern);
      continue;
    }
    const base = parts.slice(0, star).join(path.sep) || path.sep;
    const rest = parts.slice(star + 1);
    let subs: string[] = [];
    try {
      subs = (await fsp.readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.isSymbolicLink()).map((d) => d.name);
    } catch {
      continue;
    }
    out.push(...(await expandRoots(subs.map((s) => path.join(base, s, ...rest)))));
  }
  // Drop duplicates and roots nested inside another root.
  const uniq = [...new Set(out)];
  return uniq.filter((r) => !uniq.some((o) => o !== r && isInside(r, o)));
}

export async function isRealDir(p: string): Promise<boolean> {
  try {
    const st = await fsp.lstat(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

export interface Measured {
  size: number;
  count: number;
  roots: string[];
}

const fresh = (t: CacheTarget, mtime: number, btime: number) => !!t.keepNewerThanMs && Math.max(mtime, btime || 0) > Date.now() - t.keepNewerThanMs;

/** What a clean would remove: everything inside each root, minus excluded names and fresh files. */
export async function measureTarget(t: CacheTarget, opts: { signal?: AbortSignal; onTick?: (p: string) => void; excludeRoots?: string[] } = {}): Promise<Measured> {
  const roots = (await expandRoots(t.roots)).filter((r) => !(opts.excludeRoots ?? []).some((o) => o === r || isInside(r, o)));
  const excluded = new Set((t.exclude ?? []).map((e) => e.toLowerCase()));
  let size = 0;
  let count = 0;
  let ticks = 0;
  for (const root of roots) {
    const tops = new Set<string>();
    await walk(root, {
      raw: true,
      showHidden: true,
      signal: opts.signal,
      enterDir: (dir) => !excluded.has(topName(root, dir)),
      onEntry: (e) => {
        if (!e.stats.isFile()) return;
        const top = topName(root, e.path);
        if (excluded.has(top)) return;
        if (fresh(t, e.stats.mtimeMs, e.stats.birthtimeMs)) return;
        size += e.stats.size;
        tops.add(top);
        if (++ticks % 500 === 0) opts.onTick?.(e.path);
      },
    });
    count += tops.size;
  }
  return { size, count, roots };
}

function topName(root: string, p: string): string {
  return path.relative(root, p).split(path.sep)[0].toLowerCase();
}

export interface CleanOutcome {
  freed: number;
  removed: number;
  failed: number;
  inUse: number;
  denied: number;
  removedPaths: string[];
}

/**
 * Deletes the contents of each root. Every entry is re-checked against the
 * safety rules and must resolve inside its root. With keepNewerThanMs, files are
 * removed one by one so recent ones survive; otherwise whole top-level entries go.
 */
export async function cleanTarget(t: CacheTarget, ctx: SafetyContext, opts: { signal?: AbortSignal; dryRun?: boolean; excludeRoots?: string[] } = {}): Promise<CleanOutcome> {
  const out: CleanOutcome = { freed: 0, removed: 0, failed: 0, inUse: 0, denied: 0, removedPaths: [] };
  const roots = (await expandRoots(t.roots)).filter((r) => !(opts.excludeRoots ?? []).some((o) => o === r || isInside(r, o)));
  const excluded = new Set((t.exclude ?? []).map((e) => e.toLowerCase()));

  const note = (err: unknown) => {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EBUSY' || code === 'ETXTBSY' || code === 'EPERM' && process.platform === 'win32') out.inUse++;
    else if (code === 'EACCES' || code === 'EPERM') out.denied++;
    else out.failed++;
  };

  for (const root of roots) {
    if (opts.signal?.aborted) break;
    let entries: string[];
    try {
      entries = (await fsp.readdir(root)).filter((n) => !excluded.has(n.toLowerCase()));
    } catch (e) {
      note(e);
      continue;
    }
    for (const name of entries) {
      if (opts.signal?.aborted) break;
      const p = path.join(root, name);
      const verdict = await checkRemovable(p, ctx, [root]);
      if (!verdict.ok) continue;
      if (t.keepNewerThanMs) {
        await removeOldFiles(p, t, ctx, root, out, note, opts.dryRun);
        continue;
      }
      try {
        const { size } = await sizeOf(p);
        if (!opts.dryRun) await fsp.rm(p, { recursive: true, force: true, maxRetries: 1 });
        out.freed += size;
        out.removed++;
        out.removedPaths.push(p);
      } catch (e) {
        note(e);
      }
    }
  }
  return out;
}

async function removeOldFiles(p: string, t: CacheTarget, ctx: SafetyContext, root: string, out: CleanOutcome, note: (e: unknown) => void, dryRun?: boolean) {
  let st;
  try {
    st = await fsp.lstat(p);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) return;
  if (st.isFile()) {
    if (fresh(t, st.mtimeMs, st.birthtimeMs)) return;
    try {
      if (!dryRun) await fsp.unlink(p);
      out.freed += st.size;
      out.removed++;
      out.removedPaths.push(p);
    } catch (e) {
      note(e);
    }
    return;
  }
  if (!st.isDirectory()) return;
  let names: string[] = [];
  try {
    names = await fsp.readdir(p);
  } catch (e) {
    note(e);
    return;
  }
  for (const n of names) {
    const child = path.join(p, n);
    const v = await checkRemovable(child, ctx, [root]);
    if (v.ok) await removeOldFiles(child, t, ctx, root, out, note, dryRun);
  }
  // Remove the folder only if it ended up empty.
  if (!dryRun) await fsp.rmdir(p).catch(() => undefined);
}

export async function sizeOf(p: string): Promise<{ size: number; files: number }> {
  const st = await fsp.lstat(p);
  if (!st.isDirectory()) return { size: st.size, files: 1 };
  let size = 0;
  let files = 0;
  await walk(p, { raw: true, showHidden: true, onEntry: (e) => { if (e.stats.isFile()) { size += e.stats.size; files++; } } });
  return { size, files };
}
