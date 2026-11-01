// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Network Activity: which app talks to whom, how much, and which way the
// traffic leaves the computer (through a VPN, straight out through the router,
// or only on the local network). Readings happen only while this page is open.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoStatus, NetHealth, NetSettings, VpnStatus } from '../../core/api-net';
import { formatBytes } from '../../core/format';
import { portName, type AppTraffic, type DestTraffic, type FlowRow, type NetSample } from '../../core/net/flows';
import { flag } from '../../core/net/geo';
import type { PathKind } from '../../core/net/route';
import { api } from '../api';
import { Sparkline } from '../components/Chart';
import { homePoint, WorldMap, type MapPoint } from '../components/WorldMap';
import { Icon } from '../components/Icon';
import { Empty, Loading, Modal, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/net.css';
import { MeshTag } from './MeshParts';

type Tab = 'apps' | 'dests' | 'conns' | 'map' | 'health';
type Scope = 'all' | 'internet' | 'lan' | 'listening';

const rate = (b?: number) => (b === undefined ? '—' : b < 1 ? '0' : `${formatBytes(b)}/s`);
const amount = (b?: number) => (b === undefined ? '—' : formatBytes(b));

function remembered<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const set = useCallback((x: T) => {
    setV(x);
    try {
      localStorage.setItem(key, JSON.stringify(x));
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  return [v, set];
}

export function PathBadge({ path, iface }: { path: PathKind; iface?: string }) {
  const label = path === 'vpn' ? 'VPN' : path === 'direct' ? 'Direct' : path === 'lan' ? 'Local network' : 'This computer';
  const tip = path === 'vpn' ? `Through the VPN${iface ? ` (${iface})` : ''}` : path === 'direct' ? `Straight out through ${iface ?? 'the router'}, not through a VPN` : path === 'lan' ? `Stays on your local network${iface ? ` (${iface})` : ''}` : 'Stays on this computer';
  return <span className={`badge path-${path}`} title={tip}>{path === 'vpn' ? <Icon name="lock" size={10} /> : null}{label}</span>;
}

function Where({ f }: { f: { remote?: string; host?: string; service?: string; country?: string; remotePort?: number; proto?: string } }) {
  if (!f.remote) return <span className="muted">—</span>;
  return (
    <span className="where">
      {f.country ? <span className="flag" title={f.country}>{flag(f.country)}</span> : null}
      <span className="ellipsis">
        {f.service ? <b>{f.service}</b> : null}
        {f.service ? ' · ' : ''}
        <span className={f.host ? '' : 'mono'}>{f.host ?? f.remote}</span>
        {f.remotePort ? <span className="muted">:{f.remotePort}</span> : null}
        <MeshTag ip={f.remote} />
      </span>
    </span>
  );
}

function scopeMatch(s: FlowRow['scope'], want: Scope) {
  if (want === 'all') return true;
  if (want === 'listening') return s === 'listening';
  if (want === 'internet') return s === 'internet';
  return s === 'lan' || s === 'link' || s === 'multicast';
}

export function NetActivity() {
  const { toast, go } = useStore();
  const [tab, setTab] = remembered<Tab>('net.tab', 'apps');
  const [scope, setScope] = remembered<Scope>('net.scope', 'all');
  const [every, setEvery] = remembered<number>('net.every', 2000);
  const [paused, setPaused] = useState(false);
  const [q, setQ] = useState('');
  const [s, setS] = useState<NetSample | null>(null);
  const [hist, setHist] = useState<{ vin: number; vout: number; oin: number; oout: number }[]>([]);
  const [vpn, setVpn] = useState<VpnStatus | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const iconAsked = useRef(new Set<string>());

  // Read only while the page is open and the window is visible.
  useEffect(() => {
    if (paused) return;
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const x = await api.net.sample();
          if (!alive) return;
          setS(x);
          setHist((h) => [...h.slice(-59), { vin: x.totals.vpnIn, vout: x.totals.vpnOut, oin: Math.max(0, x.totals.otherIn - x.totals.vpnIn), oout: Math.max(0, x.totals.otherOut - x.totals.vpnOut) }]);
        } catch {
          /* the next reading will try again */
        }
      }
      if (alive) timer = window.setTimeout(tick, every);
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [paused, every]);

  useEffect(() => {
    let alive = true;
    const load = () => void api.net.vpnStatus().then((v) => alive && setVpn(v)).catch(() => undefined);
    load();
    const h = window.setInterval(load, 15_000);
    return () => { alive = false; clearInterval(h); };
  }, []);

  // App icons, asked once per program.
  useEffect(() => {
    if (!s) return;
    const want = s.apps.map((a) => a.appPath).filter((p): p is string => !!p && !iconAsked.current.has(p));
    if (!want.length) return;
    want.forEach((p) => iconAsked.current.add(p));
    void api.net.icons(want).then((r) => setIcons((m) => ({ ...m, ...r }))).catch(() => undefined);
  }, [s]);

  const flows = useMemo(() => {
    if (!s) return [];
    const t = q.trim().toLowerCase();
    return s.flows.filter((f) => scopeMatch(f.scope, scope) && (!t || [f.app, f.remote, f.host, f.service, f.country, f.asn, String(f.pid ?? ''), String(f.remotePort ?? ''), String(f.localPort)].some((x) => x?.toLowerCase().includes(t))));
  }, [s, q, scope]);

  const apps = useMemo(() => (s ? s.apps.filter((a) => flows.some((f) => f.app === a.app)) : []), [s, flows]);
  const dests = useMemo(() => (s ? s.dests.filter((d) => flows.some((f) => f.remote === d.remote)) : []), [s, flows]);

  const exportCsv = async () => {
    const p = await api.net.exportCsv();
    if (p) toast(`Saved ${p}`);
  };

  const v = vpn?.verdict;
  const pathTone = !v ? '' : !v.vpnUp ? 'neutral' : v.allV4 && v.allV6 && !v.dnsOutside.length ? 'good' : 'warn';
  const last = hist[hist.length - 1];
  const downNow = s ? s.totals.rateIn : 0;
  const upNow = s ? s.totals.rateOut : 0;

  return (
    <div className="net-page">
      <PageHead title="Network Activity" sub="Which app talks to whom, how much, and whether it goes through your VPN or straight out through your router">
        <button className="btn" onClick={() => go({ name: 'vpn' })}><Icon name="lock" size={13} /> VPN</button>
      </PageHead>

      <div className="net-cards">
        <div className="card net-card">
          <div className="small muted">Download</div>
          <div className="net-big">{rate(downNow)}</div>
          <Sparkline values={hist.map((h) => h.vin + h.oin)} color="var(--accent)" />
          <div className="small muted">{last ? <>VPN {rate(last.vin)} · outside {rate(last.oin)}</> : '…'}</div>
        </div>
        <div className="card net-card">
          <div className="small muted">Upload</div>
          <div className="net-big">{rate(upNow)}</div>
          <Sparkline values={hist.map((h) => h.vout + h.oout)} color="#22c55e" />
          <div className="small muted">{last ? <>VPN {rate(last.vout)} · outside {rate(last.oout)}</> : '…'}</div>
        </div>
        <div className={`card net-card path ${pathTone}`}>
          <div className="small muted">Where traffic goes</div>
          <div className="net-path-line">
            <Icon name={pathTone === 'good' ? 'lock' : pathTone === 'warn' ? 'warning' : 'globe'} size={16} />
            <b>{!v ? 'Checking…' : !v.vpnUp ? 'No VPN' : pathTone === 'good' ? 'All through the VPN' : 'Partly outside the VPN'}</b>
          </div>
          <div className="small">{v?.summary ?? ''}</div>
        </div>
        <div className="card net-card">
          <div className="small muted">Right now</div>
          <div className="net-big">{s ? s.apps.filter((a) => a.conns > 0).length : '…'} <span className="small muted">apps</span></div>
          <div className="small muted">{s ? <>{s.dests.filter((d) => d.scope === 'internet').length} internet destinations · {s.flows.filter((f) => f.scope !== 'listening').length} connections · {s.flows.filter((f) => f.scope === 'listening').length} listening</> : ''}</div>
        </div>
      </div>

      {s?.notes.length ? <div className="net-note small"><Icon name="info" size={13} /> {s.notes.join(' ')}</div> : null}

      <div className="procs-bar">
        <div className="seg" role="tablist">
          {([['apps', 'Apps'], ['dests', 'Destinations'], ['conns', 'Connections'], ['map', 'Map'], ['health', 'Health']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        {tab !== 'health' ? (
          <>
            <label className="search-box"><Icon name="search" size={13} /><input placeholder="Filter by app, address, host, country, port" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <div className="seg" title="Which connections to show">
              {([['all', 'All'], ['internet', 'Internet'], ['lan', 'Local network'], ['listening', 'Listening']] as const).map(([k, l]) => (
                <button key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{l}</button>
              ))}
            </div>
          </>
        ) : null}
        <span className="grow" />
        <select className="input sm" value={every} onChange={(e) => setEvery(Number(e.target.value))} title="How often to read">
          <option value={1000}>Every second</option>
          <option value={2000}>Every 2 seconds</option>
          <option value={5000}>Every 5 seconds</option>
        </select>
        <button className="btn sm" onClick={() => setPaused(!paused)}><Icon name={paused ? 'play' : 'pause'} size={12} /> {paused ? 'Resume' : 'Pause'}</button>
        <button className="btn sm" onClick={() => void exportCsv()} title="Save the connections as a spreadsheet (CSV)"><Icon name="down" size={12} /> Export</button>
        <button className="btn sm icon" onClick={() => setSettingsOpen(true)} title="Options"><Icon name="settings" size={13} /></button>
      </div>

      {!s ? <Loading label="Reading connections…" /> : tab === 'apps' ? (
        <AppsTable apps={apps} flows={flows} open={open} setOpen={setOpen} icons={icons} amounts={s.amounts} />
      ) : tab === 'dests' ? (
        <DestTable dests={dests} amounts={s.amounts} />
      ) : tab === 'conns' ? (
        <ConnTable flows={flows} amounts={s.amounts} />
      ) : tab === 'map' ? (
        <NetMap flows={flows} apps={apps.map((a) => a.app)} />
      ) : (
        <Health sample={s} vpn={vpn} />
      )}

      {settingsOpen ? <NetOptions onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

function AppsTable({ apps, flows, open, setOpen, icons, amounts }: { apps: AppTraffic[]; flows: FlowRow[]; open: string | null; setOpen: (a: string | null) => void; icons: Record<string, string>; amounts: NetSample['amounts'] }) {
  const { go } = useStore();
  if (!apps.length) return <Empty icon="globe" title="Nothing matches">No app has a connection like that right now.</Empty>;
  const perConn = amounts === 'connection';
  return (
    <div className="net-table">
      <div className="net-row head apps"><span>App</span><span className="num">Connections</span><span className="num">Places</span><span className="num">Down</span><span className="num">Up</span><span className="num">So far</span><span>Path</span></div>
      {apps.map((a) => {
        const on = open === a.app;
        const mine = on ? flows.filter((f) => f.app === a.app) : [];
        return (
          <Fragment key={a.app}>
            <button className={`net-row apps ${on ? 'on' : ''}`} onClick={() => setOpen(on ? null : a.app)} aria-expanded={on}>
              <span className="net-app">
                <Icon name={on ? 'chevronDown' : 'chevronRight'} size={12} />
                {a.appPath && icons[a.appPath] ? <img src={icons[a.appPath]} width={16} height={16} alt="" /> : <span className="proc-glyph"><Icon name="app" size={11} /></span>}
                <span className="ellipsis"><b>{a.app}</b></span>
                {a.countries.slice(0, 4).map((c) => <span key={c} className="flag" title={c}>{flag(c)}</span>)}
              </span>
              <span className="num">{a.conns}{a.listening ? <span className="muted"> +{a.listening}</span> : null}</span>
              <span className="num">{a.dests || '—'}</span>
              <span className="num">{perConn ? rate(a.rateIn) : '—'}</span>
              <span className="num">{perConn ? rate(a.rateOut) : '—'}</span>
              <span className="num">{perConn ? amount((a.bytesIn ?? 0) + (a.bytesOut ?? 0)) : '—'}</span>
              <span className="paths">{a.paths.map((p) => <PathBadge key={p} path={p} />)}{a.listening && !a.conns ? <span className="badge">Listening</span> : null}</span>
            </button>
            {on ? (
              <div className="net-sub">
                <div className="btn-row" style={{ padding: '4px 8px' }}><button className="btn ghost sm" onClick={() => go({ name: 'appcontrols', arg: a.appPath ?? a.app })}><Icon name="settings" size={12} /> App settings: block, limit bandwidth, route through VPN…</button></div>
                {mine.some((f) => f.country) ? <div className="net-sub-map"><WorldMap points={mapPoints(mine)} home={homePoint()} height={170} /></div> : null}
                {mine.map((f) => (
                  <div key={f.key} className="net-row sub">
                    <span><Where f={f} /></span>
                    <span className="muted small">{f.proto}{f.remotePort ? ` · ${portName(f.remotePort, f.proto) ?? `port ${f.remotePort}`}` : f.scope === 'listening' ? ` · listening on ${f.localPort}` : ''}</span>
                    <span className="small muted ellipsis">{f.asn ?? ''}</span>
                    <span className="num">{perConn ? rate(f.rateIn) : '—'}</span>
                    <span className="num">{perConn ? rate(f.rateOut) : '—'}</span>
                    <span>{f.scope === 'listening' ? <span className="badge">Listening</span> : <PathBadge path={f.path} iface={f.iface} />}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

function DestTable({ dests, amounts }: { dests: DestTraffic[]; amounts: NetSample['amounts'] }) {
  if (!dests.length) return <Empty icon="globe" title="No destinations">Nothing is connected to another computer right now.</Empty>;
  const perConn = amounts === 'connection';
  return (
    <div className="net-table">
      <div className="net-row head dests"><span>Destination</span><span>Network</span><span>Apps</span><span className="num">Down</span><span className="num">Up</span><span>Path</span></div>
      {dests.map((d) => (
        <div key={d.remote} className="net-row dests">
          <span><Where f={{ remote: d.remote, host: d.host, service: d.service, country: d.country }} /><span className="muted small"> {d.ports.slice(0, 3).map((p) => portName(p) ?? p).join(', ')}</span></span>
          <span className="small muted ellipsis" title={d.asn}>{d.asn ?? (d.scope === 'lan' ? 'Local network' : d.scope === 'multicast' ? 'Local broadcast' : '')}</span>
          <span className="ellipsis">{d.apps.join(', ')}</span>
          <span className="num">{perConn ? rate(d.rateIn) : '—'}</span>
          <span className="num">{perConn ? rate(d.rateOut) : '—'}</span>
          <span><PathBadge path={d.path} iface={d.iface} /></span>
        </div>
      ))}
    </div>
  );
}

function ConnTable({ flows, amounts }: { flows: FlowRow[]; amounts: NetSample['amounts'] }) {
  if (!flows.length) return <Empty icon="globe" title="No connections">Nothing matches.</Empty>;
  const perConn = amounts === 'connection';
  const shown = flows.slice(0, 600);
  return (
    <div className="net-table">
      <div className="net-row head conns"><span>App</span><span>Local</span><span>Remote</span><span>State</span><span>Via</span><span className="num">Down</span><span className="num">Up</span></div>
      {shown.map((f) => (
        <div key={f.key} className="net-row conns">
          <span className="ellipsis"><b>{f.app}</b>{f.pid !== undefined ? <span className="muted"> · {f.pid}</span> : null}</span>
          <span className="mono small ellipsis">{f.proto} {f.family === 6 ? `[${f.local}]` : f.local}:{f.localPort}</span>
          <span><Where f={f} /></span>
          <span className="small muted">{f.state ?? (f.proto === 'UDP' ? 'UDP' : '')}</span>
          <span className="small">{f.scope === 'listening' ? 'listening' : <><PathBadge path={f.path} iface={f.iface} /> <span className="muted">{f.iface ?? ''}</span></>}</span>
          <span className="num">{perConn ? rate(f.rateIn) : '—'}</span>
          <span className="num">{perConn ? rate(f.rateOut) : '—'}</span>
        </div>
      ))}
      {flows.length > shown.length ? <div className="small muted" style={{ padding: 10 }}>{flows.length - shown.length} more — use the filter to narrow down, or Export for all of them.</div> : null}
    </div>
  );
}

function ms(v: number | null | undefined) {
  return v === null || v === undefined ? 'no answer' : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
}

function lossOf(list: (number | null)[]) {
  if (!list.length) return undefined;
  return Math.round((list.filter((x) => x === null).length / list.length) * 100);
}

function Health({ sample, vpn }: { sample: NetSample; vpn: VpnStatus | null }) {
  const [h, setH] = useState<NetHealth | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        const x = await api.net.health().catch(() => null);
        if (alive && x) setH(x);
      }
      if (alive) timer = window.setTimeout(tick, 3000);
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  const kinds = new Map(sample.ifaces.map((i) => [i.name, i.kind]));
  const viaVpn = (iface?: string) => !!iface && (kinds.get(iface) === 'vpn' || kinds.get(iface) === 'tunnel');
  if (!h) return <Loading label="Checking the connection…" />;
  const ifaces = sample.ifaces.filter((i) => i.kind !== 'loopback' && (i.up || i.addresses.length));
  return (
    <div className="net-health">
      <div className="card pad">
        <h3>Latency</h3>
        <div className="net-lat">
          <div>
            <div className="small muted">To your router {h.gateway ? <span className="mono">({h.gateway})</span> : null}</div>
            <div className="net-big">{ms(h.gatewayMs[h.gatewayMs.length - 1])}</div>
            <Sparkline values={h.gatewayMs} color="#22c55e" />
            <div className="small muted">{lossOf(h.gatewayMs) !== undefined ? `${lossOf(h.gatewayMs)}% without answer` : ''}</div>
          </div>
          <div>
            <div className="small muted">To the internet <span className="mono">({h.probeHost})</span></div>
            <div className="net-big">{ms(h.internetMs[h.internetMs.length - 1])}</div>
            <Sparkline values={h.internetMs} color="var(--accent)" />
            <div className="small muted">{lossOf(h.internetMs) !== undefined ? `${lossOf(h.internetMs)}% without answer` : ''}</div>
          </div>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>Measured by opening a connection and timing the answer, every 3 seconds while this tab is open. A refusal still counts as an answer.</div>
      </div>

      <div className="card pad">
        <h3>Interfaces</h3>
        <table className="net-kv">
          <tbody>
            {ifaces.map((i) => (
              <tr key={i.name}>
                <td><b>{i.label ?? i.name}</b> <span className="muted mono small">{i.name}</span> <MeshTag iface={i.name} />{i.kind === 'vpn' ? <span className="badge path-vpn"><Icon name="lock" size={10} />VPN</span> : null}{!i.up ? <span className="badge">down</span> : null}</td>
                <td className="mono small">{i.addresses.map((a) => `${a.address}${a.prefix !== undefined ? `/${a.prefix}` : ''}`).join(', ') || '—'}</td>
                <td className="num small">↓ {rate(i.rxRate)} · ↑ {rate(i.txRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card pad">
        <h3>DNS (name lookups)</h3>
        {h.dns.length ? (
          <table className="net-kv">
            <tbody>
              {h.dns.map((d, i) => (
                <tr key={i}>
                  <td className="mono">{d.address}</td>
                  <td className="small muted">{d.domain ? `only for ${d.domain}` : 'all names'}{d.iface ? ` · ${d.iface}` : ''}</td>
                  <td>{vpn?.verdict.vpnUp ? (viaVpn(d.iface) ? <span className="badge path-vpn"><Icon name="lock" size={10} />Through VPN</span> : <span className="badge warn">Outside VPN</span>) : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="small muted">The system did not say which DNS servers it uses.</div>}
      </div>

      {h.wifi ? (
        <div className="card pad">
          <h3>Wi-Fi</h3>
          <div className="net-wifi">
            <div><span className="muted small">Network</span><b>{h.wifi.ssid ?? '—'}</b></div>
            <div><span className="muted small">Signal</span><b>{h.wifi.signal !== undefined ? `${h.wifi.signal}%` : h.wifi.signalDbm !== undefined ? `${h.wifi.signalDbm} dBm` : '—'}</b></div>
            <div><span className="muted small">Channel</span><b>{h.wifi.channel ?? '—'}</b></div>
            <div><span className="muted small">Speed</span><b>{h.wifi.rate ?? '—'}</b></div>
            <div><span className="muted small">Security</span><b>{h.wifi.security ?? '—'}</b></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NetOptions({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<NetSettings | null>(null);
  const [geo, setGeo] = useState<GeoStatus | null>(null);
  useEffect(() => {
    void api.net.settings().then(setSt);
    void api.net.geoStatus().then(setGeo);
  }, []);
  useEffect(() => {
    if (geo?.state !== 'downloading') return;
    const h = window.setInterval(() => void api.net.geoStatus().then(setGeo), 700);
    return () => clearInterval(h);
  }, [geo?.state]);
  const set = async (p: Partial<NetSettings>) => setSt(await api.net.setSettings(p));
  if (!st) return null;
  return (
    <Modal title="Network Activity options" onClose={onClose} width={560}>
      <div className="net-opts">
        <label className="row"><div className="grow"><b>Show host names</b><div className="small muted">Asks your normal DNS server for the name behind each address (reverse lookup), and remembers it for an hour.</div></div><Toggle on={st.hostNames} onChange={(v) => void set({ hostNames: v })} /></label>
        <div className="row">
          <div className="grow">
            <b>Countries and networks</b>
            <div className="small muted">Shows the country and owner of each internet address from a table kept on this computer. The table (about 12 MB to download, from DB-IP Lite) is fetched once when you turn this on; no address is ever looked up online.</div>
            {geo?.state === 'downloading' ? <div className="progress" style={{ marginTop: 6 }}><i style={{ width: `${Math.round((geo.progress ?? 0) * 100)}%` }} /></div> : null}
            {geo?.state === 'ready' ? <div className="small muted">Data from {geo.date} · {geo.ranges?.toLocaleString()} address ranges. <a href="https://db-ip.com" onClick={(e) => { e.preventDefault(); void api.system.openExternal('https://db-ip.com'); }}>IP Geolocation by DB-IP</a> (CC BY 4.0).</div> : null}
            {geo?.state === 'error' ? <div className="small" style={{ color: 'var(--danger, #d33)' }}>{geo.message}</div> : null}
          </div>
          {geo?.state === 'ready' ? <button className="btn sm" onClick={() => void api.net.geoRemove().then(setGeo).then(() => void api.net.settings().then(setSt))}>Remove</button>
            : <button className="btn sm primary" disabled={geo?.state === 'downloading'} onClick={() => void api.net.geoDownload().then(setGeo)}>{geo?.state === 'downloading' ? 'Downloading…' : 'Download'}</button>}
        </div>
        <label className="row"><div className="grow"><b>Measure latency</b><div className="small muted">Times a connection to your router and to an internet host every few seconds while the Health tab is open.</div></div><Toggle on={st.latency} onChange={(v) => void set({ latency: v })} /></label>
        <label className="row"><div className="grow"><b>Internet host to measure</b></div><input className="input sm" style={{ width: 170 }} defaultValue={st.probeHost} onBlur={(e) => void set({ probeHost: e.target.value.trim() || '1.1.1.1' })} /></label>
        <label className="row"><div className="grow"><b>Tell me when an app goes online for the first time</b><div className="small muted">Looks every couple of minutes in the background (less often when you're away) and shows a note in the Island. The first look only learns what is already running.</div></div><Toggle on={st.alertNewApps} onChange={(v) => void set({ alertNewApps: v })} /></label>
      </div>
    </Modal>
  );
}

/** Connections as map points: one per place, coloured by the way the traffic goes. */
export function mapPoints(flows: FlowRow[]): MapPoint[] {
  return flows.filter((f) => f.country && f.scope === 'internet').map((f) => ({
    country: f.country, label: f.host ?? f.remote, weight: (f.rateIn ?? 0) + (f.rateOut ?? 0) + 1, kind: f.path === 'vpn' ? 'vpn' : 'direct', ref: f,
  }));
}

function NetMap({ flows, apps }: { flows: FlowRow[]; apps: string[] }) {
  const { settings } = useStore();
  const [app, setApp] = useState('');
  const [picked, setPicked] = useState<FlowRow[] | null>(null);
  const [geo, setGeo] = useState<GeoStatus | null>(null);
  useEffect(() => { void api.net.geoStatus().then(setGeo); }, []);
  const shown = useMemo(() => flows.filter((f) => !app || f.app === app), [flows, app]);
  const points = useMemo(() => mapPoints(shown), [shown]);
  const home = useMemo(() => homePoint((settings?.island as { place?: { lat?: number; lon?: number } | null } | undefined)?.place), [settings]);
  if (geo && geo.state !== 'ready') {
    return (
      <Empty icon="globe" title="Countries are needed for the map">
        The map places each server by its country, from a table kept on this computer (about 20 MB, downloaded once; no address is ever looked up online).
        <div style={{ marginTop: 10 }}><button className="btn primary" onClick={() => void api.net.setSettings({ countries: true }).then(() => api.net.geoDownload()).then(setGeo)}>{geo.state === 'downloading' ? `Downloading… ${Math.round((geo.progress ?? 0) * 100)}%` : 'Download the country table'}</button></div>
      </Empty>
    );
  }
  return (
    <div className="net-map">
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <select className="input sm" value={app} onChange={(e) => { setApp(e.target.value); setPicked(null); }}>
          <option value="">Every app</option>
          {apps.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="small muted">{points.length} connection{points.length === 1 ? '' : 's'} to {new Set(points.map((p) => p.country)).size} countries · click a place to see who talks to it</span>
      </div>
      <WorldMap points={points} home={home} onPick={(ps) => setPicked(ps.map((p) => p.ref as FlowRow))} selected={picked?.[0]?.country} />
      {picked?.length ? (
        <div className="net-table" style={{ marginTop: 10 }}>
          <div className="net-row head"><span>{flag(picked[0].country)} {picked.length} connection{picked.length === 1 ? '' : 's'}</span></div>
          {picked.map((f) => (
            <div key={f.key} className="net-row sub">
              <span><b>{f.app}</b></span>
              <span><Where f={f} /></span>
              <span className="small muted ellipsis">{f.asn ?? ''}</span>
              <span className="num">{rate(f.rateIn)}</span>
              <span className="num">{rate(f.rateOut)}</span>
              <span><PathBadge path={f.path} iface={f.iface} /></span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
