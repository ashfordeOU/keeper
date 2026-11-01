// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Mesh: a private network between your paired devices. Turn it on,
// see each device's address, name and path, pick an exit node, share a
// subnet, set who may reach what, and check a connection.

import { useCallback, useEffect, useState } from 'react';
import type { LinkDevice } from '../../core/api-link';
import { formatBytes, relativeTime } from '../../core/format';
import { PATH_LABEL, type MeshDiag, type MeshNetView, type MeshPeerView, type MeshRule, type MeshState } from '../../core/mesh/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Loading, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/mesh.css';
import { MeshPlaces } from './MeshParts';

const IFACE_TEXT: Record<MeshState['iface']['state'], string> = {
  off: 'Off',
  starting: 'Starting…',
  up: 'Network card up',
  'config-only': 'Keys and paths only',
  'needs-admin': 'Needs your administrator password',
  'no-wireguard': 'WireGuard is missing',
  error: 'Something went wrong',
};

export function Mesh() {
  const { toast } = useStore();
  const [s, setS] = useState<MeshState | null>(null);
  const [devices, setDevices] = useState<LinkDevice[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setS(await api.mesh.state());
    setDevices((await api.link.state().catch(() => null))?.devices ?? []);
  }, []);
  useEffect(() => {
    void load();
    const off = api.on('mesh-changed', () => void load());
    const h = window.setInterval(() => document.visibilityState === 'visible' && void load(), 5000);
    return () => {
      off();
      clearInterval(h);
    };
  }, [load]);

  const act = async (p: Promise<MeshState | unknown>, done?: string) => {
    setBusy(true);
    try {
      const r = await p;
      if (r && typeof r === 'object' && 'networks' in (r as object)) setS(r as MeshState);
      else void load();
      if (done) toast(done);
    } catch (e) {
      toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };
  const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast(`Copied ${t}`));

  if (!s) return <div><PageHead title="Mesh" /><Loading label="Reading the mesh…" /></div>;

  if (!s.feature)
    return (
      <div className="mesh-page">
        <PageHead title="Mesh" sub="A private network between your paired devices" />
        <Empty icon="graph" title="Keeper Mesh is off">Turn it on in Settings → Features → Connections. It needs Keeper Link.</Empty>
      </div>
    );

  const exitOffers = s.networks.flatMap((n) => n.peers.filter((p) => p.offersExit).map((p) => ({ ...p, net: n.name })));

  return (
    <div className="mesh-page">
      <PageHead title="Mesh" sub="A private network between your paired devices. Any app reaches them by address or by name.">
        <label className="row mesh-switch" data-testid="mesh-switch">{s.on ? 'On' : 'Off'} <Toggle on={s.on} onChange={(on) => void act(api.mesh.setOn(on), on ? 'Mesh is on' : 'Mesh is off')} /></label>
        <button className="btn primary" disabled={busy} onClick={() => { const name = window.prompt('Name for the new network', s.networks.length ? 'Work' : 'Home'); if (name) void act(api.mesh.createNetwork(name), `Made “${name}”`); }}><Icon name="plus" size={13} /> New network</button>
      </PageHead>

      {s.invites.map((i) => (
        <div key={i.id} className="card mesh-invite" data-testid="mesh-invite">
          <Icon name="graph" size={18} />
          <div className="grow"><b>{i.fromName}</b> invites this device to <b>{i.name}</b>{i.role === 'guest' ? ' as a guest' : ''}.</div>
          <button className="btn" onClick={() => void act(api.mesh.answerInvite(i.id, false))}>Decline</button>
          <button className="btn primary" onClick={() => void act(api.mesh.answerInvite(i.id, true), `Joined ${i.name}`)}>Join</button>
        </div>
      ))}

      <div className="mesh-status">
        <div className={`card mesh-stat ${s.iface.state}`} data-testid="mesh-iface">
          <div className="small muted">Network card</div>
          <div className="mesh-big">{IFACE_TEXT[s.iface.state]}</div>
          <div className="small muted">{s.iface.name ? <span className="mono">{s.iface.name}</span> : null}{s.iface.impl && s.iface.impl !== 'none' ? ` · ${s.iface.impl === 'kernel' ? 'WireGuard in the kernel' : s.iface.impl}` : ''}</div>
          {s.iface.message ? <div className="small mesh-msg">{s.iface.message}</div> : null}
        </div>
        <div className="card mesh-stat">
          <div className="small muted">Names</div>
          <div className="mesh-big">.{s.dns.suffix}</div>
          <div className="small muted">{s.dns.split === 'on' ? 'Split DNS is set up' : s.dns.split === 'failed' ? 'Split DNS could not be set up' : 'Not set up yet'}{s.dns.responder ? <> · answering on <span className="mono">{s.dns.responder}</span></> : null}</div>
          {s.dns.message ? <div className="small mesh-msg">{s.dns.message}</div> : null}
        </div>
        <div className="card mesh-stat">
          <div className="small muted">This device’s key</div>
          <div className="mesh-big mono" title={s.wgPub}>{s.wgPub ? `${s.wgPub.slice(0, 8)}…` : '—'}</div>
          <div className="small muted">{s.relay ? (s.relay.connected ? 'Relay connected' : 'Relay not connected') : 'No relay (direct paths only)'} · port {s.port}</div>
        </div>
      </div>

      {!s.networks.length ? (
        <Empty icon="graph" title="No mesh network yet">Make one with New network, then add your paired devices to it.</Empty>
      ) : (
        s.networks.map((n) => <Network key={n.id} n={n} devices={devices} busy={busy} act={act} copy={copy} exit={s.exit.using} />)
      )}

      <div className="mesh-cols">
        <section className="card pad">
          <h3>Exit node</h3>
          <p className="small muted">Send all your internet traffic through another device, for example your home computer when you are out.</p>
          <select className="input" data-testid="mesh-exit" value={s.exit.using ?? ''} onChange={(e) => void act(api.mesh.setExit(e.target.value || null), e.target.value ? 'Traffic goes through the exit node' : 'Exit node off')}>
            <option value="">None (normal internet)</option>
            {exitOffers.map((p) => <option key={p.device} value={p.device}>{p.name} ({p.net})</option>)}
          </select>
          <div className="mesh-opts">
            <Opt on={s.exit.killSwitch} onChange={(on) => void act(api.mesh.setExit(s.exit.using ?? null, { killSwitch: on }))} label="Block traffic if the exit node is unreachable (kill switch)" />
            <Opt on={s.exit.dnsThrough} onChange={(on) => void act(api.mesh.setExit(s.exit.using ?? null, { dnsThrough: on }))} label="Look up names through it too" />
            <Opt on={s.exit.allowLan} onChange={(on) => void act(api.mesh.setExit(s.exit.using ?? null, { allowLan: on }))} label="Keep the local network reachable (printers, the router)" />
          </div>
          <hr />
          <Opt on={s.exit.offering} onChange={(on) => void act(api.mesh.offerExit(on))} label="Let my devices use this computer as their exit node" />
        </section>

        <section className="card pad">
          <h3>Share a local network</h3>
          <p className="small muted">Let your devices reach a network this computer is on, like the one your NAS or printer is on. You confirm it here, with your administrator password.</p>
          <Routes routes={s.advertise.routes} onSave={(r) => void act(api.mesh.advertise(r), r.length ? 'Shared with your mesh' : 'Stopped sharing')} />
        </section>

        <section className="card pad">
          <h3>Names</h3>
          <div className="row mesh-row">
            <span className="small">Ending</span>
            <input className="input mono" defaultValue={s.dns.suffix} onBlur={(e) => e.target.value !== s.dns.suffix && void act(api.mesh.setDns({ suffix: e.target.value }))} style={{ width: 160 }} />
          </div>
          <Opt on={s.dns.hosts} onChange={(on) => void act(api.mesh.setDns({ hosts: on }))} label="Also write the names into the hosts file (for apps that skip the system’s DNS)" />
        </section>
      </div>

      <details className="card pad mesh-trouble">
        <summary><b>Where these controls appear</b> <span className="small muted">Menu bar or tray, the Island, the command palette (also in Settings)</span></summary>
        <MeshPlaces />
      </details>

      <Troubleshoot s={s} />
      <p className="small muted mesh-foot">Keeper Mesh uses WireGuard®. “WireGuard” is a registered trademark of Jason A. Donenfeld.</p>
    </div>
  );
}

