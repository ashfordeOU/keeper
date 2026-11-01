// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Says, once and quietly, when Keeper put things back after a problem: the last
// run ended unexpectedly, a window was reloaded, or a part restarted itself.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';

export function RecoveryNotice() {
  const { boot, toast, go } = useStore();
  const [shown, setShown] = useState<'crashed' | 'safe' | null>(boot.safeMode ? 'safe' : boot.crashed ? 'crashed' : null);

  useEffect(() => {
    if (boot.reloaded) toast('This window stopped and was reopened, with your tabs where they were', { label: 'Details', run: () => go({ name: 'settings', arg: 'processes' }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => api.on('resilience' as 'navigate', ((e: { kind: string; name?: string }) => {
    if (e.kind === 'reloaded') toast('This window stopped and was reopened, with your tabs where they were');
    else if (e.kind === 'service-restarted') toast(`${e.name ?? 'A part of Keeper'} stopped and started again`, { label: 'Details', run: () => go({ name: 'settings', arg: 'processes' }) });
  }) as never), [toast, go]);

  if (!shown) return null;
  return (
    <div className={`update-banner recovery ${shown}`} role="status">
      <Icon name={shown === 'safe' ? 'shield' : 'refresh'} size={15} />
      <span className="grow">
        {shown === 'safe'
          ? <>Keeper started in <b>safe mode</b> after stopping several times. Only the library is on; your tabs and settings are untouched.</>
          : <>Keeper closed unexpectedly last time. <b>Your tabs and drafts are back</b> where they were.</>}
      </span>
      <button className="btn sm ghost" onClick={() => go({ name: 'settings', arg: 'processes' })}>Details</button>
      {shown === 'safe' ? <button className="btn sm primary" onClick={() => void api.session.relaunch(false)}>Start normally</button> : null}
      <button className="btn sm ghost icon" title="Dismiss" aria-label="Dismiss" onClick={() => setShown(null)}><Icon name="close" size={13} /></button>
    </div>
  );
}
