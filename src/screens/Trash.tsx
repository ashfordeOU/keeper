// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Trash (Recycle Bin on Windows): what was deleted, from where and when,
// with Put Back, Delete Immediately and Empty Trash.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TrashItem, TrashListing } from '../../core/api-places';
import { formatBytes, relativeTime, tildify } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Check, Empty, Loading, Modal, PageHead } from '../components/ui';
import { useStore } from '../state';
import '../styles/places.css';

export function Trash() {
  const { info, toast } = useStore();
  const bin = info?.platform === 'win32' ? 'Recycle Bin' : 'Trash';
  const [list, setList] = useState<TrashListing | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ask, setAsk] = useState<'remove' | 'empty' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const l = await api.places.trash.list().catch((e: Error) => ({ items: [], note: e.message, canRestore: false }));
    setList(l);
    setPicked((s) => new Set([...s].filter((id) => l.items.some((i) => i.id === id))));
  }, []);
  useEffect(() => void load(), [load]);

  const items = useMemo(() => [...(list?.items ?? [])].sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)), [list]);
  const total = items.reduce((n, i) => n + i.size, 0);
  const chosen = items.filter((i) => picked.has(i.id));
  const all = items.length > 0 && picked.size === items.length;
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const where = (i: TrashItem) => (i.original ? tildify(i.original.replace(/[\\/][^\\/]*$/, '') || i.original, info?.home ?? '') : 'Unknown location');

  const restore = async (ids: string[]) => {
    setBusy(true);
    const r = await api.places.trash.restore(ids);
    setBusy(false);
    toast(r.failed.length ? `Put back ${r.restored}; ${r.failed.length} could not be put back` : `Put back ${r.restored} item${r.restored === 1 ? '' : 's'}`);
    void load();
  };
  const remove = async () => {
    setBusy(true);
    const r = await api.places.trash.remove(chosen.map((i) => i.id));
    setBusy(false);
    setAsk(null);
    toast(r.failed.length ? `Deleted ${r.removed}; ${r.failed.length} could not be deleted` : `Deleted ${r.removed} item${r.removed === 1 ? '' : 's'} for good`);
    void load();
  };
  const empty = async () => {
    setBusy(true);
    const r = await api.places.trash.empty();
    setBusy(false);
    setAsk(null);
    toast(r.ok ? `${bin} emptied` : r.message ?? `Could not empty the ${bin}`);
    void load();
  };

  return (
    <div>
      <PageHead title={bin} sub={list ? `${items.length} item${items.length === 1 ? '' : 's'} · ${formatBytes(total)}` : ' '}>
        <button className="btn" disabled={!chosen.length || busy || !list?.canRestore} onClick={() => void restore(chosen.map((i) => i.id))}><Icon name="undo" size={14} />Put Back</button>
        <button className="btn" disabled={!chosen.length || busy} onClick={() => setAsk('remove')}><Icon name="trash" size={14} />Delete Immediately</button>
        <button className="btn danger" disabled={!items.length || busy} onClick={() => setAsk('empty')}>Empty {bin}</button>
      </PageHead>
      {list?.note ? <div className="card pad small" style={{ marginBottom: 12, borderColor: 'var(--warn, var(--line))' }}><Icon name="info" size={13} /> {list.note}</div> : null}
      {!list ? <Loading /> : !items.length ? (
        <Empty icon="trash" title={`The ${bin} is empty`}>Things you delete in Keeper or your file manager wait here until you empty it.</Empty>
      ) : (
        <div className="card">
          <div className="trash-row small muted" style={{ fontWeight: 600 }}>
            <Check on={all} onChange={(v) => setPicked(new Set(v ? items.map((i) => i.id) : []))} />
            <span />
            <span>Name · original location</span>
            <span>Deleted</span>
            <span style={{ textAlign: 'right' }}>Size</span>
            <span />
          </div>
          {items.map((i) => (
            <div key={i.id} className={`trash-row ${picked.has(i.id) ? 'selected' : ''}`} onClick={() => toggle(i.id)} onDoubleClick={() => list.canRestore && void restore([i.id])}>
              <Check on={picked.has(i.id)} onChange={() => toggle(i.id)} />
              <Icon name={i.isDir ? 'folder' : 'document'} size={20} />
              <div style={{ minWidth: 0 }}>
                <div className="ellipsis">{i.name}</div>
                <div className="small muted ellipsis" title={i.original}>{where(i)}{i.volume ? ` · ${i.volume}` : ''}</div>
              </div>
              <span className="small muted">{i.deletedAt ? relativeTime(i.deletedAt) : '—'}</span>
              <span className="small" style={{ textAlign: 'right' }}>{formatBytes(i.size)}</span>
              <button className="btn ghost sm icon" title="Put back" disabled={!list.canRestore || busy} onClick={(e) => { e.stopPropagation(); void restore([i.id]); }}><Icon name="undo" size={13} /></button>
            </div>
          ))}
        </div>
      )}
      {ask ? (
        <Modal title={ask === 'empty' ? `Empty the ${bin}?` : `Delete ${chosen.length} item${chosen.length === 1 ? '' : 's'} immediately?`} onClose={() => setAsk(null)}>
          <p>{ask === 'empty' ? `All ${items.length} items (${formatBytes(total)}) will be deleted for good.` : `${formatBytes(chosen.reduce((n, i) => n + i.size, 0))} will be deleted for good.`} This cannot be undone.</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn" onClick={() => setAsk(null)}>Cancel</button>
            <button className="btn danger" disabled={busy} onClick={() => void (ask === 'empty' ? empty() : remove())}>{ask === 'empty' ? `Empty ${bin}` : 'Delete'}</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
