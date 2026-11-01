// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The floating ambient sound mixer. Its window also plays the sound, so the
// sound goes on while the panel is hidden, and stops (window and all) when
// nothing is playing.

import { useEffect, useRef } from 'react';
import { AmbientEngine } from '../lib/ambient-audio';
import { MixerControls, useAmbience } from './MixerControls';
import { api } from '../api';
import { Icon } from '../components/Icon';
import '../styles/ambience.css';

export function MixerPanel() {
  const [state] = useAmbience();
  const engine = useRef<AmbientEngine | null>(null);
  useEffect(() => {
    document.documentElement.dataset.view = 'ambient';
    engine.current = new AmbientEngine();
    return () => engine.current?.dispose();
  }, []);
  useEffect(() => {
    if (!state || !engine.current) return;
    const s = state.settings.sound;
    engine.current.set({ mix: s.mix, master: s.master, playing: s.playing && state.features.ambientSound, fadeSec: s.fadeSec, sleepAt: s.sleepAt });
  }, [state]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void api.ambience.closeMixer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!state) return null;
  const active = state.settings.vibes.find((v) => v.id === state.settings.activeVibe);
  return (
    <div className="amb-panel" data-testid="amb-panel">
      <div className="amb-panel-title">
        <Icon name="audio" size={15} />
        <b className="grow">Ambient sound</b>
        {active ? <span className="badge">{active.emoji} {active.name}</span> : null}
        <button className="btn ghost icon sm" title="Close (sound keeps playing)" aria-label="Close (sound keeps playing)" onClick={() => void api.ambience.closeMixer()}><Icon name="close" size={13} /></button>
      </div>
      <MixerControls state={state} compact />
      <div className="amb-panel-foot small muted">Made on this computer — no recordings, nothing downloaded.</div>
    </div>
  );
}
