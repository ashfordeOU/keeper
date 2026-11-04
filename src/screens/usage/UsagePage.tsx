// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Usage page: every AI account and subscription, what is left and when
// it resets, history charts, costs per month, CSV export, adding and
// arranging accounts, and the tracker's settings.

import { useEffect, useMemo, useState } from 'react';
import type { AccountInput, AccountView, DetectedAccount } from '../../../core/api-ai-usage';
import { money, PROVIDERS, providerInfo, UNOFFICIAL, type Account, type Cycle, type ProviderId } from '../../../core/usage-tracker/model';
import type { HistoryPoint } from '../../../core/usage-tracker/priority';
import type { ReceiptGuess } from '../../../core/usage-tracker/subscriptions';
import { api } from '../../api';
import { Chart } from '../../components/Chart';
import { Icon } from '../../components/Icon';
import { Empty, Modal, PageHead, Toggle } from '../../components/ui';
import { useStore } from '../../state';
import { Badge, MetricRow, PriorityRow, useUsage } from './parts';
import { UsageSettings } from './UsageSettings';
import { Tabs } from '../../components/Tabs';

type Tab = 'overview' | 'accounts' | 'subscriptions' | 'costs' | 'history' | 'settings';
const TABS: [Tab, string][] = [['overview', 'Overview'], ['accounts', 'Accounts'], ['subscriptions', 'Subscriptions'], ['costs', 'Costs'], ['history', 'History'], ['settings', 'Settings']];

/** `add` or `add:<service>` (from the Island's "+ Add account"): the Accounts tab with the editor open. */
function addFrom(initial?: string): Partial<AccountInput> | null {
  const m = /^add(?::([\w-]+))?$/.exec(initial ?? '');
  if (!m) return null;
  const provider = PROVIDERS.some((p) => p.id === m[1]) ? (m[1] as ProviderId) : 'claude-web';
  return { provider, name: '' };
}

export function UsagePage({ initial }: { initial?: string }) {
  const { o, reload, refresh, busy } = useUsage();
  const [tab, setTab] = useState<Tab>(addFrom(initial) ? 'accounts' : (TABS.find((t) => t[0] === initial)?.[0]) ?? 'overview');
  const [edit, setEdit] = useState<Partial<AccountInput> | null>(() => addFrom(initial));
  const store = useStore();
  if (!o) return <div className="page usage-page"><PageHead title="AI Usage" /></div>;
  return (
    <div className="page usage-page" data-testid="usage-page">
      <PageHead title="AI Usage" sub="What is left of your AI accounts’ limits, credits and budgets, and what your subscriptions cost.">
        <button className="btn sm" disabled={busy} onClick={() => void refresh()}><Icon name="refresh" size={14} />{busy ? 'Looking…' : 'Refresh'}</button>
        <button className="btn sm" onClick={() => void api.aiUsage.exportCsv().then((r) => r.path && store.toast(`Saved ${r.rows} rows to ${r.path}`))}><Icon name="down" size={14} />Export CSV</button>
        {/* The page's one filled button; while there are no accounts, the empty state has it. */}
        <button className={`btn sm ${o.accounts.length ? 'primary' : ''}`} onClick={() => setEdit({ provider: 'claude-web', name: '' })}><Icon name="plus" size={14} />Add account</button>
      </PageHead>
      <Tabs label="AI Usage" value={tab} onChange={setTab} items={TABS.map(([id, label]) => ({ id, label }))} />
      {tab === 'overview' ? <Overview o={o} onAdd={() => setTab('accounts')} /> : null}
      {tab === 'accounts' ? <Accounts o={o} onEdit={setEdit} reload={reload} /> : null}
      {tab === 'subscriptions' ? <Subscriptions o={o} onEdit={setEdit} /> : null}
      {tab === 'costs' ? <Costs o={o} /> : null}
      {tab === 'history' ? <History o={o} /> : null}
      {tab === 'settings' ? <UsageSettings /> : null}
      {edit ? <AccountEditor init={edit} o={o} onClose={() => { setEdit(null); reload(); }} /> : null}
    </div>
  );
}

type O = NonNullable<ReturnType<typeof useUsage>['o']>;

