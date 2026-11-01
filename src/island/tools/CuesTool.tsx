// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's Cues tool: what belongs to the app or page in front, a quick
// composer attached to it (a just-copied link starts a link cue), and what is
// due today.

import { useMemo } from 'react';
import type { IslandState } from '../../../core/api';
import { sections } from '../../../core/cues/dashboard';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { Composer, CueCard, useCues } from '../../cues/parts';
import '../../styles/cues.css';

export function CuesTool({ state, now }: { state: IslandState; now: number }) {
  const [st] = useCues();
  const sec = useMemo(() => (st ? sections(st.cues, now) : { today: [], upcoming: [] }), [st, now]);
  if (!st) return <div className="muted" style={{ textAlign: 'center', padding: 20 }}>Cues are switched off in Settings → Features.</div>;
  const here = st.showing.map((id) => st.cues.find((c) => c.id === id)).filter((c) => !!c && !c.done && !c.deletedAt);
  // Copying a link a moment ago: start a link cue with it.
  const clip = state.clips[0];
  const link = st.settings.linkOnCopy && clip?.kind === 'link' && now - clip.at < 2 * 60_000 ? clip.text : undefined;
  const where = st.front?.url ? new URL(st.front.url).hostname.replace(/^www\./, '') : st.front?.app;
  return (
    <div className="cues-island" data-testid="island-cues">
      <div className="col">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <b className="grow">{link ? 'Save this link' : 'New cue'}</b>
          {where ? <span className="muted small ellipsis">for {where}</span> : null}
        </div>
        <Composer key={link ?? 'note'} st={st} compact initial={link} attach={link ? [] : ['page', 'app']} />
      </div>
      <div className="col">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <b className="grow">{here.length ? 'Here now' : sec.today.length ? 'Due today' : 'Cues'}</b>
          <button className="btn sm" onClick={() => void api.cues.openPage()}><Icon name="external" size={11} /> All</button>
        </div>
        {(here.length ? here : sec.today).slice(0, 4).map((c) => <CueCard key={c!.id} cue={c!} now={now} compact />)}
        {!here.length && !sec.today.length ? <div className="muted small">Nothing for here. Cues you tie to this app or page pop up when you come back.</div> : null}
        {st.templates.length ? (
          <div className="cue-files">{st.templates.slice(0, 4).map((t) => <button key={t.id} className="cue-chip" onClick={() => void api.cues.startTemplate(t.id, { attach: ['app'] })}><Icon name="listCheck" size={11} /> {t.name}</button>)}</div>
        ) : null}
      </div>
    </div>
  );
}
