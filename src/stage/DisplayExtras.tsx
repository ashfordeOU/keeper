// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// External monitors over DDC/CI: switch the input source, and the display
// keys (brightness and volume shortcuts routed to the monitor). Used on the
// Stage page and in the Toolbox's Display control.

import { useEffect, useState } from 'react';
import type { DisplayInfo } from '../../core/display-control';
import type { StageSettings } from '../../core/stage/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Toggle } from '../components/ui';
import { useFeature } from '../features';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The input-source picker for one display. */
export function InputPicker({ display }: { display: DisplayInfo }) {
  const [state, setState] = useState<{ current?: number; inputs: { code: number; label: string }[]; note?: string } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { void api.stage.displayInputs(display.id).then(setState).catch((e) => setErr(msg(e))); }, [display.id]);
  if (err) return <span className="small muted">{err}</span>;
  if (!state) return <span className="small muted"><span className="spinner" /> Asking…</span>;
  return (
    <span className="row" style={{ gap: 6 }} title={state.note}>
      <select aria-label={`Input of ${display.name}`} data-testid="stage-input" value={state.current ?? ''} onChange={(e) => {
        const code = +e.target.value;
        if (!window.confirm(`Switch ${display.name} to ${state.inputs.find((i) => i.code === code)?.label}? It goes dark if nothing is connected there.`)) return;
        void api.stage.setDisplayInput(display.id, code).then(() => setState({ ...state, current: code })).catch((x) => setErr(msg(x)));
      }}>
        {state.current === undefined ? <option value="">Input…</option> : null}
        {state.inputs.map((i) => <option key={i.code} value={i.code}>{i.label}</option>)}
      </select>
      {state.note ? <Icon name="info" size={12} /> : null}
    </span>
  );
}

export function DisplayExtras({ cfg, save }: { cfg: StageSettings; save: (p: Partial<StageSettings>) => void }) {
  const ddc = useFeature('displayControl');
  const keysOn = useFeature('displayKeys');
  const [displays, setDisplays] = useState<{ displays: DisplayInfo[]; note?: string } | null>(null);
  const k = cfg.displayKeys;
  const setK = (patch: Partial<StageSettings['displayKeys']>) => save({ displayKeys: { ...k, ...patch } });
  if (!ddc) return <div className="card settings-section muted small" style={{ padding: 14 }}>External display controls are switched off in Settings → Features.</div>;
  return (
    <div className="card settings-section" data-testid="stage-displays">
      <div className="setting">
        <div className="txt"><div style={{ fontWeight: 550 }}>Input source</div><div className="d">Switch a monitor between computers (HDMI, DisplayPort, USB-C) over DDC/CI, like its own buttons.</div></div>
        <div className="ctl"><button className="btn sm" data-testid="stage-find-displays" onClick={() => { setDisplays(null); void api.convert.displays().then(setDisplays).catch(() => setDisplays({ displays: [], note: 'Could not ask the displays.' })); }}><Icon name="refresh" size={12} /> Find monitors</button></div>
      </div>
      {displays ? (displays.displays.length ? displays.displays.map((d) => (
        <div key={d.id} className="setting"><div className="txt">{d.name}</div><div className="ctl"><InputPicker display={d} /></div></div>
      )) : <div className="setting small muted">{displays.note ?? 'No external monitor answered.'}</div>) : null}
      <div className="setting">
        <div className="txt"><div style={{ fontWeight: 550 }}>Display keys</div><div className="d">Shortcuts that change an external monitor’s brightness and volume, with a small level display. Apps cannot use the keyboard’s brightness keys, so pick shortcuts (F1/F2 with Control and Option or Alt work well).</div></div>
        <div className="ctl" data-testid="stage-keys-toggle"><Toggle on={keysOn} onChange={(v) => void api.features.set('displayKeys', v)} /></div>
      </div>
      {keysOn ? (
        <div className="stage-sub stage-keys">
          <label>Brighter <input value={k.brightnessUp} onChange={(e) => setK({ brightnessUp: e.target.value })} /></label>
          <label>Dimmer <input value={k.brightnessDown} onChange={(e) => setK({ brightnessDown: e.target.value })} /></label>
          <label>Louder <input value={k.volumeUp} onChange={(e) => setK({ volumeUp: e.target.value })} /></label>
          <label>Quieter <input value={k.volumeDown} onChange={(e) => setK({ volumeDown: e.target.value })} /></label>
          <label>Step <select value={k.step} onChange={(e) => setK({ step: +e.target.value })}>{[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}%</option>)}</select></label>
          <label>Monitor <select value={k.target} onChange={(e) => setK({ target: e.target.value })}><option value="all">All external</option>{displays?.displays.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label><input type="checkbox" checked={k.mediaVolumeKeys} onChange={(e) => setK({ mediaVolumeKeys: e.target.checked })} /> The keyboard’s volume keys change the monitor too</label>
        </div>
      ) : null}
    </div>
  );
}