function Overview({ o, onAdd }: { o: O; onAdd: () => void }) {
  if (!o.accounts.length) {
    return <Empty icon="chart" title="No AI accounts yet"><p className="muted">Sign in to an AI subscription, a coding tool or a service key. Nothing is read until you do.</p><button className="btn primary" onClick={onAdd}>Add an account</button></Empty>;
  }
  const s = o.summary;
  return (
    <div className="grid2">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Priority</h3>
        {s.runningOut.length ? <><div className="small muted">Running out</div>{s.runningOut.map((i) => <PriorityRow key={`${i.accountId}:${i.limit.key}`} i={i} />)}</> : null}
        {s.usedUp.length ? <><div className="small muted" style={{ marginTop: 8 }}>Used up</div>{s.usedUp.map((i) => <PriorityRow key={`${i.accountId}:${i.limit.key}`} i={i} />)}</> : null}
        {s.allClear ? <div className="row" style={{ gap: 8, padding: '8px 0' }}><Icon name="check" size={18} style={{ color: 'var(--ok)' }} /> <b>All clear.</b> <span className="muted">Nothing is running out.</span></div> : null}
        {s.expiring.length ? <><div className="small muted" style={{ marginTop: 8 }}>Use it before it resets</div>{s.expiring.map((i) => <PriorityRow key={`${i.accountId}:${i.limit.key}`} i={i} />)}</> : null}
      </div>
      {o.accounts.map((a) => {
        const st = o.states[a.id];
        const color = a.color ?? providerInfo(a.provider).color;
        return (
          <div className="card" key={a.id} data-testid="usage-account-card">
            <div className="row" style={{ gap: 8, marginBottom: 6 }}><Badge a={a} /><b className="grow">{a.name}</b><span className="small muted">{providerInfo(a.provider).label}{st?.plan ? ` · ${st.plan}` : ''} · {st?.accuracy ?? '…'}{providerInfo(a.provider).unofficial || (a.online && providerInfo(a.provider).optIn) ? ' · unofficial' : ''}</span></div>
            {(st?.limits ?? []).filter((l) => !a.limits || a.limits.includes(l.key)).map((l) => <MetricRow key={l.key} l={l} item={o.items.find((i) => i.accountId === a.id && i.limit.key === l.key)} points={o.recent[`${a.id}:${l.key}`] ?? []} color={color} />)}
            {st?.message ? <div className="umsg">{st.message}</div> : null}
            {st?.needsSignIn ? <SignInButton a={a} again={!!a.signedIn} /> : null}
            {st?.source ? <div className="small muted" style={{ marginTop: 6 }}>Source: {st.source}.</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function Accounts({ o, onEdit, reload }: { o: O; onEdit: (a: Partial<AccountInput>) => void; reload: () => void }) {
  const [found, setFound] = useState<DetectedAccount[] | null>(null);
  useEffect(() => void api.aiUsage.detect().then(setFound).catch(() => setFound([])), [o.accounts.length]);
  const move = (i: number, d: number) => {
    const ids = o.accounts.map((a) => a.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void api.aiUsage.reorder(ids).then(reload);
  };
  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        {!o.accounts.length ? <Empty icon="chart" title="No AI accounts yet" action={<button className="btn primary" onClick={() => onEdit({ provider: 'claude-web', name: '' })}>Add an account</button>}>Nothing is read until you add one.</Empty> : o.accounts.map((a, i) => (
          <div className="acc-row" key={a.id} data-testid="usage-account-row">
            <span className="handle">
              <button className="btn ghost icon sm" aria-label={`Move ${a.name} up`} disabled={!i} onClick={() => move(i, -1)}><Icon name="chevronDown" size={12} style={{ transform: 'rotate(180deg)' }} /></button>
              <button className="btn ghost icon sm" aria-label={`Move ${a.name} down`} disabled={i === o.accounts.length - 1} onClick={() => move(i, 1)}><Icon name="chevronDown" size={12} /></button>
            </span>
            <Badge a={a} />
            <div className="meta"><b>{a.name}{a.paused ? <span className="muted"> · paused</span> : null}{a.hideInMenuBar ? <span className="muted"> · not in the glance</span> : null}</b><span>{providerInfo(a.provider).label}{a.configDir ? ` · ${a.configDir}` : ''}{a.hasKey ? ' · key in keychain' : ''}{providerInfo(a.provider).kind === 'web' ? ` · ${signedInText(a)}` : ''}</span></div>
            <span className="row" style={{ gap: 6 }}>
              {providerInfo(a.provider).kind === 'web' && (!a.signedIn || a.signedIn.expired) ? <SignInButton a={a} again={!!a.signedIn} small /> : null}
              <button className="btn sm" onClick={() => onEdit(a)}>Edit</button>
              <button className="btn sm ghost" onClick={() => { if (confirm(providerInfo(a.provider).kind === 'web' ? `Stop tracking ${a.name}? Its history is removed and Keeper signs it out here, wiping its cookies and storage.` : `Stop tracking ${a.name}? Its history and key are removed.`)) void api.aiUsage.removeAccount(a.id).then(reload); }}>Remove</button>
            </span>
          </div>
        ))}
      </div>
      {found?.some((f) => !f.added) ? (
        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Found on this computer</h3>
          {found.filter((f) => !f.added).map((f) => (
            <div key={`${f.provider}:${f.configDir}`} className="row" style={{ gap: 8, padding: '6px 0' }}>
              <Badge a={{ provider: f.provider }} /><span className="grow">{f.name} <span className="muted small">{f.configDir}</span></span>
              <button className="btn sm" onClick={() => onEdit({ provider: f.provider, name: f.name, configDir: f.configDir })}>Add…</button>
            </div>
          ))}
        </div>
      ) : null}
      {o.keysInMemory ? <p className="small muted">This system has no keychain Keeper can use, so keys are kept only until Keeper quits.</p> : null}
    </>
  );
}

function Subscriptions({ o, onEdit }: { o: O; onEdit: (a: Partial<AccountInput>) => void }) {
  const subs = o.accounts.filter((a) => a.subscription);
  const [receipts, setReceipts] = useState<ReceiptGuess[] | null>(null);
  return (
    <>
      <div className="totals" style={{ marginBottom: 12 }}>
        {Object.entries(o.subscriptions.monthly).map(([cur, v]) => <div className="tile" key={cur} data-testid="usage-monthly-total"><b>{money(v, cur)}</b><span>a month ({cur})</span></div>)}
        {!Object.keys(o.subscriptions.monthly).length ? <div className="tile"><b>—</b><span>a month</span></div> : null}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Subscription</th><th>Price</th><th>Next renewal</th><th>Allowance</th><th /></tr></thead>
          <tbody>
            {subs.map((a) => {
              const s = a.subscription!;
              const st = o.states[a.id];
              const renew = st?.limits.find((l) => l.key === 'renewal');
              const quota = st?.limits.find((l) => l.key === 'quota');
              return (
                <tr key={a.id} data-testid="usage-sub-row">
                  <td><span className="row" style={{ gap: 6 }}><Badge a={a} />{a.name}</span>{s.trialEnds ? <div className="small muted">Trial until {s.trialEnds}</div> : null}</td>
                  <td>{money(s.cost, s.currency)} / {s.cycle.replace('ly', '').replace('dai', 'day')}</td>
                  <td>{renew?.resetsAt ? new Date(renew.resetsAt).toLocaleDateString() : s.renews}</td>
                  <td>{quota ? `${quota.used} / ${quota.limit} ${s.quota?.unit}` : '—'}</td>
                  <td><button className="btn sm" onClick={() => onEdit(a)}>Edit</button></td>
                </tr>
              );
            })}
            {!subs.length ? <tr><td colSpan={5} className="muted">No subscriptions yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={() => onEdit({ provider: 'subscription', name: '', subscription: { cost: 20, currency: 'USD', cycle: 'monthly', renews: new Date().toISOString().slice(0, 10), remindDays: 3 } })}><Icon name="plus" size={14} />Add a subscription</button>
        <button className="btn" onClick={() => void api.aiUsage.scanReceipts().then(setReceipts)}><Icon name="mail" size={14} />Look for receipts in Mail</button>
      </div>
      {receipts ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>Only the sender, subject and preview are read; nothing is marked read or kept.</div>
          {!receipts.length ? <span className="muted">No receipts from AI services found (Mail needs an account set up).</span> : receipts.map((r) => (
            <div key={r.messageId} className="row" style={{ gap: 8, padding: '4px 0' }}>
              <span className="grow">{r.vendor} · {money(r.amount, r.currency)} · {new Date(r.date).toLocaleDateString()}</span>
              <button className="btn sm" onClick={() => onEdit({ provider: 'subscription', name: r.vendor, subscription: { cost: r.amount, currency: r.currency, cycle: r.cycle ?? 'monthly', renews: new Date(r.date).toISOString().slice(0, 10), remindDays: 3 } })}>Add…</button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

const monthsBack = (n: number) => {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (n - 1 - i), 1)).toISOString().slice(0, 7));
};

function Costs({ o }: { o: O }) {
  const months = monthsBack(12);
  const withCost = o.accounts.filter((a) => o.costs[a.id] && Object.keys(o.costs[a.id]).length);
  const total = (m: string) => withCost.reduce((n, a) => n + (o.costs[a.id][m] ?? 0), 0);
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Costs per month (US dollars)</h3>
      {!withCost.length ? <p className="muted">Costs appear once a service account with a cost report, Keeper’s own calls or a subscription has been read.</p> : (
        <>
          <div className="chart-wrap"><Chart labels={months} series={withCost.map((a) => ({ label: a.name, color: a.color ?? providerInfo(a.provider).color, bars: true, values: months.map((m) => o.costs[a.id][m] ?? null), format: (v: number) => money(v) }))} height={180} yFormat={(v) => money(v)} /></div>
          <table style={{ marginTop: 12 }} data-testid="usage-costs">
            <thead><tr><th>Month</th>{withCost.map((a) => <th key={a.id}>{a.name}</th>)}<th>Total</th></tr></thead>
            <tbody>{months.filter((m) => total(m) > 0).reverse().map((m) => <tr key={m}><td>{m}</td>{withCost.map((a) => <td key={a.id}>{o.costs[a.id][m] !== undefined ? money(o.costs[a.id][m]) : ''}</td>)}<td><b>{money(total(m))}</b></td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

function History({ o }: { o: O }) {
  const [days, setDays] = useState(30);
  const [h, setH] = useState<Record<string, HistoryPoint[]>>({});
  useEffect(() => void api.aiUsage.history(days).then(setH).catch(() => undefined), [days, o]);
  const labels = useMemo(() => Array.from({ length: days }, (_, i) => new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(5, 10)), [days]);
  const perDay = (pts: HistoryPoint[], key: 'p' | 'u') => labels.map((_, i) => {
    const start = new Date(Date.now() - (days - 1 - i) * 86_400_000).setHours(0, 0, 0, 0);
    const vals = pts.filter((p) => p.t >= start && p.t < start + 86_400_000 && p[key] !== undefined).map((p) => p[key]!);
    return vals.length ? Math.max(...vals) : null;
  });
  return (
    <>
      <div className="seg" style={{ marginBottom: 12 }}>{[7, 30, 90].map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d} days</button>)}</div>
      <div className="grid2">
        {o.accounts.map((a) => {
          const keys = Object.keys(h).filter((k) => k.startsWith(`${a.id}:`));
          const limits = o.states[a.id]?.limits ?? [];
          const pct = keys.filter((k) => h[k].some((p) => p.p !== undefined));
          if (!keys.length) return null;
          const palette = ['var(--accent)', 'var(--c-video)', 'var(--c-audio)', 'var(--ok)', 'var(--danger)'];
          return (
            <div className="card" key={a.id} data-testid="usage-history-card">
              <div className="row" style={{ gap: 8, marginBottom: 6 }}><Badge a={a} /><b>{a.name}</b></div>
              {pct.length ? <Chart labels={labels} max={100} min={0} yFormat={(v) => `${Math.round(v)}%`} series={pct.map((k, i) => ({ label: `${limits.find((l) => `${a.id}:${l.key}` === k)?.label ?? k.split(':').slice(1).join(':')} (% used)`, color: palette[i % palette.length], values: perDay(h[k], 'p') }))} />
                : <Chart labels={labels} series={keys.slice(0, 3).map((k, i) => ({ label: limits.find((l) => `${a.id}:${l.key}` === k)?.label ?? k, color: palette[i % palette.length], values: perDay(h[k], 'u') }))} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- web sign-ins

const signedInText = (a: Pick<Account, 'signedIn'>) => (!a.signedIn ? 'not signed in' : a.signedIn.expired ? 'signed out' : `signed in${a.signedIn.email ? ` as ${a.signedIn.email}` : ''}`);

/** "Sign in" / "Sign in again": the provider's own sign-in page in a window of its own. */
function SignInButton({ a, again, small }: { a: AccountView; again: boolean; small?: boolean }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  return (
    <button className={`btn ${small ? 'sm' : 'sm primary'}`} style={small ? undefined : { marginTop: 6 }} disabled={busy} data-testid="usage-signin-again" onClick={() => {
      setBusy(true);
      void api.aiUsage.signIn({ id: a.id }).then((r) => store.toast(r.message)).finally(() => setBusy(false));
    }}>{busy ? 'Waiting for the sign-in…' : again ? 'Sign in again' : 'Sign in'}</button>
  );
}

const KIND_GROUPS: [string, string][] = [['web', 'Sign in on the web'], ['local', 'On this computer'], ['api', 'With a key'], ['manual', 'Kept by hand']];

// ---------------------------------------------------------------- adding and editing an account

const SWATCHES = ['#d97757', '#10a37f', '#4285f4', '#7c6cf0', '#f59e0b', '#e5484d', '#2fb380', '#64748b', '#ec4899'];

function AccountEditor({ init, o, onClose }: { init: Partial<AccountInput>; o: O; onClose: () => void }) {
  const [a, setA] = useState<Partial<AccountView>>({ ...init });
  const [key, setKey] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const info = providerInfo((a.provider ?? 'cc') as ProviderId);
  const has = (f: (typeof info.fields)[number]) => info.fields.includes(f);
  const set = (p: Partial<Account>) => setA((x) => ({ ...x, ...p }));
  const st = a.id ? o.states[a.id] : undefined;
  const web = info.kind === 'web';
  const site = info.id === 'claude-web' ? 'claude.ai' : 'chatgpt.com';
  /** Web accounts: sign in (adding the account first when it is new). */
  const signIn = async () => {
    setBusy(true);
    setMsg('Sign in in the window that opened. Keeper waits here.');
    try {
      const { hasKey: _h, statusLineOn: _s, ...rest } = a as AccountView;
      const r = await api.aiUsage.signIn(a.id ? { id: a.id } : ({ ...rest, provider: info.id, name: (a.name ?? '').trim() } as AccountInput));
      if (r.ok && a.id) {
        // Keep what was changed in the form too.
        await api.aiUsage.saveAccount({ ...rest, provider: info.id, name: (a.name ?? '').trim() || (r.accounts.find((x) => x.id === a.id)?.name ?? info.label) } as AccountInput);
      }
      if (r.ok) onClose();
      else setMsg(r.message);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const { hasKey: _h, statusLineOn: _s, ...rest } = a as AccountView;
      await api.aiUsage.saveAccount({ ...rest, provider: info.id, name: (a.name ?? '').trim() || info.label } as AccountInput, key);
      onClose();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const sub = a.subscription ?? { cost: 0, currency: 'USD', cycle: 'monthly' as Cycle, renews: new Date().toISOString().slice(0, 10), remindDays: 3 };
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  return (
    <Modal title={a.id ? `Edit ${a.name}` : 'Add an account'} onClose={onClose} width={560}>
      <div className="uform" data-testid="usage-editor">
        <label htmlFor="ue-provider">Service</label>
        <select id="ue-provider" className="input" value={info.id} disabled={!!a.id} onChange={(e) => set({ provider: e.target.value as ProviderId })}>
          {KIND_GROUPS.map(([kind, label]) => (
            <optgroup key={kind} label={label}>
              {PROVIDERS.filter((p) => p.kind === kind).map((p) => <option key={p.id} value={p.id}>{p.label}{p.unofficial ? ` (${UNOFFICIAL.toLowerCase()})` : ''}</option>)}
            </optgroup>
          ))}
        </select>
        <span className="hint">{info.how} <b>{info.accuracy === 'exact' ? 'Exact.' : info.accuracy === 'estimated' ? 'Estimated.' : 'Kept by hand.'}</b></span>
        <label htmlFor="ue-name">Name</label>
        <input id="ue-name" className="input" placeholder={info.id === 'cc' ? 'Work, Personal…' : info.id === 'claude-web' ? 'Claude — Work' : info.id === 'chatgpt-web' ? 'ChatGPT — Personal' : info.label} value={a.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
        {web ? <span className="hint">Left empty, it takes the email you sign in with.</span> : null}
        <label>Colour</label>
        <div className="uswatches">{SWATCHES.map((c) => <button key={c} aria-label={`Colour ${c}`} className={a.color === c ? 'on' : ''} style={{ background: c }} onClick={() => set({ color: c })} />)}<button aria-label="Default colour" className={!a.color ? 'on' : ''} style={{ background: info.color, opacity: .5 }} onClick={() => set({ color: undefined })} /></div>
        <label htmlFor="ue-icon">Badge</label>
        <input id="ue-icon" className="input" maxLength={2} style={{ width: 70 }} placeholder={info.glyph} value={a.icon ?? ''} onChange={(e) => set({ icon: e.target.value || undefined })} />
        {has('signIn') ? <>
          <label>Sign-in</label>
          <span className="col" style={{ gap: 4 }} data-testid="usage-signin">
            <span className="row" style={{ gap: 8 }}>
              <span className="grow small">{a.id ? signedInText(a) : 'Not signed in yet'}</span>
              <button className="btn sm" disabled={busy} onClick={() => void signIn()} data-testid="usage-signin-button">{a.signedIn && !a.signedIn.expired ? 'Sign in again' : a.id ? 'Sign in…' : `Add and sign in to ${site}…`}</button>
            </span>
            <span className="small muted" data-testid="usage-signin-explain">Opens {site}’s own sign-in page in a window of its own. Keeper never sees your password; the sign-in is kept only in this account’s own storage, apart from every other account, and is wiped when you remove the account.</span>
          </span>
          {st?.orgs && st.orgs.length > 1 ? <>
            <label htmlFor="ue-org">Organization</label>
            <select id="ue-org" className="input" value={a.orgId ?? ''} onChange={(e) => set({ orgId: e.target.value || undefined })}>
              <option value="">The paid one (automatic)</option>
              {st.orgs.map((x) => <option key={x.id} value={x.id}>{x.name}{x.plan ? ` (${x.plan})` : ''}</option>)}
            </select>
          </> : null}
        </> : null}
        {has('configDir') ? <>
          <label htmlFor="ue-dir">Config folder</label>
          <input id="ue-dir" className="input" placeholder={info.defaultDir ? `~/${info.defaultDir}` : 'The usual folder'} value={a.configDir ?? ''} onChange={(e) => set({ configDir: e.target.value || undefined })} />
          <span className="hint">One account per folder{info.dirEnv ? ` (what ${info.dirEnv} points to)` : ''}. Empty means the usual one.</span>
        </> : null}
        {has('key') ? <>
          <label htmlFor="ue-key">{info.keyLabel ?? 'Key'}</label>
          <input id="ue-key" className="input" type="password" autoComplete="off" placeholder={a.hasKey ? 'Kept in the keychain (type to replace)' : ''} value={key ?? ''} onChange={(e) => setKey(e.target.value)} />
          <span className="hint">Stored in the system keychain and sent only to {info.id === 'http' ? 'the address below' : info.label}.</span>
        </> : null}
        {has('teamId') ? <><label htmlFor="ue-team">Team id</label><input id="ue-team" className="input" value={a.teamId ?? ''} onChange={(e) => set({ teamId: e.target.value || undefined })} /></> : null}
        {has('plan') && info.id === 'cc' ? <>
          <label htmlFor="ue-5h">5-hour limit (tokens)</label>
          <input id="ue-5h" className="input" type="number" placeholder="unknown" value={a.plan?.fiveHourTokens ?? ''} onChange={(e) => set({ plan: { ...a.plan, fiveHourTokens: num(e.target.value) } })} />
          <label htmlFor="ue-wk">Weekly limit (tokens)</label>
          <input id="ue-wk" className="input" type="number" placeholder="unknown" value={a.plan?.weeklyTokens ?? ''} onChange={(e) => set({ plan: { ...a.plan, weeklyTokens: num(e.target.value) } })} />
          <span className="hint">The plans do not publish token numbers; what you enter is used for estimates only when nothing exact is known.</span>
        </> : null}
        {has('plan') && info.id !== 'cc' ? <><label htmlFor="ue-daily">Requests a day</label><input id="ue-daily" className="input" type="number" value={a.plan?.dailyRequests ?? ''} onChange={(e) => set({ plan: { ...a.plan, dailyRequests: num(e.target.value) } })} /></> : null}
        {has('budget') ? <><label htmlFor="ue-budget">{info.id === 'deepseek' || info.id === 'xai' ? 'Amount topped up ($)' : 'Monthly budget ($)'}</label><input id="ue-budget" className="input" type="number" value={a.budget ?? ''} onChange={(e) => set({ budget: num(e.target.value) })} /></> : null}
        {has('http') ? <>
          <label htmlFor="ue-url">Address (JSON)</label><input id="ue-url" className="input" placeholder="https://…" value={a.http?.url ?? ''} onChange={(e) => set({ http: { ...(a.http ?? { used: '' }), url: e.target.value } })} />
          <label htmlFor="ue-used">Used field</label><input id="ue-used" className="input" placeholder="$.data.used" value={a.http?.used ?? ''} onChange={(e) => set({ http: { ...(a.http ?? { url: '' }), used: e.target.value } })} />
          <label htmlFor="ue-limit">Limit field</label><input id="ue-limit" className="input" placeholder="$.data.limit" value={a.http?.limit ?? ''} onChange={(e) => set({ http: { ...(a.http ?? { url: '', used: '' }), limit: e.target.value || undefined } })} />
          <label htmlFor="ue-reset">Reset field</label><input id="ue-reset" className="input" placeholder="$.data.resets_at" value={a.http?.reset ?? ''} onChange={(e) => set({ http: { ...(a.http ?? { url: '', used: '' }), reset: e.target.value || undefined } })} />
          <label htmlFor="ue-hl">Limit name</label><input id="ue-hl" className="input" placeholder="Monthly requests" value={a.http?.label ?? ''} onChange={(e) => set({ http: { ...(a.http ?? { url: '', used: '' }), label: e.target.value || undefined } })} />
        </> : null}
        {has('subscription') ? <>
          <label htmlFor="ue-cost">Price</label>
          <span className="row" style={{ gap: 6 }}>
            <input id="ue-cost" className="input" type="number" style={{ width: 100 }} value={sub.cost} onChange={(e) => set({ subscription: { ...sub, cost: Number(e.target.value) || 0 } })} />
            <input className="input" aria-label="Currency" style={{ width: 70 }} value={sub.currency} onChange={(e) => set({ subscription: { ...sub, currency: e.target.value.toUpperCase().slice(0, 3) } })} />
            <select className="input" aria-label="Billing cycle" value={sub.cycle} onChange={(e) => set({ subscription: { ...sub, cycle: e.target.value as Cycle } })}>{['weekly', 'monthly', 'quarterly', 'yearly'].map((c) => <option key={c}>{c}</option>)}</select>
          </span>
          <label htmlFor="ue-renew">Renews on</label><input id="ue-renew" className="input" type="date" value={sub.renews} onChange={(e) => set({ subscription: { ...sub, renews: e.target.value } })} />
          <label htmlFor="ue-trial">Trial ends</label><input id="ue-trial" className="input" type="date" value={sub.trialEnds ?? ''} onChange={(e) => set({ subscription: { ...sub, trialEnds: e.target.value || undefined } })} />
          <label htmlFor="ue-remind">Remind me</label><span><input id="ue-remind" className="input" type="number" min={0} max={30} style={{ width: 70 }} value={sub.remindDays} onChange={(e) => set({ subscription: { ...sub, remindDays: Number(e.target.value) || 0 } })} /> days before</span>
          <label htmlFor="ue-quota">Allowance</label>
          <span className="row" style={{ gap: 6 }}>
            <input id="ue-quota" className="input" type="number" placeholder="500" style={{ width: 90 }} value={sub.quota?.amount ?? ''} onChange={(e) => set({ subscription: { ...sub, quota: e.target.value ? { used: 0, unit: 'requests', period: 'month', ...sub.quota, amount: Number(e.target.value) } : undefined } })} />
            <input className="input" aria-label="Unit" placeholder="requests" style={{ width: 100 }} value={sub.quota?.unit ?? ''} disabled={!sub.quota} onChange={(e) => sub.quota && set({ subscription: { ...sub, quota: { ...sub.quota, unit: e.target.value } } })} />
            <select className="input" aria-label="Per" value={sub.quota?.period ?? 'month'} disabled={!sub.quota} onChange={(e) => sub.quota && set({ subscription: { ...sub, quota: { ...sub.quota, period: e.target.value as 'month' } } })}><option value="day">a day</option><option value="week">a week</option><option value="month">a month</option></select>
          </span>
          {sub.quota ? <><label htmlFor="ue-used-q">Used so far</label><input id="ue-used-q" className="input" type="number" style={{ width: 100 }} value={sub.quota.used} onChange={(e) => set({ subscription: { ...sub, quota: { ...sub.quota!, used: Number(e.target.value) || 0 } } })} /></> : null}
        </> : null}
        {info.id === 'cc' ? <>
          <label>Status line</label>
          <span className="col" style={{ gap: 2 }}>
            <span className="row" style={{ gap: 8 }}><Toggle label="Read the limits from its status line" on={!!a.statusLine} disabled={!a.id} onChange={(v) => a.id && void api.aiUsage.setStatusLine(a.id, v).then((r) => { setMsg(r.message); if (r.ok) set({ statusLine: v }); })} /> <span className="small">Read the exact 5-hour and weekly limits from its status line{a.id ? '' : ' (after adding)'}</span></span>
            <span className="small muted" data-testid="usage-statusline-explain">Edits this account’s settings.json to add Keeper’s status-line step (your own status line still runs); turning it off restores the file as it was. Off by default.</span>
          </span>
        </> : null}
        {info.optIn ? <>
          <label>{info.unofficial ? 'Unofficial source' : 'Unofficial extra'}</label>
          <span className="col" style={{ gap: 2 }}>
            <span className="row" style={{ gap: 8 }}><Toggle label={info.optIn.label} on={!!a.online} onChange={(v) => set({ online: v })} /> <span className="small">{info.optIn.label} <span className="badge warn">{UNOFFICIAL}</span></span></span>
            <span className="small muted" data-testid="usage-optin-explain">{info.optIn.explain} Off by default.</span>
          </span>
        </> : null}
        {st?.limits.length ? <>
          <label>Limits to show</label>
          <span className="col" style={{ gap: 4 }}>{st.limits.map((l) => (
            <label key={l.key} className="row" style={{ gap: 6 }}><input type="checkbox" checked={!a.limits || a.limits.includes(l.key)} onChange={(e) => {
              const all = st.limits.map((x) => x.key);
              const cur = a.limits ?? all;
              const next = e.target.checked ? [...cur, l.key] : cur.filter((k) => k !== l.key);
              set({ limits: next.length === all.length ? undefined : next });
            }} />{l.label}</label>
          ))}</span>
        </> : null}
        <label>Glance</label>
        <span className="row" style={{ gap: 8 }}><Toggle label="Show in the glance" on={!a.hideInMenuBar} onChange={(v) => set({ hideInMenuBar: !v })} /><span className="small">Count it in the AI usage card of the owl’s glance</span></span>
        <label>Paused</label>
        <span className="row" style={{ gap: 8 }}><Toggle label="Paused" on={!!a.paused} onChange={(v) => set({ paused: v })} /><span className="small">Keep it, but read nothing</span></span>
        {msg ? <div className="full small" role="status">{msg}</div> : null}
        <div className="full btn-row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          {web && !a.id
            ? <button className="btn primary" disabled={busy} onClick={() => void signIn()} data-testid="usage-save">{busy ? 'Waiting for the sign-in…' : `Sign in to ${site}…`}</button>
            : <button className="btn primary" disabled={busy} onClick={() => void save()} data-testid="usage-save">{a.id ? 'Save' : 'Add'}</button>}
        </div>
      </div>
    </Modal>
  );
}
