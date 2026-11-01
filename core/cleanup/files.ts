// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Cleanup cards built from the file index: things the user made or downloaded,
// so they are only ever moved to the Trash, one reviewable file at a time.

import { DAY, MB } from '../format';
import type { CleanupGroup, FileEntry } from '../types';

export interface FileGroupOptions {
  now?: number;
  oldDownloadDays?: number;
  installerDays?: number;
  screenshotDays?: number;
  bigVideoMb?: number;
  bigVideoDays?: number;
  largeFileMb?: number;
  /** does a folder exist? used to spot archives that were already unpacked */
  dirExists?: (p: string) => boolean;
}

const lastTouched = (f: FileEntry) => Math.max(f.mtime, f.atime || 0);

function group(id: string, name: string, description: string, icon: string, items: FileEntry[], preselect: boolean, safety: CleanupGroup['safety'] = 'review'): CleanupGroup {
  items.sort((a, b) => b.size - a.size);
  return {
    id, name, description, icon, mode: 'files', safety, preselect, items,
    size: items.reduce((n, f) => n + f.size, 0),
    count: items.length,
    locations: [...new Set(items.map((f) => f.root))],
  };
}

export function fileCleanupGroups(files: FileEntry[], o: FileGroupOptions = {}): CleanupGroup[] {
  const now = o.now ?? Date.now();
  const dlDays = o.oldDownloadDays ?? 90;
  const instDays = o.installerDays ?? 14;
  const shotDays = o.screenshotDays ?? 30;
  const vidMb = o.bigVideoMb ?? 200;
  const vidDays = o.bigVideoDays ?? 180;
  const live = files.filter((f) => !f.cloudOnly);

  const installers = live.filter((f) => f.kind === 'installer' && now - f.mtime > instDays * DAY);
  const inst = new Set(installers.map((f) => f.path));

  const unpacked = o.dirExists
    ? live.filter((f) => f.kind === 'archive' && f.root === 'Downloads' && now - f.mtime > 7 * DAY && o.dirExists!(f.path.slice(0, f.path.length - f.ext.length - 1)))
    : [];
  const unp = new Set(unpacked.map((f) => f.path));

  const oldDownloads = live.filter((f) => f.root === 'Downloads' && !inst.has(f.path) && !unp.has(f.path) && now - lastTouched(f) > dlDays * DAY);
  const shots = live.filter((f) => f.screenshot && now - f.mtime > shotDays * DAY);
  const videos = live.filter((f) => f.kind === 'video' && f.size >= vidMb * MB && now - lastTouched(f) > vidDays * DAY);
  const empty = live.filter((f) => f.size === 0 && f.kind !== 'app' && !/^(\.|icon\r|__init__\.py$|\.keep$|\.gitkeep$)/i.test(f.name));
  const partial = live.filter((f) => /\.(crdownload|part|partial|download|opdownload|tmp)$/i.test(f.name) && now - f.mtime > 2 * DAY);

  return [
    group('old-installers', 'Old installers', `Setup files (${fmtExts(installers)}) older than ${instDays} days. The app is already installed — or you never needed it.`, 'box', installers, true, 'safe'),
    group('unpacked-archives', 'Archives already unpacked', 'Zip and other archives in Downloads with an unpacked folder right next to them.', 'archive', unpacked, true, 'safe'),
    group('partial-downloads', 'Unfinished downloads', 'Downloads that stopped half-way (.crdownload, .part) and were never resumed.', 'down', partial, true, 'safe'),
    group('old-downloads', 'Forgotten downloads', `Files in Downloads you have not opened for ${dlDays}+ days.`, 'down', oldDownloads, false),
    group('old-screenshots', 'Old screenshots', `Screenshots older than ${shotDays} days. Copy any text out of them first — Keeper can read it.`, 'screenshot', shots, false),
    group('big-old-videos', 'Big old videos', `Videos over ${vidMb} MB you have not watched in ${Math.round(vidDays / 30)} months.`, 'video', videos, false),
    group('empty-files', 'Empty files', 'Zero-byte files that hold nothing.', 'file', empty, false, 'safe'),
  ].filter((g) => g.count > 0);
}

/** Files over the large-file threshold, biggest first. */
export function largeFiles(files: FileEntry[], minMb = 500): FileEntry[] {
  return files.filter((f) => f.size >= minMb * MB && !f.cloudOnly).sort((a, b) => b.size - a.size);
}

function fmtExts(list: FileEntry[]): string {
  const exts = [...new Set(list.map((f) => '.' + f.ext))].slice(0, 4);
  return exts.length ? exts.join(', ') : '.dmg, .pkg, .exe, .msi';
}
