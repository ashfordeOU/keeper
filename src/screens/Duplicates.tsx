// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Duplicates: identical copies, look-alike photos and the same photo saved in two formats.

import { useEffect, useMemo, useState } from 'react';
import { formatBytes } from '../../core/format';
import type { DuplicateGroup, Progress } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Check, Empty, PageHead, Thumb, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/screens-b.css';

type Filter = 'all' | 'exact' | 'similar' | 'pair';

const KIND_LABEL: Record<DuplicateGroup['kind'], string> = {
  exact: 'Identical copies',
  similar: 'Look-alike photos',
  pair: 'Same photo, two formats',
};

export function Duplicates() {
  const { trash, info } = useStore();
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [similar, setSimilar] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => api.on('progress', (p: Progress) => { if (p.task === 'dupes' || p.task === 'duplicates') setProgress(p); }), []);

  const scan = async () => {
    setScanning(true);
    setProgress(null);
    try {
      const g = await api.duplicates.scan({ similar });
      setGroups(g);
      setKeep(Object.fromEntries(g.map((x) => [x.id, x.keep])));
      setSelected(new Set(g.flatMap((x) => x.files.filter((f) => f.path !== x.keep).map((f) => f.path))));
    } finally {
      setScanning(false);
    }
  };

  const shown = useMemo(() => (groups ?? []).filter((g) => filter === 'all' || g.kind === filter), [groups, filter]);
  const reclaimable = (groups ?? []).reduce((n, g) => n + g.reclaimable, 0);
  const selectedSize = (groups ?? []).flatMap((g) => g.files).filter((f, i, a) => selected.has(f.path) && a.findIndex((x) => x.path === f.path) === i).reduce((n, f) => n + f.size, 0);

  const makeKeeper = (g: DuplicateGroup, path: string) => {
    setKeep((k) => ({ ...k, [g.id]: path }));
    setSelected((s) => {
      const n = new Set(s);
      for (const f of g.files) {
        if (f.path === path) n.delete(f.path);
        else n.add(f.path);
      }
      return n;
    });
  };

  const toggle = (p: string, on: boolean) => setSelected((s) => {
    const n = new Set(s);
    if (on) n.add(p);
    else n.delete(p);
    return n;
  });

  const removeDone = (paths: string[]) => {
    const gone = new Set(paths);
    setGroups((gs) => (gs ?? []).map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f.path)) })).filter((g) => g.files.length > 1));
    setSelected((s) => new Set([...s].filter((p) => !gone.has(p))));
  };

  const trashSelected = async (paths: string[]) => {
    // Never trash every copy of a group.
    const safe = paths.filter((p) => !Object.values(keep).includes(p));
    if (!safe.length) return;
    await trash(safe, `Moved ${safe.length} duplicate${safe.length === 1 ? '' : 's'} to the Trash`);
    removeDone(safe);
  };

  const allExtras = shown.flatMap((g) => g.files.filter((f) => f.path !== keep[g.id]).map((f) => f.path));
  const short = (p: string) => (info?.home && p.startsWith(info.home) ? '~' + p.slice(info.home.length) : p);

  return (
    <div>
      <PageHead title="Duplicates" sub="Copies with the same bytes, look-alike photos such as bursts and edits, and photos saved twice in different formats.">
        <span className="row small">Include look-alike photos <Toggle on={similar} onChange={setSimilar} label="Include look-alike photos" /></span>
        <button className="btn primary" onClick={scan} disabled={scanning}>
          {scanning ? <div className="spinner" /> : <Icon name="search" size={14} />} {groups ? 'Scan again' : 'Find duplicates'}
        </button>
      </PageHead>

      {scanning ? (
        <div className="card pad">
          <div className="row"><div className="spinner" /><span>{progress?.phase ?? 'Comparing files…'}</span><span className="muted small grow ellipsis">{progress?.current ?? ''}</span></div>
          <div className={`progress ${progress?.total ? '' : 'indeterminate'}`} style={{ marginTop: 10 }}><i style={{ width: progress?.total ? `${(progress.done / progress.total) * 100}%` : undefined }} /></div>
        </div>
      ) : null}

      {!groups && !scanning ? (
        <Empty icon="dupes" title="Find files you have more than once">
          Keeper compares file contents, not names. Files that only live in the cloud are skipped, so nothing downloads. Extras go to the Trash, never straight to deletion.
        </Empty>
      ) : null}

      {groups && !scanning ? (
        groups.length === 0 ? (
          <Empty icon="check" title="No duplicates found">Every file in your library is one of a kind.</Empty>
        ) : (
          <>
            <div className="card pad row" style={{ flexWrap: 'wrap', gap: 24, marginBottom: 14 }}>
              <div className="stat"><span className="v">{groups.length}</span><span className="l">groups</span></div>
              <div className="stat"><span className="v">{formatBytes(reclaimable)}</span><span className="l">can be freed</span></div>
              <div className="stat"><span className="v">{formatBytes(selectedSize)}</span><span className="l">selected</span></div>
              <div className="grow" />
              <div className="btn-row">
                <button className="btn" disabled={!allExtras.length} onClick={() => void trashSelected(allExtras)}>Trash all extras</button>
                <button className="btn danger" disabled={!selected.size} onClick={() => void trashSelected([...selected])}><Icon name="trash" size={14} /> Trash selected</button>
              </div>
            </div>

            <div className="seg" style={{ marginBottom: 14 }}>
              {(['all', 'exact', 'similar', 'pair'] as Filter[]).map((f) => (
                <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : f === 'exact' ? 'Identical' : f === 'similar' ? 'Look-alikes' : 'Two formats'}
                  <span className="muted small">{f === 'all' ? groups.length : groups.filter((g) => g.kind === f).length}</span>
                </button>
              ))}
            </div>

            <div className="col" style={{ gap: 12 }}>
              {shown.map((g) => (
                <div key={g.id} className="card group-card">
                  <div className="head">
                    <div className="icon-wrap"><Icon name={g.kind === 'exact' ? 'dupes' : g.kind === 'pair' ? 'image' : 'sparkle'} size={17} /></div>
                    <div className="grow">
                      <h3>{KIND_LABEL[g.kind]} · {g.files.length} files</h3>
                      <div className="small muted" title={g.reason}>{formatBytes(g.reclaimable)} can be freed · {keep[g.id] === g.keep ? g.reason : 'You picked which copy to keep'}</div>
                    </div>
                  </div>
                  <div className="dupe-files">
                    {g.files.map((f) => {
                      const isKeep = keep[g.id] === f.path;
                      return (
                        <div key={f.path} className={`dupe-file ${isKeep ? 'keep' : ''}`} onClick={() => makeKeeper(g, f.path)} onDoubleClick={() => void api.files.open(f.path)} title={`${f.path}\nClick to keep this copy`}>
                          <div className="thumb"><Thumb file={f} /></div>
                          {isKeep ? <span className="badge ok tag">Keep</span> : null}
                          {!isKeep ? <span className="sel"><Check on={selected.has(f.path)} onChange={(v) => toggle(f.path, v)} /></span> : null}
                          <div className="nm">{f.name}</div>
                          <div className="path"><bdi>{short(f.path)}</bdi></div>
                          <div className="small muted">{formatBytes(f.size)}{f.meta?.width ? ` · ${f.meta.width}×${f.meta.height}` : ''}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )
      ) : null}
    </div>
  );
}