/** A switch with its words beside it. */
function Opt({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <label className="mesh-opt"><Toggle on={on} onChange={onChange} label={label} /><span className="small">{label}</span></label>;
}

function Network({ n, devices, busy, act, copy, exit }: { n: MeshNetView; devices: LinkDevice[]; busy: boolean; act: (p: Promise<unknown>, done?: string) => Promise<void>; copy: (t: string) => void; exit?: string }) {
  const [adding, setAdding] = useState('');
  const [role, setRole] = useState<'own' | 'guest'>('own');
  const [conf, setConf] = useState<string | null>(null);
  const free = devices.filter((d) => !n.peers.some((p) => p.device === d.id));
  return (
    <section className="card mesh-net" data-testid="mesh-net">
      <div className="mesh-net-head">
        <div className="grow">
          <h2>{n.name}</h2>
          <div className="small muted"><span className="mono">{n.prefix6}</span>{n.prefix4 ? <> · <span className="mono">{n.prefix4}</span></> : null}</div>
          {n.conflict ? <div className="small mesh-msg">{n.conflict}</div> : null}
        </div>
        <div className="mesh-me">
          <div className="small muted">This device</div>
          <button className="mesh-addr mono" data-testid="mesh-my-addr" title="Copy" onClick={() => copy(n.me.a4 ?? n.me.a6)}>{n.me.a4 ?? n.me.a6} <Icon name="copy" size={11} /></button>
          <div className="small muted mono">{n.me.dns}</div>
        </div>
      </div>

      {n.peers.length ? (
        <div className="mesh-table">
          <div className="mesh-tr head"><span>Device</span><span>Address</span><span>Path</span><span className="num">Latency</span><span>Last handshake</span><span className="num">Transfer</span><span /></div>
          {n.peers.map((p) => <Peer key={p.device} p={p} net={n.id} act={act} copy={copy} exit={exit === p.device} />)}
        </div>
      ) : <div className="small muted mesh-empty">No devices yet. Add one of your paired devices below.</div>}

      <div className="row mesh-add">
        <select className="input" value={adding} onChange={(e) => setAdding(e.target.value)} data-testid="mesh-add-device">
          <option value="">Add a paired device…</option>
          {free.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'own' | 'guest')}>
          <option value="own">My device (reaches everything)</option>
          <option value="guest">Someone else’s (only what rules allow)</option>
        </select>
        <button className="btn" disabled={!adding || busy} onClick={() => void act(api.mesh.addMember(n.id, adding, role), 'Invitation sent').then(() => setAdding(''))}>Invite</button>
        <span className="grow" />
        <button className="btn ghost sm" onClick={async () => setConf(conf ? null : await api.mesh.config(n.id))}>{conf ? 'Hide' : 'Show'} WireGuard settings</button>
        <button className="btn ghost sm" onClick={() => { if (window.confirm(`Leave and remove “${n.name}” on this device?`)) void act(api.mesh.removeNetwork(n.id)); }}>Remove</button>
      </div>
      {conf ? <pre className="mesh-conf" data-testid="mesh-config">{conf}</pre> : null}

      <Rules n={n} act={act} />
    </section>
  );
}

