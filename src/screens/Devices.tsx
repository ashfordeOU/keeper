// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Devices & Remote: this device, the devices paired with it and what each may
// do, pairing a new one, files and ports between them, your phone, and how
// far Keeper Link reaches (this network only, or the internet through a
// Cloudflare tunnel or a relay).

import { useEffect, useState } from 'react';
import type { CompanionInvite, LinkDevice, LinkMode, LinkState, NearbyDevice, PairInvite, RemoteEntry } from '../../core/api-link';
import { formatBytes, relativeTime } from '../../core/format';
import { PERMISSIONS, type Permission } from '../../core/link/perms';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { DeviceDot, osIcon, osName, useLink, viaLabel } from '../components/LinkParts';
import { DeviceScreenCard, PhoneMirrorCard, ScreenLog } from '../screen/ScreenParts';
import { ViewerView } from '../screen/ViewerView';
import { AuditCard, DeviceGrid, DeviceManage, HelpCard, SurfacesCard, UnattendedCard } from './DevicesRemote';
import { Empty, Modal, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/link.css';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function Devices() {
  const { route, go } = useStore();
  const [s, reload] = useLink();
  const [pairing, setPairing] = useState<'host' | 'join' | null>(null);
  if (!s) return <div className="spinner" />;
  const dev = s.devices.find((d) => d.id === route.arg);
  // A remote screen opened in a Keeper tab.
  if (route.arg?.startsWith('screen:')) return <div className="link-page embedded-viewer"><ViewerView sid={route.arg.slice(7)} embedded /></div>;
  const helpArg = route.arg === 'help' ? '' : route.arg?.startsWith('help=') ? route.arg.slice(5) : undefined;
  const tab = dev ? 'device' : route.arg === 'phone' ? 'phone' : route.arg === 'remote' || route.arg === 'audit' || helpArg !== undefined ? 'remote' : 'devices';
  return (
    <div className="link-page">
      <PageHead title="Devices & Remote" sub="Your computers and phones, connected end to end. Pair once, then send files, open shared folders and reach ports — on this network or from anywhere.">
        <button className="btn primary" onClick={() => setPairing('host')}><Icon name="plus" size={14} /> Pair a Device</button>
      </PageHead>
      <div className="seg link-tabs">
        <button className={tab === 'devices' ? 'on' : ''} onClick={() => go({ name: 'devices' })}>Devices</button>
        <button className={tab === 'phone' ? 'on' : ''} onClick={() => go({ name: 'devices', arg: 'phone' })}>Phone</button>
        <button className={tab === 'remote' ? 'on' : ''} onClick={() => go({ name: 'devices', arg: 'remote' })}>Remote Access</button>
        {dev ? <button className="on">{dev.name}</button> : null}
      </div>
      {tab === 'devices' ? <Overview s={s} onPair={setPairing} /> : tab === 'phone' ? <><Phone s={s} /><div style={{ height: 14 }} /><div className="col" style={{ gap: 14 }}><PhoneMirrorCard /></div></> : tab === 'remote' ? <div className="col" style={{ gap: 14 }}>{helpArg !== undefined ? <HelpCard prefill={helpArg || undefined} /> : null}<Remote s={s} reload={reload} />{helpArg === undefined ? <HelpCard /> : null}<UnattendedCard s={s} /><SurfacesCard s={s} reload={reload} /><AuditCard /><ScreenLog /></div> : <DeviceDetail s={s} d={dev!} />}
      {pairing ? <PairDialog start={pairing} onClose={() => setPairing(null)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- overview

function Overview({ s, onPair }: { s: LinkState; onPair: (m: 'host' | 'join') => void }) {
  const { go } = useStore();
  const [name, setName] = useState<string | null>(null);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card link-me">
        <div className="link-me-icon"><Icon name={osIcon(s.me.os)} size={22} /></div>
        <div className="grow">
          {name === null ? (
            <div className="row" style={{ gap: 8 }}>
              <h3 style={{ margin: 0 }}>{s.me.name}</h3>
              <button className="btn ghost sm" onClick={() => setName(s.me.name)}>Rename</button>
            </div>
          ) : (
            <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); void api.link.rename(name).then(() => setName(null)); }}>
              <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn sm primary">Save</button>
            </form>
          )}
          <div className="small muted">This device · {osName(s.me.os)} · key <code>{s.me.fingerprint}</code></div>
          <div className="link-badges">
            <span className={`badge ${s.settings.mode === 'off' ? '' : 'accent'}`}>{s.settings.mode === 'off' ? 'Link is off' : s.settings.mode === 'lan' ? 'This network only' : s.settings.localOnly ? 'Never leaves my network' : 'Reachable from anywhere'}</span>
            {s.me.listening ? <span className="badge">{s.me.addresses[0] ?? 'localhost'}:{s.me.port}</span> : null}
            {s.me.tunnel?.state === 'connected' ? <span className="badge ok">Tunnel connected</span> : null}
            {s.me.relay ? <span className={`badge ${s.me.relay.connected ? 'ok' : 'warn'}`}>Relay {s.me.relay.connected ? 'connected' : 'not connected'}</span> : null}
            {s.me.wireguard?.length ? <span className="badge" title="A WireGuard network is up on this computer; Keeper Link works over it like any other network.">WireGuard: {s.me.wireguard.join(', ')}</span> : null}
            {!s.me.keyProtected ? <span className="badge warn" title="There is no system keychain here, so this device's key is kept in a file only your account can read.">Key in a private file</span> : null}
          </div>
        </div>
        <button className="btn" onClick={() => go({ name: 'devices', arg: 'remote' })}><Icon name="globe" size={14} /> Remote Access</button>
      </div>

      {s.devices.length ? (
        <DeviceGrid s={s} />
      ) : (
        <Empty icon="link" title="No devices paired yet">
          <p>Open Keeper on your other computer, choose <b>Pair a Device</b> on one of them and enter the code on the other.</p>
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => onPair('host')}>Show a Code Here</button>
            <button className="btn" onClick={() => onPair('join')}>Enter a Code</button>
          </div>
        </Empty>
      )}

      <Shares s={s} />
      <Transfers s={s} />
    </div>
  );
}

