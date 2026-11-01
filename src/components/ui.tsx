// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Shared building blocks: file thumbnails, grid and list views, chips, toggles,
// context menu, modal, empty states.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { RenamePreview, RenameStep } from '../../core/rename';
import type { FileEntry, FileKind } from '../../core/types';
import { formatBytes, formatDate, formatDuration, relativeTime } from '../../core/format';
import { api } from '../api';
import { mod, shift, useStore } from '../state';
import { Icon } from './Icon';
import { isQuickLookOpen, openQuickLook } from '../preview/QuickLook';
import { canRenderThumb, renderThumb } from '../preview/thumbs';

export const KIND_COLOR: Record<FileKind | 'folder', string> = {
  image: 'var(--c-image)', video: 'var(--c-video)', audio: 'var(--c-audio)', document: 'var(--c-document)', archive: 'var(--c-archive)',
  installer: 'var(--c-installer)', app: 'var(--c-app)', code: 'var(--c-code)', other: 'var(--c-other)', folder: 'var(--accent)',
};

// ------------------------------------------------------------------ thumbnails

const thumbCache = new Map<string, string | null>();

/** Thumbnail work runs a few at a time so a full page of cards never stalls the window. */
const THUMB_SLOTS = 4;
let thumbBusy = 0;
const thumbQueue: (() => void)[] = [];
function inSlot<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      thumbBusy++;
      job().then(resolve, reject).finally(() => {
        thumbBusy--;
        thumbQueue.shift()?.();
      });
    };
    if (thumbBusy < THUMB_SLOTS) start();
    else thumbQueue.push(start);
  });
}

/**
 * Loads a thumbnail once the card is on screen (or close to it). Pass the
 * element to watch; without one it loads straight away.
 */
export function useThumb(path: string, kind: string, size = 256, el?: React.RefObject<HTMLElement | null>): string | null {
  const key = `${path}@${size}`;
  const [src, setSrc] = useState<string | null>(() => thumbCache.get(key) ?? null);
  const [visible, setVisible] = useState(!el);
  useEffect(() => {
    if (!el?.current || visible) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '400px' });
    io.observe(el.current);
    return () => io.disconnect();
  }, [el, visible]);
  useEffect(() => {
    let alive = true;
    if (thumbCache.has(key)) {
      setSrc(thumbCache.get(key)!);
      return;
    }
    if (!visible) return;
    // Plain files with nothing to draw keep their icon.
    if ((kind === 'code' || kind === 'other') && !canRenderThumb(path)) return;
    void inSlot(async () => {
      if (!alive) return undefined;
      const s = await api.files.thumbnail(path, size);
      // PDFs and fonts on systems without a thumbnailer are drawn here.
      return s ?? (canRenderThumb(path) ? await renderThumb(path, size) : null);
    }).then((url) => {
      if (url === undefined) return;
      thumbCache.set(key, url);
      if (alive) setSrc(url);
    });
    return () => { alive = false; };
  }, [key, kind, path, size, visible]);
  return src;
}

export function ExtTile({ ext, kind }: { ext: string; kind: FileKind | 'folder' }) {
  if (kind === 'folder') return <Icon name="folder" size={48} stroke={1.4} style={{ color: 'var(--accent)' }} />;
  return <div className="ext-tile" style={{ background: KIND_COLOR[kind] }}>{(ext || kind).slice(0, 5).toUpperCase()}</div>;
}

export function Thumb({ file, size = 256 }: { file: Pick<FileEntry, 'path' | 'kind' | 'ext'>; size?: number }) {
  const box = useRef<HTMLSpanElement>(null);
  const src = useThumb(file.path, file.kind, size, box);
  return (
    <span ref={box} className="thumb-box">
      {src ? <img src={src} alt="" draggable={false} loading="lazy" decoding="async" /> : <ExtTile ext={file.ext} kind={file.kind} />}
    </span>
  );
}

/** Lists carry only the start of recognised text; copy the whole of it. */
export async function copyFullText(f: Pick<FileEntry, 'path' | 'text' | 'textCut'>) {
  const text = f.textCut ? (await api.library.readText([f.path]))[0]?.text ?? f.text ?? '' : f.text ?? '';
  if (text) await api.files.copyText(text);
}

// ------------------------------------------------------------------ selection + keyboard

