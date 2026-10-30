// SPDX-License-Identifier: AGPL-3.0-or-later
// A small music player in the toolbar: double-click a song to play it here.
// The other songs in the same folder become the queue, with shuffle, repeat,
// seeking and volume.

import { useEffect, useRef, useState } from 'react';
import type { FileEntry } from '../../core/types';
import { api } from '../api';
import { fileUrl } from '../lib/fileUrl';
import { useStore } from '../state';
import { Icon } from './Icon';
import '../styles/screens-a.css';

type Repeat = 'off' | 'all' | 'one';

const dirOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')));

function loadNum(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && localStorage.getItem(key) !== null ? v : fallback;
  } catch {
    return fallback;
  }
}

export function Player() {
  const { playing, play } = useStore();
  const audio = useRef<HTMLAudioElement>(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [queue, setQueue] = useState<FileEntry[]>([]);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>('off');
  const [volume, setVolume] = useState(() => loadNum('player.volume', 1));
  const [showVol, setShowVol] = useState(false);

  // Only the desktop app can stream local files; the browser demo shows the controls without sound.
  const src = playing ? fileUrl(playing.path) : undefined;

  useEffect(() => {
    setProgress(0);
    setPaused(false);
    if (audio.current && src) void audio.current.play().catch(() => setPaused(true));
  }, [src]);

  // The queue: songs in the same folder, in name order.
  useEffect(() => {
    if (!playing) return;
    const dir = dirOf(playing.path);
    void api.library.list({ kind: 'audio', sort: 'name', desc: false }).then((all) => {
      const here = all.filter((f) => dirOf(f.path) === dir);
      setQueue(here.length ? here : [playing]);
    });
  }, [playing?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
    try {
      localStorage.setItem('player.volume', String(volume));
    } catch {
      /* storage unavailable */
    }
  }, [volume]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!playing || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if ((e.metaKey || e.ctrlKey) && e.key === ' ') {
        e.preventDefault();
        toggle();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowRight' && e.altKey) {
        e.preventDefault();
        step(1);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowLeft' && e.altKey) {
        e.preventDefault();
        step(-1);
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

  function step(dir: 1 | -1, auto = false) {
    if (!playing) return;
    const a = audio.current;
    // "Previous" restarts the song when it is more than a few seconds in.
    if (dir === -1 && a && a.currentTime > 4) {
      a.currentTime = 0;
      return;
    }
    if (auto && repeat === 'one' && a) {
      a.currentTime = 0;
      void a.play();
      return;
    }
    const i = queue.findIndex((f) => f.path === playing.path);
    let next: number;
    if (shuffle && queue.length > 1) {
      do next = Math.floor(Math.random() * queue.length);
      while (next === i);
    } else next = i + dir;
    if (next >= queue.length) {
      if (repeat === 'all' || !auto) next = 0;
      else return play(null);
    }
    if (next < 0) next = queue.length - 1;
    play(queue[next] ?? null);
  }

  const title = playing.name.replace(/\.[^.]+$/, '');
  const pos = queue.findIndex((f) => f.path === playing.path);
  return (
    <div className="player" title={playing.path}>
      <div className="art"><Icon name="audio" size={14} /></div>
      <div style={{ minWidth: 0 }}>
        <div className="t ellipsis">{title}</div>
        <div className="a ellipsis">{playing.meta?.artist ?? 'Unknown artist'}{queue.length > 1 ? ` · ${pos + 1} of ${queue.length}` : ''}</div>
        <div
          className="prog"
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            const a = audio.current;
            const r = e.currentTarget.getBoundingClientRect();
            if (a?.duration) a.currentTime = ((e.clientX - r.left) / r.width) * a.duration;
          }}
        >
          <i style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <button className="btn ghost sm icon" title="Previous" onClick={() => step(-1)}><Icon name="prev" size={12} /></button>
      <button className="btn ghost sm icon" title="Play / pause" onClick={toggle}><Icon name={paused ? 'play' : 'pause'} size={12} /></button>
      <button className="btn ghost sm icon" title="Next" onClick={() => step(1)}><Icon name="next" size={12} /></button>
      <button className={`btn ghost sm icon ${shuffle ? 'on' : ''}`} title={shuffle ? 'Shuffle on' : 'Shuffle off'} style={{ color: shuffle ? 'var(--accent)' : undefined }} onClick={() => setShuffle(!shuffle)}><Icon name="shuffle" size={12} /></button>
      <button className="btn ghost sm icon" title={repeat === 'off' ? 'Repeat off' : repeat === 'all' ? 'Repeat folder' : 'Repeat this song'} style={{ color: repeat !== 'off' ? 'var(--accent)' : undefined, position: 'relative' }} onClick={() => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')}>
        <Icon name="repeat" size={12} />{repeat === 'one' ? <span style={{ position: 'absolute', fontSize: 8, bottom: 1, right: 3 }}>1</span> : null}
      </button>
      <div style={{ position: 'relative' }}>
        <button className="btn ghost sm icon" title={`Volume ${Math.round(volume * 100)}%`} onClick={() => setShowVol(!showVol)}><Icon name="audio" size={12} /></button>
        {showVol ? (
          <div className="menu" style={{ position: 'absolute', top: 30, right: 0, minWidth: 0, padding: 8 }} onMouseLeave={() => setShowVol(false)}>
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(+e.target.value)} style={{ width: 120 }} aria-label="Volume" />
          </div>
        ) : null}
      </div>
      <button className="btn ghost sm icon" title="Stop" onClick={() => play(null)}><Icon name="close" size={12} /></button>
      <audio
        ref={audio}
        src={src}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onEnded={() => step(1, true)}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (a.duration) setProgress(a.currentTime / a.duration);
        }}
      />
    </div>
  );
}
