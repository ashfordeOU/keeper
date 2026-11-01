// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Older versions of synced files. Before sync replaces or deletes a file it is
// moved into the folder's .keeper-versions folder, named with the time, and
// kept for as long as the folder's rule says.

import { promises as fsp } from 'node:fs';
import path from 'node:path';

export const VERSIONS_DIR = '.keeper-versions';

export type VersionPolicy =
  | { type: 'none' }
  /** keep everything replaced or deleted for this many days */
  | { type: 'trashcan'; days: number }
  /** keep the last few versions of each file */
  | { type: 'simple'; keep: number }
  /** one an hour for a day, one a day for a month, one a week after that, up to maxDays */
  | { type: 'staggered'; maxDays: number };

export const DEFAULT_POLICY: VersionPolicy = { type: 'staggered', maxDays: 365 };

const H = 3600_000;
const D = 24 * H;

function stamp(t: number): string {
  const d = new Date(t);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function parseStamp(s: string): number | undefined {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : undefined;
}

/** "photos/cat.jpg" at a time → "photos/cat~20261031-140500.jpg" inside .keeper-versions */
export function versionRel(rel: string, t: number): string {
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
  const base = rel.slice(dir.length);
  const dot = base.lastIndexOf('.');
  const [name, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ''];
  return `${dir}${name}~${stamp(t)}${ext}`;
}

/** The original path and time from a version's name, or undefined for other files. */
export function parseVersionRel(vrel: string): { rel: string; time: number } | undefined {
  const dir = vrel.includes('/') ? vrel.slice(0, vrel.lastIndexOf('/') + 1) : '';
  const base = vrel.slice(dir.length);
  const m = base.match(/^(.*)~(\d{8}-\d{6})(\.[^.]*)?$/);
  if (!m) return undefined;
  const time = parseStamp(m[2]);
  return time === undefined ? undefined : { rel: `${dir}${m[1]}${m[3] ?? ''}`, time };
}

async function move(from: string, to: string) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try {
    await fsp.rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    await fsp.copyFile(from, to);
    await fsp.rm(from, { force: true });
  }
}

/** Moves the current file aside before it is replaced or deleted. With policy 'none' it is deleted. */
export async function archive(root: string, rel: string, policy: VersionPolicy, now = Date.now()): Promise<string | undefined> {
  const abs = path.join(root, ...rel.split('/'));
  const exists = await fsp.stat(abs).then((s) => s.isFile()).catch(() => false);
  if (!exists) return undefined;
  if (policy.type === 'none') {
    await fsp.rm(abs, { force: true });
    return undefined;
  }
  let t = now;
  let vrel = versionRel(rel, t);
  // Two changes in the same second keep both.
  while (await fsp.stat(path.join(root, VERSIONS_DIR, ...vrel.split('/'))).then(() => true, () => false)) vrel = versionRel(rel, (t += 1000));
  await move(abs, path.join(root, VERSIONS_DIR, ...vrel.split('/')));
  return vrel;
}

export interface VersionInfo {
  /** the file it is a version of */
  rel: string;
  /** where it is, inside .keeper-versions */
  vrel: string;
  time: number;
  size: number;
}

export async function listVersions(root: string, rel?: string): Promise<VersionInfo[]> {
  const base = path.join(root, VERSIONS_DIR);
  const out: VersionInfo[] = [];
  const walk = async (dir: string) => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile()) {
        const vrel = path.relative(base, abs).split(path.sep).join('/');
        const p = parseVersionRel(vrel);
        if (!p || (rel && p.rel !== rel)) continue;
        const st = await fsp.stat(abs).catch(() => null);
        if (st) out.push({ rel: p.rel, vrel, time: p.time, size: st.size });
      }
    }
  };
  await walk(rel && rel.includes('/') ? path.join(base, ...rel.slice(0, rel.lastIndexOf('/')).split('/')) : base);
  return out.sort((a, b) => b.time - a.time);
}

/** Puts a version back (the file there now becomes a version itself). Returns where it went. */
export async function restoreVersion(root: string, vrel: string, policy: VersionPolicy, to?: string): Promise<string> {
  const p = parseVersionRel(vrel);
  if (!p) throw new Error('Not a version');
  const target = to ?? p.rel;
  await archive(root, target, policy);
  const dest = path.join(root, ...target.split('/'));
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(path.join(root, VERSIONS_DIR, ...vrel.split('/')), dest);
  return target;
}

/** Which of a file's versions (times, any order) the policy keeps. Pure, for tests and the settings preview. */
export function keepVersions(times: number[], policy: VersionPolicy, now = Date.now()): Set<number> {
  const keep = new Set<number>();
  if (policy.type === 'none') return keep;
  if (policy.type === 'trashcan') {
    for (const t of times) if (now - t <= policy.days * D) keep.add(t);
    return keep;
  }
  const sorted = [...times].sort((a, b) => b - a);
  if (policy.type === 'simple') {
    for (const t of sorted.slice(0, Math.max(0, policy.keep))) keep.add(t);
    return keep;
  }
  // Staggered: every version from the last half hour, then one per bucket.
  const buckets = new Set<string>();
  for (const t of sorted) {
    const age = now - t;
    if (age > policy.maxDays * D) continue;
    if (age <= H / 2) {
      keep.add(t);
      continue;
    }
    const key = age <= D ? `h${Math.floor(t / H)}` : age <= 30 * D ? `d${Math.floor(t / D)}` : `w${Math.floor(t / (7 * D))}`;
    if (buckets.has(key)) continue;
    buckets.add(key);
    keep.add(t);
  }
  return keep;
}

/** Removes versions the policy no longer keeps. Returns how many and how many bytes. */
export async function cleanVersions(root: string, policy: VersionPolicy, now = Date.now()): Promise<{ removed: number; bytes: number }> {
  const all = await listVersions(root);
  const byFile = new Map<string, VersionInfo[]>();
  for (const v of all) byFile.set(v.rel, [...(byFile.get(v.rel) ?? []), v]);
  let removed = 0;
  let bytes = 0;
  for (const list of byFile.values()) {
    const keep = keepVersions(list.map((v) => v.time), policy, now);
    for (const v of list) {
      if (keep.has(v.time)) continue;
      await fsp.rm(path.join(root, VERSIONS_DIR, ...v.vrel.split('/')), { force: true });
      removed++;
      bytes += v.size;
    }
  }
  return { removed, bytes };
}
