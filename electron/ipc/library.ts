// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The library's and the file list's calls (library.*, files.*, history.*): what the
// Files pages ask. Shared by Keeper (electron/main.ts) and the Keeper Files light app
// (electron/solo/library.ts, docs/SOLO.md); each passes its own index and helpers.

import { app, ipcMain, nativeImage, shell } from 'electron';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BackgroundWork } from '../../core/api';
import type { TransferOptions } from '../../core/fileops';
import { isUnder, typeCounts } from '../../core/file-types';
import { FileIndex } from '../../core/indexer';
import { undoMoves, type Journal } from '../../core/journal';
import { run } from '../../core/platform';
import { largeFiles } from '../../core/cleanup/files';
import type { AllSettings } from '../../core/settings';
import type { FileEntry, FileKind } from '../../core/types';
import type { FileService } from '../services/files';
import { onThisDayFiles } from '../../core/today';

export interface LibraryIpcDeps {
  index: () => FileIndex;
  files: () => FileService;
  journal: () => Journal;
  /** reading the folders now: found so far and expected */
  scan: () => { found?: number; expected?: number };
  /** pictures and documents waiting for their text to be read */
  ocrPending: () => number;
  background: () => BackgroundWork;
  rescan: () => Promise<void>;
  /** "Speed up now" */
  speedUp: () => void;
  /** something in the library changed (the windows refresh) */
  changed: () => void;
  broadcast: (channel: string, ...args: unknown[]) => void;
  /** files found to be duplicates by the last check (search can show them) */
  duplicates: () => Set<string> | undefined;
  /** reads the text in a picture or PDF (Keeper's text reading) */
  readText?: (p: string) => Promise<string>;
  /** usage learning: opens, moves and trashes made in Keeper */
  record?: (e: { type: 'open' | 'trash'; path: string } | { type: 'move'; from: string; to: string }) => void;
  /** tags written back to Finder (macOS) */
  syncTags?: (p: string, tags: string[]) => void;
}

/**
 * Lists cross to the window as structured clones; recognised text can be long,
 * so lists carry only its start (enough to show that text exists). Full text is
 * fetched on demand (inspect, readText).
 */
export function lite(f: FileEntry): FileEntry {
  return f.text && f.text.length > 160 ? { ...f, text: f.text.slice(0, 160), textCut: true } : f;
}

export const sortFiles = (list: FileEntry[], key: string = 'date', desc = true) => {
  const dir = desc ? -1 : 1;
  return list.sort((a, b) =>
    key === 'name' ? dir * a.name.localeCompare(b.name, undefined, { numeric: true })
      : key === 'size' ? dir * (a.size - b.size)
      : key === 'kind' ? a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
      : dir * (a.mtime - b.mtime));
};

/**
 * The folders the library reads. Until the first-run setup is finished (or skipped) only
 * Downloads: reading Desktop and Documents would make macOS ask about each folder before
 * the person has seen anything (setup offers Full Disk Access as one switch instead).
 */
export function libraryFolders(s: AllSettings, noTour: boolean) {
  const all = s.folders.filter((f) => existsSync(f));
  const waiting = !s.setupDone && !noTour;
  const downloads = (() => { try { return app.getPath('downloads'); } catch { return ''; } })();
  return (waiting ? all.filter((f) => f === downloads || path.basename(f) === 'Downloads') : all).map((f) => ({ path: f, label: path.basename(f) }));
}

/** The library's index, kept in index.json in Keeper's data folder. */
export function makeIndex(s: AllSettings, noTour: boolean, hooks: ConstructorParameters<typeof FileIndex>[3] = {}) {
  return new FileIndex(path.join(app.getPath('userData'), 'index.json'), libraryFolders(s, noTour), s.excluded, hooks);
}

