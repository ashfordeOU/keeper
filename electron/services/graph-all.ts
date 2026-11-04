// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The knowledge graph of everything, and search by meaning over more than
// files, in the app. Nothing runs in the background for it: when the Graph
// page, a Related panel, the Assistant or an agent asks, it catches up on what
// changed (at most every 30 seconds) — only changed items are read again — and
// keeps its pieces in Keeper's data folder so the next start is quick. Meaning
// vectors for mail, events, tasks, contacts and notes are built in the brain's
// own paced batches, after the files'. Everything stays on this computer.

import { app } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { GraphStatus } from '../../core/api-agents';
import type { BrainHit } from '../../core/brain-contract';
import { E5 } from '../../core/brain/e5';
import { asSource, ItemIndex, rankTogether, type EverythingHit, type ItemDoc, type ItemDocKind } from '../../core/brain/items';
import type { ToolSpec } from '../../core/brain/providers';
import { VectorStore } from '../../core/brain/vectors';
import type { GraphFile } from '../../core/graph/build';
import {
  applyPrivacy, explain, GraphStore, ITEM_KINDS, KIND_LABEL, normalizeGraphPrivacy, related, REASON_LABEL, resolveRef, searchNodes, viewOf,
  type Explanation, type GraphPrivacy, type ItemKind, type ItemRef, type KNode, type MeetingIn, type RelatedItem, type Sources, type ViewOptions,
} from '../../core/graph/everything';
import type { FileIndex } from '../../core/indexer';
import { settings } from '../store';
import { embedQuery, kickEmbedding, localBrain, semanticReady, setEverythingTools, setExtraEmbedding } from './brain';
import { featureOn } from './features';

export interface GraphAllDeps { index: () => FileIndex }

let deps: GraphAllDeps | null = null;
const store = new GraphStore({ folders: true });
const items = new ItemIndex();
let loaded: Promise<void> | null = null;
let refreshing: Promise<void> | null = null;
let lastRefresh = 0;
let lastKey = '';
let dirty = false;
let updatedAt = 0;
let lastChange = { added: 0, changed: 0, removed: 0 };
let meta: { accounts: { id: string; label: string }[]; folders: { account: string; path: string; name: string }[] } = { accounts: [], folders: [] };
const noteText = new Map<string, { mtime: number; text: string }>();

const dir = () => path.join(app.getPath('userData'), 'graph');
const brainDir = () => path.join(app.getPath('userData'), 'brain');
export const graphPrivacy = (): GraphPrivacy => normalizeGraphPrivacy((settings() as { graph?: unknown }).graph);
const on = () => featureOn('graphAll') && featureOn('brain');

async function load() {
  loaded ??= (async () => {
    const raw = await fsp.readFile(path.join(dir(), 'graph.json'), 'utf8').then(JSON.parse, () => null);
    if (raw) store.load(raw);
    const keys = await fsp.readFile(path.join(brainDir(), 'items-keys.json'), 'utf8').then(JSON.parse, () => null);
    if (keys && typeof keys === 'object') items.restore(keys);
  })();
  return loaded;
}

// ---------------------------------------------------------------- what each part knows

/** Library files (only those the brain may read), notes first, then files with text, then the newest. */
async function libraryFiles(max = 20_000): Promise<GraphFile[]> {
  const ix = deps!.index();
  const lb = localBrain();
  const env = lb?.harnessEnv();
  const all = ix.all().filter((f) => !env || env.allowed(f.path));
  const isNote = (n: string) => /\.(md|markdown)$/i.test(n);
  const ranked = all.sort((a, b) => Number(isNote(b.name)) - Number(isNote(a.name)) || Number(!!(b.text ?? ix.extras.get(b.path)?.text)) - Number(!!(a.text ?? ix.extras.get(a.path)?.text)) || b.mtime - a.mtime).slice(0, max);
  const out: GraphFile[] = [];
  for (const f of ranked) {
    let text = f.text ?? ix.extras.get(f.path)?.text;
    // Notes carry the links: read their start (kept while unchanged).
    if (!text && /\.(md|markdown|txt)$/i.test(f.name) && f.size < 2_000_000) text = await readNote(f.path, f.mtime);
    out.push({ path: f.path, name: f.name, kind: f.kind, mtime: f.mtime, tags: f.tags, source: f.source?.name, sourceUrl: f.source?.url, text: text?.slice(0, 20_000) });
  }
  return out;
}

