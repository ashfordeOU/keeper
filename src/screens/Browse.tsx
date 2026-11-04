// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A real folder, the way Finder and File Explorer show one: its subfolders
// first, then its files, as icons, a list with disclosure triangles, columns
// or a gallery; a path bar on top; double-click or Enter opens a folder, and
// Back, Forward and ⌘↑ / Alt+↑ (the enclosing folder) work. The "By type"
// chips over the list show one type (Documents, Pictures…) in this folder and
// the folders inside it; the type sits in the route's q (core/file-types.ts).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatBytes } from '../../core/format';
import { flattenTree, sortFoldersFirst } from '../../core/folder-view';
import type { FileEntry } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { browseItem, ColumnView } from '../components/ColumnView';
import { takeShowInFolder } from '../folder-nav';
import { ContextMenu, Empty, Files, HiddenToggle, Loading, Modal, RenameDialog, ViewControls, type ListTree, type MenuItem } from '../components/ui';
import { LockDialog, lockError, UnlockDialog } from '../components/LockDialog';
import '../styles/lock.css';
import { mod, shift, useAsync, useStore } from '../state';
import { chooseDestination, folderDrop, pasteInto, setFileClip, useFileClip } from '../fileops';
import '../styles/screens-a.css';
import { TidyDialog } from '../components/TidyDialog';
import { parseServerAddress } from '../../core/places';
import { ConnectDialog } from './Network';
import '../styles/places.css';
import { chipQuery, isUnder, matchesType, routeChip, typeCounts, typeLabel } from '../../core/file-types';
import { looksLikeScreenshot } from '../../core/classify';
import { rememberFolder, TypeChips } from '../components/TypeChips';
import { CopyTextButton, GroupToggle, TypeEmpty, useTypeList } from './Library';

type SortKey = 'name' | 'date' | 'size' | 'kind';

