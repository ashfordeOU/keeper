// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The side panels of Notes: files, search, bookmarks, tags and recent files
// on the left; links (backlinks, outgoing, unlinked mentions), outline, the
// local graph and the AI on the right. Long lists only draw the rows on screen.

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { RelatedPanel } from '../components/RelatedPanel';
import { ContextMenu, type MenuItem } from '../components/ui';
import { arrowNav } from '../a11y';
import type { Bookmark } from '../../core/notes/config';
import { parseNote } from '../../core/notes/parse';
import type { NotesAnswer } from '../../core/api-notes';
import { kindOf, recentFiles, useNotes } from './ctx';
import { VaultGraph } from './VaultGraph';

const ROW = 30;

/** Draws only the rows in view. */
function Virtual<T>({ items, row, height = ROW, className, role, label, onKeyDown }: { items: T[]; row: (t: T, i: number) => React.ReactNode; height?: number; className?: string; role?: string; label?: string; onKeyDown?: React.KeyboardEventHandler<HTMLDivElement> }) {
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [h, setH] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const first = Math.max(0, Math.floor(top / height) - 10);
  const last = Math.min(items.length, Math.ceil((top + h) / height) + 10);
  return (
    <div ref={box} className={`nt-virtual ${className ?? ''}`} role={role} aria-label={label} onKeyDown={onKeyDown} onScroll={(e) => setTop((e.target as HTMLElement).scrollTop)}>
      <div style={{ height: items.length * height, position: 'relative' }} role={role ? 'none' : undefined}>
        {items.slice(first, last).map((t, i) => <div key={first + i} role={role ? 'none' : undefined} style={{ position: 'absolute', top: (first + i) * height, left: 0, right: 0, height }}>{row(t, first + i)}</div>)}
      </div>
    </div>
  );
}

interface TreeRow { path: string; name: string; depth: number; folder: boolean; open?: boolean }

