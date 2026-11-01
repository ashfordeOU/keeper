// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// iPhone and iPad backups in the storage view: which device, how old, how big,
// and a way to move old ones to the Trash (undoable from Keeper's history).

import { useState } from 'react';
import { formatBytes } from '../../core/format';
import type { PhoneBackup } from '../../core/phone-backups';
import { api } from '../api';
import { Icon } from './Icon';
import { useStore } from '../state';

const ago = (t?: number) => {
  if (!t) return 'date unknown';
  const d = Math.round((Date.now() - t) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : new Date(t).toLocaleDateString();
};

export function PhoneBackups() {
  const { toast } = useStore();
  const [list, setList] = useState<PhoneBackup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const find = async () => {
    setBusy(true);
    try { setList((await api.convert.phoneBackups()).backups); } finally { setBusy(false); }
  };
  const remove = async (b: PhoneBackup) => {
    if (!confirm(`Move the backup of “${b.deviceName}” (${formatBytes(b.size)}) to the Trash? You can restore it from the Trash.`)) return;
    await api.files.trash([b.path], `Phone backup: ${b.deviceName}`);
    setList((l) => l?.filter((x) => x.path !== b.path) ?? null);
    toast(`Moved the backup of ${b.deviceName} to the Trash`);
  };
  const total = list?.reduce((n, b) => n + b.size, 0) ?? 0;
  return (
    <div className="card col phone-backups" style={{ gap: 8, padding: 12, marginTop: 12 }}>
      <div className="row">
        <Icon name="phone" size={15} />
        <b className="grow">iPhone and iPad backups</b>
        {list ? <span className="muted small">{list.length ? `${list.length} backup${list.length === 1 ? '' : 's'} · ${formatBytes(total)}` : 'None on this computer'}</span> : null}
        <button className="btn sm" disabled={busy} onClick={() => void find()}>{busy ? <span className="spinner" /> : <Icon name="search" size={12} />} {list ? 'Look again' : 'Find backups'}</button>
      </div>
      {list?.map((b) => (
        <div key={b.path} className="row" style={{ gap: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <div className="grow col" style={{ gap: 2, minWidth: 0 }}>
            <span className="ellipsis"><b>{b.deviceName}</b> <span className="muted small">· {b.model}{b.iosVersion ? ` · iOS ${b.iosVersion}` : ''}{b.encrypted ? ' · encrypted' : ''}</span></span>
            <span className="muted small">Last backed up {ago(b.lastBackup)}</span>
          </div>
          <span className="num">{formatBytes(b.size)}</span>
          <button className="btn sm ghost" title="Show in folder" onClick={() => void api.files.reveal(b.path)}><Icon name="reveal" size={12} /></button>
          <button className="btn sm" onClick={() => void remove(b)}><Icon name="trash" size={12} /> Move to Trash</button>
        </div>
      ))}
    </div>
  );
}
