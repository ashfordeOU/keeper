// SPDX-License-Identifier: AGPL-3.0-or-later
// "Tidy this folder": preview how loose files would be sorted into
// sub-folders, then do it in one step that can be undone from History.

import { useEffect, useState } from 'react';
import type { TidyMode, TidyMove } from '../../core/tidy';
import { api } from '../api';
import { useT } from '../i18n';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Loading, Modal } from './ui';

export function TidyDialog({ dir, onClose }: { dir: string; onClose: () => void }) {
  const t = useT();
  const { refresh, toast } = useStore();
  const [mode, setMode] = useState<TidyMode>('kind');
  const [plan, setPlan] = useState<{ moves: TidyMove[]; summary: { group: string; count: number }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPlan(null);
    void api.folders.tidy(dir, mode, false).then(setPlan).catch((e: unknown) => { toast(e instanceof Error ? e.message : String(e)); onClose(); });
  }, [dir, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
  return (
    <Modal title={`${t('tidy.title')} — ${name}`} onClose={onClose}>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={mode === 'kind' ? 'on' : ''} onClick={() => setMode('kind')}>{t('tidy.byKind')}</button>
        <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>{t('tidy.byMonth')}</button>
        <button className={mode === 'ext' ? 'on' : ''} onClick={() => setMode('ext')}>{t('tidy.byExt')}</button>
      </div>
      {!plan ? <Loading /> : !plan.moves.length ? <div className="small muted">There are no loose files here to sort.</div> : (
        <>
          <div className="small sub" style={{ marginBottom: 8 }}>{plan.moves.length} file{plan.moves.length === 1 ? '' : 's'} will move into {plan.summary.length} folder{plan.summary.length === 1 ? '' : 's'}. Folders already here stay where they are.</div>
          <div className="card" style={{ maxHeight: 300, overflow: 'auto' }}>
            {plan.summary.map((g) => (
              <details key={g.group} style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)' }}>
                <summary className="row"><Icon name="folder" size={14} /><b className="grow">{g.group}</b><span className="small muted">{g.count}</span></summary>
                {plan.moves.filter((m) => m.group === g.group).map((m) => <div key={m.from} className="small muted ellipsis" style={{ paddingLeft: 22 }}>{m.from.split(/[\\/]/).pop()}</div>)}
              </details>
            ))}
          </div>
        </>
      )}
      <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
        <span className="small muted">You can undo this in History.</span>
        <div className="btn-row">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={!plan?.moves.length || busy} onClick={async () => {
            setBusy(true);
            const r = await api.folders.tidy(dir, mode, true);
            setBusy(false);
            refresh();
            const res = r.result;
            toast(`Sorted ${res?.removed ?? 0} file${res?.removed === 1 ? '' : 's'}${res?.failed ? `, ${res.failed} could not move` : ''}`, res?.journalId ? { label: t('common.undo'), run: () => void api.history.undo(res.journalId!).then(refresh) } : undefined);
            onClose();
          }}>{busy ? 'Sorting…' : t('tidy.title')}</button>
        </div>
      </div>
    </Modal>
  );
}
