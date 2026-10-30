// SPDX-License-Identifier: AGPL-3.0-or-later
// Clean Up: one scan finds rebuildable clutter (deleted for good) and your own
// forgotten files (always sent to the Trash, reviewable one by one).

import { useEffect, useMemo, useState } from 'react';
import { formatBytes, relativeTime } from '../../core/format';
import type { CleanResult, CleanupEntry, CleanupGroup, Progress } from '../../core/types';
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
  const [advanced, setAdvancedState] = useState<boolean>(() => { try { return localStorage.getItem('cleanup.advanced') === '1'; } catch { return false; } });
  // Advanced mode: exactly which files and folders go, per group (path → size).
  const [custom, setCustom] = useState<Record<string, Map<string, number>>>({});
  const setAdvanced = (v: boolean) => { setAdvancedState(v); try { localStorage.setItem('cleanup.advanced', v ? '1' : '0'); } catch { /* storage unavailable */ } };

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
      setCustom({});
    } finally {
      setScanning(false);
    }
  };

  const sizeOf = (g: CleanupGroup) => {
    const c = custom[g.id];
    if (c) return [...c.values()].reduce((n, s) => n + s, 0);
    return g.items ? g.items.filter((f) => files[g.id]?.has(f.path)).reduce((n, f) => n + f.size, 0) : g.size;
  };
  const chosen = (groups ?? []).filter((g) => (custom[g.id] ? custom[g.id].size > 0 : picked[g.id] && (!g.items || (files[g.id]?.size ?? 0) > 0)));
  const total = (groups ?? []).reduce((n, g) => n + g.size, 0);
  const selectedSize = chosen.reduce((n, g) => n + sizeOf(g), 0);
  const permanent = chosen.filter((g) => g.mode !== 'files');
  const toTrash = chosen.filter((g) => g.mode === 'files');

  const clean = async () => {
    setConfirm(false);
    setCleaning(true);
    try {
      const r = await api.cleanup.clean(chosen.map((g) => ({ id: g.id, paths: custom[g.id] ? [...custom[g.id].keys()] : g.items ? [...(files[g.id] ?? [])] : undefined })));
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
      <PageHead title="Clean Up" sub="One scan finds caches, logs, old installers, forgotten downloads and more. Nothing is removed until you choose.">
        <div className="seg" title="Advanced lets you open every group and pick exactly which files and folders go">
          <button className={!advanced ? 'on' : ''} onClick={() => setAdvanced(false)}>Simple</button>
          <button className={advanced ? 'on' : ''} onClick={() => setAdvanced(true)}><Icon name="list" size={13} /> Advanced</button>
        </div>
      </PageHead>

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
              <Check on={custom[g.id] ? custom[g.id].size > 0 : !!picked[g.id]} onChange={(v) => { setCustom((c) => { const n = { ...c }; delete n[g.id]; return n; }); setPicked((p) => ({ ...p, [g.id]: v })); }} />
              <div className="icon-wrap"><Icon name={ICONS[g.icon] ?? g.icon} size={17} /></div>
              <div className="grow">
                <div className="row"><h3>{g.name}</h3><SafetyBadge safety={g.safety} />{g.mode === 'files' ? <span className="badge">Goes to Trash</span> : g.mode === 'bin' ? <span className="badge danger">Empties the bin</span> : <span className="badge">Deleted, rebuilds</span>}</div>
                <div className="small muted">{g.description}</div>
                {g.locations.length ? <div className="small muted ellipsis" title={g.locations.join('\n')}>{g.locations.slice(0, 3).map(short).join(' · ')}{g.locations.length > 3 ? ` +${g.locations.length - 3}` : ''}</div> : null}
                {g.note ? <div className="small" style={{ color: 'var(--warn)' }}>{g.note}</div> : null}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, fontSize: 16 }} className="num">{formatBytes(sizeOf(g))}</div>
                <div className="small muted">{custom[g.id] ? `${custom[g.id].size} picked` : g.items ? `${files[g.id]?.size ?? 0} of ${g.count}` : g.count.toLocaleString()} items</div>
              </div>
              {advanced && !(g.mode === 'bin' && info?.platform === 'win32') ? (
                <button className="btn sm" onClick={() => setOpen(open === g.id ? null : g.id)}>{custom[g.id] ? 'Edit picks' : 'Choose files'} <Icon name={open === g.id ? 'chevronDown' : 'chevronRight'} size={12} /></button>
              ) : g.items?.length ? (
                <button className="btn ghost sm" onClick={() => setOpen(open === g.id ? null : g.id)}>Review <Icon name={open === g.id ? 'chevronDown' : 'chevronRight'} size={12} /></button>
              ) : null}
            </div>
            {advanced && open === g.id ? (
              <EntryPicker
                group={g}
                picked={custom[g.id]}
                short={short}
                onChange={(m) => setCustom((c) => ({ ...c, [g.id]: m }))}
                onReset={() => setCustom((c) => { const n = { ...c }; delete n[g.id]; return n; })}
              />
            ) : null}
            {!advanced && open === g.id && g.items ? (
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
            <p><b>Moved to the Trash</b> (you can put them back): {toTrash.map((g) => `${g.name} (${custom[g.id]?.size ?? files[g.id]?.size ?? 0})`).join(', ')}.</p>
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

// ---------------------------------------------------------------- advanced picker

const AGE = [0, 7, 30, 90, 365];
const SIZE = [0, 1, 10, 100, 1024];

/**
 * Lists what is inside a group — drilling into folders for caches — with
 * filters and sorting, so people who know what they are looking at can tick
 * exactly what goes. The main process re-checks every path before removing it.
 */
function EntryPicker({ group, picked, onChange, onReset, short }: {
  group: CleanupGroup;
  picked?: Map<string, number>;
  onChange: (m: Map<string, number>) => void;
  onReset: () => void;
  short: (p: string) => string;
}) {
  const [trail, setTrail] = useState<{ name: string; dir?: string }[]>([{ name: group.name }]);
  const [entries, setEntries] = useState<CleanupEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [age, setAge] = useState(0);
  const [minMb, setMinMb] = useState(0);
  const [sort, setSort] = useState<'size' | 'date' | 'name'>('size');
  const dir = trail[trail.length - 1].dir;
  const sel = picked ?? new Map<string, number>();

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);
    api.cleanup.details(group.id, dir).then((e) => alive && setEntries(e), (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [group.id, dir]);

  const shown = useMemo(() => {
    const now = Date.now();
    const q = text.trim().toLowerCase();
    const list = (entries ?? []).filter((e) => (!q || e.name.toLowerCase().includes(q)) && (!age || now - e.mtime > age * 86_400_000) && (!minMb || e.size >= minMb * 1024 * 1024));
    return list.sort((a, b) => (sort === 'size' ? b.size - a.size : sort === 'date' ? a.mtime - b.mtime : a.name.localeCompare(b.name, undefined, { numeric: true })));
  }, [entries, text, age, minMb, sort]);

  const set = (list: CleanupEntry[], on: boolean) => {
    const m = new Map(sel);
    for (const e of list) {
      if (on) m.set(e.path, e.size);
      else m.delete(e.path);
    }
    onChange(m);
  };
  const shownSize = shown.reduce((n, e) => n + e.size, 0);
  const pickedSize = [...sel.values()].reduce((n, s) => n + s, 0);
  const isPicked = (e: CleanupEntry) => sel.has(e.path) || [...sel.keys()].some((p) => e.path.startsWith(p + '/') || e.path.startsWith(p + '\\'));

  return (
    <div className="items picker">
      <div className="row small" style={{ padding: '2px 6px 8px', gap: 6, flexWrap: 'wrap' }}>
        {trail.map((t, i) => (
          <span key={i} className="row" style={{ gap: 4 }}>
            {i ? <Icon name="chevronRight" size={11} /> : null}
            <button className="btn ghost sm" disabled={i === trail.length - 1} onClick={() => setTrail(trail.slice(0, i + 1))}>{t.name}</button>
          </span>
        ))}
        <span className="grow" />
        <span className="muted">{pickedSize ? `${sel.size} picked · ${formatBytes(pickedSize)}` : 'Nothing picked yet'}</span>
        {picked ? <button className="btn ghost sm" onClick={onReset}>Back to automatic</button> : null}
      </div>
      <div className="row" style={{ padding: '0 6px 8px', gap: 6, flexWrap: 'wrap' }}>
        <input className="input" style={{ height: 28, width: 180 }} placeholder="Filter by name" value={text} onChange={(e) => setText(e.target.value)} />
        <select className="input" style={{ height: 28 }} value={age} onChange={(e) => setAge(+e.target.value)}>
          {AGE.map((d) => <option key={d} value={d}>{d ? `Untouched ${d}+ days` : 'Any age'}</option>)}
        </select>
        <select className="input" style={{ height: 28 }} value={minMb} onChange={(e) => setMinMb(+e.target.value)}>
          {SIZE.map((m) => <option key={m} value={m}>{m ? `Over ${m >= 1024 ? '1 GB' : `${m} MB`}` : 'Any size'}</option>)}
        </select>
        <select className="input" style={{ height: 28 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="size">Biggest first</option>
          <option value="date">Oldest first</option>
          <option value="name">Name A–Z</option>
        </select>
        <span className="grow" />
        <button className="btn ghost sm" onClick={() => set(shown, true)}>Pick shown ({formatBytes(shownSize)})</button>
        <button className="btn ghost sm" onClick={() => set(shown, false)}>Unpick shown</button>
        <button className="btn ghost sm" onClick={() => { const m = new Map(sel); for (const e of shown) { if (m.has(e.path)) m.delete(e.path); else m.set(e.path, e.size); } onChange(m); }}>Invert</button>
      </div>
      {error ? <div className="small" style={{ color: 'var(--danger)', padding: 8 }}>{error}</div> : null}
      {!entries && !error ? <div className="row small muted" style={{ padding: 10 }}><div className="spinner" /> Measuring…</div> : null}
      {entries && !shown.length ? <div className="small muted" style={{ padding: 10 }}>Nothing matches these filters.</div> : null}
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {shown.map((e) => {
          const inherited = !sel.has(e.path) && isPicked(e);
          return (
            <div key={e.path} className="item-row" onDoubleClick={() => (e.isDir && !group.items ? setTrail([...trail, { name: e.name, dir: e.path }]) : void api.files.reveal(e.path))}>
              <Check on={isPicked(e)} onChange={(v) => !inherited && set([e], v)} />
              <div className="mini" style={{ display: 'grid', placeItems: 'center' }}>
                {e.isDir ? <Icon name="folder" size={18} /> : <Thumb file={{ path: e.path, kind: group.items?.find((f) => f.path === e.path)?.kind ?? 'other', ext: e.name.split('.').pop()?.toLowerCase() ?? '' }} size={64} />}
              </div>
              <div className="grow ellipsis" title={e.path}>
                {e.isDir && !group.items ? <button className="link-btn" onClick={() => setTrail([...trail, { name: e.name, dir: e.path }])}>{e.name}</button> : e.name}
                <div className="small muted ellipsis">{short(e.path)}</div>
              </div>
              <span className="small muted" style={{ width: 90, textAlign: 'right' }}>{relativeTime(e.mtime)}</span>
              <span className="small muted num" style={{ width: 80, textAlign: 'right' }}>{e.isDir ? `${e.files.toLocaleString()} file${e.files === 1 ? '' : 's'}` : ''}</span>
              <span className="num" style={{ width: 80, textAlign: 'right', fontWeight: 600 }}>{formatBytes(e.size)}</span>
              <button className="btn ghost sm icon" title="Show in folder" onClick={() => void api.files.reveal(e.path)}><Icon name="reveal" size={13} /></button>
            </div>
          );
        })}
      </div>
      <div className="small muted" style={{ padding: '8px 6px 2px' }}>
        {group.mode === 'files' ? 'Picked files go to the Trash.' : 'Picked items are deleted for good — they rebuild on their own.'} Keeper re-checks every item before removing it and refuses anything outside this group.
      </div>
    </div>
  );
}
