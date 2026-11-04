// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Notes: open any folder of Markdown files as a vault and work in it with
// tabs and split panes, a file tree, search, backlinks, an outline, tags,
// bookmarks, daily notes, templates, canvases, bases, slides, a graph and
// (when switched on) AI. Files stay plain files, so the same vault keeps
// working in other notes apps.

import { openSendTo } from '../components/SendTo';
import { Learn } from '../components/Learn';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ContextMenu, Modal, type MenuItem } from '../components/ui';
import { useStore } from '../state';
import type { NotesSettings, OpenVault, VaultInfo, NoteSnapshot } from '../../core/api-notes';
import { fuzzy } from '../../core/notes/vault';
import { formatDate } from '../../core/notes/templates';
import type { Bookmark } from '../../core/notes/config';
import { validateManifest } from '../../core/notes/plugins';
import { Ctx, kindOf, pushRecent, recentFiles, type NotesCtx } from './ctx';
import { NoteView, type NoteHandle, type ViewMode } from './NoteView';
import { NotesArt } from './art';
import { ExportDialog, ImportDialog } from './ImportExport';
import { newMindmapText } from '../../core/notes/mindmap';
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

interface Tab { id: string; path: string; mode: ViewMode; subpath?: string; /** the view was not chosen: a mind map note may switch to its map */ auto?: boolean }
interface Pane { tabs: Tab[]; active: string }
interface Layout { panes: Pane[]; focus: number; left: string; right: string; leftOpen: boolean; rightOpen?: boolean; /** the view to go back to after a search */ lastLeft?: string }

const GRAPH = 'graph://vault';
let tabSeq = 0;
const newTab = (path: string, mode: ViewMode = 'live', subpath?: string, auto = false): Tab => ({ id: `t${Date.now().toString(36)}${++tabSeq}`, path, mode, subpath, auto: auto || undefined });
const emptyLayout = (): Layout => ({ panes: [{ tabs: [], active: '' }], focus: 0, left: 'files', right: 'links', leftOpen: true });

/** The side panel (links, outline, graph, AI): remembered; closed at first on narrower windows. */
const NARROW = 1180;
const inspectorKey = (narrow: boolean) => `notes.inspector.${narrow ? 'narrow' : 'wide'}`;
function inspectorPref(narrow: boolean): boolean {
  try { const v = localStorage.getItem(inspectorKey(narrow)); if (v === '1' || v === '0') return v === '1'; } catch { /* no storage */ }
  return !narrow && window.innerWidth >= 1360;
}

function useWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => { const f = () => setW(window.innerWidth); addEventListener('resize', f); return () => removeEventListener('resize', f); }, []);
  return w;
}