async function readNote(p: string, mtime: number): Promise<string | undefined> {
  const c = noteText.get(p);
  if (c && c.mtime === mtime) return c.text;
  const t = await fsp.readFile(p, 'utf8').then((x) => x.slice(0, 60_000)).catch(() => undefined);
  if (t !== undefined) noteText.set(p, { mtime, text: t });
  return t;
}

/** Notes in vaults outside the library folders (the library's own are already files). */
async function vaultNotes(known: Set<string>, max = 3000): Promise<GraphFile[]> {
  if (!featureOn('notes')) return [];
  const notes = await import('./notes');
  const out: GraphFile[] = [];
  for (const v of await notes.vaults().catch(() => [])) {
    const walk = async (d: string, depth: number): Promise<void> => {
      if (out.length >= max || depth > 8) return;
      const ents = await fsp.readdir(d, { withFileTypes: true }).catch(() => []);
      for (const e of ents) {
        if (out.length >= max || e.name.startsWith('.')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p, depth + 1);
        else if (/\.(md|markdown)$/i.test(e.name) && !known.has(p)) {
          const st = await fsp.stat(p).catch(() => null);
          if (!st || st.size > 2_000_000) continue;
          out.push({ path: p, name: e.name, kind: 'document', mtime: st.mtimeMs, text: await readNote(p, st.mtimeMs) });
        }
      }
    };
    await walk(v.path, 0);
  }
  return out;
}

async function pimItems() {
  if (!featureOn('mail') && !featureOn('calendars')) return null;
  const { pimToolCalls } = await import('./pim/route');
  return pimToolCalls.graphItems().catch(() => null);
}

async function meetings(): Promise<MeetingIn[]> {
  if (!featureOn('meetings')) return [];
  const { listMeetings } = await import('./voice/store');
  const list = await listMeetings().catch(() => []);
  return list.slice(0, 2000).map((m) => ({
    id: m.id, title: m.title, start: m.startedAt, end: m.endedAt ?? m.startedAt + m.durationMs, app: m.app, eventId: m.event?.id, attendees: m.event?.attendees,
    speakers: m.speakers.filter((s) => s.label && !/^(you|speaker \d+)$/i.test(s.label)).map((s) => s.label), notePath: m.notePath,
    text: [m.notes?.summary, ...(m.notes?.decisions ?? []), ...m.utterances.map((u) => u.text)].filter(Boolean).join('\n').slice(0, 8000),
  }));
}

async function places() {
  if (!featureOn('tracks')) return [];
  const { tracks } = await import('./tracks');
  // The places live in an encrypted vault: when it is locked they simply are not added.
  const r = await Promise.race([tracks.places().catch(() => null), new Promise<null>((res) => setTimeout(() => res(null), 3000))]);
  return (r?.named ?? []).map((p) => ({ id: p.id, name: p.name, kind: p.kind }));
}

async function bookmarks() {
  if (!featureOn('reader')) return [];
  const { readerApi } = await import('./reader');
  const [later, starred] = await Promise.all([readerApi.items({ view: 'later', limit: 2000 }).catch(() => []), readerApi.items({ view: 'starred', limit: 2000 }).catch(() => [])]);
  const seen = new Set<string>();
  return [...later, ...starred].filter((i) => !seen.has(i.key) && seen.add(i.key)).map((i) => ({ id: i.key, title: i.title, url: i.url, added: i.added, text: i.excerpt, site: i.source }));
}

const MAIL_LINK = (id: string) => `keeper://mail/${encodeURIComponent(id)}`;

