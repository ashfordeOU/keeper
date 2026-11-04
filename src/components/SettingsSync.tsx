// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Devices → Settings on your other computers: one switch, the kinds
// of settings that travel, the computers to share with, and older versions
// to bring back (core/settings-sync.ts, electron/services/settings-sync.ts).

import { useEffect, useState } from 'react';
import type { SettingsSyncStatus } from '../../core/api-settings-sync';
import { relativeTime } from '../../core/format';
import { SYNC_CATEGORIES, type SyncCategory } from '../../core/settings-sync';
import { api } from '../api';
import { useFeature } from '../features';
import { Row } from '../screens/IslandSettings';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Check, Toggle } from './ui';
import '../styles/settings-sync.css';

export function SettingsSyncPanel() {
  const { toast } = useStore();
  const on = useFeature('settingsSync');
  const linkOn = useFeature('link');
  const [st, setSt] = useState<SettingsSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const load = () => void api.settingsSync.status().then(setSt, () => undefined);
    load();
    return api.on('settings-sync-changed', load);
  }, [on]);
  const cats = new Set(st?.categories ?? []);
  const setCat = (c: SyncCategory, v: boolean) => void api.settingsSync.setCategories(SYNC_CATEGORIES.map((x) => x.id).filter((x) => (x === c ? v : cats.has(x)))).then(setSt);

  return (
    <div className="ssync" data-testid="settings-sync">
      <p className="small muted ssync-trust">Between your own computers only · Encrypted end to end · Never passwords</p>
      <Row title="Keep settings the same" desc={linkOn ? 'Changes on one computer appear on the others you choose.' : 'Turn on Keeper on your other devices first.'}>
        <Toggle label="Keep settings the same" disabled={!linkOn} on={on} onChange={(v) => void api.features.set('settingsSync', v)} />
      </Row>
      {on ? (
        <>
          <div className="ssync-group">
            <div className="ssync-head">What travels</div>
            <div className="ssync-cats">
              {SYNC_CATEGORIES.map((c) => (
                <label key={c.id} className="check-label" title={c.hint}><Check on={cats.has(c.id)} onChange={(v) => setCat(c.id, v)} label={c.label} /> {c.label}</label>
              ))}
            </div>
          </div>
          <div className="ssync-group">
            <div className="ssync-head">Share with</div>
            {st?.devices.length ? st.devices.map((d) => (
              <div key={d.id} className="ssync-dev" data-testid="ssync-device">
                <Icon name="laptop" size={14} />
                <div className="grow">
                  <div>{d.name}</div>
                  <div className="small muted">{!d.sharing ? 'Not shared' : d.last ? (d.last.ok ? `Same as this one · ${relativeTime(d.last.at)}` : d.last.message ?? 'Could not reach it') : 'Turn this on on that computer too'}</div>
                </div>
                <Toggle label={`Share with ${d.name}`} on={d.sharing} onChange={(v) => void api.settingsSync.setDevice(d.id, v).then(setSt)} />
              </div>
            )) : <div className="small muted">Pair a computer under Devices first.</div>}
            <div className="btn-row ssync-actions">
              <button className="btn" data-testid="ssync-now" disabled={busy || !st?.devices.some((d) => d.sharing)} onClick={() => { setBusy(true); void api.settingsSync.syncNow().then((s) => { setSt(s); toast('Settings are the same now'); }, () => undefined).finally(() => setBusy(false)); }}><Icon name="refresh" size={13} /> Sync now</button>
            </div>
          </div>
          {st?.older.length ? (
            <details className="ssync-older" data-testid="ssync-older">
              <summary className="small">Older versions ({st.older.length})</summary>
              {st.older.map((o, i) => (
                <div key={`${o.cat}:${o.key}:${o.replaced}`} className="ssync-old">
                  <span className="grow">{o.label}<span className="muted small"> · replaced {relativeTime(o.replaced)}</span></span>
                  <button className="btn sm ghost" onClick={() => void api.settingsSync.restoreOlder(i).then((s) => { setSt(s); toast(`${o.label} is back`); })}>Bring back</button>
                </div>
              ))}
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
