// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The hub folder on disk: notes as Markdown files, Keeper's bookkeeping in
// .keeper-notes (sync bases, the notes trash, conflicts, history, snapshots),
// attachments stored once by hash.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { diffManifests, needsSnapshot, pruneSnapshots, snapshotId, type SnapshotManifest } from '../../../core/notes-sync/backup';
import { ATTACH_DIR, attachmentPath, docOf, freeHubPath, hubPathFor, newKeeperId, parseHubNote, serializeHubNote, sha256Hex, STATE_DIR, textHash } from '../../../core/notes-sync/hub';
import type { ConflictEntry, HistoryEntry, HubNote, SourceLink } from '../../../core/notes-sync/types';

const SKIP_DIRS = new Set([STATE_DIR, ATTACH_DIR, '.obsidian', '.trash', '.git', '.keeper-versions', '.keeper-sync', 'node_modules', '.logseq']);

export interface TrashEntry {
  id: string;
  keeperId: string;
  title: string;
  at: number;
  why: string;
  /** where it was in the hub */
  rel: string;
  /** the trashed file inside .keeper-notes/trash */
  file: string;
  sources: SourceLink[];
  /** where it lived, for display (links to apps that deleted it are dropped) */
  apps?: string[];
}

async function writeAtomic(file: string, data: string | Uint8Array) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

async function readJson<T>(file: string, d: T): Promise<T> {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')) as T; } catch { return d; }
}

export class HubStore {
  readonly state: string;
  private cache = new Map<string, { mtime: number; size: number; note: HubNote }>();
  notes = new Map<string, HubNote>();
  /** notes Keeper knew about that are gone from the folder (deleted by hand) */
  vanished: HubNote[] = [];
  private scannedAt = 0;
  private known: Record<string, { rel: string; title: string; sources: SourceLink[] }> | null = null;

  constructor(readonly root: string) {
    this.state = path.join(root, STATE_DIR);
  }

  private abs(rel: string) { return path.join(this.root, ...rel.split('/')); }

  async ensure() {
    await fsp.mkdir(this.state, { recursive: true });
  }

