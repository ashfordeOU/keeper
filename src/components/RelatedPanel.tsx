// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Related": what the knowledge graph links to the thing on screen — a note,
// the sender of an email, a file in the inspector, a calendar event — with the
// reason for each. Closed until opened, so it costs nothing on the way past;
// opening asks the graph once. Each row opens the thing; "Show in graph"
// focuses the graph on it.

import { useEffect, useState } from 'react';
import type { ItemRef, RelatedItem } from '../../core/graph/everything';
import { KIND_LABEL, REASON_LABEL } from '../../core/graph/everything';
import { api } from '../api';
import { KIND_ICON, openNode, whenOf } from '../lib/graph-open';
import { useStore } from '../state';
import { useFeature } from '../features';
import { Icon } from './Icon';
import '../styles/graph.css';

export function RelatedPanel({ target, label = 'Related', open: startOpen = false, testid }: { target: ItemRef | null; label?: string; open?: boolean; testid?: string }) {
  const { go } = useStore();
  const on = useFeature('graphAll');
  const [open, setOpen] = useState(startOpen);
  const [res, setRes] = useState<{ id?: string; items: RelatedItem[] } | null>(null);
  const [err, setErr] = useState(false);
  const key = JSON.stringify(target);

  useEffect(() => {
    setRes(null);
    setErr(false);
    if (!open || !target || !on) return;
    let alive = true;
    api.agents.graphRelated(target, { limit: 6 }).then((r) => alive && setRes({ id: r.node?.id, items: r.items }), () => alive && setErr(true));
    return () => { alive = false; };
    // The target is compared by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open, on]);

  if (!on || !target) return null;
  return (
    <section className="kg-related" data-testid={testid ?? 'related-panel'}>
      <button className="kg-related-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="graph" size={13} />
        <span className="grow">{label}</span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
      </button>
      {open ? (
        <div className="kg-related-body">
          {err ? <p className="kg-related-note">The graph could not be read just now. <button className="link-btn" onClick={() => { setOpen(false); setTimeout(() => setOpen(true)); }}>Try again</button></p>
            : !res ? <p className="kg-related-note">Looking…</p>
            : !res.items.length ? <p className="kg-related-note">Nothing linked yet. Links appear as mail, events and notes mention it.</p>
            : (
              <ul className="kg-related-list">
                {res.items.map((r) => (
                  <li key={r.node.id}>
                    <button className="kg-related-row" onClick={() => openNode(r.node, go)} title={r.why.join('\n')} data-testid="related-row">
                      <span className={`kg-ico k-${r.node.kind}`} aria-hidden><Icon name={KIND_ICON[r.node.kind]} size={12} /></span>
                      <span className="kg-related-text">
                        <span className="kg-related-name">{r.node.label}</span>
                        <span className="kg-related-why">{REASON_LABEL[r.reason]}{r.via ? ` · through ${r.via.label}` : ''}{whenOf(r.node) ? ` · ${whenOf(r.node)}` : ''}</span>
                      </span>
                      <span className="sr-only">{KIND_LABEL[r.node.kind][0]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          {res?.id ? <button className="btn sm ghost kg-related-more" onClick={() => go({ name: 'graph', arg: res.id })}><Icon name="graph" size={12} /> Show in graph</button> : null}
        </div>
      ) : null}
    </section>
  );
}
