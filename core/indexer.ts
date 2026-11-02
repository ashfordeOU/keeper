// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The library index: every file in the folders the user chose, with the
// details search needs. Kept in memory and saved to one JSON file, so the app
// opens instantly and only re-reads what changed.
//
// Saving: the JSON file (a snapshot, ~100 MB for a quarter of a million files)
// is rewritten only after a scan that changed many files, on quitting, or when
// the journal beside it (index.json.log) has grown to three quarters of its size.
// Everything in between (text read from a document, a picture's details, tags,
// a file that changed) is appended to the journal as one short line, and
// replayed on loading. Rewriting the whole file every 15 seconds while text was
// read wrote gigabytes an hour.

import { closeSync, openSync, promises as fsp, writeSync } from 'node:fs';
import path from 'node:path';
import { kindOf, extOf, looksLikeScreenshot } from './classify';
import { JsonChunks, ownString, writeChunksAtomic, writeChunksAtomicSync } from './json-chunks';
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
  /** the same for many files at once (one helper process per batch); preferred when given */
  readSources?: (paths: string[]) => Promise<Map<string, { source?: DownloadSource; tags?: string[] }>>;
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

type Extra = Persisted['extras'][string];
type Hash = { size: number; mtime: number; sha256: string };

/** One line of the journal: the new value of one thing (replaying it twice changes nothing). */
type LogRecord =
  | { g: number; f: FileEntry }
  | { g: number; d: string }
  | { g: number; x: [string, Extra | null] }
  | { g: number; t: [string, string[] | null] }
  | { g: number; h: [string, Hash | null] }
  | { g: number; s: number };

/** Scans that changed more files than this write a new snapshot; fewer go to the journal. */
const SNAPSHOT_AFTER_CHANGES = 5000;

export class FileIndex {
  files = new Map<string, FileEntry>();
  tags = new Map<string, string[]>();
  extras = new Map<string, Extra>();
  hashes = new Map<string, Hash>();
  lastScan = 0;
  scanning = false;
  private saveTimer: NodeJS.Timeout | undefined;
  /** the journal beside the snapshot */
  private readonly logFile: string | null;
  /** journal lines not written yet (written together every few seconds) */
  private pendingLog: string[] = [];
  private logTimer: NodeJS.Timeout | undefined;
  /** which snapshot the journal belongs to: lines from an older one are ignored */
  private gen = 1;
  private logBytes = 0;
  private logStarted = false;
  private snapshotBytes = 0;
  private lastSnapshotAt = 0;
  /** journal writes and snapshots, one after another */
  private io: Promise<void> = Promise.resolve();
  /** paths changed since the brain last caught up; null: everything (after loading or a big scan) */
  private touched: Set<string> | null = null;
  /** bytes the index wrote to disk since it started (snapshots and journal) */
  bytesWritten = 0;

  constructor(
    private file: string | null,
    public folders: IndexFolder[],
    public excluded: string[] = [],
    private hooks: IndexHooks = {},
  ) {
    this.logFile = file ? `${file}.log` : null;
  }

  async load(): Promise<boolean> {
    if (!this.file) return false;
    try {
      const text = await fsp.readFile(this.file, 'utf8');
      this.snapshotBytes = Buffer.byteLength(text);
      const data = JSON.parse(text) as Persisted;
      if (data.version !== VERSION) return false;
      for (const f of data.files) this.files.set(f.path, f);
      for (const [k, v] of Object.entries(data.tags ?? {})) this.tags.set(k, v);
      for (const [k, v] of Object.entries(data.extras ?? {})) this.extras.set(k, v);
      for (const [k, v] of Object.entries(data.hashes ?? {})) this.hashes.set(k, v);
      this.lastScan = data.savedAt;
    } catch {
      return false;
    }
    await this.replayLog();
    this.touched = null;
    return true;
  }