export function Explorer({ onMenu, sort, collapse, onNew, onImport }: { onMenu: (path: string, folder: boolean) => MenuItem[]; sort: 'name' | 'modified'; /** bumps to close every folder */ collapse: number; onNew: () => void; onImport: () => void }) {
  const n = useNotes();
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`notes.open.${n.vault.id}`) ?? '[]') as string[]); } catch { return new Set(); }
  });
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  useEffect(() => { try { localStorage.setItem(`notes.open.${n.vault.id}`, JSON.stringify([...openDirs])); } catch { /* ignore */ } }, [openDirs, n.vault.id]);
  useEffect(() => { if (collapse) setOpenDirs(new Set()); }, [collapse]);
  // Show the open note's folder.
  useEffect(() => {
    if (!n.activePath) return;
    const parts = n.activePath.split('/').slice(0, -1);
    if (!parts.length) return;
    setOpenDirs((s) => { const next = new Set(s); parts.forEach((_, i) => next.add(parts.slice(0, i + 1).join('/'))); return next.size === s.size ? s : next; });
  }, [n.activePath]);

  const rows = useMemo(() => {
    const children = new Map<string, { dirs: Set<string>; files: typeof n.files }>();
    const ensure = (d: string) => { if (!children.has(d)) children.set(d, { dirs: new Set(), files: [] }); return children.get(d)!; };
    const addDir = (d: string) => { const parts = d.split('/'); for (let i = 1; i <= parts.length; i++) { const p = parts.slice(0, i).join('/'); ensure(parts.slice(0, i - 1).join('/')).dirs.add(p); ensure(p); } };
    for (const d of n.vault.folders) addDir(d);
    for (const f of n.files) {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
      if (dir) addDir(dir);
      if (!n.vault.config.showUnsupportedFiles && kindOf(f.path) === 'other') continue;
      ensure(dir).files.push(f);
    }
    const out: TreeRow[] = [];
    const walk = (d: string, depth: number) => {
      const c = children.get(d);
      if (!c) return;
      for (const sub of [...c.dirs].sort((a, b) => a.localeCompare(b))) {
        const open = openDirs.has(sub);
        out.push({ path: sub, name: sub.split('/').pop()!, depth, folder: true, open });
        if (open) walk(sub, depth + 1);
      }
      const files = [...c.files].sort(sort === 'name' ? (a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }) : (a, b) => b.mtime - a.mtime);
      for (const f of files) out.push({ path: f.path, name: f.path.split('/').pop()!.replace(/\.md$/, ''), depth, folder: false });
    };
    walk('', 0);
    return out;
  }, [n.files, n.vault.folders, n.vault.config.showUnsupportedFiles, openDirs, sort]);

  const drop = (e: React.DragEvent, folder: string) => {
    e.preventDefault();
    setDropOn(null);
    const from = e.dataTransfer.getData('text/x-note-path');
    if (from) {
      const name = from.split('/').pop()!;
      const to = folder ? `${folder}/${name}` : name;
      if (to !== from && !to.startsWith(`${from}/`)) void api.notes.rename(n.vault.id, from, to).then((r) => { n.toast(r.changed.length ? `Moved; updated links in ${r.changed.length} note${r.changed.length === 1 ? '' : 's'}` : 'Moved'); void n.refresh(); });
      return;
    }
    // Files dropped in from the computer are copied into the vault.
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    void Promise.all(files.map(async (f) => api.notes.saveAttachment(n.vault.id, folder ? `${folder}/x.md` : 'x.md', f.name, new Uint8Array(await f.arrayBuffer())))).then(() => n.refresh());
  };

  // One stop in the Tab order: the open note's row, or the first row.
  const activeShown = rows.some((r) => r.path === n.activePath);
  if (!rows.length) {
    return (
      <div className="nt-empty-small is-designed">
        <strong>No notes yet</strong>
        <span>Start one, or bring notes from another app.</span>
        <button className="btn sm primary" onClick={onNew}><Icon name="plus" size={12} /> New note</button>
        <button className="btn sm ghost" onClick={onImport}><Icon name="importIn" size={12} /> Import notes…</button>
      </div>
    );
  }
  return (
    <div className="nt-explorer" onDragOver={(e) => { e.preventDefault(); setDropOn(''); }} onDrop={(e) => drop(e, '')}>
      <Virtual items={rows} className="nt-tree" role="tree" label="Notes" onKeyDown={(e) => {
        // Up and Down move between rows, Right opens a folder, Left closes it, Enter opens the note.
        const t = e.target as HTMLElement;
        const path = t.dataset.path;
        const r = rows.find((x) => x.path === path);
        if (arrowNav(e, e.currentTarget, '[role="treeitem"]', 'vertical')) return;
        if (!r) return;
        const toggle = (open: boolean) => setOpenDirs((s) => { const x = new Set(s); if (open) x.add(r.path); else x.delete(r.path); return x; });
        if (e.key === 'ArrowRight' && r.folder && !r.open) { e.preventDefault(); toggle(true); }
        else if (e.key === 'ArrowLeft' && r.folder && r.open) { e.preventDefault(); toggle(false); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t.click(); }
      }} row={(r, i) => (
        <div
          role="treeitem"
          aria-level={r.depth + 1}
          aria-expanded={r.folder ? !!r.open : undefined}
          aria-selected={n.activePath === r.path}
          tabIndex={(activeShown ? n.activePath === r.path : i === 0) ? 0 : -1}
          className={`nt-tree-row ${r.folder ? 'is-folder' : ''} ${n.activePath === r.path ? 'is-active' : ''} ${dropOn === r.path ? 'is-drop' : ''}`}
          style={{ ['--depth' as string]: r.depth }}
          draggable
          data-path={r.path}
          title={r.path}
          onDragStart={(e) => { e.dataTransfer.setData('text/x-note-path', r.path); e.dataTransfer.setData('text/plain', `[[${r.name}]]`); }}
          onDragOver={(e) => { if (r.folder) { e.preventDefault(); e.stopPropagation(); setDropOn(r.path); } }}
          onDrop={(e) => { if (r.folder) { e.stopPropagation(); drop(e, r.path); } }}
          onClick={(e) => (r.folder ? setOpenDirs((s) => { const x = new Set(s); if (x.has(r.path)) x.delete(r.path); else x.add(r.path); return x; }) : n.open(r.path, { newTab: e.metaKey || e.ctrlKey }))}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: onMenu(r.path, r.folder) }); }}
        >
          {r.folder ? <Icon name={r.open ? 'chevronDown' : 'chevronRight'} size={11} /> : <span className={`nt-kind kind-${kindOf(r.path)}`} />}
          <span className="nt-tree-name">{r.name}</span>
          {!r.folder && kindOf(r.path) !== 'note' ? <span className="nt-ext">{r.path.split('.').pop()}</span> : null}
        </div>
      )} />
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

