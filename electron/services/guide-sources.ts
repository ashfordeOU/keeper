// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's own checkers for the To do list (space and storage, the system's
// protection, updates, start-up apps, backups, the VPN, locked folders) and the
// fixes Keeper can do itself. Each reads what the feature already knows; other
// services are imported lazily so a feature that is off costs nothing here.

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupFindings, lockFindings, networkFindings, protectionFindings, spaceFindings, startupFindings, updateFindings, type Platform } from '../../core/guide/builtin';
import type { FileIndex } from '../../core/indexer';
import { run } from '../../core/platform';
import { folderSize } from '../../core/walk';
import { formatBytes } from '../../core/format';
import { PLATFORM_OF_GUIDE as PLATFORM, registerAutoFix, registerFindings } from './guide';

const DAY = 24 * 3600_000;

async function diskOf(dir: string): Promise<{ free: number; total: number } | undefined> {
  try {
    const s = await fsp.statfs(dir);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return undefined;
  }
}

function phoneBackupDirs(): string[] {
  const home = os.homedir();
  if (PLATFORM === 'darwin') return [path.join(home, 'Library', 'Application Support', 'MobileSync', 'Backup')];
  if (PLATFORM === 'win32') return [path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Apple Computer', 'MobileSync', 'Backup'), path.join(home, 'Apple', 'MobileSync', 'Backup')];
  return [];
}

async function phoneBackups(): Promise<{ bytes: number; count: number } | undefined> {
  let bytes = 0;
  let count = 0;
  for (const dir of phoneBackupDirs()) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      count++;
      bytes += (await folderSize(path.join(dir, e.name)).catch(() => ({ size: 0 }))).size;
    }
  }
  return count ? { bytes, count } : undefined;
}

async function storageSenseOn(): Promise<boolean | undefined> {
  if (PLATFORM !== 'win32') return undefined;
  const r = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\StorageSense\\Parameters\\StoragePolicy', '/v', '01'], 5000);
  if (!r.ok) return undefined;
  const m = r.stdout.match(/0x([0-9a-f]+)/i);
  return m ? parseInt(m[1], 16) === 1 : undefined;
}

