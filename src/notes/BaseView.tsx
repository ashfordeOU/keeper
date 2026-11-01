// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A .base file: notes shown as a table or as cards, chosen by the filters
// written in the file. Click a column to sort; the views written in the file
// are tabs; the file itself can be edited as YAML.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import type { NotesApi } from '../../core/api-notes';
import { useNotes } from './ctx';

type Result = Awaited<ReturnType<NotesApi['base']>>;

export function BaseView({ path, source }: { path?: string; source?: string }) {
  const n = useNotes();
  const [view, setView] = useState(0);
  const [res, setRes] = useState<Result | null>(null);
  const [text, setText] = useState<string | null>(source ?? null);
  const [editingSrc, setEditingSrc] = useState(false);
  const [sort, setSort] = useState<{ col: string; desc: boolean } | null>(null);
  const [quick, setQuick] = useState('');

  useEffect(() => {
    if (source != null || !path) return;
    void api.notes.read(n.vault.id, path).then(setText);
  }, [n.vault.id, path, source, n.rev]);
  useEffect(() => {
    if (text == null) return;
    let alive = true;
    void api.notes.base(n.vault.id, { text, view, thisFile: n.activePath ?? undefined }).then((r) => alive && setRes(r)).catch((e) => alive && n.toast((e as Error).message));
    return () => { alive = false; };
  }, [n.vault.id, text, view, n.rev, n.activePath, n]);

  const rows = useMemo(() => {
    if (!res) return [];
    let list = res.rows.map((r, i) => ({ ...r, i }));
    if (quick.trim()) {
      const q = quick.toLowerCase();
      list = list.filter((r) => Object.values(r.cells).some((v) => String(v).toLowerCase().includes(q)));
    }
    if (sort) list = [...list].sort((a, b) => String(a.cells[sort.col] ?? '').localeCompare(String(b.cells[sort.col] ?? ''), undefined, { numeric: true }) * (sort.desc ? -1 : 1));
    return list;
  }, [res, sort, quick]);

  if (text == null || !res) return <div className="nt-loading">Opening…</div>;
  const cell = (r: { path: string; cells: Record<string, unknown> }, id: string) => {
    const v = String(r.cells[id] ?? '');
    if (id === 'file.name' || id === 'file.basename') return <a href="#" onClick={(e) => { e.preventDefault(); n.open(r.path); }}>{v.replace(/\.md$/, '')}</a>;
    return v;
  };

  return (
    <div className="nt-base" data-testid="base-view">
      <div className="nt-base-bar">
        <div className="nt-base-views" role="tablist">
          {res.views.map((v, i) => (
            <button key={i} role="tab" aria-selected={i === view} className={i === view ? 'on' : ''} onClick={() => setView(i)}>
              <Icon name={v.type === 'cards' ? 'grid' : 'list'} size={13} /> {v.name}
            </button>
          ))}
        </div>
        <span className="nt-spacer" />
        <input className="nt-base-q" placeholder="Filter rows" value={quick} onChange={(e) => setQuick(e.target.value)} aria-label="Filter rows" />
        <span className="nt-base-count">{rows.length} of {res.total}</span>
        {path ? <button className="nt-icon-btn" title="Edit the base file" aria-label="Edit the base file" onClick={() => setEditingSrc((x) => !x)}><Icon name="code" size={14} /></button> : null}
      </div>
      {res.errors.length ? <div className="nt-base-err"><Icon name="warning" size={13} /> {res.errors.join(' · ')}</div> : null}
      {editingSrc ? (
        <textarea className="nt-base-src" defaultValue={text} spellCheck={false} onBlur={(e) => { setText(e.target.value); if (path) void api.notes.write(n.vault.id, path, e.target.value); }} />
      ) : res.view.type === 'cards' ? (
        <div className="nt-base-cards">
          {rows.map((r) => (
            <div key={r.path} className="nt-base-card" onClick={() => n.open(r.path)}>
              <div className="nt-base-card-title">{r.path.split('/').pop()?.replace(/\.md$/, '')}</div>
              {res.columns.filter((c) => c.id !== 'file.name' && c.id !== 'file.basename').map((c) => (
                <div key={c.id} className="nt-base-card-row"><span>{c.label}</span><span>{String(r.cells[c.id] ?? '')}</span></div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="nt-base-table-wrap">
          <table className="nt-base-table">
            <thead><tr>{res.columns.map((c) => <th key={c.id} onClick={() => setSort((s) => ({ col: c.id, desc: s?.col === c.id ? !s.desc : false }))}>{c.label}{sort?.col === c.id ? (sort.desc ? ' ↓' : ' ↑') : ''}</th>)}</tr></thead>
            <tbody>
              {res.groups && !sort && !quick
                ? res.groups.flatMap((g) => [
                  <tr key={`g:${g.key}`} className="nt-base-group"><td colSpan={res.columns.length}>{g.key || '(empty)'} · {g.rows.length}</td></tr>,
                  ...g.rows.map((i) => <tr key={res.rows[i].path}>{res.columns.map((c) => <td key={c.id}>{cell(res.rows[i], c.id)}</td>)}</tr>),
                ])
                : rows.map((r) => <tr key={r.path}>{res.columns.map((c) => <td key={c.id}>{cell(r, c.id)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
