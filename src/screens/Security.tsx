// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Privacy & Security: one score with the three things most worth doing, then
// the detail behind it — who can watch what, where apps and browsers connect,
// browser extensions, how secure the system is, malware protection with
// quarantine, what starts automatically, and a timeline of what happened.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConnectionsView, EngineStatus, SecurityOverview, SecuritySettings } from '../../core/api-security';
import { formatBytes, relativeTime } from '../../core/format';
import { byService, SERVICE_LABEL } from '../../core/security/permissions';
import type { BrowserProfile, Finding, PermissionGrant, PersistenceItem, QuarantineItem, ScanProgress, SecurityEvent, Severity } from '../../core/security/types';
import { api } from '../api';
import { KeeperOwnConnections } from '../components/UsageStatsPanel';
import { Icon } from '../components/Icon';
import { Empty, Loading, PageHead, Toggle } from '../components/ui';
import { Tabs } from '../components/Tabs';
import { openGuide } from '../guide';
import { useStore } from '../state';
import { Ring } from './Protection';
import '../styles/security.css';

type Tab = 'overview' | 'watch' | 'connections' | 'browsers' | 'checks' | 'malware' | 'startup' | 'timeline';

const TABS: { id: Tab; label: string; icon: string; area?: Finding['area'] }[] = [
  { id: 'overview', label: 'Overview', icon: 'shield' },
  { id: 'watch', label: 'Who can watch', icon: 'eye', area: 'permissions' },
  { id: 'connections', label: 'Connections', icon: 'globe', area: 'connections' },
  { id: 'browsers', label: 'Browsers', icon: 'app', area: 'browsers' },
  { id: 'checks', label: 'Security checks', icon: 'lock', area: 'posture' },
  { id: 'malware', label: 'Malware', icon: 'warning', area: 'malware' },
  { id: 'startup', label: 'Startup items', icon: 'power', area: 'persistence' },
  { id: 'timeline', label: 'Timeline', icon: 'history' },
];

const SEV: Record<Severity, { label: string; cls: string }> = {
  critical: { label: 'Critical', cls: 'sev-critical' },
  high: { label: 'High', cls: 'sev-high' },
  medium: { label: 'Medium', cls: 'sev-medium' },
  low: { label: 'Low', cls: 'sev-low' },
  info: { label: 'Info', cls: 'sev-info' },
};

const scoreColor = (s: number) => (s >= 90 ? 'var(--ok)' : s >= 70 ? 'var(--warn)' : 'var(--danger)');

export function Security() {
  const { route, go } = useStore();
  const [tab, setTab] = useState<Tab>((route.arg as Tab) || 'overview');
  const [ov, setOv] = useState<SecurityOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    try {
      setOv(await api.security.overview(refresh));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const off = api.on('security-event', () => void load());
    return off;
  }, [load]);

  useEffect(() => {
    if (route.name === 'security' && route.arg) setTab(route.arg as Tab);
  }, [route]);

  const switchTo = (t: Tab) => {
    setTab(t);
    go({ name: 'security', arg: t === 'overview' ? undefined : t });
  };

  return (
    <div className="sec">
      <PageHead title="Privacy & Security" sub="Who can see and hear you, where your data goes, and how well this computer is protected — in plain words, with fixes.">
        <button className="btn" onClick={() => void api.security.exportReport()}><Icon name="down" size={14} /> Save report</button>
        <button className="btn" onClick={() => void load(true)} disabled={busy}>{busy ? <div className="spinner" /> : <Icon name="refresh" size={14} />} Check again</button>
      </PageHead>
      <Tabs label="Privacy and security checks" value={tab} onChange={switchTo} items={TABS.map((t) => ({ id: t.id, text: t.label, label: <><Icon name={t.icon} size={14} /> {t.label}</>, badge: t.area && ov?.counts[t.area] ? ov.counts[t.area] : undefined }))} />
      {error ? <Empty icon="warning" title="Could not check">{error}</Empty> : null}
      {!ov && !error ? <Loading label="Looking at your computer…" /> : null}
      {ov ? (
        tab === 'overview' ? <Overview ov={ov} onTab={switchTo} reload={load} />
          : tab === 'watch' ? <Watch findings={ov.findings} reload={load} />
            : tab === 'connections' ? <Connections findings={ov.findings} reload={load} />
              : tab === 'browsers' ? <Browsers findings={ov.findings} reload={load} />
                : tab === 'checks' ? <Findings list={ov.findings.filter((f) => f.area === 'posture')} reload={load} empty="Everything checked here looks good." />
                  : tab === 'malware' ? <Malware ov={ov} reload={load} />
                    : tab === 'startup' ? <Startup findings={ov.findings} reload={load} />
                      : <Timeline />
      ) : null}
      <p className="small muted sec-honest"><Icon name="info" size={12} /> No security tool can promise to catch everything. Keeper layers several engines and checks and tells you which are working; keep your system updated and be careful with what you open.</p>
    </div>
  );
}

