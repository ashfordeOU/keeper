// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The glance under the owl in the menu bar: cards of the moment, quick
// actions and the newest downloads. Every card opens its page. Arrow keys move
// between cards and actions, Enter opens, Escape closes. The numbers come
// from the main process every 2 s while it is open (electron/services/glance.ts).

import { useEffect, useRef, useState } from 'react';
import { ACTION_INFO, type GlanceCard, type GlanceView } from '../../core/glance';
import { api } from '../api';
import { Icon } from '../components/Icon';
import '../styles/glance.css';

const CARD_ICON: Record<string, string> = { weather: 'sun', storage: 'disk', system: 'cpu', network: 'globe', awake: 'coffee', usage: 'sparkle', calendar: 'calendar', tip: 'info' };
const size = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

function Card({ c }: { c: GlanceCard }) {
  return (
    <button className={`gl-card ${c.tone ?? ''}`} data-testid={`glance-card-${c.id}`} onClick={() => void api.glance.open(c.open)} title={c.hint} aria-label={`${c.title}: ${c.value}${c.detail ? `, ${c.detail}` : ''}`}>
      <span className="gl-ic"><Icon name={CARD_ICON[c.id] ?? 'info'} size={14} /></span>
      <span className="gl-txt">
        <span className="gl-title">{c.title}</span>
        <span className="gl-value">{c.value}</span>
        {c.detail ? <span className="gl-detail">{c.detail}</span> : null}
        {c.bar !== undefined ? <span className="gl-bar" aria-hidden><i style={{ width: `${Math.max(2, Math.min(100, c.bar))}%` }} /></span> : null}
      </span>
    </button>
  );
}

export function Glance() {
  const [v, setV] = useState<GlanceView | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void api.glance.view().then(setV).catch(() => undefined);
    const off = api.on('glance', (x) => setV(x));
    // Opened again later: fresh numbers at once.
    const vis = () => { if (document.visibilityState === 'visible') void api.glance.view().then(setV).catch(() => undefined); };
    document.addEventListener('visibilitychange', vis);
    return () => { off(); document.removeEventListener('visibilitychange', vis); };
  }, []);
  // Keyboard: arrows move through everything that can be pressed, Escape closes.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { void api.glance.close(); return; }
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const all = [...(root.current?.querySelectorAll<HTMLElement>('button') ?? [])];
      const i = all.indexOf(document.activeElement as HTMLElement);
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      all[(i + step + all.length) % all.length]?.focus();
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div className="glance" ref={root} role="dialog" aria-label="Keeper at a glance" data-testid="glance">
      <div className="gl-cards" role="list">
        {!v ? <span className="gl-muted">Reading…</span> : v.cards.map((c) => <div role="listitem" key={c.id}><Card c={c} /></div>)}
      </div>
      {v && v.actions.length ? (
        <div className="gl-actions" role="toolbar" aria-label="Quick actions">
          {v.actions.map((a) => (
            <button key={a} className="gl-act" data-testid={`glance-action-${a}`} onClick={() => void api.glance.run(a)} title={ACTION_INFO[a].label}>
              <Icon name={ACTION_INFO[a].icon} size={16} /><span>{ACTION_INFO[a].label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {v && v.recent.length ? (
        <div className="gl-recent" aria-label="Newest downloads">
          <div className="gl-head"><span>Downloads</span>{v.moreRecent ? <button className="gl-link" onClick={() => void api.glance.open('downloads')}>See all</button> : null}</div>
          {v.recent.map((f) => (
            <button key={f.path} className="gl-file" onClick={() => void api.glance.openFile(f.path, 'open')} onContextMenu={(e) => { e.preventDefault(); void api.glance.openFile(f.path, 'show'); }} title={f.path}>
              <span className="ellipsis">{f.name}</span><span className="gl-muted">{size(f.size)}{f.source ? ` · ${f.source}` : ''}</span>
            </button>
          ))}
        </div>
      ) : null}
      <footer className="gl-foot">
        <button onClick={() => void api.glance.open('home')}>Open Keeper</button>
        <button onClick={() => void api.glance.open('settings:menubar')}>Settings</button>
        <button onClick={() => void api.glance.open('action:quit')}>Quit</button>
      </footer>
    </div>
  );
}
