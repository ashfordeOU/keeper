// SPDX-License-Identifier: AGPL-3.0-or-later
// A small music player in the toolbar: double-click a song to play it here.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state';
import { Icon } from './Icon';
import '../styles/screens-a.css';

export function Player() {
  const { playing, play } = useStore();
  const audio = useRef<HTMLAudioElement>(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);

  // Only the desktop app can stream local files; the browser demo shows the controls without sound.
  const src = playing && window.keeper ? `keeper-file://${encodeURI(playing.path.replace(/\\/g, '/'))}` : undefined;

  useEffect(() => {
    setProgress(0);
    setPaused(false);
    if (audio.current && src) void audio.current.play().catch(() => setPaused(true));
  }, [src]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!playing || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if ((e.metaKey || e.ctrlKey) && e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!playing) return null;

  function toggle() {
    const a = audio.current;
    if (!a || !src) { setPaused((p) => !p); return; }
    if (a.paused) void a.play();
    else a.pause();
  }

  const title = playing.name.replace(/\.[^.]+$/, '');
  return (
    <div className="player" title={playing.path}>
      <div className="art"><Icon name="audio" size={14} /></div>
      <div style={{ minWidth: 0 }}>
        <div className="t ellipsis">{title}</div>
        <div className="a ellipsis">{playing.meta?.artist ?? 'Unknown artist'}</div>
        <div className="prog"><i style={{ width: `${progress * 100}%` }} /></div>
      </div>
      <button className="btn ghost sm icon" title="Restart" onClick={() => { if (audio.current) audio.current.currentTime = 0; setProgress(0); }}><Icon name="prev" size={12} /></button>
      <button className="btn ghost sm icon" title="Play / pause" onClick={toggle}><Icon name={paused ? 'play' : 'pause'} size={12} /></button>
      <button className="btn ghost sm icon" title="Stop" onClick={() => play(null)}><Icon name="close" size={12} /></button>
      <audio
        ref={audio}
        src={src}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onEnded={() => play(null)}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (a.duration) setProgress(a.currentTime / a.duration);
        }}
      />
    </div>
  );
}
