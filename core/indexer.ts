// SPDX-License-Identifier: AGPL-3.0-or-later
// The library index: every file in the folders the user chose, with the
// details search needs. Kept in memory and saved to one JSON file, so the app
// opens instantly and only re-reads what changed.

import { mkdirSync, promises as fsp, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { kindOf, extOf, looksLikeScreenshot } from './classify';
import { search, type MatchOptions } from './query/match';
import { parseQuery } from './query/parse';
import { walk } from './walk';
import type { DownloadSource, FileEntry, FileKind, MediaMeta, ParsedQuery, Progress, SearchHit } from './types';

const VERSION = 3;

export interface IndexFolder {
  path: string;
  /** shelf label: "Desktop", "Documents", "Downloads", or the folder name */
  label: string;
}

export interface IndexHooks {
  /** reads where a file was downloaded from (xattr / Zone.Identifier); may be slow */
  readSource?: (p: string) => Promise<DownloadSource | undefined>;
  /** reads OS tags (macOS Finder tags) */
  readTags?: (p: string) => Promise<string[] | undefined>;
  /** last-opened time, when the OS tracks it better than atime */
  lastOpened?: (p: string) => Promise<number | undefined>;
}

interface Persisted {
  version: number;
  savedAt: number;
  files: FileEntry[];
  /** user-added tags, by path */
  tags: Record<string, string[]>;
  /** OCR text and source are slow to compute: keep them keyed by path+mtime */
  extras: Record<string, { mtime: number; text?: string; source?: DownloadSource; meta?: MediaMeta; dhash?: string }>;
  hashes: Record<string, { size: number; mtime: number; sha256: string }>;
}

export class FileIndex {
  files = new Map<string, FileEntry>();
  tags = new Map<string, string[]>();
  extras = new Map<string, Persisted['extras'][string]>();
  hashes = new Map<string, { size: number; mtime: number; sha256: string }>();
  lastScan = 0;
  scanning = false;
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(
    private file: string | null,
    public folders: IndexFolder[],
    public excluded: string[] = [],
    private hooks: IndexHooks = {},
  ) {}

  async load(): Promise<boolean> {
    if (!this.file) return false;
    try {
      const data = JSON.parse(await fsp.readFile(this.file, 'utf8')) as Persisted;
      if (data.version !== VERSION) return false;
      for (const f of data.files) this.files.set(f.path, f);
      for (const [k, v] of Object.entries(data.tags ?? {})) this.tags.set(k, v);
      for (const [k, v] of Object.entries(data.extras ?? {})) this.extras.set(k, v);
      for (const [k, v] of Object.entries(data.hashes ?? {})) this.hashes.set(k, v);
      this.lastScan = data.savedAt;
      return true;
    } catch {
      return false;
    }
  }

  private snapshot(): Persisted {
    return {
      version: VERSION,
      savedAt: this.lastScan,
      files: [...this.files.values()].map((f) => ({ ...f, text: undefined })),
      tags: Object.fromEntries(this.tags),
      extras: Object.fromEntries(this.extras),
      hashes: Object.fromEntries(this.hashes),
    };
  }

  async save(): Promise<void> {
    if (!this.file) return;
    const json = JSON.stringify(this.snapshot());
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await fsp.writeFile(tmp, json);
    await fsp.rename(tmp, this.file);
  }

  /** For quitting: the process may end before an asynchronous write finishes. */
  saveSync(): void {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.snapshot()));
    renameSync(tmp, this.file);
  }

  saveSoon(): void {
    // Saving a large library takes a moment; batch the many small changes (text read, tags) into one write.
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.save().catch(() => undefined);
    }, 15_000);
  }

  private labelFor(p: string): string {
    const f = this.folders.find((x) => p === x.path || p.startsWith(x.path + path.sep));
    return f?.label ?? path.basename(path.dirname(p));
  }

  /** Builds an entry from stat data and whatever was learned about the file before. */
  makeEntry(p: string, st: { size: number; mtimeMs: number; birthtimeMs: number; atimeMs: number; blocks?: number; isDirectory(): boolean }, label?: string): FileEntry {
    const name = path.basename(p);
    const isDir = st.isDirectory();
    const kind: FileKind = kindOf(name, isDir);
    const prev = this.extras.get(p);
    const fresh = prev && prev.mtime === Math.round(st.mtimeMs) ? prev : undefined;
    const tags = this.tags.get(p);
    return {
      path: p,
      name,
      ext: extOf(name),
      kind,
      size: st.size,
      mtime: Math.round(st.mtimeMs),
      btime: Math.round(st.birthtimeMs || st.mtimeMs),
      atime: Math.round(st.atimeMs || 0),
      root: label ?? this.labelFor(p),
      screenshot: looksLikeScreenshot(name) || undefined,
      source: fresh?.source,
      text: fresh?.text,
      meta: fresh?.meta,
      tags: tags?.length ? tags : undefined,
      // APFS "dataless" (iCloud optimised storage) and other placeholders take no blocks.
      cloudOnly: process.platform !== 'win32' && st.blocks === 0 && st.size > 0 ? true : undefined,
    };
  }

  /** Re-reads every folder. Unchanged files keep their OCR text, source and hashes. */
  async scan(opts: { signal?: AbortSignal; onProgress?: (p: Progress) => void; showHidden?: boolean } = {}): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    const seen = new Set<string>();
    let done = 0;
    try {
      for (const folder of this.folders) {
        opts.onProgress?.({ task: 'index', phase: `Reading ${folder.label}`, done, total: 0 });
        await walk(folder.path, {
          signal: opts.signal,
          showHidden: opts.showHidden,
          excluded: this.excluded,
          maxEntries: 400_000,
          onEntry: (e) => {
            if (e.stats.isDirectory() && kindOf(e.name, true) !== 'app') return;
            const entry = this.makeEntry(e.path, e.stats, folder.label);
            this.files.set(e.path, entry);
            seen.add(e.path);
            if (++done % 1000 === 0) opts.onProgress?.({ task: 'index', phase: `Reading ${folder.label}`, done, total: 0, current: e.path });
          },
        });
      }
      if (!opts.signal?.aborted) {
        for (const p of [...this.files.keys()]) if (!seen.has(p)) this.files.delete(p);
        for (const p of [...this.extras.keys()]) if (!seen.has(p)) this.extras.delete(p);
        for (const p of [...this.hashes.keys()]) if (!seen.has(p)) this.hashes.delete(p);
      }
      this.lastScan = Date.now();
      await this.enrichSources(opts);
      await this.save();
    } finally {
      this.scanning = false;
    }
  }

  /** Download sources for files that do not have one yet. */
  async enrichSources(opts: { signal?: AbortSignal; onProgress?: (p: Progress) => void } = {}): Promise<void> {
    const read = this.hooks.readSource;
    if (!read) return;
    const todo = [...this.files.values()].filter((f) => !f.source && !this.extras.get(f.path)?.source && this.extras.get(f.path)?.mtime !== f.mtime);
    let done = 0;
    const limit = 8;
    let i = 0;
    const next = async (): Promise<void> => {
      while (i < todo.length && !opts.signal?.aborted) {
        const f = todo[i++];
        try {
          const src = await read(f.path);
          this.setExtra(f, { source: src });
          if (src) f.source = src;
          // OS tags (macOS Finder) join Keeper's own tags the first time a file is seen.
          if (this.hooks.readTags && !this.tags.has(f.path)) {
            const t = await this.hooks.readTags(f.path);
            if (t?.length) {
              const clean = [...new Set(t.map((x) => x.trim().toLowerCase()).filter(Boolean))];
              this.tags.set(f.path, clean);
              f.tags = clean;
            }
          }
        } catch {
          /* no source recorded */
        }
        if (++done % 200 === 0) opts.onProgress?.({ task: 'index', phase: 'Looking up download sources', done, total: todo.length });
      }
    };
    await Promise.all(Array.from({ length: limit }, next));
  }

  setExtra(f: FileEntry, patch: Partial<Persisted['extras'][string]>): void {
    const prev = this.extras.get(f.path);
    const base = prev && prev.mtime === f.mtime ? prev : { mtime: f.mtime };
    this.extras.set(f.path, { ...base, ...patch, mtime: f.mtime });
  }

  setText(p: string, text: string): void {
    const f = this.files.get(p);
    if (!f) return;
    f.text = text;
    this.setExtra(f, { text });
    this.saveSoon();
  }

  setMeta(p: string, meta: MediaMeta): void {
    const f = this.files.get(p);
    if (!f) return;
    f.meta = { ...f.meta, ...meta };
    this.setExtra(f, { meta: f.meta });
    this.saveSoon();
  }

  setDhash(p: string, dhash: string): void {
    const f = this.files.get(p);
    if (f) this.setExtra(f, { dhash });
  }

  dhashes(): Map<string, string> {
    const m = new Map<string, string>();
    for (const f of this.files.values()) {
      const x = this.extras.get(f.path);
      if (x?.dhash && x.mtime === f.mtime) m.set(f.path, x.dhash);
    }
    return m;
  }

  setTags(p: string, tags: string[]): void {
    const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    if (clean.length) this.tags.set(p, clean);
    else this.tags.delete(p);
    const f = this.files.get(p);
    if (f) f.tags = clean.length ? clean : undefined;
    this.saveSoon();
  }

  /** Updates one path after Keeper (or a watcher) saw it change. */
  async refresh(p: string): Promise<FileEntry | undefined> {
    try {
      const st = await fsp.lstat(p);
      if (st.isSymbolicLink()) return undefined;
      const e = this.makeEntry(p, st);
      if (this.hooks.readSource && !e.source) e.source = await this.hooks.readSource(p).catch(() => undefined);
      if (e.source) this.setExtra(e, { source: e.source });
      this.files.set(p, e);
      this.saveSoon();
      return e;
    } catch {
      this.remove(p);
      return undefined;
    }
  }

  remove(p: string): void {
    this.files.delete(p);
    this.extras.delete(p);
    this.hashes.delete(p);
    this.saveSoon();
  }

  /** Moves the record (and its tags, text, source) to the new path. */
  rename(from: string, to: string): void {
    const f = this.files.get(from);
    const x = this.extras.get(from);
    const t = this.tags.get(from);
    this.files.delete(from);
    this.extras.delete(from);
    this.tags.delete(from);
    if (x) this.extras.set(to, x);
    if (t) this.tags.set(to, t);
    if (f) this.files.set(to, { ...f, path: to, name: path.basename(to), ext: extOf(path.basename(to)), kind: kindOf(path.basename(to)), root: this.labelFor(to) });
    this.saveSoon();
  }

  all(): FileEntry[] {
    return [...this.files.values()];
  }

  query(text: string, opts: MatchOptions = {}): { parsed: ParsedQuery; hits: SearchHit[] } {
    const parsed = parseQuery(text, opts.now);
    return { parsed, hits: search(this.files.values(), parsed.query, opts) };
  }

  /** Totals per shelf for the Home dashboard. */
  totals(): Record<FileKind, { count: number; size: number }> {
    const t = {} as Record<FileKind, { count: number; size: number }>;
    for (const k of ['image', 'video', 'audio', 'document', 'archive', 'installer', 'app', 'code', 'other'] as FileKind[]) t[k] = { count: 0, size: 0 };
    for (const f of this.files.values()) {
      t[f.kind].count++;
      t[f.kind].size += f.size;
    }
    return t;
  }

  recent(n: number, filter: (f: FileEntry) => boolean = () => true): FileEntry[] {
    const out: FileEntry[] = [];
    for (const f of this.files.values()) if (filter(f)) out.push(f);
    return out.sort((a, b) => Math.max(b.btime, b.mtime) - Math.max(a.btime, a.mtime)).slice(0, n);
  }

  /** Downloads grouped by where they came from, biggest groups first. */
  bySource(): { id: string; name: string; count: number; size: number; latest: number }[] {
    const m = new Map<string, { id: string; name: string; count: number; size: number; latest: number }>();
    for (const f of this.files.values()) {
      if (!f.source) continue;
      const g = m.get(f.source.id) ?? { id: f.source.id, name: f.source.name, count: 0, size: 0, latest: 0 };
      g.count++;
      g.size += f.size;
      g.latest = Math.max(g.latest, f.btime || f.mtime);
      m.set(f.source.id, g);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }

  allTags(): { tag: string; count: number }[] {
    const m = new Map<string, number>();
    for (const t of this.tags.values()) for (const x of t) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  }
}
