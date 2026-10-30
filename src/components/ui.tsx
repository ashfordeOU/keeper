// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared building blocks: file thumbnails, grid and list views, chips, toggles,
// context menu, modal, empty states.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { RenamePreview, RenameStep } from '../../core/rename';
import type { FileEntry, FileKind } from '../../core/types';
import { formatBytes, formatDate, formatDuration, relativeTime } from '../../core/format';
import { api } from '../api';
import { mod, shift, useStore } from '../state';
import { Icon } from './Icon';

export const KIND_COLOR: Record<FileKind | 'folder', string> = {
  image: 'var(--c-image)', video: 'var(--c-video)', audio: 'var(--c-audio)', document: 'var(--c-document)', archive: 'var(--c-archive)',
  installer: 'var(--c-installer)', app: 'var(--c-app)', code: 'var(--c-code)', other: 'var(--c-other)', folder: 'var(--accent)',
};

// ------------------------------------------------------------------ thumbnails

const thumbCache = new Map<string, string | null>();

export function useThumb(path: string, kind: string, size = 256): string | null {
  const key = `${path}@${size}`;
  const [src, setSrc] = useState<string | null>(() => thumbCache.get(key) ?? null);
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    if (thumbCache.has(key)) {
      setSrc(thumbCache.get(key)!);
      return;
    }
    if (!['image', 'video', 'document', 'app'].includes(kind)) return;
    void api.files.thumbnail(path, size).then((s) => {
      thumbCache.set(key, s);
      if (ref.current) setSrc(s);
    });
    return () => { ref.current = false; };
  }, [key, kind, path, size]);
  return src;
}

export function ExtTile({ ext, kind }: { ext: string; kind: FileKind | 'folder' }) {
  if (kind === 'folder') return <Icon name="folder" size={48} stroke={1.4} style={{ color: 'var(--accent)' }} />;
  return <div className="ext-tile" style={{ background: KIND_COLOR[kind] }}>{(ext || kind).slice(0, 5).toUpperCase()}</div>;
}

export function Thumb({ file, size = 256 }: { file: Pick<FileEntry, 'path' | 'kind' | 'ext'>; size?: number }) {
  const src = useThumb(file.path, file.kind, size);
  if (src) return <img src={src} alt="" draggable={false} loading="lazy" />;
  return <ExtTile ext={file.ext} kind={file.kind} />;
}

// ------------------------------------------------------------------ selection + keyboard

