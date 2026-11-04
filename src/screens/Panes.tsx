// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Side by Side: two folders next to each other, each on this computer or on a
// cloud or server connection. Copy or move what is chosen on one side to the
// other (F5 / F6), or switch to Differences to see only what differs and sync
// after a preview. Both sides live in the route (core/panes.ts), so a tab
// keeps them, and they come back after a restart.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes, relativeTime } from '../../core/format';
import { decodePane, diffLabel, encodePane, paneChild, paneParent, panesRoute, paneTitle, planSummary, samePane, syncPlan, type DiffRow, type PaneSpec, type SyncDirection } from '../../core/panes';
import type { Connection } from '../../core/remote/types';
import { api } from '../api';
import { errText } from '../components/ConnectionDialog';
import { Icon } from '../components/Icon';
import { Check, Empty, Loading, Modal, PageHead } from '../components/ui';
import { transfer } from '../fileops';
import { openQuickLook } from '../preview/QuickLook';
import { isMac, useStore } from '../state';
import '../styles/panes.css';

type Side = 'left' | 'right';

interface Row {
  name: string;
  /** a local path, or the path inside the connection */
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

const other = (s: Side): Side => (s === 'left' ? 'right' : 'left');
const byName = (a: Row, b: Row) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** The places offered in a side's picker: home folders, pinned folders, then connections. */
function usePlaces(conns: Connection[]) {
  const { info, settings } = useStore();
  return useMemo(() => {
    const home = info?.home ?? '/';
    const sep = info?.sep ?? '/';
    const local: { label: string; spec: PaneSpec }[] = [{ label: 'Home', spec: { kind: 'local', path: home } }];
    for (const n of ['Desktop', 'Documents', 'Downloads', 'Pictures']) local.push({ label: n, spec: { kind: 'local', path: home + sep + n } });
    for (const p of settings?.pinned ?? []) local.push({ label: p.split(/[\\/]/).filter(Boolean).pop() ?? p, spec: { kind: 'local', path: p } });
    const remote = conns.filter((c) => c.kind !== 'smb').map((c) => ({ label: c.name, spec: { kind: 'remote', id: c.id, path: '/' } as PaneSpec }));
    return { local, remote };
  }, [info?.home, info?.sep, settings?.pinned, conns]);
}

/** Breadcrumbs for a side: a local path from Home (or the disk), a connection from its name. */
function crumbsFor(p: PaneSpec, home: string | undefined, sep: string, connName: string): { label: string; spec: PaneSpec }[] {
  if (p.kind === 'remote') {
    const parts = p.path.split('/').filter(Boolean);
    return [{ label: connName, spec: { ...p, path: '/' } }, ...parts.map((x, i) => ({ label: x, spec: { ...p, path: '/' + parts.slice(0, i + 1).join('/') } }))];
  }
  const out: { label: string; spec: PaneSpec }[] = [];
  let cur: PaneSpec | null = p;
  while (cur && out.length < 40) {
    if (home && cur.kind === 'local' && cur.path === home) { out.unshift({ label: 'Home', spec: cur }); break; }
    out.unshift({ label: paneTitle(cur) || sep, spec: cur });
    cur = paneParent(cur, sep);
  }
  return out;
}

interface PaneProps {
  side: Side;
  spec: PaneSpec;
  active: boolean;
  conns: Connection[];
  reload: number;
  selected: Set<string>;
  onSelect: (names: Set<string>) => void;
  onActivate: () => void;
  onGo: (spec: PaneSpec) => void;
  onRows: (rows: Row[]) => void;
}

function Pane({ side, spec, active, conns, reload, selected, onSelect, onActivate, onGo, onRows }: PaneProps) {
  const { info, settings, version } = useStore();
  const sep = info?.sep ?? '/';
  const places = usePlaces(conns);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const anchor = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const conn = spec.kind === 'remote' ? conns.find((c) => c.id === spec.id) : undefined;
  const key = encodePane(spec);
  const hidden = !!settings?.showHidden;

  useEffect(() => {
    let alive = true;
    setError(null);
    const load = spec.kind === 'local'
      ? api.files.browse(spec.path, hidden).then((l) => l.map((e) => ({ name: e.name, path: e.path, isDir: e.isDir, size: e.size, mtime: e.mtime })))
      : api.remote.listDir(spec.id, spec.path).then((l) => l.filter((e) => hidden || !e.name.startsWith('.')).map((e) => ({ name: e.name, path: e.path, isDir: e.isDir, size: e.size, mtime: e.mtime })));
    load.then((l) => { if (alive) { const s = [...l].sort(byName); setRows(s); onRows(s); } }, (e) => { if (alive) { setRows([]); onRows([]); setError(errText(e)); } });
    return () => { alive = false; };
    // onRows is the page's setter for this side; it does not change what is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hidden, reload, version]);
  useEffect(() => { setCursor(0); anchor.current = null; }, [key]);

  const up = paneParent(spec, sep);
  const crumbs = crumbsFor(spec, info?.home, sep, conn?.name ?? 'Connection');
  const open = (r: Row) => {
    if (r.isDir) onGo(paneChild(spec, r.name, sep));
    else if (spec.kind === 'local') openQuickLook([{ path: r.path, name: r.name }]);
    else void api.remote.preview(spec.id, { name: r.name, path: r.path, isDir: false, size: r.size, mtime: r.mtime }).then((local) => openQuickLook([{ path: local, name: r.name }]), () => undefined);
  };
  const click = (e: React.MouseEvent, i: number) => {
    onActivate();
    const list = rows ?? [];
    const name = list[i].name;
    setCursor(i);
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      onSelect(new Set(list.slice(a, b + 1).map((r) => r.name)));
      return;
    }
    anchor.current = i;
    if (e.metaKey || e.ctrlKey) {
      const n = new Set(selected);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      onSelect(n);
    } else onSelect(new Set([name]));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const list = rows ?? [];
    if (!list.length && e.key !== 'Backspace') return;
    const move = (to: number) => {
      const i = Math.max(0, Math.min(list.length - 1, to));
      setCursor(i);
      if (e.shiftKey && anchor.current !== null) {
        const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
        onSelect(new Set(list.slice(a, b + 1).map((r) => r.name)));
      } else {
        anchor.current = i;
        onSelect(new Set([list[i].name]));
      }
      listRef.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') { e.preventDefault(); move(cursor + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(cursor - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(list.length - 1); }
    else if (e.key === 'Enter' && list[cursor]) { e.preventDefault(); open(list[cursor]); }
    else if (e.key === 'Backspace' && up) { e.preventDefault(); onGo(up); }
    else if (e.key === ' ' && list[cursor]) {
      e.preventDefault();
      const n = new Set(selected);
      const nm = list[cursor].name;
      if (n.has(nm)) n.delete(nm);
      else n.add(nm);
      onSelect(n);
    } else if (e.key.toLowerCase() === 'a' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSelect(new Set(list.map((r) => r.name))); }
  };

  // The place this folder is in: its connection, or the longest home folder or pinned folder that holds it.
  const placeValue = spec.kind === 'remote'
    ? places.remote.find((p) => p.spec.kind === 'remote' && p.spec.id === spec.id)?.spec
    : places.local.filter((p) => p.spec.kind === 'local' && (spec.path === p.spec.path || spec.path.startsWith(p.spec.path.replace(/[\\/]+$/, '') + sep))).sort((a, b) => b.spec.path.length - a.spec.path.length)[0]?.spec;
  const nDirs = rows?.filter((r) => r.isDir).length ?? 0;
  const label = side === 'left' ? 'Left side' : 'Right side';

  return (
    <section className={`pane card ${active ? 'active' : ''}`} aria-label={label} data-testid={`pane-${side}`} onMouseDown={onActivate} onFocus={onActivate}>
      <div className="pane-head">
        <button className="btn ghost sm icon" disabled={!up} onClick={() => up && onGo(up)} title="Enclosing folder" aria-label={`Enclosing folder, ${label.toLowerCase()}`}><Icon name="arrowUp" size={14} /></button>
        <select className="input sm pane-place" aria-label={`Place, ${label.toLowerCase()}`} value={placeValue ? encodePane(placeValue) : ''} onChange={(e) => { const p = decodePane(e.target.value); if (p) onGo(p); }}>
          {!placeValue ? <option value="">{paneTitle(spec, conn?.name)}</option> : null}
          <optgroup label="This computer">{places.local.map((p) => <option key={encodePane(p.spec)} value={encodePane(p.spec)}>{p.label}</option>)}</optgroup>
          {places.remote.length ? <optgroup label="Cloud & Servers">{places.remote.map((p) => <option key={encodePane(p.spec)} value={encodePane(p.spec)}>{p.label}</option>)}</optgroup> : null}
        </select>
      </div>
      <nav className="pane-crumbs crumbs" aria-label={`Path, ${label.toLowerCase()}`}>
        {crumbs.map((c, i) => (
          <span key={encodePane(c.spec)} className="row">
            {i > 0 ? <Icon name="chevronRight" size={11} className="muted" /> : null}
            <button className="crumb" aria-current={i === crumbs.length - 1 ? 'location' : undefined} onClick={() => onGo(c.spec)}>{c.label}</button>
          </span>
        ))}
      </nav>
      <div className="pane-list" ref={listRef} role="listbox" aria-multiselectable="true" aria-label={`Files, ${label.toLowerCase()}`} tabIndex={0} onKeyDown={onKey}
        aria-activedescendant={rows?.[cursor] ? `${side}-row-${cursor}` : undefined}>
        {rows === null ? <Loading /> : error ? <Empty compact icon="warning" title="Can’t open this folder">{error}</Empty> : !rows.length ? (
          <Empty compact icon="folder" title="This folder is empty">Copy something here from the other side.</Empty>
        ) : rows.map((r, i) => (
          <div key={r.name} id={`${side}-row-${i}`} data-index={i} role="option" aria-selected={selected.has(r.name)} className={`pane-row ${selected.has(r.name) ? 'on' : ''} ${i === cursor && active ? 'cursor' : ''}`}
            onClick={(e) => click(e, i)} onDoubleClick={() => open(r)} title={r.name}>
            <Icon name={r.isDir ? 'folder' : 'document'} size={15} className={r.isDir ? 'pane-ico dir' : 'pane-ico'} />
            <span className="pane-name">{r.name}</span>
            <span className="pane-size muted small">{r.isDir ? '' : formatBytes(r.size)}</span>
            <span className="pane-date muted small">{r.mtime ? relativeTime(r.mtime) : ''}</span>
          </div>
        ))}
      </div>
      <div className="pane-foot small muted" aria-live="polite">
        {rows ? `${nDirs ? `${nDirs} folder${nDirs === 1 ? '' : 's'}, ` : ''}${rows.length - nDirs} file${rows.length - nDirs === 1 ? '' : 's'}${selected.size ? ` · ${selected.size} chosen` : ''}` : ''}
      </div>
    </section>
  );
}

/** Differences: every row that is not the same, ticked for the sync, with the plan under it. */
function Differences({ left, right, conns, reload, onSynced }: { left: PaneSpec; right: PaneSpec; conns: Connection[]; reload: number; onSynced: () => void }) {
  const { settings, toast } = useStore();
  const [res, setRes] = useState<Awaited<ReturnType<typeof api.panes.compare>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [direction, setDirection] = useState<SyncDirection>('left-to-right');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const deep = settings?.panes?.deep !== false;
  const hidden = !!settings?.showHidden;
  const l = encodePane(left);
  const r = encodePane(right);

  useEffect(() => {
    let alive = true;
    setRes(null);
    setError(null);
    setSkip(new Set());
    api.panes.compare(l, r, { deep, hidden }).then((x) => alive && setRes(x), (e) => alive && setError(errText(e)));
    return () => { alive = false; };
  }, [l, r, deep, hidden, reload]);

  const rows = useMemo(() => (res?.rows ?? []).filter((x) => x.state !== 'same'), [res]);
  const only = useMemo(() => new Set(rows.map((x) => x.rel).filter((rel) => !skip.has(rel))), [rows, skip]);
  const plan = useMemo(() => syncPlan(rows, direction, only), [rows, direction, only]);
  const sum = planSummary(plan);
  const name = (p: PaneSpec) => (p.kind === 'remote' ? conns.find((c) => c.id === p.id)?.name ?? 'Connection' : paneTitle(p));
  const side = (s?: { size: number; mtime: number }, isDir?: boolean) => (s ? `${isDir ? 'Folder' : formatBytes(s.size)}${s.mtime ? ` · ${relativeTime(s.mtime)}` : ''}` : '—');
  const run = async () => {
    setBusy(true);
    try {
      const x = await api.panes.sync(l, r, direction, { deep, hidden, only: [...only] });
      toast(x.failed.length ? `Synced ${x.done}; ${x.failed.length} could not: ${x.failed[0]}` : `Synced ${x.done} item${x.done === 1 ? '' : 's'}. Nothing was deleted.`);
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
      setConfirm(false);
      onSynced();
    }
  };

  if (error) return <div className="card pane-diff"><Empty compact icon="warning" title="Can’t compare these folders">{error}</Empty></div>;
  if (!res) return <div className="card pane-diff"><Loading label="Comparing…" /></div>;
  const same = res.counts.same;
  return (
    <div className="card pane-diff" data-testid="pane-diff">
      <div className="pane-diff-head">
        <div className="small muted">{rows.length ? `${rows.length} difference${rows.length === 1 ? '' : 's'}` : 'No differences'}{same ? ` · ${same} the same, hidden` : ''}{res.truncated ? ' · stopped at 20,000 items' : ''}</div>
        <div className="seg" role="radiogroup" aria-label="Sync direction">
          {([['left-to-right', 'Left → Right'], ['both', 'Both ways'], ['right-to-left', 'Left ← Right']] as const).map(([v, label]) => (
            <button key={v} role="radio" aria-checked={direction === v} className={direction === v ? 'on' : ''} onClick={() => setDirection(v)}>{label}</button>
          ))}
        </div>
      </div>
      {!rows.length ? (
        <Empty compact icon="check" title="These folders match">Everything here is on both sides.</Empty>
      ) : (
        <div className="pane-diff-list" role="table" aria-label="Differences">
          <div className="pane-diff-row head" role="row">
            <span role="columnheader"><span className="sr-only">Include</span></span>
            <span role="columnheader">Name</span>
            <span role="columnheader" title={name(left)}>Left · {name(left)}</span>
            <span role="columnheader">What differs</span>
            <span role="columnheader" title={name(right)}>Right · {name(right)}</span>
          </div>
          {rows.map((x: DiffRow) => (
            <div key={x.rel} className={`pane-diff-row ${skip.has(x.rel) ? 'off' : ''}`} role="row" data-state={x.state}>
              <span role="cell"><Check on={!skip.has(x.rel)} label={`Include ${x.rel}`} onChange={(on) => setSkip((s) => { const n = new Set(s); if (on) n.delete(x.rel); else n.add(x.rel); return n; })} /></span>
              <span role="cell" className="pane-name" title={x.rel}><Icon name={x.isDir ? 'folder' : 'document'} size={14} className={x.isDir ? 'pane-ico dir' : 'pane-ico'} /> {x.rel}</span>
              <span role="cell" className="small muted">{side(x.left, x.isDir)}</span>
              <span role="cell"><span className={`pane-chip ${x.state}`}>{diffLabel(x.state)}</span></span>
              <span role="cell" className="small muted">{side(x.right, x.isDir)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="pane-diff-foot">
        <span className="small muted grow" data-testid="pane-plan">{plan.steps.length ? `${sum.copies ? `Copies ${sum.copies}` : ''}${sum.copies && sum.replaces ? ', ' : ''}${sum.replaces ? `replaces ${sum.replaces} older` : ''}${sum.bytes ? ` · ${formatBytes(sum.bytes)}` : ''} · Nothing is deleted` : 'Nothing to sync in this direction'}{sum.skipped ? ` · ${sum.skipped} left alone` : ''}</span>
        <button className="btn primary sm" data-testid="pane-sync" disabled={!plan.steps.length || busy} onClick={() => setConfirm(true)}><Icon name="refresh" size={13} /> Sync…</button>
      </div>
      {confirm ? (
        <Modal title="Sync these folders?" onClose={() => setConfirm(false)} width={520} testId="pane-sync-sheet">
          <div className="col">
            <ul className="pane-plan-list">
              {plan.steps.slice(0, 8).map((s) => <li key={s.rel}><Icon name={s.from === 'left' ? 'chevronRight' : 'chevronLeft'} size={12} /> {s.op === 'copy' ? 'Copy' : 'Replace the older'} <b>{s.rel}</b> {s.from === 'left' ? `to the right (${name(right)})` : `to the left (${name(left)})`}</li>)}
              {plan.steps.length > 8 ? <li className="muted">and {plan.steps.length - 8} more</li> : null}
            </ul>
            <div className="small muted">Replaced files on this computer go to the Trash first. Nothing is deleted.</div>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn primary" data-testid="pane-sync-go" disabled={busy} onClick={() => void run()}>{busy ? 'Syncing…' : `Sync ${plan.steps.length} item${plan.steps.length === 1 ? '' : 's'}`}</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function Panes() {
  const { route, go, info, settings, toast, refresh } = useStore();
  const home = info?.home ?? '/';
  const sep = info?.sep ?? '/';
  const left: PaneSpec = decodePane(route.arg) ?? { kind: 'local', path: home };
  const right: PaneSpec = decodePane(route.q) ?? { kind: 'local', path: home + sep + 'Downloads' };
  const [active, setActive] = useState<Side>('left');
  const [mode, setMode] = useState<'files' | 'diff'>('files');
  const [sel, setSel] = useState<Record<Side, Set<string>>>({ left: new Set(), right: new Set() });
  const rowsRef = useRef<Record<Side, Row[]>>({ left: [], right: [] });
  const [conns, setConns] = useState<Connection[]>([]);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const specs: Record<Side, PaneSpec> = { left, right };

  useEffect(() => {
    void api.remote.list().then((x) => setConns(x.connections), () => undefined);
    return api.on('remote-changed', () => { void api.remote.list().then((x) => setConns(x.connections), () => undefined); setReload((n) => n + 1); });
  }, []);
  // A side that changes folder starts with nothing chosen.
  const lk = encodePane(left);
  const rk = encodePane(right);
  useEffect(() => setSel((s) => ({ ...s, left: new Set() })), [lk]);
  useEffect(() => setSel((s) => ({ ...s, right: new Set() })), [rk]);

  const goSide = useCallback((s: Side, p: PaneSpec) => go(panesRoute(s === 'left' ? p : left, s === 'right' ? p : right)), [go, lk, rk]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async (op: 'copy' | 'move') => {
    const from = active;
    const names = [...sel[from]];
    if (!names.length || busy) return;
    const src = specs[from];
    const dst = specs[other(from)];
    if (samePane(src, dst)) { toast('Both sides show the same folder.'); return; }
    if (src.kind === 'local' && dst.kind === 'local') {
      // Two folders on this computer: the usual copy and move, with its questions and Undo.
      const paths = rowsRef.current[from].filter((r) => names.includes(r.name)).map((r) => r.path);
      transfer(op, paths, dst.path);
      return;
    }
    setBusy(true);
    toast(`${op === 'move' ? 'Moving' : 'Copying'} ${names.length === 1 ? `“${names[0]}”` : `${names.length} items`}…`);
    try {
      const r = await api.panes.copy(encodePane(src), encodePane(dst), names, op === 'move');
      toast(r.failed.length ? `${op === 'move' ? 'Moved' : 'Copied'} ${r.done}; ${r.failed.length} could not: ${r.failed[0]}` : `${op === 'move' ? 'Moved' : 'Copied'} ${r.done} item${r.done === 1 ? '' : 's'}`);
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
      setReload((n) => n + 1);
      refresh();
    }
  }, [active, sel, busy, lk, rk, toast, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // F5 copies, F6 moves (Settings → Files & search → Side by Side); ⌘⌥← / → (Ctrl+Alt elsewhere) switches sides.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"], .modal, .menu, .palette')) return;
      if (mode === 'files' && settings?.panes?.fKeys !== false && (e.key === 'F5' || e.key === 'F6') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        void send(e.key === 'F5' ? 'copy' : 'move');
      } else if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const s: Side = e.key === 'ArrowLeft' ? 'left' : 'right';
        setActive(s);
        document.querySelector<HTMLElement>(`[data-testid="pane-${s}"] .pane-list`)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, settings?.panes?.fKeys, send]);

  const n = sel[active].size;
  const arrow = active === 'left' ? '→' : '←';
  const fKeys = settings?.panes?.fKeys !== false;

  return (
    <div className="panes-page">
      <PageHead title="Side by Side" sub="Copy, move and compare two folders, here or on a server." />
      <div className="pane-bar capsule" role="toolbar" aria-label="Side by Side">
        <div className="seg" role="radiogroup" aria-label="Show">
          <button role="radio" aria-checked={mode === 'files'} className={mode === 'files' ? 'on' : ''} onClick={() => setMode('files')}>Files</button>
          <button role="radio" aria-checked={mode === 'diff'} className={mode === 'diff' ? 'on' : ''} data-testid="pane-mode-diff" onClick={() => setMode('diff')}>Differences</button>
        </div>
        <span className="grow" />
        {mode === 'files' ? (
          <>
            <button className="btn sm primary" data-testid="pane-copy" disabled={!n || busy} onClick={() => void send('copy')} title={fKeys ? 'F5' : undefined}>
              {active === 'right' ? `${arrow} ` : ''}Copy{n > 1 ? ` ${n}` : ''}{active === 'left' ? ` ${arrow}` : ''}
            </button>
            <button className="btn sm" data-testid="pane-move" disabled={!n || busy} onClick={() => void send('move')} title={fKeys ? 'F6' : undefined}>Move{n > 1 ? ` ${n}` : ''}</button>
          </>
        ) : null}
        <button className="btn sm ghost icon" title="Swap sides" aria-label="Swap sides" data-testid="pane-swap" onClick={() => go(panesRoute(right, left))}><Icon name="swap" size={14} /></button>
        <button className="btn sm ghost icon" title="Back to one folder" aria-label="Back to one folder" onClick={() => (left.kind === 'local' ? go({ name: 'browse', arg: left.path }) : go({ name: 'remote', arg: `${left.id}:${left.path}` }))}><Icon name="close" size={14} /></button>
      </div>
      {mode === 'files' ? (
        <div className="panes">
          {(['left', 'right'] as Side[]).map((s) => (
            <Pane key={s} side={s} spec={specs[s]} active={active === s} conns={conns} reload={reload} selected={sel[s]}
              onSelect={(names) => setSel((x) => ({ ...x, [s]: names }))} onActivate={() => setActive(s)} onGo={(p) => goSide(s, p)}
              onRows={(r) => { rowsRef.current[s] = r; }} />
          ))}
        </div>
      ) : (
        <Differences left={left} right={right} conns={conns} reload={reload} onSynced={() => setReload((x) => x + 1)} />
      )}
      <div className="small muted pane-hint">{mode === 'files' ? `${fKeys ? 'F5 copies, F6 moves · ' : ''}${isMac ? '⌘⌥' : 'Ctrl+Alt+'}← / → switches sides · Space chooses` : 'Untick a row to leave it out · Nothing is ever deleted'}</div>
    </div>
  );
}