/** The items search by meaning reads: everything but library files (the brain has those). */
function itemDocs(s: Sources, vault: GraphFile[]): ItemDoc[] {
  const out: ItemDoc[] = [];
  for (const m of s.mail ?? []) out.push({ id: `mail:${m.id}`, kind: 'mail', title: m.subject || '(no subject)', text: m.text ?? '', time: m.date, sub: m.from ? m.from.name || m.from.address : undefined, cite: MAIL_LINK(m.id) });
  for (const e of s.events ?? []) out.push({ id: `event:${e.id}`, kind: 'event', title: e.title, text: [e.location, e.description, ...(e.attendees ?? []).map((a) => a.name || a.address)].filter(Boolean).join('\n'), time: e.start, sub: e.location, cite: `keeper://event/${encodeURIComponent(e.id)}?at=${e.start}` });
  for (const t of s.tasks ?? []) out.push({ id: `task:${t.id}`, kind: 'task', title: t.title, text: t.notes ?? '', time: t.due ?? t.created, sub: t.project, cite: `keeper://task/${encodeURIComponent(t.id)}` });
  for (const c of s.contacts ?? []) out.push({ id: `contact:${c.id}`, kind: 'contact', title: c.name || c.emails[0] || 'Contact', text: [c.org, ...c.emails, c.note].filter(Boolean).join('\n'), sub: c.org, cite: `keeper://contact/${encodeURIComponent(c.emails[0] ?? c.id)}` });
  for (const m of s.meetings ?? []) out.push({ id: `meeting:${m.id}`, kind: 'meeting', title: m.title, text: m.text ?? '', time: m.start, sub: m.app, cite: `keeper://meeting/${encodeURIComponent(m.id)}` });
  for (const b of s.bookmarks ?? []) out.push({ id: `bookmark:${b.id}`, kind: 'bookmark', title: b.title, text: b.text ?? '', time: b.added, sub: b.site, cite: b.url });
  for (const n of vault) out.push({ id: `note:${n.path}`, kind: 'note', title: n.name.replace(/\.(md|markdown)$/i, ''), text: n.text ?? '', time: n.mtime, cite: n.path });
  return out;
}

// ---------------------------------------------------------------- keeping up

let saveTimer: NodeJS.Timeout | undefined;
function saveSoon() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void save(), 5000);
  saveTimer.unref?.();
}

async function save() {
  dirty = false;
  try {
    await fsp.mkdir(dir(), { recursive: true });
    const tmp = path.join(dir(), 'graph.json.tmp');
    await fsp.writeFile(tmp, JSON.stringify(store.toJSON()), { mode: 0o600 });
    await fsp.rename(tmp, path.join(dir(), 'graph.json'));
    if (items.vectors) {
      await fsp.mkdir(brainDir(), { recursive: true });
      await fsp.writeFile(path.join(brainDir(), 'items-vectors.bin'), items.vectors.toBuffer(), { mode: 0o600 });
      await fsp.writeFile(path.join(brainDir(), 'items-keys.json'), JSON.stringify(items.keys()), { mode: 0o600 });
    }
  } catch {
    /* a full or read-only disk: rebuilt next time */
  }
}

async function useVectors() {
  if (!semanticReady()) { if (items.vectors) items.useVectors(null); return; }
  if (items.vectors) return;
  const buf = await fsp.readFile(path.join(brainDir(), 'items-vectors.bin')).catch(() => null);
  let v: VectorStore | null = null;
  try { v = buf ? VectorStore.fromBuffer(buf) : null; } catch { v = null; }
  items.useVectors(v && v.dims === E5.dims ? v : new VectorStore(E5.dims));
}

const choicesKey = () => JSON.stringify([graphPrivacy(), featureOn('mail'), featureOn('calendars'), featureOn('meetings'), featureOn('tracks'), featureOn('reader'), featureOn('notes')]);

