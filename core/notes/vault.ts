// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A vault's index: every file, every link, resolved the way vault tools
// resolve them (case-insensitive; exact path, then next to the note, then the
// shortest path with that name), backlinks, unresolved links, unlinked
// mentions, tags and the edits a rename needs. Updated one file at a time.

import { expandTag, normTag, parseNote, type NoteLink, type ParsedNote } from './parse';

export type LinkFormat = 'shortest' | 'relative' | 'absolute';

export interface VaultFile {
  /** vault-relative, forward slashes */
  path: string;
  mtime: number;
  ctime: number;
  size: number;
}

export interface IndexedNote extends VaultFile {
  text: string;
  note: ParsedNote;
}

export interface TextEdit { from: number; to: number; insert: string }
export interface FileEdits { path: string; edits: TextEdit[] }

export const NOTE_EXT = new Set(['md']);
export const isNote = (p: string) => extOf(p) === 'md';
export const extOf = (p: string) => { const b = baseOf(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
export const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
/** File name as shown: notes without .md. */
export const titleOf = (p: string) => (isNote(p) ? baseOf(p).slice(0, -3) : baseOf(p));
const linkKeyOfPath = (p: string) => (isNote(p) ? baseOf(p).slice(0, -3) : baseOf(p)).toLowerCase();

/** Normalises a/./b/../c and leading slashes. */
export function normPath(p: string): string {
  const out: string[] = [];
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export function relativePath(fromDir: string, to: string): string {
  const a = fromDir ? fromDir.split('/') : [];
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

const KNOWN_EXT = /\.(md|canvas|base|png|jpe?g|gif|bmp|svg|webp|avif|pdf|mp3|wav|m4a|ogg|3gp|flac|webm|mp4|mkv|mov|ogv)$/i;

export class VaultIndex {
  private files = new Map<string, VaultFile>();
  private notes = new Map<string, IndexedNote>();
  private byLower = new Map<string, string>();
  private byKey = new Map<string, Set<string>>();
  /** link key (lowercased last segment, no .md) → notes that link with that name */
  private linkers = new Map<string, Set<string>>();
  version = 0;

  get size() { return this.files.size; }
  allFiles(): VaultFile[] { return [...this.files.values()]; }
  allNotes(): IndexedNote[] { return [...this.notes.values()]; }
  has(path: string) { return this.files.has(path); }
  get(path: string): VaultFile | undefined { return this.files.get(path); }
  note(path: string): IndexedNote | undefined { return this.notes.get(path); }

  /** Adds or replaces a file. Notes need their text; other files only their stat. */
  set(file: VaultFile, text?: string) {
    this.remove(file.path, true);
    this.files.set(file.path, file);
    this.byLower.set(file.path.toLowerCase(), file.path);
    const k = linkKeyOfPath(file.path);
    if (!this.byKey.has(k)) this.byKey.set(k, new Set());
    this.byKey.get(k)!.add(file.path);
    if (isNote(file.path) && text != null) {
      const note = parseNote(text);
      this.notes.set(file.path, { ...file, text, note });
      for (const l of note.links) {
        const key = this.linkKey(l.target);
        if (!key) continue;
        if (!this.linkers.has(key)) this.linkers.set(key, new Set());
        this.linkers.get(key)!.add(file.path);
      }
    }
    this.version++;
  }

  remove(path: string, quiet = false) {
    const had = this.files.delete(path);
    this.byLower.delete(path.toLowerCase());
    this.byKey.get(linkKeyOfPath(path))?.delete(path);
    const n = this.notes.get(path);
    if (n) {
      for (const l of n.note.links) this.linkers.get(this.linkKey(l.target))?.delete(path);
      this.notes.delete(path);
    }
    if (had && !quiet) this.version++;
  }

  linkKey(target: string): string {
    if (!target) return '';
    const last = baseOf(normPath(target)).toLowerCase();
    return last.endsWith('.md') ? last.slice(0, -3) : last;
  }

  /** The file a link points to, or null when it does not exist (yet). */
  resolve(target: string, from: string): string | null {
    if (!target) return this.files.has(from) ? from : null;
    const raw = target.replace(/\\/g, '/');
    const tries = KNOWN_EXT.test(raw) ? [raw, `${raw}.md`] : [`${raw}.md`, raw];
    for (const t of tries) {
      // From the vault root (also "/Folder/Note").
      const abs = this.byLower.get(normPath(t).toLowerCase());
      if (abs) return abs;
      // Next to the linking note ("./x", "../x" and plain relative paths).
      const rel = this.byLower.get(normPath(`${dirOf(from)}/${t}`).toLowerCase());
      if (rel) return rel;
    }
    // Anywhere, by name: the one in the same folder, else the shortest path.
    const lp = normPath(raw).toLowerCase();
    const cands = [...(this.byKey.get(this.linkKey(raw)) ?? [])].filter((p) => {
      const l = p.toLowerCase();
      return l === lp || l === `${lp}.md` || l.endsWith(`/${lp}`) || l.endsWith(`/${lp}.md`);
    });
    if (!cands.length) return null;
    const here = dirOf(from).toLowerCase();
    const same = cands.find((p) => dirOf(p).toLowerCase() === here);
    if (same) return same;
    return cands.sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  }

  /** The name a new file may take for a link that does not resolve: "Folder/Note" → "Folder/Note.md". */
  pathForNewLink(target: string, newFolder = ''): string {
    const t = normPath(target);
    const withExt = KNOWN_EXT.test(t) ? t : `${t}.md`;
    return t.includes('/') ? withExt : normPath(`${newFolder}/${withExt}`) || withExt;
  }

  outgoing(path: string): { link: NoteLink; resolved: string | null }[] {
    const n = this.notes.get(path);
    if (!n) return [];
    return n.note.links.map((link) => ({ link, resolved: this.resolve(link.target, path) }));
  }

  /** Notes linking to a file, with each link (lazy: resolved against the current files). */
  backlinks(path: string): { source: string; links: NoteLink[] }[] {
    const out: { source: string; links: NoteLink[] }[] = [];
    const key = linkKeyOfPath(path);
    const sources = new Set(this.linkers.get(key) ?? []);
    for (const s of sources) {
      const n = this.notes.get(s);
      if (!n) continue;
      const links = n.note.links.filter((l) => l.target && this.linkKey(l.target) === key && this.resolve(l.target, s) === path);
      if (links.length) out.push({ source: s, links });
    }
    // Links to a heading of the same note ("[[#Heading]]") are not backlinks.
    return out.sort((a, b) => a.source.localeCompare(b.source));
  }

  /** Links that point at nothing, grouped by what they name. */
  unresolved(): Map<string, { source: string; link: NoteLink }[]> {
    const out = new Map<string, { source: string; link: NoteLink }[]>();
    for (const n of this.notes.values()) {
      for (const l of n.note.links) {
        if (!l.target || this.resolve(l.target, n.path)) continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(l.target)) continue;
        const k = l.target;
        if (!out.has(k)) out.set(k, []);
        out.get(k)!.push({ source: n.path, link: l });
      }
    }
    return out;
  }

  /** Places that mention a note's name (or an alias) as plain text, without linking to it. */
  unlinkedMentions(path: string, limit = 200): { source: string; line: number; text: string; from: number; to: number }[] {
    const target = this.notes.get(path);
    const names = [titleOf(path), ...(target?.note.aliases ?? [])].filter((s) => s.trim().length >= 2);
    if (!names.length) return [];
    const esc = names.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${esc.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
    const out: { source: string; line: number; text: string; from: number; to: number }[] = [];
    for (const n of this.notes.values()) {
      if (n.path === path) continue;
      const covered = n.note.links.map((l) => [l.from, l.to] as const);
      let m: RegExpExecArray | null;
      re.lastIndex = n.note.bodyStart;
      while ((m = re.exec(n.text))) {
        const at = m.index;
        if (covered.some(([a, b]) => at >= a && at < b)) continue;
        const ls = n.text.lastIndexOf('\n', at - 1) + 1;
        const le = n.text.indexOf('\n', at);
        const line = n.text.slice(0, at).split('\n').length - 1;
        out.push({ source: n.path, line, text: n.text.slice(ls, le < 0 ? undefined : le), from: at, to: at + m[0].length });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  /** Every tag with how many notes use it, nested tags counted for their parents too. */
  tags(): { tag: string; count: number }[] {
    const counts = new Map<string, { tag: string; notes: Set<string> }>();
    for (const n of this.notes.values()) {
      for (const t of n.note.tags) {
        const parts = t.tag.split('/').filter(Boolean);
        expandTag(t.tag).forEach((k, i) => {
          if (!counts.has(k)) counts.set(k, { tag: parts.slice(0, i + 1).join('/'), notes: new Set() });
          counts.get(k)!.notes.add(n.path);
        });
      }
    }
    return [...counts.values()].map((c) => ({ tag: c.tag, count: c.notes.size })).sort((a, b) => a.tag.localeCompare(b.tag));
  }

  notesWithTag(tag: string): string[] {
    const want = normTag(tag);
    return [...this.notes.values()].filter((n) => n.note.tags.some((t) => expandTag(t.tag).includes(want))).map((n) => n.path);
  }

  /** The text a link to `target` written in `from` should have. */
  linkText(target: string, from: string, format: LinkFormat, kind: 'wiki' | 'markdown'): string {
    const note = isNote(target);
    const strip = (p: string) => (kind === 'wiki' && note ? p.slice(0, -3) : p);
    let p: string;
    if (format === 'relative') p = relativePath(dirOf(from), target);
    else if (format === 'absolute') p = target;
    else {
      const key = linkKeyOfPath(target);
      const unique = (this.byKey.get(key)?.size ?? 0) <= 1;
      p = unique ? baseOf(target) : target;
    }
    p = strip(p);
    return kind === 'markdown' ? encodeURI(p).replace(/\(/g, '%28').replace(/\)/g, '%29') : p;
  }

  /**
   * Renames (or moves) files and returns the edits every linking note needs,
   * computed against the vault as it is before the rename. Apply the edits,
   * then call applyRename so the index matches the disk.
   */
  renameEdits(moves: { from: string; to: string }[], format: LinkFormat = 'shortest'): FileEdits[] {
    const map = new Map(moves.map((m) => [m.from, m.to]));
    const before = new Map<string, { link: NoteLink; target: string }[]>();
    // Every link that points at a moved file, and every relative link inside a moved note.
    const sources = new Set<string>();
    for (const m of moves) {
      for (const s of this.linkers.get(linkKeyOfPath(m.from)) ?? []) sources.add(s);
      if (this.notes.has(m.from)) sources.add(m.from);
    }
    for (const s of sources) {
      const n = this.notes.get(s);
      if (!n) continue;
      const list: { link: NoteLink; target: string }[] = [];
      for (const l of n.note.links) {
        if (!l.target) continue;
        const r = this.resolve(l.target, s);
        if (r && (map.has(r) || (map.has(s) && l.kind === 'markdown' && !l.target.startsWith('/') && dirOf(map.get(s)!) !== dirOf(s)))) list.push({ link: l, target: r });
      }
      if (list.length) before.set(s, list);
    }
    // A shadow index with the new names, for "shortest" link text.
    const after = new VaultIndex();
    for (const f of this.files.values()) after.files.set(map.get(f.path) ?? f.path, f);
    for (const p of after.files.keys()) {
      after.byLower.set(p.toLowerCase(), p);
      const k = linkKeyOfPath(p);
      if (!after.byKey.has(k)) after.byKey.set(k, new Set());
      after.byKey.get(k)!.add(p);
    }
    const out: FileEdits[] = [];
    for (const [s, list] of before) {
      const newSource = map.get(s) ?? s;
      const text = this.notes.get(s)!.text;
      const edits: TextEdit[] = [];
      for (const { link, target } of list) {
        const newTarget = map.get(target) ?? target;
        const wasPath = link.target.includes('/');
        const fmt: LinkFormat = link.kind === 'markdown' && !link.target.startsWith('/') && format === 'shortest' && wasPath ? 'relative' : format;
        let t = after.linkText(newTarget, newSource, fmt, link.kind);
        // Keep the link the way it was written when it still works (no churn).
        if (after.resolve(link.target, newSource) === newTarget && (link.kind === 'wiki' || !map.has(s))) continue;
        if (link.kind === 'markdown' && link.target.startsWith('/')) t = `/${encodeURI(newTarget).replace(/\(/g, '%28').replace(/\)/g, '%29')}`;
        const raw = text.slice(link.from, link.to);
        edits.push({ from: link.from, to: link.to, insert: rewriteLink(raw, link, t) });
      }
      if (edits.length) out.push({ path: newSource, edits });
    }
    return out;
  }

  /** Moves the files in the index (after the disk was changed). */
  applyRename(moves: { from: string; to: string }[], texts: Map<string, string>) {
    for (const m of moves) {
      const f = this.files.get(m.from);
      if (!f) continue;
      const n = this.notes.get(m.from);
      this.remove(m.from);
      this.set({ ...f, path: m.to }, texts.get(m.to) ?? n?.text);
    }
    for (const [p, t] of texts) {
      const f = this.files.get(p);
      if (f) this.set(f, t);
    }
  }

  /** Graph data: notes (and attachments that are linked), with resolved and unresolved edges. */
  graph(opts: { attachments?: boolean; unresolved?: boolean; folder?: string } = {}) {
    const nodes = new Map<string, { id: string; label: string; kind: 'note' | 'file' | 'missing'; tags: string[]; degree: number }>();
    const edges: { from: string; to: string }[] = [];
    const inFolder = (p: string) => !opts.folder || p === opts.folder || p.startsWith(`${opts.folder}/`);
    for (const n of this.notes.values()) {
      if (!inFolder(n.path)) continue;
      nodes.set(n.path, { id: n.path, label: titleOf(n.path), kind: 'note', tags: n.note.tags.map((t) => t.tag), degree: 0 });
    }
    for (const n of this.notes.values()) {
      if (!inFolder(n.path)) continue;
      const seen = new Set<string>();
      for (const l of n.note.links) {
        if (!l.target) continue;
        const r = this.resolve(l.target, n.path);
        let id: string;
        if (r) {
          if (!isNote(r)) {
            if (!opts.attachments) continue;
            if (!nodes.has(r)) nodes.set(r, { id: r, label: baseOf(r), kind: 'file', tags: [], degree: 0 });
          } else if (!nodes.has(r)) continue;
          id = r;
        } else {
          if (!opts.unresolved) continue;
          id = `missing:${l.target}`;
          if (!nodes.has(id)) nodes.set(id, { id, label: l.target, kind: 'missing', tags: [], degree: 0 });
        }
        if (id === n.path || seen.has(id)) continue;
        seen.add(id);
        edges.push({ from: n.path, to: id });
        nodes.get(n.path)!.degree++;
        nodes.get(id)!.degree++;
      }
    }
    return { nodes: [...nodes.values()], edges };
  }

  /** Notes around one note, `depth` links away in either direction. */
  localGraph(path: string, depth = 1, opts: { attachments?: boolean; unresolved?: boolean } = {}) {
    const g = this.graph(opts);
    const adj = new Map<string, Set<string>>();
    for (const e of g.edges) {
      if (!adj.has(e.from)) adj.set(e.from, new Set());
      if (!adj.has(e.to)) adj.set(e.to, new Set());
      adj.get(e.from)!.add(e.to);
      adj.get(e.to)!.add(e.from);
    }
    const keep = new Set([path]);
    let frontier = [path];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const p of frontier) for (const q of adj.get(p) ?? []) if (!keep.has(q)) { keep.add(q); next.push(q); }
      frontier = next;
    }
    return { nodes: g.nodes.filter((n) => keep.has(n.id)), edges: g.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
  }

  /** Link suggestions while typing [[: notes, aliases, then other files; best first. */
  suggest(query: string, limit = 50): { path: string; display: string; alias?: string; score: number }[] {
    const q = query.toLowerCase().trim();
    const out: { path: string; display: string; alias?: string; score: number }[] = [];
    const score = (s: string) => {
      const l = s.toLowerCase();
      if (!q) return 1;
      if (l === q) return 100;
      if (l.startsWith(q)) return 80 - Math.min(20, l.length - q.length);
      const i = l.indexOf(q);
      if (i >= 0) return 60 - Math.min(30, i);
      return fuzzy(l, q);
    };
    for (const f of this.files.values()) {
      const t = titleOf(f.path);
      const s = Math.max(score(t), score(f.path) - 10);
      if (s > 0) out.push({ path: f.path, display: t, score: s + (isNote(f.path) ? 5 : 0) });
      for (const a of this.notes.get(f.path)?.note.aliases ?? []) {
        const sa = score(a);
        if (sa > 0) out.push({ path: f.path, display: a, alias: a, score: sa + 4 });
      }
    }
    return out.sort((a, b) => b.score - a.score || a.display.localeCompare(b.display)).slice(0, limit);
  }
}

/** Subsequence match score (letters in order), 0 when they are not all there. */
export function fuzzy(s: string, q: string): number {
  let i = 0, gaps = 0, last = -1;
  for (const c of q) {
    const j = s.indexOf(c, i);
    if (j < 0) return 0;
    if (last >= 0) gaps += j - last - 1;
    last = j;
    i = j + 1;
  }
  return Math.max(1, 40 - gaps);
}

/** Rewrites the target part of a link and keeps its #subpath, |alias and embed mark. */
export function rewriteLink(raw: string, link: NoteLink, target: string): string {
  const sub = link.subpath ? `#${link.subpath}` : '';
  if (link.kind === 'wiki') {
    const alias = link.alias != null ? `|${link.alias}` : '';
    return `${link.embed ? '!' : ''}[[${target}${sub}${alias}]]`;
  }
  const m = /^(!?)\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)$/.exec(raw);
  if (!m) return raw;
  const angle = m[3].startsWith('<');
  const subEnc = link.subpath ? `#${angle ? link.subpath : encodeURI(link.subpath)}` : '';
  const dest = angle ? `<${decodeURI(target)}${subEnc}>` : `${target}${subEnc}`;
  return `${m[1]}[${m[2]}](${dest}${m[4] ?? ''})`;
}

export function applyEdits(text: string, edits: TextEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}
