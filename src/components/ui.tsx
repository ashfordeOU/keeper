// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Shared building blocks: file thumbnails, grid and list views, chips, toggles,
// context menu, modal, empty states.

import { tracksFileMenu } from '../screens/TracksSurfaces';
import { shownIn } from '../screen/surfaces';
import { Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EmbeddedContext, HubContext, usePageHints } from './page-context';
import { createPortal } from 'react-dom';
import type { RenamePreview, RenameStep } from '../../core/rename';
import type { FileEntry, FileKind } from '../../core/types';
import { formatBytes, formatDate, formatDuration, relativeTime } from '../../core/format';
import { api } from '../api';
import { chooseDestination, folderDrop, pasteInto, setFileClip, useFileClip } from '../fileops';
import { mod, shift, useStore } from '../state';
import { Icon } from './Icon';
import { isQuickLookOpen, openQuickLook } from '../preview/QuickLook';
import { canRenderThumb, renderThumb } from '../preview/thumbs';
import { arrowNav, isTypeKey, labelFromContext, useFocusTrap, useTypeahead } from '../a11y';
import { readableOn } from '../../core/themes';
import { isPlainText, parentOf, prettyFolder, viewScope, viewsFor, type FileView } from '../../core/folder-view';
import { showInFolder } from '../folder-nav';
import { useFeature } from '../features';

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

const inkCache = new Map<string, string>();
/** Black or white for text on a shelf colour, whichever reads better in the current theme. */
function inkOnKind(kind: FileKind): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const root = document.documentElement;
  const key = `${root.dataset.themeId}|${root.dataset.theme}|${root.dataset.look}|${kind}`;
  let ink = inkCache.get(key);
  if (!ink) {
    const c = getComputedStyle(root).getPropertyValue(`--c-${kind}`).trim();
    ink = c.startsWith('#') || c.startsWith('rgb') ? readableOn(c) : '#ffffff';
    inkCache.set(key, ink);
  }
  return ink;
}

export function ExtTile({ ext, kind }: { ext: string; kind: FileKind | 'folder' }) {
  if (kind === 'folder') return <Icon name="folder" size={48} stroke={1.4} style={{ color: 'var(--accent)' }} />;
  return <div className="ext-tile" style={{ background: KIND_COLOR[kind], color: inkOnKind(kind) }}>{(ext || kind).slice(0, 5).toUpperCase()}</div>;
}

/** A folder's icon where files show thumbnails (with a lock for one Keeper locked). */
function FolderThumb({ locked }: { locked?: boolean }) {
  return (
    <span className="thumb-box folder-thumb">
      <Icon name="folder" size={48} stroke={1.4} />
      {locked ? <span className="lock-badge"><Icon name="lock" size={10} stroke={2.4} /></span> : null}
    </span>
  );
}

/**
 * A file's picture: folders get a folder, plain text a clean type icon (a page
 * of tiny text tells nothing) unless `rich` asks for the real page, as the
 * gallery does; everything else its thumbnail.
 */
export function Thumb({ file, size = 256, rich }: { file: Pick<FileEntry, 'path' | 'kind' | 'ext' | 'dir' | 'locked'>; size?: number; rich?: boolean }) {
  if (file.dir) return <FolderThumb locked={file.locked} />;
  if (!rich && isPlainText(file.ext)) return <span className="thumb-box"><ExtTile ext={file.ext} kind={file.kind} /></span>;
  return <RealThumb file={file} size={size} />;
}

