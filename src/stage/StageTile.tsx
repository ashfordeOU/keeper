// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Stage mode in the Island: one tap starts the chosen preset (or stops it),
// with the other presets beside it.

import { useEffect, useState } from 'react';
import type { StageSettings, StageStatus } from '../../core/stage/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useFeature } from '../features';

const say = (msg: string) => window.dispatchEvent(new CustomEvent('island-toast', { detail: msg }));

export function StageTile() {
  const on = useFeature('stage');
  const [st, setSt] = useState<StageStatus | null>(null);
  const [cfg, setCfg] = useState<StageSettings | null>(null);
  useEffect(() => {
    if (!on) return;
    void api.stage.status().then(setSt).catch(() => undefined);
    void api.stage.settings().then(setCfg).catch(() => undefined);
    return api.on('stage-changed', (s) => setSt(s));
  }, [on]);
  if (!on || !st || !cfg || !cfg.surfaces.island) return null;
  const go = async (id?: string) => {
    try {
      const r = await (st.on ? api.stage.stop() : api.stage.start(id ?? cfg.preset, { reason: 'Island' }));
      setSt(r);
      say(r.on ? `Stage: ${r.presetName}` : 'Stage is off; everything is back');
    } catch (e) { say(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="tile" data-testid="island-stage">
      <div className="ctl-head"><Icon name="eye" size={13} /> Stage
        <button className={`btn sm ${st.on ? 'primary' : ''}`} style={{ marginLeft: 'auto' }} data-testid="island-stage-toggle" aria-pressed={st.on} onClick={() => void go()}>{st.on ? 'Stop' : cfg.presets.find((p) => p.id === cfg.preset)?.name ?? 'Start'}</button></div>
      {st.on ? <div className="muted small">{st.presetName} · {st.applied.filter((a) => a.ok).length} changes, put back when you stop</div> : (
        <div className="qc-tiles">
          {cfg.presets.filter((p) => p.id !== cfg.preset).slice(0, 3).map((p) => (
            <button key={p.id} className="qc-tile" onClick={() => void go(p.id)}><b>{p.name}</b><span className="s">Start</span></button>
          ))}
        </div>
      )}
    </div>
  );
}
