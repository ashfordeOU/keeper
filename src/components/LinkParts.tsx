// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper Link pieces used outside the Devices page: the sidebar section with
// your devices (drop files on one to send them), and the prompts that can come
// up anywhere — compare six digits, a file arriving, a phone asking to join.

import { useCallback, useEffect, useState } from 'react';
import type { FileOffer, LinkDevice, LinkState, PairPrompt } from '../../core/api-link';
import { formatBytes } from '../../core/format';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import { NavSection } from './NavSection';
import { ContextMenu, Modal, type MenuItem } from './ui';
import '../styles/link.css';

/** Live Link state; refreshes when the main process says something changed. */
export function useLink(): [LinkState | null, () => void] {
  const [s, setS] = useState<LinkState | null>(null);
  const load = useCallback(() => void api.link.state().then(setS).catch(() => undefined), []);
  useEffect(() => {
    load();
    const offs = [api.on('link-changed', load), api.on('link-transfer', load)];
    return () => offs.forEach((o) => o());
  }, [load]);
  return [s, load];
}

export const osIcon = (os: string) => (os === 'ios' || os === 'android' ? 'phone' : os === 'linux' ? 'server' : 'laptop');
export const osName = (os: string) => ({ darwin: 'Mac', win32: 'Windows', linux: 'Linux', ios: 'iPhone or iPad', android: 'Android' } as Record<string, string>)[os] ?? os;
export const viaLabel = (v?: string) => ({ lan: 'Local network', direct: 'Direct', relay: 'Relay', tunnel: 'Tunnel', local: 'This computer' } as Record<string, string>)[v ?? ''] ?? '';

export function DeviceDot({ d }: { d: Pick<LinkDevice, 'online' | 'via'> }) {
  return <span className={`link-dot ${d.online ? (d.via === 'relay' || d.via === 'tunnel' ? 'far' : 'on') : 'off'}`} />;
}

/** Sidebar: your devices, with drop-to-send. */
export function DevicesSidebar() {
  const { route, go, toast } = useStore();
  const [s] = useLink();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  if (!s || s.settings.mode === 'off') {
    return (
      <NavSection id="devices" title="Devices">
        <button className={`nav-item ${route.name === 'devices' ? 'active' : ''}`} onClick={() => go({ name: 'devices' })} title="Devices">
          <Icon name="link" size={15} /><span className="label ellipsis">Devices</span>
        </button>
      </NavSection>
    );
  }
  const send = async (d: LinkDevice, files: FileList) => {
    const paths = [...files].map((f) => api.files.pathOf?.(f) ?? '').filter(Boolean);
    if (!paths.length) return;
    toast(`Sending ${paths.length === 1 ? paths[0].split(/[\\/]/).pop() : `${paths.length} files`} to ${d.name}…`);
    try {
      await api.link.sendFiles(d.id, paths);
      toast(`Sent to ${d.name}`);
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    }
  };
  return (
    <NavSection id="devices" title="Devices">
      {s.devices.map((d) => (
        <button
          key={d.id}
          className={`nav-item link-side ${route.name === 'devices' && route.arg === d.id ? 'active' : ''} ${over === d.id ? 'drop' : ''}`}
          title={`${d.name}${d.online ? ` — ${viaLabel(d.via) || 'nearby'}` : ' — not reachable now'}. Drop files here to send them.`}
          onClick={() => go({ name: 'devices', arg: d.id })}
          onDragOver={(e) => { e.preventDefault(); setOver(d.id); }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => { e.preventDefault(); setOver(null); void send(d, e.dataTransfer.files); }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, items: [
              { label: 'Send Files…', icon: 'send', run: () => void api.link.sendFiles(d.id).catch((x: Error) => toast(x.message)) },
              { label: 'Send Clipboard', icon: 'clipboard', run: () => void api.link.sendClipboard(d.id).then(() => toast(`Clipboard sent to ${d.name}`), (x: Error) => toast(x.message)) },
              { label: 'View Screen', icon: 'eye', run: () => void api.screen.view(d.id, { control: false }).catch((x: Error) => toast(x.message)) },
              { label: 'Control Screen', icon: 'laptop', run: () => void api.screen.view(d.id, { control: true }).catch((x: Error) => toast(x.message)) },
              { label: 'Shared Folders', icon: 'folder', run: () => go({ name: 'devices', arg: d.id }) },
              { label: 'Check Connection', icon: 'refresh', run: () => void api.link.check(d.id).then((r) => toast(r.ok ? `${d.name}: ${viaLabel(r.via)}, ${r.rtt} ms` : r.error ?? 'Not reachable')) },
            ] });
          }}
        >
          <Icon name={osIcon(d.os)} size={15} />
          <span className="label ellipsis">{d.name}</span>
          <DeviceDot d={d} />
        </button>
      ))}
      {s.companions.map((c) => (
        <button key={c.id} className="nav-item link-side" onClick={() => go({ name: 'devices', arg: 'phone' })} title={`${c.name} (phone companion)`}>
          <Icon name="phone" size={15} />
          <span className="label ellipsis">{c.name}</span>
          <DeviceDot d={{ online: c.online, via: 'lan' }} />
        </button>
      ))}
      <button className={`nav-item ${route.name === 'devices' && !route.arg ? 'active' : ''}`} onClick={() => go({ name: 'devices' })} title="Pair a device, phones, remote access">
        <Icon name="plus" size={15} /><span className="label ellipsis">{s.devices.length ? 'Devices & Remote' : 'Pair a Device'}</span>
      </button>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </NavSection>
  );
}