function Shares({ s }: { s: LinkState }) {
  const { toast } = useStore();
  return (
    <div className="card pad">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ margin: 0 }}>Shared folders</h3>
          <div className="small muted">Devices you allow to “See shared folders” can open these, and your phone too. Nothing else on this computer is reachable.</div>
        </div>
        <button className="btn" onClick={() => void api.link.addShare().catch((e) => toast(clean(e)))}><Icon name="plus" size={13} /> Share a Folder…</button>
      </div>
      {s.settings.shares.length ? (
        <div className="link-list">
          {s.settings.shares.map((sh) => (
            <div key={sh.id} className="link-row">
              <Icon name="folder" size={15} />
              <div className="grow ellipsis"><b>{sh.name}</b> <span className="small muted">{sh.path}</span></div>
              <button className="btn ghost sm icon" title="Stop sharing" aria-label="Stop sharing" onClick={() => void api.link.removeShare(sh.id)}><Icon name="close" size={12} /></button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Transfers({ s }: { s: LinkState }) {
  if (!s.transfers.length) return null;
  const name = (id?: string) => s.devices.find((d) => d.id === id)?.name ?? id ?? '';
  return (
    <div className="card pad">
      <h3 style={{ margin: '0 0 8px' }}>Transfers</h3>
      <div className="link-list">
        {s.transfers.slice(0, 12).map((t) => (
          <div key={`${t.direction}${t.id}`} className="link-row">
            <Icon name={t.direction === 'send' ? 'send' : 'down'} size={15} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="ellipsis">{t.name} <span className="small muted">{t.direction === 'send' ? 'to' : 'from'} {name(t.peer)}</span></div>
              {t.state === 'sending' || t.state === 'receiving' || t.state === 'checking' ? <div className="progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Number(t.size ? Math.round((t.done / t.size) * 100) : 0) || 0)}><i style={{ width: `${t.size ? Math.round((t.done / t.size) * 100) : 0}%` }} /></div> : null}
            </div>
            <span className={`small ${t.state === 'failed' || t.state === 'declined' ? 'danger-text' : 'muted'}`}>
              {t.state === 'done' ? formatBytes(t.size) : t.state === 'failed' ? t.error ?? 'Failed' : t.state === 'declined' ? 'Declined' : t.state === 'checking' ? 'Checking…' : t.state === 'waiting' ? 'Waiting to be accepted…' : `${formatBytes(t.done)} of ${formatBytes(t.size)}`}
            </span>
            {t.savedAs ? <button className="btn ghost sm icon" title="Show in folder" aria-label="Show in folder" onClick={() => void api.files.reveal(t.savedAs!)}><Icon name="reveal" size={13} /></button> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pairing

function PairDialog({ start, onClose }: { start: 'host' | 'join'; onClose: () => void }) {
  const { toast } = useStore();
  const [mode, setMode] = useState(start);
  const [invite, setInvite] = useState<PairInvite | null>(null);
  const [nearby, setNearby] = useState<NearbyDevice[] | null>(null);
  const [target, setTarget] = useState<string>('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== 'host') return;
    void api.link.invite().then(setInvite).catch((e) => setError(clean(e)));
    // Closes by itself once the other device is added.
    let known: number | null = null;
    const off = api.on('link-changed', () => void api.link.state().then((st) => {
      if (known === null) known = st.devices.length;
      else if (st.devices.length > known) {
        toast(`Paired with ${st.devices[st.devices.length - 1].name}`);
        onClose();
      }
    }));
    void api.link.state().then((st) => (known = st.devices.length));
    return () => { off(); void api.link.cancelInvite(); };
  }, [mode]);
  useEffect(() => {
    if (mode !== 'join') return;
    let alive = true;
    const look = () => void api.link.discover().then((n) => alive && setNearby(n)).catch(() => undefined);
    look();
    const t = setInterval(look, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [mode]);
  const join = async () => {
    setBusy(true);
    setError(null);
    const t = target.trim();
    const isLink = t.startsWith('keeper://');
    const near = nearby?.find((n) => n.id === t);
    const r = await api.link.pair(isLink ? { link: t } : near ? { deviceId: near.id, code } : { address: t, code }).catch((e) => ({ ok: false, error: clean(e) }));
    setBusy(false);
    if (r.ok) {
      toast('Paired');
      onClose();
    } else setError(r.error ?? 'Could not pair');
  };
  return (
    <Modal title="Pair a Device" onClose={onClose} width={520}>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={mode === 'host' ? 'on' : ''} onClick={() => setMode('host')}>Show a Code Here</button>
        <button className={mode === 'join' ? 'on' : ''} onClick={() => setMode('join')}>Enter a Code</button>
      </div>
      {mode === 'host' ? (
        invite ? (
          <div className="link-invite">
            <img src={invite.qr} alt="QR code for pairing" className="link-qr" />
            <div className="col" style={{ gap: 8 }}>
              <div className="small muted">On the other device, open Keeper → Devices → Pair a Device → Enter a Code, and type:</div>
              <div className="link-code" data-testid="link-code">{invite.code.replace(/(\d{3})(\d{3})/, '$1 $2')}</div>
              <div className="small muted">Or paste this pairing link there (it also works from the QR code):</div>
              <div className="row" style={{ gap: 6 }}>
                <input className="input grow mono small" readOnly value={invite.link} onFocus={(e) => e.target.select()} />
                <button aria-label="Copy link" title="Copy link" className="btn sm" onClick={() => void navigator.clipboard.writeText(invite.link).then(() => toast('Link copied'))}><Icon name="copy" size={13} /></button>
              </div>
              <div className="small muted">Waiting… The code works for 10 minutes. You will both see six digits to compare.</div>
            </div>
          </div>
        ) : error ? <div className="danger-text">{error}</div> : <div className="spinner" />
      ) : (
        <div className="col" style={{ gap: 10 }}>
          <div className="small muted">Devices showing a code on this network:</div>
          {nearby === null ? <div className="spinner" /> : nearby.filter((n) => n.pairing).length ? (
            <div className="link-list">
              {nearby.filter((n) => n.pairing).map((n) => (
                <label key={n.id} className={`link-row pick ${target === n.id ? 'on' : ''}`}>
                  <input type="radio" name="near" checked={target === n.id} onChange={() => setTarget(n.id)} />
                  <Icon name={osIcon(n.os)} size={15} />
                  <span className="grow">{n.name}</span>
                  <span className="small muted">{n.addresses[0]}</span>
                </label>
              ))}
            </div>
          ) : <div className="small muted">None found yet. You can also type the other device’s address (shown on its Devices page), or paste its pairing link.</div>}
          <input className="input mono" placeholder="Address (192.168.1.20:47821) or keeper://pair link" value={nearby?.some((n) => n.id === target) ? '' : target} onChange={(e) => setTarget(e.target.value)} />
          {!target.startsWith('keeper://') ? <input className="input link-code-input" inputMode="numeric" placeholder="6-digit code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} /> : null}
          {error ? <div className="danger-text small">{error}</div> : null}
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy || !target || (!target.startsWith('keeper://') && code.replace(/\D/g, '').length !== 6)} onClick={() => void join()}>{busy ? 'Pairing…' : 'Pair'}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- one device

function DeviceDetail({ s, d }: { s: LinkState; d: LinkDevice }) {
  const { go, toast } = useStore();
  const setPerm = (p: Permission, on: boolean) => void api.link.setPermissions(d.id, { ...d.permissions, [p]: on });
  const [shares, setShares] = useState<{ id: string; name: string }[] | null>(null);
  const [share, setShare] = useState<string | null>(null);
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState<RemoteEntry[] | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [fwd, setFwd] = useState({ kind: 'port' as 'port' | 'socks', localPort: '', port: '' });
  const [confirmForget, setConfirmForget] = useState(false);
  const openShares = () => {
    setBrowseError(null);
    void api.link.shares(d.id).then((x) => { setShares(x); if (x[0]) { setShare(x[0].id); setDir(''); } }).catch((e) => setBrowseError(clean(e)));
  };
  useEffect(() => {
    if (!share) return;
    setEntries(null);
    void api.link.list(d.id, share, dir).then(setEntries).catch((e) => setBrowseError(clean(e)));
  }, [d.id, share, dir]);
  const fwds = s.forwards.filter((f) => f.device === d.id);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card link-me">
        <div className="link-me-icon"><Icon name={osIcon(d.os)} size={22} /></div>
        <div className="grow">
          <h3 style={{ margin: 0 }}>{d.name}</h3>
          <div className="small muted">{osName(d.os)} · paired {relativeTime(d.pairedAt)} · key <code>{d.fingerprint}</code></div>
          <div className="link-badges">
            <span className={`badge ${d.online ? 'ok' : ''}`}><DeviceDot d={d} /> {d.online ? `${viaLabel(d.via) || 'On this network'}${d.where && d.via === 'lan' ? ` (${d.where})` : ''}` : 'Not reachable now'}</span>
            {d.rtt !== undefined ? <span className="badge">{d.rtt} ms</span> : null}
          </div>
        </div>
        <div className="btn-row">
          <button className="btn primary" onClick={() => void api.link.sendFiles(d.id).catch((e) => toast(clean(e)))}><Icon name="send" size={14} /> Send Files…</button>
          <button className="btn" onClick={() => void api.link.sendClipboard(d.id).then(() => toast('Clipboard sent'), (e) => toast(clean(e)))}><Icon name="clipboard" size={14} /> Send Clipboard</button>
          <button aria-label="Check connection" title="Check connection" className="btn ghost" onClick={() => void api.link.check(d.id).then((r) => toast(r.ok ? `${viaLabel(r.via)}, ${r.rtt} ms` : r.error ?? 'Not reachable'))}><Icon name="refresh" size={14} /></button>
        </div>
      </div>

      <DeviceScreenCard d={d} />
      <DeviceManage d={d} />

      <div className="card pad">
        <h3 style={{ margin: '0 0 4px' }}>What {d.name} may do on this device</h3>
        <div className="small muted" style={{ marginBottom: 8 }}>Set on each device for itself: {d.name} decides what you may do there.</div>
        {PERMISSIONS.map((p) => (
          <div key={p.id} className="link-perm-row">
            <div className="grow">
              <div style={{ fontWeight: 550 }}>{p.label}</div>
              <div className="small muted">{p.detail}{p.id === 'screenView' || p.id === 'screenControl' || p.id === 'terminal' || p.id === 'sync' ? ' (used by features that build on Keeper Link)' : ''}</div>
            </div>
            <Toggle on={!!d.permissions[p.id]} onChange={(v) => setPerm(p.id, v)} />
          </div>
        ))}
        <div className="link-perm-row">
          <div className="grow"><div style={{ fontWeight: 550 }}>Accept files without asking</div><div className="small muted">Files from {d.name} are saved straight away.</div></div>
          <Toggle on={d.autoAccept} onChange={(v) => void api.link.setPermissions(d.id, d.permissions, v)} />
        </div>
      </div>

      <div className="card pad">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Shared folders on {d.name}</h3>
          <button className="btn sm" onClick={openShares}><Icon name="folder" size={13} /> {shares ? 'Refresh' : 'Open'}</button>
        </div>
        {browseError ? <div className="small danger-text" style={{ marginTop: 8 }}>{browseError}</div> : null}
        {shares && !shares.length ? <div className="small muted" style={{ marginTop: 8 }}>{d.name} shares no folders.</div> : null}
        {shares && share ? (
          <div style={{ marginTop: 10 }}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {shares.map((x) => <button key={x.id} className={`chip ${x.id === share ? 'on' : ''}`} onClick={() => { setShare(x.id); setDir(''); }}>{x.name}</button>)}
              {dir ? <><Icon name="chevronRight" size={12} /><button className="btn ghost sm" onClick={() => setDir(dir.split('/').slice(0, -1).join('/'))}>{dir}</button></> : null}
            </div>
            <div className="link-list" style={{ marginTop: 8 }}>
              {entries === null ? <div className="spinner" /> : entries.length ? entries.map((e) => (
                <div key={e.name} className="link-row">
                  <Icon name={e.isDir ? 'folder' : 'document'} size={15} />
                  <button className="btn ghost sm grow" style={{ justifyContent: 'flex-start' }} onClick={() => e.isDir ? setDir(dir ? `${dir}/${e.name}` : e.name) : undefined}>{e.name}</button>
                  <span className="small muted">{e.isDir ? '' : formatBytes(e.size)}</span>
                  {!e.isDir ? <button className="btn ghost sm" onClick={() => void api.link.download(d.id, share, dir ? `${dir}/${e.name}` : e.name).then((p) => toast(`Saved to ${p}`), (x) => toast(clean(x)))}><Icon name="down" size={13} /> Copy here</button> : null}
                </div>
              )) : <div className="small muted">Empty folder</div>}
            </div>
          </div>
        ) : null}
      </div>

      <div className="card pad">
        <h3 style={{ margin: '0 0 4px' }}>Ports</h3>
        <div className="small muted" style={{ marginBottom: 8 }}>Reach a service running on {d.name} as if it were here, for example a web app on port 3000. {d.name} must allow “Reach ports”.</div>
        {fwds.map((f) => (
          <div key={f.id} className="link-row">
            <Icon name="plug" size={15} />
            <div className="grow mono small">{f.kind === 'socks' ? `SOCKS5 proxy on localhost:${f.localPort}` : `localhost:${f.localPort} → ${d.name} ${f.host}:${f.port}`}</div>
            {f.error ? <span className="small danger-text">{f.error}</span> : <span className="badge ok">On</span>}
            <button className="btn ghost sm icon" title="Remove" aria-label="Remove" onClick={() => void api.link.removeForward(f.id)}><Icon name="close" size={12} /></button>
          </div>
        ))}
        <form className="row link-fwd-form" onSubmit={(e) => { e.preventDefault(); void api.link.addForward({ device: d.id, kind: fwd.kind, localPort: Number(fwd.localPort), port: fwd.kind === 'port' ? Number(fwd.port || fwd.localPort) : undefined }).then(() => setFwd({ ...fwd, localPort: '', port: '' }), (x) => toast(clean(x))); }}>
          <select className="input" value={fwd.kind} onChange={(e) => setFwd({ ...fwd, kind: e.target.value as 'port' | 'socks' })}>
            <option value="port">Forward a port</option>
            <option value="socks">SOCKS5 proxy</option>
          </select>
          <input className="input" placeholder="Port here" inputMode="numeric" value={fwd.localPort} onChange={(e) => setFwd({ ...fwd, localPort: e.target.value.replace(/\D/g, '') })} style={{ width: 110 }} />
          {fwd.kind === 'port' ? <input className="input" placeholder={`Port on ${d.name}`} inputMode="numeric" value={fwd.port} onChange={(e) => setFwd({ ...fwd, port: e.target.value.replace(/\D/g, '') })} style={{ width: 140 }} /> : null}
          <button className="btn" disabled={!fwd.localPort}>Add</button>
        </form>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn ghost" onClick={() => { const n = prompt('Name for this device', d.name); if (n) void api.link.renameDevice(d.id, n); }}>Rename</button>
        <button className="btn danger" onClick={() => setConfirmForget(true)}>Forget {d.name}</button>
      </div>
      {confirmForget ? (
        <Modal title={`Forget ${d.name}?`} onClose={() => setConfirmForget(false)} width={420}>
          <p style={{ marginTop: 0 }}>It will no longer be able to connect to this device. To use it again you pair once more.</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setConfirmForget(false)}>Cancel</button>
            <button className="btn danger" onClick={() => { void api.link.forget(d.id); go({ name: 'devices' }); }}>Forget</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- phone

function Phone({ s }: { s: LinkState }) {
  const [inv, setInv] = useState<CompanionInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tunnelUp = s.me.tunnel?.state === 'connected' && !!s.me.tunnel.url;
  const show = (viaTunnel: boolean) => void api.link.companionInvite(viaTunnel).then(setInv, (e) => setError(clean(e)));
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card pad link-phone">
        <div className="grow">
          <h3 style={{ marginTop: 0 }}>Your phone or tablet, no app needed</h3>
          <p className="small muted">Scan the code with the camera on an iPhone, iPad or Android phone. It opens a small Keeper page in the browser where you can send photos and files here, open your shared folders and use the clipboard. Everything between the phone and this computer is encrypted with a key that is only in the QR code.</p>
          <div className="btn-row">
            <button className="btn primary" disabled={s.settings.mode === 'off'} onClick={() => show(false)}><Icon name="phone" size={14} /> Show QR Code (this network)</button>
            <button className="btn" disabled={!tunnelUp} title={tunnelUp ? '' : 'Start a tunnel under Remote Access first'} onClick={() => show(true)}><Icon name="globe" size={14} /> From Anywhere (tunnel)</button>
          </div>
          {s.settings.mode === 'off' ? <div className="small muted" style={{ marginTop: 6 }}>Turn Keeper Link on under Remote Access first.</div> : null}
          {error ? <div className="small danger-text">{error}</div> : null}
        </div>
        {inv ? (
          <div className="link-invite" style={{ alignItems: 'center' }}>
            <img className="link-qr" src={inv.qr} alt="QR code for the phone" />
            <div className="col small" style={{ gap: 6, maxWidth: 240 }}>
              <span className="muted">Works once, for 10 minutes. You will be asked here to allow the phone.</span>
              <input className="input mono small" readOnly value={inv.url} onFocus={(e) => e.target.select()} data-testid="companion-url" />
            </div>
          </div>
        ) : null}
      </div>
      {s.companions.length ? (
        <div className="card pad">
          <h3 style={{ margin: '0 0 8px' }}>Phones and tablets</h3>
          <div className="link-list">
            {s.companions.map((c) => (
              <div key={c.id} className="link-row">
                <Icon name="phone" size={15} />
                <div className="grow">{c.name} <span className="small muted">{c.online ? 'connected now' : c.lastSeen ? `last used ${relativeTime(c.lastSeen)}` : ''}</span></div>
                <label className="row small" style={{ gap: 6 }} title="Lets this phone open a terminal here from its Terminal tab"><Toggle on={!!c.terminal} onChange={(v) => void api.link.setCompanionTerminal(c.id, v)} /> Terminal</label>
                <button className="btn ghost sm" onClick={() => void api.link.forgetCompanion(c.id)}>Remove</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- remote access

function Remote({ s, reload }: { s: LinkState; reload: () => void }) {
  const { toast } = useStore();
  const t = s.me.tunnel;
  const [token, setToken] = useState('');
  const [host, setHost] = useState('');
  const [relay, setRelay] = useState(s.settings.relayUrl);
  const set = (p: Partial<LinkState['settings']>) => void api.link.setSettings(p).then(reload, (e) => toast(clean(e)));
  const modes: [LinkMode, string, string][] = [
    ['off', 'Off', 'Keeper does not listen for other devices.'],
    ['lan', 'This network only', 'Devices and phones on the same Wi-Fi or wired network can connect. Nothing is reachable from the internet.'],
    ['internet', 'From anywhere', 'Also through a Cloudflare tunnel and an optional Keeper Relay. Paired devices find each other with encrypted notes.'],
  ];
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card pad">
        <h3 style={{ marginTop: 0 }}>How far Keeper Link reaches</h3>
        <div className="update-modes">
          {modes.map(([m, title, desc]) => (
            <label key={m} className={`update-mode ${s.settings.mode === m ? 'on' : ''}`}>
              <input type="radio" name="linkmode" checked={s.settings.mode === m} onChange={() => set({ mode: m })} />
              <div><div className="update-mode-title">{title}</div><div className="small muted">{desc}</div></div>
            </label>
          ))}
        </div>
        <div className="link-perm-row">
          <div className="grow"><div style={{ fontWeight: 550 }}>Never leaves my network</div><div className="small muted">Even in “From anywhere”, use no tunnel, relay or notes: only the local network.</div></div>
          <Toggle on={s.settings.localOnly} onChange={(v) => set({ localOnly: v })} />
        </div>
        <div className="link-perm-row">
          <div className="grow"><div style={{ fontWeight: 550 }}>Ports may reach this device’s network</div><div className="small muted">Off: forwarded ports and the SOCKS proxy reach only this computer. On: also private addresses on its network (a printer, a NAS).</div></div>
          <Toggle on={s.settings.forwardLan} onChange={(v) => set({ forwardLan: v })} />
        </div>
      </div>

      <div className={`card pad ${s.settings.mode !== 'internet' || s.settings.localOnly ? 'link-dim' : ''}`}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0 }}>Cloudflare tunnel</h3>
            <div className="small muted">A public https address for this computer that works through any router or firewall. Keeper restarts it if it stops.</div>
          </div>
          {t && t.state !== 'off' ? <span className={`badge ${t.state === 'connected' ? 'ok' : t.state === 'error' ? 'warn' : ''}`} data-testid="tunnel-state">{t.state === 'downloading' ? `Downloading ${t.download ?? 0}%` : t.state === 'connected' ? `Connected · ${t.connections} links` : t.state}</span> : null}
        </div>
        {t?.url ? <div className="row" style={{ gap: 6, marginTop: 10 }}><Icon name="globe" size={14} /><code className="grow">{t.url}</code><button aria-label="Copy address" title="Copy address" className="btn sm" onClick={() => void navigator.clipboard.writeText(t.url!).then(() => toast('Copied'))}><Icon name="copy" size={13} /></button></div> : null}
        {t?.lastError && t.state !== 'connected' ? <div className="small danger-text" style={{ marginTop: 6 }}>{t.lastError}</div> : null}
        {t && t.restarts ? <div className="small muted">Restarted {t.restarts} time{t.restarts === 1 ? '' : 's'}{t.since ? ` · up since ${relativeTime(t.since)}` : ''}</div> : null}
        <div className="link-tunnel-modes">
          <div className="card pad">
            <b>Quick tunnel</b>
            <div className="small muted">No account. A random trycloudflare.com address that changes each time it starts; paired devices learn the new one automatically.</div>
            <button className="btn sm" disabled={s.settings.localOnly} onClick={() => void api.link.tunnel.start('quick').then(reload, (e) => toast(clean(e)))}>Start Quick Tunnel</button>
          </div>
          <div className="card pad">
            <b>Your own address</b>
            <div className="small muted">With a free Cloudflare account: create a tunnel in Zero Trust → Networks → Tunnels, point a hostname at <code>http://localhost:{s.me.port || 47821}</code>, and paste the token here.</div>
            <input className="input small" placeholder="Hostname, e.g. home.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
            <input className="input small mono" type="password" placeholder={t?.hasToken ? 'Token saved in the keychain' : 'Tunnel token'} value={token} onChange={(e) => setToken(e.target.value)} />
            <button className="btn sm" disabled={s.settings.localOnly || (!token && !t?.hasToken)} onClick={() => void api.link.tunnel.start('named', token || undefined, host || undefined).then(() => { setToken(''); reload(); }, (e) => toast(clean(e)))}>Start</button>
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {t && t.state !== 'off' && t.mode !== 'off' ? <button className="btn" onClick={() => void api.link.tunnel.stop().then(reload)}>Stop Tunnel</button> : null}
          {t?.mode === 'named' ? (
            <label className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={t.service} onChange={(e) => void api.link.tunnel.installService(e.target.checked).then(reload, (x) => toast(clean(x)))} />
              Keep the tunnel running when Keeper is closed (installs a system service; asks for an administrator)
            </label>
          ) : null}
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>Anyone who knows the address reaches only Keeper’s pairing and phone pages, and nothing works without pairing. For a second lock, put Cloudflare Access in front of your hostname.</div>
      </div>

      <div className={`card pad ${s.settings.mode !== 'internet' || s.settings.localOnly ? 'link-dim' : ''}`}>
        <h3 style={{ marginTop: 0 }}>Keeper Relay <span className="small muted">(optional)</span></h3>
        <div className="small muted">When two devices cannot reach each other directly or through a tunnel, a relay passes their encrypted traffic along without being able to read it. Run your own (a small Node program, Docker image or Cloudflare Worker — see docs/LINK.md).</div>
        <form className="row" style={{ gap: 6, marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); set({ relayUrl: relay.trim() }); }}>
          <input className="input grow mono small" placeholder="https://relay.example.com" value={relay} onChange={(e) => setRelay(e.target.value)} />
          <button className="btn sm">Save</button>
        </form>
        {s.me.relay ? <div className="small" style={{ marginTop: 6 }}>{s.me.relay.connected ? 'Connected to the relay' : `Not connected${s.me.relay.error ? `: ${s.me.relay.error}` : ''}`}</div> : null}
      </div>

      <div className={`card pad ${s.settings.mode !== 'internet' || s.settings.localOnly ? 'link-dim' : ''}`}>
        <h3 style={{ marginTop: 0 }}>Finding each other</h3>
        <div className="small muted">Paired devices leave each other short encrypted, signed notes saying where they are now, on a public push service that cannot read them. Clear the box to turn this off.</div>
        <MailboxField value={s.settings.mailbox} onSave={(v) => set({ mailbox: v })} />
      </div>
    </div>
  );
}

function MailboxField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <form className="row" style={{ gap: 6, marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); onSave(v.trim()); }}>
      <input className="input grow mono small" placeholder="https://ntfy.sh (or your own)" value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn sm">Save</button>
    </form>
  );
}
