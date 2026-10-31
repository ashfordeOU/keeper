// SPDX-License-Identifier: AGPL-3.0-or-later
// Small operating-system helpers usable from both the app and the CLI
// (plain Node, no Electron).

import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseGetfattrHex, parseMdlsWhereFroms, parseZoneIdentifier, sourceFromUrls, splitMdlsRaw } from './sources';
import type { DownloadSource } from './types';
import type { TargetEnv } from './cleanup/targets';
import type { IndexFolder } from './indexer';

export function run(file: string, args: string[], timeout = 15_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

export function powershell(script: string, timeout = 30_000) {
  const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return run(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], timeout);
}

let hasGetfattr: boolean | undefined;

/** Where a file was downloaded from, as recorded by the OS and browser. */
export async function readDownloadSource(p: string): Promise<DownloadSource | undefined> {
  if (process.platform === 'darwin') {
    const r = await run('/usr/bin/mdls', ['-raw', '-name', 'kMDItemWhereFroms', p], 5000);
    return r.ok ? parseMdlsWhereFroms(r.stdout) : undefined;
  }
  if (process.platform === 'win32') {
    try {
      return parseZoneIdentifier(await fsp.readFile(`${p}:Zone.Identifier`, 'utf8'));
    } catch {
      return undefined;
    }
  }
  // Linux: Chromium and Firefox write user.xdg.origin.url when the file system supports xattrs.
  hasGetfattr ??= (await run('getfattr', ['--version'], 2000)).ok;
  if (!hasGetfattr) return undefined;
  const attr = (name: string) => run('getfattr', ['--absolute-names', '--only-values', '-n', name, p], 3000);
  const url = await attr('user.xdg.origin.url');
  if (!url.ok || !url.stdout.trim()) return undefined;
  const ref = await attr('user.xdg.referrer.url');
  return sourceFromUrls([url.stdout.trim(), ref.ok ? ref.stdout.trim() : undefined]);
}

export interface FileOrigin {
  source?: DownloadSource;
  /** macOS Finder tags */
  tags?: string[];
}

function parseMdlsTags(raw: string): string[] | undefined {
  const tags = [...raw.matchAll(/"?([^",()\n]+?)"?\s*(?:,|\n|$)/g)].map((m) => m[1].trim()).filter((t) => t && t !== '(null)');
  return tags.length ? tags : undefined;
}

/**
 * Where many files came from, in one helper call per batch instead of one per
 * file: on a first scan of 20,000 files that is about 100 processes, not 20,000.
 */
export async function readDownloadSources(paths: string[]): Promise<Map<string, FileOrigin>> {
  const res = new Map<string, FileOrigin>();
  if (!paths.length) return res;
  if (process.platform === 'darwin') {
    const r = await run('/usr/bin/mdls', ['-raw', '-name', 'kMDItemWhereFroms', '-name', 'kMDItemUserTags', ...paths], 30_000);
    const rows = r.stdout ? splitMdlsRaw(r.stdout, paths.length, 2) : null;
    if (!rows) {
      // A file vanished or mdls changed its output: fall back to one at a time.
      for (const p of paths) res.set(p, { source: await readDownloadSource(p), tags: await readFinderTags(p) });
      return res;
    }
    rows.forEach(([from, tags], i) => res.set(paths[i], { source: parseMdlsWhereFroms(from), tags: parseMdlsTags(tags) }));
    return res;
  }
  if (process.platform === 'win32') {
    for (const p of paths) res.set(p, { source: await readDownloadSource(p) });
    return res;
  }
  hasGetfattr ??= (await run('getfattr', ['--version'], 2000)).ok;
  if (!hasGetfattr) return res;
  const get = async (name: string, files: string[]) =>
    parseGetfattrHex((await run('getfattr', ['--absolute-names', '-e', 'hex', '-n', name, '--', ...files], 30_000)).stdout, name);
  const urls = await get('user.xdg.origin.url', paths);
  if (!urls.size) return res;
  const refs = await get('user.xdg.referrer.url', [...urls.keys()]);
  for (const [p, url] of urls) {
    const source = sourceFromUrls([url.trim(), refs.get(p)?.trim()]);
    if (source) res.set(p, { source });
  }
  return res;
}

/** macOS Finder tags. */
export async function readFinderTags(p: string): Promise<string[] | undefined> {
  if (process.platform !== 'darwin') return undefined;
  const r = await run('/usr/bin/mdls', ['-raw', '-name', 'kMDItemUserTags', p], 5000);
  if (!r.ok) return undefined;
  const tags = [...r.stdout.matchAll(/"?([^",()\n]+?)"?\s*(?:,|\n)/g)].map((m) => m[1].trim()).filter((t) => t && t !== '(null)');
  return tags.length ? tags : undefined;
}

export function targetEnv(): TargetEnv {
  return {
    platform: process.platform,
    home: os.homedir(),
    localAppData: process.env.LOCALAPPDATA,
    appData: process.env.APPDATA,
    temp: process.platform === 'win32' ? os.tmpdir() : undefined,
    systemRoot: process.env.SystemRoot,
    programData: process.env.ProgramData,
    xdgCache: process.env.XDG_CACHE_HOME,
  };
}

/** The folders indexed by default: the ones people actually keep files in. */
export function defaultFolders(home = os.homedir()): IndexFolder[] {
  const names = ['Desktop', 'Documents', 'Downloads', 'Pictures', process.platform === 'darwin' ? 'Movies' : 'Videos', 'Music'];
  return names.map((n) => ({ path: path.join(home, n), label: n }));
}

/** Moves a file to the system Trash without Electron (CLI). */
export async function trashWithoutElectron(p: string): Promise<boolean> {
  if (process.platform === 'darwin') {
    const r = await run('/usr/bin/osascript', ['-e', `tell application "Finder" to delete POSIX file ${JSON.stringify(p)}`]);
    return r.ok;
  }
  if (process.platform === 'win32') {
    const lit = p.replace(/'/g, "''");
    const r = await powershell(`Add-Type -AssemblyName Microsoft.VisualBasic; if (Test-Path -LiteralPath '${lit}' -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${lit}','OnlyErrorDialogs','SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${lit}','OnlyErrorDialogs','SendToRecycleBin') }`);
    return r.ok;
  }
  const r = await run('gio', ['trash', p]);
  return r.ok;
}
