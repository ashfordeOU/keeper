// SPDX-License-Identifier: AGPL-3.0-or-later
// Home: how full the disk is, what is on each shelf, and what arrived lately.

import { KIND_LABEL } from '../../core/classify';
import { formatBytes, relativeTime } from '../../core/format';
import type { FileEntry, FileKind } from '../../core/types';
import { describeCode } from '../../core/weather';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { KIND_COLOR, SizeBar, Thumb } from '../components/ui';
import { useAsync, useStore } from '../state';
import '../styles/screens-a.css';

const SHELVES: FileKind[] = ['image', 'video', 'audio', 'document', 'archive', 'installer', 'app'];

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function ShelfRow({ title, files, onMore }: { title: string; files: FileEntry[] | undefined; onMore: () => void }) {
  const { setSelection, setFocused, play } = useStore();
  if (!files?.length) return null;
  return (
    <div className="section">
      <div className="section-head">
        <h2>{title}</h2>
        <button className="btn ghost sm" onClick={onMore}>See all <Icon name="chevronRight" size={12} /></button>
      </div>
      <div className="shelf">
        {files.map((f) => (
          <div
            key={f.path}
            className="shelf-card"
            title={f.path}
            onClick={() => { setSelection([f.path]); setFocused(f); }}
            onDoubleClick={() => (f.kind === 'audio' ? play(f) : void api.files.open(f.path))}
            draggable
            onDragStart={(e) => { e.preventDefault(); api.files.startDrag([f.path]); }}
          >
            <div className="thumb"><Thumb file={f} /></div>
            <div className="name">{f.name}</div>
            <div className="meta">{f.source ? `${f.source.name} · ` : ''}{relativeTime(f.mtime)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Home() {
  const { go, version } = useStore();
  const disks = useAsync(() => api.system.disks(), []);
  const totals = useAsync(() => api.library.totals(), [version]);
  const status = useAsync(() => api.library.status(), [version]);
  const photos = useAsync(() => api.library.recent(12, 'image'), [version]);
  const videos = useAsync(() => api.library.recent(12, 'video'), [version]);
  const music = useAsync(() => api.library.recent(12, 'audio'), [version]);
  const docs = useAsync(() => api.library.recent(12, 'document'), [version]);
  const downloads = useAsync(() => api.library.recent(12, 'download'), [version]);
  const weather = useAsync(() => api.weather.get().catch(() => null), []);

  const disk = disks.data?.find((d) => d.system) ?? disks.data?.[0];
  const libTotal = totals.data ? Object.values(totals.data).reduce((n, v) => n + v.size, 0) : 0;
  const w = weather.data;

  return (
    <div>
      <div className="home-hero">
        <div>
          <h1>{greeting()}</h1>
          <div className="sub">
            {status.data
              ? status.data.indexing
                ? 'Reading your folders…'
                : `${status.data.files.toLocaleString()} files in your library · updated ${relativeTime(status.data.lastScan)}`
              : ' '}
          </div>
        </div>
        <div className="btn-row">
          {status.data?.indexing ? <div className="spinner" /> : null}
          <button className="btn" onClick={() => void api.library.rescan()}><Icon name="refresh" size={14} /> Rescan</button>
        </div>
      </div>

      <div className="grid cols-2">
        {disk ? (
          <div className="card pad">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <h3>{disk.label}</h3>
              <span className="small muted">{formatBytes(disk.free)} free of {formatBytes(disk.total)}</span>
            </div>
            <SizeBar
              total={disk.total}
              parts={[
                ...(totals.data ? SHELVES.map((k) => ({ size: totals.data![k].size, color: KIND_COLOR[k], label: KIND_LABEL[k] })) : []),
                { size: Math.max(0, disk.total - disk.free - libTotal), color: 'var(--text-3)', label: 'Everything else' },
              ]}
            />
            <div className="row small muted" style={{ marginTop: 10, flexWrap: 'wrap', gap: 12 }}>
              {totals.data ? SHELVES.filter((k) => totals.data![k].size).map((k) => (
                <span key={k} className="row" style={{ gap: 5 }}><span className="dot" style={{ width: 8, height: 8, borderRadius: 8, background: KIND_COLOR[k] }} />{KIND_LABEL[k]} {formatBytes(totals.data![k].size)}</span>
              )) : null}
            </div>
          </div>
        ) : null}

        <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row"><Icon name="broom" size={18} /><h3 className="grow">Free up space</h3></div>
          <div className="sub small">Caches, old installers, forgotten downloads and duplicates — reviewed before anything goes to the Trash.</div>
          <div className="btn-row">
            <button className="btn primary" onClick={() => go({ name: 'cleanup' })}>Scan now</button>
            <button className="btn" onClick={() => go({ name: 'duplicates' })}>Find duplicates</button>
          </div>
        </div>

        {w ? (
          <div className="card pad weather-mini" onClick={() => go({ name: 'island' })}>
            <div className="t">{Math.round(w.current.temp)}°</div>
            <div className="grow">
              <h3>{w.place.name}</h3>
              <div className="small sub">{describeCode(w.current.code).label} · feels {Math.round(w.current.feels)}° · {w.daily[0] ? `${Math.round(w.daily[0].min)}° / ${Math.round(w.daily[0].max)}°` : ''}</div>
              {w.nowcast ? <div className="small" style={{ color: 'var(--accent)' }}>{w.nowcast}</div> : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="section">
        <div className="section-head"><h2>Library</h2></div>
        <div className="kind-tiles">
          {SHELVES.map((k) => (
            <button key={k} className="kind-tile" onClick={() => go({ name: 'library', arg: k })}>
              <span className="ico" style={{ background: KIND_COLOR[k] }}><Icon name={k} size={16} /></span>
              <span className="small sub">{KIND_LABEL[k]}</span>
              <span className="v">{totals.data ? totals.data[k].count.toLocaleString() : '—'}</span>
              <span className="small muted">{totals.data ? formatBytes(totals.data[k].size) : ''}</span>
            </button>
          ))}
        </div>
      </div>

      <ShelfRow title="Recent downloads" files={downloads.data} onMore={() => go({ name: 'downloads' })} />
      <ShelfRow title="Recent photos" files={photos.data} onMore={() => go({ name: 'library', arg: 'image' })} />
      <ShelfRow title="Recent videos" files={videos.data} onMore={() => go({ name: 'library', arg: 'video' })} />
      <ShelfRow title="Recent music" files={music.data} onMore={() => go({ name: 'library', arg: 'audio' })} />
      <ShelfRow title="Recent documents" files={docs.data} onMore={() => go({ name: 'library', arg: 'document' })} />
    </div>
  );
}
