// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Account & Pro, the Pro pill and the upgrade sheet. All of it exists
// only in builds with Keeper Pro switched on (core/pro-switch.ts): otherwise every
// component here draws nothing. Calm by design: nothing opens by itself, nothing
// interrupts, and the sheet opens only when the person asks for it.

import { useCallback, useEffect, useState } from 'react';
import type { ProStatus } from '../../core/api-pro';
import { PLAN_NAME, type Plan } from '../../core/entitlements';
import { proEnabled } from '../../core/pro-switch';
import type { PaidPlan } from '../../core/pro/license';
import type { Period } from '../../core/pro/payments';
import { errorText } from '../../core/ipc-error';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Modal } from './ui';
import '../styles/pro.css';

type On = Extract<ProStatus, { enabled: true }>;

/** Keeper Pro's status, and a way to refresh it. Null with Pro off (and nothing is asked). */
export function useProStatus(): [On | null, () => void] {
  const [s, setS] = useState<On | null>(null);
  const load = useCallback(() => {
    if (!proEnabled()) return;
    void api.pro.status().then((x) => setS(x.enabled ? x : null)).catch(() => setS(null));
  }, []);
  useEffect(() => {
    if (!proEnabled()) return;
    load();
    return api.on('pro-changed', load);
  }, [load]);
  return [s, load];
}

/** A small "Pro" or "Team" pill beside something that needs that plan. Nothing for free things, or with Pro off. */
export function ProPill({ plan }: { plan: Plan }) {
  if (!proEnabled() || plan === 'free') return null;
  return <span className="pro-pill" data-testid="pro-pill" title={`Part of Keeper ${PLAN_NAME[plan]}`}>{PLAN_NAME[plan]}</span>;
}

const dateText = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const PERIOD_NAME: Record<Period, string> = { month: 'Monthly', year: 'Yearly' };

/** What Pro adds and how to get it. Opens only when asked; closes with Esc. */
export function UpgradeSheet(p: { s: On; onClose: () => void }) {
  return proEnabled() ? <Sheet {...p} /> : null;
}

function Sheet({ s, onClose }: { s: On; onClose: () => void }) {
  const { toast } = useStore();
  const [pick, setPick] = useState(() => s.buy.find((b) => b.plan === 'pro' && b.period === 'year') ?? s.buy[0]);
  const go = () => pick && void api.pro.checkout(pick.plan, pick.period).then(() => { toast('Checkout opened in your browser'); onClose(); }, (e: unknown) => toast(errorText(e)));
  const plans = (['pro', 'team'] as PaidPlan[]).filter((p) => s.buy.some((b) => b.plan === p));
  const choices = plans.flatMap((p) => s.buy.filter((b) => b.plan === p));
  return (
    <Modal title="Keeper Pro" onClose={onClose} width={520}>
      <div className="pro-sheet" data-testid="pro-sheet">
        <p className="pro-promise"><Icon name="check" size={14} /> Everything Keeper does today stays free.</p>
        {plans.length ? (
          <div className="pro-choices" role="radiogroup" aria-label="Plan" onKeyDown={(e) => {
            // Arrow keys move the choice, as in any group of radio buttons.
            const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!step) return;
            e.preventDefault();
            const i = choices.findIndex((b) => b.plan === pick?.plan && b.period === pick?.period);
            const next = choices[(i + step + choices.length) % choices.length];
            setPick(next);
            (e.currentTarget.children[choices.indexOf(next)] as HTMLElement | undefined)?.focus();
          }}>
            {choices.map((b) => {
              const on = pick?.plan === b.plan && pick?.period === b.period;
              return (
                <button key={`${b.plan}-${b.period}`} role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={`pro-choice${on ? ' on' : ''}`} onClick={() => setPick(b)}>
                  <span className="pro-choice-plan">{PLAN_NAME[b.plan]}</span>
                  <span className="small muted">{PERIOD_NAME[b.period]}</span>
                </button>
              );
            })}
          </div>
        ) : <p className="small muted">Buying isn’t open right now.</p>}
        {/* Only what the chosen plan adds: Team says it includes Pro rather than listing it again. */}
        {pick?.plan === 'team' ? <div className="small muted">Everything in Pro, and:</div> : null}
        <ul className="pro-adds">
          {s.features.filter((f) => f.plan === (pick?.plan ?? 'pro')).map((f) => (
            <li key={f.id}><span className="pro-adds-name">{f.name}</span><div className="small muted">{f.about}</div></li>
          ))}
        </ul>
        <div className="pro-sheet-foot">
          <span className="small muted">Prices and tax are shown at checkout.</span>
          <button className="btn primary" data-testid="pro-checkout" disabled={!pick} onClick={go}>Continue in browser <Icon name="external" size={12} /></button>
        </div>
      </div>
    </Modal>
  );
}

