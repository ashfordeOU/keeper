// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The small window that pops up beside the app or page a cue belongs to
// (and the composer opened by the shortcut, the palette or the tray).

import { useEffect, useState } from 'react';
import type { Cue, CueAnchor } from '../../core/cues/model';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Composer, CueCard, useCues } from './parts';

type PopupData = { cues: Cue[]; front?: { app?: string; title?: string; url?: string }; compose?: { text?: string; attach?: CueAnchor['kind'][] } };

export function CuePopup() {
  const [st] = useCues();
  const [data, setData] = useState<PopupData | null>(null);
  const [now, setNow] = useState(Date.now());
  const load = () => void api.cues.popup().then((d) => setData(d as PopupData));
  useEffect(() => {
    load();
    const off = api.on('cue-popup', load);
    const off2 = api.on('cues-changed', load);
    const t = setInterval(() => setNow(Date.now()), 30_000);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') void api.cues.closePopup(); };
    window.addEventListener('keydown', esc);
    return () => { off(); off2(); clearInterval(t); window.removeEventListener('keydown', esc); };
  }, []);
  if (!data) return null;
  const where = data.front?.url ? new URL(data.front.url).hostname.replace(/^www\./, '') : data.front?.app;
  const live = data.cues.filter((c) => !c.done && !c.deletedAt);
  return (
    <div className="cue-pop" role="dialog" aria-label={data.compose ? 'New cue' : 'Cues for this place'} data-testid="cue-popup">
      <div className="cue-pop-head">
        <span className="owl"><Icon name="pin" size={13} /></span>
        <b>{data.compose ? 'New cue' : live.length === 1 ? 'A cue for here' : `${live.length} cues for here`}</b>
        <span className="where ellipsis">{where ? `· ${where}` : ''}</span>
        <button className="btn ghost sm icon" title="Open Cues" aria-label="Open Cues" onClick={() => void api.cues.openPage()}><Icon name="external" size={12} /></button>
        <button className="btn ghost sm icon" title="Close (Esc)" aria-label="Close" onClick={() => void api.cues.closePopup()}><Icon name="close" size={12} /></button>
      </div>
      <div className="cue-pop-body">
        {data.compose ? (
          <Composer st={st} compact autoFocus initial={data.compose.text} attach={data.compose.attach} onSaved={() => void api.cues.closePopup()} onCancel={() => void api.cues.closePopup()} />
        ) : live.length ? (
          live.map((c) => <CueCard key={c.id} cue={c} now={now} compact onDismiss={() => void api.cues.dismiss(c.id)} />)
        ) : (
          <div className="muted small" style={{ padding: 8 }}>All done here.</div>
        )}
      </div>
    </div>
  );
}