export function useFileSelection(files: FileEntry[]) {
  const { selection, setSelection, setFocused, play, trash } = useStore();
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
        // Space opens Quick Look on the selection (or the whole list, starting at this file).
        e.preventDefault();
        if (isQuickLookOpen()) return;
        const sel = files.filter((f) => selection.includes(f.path));
        const list = sel.length > 1 ? sel : files;
        openQuickLook(list.map((f) => ({ path: f.path, name: f.name })), Math.max(0, list.findIndex((f) => f.path === files[cur].path)));
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

const PAGE = 240;

/**
 * Draws long lists a page at a time: the first cards appear at once and more
 * are added as you scroll, so a library of tens of thousands opens instantly.
 */
function useProgressive<T>(items: T[], selected: string[], keyOf: (t: T) => string) {
  const [count, setCount] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => setCount(PAGE), [items]);
  // Keyboard navigation past the drawn part draws far enough to show it.
  useEffect(() => {
    if (!selected.length) return;
    const last = selected[selected.length - 1];
    const i = items.findIndex((x) => keyOf(x) === last);
    if (i >= count) setCount(Math.ceil((i + 1) / PAGE) * PAGE);
  }, [selected, items, count, keyOf]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || count >= items.length) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setCount((c) => Math.min(items.length, c + PAGE));
    }, { rootMargin: '1200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [count, items.length]);
  return { shown: count >= items.length ? items : items.slice(0, count), more: count < items.length, sentinel };
}

const pathOf = (f: FileEntry) => f.path;
/** A hidden file, or one inside a hidden folder: shown dimmed. */
const isHiddenFile = (f: FileEntry) => !!f.hidden || /(^|[\\/])\.[^\\/.]/.test(f.path);

export function FileGrid({ files, onContext }: { files: FileEntry[]; onContext?: (e: React.MouseEvent, f: FileEntry) => void }) {
  const { cardSize } = useStore();
  const { selection, click, open } = useFileSelection(files);
  const menu = useFileMenu();
  const { shown, more, sentinel } = useProgressive(files, selection, pathOf);
  const picked = useMemo(() => new Set(selection), [selection]);
  return (
    <div className="file-grid" style={{ ['--card' as string]: `${cardSize}px` }}>
      {shown.map((f, i) => (
        <div
          key={f.path}
          data-path={f.path}
          className={`file-card ${picked.has(f.path) ? 'selected' : ''} ${isHiddenFile(f) ? 'is-hidden' : ''}`}
          onClick={(e) => click(e, i)}
          onDoubleClick={() => open(f)}
          onContextMenu={(e) => { if (!picked.has(f.path)) click(e, i); (onContext ?? menu.open)(e, f); }}
          draggable
          onDragStart={(e) => { e.preventDefault(); api.files.startDrag(picked.has(f.path) ? selection : [f.path]); }}
          title={f.path}
        >
          <div className={`thumb ${f.kind === 'image' || f.kind === 'video' ? '' : 'contain'}`}>
            <Thumb file={f} />
            {f.meta?.durationSec ? <span className="duration">{formatDuration(f.meta.durationSec)}</span> : null}
          </div>
          {f.text && f.kind === 'image' ? (
            <div className="hover-actions">
              <button className="btn sm icon" title="Copy text in image" onClick={(e) => { e.stopPropagation(); void copyFullText(f); }}>
                <Icon name="text" size={13} />
              </button>
            </div>
          ) : null}
          <div className="name">{f.name}</div>
          <div className="meta">{formatBytes(f.size)} · {relativeTime(f.mtime)}</div>
        </div>
      ))}
      {more ? <div ref={sentinel} style={{ gridColumn: '1 / -1', height: 1 }} /> : null}
      {menu.node}
    </div>
  );
}

type SortKey = 'name' | 'date' | 'size' | 'kind';

