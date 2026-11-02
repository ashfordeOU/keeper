// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Browsing a connection: a cloud service, a server, a home server or another
// computer. Pictures get thumbnails as they scroll into view; opening a file
// fetches it once and keeps a copy for next time; saving it in its app sends
// the change back.

import { useEffect, useMemo, useRef, useState } from 'react';
import { classifyKind } from '../../core/remote/kind';
import { parentRemote, parseRemoteRoute, remoteCrumbs, remoteRoute } from '../../core/remote/paths';
import type { ConnStatus, RemoteEntry, Transfer } from '../../core/remote/types';
import { formatBytes, relativeTime } from '../../core/format';
import { api } from '../api';
import { ConnectionDialog, deviceIcon, errText } from '../components/ConnectionDialog';
import { Icon } from '../components/Icon';
import { ContextMenu, Empty, ExtTile, Loading, Modal, type MenuItem } from '../components/ui';
import { openQuickLook } from '../preview/QuickLook';
import { useStore } from '../state';
import { RemoteOverview } from './RemoteOverview';
import '../styles/remote.css';
import '../styles/screens-a.css';

type Sort = 'name' | 'date' | 'size';

// At most three thumbnails are fetched at once, so a big folder never floods the connection.
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 3) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}
const thumbs = new Map<string, string | null>();

function RemoteThumb({ id, entry }: { id: string; entry: RemoteEntry }) {
  const kind = classifyKind(entry.name);
  const key = `${id}:${entry.path}:${entry.size}:${entry.mtime}`;
  const [src, setSrc] = useState<string | null | undefined>(thumbs.get(key));
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (src !== undefined || (kind.kind !== 'image' && kind.kind !== 'video' && kind.ext !== 'pdf')) return;
    const el = box.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver((seen) => {
      if (!seen.some((s) => s.isIntersecting)) return;
      io.disconnect();
      void slot(() => api.remote.thumbnail(id, entry, 256)).then((url) => {
        thumbs.set(key, url);
        if (alive) setSrc(url);
      });
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  }, [key, src, kind.kind, kind.ext, id, entry]);
  return <div ref={box} className="remote-thumb">{src ? <img src={src} alt="" draggable={false} /> : <ExtTile ext={kind.ext} kind={kind.kind} />}</div>;
}