  /** Reads changed files; gives notes written by hand a keeper id. */
  async scan(maxAgeMs = 0): Promise<HubNote[]> {
    if (maxAgeMs && Date.now() - this.scannedAt < maxAgeMs) return [...this.notes.values()];
    await this.ensure();
    const seen = new Set<string>();
    const walk = async (dir: string, rel: string) => {
      const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of ents) {
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
          await walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
        } else if (e.isFile() && /\.md$/i.test(e.name) && !e.name.startsWith('.')) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          seen.add(r);
          const st = await fsp.stat(path.join(dir, e.name)).catch(() => null);
          if (!st) continue;
          const c = this.cache.get(r);
          if (c && c.mtime === st.mtimeMs && c.size === st.size) continue;
          const text = await fsp.readFile(path.join(dir, e.name), 'utf8').catch(() => null);
          if (text === null) continue;
          let note = parseHubNote(text, r, st.mtimeMs);
          if (!note.keeperId) {
            note = { ...note, keeperId: newKeeperId(), modified: st.mtimeMs };
            await this.writeFile(note);
            continue;
          }
          this.cache.set(r, { mtime: st.mtimeMs, size: st.size, note });
        }
      }
    };
    await walk(this.root, '');
    for (const r of [...this.cache.keys()]) if (!seen.has(r)) this.cache.delete(r);
    this.notes = new Map();
    for (const { note } of this.cache.values()) {
      // Two files with the same id (a copy made by hand): the copy gets a new id.
      if (this.notes.has(note.keeperId)) {
        const fresh = { ...note, keeperId: newKeeperId(), sources: [] };
        await this.writeFile(fresh);
        this.notes.set(fresh.keeperId, fresh);
        continue;
      }
      this.notes.set(note.keeperId, note);
    }
    await this.trackVanished();
    this.scannedAt = Date.now();
    return [...this.notes.values()];
  }

  private async trackVanished() {
    this.known ??= await readJson(path.join(this.state, 'index.json'), {} as Record<string, { rel: string; title: string; sources: SourceLink[] }>);
    const trashed = new Set((await this.trashList()).map((t) => t.keeperId));
    const next: typeof this.known = {};
    const vanished: HubNote[] = [];
    for (const [id, k] of Object.entries(this.known)) {
      if (this.notes.has(id) || trashed.has(id) || !k.sources.length) continue;
      vanished.push({ keeperId: id, title: k.title, body: '', tags: [], created: 0, modified: 0, sources: k.sources, rel: k.rel });
      next[id] = k;
    }
    for (const n of this.notes.values()) next[n.keeperId] = { rel: n.rel ?? '', title: n.title, sources: n.sources };
    this.vanished = vanished;
    const before = JSON.stringify(this.known);
    this.known = next;
    if (JSON.stringify(next) !== before) await writeAtomic(path.join(this.state, 'index.json'), JSON.stringify(next));
  }

  /** Forget a vanished note's link to one app (after the app's copy was handled). */
  async forgetVanished(keeperId: string, connector?: string) {
    if (!this.known?.[keeperId]) return;
    const k = this.known[keeperId];
    k.sources = connector ? k.sources.filter((s) => s.connector !== connector) : [];
    if (!k.sources.length) delete this.known[keeperId];
    await writeAtomic(path.join(this.state, 'index.json'), JSON.stringify(this.known));
  }

  private async writeFile(n: HubNote) {
    const rel = n.rel!;
    await writeAtomic(this.abs(rel), serializeHubNote(n));
    const st = await fsp.stat(this.abs(rel));
    this.cache.set(rel, { mtime: st.mtimeMs, size: st.size, note: { ...n, rel } });
    this.notes.set(n.keeperId, { ...n, rel });
    if (this.known) this.known[n.keeperId] = { rel, title: n.title, sources: n.sources };
  }

  private taken = (rel: string) => this.cache.has(rel) || [...this.notes.values()].some((n) => n.rel?.toLowerCase() === rel.toLowerCase());

  /** Saves a note; a new one goes to "<app folder>/<notebook>/<title>.md". */
  async write(n: HubNote, place?: { appFolder: string; folder?: string }): Promise<HubNote> {
    const old = this.notes.get(n.keeperId);
    let rel = n.rel ?? old?.rel;
    if (!rel) rel = freeHubPath(hubPathFor(place?.appFolder ?? 'Inbox', place?.folder, n.title), this.taken);
    const out = { ...n, rel };
    await this.writeFile(out);
    return out;
  }

  get(id: string) { return this.notes.get(id); }

  // ---------------------------------------------------------------- sync bases

  private bases = new Map<string, string>();

  /** Keeps the text a note had when it was last in step with an app. */
  async putBase(title: string, body: string): Promise<string> {
    const doc = docOf(title, body);
    const h = textHash(title, body);
    if (this.bases.has(h)) return h;
    const f = path.join(this.state, 'base', h.slice(0, 2), `${h}.txt`);
    await fsp.access(f).catch(() => writeAtomic(f, doc));
    this.bases.set(h, doc);
    return h;
  }

  async loadBases(hashes: Iterable<string>) {
    for (const h of hashes) {
      if (!h || this.bases.has(h) || !/^[0-9a-f]{8,64}$/.test(h)) continue;
      const t = await fsp.readFile(path.join(this.state, 'base', h.slice(0, 2), `${h}.txt`), 'utf8').catch(() => null);
      if (t !== null) this.bases.set(h, t);
    }
  }

  base = (h: string) => this.bases.get(h);

  // ---------------------------------------------------------------- attachments

  async storeAttachment(data: Uint8Array, name: string): Promise<{ hash: string; rel: string }> {
    const hash = sha256Hex(data);
    const rel = attachmentPath(hash, name);
    const f = this.abs(rel);
    await fsp.access(f).catch(() => writeAtomic(f, data));
    return { hash, rel };
  }

  async readAttachment(hash: string, name: string): Promise<Uint8Array | null> {
    return fsp.readFile(this.abs(attachmentPath(hash, name))).catch(() => null);
  }

  // ---------------------------------------------------------------- the notes trash

  async trashList(): Promise<TrashEntry[]> {
    return readJson(path.join(this.state, 'trash.json'), [] as TrashEntry[]);
  }

  async moveToTrash(n: HubNote, why: string, apps?: string[]): Promise<void> {
    const list = await this.trashList();
    const id = `t-${Date.now().toString(36)}-${n.keeperId.slice(2, 8)}`;
    const file = `trash/${id}.md`;
    await writeAtomic(path.join(this.state, file), serializeHubNote(n));
    if (n.rel) {
      await fsp.rm(this.abs(n.rel), { force: true });
      this.cache.delete(n.rel);
    }
    this.notes.delete(n.keeperId);
    if (this.known) delete this.known[n.keeperId];
    list.unshift({ id, keeperId: n.keeperId, title: n.title, at: Date.now(), why, rel: n.rel ?? '', file, sources: n.sources, apps: apps ?? n.sources.map((s) => s.app) });
    await writeAtomic(path.join(this.state, 'trash.json'), JSON.stringify(list.slice(0, 5000)));
  }

  async trashNote(id: string): Promise<HubNote | null> {
    const t = (await this.trashList()).find((x) => x.id === id);
    if (!t) return null;
    const text = await fsp.readFile(path.join(this.state, t.file), 'utf8').catch(() => null);
    return text === null ? null : parseHubNote(text, t.rel);
  }

  async updateTrash(fn: (l: TrashEntry[]) => TrashEntry[]) {
    await writeAtomic(path.join(this.state, 'trash.json'), JSON.stringify(fn(await this.trashList())));
  }

  async restore(id: string): Promise<HubNote | null> {
    const t = (await this.trashList()).find((x) => x.id === id);
    if (!t) return null;
    const n = await this.trashNote(id);
    if (!n) return null;
    const rel = freeHubPath(t.rel || `Inbox/${n.title}.md`, this.taken);
    const out = await this.write({ ...n, rel, keeperId: this.notes.has(n.keeperId) ? newKeeperId() : n.keeperId });
    await fsp.rm(path.join(this.state, t.file), { force: true });
    await this.updateTrash((l) => l.filter((x) => x.id !== id));
    return out;
  }

  // ---------------------------------------------------------------- conflicts, history

  async conflicts(): Promise<ConflictEntry[]> {
    return readJson(path.join(this.state, 'conflicts.json'), [] as ConflictEntry[]);
  }

  async saveConflicts(list: ConflictEntry[]) {
    await writeAtomic(path.join(this.state, 'conflicts.json'), JSON.stringify(list, null, 1));
  }

  async log(entries: HistoryEntry[]) {
    if (!entries.length) return;
    await this.ensure();
    await fsp.appendFile(path.join(this.state, 'history.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }

  async history(keeperId?: string, limit = 300): Promise<HistoryEntry[]> {
    const text = await fsp.readFile(path.join(this.state, 'history.jsonl'), 'utf8').catch(() => '');
    const out: HistoryEntry[] = [];
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      if (!lines[i]) continue;
      try {
        const e = JSON.parse(lines[i]) as HistoryEntry;
        if (!keeperId || e.keeperId === keeperId) out.push(e);
      } catch { /* a torn line */ }
    }
    return out;
  }

  // ---------------------------------------------------------------- snapshots

  private snapDir() { return path.join(this.state, 'snapshots'); }

  async manifests(): Promise<SnapshotManifest[]> {
    const dir = this.snapDir();
    const names = (await fsp.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.json')).sort();
    const out: SnapshotManifest[] = [];
    for (const n of names) { const m = await readJson<SnapshotManifest | null>(path.join(dir, n), null); if (m) out.push(m); }
    return out;
  }

  /** Every note and attachment file with its content hash. */
  private async currentFiles(): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const walk = async (dir: string, rel: string) => {
      for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory()) {
          if ((SKIP_DIRS.has(e.name) && e.name !== ATTACH_DIR) || e.name.startsWith('.')) continue;
          await walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
        } else if (e.isFile()) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (r.startsWith(`${ATTACH_DIR}/`)) { files[r] = e.name.replace(/\.[^.]*$/, ''); continue; }
          if (!/\.md$/i.test(e.name)) continue;
          files[r] = sha256Hex(await fsp.readFile(path.join(dir, e.name)));
        }
      }
    };
    await walk(this.root, '');
    return files;
  }

  /** A snapshot of the hub, if anything changed since the last one. Contents are stored once. */
  async snapshot(label?: string, force = false): Promise<SnapshotManifest | null> {
    const files = await this.currentFiles();
    const all = await this.manifests();
    if (!force && !needsSnapshot(all[all.length - 1], files)) return null;
    for (const [rel, h] of Object.entries(files)) {
      if (rel.startsWith(`${ATTACH_DIR}/`)) continue; // attachments never change: their name is their hash
      const obj = path.join(this.snapDir(), 'objects', h.slice(0, 2), h);
      await fsp.access(obj).catch(async () => writeAtomic(obj, await fsp.readFile(this.abs(rel))));
    }
    const time = Date.now();
    const m: SnapshotManifest = { id: snapshotId(time), time, label, files };
    await writeAtomic(path.join(this.snapDir(), `${m.id}.json`), JSON.stringify(m));
    const { drop, orphans } = pruneSnapshots([...all, m]);
    for (const id of drop) await fsp.rm(path.join(this.snapDir(), `${id}.json`), { force: true });
    if (drop.length) {
      const objDir = path.join(this.snapDir(), 'objects');
      const have: string[] = [];
      for (const d of await fsp.readdir(objDir).catch(() => [] as string[])) for (const f of await fsp.readdir(path.join(objDir, d)).catch(() => [] as string[])) have.push(f);
      for (const h of orphans(have)) await fsp.rm(path.join(objDir, h.slice(0, 2), h), { force: true });
    }
    return m;
  }

  summarize(all: SnapshotManifest[]) {
    return all.map((m, i) => ({ id: m.id, time: m.time, label: m.label, files: Object.keys(m.files).length, ...((d) => ({ added: d.added.length, changed: d.changed.length, removed: d.removed.length }))(diffManifests(all[i - 1], m)) })).reverse();
  }

  /** Puts files back as they were in a snapshot (the current state is snapshotted first). */
  async restoreSnapshot(id: string, only?: string[]): Promise<number> {
    const m = (await this.manifests()).find((x) => x.id === id);
    if (!m) throw new Error('That snapshot is gone');
    await this.snapshot('Before restoring', false);
    let n = 0;
    for (const [rel, h] of Object.entries(m.files)) {
      if (rel.startsWith(`${ATTACH_DIR}/`)) continue;
      if (only?.length && !only.includes(rel)) continue;
      const data = await fsp.readFile(path.join(this.snapDir(), 'objects', h.slice(0, 2), h)).catch(() => null);
      if (!data) continue;
      await writeAtomic(this.abs(rel), data);
      this.cache.delete(rel);
      n++;
    }
    this.scannedAt = 0;
    return n;
  }
}
