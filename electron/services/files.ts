// SPDX-License-Identifier: AGPL-3.0-or-later
// Everyday file operations. User files only ever go to the system Trash, and
// every change is written to the history so it can be undone.

import { app, nativeImage, shell } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import type { BrowseEntry } from '../../core/api';
import { extOf, kindOf } from '../../core/classify';
import type { FileIndex } from '../../core/indexer';
import { moveFile, type Journal } from '../../core/journal';
import { run, powershell } from '../../core/platform';
import { previewRename, type RenameStep } from '../../core/rename';
import { uniqueName } from '../../core/rules';
import { checkRemovable } from '../../core/safety';
import type { CleanResult, FileEntry, JournalOp } from '../../core/types';
import { settings } from '../store';
import { writePaths, writeText } from './clip';
import { richThumbnail } from './thumbs';

/**
 * Names the system marks hidden without a leading dot: the hidden attribute on
 * Windows, the "hidden" flag on macOS, and a folder's ".hidden" list on Linux
 * desktops. Cached for a few seconds, since folders are listed again often.
 */
const flagCache = new Map<string, { at: number; names: Set<string> }>();
async function hiddenByFlag(dir: string): Promise<Set<string>> {
  const hit = flagCache.get(dir);
  if (hit && Date.now() - hit.at < 5000) return hit.names;
  let names: string[] = [];
  if (process.platform === 'win32') {
    const r = await run('cmd.exe', ['/d', '/c', 'dir', '/a:h', '/b', dir], 5000);
    names = r.ok ? r.stdout.split(/\r?\n/) : [];
  } else if (process.platform === 'darwin') {
    const r = await run('/usr/bin/find', [dir, '-mindepth', '1', '-maxdepth', '1', '-flags', '+hidden', '-print0'], 5000);
    names = r.ok ? r.stdout.split('\0').map((p) => path.basename(p)) : [];
  } else {
    names = await fsp.readFile(path.join(dir, '.hidden'), 'utf8').then((t) => t.split('\n'), () => []);
  }
  const set = new Set(names.map((n) => n.trim()).filter(Boolean));
  if (flagCache.size > 200) flagCache.clear();
  flagCache.set(dir, { at: Date.now(), names: set });
  return set;
}

export class FileService {
  constructor(private index: FileIndex, private journal: Journal, private onChange: () => void) {}

  async browse(dir: string, showHidden = false): Promise<BrowseEntry[]> {
    const [list, marked] = await Promise.all([fsp.readdir(dir, { withFileTypes: true }), hiddenByFlag(dir)]);
    const out: BrowseEntry[] = [];
    await Promise.all(
      list.map(async (d) => {
        const hidden = d.name.startsWith('.') || marked.has(d.name) || (process.platform === 'win32' && /^(desktop\.ini|thumbs\.db|ntuser\.)/i.test(d.name));
        if (hidden && !showHidden) return;
        const p = path.join(dir, d.name);
        try {
          const st = await fsp.stat(p);
          const isDir = st.isDirectory() && extOf(d.name) !== 'app';
          out.push({ path: p, name: d.name, isDir, size: isDir ? 0 : st.size, mtime: st.mtimeMs, kind: isDir ? 'folder' : kindOf(d.name, st.isDirectory()), ext: isDir ? '' : extOf(d.name), hidden, cloudOnly: !isDir && st.size > 4096 && st.blocks === 0 ? true : undefined });
        } catch {
          /* broken link or no permission */
        }
      }),
    );
    return out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  private thumbs = new Map<string, string | null>();

  /** OS thumbnail (Quick Look / Explorer); falls back to decoding the image directly. */
  async thumbnail(p: string, size: number): Promise<string | null> {
    const key = `${p}@${size}`;
    if (this.thumbs.has(key)) return this.thumbs.get(key)!;
    // Video frames, cover art, documents, RAW/HEIC/PSD/SVG… (disk-cached).
    const rich = await richThumbnail(p, size).catch(() => null);
    if (rich) {
      this.thumbs.set(key, rich);
      return rich;
    }
    let img: Electron.NativeImage | null = null;
    try {
      if (process.platform !== 'linux') img = await nativeImage.createThumbnailFromPath(p, { width: size, height: size });
    } catch {
      img = null;
    }
    if (!img || img.isEmpty()) {
      const k = kindOf(path.basename(p));
      if (k === 'image') {
        const raw = nativeImage.createFromPath(p);
        if (!raw.isEmpty()) {
          const { width, height } = raw.getSize();
          const scale = Math.min(1, size / Math.max(width, height));
          img = raw.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' });
        }
      }
    }
    const url = img && !img.isEmpty() ? img.toDataURL() : null;
    if (this.thumbs.size > 2000) this.thumbs.clear();
    this.thumbs.set(key, url);
    return url;
  }

  async icon(p: string): Promise<string | null> {
    try {
      return (await app.getFileIcon(p, { size: 'large' })).toDataURL();
    } catch {
      return null;
    }
  }

  async open(p: string) {
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
  }

  async openWith(p: string) {
    if (process.platform === 'darwin') shell.showItemInFolder(p);
    else if (process.platform === 'win32') await run('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', p]);
    else await shell.openPath(path.dirname(p));
  }

