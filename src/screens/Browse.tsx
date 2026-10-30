// SPDX-License-Identifier: AGPL-3.0-or-later
// A folder-by-folder browser, for when you know where something lives.

import { useEffect, useMemo, useState } from 'react';
import type { BrowseEntry } from '../../core/api';
import { formatBytes, relativeTime } from '../../core/format';
import type { FileEntry, FileKind } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ContextMenu, Empty, Files, Loading, Modal, Toggle, ViewControls, type MenuItem } from '../components/ui';
import { useAsync, useStore } from '../state';
import '../styles/screens-a.css';
import { TidyDialog } from '../components/TidyDialog';

type SortKey = 'name' | 'date' | 'size' | 'kind';

function toEntry(b: BrowseEntry, root: string): FileEntry {
  return {
    path: b.path, name: b.name, ext: b.ext, kind: (b.kind === 'folder' ? 'other' : b.kind) as FileKind, size: b.size,
    mtime: b.mtime, btime: b.mtime, atime: 0, root,
  };
}

export function Browse() {
  const { route, go, info, version, settings, updateSettings, refresh, toast, trash } = useStore();
  const dir = route.arg || info?.home || '';
  const sep = info?.sep ?? (dir.includes('\\') ? '\\' : '/');
  const [hidden, setHidden] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false });
  const [selected, setSelected] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [tidy, setTidy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: BrowseEntry } | null>(null);

  const entries = useAsync(() => (dir ? api.files.browse(dir, hidden) : Promise.resolve([])), [dir, hidden, version]);
  useEffect(() => setSelected(null), [dir]);

  const folders = useMemo(() => (entries.data ?? []).filter((e) => e.isDir && !/\.app$/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [entries.data]);
  const files = useMemo(() => {
    const root = dir.split(/[\\/]/).pop() ?? '';
    const list = (entries.data ?? []).filter((e) => !e.isDir || /\.app$/i.test(e.name)).map((e) => toEntry(e, root));
    const d = sort.desc ? -1 : 1;
    return list.sort((a, b) =>
      sort.key === 'size' ? d * (a.size - b.size)
      : sort.key === 'date' ? d * (a.mtime - b.mtime)
      : sort.key === 'kind' ? d * a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
      : d * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }, [entries.data, sort, dir]);

  // Breadcrumbs from the path; Windows drive roots and POSIX root both handled.
  const crumbs = useMemo(() => {
    const parts = dir.split(/[\\/]/).filter(Boolean);
    const isPosix = dir.startsWith('/');
    const out: { label: string; path: string }[] = [];
    let acc = isPosix ? '' : '';
    parts.forEach((p, i) => {
      acc = i === 0 ? (isPosix ? `/${p}` : `${p}${sep}`) : `${acc.endsWith(sep) ? acc : acc + sep}${p}`;
      out.push({ label: p, path: acc });
    });
    if (isPosix) out.unshift({ label: '/', path: '/' });
    // Show the home folder as one crumb instead of /Users/name.
    if (info?.home && dir.startsWith(info.home)) {
      const homeParts = info.home.split(/[\\/]/).filter(Boolean).length + (isPosix ? 1 : 0);
      return [{ label: 'Home', path: info.home }, ...out.slice(homeParts)];
    }
    return out;
  }, [dir, sep, info?.home]);

  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2].path : null;
  const pinned = settings?.pinned.includes(dir);

  const folderMenu = (e: BrowseEntry): MenuItem[] => [
    { label: 'Open', icon: 'folder', run: () => go({ name: 'browse', arg: e.path }) },
    { label: info?.platform === 'win32' ? 'Show in Explorer' : info?.platform === 'darwin' ? 'Show in Finder' : 'Show in Folder', icon: 'reveal', run: () => void api.files.reveal(e.path) },
    { label: 'Pin to Sidebar', icon: 'pin', run: () => settings && !settings.pinned.includes(e.path) && void updateSettings({ pinned: [...settings.pinned, e.path] }) },
    { label: 'Show Size in Space Map', icon: 'map', run: () => go({ name: 'space', arg: e.path }) },
    { label: 'Copy Path', icon: 'copy', run: () => void api.files.copyText(e.path) },
    { label: 'Compress', icon: 'zip', run: () => void api.files.compress([e.path]).then(() => refresh()) },
    { sep: true, label: '' },
    { label: 'Move to Trash', icon: 'trash', danger: true, run: () => void trash([e.path]) },
  ];

  return (
    <div>
      <div className="page-head" style={{ alignItems: 'center' }}>
        <div className="row" style={{ minWidth: 0, gap: 6 }}>
          <button className="btn ghost sm icon" disabled={!parent} onClick={() => parent && go({ name: 'browse', arg: parent })} title="Enclosing folder"><Icon name="arrowUp" size={14} /></button>
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={c.path} className="row" style={{ gap: 2 }}>
                {i > 0 ? <Icon name="chevronRight" size={12} className="muted" /> : null}
                <button onClick={() => go({ name: 'browse', arg: c.path })}>{c.label}</button>
              </span>
            ))}
          </div>
        </div>
        <div className="btn-row">
          <label className="row small muted" style={{ gap: 6 }}><Toggle on={hidden} onChange={setHidden} label="Show hidden files" /> Hidden</label>
          <button className="btn sm" onClick={() => setNewFolder('untitled folder')}><Icon name="plus" size={13} /> New Folder</button>
          <button className="btn sm" onClick={() => setTidy(true)} title="Sort loose files into folders by kind, month or extension"><Icon name="broom" size={13} /> Tidy</button>
          <button className="btn sm" onClick={() => settings && void updateSettings({ pinned: pinned ? settings.pinned.filter((p) => p !== dir) : [...settings.pinned, dir] })}>
            <Icon name="pin" size={13} /> {pinned ? 'Unpin' : 'Pin'}
          </button>
          <button className="btn sm" onClick={() => void api.files.reveal(dir)}><Icon name="reveal" size={13} /> Open</button>
          <ViewControls sort={sort} onSort={setSort} />
        </div>
      </div>

      {entries.loading && !entries.data ? <Loading /> : entries.error ? <Empty icon="lock" title="Can’t open this folder">{entries.error}</Empty> : (
        <>
          {folders.length ? (
            <div className="folder-grid">
              {folders.map((f) => (
                <div
                  key={f.path}
                  className={`folder-item ${selected === f.path ? 'selected' : ''}`}
                  onClick={() => setSelected(f.path)}
                  onDoubleClick={() => go({ name: 'browse', arg: f.path })}
                  onContextMenu={(e) => { e.preventDefault(); setSelected(f.path); setMenu({ x: e.clientX, y: e.clientY, entry: f }); }}
                  title={f.path}
                  draggable
                  onDragStart={(e) => { e.preventDefault(); api.files.startDrag([f.path]); }}
                >
                  <Icon name="folder" size={20} style={{ color: 'var(--accent)', flex: 'none' }} />
                  <div className="grow">
                    <div className="ellipsis" style={{ fontWeight: 550 }}>{f.name}</div>
                    <div className="small muted ellipsis">{f.size ? `${formatBytes(f.size)} · ` : ''}{relativeTime(f.mtime)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {files.length ? (
            <Files files={files} sort={sort} onSort={(k) => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== 'name' }))} />
          ) : !folders.length ? <Empty icon="folder" title="This folder is empty" /> : null}
        </>
      )}

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={folderMenu(menu.entry)} onClose={() => setMenu(null)} /> : null}

      {tidy ? <TidyDialog dir={dir} onClose={() => setTidy(false)} /> : null}

      {newFolder !== null ? (
        <Modal title="New folder" onClose={() => setNewFolder(null)} width={400}>
          <div className="col">
            <input className="input" autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onFocus={(e) => e.target.select()}
              onKeyDown={(e) => { if (e.key === 'Enter') (document.getElementById('nf-create') as HTMLButtonElement | null)?.click(); }} />
            <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn" onClick={() => setNewFolder(null)}>Cancel</button>
              <button id="nf-create" className="btn primary" disabled={!newFolder.trim()} onClick={async () => {
                try {
                  await api.files.newFolder(dir, newFolder.trim());
                  refresh();
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Could not create the folder');
                }
                setNewFolder(null);
              }}>Create</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
