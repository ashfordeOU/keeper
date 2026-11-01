// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote access on the Island: sessions where this device watches another
// one, a help code that is waiting (each with Stop), and a tile to Get help
// or Help someone without opening Keeper's window.

import { useEffect, useState } from 'react';
import type { HelpOfferView } from '../../core/access-types';
import type { ScreenState } from '../../core/api-screen';
import { formatCode } from '../../core/link/help-web';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useFeature } from '../features';
import { useSurface } from './surfaces';

type Remote = { id: string; title: string; detail?: string; since: number; ref: string };

/** Viewer sessions and a waiting help code, as Island activities. */
export function useRemoteActivities(): Remote[] {
  const shown = useSurface('sessions', 'island');
  const [sessions, setSessions] = useState<ScreenState['sessions']>([]);
  const [offer, setOffer] = useState<HelpOfferView | undefined>();
  useEffect(() => {
    const apply = (s: ScreenState) => setSessions(s.sessions);
    void api.screen?.state?.().then(apply).catch(() => undefined);
    const loadHelp = () => void api.access?.helpStatus?.().then((h) => setOffer(h.offer)).catch(() => undefined);
    loadHelp();
    const offs = [api.on('screen-state', apply as never), api.on('access-help' as never, loadHelp as never)];
    return () => offs.forEach((o) => o());
  }, []);
  if (!shown) return [];
  const out: Remote[] = sessions.filter((s) => s.role === 'viewer' && s.state !== 'ended').map((s) => ({ id: s.id, title: s.help ? `Helping ${s.peerName}` : `${s.control ? 'Controlling' : 'Watching'} ${s.peerName}`, detail: s.joined ? 'View only, invited' : undefined, since: s.started, ref: `session:${s.id}` }));
  if (offer) out.push({ id: 'help', title: `Help code ${formatCode(offer.code)}`, detail: `Password ${offer.password}`, since: offer.expires - 10 * 60_000, ref: 'help' });
  return out;
}

export function RemoteActivityActions({ refId }: { refId: string }) {
  if (refId === 'help') return <button className="btn sm danger" onClick={() => void api.access.helpStop()}>Stop</button>;
  const sid = refId.replace(/^session:/, '');
  return <button className="btn sm danger" onClick={() => void api.screen.stop(sid)}>Stop</button>;
}

/** Get help / Help someone, in the Island's Controls tab. */
export function RemoteTile() {
  const on = useFeature('remoteHelp');
  const shown = useSurface('help', 'island');
  const [offer, setOffer] = useState<HelpOfferView | null>(null);
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    const load = () => void api.access?.helpStatus?.().then((h) => setOffer(h.offer ?? null)).catch(() => undefined);
    load();
    return api.on('access-help' as never, load as never);
  }, []);
  if (!on || !shown) return null;
  const err = (e: unknown) => setMsg((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  return (
    <div className="tile" data-testid="island-help">
      <div className="ctl-head"><Icon name="laptop" size={13} /> Remote help</div>
      {offer ? (
        <div className="col" style={{ gap: 4 }}>
          <div className="small muted">Read these to the person helping you:</div>
          <div className="num" style={{ fontSize: 20, fontWeight: 650, letterSpacing: 1 }}>{formatCode(offer.code)}</div>
          <div className="small">Password <b className="mono">{offer.password}</b></div>
          <button className="btn sm danger" onClick={() => void api.access.helpStop()}>Stop</button>
        </div>
      ) : joining ? (
        <form className="col" style={{ gap: 4 }} onSubmit={(e) => { e.preventDefault(); setMsg('Connecting…'); void api.access.helpJoin(code, pw).then(() => { setJoining(false); setMsg(''); }, err); }}>
          <input className="input sm" placeholder="Session code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
          <input className="input sm" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <div className="btn-row"><button className="btn sm primary" disabled={!code || !pw}>Connect</button><button type="button" className="btn sm" onClick={() => setJoining(false)}>Cancel</button></div>
        </form>
      ) : (
        <div className="btn-row">
          <button className="btn sm" onClick={() => void api.access.helpStart().then(setOffer, err)}>Get Help</button>
          <button className="btn sm" onClick={() => setJoining(true)}>Help Someone</button>
        </div>
      )}
      {msg ? <div className="small muted">{msg}</div> : null}
    </div>
  );
}
