// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Finds iPhone and iPad backups (often tens of gigabytes) for the storage view.
// Only runs when asked.

import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupFolders, describeBackup, type PhoneBackup } from '../../core/phone-backups';

async function folderSize(dir: string): Promise<number> {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    const entries = await fsp.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) total += (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
    }
  }
  return total;
}

/** Backups in the usual folders (plus any `extra` folders), newest first. */
export async function phoneBackups(extra: string[] = []): Promise<{ folders: string[]; backups: PhoneBackup[] }> {
  const folders = [...backupFolders(process.platform, os.homedir(), process.env), ...extra].filter((f, i, a) => a.indexOf(f) === i);
  const backups: PhoneBackup[] = [];
  for (const root of folders) {
    if (!existsSync(root)) continue;
    for (const e of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      const info = await fsp.readFile(path.join(dir, 'Info.plist'), 'utf8').catch(() => null);
      if (!info) continue;
      // Manifest.plist is usually binary; when it is XML it says whether the backup is encrypted.
      const manifest = await fsp.readFile(path.join(dir, 'Manifest.plist'), 'utf8').catch(() => undefined);
      backups.push(describeBackup(e.name, dir, info, await folderSize(dir), manifest?.startsWith('<?xml') ? manifest : undefined));
    }
  }
  backups.sort((a, b) => (b.lastBackup ?? 0) - (a.lastBackup ?? 0));
  return { folders: folders.filter((f) => existsSync(f)), backups };
}