function loadLayout(vault: string): Layout {
  try {
    const l = JSON.parse(localStorage.getItem(`notes.ws.${vault}`) ?? 'null') as Layout | null;
    if (l?.panes?.length) return { ...l, left: l.left === 'search' ? l.lastLeft ?? 'files' : l.left };
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

// ---------------------------------------------------------------- pictures and empty states

function VaultChooser({ onOpen, error }: { onOpen: (v: VaultInfo) => void; error: string | null }) {
  const [list, setList] = useState<VaultInfo[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(error);
  useEffect(() => { void api.notes.vaults().then(setList); }, []);
  useEffect(() => setErr(error), [error]);
  const first = list !== null && !list.length;
  return (
    <div className="nt-chooser">
      <section className="nt-chooser-card nt-panel" aria-labelledby="nt-chooser-title">
        <NotesArt />
        <div className="nt-kicker">Notes</div>
        <h2 id="nt-chooser-title">{first ? <>Your notes, as <em>plain</em> files</> : 'Choose a vault'}</h2>
        <p className="nt-lead">A vault is a folder of Markdown notes. Vaults from other notes apps open as they are.</p>
        {list?.length ? (
          <div className="nt-vault-list" role="list">
            {list.map((v) => (
              <div key={v.id} className="nt-vault-row" role="listitem">
                <button className="nt-vault-open" disabled={v.missing} onClick={() => onOpen(v)}>
                  <span className="nt-vault-mark" aria-hidden>{v.name.slice(0, 1).toUpperCase()}</span>
                  <span className="nt-vault-text"><strong>{v.name}</strong><span className="nt-dim">{v.missing ? 'Folder not found' : v.path}</span></span>
                  <Icon name="chevronRight" size={14} />
                </button>
                <button className="nt-icon-btn" title="Remove from this list (the folder is kept)" aria-label={`Remove ${v.name} from this list`} onClick={() => void api.notes.removeVault(v.id).then(setList)}><Icon name="close" size={12} /></button>
              </div>
            ))}
          </div>
        ) : null}
        {err ? <div className="nt-base-err" role="alert"><Icon name="warning" size={13} /> {err}</div> : null}
        <div className="nt-chooser-actions">
          <button className={`btn ${first ? 'primary' : ''}`} onClick={() => setCreating(true)}><Icon name="plus" size={13} /> New vault</button>
          <button className={`btn ${first ? '' : 'primary'}`} onClick={() => void api.notes.addVault().then((v) => v && onOpen(v)).catch((e) => setErr((e as Error).message))}><Icon name="folder" size={13} /> Open folder as vault</button>
        </div>
        <div className="nt-trust">On this computer · Plain Markdown · Works with other notes apps</div>
      </section>
      {creating ? <Prompt title="Name of the new vault" initial="Notes" okLabel="Create" onClose={() => setCreating(false)} onOk={(name) => void api.notes.createVault(name).then((v) => v && onOpen(v))} /> : null}
    </div>
  );
}

function EmptyPane({ count, onNew, onOpen, onToday, onImport }: { count: number; onNew: () => void; onOpen: () => void; onToday: () => void; onImport: () => void }) {
  return (
    <section className="nt-empty-pane" aria-labelledby="nt-empty-title">
      <NotesArt />
      <h2 id="nt-empty-title">{count ? <>Pick up where you <em>left</em> off</> : <>Write your <em>first</em> note</>}</h2>
      <p className="nt-lead">{count ? 'Open a note, or start a new one.' : 'Or bring your notes from another app.'}</p>
      <div className="nt-empty-actions">
        <button className="btn primary" onClick={onNew}><Icon name="plus" size={13} /> New note <kbd>Ctrl N</kbd></button>
        {count ? <button className="btn" onClick={onOpen}><Icon name="search" size={13} /> Open note <kbd>Ctrl O</kbd></button> : null}
        <button className="btn ghost" onClick={onToday}><Icon name="calendar" size={13} /> Today’s note</button>
        <button className="btn ghost" onClick={onImport}><Icon name="importIn" size={13} /> Import notes…</button>
      </div>
      <div className="nt-trust">{count.toLocaleString()} note{count === 1 ? '' : 's'} · On this computer · Plain Markdown files</div>
    </section>
  );
}

function Gone({ path, onClose }: { path: string; onClose: () => void }) {
  return (
    <section className="nt-empty-pane is-small" role="status">
      <h2>Not here any more</h2>
      <p className="nt-lead">“{path.replace(/\.md$/, '')}” is not in the vault any more.</p>
      <div className="nt-empty-actions"><button className="btn" onClick={onClose}>Close tab</button></div>
    </section>
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
  const handles = useRef(new Map<string, NoteHandle | null>());
  const searchBox = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; label: string } | null>(null);
  const [sort, setSort] = useState<'name' | 'modified'>('name');
  const [collapse, setCollapse] = useState(0);
  const [recording, setRecording] = useState(false);
  const width = useWidth();
  const narrow = width < NARROW;
  // Wide and narrow windows remember the side panel separately, so making the window smaller never covers the note by surprise.
  const [inspector, setInspectorRaw] = useState(() => inspectorPref(narrow));
  useEffect(() => setInspectorRaw(inspectorPref(narrow)), [narrow]);
  const setInspector = useCallback((on: boolean) => { setInspectorRaw(on); try { localStorage.setItem(inspectorKey(window.innerWidth < NARROW), on ? '1' : '0'); } catch { /* ignore */ } }, []);
  const findIn = useCallback((q?: string) => {
    if (q !== undefined) setSearchQ(q);
    setLayoutRaw((l) => ({ ...l, leftOpen: true, left: 'search', lastLeft: l.left === 'search' ? l.lastLeft : l.left }));
    setTimeout(() => searchBox.current?.focus());
  }, []);
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
    void api.notes.read(vault.id, activePath).then((t) => alive && setActiveText(t)).catch(() => alive && setActiveText(null));
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
        const t = newTab(path, mode, opts.subpath, !opts.mode);
        p.tabs.push(t);
        p.active = t.id;
      } else {
        // Replace the current tab (as a plain click does).
        const t = newTab(path, mode, opts.subpath, !opts.mode);
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

  const setMode = (tabId: string, mode: ViewMode) => setLayout((l) => ({ ...l, panes: l.panes.map((p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, mode, auto: undefined } : t)) })) }));

  const ctx: NotesCtx | null = vault ? {
    vault, files: vault.files, rev, open, openLink, refresh, toast, activePath,
    search: (q) => findIn(q),
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

  const newMindmap = useCallback(async () => {
    if (!vault) return;
    const p = await api.notes.newNote(vault.id, { title: 'Mind map', activePath: activePath ?? undefined, text: newMindmapText('Mind map') });
    await refresh();
    open(p, { newTab: true, mode: 'map' });
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
    ...(vault ? [{ label: 'Send to…', icon: 'send', run: () => void api.notes.read(vault.id, p).catch(() => '').then((text) => openSendTo({ kind: kindOf(p) === 'note' ? 'note' : 'file', title: p.split('/').pop()!.replace(/\.md$/, ''), text: text.slice(0, 4000), paths: [`${vault.path}/${p}`], link: `keeper://notes?open=${encodeURIComponent(p)}` })) }] : []),
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
      { id: 'mindmap', name: 'New mind map', run: () => void newMindmap() },
      { id: 'mapview', name: 'Show this note as a mind map', run: () => activeTab && setMode(activeTab.id, activeTab.mode === 'map' ? 'live' : 'map') },
      { id: 'daily', name: 'Open today’s daily note', run: () => void daily('day') },
      { id: 'yesterday', name: 'Open yesterday’s daily note', run: () => void daily('day', -1) },
      { id: 'tomorrow', name: 'Open tomorrow’s daily note', run: () => void daily('day', 1) },
      { id: 'weekly', name: 'Open this week’s note', run: () => void daily('week') },
      { id: 'monthly', name: 'Open this month’s note', run: () => void daily('month') },
      { id: 'search', name: 'Search in all notes (Ctrl+Shift+F)', run: () => findIn() },
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
      { id: 'ask', name: 'Ask your notes (AI)', run: () => { setLayout((l) => ({ ...l, right: 'ai' })); setInspector(true); } },
      { id: 'panel', name: 'Show or hide links and outline', run: () => setInspector(!inspector) },
      { id: 'collapse', name: 'Close all folders', run: () => setCollapse((c) => c + 1) },
      { id: 'settings', name: 'Notes settings', run: () => setModal({ kind: 'settings' }) },
      { id: 'import', name: 'Import notes from another app…', run: () => setModal({ kind: 'import' }) },
      { id: 'export', name: 'Export notes…', run: () => setModal({ kind: 'export', arg: activePath ?? undefined }) },
      { id: 'vaults', name: 'Open another vault…', run: () => { setVault(null); setVaultId(null); try { localStorage.removeItem('notes.vault'); } catch { /* ignore */ } } },
      { id: 'workspace-save', name: 'Save this layout as a workspace…', run: () => setModal({ kind: 'saveWs' }) },
      { id: 'workspace-load', name: 'Load a workspace…', run: () => setModal({ kind: 'loadWs' }) },
      ...pluginCmds.map((c) => ({ id: `plugin:${c.plugin}:${c.id}`, name: c.name, run: () => hosts.current.find((h) => h.manifest.id === c.plugin)?.run(c.id) })),
    ];
    return list;
  }, [activeTab, activePath, vault, pluginCmds, newFile, daily, open, inspector]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shortcuts while the Notes page is open.
  useEffect(() => {
    if (!vault) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'o' && !e.shiftKey) { e.preventDefault(); setModal({ kind: 'switcher' }); }
      else if (k === 'p' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); setModal({ kind: 'palette' }); }
      // Not with Alt: ⌥⌘N / Ctrl+Alt+N opens the page in a window of its own.
      else if (k === 'n' && !e.shiftKey && !e.altKey) { e.preventDefault(); void newFile('note'); }
      else if (k === 'f' && e.shiftKey) { e.preventDefault(); findIn(); }
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
      <div className="nt-root is-chooser">
        <VaultChooser error={error} onOpen={(v) => void openVault(v.id)} />
      </div>
    );
  }

  const renderTab = (t: Tab, active: boolean) => {
    if (t.path === GRAPH) return <VaultGraph />;
    const k = kindOf(t.path);
    if (!vault.files.some((f) => f.path === t.path)) return <Gone path={t.path} onClose={() => closeTab(layout.focus, t.id)} />;
    if (k === 'note') return <NoteView key={t.id} path={t.path} mode={t.mode} subpath={t.subpath} active={active} onEditor={(e) => { editors.current.set(t.id, e); }} onHandle={(h) => { handles.current.set(t.id, h); }} onRecording={setRecording} onWantsMap={t.auto ? () => setMode(t.id, 'map') : undefined} />;
    if (k === 'canvas') return <CanvasView path={t.path} />;
    if (k === 'base') return <BaseView path={t.path} />;
    return <div className="nt-file-view"><FilePreview path={`${vault.path}/${t.path}`} /></div>;
  };

  const L = layout;
  const showMenu = (e: React.MouseEvent, items: MenuItem[], label: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, items, label });
  };
  const switchVault = () => { setVault(null); setVaultId(null); try { localStorage.removeItem('notes.vault'); } catch { /* ignore */ } };
  const moreMenu: MenuItem[] = [
    { label: 'New folder', icon: 'folder', run: () => void newFile('folder') },
    { label: 'New canvas', icon: 'grid', run: () => void newFile('canvas') },
    { label: 'New base', icon: 'list', run: () => void newFile('base') },
    { label: 'New mind map', icon: 'mindmap', run: () => void newMindmap() },
    { sep: true, label: '' },
    { label: sort === 'name' ? 'Sort by last change' : 'Sort by name', icon: sort === 'name' ? 'clock' : 'text', run: () => setSort(sort === 'name' ? 'modified' : 'name') },
    { label: 'Close all folders', icon: 'minus', run: () => setCollapse((c) => c + 1) },
    { sep: true, label: '' },
    { label: 'Random note', icon: 'shuffle', run: () => void api.notes.random(vault.id).then((p) => p && open(p)) },
    { label: 'All commands', icon: 'terminal', kbd: 'Ctrl P', run: () => setModal({ kind: 'palette' }) },
  ];
  const vaultMenu: MenuItem[] = [
    { label: 'Import notes…', icon: 'importIn', run: () => setModal({ kind: 'import' }) },
    { label: 'Export notes…', icon: 'exportOut', run: () => setModal({ kind: 'export' }) },
    { sep: true, label: '' },
    { label: 'Switch vault…', icon: 'folder', run: switchVault },
    { label: 'Show in folder', icon: 'reveal', run: () => void api.notes.reveal(vault.id, '') },
    { sep: true, label: '' },
    { label: 'Notes settings', icon: 'settings', run: () => setModal({ kind: 'settings' }) },
  ];
  const noteMenu = (t: Tab): MenuItem[] => {
    const p = t.path;
    const h = handles.current.get(t.id);
    return [
      ...(kindOf(p) === 'note' ? [
        { label: recording ? 'Stop recording' : 'Record audio', icon: 'mic', run: () => h?.record() },
        { label: 'Present as slides', icon: 'play', run: () => setModal({ kind: 'slides', arg: p }) },
        { label: 'Earlier versions…', icon: 'history', run: () => setModal({ kind: 'snapshots', arg: p }) },
        { label: 'Export this note…', icon: 'exportOut', run: () => setModal({ kind: 'export', arg: p }) },
        { label: 'Publish as a website…', icon: 'globe', run: () => setModal({ kind: 'publish', arg: p }) },
        { sep: true, label: '' },
      ] : []),
      { label: 'Open to the right', icon: 'columns', run: () => open(p, { split: true }) },
      { label: 'Rename…', icon: 'rename', run: () => setModal({ kind: 'rename', arg: p }) },
      { label: 'Bookmark', icon: 'star', run: () => void toggleBookmark(p) },
      { label: 'Copy link', icon: 'copy', run: () => void navigator.clipboard.writeText(`[[${p.replace(/\.md$/, '')}]]`) },
      { label: 'Show in folder', icon: 'reveal', run: () => void api.notes.reveal(vault.id, p) },
      { sep: true, label: '' },
      { label: 'Delete', icon: 'trash', danger: true, run: () => void remove(p) },
    ];
  };
  const inspectorShown = inspector;
  const views: [string, string][] = [['files', 'Files'], ['tags', 'Tags'], ['bookmarks', 'Bookmarks'], ['recent', 'Recent']];
  const searching = L.left === 'search' || !!searchQ;

  return (
    <Ctx.Provider value={ctx}>
      <div className={`nt-root ${narrow ? 'is-narrow' : ''}`} data-testid="notes-root">
        {L.leftOpen ? (
          <aside className="nt-left nt-panel" aria-label="Notes in this vault">
            <div className="nt-left-head">
              <div className="nt-left-row">
                <button className="nt-vault-btn" title={`${vault.path}\nSwitch vault or open settings`} aria-haspopup="menu" onClick={(e) => showMenu(e, vaultMenu, 'Vault')}>
                  <span className="nt-vault-mark" aria-hidden>{vault.name.slice(0, 1).toUpperCase()}</span>
                  <span className="nt-vault-label">{vault.name}</span>
                  <Icon name="chevronDown" size={12} />
                </button>
                <button className="nt-icon-btn" title="More" aria-label="More" aria-haspopup="menu" onClick={(e) => showMenu(e, moreMenu, 'More')}><Icon name="more" size={16} stroke={2.6} /></button>
                <button className="nt-new-btn" title="New note (Ctrl+N)" aria-label="New note" onClick={() => void newFile('note')}><Icon name="plus" size={14} stroke={2.2} />{narrow ? null : ' New'}</button>
              </div>
              <label className="nt-search-field">
                <Icon name="search" size={14} />
                <input ref={searchBox} className="nt-search-input" placeholder="Search notes" aria-label="Search notes" value={searchQ}
                  onFocus={() => setLayout((l) => (l.left === 'search' ? l : { ...l, left: 'search', lastLeft: l.left === 'search' ? l.lastLeft : l.left }))}
                  onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setSearchQ(''); setLayout((l) => ({ ...l, left: l.lastLeft ?? 'files' })); (e.target as HTMLInputElement).blur(); } }} />
                {searching ? <button type="button" className="nt-search-clear" aria-label="Clear search" title="Clear search (Esc)" onClick={() => { setSearchQ(''); setLayout((l) => ({ ...l, left: l.lastLeft ?? 'files' })); }}><Icon name="close" size={11} /></button> : <kbd aria-hidden>Ctrl ⇧ F</kbd>}
              </label>
              {!searching ? (
                <div className="nt-seg nt-seg-fill" role="tablist" aria-label="Show">
                  {views.map(([id, label]) => (
                    <button key={id} role="tab" aria-selected={L.left === id} className={L.left === id ? 'on' : ''} onClick={() => setLayout((l) => ({ ...l, left: id }))}>{label}</button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="nt-panel-body">
              {searching ? <SearchPanel query={searchQ} />
                : L.left === 'files' ? <Explorer onMenu={fileMenu} sort={sort} collapse={collapse} onNew={() => void newFile('note')} onImport={() => setModal({ kind: 'import' })} />
                : L.left === 'bookmarks' ? <BookmarksPanel />
                : L.left === 'tags' ? <TagsPanel />
                : <RecentPanel />}
            </div>
            <div className="nt-left-foot">
              <button className="nt-quiet-btn" title="Today’s daily note (Ctrl+Shift+D)" aria-label="Daily note" onClick={() => void daily('day')}><Icon name="calendar" size={14} /> Today</button>
              <button className="nt-quiet-btn" title="All notes as a graph (Ctrl+Alt+G)" aria-label="Graph view" onClick={() => open(GRAPH, { newTab: true })}><Icon name="graph" size={14} /> Graph</button>
              <span className="nt-spacer" />
              <button className="nt-icon-btn" title="Notes settings" aria-label="Notes settings" onClick={() => setModal({ kind: 'settings' })}><Icon name="settings" size={15} /></button>
            </div>
          </aside>
        ) : null}
        <main className={`nt-main panes-${L.panes.length}`}>
          {L.panes.map((p, pi) => {
            const at = p.tabs.find((t) => t.id === p.active) ?? null;
            const last = pi === L.panes.length - 1;
            return (
              <section key={pi} className={`nt-pane nt-panel ${pi === L.focus ? 'is-focus' : ''}`} onMouseDown={() => pi !== L.focus && setLayout((l) => ({ ...l, focus: pi }))}>
                <div className="nt-pane-head">
                  {pi === 0 ? <button className="nt-icon-btn" title={L.leftOpen ? 'Hide the note list' : 'Show the note list'} aria-label={L.leftOpen ? 'Hide the note list' : 'Show the note list'} aria-pressed={L.leftOpen} onClick={() => setLayout((l) => ({ ...l, leftOpen: !l.leftOpen }))}><Icon name="panelLeft" size={16} /></button> : null}
                  <div className="nt-tabs" role="tablist" aria-label="Open notes">
                    {p.tabs.map((t) => (
                      <div key={t.id} role="tab" tabIndex={t.id === p.active ? 0 : -1} aria-selected={t.id === p.active} className={`nt-tab ${t.id === p.active ? 'on' : ''}`}
                        onClick={() => setLayout((l) => ({ ...l, focus: pi, panes: l.panes.map((x, i) => (i === pi ? { ...x, active: t.id } : x)) }))}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
                        onAuxClick={(e) => e.button === 1 && closeTab(pi, t.id)} title={t.path}>
                        <span className={`nt-kind kind-${t.path === GRAPH ? 'graph' : kindOf(t.path)}`} aria-hidden />
                        <span className="nt-tab-name">{t.path === GRAPH ? 'Graph' : t.path.split('/').pop()!.replace(/\.md$/, '')}</span>
                        <button className="nt-tab-x" aria-label={`Close ${t.path.split('/').pop()!.replace(/\.md$/, '')}`} title="Close (Ctrl+W)" onClick={(e) => { e.stopPropagation(); closeTab(pi, t.id); }}><Icon name="close" size={10} stroke={2.2} /></button>
                      </div>
                    ))}
                    <button className="nt-icon-btn nt-tab-new" title="New note (Ctrl+N)" aria-label="New tab" onClick={() => void newFile('note')}><Icon name="plus" size={14} /></button>
                  </div>
                  {at && kindOf(at.path) === 'note' && vault.files.some((f) => f.path === at.path) ? (
                    <div className="nt-seg" role="group" aria-label="View">
                      <button className={at.mode === 'live' ? 'on' : ''} aria-pressed={at.mode === 'live'} onClick={() => setMode(at.id, 'live')} title="Write with formatting shown">Live</button>
                      <button className={at.mode === 'source' ? 'on' : ''} aria-pressed={at.mode === 'source'} onClick={() => setMode(at.id, 'source')} title="Plain Markdown">Source</button>
                      <button className={at.mode === 'reading' ? 'on' : ''} aria-pressed={at.mode === 'reading'} onClick={() => { void handles.current.get(at.id)?.flush(); setMode(at.id, 'reading'); }} title="Reading view (Ctrl+E)">Read</button>
                      <button className={at.mode === 'map' ? 'on' : ''} aria-pressed={at.mode === 'map'} onClick={() => setMode(at.id, 'map')} title="Headings and lists as a mind map">Map</button>
                    </div>
                  ) : null}
                  {at && at.path !== GRAPH ? <button className="nt-icon-btn" title="More for this note" aria-label="More for this note" aria-haspopup="menu" onClick={(e) => showMenu(e, noteMenu(at), 'This note')}><Icon name="more" size={16} stroke={2.6} /></button> : null}
                  {last ? <button className={`nt-icon-btn ${inspectorShown ? 'is-on' : ''}`} title={inspectorShown ? 'Hide links and outline' : 'Show links and outline'} aria-label="Links and outline" aria-pressed={inspectorShown} onClick={() => setInspector(!inspectorShown)}><Icon name="panelRight" size={16} /></button> : null}
                </div>
                <div className="nt-pane-body">
                  {p.tabs.length ? p.tabs.map((t) => (
                    <div key={t.id} className="nt-tab-body" style={{ display: t.id === p.active ? undefined : 'none' }}>
                      {t.id === p.active || kindOf(t.path) === 'note' ? renderTab(t, pi === L.focus && t.id === p.active) : null}
                    </div>
                  )) : (
                    <EmptyPane count={vault.files.filter((f) => kindOf(f.path) === 'note').length} onNew={() => void newFile('note')} onOpen={() => setModal({ kind: 'switcher' })} onToday={() => void daily('day')} onImport={() => setModal({ kind: 'import' })} />
                  )}
                </div>
              </section>
            );
          })}
        </main>
        {inspectorShown ? (
          <aside className={`nt-right nt-panel ${narrow ? 'is-floating' : ''}`} aria-label="Links and outline" onKeyDown={(e) => { if (e.key === 'Escape' && narrow) setInspector(false); }}>
            <div className="nt-right-head">
              <div className="nt-seg nt-seg-fill" role="tablist" aria-label="Side panel">
                {[['links', 'Links'], ['outline', 'Outline'], ['graph', 'Graph'], ['ai', 'Ask AI']].map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={L.right === id} className={L.right === id ? 'on' : ''} onClick={() => setLayout((l) => ({ ...l, right: id }))}>{label}</button>
                ))}
              </div>
              <button className="nt-icon-btn" title="Close side panel" aria-label="Close side panel" onClick={() => setInspector(false)}><Icon name="close" size={12} /></button>
            </div>
            <div className="nt-panel-body">
              {L.right === 'links' ? <LinksPanel path={activePath && kindOf(activePath) === 'note' ? activePath : null} />
                : L.right === 'outline' ? <OutlinePanel text={activeText} onJump={(_line, h) => activePath && open(activePath, { subpath: h })} />
                : L.right === 'graph' ? <LocalGraphPanel path={activePath} />
                : <AiPanel path={activePath && kindOf(activePath) === 'note' ? activePath : null} onInsert={insertText} />}
            </div>
          </aside>
        ) : null}
        {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} label={menu.label} onClose={() => setMenu(null)} /> : null}
        {recording ? <div className="nt-rec-pill" role="status"><span aria-hidden>●</span> Recording <button className="btn sm" onClick={() => [...handles.current.values()].forEach((h) => h?.stopRecording())}>Stop</button></div> : null}
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
        {modal?.kind === 'import' ? <ImportDialog vault={vault} onClose={() => setModal(null)} onDone={() => void refresh()} onOpenFolder={(folder) => void api.notes.open(vault.id).then((v) => { setVault(v); const first = v.files.filter((f) => f.path.startsWith(`${folder}/`) && f.path.endsWith('.md')).sort((x, y) => x.path.localeCompare(y.path))[0]; if (first) open(first.path); })} /> : null}
        {modal?.kind === 'export' ? <ExportDialog vault={vault} path={modal.arg ?? null} toast={toast} onClose={() => setModal(null)} /> : null}
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
      <p className="nt-dim">Plugins: community plugins written for other notes apps are listed but never run — they get full access to your computer. Keeper plugins run in a sandbox and only do what you allow. <Learn doc="NOTES" /></p>
      <div className="nt-modal-actions"><button className="btn primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

export { sanitize };
