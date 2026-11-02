// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Studio: record the screen with its parts kept apart, then edit it into a
// finished video. This page has the recorder and the recent projects; a
// project opens in the editor (src/studio/Editor.tsx).

import { useEffect, useState } from 'react';
import type { OpenedProject, StudioOptions, StudioRecordState, StudioSupport } from '../../core/studio/api';
import type { ProjectSummary } from '../../core/studio/types';
import { relativeTime } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Modal, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import { Editor } from '../studio/Editor';
import { fmt } from '../studio/Timeline';
import '../styles/studio.css';

const mac = /Mac/.test(navigator.platform);
const keyText = (a: string) => a.replace('CommandOrControl', mac ? '⌘' : 'Ctrl').replace('Shift', mac ? '⇧' : 'Shift').replace('Alt', mac ? '⌥' : 'Alt').replace(/\+/g, mac ? '' : '+');

export function Studio({ initial }: { initial?: string }) {
  const { go } = useStore();
  if (initial) return <EditorLoader dir={initial} onBack={() => go({ name: 'studio' })} />;
  return <Home onOpen={(dir) => go({ name: 'studio', arg: dir })} />;
}

function EditorLoader({ dir, onBack }: { dir: string; onBack(): void }) {
  const [opened, setOpened] = useState<OpenedProject | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void api.studio.open(dir).then(setOpened, (e: unknown) => setErr(e instanceof Error ? e.message : String(e))); }, [dir]);
  if (err) return <div className="studio-page"><Empty icon="warning" title="This project could not be opened">{err}<div style={{ marginTop: 12 }}><button className="btn" onClick={onBack}>Back to recordings</button></div></Empty></div>;
  if (!opened) return <div className="studio-page"><div className="empty" role="status"><div className="spinner" aria-hidden /><div className="small">Opening the project…</div></div></div>;
  return <Editor opened={opened} onBack={onBack} />;
}

function useDevices() {
  const [list, setList] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const read = () => void navigator.mediaDevices?.enumerateDevices().then(setList).catch(() => undefined);
    read();
    navigator.mediaDevices?.addEventListener?.('devicechange', read);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', read);
  }, []);
  return { mics: list.filter((d) => d.kind === 'audioinput'), cams: list.filter((d) => d.kind === 'videoinput') };
}

