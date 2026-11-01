// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The pop-over under the AI usage menu-bar item: Priority (what is running
// out, what is used up, unused allowance about to reset, or all clear) and
// All Metrics (every account and limit, grouped by service).

import { useEffect, useRef, useState } from 'react';
import { countdown, providerInfo } from '../../../core/usage-tracker/model';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { Badge, MetricRow, PriorityRow, useUsage } from './parts';

export function UsagePopover() {
  const { o, refresh, busy } = useUsage();
  const [tab, setTab] = useState<'priority' | 'all'>('priority');
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menu) setMenu(false);
      else void api.aiUsage.closePopover();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [menu]);
  useEffect(() => { if (menu) menuRef.current?.querySelector('button')?.focus(); }, [menu]);
  const open = (route?: string) => { void api.aiUsage.closePopover(); void api.aiUsage.openPage(route); };
  const now = Date.now();
  const s = o?.summary;
  const paused = !!o?.settings.paused;
  return (
    <div className="upop" data-testid="usage-popover">
      <header>
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={tab === 'priority'} className={tab === 'priority' ? 'on' : ''} onClick={() => setTab('priority')}>Priority</button>
          <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All Metrics</button>
        </div>
      </header>
      <div className="body">
        {!o ? null : !o.accounts.length ? (
          <div className="empty-note">
            <Icon name="chart" size={28} />
            <span>Add an AI account to see how much is left.</span>
            <button className="btn sm primary" onClick={() => open('accounts')}>Add an account…</button>
          </div>
        ) : tab === 'priority' ? (
          <div data-testid="usage-priority">
            {s!.runningOut.length ? <><h4>Running Out</h4>{s!.runningOut.map((i) => <PriorityRow key={`${i.accountId}:${i.limit.key}`} i={i} />)}</> : null}
            {s!.usedUp.length ? <><h4>Used Up</h4>{s!.usedUp.map((i) => <PriorityRow key={`${i.accountId}:${i.limit.key}`} i={i} />)}</> : null}
            {s!.allClear ? (
              <div className="clear" data-testid="usage-all-clear">
                <span className="check"><Icon name="check" size={24} /></span>
                <b>All Clear</b>
                <span className="muted">Nothing is running out.</span>
              </div>
            ) : null}
            {s!.expiring.length ? <><h4><Icon name="clock" size={12} />Use It Before It Resets</h4>{s!.expiring.map((i) => <PriorityRow key={`${i.accountId}:${i.limit.key}`} i={i} />)}</> : null}
          </div>
        ) : (
          <div data-testid="usage-all">
            {[...new Set(o.accounts.map((a) => a.provider))].map((p) => (
              <div key={p}>
                <h4>{providerInfo(p).label}</h4>
                {o.accounts.filter((a) => a.provider === p).map((a) => {
                  const st = o.states[a.id];
                  const color = a.color ?? providerInfo(a.provider).color;
                  const limits = (st?.limits ?? []).filter((l) => !a.limits || a.limits.includes(l.key));
                  return (
                    <div key={a.id} className="ugroup" data-testid="usage-account">
                      <div className="gh"><Badge a={a} /><b>{a.name}</b><span className="acc">{st?.accuracy ?? '…'}{providerInfo(a.provider).unofficial || (a.online && providerInfo(a.provider).optIn) ? ' · unofficial' : ''}</span></div>
                      {limits.map((l) => <MetricRow key={l.key} l={l} item={o.items.find((i) => i.accountId === a.id && i.limit.key === l.key)} points={o.recent[`${a.id}:${l.key}`] ?? []} color={color} />)}
                      {st?.message || (!limits.length && st) ? <div className="umsg">{st?.message ?? 'Nothing to show yet.'}</div> : null}
                      {!st ? <div className="umsg">Looking…</div> : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      <footer>
        <span className="grow" data-testid="usage-next">{paused ? 'Tracking paused' : busy ? 'Updating…' : o?.nextUpdateAt ? `Next update in ${countdown(Math.max(60_000, o.nextUpdateAt - now))}` : ''}</span>
        <button className="btn ghost icon sm" aria-label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>•••</button>
        {menu ? (
          <div className="menu" role="menu" ref={menuRef} onMouseLeave={() => setMenu(false)}>
            <button role="menuitem" onClick={() => { setMenu(false); void refresh(); }}><Icon name="refresh" size={13} />Refresh now</button>
            <button role="menuitem" onClick={() => open()}><Icon name="chart" size={13} />Open Usage page</button>
            <button role="menuitem" onClick={() => open('settings')}><Icon name="settings" size={13} />Settings…</button>
            <button role="menuitem" onClick={() => { setMenu(false); void api.aiUsage.setSettings({ paused: !paused }); }}><Icon name={paused ? 'play' : 'pause'} size={13} />{paused ? 'Resume tracking' : 'Pause tracking'}</button>
          </div>
        ) : null}
      </footer>
    </div>
  );
}
