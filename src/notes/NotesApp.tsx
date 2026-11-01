// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Notes: open any folder of Markdown files as a vault and work in it with
// tabs and split panes, a file tree, search, backlinks, an outline, tags,
// bookmarks, daily notes, templates, canvases, bases, slides, a graph and
// (when switched on) AI. Files stay plain files, so the same vault keeps
// working in other notes apps.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal, type MenuItem } from '../components/ui';
import { useStore } from '../state';
import type { NotesSettings, OpenVault, VaultInfo, NoteSnapshot } from '../../core/api-notes';
import { fuzzy } from '../../core/notes/vault';
import { formatDate } from '../../core/notes/templates';
import type { Bookmark } from '../../core/notes/config';
import { validateManifest } from '../../core/notes/plugins';
import { Ctx, kindOf, pushRecent, recentFiles, type NotesCtx } from './ctx';
import { NoteView, type ViewMode } from './NoteView';
import { CanvasView } from './CanvasView';
import { BaseView } from './BaseView';
import { VaultGraph } from './VaultGraph';
import { AiPanel, BookmarksPanel, Explorer, LinksPanel, LocalGraphPanel, OutlinePanel, RecentPanel, SearchPanel, TagsPanel } from './Panels';
import { Reading, sanitize } from './Reading';
import { PluginHost, type PluginCommand } from './plugin-host';
import type { NoteEditor } from './cm';
import { FilePreview } from '../preview/Preview';
import { splitSlides } from '../../core/notes/render';
import '../styles/notes.css';

interface Tab { id: string; path: string; mode: ViewMode; subpath?: string }
interface Pane { tabs: Tab[]; active: string }
interface Layout { panes: Pane[]; focus: number; left: string; right: string; leftOpen: boolean; rightOpen: boolean }

const GRAPH = 'graph://vault';
let tabSeq = 0;
const newTab = (path: string, mode: ViewMode = 'live', subpath?: string): Tab => ({ id: `t${Date.now().toString(36)}${++tabSeq}`, path, mode, subpath });
const emptyLayout = (): Layout => ({ panes: [{ tabs: [], active: '' }], focus: 0, left: 'files', right: 'links', leftOpen: true, rightOpen: true });

function loadLayout(vault: string): Layout {
  try {
    const l = JSON.parse(localStorage.getItem(`notes.ws.${vault}`) ?? 'null') as Layout | null;
    if (l?.panes?.length) return l;
  } catch { /* fresh */ }
  return emptyLayout();
}

// ---------------------------------------------------------------- pickers