export function registerBuiltinGuideSources(d: { index: () => FileIndex | undefined; trashSize?: () => Promise<{ bytes: number; count: number } | undefined> }) {
  // ---------------------------------------------------------------- space and storage
  registerFindings('space', async () => {
    const idx = d.index();
    let oldVideos: { bytes: number; count: number } | undefined;
    if (idx) {
      const cut = Date.now() - 180 * DAY;
      let bytes = 0;
      let count = 0;
      for (const f of idx.files.values()) {
        if (f.kind === 'video' && f.size > 1024 ** 3 && Math.max(f.atime || 0, f.mtime) < cut) { bytes += f.size; count++; }
      }
      if (count) oldVideos = { bytes, count };
    }
    const trash = d.trashSize
      ? await d.trashSize()
      : await import('./places').then(async (p) => {
        const l = await p.listTrash();
        return { bytes: l.items.reduce((n, i) => n + (i.size || 0), 0), count: l.items.length };
      }).catch(() => undefined);
    return spaceFindings({
      platform: PLATFORM as Platform,
      disk: await diskOf(os.homedir()),
      trash,
      phoneBackups: await phoneBackups(),
      oldVideos,
      storageSense: await storageSenseOn(),
      // Tests use a tiny Trash.
      trashMin: process.env.KEEPER_GUIDE_TRASH_MIN ? Number(process.env.KEEPER_GUIDE_TRASH_MIN) : undefined,
    });
  });

  registerAutoFix('emptyTrash', {
    async preview() {
      const p = await import('./places');
      const l = await p.listTrash();
      const bytes = l.items.reduce((n, i) => n + (i.size || 0), 0);
      return {
        summary: `${l.items.length} item${l.items.length === 1 ? '' : 's'} (${formatBytes(bytes)}) will be deleted for good.`,
        items: l.items.slice(0, 50).map((i) => ({ label: i.name, detail: i.size ? formatBytes(i.size) : undefined })),
        bytes, undoable: false, warning: l.note,
      };
    },
    async apply() {
      const p = await import('./places');
      const r = await p.emptyTrash();
      return { ok: r.ok, message: r.ok ? `The ${PLATFORM === 'win32' ? 'Recycle Bin' : 'Trash'} is empty.` : r.message ?? 'Could not empty it.' };
    },
  });

  // ---------------------------------------------------------------- the system's own protection
  registerFindings('protection', async () => {
    const { checkProtection } = await import('./protection');
    const r = await checkProtection();
    return protectionFindings(r.checks, PLATFORM as Platform);
  });

  // ---------------------------------------------------------------- Keeper's own updates
  registerFindings('updates', async () => {
    const { updateStatus } = await import('./updater');
    return updateFindings(updateStatus());
  });

  // ---------------------------------------------------------------- start-up apps
  let disabledByGuide: string[] = [];
  registerFindings('startup', async () => {
    const { listStartup } = await import('./startup');
    return startupFindings(await listStartup());
  });
  registerAutoFix('disableHeavyStartup', {
    async preview() {
      const { listStartup } = await import('./startup');
      const heavy = (await listStartup()).filter((i) => i.enabled && i.impact === 'high' && i.scope === 'user');
      return { summary: `${heavy.length} app${heavy.length === 1 ? '' : 's'} will no longer open by themselves when you sign in. They stay installed; open them whenever you like.`, items: heavy.map((i) => ({ label: i.name, detail: i.publisher })), undoable: true };
    },
    async apply() {
      const { listStartup, toggleStartup } = await import('./startup');
      const heavy = (await listStartup()).filter((i) => i.enabled && i.impact === 'high' && i.scope === 'user');
      const done: string[] = [];
      for (const i of heavy) await toggleStartup(i.id, false).then(() => done.push(i.id)).catch(() => undefined);
      disabledByGuide = done;
      return { ok: done.length > 0, message: done.length ? `${done.length} app${done.length === 1 ? '' : 's'} will no longer start by themselves.` : 'Nothing could be changed.' };
    },
    async undo() {
      const { toggleStartup } = await import('./startup');
      let n = 0;
      for (const id of disabledByGuide) await toggleStartup(id, true).then(() => n++).catch(() => undefined);
      disabledByGuide = [];
      return { ok: n > 0, message: `${n} app${n === 1 ? '' : 's'} will start by themselves again.` };
    },
  });

  // ---------------------------------------------------------------- backups
  registerFindings('backup', async () => {
    const s = await import('./sync').then((m) => m.syncStatusLine()).catch(() => undefined);
    if (!s) return [];
    return backupFindings({ jobs: s.backups.length + s.mirrors.length, check321: s.check321, testDue: s.backups.filter((b) => b.testDue).length });
  });

  // ---------------------------------------------------------------- the VPN
  registerFindings('network', async () => {
    const v = await import('./net').then((m) => m.vpnStatus()).catch(() => undefined);
    return networkFindings(v?.verdict);
  });

  // ---------------------------------------------------------------- locked folders
  registerFindings('lock', async () => {
    const { list } = await import('./lock');
    return lockFindings(list().filter((l) => l.state === 'unlocked').map((l) => ({ path: l.folder ?? l.vault, since: l.unlockedAt })));
  });
  registerAutoFix('relockFolders', {
    async preview() {
      const { list } = await import('./lock');
      const open = list().filter((l) => l.state === 'unlocked' && l.unlockedAt && Date.now() - l.unlockedAt > 3600_000);
      return { summary: `${open.length} folder${open.length === 1 ? '' : 's'} will be locked again. Close files from them first.`, items: open.map((l) => ({ label: path.basename(l.folder ?? l.vault) })), undoable: false };
    },
    async apply() {
      const { list, relock } = await import('./lock');
      const open = list().filter((l) => l.state === 'unlocked' && l.unlockedAt && Date.now() - l.unlockedAt > 3600_000);
      let n = 0;
      for (const l of open) await relock(l.folder ?? l.vault).then(() => n++).catch(() => undefined);
      return { ok: n > 0, message: `${n} folder${n === 1 ? '' : 's'} locked again.` };
    },
  });
}