export function Remote() {
  const { route, go, toast } = useStore();
  const loc = parseRemoteRoute(route.arg);
  const id = loc?.id ?? '';
  const dir = loc?.path ?? '/';
  const [conns, setConns] = useState<Awaited<ReturnType<typeof api.remote.list>> | null>(null);
  const [entries, setEntries] = useState<RemoteEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('name');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [naming, setNaming] = useState<{ kind: 'folder' | 'rename'; entry?: RemoteEntry; value: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [over, setOver] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);

  const conn = conns?.connections.find((c) => c.id === id);
  const status: ConnStatus | undefined = conns?.status.find((s) => s.id === id);

  useEffect(() => {
    void api.remote.list().then(setConns);
    const offs = [
      api.on('remote-changed', () => { void api.remote.list().then(setConns); refresh(); }),
      api.on('remote-status', (s) => setConns((c) => (c ? { ...c, status: [...c.status.filter((x) => x.id !== s.id), s] } : c))),
      api.on('remote-transfer', (t) => setTransfers((all) => [...all.filter((x) => x.id !== t.id), t].slice(-6))),
      api.on('remote-saved', (r) => r.id === id && toast(r.error ? `Could not save back: ${r.error}` : r.conflict ? `It changed on the server meanwhile, so your edit was saved as a copy` : 'Saved back to the server')),
    ];
    return () => offs.forEach((o) => o());
  }, [id, toast]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setEntries(null);
    setError(null);
    setSelected(new Set());
    api.remote.listDir(id, dir).then((e) => alive && setEntries(e), (e) => alive && setError(errText(e)));
    return () => { alive = false; };
  }, [id, dir, tick]);

  const sorted = useMemo(() => {
    const list = [...(entries ?? [])].filter((e) => !e.name.startsWith('.'));
    const by = (a: RemoteEntry, b: RemoteEntry) => (sort === 'size' ? b.size - a.size : sort === 'date' ? b.mtime - a.mtime : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return { folders: list.filter((e) => e.isDir).sort(by), files: list.filter((e) => !e.isDir).sort(by) };
  }, [entries, sort]);

  // No connection chosen: the overview of every connection, with Add….
  if (!loc) return <RemoteOverview />;
  const crumbs = remoteCrumbs(conn?.name ?? 'Connection', dir);
  const parent = parentRemote(dir);
  const open = (e: RemoteEntry) => (e.isDir ? go({ name: 'remote', arg: remoteRoute(id, e.path) }) : void preview(e));
  const preview = async (e: RemoteEntry) => {
    toast(`Fetching ${e.name}…`);
    try {
      const local = await api.remote.preview(id, e);
      openQuickLook([{ path: local, name: e.name }]);
    } catch (err) {
      toast(errText(err));
    }
  };
  const chosen = (): RemoteEntry[] => (entries ?? []).filter((e) => selected.has(e.path));
  const download = async (list: RemoteEntry[]) => {
    if (!list.length) return;
    const r = await api.remote.download(id, list);
    toast(r.failed.length ? `Downloaded ${r.done}; ${r.failed.length} failed` : `Downloaded to ${r.folder}`);
  };
  const remove = async (list: RemoteEntry[]) => {
    if (!list.length || !confirm(`Delete ${list.length === 1 ? `“${list[0].name}”` : `${list.length} items`} on ${conn?.name}? Services with a trash keep it there.`)) return;
    const r = await api.remote.removeEntries(id, list.map((e) => ({ path: e.path, isDir: e.isDir })));
    toast(r.failed.length ? `Deleted ${r.removed}; ${r.failed[0]}` : `Deleted ${r.removed} item${r.removed === 1 ? '' : 's'}`);
  };
  const itemMenu = (ev: React.MouseEvent, e: RemoteEntry) => {
    ev.preventDefault();
    if (!selected.has(e.path)) setSelected(new Set([e.path]));
    const list = selected.has(e.path) ? chosen() : [e];
    setMenu({
      x: ev.clientX, y: ev.clientY, items: [
        e.isDir ? { label: 'Open', icon: 'folder', run: () => open(e) } : { label: 'Quick Look', icon: 'eye', run: () => void preview(e) },
        ...(!e.isDir ? [{ label: 'Open with Its App', icon: 'external', run: () => void api.remote.open(id, e).then(() => toast('Opened. Saving it sends the change back.'), (err) => toast(errText(err))) }] : []),
        { label: list.length > 1 ? `Download ${list.length} Items` : 'Download', icon: 'down', run: () => void download(list) },
        ...(e.isDir ? [{ label: e.offline ? 'Stop Keeping Offline' : 'Keep Offline', icon: 'pin', run: () => void api.remote.setOffline(id, e.path, !e.offline).then((p) => { toast(p ? `Keeping a copy in ${p}` : 'No longer kept offline'); refresh(); }) }] : []),
        { label: 'Rename…', icon: 'rename', run: () => setNaming({ kind: 'rename', entry: e, value: e.name }) },
        { label: 'Copy Path', icon: 'copy', run: () => void api.files.copyText(`${conn?.name}:${e.path}`) },
        { sep: true, label: '' },
        { label: 'Delete…', icon: 'trash', danger: true, run: () => void remove(list) },
      ],
    });
  };
  const click = (ev: React.MouseEvent, e: RemoteEntry) => {
    const s = new Set(ev.metaKey || ev.ctrlKey ? selected : []);
    if (s.has(e.path) && (ev.metaKey || ev.ctrlKey)) s.delete(e.path);
    else s.add(e.path);
    setSelected(s);
  };
  const onDrop = async (ev: React.DragEvent) => {
    ev.preventDefault();
    setOver(false);
    const paths = [...ev.dataTransfer.files].map((f) => api.files.pathOf?.(f) ?? (f as File & { path?: string }).path).filter((p): p is string => !!p);
    if (!paths.length) return;
    toast(`Uploading ${paths.length} item${paths.length === 1 ? '' : 's'}…`);
    const r = await api.remote.upload(id, dir, paths);
    toast(r.failed.length ? `Uploaded ${r.done}; ${r.failed[0]}` : `Uploaded ${r.done} file${r.done === 1 ? '' : 's'}`);
    refresh();
  };
  const q = status?.quota;
  const running = transfers.filter((t) => t.state === 'running');

  return (
    <div className={`remote ${over ? 'drop-over' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)} onDrop={(e) => void onDrop(e)}>
      <div className="page-head" style={{ alignItems: 'center' }}>
        <div className="row" style={{ minWidth: 0, gap: 6 }}>
          <button className="btn ghost sm icon" disabled={!parent} onClick={() => parent && go({ name: 'remote', arg: remoteRoute(id, parent) })} title="Enclosing folder" aria-label="Enclosing folder"><Icon name="arrowUp" size={14} /></button>
          <Icon name={deviceIcon(conn?.device)} size={16} />
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={c.path} className="row" style={{ gap: 2 }}>
                {i > 0 ? <Icon name="chevronRight" size={12} className="muted" /> : null}
                <button onClick={() => go({ name: 'remote', arg: remoteRoute(id, c.path) })}>{c.label}</button>
              </span>
            ))}
          </div>
        </div>
        <div className="btn-row">
          <button className="btn sm" onClick={() => setNaming({ kind: 'folder', value: 'New folder' })}><Icon name="plus" size={13} /> New Folder</button>
          <button className="btn sm" onClick={async () => { const r = await api.remote.uploadPick(id, dir); if (r.done || r.failed.length) toast(r.failed.length ? `Uploaded ${r.done}; ${r.failed[0]}` : `Uploaded ${r.done} file${r.done === 1 ? '' : 's'}`); refresh(); }}><Icon name="arrowUp" size={13} /> Upload</button>
          <button className="btn sm" disabled={!selected.size} onClick={() => void download(chosen())}><Icon name="down" size={13} /> Download</button>
          <button className="btn sm ghost icon" title="Refresh" aria-label="Refresh" onClick={refresh}><Icon name="refresh" size={13} /></button>
          <select className="input sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ width: 'auto' }}>
            <option value="name">Name</option><option value="date">Newest</option><option value="size">Largest</option>
          </select>
        </div>
      </div>

      <div className="remote-status small muted">
        <span className={`dot ${status?.state ?? 'idle'}`} />
        {status?.state === 'connected' ? 'Connected' : status?.state === 'connecting' ? 'Connecting…' : status?.state === 'needs-sign-in' ? 'Needs you to sign in again' : status?.state === 'offline' ? 'Can’t reach it right now' : status?.state === 'error' ? 'Something went wrong' : 'Ready'}
        {q?.total ? <span> · {formatBytes(q.free ?? q.total - (q.used ?? 0))} free of {formatBytes(q.total)}</span> : q?.used ? <span> · {formatBytes(q.used)} used</span> : null}
        {conn?.offline?.length ? <span> · {conn.offline.length} folder{conn.offline.length === 1 ? '' : 's'} kept offline</span> : null}
        <span className="grow" />
        <span>Drop files here to upload</span>
      </div>

      {status?.state === 'needs-sign-in' || status?.state === 'error' ? (
        <div className="conn-note warn" style={{ marginBottom: 12 }}>
          <Icon name="warning" size={14} /> <span className="grow">{status.message}</span>
          {conn?.kind === 'rclone' && conn.provider ? <button className="btn sm primary" onClick={() => void api.remote.signIn(conn.provider!, conn.id).then(() => { toast('Signed in again'); refresh(); }, (e) => toast(errText(e)))}>Sign in again…</button> : <button className="btn sm" onClick={() => setEditing(true)}>Fix…</button>}
        </div>
      ) : null}

      {running.length ? (
        <div className="transfers">
          {running.map((t) => (
            <div key={t.id} className="transfer">
              <Icon name={t.direction === 'up' ? 'arrowUp' : 'down'} size={13} />
              <span className="grow ellipsis small">{t.label}</span>
              <span className="small muted">{t.total ? `${Math.round((t.bytes / t.total) * 100)}%` : formatBytes(t.bytes)}</span>
              <div className="progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Number(t.total ? (t.bytes / t.total) * 100 : 30) || 0)} style={{ width: 120 }}><i style={{ width: `${t.total ? (t.bytes / t.total) * 100 : 30}%` }} /></div>
              <button className="btn ghost sm icon" title="Cancel" aria-label="Cancel" onClick={() => void api.remote.cancelTransfer(t.id)}><Icon name="close" size={12} /></button>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <Empty icon="warning" title="Can’t open this folder">{error}</Empty> : !entries ? <Loading label={`Opening ${conn?.name ?? 'connection'}…`} /> : !sorted.folders.length && !sorted.files.length ? (
        <Empty icon="folder" title="This folder is empty">Drop files here, or use Upload.</Empty>
      ) : (
        <>
          {sorted.folders.length ? (
            <div className="folder-grid">
              {sorted.folders.map((f) => (
                <div key={f.path} tabIndex={0} className={`folder-item ${selected.has(f.path) ? 'selected' : ''}`} onClick={(e) => click(e, f)} onDoubleClick={() => open(f)} onKeyDown={(e) => e.key === 'Enter' && open(f)} onContextMenu={(e) => itemMenu(e, f)} title={f.path}>
                  <span style={{ color: 'var(--accent)', display: 'inline-flex', flex: 'none' }}><Icon name={/usb|external|seagate|wd |sandisk/i.test(f.name) ? 'usb' : 'folder'} size={20} /></span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 550 }}>{f.name}</div>
                    <div className="small muted ellipsis">{f.offline ? 'Kept offline · ' : ''}{f.mtime ? relativeTime(f.mtime) : 'Folder'}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {sorted.files.length ? (
            <div className="remote-grid">
              {sorted.files.map((f) => (
                <div key={f.path} tabIndex={0} className={`remote-card ${selected.has(f.path) ? 'selected' : ''}`} onClick={(e) => click(e, f)} onDoubleClick={() => open(f)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(f); } }} onContextMenu={(e) => itemMenu(e, f)} title={`${f.name}\n${formatBytes(f.size)}${f.mtime ? ` · ${relativeTime(f.mtime)}` : ''}`}
                  draggable onDragStart={(e) => { e.preventDefault(); void api.remote.startDrag(id, f); }}>
                  <RemoteThumb id={id} entry={f} />
                  <div className="remote-name ellipsis">{f.name}</div>
                  <div className="small muted ellipsis">{formatBytes(f.size)}{f.mtime ? ` · ${relativeTime(f.mtime)}` : ''}{f.offline ? ' · offline' : ''}</div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      {editing && conn ? <ConnectionDialog edit={conn} onClose={() => setEditing(false)} onSaved={refresh} /> : null}
      {naming ? (
        <Modal title={naming.kind === 'folder' ? 'New folder' : `Rename “${naming.entry?.name}”`} onClose={() => setNaming(null)} width={400}>
          <input className="input" autoFocus value={naming.value} onFocus={(e) => e.target.select()} onChange={(e) => setNaming({ ...naming, value: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') (document.getElementById('rm-ok') as HTMLButtonElement | null)?.click(); }} />
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn" onClick={() => setNaming(null)}>Cancel</button>
            <button id="rm-ok" className="btn primary" disabled={!naming.value.trim() || /[\\/]/.test(naming.value)} onClick={async () => {
              const n = naming;
              setNaming(null);
              try {
                if (n.kind === 'folder') await api.remote.mkdir(id, dir, n.value.trim());
                else if (n.entry) await api.remote.rename(id, n.entry.path, n.value.trim());
              } catch (e) {
                toast(errText(e));
              }
              refresh();
            }}>{naming.kind === 'folder' ? 'Create' : 'Rename'}</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
