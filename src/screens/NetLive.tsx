// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Network & Firewall: the live view (every app with its connections now,
// grouped by app and then by host, with an inspector for answers), the
// history (a day or a week per app, top destinations, CSV), "where your data
// goes", and the Ask prompt shared by the page and its small window.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FwStatus, QuickTarget } from '../../core/api-fw';
import type { FwConnection } from '../../core/api-fw';
import { countryName } from '../../core/fw/monitor';
import { amountText, batchAlerts, filterCounts, groupLive, pushSpark, rateText, type AskBatch, type DestTotal, type LiveApp, type LiveFilter, type LiveHost, type WhereApp } from '../../core/fw/live';
import { quickRuleFor, scopeOf, type AlertScope, type RuleVerdict } from '../../core/fw/rules';
import { flag } from '../../core/net/geo';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Loading, Toggle } from '../components/ui';
import { AppIcon, Spark, useAppIcons } from '../components/NetBits';
import { useStore } from '../state';
import '../styles/netmon.css';

type Scope = Exclude<AlertScope, 'once'>;
const SCOPES: [Scope, string][] = [['hour', '1 hour'], ['quit', 'Until quit'], ['forever', 'Always']];

// ---------------------------------------------------------------- small parts

function Decision({ d, reason }: { d: LiveHost['decision']; reason: string }) {
  const label = d === 'deny' ? 'Blocked' : d === 'ask' ? 'No rule' : 'Allowed';
  return <span className={`nm-chip ${d}`} title={reason}><i aria-hidden />{label}</span>;
}

/** Where blocking single apps stands on this computer, in one honest sentence. */
function enforcementNote(s: FwStatus): string | undefined {
  if (s.caps.perAppBlocking) return s.settings.enforce ? undefined : 'Answers are saved now and take effect once “Enforce rules” is on.';
  if (s.platform === 'darwin') return 'Blocking single apps on a Mac: available once Apple approves Keeper’s network filter. Until then Keeper watches and asks, and the DNS filter can block a site for every app.';
  return s.caps.notes[0] ?? 'This computer can’t block single apps yet; the DNS filter can block a site for every app.';
}

// ---------------------------------------------------------------- live

/** Connections every 2 s while the page is visible, with a small history of rates per app and per host. */
function useLive() {
  const [rows, setRows] = useState<FwConnection[] | null>(null);
  const [sparks, setSparks] = useState<Map<string, number[]>>(new Map());
  useEffect(() => {
    let alive = true;
    let t: number | undefined;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const r = await api.fw.connections();
          if (!alive) return;
          setRows(r);
          const vals = new Map<string, number>();
          for (const a of groupLive(r)) { vals.set(a.appPath ?? a.app, a.rateIn + a.rateOut); for (const h of a.hosts) vals.set(h.key, h.rateIn + h.rateOut); }
          setSparks((b) => pushSpark(b, vals, 30));
        } catch { /* next time */ }
      }
      if (alive) t = window.setTimeout(tick, 2000);
    };
    void tick();
    return () => { alive = false; clearTimeout(t); };
  }, []);
  return { rows, sparks };
}

const FILTERS: [LiveFilter, string][] = [['all', 'All'], ['active', 'Active'], ['blocked', 'Blocked'], ['new', 'New today']];