function Home({ onOpen }: { onOpen(dir: string): void }) {
  const { toast } = useStore();
  const [opts, setOpts] = useState<StudioOptions | null>(null);
  const [support, setSupport] = useState<StudioSupport | null>(null);
  const [rec, setRecRaw] = useState<StudioRecordState>({ phase: 'idle' });
  const [recAt, setRecAt] = useState(Date.now());
  const setRec = (s: StudioRecordState) => { setRecRaw(s); setRecAt(Date.now()); };
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [removing, setRemoving] = useState<ProjectSummary | null>(null);
  const { mics, cams } = useDevices();

  const reload = () => void api.studio.projects().then(setProjects).catch(() => setProjects([]));
  useEffect(() => {
    void api.studio.options().then(setOpts);
    void api.studio.support().then(setSupport);
    void api.studio.state().then(setRec);
    reload();
    return api.on('studio-changed', (s) => { setRec(s); if (s.phase === 'idle') reload(); if (s.error) toast(s.error); });
  }, []);
  useEffect(() => {
    if (rec.phase !== 'recording') return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [rec.phase]);

  const set = async (patch: Partial<StudioOptions>) => setOpts(await api.studio.setOptions(patch));
  const record = async () => {
    const s = await api.studio.record().catch((e: unknown) => { toast(e instanceof Error ? e.message : String(e)); return null; });
    if (s?.error) toast(s.error);
  };
  const live = rec.phase !== 'idle';
  // the main process says how long every second; the clock runs on in between
  const elapsed = rec.phase === 'recording' ? (rec.elapsed ?? 0) + Math.max(0, now - recAt) : rec.elapsed ?? 0;

  return (
    <div className="studio-page">
      <PageHead title="Studio" sub="Record the screen, then make it look produced: zooms where you click and type, a smooth pointer, a clean frame, captions. Everything stays on this computer.">
        <button className="btn" onClick={() => void api.studio.pick().then((d) => (d ? onOpen(d) : undefined))}><Icon name="folder" size={14} /> Open Project…</button>
      </PageHead>

      {live ? (
        <section className="studio-live" aria-live="polite" data-testid="studio-live">
          <span className={`studio-dot ${rec.phase === 'paused' ? 'paused' : ''}`} aria-hidden />
          <div className="grow">
            <b>{rec.phase === 'picking' ? 'Choose what to record…' : rec.phase === 'countdown' ? `Recording in ${rec.countdown}…` : rec.phase === 'saving' ? 'Saving the recording…' : rec.phase === 'paused' ? 'Paused' : 'Recording'}</b>
            {rec.phase === 'recording' || rec.phase === 'paused' ? <span className="num studio-timer"> {fmt(elapsed)}</span> : null}
            {rec.phase === 'paused' ? <div className="small muted">Paused parts are left out of the video.</div> : null}
          </div>
          {rec.phase === 'recording' ? <button className="btn" onClick={() => void api.studio.pause().then(setRec)}><Icon name="pause" size={14} /> Pause</button> : null}
          {rec.phase === 'paused' ? <button className="btn" onClick={() => void api.studio.resume().then(setRec)}><Icon name="play" size={14} /> Resume</button> : null}
          {rec.phase === 'recording' || rec.phase === 'paused' ? <button className="btn danger" onClick={() => void api.studio.stop()} data-testid="studio-stop"><Icon name="check" size={14} /> Stop and Edit</button> : null}
          {rec.phase !== 'saving' ? <button className="btn ghost" onClick={() => void api.studio.discard()}>{rec.phase === 'countdown' || rec.phase === 'picking' ? 'Cancel' : 'Discard'}</button> : null}
        </section>
      ) : null}

      {opts ? (
        <section className="studio-recorder" aria-label="New recording">
          <div className="studio-rec-main">
            <div className="seg studio-modes" role="radiogroup" aria-label="What to record">
              {([['full', 'Whole screen', 'laptop'], ['window', 'One window', 'app'], ['area', 'An area', 'screenshot']] as const).map(([id, label, icon]) => (
                <button key={id} role="radio" aria-checked={opts.mode === id} className={opts.mode === id ? 'on' : ''} onClick={() => void set({ mode: id })}><Icon name={icon} size={14} /> {label}</button>
              ))}
            </div>
            <button className="studio-record" onClick={() => void record()} disabled={live} data-testid="studio-record">
              <span className="studio-dot" aria-hidden /> Record
              {opts.shortcut ? <kbd>{keyText(opts.shortcut)}</kbd> : null}
            </button>
          </div>
          <div className="studio-rec-options">
            <div className="st-opt">
              <span className="st-opt-label"><Icon name="mic" size={14} /> Microphone</span>
              <Toggle on={opts.mic} onChange={(v) => void set({ mic: v })} label="Microphone" />
              {opts.mic && mics.length > 1 ? <select value={opts.micId ?? ''} onChange={(e) => void set({ micId: e.target.value || undefined })} aria-label="Which microphone"><option value="">Default</option>{mics.map((m, i) => <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>)}</select> : null}
            </div>
            <div className="st-opt">
              <span className="st-opt-label"><Icon name="camera" size={14} /> Camera</span>
              <Toggle on={opts.webcam} onChange={(v) => void set({ webcam: v })} label="Camera" />
              {opts.webcam && cams.length > 1 ? <select value={opts.camId ?? ''} onChange={(e) => void set({ camId: e.target.value || undefined })} aria-label="Which camera"><option value="">Default</option>{cams.map((m, i) => <option key={m.deviceId} value={m.deviceId}>{m.label || `Camera ${i + 1}`}</option>)}</select> : null}
            </div>
            <div className="st-opt" title={support && !support.systemAudio ? 'Not available on this system yet' : undefined}>
              <span className="st-opt-label"><Icon name="audio" size={14} /> Computer sound</span>
              <Toggle on={opts.systemAudio && !!support?.systemAudio} disabled={!support?.systemAudio} onChange={(v) => void set({ systemAudio: v })} label="Computer sound" />
            </div>
            <div className="st-opt">
              <span className="st-opt-label"><Icon name="eye" size={14} /> Clean the screen first</span>
              <Toggle on={opts.stage} onChange={(v) => void set({ stage: v })} label="Clean the screen with Stage first" />
            </div>
            <div className="st-opt">
              <span className="st-opt-label"><Icon name="eyeOff" size={14} /> Move Keeper out of the way</span>
              <Toggle on={opts.hideWindow} onChange={(v) => void set({ hideWindow: v })} label="Move Keeper out of the way while recording" />
            </div>
            <div className="st-opt">
              <span className="st-opt-label">Frame rate</span>
              <div className="seg" role="radiogroup" aria-label="Frame rate">{([30, 60] as const).map((f) => <button key={f} role="radio" aria-checked={opts.fps === f} className={opts.fps === f ? 'on' : ''} onClick={() => void set({ fps: f })}>{f} fps</button>)}</div>
            </div>
            <div className="st-opt">
              <span className="st-opt-label">Countdown</span>
              <div className="seg" role="radiogroup" aria-label="Countdown">{[0, 3, 5].map((n) => <button key={n} role="radio" aria-checked={opts.countdown === n} className={opts.countdown === n ? 'on' : ''} onClick={() => void set({ countdown: n })}>{n ? `${n} s` : 'None'}</button>)}</div>
            </div>
          </div>
          {support ? (
            <div className="studio-support small muted">
              <span><Icon name={support.screen.cursorHidden ? 'check' : 'info'} size={12} /> {support.screen.how === 'screencapturekit' ? 'ScreenCaptureKit, full resolution, pointer left out' : support.screen.how === 'ffmpeg' ? 'Recorded with the pointer left out' : 'The pointer is part of the picture here'}</span>
              {support.screen.note ? <span>{support.screen.note}</span> : null}
              {support.input.note ? <span>{support.input.note}</span> : null}
              <span>Pause and resume: <kbd>{keyText(opts.pauseShortcut)}</kbd> · stop from the Island or the tray</span>
            </div>
          ) : null}
        </section>
      ) : null}

      <h2 className="studio-h2">Recordings</h2>
      {projects === null ? null : projects.length ? (
        <div className="studio-projects">
          {projects.map((p) => (
            <article key={p.dir} className="studio-card">
              <button className="studio-card-open" onClick={() => onOpen(p.dir)} aria-label={`Open ${p.name}`}>
                <div className="studio-thumb" style={{ aspectRatio: `${p.width} / ${p.height}` }}>
                  {p.thumb ? <img src={api.preview.url(p.thumb)} alt="" loading="lazy" /> : <Icon name="video" size={28} />}
                  <span className="studio-dur num">{fmt(p.duration)}</span>
                </div>
                <div className="studio-card-name">{p.name}</div>
                <div className="small muted">{relativeTime(p.updatedAt)} · {p.width}×{p.height}</div>
              </button>
              <div className="studio-card-actions">
                <button className="btn ghost sm icon" onClick={() => void api.studio.reveal(p.dir)} aria-label={`Show ${p.name} in its folder`} title="Show in folder"><Icon name="reveal" size={13} /></button>
                <button className="btn ghost sm icon" onClick={() => setRemoving(p)} aria-label={`Delete ${p.name}`} title="Delete"><Icon name="trash" size={13} /></button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty icon="video" title="No recordings yet">Press Record. When you stop, the recording opens here with zooms already made from your clicks.</Empty>
      )}

      {removing ? (
        <Modal title="Delete this recording?" onClose={() => setRemoving(null)} width={420}>
          <p className="small">“{removing.name}” and its raw tracks go to the Trash. Videos you exported stay where they are.</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setRemoving(null)}>Keep</button>
            <button className="btn danger" onClick={() => { const r = removing; setRemoving(null); void api.studio.remove(r.dir).then(reload, (e: unknown) => toast(String(e))); }}>Delete</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