// ---------------------------------------------------------------- findings

function FindingRow({ f, reload }: { f: Finding; reload: (refresh?: boolean) => void }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const doFix = async () => {
    setBusy(true);
    try {
      const r = await api.security.fix(f.id);
      toast(r.message);
      reload(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`sec-finding ${f.ignored ? 'ignored' : ''}`}>
      <span className={`sec-sev ${SEV[f.severity].cls}`} title={SEV[f.severity].label} />
      <div className="grow">
        <div className="sec-finding-title">{f.title}{f.ignored ? <span className="badge">Ignored</span> : null}</div>
        <div className="small muted">{f.why}</div>
        {f.detail ? <div className="small sec-detail">{f.detail}</div> : null}
        {f.fix?.steps?.length ? <ol className="small sec-steps">{f.fix.steps.map((s, i) => <li key={i}>{s}</li>)}</ol> : null}
      </div>
      <div className="sec-actions">
        {f.fix && !f.ignored && (f.fix.action || f.fix.settings) ? <button className="btn sm primary" disabled={busy} onClick={() => void doFix()}>{busy ? <div className="spinner" /> : null}{f.fix.label}</button> : null}
        {/* The step-by-step guide (also in the To do list): the system's protections live under the guide's own ids. */}
        {!f.ignored && f.severity !== 'info' ? <button className="btn sm" onClick={() => openGuide(f.id.startsWith('protection.') ? `protection:${f.id.slice(11)}` : `security:${f.id}`)}>Show me how</button> : null}
        <button className="btn sm ghost" onClick={() => void api.security.ignore(f.id, !f.ignored).then(() => reload())}>{f.ignored ? 'Stop ignoring' : 'Ignore'}</button>
      </div>
    </div>
  );
}

function Findings({ list, reload, empty }: { list: Finding[]; reload: (refresh?: boolean) => void; empty: string }) {
  if (!list.length) return <div className="card pad sec-allgood"><Icon name="check" size={18} /> {empty}</div>;
  return <div className="card sec-findings">{list.map((f) => <FindingRow key={f.id} f={f} reload={reload} />)}</div>;
}

// ---------------------------------------------------------------- overview

function Overview({ ov, onTab, reload }: { ov: SecurityOverview; onTab: (t: Tab) => void; reload: (refresh?: boolean) => void }) {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  useEffect(() => {
    void api.security.events(6).then(setEvents);
  }, [ov]);
  return (
    <div className="sec-overview">
      <div className="sec-hero card pad">
        <Ring value={ov.score} color={scoreColor(ov.score)} label={String(ov.score)} sub="of 100" />
        <div className="grow">
          <h2 className="sec-label">{ov.label}</h2>
          <div className="small muted">Checked {ov.checkedAt ? relativeTime(ov.checkedAt) : 'just now'} · {ov.quarantined} in quarantine{ov.lastScan ? ` · last ${ov.lastScan.kind} scan ${relativeTime(ov.lastScan.at)}: ${ov.lastScan.found ? `${ov.lastScan.found} found` : 'nothing found'}` : ' · not scanned yet'}</div>
          <div className="sec-engines">{ov.engines.map((e) => <EngineChip key={e.id} e={e} />)}</div>
          {ov.notes.map((n, i) => <div key={i} className="small sec-note"><Icon name="info" size={12} /> {n}</div>)}
        </div>
      </div>
      <h3 className="sec-h">Most worth doing</h3>
      <Findings list={ov.top} reload={reload} empty="Nothing urgent. Well done." />
      <div className="sec-areas">
        {TABS.filter((t) => t.area).map((t) => {
          const n = ov.counts[t.area!];
          return (
            <button key={t.id} className="card pad sec-area" onClick={() => onTab(t.id)}>
              <Icon name={t.icon} size={18} />
              <div className="grow">
                <b>{t.label}</b>
                <div className="small muted">{n ? `${n} to look at` : 'Looks good'}</div>
              </div>
              <span className={`sec-dot ${n ? 'warn' : 'ok'}`} />
            </button>
          );
        })}
      </div>
      {events.length ? (
        <>
          <h3 className="sec-h">Recently</h3>
          <div className="card">{events.map((e) => <EventRow key={e.id} e={e} />)}</div>
        </>
      ) : null}
    </div>
  );
}

function EngineChip({ e }: { e: EngineStatus }) {
  return (
    <span className={`sec-engine ${e.state}`} title={e.detail}>
      <span className="sec-dot" /> {e.name}{e.state === 'missing' ? ' — not installed' : e.state === 'off' ? ' — off' : ''}
    </span>
  );
}

// ---------------------------------------------------------------- who can watch

function Watch({ findings, reload }: { findings: Finding[]; reload: (refresh?: boolean) => void }) {
  const { toast } = useStore();
  const [data, setData] = useState<{ grants: PermissionGrant[]; notes: string[]; platform: string } | null>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    void api.security.permissions().then(setData);
  }, []);
  const groups = useMemo(() => byService((data?.grants ?? []).filter((g) => !filter || g.app.toLowerCase().includes(filter.toLowerCase()))), [data, filter]);
  const revoke = async (g: PermissionGrant) => {
    const r = await api.security.revoke(g);
    toast(r.message);
    if (r.ok) setData(await api.security.permissions());
  };
  if (!data) return <Loading label="Reading permissions…" />;
  return (
    <div>
      <Findings list={findings.filter((f) => f.area === 'permissions')} reload={reload} empty="No app has a sensitive permission it should not." />
      {data.notes.map((n, i) => <div key={i} className="card pad small sec-note"><Icon name="info" size={12} /> {n}</div>)}
      <input className="input sec-filter" placeholder="Filter apps…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {!groups.length ? <Empty icon="eye" title="No permissions recorded">This system has no per-app list Keeper can read{data.platform === 'linux' ? ' (only sandboxed Flatpak apps have one)' : ''}.</Empty> : null}
      {groups.map((g) => (
        <div key={g.service} className="card sec-group">
          <div className="sec-group-head"><b>{g.label}</b><span className="small muted">{g.allowed.length} allowed{g.denied.length ? ` · ${g.denied.length} refused` : ''}</span></div>
          {[...g.allowed, ...g.denied].map((p, i) => (
            <div key={`${p.app}-${p.raw}-${i}`} className="sec-perm">
              <span className={`sec-dot ${p.allowed ? (p.inUse ? 'live' : 'warn') : 'off'}`} />
              <div className="grow">
                <div className="ellipsis">{p.app}{p.inUse ? <span className="badge sev-high-bg">In use now</span> : null}</div>
                <div className="small muted">{p.allowed ? 'Allowed' : 'Refused'}{p.lastUsed ? ` · last ${relativeTime(p.lastUsed)}` : ''}{p.path && p.path !== p.app ? ` · ${p.path}` : ''}</div>
              </div>
              {p.allowed ? <button className="btn sm" onClick={() => void revoke(p)}>Take away</button> : null}
            </div>
          ))}
        </div>
      ))}
      <p className="small muted">Labels follow the system: {Object.values(SERVICE_LABEL).slice(0, 6).join(', ')}…</p>
    </div>
  );
}

