// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Column view, as in Finder: the folder's contents in one column; choosing a
// folder shows its contents in the next column, and choosing a file shows its
// preview at the end. ↑ ↓ move, → goes into a folder, ← steps back, Enter or
// a double-click opens.

import { useEffect, useRef, useState } from 'react';
import type { BrowseEntry } from '../../core/api';
import { formatBytes, formatDate } from '../../core/format';
import { sortFoldersFirst, type Sort } from '../../core/folder-view';
import type { FileEntry, FileKind } from '../../core/types';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import { openQuickLook } from '../preview/QuickLook';
import { KIND_COLOR, Loading, Thumb, useFileMenu } from './ui';

/** A folder listing as the views show it: folders marked, Keeper's locked folders as folders with a lock. */
export function browseItem(b: BrowseEntry, root = ''): FileEntry {
  const locked = !b.isDir && /\.keeperlock$/i.test(b.name);
  const dir = (b.isDir && !/\.app$/i.test(b.name)) || locked;
  return {
    path: b.path, name: locked ? b.name.replace(/\.keeperlock$/i, '') : b.name, ext: dir ? '' : b.ext,
    kind: (b.kind === 'folder' ? 'other' : b.kind) as FileKind, size: b.size, mtime: b.mtime, btime: b.mtime, atime: 0, root,
    hidden: b.hidden || undefined, cloudOnly: b.cloudOnly || undefined, dir: dir || undefined, locked: locked || undefined,
  };
}

export function ColumnView({ dir, items, hidden, sort, onOpenDir, onContext }: {
  dir: string;
  items: FileEntry[];
  hidden: boolean;
  sort: Sort;
  onOpenDir: (f: FileEntry) => void;
  onContext?: (e: React.MouseEvent, f: FileEntry) => boolean | void;
}) {
  const { setSelection, setFocused, version, play } = useStore();
  // What is chosen in each column, left to right.
  const [trail, setTrail] = useState<FileEntry[]>([]);
  const [kids, setKids] = useState<Map<string, FileEntry[] | string>>(new Map());
  const box = useRef<HTMLDivElement>(null);
  const menu = useFileMenu();
  useEffect(() => { setTrail([]); setKids(new Map()); }, [dir, hidden, version]);
  useEffect(() => {
    for (const t of trail) {
      if (!t.dir || t.locked || kids.has(t.path)) continue;
      void api.files.browse(t.path, hidden).then(
        (list) => setKids((m) => new Map(m).set(t.path, sortFoldersFirst(list.map((b) => browseItem(b)), sort))),
        (e: Error) => setKids((m) => new Map(m).set(t.path, e?.message || 'Can’t open this folder')),
      );
    }
  }, [trail, kids, hidden, sort]);
  // Keep the newest column in view.
  useEffect(() => { const el = box.current; if (el) el.scrollLeft = el.scrollWidth; }, [trail, kids]);

  const columns: { dir: string; items: FileEntry[] | string | undefined }[] = [{ dir, items }];
  for (const t of trail) if (t.dir && !t.locked) columns.push({ dir: t.path, items: kids.get(t.path) });
  const last = trail[trail.length - 1];

  const choose = (col: number, f: FileEntry) => {
    setTrail((t) => [...t.slice(0, col), f]);
    setSelection([f.path]);
    setFocused(f);
    // Keep the row in view within its own column (never scrolling the columns sideways).
    requestAnimationFrame(() => {
      const el = box.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(f.path)}"]`);
      const pane = el?.closest<HTMLElement>('.col-pane');
      if (!el || !pane) return;
      if (el.offsetTop < pane.scrollTop) pane.scrollTop = el.offsetTop - 4;
      else if (el.offsetTop + el.offsetHeight > pane.scrollTop + pane.clientHeight) pane.scrollTop = el.offsetTop + el.offsetHeight - pane.clientHeight + 4;
    });
  };
  const open = (f: FileEntry) => (f.dir ? onOpenDir(f) : f.kind === 'audio' ? play(f) : void api.files.open(f.path));
  const listOf = (col: number) => { const c = columns[col]?.items; return Array.isArray(c) ? c : []; };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const col = Math.max(0, trail.length - 1);
    const list = listOf(col);
    const at = last ? list.findIndex((f) => f.path === last.path) : -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = list[Math.max(0, Math.min(list.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) choose(col, next);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const inside = last?.dir ? listOf(col + 1) : [];
      if (inside.length) choose(col + 1, inside[0]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (trail.length > 1) { const prev = trail[trail.length - 2]; setTrail(trail.slice(0, -1)); setSelection([prev.path]); setFocused(prev); }
    } else if (e.key === 'Enter' && last) {
      e.preventDefault();
      open(last);
    } else if (e.key === ' ' && last && !last.dir) {
      e.preventDefault();
      const files = listOf(col).filter((f) => !f.dir);
      openQuickLook(files.map((f) => ({ path: f.path, name: f.name })), Math.max(0, files.findIndex((f) => f.path === last.path)));
    }
  };

  return (
    <div className="col-view" ref={box} tabIndex={0} role="group" aria-label="Columns" onKeyDown={onKey}>
      {columns.map((c, col) => (
        <div key={c.dir} className="col-pane" role="listbox" aria-label={c.dir.split(/[\\/]/).pop() || c.dir}>
          {c.items === undefined ? <Loading /> : typeof c.items === 'string' ? <div className="small muted" style={{ padding: 12 }}>{c.items}</div> : !c.items.length ? <div className="small muted" style={{ padding: 12 }}>Empty folder</div> : c.items.map((f) => {
            const on = trail[col]?.path === f.path;
            return (
              <div
                key={f.path}
                data-path={f.path}
                data-dir={f.dir ? '1' : undefined}
                role="option"
                aria-selected={on}
                className={`col-row ${on ? 'on' : ''} ${on && col === trail.length - 1 ? 'here' : ''} ${f.hidden ? 'is-hidden' : ''}`}
                title={f.path}
                onClick={() => { choose(col, f); box.current?.focus({ preventScroll: true }); }}
                onDoubleClick={() => open(f)}
                onContextMenu={(e) => { choose(col, f); if (!onContext?.(e, f)) menu.open(e, f); }}
                draggable
                onDragStart={(e) => { e.preventDefault(); api.files.startDrag([f.path]); }}
              >
                <span className="col-icon" style={{ color: f.dir ? 'var(--accent)' : KIND_COLOR[f.kind] }}><Icon name={f.dir ? (f.locked ? 'folderLock' : 'folder') : f.kind} size={15} /></span>
                <span className="ellipsis grow">{f.name}</span>
                {f.dir && !f.locked ? <Icon name="chevronRight" size={12} className="muted" /> : null}
              </div>
            );
          })}
        </div>
      ))}
      {last && !last.dir ? (
        <div className="col-preview">
          <div className="col-preview-pic"><Thumb file={last} size={512} rich /></div>
          <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{last.name}</div>
          <div className="small muted">{last.ext.toUpperCase() || last.kind} · {formatBytes(last.size)}</div>
          <div className="small muted">Modified {formatDate(last.mtime)}</div>
          <button className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => open(last)}><Icon name="external" size={12} /> Open</button>
        </div>
      ) : null}
      {menu.node}
    </div>
  );
}