function RealThumb({ file, size }: { file: Pick<FileEntry, 'path' | 'kind' | 'ext'>; size: number }) {
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

export interface SelectionOptions {
  /** opens a folder (pages that show folders and files together) */
  onOpenDir?: (f: FileEntry) => void;
  /** a page's own keys (a list's disclosure triangles); true when it handled the key */
  onKey?: (e: KeyboardEvent, cur: number) => boolean;
}

/** Where the arrow keys move the selection. */
const FILE_AREAS = '.file-grid, .file-list, .gallery-strip';

export function useFileSelection(files: FileEntry[], opts: SelectionOptions = {}) {
  const { selection, setSelection, setFocused, play, trash } = useStore();
  const anchor = useRef<number>(-1);
  const typeahead = useTypeahead();
  /** Moves the selection (and keyboard focus) to the file at i. */
  const pick = (i: number) => {
    setSelection([files[i].path]);
    setFocused(files[i]);
    anchor.current = i;
    const el = document.querySelector<HTMLElement>(`[data-path="${CSS.escape(files[i].path)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
    // Keyboard focus follows when it is already in the grid or list.
    if (el && document.activeElement?.closest(FILE_AREAS)) el.focus({ preventScroll: true });
  };

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
    if (f.dir) opts.onOpenDir?.(f);
    else if (f.kind === 'audio') play(f);
    else void api.files.open(f.path);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
      // Menus and dialogs handle their own keys, and so do buttons, tabs and other controls outside the files.
      if (t.closest?.('.menu, .modal, .palette, .ql, [role="dialog"]')) return;
      if (t !== document.body && !t.closest?.(FILE_AREAS) && t.matches?.('button, a[href], summary, [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], [role="option"], [role="menuitem"], [role="slider"], [role="treeitem"], [tabindex]:not([tabindex="-1"])')) return;
      const cur = files.findIndex((f) => f.path === selection[selection.length - 1]);
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd && !e.altKey && opts.onKey?.(e, cur)) {
        e.preventDefault();
      } else if (!cmd && !e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') && files.length) {
        const cols = Math.max(1, Math.round((document.querySelector('.file-grid')?.clientWidth ?? 1) / ((document.querySelector('.file-card') as HTMLElement)?.offsetWidth + 14 || 1)));
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? (document.querySelector('.file-grid') ? cols : 1) : (document.querySelector('.file-grid') ? -cols : -1);
        const next = Math.max(0, Math.min(files.length - 1, (cur < 0 ? -step : cur) + step));
        pick(next);
        e.preventDefault();
      } else if ((e.key === 'Home' || e.key === 'End') && files.length && t.closest?.(FILE_AREAS)) {
        e.preventDefault();
        pick(e.key === 'Home' ? 0 : files.length - 1);
      } else if (isTypeKey(e) && files.length && (t === document.body || t.closest?.(FILE_AREAS))) {
        // Type-to-select: the first letters of a name jump to it.
        const i = typeahead(e.key, files.map((f) => f.name), cur);
        if (i >= 0) { e.preventDefault(); pick(i); }
      } else if (e.key === 'Enter' && !cmd && cur >= 0) {
        e.preventDefault();
        open(files[cur]);
      } else if (e.key === ' ' && cur >= 0) {
        // Space opens Quick Look on the selection (or the whole list, starting at this file).
        e.preventDefault();
        if (isQuickLookOpen() || files[cur].dir) return;
        const sel = files.filter((f) => selection.includes(f.path) && !f.dir);
        const list = sel.length > 1 ? sel : files.filter((f) => !f.dir);
        openQuickLook(list.map((f) => ({ path: f.path, name: f.name })), Math.max(0, list.findIndex((f) => f.path === files[cur].path)));
      } else if (cmd && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection(files.map((f) => f.path));
      } else if (cmd && e.key === 'Backspace' && selection.length) {
        void trash(selection);
      } else if (e.key === 'Delete' && selection.length) {
        void trash(selection);
      } else if (cmd && !e.shiftKey && e.key.toLowerCase() === 'c' && selection.length && !window.getSelection()?.toString()) {
        // Copy: paste into another folder with ⌘V (and into other apps from the system clipboard).
        setFileClip('copy', selection);
      } else if (cmd && !e.shiftKey && e.key.toLowerCase() === 'x' && selection.length && !window.getSelection()?.toString()) {
        e.preventDefault();
        setFileClip('cut', selection);
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

/** What a page passes to the grid, list and gallery beyond its files. */
export interface FileViewProps {
  /** its own right-click menu; return true when it showed one (else the usual file menu shows) */
  onContext?: (e: React.MouseEvent, f: FileEntry) => boolean | void;
  /** opens a folder (pages that show folders and files together) */
  onOpenDir?: (f: FileEntry) => void;
  /** a heading drawn before a file (the Library's folder groups) */
  header?: (f: FileEntry, i: number) => ReactNode;
}

const kindLabel = (f: FileEntry) => (f.dir ? 'Folder' : f.screenshot ? 'Screenshot' : f.ext.toUpperCase() || f.kind);
const metaLine = (f: FileEntry) => (f.dir ? `${f.locked ? 'Locked' : 'Folder'} · ${relativeTime(f.mtime)}` : `${formatBytes(f.size)} · ${relativeTime(f.mtime)}`);

export function FileGrid({ files, onContext, onOpenDir, header }: { files: FileEntry[] } & FileViewProps) {
  const { cardSize, setSelection, setFocused } = useStore();
  const { selection, click, open } = useFileSelection(files, { onOpenDir });
  const menu = useFileMenu();
  const { shown, more, sentinel } = useProgressive(files, selection, pathOf);
  const picked = useMemo(() => new Set(selection), [selection]);
  const context = (e: React.MouseEvent, f: FileEntry) => { if (!onContext?.(e, f)) menu.open(e, f); };
  return (
    <div className="file-grid" role="listbox" aria-label="Files" aria-multiselectable="true" aria-orientation="horizontal" style={{ ['--card' as string]: `${cardSize}px` }}>
      {shown.map((f, i) => (
        <FileCard key={f.path} f={f} i={i} picked={picked} selection={selection} header={header?.(f, i)}
          onFocus={(e) => { if (!picked.has(f.path) && e.currentTarget.matches(':focus-visible')) { setSelection([f.path]); setFocused(f); } }}
          onClick={(e) => click(e, i)} onOpen={() => open(f)} onContext={context}
          onMenuKey={(r) => context({ preventDefault: () => undefined, clientX: r.left + 20, clientY: r.top + 20 } as React.MouseEvent, f)}
        />
      ))}
      {more ? <div ref={sentinel} style={{ gridColumn: '1 / -1', height: 1 }} /> : null}
      {menu.node}
    </div>
  );
}

/** One card in the icons view or the gallery's strip. */
function FileCard({ f, i, picked, selection, header, onFocus, onClick, onOpen, onContext, onMenuKey, rich }: {
  f: FileEntry; i: number; picked: Set<string>; selection: string[]; header?: ReactNode;
  onFocus: (e: React.FocusEvent<HTMLDivElement>) => void; onClick: (e: React.MouseEvent) => void; onOpen: () => void;
  onContext: (e: React.MouseEvent, f: FileEntry) => void; onMenuKey: (r: DOMRect) => void; rich?: boolean;
}) {
  const clip = useFileClip();
  const cut = clip?.op === 'cut' && clip.paths.includes(f.path);
  return (
    <>
      {header ?? null}
      <div
        data-path={f.path}
        data-dir={f.dir ? '1' : undefined}
        role="option"
        aria-selected={picked.has(f.path)}
        aria-label={`${f.name}, ${metaLine(f)}`}
        // One stop in the Tab order: the selected file (or the first one).
        tabIndex={picked.size ? (picked.has(f.path) && f.path === selection[selection.length - 1] ? 0 : -1) : i === 0 ? 0 : -1}
        onFocus={onFocus}
        onKeyDown={(e) => { if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { e.preventDefault(); onMenuKey(e.currentTarget.getBoundingClientRect()); } }}
        className={`file-card ${f.dir ? 'is-dir' : ''} ${picked.has(f.path) ? 'selected' : ''} ${isHiddenFile(f) ? 'is-hidden' : ''} ${cut ? 'is-cut' : ''}`}
        onClick={onClick}
        onDoubleClick={onOpen}
        onContextMenu={(e) => { if (!picked.has(f.path)) onClick(e); onContext(e, f); }}
        draggable
        onDragStart={(e) => { e.preventDefault(); api.files.startDrag(picked.has(f.path) ? selection : [f.path]); }}
        {...folderDrop(f.dir && !f.locked ? f.path : undefined)}
        title={f.path}
      >
        <div className={`thumb ${f.kind === 'image' || f.kind === 'video' ? '' : 'contain'}`}>
          <Thumb file={f} rich={rich} />
          {f.meta?.durationSec ? <span className="duration">{formatDuration(f.meta.durationSec)}</span> : null}
        </div>
        {f.text && f.kind === 'image' ? (
          <div className="hover-actions">
            <button className="btn sm icon" title="Copy text in image" aria-label="Copy text in image" onClick={(e) => { e.stopPropagation(); void copyFullText(f); }}>
              <Icon name="text" size={13} />
            </button>
          </div>
        ) : null}
        <div className="name">{f.name}</div>
        <div className="meta">{metaLine(f)}</div>
      </div>
    </>
  );
}

type SortKey = 'name' | 'date' | 'size' | 'kind';

/** List view's disclosure triangles: how deep each row is, which folders are open, and opening one. */
export interface ListTree {
  depth: (path: string) => number;
  expanded: (path: string) => boolean;
  toggle: (path: string, open?: boolean) => void;
}

export function FileList({ files, sort, onSort, showSource, showFolder, tree, onContext, onOpenDir, header }: { files: FileEntry[]; sort?: { key: SortKey; desc: boolean }; onSort?: (k: SortKey) => void; showSource?: boolean; /** a Folder column (the Library, when not grouped by folder) */ showFolder?: boolean; tree?: ListTree } & FileViewProps) {
  const { setSelection, setFocused, info } = useStore();
  // ← and → fold and unfold a folder, as in Finder's list view (and do nothing else in a list).
  const onKey = (e: KeyboardEvent, cur: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
    const f = files[cur];
    if (!tree || !f) return true;
    if (e.key === 'ArrowRight' && f.dir && !f.locked) tree.toggle(f.path, true);
    else if (e.key === 'ArrowLeft' && f.dir && tree.expanded(f.path)) tree.toggle(f.path, false);
    else if (e.key === 'ArrowLeft' && tree.depth(f.path) > 0) {
      // To the folder this row is in.
      const d = tree.depth(f.path);
      for (let i = cur - 1; i >= 0; i--) if (tree.depth(files[i].path) < d) { setSelection([files[i].path]); setFocused(files[i]); break; }
    }
    return true;
  };
  const { selection, click, open } = useFileSelection(files, { onOpenDir, onKey });
  const clip = useFileClip();
  const menu = useFileMenu();
  const { shown, more, sentinel } = useProgressive(files, selection, pathOf);
  const picked = useMemo(() => new Set(selection), [selection]);
  const context = (e: React.MouseEvent, f: FileEntry) => { if (!onContext?.(e, f)) menu.open(e, f); };
  const cols = (tree ? 4 : 5) + (showSource ? 1 : 0) + (showFolder ? 1 : 0);
  const th = (k: SortKey, label: string, style?: React.CSSProperties) => (
    <th style={style} aria-sort={sort?.key === k ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      {onSort ? <button className="th-sort" onClick={() => onSort(k)}>{label} <span aria-hidden>{sort?.key === k ? (sort.desc ? '↓' : '↑') : ''}</span></button> : label}
    </th>
  );
  return (
    <>
      <table className={`file-list ${tree ? 'is-tree' : ''}`} aria-label="Files" aria-multiselectable="true">
        <thead>
          <tr>
            {tree ? null : <th className="icon-cell"><span className="sr-only">Preview</span></th>}
            {th('name', 'Name')}
            {showFolder ? <th style={{ width: '28%' }}>Folder</th> : null}
            {th('date', 'Modified', { width: 130 })}
            {th('size', 'Size', { width: 90, textAlign: 'right' })}
            {th('kind', 'Kind', { width: 100 })}
            {showSource ? <th style={{ width: 130 }}>From</th> : null}
          </tr>
        </thead>
        <tbody>
          {shown.map((f, i) => {
            const depth = tree?.depth(f.path) ?? 0;
            const open1 = !!tree?.expanded(f.path);
            const head = header?.(f, i);
            return (
              <Fragment key={f.path}>
                {head ? <tr className="group-row"><td colSpan={cols}>{head}</td></tr> : null}
                <tr
                  data-path={f.path}
                  data-dir={f.dir ? '1' : undefined}
                  data-depth={tree ? depth : undefined}
                  aria-selected={picked.has(f.path)}
                  aria-level={tree ? depth + 1 : undefined}
                  aria-expanded={tree && f.dir ? open1 : undefined}
                  tabIndex={picked.size ? (picked.has(f.path) && f.path === selection[selection.length - 1] ? 0 : -1) : i === 0 ? 0 : -1}
                  onFocus={(e) => { if (!picked.has(f.path) && e.currentTarget.matches(':focus-visible')) { setSelection([f.path]); setFocused(f); } }}
                  onKeyDown={(e) => { if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); context({ preventDefault: () => undefined, clientX: r.left + 40, clientY: r.top + 10 } as React.MouseEvent, f); } }}
                  className={`${f.dir ? 'is-dir' : ''} ${picked.has(f.path) ? 'selected' : ''} ${isHiddenFile(f) ? 'is-hidden' : ''} ${clip?.op === 'cut' && clip.paths.includes(f.path) ? 'is-cut' : ''}`}
                  onClick={(e) => click(e, i)}
                  onDoubleClick={() => open(f)}
                  onContextMenu={(e) => { if (!picked.has(f.path)) click(e, i); context(e, f); }}
                  draggable
                  onDragStart={(e) => { e.preventDefault(); api.files.startDrag(picked.has(f.path) ? selection : [f.path]); }}
                  {...folderDrop(f.dir && !f.locked ? f.path : undefined)}
                >
                  {tree ? (
                    // Finder's list: the triangle, the icon and the name, indented by how deep the row is.
                    <td className="tree-cell" style={{ maxWidth: 480 }} title={f.path}>
                      <div className="fl-tree" style={{ paddingLeft: depth * 18 }}>
                        {f.dir && !f.locked ? (
                          <button className={`disclose ${open1 ? 'open' : ''}`} tabIndex={-1} aria-label={`${open1 ? 'Collapse' : 'Expand'} ${f.name}`} onClick={(e) => { e.stopPropagation(); tree.toggle(f.path); }} onDoubleClick={(e) => e.stopPropagation()}>
                            <Icon name="chevronRight" size={12} />
                          </button>
                        ) : <span className="disclose-space" aria-hidden />}
                        <div className="mini-thumb"><Thumb file={f} size={64} /></div>
                        <span className="fl-name ellipsis">{f.name}</span>
                      </div>
                    </td>
                  ) : (
                    <>
                      <td className="icon-cell"><div className="mini-thumb"><Thumb file={f} size={64} /></div></td>
                      <td className="ellipsis" style={{ maxWidth: 420 }} title={f.path}><span className="fl-name">{f.name}</span></td>
                    </>
                  )}
                  {showFolder ? <td className="muted ellipsis" style={{ maxWidth: 260 }} title={parentOf(f.path)}>{prettyFolder(parentOf(f.path), info?.home)}</td> : null}
                  <td className="muted">{formatDate(f.mtime)}</td>
                  <td className="muted num" style={{ textAlign: 'right' }}>{f.dir ? '—' : formatBytes(f.size)}</td>
                  <td className="muted">{kindLabel(f)}</td>
                  {showSource ? <td className="muted ellipsis" style={{ maxWidth: 130 }}>{f.source?.name ?? ''}</td> : null}
                </tr>
              </Fragment>
            );
          })}
          {more ? <tr ref={sentinel as unknown as React.RefObject<HTMLTableRowElement>}><td colSpan={cols} style={{ height: 1, padding: 0 }} /></tr> : null}
        </tbody>
      </table>
      {menu.node}
    </>
  );
}

/**
 * Gallery: the selected item large, the rest in a strip below, as in Finder.
 * ← and → step through; double-click or Enter opens (a folder opens in place).
 */
export function GalleryView({ files, onContext, onOpenDir }: { files: FileEntry[] } & FileViewProps) {
  const { setSelection, setFocused } = useStore();
  const { selection, click, open } = useFileSelection(files, { onOpenDir });
  const menu = useFileMenu();
  const { shown, more, sentinel } = useProgressive(files, selection, pathOf);
  const picked = useMemo(() => new Set(selection), [selection]);
  const context = (e: React.MouseEvent, f: FileEntry) => { if (!onContext?.(e, f)) menu.open(e, f); };
  const cur = files.find((f) => f.path === selection[selection.length - 1]) ?? files[0];
  // The strip follows the selection.
  useEffect(() => { if (cur) document.querySelector<HTMLElement>(`.gallery-strip [data-path="${CSS.escape(cur.path)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [cur]);
  return (
    <div className="gallery-view">
      {cur ? (
        <div className="gallery-stage" onDoubleClick={() => open(cur)}>
          <div className="gallery-pic">{cur.dir ? <FolderThumb locked={cur.locked} /> : <Thumb key={cur.path} file={cur} size={1024} rich />}</div>
          <div className="gallery-cap">
            <div className="ellipsis" style={{ fontWeight: 600 }} title={cur.path}>{cur.name}</div>
            <div className="small muted">{cur.dir ? metaLine(cur) : `${kindLabel(cur)} · ${metaLine(cur)}`}</div>
          </div>
        </div>
      ) : null}
      <div className="gallery-strip" role="listbox" aria-label="Files" aria-multiselectable="true" aria-orientation="horizontal">
        {shown.map((f, i) => (
          <FileCard key={f.path} f={f} i={i} picked={picked} selection={selection} rich
            onFocus={(e) => { if (!picked.has(f.path) && e.currentTarget.matches(':focus-visible')) { setSelection([f.path]); setFocused(f); } }}
            onClick={(e) => click(e, i)} onOpen={() => open(f)} onContext={context}
            onMenuKey={(r) => context({ preventDefault: () => undefined, clientX: r.left + 20, clientY: r.top + 20 } as React.MouseEvent, f)}
          />
        ))}
        {more ? <div ref={sentinel} style={{ width: 1, flex: 'none' }} /> : null}
      </div>
      {menu.node}
    </div>
  );
}

export function Files({ files, sort, onSort, showSource, showFolder, empty, tree, ...rest }: { files: FileEntry[] | undefined; sort?: { key: SortKey; desc: boolean }; onSort?: (k: SortKey) => void; showSource?: boolean; showFolder?: boolean; empty?: ReactNode; tree?: ListTree } & FileViewProps) {
  const { view } = useStore();
  if (!files) return <Loading />;
  if (!files.length) return <>{empty ?? <Empty icon="search" title="Nothing here yet" />}</>;
  if (view === 'grid') return <FileGrid files={files} {...rest} />;
  if (view === 'gallery') return <GalleryView files={files} {...rest} />;
  return <FileList files={files} sort={sort} onSort={onSort} showSource={showSource} showFolder={showFolder} tree={tree} {...rest} />;
}

// ------------------------------------------------------------------ context menu

export interface MenuItem {
  label: string;
  icon?: string;
  kbd?: string;
  danger?: boolean;
  run?: () => void;
  sep?: boolean;
  /** data-testid for end-to-end tests */
  testId?: string;
}

export function ContextMenu({ x, y, items, onClose, label }: { x: number; y: number; items: MenuItem[]; onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (el) setPos({ x: Math.min(x, window.innerWidth - el.offsetWidth - 8), y: Math.min(y, window.innerHeight - el.offsetHeight - 8) });
    const close = () => onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [x, y, onClose]);
  // Keyboard: focus starts on the first item and goes back where it was when the menu closes.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    opener.current = before;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('keydown', esc, true);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div
      className="menu"
      role="menu"
      aria-label={label}
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (arrowNav(e, e.currentTarget, '[role="menuitem"]')) return;
        if (e.key === 'Tab') { e.preventDefault(); onClose(); }
        else if (isTypeKey(e)) {
          // A letter jumps to the next item starting with it.
          const list = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
          const i = list.indexOf(document.activeElement as HTMLElement);
          const k = e.key.toLowerCase();
          const hit = [...list.slice(i + 1), ...list.slice(0, i + 1)].find((b) => (b.textContent ?? '').trim().toLowerCase().startsWith(k));
          hit?.focus();
        }
      }}
    >
      {items.map((it, i) =>
        it.sep ? <hr key={i} role="separator" /> : (
          <button key={i} role="menuitem" tabIndex={-1} data-testid={it.testId} className={it.danger ? 'danger' : ''} onClick={() => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); onClose(); it.run?.(); }}>
            {it.icon ? <Icon name={it.icon} size={14} /> : <span style={{ width: 14 }} aria-hidden />}
            {it.label}
            {it.kbd ? <kbd aria-hidden>{it.kbd}</kbd> : null}
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
  const photoOn = useFeature('photoEditor');
  const archivesOn = useFeature('archives');
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
    // Places & Tracks: GPX, FIT, KML and photos with a place in them.
    ...tracksFileMenu(state.file.path, store.go),
    // Keeper's own view of the folder it is in, with the file selected.
    ...(store.route.name !== 'browse' ? [{ label: 'Show in Enclosing Folder', icon: 'folder', run: () => showInFolder(store.go, state.file.path) }] : []),
    { label: store.info?.platform === 'win32' ? 'Show in Explorer' : store.info?.platform === 'darwin' ? 'Show in Finder' : 'Show in Folder', icon: 'reveal', run: () => void api.files.reveal(state.file.path) },
    { sep: true, label: '' },
    { label: 'Cut', icon: 'drag', kbd: `${mod}X`, run: () => setFileClip('cut', sel) },
    { label: 'Copy', icon: 'copy', kbd: `${mod}C`, run: () => setFileClip('copy', sel) },
    ...(state.file.dir && !state.file.locked ? [{ label: 'Paste Into Folder', icon: 'clipboard', run: () => void pasteInto(state.file.path) }] : []),
    { label: 'Move to…', icon: 'folder', run: () => chooseDestination('move', sel) },
    { label: 'Copy to…', icon: 'copy', run: () => chooseDestination('copy', sel) },
    { label: 'Copy Path', icon: 'copy', run: () => void api.files.copyText(sel.join('\n')) },
    ...(state.file.text ? [{ label: 'Copy Text in Image', icon: 'text', kbd: `${shift}${mod}C`, run: () => void copyFullText(state.file) }] : []),
    { label: 'Add to Shelf', icon: 'island', run: () => void api.island.addToShelf(sel) },
    { label: store.info?.platform === 'darwin' ? 'Share… (AirDrop, Mail, Messages)' : 'Share…', icon: 'share', run: () => void api.places.share(sel).then((r) => { if (r.message) store.toast(r.message); }) },
    // Your other computers (Keeper Link) and Android phones; handled by the Send sheet on every page.
    ...(shownIn('sendTo', 'contextMenu') ? [{ label: 'Send to Device…', icon: 'send', run: () => window.dispatchEvent(new CustomEvent('keeper-send-to', { detail: sel })) }] : []),
    { label: 'Pin to Sidebar', icon: 'pin', run: () => {
      const dir = state.file.path.slice(0, state.file.path.length - state.file.name.length - 1);
      if (store.settings && !store.settings.pinned.includes(dir)) void store.updateSettings({ pinned: [...store.settings.pinned, dir] });
    } },
    { sep: true, label: '' },
    { label: sel.length > 1 ? `Rename ${sel.length} Items…` : 'Rename…', icon: 'rename', run: () => setRenaming(sel) },
    { label: 'Compress', icon: 'zip', run: () => void api.files.compress(sel).then((p) => { store.toast(`Created ${p.split(/[\\/]/).pop()}`); store.refresh(); }) },
    ...(archivesOn ? [
      ...(state.file.kind === 'archive' && sel.length === 1 ? [{ label: 'Open in Archives', icon: 'archive', run: () => store.go({ name: 'archives', arg: state.file.path }) }] : []),
      { label: 'Compress with a Password…', icon: 'lock', run: () => store.go({ name: 'archives', arg: JSON.stringify({ make: sel }) }) },
    ] : []),
    { label: 'Convert…', icon: 'refresh', run: () => store.go({ name: 'convert', arg: JSON.stringify(sel) }) },
    // Any format to another (pictures, documents, data, subtitles, fonts, 3D, drawings, mail…).
    { label: 'Convert to…', icon: 'refresh', run: () => store.go({ name: 'convert', arg: JSON.stringify({ tool: 'convert.to', files: sel }) }) },
    ...(state.file.kind === 'image' ? [
      ...(photoOn ? [{ label: 'Edit Photo…', icon: 'sliders', run: () => store.go({ name: 'photo', arg: state.file.path }) }] : []),
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

let modalSeq = 0;

export function Modal({ title, children, onClose, width, label, sheet, testId }: { title?: ReactNode; children: ReactNode; onClose: () => void; width?: number; /** a name for screen readers when there is no title */ label?: string; /** a panel down the right edge instead of a box in the middle */ sheet?: boolean; testId?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [id] = useState(() => `modal-title-${++modalSeq}`);
  // Focus moves into the dialog, Tab stays inside it, and goes back where it was afterwards.
  useFocusTrap(box);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only the top-most dialog closes.
      const all = document.querySelectorAll('.modal');
      if (all[all.length - 1] === box.current) onClose();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return createPortal(
    <div className={`modal-back${sheet ? ' sheet-back' : ''}`} onMouseDown={onClose}>
      <div className={`modal${sheet ? ' sheet' : ''}`} data-testid={testId} ref={box} role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined} aria-label={title ? undefined : label} tabIndex={-1} style={width ? { width } : undefined} onMouseDown={(e) => e.stopPropagation()}>
        {title ? <div className="row" style={{ marginBottom: 14 }}><h2 className="grow" id={id}>{title}</h2><button aria-label="Close" title="Close" className="btn ghost sm icon modal-close" onClick={onClose}><Icon name="close" size={14} /></button></div> : null}
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
      aria-label={compact ? 'Hidden files and folders' : undefined}
    >
      <Icon name={on ? 'eye' : 'eyeOff'} size={14} />
      {compact ? null : on ? ' Hidden shown' : ' Hidden files'}
    </button>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useRowLabel(ref, label);
  return <button ref={ref} role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

/**
 * A control drawn without its own text (a switch, a tick box) takes its
 * accessible name from the row it sits in, when it was not given one.
 */
export function useRowLabel(ref: React.RefObject<HTMLElement | null>, label?: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el || label || el.hasAttribute('aria-labelledby') || el.hasAttribute('aria-label')) return;
    const text = labelFromContext(el);
    if (text) el.setAttribute('aria-label', text.slice(0, 120));
  });
}

export function Check({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  useRowLabel(ref, label);
  return (
    <button ref={ref} role="checkbox" aria-checked={on} aria-label={label} className={`check ${on ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onChange(!on); }} style={{ padding: 0 }}>
      {on ? <Icon name="check" size={11} stroke={3} /> : null}
    </button>
  );
}

/**
 * The one empty state, the same on every page: a small illustration in Keeper's style (the
 * page's icon on a card, on a soft accent shape that recolours with the theme), a short title,
 * one line of text, the one useful next action (and maybe an Import or Learn beside it) and a
 * shortcut hint. Problems (icon "warning") get a calmer amber shape.
 */
export function Empty({ icon = 'search', title, children, action, hint, compact }: { icon?: string; title: string; children?: ReactNode; /** buttons under the text: one main action, at most one more */ action?: ReactNode; /** a shortcut or tip under the buttons ("Drop files here", "⌘N makes one") */ hint?: ReactNode; /** inside a card: a smaller picture and less room around it */ compact?: boolean }) {
  return (
    <div className={`empty ${compact ? 'compact' : ''} ${icon === 'warning' || icon === 'lock' ? 'problem' : ''}`} data-testid="empty-state">
      <EmptyArt icon={icon} />
      <div className="empty-title">{title}</div>
      {children ? <div className="small empty-text">{children}</div> : null}
      {action ? <div className="btn-row empty-actions">{action}</div> : null}
      {hint ? <div className="empty-hint">{hint}</div> : null}
    </div>
  );
}

/** The empty state's picture: drawn here, on this computer, in the theme's own colours. */
export function EmptyArt({ icon }: { icon: string }) {
  return (
    <div className="empty-art" aria-hidden>
      <svg viewBox="0 0 160 112" width="160" height="112">
        <path className="empty-art-blob" d="M30 64c-6-24 10-46 38-50 20-3 30 6 46 4 22-3 38 12 36 34-2 26-24 44-54 46-36 3-60-10-66-34z" />
        <rect className="empty-art-card back" x="44" y="30" width="58" height="46" rx="12" transform="rotate(-8 73 53)" />
        <rect className="empty-art-card" x="58" y="26" width="58" height="58" rx="14" />
        <circle className="empty-art-dot" cx="128" cy="26" r="5" />
        <circle className="empty-art-dot soft" cx="28" cy="34" r="3.5" />
        <circle className="empty-art-dot soft" cx="136" cy="86" r="3" />
      </svg>
      <span className="empty-art-icon"><Icon name={icon} size={26} stroke={1.6} /></span>
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="empty" role="status" aria-live="polite"><div className="spinner" aria-hidden /><div className="small">{label}</div></div>;
}

export function SafetyBadge({ safety }: { safety: 'safe' | 'review' | 'permanent' }) {
  const label = safety === 'safe' ? 'Safe' : safety === 'review' ? 'Review' : 'Permanent';
  return <span className={`badge ${safety}`}>{label}</span>;
}

/**
 * A page's title, a line under it and its actions on the right. On a merged page
 * (System Controls, Privacy & Security, Startup & Apps) the merged page's title
 * shows, with its tabs right under the head; the page's hint cards follow.
 */
export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; /** actions, on the right of the title */ children?: ReactNode }) {
  const hub = useContext(HubContext);
  const embedded = useContext(EmbeddedContext);
  const hints = usePageHints(!embedded);
  if (embedded) {
    return (
      <div className="page-head embedded">
        <div><h2>{title}</h2>{sub ? <div className="sub">{sub}</div> : null}</div>
        {children ? <div className="btn-row">{children}</div> : null}
      </div>
    );
  }
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <h1>{hub?.title ?? title}</h1>
          {sub ? <div className="sub">{sub}</div> : null}
        </div>
        {children ? <div className="btn-row page-actions">{children}</div> : null}
      </div>
      {hub?.tabs ?? null}
      {hints}
    </>
  );
}

const VIEW_BUTTONS: Record<FileView, { icon: string; label: string; key: string }> = {
  grid: { icon: 'grid', label: 'Icons', key: '1' },
  list: { icon: 'list', label: 'List', key: '2' },
  columns: { icon: 'columns', label: 'Columns', key: '3' },
  gallery: { icon: 'gallery', label: 'Gallery', key: '4' },
};

export function ViewControls({ sort, onSort, views }: { sort?: { key: SortKey; desc: boolean }; onSort?: (s: { key: SortKey; desc: boolean }) => void; /** the views this page offers (columns only for real folders) */ views?: FileView[] }) {
  const { view, setView, route } = useStore();
  const offered = views ?? viewsFor(viewScope(route));
  return (
    <div className="btn-row">
      {sort && onSort ? (
        <select className="input" aria-label="Sort by" value={`${sort.key}:${sort.desc ? 'desc' : 'asc'}`} onChange={(e) => { const [k, d] = e.target.value.split(':'); onSort({ key: k as SortKey, desc: d === 'desc' }); }} style={{ height: 30 }}>
          <option value="name:asc">Name A–Z</option>
          <option value="name:desc">Name Z–A</option>
          <option value="date:desc">Newest first</option>
          <option value="date:asc">Oldest first</option>
          <option value="size:desc">Biggest first</option>
          <option value="size:asc">Smallest first</option>
          <option value="kind:asc">Kind</option>
        </select>
      ) : null}
      <div className="seg" role="group" aria-label="View">
        {offered.map((v) => {
          const b = VIEW_BUTTONS[v];
          return <button key={v} data-testid={`view-${v}`} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)} title={`${b.label} (${mod}${b.key})`} aria-label={`${b.label} (${mod}${b.key})`}><Icon name={b.icon} size={14} /></button>;
        })}
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
