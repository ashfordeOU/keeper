// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Fix-it List (was To do): everything Keeper found worth doing about space, storage, security,
// privacy, speed, the network, backups and updates — most important first —
// each with a fix that is done for you or walked through step by step.

import { useState } from 'react';
import { AREAS, type Area } from '../../core/guide/types';
import { formatBytes, relativeTime } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, PageHead } from '../components/ui';
import { AREA_ICON, AREA_LABEL, FindingCard, gtTodo, openGuide, useGuideLang, useGuideList, useHowTo } from '../guide';

export function Todo() {
  const lang = useGuideLang();
  const [list, reload] = useGuideList();
  const [area, setArea] = useState<Area | 'all'>('all');
  const [show, setShow] = useState<'open' | 'later'>('open');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const how = useHowTo(q);
  const open = list?.findings.filter((f) => f.status === 'open') ?? [];
  const later = list?.findings.filter((f) => f.status === 'snoozed' || f.status === 'ignored') ?? [];
  const shown = (show === 'open' ? open : later).filter((f) => area === 'all' || f.area === area);
  const freeable = open.reduce((n, f) => n + (f.impactBytes ?? 0), 0);

  return (
    <div className="todo">
      <PageHead title={gtTodo(lang)} sub={list ? <>{open.length ? `${open.length} thing${open.length === 1 ? '' : 's'} worth doing` : 'Nothing to do — all good.'}{freeable ? ` · up to ${formatBytes(freeable)} to free` : ''}{list.checkedAt ? ` · checked ${relativeTime(list.checkedAt)}` : ''}</> : 'Checking…'}>
        <button className="btn" disabled={busy} onClick={async () => { setBusy(true); await api.guide.refresh(); reload(); setBusy(false); }}>{busy ? <div className="spinner" /> : <Icon name="refresh" size={14} />} Check again</button>
      </PageHead>

      <div className="howto">
        <Icon name="search" size={15} />
        <input className="input" placeholder="How do I…? — free up space, stop apps watching my camera, encrypt my disk…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="How do I" />
      </div>
      {q ? (
        <div className="howto-results">
          {how.length ? how.map((h) => <button key={h.id} className="chip" onClick={() => openGuide(h.id)}><Icon name={AREA_ICON[h.area as Area] ?? 'sparkle'} size={13} /> {h.title}</button>) : <span className="small muted">No guide for that yet — try “free up space”, “camera”, “encrypt”, “backup”, “trackers”.</span>}
        </div>
      ) : null}

      <div className="seg" style={{ margin: '14px 0 10px' }}>
        <button className={area === 'all' ? 'on' : ''} onClick={() => setArea('all')}>All</button>
        {AREAS.filter((a) => (list?.summary.byArea[a] ?? 0) > 0 || a === area).map((a) => (
          <button key={a} className={area === a ? 'on' : ''} onClick={() => setArea(a)}>{AREA_LABEL[a]} <span className="count">{list?.summary.byArea[a] ?? 0}</span></button>
        ))}
        <span className="grow" />
        {later.length ? <button className={show === 'later' ? 'on' : ''} onClick={() => setShow(show === 'later' ? 'open' : 'later')}>Snoozed and ignored ({later.length})</button> : null}
      </div>

      {!list ? null : shown.length ? (
        <div className="findings">
          {shown.map((f) => (
            <div key={f.id} className="finding-wrap">
              <FindingCard f={f} />
              {show === 'later' ? <button className="link-like small" onClick={() => void api.guide.setState(f.id, null).then(reload)}>Bring back</button> : null}
            </div>
          ))}
        </div>
      ) : (
        <Empty icon="check" title={show === 'open' ? 'Nothing to do — all good.' : 'Nothing snoozed or ignored'}>
          <span className="small">Keeper checks space, security, privacy, backups and updates a minute after it starts and twice a day.</span>
        </Empty>
      )}

      <h3 style={{ margin: '22px 0 8px' }}>Guides</h3>
      <div className="guide-flows">
        <GuideList />
      </div>
    </div>
  );
}

function GuideList() {
  const flows = useHowTo('');
  return <>{flows.map((h) => <button key={h.id} className="guide-flow" onClick={() => openGuide(h.id)}><Icon name={AREA_ICON[h.area as Area] ?? 'sparkle'} size={15} /><span>{h.title}</span><Icon name="chevronRight" size={13} /></button>)}</>;
}