/**
 * Before answering: the first time, or after a change to what the graph may include, wait
 * for it to catch up; otherwise answer from what it has and catch up behind (so typing in
 * a search box never waits for mail to be read).
 */
async function ready(): Promise<void> {
  if (!lastRefresh || choicesKey() !== lastKey) return refresh();
  void refresh();
}

/** Catches up on what changed (at most every 30 seconds unless forced). */
export async function refresh(force = false): Promise<void> {
  if (!deps || !on()) return;
  if (refreshing) return refreshing;
  // A change to what the graph may include counts at once.
  const key = choicesKey();
  if (!force && key === lastKey && Date.now() - lastRefresh < 30_000) return;
  lastKey = key;
  refreshing = (async () => {
    await load();
    const files = await libraryFiles();
    const known = new Set(files.map((f) => f.path));
    const [pim, vault, mt, pl, bm] = await Promise.all([pimItems(), vaultNotes(known), meetings(), places(), bookmarks()]);
    if (pim) meta = { accounts: pim.accounts, folders: pim.folders };
    const raw: Sources = { files: [...files, ...vault], mail: pim?.mail, contacts: pim?.contacts, events: pim?.events, tasks: pim?.tasks, meetings: mt, places: pl, bookmarks: bm, me: pim?.me };
    const s = applyPrivacy(raw, graphPrivacy(), { mail: featureOn('mail'), calendars: featureOn('calendars'), meetings: featureOn('meetings'), tracks: featureOn('tracks'), reader: featureOn('reader') });
    lastChange = store.update(s);
    await useVectors();
    const ch = items.setAll(itemDocs(s, applyPrivacy({ files: vault }, graphPrivacy(), { mail: false, calendars: false, meetings: false, tracks: false, reader: false }).files ?? []));
    if (lastChange.added || lastChange.changed || lastChange.removed || ch.added || ch.changed || ch.removed) saveSoon();
    if (items.pendingCount) kickEmbedding();
    lastRefresh = Date.now();
    updatedAt = lastRefresh;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

// ---------------------------------------------------------------- what the pages and agents ask

const similarFor = (id: string): { id: string; score: number }[] => {
  const g = store.graph();
  const n = g.byId.get(id);
  if (!n) return [];
  const lb = localBrain();
  if ((n.kind === 'file' || n.kind === 'note') && n.path && lb?.engine.vectors?.size) {
    const files = lb.engine.similarFiles(n.path, 5).map((x) => ({ id: `f:${x.path}`, score: x.score }));
    if (files.length) return files;
  }
  const docId = n.kind === 'mail' ? `mail:${n.ref}` : n.kind === 'event' ? `event:${n.ref}` : n.kind === 'task' ? `task:${n.ref}` : n.kind === 'meeting' ? `meeting:${n.ref}` : n.kind === 'note' && n.path ? `note:${n.path}` : undefined;
  if (!docId) return [];
  return items.similar(docId, 5).map((x) => ({ id: nodeOfDoc(x.id) ?? '', score: x.score })).filter((x) => x.id);
};

function nodeOfDoc(docId: string): string | undefined {
  const g = store.graph();
  const [kind, ...rest] = docId.split(':');
  const id = rest.join(':');
  if (kind === 'mail') return g.handles.get(`mid:${id}`)?.[0];
  if (kind === 'event') return `ev:${id}`;
  if (kind === 'task') return `tk:${id}`;
  if (kind === 'meeting') return `mt:${id}`;
  if (kind === 'note') return `f:${id}`;
  return undefined;
}


export async function status(): Promise<GraphStatus> {
  await ready();
  const g = on() ? store.graph() : null;
  const counts: Partial<Record<ItemKind, number>> = {};
  for (const n of g?.nodes ?? []) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
  return {
    on: on(), nodes: g?.nodes.length ?? 0, links: g?.edges.length ?? 0, counts, updatedAt, lastChange,
    meaning: { on: semanticReady(), items: items.size, embedded: items.embedded, pending: items.pendingCount },
    privacy: graphPrivacy(), accounts: meta.accounts, folders: meta.folders,
    parts: { mail: featureOn('mail'), calendars: featureOn('calendars'), meetings: featureOn('meetings'), tracks: featureOn('tracks'), reader: featureOn('reader'), notes: featureOn('notes') },
  };
}

const emptyView = () => ({ nodes: [], edges: [], hidden: {}, total: 0, counts: {} });

export async function view(o: Omit<ViewOptions, 'similar' | 'focus'> & { focus?: string | ItemRef } = {}) {
  await ready();
  if (!on()) return emptyView();
  const g = store.graph();
  const focus = typeof o.focus === 'string' ? (g.byId.has(o.focus) ? o.focus : resolveRef(g, { path: o.focus })) : o.focus ? resolveRef(g, o.focus) : undefined;
  return viewOf(g, { ...o, focus, similar: similarFor });
}

export async function find(q: string, kinds?: ItemKind[]): Promise<KNode[]> {
  await ready();
  return on() ? searchNodes(store.graph(), q, { kinds, limit: 12 }) : [];
}

export async function relatedTo(ref: ItemRef, o: { limit?: number; kinds?: ItemKind[] } = {}): Promise<{ node: KNode | null; items: RelatedItem[] }> {
  await ready();
  if (!on()) return { node: null, items: [] };
  const g = store.graph();
  const id = resolveRef(g, ref);
  if (!id) return { node: null, items: [] };
  return { node: g.byId.get(id) ?? null, items: related(g, id, { limit: o.limit ?? 8, kinds: o.kinds, similar: similarFor }) };
}

export async function explainLink(a: string, b: string): Promise<Explanation | null> {
  await ready();
  return on() ? explain(store.graph(), a, b) : null;
}

/** One search box for every kind: files from the brain, everything else from the item index, ranked together. */
export async function searchEverything(q: string, o: { kinds?: (ItemDocKind | 'file')[]; limit?: number } = {}): Promise<EverythingHit[]> {
  await ready();
  const limit = Math.min(50, o.limit ?? 20);
  const wantFiles = !o.kinds?.length || o.kinds.includes('file') || o.kinds.includes('note');
  const itemKinds = o.kinds?.filter((k): k is ItemDocKind => k !== 'file');
  const lb = localBrain();
  const [files, qvec] = await Promise.all([wantFiles && lb ? lb.search({ query: q, limit }).catch(() => [] as BrainHit[]) : Promise.resolve([] as BrainHit[]), embedQuery(q).catch(() => null)]);
  const its = on() && (!o.kinds?.length || itemKinds?.length) ? items.search(q, { qvec: qvec ?? undefined, kinds: itemKinds?.length ? itemKinds : undefined, limit }) : [];
  return rankTogether(files, its, limit);
}

/** A line for a note: a link back to the thing. */
export async function addToNote(id: string): Promise<{ path: string } | null> {
  if (!featureOn('notes')) return null;
  const n = store.graph().byId.get(id);
  if (!n) return null;
  const link = citeOf(n);
  const text = link.startsWith('/') || /^[a-z]:\\/i.test(link) ? `[${n.label}](<${link}>)` : link ? `[${n.label}](${link})` : n.label;
  const { capture } = await import('./notes');
  return capture(`${KIND_LABEL[n.kind][0]}: ${text}`);
}

/** How the Assistant cites a node, and what opening it needs. */
export function citeOf(n: KNode): string {
  if (n.path && (n.kind === 'file' || n.kind === 'note' || n.kind === 'folder')) return n.path;
  if (n.kind === 'mail' && n.ref) return MAIL_LINK(n.ref);
  if (n.kind === 'event' && n.ref) return `keeper://event/${encodeURIComponent(n.ref)}?at=${n.time ?? ''}`;
  if (n.kind === 'task' && n.ref) return `keeper://task/${encodeURIComponent(n.ref)}`;
  if (n.kind === 'meeting' && n.ref) return `keeper://meeting/${encodeURIComponent(n.ref)}`;
  if (n.kind === 'person' && n.emails?.[0]) return `keeper://contact/${encodeURIComponent(n.emails[0])}`;
  if (n.kind === 'bookmark' && n.ref) return n.ref;
  return '';
}

// ---------------------------------------------------------------- for agents

/**
 * What other AI apps may see: mail only from accounts shared with them, and files and
 * notes only inside the folders Keeper indexes (not notes from vaults kept elsewhere).
 */
function sharedWithApps(n: KNode, mcp: boolean, shared: Set<string>): boolean {
  if (!mcp) return true;
  if (n.kind === 'mail') return !!n.ref && shared.has(n.ref.split(':')[0]);
  if ((n.kind === 'file' || n.kind === 'note' || n.kind === 'folder') && n.path) return !!localBrain()?.harnessEnv().allowed(n.path);
  return true;
}

async function mcpShared(): Promise<Set<string>> {
  if (!featureOn('mail')) return new Set();
  const { pimCalls } = await import('./pim/route');
  return new Set((await pimCalls.accounts().catch(() => [])).filter((a) => a.mcp).map((a) => a.id));
}

const line = (n: KNode) => `${KIND_LABEL[n.kind][0]}: ${n.label}${n.time ? ` · ${new Date(n.time).toISOString().slice(0, 10)}` : ''}${citeOf(n) ? ` [[${citeOf(n)}]]` : ''} (id ${n.id})`;

/** graph_neighbors and graph_search for agents, over every kind. `mcp` is true for other AI apps. */
export async function agentTool(name: string, args: Record<string, unknown>, mcp: boolean): Promise<{ text: string; isError?: boolean } | null> {
  if (!on()) return null;
  await ready();
  const g = store.graph();
  const shared = mcp ? await mcpShared() : new Set<string>();
  const kinds = Array.isArray(args.kinds) ? (args.kinds as string[]).filter((k): k is ItemKind => (ITEM_KINDS as string[]).includes(k)) : undefined;
  if (name === 'graph_search') {
    const hits = searchNodes(g, String(args.query ?? ''), { kinds, limit: 20 }).filter((n) => sharedWithApps(n, mcp, shared));
    return { text: hits.map((n) => `${line(n)} · ${n.degree} links`).join('\n') || 'Nothing found.' };
  }
  if (name === 'graph_neighbors') {
    const ref: ItemRef = args.id ? { id: String(args.id) } : args.path ? { path: String(args.path) } : args.email ? { email: String(args.email) } : { name: String(args.name ?? '') };
    const id = resolveRef(g, ref);
    if (!id || !sharedWithApps(g.byId.get(id)!, mcp, shared)) return { text: 'Not in the knowledge graph.', isError: true };
    const r = related(g, id, { limit: Math.min(40, Number(args.limit) || 20), kinds, similar: similarFor }).filter((x) => sharedWithApps(x.node, mcp, shared));
    return { text: [line(g.byId.get(id)!), ...r.map((x) => `- ${line(x.node)} — ${REASON_LABEL[x.reason]}${x.via ? ` (through ${x.via.label})` : ''}: ${x.why[0]}`)].join('\n') };
  }
  return null;
}

export const GRAPH_TOOL_SPECS = [
  { name: 'graph_neighbors', description: 'What is linked to one thing in Keeper\'s knowledge graph — a file or note (path), a person (name or email), or any node id — across files, notes, mail, people, organisations, events, tasks, projects, meetings, places and saved pages, each with the reason it is linked.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, id: { type: 'string' }, kinds: { type: 'array', items: { type: 'string', enum: ITEM_KINDS } }, limit: { type: 'integer', minimum: 1, maximum: 40 } } }, annotations: { readOnlyHint: true } },
  { name: 'graph_search', description: 'Find people, organisations, projects, files, notes, mail threads, events, tasks, meetings, places and saved pages in the knowledge graph by name, address or title.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, kinds: { type: 'array', items: { type: 'string', enum: ITEM_KINDS } } }, required: ['query'] }, annotations: { readOnlyHint: true } },
];

/** The Assistant's own tools: search over everything with citations, and what relates to a person or topic. */
function assistantTools() {
  if (!on()) return undefined;
  const specs: ToolSpec[] = [
    { name: 'search_everything', description: 'Search mail, calendar events, tasks, contacts, notes, meetings, saved pages and files together, by words and by meaning. Use it for "what do I have about X?".', parameters: { type: 'object', properties: { query: { type: 'string' }, kinds: { type: 'array', items: { type: 'string', enum: ['file', 'note', 'mail', 'event', 'task', 'contact', 'meeting', 'bookmark'] } }, limit: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['query'] } },
    { name: 'related_to', description: 'Everything linked to a person, organisation, project or file in the knowledge graph (mail, meetings, events, notes, files), with the reason for each link.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'a person, organisation, project or topic' }, path: { type: 'string' } } } },
  ];
  return {
    specs,
    instructions: 'Mail, events, tasks, contacts, meetings and notes can be searched with search_everything; related_to lists what is linked to a person or project. Cite each item you rely on with the link given for it in double square brackets, exactly like a file path, for example [[keeper://mail/…]].',
    async run(call: { name: string; args: Record<string, unknown> }) {
      if (call.name === 'search_everything') {
        const hits = await searchEverything(String(call.args.query ?? ''), { kinds: Array.isArray(call.args.kinds) ? (call.args.kinds as (ItemDocKind | 'file')[]) : undefined, limit: Number(call.args.limit) || 12 });
        const content = hits.map((h, i) => `${i + 1}. ${h.kind}: ${h.title}${h.sub ? ` — ${h.sub}` : ''}${h.time ? ` · ${new Date(h.time).toISOString().slice(0, 10)}` : ''} [[${h.cite}]]${h.snippet ? `\n   ${h.snippet}` : ''}`).join('\n') || 'Nothing found.';
        return { content, summary: `${hits.length} found across mail, calendar, notes and files`, sources: hits.map(asSource) };
      }
      await ready();
      const g = store.graph();
      const ref: ItemRef = call.args.path ? { path: String(call.args.path) } : { name: String(call.args.name ?? '') };
      const id = resolveRef(g, ref) ?? searchNodes(g, String(call.args.name ?? ''), { limit: 1 })[0]?.id;
      if (!id) return { content: 'Not in the knowledge graph.', summary: 'Nothing linked' };
      const r = related(g, id, { limit: 20, similar: similarFor });
      const sources: BrainHit[] = r.filter((x) => citeOf(x.node)).map((x) => ({ path: citeOf(x.node), name: x.node.label, kind: x.node.kind === 'file' || x.node.kind === 'note' ? 'document' : 'other', ...(['mail', 'event', 'task', 'meeting', 'bookmark'].includes(x.node.kind) ? { item: x.node.kind as BrainHit['item'] } : x.node.kind === 'person' ? { item: 'contact' as const } : {}), size: 0, mtime: x.node.time ?? 0, score: x.score / 12, snippet: x.why[0] }));
      return { content: [line(g.byId.get(id)!), ...r.map((x) => `- ${line(x.node)} — ${REASON_LABEL[x.reason]}: ${x.why[0]}`)].join('\n'), summary: `${r.length} things linked`, sources };
    },
  };
}

export function startGraphAll(d: GraphAllDeps) {
  deps = d;
  setEverythingTools(assistantTools);
  setExtraEmbedding({
    pending: () => (on() ? items.pendingCount : 0),
    async run(embed, n) {
      const batch = items.nextToEmbed(n);
      if (!batch.length) return;
      const vecs = await embed(batch.map((b) => b.text));
      batch.forEach((b, i) => items.setVector(b.num, vecs[i]));
      saveSoon();
    },
  });
}

export async function stopGraphAll() {
  clearTimeout(saveTimer);
  if (deps && dirty) await save();
}
