// SPDX-License-Identifier: AGPL-3.0-or-later
// VPN: the computer's VPN connections with Connect and Disconnect, whether all
// traffic really goes through them (IPv6 and DNS leaks), the public address
// seen from outside, importing WireGuard and OpenVPN files, and auto-reconnect.

import { useCallback, useEffect, useState } from 'react';
import type { PublicIpResult, VpnImportPreview, VpnStatus } from '../../core/api-net';
import { formatBytes, relativeTime } from '../../core/format';
import type { VpnConn } from '../../core/net/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Loading, Modal, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/net.css';

const TYPE: Record<string, string> = { wireguard: 'WireGuard', openvpn: 'OpenVPN', ikev2: 'IKEv2', l2tp: 'L2TP', ipsec: 'IPsec', pptp: 'PPTP', sstp: 'SSTP', vpn: 'VPN', tun: 'Tunnel', automatic: 'Automatic' };

export function Vpn() {
  const { toast, go } = useStore();
  const [st, setSt] = useState<VpnStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ip, setIp] = useState<PublicIpResult | null>(null);
  const [ipBusy, setIpBusy] = useState(false);
  const [preview, setPreview] = useState<VpnImportPreview | null>(null);

  const load = useCallback(async () => setSt(await api.net.vpnStatus()), []);
  useEffect(() => {
    void load();
    const h = window.setInterval(() => document.visibilityState === 'visible' && void load(), 8000);
    return () => clearInterval(h);
  }, [load]);

  const act = async (v: VpnConn, action: 'connect' | 'disconnect') => {
    setBusy(v.id);
    const r = await api.net.vpnAction(v.id, action);
    setBusy(null);
    if (!r.ok) toast(r.message ?? `Could not ${action} ${v.name}`);
    else toast(action === 'connect' ? `Connecting ${v.name}…` : `Disconnected ${v.name}`);
    setTimeout(() => void load(), 1500);
    void load();
  };

  const setAuto = async (id: string, on: boolean) => {
    const cur = st?.autoReconnect ?? [];
    await api.net.setSettings({ autoReconnect: on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id) });
    void load();
  };

  const checkIp = async () => {
    setIpBusy(true);
    setIp(await api.net.publicIp());
    setIpBusy(false);
  };

  if (!st) return <div><PageHead title="VPN" /><Loading label="Looking for VPN connections…" /></div>;
  const v = st.verdict;
  const tone = !v.vpnUp ? 'neutral' : v.allV4 && v.allV6 && !v.dnsOutside.length ? 'good' : 'warn';

  return (
    <div className="net-page">
      <PageHead title="VPN" sub="Your VPN connections, and whether traffic really goes through them">
        <button className="btn" onClick={() => go({ name: 'netactivity' })}><Icon name="globe" size={13} /> Network Activity</button>
        <button className="btn primary" onClick={async () => { const p = await api.net.importPick(); if (p) setPreview(p); }}><Icon name="plus" size={13} /> Import a VPN file…</button>
      </PageHead>

      <div className={`card vpn-hero ${tone}`}>
        <div className="vpn-shield"><Icon name={tone === 'good' ? 'lock' : tone === 'warn' ? 'warning' : 'globe'} size={26} /></div>
        <div className="grow">
          <div className="vpn-title">{!v.vpnUp ? 'Not connected to a VPN' : tone === 'good' ? 'Protected' : 'Connected, with gaps'}</div>
          <div className="small">{v.summary}</div>
          <ul className="vpn-checks">
            <Check ok={v.allV4} label={v.allV4 ? `IPv4 internet traffic goes through ${v.v4Iface}` : `IPv4 internet traffic leaves through ${v.v4Iface ?? 'the normal connection'}`} />
            {v.v6Iface ? <Check ok={v.allV6} label={v.allV6 ? `IPv6 traffic goes through ${v.v6Iface}` : `IPv6 traffic leaves through ${v.v6Iface}${v.vpnUp ? ' — outside the VPN' : ''}`} /> : <Check ok label="No IPv6 route to the internet (nothing can leak over IPv6)" />}
            {v.vpnUp ? <Check ok={!v.dnsOutside.length} label={v.dnsOutside.length ? `Name lookups go to ${v.dnsOutside.join(', ')} outside the VPN (a DNS leak)` : 'Name lookups stay inside the VPN'} /> : null}
          </ul>
        </div>
        <div className="vpn-ip">
          <button className="btn sm" disabled={ipBusy} onClick={() => void checkIp()}>{ipBusy ? <div className="spinner" /> : <Icon name="globe" size={12} />} What the internet sees</button>
          {ip ? (
            <div className="small">
              {ip.error ? <div className="muted">{ip.error}</div> : null}
              {ip.current ? <div>Your address: <b className="mono">{ip.current}</b></div> : null}
              {ip.currentV6 ? <div>IPv6: <b className="mono">{ip.currentV6}</b></div> : null}
              {v.vpnUp && ip.outsideVpn ? (
                ip.outsideVpn === ip.current
                  ? <div className="warn-text">Outside the VPN ({ip.outsideIface}) the address is the same: either the VPN isn't hiding your address, or the system routes everything through it anyway.</div>
                  : <div className="muted">Without the VPN ({ip.outsideIface}): <span className="mono">{ip.outsideVpn}</span></div>
              ) : null}
              {v.vpnUp && v.v6Leak && ip.currentV6 ? <div className="warn-text">Sites that use IPv6 see {ip.currentV6}, which is not the VPN's.</div> : null}
            </div>
          ) : <div className="small muted">Asks a public address service; only when you press the button.</div>}
        </div>
      </div>

      {st.notes.length ? <div className="net-note small"><Icon name="info" size={13} /> {st.notes.join(' ')}</div> : null}

      <h2 className="vpn-h">Connections</h2>
      {!st.vpns.length ? (
        <Empty icon="lock" title="No VPN connections found">
          Import a WireGuard (.conf) or OpenVPN (.ovpn) file from your VPN provider or your own server, or add one in the system's network settings.
        </Empty>
      ) : (
        <div className="vpn-list">
          {st.vpns.map((c) => (
            <div key={c.id} className={`card vpn-item ${c.state}`}>
              <div className={`vpn-dot ${c.state}`} />
              <div className="grow">
                <div className="row" style={{ gap: 8 }}><b>{c.name}</b><span className="badge">{TYPE[c.type] ?? c.type}</span>{c.iface && c.state === 'connected' ? <span className="badge mono">{c.iface}</span> : null}</div>
                <div className="small muted">
                  {c.state === 'connected' ? 'Connected' : c.state === 'connecting' ? 'Connecting…' : c.state === 'disconnecting' ? 'Disconnecting…' : c.state === 'disconnected' ? 'Not connected' : 'State unknown'}
                  {c.server ? ` · ${c.server}` : ''}
                </div>
                {c.wg?.peers.map((p) => (
                  <div key={p.publicKey} className="small muted vpn-peer">
                    <span className="mono" title={p.publicKey}>{p.publicKey.slice(0, 10)}…</span>
                    {p.endpoint ? ` · ${p.endpoint}` : ''} · {p.allowedIps.join(', ')}
                    {p.handshake ? ` · last handshake ${relativeTime(p.handshake)}` : ' · no handshake yet'}
                    {` · ↓ ${formatBytes(p.rx)} ↑ ${formatBytes(p.tx)}`}
                  </div>
                ))}
              </div>
              <label className="small row vpn-auto" title="Keeper checks every minute and connects it again if it drops (not after you disconnect it yourself)">
                Reconnect if it drops <Toggle on={st.autoReconnect.includes(c.id)} onChange={(on) => void setAuto(c.id, on)} />
              </label>
              {c.state === 'connected' || c.state === 'connecting'
                ? <button className="btn" disabled={busy === c.id} onClick={() => void act(c, 'disconnect')}>{busy === c.id ? <div className="spinner" /> : null} Disconnect</button>
                : <button className="btn primary" disabled={busy === c.id} onClick={() => void act(c, 'connect')}>{busy === c.id ? <div className="spinner" /> : null} Connect</button>}
            </div>
          ))}
        </div>
      )}

      <details className="card pad vpn-advice">
        <summary><b>Stop traffic leaking when the VPN drops (kill switch)</b></summary>
        <ul>{st.advice.map((a, i) => <li key={i} className="small">{a}</li>)}</ul>
      </details>

      {preview ? <ImportDialog preview={preview} onClose={() => setPreview(null)} onDone={() => { setPreview(null); void load(); }} /> : null}
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return <li className={ok ? 'ok' : 'bad'}><Icon name={ok ? 'check' : 'warning'} size={13} /> {label}</li>;
}

function ImportDialog({ preview, onClose, onDone }: { preview: VpnImportPreview; onClose: () => void; onDone: () => void }) {
  const { toast } = useStore();
  const s = preview.summary;
  const [name, setName] = useState(s.name);
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = s.issues.filter((i) => i.level === 'error');
  const install = async () => {
    setBusy(true);
    const r = await api.net.importInstall(preview.token, { name, keepCopy: keep });
    setBusy(false);
    toast(r.message);
    if (r.ok) onDone();
  };
  return (
    <Modal title={`${s.kind === 'wireguard' ? 'WireGuard' : 'OpenVPN'} configuration`} onClose={onClose} width={640}>
      <div className="vpn-import">
        <div className="vpn-facts">
          <div><span className="muted small">Server</span><b className="mono">{s.servers.join(', ') || '—'}</b></div>
          {s.addresses.length ? <div><span className="muted small">Address in the tunnel</span><b className="mono">{s.addresses.join(', ')}</b></div> : null}
          <div><span className="muted small">Traffic</span><b>{s.fullTunnel ? 'Everything (full tunnel)' : 'Only some addresses (split tunnel)'}</b></div>
          <div><span className="muted small">DNS</span><b className="mono">{s.dns.join(', ') || 'not set'}</b></div>
          {s.needsLogin ? <div><span className="muted small">Login</span><b>Asks for a user name and password</b></div> : null}
        </div>
        {s.issues.length ? (
          <ul className="vpn-issues">
            {s.issues.map((i, k) => <li key={k} className={i.level}><Icon name={i.level === 'info' ? 'info' : 'warning'} size={13} /> {i.text}</li>)}
          </ul>
        ) : <div className="small ok-text"><Icon name="check" size={13} /> No problems found.</div>}
        <details>
          <summary className="small">Show the file (keys hidden)</summary>
          <pre className="vpn-pre">{s.redacted}</pre>
        </details>
        <label className="row" style={{ gap: 10, marginTop: 10 }}><span className="small" style={{ width: 120 }}>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="row" style={{ gap: 10, marginTop: 8 }}>
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span className="small">Keep an encrypted copy in Keeper (in the system keychain), to add it again later</span>
        </label>
        <div className="small muted" style={{ marginTop: 10 }}>{preview.methodNote}</div>
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !!errors.length || preview.method === 'manual'} onClick={() => void install()}>{busy ? <div className="spinner" /> : null} {preview.method === 'manual' ? 'Can\'t add it here' : 'Add VPN'}</button>
        </div>
      </div>
    </Modal>
  );
}