function Picker<T>({ title, placeholder, items, label, detail, onPick, onCreate, onClose }: {
  title?: string; placeholder: string; items: T[]; label: (t: T) => string; detail?: (t: T) => string | undefined;
  onPick: (t: T, e: { mod: boolean; shift: boolean }) => void; onCreate?: (q: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const list = useMemo(() => {
    const ql = q.toLowerCase().trim();
    if (!ql) return items.slice(0, 200);
    return items.map((t) => {
      const l = label(t).toLowerCase();
      const s = l === ql ? 1000 : l.startsWith(ql) ? 500 : l.includes(ql) ? 300 - l.indexOf(ql) : fuzzy(l, ql);
      return { t, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 200).map((x) => x.t);
  }, [q, items, label]);
  useEffect(() => setSel(0), [q]);
  return (
    <div className="nt-overlay" onMouseDown={onClose}>
      <div className="nt-picker" role="dialog" aria-label={title ?? placeholder} onMouseDown={(e) => e.stopPropagation()}>
        <input autoFocus placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          if (e.key === 'Enter') {
            e.preventDefault();
            if ((e.shiftKey && onCreate) || (!list.length && onCreate && q.trim())) { onCreate!(q.trim()); onClose(); return; }
            if (list[sel]) { onPick(list[sel], { mod: e.metaKey || e.ctrlKey, shift: e.shiftKey }); onClose(); }
          }
        }} />
        <div className="nt-picker-list">
          {list.map((t, i) => (
            <button key={i} className={`nt-picker-row ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={(e) => { onPick(t, { mod: e.metaKey || e.ctrlKey, shift: e.shiftKey }); onClose(); }}>
              <span>{label(t)}</span>{detail?.(t) ? <span className="nt-dim">{detail(t)}</span> : null}
            </button>
          ))}
          {!list.length && onCreate && q.trim() ? <div className="nt-picker-row on">Enter to create “{q.trim()}”</div> : null}
        </div>
        <div className="nt-picker-help">↑↓ to move · Enter to open · Ctrl+Enter in a new tab{onCreate ? ' · Shift+Enter to create' : ''} · Esc to close</div>
      </div>
    </div>
  );
}

function Prompt({ title, initial, onOk, onClose, okLabel = 'OK' }: { title: string; initial: string; onOk: (v: string) => void; onClose: () => void; okLabel?: string }) {
  const [v, setV] = useState(initial);
  return (
    <Modal title={title} onClose={onClose} width={440}>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onOk(v.trim()); onClose(); } }}>
        <input className="nt-prompt-input" autoFocus value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => { const dot = e.target.value.lastIndexOf('.'); e.target.setSelectionRange(e.target.value.lastIndexOf('/') + 1, dot > 0 ? dot : e.target.value.length); }} aria-label={title} />
        <div className="nt-modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit">{okLabel}</button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- vault chooser

function VaultChooser({ onOpen }: { onOpen: (v: VaultInfo) => void }) {
  const [list, setList] = useState<VaultInfo[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void api.notes.vaults().then(setList); }, []);
  return (
    <div className="nt-chooser">
      <div className="nt-chooser-card">
        <div className="nt-chooser-head"><Icon name="document" size={28} /><h2>Notes</h2></div>
        <p className="nt-dim">A vault is a folder of Markdown files. Open one you already have — vaults made by other notes apps work as they are, with their links, properties, daily notes, canvases and bases — or start a new one.</p>
        {list?.length ? (
          <div className="nt-vault-list">
            {list.map((v) => (
              <div key={v.id} className="nt-vault-row">
                <button className="nt-vault-open" disabled={v.missing} onClick={() => onOpen(v)}>
                  <strong>{v.name}</strong><span className="nt-dim">{v.path}{v.missing ? ' — not found' : ''}</span>
                </button>
                <button className="nt-icon-btn" title="Remove from this list (the folder is kept)" onClick={() => void api.notes.removeVault(v.id).then(setList)}><Icon name="close" size={12} /></button>
              </div>
            ))}
          </div>
        ) : null}
        {err ? <div className="nt-base-err">{err}</div> : null}
        <div className="nt-modal-actions">
          <button className="btn" onClick={() => setCreating(true)}><Icon name="plus" size={13} /> New vault</button>
          <button className="btn primary" onClick={() => void api.notes.addVault().then((v) => v && onOpen(v)).catch((e) => setErr((e as Error).message))}><Icon name="folder" size={13} /> Open folder as vault</button>
        </div>
      </div>
      {creating ? <Prompt title="Name of the new vault" initial="Notes" okLabel="Create" onClose={() => setCreating(false)} onOk={(name) => void api.notes.createVault(name).then((v) => v && onOpen(v))} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- the page

export function NotesApp() {
  const { route, toast } = useStore();
  const [vaultId, setVaultId] = useState<string | null>(() => { try { return localStorage.getItem('notes.vault'); } catch { return null; } });
  const [vault, setVault] = useState<OpenVault | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [layout, setLayoutRaw] = useState<Layout>(emptyLayout);
  const [modal, setModal] = useState<null | { kind: string; arg?: string }>(null);
  const [searchQ, setSearchQ] = useState('');
  const [activeText, setActiveText] = useState<string | null>(null);
  const [settings, setSettings] = useState<NotesSettings | null>(null);
  const [pluginCmds, setPluginCmds] = useState<PluginCommand[]>([]);
  const editors = useRef(new Map<string, NoteEditor | null>());
  const hosts = useRef<PluginHost[]>([]);

  const setLayout = useCallback((f: (l: Layout) => Layout) => setLayoutRaw((l) => {
    const next = f(l);
    if (vaultId) try { localStorage.setItem(`notes.ws.${vaultId}`, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  }), [vaultId]);

  const openVault = useCallback(async (id: string) => {
    setError(null);
    try {
      const v = await api.notes.open(id);
      setVault(v);
      setVaultId(id);
      try { localStorage.setItem('notes.vault', id); } catch { /* ignore */ }
      setLayoutRaw(loadLayout(id));
    } catch (e) {
      setError((e as Error).message);
      setVault(null);
    }
  }, []);

  useEffect(() => { if (vaultId && !vault) void openVault(vaultId); }, [vaultId, vault, openVault]);
  useEffect(() => { void api.notes.settings().then(setSettings); }, []);
  // Follow changes on disk while the page is open; stop when it closes.
  useEffect(() => {
    if (!vault) return;
    const off = api.on('notes-changed', (e) => {
      if (e.vault !== vault.id) return;
      void api.notes.open(vault.id).then((v) => { setVault(v); setRev((r) => r + 1); });
    });
    return () => { off(); void api.notes.close(vault.id); };
  }, [vault?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    if (!vault) return;
    const v = await api.notes.open(vault.id);
    setVault(v);
    setRev((r) => r + 1);
  }, [vault]);

  const pane = layout.panes[Math.min(layout.focus, layout.panes.length - 1)];
  const activeTab = pane?.tabs.find((t) => t.id === pane.active) ?? null;
  const activePath = activeTab && activeTab.path !== GRAPH ? activeTab.path : null;

  useEffect(() => {
    if (!vault || !activePath || kindOf(activePath) !== 'note') { setActiveText(null); return; }
    let alive = true;
    void api.notes.read(vault.id, activePath).then((t) => alive && setActiveText(t));
    return () => { alive = false; };
  }, [vault, activePath, rev]);

  const open = useCallback<NotesCtx['open']>((path, opts = {}) => {
    if (vault) pushRecent(vault.id, path);
    setLayout((l) => {
      const panes = l.panes.map((p) => ({ ...p, tabs: [...p.tabs] }));
      let focus = Math.min(l.focus, panes.length - 1);
      if (opts.split) {
        if (panes.length < 2) panes.push({ tabs: [], active: '' });
        focus = l.focus === 0 ? 1 : 0;
      }
      const p = panes[focus];
      const existing = p.tabs.find((t) => t.path === path);
      const mode: ViewMode = opts.mode ?? (vault?.config.defaultViewMode === 'preview' ? 'reading' : vault?.config.livePreview === false ? 'source' : 'live');
      if (existing && !opts.newTab) {
        p.active = existing.id;
        if (opts.subpath) p.tabs = p.tabs.map((t) => (t.id === existing.id ? { ...t, subpath: opts.subpath } : t));
      } else if (opts.newTab || opts.split || !p.tabs.length) {
        const t = newTab(path, mode, opts.subpath);
        p.tabs.push(t);
        p.active = t.id;
      } else {
        // Replace the current tab (as a plain click does).
        const t = newTab(path, mode, opts.subpath);
        const i = p.tabs.findIndex((x) => x.id === p.active);
        if (i >= 0) p.tabs[i] = t; else p.tabs.push(t);
        p.active = t.id;
      }
      return { ...l, panes, focus };
    });
  }, [vault, setLayout]);

  const openLink = useCallback<NotesCtx['openLink']>((target, from, opts = {}) => {
    if (!vault) return;
    const hash = target.indexOf('#');
    const t = hash >= 0 ? target.slice(0, hash) : target;
    const sub = hash >= 0 ? target.slice(hash + 1) : undefined;
    void api.notes.resolve(vault.id, t, from).then(async (p) => {
      if (p) { open(p, { ...opts, subpath: sub }); return; }
      // A link to a note that does not exist yet creates it (where the vault puts new notes).
      const name = t.includes('/') ? t : t;
      const created = await api.notes.create(vault.id, /\.\w+$/.test(name) && !name.endsWith('.md') ? name : `${name.replace(/\.md$/, '')}.md`, '').catch(() => null);
      if (created) { await refresh(); open(created.path, opts); }
    });
  }, [vault, open, refresh]);

  const closeTab = (paneIdx: number, id: string) => setLayout((l) => {
    let panes = l.panes.map((p, i) => {
      if (i !== paneIdx) return p;
      const idx = p.tabs.findIndex((t) => t.id === id);
      const tabs = p.tabs.filter((t) => t.id !== id);
      return { tabs, active: p.active === id ? tabs[Math.max(0, idx - 1)]?.id ?? '' : p.active };
    });
    if (panes.length > 1) panes = panes.filter((p) => p.tabs.length);
    return { ...l, panes: panes.length ? panes : [{ tabs: [], active: '' }], focus: Math.min(l.focus, Math.max(0, panes.length - 1)) };
  });

  const setMode = (tabId: string, mode: ViewMode) => setLayout((l) => ({ ...l, panes: l.panes.map((p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, mode } : t)) })) }));

  const ctx: NotesCtx | null = vault ? {
    vault, files: vault.files, rev, open, openLink, refresh, toast, activePath,
    search: (q) => { setSearchQ(q); setLayout((l) => ({ ...l, left: 'search', leftOpen: true })); },
    rename: (p) => setModal({ kind: 'rename', arg: p }),
  } : null;

  // ---------------------------------------------------------------- actions

  const newFile = useCallback(async (kind: 'note' | 'folder' | 'canvas' | 'base', folder?: string, title?: string) => {
    if (!vault) return;
    if (kind === 'folder') { setModal({ kind: 'newFolder', arg: folder ?? '' }); return; }
    if (kind === 'note') {
      const p = await api.notes.newNote(vault.id, { folder, title, activePath: activePath ?? undefined });
      await refresh();
      open(p, { newTab: true });
      setModal({ kind: 'rename', arg: p });
      return;
    }
    const dir = folder ?? '';
    const base = kind === 'canvas' ? 'Untitled' : 'Untitled';
    const ext = kind === 'canvas' ? 'canvas' : 'base';
    let p = `${dir ? `${dir}/` : ''}${base}.${ext}`;
    for (let i = 1; vault.files.some((f) => f.path === p); i++) p = `${dir ? `${dir}/` : ''}${base} ${i}.${ext}`;
    await api.notes.create(vault.id, p, kind === 'canvas' ? '{\n\t"nodes":[],\n\t"edges":[]\n}' : 'views:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - file.mtime\n');
    await refresh();
    open(p, { newTab: true });
  }, [vault, activePath, refresh, open]);

  const daily = useCallback(async (period: 'day' | 'week' | 'month' = 'day', offset = 0) => {
    if (!vault) return;
    const r = await api.notes.periodic(vault.id, period, undefined, offset);
    if (r.created) await refresh();
    open(r.path);
  }, [vault, refresh, open]);

  const doRename = async (from: string, to: string) => {
    if (!vault) return;
    try {
      const r = await api.notes.rename(vault.id, from, to);
      await refresh();
      setLayout((l) => ({ ...l, panes: l.panes.map((p) => ({ ...p, tabs: p.tabs.map((t) => (t.path === from ? { ...t, path: r.to } : t.path.startsWith(`${from}/`) ? { ...t, path: r.to + t.path.slice(from.length) } : t)) })) }));
      toast(r.changed.length ? `Renamed. Links updated in ${r.changed.length} note${r.changed.length === 1 ? '' : 's'}.` : 'Renamed.');
    } catch (e) { toast((e as Error).message); }
  };

  const remove = async (p: string) => {
    if (!vault) return;
    const where = vault.config.trashOption === 'local' ? 'the vault’s .trash folder' : vault.config.trashOption === 'none' ? 'nowhere (deleted for good)' : 'the Trash';
    if (!confirm(`Move “${p}” to ${where}?`)) return;
    await api.notes.remove(vault.id, p);
    setLayout((l) => ({ ...l, panes: l.panes.map((x) => { const tabs = x.tabs.filter((t) => t.path !== p && !t.path.startsWith(`${p}/`)); return { tabs, active: tabs.some((t) => t.id === x.active) ? x.active : tabs[0]?.id ?? '' }; }) }));
    await refresh();
  };

  const toggleBookmark = async (p: string) => {
    if (!vault) return;
    const list = await api.notes.bookmarks(vault.id);
    const has = list.some((b) => b.type === 'file' && b.path === p);
    const next: Bookmark[] = has ? list.filter((b) => !(b.type === 'file' && b.path === p)) : [...list, { type: 'file', path: p, ctime: Date.now() }];
    await api.notes.setBookmarks(vault.id, next);
    setRev((r) => r + 1);
    toast(has ? 'Bookmark removed' : 'Bookmarked');
  };

  const fileMenu = (p: string, folder: boolean): MenuItem[] => folder ? [
    { label: 'New note here', icon: 'plus', run: () => void newFile('note', p) },
    { label: 'New folder here', icon: 'folder', run: () => setModal({ kind: 'newFolder', arg: p }) },
    { label: 'New canvas here', icon: 'grid', run: () => void newFile('canvas', p) },
    { label: 'Rename…', icon: 'rename', run: () => setModal({ kind: 'rename', arg: p }) },
    { label: 'Show in folder', icon: 'reveal', run: () => vault && void api.notes.reveal(vault.id, p) },
    { sep: true, label: '' },
    { label: 'Delete', icon: 'trash', run: () => void remove(p) },
  ] : [
    { label: 'Open in new tab', icon: 'plus', run: () => open(p, { newTab: true }) },
    { label: 'Open to the right', icon: 'columns', run: () => open(p, { split: true }) },
    { label: 'Rename…', icon: 'rename', run: () => setModal({ kind: 'rename', arg: p }) },
    { label: 'Bookmark', icon: 'star', run: () => void toggleBookmark(p) },
    ...(kindOf(p) === 'note' ? [
      { label: 'Merge into another note…', icon: 'link', run: () => setModal({ kind: 'merge', arg: p }) },
      { label: 'File history…', icon: 'history', run: () => setModal({ kind: 'snapshots', arg: p }) },
      { label: 'Publish as a website…', icon: 'globe', run: () => setModal({ kind: 'publish', arg: p }) },
    ] : []),
    { label: 'Copy link', icon: 'copy', run: () => void navigator.clipboard.writeText(`[[${p.replace(/\.md$/, '')}]]`) },
    { label: 'Show in folder', icon: 'reveal', run: () => vault && void api.notes.reveal(vault.id, p) },
    { sep: true, label: '' },
    { label: 'Delete', icon: 'trash', run: () => void remove(p) },
  ];

  const insertText = (text: string) => {
    const ed = activeTab ? editors.current.get(activeTab.id) : null;
    if (ed) { const at = ed.view.state.selection.main.head; ed.view.dispatch({ changes: { from: at, insert: text } }); ed.view.focus(); }
    else toast('Open a note in Live or Source view to insert.');
  };

  // Plugins the person turned on (sandboxed workers).
  useEffect(() => {
    if (!vault) return;
    let alive = true;
    void api.notes.plugins(vault.id).then(async (pl) => {
      for (const p of pl.keeper.filter((x) => x.enabled)) {
        const m = validateManifest(p);
        if (!m.ok || !alive) continue;
        const code = await api.notes.pluginCode(p.id).catch(() => '');
        const host = new PluginHost(m.manifest, code, p.granted, {
          list: async () => vault.files.map((f) => f.path),
          read: (path) => api.notes.read(vault.id, path),
          write: async (path, t) => { await api.notes.write(vault.id, path, t); },
          create: async (path, t) => { await api.notes.create(vault.id, path, t); },
          search: async (q) => (await api.notes.search(vault.id, q, { limit: 50 })).map((h) => h.path),
          notice: (t) => toast(t),
          getSelection: () => { const ed = [...editors.current.values()].find(Boolean); return ed ? ed.view.state.sliceDoc(ed.view.state.selection.main.from, ed.view.state.selection.main.to) : ''; },
          replaceSelection: (t) => { const ed = [...editors.current.values()].find(Boolean); if (ed) ed.view.dispatch(ed.view.state.replaceSelection(t)); },
        }, () => setPluginCmds(hosts.current.flatMap((h) => h.commands)), (e) => toast(e));
        hosts.current.push(host);
      }
    });
    return () => { alive = false; hosts.current.forEach((h) => h.stop()); hosts.current = []; setPluginCmds([]); };
  }, [vault?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const commands = useMemo(() => {
    const ed = activeTab ? editors.current.get(activeTab.id) : null;
    const list: { id: string; name: string; run: () => void }[] = [
      { id: 'switcher', name: 'Open note… (Ctrl+O)', run: () => setModal({ kind: 'switcher' }) },
      { id: 'new', name: 'New note (Ctrl+N)', run: () => void newFile('note') },
      { id: 'canvas', name: 'New canvas', run: () => void newFile('canvas') },
      { id: 'base', name: 'New base', run: () => void newFile('base') },
      { id: 'daily', name: 'Open today’s daily note', run: () => void daily('day') },
      { id: 'yesterday', name: 'Open yesterday’s daily note', run: () => void daily('day', -1) },
      { id: 'tomorrow', name: 'Open tomorrow’s daily note', run: () => void daily('day', 1) },
      { id: 'weekly', name: 'Open this week’s note', run: () => void daily('week') },
      { id: 'monthly', name: 'Open this month’s note', run: () => void daily('month') },
      { id: 'search', name: 'Search in all notes (Ctrl+Shift+F)', run: () => setLayout((l) => ({ ...l, left: 'search', leftOpen: true })) },
      { id: 'graph', name: 'Open graph view', run: () => open(GRAPH, { newTab: true }) },
      { id: 'random', name: 'Open a random note', run: () => vault && void api.notes.random(vault.id).then((p) => p && open(p)) },
      { id: 'split', name: 'Split right', run: () => activePath && open(activePath, { split: true }) },
      { id: 'reading', name: 'Toggle reading view (Ctrl+E)', run: () => activeTab && setMode(activeTab.id, activeTab.mode === 'reading' ? 'live' : 'reading') },
      { id: 'source', name: 'Toggle live preview / source mode', run: () => activeTab && setMode(activeTab.id, activeTab.mode === 'source' ? 'live' : 'source') },
      { id: 'template', name: 'Insert template…', run: () => setModal({ kind: 'template' }) },
      { id: 'date', name: 'Insert today’s date', run: () => vault && insertText(formatDate(new Date(), vault.config.templates.dateFormat)) },
      { id: 'time', name: 'Insert current time', run: () => vault && insertText(formatDate(new Date(), vault.config.templates.timeFormat)) },
      { id: 'slides', name: 'Start presentation (slides)', run: () => activePath && setModal({ kind: 'slides', arg: activePath }) },
      { id: 'publish', name: 'Publish notes as a website…', run: () => setModal({ kind: 'publish', arg: activePath ?? '' }) },
      { id: 'history', name: 'File recovery: earlier versions of this note', run: () => activePath && setModal({ kind: 'snapshots', arg: activePath }) },
      { id: 'merge', name: 'Merge this note into another…', run: () => activePath && setModal({ kind: 'merge', arg: activePath }) },
      { id: 'extract', name: 'Extract selection into a new note', run: () => ed && activePath && setModal({ kind: 'extract', arg: activePath }) },
      { id: 'rename', name: 'Rename this file', run: () => activePath && setModal({ kind: 'rename', arg: activePath }) },
      { id: 'bookmark', name: 'Bookmark this file', run: () => activePath && void toggleBookmark(activePath) },
      { id: 'ask', name: 'Ask your notes (AI)', run: () => setLayout((l) => ({ ...l, right: 'ai', rightOpen: true })) },
      { id: 'settings', name: 'Notes settings', run: () => setModal({ kind: 'settings' }) },
      { id: 'vaults', name: 'Open another vault…', run: () => { setVault(null); setVaultId(null); try { localStorage.removeItem('notes.vault'); } catch { /* ignore */ } } },
      { id: 'workspace-save', name: 'Save this layout as a workspace…', run: () => setModal({ kind: 'saveWs' }) },
      { id: 'workspace-load', name: 'Load a workspace…', run: () => setModal({ kind: 'loadWs' }) },
      ...pluginCmds.map((c) => ({ id: `plugin:${c.plugin}:${c.id}`, name: c.name, run: () => hosts.current.find((h) => h.manifest.id === c.plugin)?.run(c.id) })),
    ];
    return list;
  }, [activeTab, activePath, vault, pluginCmds, newFile, daily, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shortcuts while the Notes page is open.
  useEffect(() => {
    if (!vault) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'o' && !e.shiftKey) { e.preventDefault(); setModal({ kind: 'switcher' }); }
      else if (k === 'p' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); setModal({ kind: 'palette' }); }
      else if (k === 'n' && !e.shiftKey) { e.preventDefault(); void newFile('note'); }
      else if (k === 'f' && e.shiftKey) { e.preventDefault(); setLayout((l) => ({ ...l, left: 'search', leftOpen: true })); }
      else if (k === 'e' && !e.shiftKey && activeTab) { e.preventDefault(); setMode(activeTab.id, activeTab.mode === 'reading' ? 'live' : 'reading'); }
      else if (k === 'w' && !e.shiftKey && activeTab) { e.preventDefault(); e.stopPropagation(); closeTab(layout.focus, activeTab.id); }
      else if (k === 'd' && e.shiftKey) { e.preventDefault(); void daily('day'); }
      else if (k === 'g' && !e.shiftKey && e.altKey) { e.preventDefault(); open(GRAPH, { newTab: true }); }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  });

  // keeper://notes?…  and the sidebar's quick links
  useEffect(() => {
    if (!vault || !route.arg) return;
    if (route.arg === 'today') void daily('day');
    else if (route.arg === 'graph') open(GRAPH, { newTab: true });
    else if (route.arg.startsWith('open:')) open(route.arg.slice(5));
  }, [route.arg, vault?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!vault || !ctx) {
    return (
      <div className="nt-root">
        {error ? <div className="nt-base-err" style={{ margin: 16 }}>{error}</div> : null}
        <VaultChooser onOpen={(v) => void openVault(v.id)} />
      </div>
    );
  }

  const renderTab = (t: Tab, active: boolean) => {
    if (t.path === GRAPH) return <VaultGraph />;
    const k = kindOf(t.path);
    if (!vault.files.some((f) => f.path === t.path)) return <div className="nt-empty">“{t.path}” is not in the vault any more.</div>;
    if (k === 'note') return <NoteView key={t.id} path={t.path} mode={t.mode} setMode={(m) => setMode(t.id, m)} subpath={t.subpath} active={active} onEditor={(e) => { editors.current.set(t.id, e); }} />;
    if (k === 'canvas') return <CanvasView path={t.path} />;
    if (k === 'base') return <BaseView path={t.path} />;
    return <div className="nt-file-view"><FilePreview path={`${vault.path}/${t.path}`} /></div>;
  };

  const L = layout;
  return (
    <Ctx.Provider value={ctx}>
      <div className="nt-root" data-testid="notes-root">
        <div className="nt-ribbon" aria-label="Notes tools">
          <button className="nt-icon-btn" title="Show or hide the file panel" onClick={() => setLayout((l) => ({ ...l, leftOpen: !l.leftOpen }))}><Icon name="columns" size={15} /></button>
          <button className="nt-icon-btn" title="Open note (Ctrl+O)" aria-label="Quick switcher" onClick={() => setModal({ kind: 'switcher' })}><Icon name="search" size={15} /></button>
          <button className="nt-icon-btn" title="Today’s daily note (Ctrl+Shift+D)" aria-label="Daily note" onClick={() => void daily('day')}><Icon name="calendar" size={15} /></button>
          <button className="nt-icon-btn" title="Graph view" aria-label="Graph view" onClick={() => open(GRAPH, { newTab: true })}><Icon name="graph" size={15} /></button>
          <button className="nt-icon-btn" title="New canvas" onClick={() => void newFile('canvas')}><Icon name="grid" size={15} /></button>
          <button className="nt-icon-btn" title="Random note" onClick={() => void api.notes.random(vault.id).then((p) => p && open(p))}><Icon name="shuffle" size={15} /></button>
          <button className="nt-icon-btn" title="Commands (Ctrl+P)" aria-label="Commands" onClick={() => setModal({ kind: 'palette' })}><Icon name="terminal" size={15} /></button>
          <span className="nt-spacer" />
          <button className="nt-icon-btn" title="Notes settings" aria-label="Notes settings" onClick={() => setModal({ kind: 'settings' })}><Icon name="settings" size={15} /></button>
        </div>
        {L.leftOpen ? (
          <aside className="nt-left">
            <div className="nt-vault-name" title={vault.path}>
              <button onClick={() => { setVault(null); setVaultId(null); try { localStorage.removeItem('notes.vault'); } catch { /* ignore */ } }} title="Switch vault"><Icon name="chevronDown" size={11} /> {vault.name}</button>
            </div>
            <div className="nt-panel-tabs" role="tablist">
              {[['files', 'folder', 'Files'], ['search', 'search', 'Search'], ['bookmarks', 'star', 'Bookmarks'], ['tags', 'tag', 'Tags'], ['recent', 'clock', 'Recent']].map(([id, icon, label]) => (
                <button key={id} role="tab" aria-selected={L.left === id} aria-label={label} title={label} className={L.left === id ? 'on' : ''} onClick={() => setLayout((l) => ({ ...l, left: id }))}><Icon name={icon} size={14} /></button>
              ))}
            </div>
            <div className="nt-panel-body">
              {L.left === 'files' ? <Explorer onNew={(k, f) => void newFile(k, f || undefined)} onMenu={fileMenu} />
                : L.left === 'search' ? <SearchPanel query={searchQ} setQuery={setSearchQ} />
                : L.left === 'bookmarks' ? <BookmarksPanel />
                : L.left === 'tags' ? <TagsPanel />
                : <RecentPanel />}
            </div>
          </aside>
        ) : null}
        <main className={`nt-main panes-${L.panes.length}`}>
          {L.panes.map((p, pi) => (
            <section key={pi} className={`nt-pane ${pi === L.focus ? 'is-focus' : ''}`} onMouseDown={() => pi !== L.focus && setLayout((l) => ({ ...l, focus: pi }))}>
              <div className="nt-tabs" role="tablist">
                {p.tabs.map((t) => (
                  <div key={t.id} role="tab" aria-selected={t.id === p.active} className={`nt-tab ${t.id === p.active ? 'on' : ''}`} onClick={() => setLayout((l) => ({ ...l, focus: pi, panes: l.panes.map((x, i) => (i === pi ? { ...x, active: t.id } : x)) }))} onAuxClick={(e) => e.button === 1 && closeTab(pi, t.id)} title={t.path}>
                    <span className={`nt-kind kind-${t.path === GRAPH ? 'graph' : kindOf(t.path)}`} />
                    <span className="nt-tab-name">{t.path === GRAPH ? 'Graph' : t.path.split('/').pop()!.replace(/\.md$/, '')}</span>
                    <button className="nt-tab-x" aria-label="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(pi, t.id); }}>×</button>
                  </div>
                ))}
                <button className="nt-icon-btn nt-tab-new" title="New note" aria-label="New tab" onClick={() => void newFile('note')}><Icon name="plus" size={13} /></button>
                <span className="nt-spacer" />
                {pi === L.panes.length - 1 ? <button className="nt-icon-btn" title="Show or hide the side panel" onClick={() => setLayout((l) => ({ ...l, rightOpen: !l.rightOpen }))}><Icon name="columns" size={14} /></button> : null}
              </div>
              <div className="nt-pane-body">
                {p.tabs.length ? p.tabs.map((t) => (
                  <div key={t.id} className="nt-tab-body" style={{ display: t.id === p.active ? undefined : 'none' }}>
                    {t.id === p.active || kindOf(t.path) === 'note' ? renderTab(t, pi === L.focus && t.id === p.active) : null}
                  </div>
                )) : (
                  <div className="nt-empty-pane">
                    <button className="btn" onClick={() => void newFile('note')}>New note <kbd>Ctrl N</kbd></button>
                    <button className="btn" onClick={() => setModal({ kind: 'switcher' })}>Open note <kbd>Ctrl O</kbd></button>
                    <button className="btn" onClick={() => void daily('day')}>Today’s note</button>
                    <div className="nt-dim">{vault.files.length.toLocaleString()} files · read in {vault.took} ms</div>
                  </div>
                )}
              </div>
            </section>
          ))}
        </main>
        {L.rightOpen ? (
          <aside className="nt-right">
            <div className="nt-panel-tabs" role="tablist">
              {[['links', 'link', 'Links'], ['outline', 'list', 'Outline'], ['graph', 'graph', 'Local graph'], ['ai', 'sparkle', 'Ask AI']].map(([id, icon, label]) => (
                <button key={id} role="tab" aria-selected={L.right === id} aria-label={label} title={label} className={L.right === id ? 'on' : ''} onClick={() => setLayout((l) => ({ ...l, right: id }))}><Icon name={icon} size={14} /></button>
              ))}
            </div>
            <div className="nt-panel-body">
              {L.right === 'links' ? <LinksPanel path={activePath && kindOf(activePath) === 'note' ? activePath : null} />
                : L.right === 'outline' ? <OutlinePanel text={activeText} onJump={(_line, h) => activePath && open(activePath, { subpath: h })} />
                : L.right === 'graph' ? <LocalGraphPanel path={activePath} />
                : <AiPanel path={activePath && kindOf(activePath) === 'note' ? activePath : null} onInsert={insertText} />}
            </div>
          </aside>
        ) : null}

        {modal?.kind === 'switcher' ? (
          <Picker placeholder="Find or create a note…" items={[...recentFiles(vault.id).filter((p) => vault.files.some((f) => f.path === p)), ...vault.files.map((f) => f.path).filter((p) => !recentFiles(vault.id).includes(p))]}
            label={(p) => p.replace(/\.md$/, '')} detail={(p) => (kindOf(p) !== 'note' ? kindOf(p) : undefined)}
            onPick={(p, e) => open(p, { newTab: e.mod })} onCreate={(q) => void newFile('note', undefined, q).then(() => setModal(null))} onClose={() => setModal((m) => (m?.kind === 'switcher' ? null : m))} />
        ) : null}
        {modal?.kind === 'palette' ? <Picker placeholder="Type a command…" items={commands} label={(c) => c.name} onPick={(c) => setTimeout(c.run)} onClose={() => setModal((m) => (m?.kind === 'palette' ? null : m))} /> : null}
        {modal?.kind === 'merge' ? <Picker placeholder={`Merge “${modal.arg}” into…`} items={vault.files.filter((f) => kindOf(f.path) === 'note' && f.path !== modal.arg).map((f) => f.path)} label={(p) => p.replace(/\.md$/, '')} onPick={(p) => void api.notes.merge(vault.id, modal.arg!, p).then(async () => { await refresh(); open(p); toast('Merged.'); })} onClose={() => setModal(null)} /> : null}
        {modal?.kind === 'template' ? <TemplatePicker vault={vault} onPick={async (tpl) => { if (activePath) insertText(await api.notes.fillTemplate(vault.id, tpl, activePath)); }} onClose={() => setModal(null)} /> : null}
        {modal?.kind === 'loadWs' ? <Picker placeholder="Load workspace…" items={Object.keys(settings?.workspaces ?? {}).filter((k) => k.startsWith(`${vault.id}:`))} label={(k) => k.slice(vault.id.length + 1)} onPick={(k) => setLayout(() => (settings!.workspaces![k] as Layout))} onClose={() => setModal(null)} /> : null}
        {modal?.kind === 'saveWs' ? <Prompt title="Name for this workspace" initial="My layout" okLabel="Save" onClose={() => setModal(null)} onOk={(name) => void api.notes.setSettings({ workspaces: { ...(settings?.workspaces ?? {}), [`${vault.id}:${name}`]: layout } }).then(setSettings)} /> : null}
        {modal?.kind === 'rename' ? <Prompt title="Rename" initial={modal.arg!.replace(/\.md$/, '')} okLabel="Rename" onClose={() => setModal(null)} onOk={(v) => void doRename(modal.arg!, kindOf(modal.arg!) === 'note' && !/\.md$/.test(v) ? `${v}.md` : v)} /> : null}
        {modal?.kind === 'newFolder' ? <Prompt title="New folder" initial={modal.arg ? `${modal.arg}/New folder` : 'New folder'} okLabel="Create" onClose={() => setModal(null)} onOk={(v) => void api.notes.createFolder(vault.id, v).then(refresh)} /> : null}
        {modal?.kind === 'extract' ? <Prompt title="Name of the new note" initial="Extracted" okLabel="Extract" onClose={() => setModal(null)} onOk={(title) => {
          const ed = activeTab ? editors.current.get(activeTab.id) : null;
          if (!ed || !activePath) return;
          const r = ed.view.state.selection.main;
          if (r.empty) { toast('Select some text first.'); return; }
          void api.notes.extract(vault.id, activePath, r.from, r.to, title).then(async (p) => { await refresh(); setRev((x) => x + 1); toast(`Moved to ${p}`); });
        }} /> : null}
        {modal?.kind === 'snapshots' ? <Snapshots vault={vault} path={modal.arg!} toast={toast} bump={() => setRev((r) => r + 1)} onClose={() => setModal(null)} /> : null}
        {modal?.kind === 'publish' ? <Publish vault={vault} toast={toast} initial={modal.arg ? [modal.arg] : []} onClose={() => setModal(null)} /> : null}
        {modal?.kind === 'slides' ? <Slides vault={vault} path={modal.arg!} onClose={() => setModal(null)} /> : null}
        {modal?.kind === 'settings' && settings ? <NotesSettingsModal settings={settings} onChange={(s) => void api.notes.setSettings(s).then(setSettings)} onClose={() => setModal(null)} /> : null}
      </div>
    </Ctx.Provider>
  );

}

function TemplatePicker({ vault, onPick, onClose }: { vault: OpenVault; onPick: (tpl: string) => void; onClose: () => void }) {
  const [list, setList] = useState<string[] | null>(null);
  useEffect(() => { void api.notes.templates(vault.id).then(setList); }, []);
  if (list && !list.length) return <Modal title="Templates" onClose={onClose}><p className="nt-dim">No templates. Set a template folder in the vault’s settings (templates.json) or put notes in a “Templates” folder and choose it in Notes settings.</p></Modal>;
  return <Picker placeholder="Insert template…" items={list ?? []} label={(p) => p.replace(/\.md$/, '')} onPick={(p) => onPick(p)} onClose={onClose} />;
}

function Snapshots({ vault, path, onClose, toast, bump }: { vault: OpenVault; path: string; onClose: () => void; toast: (t: string) => void; bump: () => void }) {
  const [list, setList] = useState<NoteSnapshot[]>([]);
  const [sel, setSel] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => { void api.notes.snapshots(vault.id, path).then(setList); }, [path]);
  return (
    <Modal title={`Earlier versions of ${path.replace(/\.md$/, '')}`} onClose={onClose} width={820}>
      <div className="nt-snaps">
        <div className="nt-snap-list">
          {list.length ? list.map((s) => <button key={s.id} className={sel?.id === s.id ? 'on' : ''} onClick={() => void api.notes.snapshot(vault.id, path, s.id).then((text) => setSel({ id: s.id, text }))}>{new Date(s.at).toLocaleString()}{s.by ? ` · ${s.by}` : ''}</button>) : <p className="nt-dim">No earlier versions yet. Keeper keeps a copy every few minutes while you edit, and before any change an AI agent makes.</p>}
        </div>
        <pre className="nt-snap-text">{sel?.text ?? ''}</pre>
      </div>
      <div className="nt-modal-actions">
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn primary" disabled={!sel} onClick={() => sel && void api.notes.write(vault.id, path, sel.text).then(() => { bump(); toast('Restored.'); onClose(); })}>Restore this version</button>
      </div>
    </Modal>
  );
}

function Publish({ vault, initial, onClose, toast }: { vault: OpenVault; initial: string[]; onClose: () => void; toast: (t: string) => void }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set(initial.filter(Boolean)));
  const [q, setQ] = useState('');
  const notes = vault.files.filter((f) => kindOf(f.path) === 'note' && f.path.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="Publish as a website" onClose={onClose} width={560}>
      <p className="nt-dim">Chosen notes become plain web pages (no scripts) in a folder you pick, ready for any web host. Links between published notes keep working; links to other notes become plain text.</p>
      <input className="nt-prompt-input" placeholder="Filter notes" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="nt-publish-list">
        {notes.map((f) => <label key={f.path}><input type="checkbox" checked={chosen.has(f.path)} onChange={(e) => setChosen((s) => { const x = new Set(s); if (e.target.checked) x.add(f.path); else x.delete(f.path); return x; })} /> {f.path.replace(/\.md$/, '')}</label>)}
      </div>
      <div className="nt-modal-actions">
        <button className="btn" onClick={() => setChosen(new Set(notes.map((f) => f.path)))}>Choose all shown</button>
        <span className="nt-spacer" />
        <button className="btn primary" disabled={!chosen.size} onClick={() => void api.notes.publish(vault.id, [...chosen]).then((r) => { if (r) { toast(`Published ${chosen.size} notes to ${r.out}`); onClose(); } })}>Publish {chosen.size || ''}</button>
      </div>
    </Modal>
  );
}

function Slides({ vault, path, onClose }: { vault: OpenVault; path: string; onClose: () => void }) {
  const [slides, setSlides] = useState<string[]>([]);
  const [i, setI] = useState(0);
  useEffect(() => { void api.notes.read(vault.id, path).then((t) => setSlides(splitSlides(t))); }, [path]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) setI((x) => Math.min(slides.length - 1, x + 1));
      if (['ArrowLeft', 'PageUp'].includes(e.key)) setI((x) => Math.max(0, x - 1));
      if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [slides.length, onClose]);
  return (
    <div className="nt-slides" onClick={() => setI((x) => Math.min(slides.length - 1, x + 1))}>
      {slides.length ? <div className="nt-slide"><Reading path={path} text={slides[i]} /></div> : null}
      <div className="nt-slide-count">{i + 1} / {slides.length} · Esc to leave</div>
    </div>
  );
}

function NotesSettingsModal({ settings, onChange, onClose }: { settings: NotesSettings; onChange: (s: Partial<NotesSettings>) => void; onClose: () => void }) {
  const row = (label: string, help: string, on: boolean, set: (v: boolean) => void) => (
    <label className="nt-setting"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /><span><strong>{label}</strong><span className="nt-dim">{help}</span></span></label>
  );
  return (
    <Modal title="Notes settings" onClose={onClose} width={560}>
      {row('AI for notes', 'Ask your vault, summarize, continue writing, suggest links and tags. Only the notes needed for each request are sent to the AI chosen in Settings → AI & Brain.', settings.ai, (v) => onChange({ ai: v }))}
      {row('Let AI agents edit notes', 'Agents connected to Keeper may change notes through `keeper/notes`. The version before each change is kept in file recovery.', settings.agentsCanEdit, (v) => onChange({ agentsCanEdit: v }))}
      {row('Vim keys', 'Use vim key bindings in the editor (the vault’s own setting is also honoured).', !!settings.vim, (v) => onChange({ vim: v }))}
      {row('Spellcheck', 'Underline misspelled words while you type.', settings.spellcheck !== false, (v) => onChange({ spellcheck: v }))}
      <label className="nt-setting"><span><strong>File recovery</strong><span className="nt-dim">Keep a copy of a note every</span></span>
        <input type="number" min={1} max={120} value={settings.snapshotMinutes} onChange={(e) => onChange({ snapshotMinutes: Math.max(1, Number(e.target.value)) })} /> minutes, for
        <input type="number" min={1} max={365} value={settings.snapshotDays} onChange={(e) => onChange({ snapshotDays: Math.max(1, Number(e.target.value)) })} /> days
      </label>
      <p className="nt-dim">Encrypted notes: put a vault (or a folder of it) in a locked folder (Tools → Lock Folders); it opens here while unlocked. Syncing: a vault is an ordinary folder, so Keeper Sync can keep it in step between your devices.</p>
      <p className="nt-dim">Plugins: community plugins written for other notes apps are listed but never run — they get full access to your computer. Keeper plugins run in a sandbox and only do what you allow. See docs/NOTES.md.</p>
      <div className="nt-modal-actions"><button className="btn primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

export { sanitize };
