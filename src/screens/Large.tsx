// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Large Files: the biggest things in your library, ready to review.

import { useEffect, useState } from 'react';
import { formatBytes, formatDate } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Check, Empty, Loading, PageHead, Thumb } from '../components/ui';
import { useAsync, useStore } from '../state';
import '../styles/screens-a.css';

const THRESHOLDS = [100, 500, 1024, 5120];

export function Large() {
  const { version, trash, setFocused, settings } = useStore();
  const [min, setMin] = useState(settings?.largeFileMb ?? 500);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const files = useAsync(() => api.library.largeFiles(min), [min, version]);
  useEffect(() => setPicked(new Set()), [min, version]);

  const list = files.data ?? [];
  const total = list.reduce((n, f) => n + f.size, 0);
  const selSize = list.filter((f) => picked.has(f.path)).reduce((n, f) => n + f.size, 0);
  const all = list.length > 0 && picked.size === list.length;
  const toggle = (p: string) => setPicked((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  return (
    <div>
      <PageHead title="Large Files" sub={files.data ? `${list.length} file${list.length === 1 ? '' : 's'} · ${formatBytes(total)}` : ' '}>
        <div className="seg">
          {THRESHOLDS.map((t) => <button key={t} className={min === t ? 'on' : ''} onClick={() => setMin(t)}>Over {t >= 1024 ? `${t / 1024} GB` : `${t} MB`}</button>)}
        </div>
      </PageHead>

      {files.loading && !files.data ? <Loading /> : !list.length ? <Empty icon="weight" title="No files that big">Try a smaller size.</Empty> : (
        <div className="card">
          <div className="large-row" style={{ fontWeight: 600 }}>
            <Check on={all} onChange={() => setPicked(all ? new Set() : new Set(list.map((f) => f.path)))} />
            <span className="grow small muted">{picked.size ? `${picked.size} selected · ${formatBytes(selSize)}` : 'Select files to move to the Trash'}</span>
            <button className="btn danger sm" disabled={!picked.size} onClick={() => void trash([...picked], 'Large files')}><Icon name="trash" size={12} /> Move to Trash</button>
          </div>
          {list.map((f) => (
            <div key={f.path} className="large-row" onClick={() => setFocused(f)} onDoubleClick={() => void api.files.open(f.path)}>
              <Check on={picked.has(f.path)} onChange={() => toggle(f.path)} />
              <div className="mini-thumb" style={{ width: 34, height: 34, borderRadius: 7, overflow: 'hidden', background: 'var(--bg-sunk)', display: 'grid', placeItems: 'center', flex: 'none' }}><Thumb file={f} size={96} /></div>
              <div className="grow">
                <div className="ellipsis" style={{ fontWeight: 550 }}>{f.name}</div>
                <div className="small muted ellipsis" title={f.path}>{f.path}</div>
              </div>
              <span className="small muted" style={{ width: 100 }}>{formatDate(f.mtime)}</span>
              <span className="num" style={{ width: 80, textAlign: 'right', fontWeight: 600 }}>{formatBytes(f.size)}</span>
              <button className="btn ghost sm icon" title="Show in folder" onClick={(e) => { e.stopPropagation(); void api.files.reveal(f.path); }}><Icon name="reveal" size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