/** Prompts that can come up on any page. */
export function LinkPrompts() {
  const { toast } = useStore();
  const [pair, setPair] = useState<PairPrompt | null>(null);
  const [offers, setOffers] = useState<FileOffer[]>([]);
  const [phone, setPhone] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    void api.link.pending().then((p) => {
      if (p.pairs[0]) setPair(p.pairs[0]);
      setOffers(p.offers);
    }).catch(() => undefined);
    const offs = [
      api.on('link-pair', (p) => setPair(p)),
      api.on('link-offer', (o) => setOffers((x) => [...x, o])),
      api.on('link-companion', (c) => setPhone(c)),
    ];
    return () => offs.forEach((o) => o());
  }, []);
  const offer = offers[0];
  const answer = (o: FileOffer, ok: boolean, always = false) => {
    setOffers((x) => x.filter((y) => y.id !== o.id));
    void api.link.answerOffer(o.id, ok, always);
    if (ok) toast(`Receiving ${o.name}…`);
  };
  return (
    <>
      {pair ? (
        <Modal title={pair.role === 'host' ? `Pair with ${pair.peer.name}?` : `Pairing with ${pair.peer.name}`} onClose={() => { void api.link.confirmPair(pair.id, false); setPair(null); }} width={440}>
          <div className="col link-sas-box">
            <div className="small muted">Check that both screens show the same six digits.</div>
            <div className="link-sas" data-testid="link-sas">{pair.sas}</div>
            <div className="small muted">{osName(pair.peer.os)} · key <code>{pair.peer.fingerprint}</code></div>
            <div className="small muted">If the digits are different, someone may be in between: choose “They don’t match”.</div>
            <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => { void api.link.confirmPair(pair.id, false); setPair(null); }}>They don’t match</button>
              <button className="btn primary" onClick={() => { void api.link.confirmPair(pair.id, true); setPair(null); toast('Waiting for the other device…'); }}>They match — Pair</button>
            </div>
          </div>
        </Modal>
      ) : offer ? (
        <Modal title={`${offer.fromName} is sending a file`} onClose={() => answer(offer, false)} width={440}>
          <div className="row" style={{ gap: 12 }}>
            <Icon name="down" size={22} />
            <div className="grow">
              <div style={{ fontWeight: 600 }} className="ellipsis">{offer.name}</div>
              <div className="small muted">{formatBytes(offer.size)} · saved to Downloads/Keeper</div>
            </div>
          </div>
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn" onClick={() => answer(offer, false)}>Decline</button>
            <button className="btn" onClick={() => answer(offer, true, true)} title={`Accept files from ${offer.fromName} without asking from now on`}>Always Accept</button>
            <button className="btn primary" onClick={() => answer(offer, true)}>Accept</button>
          </div>
        </Modal>
      ) : phone ? (
        <Modal title="Allow this phone?" onClose={() => { void api.link.answerCompanion(phone.id, false); setPhone(null); }} width={420}>
          <p style={{ marginTop: 0 }}><b>{phone.name}</b> scanned the QR code and wants to connect. It will be able to send files here, open your shared folders and read the clipboard.</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => { void api.link.answerCompanion(phone.id, false); setPhone(null); }}>Don’t Allow</button>
            <button className="btn primary" onClick={() => { void api.link.answerCompanion(phone.id, true); setPhone(null); toast(`${phone.name} connected`); }}>Allow</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
