// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The teleprompter: your script scrolls just under the camera so your eyes
// stay near the lens. By reading speed, or only while you speak.

import { useEffect, useRef, useState } from 'react';
import { pixelsPerSecond, readingSeconds, step, voiceActivity, wordsPerLine } from '../../../core/island-tools/teleprompter';
import type { IslandToolsStore, Script } from '../../../core/island-tools/notes';
import { upsert } from '../../../core/island-tools/notes';
import { api } from '../../api';
import { Icon } from '../../components/Icon';

const uid = () => Math.random().toString(36).slice(2, 10);

export function TeleprompterTool({ store, save }: { store: IslandToolsStore; save: (p: Partial<IslandToolsStore>) => void }) {
  const [id, setId] = useState(store.scripts[0]?.id ?? '');
  const script = store.scripts.find((s) => s.id === id);
  const [editing, setEditing] = useState(!script);
  const [running, setRunning] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [wpm, setWpm] = useState(() => Number(localStorage.getItem('prompter.wpm') ?? 140) || 140);
  const [font, setFont] = useState(() => Number(localStorage.getItem('prompter.font') ?? 24) || 24);
  const [mirror, setMirror] = useState(false);
  const [voice, setVoice] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const offset = useRef(0);

  const update = (s: Script) => save({ scripts: upsert(store.scripts, s) });
  const create = () => {
    const s: Script = { id: uid(), title: 'New script', text: '', updated: Date.now() };
    save({ scripts: [s, ...store.scripts] });
    setId(s.id);
    setEditing(true);
  };

  useEffect(() => { try { localStorage.setItem('prompter.wpm', String(wpm)); localStorage.setItem('prompter.font', String(font)); } catch { /* ignore */ } }, [wpm, font]);

  // A 3-2-1 countdown before scrolling starts.
  useEffect(() => {
    if (countdown <= 0) return;
    const t = window.setTimeout(() => { setCountdown(countdown - 1); if (countdown === 1) setRunning(true); }, 1000);
    return () => window.clearTimeout(t);
  }, [countdown]);

  // Voice-paced mode: the microphone's loudness only, on this computer; nothing is recorded or sent.
  const speakingRef = useRef(false);
  useEffect(() => {
    if (!voice || !running) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let floor = 0.01;
    void navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
      stream = s;
      ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(s).connect(an);
      const data = new Float32Array(1024);
      let quietFor = 0;
      const tick = () => {
        an.getFloatTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += v * v;
        const r = voiceActivity(Math.sqrt(sum / data.length), floor);
        floor = r.floor;
        // Keep moving through short pauses between words.
        quietFor = r.speaking ? 0 : quietFor + 1;
        const talking = quietFor < 25;
        if (talking !== speakingRef.current) { speakingRef.current = talking; setSpeaking(talking); }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }).catch(() => setVoice(false));
    return () => { cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); void ctx?.close(); speakingRef.current = false; };
  }, [voice, running]);

  // Scrolling: transform only, one frame at a time, only while running.
  useEffect(() => {
    if (!running || !box.current) return;
    const el = box.current;
    const inner = el.firstElementChild as HTMLElement | null;
    if (!inner) return;
    const pps = pixelsPerSecond(wpm, wordsPerLine(el.clientWidth, font), font * 1.4);
    let last = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      const max = Math.max(0, inner.scrollHeight - el.clientHeight / 2);
      offset.current = step(offset.current, (t - last) / 1000, pps, max, !voice || speakingRef.current);
      last = t;
      inner.style.transform = `translateY(${-offset.current}px)${mirror ? ' scaleX(-1)' : ''}`;
      if (offset.current >= max) setRunning(false);
      else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, wpm, font, voice, mirror]);

  const restart = () => {
    offset.current = 0;
    const inner = box.current?.firstElementChild as HTMLElement | null;
    if (inner) inner.style.transform = mirror ? 'scaleX(-1)' : '';
  };

  // Hotkeys while the prompter is open: Space play/pause, ↑/↓ speed, R restart, M mirror, Esc stop.
  useEffect(() => {
    if (editing) return;
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === ' ') { e.preventDefault(); setRunning((r) => !r); }
      else if (e.key === 'ArrowUp') setWpm((w) => Math.min(300, w + 10));
      else if (e.key === 'ArrowDown') setWpm((w) => Math.max(60, w - 10));
      else if (e.key.toLowerCase() === 'r') { setRunning(false); restart(); }
      else if (e.key.toLowerCase() === 'm') setMirror((m) => !m);
      else if (e.key === 'Escape') setRunning(false);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  if (editing || !script) {
    return (
      <div className="itool prompter-edit">
        <div className="row-x">
          <select className="input sm" value={id} onChange={(e) => setId(e.target.value)}>{store.scripts.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
          <button className="btn sm" onClick={create}><Icon name="plus" size={11} /> New</button>
          <button className="btn sm" onClick={() => void api.islandTools.importScript().then((r) => { if (!r) return; const s: Script = { id: uid(), title: r.title, text: r.text, updated: Date.now() }; save({ scripts: [s, ...store.scripts] }); setId(s.id); })}><Icon name="down" size={11} /> Import</button>
          <span className="grow" />
          {script ? <button className="btn sm primary" onClick={() => { setEditing(false); restart(); }}>Done</button> : null}
        </div>
        {script ? (
          <>
            <input className="input sm" value={script.title} onChange={(e) => update({ ...script, title: e.target.value, updated: Date.now() })} />
            <textarea className="input" value={script.text} placeholder="Paste or write your script…" onChange={(e) => update({ ...script, text: e.target.value, updated: Date.now() })} />
            <div className="small muted">{script.text.split(/\s+/).filter(Boolean).length} words · about {Math.ceil(readingSeconds(script.text, wpm) / 60)} min at {wpm} words a minute</div>
          </>
        ) : <div className="muted">Write or import a script (text, Markdown or Word).</div>}
      </div>
    );
  }

  return (
    <div className="itool prompter">
      <div ref={box} className="pview" style={{ fontSize: font }} onDoubleClick={() => setRunning(!running)}>
        <div className="ptext" style={{ transform: mirror ? 'scaleX(-1)' : undefined }}>{script.text}</div>
        {countdown ? <div className="pcount">{countdown}</div> : null}
        <div className="pline" aria-hidden />
      </div>
      <div className="row-x">
        <button className="btn sm primary" onClick={() => (running ? setRunning(false) : setCountdown(3))}><Icon name={running ? 'pause' : 'play'} size={11} /> {running ? 'Pause' : 'Start'}</button>
        <button className="btn sm" onClick={() => { setRunning(false); restart(); }} title="Back to the top (R)" aria-label="Back to the top (R)"><Icon name="undo" size={11} /></button>
        <span className="small muted">Speed</span><input type="range" min={60} max={300} step={10} value={wpm} onChange={(e) => setWpm(Number(e.target.value))} style={{ width: 80 }} /><span className="small num">{wpm}</span>
        <span className="small muted">Size</span><input type="range" min={14} max={48} value={font} onChange={(e) => setFont(Number(e.target.value))} style={{ width: 60 }} />
        <button className={`chip ${mirror ? 'on' : ''}`} onClick={() => setMirror(!mirror)} title="Flip for a mirror rig (M)">Flip</button>
        <button className={`chip ${voice ? 'on' : ''}`} onClick={() => setVoice(!voice)} title="Scroll only while you speak (microphone, on this computer)">{voice ? (speaking ? '● Voice' : '○ Voice') : 'Voice'}</button>
        <span className="grow" />
        <button className="btn sm" onClick={() => setEditing(true)}>Edit</button>
      </div>
    </div>
  );
}
