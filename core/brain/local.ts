// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The brain over a library on this computer: the engine, its files on disk,
// and everything the harness and MCP need (reading files, listing folders,
// recent activity). Used by the app, and by `keeper mcp` / `keeper ask` when
// the app is closed.

import { existsSync, promises as fsp } from 'node:fs';
import { JsonChunks, writeChunksAtomic, writeChunksAtomicSync } from '../json-chunks';
import path from 'node:path';
import type { Brain, BrainHit, BrainSearchOptions, BrainStatus } from '../brain-contract';
import { findExactDuplicates } from '../duplicates';
import type { FileIndex } from '../indexer';
import type { FileEntry } from '../types';
import { BrainEngine, type Embedder } from './engine';
import { extractText } from './extract';
import { Harness, type HarnessEnv, type HarnessResult, type Visibility } from './harness';
// More AI services (Responses API, Gemini, Bedrock) register themselves.
import './adapters';
import type { ChatMessage, ChatProvider } from './providers';
import { VectorStore } from './vectors';

export interface LocalBrainOptions {
  index: () => FileIndex;
  /** folder for brain.json and vectors.bin */
  dir: string;
  excluded: () => string[];
  visibility: () => Visibility;
  /** the AI the person chose; null when none is ready */
  provider?: () => Promise<ChatProvider | null>;
  redactAlways?: () => boolean;
  home?: string;
  semantic?: () => BrainStatus['semantic'];
  semanticModel?: () => string | undefined;
  /** skills the assistant may use (names and descriptions up front, bodies on use) */
  skills?: () => HarnessEnv['skills'];
}

const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '');

export function toHit(f: FileEntry, score = 0, snippet?: string): BrainHit {
  return { path: f.path, name: f.name, kind: f.kind, size: f.size, mtime: f.mtime, score, snippet, source: f.source?.name, tags: f.tags?.length ? f.tags : undefined };
}

export class LocalBrain implements Brain {
  engine: BrainEngine;
  private saveTimer: NodeJS.Timeout | undefined;
  private dirty = false;

  constructor(private o: LocalBrainOptions) {
    this.engine = new BrainEngine({ getText: (f) => extractText(f), isExcluded: (p) => this.isExcluded(p) });
  }

  // ------------------------------------------------------------ files on disk

  private get jsonFile() { return path.join(this.o.dir, 'brain.json'); }
  private get vecFile() { return path.join(this.o.dir, 'vectors.bin'); }

  async load(): Promise<boolean> {
    try {
      const data = JSON.parse(await fsp.readFile(this.jsonFile, 'utf8'));
      this.engine.load(data);
      return true;
    } catch {
      return false;
    }
  }

  /** Saved vectors, when they were made by `modelId`. */
  async loadVectors(modelId: string): Promise<VectorStore | null> {
    try {
      const data = JSON.parse(await fsp.readFile(this.jsonFile, 'utf8')) as { model?: string };
      if (data.model !== modelId || !existsSync(this.vecFile)) return null;
      return VectorStore.fromBuffer(await fsp.readFile(this.vecFile));
    } catch {
      return null;
    }
  }

  async useEmbedder(e: Embedder | null): Promise<void> {
    const keep = e ? await this.loadVectors(e.id) : null;
    this.engine.useEmbedder(e, keep);
    if (!e) this.engine.vectors = null;
    this.markDirty();
  }

