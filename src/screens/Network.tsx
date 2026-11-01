// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Network: servers announcing themselves nearby, shares already connected
// (with eject), and Connect to Server with remembered addresses.

import { useCallback, useEffect, useState } from 'react';
import type { DiscoveredServer } from '../../core/api-places';
import { formatBytes } from '../../core/format';
import { parseServerAddress } from '../../core/places';
import { api } from '../api';
import { usePlaces } from '../components/PlacesSidebar';
import { ConnectionDialog } from '../components/ConnectionDialog';
import { Icon } from '../components/Icon';
import { Empty, Modal, PageHead } from '../components/ui';
import { useStore } from '../state';
import '../styles/places.css';

export function ConnectDialog({ initial = '', onClose }: { initial?: string; onClose: () => void }) {
  const { go, toast } = useStore();
  const [address, setAddress] = useState(initial);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => void api.places.recentServers().then(setRecent).catch(() => undefined), []);
  const parsed = address.trim() ? parseServerAddress(address) : null;

  const connect = async (to = address) => {
    setBusy(true);
    setError(null);
    const r = await api.places.connect({ address: to, user: user || undefined, password: password || undefined, remember }).catch((e: Error) => ({ ok: false, message: e.message, path: undefined }));
    setBusy(false);
    if (!r.ok) { setError(r.message ?? 'Could not connect.'); return; }
    toast(`Connected to ${parseServerAddress(to)?.host ?? to}`);
    onClose();
    if (r.path) go({ name: 'browse', arg: r.path });
  };

  return (
    <Modal title="Connect to Server" onClose={onClose} width={500}>
      <div className="col" style={{ gap: 10 }}>
        <input className="input" autoFocus value={address} placeholder="smb://nas.local/Media  ·  \\server\share  ·  sftp://me@host" onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && parsed && void connect()} style={{ fontFamily: 'var(--mono)' }} />
        <div className="small muted">
          {!address.trim() ? 'SMB, AFP, NFS, SFTP, FTP and WebDAV addresses work, as do Windows \\\\server\\share paths.' : parsed ? <>Connects to <b>{parsed.host}</b> over <span className="proto">{parsed.protocol}</span>{parsed.share ? <> and opens <b>{parsed.share}</b></> : null}</> : <span style={{ color: 'var(--danger)' }}>That does not look like a server address.</span>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" value={user} placeholder="Name (optional)" onChange={(e) => setUser(e.target.value)} />
          <input className="input grow" type="password" value={password} placeholder="Password (optional)" onChange={(e) => setPassword(e.target.value)} />
        </div>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember this server (never the password)</label>
        {error ? <div className="small" style={{ color: 'var(--danger)' }}>{error}</div> : null}
        {recent.length ? (
          <div>
            <div className="small muted" style={{ margin: '6px 0 4px' }}>Recent servers</div>
            {recent.map((s) => (
              <div key={s} className="recent-server">
                <Icon name="server" size={14} />
                <button className="btn ghost sm grow" style={{ justifyContent: 'flex-start', fontFamily: 'var(--mono)' }} onClick={() => setAddress(s)} onDoubleClick={() => void connect(s)}>{s}</button>
                <button className="btn ghost sm icon" title="Forget" aria-label="Forget" onClick={() => void api.places.forgetServer(s).then(setRecent)}><Icon name="close" size={12} /></button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!parsed || busy} onClick={() => void connect()}>{busy ? 'Connecting…' : 'Connect'}</button>
        </div>
      </div>
    </Modal>
  );
}

export function Network() {
  const { go, toast } = useStore();
  const [m, reload] = usePlaces();
  const [servers, setServers] = useState<DiscoveredServer[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [connect, setConnect] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    setServers(await api.places.discover().catch(() => []));
    setScanning(false);
  }, []);
  useEffect(() => void scan(), [scan]);

  const addressFor = (s: DiscoveredServer) => `${s.protocols.includes('smb') ? 'smb' : s.protocols[0] ?? 'smb'}://${s.host || s.address}`;
  const eject = async (path: string, name: string) => {
    const r = await api.places.eject(path);
    toast(r.ok ? `Disconnected ${name}` : r.message ?? `Could not disconnect ${name}`);
    reload();
  };

  return (
    <div>
      <PageHead title="Network" sub="Computers and storage on your network, and the shares you are connected to.">
        <button className="btn" disabled={scanning} onClick={() => void scan()}><Icon name="refresh" size={14} />{scanning ? 'Looking…' : 'Look again'}</button>
        <button className="btn" onClick={() => setSaving(true)} title="Home servers, NAS boxes and computers: what each one is, its shared folders and external drives, saved in Cloud & Servers"><Icon name="plus" size={14} />Save a Connection…</button>
        <button className="btn primary" onClick={() => setConnect('')}><Icon name="server" size={14} />Connect to Server…</button>
      </PageHead>

      <h3 style={{ margin: '4px 0 10px' }}>Connected</h3>
      {m?.network.length ? (
        <div className="server-grid" style={{ marginBottom: 22 }}>
          {m.network.map((p) => (
            <div key={p.id} className="card server-card">
              <div className="server-icon"><Icon name="server" size={20} /></div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis" style={{ fontWeight: 600 }}>{p.name}</div>
                <div className="small muted ellipsis">{p.server ?? p.path}{p.total ? ` · ${formatBytes(p.free ?? 0)} free` : ''}</div>
                {p.protocol ? <span className="proto">{p.protocol}</span> : null}
              </div>
              <button className="btn sm" onClick={() => go({ name: 'browse', arg: p.path })}>Open</button>
              <button className="btn ghost sm icon" title={`Disconnect ${p.name}`} aria-label={`Disconnect ${p.name}`} onClick={() => void eject(p.path, p.name)}><Icon name="eject" size={13} /></button>
            </div>
          ))}
        </div>
      ) : <p className="small muted" style={{ marginBottom: 22 }}>No network shares are connected.</p>}

      <h3 style={{ margin: '4px 0 10px' }}>Nearby</h3>
      {servers === null ? (
        <div className="row small muted"><div className="spinner" style={{ width: 14, height: 14 }} />Looking for servers…</div>
      ) : servers.length ? (
        <div className="server-grid">
          {servers.map((s) => (
            <button key={`${s.host}-${s.name}`} className="card server-card hover" style={{ textAlign: 'left' }} onClick={() => setConnect(addressFor(s))}>
              <div className="server-icon"><Icon name={/\b(mac|imac|macbook)/i.test(s.name) ? 'laptop' : 'server'} size={20} /></div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis" style={{ fontWeight: 600 }}>{s.name}</div>
                <div className="small muted ellipsis">{s.host}{s.address && s.address !== s.host ? ` · ${s.address}` : ''}</div>
                <div className="row" style={{ gap: 4, marginTop: 3 }}>{s.protocols.map((p) => <span key={p} className="proto">{p}</span>)}</div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Empty icon="server" title="No servers found nearby">
          Servers that announce themselves (most NAS boxes, Macs with file sharing on, Linux machines running Samba with Avahi) appear here. You can still connect to any address with Connect to Server.
        </Empty>
      )}
      {saving ? <ConnectionDialog initialTab="network" onClose={() => setSaving(false)} /> : null}
      {connect !== null ? <ConnectDialog initial={connect} onClose={() => { setConnect(null); reload(); }} /> : null}
    </div>
  );
}
