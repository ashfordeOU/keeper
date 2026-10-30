// SPDX-License-Identifier: AGPL-3.0-or-later
// The rules every destructive action passes through. Keeper never decides what
// to remove from a path the interface sends; it re-derives the target from a
// known category and checks the resolved, real path against these rules.

import { promises as fsp } from 'node:fs';
import path from 'node:path';

export interface SafetyContext {
  platform: NodeJS.Platform;
  home: string;
  /** user-excluded folders: never touched */
  excluded?: string[];
}

const norm = (p: string, win: boolean) => {
  const r = path.resolve(p);
  return win ? r.toLowerCase() : r;
};

export function isInside(child: string, parent: string, win = process.platform === 'win32'): boolean {
  const c = norm(child, win);
  const p = norm(parent, win);
  if (c === p) return false;
  const rel = path.relative(p, c);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function samePath(a: string, b: string, win = process.platform === 'win32'): boolean {
  return norm(a, win) === norm(b, win);
}

/** Folders Keeper must never remove, or remove anything directly from. */
export function protectedRoots(ctx: SafetyContext): string[] {
  const h = ctx.home;
  const list = [
    h,
    path.join(h, 'Desktop'),
    path.join(h, 'Documents'),
    path.join(h, 'Downloads'),
    path.join(h, 'Pictures'),
    path.join(h, 'Movies'),
    path.join(h, 'Videos'),
    path.join(h, 'Music'),
    path.join(h, 'Library'),
    path.join(h, 'AppData'),
    path.join(h, '.ssh'),
    path.join(h, '.gnupg'),
    path.join(h, '.config'),
    path.join(h, '.local'),
  ];
  if (ctx.platform === 'win32') {
    const sys = process.env.SystemRoot || 'C:\\Windows';
    list.push(sys, process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', process.env.ProgramData || 'C:\\ProgramData');
  } else if (ctx.platform === 'darwin') {
    list.push('/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/private', '/etc', '/var', '/Volumes');
  } else {
    list.push('/usr', '/bin', '/sbin', '/etc', '/var', '/boot', '/lib', '/lib64', '/opt', '/proc', '/sys', '/dev', '/run', '/srv', '/snap', '/root');
  }
  return list;
}

const WIN_RESERVED = /(^|[\\/])(\$recycle\.bin|system volume information|windows|program files( \(x86\))?|programdata|recovery|boot|efi)([\\/]|$)/i;

export type Verdict = { ok: true; real: string } | { ok: false; reason: string };

/**
 * Checks a path before Keeper removes it.
 *  - no drive roots, the home folder, system folders, or a protected folder itself
 *  - no symlinks / junctions (they would redirect the delete elsewhere)
 *  - no network paths, Windows 8.3 short names or trailing dots/spaces
 *  - nothing inside a folder the user excluded
 *  - when `within` is given, the real path must be inside one of those folders
 */
export async function checkRemovable(p: string, ctx: SafetyContext, within?: string[]): Promise<Verdict> {
  const win = ctx.platform === 'win32';
  if (!p || !path.isAbsolute(p)) return { ok: false, reason: 'not an absolute path' };
  if (win && (/^\\\\/.test(p) || /^\/\//.test(p))) return { ok: false, reason: 'network paths are never cleaned' };
  if (win && /~\d/.test(p)) return { ok: false, reason: 'short (8.3) names are refused' };
  if (win && /[. ]$/.test(p)) return { ok: false, reason: 'trailing dots or spaces are refused' };
  if (path.parse(p).root === path.resolve(p)) return { ok: false, reason: 'drive roots are never cleaned' };

  let real: string;
  try {
    const st = await fsp.lstat(p);
    if (st.isSymbolicLink()) return { ok: false, reason: 'symbolic links are skipped' };
    real = await fsp.realpath(p);
  } catch {
    return { ok: false, reason: 'no longer exists' };
  }
  if (!samePath(real, path.resolve(p), win) && !win) {
    // A parent folder is a link: the real target lives somewhere else.
    return { ok: false, reason: 'path goes through a link' };
  }
  for (const root of protectedRoots(ctx)) {
    if (samePath(real, root, win)) return { ok: false, reason: 'protected folder' };
  }
  if (win && WIN_RESERVED.test(real.slice(3)) && !isInside(real, path.join(ctx.home, 'AppData'), win) && !isInside(real, process.env.SystemRoot ? path.join(process.env.SystemRoot, 'Temp') : 'C:\\Windows\\Temp', win)) {
    return { ok: false, reason: 'system folder' };
  }
  for (const ex of ctx.excluded ?? []) {
    if (samePath(real, ex, win) || isInside(real, ex, win)) return { ok: false, reason: 'inside a folder you excluded' };
  }
  if (within && !within.some((w) => isInside(real, w, win))) return { ok: false, reason: 'outside the expected folder' };
  return { ok: true, real };
}
