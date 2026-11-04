// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Folder boxes: what a box widget shows (its folder's files, read when the box
// asks), opening a file from it, and "Tidy my desktop into boxes" (loose desktop
// files into one folder per kind, a box for each, one step in History that
// Undo puts back). Boxes are ordinary desktop widgets (electron/ipc/widgets.ts),
// so they float on the desktop layer where the system has one; nothing here
// runs in the background.

import { app, screen, shell } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import type { BoxesApi, BoxesStatus } from '../../core/api-boxes';
import { boxItems, boxPositions, planTidy, type BoxEntry, type BoxGroup, type BoxSort, type TidyPlan } from '../../core/folder-boxes';
import { moveFile, type Journal } from '../../core/journal';
import type { JournalOp } from '../../core/types';
import { newWidget, normalizeWidgets } from '../../core/widgets';
import { settings } from '../store';
import { featureOn } from './features';

export interface BoxesDeps {
  journal: () => Journal;
  /** tells the library a file moved */
  moved: (from: string, to: string) => void;
  /** saves widgets and opens their windows (ipc/widgets.ts) */
  replaceWidgets: (list: ReturnType<typeof normalizeWidgets>) => Promise<void>;
}

const desktop = () => app.getPath('desktop');

/** Folders a box may read and open from: the ones boxes show, and the desktop. */
function allowed(p: string): boolean {
  const target = path.resolve(p);
  const roots = [desktop(), ...normalizeWidgets(settings().widgets).filter((w) => w.kind === 'folder' && w.options.folder).map((w) => w.options.folder!)];
  return roots.some((r) => { const rel = path.relative(path.resolve(r), target); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); });
}

async function readFolder(folder: string): Promise<BoxEntry[]> {
  const names = await fsp.readdir(folder).catch(() => null);
  if (!names) throw new Error('This folder is gone or cannot be read.');
  const out: BoxEntry[] = [];
  for (const name of names.slice(0, 2000)) {
    const p = path.join(folder, name);
    // A link is shown as what it points to; a broken one as a plain file.
    const st = (await fsp.stat(p).catch(() => null)) ?? (await fsp.lstat(p).catch(() => null));
    if (!st) continue;
    out.push({ name, path: p, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs });
  }
  return out;
}

const wayland = () => process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);

async function status(): Promise<BoxesStatus> {
  return {
    desktop: desktop(),
    // Wayland has no desktop layer for other apps: the boxes are ordinary windows that may float over others.
    floats: wayland(),
    tidyOffered: true,
  };
}

let lastPlan: { at: number; plan: TidyPlan } | null = null;

async function plan(): Promise<TidyPlan> {
  const p = planTidy(desktop(), await readFolder(desktop()), existsSync, path.sep);
  lastPlan = { at: Date.now(), plan: p };
  return p;
}

export function boxesApi(d: BoxesDeps): BoxesApi {
  return {
    status,
    list: async (folder: string, sort?: BoxSort, show?: BoxGroup | 'all') => {
      if (!featureOn('folderBoxes')) return [];
      if (!folder || !allowed(folder)) throw new Error('Choose a folder for this box.');
      return boxItems(await readFolder(folder), { sort, show });
    },
    open: async (p: string) => {
      if (!allowed(p)) return false;
      return (await shell.openPath(p)) === '';
    },
    reveal: async (p: string) => {
      if (allowed(p)) shell.showItemInFolder(p);
    },
    planTidy: () => plan(),
    tidy: async () => {
      if (!featureOn('folderBoxes')) throw new Error('Folder boxes are switched off in Settings → Features.');
      // The plan the person saw, if it is fresh; otherwise a new one.
      const p = lastPlan && Date.now() - lastPlan.at < 10 * 60_000 ? lastPlan.plan : await plan();
      lastPlan = null;
      const ops: JournalOp[] = [];
      for (const b of p.boxes) {
        if (existsSync(b.folder)) continue;
        await fsp.mkdir(b.folder, { recursive: true });
        ops.push({ type: 'create', from: b.folder, size: 0 });
      }
      let moved = 0;
      for (const m of p.moves) {
        // Each file is checked again: it may have gone or a file may have taken its new name since the plan.
        if (!existsSync(m.from) || existsSync(m.to)) continue;
        try {
          await moveFile(m.from, m.to);
          const st = await fsp.stat(m.to).catch(() => null);
          ops.push({ type: 'move', from: m.from, to: m.to, size: st?.size ?? 0 });
          d.moved(m.from, m.to);
          moved++;
        } catch { /* left where it was */ }
      }
      const entry = await d.journal().record(`Tidied the desktop into ${p.boxes.length} box${p.boxes.length === 1 ? '' : 'es'}`, ops);
      // A box for each folder that has none yet, in a row from the top left of the main screen.
      const list = normalizeWidgets(settings().widgets);
      const have = new Set(list.filter((w) => w.kind === 'folder').map((w) => path.resolve(w.options.folder ?? '')));
      const fresh = p.boxes.filter((b) => !have.has(path.resolve(b.folder)));
      const at = boxPositions(fresh.length, screen.getPrimaryDisplay().workArea);
      const added = fresh.map((b, i) => {
        const w = newWidget('folder', at[i], Date.now() + i);
        return { ...w, options: { ...w.options, folder: b.folder, title: b.name, sort: 'name' as const } };
      });
      if (added.length) await d.replaceWidgets([...list, ...added]);
      return { moved, boxes: p.boxes.length, journalId: entry?.id };
    },
  };
}