// ---------------------------------------------------------------- connections

function Connections({ findings, reload }: { findings: Finding[]; reload: (refresh?: boolean) => void }) {
  const { go } = useStore();
  const [c, setC] = useState<ConnectionsView | null>(null);
  useEffect(() => {
    void api.security.connections().then(setC);
  }, []);
  if (!c) return <Loading label="Looking at connections…" />;
  return (
    <div>
      <Findings list={findings.filter((f) => f.area === 'connections')} reload={reload} empty="Nothing sends data in the clear, and nothing unexpected listens to the network." />
      <div className="row sec-links">
        <button className="btn sm" onClick={() => go({ name: 'netactivity' })}><Icon name="globe" size={13} /> Network Activity and map</button>
        <button className="btn sm" onClick={() => go({ name: 'vpn' })}><Icon name="lock" size={13} /> VPN and leak checks</button>
      </div>
      <div style={{ margin: '12px 0' }}><KeeperOwnConnections /></div>
      <h3 className="sec-h">Apps and who they talk to</h3>
      {!c.apps.length ? <Empty icon="globe" title="No connections right now" /> : (
        <div className="card">
          {c.apps.slice(0, 60).map((a) => (
            <div key={a.app} className="sec-app">
              <div className="grow">
                <b>{a.app}</b>
                <div className="small muted">{a.destinations} place{a.destinations === 1 ? '' : 's'}{a.countries.length ? ` in ${a.countries.join(', ')}` : ''}{a.bytesOut ? ` · ${formatBytes(a.bytesOut)} sent` : ''}</div>
                <div className="sec-chips">
                  {a.trackers.map((t) => <span key={t.owner} className={`chip sec-tracker ${t.category}`} title={t.host}>{t.owner} · {t.category}</span>)}
                  {a.cleartext.map((x) => <span key={`${x.host}:${x.port}`} className="chip sec-clear" title="Not encrypted">{x.protocol} → {x.host}</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {c.listeners.length ? (
        <>
          <h3 className="sec-h">Programs that accept connections</h3>
          <div className="card">{c.listeners.map((l) => <div key={`${l.app}:${l.port}`} className="sec-app"><b>{l.app}</b><span className="small muted">port {l.port} on {l.address === '*' || l.address === '0.0.0.0' || l.address === '::' ? 'every network' : l.address}</span></div>)}</div>
        </>
      ) : null}
      <h3 className="sec-h">Sites and their third parties</h3>
      {c.sites.length ? (
        <div className="card">
          {c.sites.slice(0, 50).map((s) => (
            <div key={s.site} className="sec-app">
              <div className="grow">
                <b>{s.site}</b> <span className="small muted">{relativeTime(s.at)}{s.browser ? ` · ${s.browser}` : ''}</span>
                <div className="sec-chips">{s.thirdParties.slice(0, 24).map((t) => <span key={t.host} className={`chip ${t.tracker ? 'sec-tracker' : ''}`}>{t.host} ×{t.requests}</span>)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : <BrowserConnect connected={c.extensionConnected} />}
    </div>
  );
}

function BrowserConnect({ connected }: { connected: boolean }) {
  const { toast } = useStore();
  const [folder, setFolder] = useState<string | null>(null);
  return (
    <div className="card pad">
      <b>{connected ? 'The browser extension is connected' : 'See which third parties each site loads'}</b>
      <div className="small muted">Keeper’s optional browser extension reports, per site, which other sites and trackers it loaded. It only watches; reports stay on this computer. It needs access to all sites to do this.</div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm primary" onClick={async () => { const r = await api.security.installBrowserHost(); setFolder(r.extensionFolder); toast(r.installed.length ? `Connected ${r.installed.join(', ')}` : 'No supported browser found'); }}>Connect browsers</button>
        {folder ? <span className="small">Then load the extension from <code>{folder}</code> (see its README).</span> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- browsers

function Browsers({ findings, reload }: { findings: Finding[]; reload: (refresh?: boolean) => void }) {
  const [list, setList] = useState<BrowserProfile[] | null>(null);
  useEffect(() => {
    void api.security.browsers().then(setList);
  }, []);
  if (!list) return <Loading label="Looking at browsers…" />;
  return (
    <div>
      <Findings list={findings.filter((f) => f.area === 'browsers')} reload={reload} empty="No risky extensions found." />
      {!list.length ? <Empty icon="app" title="No browsers found" /> : null}
      {list.map((p) => (
        <div key={`${p.browser}-${p.path}`} className="card sec-group">
          <div className="sec-group-head">
            <b>{p.browser}</b><span className="small muted">{p.profile}</span>
            <span className="sec-chips">
              {p.savedPasswords ? <span className="chip">Saves passwords</span> : null}
              {p.signedInSync ? <span className="chip">Signed in, syncing</span> : null}
              {p.doh ? <span className={`chip ${p.doh === 'off' ? 'sec-clear' : ''}`}>Secure DNS: {p.doh}</span> : null}
            </span>
          </div>
          {!p.extensions.length ? <div className="small muted sec-perm">No extensions{p.engine === 'webkit' ? ' that Keeper can read (Safari keeps them inside apps)' : ''}.</div> : null}
          {[...p.extensions].sort((a, b) => b.risk - a.risk).map((e) => (
            <div key={e.id} className={`sec-perm ${e.enabled ? '' : 'dim'}`}>
              <div className="sec-risk" title={`Risk ${e.risk}/100`}><i style={{ width: `${e.risk}%`, background: e.risk >= 60 ? 'var(--danger)' : e.risk >= 35 ? 'var(--warn)' : 'var(--ok)' }} /></div>
              <div className="grow">
                <div className="ellipsis"><b>{e.name}</b> {e.version ? <span className="small muted">{e.version}</span> : null}{!e.enabled ? <span className="badge">Off</span> : null}{e.knownBad ? <span className="badge sev-critical-bg">Malicious</span> : null}</div>
                <div className="small muted">{e.reasons.length ? `It ${e.reasons.join('; ')}.` : 'Asks for nothing sensitive.'}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
      <PasswordCheck />
    </div>
  );
}

function PasswordCheck() {
  const [pw, setPw] = useState('');
  const [res, setRes] = useState<string | null>(null);
  const check = async () => {
    try {
      const r = await api.security.checkPassword(pw);
      setRes(r.count ? `Seen ${r.count.toLocaleString()} times in data breaches. Do not use it anywhere.` : 'Not found in any known breach.');
    } catch (e) {
      setRes(e instanceof Error ? e.message : String(e));
    }
    setPw('');
  };
  return (
    <div className="card pad">
      <b>Has a password leaked?</b>
      <div className="small muted">Checked against breached passwords without sending it: only the first five characters of its fingerprint leave this computer (Pwned Passwords).</div>
      <div className="row" style={{ marginTop: 8 }}>
        <input className="input grow" type="password" value={pw} placeholder="Type a password" onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pw && void check()} />
        <button className="btn" disabled={!pw} onClick={() => void check()}>Check</button>
      </div>
      {res ? <div className="small" style={{ marginTop: 6 }}>{res}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- malware

function Malware({ ov, reload }: { ov: SecurityOverview; reload: (refresh?: boolean) => void }) {
  const { toast } = useStore();
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [scans, setScans] = useState<ScanProgress[]>([]);
  const [q, setQ] = useState<QuarantineItem[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const [s, sc, qq] = await Promise.all([api.security.settings(), api.security.scans(), api.security.quarantine()]);
    setSettings(s);
    setScans(sc);
    setQ(qq);
  }, []);
  useEffect(() => {
    void refresh();
    const off1 = api.on('security-scan', (p) => setScans((list) => [p, ...list.filter((x) => x.id !== p.id)]));
    const off2 = api.on('security-event', () => void refresh());
    return () => { off1(); off2(); };
  }, [refresh]);
  const set = async (p: Partial<SecuritySettings>) => setSettings(await api.security.setSettings(p));
  const run = async (label: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    setWorking(label);
    try {
      toast((await fn()).message);
      reload(true);
    } finally {
      setWorking(null);
    }
  };
  const current = scans.find((s) => s.state === 'running');
  const clam = ov.engines.find((e) => e.id === 'clamav');
  return (
    <div>
      <Findings list={ov.findings.filter((f) => f.area === 'malware')} reload={reload} empty="Protection is on and nothing has been found." />
      <div className="card pad sec-scan">
        <div className="grow">
          <b>{current ? `${current.kind === 'quick' ? 'Quick' : current.kind === 'full' ? 'Full' : 'Custom'} scan running` : 'Scan'}</b>
          <div className="small muted">{current ? `${current.files.toLocaleString()} files · ${formatBytes(current.bytes)}${current.detections.length ? ` · ${current.detections.length} found` : ''}${current.message ? ` · ${current.message}` : ''}` : 'Quick looks where malware usually arrives; Full checks everything in your home folder.'}</div>
          {current?.current ? <div className="small ellipsis sec-detail">{current.current}</div> : null}
        </div>
        {current ? <button className="btn danger" onClick={() => void api.security.stopScan(current.id)}>Stop</button> : (
          <div className="btn-row">
            <button className="btn primary" onClick={() => void api.security.scan('quick')}>Quick scan</button>
            <button className="btn" onClick={() => void api.security.scan('full')}>Full scan</button>
            <button className="btn" onClick={async () => { const f = await api.settings.pickFolder(); if (f) await api.security.scan('custom', [f]); }}>Scan a folder…</button>
          </div>
        )}
      </div>
      {settings ? (
        <div className="card sec-settings">
          <label className="sec-set"><div className="grow"><b>Real-time protection</b><div className="small muted">Checks new files in Downloads, Desktop and Documents as they arrive.</div></div><Toggle on={settings.realtime} onChange={(v) => void set({ realtime: v })} /></label>
          <label className="sec-set"><div className="grow"><b>Quarantine automatically</b><div className="small muted">Certain detections are encrypted away at once; hints wait for you.</div></div><Toggle on={settings.autoQuarantine} onChange={(v) => void set({ autoQuarantine: v })} /></label>
          <label className="sec-set"><div className="grow"><b>Watch for new startup items</b><div className="small muted">Malware often sets itself up to start with the computer.</div></div><Toggle on={settings.persistenceAlerts} onChange={(v) => void set({ persistenceAlerts: v })} /></label>
          <label className="sec-set"><div className="grow"><b>Watch for miners</b><div className="small muted">Programs using your processor to mine cryptocurrency, or running from temporary folders.</div></div><Toggle on={settings.behaviour} onChange={(v) => void set({ behaviour: v })} /></label>
          <label className="sec-set"><div className="grow"><b>Look up fingerprints online</b><div className="small muted">Asks MalwareBazaar (abuse.ch) about a file’s SHA-256 only. Off by default.</div></div><Toggle on={settings.hashLookups} onChange={(v) => void set({ hashLookups: v })} /></label>
          <label className="sec-set"><div className="grow"><b>Scheduled scan</b><div className="small muted">A quick scan when the computer is idle.</div></div>
            <select className="input" value={settings.schedule} onChange={(e) => void set({ schedule: e.target.value as SecuritySettings['schedule'] })}><option value="off">Off</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select>
          </label>
          <div className="sec-set">
            <div className="grow"><b>ClamAV signatures</b><div className="small muted">{clam?.detail}</div></div>
            {clam?.state === 'missing' ? <button className="btn sm primary" disabled={!!working} onClick={() => void run('install', () => api.security.installClamav())}>{working === 'install' ? <div className="spinner" /> : null} Install ClamAV</button>
              : <button className="btn sm" disabled={!!working} onClick={() => void run('update', () => api.security.updateSignatures())}>{working === 'update' ? <div className="spinner" /> : null} Update now</button>}
          </div>
          <Sources settings={settings} onChange={set} />
        </div>
      ) : null}
      <h3 className="sec-h">Quarantine</h3>
      {!q.length ? <div className="card pad small muted">Nothing in quarantine.</div> : (
        <div className="card">
          {q.map((it) => (
            <div key={it.id} className="sec-perm">
              <Icon name="lock" size={16} />
              <div className="grow">
                <div className="ellipsis"><b>{it.name}</b> <span className="small muted">{formatBytes(it.size)} · {relativeTime(it.at)}</span></div>
                <div className="small muted ellipsis">{it.detections.map((d) => d.name).join(', ') || 'Moved by hand'} · was in {it.originalPath}</div>
              </div>
              <button className="btn sm" onClick={async () => { const r = await api.security.restore(it.id); toast(`Put back: ${r.path}`); void refresh(); }}>Put back</button>
              <button className="btn sm danger" onClick={async () => { await api.security.deleteQuarantined(it.id); void refresh(); }}>Delete</button>
            </div>
          ))}
        </div>
      )}
      <h3 className="sec-h">Recent scans</h3>
      {scans.filter((s) => s.state !== 'running').slice(0, 8).map((s) => (
        <div key={s.id} className="small sec-scanrow">{s.kind} · {relativeTime(s.started)} · {s.files.toLocaleString()} files · {s.detections.length ? `${s.detections.length} found` : 'nothing found'} · {s.state}</div>
      ))}
    </div>
  );
}

function Sources({ settings, onChange }: { settings: SecuritySettings; onChange: (p: Partial<SecuritySettings>) => void }) {
  const [text, setText] = useState(settings.ruleSources.join('\n'));
  const [trackers, setTrackers] = useState(settings.trackerLists.join('\n'));
  const [ext, setExt] = useState(settings.extensionLists.join('\n'));
  const split = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  return (
    <details className="sec-set sec-sources">
      <summary><b>Extra rules and lists</b> <span className="small muted">YARA rule files, malware hash lists, tracker lists, malicious-extension lists (one file path or URL per line)</span></summary>
      <label className="small">YARA rules or SHA-256 lists<textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <label className="small">Tracker lists (Disconnect services.json or domain lists)<textarea className="input" rows={2} value={trackers} onChange={(e) => setTrackers(e.target.value)} /></label>
      <label className="small">Malicious extension ids (JSON: {'{ "id": "reason" }'})<textarea className="input" rows={2} value={ext} onChange={(e) => setExt(e.target.value)} /></label>
      <button className="btn sm" onClick={() => onChange({ ruleSources: split(text), trackerLists: split(trackers), extensionLists: split(ext) })}>Save and download</button>
    </details>
  );
}

// ---------------------------------------------------------------- startup items

function Startup({ findings, reload }: { findings: Finding[]; reload: (refresh?: boolean) => void }) {
  const { go } = useStore();
  const [items, setItems] = useState<PersistenceItem[] | null>(null);
  useEffect(() => {
    void api.security.persistence().then(setItems);
  }, []);
  return (
    <div>
      <Findings list={findings.filter((f) => f.area === 'persistence')} reload={reload} empty="Nothing new has been set to start automatically this week." />
      <div className="row sec-links"><button className="btn sm" onClick={() => go({ name: 'startup' })}><Icon name="power" size={13} /> Manage startup items</button></div>
      {!items ? <Loading /> : !items.length ? <Empty icon="power" title="Nothing found yet" /> : (
        <div className="card">
          {items.map((i) => (
            <div key={i.id} className="sec-perm">
              <span className={`sec-dot ${i.signed === false ? 'warn' : 'ok'}`} />
              <div className="grow">
                <div className="ellipsis"><b>{i.name}</b> <span className="small muted">{i.kind.replace(/-/g, ' ')} · first seen {relativeTime(i.firstSeen)}</span></div>
                <div className="small muted ellipsis">{i.command ?? i.location}{i.signer ? ` · signed by ${i.signer}` : i.signed === false ? ' · not signed' : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- timeline

function EventRow({ e }: { e: SecurityEvent }) {
  return (
    <div className="sec-event">
      <span className={`sec-sev ${SEV[e.severity].cls}`} />
      <div className="grow">
        <div>{e.title}</div>
        {e.detail ? <div className="small muted">{e.detail}</div> : null}
      </div>
      <span className="small muted">{relativeTime(e.at)}</span>
    </div>
  );
}

function Timeline() {
  const [list, setList] = useState<SecurityEvent[] | null>(null);
  useEffect(() => {
    void api.security.events(300).then(setList);
    return api.on('security-event', (e) => setList((l) => [e, ...(l ?? [])]));
  }, []);
  if (!list) return <Loading />;
  if (!list.length) return <Empty icon="history" title="Nothing has happened yet">Detections, quarantines, new startup items, camera and microphone use and scans show up here.</Empty>;
  return <div className="card">{list.map((e) => <EventRow key={e.id} e={e} />)}</div>;
}
