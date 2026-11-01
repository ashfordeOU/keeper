// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's Vibes tool: switch the desktop's mood without opening Keeper.

import { describeMix } from '../../core/scenes/ambient';
import { describeSource, paletteById } from '../../core/scenes/catalog';
import type { Vibe } from '../../core/vibes';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useAmbience } from './MixerControls';
import '../styles/ambience.css';

export function vibeSwatch(v: Pick<Vibe, 'wallpaper'>, custom = [] as Parameters<typeof paletteById>[1]): string {
  const w = v.wallpaper;
  if (w?.kind === 'scene') {
    const c = paletteById(w.palette, custom).colors;
    return `radial-gradient(120% 90% at 20% 15%, ${c[3]}55, transparent 55%), linear-gradient(150deg, ${c[0]}, ${c[1]} 45%, ${c[2]})`;
  }
  return 'linear-gradient(150deg, #2a2a33, #4a4a5a)';
}

export function VibesTool() {
  const [s] = useAmbience();
  if (!s) return <div className="muted small" style={{ margin: 'auto' }}>…</div>;
  const a = s.settings;
  const live = s.features.wallpaper && a.wallpaper.enabled;
  const paused = s.displays.some((d) => d.live && !d.live.running);
  return (
    <div className="amb-island" data-testid="island-vibes">
      <div className="amb-island-vibes">
        {a.vibes.slice(0, 8).map((v) => (
          <button key={v.id} className={`amb-island-vibe ${a.activeVibe === v.id ? 'on' : ''}`} style={{ background: vibeSwatch(v, a.palettes) }} title={v.name} onClick={() => void api.ambience.applyVibe(v.id)}>
            <span className="e">{v.emoji}</span><span className="n">{v.name}</span>
          </button>
        ))}
      </div>
      <div className="amb-island-row">
        <div className="tile grow">
          <span className="muted small">Wallpaper</span>
          <b className="ellipsis" style={{ display: 'block' }}>{describeSource(a.wallpaper.default)}</b>
          <div className="btn-row" style={{ marginTop: 6 }}>
            <button className="btn sm" onClick={() => void api.ambience.setPlaying(!live)}><Icon name={live ? 'pause' : 'play'} size={11} /> {live ? 'Turn off' : 'Turn on'}</button>
            <button className="btn sm" onClick={() => void api.ambience.surprise()}><Icon name="shuffle" size={11} /> Surprise</button>
          </div>
          {live && paused ? <span className="muted small">{s.displays.find((d) => d.live && !d.live.running)?.live?.reason}</span> : null}
        </div>
        <div className="tile grow">
          <span className="muted small">Sound</span>
          <b className="ellipsis" style={{ display: 'block' }}>{a.sound.playing ? describeMix(a.sound.mix) : 'Off'}</b>
          <div className="btn-row" style={{ marginTop: 6 }}>
            <button className="btn sm" onClick={() => void api.ambience.setSoundPlaying(!a.sound.playing)}><Icon name={a.sound.playing ? 'pause' : 'play'} size={11} /> {a.sound.playing ? 'Stop' : 'Play'}</button>
            <button className="btn sm" onClick={() => void api.ambience.openMixer()}><Icon name="audio" size={11} /> Mixer</button>
          </div>
        </div>
      </div>
    </div>
  );
}
