// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Health → Sound & tabs: the per-app volume mixer and output device, browser
// tabs by memory and data (through Keeper's browser extension), and on macOS
// energy impact, what keeps it awake and App Nap per app.

import { useCallback, useState } from 'react';
import { formatBytes } from '../../../core/format';
import type { EnergyRow } from '../../../core/monitor-energy';
import type { MixerState } from '../../../core/monitor-mixer';
import type { SysmonApi } from '../../../core/api-sysmon';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { Loading, Toggle } from '../../components/ui';
import { useFeature } from '../../features';
import { useStore } from '../../state';
import { useVisibleInterval } from './common';
import '../../styles/extras.css';

type Tabs = Awaited<ReturnType<SysmonApi['tabs']>>;

export function HealthApps() {
  const { toast, go } = useStore();
  const perApp = useFeature('soundPerApp');
  const [mix, setMix] = useState<MixerState | null>(null);
  const [tabs, setTabs] = useState<Tabs | null>(null);
  const [energy, setEnergy] = useState<{ supported: boolean; rows: EnergyRow[]; note?: string } | null>(null);
  const load = useCallback(() => {
    void api.sysmon.mixer().then(setMix).catch(() => setMix({ supported: false, streams: [], outputs: [], canSwitchOutput: false }));
    void api.sysmon.tabs().then(setTabs).catch(() => setTabs({ linked: false, tabs: [] }));
  }, []);
  useVisibleInterval(load, 4000, [load]);
  useVisibleInterval(() => void api.sysmon.energy().then(setEnergy).catch(() => undefined), 10_000);

  const setStream = async (id: string, patch: { volume?: number; muted?: boolean }) => {
    setMix((m) => (m ? { ...m, streams: m.streams.map((s) => (s.id === id ? { ...s, ...patch, remembered: perApp || s.remembered } : s)) } : m));
    if (!(await api.sysmon.setStream(id, patch))) toast('The sound system did not accept the change');
  };
  const setStreamOutput = async (id: string, sink: string) => {
    setMix((m) => (m ? { ...m, streams: m.streams.map((s) => (s.id === id ? { ...s, output: sink, remembered: perApp || s.remembered } : s)) } : m));
    if (!(await api.sysmon.setStreamOutput(id, sink))) toast('Could not move that app to another output');
  };
  const canVolume = mix?.canSetVolume !== false;

  return (
    <div>
      <div className="section-head"><h3>Sound by app</h3>{mix?.canSwitchOutput && mix.outputs.length ? (
        <label className="row small" style={{ gap: 8 }}>Output
          <select className="input" style={{ height: 28, width: 'auto' }} value={mix.outputs.find((o) => o.default)?.id ?? ''} onChange={async (e) => { const id = e.target.value; setMix({ ...mix, outputs: mix.outputs.map((o) => ({ ...o, default: o.id === id })) }); if (!(await api.sysmon.setOutput(id))) toast('Could not switch the output'); }} aria-label="Output device">
            {mix.outputs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      ) : null}</div>
      {!mix ? <Loading /> : !mix.supported ? <p className="small muted card pad">{mix.note}</p> : mix.streams.length ? (
        <div className="card mon-mixer">
          {mix.streams.map((s) => (
            <div key={s.id} className="mon-mix-row">
              <Icon name="audio" size={14} />
              <span className="ellipsis" title={s.pid ? `PID ${s.pid}` : undefined}>{s.name}</span>
              <button className={`btn ghost sm icon${s.muted ? ' danger' : ''}`} disabled={!canVolume} title={s.muted ? 'Unmute' : 'Mute'} aria-label={s.muted ? `Unmute ${s.name}` : `Mute ${s.name}`} onClick={() => void setStream(s.id, { muted: !s.muted })}><Icon name={s.muted ? 'minus' : 'audio'} size={13} /></button>
              <input type="range" min={0} max={100} value={Math.min(100, s.volume)} disabled={!canVolume} aria-label={`${s.name} volume`} onChange={(e) => setMix((m) => (m ? { ...m, streams: m.streams.map((x) => (x.id === s.id ? { ...x, volume: Number(e.target.value) } : x)) } : m))} onMouseUp={(e) => void setStream(s.id, { volume: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => void setStream(s.id, { volume: Number((e.target as HTMLInputElement).value) })} />
              <span className="num small" style={{ width: 40, textAlign: 'right' }}>{s.muted ? 'muted' : `${Math.round(s.volume)}%`}</span>
              {mix.canRouteStreams && mix.outputs.length > 1 ? (
                <select className="input mon-mix-out" aria-label={`${s.name} plays to`} value={s.output ?? ''} onChange={(e) => void setStreamOutput(s.id, e.target.value)} data-testid="mix-out">
                  {!s.output ? <option value="">Default output</option> : null}
                  {mix.outputs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              ) : null}
              {s.remembered ? <button className="btn ghost sm" title={`Keeper sets ${s.name}’s sound again each time it plays. Forget it.`} onClick={async () => { await api.sysmon.forgetSound(s.name); load(); toast(`${s.name} is back to the system’s own sound`); }} data-testid="mix-forget">Forget</button> : null}
            </div>
          ))}
          {mix.note ? <p className="small muted" style={{ padding: '0 14px 10px' }}>{mix.note}</p> : null}
        </div>
      ) : <p className="small muted">No app is playing sound right now.</p>}
      {mix?.supported ? (
        <div className="row small mon-mix-keep">
          <span className="trust-line grow" data-testid="mix-keep-line">{perApp ? 'Each app keeps its volume and output · Set again when it plays' : 'Keep each app’s volume and output for next time'}</span>
          <Toggle on={perApp} label="Keep each app’s sound" onChange={(v) => void api.features.set('soundPerApp', v)} />
        </div>
      ) : null}

      <div className="section-head" style={{ marginTop: 18 }}><h3>Browser tabs</h3><span className="small muted">memory and data per tab, from Keeper’s browser extension</span></div>
      {!tabs ? <Loading /> : !tabs.linked ? (
        <div className="card pad row" style={{ gap: 10 }}><span className="small muted grow">No browser is linked yet. Keeper’s extension reports each tab’s memory (an estimate from the page) and the data it loaded.</span><button className="btn sm" onClick={() => go({ name: 'browsers' })}>Browser tabs…</button></div>
      ) : (
        <div className="card">
          <table className="table">
            <thead><tr><th>Tab</th><th>Memory</th><th>Data</th><th /></tr></thead>
            <tbody>
              {tabs.tabs.slice(0, 25).map((t) => (
                <tr key={`${t.session}:${t.id}`}>
                  <td><span className="ellipsis" style={{ display: 'block', maxWidth: 460 }} title={t.url}>{t.title || t.url}</span><span className="small muted">{t.browser}{t.audible ? ' · playing sound' : ''}{t.asleep ? ' · asleep' : ''}</span></td>
                  <td className="num">{t.memory ? formatBytes(t.memory) : '—'}</td>
                  <td className="num">{t.bytes ? formatBytes(t.bytes) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{!t.asleep ? <button className="btn ghost sm" title="Free its memory; it reloads when you open it" onClick={async () => { const r = await api.browserTabs.tab(t.session, t.id, 'discard'); toast(r.ok ? 'Tab put to sleep' : r.message ?? 'Could not'); load(); }}>Sleep</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {energy?.supported ? (
        <>
          <div className="section-head" style={{ marginTop: 18 }}><h3>Energy</h3><span className="small muted">energy impact, what keeps the Mac awake, and App Nap</span></div>
          <div className="card">
            <table className="table">
              <thead><tr><th>App</th><th>Energy impact</th><th>Keeping awake</th><th title="Lets macOS slow the app down while it is hidden">App Nap</th></tr></thead>
              <tbody>
                {energy.rows.slice(0, 15).map((r) => (
                  <tr key={r.pid}>
                    <td>{r.name}<span className="small muted"> · {r.pid}</span></td>
                    <td className="num">{r.power.toFixed(1)}</td>
                    <td className="small">{r.holds?.join('; ') ?? ''}</td>
                    <td>{r.bundleId ? <Toggle on={r.appNap !== false} onChange={async (v) => { if (await api.sysmon.setAppNap(r.bundleId!, v)) { toast(`App Nap ${v ? 'allowed' : 'off'} for ${r.name}; it applies the next time the app starts`); setEnergy({ ...energy, rows: energy.rows.map((x) => (x.pid === r.pid ? { ...x, appNap: v } : x)) }); } }} /> : <span className="muted small">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
