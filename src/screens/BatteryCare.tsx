// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Battery Care: the charge now, one choice of where charging stops, a full
// charge for a trip and pausing while warm, and plainly what this computer
// allows (Linux sets it; Windows opens the maker's app; a Mac uses its own).

import { useCallback, useEffect, useState } from 'react';
import type { BatteryCareStatus } from '../../core/api-battery';
import { LIMITS, planWords } from '../../core/charge-limit';
import { api } from '../api';
import { Empty, Loading, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import { Ring } from './Protection';
import '../styles/extras.css';
import '../styles/battery-care.css';

const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export function BatteryCare() {
  const { toast } = useStore();
  const [st, setSt] = useState<BatteryCareStatus | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [allow, setAllow] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => void api.batteryCare.status().then((s) => { setSt(s); setAllow((a) => a || s.withoutAsking); }).catch(() => undefined), []);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 30_000);
    const off = api.on('battery-care-changed', load);
    return () => { window.clearInterval(t); off(); };
  }, [load]);

  if (!st) return <div className="page"><PageHead title="Battery Care" /><Loading /></div>;
  const b = st.battery;
  const chosen = pick ?? st.settings.limit;
  // Something to apply: a new choice, a limit the battery does not have yet, or one not kept after a restart.
  const pending = (pick !== null && pick !== st.settings.limit) || allow !== st.withoutAsking || (st.plan?.reason === 'limit' && (st.current !== st.settings.limit || !st.kept));
  const apply = async () => {
    setBusy(true);
    const r = await api.batteryCare.apply(chosen, { withoutAsking: allow }).catch((e) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    setBusy(false);
    setPick(null);
    toast(r.message);
    load();
  };

  return (
    <div className="page bc" data-testid="battery-care">
      <PageHead title="Battery Care" sub="Help your battery last longer." />
      {!b ? (
        <Empty icon="battery" title="No battery here" hint="Battery Care is for laptops and tablets.">{st.note}</Empty>
      ) : (
        <>
          <section className="bc-hero" data-testid="bc-hero">
            <Ring value={b.percent} size={128} color={b.percent < 20 ? 'var(--danger)' : 'var(--ok)'} label={`${Math.round(b.percent)}%`} sub={b.charging ? 'charging' : b.plugged ? 'plugged in' : 'on battery'} />
            <div className="bc-hero-text">
              <div className="fr-kicker">Now</div>
              <h2 className="bc-hero-title" data-testid="bc-plan">
                {st.support === 'linux' && st.plan ? planWords(st.plan, st.settings, b.temp, when) : st.support === 'mac' ? 'Your Mac manages charging' : st.support === 'windows' ? 'Your laptop’s maker sets the limit' : 'Charging to 100%'}
              </h2>
              <p className="trust-line">
                {[b.plugged ? 'Plugged in' : 'On battery', b.temp !== undefined ? `${b.temp}°C` : '', st.support === 'linux' && st.kept ? 'Kept after a restart' : '', st.withoutAsking ? 'Keeper may adjust it' : ''].filter(Boolean).join(' · ')}
              </p>
            </div>
          </section>

          {st.support === 'linux' && st.canLimit ? (
            <>
              <section className="bc-card" aria-labelledby="bc-limit-h">
                <h3 id="bc-limit-h">Stop charging at</h3>
                <div className="seg bc-seg" role="group" aria-label="Stop charging at" data-testid="bc-limits">
                  {LIMITS.map((l) => <button key={l} className={chosen === l ? 'on' : ''} aria-pressed={chosen === l} onClick={() => setPick(l)}>{l === 100 ? 'No limit' : `${l}%`}</button>)}
                </div>
                <p className="small muted">80% suits a laptop that is plugged in most of the day. Charging starts again {chosen >= 100 ? 'whenever it is not full' : `below ${chosen - 5}%`}.</p>
                <label className="row small bc-allow"><input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} data-testid="bc-allow" /> Let Keeper adjust it by itself, for trips and warm days</label>
                <div className="btn-row">
                  <button className="btn primary" onClick={() => void apply()} disabled={busy || !pending} data-testid="bc-apply">{busy ? 'Asking for your password…' : 'Apply'}</button>
                  <span className="small muted">Your password is asked once.</span>
                </div>
                {st.message ? <p className="small bc-problem" role="status">{st.message}</p> : null}
              </section>

              <section className="bc-card" aria-label="More">
                <div className="bc-row">
                  <span className="bc-row-text"><b>Full charge for a trip</b><span className="small muted">{st.settings.tripUntil > Date.now() ? `Until ${when(st.settings.tripUntil)}, then back to ${st.settings.limit}%` : 'Charge to 100% once, until tomorrow morning.'}</span></span>
                  {st.settings.tripUntil > Date.now()
                    ? <button className="btn" onClick={async () => setSt(await api.batteryCare.setTrip(false))} data-testid="bc-trip-off">Cancel</button>
                    : <button className="btn" disabled={!st.withoutAsking} title={st.withoutAsking ? undefined : 'Let Keeper adjust it by itself first'} onClick={async () => setSt(await api.batteryCare.setTrip(true))} data-testid="bc-trip">Charge to 100%</button>}
                </div>
                <div className="bc-row">
                  <span className="bc-row-text"><b>Pause when warm</b><span className="small muted">{st.canPause ? `Charging waits while the battery is ${st.settings.hotC}°C or warmer.` : 'This battery cannot pause charging.'}</span></span>
                  <Toggle on={st.settings.heat} disabled={!st.withoutAsking || !st.canPause} label="Pause when warm" onChange={async (v) => setSt(await api.batteryCare.setHeat(v))} />
                </div>
              </section>
            </>
          ) : st.support === 'mac' ? (
            <section className="bc-card" data-testid="bc-mac">
              <h3>On a Mac</h3>
              <p className="small">macOS learns when you usually unplug and holds the charge at 80% until then (Optimised Battery Charging). If your Mac offers a charge limit, it is in Battery settings too.</p>
              <p className="small muted">A fixed limit set by another app needs low-level hardware access that Apple does not offer, so Keeper leaves charging to macOS.</p>
              <div className="btn-row"><button className="btn primary" onClick={() => void api.batteryCare.openSettings()}>Open Battery settings</button></div>
            </section>
          ) : st.support === 'windows' ? (
            <section className="bc-card" data-testid="bc-windows">
              <h3>On Windows</h3>
              <p className="small">Windows has no common charge limit: each laptop maker offers one in its own app.{st.vendor ? ` On this ${st.vendor.maker} laptop that is ${st.vendor.name}.` : ''}</p>
              {st.note ? <p className="small muted">{st.note}</p> : null}
              <div className="btn-row">{st.vendor ? <button className="btn primary" onClick={() => void api.batteryCare.openSettings()}>{st.vendor.appId ? `Open ${st.vendor.name}` : `Get ${st.vendor.name}`}</button> : <button className="btn" onClick={() => void api.batteryCare.openSettings()}>Open power settings</button>}</div>
            </section>
          ) : (
            <Empty icon="battery" title="No charge limit here" hint="Some makers offer one in the firmware settings.">{st.note}</Empty>
          )}

          <details className="bc-how xmore">
            <summary>Works with your computer</summary>
            <ul className="small muted">
              <li><b>Linux</b>: the system’s own charge limit (ThinkPad, ASUS, Framework, Dell, Huawei, LG, MSI, Samsung, System76 and others). Kept after a restart.</li>
              <li><b>Windows</b>: opens your laptop maker’s app, which sets it.</li>
              <li><b>Mac</b>: macOS manages charging; Keeper opens Battery settings.</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
