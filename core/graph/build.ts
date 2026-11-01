// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The knowledge graph: files, folders, tags, people, organisations and where
// things came from, linked the way they relate — Markdown and wiki links
// ([[Note]]) with their backlinks, shared tags, shared names mentioned inside,
// the same download source, the same folder, and similar meaning when Keeper's
// meaning search is on. Pure: the app hands in what the library knows.

export type NodeType = 'file' | 'folder' | 'tag' | 'entity' | 'source';
export type EdgeType = 'link' | 'tag' | 'entity' | 'source' | 'folder' | 'similar';

export interface GraphFile {
  path: string;
  name: string;
  kind: string;
  mtime: number;
  tags?: string[];
  source?: string;
  /** text inside (notes, documents, read from images); only the start is needed */
  text?: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  kind?: string;
  path?: string;
  degree: number;
  mtime?: number;
}

export interface GraphEdge {
  a: string;
  b: string;
  type: EdgeType;
  w: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** files left out to keep the graph fast */
  truncated: number;
}

export interface GraphOptions {
  maxFiles?: number;
  folders?: boolean;
  entities?: boolean;
  /** nearest files by meaning, when the brain has vectors */
  similar?: (path: string) => { path: string; score: number }[];
  /** only files whose path starts with one of these */
  within?: string[];
  kinds?: string[];
  after?: number;
}

const SEP = /[\\/]/;
const baseName = (p: string) => p.split(SEP).pop() ?? p;
const stem = (n: string) => n.replace(/\.[^.]+$/, '');
const dirName = (p: string) => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
};

/** [[Target]], [[Target|alias]], [[Target#heading]] and [text](relative.md) links in a note. */
export function extractLinks(text: string): { wiki: string[]; md: string[] } {
  const wiki = [...text.matchAll(/!?\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g)].map((m) => m[1].trim()).filter(Boolean);
  const md = [...text.matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => decodeURIComponent(m[1].split('#')[0])).filter((u) => u && !/^[a-z][a-z0-9+.-]*:/i.test(u));
  return { wiki, md };
}

