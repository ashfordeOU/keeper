// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Features → App icons: Keeper Mail, Keeper Calendar, Keeper Notes, Keeper Files
// and the others (core/launchers.ts). Each one is added to Applications, the Start menu or
// the app menu on request, and removed here again. Started while Keeper is closed, it runs
// as a light app with only its own part (core/solo.ts); the switch below can make them start
// all of Keeper instead.

import { useEffect, useState } from 'react';
import { LAUNCHERS } from '../../core/launchers';
import type { LauncherState } from '../../core/launchers';
import { api } from '../api';
import { useFeatureStates } from '../features';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Toggle } from './ui';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function LaunchersPanel() {
  const { info, toast } = useStore();
  const states = useFeatureStates();
  const [list, setList] = useState<LauncherState[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { void api.launchers?.list().then(setList).catch(() => undefined); }, [states]);
  if (!api.launchers || !list) return null;
  const platform = info?.platform ?? '';
  const where = platform === 'darwin' ? 'Applications' : platform === 'win32' ? 'the Start menu' : 'your app menu';
  const reveal = platform === 'darwin' ? 'Show in Finder' : platform === 'win32' ? 'Show in File Explorer' : 'Show in Folder';
  const on = (feature: string) => states?.get(feature)?.on !== false;
  const light = on('soloApps');
  // Only the parts that are on; the others wait until their part is switched on.
  const shown = list.filter((l) => on(LAUNCHERS.find((x) => x.page === l.page)?.feature ?? ''));
  const waiting = list.length - shown.length;

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
    <section className="feature-group launchers" data-testid="launchers" aria-labelledby="launchers-title">
      <div className="feature-group-title" id="launchers-title">App icons</div>
      <p className="launchers-lead">Open one part of Keeper on its own, with an icon of its own.</p>
      <p className="launchers-facts small muted">
        {light ? 'Starts only what it needs' : 'Starts all of Keeper'} · Same settings and accounts · Updates with Keeper
      </p>
      <ul className="launchers-grid">
        {shown.map((l) => {
          const def = LAUNCHERS.find((x) => x.page === l.page);
          const disabled = busy === l.page || (!l.installed && (!!l.unavailable || !!l.foreign));
          const note = l.unavailable ?? (l.foreign ? 'Another app has this name' : l.installed ? 'Added' : 'Not added');
          return (
            <li key={l.page} className={`launcher-tile ${l.installed ? 'on' : ''}`} data-launcher={l.page}>
              <span className="launcher-badge" style={{ background: def?.color }} aria-hidden><Icon name={def?.icon ?? 'app'} size={16} stroke={2.2} /></span>
              <div className="grow launcher-text">
                {/* "Keeper" is in every name: the tile shows the part ("Mail"), the full name is in the tooltip. */}
                <div className="launcher-name" title={l.name}>{l.name.replace(/^Keeper /, '')}</div>
                <div className="small muted launcher-note" title={l.installed ? `${l.name} is in ${where}: ${l.path}` : undefined}>{note}</div>
              </div>
              {l.installed ? <button className="btn ghost icon sm" title={reveal} aria-label={`${reveal}: ${l.name}`} onClick={() => void api.launchers!.reveal(l.page)}><Icon name="folder" size={14} /></button> : null}
              <Toggle on={l.installed} disabled={disabled} label={`${l.name} in ${where}`} onChange={(v) => void act(l.page, v ? 'add' : 'remove')} />
            </li>
          );
        })}
      </ul>
      {waiting > 0 ? <p className="small muted launchers-more">{waiting === 1 ? 'One more app icon appears' : `${waiting} more app icons appear`} when its part is switched on below.</p> : null}
      <div className="feature-row launchers-light">
        <div className="grow">
          <div className="feature-name">Start only what they need</div>
          <div className="small muted">Off: an app icon starts all of Keeper.</div>
        </div>
        <Toggle on={light} label="App icons start only what they need" onChange={(v) => void api.features.set('soloApps', v).catch((e) => toast(errText(e)))} />
      </div>
    </section>
  );
}
