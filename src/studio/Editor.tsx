// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Studio's editor: the preview, the side panel, the timeline, undo and redo,
// keyboard shortcuts, saving as you go, and export.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OpenedProject } from '../../core/studio/api';
import { smoothPath, trackAt } from '../../core/studio/cursor';
import type { Derived } from '../../core/studio/frame';
import { frameAt } from '../../core/studio/frame';
import { canRedo, canUndo, push, redo, redoLabel, start, undo, undoLabel, type History } from '../../core/studio/history';
import { applyRanges, idleRanges, intersect, mergeTouching, outputDuration, outToSrc, restoreGap, silentRanges, split, trim } from '../../core/studio/timeline';
import { newId, type Aspect, type StudioProject } from '../../core/studio/types';
import { autoZooms } from '../../core/studio/zoom';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useStore } from '../state';
import { ExportDialog } from './ExportDialog';
import { Inspector, type Editable, type Panel } from './Inspector';
import { Preview, type PreviewHandle } from './Preview';
import { Timeline, type Selection } from './Timeline';

const mac = /Mac/.test(navigator.platform);
const mod = mac ? '⌘' : 'Ctrl+';

export function Editor({ opened, onBack }: { opened: OpenedProject; onBack(): void }) {
  const { toast } = useStore();
  const base = opened.project;
  const [hist, setHist] = useState<History<Editable>>(() => start({ name: base.name, timeline: base.timeline, style: base.style }));
  const project: StudioProject = useMemo(() => ({ ...base, ...hist.present }), [base, hist.present]);
  const events = opened.events;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [panel, setPanel] = useState<Panel>('frame');
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [drawingBlur, setDrawingBlur] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [lastExport, setLastExport] = useState<Partial<import('../../core/studio/export').ExportSettings> | undefined>();
  const preview = useRef<PreviewHandle>(null);
  const total = outputDuration(project.timeline.clips);
  const srcTime = outToSrc(project.timeline.clips, time);

  const change = useCallback((fn: (e: Editable) => Editable, label: string) => setHist((h) => push(h, fn(h.present), label)), []);

  // saved shortly after each change
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => void api.studio.save(opened.dir, project).catch((e: unknown) => toast(`Could not save: ${e instanceof Error ? e.message : String(e)}`)), 600);
    return () => clearTimeout(t);
  }, [hist.present]);

  useEffect(() => { void api.studio.options().then((o) => setLastExport(o.lastExport)); }, []);
  useEffect(() => api.on('studio-progress', (p) => setProgress(p.fraction)), []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setProgress(null);
    try { await fn(); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); setProgress(null); }
  };

  const pointer = useMemo(() => { const tr = smoothPath(events, project.meta.duration, 0); return (t: number): [number, number] => { const p = trackAt(tr, t); return [p.x, p.y]; }; }, [events, project.meta.duration]);

  const actions = {
    split: () => change((e) => ({ ...e, timeline: { ...e.timeline, clips: split(e.timeline.clips, srcTime) } }), 'Split'),
    autoZooms: (depth: number) => change((e) => ({ ...e, timeline: { ...e.timeline, zooms: [...e.timeline.zooms.filter((z) => !z.auto), ...autoZooms(events, project.meta.duration, { width: project.meta.width, height: project.meta.height }, { depth }, pointer)].sort((a, b) => a.start - b.start) } }), 'Automatic zooms'),
    addZoom: () => addZoomAt(srcTime),
    idle: (how: 'cut' | 'speed') => {
      const ranges = idleRanges(events, project.meta.duration, { minMs: how === 'cut' ? 4000 : 3000 });
      if (!ranges.length) { toast('No idle stretches were found'); return; }
      change((e) => ({ ...e, timeline: { ...e.timeline, clips: mergeTouching(applyRanges(e.timeline.clips, ranges, how, 6)) } }), how === 'cut' ? 'Cut idle parts' : 'Speed up idle parts');
      toast(`${how === 'cut' ? 'Cut' : 'Sped up'} ${ranges.length} idle ${ranges.length === 1 ? 'stretch' : 'stretches'}`);
    },
    silences: () => void run('Listening for silences…', async () => {
      const { stepMs, levels } = await api.studio.levels(opened.dir);
      const quiet = silentRanges(levels, stepMs);
      // only where nothing happens on screen either
      const ranges = intersect(quiet, idleRanges(events, project.meta.duration, { minMs: 1500, margin: 200 }));
      if (!ranges.length) { toast('No silent, idle stretches were found'); return; }
      change((e) => ({ ...e, timeline: { ...e.timeline, clips: applyRanges(e.timeline.clips, ranges, 'cut') } }), 'Cut silences');
      toast(`Cut ${ranges.length} silent ${ranges.length === 1 ? 'stretch' : 'stretches'}`);
    }),
    trimStart: () => change((e) => ({ ...e, timeline: { ...e.timeline, clips: trim(e.timeline.clips, srcTime, project.meta.duration) } }), 'Trim start'),
    trimEnd: () => change((e) => ({ ...e, timeline: { ...e.timeline, clips: trim(e.timeline.clips, 0, srcTime) } }), 'Trim end'),
    captions: () => void run('Making captions…', async () => {
      const caps = await api.studio.transcribe(opened.dir);
      change((e) => ({ ...e, timeline: { ...e.timeline, captions: caps }, style: { ...e.style, overlay: { ...e.style.overlay, captions: true } } }), 'Captions');
      toast(caps.length ? `${caps.length} caption lines` : 'No speech was found');
    }),
    privacy: () => void run('Reading the screen for private things…', async () => {
      const found = await api.studio.privacyScan(opened.dir, project.timeline.clips);
      change((e) => ({ ...e, timeline: { ...e.timeline, blurs: [...e.timeline.blurs.filter((b) => !b.auto), ...found] } }), 'Privacy blur');
      toast(found.length ? `Blurred ${found.length} ${found.length === 1 ? 'place' : 'places'}` : 'Nothing private was found');
    }),
    drawBlur: () => setDrawingBlur((v) => !v),
  };

  function addZoomAt(src: number) {
    const z = { id: newId('z'), start: Math.max(0, src - 300), end: Math.min(project.meta.duration, src + 2700), scale: project.style.zoom.depth, follow: true };
    change((e) => ({ ...e, timeline: { ...e.timeline, zooms: [...e.timeline.zooms, z].sort((a, b) => a.start - b.start) } }), 'Add zoom');
    setSelection({ kind: 'zoom', id: z.id });
    setPanel('zoom');
  }

  const removeSelection = () => {
    if (!selection) return;
    if (selection.kind === 'zoom') change((e) => ({ ...e, timeline: { ...e.timeline, zooms: e.timeline.zooms.filter((z) => z.id !== selection.id) } }), 'Remove zoom');
    else if (selection.kind === 'blur') change((e) => ({ ...e, timeline: { ...e.timeline, blurs: e.timeline.blurs.filter((z) => z.id !== selection.id) } }), 'Remove blur');
    else if (project.timeline.clips.length > 1) change((e) => ({ ...e, timeline: { ...e.timeline, clips: e.timeline.clips.filter((c) => c.id !== selection.id) } }), 'Cut clip');
    setSelection(null);
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (exporting || t.closest('input, select, textarea, [contenteditable="true"], .modal')) return;
      const cmd = mac ? e.metaKey : e.ctrlKey;
      if (cmd && e.key.toLowerCase() === 'z') { e.preventDefault(); setHist((h) => (e.shiftKey ? redo(h) : undo(h))); return; }
      if (cmd && e.key.toLowerCase() === 'y') { e.preventDefault(); setHist((h) => redo(h)); return; }
      if (cmd && e.key.toLowerCase() === 'e') { e.preventDefault(); setExporting(true); return; }
      if (cmd || e.altKey) return;
      if (e.key === ' ' && !t.closest('button, [role="button"], [role="tab"], [role="radio"]')) { e.preventDefault(); preview.current?.toggle(); }
      else if (e.key.toLowerCase() === 's') { e.preventDefault(); actions.split(); }
      else if (e.key.toLowerCase() === 'z') { e.preventDefault(); addZoomAt(srcTime); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) { e.preventDefault(); removeSelection(); }
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !t.closest('[role="slider"], .tl-block')) { e.preventDefault(); preview.current?.seek(time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1000 : 1000 / 30)); }
      else if (e.key === 'Home') { e.preventDefault(); preview.current?.seek(0); }
      else if (e.key === 'End') { e.preventDefault(); preview.current?.seek(total); }
      else if (e.key === 'Escape') { setSelection(null); setDrawingBlur(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // drawing a blur box on the preview
  const onCanvasMouseDown = drawingBlur ? (e: React.MouseEvent<HTMLCanvasElement>, d: Derived) => {
    const canvas = e.currentTarget;
    const r = canvas.getBoundingClientRect();
    const k = canvas.width / r.width;
    const view = frameAt(project, events, d, time).view;
    const box = d.layout.box;
    const toSrc = (cx: number, cy: number) => ({ x: (view.x + ((cx * k - box.x) / box.w) * view.w) / project.meta.width, y: (view.y + ((cy * k - box.y) / box.h) * view.h) / project.meta.height });
    const x0 = e.clientX - r.left, y0 = e.clientY - r.top;
    let last = { x: x0, y: y0 };
    const moveFn = (ev: MouseEvent) => { last = { x: ev.clientX - r.left, y: ev.clientY - r.top }; setDraft({ x: Math.min(x0, last.x), y: Math.min(y0, last.y), w: Math.abs(last.x - x0), h: Math.abs(last.y - y0) }); };
    const up = () => {
      window.removeEventListener('mousemove', moveFn);
      window.removeEventListener('mouseup', up);
      setDraft(null);
      if (Math.abs(last.x - x0) < 6 || Math.abs(last.y - y0) < 6) return;
      const a = toSrc(Math.min(x0, last.x), Math.min(y0, last.y)), b = toSrc(Math.max(x0, last.x), Math.max(y0, last.y));
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      const blur = { id: newId('b'), start: Math.max(0, srcTime - 1500), end: Math.min(project.meta.duration, srcTime + 3500), x: clamp(a.x), y: clamp(a.y), w: clamp(b.x) - clamp(a.x), h: clamp(b.y) - clamp(a.y) };
      if (blur.w > 0.003 && blur.h > 0.003) {
        change((ed) => ({ ...ed, timeline: { ...ed.timeline, blurs: [...ed.timeline.blurs, blur] } }), 'Add blur');
        setSelection({ kind: 'blur', id: blur.id });
      }
      setDrawingBlur(false);
    };
    window.addEventListener('mousemove', moveFn);
    window.addEventListener('mouseup', up);
  } : undefined;

  const setAspect = (a: Aspect) => change((e) => ({ ...e, style: { ...e.style, frame: { ...e.style.frame, aspect: a } } }), 'Frame shape');

  return (
    <div className="studio-editor" data-testid="studio-editor">
      <header className="studio-bar">
        <button className="btn ghost sm" onClick={onBack} aria-label="Back to recordings"><Icon name="chevronLeft" size={14} /> Recordings</button>
        <input className="studio-name" value={project.name} aria-label="Project name" onChange={(e) => change((ed) => ({ ...ed, name: e.target.value }), 'Rename')} />
        <span className="grow" />
        <button className="btn ghost sm icon" disabled={!canUndo(hist)} onClick={() => setHist(undo)} title={`Undo ${undoLabel(hist) ?? ''} (${mod}Z)`} aria-label={`Undo ${undoLabel(hist) ?? ''}`}><Icon name="undo" size={15} /></button>
        <button className="btn ghost sm icon" disabled={!canRedo(hist)} onClick={() => setHist(redo)} title={`Redo ${redoLabel(hist) ?? ''} (${mod}${mac ? '⇧Z' : 'Y'})`} aria-label={`Redo ${redoLabel(hist) ?? ''}`}><Icon name="undo" size={15} style={{ transform: 'scaleX(-1)' }} /></button>
        <button className="btn sm" onClick={() => void api.studio.reveal(opened.dir)} title="Show the project folder"><Icon name="reveal" size={14} /> Folder</button>
        <button className="btn primary sm" onClick={() => setExporting(true)} data-testid="studio-export"><Icon name="down" size={14} /> Export</button>
      </header>
      {opened.project.meta.notes?.length ? <div className="studio-notes" role="note">{opened.project.meta.notes.map((n, i) => <div key={i}><Icon name="info" size={13} /> {n}</div>)}</div> : null}
      <div className="studio-main">
        <div className="studio-center">
          <Preview
            ref={preview} opened={opened} project={project} events={events} time={time} onTime={setTime} onPlaying={setPlaying}
            onCanvasMouseDown={onCanvasMouseDown}
            overlay={<>
              {drawingBlur ? <div className="studio-draw-hint" role="status">Drag over the part to blur</div> : null}
              {draft ? <div className="studio-draft" style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }} /> : null}
            </>}
          />
          <div className="studio-transport">
            <button className="btn ghost sm icon" onClick={() => preview.current?.seek(0)} aria-label="To the start"><Icon name="prev" size={14} /></button>
            <button className="btn sm studio-play" onClick={() => preview.current?.toggle()} aria-label={playing ? 'Pause' : 'Play'} data-testid="studio-play"><Icon name={playing ? 'pause' : 'play'} size={16} /></button>
            <button className="btn ghost sm icon" onClick={() => preview.current?.seek(total)} aria-label="To the end"><Icon name="next" size={14} /></button>
            <span className="small muted studio-keys">Space play · S split · Z zoom · ⌫ remove · {mod}Z undo · {mod}E export</span>
          </div>
        </div>
        <Inspector
          project={project} events={events} panel={panel} setPanel={setPanel} selection={selection} setSelection={setSelection}
          change={change} time={time} srcTime={srcTime} busy={busy} progress={progress} actions={actions} drawingBlur={drawingBlur}
        />
      </div>
      <Timeline
        project={project} events={events} time={time} selection={selection}
        onSeek={(o) => preview.current?.seek(o)}
        onSelect={(s) => { setSelection(s); if (s?.kind === 'zoom') setPanel('zoom'); else if (s?.kind === 'clip') setPanel('edit'); else if (s?.kind === 'blur') setPanel('extras'); }}
        onZoom={(z, label) => change((e) => ({ ...e, timeline: { ...e.timeline, zooms: e.timeline.zooms.map((x) => (x.id === z.id ? z : x)) } }), label)}
        onBlur={(b, label) => change((e) => ({ ...e, timeline: { ...e.timeline, blurs: e.timeline.blurs.map((x) => (x.id === b.id ? b : x)) } }), label)}
        onAddZoom={addZoomAt}
        onRestoreGap={(i) => change((e) => ({ ...e, timeline: { ...e.timeline, clips: restoreGap(e.timeline.clips, i) } }), 'Put back cut')}
      />
      {exporting ? <ExportDialog dir={opened.dir} project={project} initial={lastExport} setAspect={setAspect} onClose={() => { setExporting(false); void api.studio.options().then((o) => setLastExport(o.lastExport)); }} /> : null}
    </div>
  );
}