function Peer({ p, net, act, copy, exit }: { p: MeshPeerView; net: string; act: (p: Promise<unknown>, done?: string) => Promise<void>; copy: (t: string) => void; exit: boolean }) {
  const addr = p.a4 ?? p.a6;
  return (
    <div className={`mesh-tr ${p.online ? '' : 'away'}`} data-testid="mesh-peer">
      <span className="mesh-dev">
        <span className={`mesh-dot ${p.path}`} />
        <span className="ellipsis"><b>{p.name}</b>{p.role === 'guest' ? <span className="badge">guest</span> : null}{exit ? <span className="badge mesh-exit-badge">exit node</span> : null}<br /><span className="small muted mono">{p.joined ? p.dns : 'waiting for them to join'}</span></span>
      </span>
      <span>{addr ? <button className="mesh-addr mono" title={`Copy ${addr}`} onClick={() => copy(addr)}>{addr}</button> : '—'}{p.a4 && p.a6 ? <div className="small muted mono ellipsis" title={p.a6}>{p.a6}</div> : null}</span>
      <span><span className={`badge mesh-path ${p.path}`} data-testid="mesh-path">{PATH_LABEL[p.path]}</span>{p.endpoint ? <div className="small muted mono ellipsis" title={p.endpoint}>{p.endpoint}</div> : null}</span>
      <span className="num">{p.latencyMs !== undefined ? `${p.latencyMs} ms` : '—'}</span>
      <span className="small">{p.lastHandshake ? relativeTime(p.lastHandshake) : p.keyVerified ? 'key checked' : '—'}</span>
      <span className="num small">↓ {formatBytes(p.rx)}<br />↑ {formatBytes(p.tx)}</span>
      <span className="mesh-actions">
        {p.routes.length ? <label className="small" title={p.routes.join(', ')}><input type="checkbox" checked={p.routesAccepted} onChange={(e) => void act(api.mesh.acceptRoutes(p.device, e.target.checked))} /> use {p.routes.length === 1 ? p.routes[0] : `${p.routes.length} networks`}</label> : null}
        <button className="btn ghost sm" title="Remove from this network" onClick={() => void act(api.mesh.removeMember(net, p.device))}><Icon name="close" size={12} /></button>
      </span>
    </div>
  );
}