/** Settings → Account & Pro → Your plan. */
export function ProAccountPanel() {
  return proEnabled() ? <Account /> : null;
}

function Account() {
  const { toast } = useStore();
  const [s, reload] = useProStatus();
  const [sheet, setSheet] = useState(false);
  const [more, setMore] = useState<'license' | 'restore' | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  if (!s) return null;
  const l = s.license;
  const run = (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    void fn().then((r) => { if (typeof r === 'string') toast(r); else if (done) toast(done); setText(''); setMore(null); setSure(false); reload(); }, (e: unknown) => toast(errorText(e))).finally(() => setBusy(false));
  };
  const line = l
    ? `${l.seats} ${l.plan === 'team' ? 'people' : 'computer'}${l.seats === 1 || l.plan === 'team' ? '' : 's'} · ${l.exp === null ? 'Never ends' : l.state === 'grace' ? `Ended ${dateText(l.exp)} · works until ${dateText(l.graceEndsAt!)}` : `Renews ${dateText(l.exp)}`}`
    : 'Everything Keeper does today is free, for good.';
  return (
    <div className="pro-account" data-testid="pro-account">
      <div className="pro-plan">
        <div className="pro-plan-icon" aria-hidden="true"><Icon name={s.plan === 'free' ? 'smile' : 'star'} size={18} /></div>
        <div className="grow">
          <div className="pro-plan-name" data-testid="pro-plan">Keeper {PLAN_NAME[s.plan]}</div>
          <div className="small muted">{line}</div>
          {s.problem ? <div className="small pro-problem" role="status">{s.problem}</div> : null}
        </div>
        {/* One main action: see Pro while on Free, manage the subscription once there is one. */}
        {s.plan === 'free' && s.offered && s.buy.length ? <button className="btn primary" data-testid="pro-see" onClick={() => setSheet(true)}>See Pro</button> : null}
        {s.plan !== 'free' && s.manage ? <button className="btn" data-testid="pro-manage" onClick={() => run(() => api.pro.manage())}>Manage subscription <Icon name="external" size={12} /></button> : null}
      </div>
      <div className="pro-links">
        {!l ? <button className="link-btn" aria-expanded={more === 'license'} data-testid="pro-enter" onClick={() => setMore(more === 'license' ? null : 'license')}>Enter a license</button> : null}
        {!l && s.edition === 'direct' ? <button className="link-btn" aria-expanded={more === 'restore'} data-testid="pro-restore" onClick={() => setMore(more === 'restore' ? null : 'restore')}>Restore purchase</button> : null}
        {l ? <button className="link-btn" data-testid="pro-remove" onClick={() => (sure ? run(() => api.pro.deactivate(), 'License removed from this computer') : setSure(true))}>{sure ? 'Remove it? Click again' : 'Use on another computer'}</button> : null}
      </div>
      {more === 'license' ? (
        <form className="pro-form" onSubmit={(e) => { e.preventDefault(); run(() => api.pro.activate(text), 'Keeper Pro is on. Thank you!'); }}>
          <input className="input grow" aria-label="License" placeholder="Paste the license from your e-mail" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <button className="btn" disabled={busy || !text.trim()} data-testid="pro-activate">Use license</button>
        </form>
      ) : null}
      {more === 'restore' ? (
        <form className="pro-form" onSubmit={(e) => { e.preventDefault(); run(() => api.pro.restore(text)); }}>
          <input className="input grow" type="email" aria-label="E-mail address" placeholder="The address you bought with" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <button className="btn" disabled={busy || !text.trim()}>Send it again</button>
        </form>
      ) : null}
      {sheet ? <UpgradeSheet s={s} onClose={() => setSheet(false)} /> : null}
    </div>
  );
}

/** Settings → Account & Pro → What Pro adds: the plan each needs, and that it is planned. */
export function ProCatalogPanel() {
  return proEnabled() ? <Catalog /> : null;
}

function Catalog() {
  const [s] = useProStatus();
  if (!s) return null;
  return (
    <ul className="pro-catalog" data-testid="pro-catalog">
      {s.features.map((f) => (
        <li key={f.id} className="pro-catalog-row">
          <div className="grow">
            <div className="pro-adds-name">{f.name} <ProPill plan={f.plan} /></div>
            <div className="small muted">{f.about}</div>
          </div>
          <span className="small muted">{f.has ? 'Included' : f.proposal ? 'Planned' : ''}</span>
        </li>
      ))}
    </ul>
  );
}