export function useFileSelection(files: FileEntry[]) {
  const { selection, setSelection, setFocused, inspector, setInspector, play, trash } = useStore();
  const anchor = useRef<number>(-1);

  const click = (e: React.MouseEvent, i: number) => {
    const p = files[i].path;
    if (e.shiftKey && anchor.current >= 0) {
      const [a, b] = [anchor.current, i].sort((x, y) => x - y);
      setSelection(files.slice(a, b + 1).map((f) => f.path));
    } else if (e.metaKey || e.ctrlKey) {
      setSelection(selection.includes(p) ? selection.filter((x) => x !== p) : [...selection, p]);
      anchor.current = i;
    } else {
      setSelection([p]);
      anchor.current = i;
    }
    setFocused(files[i]);
  };

  const open = (f: FileEntry) => {
    if (f.kind === 'audio') play(f);
    else void api.files.open(f.path);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const cur = files.findIndex((f) => f.path === selection[selection.length - 1]);
      const cmd = e.metaKey || e.ctrlKey;
      if ((e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') && files.length) {
        const cols = Math.max(1, Math.round((document.querySelector('.file-grid')?.clientWidth ?? 1) / ((document.querySelector('.file-card') as HTMLElement)?.offsetWidth + 14 || 1)));
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? (document.querySelector('.file-grid') ? cols : 1) : (document.querySelector('.file-grid') ? -cols : -1);
        const next = Math.max(0, Math.min(files.length - 1, (cur < 0 ? -step : cur) + step));
        setSelection([files[next].path]);
        setFocused(files[next]);
        anchor.current = next;
        document.querySelector(`[data-path="${CSS.escape(files[next].path)}"]`)?.scrollIntoView({ block: 'nearest' });
        e.preventDefault();
      } else if (e.key === 'Enter' && cur >= 0) {
        open(files[cur]);
      } else if (e.key === ' ' && cur >= 0) {
        e.preventDefault();
        setInspector(!inspector);
      } else if (cmd && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection(files.map((f) => f.path));
      } else if (cmd && e.key === 'Backspace' && selection.length) {
        void trash(selection);
      } else if (e.key === 'Delete' && selection.length) {
        void trash(selection);
      } else if (cmd && e.key.toLowerCase() === 'c' && selection.length && !window.getSelection()?.toString()) {
        void api.files.copyPaths(selection);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return { selection, click, open };
}

// ------------------------------------------------------------------ grid & list

export function FileGrid({ files, onContext }: { files: FileEntry[]; onContext?: (e: React.MouseEvent, f: FileEntry) => void }) {
  const { cardSize } = useStore();
  const { selection, click, open } = useFileSelection(files);
  const menu = useFileMenu();
  return (
    <div className="file-grid" style={{ ['--card' as string]: `${cardSize}px` }}>
      {files.map((f, i) => (
        <div
          key={f.path}
          data-path={f.path}
          className={`file-card ${selection.includes(f.path) ? 'selected' : ''}`}
          onClick={(e) => click(e, i)}
          onDoubleClick={() => open(f)}
          onContextMenu={(e) => { if (!selection.includes(f.path)) click(e, i); (onContext ?? menu.open)(e, f); }}
          draggable
          onDragStart={(e) => { e.preventDefault(); api.files.startDrag(selection.includes(f.path) ? selection : [f.path]); }}
          title={f.path}
        >
          <div className={`thumb ${f.kind === 'image' || f.kind === 'video' ? '' : 'contain'}`}>
            <Thumb file={f} />
            {f.meta?.durationSec ? <span className="duration">{formatDuration(f.meta.durationSec)}</span> : null}
          </div>
          {f.text && f.kind === 'image' ? (
            <div className="hover-actions">
              <button className="btn sm icon" title="Copy text in image" onClick={(e) => { e.stopPropagation(); void api.files.copyText(f.text!); }}>
                <Icon name="text" size={13} />
              </button>
            </div>
          ) : null}
          <div className="name">{f.name}</div>
          <div className="meta">{formatBytes(f.size)} · {relativeTime(f.mtime)}</div>
        </div>
      ))}
      {menu.node}
    </div>
  );
}

type SortKey = 'name' | 'date' | 'size' | 'kind';

export function FileList({ files, sort, onSort, showSource }: { files: FileEntry[]; sort?: { key: SortKey; desc: boolean }; onSort?: (k: SortKey) => void; showSource?: boolean }) {
  const { selection, click, open } = useFileSelection(files);
  const menu = useFileMenu();
  const th = (k: SortKey, label: string, style?: React.CSSProperties) => (
    <th style={style} onClick={() => onSort?.(k)}>
      {label} {sort?.key === k ? (sort.desc ? '↓' : '↑') : ''}
    </th>
  );
  return (
    <>
      <table className="file-list">
        <thead>
          <tr>
            <th className="icon-cell" />
            {th('name', 'Name')}
            {th('date', 'Modified', { width: 130 })}
            {th('size', 'Size', { width: 90, textAlign: 'right' })}
            {th('kind', 'Kind', { width: 100 })}
            {showSource ? <th style={{ width: 130 }}>From</th> : null}
          </tr>
        </thead>
        <tbody>
          {files.map((f, i) => (
            <tr
              key={f.path}
              data-path={f.path}
              className={selection.includes(f.path) ? 'selected' : ''}
              onClick={(e) => click(e, i)}
              onDoubleClick={() => open(f)}
              onContextMenu={(e) => { if (!selection.includes(f.path)) click(e, i); menu.open(e, f); }}
              draggable
              onDragStart={(e) => { e.preventDefault(); api.files.startDrag(selection.includes(f.path) ? selection : [f.path]); }}
            >
              <td className="icon-cell"><div className="mini-thumb"><Thumb file={f} size={64} /></div></td>
              <td className="ellipsis" style={{ maxWidth: 420 }} title={f.path}>{f.name}</td>
              <td className="muted">{formatDate(f.mtime)}</td>
              <td className="muted num" style={{ textAlign: 'right' }}>{formatBytes(f.size)}</td>
              <td className="muted">{f.screenshot ? 'Screenshot' : f.ext.toUpperCase() || f.kind}</td>
              {showSource ? <td className="muted ellipsis" style={{ maxWidth: 130 }}>{f.source?.name ?? ''}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      {menu.node}
    </>
  );
}

export function Files({ files, sort, onSort, showSource, empty }: { files: FileEntry[] | undefined; sort?: { key: SortKey; desc: boolean }; onSort?: (k: SortKey) => void; showSource?: boolean; empty?: ReactNode }) {
  const { view } = useStore();
  if (!files) return <Loading />;
  if (!files.length) return <>{empty ?? <Empty icon="search" title="Nothing here yet" />}</>;
  return view === 'grid' ? <FileGrid files={files} /> : <FileList files={files} sort={sort} onSort={onSort} showSource={showSource} />;
}

// ------------------------------------------------------------------ context menu

export interface MenuItem {
  label: string;
  icon?: string;
  kbd?: string;
  danger?: boolean;
  run?: () => void;
  sep?: boolean;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (el) setPos({ x: Math.min(x, window.innerWidth - el.offsetWidth - 8), y: Math.min(y, window.innerHeight - el.offsetHeight - 8) });
    const close = () => onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('blur', close);
    };
  }, [x, y, onClose]);
  return createPortal(
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((it, i) =>
        it.sep ? <hr key={i} /> : (
          <button key={i} className={it.danger ? 'danger' : ''} onClick={() => { onClose(); it.run?.(); }}>
            {it.icon ? <Icon name={it.icon} size={14} /> : <span style={{ width: 14 }} />}
            {it.label}
            {it.kbd ? <kbd>{it.kbd}</kbd> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** The standard right-click menu for files. */
export function useFileMenu() {
  const store = useStore();
  const [state, setState] = useState<{ x: number; y: number; file: FileEntry } | null>(null);
  const [renaming, setRenaming] = useState<string[] | null>(null);
  const open = (e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault();
    setState({ x: e.clientX, y: e.clientY, file });
  };
  const sel = state ? (store.selection.includes(state.file.path) ? store.selection : [state.file.path]) : [];
  const items: MenuItem[] = state ? [
    { label: 'Open', icon: 'external', kbd: '↩', run: () => (state.file.kind === 'audio' ? store.play(state.file) : void api.files.open(state.file.path)) },
    { label: 'Open With…', icon: 'external', run: () => void api.files.openWith(state.file.path) },
    { label: 'Quick Look', icon: 'eye', kbd: 'Space', run: () => store.setInspector(true) },
    { label: store.info?.platform === 'win32' ? 'Show in Explorer' : store.info?.platform === 'darwin' ? 'Show in Finder' : 'Show in Folder', icon: 'reveal', run: () => void api.files.reveal(state.file.path) },
    { sep: true, label: '' },
    { label: 'Copy', icon: 'copy', kbd: `${mod}C`, run: () => void api.files.copyPaths(sel) },
    { label: 'Copy Path', icon: 'copy', run: () => void api.files.copyText(sel.join('\n')) },
    ...(state.file.text ? [{ label: 'Copy Text in Image', icon: 'text', kbd: `${shift}${mod}C`, run: () => void api.files.copyText(state.file.text!) }] : []),
    { label: 'Add to Shelf', icon: 'island', run: () => void api.island.addToShelf(sel) },
    { label: 'Pin to Sidebar', icon: 'pin', run: () => {
      const dir = state.file.path.slice(0, state.file.path.length - state.file.name.length - 1);
      if (store.settings && !store.settings.pinned.includes(dir)) void store.updateSettings({ pinned: [...store.settings.pinned, dir] });
    } },
    { sep: true, label: '' },
    { label: sel.length > 1 ? `Rename ${sel.length} Items…` : 'Rename…', icon: 'rename', run: () => setRenaming(sel) },
    { label: 'Compress', icon: 'zip', run: () => void api.files.compress(sel).then((p) => { store.toast(`Created ${p.split(/[\\/]/).pop()}`); store.refresh(); }) },
    ...(state.file.kind === 'image' ? [
      { label: 'Annotate…', icon: 'rename', run: () => store.go({ name: 'annotate', arg: state.file.path }) },
      { label: 'Read Text and Codes', icon: 'text', run: () => void api.capture.readFile(state.file.path).then((r) => { const t = r.code ?? r.text; if (t) { void api.files.copyText(t); store.toast(r.code ? `Copied code: ${r.code}` : 'Copied the text in this image'); } else store.toast('No text found'); }) },
    ] : state.file.ext === 'pdf' ? [
      { label: 'Copy Text in PDF', icon: 'text', run: () => void api.capture.readFile(state.file.path).then((r) => { if (r.text) { void api.files.copyText(r.text); store.toast('Copied the text in this PDF'); } else store.toast('No text found'); }) },
    ] : []),
    { sep: true, label: '' },
    { label: 'Move to Trash', icon: 'trash', danger: true, kbd: `${mod}⌫`, run: () => void store.trash(sel) },
  ] : [];
  const node = (
    <>
      {state ? <ContextMenu x={state.x} y={state.y} items={items} onClose={() => setState(null)} /> : null}
      {renaming ? <RenameDialog paths={renaming} onClose={() => setRenaming(null)} /> : null}
    </>
  );
  return { open, node };
}

// ------------------------------------------------------------------ rename dialog

export function RenameDialog({ paths, onClose }: { paths: string[]; onClose: () => void }) {
  const { refresh, toast } = useStore();
  const single = paths.length === 1;
  const original = paths[0].split(/[\\/]/).pop()!;
  const [mode, setMode] = useState<'replace' | 'template' | 'case' | 'affix'>(single ? 'template' : 'replace');
  const [a, setA] = useState(single ? original.replace(/\.[^.]+$/, '') : '');
  const [b, setB] = useState('');
  const [caseTo, setCaseTo] = useState<'lower' | 'upper' | 'title' | 'sentence'>('title');
  const [preview, setPreview] = useState<RenamePreview[]>([]);

  const steps: RenameStep[] =
    mode === 'replace' ? [{ type: 'replace', find: a, with: b }]
    : mode === 'template' ? [{ type: 'template', pattern: a || '{name}', start: Number(b) || 1 }]
    : mode === 'case' ? [{ type: 'case', to: caseTo }]
    : [{ type: 'prefix', text: a }, { type: 'suffix', text: b }];

  useEffect(() => {
    const t = setTimeout(() => void api.files.previewRename(paths, steps).then(setPreview), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, a, b, caseTo, paths.join('|')]);

  const conflicts = preview.filter((p) => p.conflict).length;
  const changed = preview.filter((p) => p.changed).length;
  return (
    <Modal onClose={onClose} title={single ? 'Rename' : `Rename ${paths.length} items`}>
      <div className="seg" style={{ marginBottom: 12 }}>
        {(['template', 'replace', 'affix', 'case'] as const).map((m) => (
          <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); if (m !== 'template') setA(''); setB(''); }}>
            {m === 'template' ? 'Name' : m === 'replace' ? 'Find & replace' : m === 'affix' ? 'Add text' : 'Change case'}
          </button>
        ))}
      </div>
      {mode === 'case' ? (
        <div className="seg">{(['title', 'sentence', 'lower', 'upper'] as const).map((c) => <button key={c} className={caseTo === c ? 'on' : ''} onClick={() => setCaseTo(c)}>{c === 'title' ? 'Title Case' : c === 'sentence' ? 'Sentence case' : c === 'lower' ? 'lowercase' : 'UPPERCASE'}</button>)}</div>
      ) : (
        <div className="row">
          <input className="input grow" autoFocus value={a} onChange={(e) => setA(e.target.value)} placeholder={mode === 'replace' ? 'Find' : mode === 'template' ? 'New name — use {n} for a counter, {date}, {name}' : 'Add before'} />
          <input className="input" style={{ width: mode === 'template' ? 90 : 220 }} value={b} onChange={(e) => setB(e.target.value)} placeholder={mode === 'replace' ? 'Replace with' : mode === 'template' ? 'Start at' : 'Add after'} />
        </div>
      )}
      <div className="card" style={{ marginTop: 12, maxHeight: 260, overflow: 'auto' }}>
        {preview.slice(0, 200).map((p) => (
          <div key={p.from} className="row small" style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)' }}>
            <span className="ellipsis muted" style={{ flex: 1 }}>{p.from.split(/[\\/]/).pop()}</span>
            <Icon name="chevronRight" size={12} />
            <span className="ellipsis" style={{ flex: 1, color: p.conflict ? 'var(--danger)' : undefined, fontWeight: p.changed ? 600 : 400 }} title={p.conflict}>{p.newName}</span>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
        <span className="small muted">{conflicts ? `${conflicts} conflict${conflicts === 1 ? '' : 's'} — fix them first` : `${changed} will change · you can undo this in History`}</span>
        <div className="btn-row">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!!conflicts || !changed} onClick={async () => {
            const r = await api.files.applyRename(paths, steps);
            refresh();
            toast(`Renamed ${r.removed} item${r.removed === 1 ? '' : 's'}`, r.journalId ? { label: 'Undo', run: () => void api.history.undo(r.journalId!).then(refresh) } : undefined);
            onClose();
          }}>Rename</button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ small pieces

export function Modal({ title, children, onClose, width }: { title?: ReactNode; children: ReactNode; onClose: () => void; width?: number }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return createPortal(
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" style={width ? { width } : undefined} onMouseDown={(e) => e.stopPropagation()}>
        {title ? <div className="row" style={{ marginBottom: 14 }}><h2 className="grow">{title}</h2><button className="btn ghost sm icon" onClick={onClose}><Icon name="close" size={14} /></button></div> : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Check({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`check ${on ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onChange(!on); }} aria-pressed={on} style={{ padding: 0 }}>
      {on ? <Icon name="check" size={11} stroke={3} /> : null}
    </button>
  );
}

export function Empty({ icon = 'search', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={40} stroke={1.3} />
      <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>{title}</div>
      {children ? <div className="small" style={{ maxWidth: 380 }}>{children}</div> : null}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="empty"><div className="spinner" /><div className="small">{label}</div></div>;
}

export function SafetyBadge({ safety }: { safety: 'safe' | 'review' | 'permanent' }) {
  const label = safety === 'safe' ? 'Safe' : safety === 'review' ? 'Review' : 'Permanent';
  return <span className={`badge ${safety}`}>{label}</span>;
}

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {children ? <div className="btn-row">{children}</div> : null}
    </div>
  );
}

export function ViewControls({ sort, onSort }: { sort?: { key: SortKey; desc: boolean }; onSort?: (s: { key: SortKey; desc: boolean }) => void }) {
  const { view, setView } = useStore();
  return (
    <div className="btn-row">
      {sort && onSort ? (
        <select className="input" value={`${sort.key}:${sort.desc ? 'desc' : 'asc'}`} onChange={(e) => { const [k, d] = e.target.value.split(':'); onSort({ key: k as SortKey, desc: d === 'desc' }); }} style={{ height: 30 }}>
          <option value="date:desc">Newest first</option>
          <option value="date:asc">Oldest first</option>
          <option value="size:desc">Biggest first</option>
          <option value="size:asc">Smallest first</option>
          <option value="name:asc">Name A–Z</option>
          <option value="kind:asc">Kind</option>
        </select>
      ) : null}
      <div className="seg">
        <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} title={`Grid (${mod}1)`}><Icon name="grid" size={14} /></button>
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} title={`List (${mod}2)`}><Icon name="list" size={14} /></button>
      </div>
    </div>
  );
}

export function SizeBar({ parts, total }: { parts: { size: number; color: string; label?: string }[]; total: number }) {
  return (
    <div className="bar" title={parts.map((p) => `${p.label ?? ''} ${formatBytes(p.size)}`).join(' · ')}>
      {parts.map((p, i) => <i key={i} style={{ width: `${(p.size / Math.max(1, total)) * 100}%`, background: p.color }} />)}
    </div>
  );
}