export function registerLibraryIpc(d: LibraryIpcDeps) {
  const handle = (name: string, fn: (...args: never[]) => unknown) => ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
  const index = () => d.index();
  const files = () => d.files();

  handle('library.status', () => {
    const i = index();
    const sc = i.scanning ? d.scan() : {};
    return { indexing: i.scanning, files: i.files.size, lastScan: i.lastScan, ocrPending: d.ocrPending(), found: sc.found, expected: sc.expected, background: d.background() };
  });
  // "Speed up now": background reading at full speed for half an hour, even on battery.
  handle('library.speedUp', () => { d.speedUp(); });
  handle('library.rescan', () => d.rescan());
  handle('library.totals', () => index().totals());
  // The type chips' counts on the file list (Everywhere, or one folder and what is inside it).
  handle('library.typeCounts', (under?: string) => typeCounts(index().files.values(), under || undefined));
  handle('library.recent', (n: number, kind?: string) => index().recent(n, (f) => !kind || (kind === 'screenshot' ? !!f.screenshot : kind === 'download' ? f.root === 'Downloads' : f.kind === kind)).map(lite));
  handle('library.list', (o: { kind?: FileKind; screenshot?: boolean; fromWeb?: boolean; under?: string; root?: string; source?: string; tag?: string; sort?: string; desc?: boolean; limit?: number }) => {
    const list = index().all().filter((f) => (!o.kind || f.kind === o.kind) && (!o.screenshot || f.screenshot) && (!o.fromWeb || !!f.source) && (!o.under || isUnder(f.path, o.under)) && (!o.root || f.root === o.root) && (!o.source || f.source?.id === o.source) && (!o.tag || f.tags?.includes(o.tag)));
    const sorted = sortFiles(list, o.sort, o.desc ?? o.sort !== 'name');
    return (o.limit ? sorted.slice(0, o.limit) : sorted).map(lite);
  });
  handle('library.search', (text: string, limit = 300) => {
    const { parsed, hits } = index().query(text, { duplicatePaths: d.duplicates() });
    return { parsed, hits: hits.slice(0, limit).map((h) => ({ ...h, file: lite(h.file) })) };
  });
  handle('library.bySource', () => index().bySource());
  handle('library.tags', () => index().allTags());
  handle('library.setTags', (p: string, tags: string[]) => { const i = index(); i.setTags(p, tags); d.syncTags?.(p, i.files.get(p)?.tags ?? []); d.changed(); });
  handle('library.inspect', async (p: string) => index().files.get(p) ?? (await index().refresh(p)) ?? null);
  handle('library.readText', async (paths: string[]) => {
    const out = [];
    for (const p of paths) {
      const i = index();
      let text = i.files.get(p)?.text ?? i.extras.get(p)?.text;
      if (text === undefined) {
        text = d.readText ? await d.readText(p) : '';
        i.setText(p, text);
      }
      out.push({ path: p, text });
    }
    return out;
  });
  handle('library.largeFiles', (minMb: number) => largeFiles(index().all(), minMb).map(lite));
  // Today's On this day card: pictures made on this day in earlier years (core/today.ts).
  handle('library.onThisDay', (n?: number) => onThisDayFiles(index().all().filter((f) => f.kind === 'image'), Date.now(), Math.max(1, Math.min(12, Number(n) || 6))).map(lite));

  handle('files.browse', (dir: string, hidden?: boolean) => files().browse(dir, hidden));
  handle('files.thumbnail', (p: string, size: number) => files().thumbnail(p, size));
  handle('files.icon', (p: string) => files().icon(p));
  // Usage learning (off unless turned on) notes opens, moves and trashes made in Keeper.
  handle('files.open', (p: string) => { d.record?.({ type: 'open', path: p }); return files().open(p); });
  handle('files.openWith', (p: string) => files().openWith(p));
  handle('files.reveal', (p: string) => files().reveal(p));
  handle('files.copyPaths', (paths: string[]) => files().copyPaths(paths));
  handle('files.copyText', (t: string) => files().copyText(t));
  handle('files.trash', (paths: string[], title?: string) => { for (const p of paths) d.record?.({ type: 'trash', path: p }); return files().trash(paths, title); });
  handle('files.move', async (paths: string[], dir: string, opts?: TransferOptions) => {
    const r = await files().move(paths, dir, { ...opts }, (p) => d.broadcast('files-progress', p));
    for (const op of d.journal().get(r.journalId ?? '')?.ops ?? []) if (op.type === 'move' && op.to) d.record?.({ type: 'move', from: op.from, to: op.to });
    return r;
  });
  handle('files.copy', (paths: string[], dir: string, opts?: TransferOptions) => files().copy(paths, dir, { ...opts }, (p) => d.broadcast('files-progress', p)));
  handle('files.clipboardPaths', () => files().clipboardPaths());
  handle('files.conflicts', (paths: string[], dir: string, op?: 'copy' | 'move') => files().conflicts(paths, dir, op));
  handle('files.rename', (p: string, name: string) => files().rename(p, name));
  handle('files.previewRename', (paths: string[], steps: never) => files().previewRename(paths, steps));
  handle('files.applyRename', (paths: string[], steps: never) => files().applyRename(paths, steps));
  handle('files.newFolder', (dir: string, name: string) => files().newFolder(dir, name));
  handle('files.compress', (paths: string[]) => files().compress(paths));
  ipcMain.on('files.startDrag', (e, paths: string[]) => {
    const list = paths.filter((p) => existsSync(p));
    if (!list.length) return;
    const icon = nativeImage.createFromPath(list[0]);
    e.sender.startDrag({ file: list[0], files: list, icon: icon.isEmpty() ? nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=') : icon.resize({ width: 64 }) });
  });

  handle('history.list', async () => {
    const journal = d.journal();
    await journal.load();
    return journal.list();
  });
  handle('history.undo', async (id: string) => {
    const journal = d.journal();
    await journal.load();
    const e = journal.get(id);
    if (!e || e.undone) return { restored: 0, failed: [] };
    const res = await undoMoves(e);
    // Items sent to the Trash: point the user at it (restoring from the system Trash is up to the OS).
    const trashed = e.ops.filter((o) => o.type === 'trash');
    if (trashed.length && process.platform === 'darwin') await run('/usr/bin/open', [path.join(os.homedir(), '.Trash')]);
    else if (trashed.length && process.platform === 'win32') await run('explorer.exe', ['shell:RecycleBinFolder']);
    else if (trashed.length) await shell.openPath(path.join(os.homedir(), '.local', 'share', 'Trash', 'files'));
    for (const op of e.ops) if (op.type === 'move' && op.to) index().rename(op.to, op.from);
    await journal.markUndone(id);
    d.changed();
    return { restored: res.restored, failed: res.failed.concat(trashed.length ? [`${trashed.length} item(s) are in the Trash — put them back from there`] : []) };
  });
}
