// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// History: everything Keeper changed on disk, with Undo where possible.

import { useState } from 'react';
import { formatBytes, formatDate, relativeTime } from '../../core/format';
import type { JournalEntry } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Loading, PageHead } from '../components/ui';
import { useAsync, useStore } from '../state';
import '../styles/screens-b.css';

const OP_LABEL = { trash: 'Moved to Trash', move: 'Moved', delete: 'Deleted', startup: 'Startup item', tag: 'Tagged', create: 'Created' } as const;

export function History() {
  const { toast, refresh, info } = useStore();
  const list = useAsync(() => api.history.list(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [undone, setUndone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const short = (p: string) => (info?.home && p.startsWith(info.home) ? '~' + p.slice(info.home.length) : p);

  const undo = async (e: JournalEntry) => {
    setBusy(e.id);
    try {
      const r = await api.history.undo(e.id);
      setUndone((s) => new Set(s).add(e.id));
      refresh();
      toast(r.failed.length ? `Put back ${r.restored}; ${r.failed.length} could not be restored` : `Put back ${r.restored} item${r.restored === 1 ? '' : 's'}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not undo');
    } finally {
      setBusy(null);
    }
  };

  const total = (list.data ?? []).reduce((n, e) => n + e.freed, 0);
  return (
    <div>
      <PageHead title="History" sub={list.data?.length ? `${formatBytes(total)} freed across ${list.data.length} actions` : 'Everything Keeper changes on disk is recorded here.'} />
      {list.loading ? <Loading /> : null}
      {list.data && !list.data.length ? <Empty icon="history" title="Nothing yet">Cleanups, moves, renames and rule runs will show up here.</Empty> : null}
      <div className="timeline">
        {(list.data ?? []).map((e) => {
          const isUndone = e.undone || undone.has(e.id);
          return (
            <div key={e.id} className="card entry">
              <div className="row">
                <Icon name={e.ops[0]?.type === 'move' ? 'folder' : e.ops[0]?.type === 'delete' ? 'broom' : 'trash'} size={16} />
                <div className="grow">
                  <b>{e.title}</b>
                  <div className="small muted" title={new Date(e.at).toLocaleString()}>{relativeTime(e.at)} · {formatDate(e.at)} · {e.ops.length} item{e.ops.length === 1 ? '' : 's'}{e.freed ? ` · ${formatBytes(e.freed)} freed` : ''}</div>
                </div>
                {isUndone ? <span className="badge">Undone</span> : null}
                <button className="btn ghost sm" onClick={() => setOpen(open === e.id ? null : e.id)}>Details <Icon name={open === e.id ? 'chevronDown' : 'chevronRight'} size={12} /></button>
                {e.undoable && !isUndone ? (
                  <button className="btn sm" disabled={busy === e.id} onClick={() => void undo(e)}>{busy === e.id ? <div className="spinner" /> : <Icon name="undo" size={13} />} Undo</button>
                ) : !e.undoable ? <span className="small muted" title="Caches rebuild themselves and cannot be put back">Can’t undo</span> : null}
              </div>
              {open === e.id ? (
                <div className="items" style={{ marginTop: 10, maxHeight: 260, overflow: 'auto' }}>
                  {e.ops.map((o, i) => (
                    <div key={i} className="item-row">
                      <span className="badge">{OP_LABEL[o.type]}</span>
                      <span className="grow ellipsis" title={o.from}>{short(o.from)}</span>
                      {o.to ? <span className="small muted ellipsis" style={{ maxWidth: 280 }} title={o.to}>→ {short(o.to)}</span> : null}
                      {o.size ? <span className="small muted num">{formatBytes(o.size)}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