export function LiveTab({ s, act, onAsk }: { s: FwStatus; act: (p: Promise<FwStatus>) => Promise<void>; onAsk: () => void }) {
  const { rows, sparks } = useLive();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<LiveFilter>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const search = useRef<HTMLInputElement>(null);
  const o = { now: Date.now(), watchingSince: s.watchingSince };
  const apps = useMemo(() => groupLive(rows ?? [], { ...o, filter, query: q }), [rows, filter, q, s.watchingSince]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => filterCounts(rows ?? [], o), [rows, s.watchingSince]); // eslint-disable-line react-hooks/exhaustive-deps
  const icons = useAppIcons(apps.map((a) => a.appPath));
  const all = useMemo(() => groupLive(rows ?? [], o), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = all.find((a) => (a.appPath ?? a.app) === sel) ?? (sel ? undefined : apps[0]);
  const waiting = batchAlerts(s.pending);
  const totals = apps.reduce((t, a) => [t[0] + a.rateIn, t[1] + a.rateOut], [0, 0]);
  // Windows counts bytes per app only with administrator access: speeds are unknown there, not zero.
  const uncounted = (rows ?? []).some((r) => r.counted === false);
  const rate = (b: number) => (uncounted ? '—' : rateText(b));

  // "/" searches; arrows move through the apps; Enter or → opens one, ← closes it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]');
      if (e.key === '/' && !typing) { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const rowKeys = (e: React.KeyboardEvent, a: LiveApp) => {
    const id = a.appPath ?? a.app;
    const list = [...document.querySelectorAll<HTMLElement>('.nm-app')];
    const i = list.indexOf(e.currentTarget as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); list[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus(); }
    else if (e.key === 'ArrowRight') setOpen((x) => new Set(x).add(id));
    else if (e.key === 'ArrowLeft') setOpen((x) => { const n = new Set(x); n.delete(id); return n; });
  };

  if (!rows) return <Loading label="Looking at connections…" />;
  return (
    <div className="nm-live">
      <div className="nm-capsule" role="toolbar" aria-label="Search and filters">
        <label className="nm-search">
          <Icon name="search" size={14} />
          <input ref={search} data-testid="nm-search" placeholder="Search apps, sites, countries, ports" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search connections" />
          {q ? <button className="nm-x" onClick={() => setQ('')} aria-label="Clear the search" title="Clear"><Icon name="close" size={12} /></button> : <kbd title="Press / to search">/</kbd>}
        </label>
        <div className="nm-seg" role="radiogroup" aria-label="Show">
          {FILTERS.map(([k, l]) => (
            <button key={k} role="radio" aria-checked={filter === k} data-testid={`nm-filter-${k}`} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}<span className="nm-count">{counts[k]}</span></button>
          ))}
        </div>
        {uncounted ? <span className="nm-rates" title="This computer counts data per app only for the administrator; Network activity shows the whole computer's speed">Speeds per app: not counted here</span> : <span className="nm-rates" title="Everything shown, right now">↓ {rateText(totals[0])} · ↑ {rateText(totals[1])}</span>}
      </div>

      {waiting.length ? (
        <button className="nm-waiting" data-testid="nm-waiting" onClick={onAsk}>
          <span className="nm-waiting-dot" aria-hidden />
          <b>{waiting.length === 1 ? `${waiting[0].app} wants to connect` : `${waiting.length} apps want to connect`}</b>
          <span className="muted">{waiting.length === 1 ? `${waiting[0].hosts[0]}${waiting[0].hosts.length > 1 ? ` and ${waiting[0].hosts.length - 1} more` : ''}` : waiting.map((b) => b.app).slice(0, 3).join(', ')}</span>
          <span className="nm-waiting-go">Decide<Icon name="chevronRight" size={12} /></span>
        </button>
      ) : null}

      <div className="nm-split">
        <section className="nm-panel nm-list" aria-label="Apps and their connections">
          <div className="nm-head-row" aria-hidden>
            <span>App</span><span>Received</span><span>Sent</span><span>Last minute</span><span />
          </div>
          {!apps.length ? <LiveEmpty filter={filter} q={q} watching={!!s.watchingSince} onClear={() => { setQ(''); setFilter('all'); }} onWatch={() => void act(api.fw.setSettings({ monitor: true }))} /> : apps.map((a) => {
            const id = a.appPath ?? a.app;
            const isOpen = open.has(id) || !!q || filter !== 'all';
            const on = selected && (selected.appPath ?? selected.app) === id;
            return (
              <div key={id} className={`nm-group${on ? ' on' : ''}`} data-testid="nm-app" data-app={a.app}>
                <div className="nm-app" role="button" tabIndex={0} aria-expanded={isOpen} aria-label={`${a.app}: ${a.hosts.length} ${a.hosts.length === 1 ? 'place' : 'places'}, receiving ${rateText(a.rateIn)}, sending ${rateText(a.rateOut)}`}
                  onClick={() => { setSel(id); setOpen((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }}
                  onKeyDown={(e) => { rowKeys(e, a); if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                  <span className="nm-name">
                    <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12} />
                    <AppIcon name={a.app} src={icons[a.appPath ?? '']} />
                    <span className="nm-name-txt">
                      <b>{a.app}</b>
                      <small>{a.hosts.length} {a.hosts.length === 1 ? 'place' : 'places'}{a.blocked ? ` · ${a.blocked} blocked` : ''}{a.newHosts ? ` · ${a.newHosts} new` : ''}</small>
                    </span>
                  </span>
                  <span className="nm-num">{rate(a.rateIn)}</span>
                  <span className="nm-num">{rate(a.rateOut)}</span>
                  <Spark values={sparks.get(id) ?? []} />
                  <span />
                </div>
                {isOpen ? a.hosts.map((h) => (
                  <div key={h.key} className={`nm-host ${h.decision}`} data-testid="nm-host" data-host={h.host ?? h.ip} onClick={() => setSel(id)}>
                    <span className="nm-where">
                      <span className="nm-flag" title={h.country ? countryName(h.country) : 'Country unknown'} aria-label={h.country ? countryName(h.country) : undefined}>{h.country ? flag(h.country) : <i aria-hidden />}</span>
                      <span className="nm-where-txt">
                        <span className="nm-hostname" title={h.host && h.ip ? `${h.host} (${h.ip})` : h.ip}>{h.host ?? h.ip}</span>
                        <small>{h.proto} {h.ports.slice(0, 3).join(', ')}{h.ports.length > 3 ? '…' : ''}{h.service ? ` · ${h.service}` : ''}{h.newToday ? ' · new today' : ''}</small>
                      </span>
                    </span>
                    <span className="nm-num">{rate(h.rateIn)}</span>
                    <span className="nm-num">{rate(h.rateOut)}</span>
                    <Spark values={sparks.get(h.key) ?? []} />
                    <Decision d={h.decision} reason={h.reason} />
                  </div>
                )) : null}
              </div>
            );
          })}
        </section>
        {selected ? <Inspector s={s} a={selected} icon={icons[selected.appPath ?? '']} act={act} spark={sparks.get(selected.appPath ?? selected.app) ?? []} /> : <aside className="nm-panel nm-inspector nm-inspector-empty"><Icon name="app" size={22} /><p>Pick an app to see where it connects and decide what it may do.</p></aside>}
      </div>
    </div>
  );
}

function LiveEmpty({ filter, q, watching, onClear, onWatch }: { filter: LiveFilter; q: string; watching: boolean; onClear: () => void; onWatch: () => void }) {
  const [title, text, action] = q ? ['Nothing matches', 'Try an app’s name, a site or a country.', <button key="c" className="btn sm" onClick={onClear}>Clear the search</button>]
    : filter === 'blocked' ? ['Nothing blocked right now', 'Blocked attempts show here as they happen.', null]
      : filter === 'new' ? (watching ? ['Nothing new today', 'Apps reaching a place for the first time show here.', null] : ['Learning what’s usual', 'Keeper needs to watch for a day before it can tell what’s new.', <button key="w" className="btn sm primary" onClick={onWatch}>Watch in the background</button>])
        : filter === 'active' ? ['All quiet', 'No app is sending or receiving right now.', null]
          : ['No connections', 'Nothing on this computer is talking to the network.', null];
  return (
    <div className="nm-empty" data-testid="nm-empty">
      <EmptyArt />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

/** Keeper's small drawing for quiet network screens: a computer with soft lines going out. */
export function EmptyArt() {
  return (
    <svg className="nm-art" width="132" height="84" viewBox="0 0 132 84" aria-hidden>
      <defs><linearGradient id="nm-art-g" x1="0" x2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".05" /><stop offset="1" stopColor="currentColor" stopOpacity=".22" /></linearGradient></defs>
      <path d="M44 42 C 70 18, 92 14, 120 16" fill="none" stroke="url(#nm-art-g)" strokeWidth="2" strokeDasharray="3 5" />
      <path d="M44 46 C 74 44, 96 48, 124 44" fill="none" stroke="url(#nm-art-g)" strokeWidth="2" strokeDasharray="3 5" />
      <path d="M44 50 C 70 72, 92 74, 118 70" fill="none" stroke="url(#nm-art-g)" strokeWidth="2" strokeDasharray="3 5" />
      <circle cx="120" cy="16" r="4" className="nm-art-dot" /><circle cx="124" cy="44" r="4" className="nm-art-dot" /><circle cx="118" cy="70" r="4" className="nm-art-dot" />
      <rect x="6" y="26" width="40" height="30" rx="5" className="nm-art-screen" />
      <rect x="18" y="58" width="16" height="4" rx="2" className="nm-art-screen" />
    </svg>
  );
}

// ---------------------------------------------------------------- inspector

function Inspector({ s, a, icon, act, spark }: { s: FwStatus; a: LiveApp; icon?: string; act: (p: Promise<FwStatus>) => Promise<void>; spark: number[] }) {
  const appId = a.appPath ?? a.app;
  const rule = quickRuleFor(s.state, appId);
  const [scope, setScope] = useState<Scope>(rule ? scopeOf(rule) : 'forever');
  const [profiles, setProfiles] = useState<string[]>(rule?.profiles ?? []);
  useEffect(() => { setScope(rule ? scopeOf(rule) : 'forever'); setProfiles(rule?.profiles ?? []); }, [appId, rule?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const can = s.caps.perAppBlocking;
  const note = enforcementNote(s);
  const target = (host?: string): QuickTarget => ({ app: a.app, path: a.appPath, signer: a.signer, host });
  const answer = (v: RuleVerdict | null, host?: string) => act(api.fw.quickRule(target(host), v, scope, profiles));
  const verdicts: [RuleVerdict | null, string, string][] = [[null, 'Follow rules', 'No answer of its own: the other rules and the mode decide'], ['allow', 'Allow', 'Always let it connect'], ['ask', 'Ask', 'Ask before it reaches a new place'], ['deny', 'Block', 'Never let it connect']];
  const shown = can ? verdicts : verdicts.filter(([v]) => v === null || v === 'ask');
  return (
    <aside className="nm-panel nm-inspector" aria-label={`${a.app} details`} data-testid="nm-inspector">
      <div className="nm-insp-head">
        <AppIcon name={a.app} src={icon} size={40} />
        <div className="nm-insp-title">
          <h3>{a.app}</h3>
          <small title={a.appPath}>{a.signer ? `Signed by ${a.signer}` : 'Not signed'}</small>
        </div>
      </div>
      <div className="nm-facts" aria-label="Right now">
        <div><small>Received</small><b>{rateText(a.rateIn)}</b></div>
        <div><small>Sent</small><b>{rateText(a.rateOut)}</b></div>
        <div><small>Places</small><b>{a.hosts.length}</b></div>
      </div>
      <div className="nm-insp-spark"><Spark values={spark} w={260} h={36} label={`${a.app}’s traffic in the last minute`} /></div>

      <h4 className="nm-kicker">This app may</h4>
      <div className="nm-seg nm-seg-wide" role="radiogroup" aria-label={`What ${a.app} may do`} data-testid="nm-verdict">
        {shown.map(([v, l, tip]) => (
          <button key={l} role="radio" aria-checked={(rule?.verdict ?? null) === v} className={(rule?.verdict ?? null) === v ? `on ${v ?? ''}` : ''} title={tip} onClick={() => void answer(v)}>{l}</button>
        ))}
      </div>
      <div className="nm-insp-grid">
        <label>For<select className="input sm" value={scope} onChange={(e) => { const sc = e.target.value as Scope; setScope(sc); if (rule) void act(api.fw.quickRule(target(), rule.verdict, sc, profiles)); }}>{SCOPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Where<select className="input sm" value={profiles[0] ?? ''} onChange={(e) => { const p = e.target.value ? [e.target.value] : []; setProfiles(p); if (rule) void act(api.fw.quickRule(target(), rule.verdict, scope, p)); }}>
          <option value="">Any network</option>
          {s.state.profiles.map((p) => <option key={p.id} value={p.id}>Only {p.name}</option>)}
        </select></label>
      </div>
      {note ? <p className="nm-note" role="note"><Icon name="info" size={13} />{note}{s.caps.perAppBlocking && !s.settings.enforce ? <button className="btn xs" onClick={() => void act(api.fw.setSettings({ enforce: true }))}>Turn on</button> : null}</p> : null}

      <h4 className="nm-kicker">Places it reaches</h4>
      <ul className="nm-places">
        {a.hosts.slice(0, 8).map((h) => {
          const where = h.host ?? h.ip;
          const own = quickRuleFor(s.state, appId, where);
          return (
            <li key={h.key}>
              <span className="nm-hostname" title={where}>{h.country ? `${flag(h.country)} ` : ''}{where}</span>
              {can ? (
                <span className="nm-mini-seg" role="group" aria-label={`${a.app} and ${where}`}>
                  <button className={own?.verdict === 'allow' ? 'on' : ''} aria-pressed={own?.verdict === 'allow'} title={`Always allow ${a.app} to reach ${where}`} onClick={() => void answer(own?.verdict === 'allow' ? null : 'allow', where)}>Allow</button>
                  <button className={own?.verdict === 'deny' ? 'on deny' : ''} aria-pressed={own?.verdict === 'deny'} data-testid="nm-host-block" title={`Block ${a.app} from ${where}`} onClick={() => void answer(own?.verdict === 'deny' ? null : 'deny', where)}>Block</button>
                </span>
              ) : s.dns.running && h.host ? (
                <button className="btn xs ghost" title={`Block ${h.host} for every app (DNS filter)`} onClick={() => void act(api.fw.setDomain(h.host!, 'deny'))}>Block site</button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {a.hosts.length > 8 ? <small className="muted">and {a.hosts.length - 8} more in the list</small> : null}
    </aside>
  );
}

// ---------------------------------------------------------------- the Ask prompt

/** One app's prompt: who, where, why, and the answer with how long to remember it. */
export function AskCard({ b, s, index, total, onLater, inWindow }: { b: AskBatch; s: FwStatus; index: number; total: number; onLater?: () => void; inWindow?: boolean }) {
  const { toast } = useStore();
  const [remember, setRemember] = useState<Scope>('forever');
  const [reach, setReach] = useState<'places' | 'domain' | 'everywhere'>('places');
  const [busy, setBusy] = useState(false);
  const icons = useAppIcons([b.appPath]);
  const can = s.caps.perAppBlocking;
  const go = async (v: 'allow' | 'deny', scope: AlertScope) => {
    setBusy(true);
    try { await api.fw.answerApp(b.id, v, scope, { wholeDomain: reach === 'domain', anyHost: reach === 'everywhere' }); } catch (e) { toast?.((e as Error).message); } finally { setBusy(false); }
  };
  const country = b.alerts.find((x) => x.country)?.country;
  return (
    <div className="nm-ask" data-testid="nm-ask" role="group" aria-labelledby={`nm-ask-${index}`}>
      <div className="nm-ask-kicker">New connection{total > 1 ? ` · ${index + 1} of ${total}` : ''}</div>
      <div className="nm-ask-head">
        <AppIcon name={b.app} src={icons[b.appPath ?? '']} size={44} />
        <div className="nm-ask-title">
          <h2 id={`nm-ask-${index}`}><span className="nm-hl">{b.app}</span> wants to connect</h2>
          <small title={b.appPath}>{b.signer ? `Signed by ${b.signer}` : 'Not signed'}{b.attempts > 1 ? ` · tried ${b.attempts} times` : ''}</small>
        </div>
      </div>
      <ul className="nm-ask-places" aria-label="Places">
        {b.hosts.slice(0, 3).map((h) => <li key={h}>{country && h === b.hosts[0] ? <span title={countryName(country)}>{flag(country)} </span> : null}{h}</li>)}
        {b.hosts.length > 3 ? <li className="muted">+{b.hosts.length - 3} more</li> : null}
      </ul>
      <p className="nm-ask-why"><Icon name="info" size={13} />{b.why}</p>
      {b.monitorOnly ? <p className="nm-ask-note">The first try went through; your answer counts from now.</p> : null}
      <div className="nm-ask-opts">
        <div className="nm-seg nm-seg-sm" role="radiogroup" aria-label="Remember">
          {SCOPES.map(([k, l]) => <button key={k} role="radio" aria-checked={remember === k} className={remember === k ? 'on' : ''} onClick={() => setRemember(k)}>{l}</button>)}
        </div>
        <select className="input sm" aria-label="For which places" value={reach} onChange={(e) => setReach(e.target.value as typeof reach)}>
          <option value="places">{b.hosts.length === 1 ? 'This place' : 'These places'}</option>
          <option value="domain">Their whole sites</option>
          <option value="everywhere">Everywhere</option>
        </select>
      </div>
      {!can ? <p className="nm-ask-note">{enforcementNote(s)}</p> : null}
      <div className="nm-ask-actions">
        {onLater ? <button className="btn sm ghost" data-testid="nm-ask-later" onClick={onLater} title="Decide later; it waits on the firewall page">Later</button> : null}
        <span className="grow" />
        {can ? <button className="btn sm nm-deny" disabled={busy} data-testid="nm-ask-deny" onClick={() => void go('deny', remember)}>Deny</button> : null}
        <button className="btn sm" disabled={busy} data-testid="nm-ask-once" onClick={() => void go('allow', 'once')}>{can ? 'Allow once' : 'Got it'}</button>
        <button className="btn sm primary" disabled={busy} data-testid="nm-ask-allow" onClick={() => void go('allow', remember)}>{can ? 'Allow' : 'Always allow'}</button>
      </div>
      {inWindow ? null : <div className="nm-ask-trust">On this computer · Undo anytime in Rules</div>}
    </div>
  );
}

/** The small window that asks (view=netask): one app at a time, never taking the keyboard unless clicked. */
export function NetAskWindow() {
  const [s, setS] = useState<FwStatus | null>(null);
  const [i, setI] = useState(0);
  const fit = useRef<HTMLDivElement>(null);
  const load = useCallback(() => void api.fw.status().then(setS).catch(() => undefined), []);
  useEffect(() => {
    load();
    const offs = [api.on('fw-changed', load), api.on('fw-alert', load)];
    const vis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', vis);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') void api.fw.askLater(10); };
    window.addEventListener('keydown', key);
    return () => { offs.forEach((o) => o()); document.removeEventListener('visibilitychange', vis); window.removeEventListener('keydown', key); };
  }, [load]);
  useLayoutEffect(() => {
    const el = fit.current;
    if (!el) return;
    const send = () => void api.fw.askFit(Math.ceil(el.getBoundingClientRect().height) + 20).catch(() => undefined);
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, [s]);
  const batches = s ? batchAlerts(s.pending) : [];
  const b = batches[Math.min(i, batches.length - 1)];
  return (
    <main className="nm-window" data-testid="nm-window">
      <div className="nm-window-card" ref={fit}>
        {!s ? null : !b ? (
          <div className="nm-ask nm-ask-done"><Icon name="check" size={18} /><b>All answered</b></div>
        ) : (
          <>
            <AskCard key={b.id} b={b} s={s} index={Math.min(i, batches.length - 1)} total={batches.length} inWindow onLater={() => void api.fw.askLater(10)} />
            {batches.length > 1 ? (
              <div className="nm-window-nav">
                <button className="btn xs ghost" disabled={i === 0} onClick={() => setI(Math.max(0, i - 1))} aria-label="Previous app"><Icon name="chevronLeft" size={12} /></button>
                <span className="small muted">{batches.length - 1} more waiting</span>
                <button className="btn xs ghost" disabled={i >= batches.length - 1} onClick={() => setI(i + 1)} aria-label="Next app"><Icon name="chevronRight" size={12} /></button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

/** The page's own list of waiting prompts (a sheet over the live view). */
export function AskSheet({ s, onClose }: { s: FwStatus; onClose: () => void }) {
  const batches = batchAlerts(s.pending);
  const [i, setI] = useState(0);
  const at = Math.min(i, Math.max(0, batches.length - 1));
  useEffect(() => { if (!batches.length) onClose(); }, [batches.length, onClose]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="nm-sheet-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nm-sheet" role="dialog" aria-modal="true" aria-label="Waiting connections" data-testid="nm-sheet">
        <div className="nm-sheet-head"><h3>{batches.length === 1 ? 'One app is waiting' : `${batches.length} apps are waiting`}</h3><button className="btn xs ghost" onClick={onClose} aria-label="Close" title="Close (Esc)"><Icon name="close" size={12} /></button></div>
        {batches[at] ? <AskCard key={batches[at].id} b={batches[at]} s={s} index={at} total={batches.length} /> : null}
        {batches.length > 1 ? (
          <div className="nm-window-nav">
            <button className="btn xs ghost" disabled={at === 0} onClick={() => setI(at - 1)} aria-label="Previous app"><Icon name="chevronLeft" size={12} /></button>
            <span className="small muted">{batches.length - 1} more waiting</span>
            <button className="btn xs ghost" disabled={at >= batches.length - 1} onClick={() => setI(at + 1)} aria-label="Next app"><Icon name="chevronRight" size={12} /></button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- history

const SPANS: [string, number][] = [['Day', 86_400_000], ['Week', 7 * 86_400_000], ['Month', 30 * 86_400_000]];

export function HistoryTab({ s, act }: { s: FwStatus; act: (p: Promise<FwStatus>) => Promise<void> }) {
  const { toast } = useStore();
  const [span, setSpan] = useState(86_400_000);
  const [app, setApp] = useState<string | undefined>();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.fw.history>> | null>(null);
  const [dests, setDests] = useState<DestTotal[]>([]);
  useEffect(() => {
    const to = Date.now();
    void api.fw.history(to - span, to, app).then(setData);
    void api.fw.destinations(to - span, to, app).then(setDests);
  }, [span, app]);
  if (!data) return <Loading label="Reading history…" />;
  const pts = data.points;
  const max = Math.max(1, ...pts.map((p) => p.inB + p.outB));
  const inT = pts.reduce((a, p) => a + p.inB, 0);
  const outT = pts.reduce((a, p) => a + p.outB, 0);
  const top = Math.max(1, ...data.apps.map((a) => a.inB + a.outB));
  const label = (t: number) => span <= 86_400_000 ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric' });
  const empty = !data.apps.length;
  return (
    <div className="nm-history">
      <div className="nm-capsule" role="toolbar" aria-label="History">
        <div className="nm-seg" role="radiogroup" aria-label="Time">{SPANS.map(([l, ms]) => <button key={l} role="radio" aria-checked={span === ms} className={span === ms ? 'on' : ''} onClick={() => setSpan(ms)}>{l}</button>)}</div>
        {app ? <button className="nm-pill" onClick={() => setApp(undefined)} title="Show every app"><Icon name="close" size={11} />{app}</button> : <span className="muted small">Every app</span>}
        <span className="grow" />
        <button className="btn sm ghost" data-testid="nm-export" disabled={empty} onClick={() => void api.fw.exportHistory(Date.now() - span, Date.now(), app).then((p) => p && toast(`Saved ${p}`))}><Icon name="down" size={12} /> Export CSV</button>
      </div>
      {empty ? (
        <div className="nm-panel nm-empty"><EmptyArt /><h3>No history yet</h3><p>{s.settings.monitor || s.settings.alerts || s.settings.enforce ? 'It fills in as apps use the network.' : 'Keeper keeps it once it watches in the background.'}</p>{!(s.settings.monitor || s.settings.alerts || s.settings.enforce) ? <button className="btn sm primary" onClick={() => void act(api.fw.setSettings({ monitor: true }))}>Watch in the background</button> : null}</div>
      ) : (
        <>
          <div className="nm-stats">
            <div className="nm-stat"><small>Data used</small><b>{amountText(inT + outT)}</b></div>
            <div className="nm-stat"><small>Received</small><b>{amountText(inT)}</b></div>
            <div className="nm-stat"><small>Sent</small><b>{amountText(outT)}</b></div>
          </div>
          <section className="nm-panel" aria-label={`Traffic over time${app ? ` for ${app}` : ''}`}>
            <div className="nm-chart" role="img" aria-label={`Traffic chart: ${amountText(inT)} received, ${amountText(outT)} sent`} data-testid="nm-chart">
              {pts.map((p) => <span key={p.t} title={`${label(p.t)} · ↓ ${amountText(p.inB)} ↑ ${amountText(p.outB)}`}><i className="in" style={{ height: `${(p.inB / max) * 100}%` }} /><i className="out" style={{ height: `${(p.outB / max) * 100}%` }} /></span>)}
            </div>
            <div className="nm-axis"><span>{pts[0] ? label(pts[0].t) : ''}</span><span className="nm-key"><i className="in" />Received <i className="out" />Sent</span><span>{pts.length ? label(pts[pts.length - 1].t) : ''}</span></div>
          </section>
          <div className="nm-two">
            <section className="nm-panel" aria-labelledby="nm-h-apps">
              <h4 id="nm-h-apps" className="nm-kicker">Apps</h4>
              <div className="nm-bars">{data.apps.slice(0, 10).map((a) => (
                <button key={a.app} className={`nm-bar-row${app === a.app ? ' on' : ''}`} aria-pressed={app === a.app} onClick={() => setApp(app === a.app ? undefined : a.app)}>
                  <span className="nm-bar-name">{a.app}</span>
                  <span className="nm-bar"><i style={{ width: `${Math.max(2, ((a.inB + a.outB) / top) * 100)}%` }} /></span>
                  <span className="nm-num">{amountText(a.inB + a.outB)}</span>
                </button>
              ))}</div>
            </section>
            <section className="nm-panel" aria-labelledby="nm-h-dests">
              <h4 id="nm-h-dests" className="nm-kicker">Top destinations{app ? ` of ${app}` : ''}</h4>
              {!dests.length ? <p className="muted small">Places show here once Keeper has watched for a while.</p> : (
                <ol className="nm-dests">{dests.slice(0, 10).map((d) => <li key={d.host}><span className="nm-hostname" title={d.host}>{d.host}</span><span className="muted small">{d.conns} {d.conns === 1 ? 'connection' : 'connections'}</span><span className="nm-num">{amountText(d.inB + d.outB)}</span></li>)}</ol>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- where your data goes

const WHERE_SPANS: [string, number][] = [['Today', 0], ['7 days', 7 * 86_400_000], ['30 days', 30 * 86_400_000]];

export function WhereTab({ s, act }: { s: FwStatus; act: (p: Promise<FwStatus>) => Promise<void> }) {
  const [span, setSpan] = useState(7 * 86_400_000);
  const [w, setW] = useState<{ apps: WhereApp[]; totalIn: number; totalOut: number; places: number } | null>(null);
  useEffect(() => { const to = Date.now(); const d = new Date(to); d.setHours(0, 0, 0, 0); void api.fw.where(span ? to - span : d.getTime(), to).then(setW); }, [span]);
  if (!w) return <Loading label="Adding it up…" />;
  const top = Math.max(1, ...w.apps.map((a) => a.inB + a.outB));
  return (
    <div className="nm-where-page">
      <div className="nm-hero">
        <div>
          <div className="nm-kicker">{WHERE_SPANS.find(([, ms]) => ms === span)?.[0]}</div>
          <h2 className="nm-hero-title" data-testid="nm-where-title">Your data went to <span className="nm-hl">{w.places} {w.places === 1 ? 'place' : 'places'}</span></h2>
          <div className="nm-trust">{amountText(w.totalIn)} received · {amountText(w.totalOut)} sent · Counted on this computer</div>
        </div>
        <div className="nm-seg" role="radiogroup" aria-label="Time">{WHERE_SPANS.map(([l, ms]) => <button key={l} role="radio" aria-checked={span === ms} className={span === ms ? 'on' : ''} onClick={() => setSpan(ms)}>{l}</button>)}</div>
      </div>
      {!w.apps.length ? (
        <div className="nm-panel nm-empty"><EmptyArt /><h3>Nothing counted yet</h3><p>Keeper adds up where each app’s data goes while it watches.</p>{!s.settings.monitor ? <button className="btn sm primary" onClick={() => void act(api.fw.setSettings({ monitor: true }))}>Watch in the background</button> : null}</div>
      ) : (
        <div className="nm-where-grid">
          {w.apps.map((a) => {
            // Bars by data, or by connections when an app's data is too small to count.
            const byData = a.inB + a.outB > 0;
            const val = (h: DestTotal) => (byData ? h.inB + h.outB : h.conns);
            const hTop = Math.max(1, ...a.hosts.map(val));
            return (
              <section key={a.app} className="nm-panel nm-where-app" aria-label={a.app}>
                <div className="nm-where-head">
                  <AppIcon name={a.app} size={28} />
                  <b className="grow">{a.app}</b>
                  <span className="nm-num">{amountText(a.inB + a.outB)}</span>
                </div>
                <span className="nm-bar nm-bar-big" aria-hidden><i style={{ width: `${Math.max(2, ((a.inB + a.outB) / top) * 100)}%` }} /></span>
                <ul className="nm-where-hosts">
                  {a.hosts.map((h) => (
                    <li key={h.host}>
                      <span className="nm-hostname" title={h.host}>{h.host}</span>
                      <span className="nm-bar"><i style={{ width: `${Math.max(3, (val(h) / hTop) * 100)}%` }} /></span>
                      <span className="muted small nm-num" title={`${h.conns} ${h.conns === 1 ? 'connection' : 'connections'} · ${amountText(h.inB + h.outB)}`}>{h.conns}×</span>
                    </li>
                  ))}
                </ul>
                <small className="muted">{a.hostCount > a.hosts.length ? `and ${a.hostCount - a.hosts.length} more ${a.hostCount - a.hosts.length === 1 ? 'place' : 'places'}` : `${a.hostCount} ${a.hostCount === 1 ? 'place' : 'places'} in all`}</small>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The two newer switches (watching, the small window), on the firewall page's Switches part. */
export function MonitorSwitches({ s, act }: { s: FwStatus; act: (p: Promise<FwStatus>) => Promise<void> }) {
  return (
    <>
      <label className="row fw-switch"><div className="grow"><b>Watch in the background</b><div className="small muted">Keeps history, finds what’s new and asks. Off: only while this page is open.</div></div><Toggle on={s.settings.monitor} onChange={(v) => void act(api.fw.setSettings({ monitor: v }))} /></label>
      <label className="row fw-switch"><div className="grow"><b>Ask in a small window</b><div className="small muted">It opens in the corner and never takes the keyboard while you type.</div></div><Toggle on={s.settings.askWindow} onChange={(v) => void act(api.fw.setSettings({ askWindow: v }))} /></label>
    </>
  );
}