  /** Applies the journal written since the snapshot. A half-written last line (a crash) is skipped. */
  private async replayLog(): Promise<void> {
    if (!this.logFile) return;
    let text: string;
    try {
      text = await fsp.readFile(this.logFile, 'utf8');
    } catch {
      return;
    }
    const lines = text.split('\n');
    let gen: number | undefined;
    try {
      gen = (JSON.parse(lines[0]) as { gen?: number }).gen;
    } catch {
      /* no header: nothing in it can be trusted */
    }
    if (typeof gen !== 'number') return;
    this.gen = gen;
    this.logStarted = true;
    this.logBytes = Buffer.byteLength(text);
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      let r: LogRecord;
      try {
        r = JSON.parse(lines[i]) as LogRecord;
      } catch {
        continue;
      }
      if (r.g !== gen) continue;
      this.apply(r);
    }
  }

  private apply(r: LogRecord) {
    if ('f' in r) this.files.set(r.f.path, r.f);
    else if ('d' in r) {
      this.files.delete(r.d);
      this.extras.delete(r.d);
      this.hashes.delete(r.d);
    } else if ('x' in r) {
      if (r.x[1]) this.extras.set(r.x[0], r.x[1]);
      else this.extras.delete(r.x[0]);
    } else if ('t' in r) {
      if (r.t[1]?.length) this.tags.set(r.t[0], r.t[1]);
      else this.tags.delete(r.t[0]);
    } else if ('h' in r) {
      if (r.h[1]) this.hashes.set(r.h[0], r.h[1]);
      else this.hashes.delete(r.h[0]);
    } else if ('s' in r) this.lastScan = r.s;
  }

  /** Records one change: in the journal (written within a few seconds) and for the brain. */
  private note(r: { f: FileEntry } | { d: string } | { x: [string, Extra | null] } | { t: [string, string[] | null] } | { h: [string, Hash | null] } | { s: number }, p?: string): void {
    if (p !== undefined) this.touch(p);
    if (!this.logFile) return;
    this.pendingLog.push(`${JSON.stringify({ ...r, g: this.gen })}\n`);
    if (this.logTimer) return;
    this.logTimer = setTimeout(() => { this.logTimer = undefined; void this.flushLog().catch(() => undefined); }, 5000);
    this.logTimer.unref?.();
  }

  private touch(p: string) {
    if (!this.touched) return;
    this.touched.add(p);
    // So many that looking at everything is quicker.
    if (this.touched.size > 20_000) this.touched = null;
  }

  /**
   * Paths changed since the last call (text read, tags, files that changed or went), for the
   * brain to catch up on just those; null means look at everything.
   */
  drainChanged(): string[] | null {
    const t = this.touched;
    this.touched = new Set();
    return t ? [...t] : null;
  }

  private queue(fn: () => Promise<void>): Promise<void> {
    const p = this.io.then(fn, fn);
    this.io = p.catch(() => undefined);
    return p;
  }

  /** Writes the journal lines waiting, now. */
  flushLog(): Promise<void> {
    clearTimeout(this.logTimer);
    this.logTimer = undefined;
    const logFile = this.logFile;
    if (!logFile) return Promise.resolve();
    return this.queue(async () => {
      if (!this.pendingLog.length) return;
      const lines = this.pendingLog.join('');
      this.pendingLog = [];
      if (!this.logStarted) {
        const head = `${JSON.stringify({ gen: this.gen })}\n`;
        await fsp.mkdir(path.dirname(logFile), { recursive: true });
        await fsp.writeFile(logFile, head);
        this.logStarted = true;
        this.logBytes = head.length;
        this.bytesWritten += head.length;
      }
      const n = Buffer.byteLength(lines);
      await fsp.appendFile(logFile, lines);
      this.logBytes += n;
      this.bytesWritten += n;
      // The journal has grown to three quarters of the snapshot: fold it in. (A first start's
      // download-source lookups and text alone are about half: one snapshot fewer.)
      if (this.logBytes > Math.max(16 * 1048576, this.snapshotBytes * 0.75)) this.saveSoon(0);
    });
  }

  /** Journal size on disk, and the snapshot's, in bytes (for tests and the performance check). */
  diskSizes(): { snapshot: number; journal: number } {
    return { snapshot: this.snapshotBytes, journal: this.logBytes };
  }

  /**
   * The saved form, written piece by piece (the same JSON as stringifying the
   * whole Persisted object): no copy of every entry and no single giant string
   * on the heap, which for a big library with its text was gigabytes.
   */
  serialize(): Buffer[] {
    const out = new JsonChunks();
    out.raw(`{"version":${VERSION},"savedAt":`).num(this.lastScan).raw(',"files":[');
    let first = true;
    for (const f of this.files.values()) {
      out.raw(first ? '' : ',').raw(JSON.stringify({ ...f, text: undefined }));
      first = false;
    }
    const record = (name: string, m: Map<string, unknown>) => {
      out.raw(`,${JSON.stringify(name)}:{`);
      let i = 0;
      for (const [k, v] of m) {
        if (v === undefined) continue;
        out.raw(`${i++ ? ',' : ''}${JSON.stringify(k)}:${JSON.stringify(v)}`);
      }
      out.raw('}');
    };
    out.raw(']');
    record('tags', this.tags);
    record('extras', this.extras);
    record('hashes', this.hashes);
    out.raw('}');
    return out.done();
  }

  private saving: Promise<void> | null = null;
  private saveAgain = false;

  /** Writes a new snapshot now; a save asked for while one is being written follows it (never two at once). */
  async save(): Promise<void> {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (this.saving) {
      this.saveAgain = true;
      return this.saving;
    }
    const file = this.file;
    this.saving = (async () => {
      try {
        do {
          this.saveAgain = false;
          await this.queue(() => this.writeSnapshot(file));
        } while (this.saveAgain);
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  private async writeSnapshot(file: string): Promise<void> {
    // Everything noted so far is in this snapshot; the journal starts again for the next one.
    this.pendingLog = [];
    this.gen++;
    const parts = this.serialize();
    await writeChunksAtomic(file, parts);
    const bytes = parts.reduce((n, b) => n + b.length, 0);
    this.snapshotBytes = bytes;
    this.bytesWritten += bytes;
    this.lastSnapshotAt = Date.now();
    if (this.logFile) {
      const head = `${JSON.stringify({ gen: this.gen })}\n`;
      await fsp.writeFile(this.logFile, head);
      this.logStarted = true;
      this.logBytes = head.length;
    }
  }

  /** For quitting: the process may end before an asynchronous write finishes. */
  saveSync(): void {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    clearTimeout(this.logTimer);
    this.logTimer = undefined;
    this.pendingLog = [];
    // A journal write still under way belongs to the old snapshot and is ignored on loading.
    this.gen++;
    // Its own temporary file, so an asynchronous save still writing cannot interleave with it.
    writeChunksAtomicSync(this.file, this.serialize(), `${this.file}.quit.tmp`);
    if (this.logFile) {
      const fd = openSync(this.logFile, 'w');
      try { writeSync(fd, `${JSON.stringify({ gen: this.gen })}\n`); } finally { closeSync(fd); }
    }
  }

  /**
   * A snapshot soon. Many small changes (the brain's duplicate hashes) are batched into one
   * write, and a big index is rewritten at most every few minutes: the gap grows with its size
   * (about 128 KB a second on average, so a 100 MB index waits ten minutes). Changes in
   * between are in the journal or rebuilt by the next scan.
   */
  saveSoon(delayMs?: number): void {
    if (this.saveTimer) return;
    const sizeGap = Math.min(10 * 60_000, Math.max(15_000, (this.snapshotBytes / (128 * 1024)) * 1000));
    const wait = delayMs ?? Math.max(15_000, this.lastSnapshotAt + sizeGap - Date.now());
    const due = Math.max(wait, this.lastSnapshotAt + Math.min(sizeGap, 60_000) - Date.now(), 0);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.save().catch(() => undefined);
    }, due);
    this.saveTimer.unref?.();
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

  /**
   * Re-reads every folder. Unchanged files keep their OCR text, source and hashes. `pause`
   * is awaited every few hundred files (the governor's pace: a gentle first read).
   * `sources: false` leaves looking up download sources to the caller (enrichSources), so
   * the library counts as read as soon as every folder has been listed.
   */
  async scan(opts: { signal?: AbortSignal; onProgress?: (p: Progress) => void; showHidden?: boolean; pause?: () => Promise<void>; sources?: boolean } = {}): Promise<{ changed: number }> {
    if (this.scanning) return { changed: 0 };
    this.scanning = true;
    const seen = new Set<string>();
    const expected = this.files.size;
    let done = 0;
    let changed = 0;
    const changedPaths: string[] = [];
    let pausing: Promise<void> | null = null;
    try {
      for (const folder of this.folders) {
        opts.onProgress?.({ task: 'index', phase: `Reading ${folder.label}`, done, total: 0, found: done, expected });
        await walk(folder.path, {
          signal: opts.signal,
          showHidden: opts.showHidden,
          excluded: this.excluded,
          maxEntries: 400_000,
          // A few folders at a time: listing a quarter of a million files should not crowd out the disk.
          concurrency: 4,
          statSync: true,
          onEntry: async (e) => {
            if (e.stats.isDirectory() && kindOf(e.name, true) !== 'app') return;
            const prev = this.files.get(e.path);
            const st = e.stats;
            seen.add(e.path);
            // Unchanged (same date, size and shelf, and its text already attached): the entry stays as it is.
            // A rescan of a quarter of a million files then makes almost nothing new.
            if (prev && prev.mtime === Math.round(st.mtimeMs) && prev.size === st.size && prev.root === folder.label
              && !!prev.cloudOnly === (process.platform !== 'win32' && st.blocks === 0 && st.size > 0)
              && (prev.text !== undefined || this.extras.get(e.path)?.text === undefined)) {
              prev.atime = Math.round(st.atimeMs || 0);
            } else {
              const entry = this.makeEntry(e.path, st, folder.label);
              this.files.set(e.path, entry);
              if (!prev || prev.mtime !== entry.mtime || prev.size !== entry.size || prev.cloudOnly !== entry.cloudOnly || prev.root !== entry.root) {
                changed++;
                if (changedPaths.length <= SNAPSHOT_AFTER_CHANGES) changedPaths.push(e.path);
              }
            }
            if (++done % 1000 === 0) opts.onProgress?.({ task: 'index', phase: `Reading ${folder.label}`, done, total: 0, current: e.path, found: done, expected });
            // Every folder being read waits during the pause, not only the one that reached it.
            if (opts.pause && done % 500 === 0 && !pausing) pausing = opts.pause().finally(() => { pausing = null; });
            if (pausing) await pausing;
          },
        });
      }
      const gone: string[] = [];
      if (!opts.signal?.aborted) {
        for (const p of [...this.files.keys()]) if (!seen.has(p)) { this.files.delete(p); gone.push(p); }
        for (const p of [...this.extras.keys()]) if (!seen.has(p)) this.extras.delete(p);
        for (const p of [...this.hashes.keys()]) if (!seen.has(p)) this.hashes.delete(p);
      }
      changed += gone.length;
      this.lastScan = Date.now();
      if (opts.sources !== false) await this.enrichSources(opts);
      // Nothing changed: nothing to write (a full read every half hour used to rewrite the whole file).
      // A few changes go to the journal; many, or no snapshot yet, make a new snapshot.
      if (!this.snapshotBytes || changed > SNAPSHOT_AFTER_CHANGES || !this.logFile) {
        this.touched = null;
        await this.save();
      } else {
        for (const p of changedPaths) {
          const f = this.files.get(p);
          if (f) this.note({ f: { ...f, text: undefined } }, p);
        }
        for (const p of gone) this.note({ d: p }, p);
        this.note({ s: this.lastScan });
        if (changed) await this.flushLog();
      }
      return { changed };
    } finally {
      this.scanning = false;
    }
  }

  /** Download sources for files that do not have one yet. */
  async enrichSources(opts: { signal?: AbortSignal; onProgress?: (p: Progress) => void; pause?: () => Promise<void> } = {}): Promise<void> {
    const read = this.hooks.readSource;
    if (!read && !this.hooks.readSources) return;
    const todo = [...this.files.values()].filter((f) => !f.source && !this.extras.get(f.path)?.source && this.extras.get(f.path)?.mtime !== f.mtime);
    if (this.hooks.readSources) return this.enrichInBatches(todo, this.hooks.readSources, opts);
    if (!read) return;
    let done = 0;
    const limit = 8;
    let i = 0;
    const next = async (): Promise<void> => {
      while (i < todo.length && !opts.signal?.aborted) {
        if (opts.pause && i % 50 === 0) await opts.pause();
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

  private async enrichInBatches(todo: FileEntry[], readMany: NonNullable<IndexHooks['readSources']>, opts: { signal?: AbortSignal; onProgress?: (p: Progress) => void; pause?: () => Promise<void> }): Promise<void> {
    // Each helper started costs the main process a few milliseconds: 500 files per helper.
    const BATCH = 500;
    for (let i = 0; i < todo.length && !opts.signal?.aborted; i += BATCH) {
      if (opts.pause) await opts.pause();
      const batch = todo.slice(i, i + BATCH);
      const found = await readMany(batch.map((f) => f.path)).catch(() => new Map<string, { source?: DownloadSource; tags?: string[] }>());
      for (const f of batch) {
        const o = found.get(f.path);
        this.setExtra(f, { source: o?.source });
        if (o?.source) f.source = o.source;
        // OS tags (macOS Finder) join Keeper's own tags the first time a file is seen.
        if (o?.tags?.length && !this.tags.has(f.path)) {
          const clean = [...new Set(o.tags.map((x) => x.trim().toLowerCase()).filter(Boolean))];
          if (clean.length) {
            this.tags.set(f.path, clean);
            f.tags = clean;
          }
        }
      }
      opts.onProgress?.({ task: 'index', phase: 'Looking up download sources', done: Math.min(i + BATCH, todo.length), total: todo.length });
    }
  }

  setExtra(f: FileEntry, patch: Partial<Persisted['extras'][string]>): void {
    const prev = this.extras.get(f.path);
    const base = prev && prev.mtime === f.mtime ? prev : { mtime: f.mtime };
    const next = { ...base, ...patch, mtime: f.mtime };
    this.extras.set(f.path, next);
    this.note({ x: [f.path, next] }, f.path);
  }

  setText(p: string, text: string): void {
    const f = this.files.get(p);
    if (!f) return;
    // Its own copy: text cut from a whole file would otherwise keep the whole file in memory.
    text = ownString(text);
    f.text = text;
    this.setExtra(f, { text });
  }

  setMeta(p: string, meta: MediaMeta): void {
    const f = this.files.get(p);
    if (!f) return;
    f.meta = { ...f.meta, ...meta };
    this.setExtra(f, { meta: f.meta });
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
    this.note({ t: [p, clean.length ? clean : null] }, p);
  }

  /** Updates one path after Keeper (or a watcher) saw it change. */
  async refresh(p: string): Promise<FileEntry | undefined> {
    try {
      const st = await fsp.lstat(p);
      if (st.isSymbolicLink()) return undefined;
      const e = this.makeEntry(p, st);
      if (this.hooks.readSource && !e.source) e.source = await this.hooks.readSource(p).catch(() => undefined);
      this.files.set(p, e);
      this.note({ f: { ...e, text: undefined } }, p);
      if (e.source) this.setExtra(e, { source: e.source });
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
    this.note({ d: p }, p);
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
    this.note({ d: from }, from);
    this.note({ t: [from, null] });
    const moved = this.files.get(to);
    if (moved) this.note({ f: { ...moved, text: undefined } }, to);
    this.note({ x: [to, x ?? null] });
    this.note({ t: [to, t ?? null] });
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
