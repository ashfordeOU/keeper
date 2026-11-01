// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The deeper half of the process inspector: who signed it, its parents,
// listening ports, and its environment — hidden until asked, and secrets
// hidden until asked a second time.

import { useEffect, useState } from 'react';
import type { ProcExtras } from '../../../core/api-sysmon';
import { api } from '../../api';
import { Icon } from '../../components/Icon';

export function InspectExtras({ pid, onPick }: { pid: number; onPick: (pid: number) => void }) {
  const [x, setX] = useState<ProcExtras | null | undefined>(undefined);
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    setX(undefined);
    setReveal(0);
    void api.sysmon.procExtras(pid).then(setX).catch(() => setX(null));
  }, [pid]);
  useEffect(() => {
    if (!reveal) return;
    void api.sysmon.procExtras(pid, { reveal: true, revealSecrets: reveal > 1, signature: false }).then((r) => r && setX((old) => (old ? { ...old, env: r.env } : r)));
  }, [pid, reveal]);
  if (x === undefined) return <p className="small muted">Checking signature and parents…</p>;
  if (!x) return null;
  const sig = x.signature;
  const secrets = x.env?.filter((e) => e.secret).length ?? 0;
  return (
    <>
      {sig ? (
        <>
          <h4>{sig.source === 'package' ? 'Where it came from' : 'Signature'}</h4>
          <div className="kv">
            <span>Status</span>
            <b style={{ color: sig.valid ? 'var(--ok)' : sig.signed ? 'var(--warn)' : 'var(--text-2)' }}><Icon name={sig.valid ? 'check' : 'warning'} size={12} /> {sig.valid ? (sig.source === 'package' ? 'From the system’s packages' : 'Signed and intact') : sig.signed ? 'Signed, but it does not check out' : sig.source === 'package' ? 'Not from a system package' : 'Not signed'}</b>
            {sig.signer ? <><span>{sig.source === 'package' ? 'Package' : 'Signed by'}</span><b className="wrap">{sig.signer}</b></> : null}
            {sig.teamId ? <><span>Team ID</span><b className="mono">{sig.teamId}</b></> : null}
            {sig.identifier && sig.source !== 'package' ? <><span>Identifier</span><b className="mono wrap">{sig.identifier}</b></> : null}
            {sig.source === 'codesign' ? <><span>Protections</span><b>{[sig.hardenedRuntime ? 'hardened runtime' : 'no hardened runtime', sig.sandboxed ? 'sandboxed' : 'not sandboxed', sig.notarized ? 'notarised' : null, sig.platform ? 'part of macOS' : null].filter(Boolean).join(' · ')}</b></> : null}
            {sig.source === 'authenticode' && sig.platform ? <><span>Part of</span><b>Windows</b></> : null}
            {sig.note && !sig.valid ? <><span>Note</span><b className="wrap">{sig.note}</b></> : null}
          </div>
        </>
      ) : null}
      {x.parents.length ? (
        <>
          <h4>Started by</h4>
          <div className="chips">{x.parents.map((p, i) => <button key={p.pid} className="badge" onClick={() => onPick(p.pid)}>{i ? '← ' : ''}{p.name} · {p.pid}</button>)}</div>
        </>
      ) : null}
      {x.ports.length ? (
        <>
          <h4>Listening on</h4>
          <div className="chips">{x.ports.map((p) => <button key={p} className="badge" onClick={() => void api.system.openExternal(`http://localhost:${p}`)}>port {p}</button>)}</div>
        </>
      ) : null}
      <h4>Environment {x.env ? `(${x.env.length})` : ''}</h4>
      {x.env ? (
        <>
          <div className="row small" style={{ gap: 8, marginBottom: 6 }}>
            <span className="muted grow">{reveal ? (reveal > 1 ? 'Everything is shown.' : `Values shown${secrets ? `; ${secrets} that look like passwords or keys stay hidden` : ''}.`) : 'Only setup values (PATH, HOME, LANG…) are shown.'}</span>
            {reveal < 1 ? <button className="btn ghost sm" onClick={() => setReveal(1)}>Show values</button> : reveal < 2 && secrets ? <button className="btn ghost sm" onClick={() => setReveal(2)}>Show secrets too</button> : null}
          </div>
          <div className="inspect-list mono">
            {x.env.map((e) => <div key={e.name} className="ellipsis" title={e.value ?? ''}><b>{e.name}</b>={e.value ?? <span className="muted">{e.secret ? '•••• (looks secret)' : '••••'}</span>}</div>)}
          </div>
        </>
      ) : <p className="small muted">{x.envError}</p>}
    </>
  );
}
