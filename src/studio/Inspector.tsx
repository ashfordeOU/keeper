// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The editor's side panel: the look of the frame, the pointer, zooms, edits,
// the camera bubble, sound, and extras (captions, shortcut badges, chapters,
// privacy blur). Every change goes through `change`, so it can be undone.

import { useState, type ReactNode } from 'react';
import { BACKGROUNDS, swatchCss } from '../../core/studio/backgrounds';
import { chaptersFrom } from '../../core/studio/overlays';
import type { Aspect, Background, BlurBox, Clip, EventLog, StudioProject, StudioStyle, Timeline, Zoom } from '../../core/studio/types';
import { Icon } from '../components/Icon';
import { Toggle } from '../components/ui';
import type { Selection } from './Timeline';
import { fmt } from './Timeline';

export type Panel = 'frame' | 'pointer' | 'zoom' | 'edit' | 'camera' | 'sound' | 'extras';

export interface Editable { name: string; timeline: Timeline; style: StudioStyle }

interface Props {
  project: StudioProject;
  events: EventLog;
  panel: Panel;
  setPanel(p: Panel): void;
  selection: Selection;
  setSelection(s: Selection): void;
  change(fn: (e: Editable) => Editable, label: string): void;
  time: number;
  srcTime: number;
  busy: string | null;
  progress: number | null;
  actions: {
    split(): void;
    autoZooms(depth: number): void;
    addZoom(): void;
    idle(how: 'cut' | 'speed'): void;
    silences(): void;
    trimStart(): void;
    trimEnd(): void;
    captions(): void;
    privacy(): void;
    drawBlur(): void;
  };
  drawingBlur: boolean;
}

const PANELS: { id: Panel; label: string; icon: string }[] = [
  { id: 'frame', label: 'Frame', icon: 'palette' },
  { id: 'pointer', label: 'Pointer', icon: 'drag' },
  { id: 'zoom', label: 'Zoom', icon: 'search' },
  { id: 'edit', label: 'Edit', icon: 'ruler' },
  { id: 'camera', label: 'Camera', icon: 'camera' },
  { id: 'sound', label: 'Sound', icon: 'audio' },
  { id: 'extras', label: 'Extras', icon: 'sparkle' },
];

const SOLIDS = ['#111827', '#f8fafc', '#1e293b', '#0f766e', '#7c3aed', '#be123c', '#ea580c', '#ca8a04'];
const ASPECTS: { id: Aspect; label: string }[] = [{ id: 'source', label: 'Auto' }, { id: '16:9', label: '16:9' }, { id: '9:16', label: '9:16' }, { id: '1:1', label: '1:1' }, { id: '4:5', label: '4:5' }];