export function FileList({ files, sort, onSort, showSource }: { files: FileEntry[]; sort?: { key: SortKey; desc: boolean }; onSort?: (k: SortKey) => void; showSource?: boolean }) {
  const { selection, click, open } = useFileSelection(files);
  const menu = useFileMenu();
  const { shown, more, sentinel } = useProgressive(files, selection, pathOf);
  const picked = useMemo(() => new Set(selection), [selection]);
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
          {shown.map((f, i) => (
            <tr
              key={f.path}
              data-path={f.path}
              className={`${picked.has(f.path) ? 'selected' : ''} ${isHiddenFile(f) ? 'is-hidden' : ''}`}
              onClick={(e) => click(e, i)}
              onDoubleClick={() => open(f)}
              onContextMenu={(e) => { if (!picked.has(f.path)) click(e, i); menu.open(e, f); }}
              draggable
              onDragStart={(e) => { e.preventDefault(); api.files.startDrag(picked.has(f.path) ? selection : [f.path]); }}
            >
              <td className="icon-cell"><div className="mini-thumb"><Thumb file={f} size={64} /></div></td>
              <td className="ellipsis" style={{ maxWidth: 420 }} title={f.path}>{f.name}</td>
              <td className="muted">{formatDate(f.mtime)}</td>
              <td className="muted num" style={{ textAlign: 'right' }}>{formatBytes(f.size)}</td>
              <td className="muted">{f.screenshot ? 'Screenshot' : f.ext.toUpperCase() || f.kind}</td>
              {showSource ? <td className="muted ellipsis" style={{ maxWidth: 130 }}>{f.source?.name ?? ''}</td> : null}
            </tr>
          ))}
          {more ? <tr ref={sentinel as unknown as React.RefObject<HTMLTableRowElement>}><td colSpan={6} style={{ height: 1, padding: 0 }} /></tr> : null}
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
    { label: 'Quick Look', icon: 'eye', kbd: 'Space', run: () => openQuickLook([{ path: state.file.path, name: state.file.name }]) },
    { label: store.info?.platform === 'win32' ? 'Show in Explorer' : store.info?.platform === 'darwin' ? 'Show in Finder' : 'Show in Folder', icon: 'reveal', run: () => void api.files.reveal(state.file.path) },
    { sep: true, label: '' },
    { label: 'Copy', icon: 'copy', kbd: `${mod}C`, run: () => void api.files.copyPaths(sel) },
    { label: 'Copy Path', icon: 'copy', run: () => void api.files.copyText(sel.join('\n')) },
    ...(state.file.text ? [{ label: 'Copy Text in Image', icon: 'text', kbd: `${shift}${mod}C`, run: () => void copyFullText(state.file) }] : []),
    { label: 'Add to Shelf', icon: 'island', run: () => void api.island.addToShelf(sel) },
    { label: store.info?.platform === 'darwin' ? 'Share… (AirDrop, Mail, Messages)' : 'Share…', icon: 'share', run: () => void api.places.share(sel).then((r) => { if (r.message) store.toast(r.message); }) },
    // Your other computers (Keeper Link) and Android phones; handled by the Send sheet on every page.
    { label: 'Send to Device…', icon: 'send', run: () => window.dispatchEvent(new CustomEvent('keeper-send-to', { detail: sel })) },
    { label: 'Pin to Sidebar', icon: 'pin', run: () => {
      const dir = state.file.path.slice(0, state.file.path.length - state.file.name.length - 1);
      if (store.settings && !store.settings.pinned.includes(dir)) void store.updateSettings({ pinned: [...store.settings.pinned, dir] });
    } },
    { sep: true, label: '' },
    { label: sel.length > 1 ? `Rename ${sel.length} Items…` : 'Rename…', icon: 'rename', run: () => setRenaming(sel) },
    { label: 'Compress', icon: 'zip', run: () => void api.files.compress(sel).then((p) => { store.toast(`Created ${p.split(/[\\/]/).pop()}`); store.refresh(); }) },
    { label: 'Convert…', icon: 'refresh', run: () => store.go({ name: 'convert', arg: JSON.stringify(sel) }) },
    // Any format to another (pictures, documents, data, subtitles, fonts, 3D, drawings, mail…).
    { label: 'Convert to…', icon: 'refresh', run: () => store.go({ name: 'convert', arg: JSON.stringify({ tool: 'convert.to', files: sel }) }) },
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

/**
 * Show or hide hidden files and folders: one clear button with an eye, the same
 * everywhere, with the system shortcut (⌘⇧. on a Mac, Ctrl+Shift+. elsewhere).
 */
export function HiddenToggle({ compact }: { compact?: boolean }) {
  const { settings, updateSettings } = useStore();
  const on = !!settings?.showHidden;
  return (
    <button
      className={`btn sm hidden-toggle ${on ? 'on' : ''}`}
      aria-pressed={on}
      onClick={() => settings && void updateSettings({ showHidden: !on })}
      title={`${on ? 'Hide' : 'Show'} hidden files and folders (${mod}${shift}.)`}
    >
      <Icon name={on ? 'eye' : 'eyeOff'} size={14} />
      {compact ? null : on ? ' Hidden shown' : ' Hidden files'}
    </button>
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