  markDirty(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = undefined; void this.save(); }, 20_000);
    this.saveTimer.unref?.();
  }

  private saving: Promise<void> | null = null;

  /** The brain's JSON, built piece by piece outside the JavaScript heap (one consistent picture). */
  private serialize(): Buffer[] {
    const out = new JsonChunks();
    this.engine.writeJSON(out);
    return out.done();
  }

  /** Saves what changed; never two saves at once (one asked for meanwhile follows the current one). */
  async save(): Promise<void> {
    if (this.saving) {
      await this.saving;
      if (this.saving) return this.saving;
    }
    if (!this.dirty) return;
    this.saving = (async () => {
      try {
        while (this.dirty) {
          this.dirty = false;
          const json = this.serialize();
          const vectors = this.engine.vectors?.toBuffer();
          await writeChunksAtomic(this.jsonFile, json, `${this.jsonFile}.${process.pid}.tmp`);
          if (vectors) await writeChunksAtomic(this.vecFile, [vectors], `${this.vecFile}.${process.pid}.tmp`);
        }
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  /** For quitting: writes straight away. */
  saveSync(): void {
    if (!this.dirty) return;
    this.dirty = false;
    writeChunksAtomicSync(this.jsonFile, this.serialize(), `${this.jsonFile}.${process.pid}.quit.tmp`);
    if (this.engine.vectors) writeChunksAtomicSync(this.vecFile, [this.engine.vectors.toBuffer()], `${this.vecFile}.${process.pid}.quit.tmp`);
  }

  async clear(): Promise<void> {
    await fsp.rm(this.jsonFile, { force: true });
    await fsp.rm(this.vecFile, { force: true });
    const e = this.engine.embedder;
    this.engine = new BrainEngine({ getText: (f) => extractText(f), isExcluded: (p) => this.isExcluded(p) });
    if (e) this.engine.useEmbedder(e);
  }

  // ------------------------------------------------------------ what may be seen

  isExcluded(p: string): boolean {
    const n = norm(p);
    return this.o.excluded().some((x) => { const e = norm(x); return n === e || n.startsWith(e + path.sep) || n.startsWith(e + '/'); });
  }

  /** Inside a library folder (or a file the library knows) and not excluded. */
  allowed(p: string): boolean {
    if (!p || this.isExcluded(p)) return false;
    const ix = this.o.index();
    if (ix.files.has(p)) return true;
    const n = norm(p);
    return ix.folders.some((f) => { const r = norm(f.path); return n === r || n.startsWith(r + path.sep) || n.startsWith(r + '/'); });
  }

  // ------------------------------------------------------------ Brain

  async sync(o: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<number> {
    const n = await this.engine.sync(this.o.index().files.values(), o);
    if (n) this.markDirty();
    return n;
  }

  status(): BrainStatus {
    return this.engine.status(this.o.index().files, this.o.semantic?.() ?? (this.engine.embedder ? 'ready' : 'off'), this.o.semanticModel?.());
  }

  search(o: BrainSearchOptions): Promise<BrainHit[]> {
    return this.engine.search(o, this.o.index().files);
  }

  async read(p: string, opts: { offset?: number; maxChars?: number } = {}): Promise<{ text: string; total: number; truncated: boolean }> {
    if (!this.allowed(p)) throw new Error('That file is outside the folders Keeper indexes, or it is excluded.');
    const f = this.o.index().files.get(p);
    const text = f ? (await this.engine.textOf(f)) ?? '' : '';
    const start = Math.max(0, opts.offset ?? 0);
    const max = Math.max(1, opts.maxChars ?? 20_000);
    return { text: text.slice(start, start + max), total: text.length, truncated: start + max < text.length };
  }

  harnessEnv(): HarnessEnv {
    const ix = () => this.o.index();
    const all = () => ix().all().filter((f) => !this.isExcluded(f.path));
    return {
      visibility: this.o.visibility(),
      skills: this.o.skills?.(),
      home: this.o.home,
      platform: process.platform,
      allowed: (p) => this.allowed(p),
      search: (q, o) => this.search({ query: q, limit: o.limit, kinds: o.kinds as BrainSearchOptions['kinds'], within: o.within, modifiedAfter: o.modifiedAfter, mode: o.mode }),
      read: (p, offset, maxChars) => this.read(p, { offset, maxChars }),
      listFolder: async (p, limit) => {
        const items = await fsp.readdir(p, { withFileTypes: true });
        const out = [];
        for (const d of items) {
          if (d.name.startsWith('.')) continue;
          const full = path.join(p, d.name);
          if (this.isExcluded(full)) continue;
          const st = await fsp.stat(full).catch(() => null);
          if (st) out.push({ name: d.name, path: full, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs });
          if (out.length >= limit) break;
        }
        return out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      },
      fileInfo: async (p) => {
        const f = ix().files.get(p);
        if (!f) return undefined;
        const b = this.engine.files.get(p);
        return {
          path: f.path, kind: f.kind, size: f.size, modified: new Date(f.mtime).toISOString(), created: new Date(f.btime || f.mtime).toISOString(),
          opened: f.atime ? new Date(f.atime).toISOString() : undefined, downloadedFrom: f.source ? `${f.source.name} (${f.source.host})` : undefined,
          tags: f.tags, ...f.meta, screenshot: f.screenshot || undefined, onlyInCloud: f.cloudOnly || undefined, passages: b?.chunks.length ?? 0,
        };
      },
      recent: async (what, days, limit) => {
        const since = Date.now() - days * 86_400_000;
        const pick = (f: FileEntry) => (what === 'opened' ? f.atime : what === 'downloaded' ? (f.source || f.root === 'Downloads' ? f.btime || f.mtime : 0) : f.mtime);
        return all().filter((f) => pick(f) >= since).sort((a, b) => pick(b) - pick(a)).slice(0, limit).map((f) => toHit(f, 1));
      },
      largest: async (limit) => [...all()].sort((a, b) => b.size - a.size).slice(0, limit).map((f) => toHit(f, 1)),
      duplicates: async (limit) => {
        const groups = await findExactDuplicates(all().filter((f) => f.size > 1024 * 1024 && !f.cloudOnly));
        return groups.sort((a, b) => b.reclaimable - a.reclaimable).slice(0, limit).map((g) => ({ size: g.files[0]?.size ?? 0, paths: g.files.map((f) => f.path) }));
      },
    };
  }

  /** One question to the person's AI, grounded in the brain. */
  async ask(question: string, opts: { signal?: AbortSignal; onDelta?: (t: string) => void; history?: ChatMessage[]; onStep?: (s: HarnessResult['trace'][number]) => void; extraTools?: HarnessEnv['extraTools']; maxRounds?: number } = {}): Promise<HarnessResult> {
    const provider = await this.o.provider?.();
    if (!provider) throw new Error('No AI is set up yet. Choose one in Settings → AI & Brain.');
    const env = opts.extraTools ? { ...this.harnessEnv(), extraTools: opts.extraTools } : this.harnessEnv();
    const h = new Harness(provider, env, { signal: opts.signal, onDelta: opts.onDelta, onStep: opts.onStep, redactAlways: this.o.redactAlways?.(), ...(opts.maxRounds ? { maxRounds: opts.maxRounds } : {}) });
    return h.ask(question, opts.history ?? []);
  }
}