  reveal(p: string) {
    shell.showItemInFolder(p);
  }

  async copyPaths(paths: string[]) {
    await writePaths(paths);
    // Windows Explorer pastes files from its own clipboard format.
    if (process.platform === 'win32') await powershell(`Set-Clipboard -Path ${paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')}`);
  }

  async copyText(text: string) {
    await writeText(text);
  }

  /** Moves files to the system Trash. Refuses protected folders and anything excluded. */
  async trash(paths: string[], title?: string): Promise<CleanResult> {
    const s = settings();
    const ctx = { platform: process.platform, home: app.getPath('home'), excluded: s.excluded };
    const res: CleanResult = { freed: 0, removed: 0, failed: 0, skipped: [] };
    const ops: JournalOp[] = [];
    for (const p of paths) {
      const v = await checkRemovable(p, ctx);
      if (!v.ok) {
        res.skipped.push(`${path.basename(p)}: ${v.reason}`);
        res.failed++;
        continue;
      }
      try {
        const st = await fsp.lstat(p);
        const size = st.isDirectory() ? (this.index.files.get(p)?.size ?? 0) : st.size;
        await shell.trashItem(p);
        res.freed += size;
        res.removed++;
        ops.push({ type: 'trash', from: p, size });
        this.index.remove(p);
      } catch (e) {
        res.failed++;
        res.skipped.push(`${path.basename(p)}: ${e instanceof Error ? e.message : 'could not be moved'}`);
      }
    }
    const entry = await this.journal.record(title ?? `Moved ${res.removed} item${res.removed === 1 ? '' : 's'} to the Trash`, ops);
    res.journalId = entry?.id;
    this.onChange();
    return res;
  }

  async move(paths: string[], dir: string, title?: string): Promise<CleanResult> {
    const res: CleanResult = { freed: 0, removed: 0, failed: 0, skipped: [] };
    const ops: JournalOp[] = [];
    await fsp.mkdir(dir, { recursive: true });
    for (const p of paths) {
      try {
        const to = uniqueName(path.join(dir, path.basename(p)), existsSync);
        await moveFile(p, to);
        ops.push({ type: 'move', from: p, to, size: 0 });
        this.index.rename(p, to);
        res.removed++;
      } catch (e) {
        res.failed++;
        res.skipped.push(`${path.basename(p)}: ${e instanceof Error ? e.message : 'could not be moved'}`);
      }
    }
    const entry = await this.journal.record(title ?? `Moved ${res.removed} item${res.removed === 1 ? '' : 's'} to ${path.basename(dir)}`, ops);
    res.journalId = entry?.id;
    this.onChange();
    return res;
  }