function Rules({ n, act }: { n: MeshNetView; act: (p: Promise<unknown>, done?: string) => Promise<void> }) {
  const [from, setFrom] = useState('guests');
  const [proto, setProto] = useState<MeshRule['proto']>('tcp');
  const [ports, setPorts] = useState('');
  const who = (f: string) => (f === 'own' ? 'Your devices' : f === 'guests' ? 'Guests' : n.peers.find((p) => p.device === f)?.name ?? f);
  return (
    <details className="mesh-rules">
      <summary><b>Who may reach this device</b> <span className="small muted">Your devices: everything. Guests: only what you allow here.</span></summary>
      {n.rules.map((r) => (
        <div key={r.id} className="row mesh-rule">
          <span className="grow small">{who(r.from)} → {r.ports.trim().toLowerCase() === 'all' ? 'every port' : `port ${r.ports}`}{r.proto === 'any' ? '' : ` (${r.proto.toUpperCase()})`}</span>
          <button className="btn ghost sm" onClick={() => void act(api.mesh.removeRule(n.id, r.id))}><Icon name="close" size={12} /></button>
        </div>
      ))}
      <div className="row mesh-rule-add">
        <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="guests">Guests</option>
          <option value="own">Your devices</option>
          {n.peers.map((p) => <option key={p.device} value={p.device}>{p.name}</option>)}
        </select>
        <select className="input" value={proto} onChange={(e) => setProto(e.target.value as MeshRule['proto'])}>
          <option value="tcp">TCP</option><option value="udp">UDP</option><option value="any">TCP and UDP</option>
        </select>
        <input className="input" placeholder="22, 445, 8000-8100 or all" value={ports} onChange={(e) => setPorts(e.target.value)} />
        <button className="btn" disabled={!ports.trim()} onClick={() => void act(api.mesh.saveRule(n.id, { id: '', from, proto, ports }), 'Rule saved').then(() => setPorts(''))}>Allow</button>
      </div>
    </details>
  );
}

function Routes({ routes, onSave }: { routes: string[]; onSave: (r: string[]) => void }) {
  const [text, setText] = useState(routes.join(', '));
  useEffect(() => setText(routes.join(', ')), [routes]);
  return (
    <div className="row mesh-row">
      <input className="input mono grow" placeholder="192.168.50.0/24" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn" onClick={() => onSave(text.split(/[\s,]+/).filter(Boolean))}>{routes.length ? 'Update' : 'Share'}</button>
      {routes.length ? <button className="btn ghost" onClick={() => onSave([])}>Stop</button> : null}
    </div>
  );
}

function Troubleshoot({ s }: { s: MeshState }) {
  const peers = s.networks.flatMap((n) => n.peers.filter((p) => p.joined));
  const [dev, setDev] = useState('');
  const [out, setOut] = useState<MeshDiag | null>(null);
  const [running, setRunning] = useState('');
  const go = async (what: 'ping' | 'pathTest' | 'mtuProbe') => {
    const d = dev || peers[0]?.device;
    if (!d) return;
    setRunning(what);
    setOut(null);
    try {
      setOut(await api.mesh[what](d));
    } catch (e) {
      setOut({ ok: false, lines: [(e as Error).message] });
    }
    setRunning('');
  };
  return (
    <details className="card pad mesh-trouble" data-testid="mesh-trouble">
      <summary><b>Troubleshooting</b> <span className="small muted">Ping a device, test the path, find the largest packet that fits</span></summary>
      <div className="row mesh-row">
        <select className="input" value={dev} onChange={(e) => setDev(e.target.value)}>
          {peers.map((p) => <option key={p.device} value={p.device}>{p.name}</option>)}
        </select>
        <button className="btn" disabled={!peers.length || !!running} onClick={() => void go('ping')}>{running === 'ping' ? <div className="spinner" /> : null} Ping</button>
        <button className="btn" disabled={!peers.length || !!running} onClick={() => void go('pathTest')}>{running === 'pathTest' ? <div className="spinner" /> : null} Path test</button>
        <button className="btn" disabled={!peers.length || !!running} onClick={() => void go('mtuProbe')}>{running === 'mtuProbe' ? <div className="spinner" /> : null} MTU probe</button>
      </div>
      {out ? <pre className={`mesh-diag ${out.ok ? 'ok' : 'bad'}`}>{out.lines.join('\n')}</pre> : null}
    </details>
  );
}
