// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Firewall: who may connect where. Overview with alerts and quiet modes,
// live connections on a list and a map, rules and groups, profiles, the DNS
// filter with blocklists, and traffic history. Everything is free.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FwAlert, FwConnection, FwEvent, FwStatus } from '../../core/api-fw';
import type { QueryLogEntry } from '../../core/fw/dns';
import { countryName, matchesSearch, parseSearch } from '../../core/fw/monitor';
import { describeRuleTarget } from '../fw-text';
import type { AlertScope, FwRule, Mode, Profile, TidyNote } from '../../core/fw/rules';
import { formatBytes, relativeTime } from '../../core/format';
import { flag } from '../../core/net/geo';
import { api, isDemo } from '../api';
import { KeeperOwnConnections } from '../components/UsageStatsPanel';
import { Icon } from '../components/Icon';
import { homePoint, WorldMap, type MapPoint } from '../components/WorldMap';
import { Empty, Loading, Modal, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/fw.css';
import { MeshTag } from './MeshParts';

type Tab = 'overview' | 'connections' | 'rules' | 'profiles' | 'dns' | 'history';

const MODE_TEXT: Record<Mode, [string, string]> = {
  alert: ['Ask me', 'New connections without a rule ask first.'],
  'silent-allow': ['Quiet: allow', 'Allow without asking and remember them, to decide later.'],
  'silent-deny': ['Quiet: deny', 'Deny without asking. Good on public networks.'],
};

export function Firewall() {
  const { route, go, toast } = useStore();
  const [tab, setTab] = useState<Tab>((route.arg as Tab) || 'overview');
  const [s, setS] = useState<FwStatus | null>(null);
  const load = useCallback(() => void api.fw.status().then(setS), []);
  useEffect(() => {
    load();
    const offs = [api.on('fw-changed', load), api.on('fw-alert', load), api.on('fw-event', load)];
    return () => offs.forEach((o) => o());
  }, [load]);
  const act = async (p: Promise<FwStatus>) => { try { setS(await p); } catch (e) { toast((e as Error).message); } };
  if (!s) return <Loading label="Reading the firewall…" />;

  return (
    <div className="fw">
      <PageHead title="Firewall" sub="Which app may connect where — on this computer, for free." />
      <div className="fw-status">
        <div className={`fw-shield ${s.enforcement.active ? 'on' : s.settings.alerts || s.settings.dnsFilter ? 'part' : 'off'}`}><Icon name="shield" size={22} /></div>
        <div className="grow">
          <b>{s.enforcement.active ? `Rules enforced through ${s.enforcement.backend}` : s.settings.enforce ? 'Rules not in place yet' : 'Watching only — nothing is blocked by rules'}</b>
          <div className="small muted">{s.enforcement.message ?? (s.settings.enforce ? '' : 'Turn on “Enforce rules” below; the system asks for the administrator once per change.')}</div>
        </div>
        <div className="seg">
          {(Object.keys(MODE_TEXT) as Mode[]).map((m) => <button key={m} className={s.state.mode === m ? 'on' : ''} title={MODE_TEXT[m][1]} onClick={() => void act(api.fw.setMode(m))}>{MODE_TEXT[m][0]}</button>)}
        </div>
        <select className="input sm" value={s.state.activeProfile} onChange={(e) => void act(api.fw.setProfile(e.target.value))} title="Profile">
          {s.state.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="seg fw-tabs" role="tablist">
        {([['overview', 'Overview'], ['connections', 'Connections'], ['rules', 'Rules'], ['profiles', 'Profiles'], ['dns', 'Blocklists & DNS'], ['history', 'History']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{k === 'overview' && s.pending.length ? <span className="fw-count">{s.pending.length}</span> : null}</button>
        ))}
      </div>

      {tab === 'overview' ? <Overview s={s} act={act} go={go} /> : tab === 'connections' ? <Connections s={s} act={act} /> : tab === 'rules' ? <Rules s={s} act={act} /> : tab === 'profiles' ? <Profiles s={s} act={act} /> : tab === 'dns' ? <Dns s={s} act={act} /> : <HistoryTab />}
    </div>
  );
}

type Act = (p: Promise<FwStatus>) => Promise<void>;

// ---------------------------------------------------------------- overview

function Overview({ s, act, go }: { s: FwStatus; act: Act; go: ReturnType<typeof useStore>['go'] }) {
  const set = (p: Partial<FwStatus['settings']>) => act(api.fw.setSettings(p));
  return (
    <div className="fw-grid">
      <section className="card pad">
        <h3>Waiting for you {s.pending.length ? <span className="fw-count">{s.pending.length}</span> : null}</h3>
        {!s.pending.length ? <div className="muted small">No new connections to decide.</div> : s.pending.map((a) => <AlertCard key={a.id} a={a} act={act} go={go} />)}
      </section>
      <section className="card pad">
        <h3>Switches</h3>
        <label className="row fw-switch"><div className="grow"><b>Enforce rules</b><div className="small muted">Put the rules into {s.platform === 'win32' ? 'Windows Firewall' : s.platform === 'darwin' ? 'the system packet filter' : 'nftables'} so they hold even while Keeper is closed.</div></div><Toggle on={s.settings.enforce} onChange={(v) => void set({ enforce: v })} /></label>
        {s.platform !== 'darwin' ? <label className="row fw-switch"><div className="grow"><b>Block what no rule allows</b><div className="small muted">Outbound connections need a rule. Windows’ own essentials stay allowed.</div></div><Toggle on={s.settings.defaultBlock} onChange={(v) => void set({ defaultBlock: v })} /></label> : null}
        <label className="row fw-switch"><div className="grow"><b>Ask about new connections</b><div className="small muted">An alert when an app connects somewhere without a rule.</div></div><Toggle on={s.settings.alerts} onChange={(v) => void set({ alerts: v })} /></label>
        <label className="row fw-switch"><div className="grow"><b>DNS filter</b><div className="small muted">Blocklists, host rules and encrypted DNS for every app.</div></div><Toggle on={s.settings.dnsFilter} onChange={(v) => void set({ dnsFilter: v })} /></label>
        <label className="row fw-switch"><div className="grow"><b>Traffic history</b><div className="small muted">Up to a year, kept on this computer.</div></div><Toggle on={s.settings.history} onChange={(v) => void set({ history: v })} /></label>
        <label className="row fw-switch"><div className="grow"><b>Warn about unusual transfers</b><div className="small muted">When an app sends or receives far more than it normally does.</div></div><Toggle on={s.settings.unusual} onChange={(v) => void set({ unusual: v })} /></label>
      </section>
      <section className="card pad">
        <h3>What this computer allows Keeper to do</h3>
        <ul className="fw-caps">
          <li className={s.caps.perAppBlocking ? 'yes' : 'no'}>Block per app</li>
          <li className={s.caps.perAppAlerts ? 'yes' : 'no'}>Hold a connection until you answer</li>
          <li className="yes">Block hosts {s.caps.hostRules === 'dns' ? '(through the DNS filter)' : s.caps.hostRules === 'resolved-addresses' ? '(by their current addresses)' : ''}</li>
          <li className={s.caps.inbound ? 'yes' : 'no'}>Incoming connections</li>
          <li className="yes">Encrypted DNS and blocklists</li>
        </ul>
        {s.caps.notes.map((n, i) => <p key={i} className="small muted">{n}</p>)}
      </section>
      <section className="card pad">
        <h3>Lately</h3>
        <EventList events={s.recent.slice(0, 12)} />
      </section>
      <KeeperOwnConnections />
    </div>
  );
}

function AlertCard({ a, act, go }: { a: FwAlert; act: Act; go: ReturnType<typeof useStore>['go'] }) {
  const [scope, setScope] = useState<AlertScope>('forever');
  const [wholeDomain, setWhole] = useState(false);
  const [anyPort, setAnyPort] = useState(false);
  const c = a.conn;
  const answer = (v: 'allow' | 'deny') => act(api.fw.answer(a.id, v, scope, { wholeDomain, anyPort }));
  return (
    <div className="fw-alert">
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div className="fw-alert-icon"><Icon name={c.app.browser ? 'globe' : c.app.devtool ? 'terminal' : 'app'} size={18} /></div>
        <div className="grow">
          <div><b>{c.app.name}</b> wants to connect to <b>{c.host ?? c.ip}</b> on {c.proto.toUpperCase()} port {c.port}</div>
          <div className="small muted">
            {a.country ? `${flag(a.country)} ${countryName(a.country)} · ` : ''}{a.asn ? `${a.asn} · ` : ''}{a.service ? `${a.service} · ` : ''}{c.host && c.host !== c.ip ? `${c.ip} · ` : ''}{a.reverse ? `${a.reverse} · ` : ''}
            {c.app.signer ? `signed by ${c.app.signer}` : 'not signed'} · {relativeTime(a.t)}{a.attempts > 1 ? ` · tried ${a.attempts}×` : ''}
          </div>
          <div className="small muted ellipsis" title={c.app.path}>{c.app.path}</div>
          {a.monitorOnly ? <div className="small fw-note">Seen by the monitor, not held: the first connection went through. Your answer applies from now on.</div> : null}
        </div>
      </div>
      <div className="row fw-alert-opts">
        <select className="input sm" value={scope} onChange={(e) => setScope(e.target.value as AlertScope)}>
          <option value="forever">Always</option>
          <option value="quit">Until Keeper quits</option>
          <option value="hour">For an hour</option>
          <option value="once">Just this once</option>
        </select>
        {c.host ? <label className="small"><input type="checkbox" checked={wholeDomain} onChange={(e) => setWhole(e.target.checked)} /> the whole domain</label> : null}
        <label className="small"><input type="checkbox" checked={anyPort} onChange={(e) => setAnyPort(e.target.checked)} /> any port</label>
        <span className="fw-alert-actions">
        <button className="btn sm ghost" title="Ask your AI what this connection is" onClick={() => go({ name: 'assistant', arg: `What is this network connection, and is it safe to allow? App: ${c.app.name} (${c.app.path ?? 'unknown path'}${c.app.signer ? `, signed by ${c.app.signer}` : ''}). Destination: ${c.host ?? c.ip} (${c.ip}) port ${c.port}/${c.proto}${a.country ? `, ${countryName(a.country)}` : ''}${a.asn ? `, ${a.asn}` : ''}.` })}><Icon name="sparkle" size={12} /> Explain</button>
        <button className="btn sm danger" onClick={() => void answer('deny')}>Deny</button>
        <button className="btn sm primary" onClick={() => void answer('allow')}>Allow</button>
        </span>
      </div>
    </div>
  );
}

function EventList({ events }: { events: FwEvent[] }) {
  if (!events.length) return <div className="muted small">Nothing yet.</div>;
  return (
    <div className="fw-events">
      {events.map((e, i) => (
        <div key={i} className={`fw-event ${e.kind}`}>
          <Icon name={e.kind === 'denied' || e.kind === 'would-deny' ? 'close' : e.kind === 'allowed' ? 'check' : e.kind === 'unusual' ? 'warning' : 'info'} size={12} />
          <span className="grow ellipsis" title={e.message}>{e.message}</span>
          <span className="muted small">{relativeTime(e.t)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- connections

function Connections({ act }: { s: FwStatus; act: Act }) {
  const { settings } = useStore();
  const [rows, setRows] = useState<FwConnection[] | null>(null);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'app' | 'host' | 'country' | 'map'>('app');
  useEffect(() => {
    let alive = true;
    let t: number | undefined;
    const tick = async () => {
      if (document.visibilityState === 'visible') { try { const r = await api.fw.connections(); if (alive) setRows(r); } catch { /* next time */ } }
      if (alive) t = window.setTimeout(tick, 3000);
    };
    void tick();
    return () => { alive = false; clearTimeout(t); };
  }, []);
  const tokens = useMemo(() => parseSearch(q), [q]);
  const shown = useMemo(() => (rows ?? []).filter((r) => matchesSearch({ app: r.app, path: r.appPath, host: r.host, ip: r.ip, country: r.country, port: r.port, proto: r.proto, rule: r.ruleId }, tokens)), [rows, tokens]);
  const groups = useMemo(() => {
    const m = new Map<string, FwConnection[]>();
    for (const r of shown) { const k = view === 'app' ? r.app : view === 'host' ? r.host ?? r.ip ?? '?' : r.country ?? '—'; m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m].sort((a, b) => b[1].reduce((x, r) => x + r.rateIn + r.rateOut, 0) - a[1].reduce((x, r) => x + r.rateIn + r.rateOut, 0));
  }, [shown, view]);
  const points: MapPoint[] = useMemo(() => shown.filter((r) => r.country).map((r) => ({ country: r.country, label: r.host ?? r.ip, weight: r.rateIn + r.rateOut + 1, kind: r.decision === 'deny' ? 'blocked' : r.path === 'vpn' ? 'vpn' : 'direct', ref: r })), [shown]);
  const quick = (r: FwConnection, verdict: 'allow' | 'deny') => act(api.fw.saveRule('mine', { id: `q-${Date.now().toString(36)}`, app: r.appPath ? { path: r.appPath } : 'any', direction: 'out', host: r.host ? `=${r.host}` : undefined, ip: r.host ? undefined : r.ip, verdict, enabled: true, created: Date.now(), note: `${r.app} → ${r.host ?? r.ip}` }));
  if (!rows) return <Loading label="Reading connections…" />;
  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <label className="search-box grow"><Icon name="search" size={13} /><input placeholder="app:firefox host:google country:us port:443 proto:udp rule:… — or any words" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="seg">{([['app', 'By app'], ['host', 'By host'], ['country', 'By country'], ['map', 'Map']] as const).map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>
      </div>
      {view === 'map' ? <WorldMap points={points} home={homePoint(settings?.island?.place as never)} onPick={(ps) => setQ(`country:${(ps[0]?.ref as FwConnection)?.country ?? ''}`)} /> : !groups.length ? <Empty icon="globe" title="Nothing matches">No connection like that right now.</Empty> : (
        <div className="fw-conns">
          {groups.map(([k, list]) => (
            <details key={k} open={groups.length < 8}>
              <summary><b>{view === 'country' ? `${flag(k)} ${countryName(k) ?? k}` : k}</b> <span className="muted small">{list.length} · ↓ {formatBytes(list.reduce((a, r) => a + r.rateIn, 0))}/s ↑ {formatBytes(list.reduce((a, r) => a + r.rateOut, 0))}/s</span></summary>
              {list.map((r) => (
                <div key={r.key} className={`fw-conn ${r.decision}`}>
                  <span className={`fw-dot ${r.decision}`} title={r.reason} />
                  <span className="ellipsis grow">{view !== 'app' ? <b>{r.app} </b> : null}{r.host ?? r.ip}<span className="muted">:{r.port}</span><MeshTag ip={r.ip} /> {r.country ? <span title={countryName(r.country)}>{flag(r.country)}</span> : null} <span className="muted small">{r.asn ?? ''}</span></span>
                  <span className="muted small" title={r.reason}>{r.decision === 'deny' ? 'Blocked' : r.ruleId ? 'Rule' : 'No rule'}</span>
                  <span className="num small">↓ {formatBytes(r.rateIn)}/s</span>
                  <button className="btn xs" onClick={() => void quick(r, 'allow')} title="Always allow this app to this host">Allow</button>
                  <button className="btn xs danger" onClick={() => void quick(r, 'deny')} title="Always deny this app to this host">Deny</button>
                </div>
              ))}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- rules

function Rules({ s, act }: { s: FwStatus; act: Act }) {
  const { toast } = useStore();
  const [edit, setEdit] = useState<{ group: string; rule: FwRule } | null>(null);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'allow' | 'deny' | 'recent' | 'temporary'>('all');
  const [notes, setNotes] = useState<TidyNote[] | null>(null);
  const [subUrl, setSubUrl] = useState('');
  const blank = (): FwRule => ({ id: `r-${Date.now().toString(36)}`, app: 'any', direction: 'out', verdict: 'deny', enabled: true, created: Date.now() });
  const match = (r: FwRule) => {
    if (only === 'allow' || only === 'deny') { if (r.verdict !== only) return false; }
    if (only === 'temporary' && !r.until) return false;
    if (only === 'recent' && (!r.lastUsed || r.lastUsed < Date.now() - 86_400_000)) return false;
    return !q || JSON.stringify([r.app, r.host, r.ip, r.port, r.note]).toLowerCase().includes(q.toLowerCase());
  };
  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <label className="search-box grow"><Icon name="search" size={13} /><input placeholder="Find a rule" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="seg">{([['all', 'All'], ['deny', 'Deny'], ['allow', 'Allow'], ['recent', 'Used today'], ['temporary', 'Temporary']] as const).map(([k, l]) => <button key={k} className={only === k ? 'on' : ''} onClick={() => setOnly(k)}>{l}</button>)}</div>
        <button className="btn sm primary" onClick={() => setEdit({ group: 'mine', rule: blank() })}><Icon name="plus" size={12} /> New rule</button>
        <button className="btn sm" onClick={() => void api.fw.tidy().then(setNotes)}><Icon name="broom" size={12} /> Tidy up</button>
        <button className="btn sm" onClick={() => void api.fw.exportRules().then((p) => p && toast(`Saved ${p}`))}>Export</button>
        <button className="btn sm" onClick={() => void api.fw.importRules().then((r) => r && toast(`Imported ${r.imported} rules${r.problems.length ? `; ${r.problems.length} skipped` : ''}`))}>Import</button>
      </div>
      {notes ? (
        <div className="card pad fw-tidy">
          <div className="row"><b className="grow">{notes.length ? `${notes.length} things to tidy` : 'Nothing to tidy — every rule is useful.'}</b><button className="btn xs ghost" onClick={() => setNotes(null)}>Close</button></div>
          {notes.map((n) => <div key={n.ruleId + n.kind} className="row small"><span className={`badge ${n.kind === 'invalid' ? 'warn' : ''}`}>{n.kind}</span><span className="grow">{n.message}</span><button className="btn xs" onClick={() => void act(api.fw.removeRule(n.groupId, n.ruleId)).then(() => setNotes((x) => x?.filter((y) => y !== n) ?? null))}>Remove</button></div>)}
        </div>
      ) : null}
      {s.state.groups.map((g) => (
        <section key={g.id} className="card fw-group">
          <div className="row fw-group-head">
            <Toggle on={g.enabled} onChange={(v) => void act(api.fw.saveGroup({ ...g, enabled: v }))} />
            <b className="grow">{g.name}</b>
            {g.source.kind === 'subscription' ? <span className="small muted">from {new URL(g.source.url).hostname}{g.source.updated ? ` · updated ${relativeTime(g.source.updated)}` : ''}{g.source.error ? ` · ${g.source.error}` : ''}</span> : null}
            <span className="small muted">{g.rules.length} rule{g.rules.length === 1 ? '' : 's'}</span>
            {g.id !== 'mine' ? <button className="btn xs ghost" onClick={() => void act(api.fw.removeGroup(g.id))}>Remove</button> : null}
          </div>
          {g.rules.filter(match).map((r) => (
            <div key={r.id} className={`fw-rule ${r.enabled ? '' : 'off'}`} onDoubleClick={() => g.source.kind === 'local' && setEdit({ group: g.id, rule: r })}>
              <span className={`fw-verdict ${r.verdict}`}>{r.verdict === 'allow' ? 'Allow' : 'Deny'}</span>
              <span className="grow ellipsis">{describeRuleTarget(r)}</span>
              {r.until ? <span className="badge">{r.until === 'quit' ? 'until quit' : `until ${new Date(r.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</span> : null}
              {r.priority === 'high' ? <span className="badge warn">high priority</span> : null}
              <span className="small muted" title="Times used">{r.hits ? `${r.hits}×` : ''}{r.lastUsed ? ` · ${relativeTime(r.lastUsed)}` : ''}</span>
              {g.source.kind === 'local' ? <><Toggle on={r.enabled} onChange={(v) => void act(api.fw.saveRule(g.id, { ...r, enabled: v }))} /><button className="btn xs ghost icon" title="Edit" onClick={() => setEdit({ group: g.id, rule: r })}><Icon name="rename" size={12} /></button><button className="btn xs ghost icon" title="Delete" onClick={() => void act(api.fw.removeRule(g.id, r.id))}><Icon name="trash" size={12} /></button></> : null}
            </div>
          ))}
        </section>
      ))}
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <input className="input grow" placeholder="Subscribe to a rule group: https://… (add #sha256=… to pin a version, or #key=… to check a signature)" value={subUrl} onChange={(e) => setSubUrl(e.target.value)} />
        <button className="btn" disabled={!/^https:\/\//.test(subUrl)} onClick={() => void act(api.fw.subscribe(subUrl)).then(() => setSubUrl(''))}>Subscribe</button>
      </div>
      {edit ? <RuleEditor init={edit.rule} onClose={() => setEdit(null)} onSave={(r) => void act(api.fw.saveRule(edit.group, r)).then(() => setEdit(null))} /> : null}
    </div>
  );
}

function RuleEditor({ init, onClose, onSave }: { init: FwRule; onClose: () => void; onSave: (r: FwRule) => void }) {
  const [r, setR] = useState<FwRule>(init);
  const app = r.app === 'any' ? { kind: 'any' } : r.app.group ? { kind: 'group', group: r.app.group } : { kind: 'app' };
  const set = (p: Partial<FwRule>) => setR({ ...r, ...p });
  return (
    <Modal title={init.hits === undefined && !init.lastUsed ? 'Rule' : 'Edit rule'} onClose={onClose}>
      <div className="fw-form">
        <label>Answer<div className="seg"><button className={r.verdict === 'allow' ? 'on' : ''} onClick={() => set({ verdict: 'allow' })}>Allow</button><button className={r.verdict === 'deny' ? 'on' : ''} onClick={() => set({ verdict: 'deny' })}>Deny</button></div></label>
        <label>Who
          <select className="input" value={app.kind === 'group' ? `group:${app.group}` : app.kind} onChange={(e) => { const v = e.target.value; set({ app: v === 'any' ? 'any' : v.startsWith('group:') ? { group: v.slice(6) as 'system' } : { path: '' } }); }}>
            <option value="any">Any app</option><option value="app">One app…</option>
            <option value="group:system">System processes</option><option value="group:devtools">Developer tools</option><option value="group:browsers">Web browsers</option>
          </select>
        </label>
        {r.app !== 'any' && !r.app.group ? (
          <>
            <label>Program path<input className="input" value={r.app.path ?? ''} onChange={(e) => set({ app: { ...(r.app as object), path: e.target.value } })} placeholder="/Applications/App.app/Contents/MacOS/App" /></label>
            <label>Signed by (optional)<input className="input" value={r.app.signer ?? ''} onChange={(e) => set({ app: { ...(r.app as object), signer: e.target.value || undefined } })} placeholder="Team ID or publisher — keeps working if the app moves" /></label>
          </>
        ) : null}
        <label>Direction<select className="input" value={r.direction} onChange={(e) => set({ direction: e.target.value as FwRule['direction'] })}><option value="out">Outgoing</option><option value="in">Incoming</option><option value="both">Both</option></select></label>
        <label>Host or domain<input className="input" value={r.host ?? ''} onChange={(e) => set({ host: e.target.value || undefined, ip: e.target.value ? undefined : r.ip })} placeholder="example.com (with subdomains), =www.example.com (only that host)" /></label>
        <label>…or address / range<input className="input" value={r.ip ?? ''} onChange={(e) => set({ ip: e.target.value || undefined, host: e.target.value ? undefined : r.host })} placeholder="203.0.113.7 or 10.0.0.0/8" /></label>
        <label>Port<input className="input" value={r.port ?? ''} onChange={(e) => set({ port: e.target.value || undefined })} placeholder="any, 443, 8000-8080" /></label>
        <label>Protocol<select className="input" value={r.proto ?? 'any'} onChange={(e) => set({ proto: e.target.value as FwRule['proto'] })}><option value="any">Any</option><option value="tcp">TCP</option><option value="udp">UDP</option><option value="icmp">ICMP</option></select></label>
        <label>Lasts<select className="input" value={r.until === undefined ? 'always' : r.until === 'quit' ? 'quit' : 'hour'} onChange={(e) => set({ until: e.target.value === 'always' ? undefined : e.target.value === 'quit' ? 'quit' : Date.now() + 3600_000 })}><option value="always">Always</option><option value="quit">Until Keeper quits</option><option value="hour">For an hour</option></select></label>
        <label className="row"><input type="checkbox" checked={r.priority === 'high'} onChange={(e) => set({ priority: e.target.checked ? 'high' : undefined })} /> High priority (wins over more specific rules)</label>
        <label>Note<input className="input" value={r.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} /></label>
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={r.app !== 'any' && !r.app.group && !r.app.path && !r.app.signer} onClick={() => onSave(r)}>Save</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- profiles

function Profiles({ s, act }: { s: FwStatus; act: Act }) {
  const [edit, setEdit] = useState<Profile | null>(null);
  return (
    <div>
      <label className="row card pad" style={{ marginBottom: 10 }}><div className="grow"><b>Switch profiles by network</b><div className="small muted">Uses the Wi-Fi name or the router’s address to pick the profile.</div></div><Toggle on={s.state.autoSwitch} onChange={(v) => void act(api.fw.setAutoSwitch(v))} /></label>
      {s.state.profiles.map((p) => (
        <div key={p.id} className={`card pad fw-profile ${p.id === s.state.activeProfile ? 'on' : ''}`}>
          <div className="row">
            <b className="grow">{p.name}{p.id === s.state.activeProfile ? <span className="badge accent" style={{ marginLeft: 8 }}>Active</span> : null}</b>
            {p.id !== s.state.activeProfile ? <button className="btn xs" onClick={() => void act(api.fw.setProfile(p.id))}>Use now</button> : null}
            <button className="btn xs ghost" onClick={() => setEdit(p)}>Edit</button>
          </div>
          <div className="small muted">
            {p.mode ? `${MODE_TEXT[p.mode][0]} · ` : ''}{p.groupsOff.length ? `Off: ${p.groupsOff.map((g) => s.state.groups.find((x) => x.id === g)?.name ?? g).join(', ')} · ` : 'All rule groups on · '}
            {p.auto?.ssids?.length ? `Wi-Fi: ${p.auto.ssids.join(', ')}` : ''}{p.auto?.gateways?.length ? ` Router: ${p.auto.gateways.join(', ')}` : ''}
          </div>
        </div>
      ))}
      <button className="btn" onClick={() => setEdit({ id: `p-${Date.now().toString(36)}`, name: 'New profile', groupsOff: [] })}><Icon name="plus" size={12} /> New profile</button>
      {edit ? (
        <Modal title="Profile" onClose={() => setEdit(null)}>
          <div className="fw-form">
            <label>Name<input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label>Mode<select className="input" value={edit.mode ?? ''} onChange={(e) => setEdit({ ...edit, mode: (e.target.value || undefined) as Mode | undefined })}><option value="">Same as overall</option>{(Object.keys(MODE_TEXT) as Mode[]).map((m) => <option key={m} value={m}>{MODE_TEXT[m][0]}</option>)}</select></label>
            <div>Rule groups on in this profile
              {s.state.groups.map((g) => <label key={g.id} className="row small"><input type="checkbox" checked={!edit.groupsOff.includes(g.id)} onChange={(e) => setEdit({ ...edit, groupsOff: e.target.checked ? edit.groupsOff.filter((x) => x !== g.id) : [...edit.groupsOff, g.id] })} /> {g.name}</label>)}
            </div>
            <label>Wi-Fi names (comma-separated)<input className="input" value={(edit.auto?.ssids ?? []).join(', ')} onChange={(e) => setEdit({ ...edit, auto: { ...edit.auto, ssids: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} /></label>
            <label>Router addresses (comma-separated)<input className="input" value={(edit.auto?.gateways ?? []).join(', ')} onChange={(e) => setEdit({ ...edit, auto: { ...edit.auto, gateways: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} /></label>
          </div>
          <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <button className="btn danger" onClick={() => void act(api.fw.removeProfile(edit.id)).then(() => setEdit(null))}>Delete</button>
            <button className="btn primary" onClick={() => void act(api.fw.saveProfile(edit)).then(() => setEdit(null))}>Save</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- DNS and blocklists

function Dns({ s, act }: { s: FwStatus; act: Act }) {
  const [log, setLog] = useState<QueryLogEntry[]>([]);
  const [domain, setDomain] = useState('');
  const [listUrl, setListUrl] = useState('');
  useEffect(() => { void api.fw.queryLog(300).then(setLog); const t = window.setInterval(() => document.visibilityState === 'visible' && void api.fw.queryLog(300).then(setLog), 4000); return () => clearInterval(t); }, []);
  const set = (p: Partial<FwStatus['settings']>) => act(api.fw.setSettings(p));
  return (
    <div className="fw-grid">
      <section className="card pad">
        <h3>DNS filter {s.dns.running ? <span className="badge accent">On · port {s.dns.port}</span> : <span className="badge">Off</span>}</h3>
        <label className="row fw-switch"><div className="grow"><b>Filter and encrypt DNS</b><div className="small muted">{s.dns.queries.toLocaleString()} questions, {s.dns.blocked.toLocaleString()} blocked · {s.dns.listsEntries.toLocaleString()} names on your lists</div></div><Toggle on={s.settings.dnsFilter} onChange={(v) => void set({ dnsFilter: v })} /></label>
        {s.dns.error ? <div className="small fw-note">{s.dns.error}</div> : null}
        <label className="fw-form">Ask<select className="input" value={s.settings.upstream} onChange={(e) => void set({ upstream: e.target.value })}>
          {s.upstreams.map((u) => <option key={u.id} value={u.id} disabled={u.kind === 'doq'}>{u.name}{u.kind === 'doh' ? ' — HTTPS' : u.kind === 'dot' ? ' — TLS' : u.kind === 'doq' ? ' — QUIC' : ''}</option>)}
        </select></label>
        <div className="small muted">DNS over QUIC is listed for later: this version of Keeper has no QUIC stack yet. DNS over HTTPS and TLS are fully encrypted.</div>
        <div className="row" style={{ gap: 6, marginTop: 10 }}>
          <input className="input grow" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <button className="btn sm danger" disabled={!domain} onClick={() => void act(api.fw.setDomain(domain, 'deny')).then(() => setDomain(''))}>Block</button>
          <button className="btn sm" disabled={!domain} onClick={() => void act(api.fw.setDomain(domain, 'allow')).then(() => setDomain(''))}>Always allow</button>
        </div>
      </section>
      <section className="card pad">
        <h3>Blocklists</h3>
        {s.settings.lists.map((l) => (
          <label key={l.id} className="row fw-switch">
            <div className="grow"><b>{l.name}</b> <span className="badge">{l.topic}</span><div className="small muted">{l.description}{l.entries ? ` · ${l.entries.toLocaleString()} entries` : ''}{l.updated ? ` · updated ${relativeTime(l.updated)}` : ''}{l.error ? ` · ${l.error}` : ''} · {l.licence}</div></div>
            <Toggle on={!!l.enabled} onChange={(v) => void set({ lists: s.settings.lists.map((x) => (x.id === l.id ? { ...x, enabled: v } : x)) })} />
          </label>
        ))}
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <input className="input grow" placeholder="Add a list: https://… (hosts, domains, ad-blocker or address format)" value={listUrl} onChange={(e) => setListUrl(e.target.value)} />
          <button className="btn sm" disabled={!/^https:\/\//.test(listUrl)} onClick={() => void act(api.fw.addList(listUrl)).then(() => setListUrl(''))}>Add</button>
          <button className="btn sm ghost" onClick={() => void act(api.fw.refreshLists())}>Update now</button>
        </div>
      </section>
      <section className="card pad" style={{ gridColumn: '1 / -1' }}>
        <h3>Questions asked</h3>
        {!log.length ? <div className="muted small">Nothing yet{s.dns.running ? '' : ' — the DNS filter is off'}.</div> : (
          <div className="fw-log">
            {log.map((e, i) => (
              <div key={i} className={`fw-log-row ${e.blockedBy ? 'blocked' : e.error ? 'err' : ''}`}>
                <span className="muted small">{new Date(e.t).toLocaleTimeString()}</span>
                <span className="ellipsis grow">{e.name} <span className="muted small">{e.type}</span></span>
                <span className="small ellipsis">{e.blockedBy ? `Blocked: ${e.blockedBy}` : e.error ? e.error : (e.answer ?? []).slice(0, 2).join(', ')}{e.cached ? ' · cached' : ''}</span>
                <span className="muted small num">{e.ms} ms</span>
                <button className="btn xs ghost" onClick={() => void act(api.fw.setDomain(e.name, e.blockedBy ? 'allow' : 'deny'))}>{e.blockedBy ? 'Allow' : 'Block'}</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- history

const SPANS: [string, number][] = [['Hour', 3600_000], ['Day', 86_400_000], ['Week', 7 * 86_400_000], ['Month', 30 * 86_400_000], ['3 months', 90 * 86_400_000], ['Year', 365 * 86_400_000]];

function HistoryTab() {
  const [span, setSpan] = useState(86_400_000);
  const [app, setApp] = useState<string | undefined>();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.fw.history>> | null>(null);
  useEffect(() => { const to = Date.now(); void api.fw.history(to - span, to, app).then(setData); }, [span, app]);
  if (!data) return <Loading label="Reading history…" />;
  const max = Math.max(1, ...data.points.map((p) => p.inB + p.outB));
  const total = data.points.reduce((a, p) => a + p.inB + p.outB, 0);
  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <div className="seg">{SPANS.map(([l, ms]) => <button key={l} className={span === ms ? 'on' : ''} onClick={() => setSpan(ms)}>{l}</button>)}</div>
        {app ? <button className="btn sm" onClick={() => setApp(undefined)}><Icon name="close" size={11} /> {app}</button> : null}
        <span className="grow" />
        <span className="small muted">{formatBytes(total)} in this time</span>
      </div>
      <div className="fw-chart card" role="img" aria-label={`Traffic chart, ${formatBytes(total)}`}>
        {data.points.map((p) => (
          <div key={p.t} className="fw-bar" title={`${new Date(p.t).toLocaleString()} · ↓ ${formatBytes(p.inB)} ↑ ${formatBytes(p.outB)}`}>
            <i className="in" style={{ height: `${(p.inB / max) * 100}%` }} />
            <i className="out" style={{ height: `${(p.outB / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="small muted" style={{ margin: '4px 0 12px' }}><span className="fw-key in" /> Received <span className="fw-key out" /> Sent · minutes for a day, hours for 90 days, days for a year</div>
      {!data.apps.length ? <Empty icon="chart" title="No history yet">Keeper adds to it while it watches the network.</Empty> : (
        <div className="fw-apps">
          {data.apps.map((a) => (
            <button key={a.app} className={`fw-app-row ${app === a.app ? 'on' : ''}`} onClick={() => setApp(app === a.app ? undefined : a.app)}>
              <b className="grow ellipsis">{a.app}</b>
              <span className="num small">↓ {formatBytes(a.inB)}</span>
              <span className="num small">↑ {formatBytes(a.outB)}</span>
              <span className="fw-share"><i style={{ width: `${((a.inB + a.outB) / (data.apps[0].inB + data.apps[0].outB)) * 100}%` }} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- alerts anywhere in Keeper

/** New connection alerts as a small card on any page (the Island also tells), and the sounds of rules that have one. */
export function FirewallAlerts() {
  const { route, go } = useStore();
  const [s, setS] = useState<FwStatus | null>(null);
  useEffect(() => {
    const load = () => void api.fw.status().then(setS).catch(() => undefined);
    load();
    const offA = api.on('fw-alert', load);
    const offC = api.on('fw-changed', load);
    const offE = api.on('fw-event', (e) => { setS((x) => { if (x && e.ruleId && x.settings.sounds[e.ruleId]) playSound(x.settings.sounds[e.ruleId], x.settings.soundByData ? e.bytes : undefined); return x; }); });
    return () => { offA(); offC(); offE(); };
  }, []);
  const [later, setLater] = useState<string | null>(null);
  const a = s?.pending[0];
  // The demo's sample alerts show on the Firewall page itself, not over every other page.
  if (!a || route.name === 'firewall' || later === a.id || isDemo) return null;
  const act: Act = (p) => p.then(setS).then(() => undefined);
  return (
    <div className="fw-popup" role="alertdialog" aria-label="New connection">
      <AlertCard a={a} act={act} go={go} />
      <div className="fw-popup-foot">
        <button className="btn xs ghost" onClick={() => setLater(a.id)} title="Keep it in the firewall's list and decide later">Later</button>
        {s!.pending.length > 1 ? <button className="btn xs ghost" onClick={() => go({ name: 'firewall' })}>{s!.pending.length - 1} more waiting…</button> : null}
      </div>
    </div>
  );
}

let ctx: AudioContext | undefined;
/** Short sounds made on the spot (no files); with "follow the data", more data plays a higher note. */
export function playSound(kind: 'tick' | 'chime' | 'buzz' | 'data', bytes?: number) {
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const base = kind === 'buzz' ? 140 : kind === 'chime' ? 880 : kind === 'data' ? 300 : 1400;
    o.type = kind === 'buzz' ? 'sawtooth' : 'sine';
    o.frequency.value = bytes ? base * Math.min(4, 1 + Math.log10(1 + bytes / 1024) / 3) : base;
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (kind === 'chime' ? 0.5 : 0.08));
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.5);
  } catch { /* no audio */ }
}