export function Browse() {
  const { route, go, info, version, settings, updateSettings, refresh, toast, trash, view, selection, setSelection, setFocused } = useStore();
  const clip = useFileClip();
  const dir = route.arg || info?.home || '';
  const sep = info?.sep ?? (dir.includes('\\') ? '\\' : '/');
  const hidden = !!settings?.showHidden;
  const [locking, setLocking] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [tidy, setTidy] = useState(false);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  // Typing a path (or a server address such as smb://nas/Media or \\server\share) into the path bar.
  const [typed, setTyped] = useState<string | null>(null);
  const [server, setServer] = useState<string | null>(null);
  const goTyped = () => {
    const v = (typed ?? '').trim();
    setTyped(null);
    if (!v) return;
    if (/^[a-z]+:\/\//i.test(v) || /^\\\\/.test(v)) {
      if (parseServerAddress(v)) setServer(v);
      else toast('That does not look like a server address.');
      return;
    }
    go({ name: 'browse', arg: v.replace(/^~(?=$|[\\/])/, info?.home ?? '~') });
  };
  const getInfo = (p: string, name: string) => {
    toast(`Measuring ${name}…`);
    void api.places.folderSize(p).then((s) => toast(`${name}: ${formatBytes(s.size)} · ${s.files.toLocaleString()} files in ${s.folders.toLocaleString()} folders`));
  };

  const entries = useAsync(() => (dir ? api.files.browse(dir, hidden) : Promise.resolve([])), [dir, hidden, version]);
  useEffect(() => rememberFolder(dir), [dir]);

  // Folders Keeper unlocked, which can be locked again in one step.
  const locks = useAsync(() => api.lock.list(), [version]);
  const unlockedHere = useMemo(() => new Set((locks.data ?? []).filter((l) => l.state === 'unlocked' && l.folder).map((l) => l.folder!)), [locks.data]);

  // Subfolders first, then files, in the chosen order (locked folders sit with the folders).
  const items = useMemo(() => {
    const root = dir.split(/[\\/]/).pop() ?? '';
    return sortFoldersFirst((entries.data ?? []).map((e) => browseItem(e, root)), sort);
  }, [entries.data, sort, dir]);

  // A type chosen with the chips: from the library (this folder and inside it) when Keeper reads
  // this folder, otherwise from what is in the folder itself.
  const chip = routeChip(route);
  const indexed = !!dir && (settings?.folders ?? []).some((r) => isUnder(dir, r) || isUnder(r, dir));
  const typeList = useTypeList(chipQuery(chip, { under: dir }), `browse:${chip}`, true, sort, true, chip === 'all' || !indexed);
  const local = useMemo(() => (indexed ? undefined : items.map((e) => ({ ...e, screenshot: e.screenshot ?? (looksLikeScreenshot(e.name) || undefined) }))), [indexed, items]);
  const localCounts = useMemo(() => (local ? typeCounts(local) : undefined), [local]);
  const localShown = useMemo(() => (local && chip !== 'all' ? sortFoldersFirst(local.filter((f) => matchesType(f, chipQuery(chip))), sort) : undefined), [local, chip, sort]);
  const typeShown = chip === 'all' ? undefined : indexed ? typeList.shown : localShown;
  const folderName = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir;

  // List view's disclosure triangles: open folders and what is in them.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [kids, setKids] = useState<Map<string, FileEntry[]>>(new Map());
  useEffect(() => { setExpanded(new Set()); setKids(new Map()); }, [dir]);
  useEffect(() => setKids(new Map()), [hidden, version, sort]);
  useEffect(() => {
    for (const p of expanded) {
      if (kids.has(p)) continue;
      void api.files.browse(p, hidden).then(
        (list) => setKids((m) => new Map(m).set(p, sortFoldersFirst(list.map((b) => browseItem(b)), sort))),
        () => setKids((m) => new Map(m).set(p, [])),
      );
    }
  }, [expanded, kids, hidden, sort]);
  const rows = useMemo(() => flattenTree(items, expanded, (p) => kids.get(p)), [items, expanded, kids]);
  const depth = useMemo(() => new Map(rows.map((r) => [r.item.path, r.depth])), [rows]);
  const tree: ListTree = useMemo(() => ({
    depth: (p) => depth.get(p) ?? 0,
    expanded: (p) => expanded.has(p),
    toggle: (p, open) => setExpanded((cur) => {
      const want = open ?? !cur.has(p);
      if (want === cur.has(p)) return cur;
      const next = new Set(cur);
      // Folding a folder folds everything inside it too.
      if (want) next.add(p);
      else for (const x of cur) if (x === p || x.startsWith(p + sep)) next.delete(x);
      return next;
    }),
  }), [depth, expanded, sep]);
  const shown = view === 'list' ? rows.map((r) => r.item) : items;
  const nDirs = items.filter((f) => f.dir).length;

  // "Show in Enclosing Folder" from the Library: select the file once it shows.
  useEffect(() => {
    if (!entries.data) return;
    const want = takeShowInFolder(dir);
    const f = want ? items.find((x) => x.path === want) : undefined;
    if (!f) return;
    setSelection([f.path]);
    setFocused(f);
    setTimeout(() => document.querySelector<HTMLElement>(`[data-path="${CSS.escape(f.path)}"]`)?.scrollIntoView({ block: 'center' }), 150);
  }, [entries.data, dir, items, setSelection, setFocused]);

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

  // ⌘↑ (Mac) or Alt+↑ (Windows, Linux): the enclosing folder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"], .modal, .menu, .palette, .ql')) return;
      if (e.key === 'ArrowUp' && (e.metaKey || e.ctrlKey || e.altKey) && !e.shiftKey && parent) { e.preventDefault(); go({ name: 'browse', arg: parent }); }
      const cmd = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
      if (!cmd || t?.closest?.('[role="dialog"]') || window.getSelection()?.toString()) return;
      const k = e.key.toLowerCase();
      // ⌘V / Ctrl+V: paste what was copied or cut into this folder.
      if (k === 'v' && dir) { e.preventDefault(); void pasteInto(dir); }
      // The columns view has no file grid of its own to take ⌘C and ⌘X.
      else if (view === 'columns' && (k === 'c' || k === 'x') && selection.length) { e.preventDefault(); setFileClip(k === 'x' ? 'cut' : 'copy', selection); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [parent, go, dir, view, selection]);

  const openDir = useCallback((f: FileEntry) => (f.locked ? setUnlocking(f.path) : go({ name: 'browse', arg: f.path })), [go]);
  const onContext = (e: React.MouseEvent, f: FileEntry) => {
    if (!f.dir) return false;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, entry: f });
    return true;
  };

  const folderMenu = (e: FileEntry): MenuItem[] => [
    { label: 'Open', icon: 'folder', run: () => go({ name: 'browse', arg: e.path }) },
    { label: info?.platform === 'win32' ? 'Show in Explorer' : info?.platform === 'darwin' ? 'Show in Finder' : 'Show in Folder', icon: 'reveal', run: () => void api.files.reveal(e.path) },
    { label: 'Pin to Sidebar', icon: 'pin', run: () => settings && !settings.pinned.includes(e.path) && void updateSettings({ pinned: [...settings.pinned, e.path] }) },
    { label: 'Get Info', icon: 'info', run: () => getInfo(e.path, e.name) },
    { label: 'Rename…', icon: 'rename', run: () => setRenaming(e.path) },
    { label: 'Show Size in Space Map', icon: 'map', run: () => go({ name: 'space', arg: e.path }) },
    { sep: true, label: '' },
    { label: 'Cut', icon: 'drag', run: () => setFileClip('cut', [e.path]) },
    { label: 'Copy', icon: 'copy', run: () => setFileClip('copy', [e.path]) },
    { label: 'Paste Into Folder', icon: 'clipboard', run: () => void pasteInto(e.path) },
    { label: 'Move to…', icon: 'folder', run: () => chooseDestination('move', selection.includes(e.path) ? selection : [e.path]) },
    { label: 'Copy to…', icon: 'copy', run: () => chooseDestination('copy', selection.includes(e.path) ? selection : [e.path]) },
    { label: 'Copy Path', icon: 'copy', run: () => void api.files.copyText(e.path) },
    { label: 'Open in Terminal', icon: 'terminal', run: () => go({ name: 'terminal', arg: e.path }) },
    { label: 'Compress', icon: 'zip', run: () => void api.files.compress([e.path]).then(() => refresh()) },
    { sep: true, label: '' },
    unlockedHere.has(e.path)
      ? { label: 'Lock Again Now', icon: 'lock', run: () => void api.lock.relock(e.path).then(() => { toast(`“${e.name}” is locked`); refresh(); }, (err) => toast(lockError(err))) }
      : { label: 'Lock Folder…', icon: 'lock', run: () => setLocking(e.path) },
    { sep: true, label: '' },
    { label: 'Move to Trash', icon: 'trash', danger: true, run: () => void trash([e.path]) },
  ];
  const vaultMenu = (e: FileEntry): MenuItem[] => [
    { label: 'Unlock…', icon: 'unlock', run: () => setUnlocking(e.path) },
    { label: info?.platform === 'win32' ? 'Show in Explorer' : info?.platform === 'darwin' ? 'Show in Finder' : 'Show in Folder', icon: 'reveal', run: () => void api.files.reveal(e.path) },
    { label: 'Copy Path', icon: 'copy', run: () => void api.files.copyText(e.path) },
    { sep: true, label: '' },
    { label: 'Move to Trash', icon: 'trash', danger: true, run: () => void trash([e.path]) },
  ];

  return (
    <div className="browse-page" {...folderDrop(dir || undefined)}>
      <div className="page-head" style={{ alignItems: 'center' }}>
        <div className="row" style={{ minWidth: 0, gap: 6 }}>
          <button className="btn ghost sm icon" disabled={!parent} onClick={() => parent && go({ name: 'browse', arg: parent })} title={`Enclosing folder (${info?.platform === 'darwin' ? '⌘↑' : 'Alt+↑'})`} aria-label="Enclosing folder"><Icon name="arrowUp" size={14} /></button>
          {typed !== null ? (
            <div className="browse-pathbar" style={{ marginBottom: 0, minWidth: 320 }}>
              <input className="input" autoFocus value={typed} placeholder="/path, ~/folder, smb://server/share, \\server\share" onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') goTyped(); if (e.key === 'Escape') setTyped(null); }} onBlur={() => setTyped(null)} />
            </div>
          ) : (
          <nav className="crumbs" aria-label="Path" data-testid="pathbar" title="Double-click to type a path or server address" onDoubleClick={() => setTyped(dir)}>
            {crumbs.map((c, i) => (
              <span key={c.path} className="row" style={{ gap: 2 }}>
                {i > 0 ? <Icon name="chevronRight" size={12} className="muted" /> : null}
                <button className="crumb" {...folderDrop(c.path)} aria-current={i === crumbs.length - 1 ? 'location' : undefined} onClick={() => go({ name: 'browse', arg: c.path })}>
                  {i === 0 ? <Icon name={c.path === info?.home ? 'home' : 'disk'} size={13} /> : null}{c.label}
                </button>
              </span>
            ))}
          </nav>
          )}
          <button className="btn ghost sm icon" title="Go to a path or server address" aria-label="Go to a path or server address" onClick={() => setTyped(typed === null ? dir : null)}><Icon name="terminal" size={13} /></button>
        </div>
        <div className="btn-row">
          {chip === 'screenshot' ? <CopyTextButton list={typeShown} /> : null}
          {chip !== 'all' && indexed ? <GroupToggle grouped={typeList.grouped} onChange={typeList.setGrouped} /> : null}
          {/* Hidden files shown: a pill that says so and hides them again (shown from More or ⌘⇧.). */}
          {settings?.showHidden ? <HiddenToggle /> : null}
          {clip ? <button className="btn sm" data-testid="paste-here" onClick={() => void pasteInto(dir)} title={`Paste ${clip.paths.length === 1 ? 'the item' : `${clip.paths.length} items`} you ${clip.op === 'cut' ? 'cut' : 'copied'} into this folder`}><Icon name="clipboard" size={13} /> Paste{clip.op === 'cut' ? ' (Move)' : ''}</button> : null}
          <button className="btn sm primary" data-testid="new-folder" onClick={() => setNewFolder('untitled folder')}><Icon name="plus" size={13} /> New Folder</button>
          <ViewControls sort={sort} onSort={setSort} />
          {/* The rest of this folder's actions, one click away. */}
          <button className="btn sm ghost icon" data-testid="folder-more" aria-haspopup="menu" aria-expanded={!!more} title="More for this folder" aria-label="More for this folder" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMore({ x: r.right - 220, y: r.bottom + 4 }); }}><Icon name="more" size={14} /></button>
        </div>
      </div>

      {dir ? <TypeChips folder={dir} active={chip} counts={localCounts} /> : null}
      {entries.data?.some((e) => e.cloudOnly) ? (
        <div className="small muted row cloud-mark" style={{ gap: 6, marginBottom: 10 }}><Icon name="cloud" size={13} />{entries.data.filter((e) => e.cloudOnly).length} item(s) here are kept only in the cloud and download when opened.</div>
      ) : null}
      {entries.loading && !entries.data ? <Loading /> : entries.error ? <Empty icon="lock" title="Can’t open this folder">{entries.error}</Empty> : chip !== 'all' ? (
        <Files
          files={typeShown}
          header={indexed ? typeList.header : undefined}
          showFolder={!(indexed && typeList.header) && view === 'list'}
          sort={sort}
          onSort={(k) => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== 'name' }))}
          showSource={chip === 'web'}
          empty={<TypeEmpty chip={chip} inFolder={folderName} />}
        />
      ) : !items.length ? <Empty icon="folder" title="This folder is empty" action={<button className="btn" onClick={() => setNewFolder('untitled folder')}><Icon name="plus" size={13} /> New Folder</button>}>Drop files here to move them in.</Empty> : view === 'columns' ? (
        <ColumnView dir={dir} items={items} hidden={hidden} sort={sort} onOpenDir={openDir} onContext={onContext} />
      ) : (
        <Files
          files={shown}
          sort={sort}
          onSort={(k) => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== 'name' }))}
          tree={tree}
          onOpenDir={openDir}
          onContext={onContext}
        />
      )}
      {chip !== 'all' ? (typeShown?.length ? <div className="small muted folder-status" aria-live="polite">{typeShown.length.toLocaleString()} {typeLabel(chip).toLowerCase()} in {folderName}{indexed ? ' and the folders in it' : ''}</div> : null) : items.length ? <div className="small muted folder-status" aria-live="polite">{nDirs ? `${nDirs} folder${nDirs === 1 ? '' : 's'}, ` : ''}{items.length - nDirs} file{items.length - nDirs === 1 ? '' : 's'}</div> : null}

      {more ? <ContextMenu x={more.x} y={more.y} label="More for this folder" onClose={() => setMore(null)} items={[
        { label: `${settings?.showHidden ? 'Hide' : 'Show'} Hidden Files (${mod}${shift}.)`, icon: settings?.showHidden ? 'eyeOff' : 'eye', run: () => settings && void updateSettings({ showHidden: !settings.showHidden }) },
        { label: 'Tidy This Folder…', icon: 'broom', run: () => setTidy(true) },
        { label: pinned ? 'Remove from Sidebar' : 'Add to Sidebar', icon: 'pin', run: () => settings && void updateSettings({ pinned: pinned ? settings.pinned.filter((p) => p !== dir) : [...settings.pinned, dir] }) },
        { label: info?.platform === 'win32' ? 'Show in Explorer' : info?.platform === 'darwin' ? 'Show in Finder' : 'Show in File Manager', icon: 'reveal', run: () => void api.files.reveal(dir) },
      ]} /> : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.entry.locked ? vaultMenu(menu.entry) : folderMenu(menu.entry)} onClose={() => setMenu(null)} /> : null}
      {locking ? <LockDialog dir={locking} onClose={() => setLocking(null)} /> : null}
      {unlocking ? <UnlockDialog vault={unlocking} onClose={() => setUnlocking(null)} /> : null}
      {server !== null ? <ConnectDialog initial={server} onClose={() => setServer(null)} /> : null}

      {renaming ? <RenameDialog paths={[renaming]} onClose={() => setRenaming(null)} /> : null}
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