  async copy(paths: string[], dir: string): Promise<CleanResult> {
    const res: CleanResult = { freed: 0, removed: 0, failed: 0, skipped: [] };
    for (const p of paths) {
      try {
        const to = uniqueName(path.join(dir, path.basename(p)), existsSync);
        await fsp.cp(p, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
        await this.index.refresh(to);
        res.removed++;
      } catch (e) {
        res.failed++;
        res.skipped.push(`${path.basename(p)}: ${e instanceof Error ? e.message : 'could not be copied'}`);
      }
    }
    this.onChange();
    return res;
  }

  async rename(p: string, name: string): Promise<string> {
    const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim();
    if (!clean) throw new Error('A name cannot be empty');
    const to = path.join(path.dirname(p), clean);
    if (to === p) return p;
    if (existsSync(to) && to.toLowerCase() !== p.toLowerCase()) throw new Error(`“${clean}” already exists here`);
    await fsp.rename(p, to);
    this.index.rename(p, to);
    await this.journal.record(`Renamed ${path.basename(p)} to ${clean}`, [{ type: 'move', from: p, to, size: 0 }]);
    this.onChange();
    return to;
  }

  private entries(paths: string[]): FileEntry[] {
    return paths.map((p) => this.index.files.get(p) ?? this.index.makeEntry(p, { size: 0, mtimeMs: Date.now(), birthtimeMs: Date.now(), atimeMs: 0, isDirectory: () => false }));
  }

  previewRename(paths: string[], steps: RenameStep[]) {
    return previewRename(this.entries(paths), steps, existsSync);
  }

  /** Renames in two passes (through temporary names) so swaps like a→b, b→a work. */
  async applyRename(paths: string[], steps: RenameStep[]): Promise<CleanResult> {
    const plan = previewRename(this.entries(paths), steps, existsSync).filter((p) => p.changed);
    if (plan.some((p) => p.conflict)) throw new Error('Some names conflict; fix them first');
    const temps: { tmp: string; from: string; to: string }[] = [];
    for (const p of plan) {
      const tmp = `${p.from}.keeper-rename-${Date.now()}`;
      await fsp.rename(p.from, tmp);
      temps.push({ tmp, from: p.from, to: p.to });
    }
    const ops: JournalOp[] = [];
    for (const t of temps) {
      await fsp.rename(t.tmp, t.to);
      this.index.rename(t.from, t.to);
      ops.push({ type: 'move', from: t.from, to: t.to, size: 0 });
    }
    const entry = await this.journal.record(`Renamed ${ops.length} item${ops.length === 1 ? '' : 's'}`, ops);
    this.onChange();
    return { freed: 0, removed: ops.length, failed: 0, skipped: [], journalId: entry?.id };
  }

  async newFolder(dir: string, name: string): Promise<string> {
    const p = uniqueName(path.join(dir, name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-') || 'New Folder'), existsSync);
    await fsp.mkdir(p);
    return p;
  }

  /** Zips the items next to the first one, using the system's own zip tool. */
  async compress(paths: string[]): Promise<string> {
    if (!paths.length) throw new Error('Nothing to compress');
    const dir = path.dirname(paths[0]);
    const base = paths.length === 1 ? path.basename(paths[0]).replace(/\.[^.]+$/, '') : 'Archive';
    const out = uniqueName(path.join(dir, `${base}.zip`), existsSync);
    const names = paths.map((p) => path.relative(dir, p));
    let ok: boolean;
    if (process.platform === 'darwin') {
      ok = paths.length === 1
        ? (await run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', paths[0], out], 600_000)).ok
        : (await runIn(dir, '/usr/bin/zip', ['-r', '-q', out, ...names])).ok;
    } else if (process.platform === 'win32') {
      ok = (await powershell(`Compress-Archive -LiteralPath ${paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')} -DestinationPath '${out.replace(/'/g, "''")}'`, 600_000)).ok;
    } else {
      ok = (await runIn(dir, 'zip', ['-r', '-q', out, ...names])).ok;
    }
    if (!ok) throw new Error('Could not create the archive');
    await this.index.refresh(out);
    this.onChange();
    return out;
  }
}

function runIn(cwd: string, file: string, args: string[]) {
  return new Promise<{ ok: boolean }>((resolve) => {
    import('node:child_process').then(({ execFile }) => {
      execFile(file, args, { cwd, timeout: 600_000, windowsHide: true }, (err) => resolve({ ok: !err }));
    });
  });
}
