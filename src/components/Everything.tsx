// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The one search box's results beyond files: mail, events, tasks, contacts,
// notes, Keeper's features and system settings, grouped, each opening where
// it lives. Used by the Search page; Quick Search draws the same rows itself
// so the arrow keys run through files and these as one list.

import { useEffect, useState } from 'react';
import { relativeTime } from '../../core/format';
import { EVERYTHING_ICON, EVERYTHING_LABEL, type EverythingHit, type EverythingResult } from '../../core/search-everything';
import { api } from '../api';
import type { Route, RouteName } from '../state';
import { Icon } from './Icon';
import '../styles/everything.css';

/** "name:arg" (as the main process sends pages) as a route. */
export function routeOf(s: string): Route {
  const i = s.indexOf(':');
  return i < 0 ? { name: s as RouteName } : { name: s.slice(0, i) as RouteName, arg: s.slice(i + 1) };
}

/** Everything but files for these words, debounced; empty while nothing is typed. */
export function useEverything(q: string, delay = 150): EverythingResult | null {
  const [r, setR] = useState<EverythingResult | null>(null);
  useEffect(() => {
    if (!q.trim() || !api.search) { setR(null); return; }
    let alive = true;
    const t = setTimeout(() => void api.search.everything(q, { limit: 5 }).then((x) => { if (alive) setR(x); }, () => undefined), delay);
    return () => { alive = false; clearTimeout(t); };
  }, [q, delay]);
  return r;
}

/** One result's second line. */
export function hitLine(h: EverythingHit): string {
  const when = h.when ? (h.kind === 'event' || h.kind === 'task' ? new Date(h.when).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: h.kind === 'event' ? 'short' : undefined }) : relativeTime(h.when)) : '';
  return [EVERYTHING_LABEL[h.kind].replace(/s$/, ''), h.detail, when].filter(Boolean).join(' · ');
}

export function HitIcon({ h }: { h: EverythingHit }) {
  return <div className="ev-icon" aria-hidden><Icon name={EVERYTHING_ICON[h.kind]} size={16} /></div>;
}

/** Grouped results with headings, for a page (Tab and Enter work on each). */
export function EverythingGroups({ result, onOpen }: { result: EverythingResult | null; onOpen: (h: EverythingHit) => void }) {
  if (!result?.groups.length) return null;
  return (
    <section className="ev-groups" aria-label="Elsewhere in Keeper" data-testid="everything">
      <h2 className="small muted ev-title">Elsewhere in Keeper</h2>
      {result.groups.map((g) => (
        <div key={g.kind} className="ev-group" role="group" aria-label={g.label}>
          <div className="small muted ev-head">{g.label}</div>
          {g.hits.map((h) => (
            <button key={`${h.kind}:${h.id}`} className="ev-row" data-kind={h.kind} onClick={() => onOpen(h)} title={h.title}>
              <HitIcon h={h} />
              <span className="grow ev-text">
                <span className="ellipsis ev-name">{h.title}</span>
                <span className="small muted ellipsis">{hitLine(h)}</span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}