/** #tags written inside notes (not headings, not colours). */
export function extractHashTags(text: string): string[] {
  return [...new Set([...text.matchAll(/(?:^|\s)#([A-Za-zÀ-ɏ][\w/-]{1,40})/g)].map((m) => m[1].toLowerCase()))];
}

const ORG_SUFFIX = /\b([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3})\s+(Inc|Inc\.|Ltd|Ltd\.|LLC|GmbH|OÜ|AG|SA|S\.A\.|BV|AB|Oy|Corp|Corp\.|Corporation|Company|Limited|PLC)\b/g;
const STOP = new Set(['The', 'This', 'That', 'These', 'Those', 'And', 'But', 'For', 'With', 'From', 'Dear', 'Hello', 'Thanks', 'Thank', 'Best', 'Kind', 'Regards', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'Page', 'Total', 'Invoice', 'Date', 'Note', 'Notes', 'Table', 'Figure', 'Chapter', 'Section', 'Summary', 'Introduction', 'Please', 'If', 'When', 'Where', 'What', 'How', 'Why', 'New', 'Read', 'See', 'All', 'Our', 'Your', 'My', 'We', 'You', 'It', 'In', 'On', 'At', 'To', 'Of', 'A', 'An', 'Mr', 'Mrs', 'Ms', 'Dr']);

/** People, organisations and e-mail addresses named in a text (light heuristics, no AI). */
export function extractEntities(text: string, max = 15): string[] {
  const t = text.slice(0, 20_000);
  const found = new Map<string, number>();
  const add = (s: string) => found.set(s, (found.get(s) ?? 0) + 1);
  for (const m of t.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) add(m[0].toLowerCase());
  for (const m of t.matchAll(ORG_SUFFIX)) add(`${m[1]} ${m[2].replace(/\.$/, '')}`);
  // Two or three capitalised words in a row, not starting a sentence with a common word.
  for (const m of t.matchAll(/\b([A-Z][a-zà-ɏ]+(?:[ -][A-Z][a-zà-ɏ]+){1,2})\b/g)) {
    let words = m[1].split(/[ -]/);
    // "Ask Lena Fischer." — a capitalised word that only starts the sentence is not part of the name.
    const at = m.index ?? 0;
    if (words.length === 3 && (at === 0 || /[.!?:\n]\s*$/.test(t.slice(Math.max(0, at - 3), at)))) words = words.slice(1);
    if (words.some((w) => STOP.has(w))) continue;
    add(words.join(' '));
  }
  // "Acme Property" is the start of "Acme Property GmbH": keep only the full name.
  const names = [...found.keys()];
  for (const n of names) if (names.some((o) => o !== n && o.startsWith(n + ' '))) found.delete(n);
  return [...found.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
}

export function buildGraph(files: GraphFile[], opts: GraphOptions = {}): Graph {
  const max = opts.maxFiles ?? 3000;
  let pool = files;
  if (opts.within?.length) pool = pool.filter((f) => opts.within!.some((w) => f.path === w || f.path.startsWith(w.replace(/[\\/]+$/, '') + '/') || f.path.startsWith(w.replace(/[\\/]+$/, '') + '\\')));
  if (opts.kinds?.length) pool = pool.filter((f) => opts.kinds!.includes(f.kind) || (opts.kinds!.includes('note') && /\.(md|markdown)$/i.test(f.name)));
  if (opts.after) pool = pool.filter((f) => f.mtime >= opts.after!);
  // Notes and files with text first (they carry the links), then the newest.
  const ranked = [...pool].sort((a, b) => Number(/\.(md|markdown)$/i.test(b.name)) - Number(/\.(md|markdown)$/i.test(a.name)) || Number(!!b.text) - Number(!!a.text) || b.mtime - a.mtime);
  const chosen = ranked.slice(0, max);
  const truncated = pool.length - chosen.length;

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const node = (id: string, n: Omit<GraphNode, 'id' | 'degree'>) => {
    if (!nodes.has(id)) nodes.set(id, { id, degree: 0, ...n });
    return id;
  };
  const edge = (a: string, b: string, type: EdgeType, w = 1) => {
    if (a === b) return;
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${x}\u0000${y}\u0000${type}`;
    const e = edges.get(key);
    if (e) e.w += w;
    else edges.set(key, { a: x, b: y, type, w });
  };

  const byStem = new Map<string, string>();
  const byPath = new Map<string, string>();
  for (const f of chosen) {
    const id = `f:${f.path}`;
    node(id, { label: f.name, type: 'file', kind: /\.(md|markdown)$/i.test(f.name) ? 'note' : f.kind, path: f.path, mtime: f.mtime });
    byPath.set(f.path.replace(/\\/g, '/').toLowerCase(), id);
    const s = stem(f.name).toLowerCase();
    if (!byStem.has(s)) byStem.set(s, id);
  }

  const entityFiles = new Map<string, string[]>();
  for (const f of chosen) {
    const id = `f:${f.path}`;
    const text = f.text ?? '';
    // Links between notes, both ways (the graph is undirected; backlinks come free).
    if (text) {
      const { wiki, md } = extractLinks(text);
      for (const w of wiki) {
        const target = byStem.get(stem(baseName(w)).toLowerCase());
        if (target) edge(id, target, 'link', 2);
      }
      for (const m of md) {
        const abs = (dirName(f.path).replace(/\\/g, '/') + '/' + m).split('/').reduce<string[]>((acc, part) => (part === '..' ? acc.slice(0, -1) : part === '.' || part === '' ? acc : [...acc, part]), []).join('/');
        const target = byPath.get(('/' + abs).toLowerCase()) ?? byPath.get(abs.toLowerCase());
        if (target) edge(id, target, 'link', 2);
      }
    }
    const tags = new Set([...(f.tags ?? []).map((t) => t.toLowerCase()), ...(text && /\.(md|markdown|txt)$/i.test(f.name) ? extractHashTags(text) : [])]);
    for (const t of tags) edge(id, node(`t:${t}`, { label: `#${t}`, type: 'tag' }), 'tag');
    if (f.source) edge(id, node(`s:${f.source}`, { label: f.source, type: 'source' }), 'source', 0.5);
    if (opts.entities !== false && text) for (const e of extractEntities(text)) entityFiles.set(e, [...(entityFiles.get(e) ?? []), id]);
    if (opts.folders !== false) {
      const d = dirName(f.path);
      edge(id, node(`d:${d}`, { label: baseName(d) || d, type: 'folder', path: d }), 'folder', 0.5);
    }
  }
  // A name becomes a node only when two or more files mention it.
  for (const [e, ids] of entityFiles) {
    const uniq = [...new Set(ids)];
    if (uniq.length < 2) continue;
    const eid = node(`e:${e.toLowerCase()}`, { label: e, type: 'entity' });
    for (const id of uniq) edge(id, eid, 'entity');
  }
  if (opts.similar) {
    for (const f of chosen) {
      for (const s of opts.similar(f.path).slice(0, 3)) {
        const other = byPath.get(s.path.replace(/\\/g, '/').toLowerCase());
        if (other && s.score >= 0.5) edge(`f:${f.path}`, other, 'similar', s.score);
      }
    }
  }
  // Parent folders link up so the folder tree shows.
  if (opts.folders !== false) {
    for (const n of [...nodes.values()].filter((x) => x.type === 'folder')) {
      const parent = dirName(n.path!);
      if (parent !== n.path && nodes.has(`d:${parent}`)) edge(n.id, `d:${parent}`, 'folder', 0.3);
    }
  }
  const edgeList = [...edges.values()];
  for (const e of edgeList) {
    nodes.get(e.a)!.degree++;
    nodes.get(e.b)!.degree++;
  }
  return { nodes: [...nodes.values()], edges: edgeList, truncated };
}

/** The neighbourhood of one node: everything within `depth` links. */
export function neighbourhood(g: Graph, id: string, depth = 1, max = 300): Graph {
  const adj = new Map<string, GraphEdge[]>();
  for (const e of g.edges) {
    adj.set(e.a, [...(adj.get(e.a) ?? []), e]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), e]);
  }
  const keep = new Set([id]);
  let frontier = [id];
  for (let d = 0; d < depth && keep.size < max; d++) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const e of (adj.get(n) ?? []).sort((x, y) => y.w - x.w)) {
        const o = e.a === n ? e.b : e.a;
        if (!keep.has(o) && keep.size < max) { keep.add(o); next.push(o); }
      }
    }
    frontier = next;
  }
  return { nodes: g.nodes.filter((n) => keep.has(n.id)), edges: g.edges.filter((e) => keep.has(e.a) && keep.has(e.b)), truncated: 0 };
}

/** Nodes whose label matches the words, best first. */
export function searchGraph(g: Graph, q: string, limit = 20): GraphNode[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return g.nodes
    .map((n) => ({ n, s: words.every((w) => n.label.toLowerCase().includes(w)) ? 10 + n.degree : words.some((w) => n.label.toLowerCase().includes(w)) ? n.degree / 10 : 0 }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.n);
}
