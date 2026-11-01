// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Locked folders and hidden files for the browser demo. Nothing is encrypted
// here; it only shows how it looks.

import type { BrowseEntry } from '../core/api';
import type { LockApi, LockedFolder } from '../core/api-lock';

const MB = 1024 * 1024;
const DAY = 86_400_000;
const PASSWORD = 'demo';

export function mockLock(home: string, changed: () => void) {
  const now = Date.now();
  const vaults: (LockedFolder & { password?: string })[] = [
    { vault: `${home}/Documents/Taxes 2025.keeperlock`, state: 'locked', methods: ['device', 'recovery'], relock: 'quit', lockedAt: now - 3 * DAY, files: 14, bytes: 23 * MB },
    { vault: `${home}/Pictures/Private.keeperlock`, state: 'locked', methods: ['password', 'recovery'], relock: 'screen', lockedAt: now - 9 * DAY, files: 212, bytes: 1.4 * 1024 * MB, password: PASSWORD },
  ];
  /** folders "locked" in this session, hidden from the listing */
  const gone = new Set<string>();
  const unlocked = new Set<string>();
  let failures = 0;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const find = (p: string) => vaults.find((v) => v.vault === p || v.folder === p);

  const hiddenIn: Record<string, BrowseEntry[]> = {
    [home]: [
      { path: `${home}/.config`, name: '.config', isDir: true, size: 0, mtime: now - 2 * DAY, kind: 'folder', ext: '', hidden: true },
      { path: `${home}/.ssh`, name: '.ssh', isDir: true, size: 0, mtime: now - 40 * DAY, kind: 'folder', ext: '', hidden: true },
      { path: `${home}/.zshrc`, name: '.zshrc', isDir: false, size: 2100, mtime: now - 6 * DAY, kind: 'code', ext: 'zshrc', hidden: true },
      { path: `${home}/.gitconfig`, name: '.gitconfig', isDir: false, size: 380, mtime: now - 90 * DAY, kind: 'code', ext: 'gitconfig', hidden: true },
    ],
    [`${home}/Documents`]: [
      { path: `${home}/Documents/.DS_Store`, name: '.DS_Store', isDir: false, size: 10_244, mtime: now - DAY, kind: 'other', ext: 'ds_store', hidden: true },
    ],
  };

  /** extra entries for the demo listing, and which ones to leave out */
  const adjust = (dir: string, list: BrowseEntry[], showHidden: boolean): BrowseEntry[] => {
    const out = list.filter((e) => !gone.has(e.path));
    for (const v of vaults) {
      if (v.state !== 'locked' || v.vault.slice(0, v.vault.lastIndexOf('/')) !== dir) continue;
      out.push({ path: v.vault, name: v.vault.slice(dir.length + 1), isDir: false, size: v.bytes ?? 0, mtime: v.lockedAt ?? now, kind: 'other', ext: 'keeperlock', hidden: false });
    }
    for (const f of unlocked) {
      if (f.slice(0, f.lastIndexOf('/')) === dir && !out.some((e) => e.path === f)) out.push({ path: f, name: f.slice(dir.length + 1), isDir: true, size: 0, mtime: now, kind: 'folder', ext: '', hidden: false });
    }
    if (showHidden) out.push(...(hiddenIn[dir] ?? []));
    return out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
  };

  const api: LockApi = {
    status: async () => ({ account: { available: true, label: 'Touch ID or your Mac password' }, platform: 'darwin' }),
    canLock: async (dir) => (dir === home || /\/(Documents|Desktop|Downloads|Pictures|Movies|Music)$/.test(dir) ? 'This is one of your main folders. Lock a folder inside it instead.' : null),
    newRecoveryKey: async () => 'K7F3-9QXA-M2D8-ZT4R-HN6W-B1PC-Y5EJ-VS0G',
    saveRecoveryKey: async () => true,
    lock: async (req) => {
      await wait(900);
      const vault = `${req.dir}.keeperlock`;
      gone.add(req.dir);
      unlocked.delete(req.dir);
      const existing = find(req.dir);
      if (existing) Object.assign(existing, { vault, state: 'locked', folder: undefined, lockedAt: Date.now() });
      else vaults.push({ vault, state: 'locked', methods: [req.method === 'account' ? 'device' : 'password', 'recovery'], relock: req.relock, idleMinutes: req.idleMinutes, lockedAt: Date.now(), files: 8, bytes: 12 * MB, password: req.password });
      changed();
      return { vault, leftovers: false };
    },
    inspect: async (vault) => {
      const v = find(vault);
      return { methods: v?.methods ?? ['password', 'recovery'], thisComputer: !!v?.methods.includes('device'), created: v?.lockedAt ?? now, waitSeconds: failures >= 3 ? 2 ** (failures - 3) : 0 };
    },
    unlock: async (req) => {
      const v = find(req.vault);
      if (!v) throw new Error('Not found');
      await wait(req.method === 'account' ? 1200 : 500);
      if (req.method === 'password' && req.secret !== (v.password ?? PASSWORD)) {
        failures++;
        throw new Error('That password is not right. (In the demo it is “demo”.)');
      }
      if (req.method === 'recovery' && (req.secret ?? '').replace(/[^0-9a-z]/gi, '').length !== 32) {
        failures++;
        throw new Error('That recovery key does not unlock this folder.');
      }
      failures = 0;
      const folder = v.vault.replace(/\.keeperlock$/, '');
      Object.assign(v, { state: 'unlocked', folder, unlockedAt: Date.now(), relock: req.relock ?? v.relock });
      gone.delete(folder);
      unlocked.add(folder);
      changed();
      return { folder };
    },
    relock: async (p) => {
      const v = find(p);
      if (!v?.folder) throw new Error('This folder is not one Keeper unlocked.');
      await wait(700);
      gone.add(v.folder);
      unlocked.delete(v.folder);
      Object.assign(v, { state: 'locked', folder: undefined, lockedAt: Date.now() });
      changed();
      return { vault: v.vault };
    },
    list: async () => vaults.map(({ password: _p, ...v }) => v),
    forget: async (vault) => {
      const i = vaults.findIndex((v) => v.vault === vault);
      if (i >= 0) vaults.splice(i, 1);
      return vaults.map(({ password: _p, ...v }) => v);
    },
    setRelock: async (vault, relock, idleMinutes) => {
      const v = find(vault);
      if (v) Object.assign(v, { relock, idleMinutes });
      return vaults.map(({ password: _p, ...v }) => v);
    },
    cancel: async () => undefined,
  };
  return { lock: api, adjust };
}
