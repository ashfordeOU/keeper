// SPDX-License-Identifier: AGPL-3.0-or-later
// Clean Up: one scan finds rebuildable clutter (deleted for good) and your own
// forgotten files (always sent to the Trash, reviewable one by one).

import { useEffect, useState } from 'react';
import { formatBytes } from '../../core/format';
import type { CleanResult, CleanupGroup, Progress } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Check, Empty, Modal, PageHead, SafetyBadge, Thumb } from '../components/ui';
import { useStore } from '../state';
import '../styles/screens-b.css';

const ICONS: Record<string, string> = {
  globe: 'globe', layers: 'app', apps: 'app', doc: 'document', code: 'code', trash: 'trash', box: 'installer', archive: 'archive',
  down: 'down', screenshot: 'screenshot', video: 'video', app: 'app', file: 'other', warning: 'warning', gear: 'settings', history: 'history', chip: 'code', photo: 'image',
};

export function Cleanup() {
  const { go, refresh, info } = useStore();
  const [groups, setGroups] = useState<CleanupGroup[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [files, setFiles] = useState<Record<string, Set<string>>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [result, setResult] = useState<CleanResult | null>(null);

  useEffect(() => api.on('progress', (p: Progress) => { if (p.task === 'junk' || p.task === 'cleanup') setProgress(p); }), []);

  const scan = async () => {
    setScanning(true);
    setResult(null);
    setProgress(null);
    try {
      const g = await api.cleanup.scan();
      setGroups(g);
      setPicked(Object.fromEntries(g.map((x) => [x.id, x.preselect])));
      setFiles(Object.fromEntries(g.filter((x) => x.items).map((x) => [x.id, new Set(x.items!.map((f) => f.path))])));
    } finally {
      setScanning(false);
    }
  };

  const sizeOf = (g: CleanupGroup) => (g.items ? g.items.filter((f) => files[g.id]?.has(f.path)).reduce((n, f) => n + f.size, 0) : g.size);
  const chosen = (groups ?? []).filter((g) => picked[g.id] && (!g.items || (files[g.id]?.size ?? 0) > 0));
  const total = (groups ?? []).reduce((n, g) => n + g.size, 0);
  const selectedSize = chosen.reduce((n, g) => n + sizeOf(g), 0);
  const permanent = chosen.filter((g) => g.mode !== 'files');
  const toTrash = chosen.filter((g) => g.mode === 'files');

  const clean = async () => {
    setConfirm(false);
    setCleaning(true);
    try {
      const r = await api.cleanup.clean(chosen.map((g) => ({ id: g.id, paths: g.items ? [...(files[g.id] ?? [])] : undefined })));
      setResult(r);
      setGroups(null);
      refresh();
    } finally {
      setCleaning(false);
    }
  };

  const short = (p: string) => (info?.home && p.startsWith(info.home) ? '~' + p.slice(info.home.length) : p);

  if (result) {
    return (
      <div>
        <div className="hero">
          <div className="icon-wrap" style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--ok-soft)', color: 'var(--ok)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={28} stroke={2.4} /></div>
          <div className="grow">
            <div className="big">{formatBytes(result.freed)}</div>
            <div className="sub">freed · {result.removed} item{result.removed === 1 ? '' : 's'} cleaned{result.failed ? ` · ${result.failed} could not be removed` : ''}</div>
            {result.skipped.length ? <div className="small muted" style={{ marginTop: 6 }}>{result.skipped.join(' · ')}</div> : null}
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => go({ name: 'history' })}><Icon name="history" size={14} /> Undo in History</button>
            <button className="btn primary" onClick={() => { setResult(null); void scan(); }}>Scan again</button>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>Your own files went to the Trash and can be put back. Caches and temporary files rebuild themselves as you use your apps.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHead title="Clean Up" sub="One scan finds caches, logs, old installers, forgotten downloads and more. Nothing is removed until you choose." />

      <div className="hero" style={{ marginBottom: 18 }}>
        <div className="grow">
          <div className="small muted">{groups ? 'You can free up' : scanning ? 'Scanning…' : 'Smart Scan'}</div>
          <div className="big">{groups ? formatBytes(total) : scanning ? <span className="muted">…</span> : <span style={{ fontSize: 30 }}>See what can go</span>}</div>
          {scanning ? (
            <>
              <div className={`progress ${progress?.total ? '' : 'indeterminate'}`}><i style={{ width: progress?.total ? `${(progress.done / progress.total) * 100}%` : undefined }} /></div>
              <div className="small muted ellipsis" style={{ marginTop: 6 }}>{progress?.phase ?? 'Measuring caches and checking your folders'}</div>
            </>
          ) : groups ? <div className="small muted">{formatBytes(selectedSize)} selected in {chosen.length} group{chosen.length === 1 ? '' : 's'}</div> : null}
        </div>
        <div className="btn-row">
          {groups ? (
            <button className="btn primary" disabled={!chosen.length || cleaning} onClick={() => setConfirm(true)} style={{ height: 40, padding: '0 20px' }}>
              {cleaning ? <div className="spinner" /> : <Icon name="broom" size={15} />} Clean {formatBytes(selectedSize)}
            </button>
          ) : null}
          <button className={`btn ${groups ? '' : 'primary'}`} disabled={scanning} onClick={scan} style={{ height: 40, padding: '0 20px' }}>
            {scanning ? <div className="spinner" /> : <Icon name="search" size={15} />} {groups ? 'Rescan' : 'Scan'}
          </button>
        </div>
      </div>

      {!groups && !scanning ? (
        <Empty icon="broom" title="Two simple rules">
          Caches, temporary files and logs are deleted for good — apps rebuild them, and moving them to the Trash would free nothing. Anything you made or downloaded always goes to the Trash first.
        </Empty>
      ) : null}

      {groups && groups.length === 0 ? <Empty icon="check" title="Nothing to clean">Your computer is already tidy.</Empty> : null}

      <div className="col" style={{ gap: 10 }}>
        {(groups ?? []).map((g) => (
          <div key={g.id} className="card group-card">
            <div className="head">
              <Check on={!!picked[g.id]} onChange={(v) => setPicked((p) => ({ ...p, [g.id]: v }))} />
              <div className="icon-wrap"><Icon name={ICONS[g.icon] ?? g.icon} size={17} /></div>
              <div className="grow">
                <div className="row"><h3>{g.name}</h3><SafetyBadge safety={g.safety} />{g.mode === 'files' ? <span className="badge">Goes to Trash</span> : g.mode === 'bin' ? <span className="badge danger">Empties the bin</span> : <span className="badge">Deleted, rebuilds</span>}</div>
                <div className="small muted">{g.description}</div>
                {g.locations.length ? <div className="small muted ellipsis" title={g.locations.join('\n')}>{g.locations.slice(0, 3).map(short).join(' · ')}{g.locations.length > 3 ? ` +${g.locations.length - 3}` : ''}</div> : null}
                {g.note ? <div className="small" style={{ color: 'var(--warn)' }}>{g.note}</div> : null}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, fontSize: 16 }} className="num">{formatBytes(sizeOf(g))}</div>
                <div className="small muted">{g.items ? `${files[g.id]?.size ?? 0} of ${g.count}` : g.count.toLocaleString()} items</div>
              </div>
              {g.items?.length ? (
                <button className="btn ghost sm" onClick={() => setOpen(open === g.id ? null : g.id)}>Review <Icon name={open === g.id ? 'chevronDown' : 'chevronRight'} size={12} /></button>
              ) : null}
            </div>
            {open === g.id && g.items ? (
              <div className="items">
                <div className="row small" style={{ padding: '0 6px 6px' }}>
                  <button className="btn ghost sm" onClick={() => setFiles((f) => ({ ...f, [g.id]: new Set(g.items!.map((x) => x.path)) }))}>Select all</button>
                  <button className="btn ghost sm" onClick={() => setFiles((f) => ({ ...f, [g.id]: new Set() }))}>Select none</button>
                </div>
                {g.items.map((f) => (
                  <div key={f.path} className="item-row" onDoubleClick={() => void api.files.reveal(f.path)}>
                    <Check on={!!files[g.id]?.has(f.path)} onChange={(v) => setFiles((all) => { const s = new Set(all[g.id]); if (v) s.add(f.path); else s.delete(f.path); return { ...all, [g.id]: s }; })} />
                    <div className="mini"><Thumb file={f} size={64} /></div>
                    <div className="grow ellipsis" title={f.path}>{f.name}<div className="small muted ellipsis">{short(f.path)}</div></div>
                    <span className="muted num">{formatBytes(f.size)}</span>
                    <button className="btn ghost sm icon" title="Show in folder" onClick={() => void api.files.reveal(f.path)}><Icon name="reveal" size={13} /></button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {confirm ? (
        <Modal title={`Clean ${formatBytes(selectedSize)}?`} onClose={() => setConfirm(false)}>
          {permanent.length ? (
            <p><b>Deleted for good</b> (they rebuild on their own): {permanent.map((g) => g.name).join(', ')}.</p>
          ) : null}
          {toTrash.length ? (
            <p><b>Moved to the Trash</b> (you can put them back): {toTrash.map((g) => `${g.name} (${files[g.id]?.size ?? 0})`).join(', ')}.</p>
          ) : null}
          <p className="small muted">Files in use and anything touched in the last day are skipped. Every action is recorded in History.</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn primary" onClick={() => void clean()}>Clean now</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
