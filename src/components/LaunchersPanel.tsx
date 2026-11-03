// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Features → App icons: Keeper Mail, Keeper Calendar and Keeper Notes
// (core/launchers.ts), each added to Applications, the Start menu or the app menu
// on request, and removed here again.

import { useEffect, useState } from 'react';
import { LAUNCHERS } from '../../core/launchers';
import type { LauncherState } from '../../core/launchers';
import { navPage } from '../../core/nav';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function LaunchersPanel() {
  const { info, toast } = useStore();
  const [list, setList] = useState<LauncherState[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { void api.launchers?.list().then(setList).catch(() => undefined); }, []);
  if (!api.launchers || !list) return null;
  const platform = info?.platform ?? '';
  const where = platform === 'darwin' ? 'Applications' : platform === 'win32' ? 'the Start menu' : 'your app menu';
  const reveal = platform === 'darwin' ? 'Show in Finder' : platform === 'win32' ? 'Show in File Explorer' : 'Show in Folder';

  const act = async (page: string, what: 'add' | 'remove') => {
    setBusy(page);
    try {
      setList(await api.launchers![what](page));
      const name = LAUNCHERS.find((l) => l.page === page)?.name ?? page;
      toast(what === 'add' ? `${name} is in ${where}` : `${name} removed`);
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="feature-group" data-testid="launchers">
      <div className="feature-group-title">App icons</div>
      <div className="small muted" style={{ padding: '0 2px 8px' }}>
        Keeper Mail, Keeper Calendar and Keeper Notes: icons of their own to keep in your {platform === 'darwin' ? 'Dock' : platform === 'win32' ? 'Start menu or taskbar' : 'dock or app menu'}. Each opens just its page in a window of its own, and starts Keeper first when it is not running. They use Keeper’s settings, accounts and updates, so Keeper stays installed.
      </div>
      {list.map((l) => {
        const def = LAUNCHERS.find((x) => x.page === l.page);
        return (
          <div key={l.page} className="feature-row" data-launcher={l.page}>
            <span style={{ background: def?.color, flex: 'none', width: 26, height: 26, borderRadius: 7, display: 'grid', placeItems: 'center', color: '#fff' }} aria-hidden><Icon name={navPage(l.page)?.icon ?? 'app'} size={15} stroke={2.2} /></span>
            <div className="grow">
              <div className="feature-name">{l.name}{l.installed ? <span className="badge" style={{ marginLeft: 6 }}>Added</span> : null}</div>
              <div className="small muted">
                {l.unavailable ?? (l.foreign ? `Something else is called ${l.name} there; Keeper leaves it alone.` : l.installed ? l.path : `Adds ${l.name} to ${where}.`)}
              </div>
            </div>
            {l.installed ? <button className="btn sm" onClick={() => void api.launchers!.reveal(l.page)}>{reveal}</button> : null}
            {l.installed
              ? <button className="btn sm" disabled={busy === l.page} onClick={() => void act(l.page, 'remove')}>Remove</button>
              : <button className="btn sm" disabled={busy === l.page || !!l.unavailable || l.foreign} onClick={() => void act(l.page, 'add')}>{platform === 'darwin' ? 'Add to Applications' : platform === 'win32' ? 'Add to Start Menu' : 'Add to App Menu'}</button>}
          </div>
        );
      })}
    </div>
  );
}
