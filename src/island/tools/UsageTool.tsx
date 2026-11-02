// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's AI usage tab: the usage tracker's accounts (Keeper → Usage),
// each by its own name with its limits as bars, the share left and the reset
// countdown, most urgent first. Several accounts of one service sit side by
// side. "+ Add account" opens Usage → Accounts → Add; with no accounts the
// choices are offered right here. The tracker reads; this only shows.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountView, UsageOverview } from '../../../core/api-ai-usage';
import { accountGlyph, amountText, countdown, providerInfo, type Limit, type ProviderId } from '../../../core/usage-tracker/model';
import type { PriorityItem, Urgency } from '../../../core/usage-tracker/priority';
import { api } from '../../api';
import '../../styles/island-usage.css';

const ORDER: Record<Urgency, number> = { 'running-out': 0, 'used-up': 1, expiring: 2, ok: 3 };

/** The choices offered when nothing is tracked yet (each opens the Add form with it chosen). */
const CHOICES: { provider: ProviderId; label: string; hint: string }[] = [
  { provider: 'claude-web', label: 'Claude (claude.ai)', hint: 'Pro, Max or Team: sign in, one account each' },
  { provider: 'chatgpt-web', label: 'ChatGPT', hint: 'Plus, Pro or Team, with Codex limits' },
  { provider: 'cc', label: 'Claude Code folder', hint: 'Session files on this computer' },
  { provider: 'codex', label: 'Codex folder', hint: 'Its own limit logs' },
  { provider: 'copilot', label: 'GitHub Copilot', hint: 'Premium requests' },
];

function useOverview(): [UsageOverview | null, () => void] {
  const [o, setO] = useState<UsageOverview | null>(null);
  const load = useCallback(() => void api.aiUsage.overview().then(setO).catch(() => undefined), []);
  useEffect(() => {
    load();
    const off = api.on('ai-usage' as never, () => load());
    // Countdowns tick while the tab is on screen; nothing runs in the background.
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000);
    return () => { off?.(); window.clearInterval(t); };
  }, [load]);
  return [o, load];
}

const tone = (i?: PriorityItem, left?: number) => (i?.urgency === 'used-up' || (left !== undefined && left <= 2) ? 'out' : i?.urgency === 'running-out' || (left !== undefined && left <= 30) ? 'low' : 'ok');

function LimitRow({ l, item, now }: { l: Limit; item?: PriorityItem; now: number }) {
  const left = item?.left ?? (l.usedPercent === undefined ? undefined : 100 - l.usedPercent);
  const used = left === undefined ? undefined : 100 - left;
  const reset = item?.limit.resetsAt ?? l.resetsAt;
  const amount = amountText(l);
  return (
    <div className={`iu-limit ${tone(item, left)}`} data-testid="island-usage-limit">
      <span className="iu-lab">{l.label}{l.estimated ? <i> · est.</i> : null}</span>
      {used !== undefined ? <span className="iu-bar" role="meter" aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={100} aria-label={`${l.label}: ${Math.round(used)}% used`}><i style={{ width: `${Math.max(2, Math.min(100, used))}%` }} /></span> : <span className="iu-amt">{amount}</span>}
      <span className="iu-num">{left !== undefined ? (item?.urgency === 'used-up' ? 'Used up' : `${Math.round(left)}% left`) : ''}</span>
      <span className="iu-reset">{reset ? `${l.key === 'renewal' ? 'renews' : 'resets'} in ${countdown(reset - now)}` : ''}</span>
    </div>
  );
}

