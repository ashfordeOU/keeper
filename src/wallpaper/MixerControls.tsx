// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The ambient sound sliders and the shared wallpaper/vibes state hook. Used by
// the floating mixer, the page and the Island (no audio code here: the sound
// itself plays only in the mixer's window).

import { useEffect, useRef, useState } from 'react';
import { describeMix, SLEEP_CHOICES, sleepLeft, SOUNDS, type SoundMix } from '../../core/scenes/ambient';
import type { AmbienceState } from '../../core/scenes/api';
import { api } from '../api';
import { Icon } from '../components/Icon';
import '../styles/ambience.css';

export function useAmbience(): [AmbienceState | null, () => void] {
  const [s, setS] = useState<AmbienceState | null>(null);
  useEffect(() => {
    const load = () => void api.ambience.state().then(setS).catch(() => undefined);
    load();
    return api.on('ambience-changed', load);
  }, []);
  return [s, () => void api.ambience.state().then(setS)];
}

/** Sound sliders, shared by the floating panel and the page. */
export function MixerControls({ state, compact }: { state: AmbienceState; compact?: boolean }) {
  const snd = state.settings.sound;
  const [mix, setMix] = useState<SoundMix>(snd.mix);
  const [master, setMaster] = useState(snd.master);
  const t = useRef<number>(0);
  useEffect(() => { setMix(snd.mix); setMaster(snd.master); }, [snd.mix, snd.master]);
  const push = (m: SoundMix, v: number) => {
    setMix(m);
    setMaster(v);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => void api.ambience.setMix(m, v), 120);
  };
  const left = sleepLeft(snd.sleepAt);
  return (
    <div className={`amb-mixer ${compact ? 'compact' : ''}`}>
      <div className="amb-mixer-head">
        <button className={`btn ${snd.playing ? '' : 'primary'}`} data-testid="amb-play" onClick={() => void api.ambience.setSoundPlaying(!snd.playing)}>
          <Icon name={snd.playing ? 'pause' : 'play'} size={13} /> {snd.playing ? 'Pause' : 'Play'}
        </button>
        <span className="muted small grow ellipsis">{describeMix(mix)}</span>
        <label className="amb-master" title="Volume"><Icon name="audio" size={13} /><input type="range" min={0} max={1} step={0.01} value={master} onChange={(e) => push(mix, Number(e.target.value))} /></label>
      </div>
      <div className="amb-sounds">
        {SOUNDS.map((s) => {
          const v = mix[s.id] ?? 0;
          return (
            <label key={s.id} className={`amb-sound ${v > 0 ? 'on' : ''}`} data-testid={`amb-sound-${s.id}`} title={s.description}>
              <span className="amb-sound-name"><Icon name={s.icon} size={13} /> {s.name}</span>
              <input type="range" min={0} max={1} step={0.01} value={v} onChange={(e) => push({ ...mix, [s.id]: Number(e.target.value) }, master)} />
            </label>
          );
        })}
      </div>
      <div className="amb-sleep">
        <span className="small muted"><Icon name="moon" size={12} /> Sleep timer</span>
        {SLEEP_CHOICES.slice(0, compact ? 4 : 6).map((m) => <button key={m} className="chip" onClick={() => void api.ambience.sleep(m)}>{m < 60 ? `${m}m` : `${m / 60}h`}</button>)}
        {left !== null ? <span className="chip on num" data-testid="amb-sleep-left">{Math.ceil(left / 60_000)} min <button className="x" onClick={() => void api.ambience.sleep(null)} aria-label="Cancel sleep timer">×</button></span> : null}
      </div>
    </div>
  );
}