export function SearchPanel({ query }: { query: string }) {
  const n = useNotes();
  const [hits, setHits] = useState<Awaited<ReturnType<typeof api.notes.search>>>([]);
  const [caseSensitive, setCase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tips, setTips] = useState(false);
  useEffect(() => {
    if (!query.trim()) { setHits([]); return; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => void api.notes.search(n.vault.id, query, { caseSensitive }).then((h) => { if (alive) { setHits(h); setBusy(false); } }), 150);
    return () => { alive = false; clearTimeout(t); };
  }, [query, caseSensitive, n.vault.id, n.rev]);
  return (
    <div className="nt-search">
      <div className="nt-search-bar">
        <span className="nt-search-count" role="status">{busy ? 'Searching…' : query ? `${hits.length} note${hits.length === 1 ? '' : 's'}` : 'Type to search'}</span>
        <span className="nt-spacer" />
        <button className={`nt-chip-btn ${caseSensitive ? 'is-on' : ''}`} aria-pressed={caseSensitive} title="Match upper and lower case" onClick={() => setCase((c) => !c)}>Aa</button>
        <button className={`nt-chip-btn ${tips ? 'is-on' : ''}`} aria-expanded={tips} onClick={() => setTips((t) => !t)}>Tips</button>
      </div>
      {tips ? <div className="nt-search-help"><code>tag:#idea</code> <code>path:Books/</code> <code>"exact words"</code> <code>-leave out</code> <code>[status:done]</code> <code>task-todo:</code> <code>a OR b</code> <code>/regex/</code></div> : null}
      {query.trim() && !busy && !hits.length ? <div className="nt-empty-small">No notes match. Try fewer words.</div> : null}
      <div className="nt-search-results">
        {hits.map((h) => (
          <div key={h.path} className="nt-hit">
            <button className="nt-hit-title" onClick={() => n.open(h.path)}>{h.path.replace(/\.md$/, '')}</button>
            {h.matches.slice(0, 4).map((m, i) => (
              <button key={i} className="nt-hit-line" onClick={() => n.open(h.path)}>
                {m.text.slice(Math.max(0, m.from - 40), m.from)}<mark>{m.text.slice(m.from, m.to)}</mark>{m.text.slice(m.to, m.to + 80)}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TagsPanel() {
  const n = useNotes();
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  useEffect(() => { void api.notes.tags(n.vault.id).then(setTags); }, [n.vault.id, n.rev]);
  return (
    <div className="nt-list">
      {tags.length ? tags.map((t) => (
        <button key={t.tag} className="nt-list-row" style={{ ['--depth' as string]: t.tag.split('/').length - 1 }} onClick={() => n.search(`tag:#${t.tag}`)}>
          <span>#{t.tag.split('/').pop()}</span><span className="nt-count">{t.count}</span>
        </button>
      )) : <div className="nt-empty-small">No tags yet. Write #tag in a note.</div>}
    </div>
  );
}

export function BookmarksPanel() {
  const n = useNotes();
  const [items, setItems] = useState<Bookmark[]>([]);
  useEffect(() => { void api.notes.bookmarks(n.vault.id).then(setItems); }, [n.vault.id, n.rev]);
  const flat = (list: Bookmark[], depth = 0): { b: Bookmark; depth: number }[] => list.flatMap((b) => [{ b, depth }, ...(b.type === 'group' ? flat(b.items ?? [], depth + 1) : [])]);
  return (
    <div className="nt-list">
      {items.length ? flat(items).map(({ b, depth }, i) => (
        <button key={i} className="nt-list-row" style={{ ['--depth' as string]: depth }} onClick={() => {
          if (b.type === 'file' && b.path) n.open(b.path, { subpath: b.subpath?.replace(/^#/, '') });
          else if ((b.type === 'heading' || b.type === 'block') && b.path) n.open(b.path, { subpath: b.subpath?.replace(/^#/, '') });
          else if (b.type === 'search' && b.query) n.search(b.query);
          else if (b.type === 'url' && b.url) void api.system.openExternal(b.url);
        }}>
          <Icon name={b.type === 'group' ? 'folder' : b.type === 'search' ? 'search' : b.type === 'url' ? 'globe' : 'star'} size={12} />
          <span>{b.title ?? b.path?.replace(/\.md$/, '') ?? b.query ?? b.url}</span>
        </button>
      )) : <div className="nt-empty-small">No bookmarks. Right-click a file → Bookmark.</div>}
    </div>
  );
}

export function RecentPanel() {
  const n = useNotes();
  const list = recentFiles(n.vault.id).filter((p) => n.files.some((f) => f.path === p));
  return (
    <div className="nt-list">
      {list.length ? list.map((p) => <button key={p} className="nt-list-row" onClick={() => n.open(p)}><span>{p.replace(/\.md$/, '')}</span></button>) : <div className="nt-empty-small">Notes you open show up here.</div>}
    </div>
  );
}

/** A note's path on disk, in the system's own way of writing paths. */
function onDisk(vault: string, rel: string): string {
  const sep = vault.includes('\\') && !vault.includes('/') ? '\\' : '/';
  return vault.replace(/[\\/]+$/, '') + sep + rel.split('/').join(sep);
}

export function LinksPanel({ path }: { path: string | null }) {
  const n = useNotes();
  const [back, setBack] = useState<Awaited<ReturnType<typeof api.notes.backlinks>>>([]);
  const [out, setOut] = useState<Awaited<ReturnType<typeof api.notes.outgoing>>>([]);
  const [unl, setUnl] = useState<Awaited<ReturnType<typeof api.notes.unlinked>>>([]);
  const [showUnl, setShowUnl] = useState(false);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    void Promise.all([api.notes.backlinks(n.vault.id, path), api.notes.outgoing(n.vault.id, path)]).then(([b, o]) => { if (alive) { setBack(b); setOut(o); } });
    return () => { alive = false; };
  }, [n.vault.id, path, n.rev]);
  useEffect(() => {
    if (!path || !showUnl) return;
    void api.notes.unlinked(n.vault.id, path).then(setUnl);
  }, [n.vault.id, path, showUnl, n.rev]);
  if (!path) return <div className="nt-empty-small">Open a note to see its links.</div>;
  const outUnique = [...new Map(out.filter((o) => o.link.target).map((o) => [o.resolved ?? `?${o.link.target}`, o])).values()];
  return (
    <div className="nt-links" data-testid="links-panel">
      <h3 className="nt-sec-title">Linked mentions <span className="nt-count">{back.length}</span></h3>
      {back.length ? back.map((b) => (
        <div key={b.source} className="nt-backlink">
          <button className="nt-hit-title" onClick={() => n.open(b.source)}>{b.source.replace(/\.md$/, '')}</button>
          {b.links.slice(0, 3).map((l, i) => <div key={i} className="nt-hit-line">{l.context}</div>)}
        </div>
      )) : <div className="nt-empty-small">No notes link here yet.</div>}
      <h3 className="nt-sec-title"><button className="nt-sec-toggle" aria-expanded={showUnl} onClick={() => setShowUnl((s) => !s)}><Icon name={showUnl ? 'chevronDown' : 'chevronRight'} size={11} /> Unlinked mentions</button>{showUnl ? <span className="nt-count">{unl.length}</span> : null}</h3>
      {showUnl && !unl.length ? <div className="nt-empty-small">No other notes mention this one by name.</div> : null}
      {showUnl ? unl.map((u, i) => (
        <div key={i} className="nt-backlink">
          <button className="nt-hit-title" onClick={() => n.open(u.source)}>{u.source.replace(/\.md$/, '')}</button>
          <div className="nt-hit-line">{u.text}</div>
          <button className="nt-link-btn" onClick={() => void api.notes.linkMention(n.vault.id, u.source, u.from, u.to, path).then(() => n.refresh())}>Link</button>
        </div>
      )) : null}
      <h3 className="nt-sec-title">Outgoing links <span className="nt-count">{outUnique.length}</span></h3>
      {!outUnique.length ? <div className="nt-empty-small">This note links nowhere yet. Type [[ to link.</div> : null}
      {outUnique.map((o, i) => (
        <button key={i} className={`nt-list-row ${o.resolved ? '' : 'is-unresolved'}`} onClick={() => n.openLink(o.link.target, path)}>
          <Icon name={o.link.embed ? 'image' : 'link'} size={12} /><span>{o.resolved ? o.resolved.replace(/\.md$/, '') : `${o.link.target} (not created)`}</span>
        </button>
      ))}
      {/* Mail, people, events and files the knowledge graph links to this note. */}
      <RelatedPanel target={{ path: onDisk(n.vault.path, path) }} testid="notes-related" />
    </div>
  );
}

export function OutlinePanel({ text, onJump }: { text: string | null; onJump: (line: number, heading: string) => void }) {
  const hs = useMemo(() => (text ? parseNote(text).headings : []), [text]);
  if (!hs.length) return <div className="nt-empty-small">No headings in this note. Start a line with # to add one.</div>;
  const min = Math.min(...hs.map((h) => h.level));
  return (
    <div className="nt-list nt-outline">
      <h3 className="nt-sec-title">Headings <span className="nt-count">{hs.length}</span></h3>
      {hs.map((h, i) => <button key={i} className="nt-list-row" style={{ ['--depth' as string]: h.level - min }} onClick={() => onJump(h.line, h.text)}>{h.text}</button>)}
    </div>
  );
}

export function LocalGraphPanel({ path }: { path: string | null }) {
  const [depth, setDepth] = useState(1);
  if (!path) return <div className="nt-empty-small">Open a note to see its neighbourhood.</div>;
  return (
    <div className="nt-localgraph">
      <label className="nt-dim">Depth <input type="range" min={1} max={3} value={depth} onChange={(e) => setDepth(Number(e.target.value))} /> {depth}</label>
      <VaultGraph center={path} depth={depth} compact />
    </div>
  );
}

export function AiPanel({ path, onInsert }: { path: string | null; onInsert: (text: string) => void }) {
  const n = useNotes();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [ans, setAns] = useState<NotesAnswer | null>(null);
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { void api.notes.settings().then((s) => setOn(s.ai)); }, []);
  const run = async (fn: () => Promise<NotesAnswer>) => { setBusy(true); setAns(null); try { setAns(await fn()); } finally { setBusy(false); } };
  if (on === false) {
    return (
      <div className="nt-ai">
        <p className="nt-dim">AI for notes is off. When on, the notes that answer a question (and nothing else) are sent to the AI you chose in Settings → AI & Brain.</p>
        <button className="btn" onClick={() => void api.notes.setSettings({ ai: true }).then(() => setOn(true))}>Turn on AI for notes</button>
      </div>
    );
  }
  return (
    <div className="nt-ai" data-testid="ai-panel">
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) void run(() => api.notes.ask(n.vault.id, q, { path: path ?? undefined })); }}>
        <textarea placeholder="Ask your notes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ask your notes" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).form?.requestSubmit(); } }} />
        <button className="btn" disabled={busy || !q.trim()}>{busy ? 'Thinking…' : 'Ask'}</button>
      </form>
      {path ? (
        <div className="nt-ai-actions">
          <button className="btn ghost sm" disabled={busy} onClick={() => void run(() => api.notes.assist(n.vault.id, path, 'summarize'))}>Summarize</button>
          <button className="btn ghost sm" disabled={busy} onClick={() => void run(() => api.notes.assist(n.vault.id, path, 'continue'))}>Continue writing</button>
          <button className="btn ghost sm" disabled={busy} onClick={() => void run(() => api.notes.assist(n.vault.id, path, 'links'))}>Suggest links</button>
          <button className="btn ghost sm" disabled={busy} onClick={() => void run(() => api.notes.assist(n.vault.id, path, 'tags'))}>Suggest tags</button>
        </div>
      ) : null}
      {ans ? (
        <div className="nt-ai-answer">
          {ans.error ? <div className="nt-base-err">{ans.error}</div> : <div className="nt-ai-text">{ans.text}</div>}
          {ans.cites.length ? (
            <div className="nt-ai-cites">
              {ans.cites.map((c) => <button key={c} className="nt-cite" onClick={() => n.open(c)}><Icon name="document" size={11} /> {c.replace(/\.md$/, '')}</button>)}
            </div>
          ) : null}
          {!ans.error && ans.text ? <button className="btn ghost sm" onClick={() => onInsert(ans.text)}>Insert into note</button> : null}
          {ans.provider ? <div className="nt-dim">Answered by {ans.provider}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