function Row({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="st-row">
      <div className="st-row-text"><div className="st-row-title">{title}</div>{desc ? <div className="st-row-desc">{desc}</div> : null}</div>
      <div className="st-row-control">{children}</div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, show }: { label: string; value: number; min: number; max: number; step: number; onChange(v: number): void; show?: (v: number) => string }) {
  return (
    <label className="st-slider">
      <span className="st-slider-head"><span>{label}</span><span className="num muted">{show ? show(value) : value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} aria-label={label} />
    </label>
  );
}

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div className="seg st-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => <button key={String(o.id)} role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>)}
    </div>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function Inspector(p: Props) {
  const { project, change, selection } = p;
  const st = project.style;
  const set = <K extends keyof StudioStyle>(k: K, patch: Partial<StudioStyle[K]>, label: string) => change((e) => ({ ...e, style: { ...e.style, [k]: { ...e.style[k], ...patch } } }), label);
  const zoom = selection?.kind === 'zoom' ? project.timeline.zooms.find((z) => z.id === selection.id) : undefined;
  const clip = selection?.kind === 'clip' ? project.timeline.clips.find((c) => c.id === selection.id) : undefined;
  const blur = selection?.kind === 'blur' ? project.timeline.blurs.find((b) => b.id === selection.id) : undefined;
  const setZoom = (z: Zoom, label: string) => change((e) => ({ ...e, timeline: { ...e.timeline, zooms: e.timeline.zooms.map((x) => (x.id === z.id ? z : x)) } }), label);
  const setClip = (c: Clip, label: string) => change((e) => ({ ...e, timeline: { ...e.timeline, clips: e.timeline.clips.map((x) => (x.id === c.id ? c : x)) } }), label);
  const removeBlur = (b: BlurBox) => { change((e) => ({ ...e, timeline: { ...e.timeline, blurs: e.timeline.blurs.filter((x) => x.id !== b.id) } }), 'Remove blur'); p.setSelection(null); };
  const bgIs = (b: Background) => JSON.stringify(b) === JSON.stringify(st.frame.background);
  const [custom, setCustom] = useState(st.frame.background.kind === 'gradient' ? st.frame.background : { kind: 'gradient' as const, from: '#6366f1', to: '#ec4899', angle: 135 });
  const hasCam = !!project.meta.webcam;
  const panels = PANELS.filter((x) => x.id !== 'camera' || hasCam);

  return (
    <aside className="studio-inspector" aria-label="Edit settings">
      <div className="st-tabs" role="tablist" aria-label="Settings">
        {panels.map((x) => (
          <button key={x.id} role="tab" id={`st-tab-${x.id}`} aria-selected={p.panel === x.id} aria-controls="st-panel" className={p.panel === x.id ? 'on' : ''} onClick={() => p.setPanel(x.id)} title={x.label}>
            <Icon name={x.icon} size={15} /><span>{x.label}</span>
          </button>
        ))}
      </div>
      <div className="st-panel" id="st-panel" role="tabpanel" aria-labelledby={`st-tab-${p.panel}`}>
        {p.panel === 'frame' ? (
          <>
            <h3>Background</h3>
            <div className="st-swatches" role="radiogroup" aria-label="Background">
              {BACKGROUNDS.map((b) => { const bg: Background = { kind: 'preset', id: b.id }; return <button key={b.id} role="radio" aria-checked={bgIs(bg)} aria-label={b.name} title={b.name} className={`st-swatch ${bgIs(bg) ? 'on' : ''}`} style={{ background: swatchCss(bg) }} onClick={() => set('frame', { background: bg }, 'Background')} />; })}
              {SOLIDS.map((c) => { const bg: Background = { kind: 'solid', color: c }; return <button key={c} role="radio" aria-checked={bgIs(bg)} aria-label={`Plain ${c}`} title={c} className={`st-swatch ${bgIs(bg) ? 'on' : ''}`} style={{ background: c }} onClick={() => set('frame', { background: bg }, 'Background')} />; })}
            </div>
            <div className="st-custom">
              <label className="small">From <input type="color" value={custom.from} onChange={(e) => { const g = { ...custom, from: e.target.value }; setCustom(g); set('frame', { background: g }, 'Background'); }} aria-label="Gradient start colour" /></label>
              <label className="small">To <input type="color" value={custom.to} onChange={(e) => { const g = { ...custom, to: e.target.value }; setCustom(g); set('frame', { background: g }, 'Background'); }} aria-label="Gradient end colour" /></label>
              <label className="small grow">Angle <input type="range" min={0} max={360} step={5} value={custom.angle} onChange={(e) => { const g = { ...custom, angle: +e.target.value }; setCustom(g); set('frame', { background: g }, 'Background'); }} aria-label="Gradient angle" /></label>
            </div>
            <h3>Shape</h3>
            <Seg label="Frame shape" value={st.frame.aspect} options={ASPECTS} onChange={(v) => set('frame', { aspect: v }, 'Frame shape')} />
            <Row title="Follow the pointer in tall and square frames" desc="Shows the part of the screen you are working in, instead of shrinking the whole screen."><Toggle on={st.frame.reframe} onChange={(v) => set('frame', { reframe: v }, 'Reframe')} /></Row>
            <Slider label="Space around" value={st.frame.padding} min={0} max={0.25} step={0.005} show={pct} onChange={(v) => set('frame', { padding: v }, 'Padding')} />
            <Slider label="Rounded corners" value={st.frame.radius} min={0} max={60} step={1} show={(v) => `${v}px`} onChange={(v) => set('frame', { radius: v }, 'Corners')} />
            <Slider label="Shadow" value={st.frame.shadow} min={0} max={1} step={0.05} show={pct} onChange={(v) => set('frame', { shadow: v }, 'Shadow')} />
            <Row title="Window edge" desc="A fine light line around the picture."><Toggle on={st.frame.inset} onChange={(v) => set('frame', { inset: v }, 'Window edge')} /></Row>
          </>
        ) : null}

        {p.panel === 'pointer' ? (
          <>
            {project.meta.cursorInVideo ? <p className="st-note">This recording has the system pointer in the picture (it could not be left out here), so Studio does not draw its own. Zooms still follow it.</p> : null}
            <Row title="Show the pointer"><Toggle on={st.cursor.show} disabled={project.meta.cursorInVideo} onChange={(v) => set('cursor', { show: v }, 'Pointer')} /></Row>
            <Seg label="Pointer look" value={st.cursor.look} options={[{ id: 'arrow', label: 'Arrow' }, { id: 'dot', label: 'Dot' }]} onChange={(v) => set('cursor', { look: v }, 'Pointer look')} />
            <Slider label="Size" value={st.cursor.size} min={0.6} max={4} step={0.1} show={(v) => `${v.toFixed(1)}×`} onChange={(v) => set('cursor', { size: v }, 'Pointer size')} />
            <Slider label="Smooth movement" value={st.cursor.smoothing} min={0} max={1} step={0.05} show={(v) => (v === 0 ? 'Off' : pct(v))} onChange={(v) => set('cursor', { smoothing: v }, 'Smoothing')} />
            <Row title="Hide when still" desc="Fades out when it rests, back as it moves."><Toggle on={st.cursor.hideIdle} onChange={(v) => set('cursor', { hideIdle: v }, 'Hide when still')} /></Row>
            {st.cursor.hideIdle ? <Slider label="Hide after" value={st.cursor.idleMs} min={500} max={10000} step={250} show={(v) => `${(v / 1000).toFixed(1)} s`} onChange={(v) => set('cursor', { idleMs: v }, 'Hide after')} /> : null}
            <Row title="Ripple on clicks"><Toggle on={st.cursor.ripple} onChange={(v) => set('cursor', { ripple: v }, 'Ripple')} /></Row>
            <Slider label="Motion blur" value={st.cursor.motionBlur} min={0} max={1} step={0.05} show={(v) => (v === 0 ? 'Off' : pct(v))} onChange={(v) => set('cursor', { motionBlur: v }, 'Motion blur')} />
          </>
        ) : null}

        {p.panel === 'zoom' ? (
          <>
            {zoom ? (
              <div className="st-card">
                <h3>Selected zoom <span className="muted small num">{fmt(zoom.start)}–{fmt(zoom.end)}</span></h3>
                <Slider label="Depth" value={zoom.scale} min={1.1} max={4} step={0.05} show={(v) => `${v.toFixed(2)}×`} onChange={(v) => setZoom({ ...zoom, scale: v, auto: undefined }, 'Zoom depth')} />
                <Row title="Follow the pointer" desc={zoom.follow ? 'The view moves with the pointer while zoomed.' : 'The view holds on one spot.'}><Toggle on={zoom.follow} onChange={(v) => setZoom({ ...zoom, follow: v, x: zoom.x ?? 0.5, y: zoom.y ?? 0.5, auto: undefined }, 'Zoom follow')} /></Row>
                {!zoom.follow ? (
                  <>
                    <Slider label="Spot across" value={zoom.x ?? 0.5} min={0} max={1} step={0.01} show={pct} onChange={(v) => setZoom({ ...zoom, x: v }, 'Zoom spot')} />
                    <Slider label="Spot down" value={zoom.y ?? 0.5} min={0} max={1} step={0.01} show={pct} onChange={(v) => setZoom({ ...zoom, y: v }, 'Zoom spot')} />
                  </>
                ) : null}
                <button className="btn sm danger" onClick={() => { change((e) => ({ ...e, timeline: { ...e.timeline, zooms: e.timeline.zooms.filter((x) => x.id !== zoom.id) } }), 'Remove zoom'); p.setSelection(null); }}><Icon name="trash" size={13} /> Remove zoom</button>
              </div>
            ) : <p className="st-note">Select a zoom on the timeline to change it, drag it to move it, or drag its ends to make it longer or shorter.</p>}
            <h3>Automatic zooms</h3>
            <p className="st-desc">Made from where you clicked and typed: in a little before, held while you work, out when you are done.</p>
            <Slider label="Depth" value={st.zoom.depth} min={1.2} max={3.5} step={0.05} show={(v) => `${v.toFixed(2)}×`} onChange={(v) => set('zoom', { depth: v }, 'Zoom depth')} />
            <Slider label="Ease in and out" value={st.zoom.ease} min={200} max={1500} step={50} show={(v) => `${(v / 1000).toFixed(2)} s`} onChange={(v) => set('zoom', { ease: v }, 'Zoom ease')} />
            <div className="btn-row">
              <button className="btn sm" onClick={() => p.actions.autoZooms(st.zoom.depth)} disabled={!p.events.clicks.length && !p.events.keys.length} title={!p.events.clicks.length && !p.events.keys.length ? 'No clicks or keys were recorded' : undefined}><Icon name="sparkle" size={13} /> Make zooms again</button>
              <button className="btn sm" onClick={p.actions.addZoom}><Icon name="plus" size={13} /> Zoom at playhead</button>
            </div>
            <p className="st-desc small">{p.events.clicks.length} clicks and {p.events.keys.length} key presses were recorded.</p>
          </>
        ) : null}

        {p.panel === 'edit' ? (
          <>
            <div className="btn-row">
              <button className="btn sm" onClick={p.actions.split}><Icon name="ruler" size={13} /> Split at playhead <kbd>S</kbd></button>
              <button className="btn sm" onClick={p.actions.trimStart}>Trim start here</button>
              <button className="btn sm" onClick={p.actions.trimEnd}>Trim end here</button>
            </div>
            {clip ? (
              <div className="st-card">
                <h3>Selected clip <span className="muted small num">{fmt(clip.start)}–{fmt(clip.end)} of the recording</span></h3>
                <Seg label="Speed" value={clip.speed} options={[0.5, 1, 1.5, 2, 4, 8].map((v) => ({ id: v, label: `${v}×` }))} onChange={(v) => setClip({ ...clip, speed: v }, 'Speed')} />
                <button className="btn sm danger" onClick={() => { change((e) => ({ ...e, timeline: { ...e.timeline, clips: e.timeline.clips.filter((x) => x.id !== clip.id) } }), 'Cut clip'); p.setSelection(null); }} disabled={project.timeline.clips.length < 2}><Icon name="trash" size={13} /> Cut this clip</button>
              </div>
            ) : <p className="st-note">Split the recording at the playhead, then select a part on the timeline to speed it up or cut it. A ✂ between parts puts a cut back.</p>}
            <h3>Clean up automatically</h3>
            <p className="st-desc">Stretches with no clicks, typing or pointer movement.</p>
            <div className="btn-row">
              <button className="btn sm" onClick={() => p.actions.idle('speed')} disabled={!!p.busy}><Icon name="bolt" size={13} /> Speed up idle parts</button>
              <button className="btn sm" onClick={() => p.actions.idle('cut')} disabled={!!p.busy}>Cut idle parts</button>
              <button className="btn sm" onClick={p.actions.silences} disabled={!!p.busy || (!project.meta.mic && !project.meta.system)} title={!project.meta.mic && !project.meta.system ? 'This recording has no sound' : undefined}>Cut silences</button>
            </div>
          </>
        ) : null}

        {p.panel === 'camera' && hasCam ? (
          <>
            <Row title="Show the camera"><Toggle on={st.camera.show} onChange={(v) => set('camera', { show: v }, 'Camera')} /></Row>
            <Seg label="Shape" value={st.camera.shape} options={[{ id: 'circle', label: 'Circle' }, { id: 'rounded', label: 'Rounded' }, { id: 'square', label: 'Square' }]} onChange={(v) => set('camera', { shape: v }, 'Camera shape')} />
            <Slider label="Size" value={st.camera.size} min={0.08} max={0.45} step={0.01} show={pct} onChange={(v) => set('camera', { size: v }, 'Camera size')} />
            <Seg label="Corner" value={st.camera.corner} options={[{ id: 'tl', label: '↖' }, { id: 'tr', label: '↗' }, { id: 'bl', label: '↙' }, { id: 'br', label: '↘' }]} onChange={(v) => set('camera', { corner: v }, 'Camera corner')} />
            <Row title="Move out of the pointer’s way"><Toggle on={st.camera.autoMove} onChange={(v) => set('camera', { autoMove: v }, 'Camera moves')} /></Row>
            <Row title="Mirror"><Toggle on={st.camera.mirror} onChange={(v) => set('camera', { mirror: v }, 'Mirror')} /></Row>
          </>
        ) : null}

        {p.panel === 'sound' ? (
          <>
            {!project.meta.mic && !project.meta.system ? <p className="st-note">This recording has no sound.</p> : null}
            {project.meta.mic ? (
              <>
                <Row title="Microphone"><Toggle on={st.audio.mic} onChange={(v) => set('audio', { mic: v }, 'Microphone')} /></Row>
                <Slider label="Microphone volume" value={st.audio.micVolume} min={0} max={2} step={0.05} show={pct} onChange={(v) => set('audio', { micVolume: v }, 'Microphone volume')} />
                <Row title="Reduce background noise" desc="A gentle filter for fans and hum, applied on export."><Toggle on={st.audio.denoise} onChange={(v) => set('audio', { denoise: v }, 'Noise reduction')} /></Row>
              </>
            ) : null}
            {project.meta.system ? (
              <>
                <Row title="Computer sound"><Toggle on={st.audio.system} onChange={(v) => set('audio', { system: v }, 'Computer sound')} /></Row>
                <Slider label="Computer sound volume" value={st.audio.systemVolume} min={0} max={2} step={0.05} show={pct} onChange={(v) => set('audio', { systemVolume: v }, 'Computer sound volume')} />
              </>
            ) : null}
            {project.meta.mic || project.meta.system ? <Row title="Even loudness" desc="Brings the export to a steady, standard loudness."><Toggle on={st.audio.normalize} onChange={(v) => set('audio', { normalize: v }, 'Even loudness')} /></Row> : null}
          </>
        ) : null}

        {p.panel === 'extras' ? (
          <>
            <h3>Captions</h3>
            <p className="st-desc">Made from the microphone on this computer; nothing is sent anywhere. {project.timeline.captions.length ? `${project.timeline.captions.length} lines.` : ''}</p>
            <div className="btn-row">
              <button className="btn sm" onClick={p.actions.captions} disabled={!!p.busy || (!project.meta.mic && !project.meta.system)}><Icon name="text" size={13} /> {project.timeline.captions.length ? 'Make captions again' : 'Make captions'}</button>
            </div>
            <Row title="Show captions in the video" desc="Or export them as an .srt file beside it."><Toggle on={st.overlay.captions} onChange={(v) => set('overlay', { captions: v }, 'Captions')} /></Row>
            <h3>Keyboard shortcuts</h3>
            <Row title="Show shortcuts as badges"><Toggle on={st.overlay.keys} onChange={(v) => set('overlay', { keys: v }, 'Shortcut badges')} /></Row>
            <Row title="Only shortcuts" desc="Leave ordinary typing out."><Toggle on={st.overlay.shortcutsOnly} onChange={(v) => set('overlay', { shortcutsOnly: v }, 'Only shortcuts')} /></Row>
            <h3>Chapters</h3>
            <p className="st-desc">From the apps you used; saved inside MP4 and WebM exports.</p>
            {project.timeline.chapters.length ? (
              <ol className="st-chapters">
                {project.timeline.chapters.map((c, i) => (
                  <li key={i}><span className="num muted">{fmt(c.t)}</span>
                    <input value={c.title} aria-label={`Chapter ${i + 1} title`} onChange={(e) => change((ed) => ({ ...ed, timeline: { ...ed.timeline, chapters: ed.timeline.chapters.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) } }), 'Chapter title')} />
                    <button className="btn ghost sm icon" aria-label={`Remove chapter ${i + 1}`} onClick={() => change((ed) => ({ ...ed, timeline: { ...ed.timeline, chapters: ed.timeline.chapters.filter((_, j) => j !== i) } }), 'Remove chapter')}><Icon name="close" size={12} /></button>
                  </li>
                ))}
              </ol>
            ) : <p className="st-note">No chapters yet.</p>}
            <div className="btn-row">
              <button className="btn sm" onClick={() => change((e) => ({ ...e, timeline: { ...e.timeline, chapters: [...e.timeline.chapters, { t: p.srcTime, title: 'Chapter' }].sort((a, b) => a.t - b.t) } }), 'Add chapter')}><Icon name="plus" size={13} /> Chapter at playhead</button>
              <button className="btn sm" onClick={() => change((e) => ({ ...e, timeline: { ...e.timeline, chapters: chaptersFrom(p.events, project.meta.duration) } }), 'Chapters from apps')} disabled={!p.events.focus.length}>From the apps used</button>
            </div>
            <h3>Privacy</h3>
            <p className="st-desc">Blur email addresses, keys and tokens that were on screen, found by reading the picture on this computer; or draw your own blur boxes.</p>
            <div className="btn-row">
              <button className="btn sm" onClick={p.actions.privacy} disabled={!!p.busy}><Icon name="eyeOff" size={13} /> Find and blur</button>
              <button className={`btn sm ${p.drawingBlur ? 'primary' : ''}`} aria-pressed={p.drawingBlur} onClick={p.actions.drawBlur}><Icon name="plus" size={13} /> Draw a blur box</button>
            </div>
            {blur ? (
              <div className="st-card">
                <h3>Selected blur <span className="muted small num">{fmt(blur.start)}–{fmt(blur.end)}</span></h3>
                <button className="btn sm danger" onClick={() => removeBlur(blur)}><Icon name="trash" size={13} /> Remove blur</button>
              </div>
            ) : project.timeline.blurs.length ? <p className="st-desc small">{project.timeline.blurs.length} blur boxes. Select one on the timeline to move or remove it.</p> : null}
          </>
        ) : null}

        {p.busy ? (
          <div className="st-busy" role="status" aria-live="polite">
            <div className="spinner sm" aria-hidden />
            <span>{p.busy}{p.progress !== null ? ` ${Math.round(p.progress * 100)}%` : ''}</span>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