function AccountCard({ a, o, glyph, now, reload }: { a: AccountView; o: UsageOverview; glyph: string; now: number; reload: () => void }) {
  const st = o.states[a.id];
  const info = providerInfo(a.provider);
  const [busy, setBusy] = useState(false);
  const items = o.items.filter((i) => i.accountId === a.id);
  const limits = (st?.limits ?? []).filter((l) => !a.limits || a.limits.includes(l.key));
  const itemOf = (l: Limit) => items.find((i) => i.limit.key === l.key);
  // Most urgent first, then the least left.
  const sorted = [...limits].sort((x, y) => ORDER[itemOf(x)?.urgency ?? 'ok'] - ORDER[itemOf(y)?.urgency ?? 'ok'] || (itemOf(x)?.left ?? 101) - (itemOf(y)?.left ?? 101));
  const optInOff = info.optIn && !a.online && (info.unofficial || info.kind === 'web');
  const signIn = () => { setBusy(true); void api.aiUsage.signIn({ id: a.id }).finally(() => { setBusy(false); reload(); }); };
  const allow = () => { const { hasKey: _h, statusLineOn: _s, ...rest } = a; void api.aiUsage.saveAccount({ ...rest, online: true }).then(reload); };
  return (
    <div className="tile iu-acct" data-testid="island-usage-account" data-account={a.id}>
      <div className="iu-head">
        <span className="iu-badge" style={{ background: a.color ?? info.color }}>{glyph}</span>
        <b className="iu-name">{a.name}</b>
        <span className="muted small iu-what">{info.label}{st?.plan ? ` · ${st.plan}` : ''}{st?.accuracy === 'estimated' ? ' · estimated' : ''}</span>
      </div>
      {sorted.map((l) => <LimitRow key={l.key} l={l} item={itemOf(l)} now={now} />)}
      {st?.message ? <div className="muted small">{st.message}</div> : null}
      {st?.needsSignIn ? <button className="btn sm primary" disabled={busy} onClick={signIn} data-testid="island-usage-signin">{busy ? 'Waiting for the sign-in…' : a.signedIn ? 'Sign in again' : 'Sign in'}</button> : null}
      {!st?.needsSignIn && optInOff ? (
        <div className="iu-optin small">
          <span className="muted">{info.optIn!.explain}</span>
          <button className="btn sm" onClick={allow}>{info.optIn!.label}</button>
        </div>
      ) : null}
      {!st ? <div className="muted small">Looking…</div> : null}
    </div>
  );
}

export function UsageTool() {
  const [o, reload] = useOverview();
  const now = Date.now();
  const add = (provider?: ProviderId) => void api.aiUsage.openPage(provider ? `add:${provider}` : 'add');
  const ordered = useMemo(() => {
    if (!o) return [];
    // Accounts with the most urgent limit first; then the order chosen on the Usage page.
    const rank = (a: AccountView) => { const i = o.items.findIndex((x) => x.accountId === a.id && x.urgency !== 'ok'); return i < 0 ? Infinity : i; };
    return o.accounts.filter((a) => !a.paused).map((a, n) => ({ a, n })).sort((x, y) => rank(x.a) - rank(y.a) || x.n - y.n).map((x) => x.a);
  }, [o]);
  if (!o) return <div className="muted">Looking…</div>;
  if (!o.on) return <div className="itool iu"><div className="muted small">AI usage tracking is switched off (Settings → Features).</div></div>;
  if (!o.accounts.length) {
    return (
      <div className="itool iu" data-testid="island-usage-empty">
        <div className="small">Track what is left of each AI account: sign in to as many Claude or ChatGPT accounts as you use, each kept apart, or add a tool on this computer.</div>
        <div className="iu-choices">
          {CHOICES.map((c) => (
            <button key={c.provider} className="iu-choice" onClick={() => add(c.provider)} data-testid="island-usage-choice">
              <span className="iu-badge" style={{ background: providerInfo(c.provider).color }}>{providerInfo(c.provider).glyph}</span>
              <span><b>{c.label}</b><span className="muted small">{c.hint}</span></span>
            </button>
          ))}
        </div>
        <button className="btn sm ghost" onClick={() => add()}>More services…</button>
      </div>
    );
  }
  const s = o.summary;
  return (
    <div className="itool iu" data-testid="island-usage">
      <div className="iu-top small">
        <span className={`iu-state ${s.usedUp.length ? 'out' : s.runningOut.length ? 'low' : 'ok'}`}>{s.usedUp.length ? `${s.usedUp.length} used up` : s.runningOut.length ? `${s.runningOut.length} running out` : 'All clear'}</span>
        <span className="grow" />
        <button className="btn sm ghost" onClick={() => void api.aiUsage.openPage()}>Open Usage</button>
        <button className="btn sm" onClick={() => add()} data-testid="island-usage-add">+ Add account</button>
      </div>
      {ordered.map((a) => <AccountCard key={a.id} a={a} o={o} glyph={accountGlyph(a, o.accounts)} now={now} reload={reload} />)}
    </div>
  );
}
