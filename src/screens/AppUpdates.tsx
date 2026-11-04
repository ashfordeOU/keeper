// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Applications → Updates: apps with a newer version, security ones first, each
// with one button (Update through its package manager, or the maker's own
// download after its signature is checked), Update all for what package
// managers can do by themselves, and plain rows for system packages and store apps.

import { useCallback, useEffect, useState } from 'react';
import type { AppUpdatesView as View } from '../../core/api-app-updates';
import { SOURCE_LABEL, updateCounts, type AppUpdate } from '../../core/app-updates';
import { relativeTime } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Loading } from '../components/ui';
import { useStore } from '../state';
import '../styles/extras.css';
import '../styles/app-updates.css';

const BUTTON: Record<AppUpdate['action']['kind'], string> = { run: 'Update', download: 'Download', open: 'Get it' };
const HOW: Record<AppUpdate['action']['kind'], string> = {
  run: 'Updated by its package manager, which checks the maker’s signature',
  download: 'The maker’s own download, opened only after its signature is checked',
  open: 'Opens the maker’s page; this app has no signature Keeper can check',
};

export function AppUpdatesView() {
  const { toast, info } = useStore();
  const [v, setV] = useState<View | null>(null);
  const load = useCallback(() => void api.appUpdates.state().then(setV).catch(() => undefined), []);
  useEffect(() => {
    load();
    return api.on('app-updates-changed', load);
  }, [load]);
  // Never looked yet (just switched on): look now, so the page is not empty.
  useEffect(() => {
    if (v && !v.checkedAt && !v.checking) void api.appUpdates.check().then(setV).catch(() => undefined);
  }, [v]);

  if (!v || (!v.checkedAt && v.checking) || !v.checkedAt) return <Loading label="Looking for updates…" />;
  const c = updateCounts(v);
  const runnable = v.updates.filter((u) => u.action.kind === 'run' && !v.busy.includes(u.id)).length;
  const say = (r: { message: string }) => toast(r.message);
  const update = async (u: AppUpdate) => say(await api.appUpdates.update(u.id).catch((e) => ({ message: e instanceof Error ? e.message : String(e) })));
  const nothing = !c.apps && !c.system;

  return (
    <div className="au" data-testid="app-updates">
      <div className="au-bar">
        <p className="trust-line" data-testid="au-summary">
          {v.checking ? 'Looking now…' : `Checked ${relativeTime(v.checkedAt)}`} · {v.sources} · Signatures checked first
        </p>
        <div className="btn-row">
          <button className="btn ghost" onClick={() => void api.appUpdates.check().then(setV)} disabled={v.checking} data-testid="au-check"><Icon name="refresh" size={14} /> Check now</button>
          {runnable > 1 ? <button className="btn primary" onClick={async () => say(await api.appUpdates.updateAll())} data-testid="au-all">Update all {runnable}</button> : null}
        </div>
      </div>

      {nothing ? (
        <Empty icon="check" title="Every app is up to date" action={<button className="btn" onClick={() => void api.appUpdates.check().then(setV)} disabled={v.checking}>Check again</button>} hint={v.storeApps ? `${v.storeApps} apps from the App Store update there.` : undefined} />
      ) : (
        <ul className="au-list" aria-label="Apps with updates" data-testid="au-list">
          {v.updates.map((u) => {
            const busy = v.busy.includes(u.id);
            return (
              <li key={u.id} className="au-row" data-testid="au-row">
                <span className={`au-badge${u.security ? ' sec' : ''}`} aria-hidden><Icon name={u.security ? 'shield' : 'app'} size={16} /></span>
                <span className="au-text">
                  <span className="au-name">{u.name}{u.security ? <span className="badge warn">Security</span> : null}</span>
                  <span className="small muted">{u.installed} → <b className="au-new">{u.latest}</b> · {SOURCE_LABEL[u.source]}</span>
                </span>
                {u.notes ? <button className="btn ghost sm" onClick={() => void api.system.openExternal(u.notes!)} title="The maker’s notes on this version">What’s new</button> : null}
                <button className="btn sm" disabled={busy} title={HOW[u.action.kind]} onClick={() => void update(u)} data-testid="au-update">{busy ? <><span className="spinner au-spin" aria-hidden /> Updating…</> : BUTTON[u.action.kind]}</button>
              </li>
            );
          })}
          {v.system?.count ? (
            <li className="au-row" data-testid="au-system">
              <span className={`au-badge${v.system.security ? ' sec' : ''}`} aria-hidden><Icon name="installer" size={16} /></span>
              <span className="au-text">
                <span className="au-name">System packages</span>
                <span className="small muted">{v.system.count} update{v.system.count === 1 ? '' : 's'}{v.system.security ? `, ${v.system.security} for security` : ''} · your system’s updater installs them</span>
              </span>
              <button className="btn sm" onClick={async () => say(await api.appUpdates.openSystemUpdater())}>Open updater</button>
            </li>
          ) : null}
        </ul>
      )}

      {v.storeApps && !nothing ? (
        <div className="au-note row">
          <Icon name="info" size={14} />
          <span className="small muted grow">{v.storeApps} app{v.storeApps === 1 ? '' : 's'} from the {info?.platform === 'win32' ? 'Microsoft Store' : 'App Store'} update there.</span>
          <button className="btn ghost sm" onClick={() => void api.appUpdates.openStore()}>Open {info?.platform === 'win32' ? 'Microsoft Store' : 'App Store'}</button>
        </div>
      ) : null}
      {v.notes.length ? <ul className="au-notes small muted" data-testid="au-notes">{v.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
    </div>
  );
}
