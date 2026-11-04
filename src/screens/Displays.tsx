// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Displays: each screen's size and refresh rate (and sharp text on a Mac),
// switched back by itself unless you press Keep; presets for each set of
// screens; and plugged-in monitors that follow the built-in screen's
// brightness or the time of day.

import { useCallback, useEffect, useState } from 'react';
import type { BrightnessState, DisplaysState } from '../../core/api-displays';
import { rateWords, sizesOf, sizeWords, type ScreenInfo, type SyncMode } from '../../core/display-modes';
import { api } from '../api';
import { useFeature } from '../features';
import { Icon } from '../components/Icon';
import { Empty, Loading, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/extras.css';
import '../styles/displays.css';

const HOURS = Array.from({ length: 24 }, (_, h) => h * 60);
const hourWords = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:00`;

/** A slider that saves when it is let go (monitors are slow to change, and each change is written to them). */
function Level({ value, min, max, step, label, onCommit, words }: { value: number; min: number; max: number; step: number; label: string; onCommit: (v: number) => void; words?: (v: number) => string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v !== value) onCommit(v); };
  return (
    <>
      {words ? <span className="small muted dp-off-label">{words(v)}</span> : null}
      <input type="range" min={min} max={max} step={step} value={v} aria-label={label} onChange={(e) => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
    </>
  );
}

function ScreenCard({ s, onPick }: { s: ScreenInfo; onPick: (s: ScreenInfo, m: { width: number; height: number; refresh?: number; hidpi?: boolean }) => void }) {
  const cur = s.modes.find((m) => m.current);
  const sizes = sizesOf(s.modes);
  const curSize = sizes.find((x) => x.width === cur?.width && x.height === cur?.height);
  const both = !!curSize?.hidpi && !!curSize.lowres;
  return (
    <section className="dp-card" data-testid="dp-screen" aria-label={s.name}>
      <div className="dp-card-head">
        <span className="dp-badge" aria-hidden><Icon name={s.builtIn ? 'laptop' : 'columns'} size={18} /></span>
        <span className="dp-card-title">
          <span className="fr-kicker">{s.builtIn ? 'Built in' : s.main ? 'Main screen' : 'Screen'}</span>
          <b>{s.name}</b>
        </span>
        <span className="small muted" data-testid="dp-current">{cur ? `${sizeWords(cur)} · ${rateWords(cur.refresh)}` : 'Mode unknown'}</span>
      </div>
      {sizes.length ? (
        <div className="dp-fields">
          <label className="dp-field"><span className="small muted">Size</span>
            <select className="input" aria-label={`${s.name} size`} value={cur ? `${cur.width}x${cur.height}` : ''} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); onPick(s, { width: w, height: h, hidpi: cur?.hidpi }); }} data-testid="dp-size">
              {!cur ? <option value="">Choose</option> : null}
              {sizes.map((z) => <option key={`${z.width}x${z.height}`} value={`${z.width}x${z.height}`}>{sizeWords(z)}</option>)}
            </select>
          </label>
          <label className="dp-field"><span className="small muted">Refresh rate</span>
            <select className="input" aria-label={`${s.name} refresh rate`} value={String(cur?.refresh ?? '')} onChange={(e) => cur && onPick(s, { width: cur.width, height: cur.height, refresh: Number(e.target.value), hidpi: cur.hidpi })} disabled={!curSize || curSize.rates.length < 2} data-testid="dp-rate">
              {(curSize?.rates.length ? curSize.rates : [cur?.refresh ?? 0]).map((r) => <option key={r} value={String(r)}>{rateWords(r)}</option>)}
            </select>
          </label>
          {both && cur ? (
            <label className="dp-field dp-sharp"><span className="small muted">Sharp text</span>
              <Toggle on={!!cur.hidpi} label={`${s.name} sharp text`} onChange={(v) => onPick(s, { width: cur.width, height: cur.height, refresh: cur.refresh, hidpi: v })} />
            </label>
          ) : null}
        </div>
      ) : <p className="small muted">This screen does not list other modes.</p>}
    </section>
  );
}

export function Displays() {
  const { toast } = useStore();
  const syncOn = useFeature('brightnessSync');
  const [st, setSt] = useState<DisplaysState | null>(null);
  const [br, setBr] = useState<BrightnessState | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(() => void api.displays.state().then(setSt).catch(() => undefined), []);
  useEffect(() => {
    load();
    return api.on('displays-changed', load);
  }, [load]);
  useEffect(() => { if (syncOn) void api.displays.brightness().then(setBr).catch(() => undefined); }, [syncOn]);
  useEffect(() => {
    if (!st?.revertAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [st?.revertAt]);

  if (!st) return <div className="page"><PageHead title="Displays" /><Loading label="Asking the screens…" /></div>;
  const pick = async (s: ScreenInfo, m: { width: number; height: number; refresh?: number; hidpi?: boolean }) => {
    const r = await api.displays.setMode(s.id, m);
    if (!r.ok) toast(r.message);
    load();
  };
  const left = st.revertAt ? Math.max(0, Math.ceil((st.revertAt - now) / 1000)) : 0;
  const forNow = st.presets.filter((p) => p.set === st.screens.map((s) => s.id).sort().join('+'));
  const setB = async (patch: Partial<BrightnessState['settings']>) => setBr(await api.displays.setBrightness(patch));

  return (
    <div className="page dp" data-testid="displays">
      <PageHead title="Displays" sub="Each screen’s size and refresh rate, and monitors that match." />

      {st.revertAt ? (
        <div className="dp-keep capsule" role="alertdialog" aria-live="assertive" aria-label="Keep this screen mode?" data-testid="dp-keep">
          <span className="dp-keep-text"><b>Keep this?</b> <span className="muted">Switching back in {left} s</span></span>
          <button className="btn ghost sm" onClick={async () => setSt(await api.displays.revert())} data-testid="dp-revert">Switch back</button>
          <button className="btn primary sm" onClick={async () => setSt(await api.displays.keep())} data-testid="dp-keep-btn" autoFocus>Keep</button>
        </div>
      ) : null}

      {!st.screens.length ? (
        <Empty icon="columns" title="No screens to change here" hint="Use your system’s Displays settings.">{st.note}</Empty>
      ) : (
        <div className="dp-grid">{st.screens.map((s) => <ScreenCard key={s.id} s={s} onPick={(x, m) => void pick(x, m)} />)}</div>
      )}

      {st.screens.length ? (
        <section className="dp-panel" aria-labelledby="dp-presets-h" data-testid="dp-presets">
          <div className="dp-panel-head">
            <h3 id="dp-presets-h">Presets for these screens</h3>
            {naming === null ? <button className="btn ghost sm" onClick={() => setNaming(forNow.length ? `Setup ${forNow.length + 1}` : 'Desk')} data-testid="dp-save"><Icon name="plus" size={13} /> Save as preset</button> : null}
          </div>
          {naming !== null ? (
            <form className="row dp-name" onSubmit={async (e) => { e.preventDefault(); setSt(await api.displays.savePreset(naming)); setNaming(null); }}>
              <input className="input" aria-label="Preset name" value={naming} onChange={(e) => setNaming(e.target.value)} autoFocus data-testid="dp-name" />
              <button className="btn sm" type="submit" data-testid="dp-name-save">Save</button>
              <button className="btn ghost sm" type="button" onClick={() => setNaming(null)}>Cancel</button>
            </form>
          ) : null}
          {forNow.length ? (
            <ul className="dp-presets">
              {forNow.map((p) => (
                <li key={p.id} className="dp-preset" data-testid="dp-preset">
                  <b className="grow">{p.name}</b>
                  <label className="row small muted dp-auto">When these screens connect <Toggle on={p.auto} label={`Use ${p.name} when these screens connect`} onChange={async (v) => setSt(await api.displays.setPresetAuto(p.id, v))} /></label>
                  <button className="btn sm" onClick={async () => { const r = await api.displays.applyPreset(p.id); if (!r.ok || !r.revertAt) toast(r.message); load(); }} data-testid="dp-use">Use</button>
                  <button className="btn ghost sm icon" title={`Remove ${p.name}`} aria-label={`Remove ${p.name}`} onClick={async () => setSt(await api.displays.removePreset(p.id))}><Icon name="trash" size={13} /></button>
                </li>
              ))}
            </ul>
          ) : naming === null ? <p className="small muted">Save how these screens are set now, to come back to it in one click.</p> : null}
        </section>
      ) : null}

      <section className="dp-panel" aria-labelledby="dp-bright-h" data-testid="dp-brightness">
        <div className="dp-panel-head">
          <h3 id="dp-bright-h">Matched brightness</h3>
          {!syncOn ? <button className="btn ghost sm" onClick={async () => { await api.features.set('displayControl', true); await api.features.set('brightnessSync', true); }} data-testid="dp-sync-on">Turn on</button> : null}
        </div>
        {!syncOn ? <p className="small muted">Plugged-in monitors can follow your built-in screen’s brightness, or dim in the evening.</p> : !br ? <Loading label="Asking the monitors…" /> : (
          <>
            <div className="seg" role="group" aria-label="Monitors follow" data-testid="dp-sync-mode">
              {([['builtin', 'Built-in screen'], ['schedule', 'Time of day'], ['off', 'Off']] as [SyncMode, string][]).map(([m, l]) => (
                <button key={m} className={br.settings.mode === m ? 'on' : ''} aria-pressed={br.settings.mode === m} disabled={m === 'builtin' && !br.canFollow} title={m === 'builtin' && !br.canFollow ? br.followNote : undefined} onClick={() => void setB({ mode: m })}>{l}</button>
              ))}
            </div>
            {br.settings.mode === 'builtin' && !br.canFollow ? <p className="small muted">{br.followNote} Choose Time of day instead.</p> : null}
            {br.settings.mode === 'builtin' && br.canFollow ? <p className="small muted" data-testid="dp-builtin">Built-in screen at {br.builtIn}%. Each monitor follows it, a little brighter or dimmer if you like.</p> : null}
            {br.settings.mode === 'schedule' ? (
              <div className="dp-fields">
                <label className="dp-field"><span className="small muted">Day</span><Level value={br.settings.day} min={0} max={100} step={5} label="Day brightness" words={(x) => `${x}%`} onCommit={(x) => void setB({ day: x })} /></label>
                <label className="dp-field"><span className="small muted">Evening</span><Level value={br.settings.evening} min={0} max={100} step={5} label="Evening brightness" words={(x) => `${x}%`} onCommit={(x) => void setB({ evening: x })} /></label>
                <label className="dp-field"><span className="small muted">Evening from</span><select className="input" value={br.settings.eveningFrom} onChange={(e) => void setB({ eveningFrom: Number(e.target.value) })}>{HOURS.map((h) => <option key={h} value={h}>{hourWords(h)}</option>)}</select></label>
                <label className="dp-field"><span className="small muted">until</span><select className="input" value={br.settings.eveningTo} onChange={(e) => void setB({ eveningTo: Number(e.target.value) })}>{HOURS.map((h) => <option key={h} value={h}>{hourWords(h)}</option>)}</select></label>
              </div>
            ) : null}
            {br.settings.mode !== 'off' ? (
              br.monitors.length ? (
                <ul className="dp-monitors" data-testid="dp-monitors">
                  {br.monitors.map((m) => {
                    const off = br.settings.offsets[m.id] ?? 0;
                    return (
                      <li key={m.id} className="dp-monitor">
                        <span className="grow"><b>{m.name}</b><span className="small muted"> · now {m.brightness ?? '—'}%</span></span>
                        <Level value={off} min={-30} max={30} step={5} label={`${m.name}: brighter or dimmer`} words={(x) => (x === 0 ? 'Same' : x > 0 ? `${x} brighter` : `${-x} dimmer`)} onCommit={(x) => void setB({ offsets: { ...br.settings.offsets, [m.id]: x } })} />
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="small muted">{br.monitorsNote ?? 'No plugged-in monitor answered. Turn on DDC/CI in the monitor’s own menu.'}</p>
            ) : null}
          </>
        )}
      </section>

      <details className="dp-how xmore">
        <summary>Works with your computer</summary>
        <ul className="small muted">
          <li><b>Mac</b>: every screen’s sizes, refresh rates and sharp text. Built-in brightness can be followed on Intel Macs; on Apple silicon, monitors follow the time of day.</li>
          <li><b>Windows</b>: every screen’s sizes and refresh rates; the built-in brightness on laptops.</li>
          <li><b>Linux</b>: X11 (xrandr), KDE (kscreen-doctor) and wlroots desktops (wlr-randr). GNOME on Wayland keeps sizes in its own settings.</li>
          <li>No virtual screens or extra brightness: they need interfaces that are not public.</li>
        </ul>
      </details>
    </div>
  );
}
