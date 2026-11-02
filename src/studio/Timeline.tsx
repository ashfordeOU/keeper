// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The editor's timeline, in the finished video's time: the kept clips (with
// their speed, and the cuts between them), the zooms (drag to move, drag an
// edge to resize, double-click empty space to add one), blur boxes, captions,
// and ticks where the clicks and keys were.

import { useEffect, useMemo, useRef, useState } from 'react';
import { outputDuration, outToSrc, srcToOut } from '../../core/studio/timeline';
import type { BlurBox, Clip, EventLog, StudioProject, Zoom } from '../../core/studio/types';

export type Selection = { kind: 'zoom' | 'clip' | 'blur'; id: string } | null;

interface Props {
  project: StudioProject;
  events: EventLog;
  time: number;
  selection: Selection;
  onSeek(outMs: number): void;
  onSelect(s: Selection): void;
  onZoom(z: Zoom, label: string): void;
  onAddZoom(srcMs: number): void;
  onBlur(b: BlurBox, label: string): void;
  onRestoreGap(afterIndex: number): void;
}

export const fmt = (ms: number, tenths = false) => {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${(tenths ? r.toFixed(1) : String(Math.floor(r))).padStart(tenths ? 4 : 2, '0')}`;
};

const STEPS = [500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000];

/** Where a span of the recording sits on the output timeline (clamped to what was kept). */
function outSpan(clips: Clip[], start: number, end: number): [number, number] | null {
  let a: number | null = null, b: number | null = null;
  for (const c of clips) {
    const s = Math.max(start, c.start), e = Math.min(end, c.end);
    if (e <= s) continue;
    const os = srcToOut(clips, s)!, oe = srcToOut(clips, e)!;
    a = a === null ? os : Math.min(a, os);
    b = b === null ? oe : Math.max(b, oe);
  }
  return a === null || b === null ? null : [a, b];
}

export function Timeline({ project, events, time, selection, onSeek, onSelect, onZoom, onAddZoom, onBlur, onRestoreGap }: Props) {
  const clips = project.timeline.clips;
  const total = Math.max(1, outputDuration(clips));
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [drag, setDrag] = useState<{ id: string; kind: 'zoom' | 'blur'; mode: 'move' | 'l' | 'r'; x0: number; start: number; end: number } | null>(null);
  const [boxW, setBoxW] = useState(800);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth || 800));
    ro.observe(el);
    setBoxW(el.clientWidth || 800);
    return () => ro.disconnect();
  }, []);
  const width = Math.max(200, boxW - 70) * scale;
  const px = (ms: number) => (ms / total) * width;
  const ms = (x: number) => (x / width) * total;
  const step = STEPS.find((s) => px(s) >= 72) ?? STEPS[STEPS.length - 1];
  const ticks = useMemo(() => { const t: number[] = []; for (let x = 0; x <= total; x += step) t.push(x); return t; }, [total, step]);
  const marks = useMemo(() => {
    const out: { o: number; kind: 'click' | 'key' }[] = [];
    for (const c of events.clicks) { const o = srcToOut(clips, c.t); if (o !== null) out.push({ o, kind: 'click' }); }
    let last = -1e9;
    for (const k of events.keys) { const o = srcToOut(clips, k.t); if (o !== null && o - last > total / 400) { out.push({ o, kind: 'key' }); last = o; } }
    return out;
  }, [events, clips, total]);

  // the track names take the first 64 pixels
  const xOf = (e: { clientX: number }) => Math.max(0, e.clientX - (box.current?.getBoundingClientRect().left ?? 0) + (box.current?.scrollLeft ?? 0) - 64);

  const startDrag = (e: React.PointerEvent, kind: 'zoom' | 'blur', item: { id: string; start: number; end: number }, mode: 'move' | 'l' | 'r') => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    onSelect({ kind, id: item.id });
    setDrag({ id: item.id, kind, mode, x0: xOf(e), start: item.start, end: item.end });
  };

  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = ms(xOf(e) - drag.x0);
    const span = outSpan(clips, drag.start, drag.end);
    if (!span) return;
    let s = drag.start, en = drag.end;
    const dur = project.meta.duration;
    if (drag.mode === 'move') {
      const ns = outToSrc(clips, Math.max(0, span[0] + dx));
      s = Math.max(0, Math.min(dur - (drag.end - drag.start), ns));
      en = s + (drag.end - drag.start);
    } else if (drag.mode === 'l') s = Math.min(drag.end - 300, outToSrc(clips, Math.max(0, span[0] + dx)));
    else en = Math.max(drag.start + 300, outToSrc(clips, Math.min(total, span[1] + dx)));
    if (drag.kind === 'zoom') { const z = project.timeline.zooms.find((x) => x.id === drag.id); if (z) onZoom({ ...z, start: s, end: en, auto: undefined }, 'Move zoom'); }
    else { const b = project.timeline.blurs.find((x) => x.id === drag.id); if (b) onBlur({ ...b, start: s, end: en, auto: undefined }, 'Move blur'); }
  };

  const nudge = (e: React.KeyboardEvent, kind: 'zoom' | 'blur', item: Zoom | BlurBox) => {
    const d = (e.shiftKey ? 1000 : 100) * (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0);
    if (!d) return;
    e.preventDefault();
    const len = item.end - item.start;
    const s = Math.max(0, Math.min(project.meta.duration - len, item.start + d));
    if (kind === 'zoom') onZoom({ ...(item as Zoom), start: s, end: s + len, auto: undefined }, 'Move zoom');
    else onBlur({ ...(item as BlurBox), start: s, end: s + len, auto: undefined }, 'Move blur');
  };

  let acc = 0;
  return (
    <div className="studio-timeline" aria-label="Timeline">
      <div className="tl-tools">
        <span className="small muted num">{fmt(time, true)} / {fmt(total, true)}</span>
        <span className="grow" />
        <label className="small muted tl-scale">Timeline zoom
          <input type="range" min={1} max={12} step={0.5} value={scale} onChange={(e) => setScale(+e.target.value)} aria-label="Timeline zoom" />
        </label>
      </div>
      <div
        className="tl-scroll" ref={box}
        onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}
        onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setScale((s) => Math.max(1, Math.min(12, s * (e.deltaY < 0 ? 1.15 : 0.87)))); } }}
      >
        <div className="tl-inner" style={{ width }}>
          <div className="tl-ruler" onPointerDown={(e) => onSeek(ms(xOf(e)))} role="slider" tabIndex={0} aria-label="Playhead" aria-valuemin={0} aria-valuemax={Math.round(total / 1000)} aria-valuenow={Math.round(time / 1000)} aria-valuetext={fmt(time)}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onSeek(time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5000 : 1000)); } }}>
            {ticks.map((t) => <span key={t} className="tl-tick" style={{ left: px(t) }}>{fmt(t, step < 1000)}</span>)}
          </div>
          <div className="tl-track tl-clips" onPointerDown={(e) => { onSeek(ms(xOf(e))); onSelect(null); }}>
            <span className="tl-label">Clips</span>
            {clips.map((c, i) => {
              const len = (c.end - c.start) / c.speed;
              const left = px(acc);
              acc += len;
              const sel = selection?.kind === 'clip' && selection.id === c.id;
              return (
                <div key={c.id} className="tl-clip-wrap" style={{ left, width: Math.max(2, px(len)) }}>
                  <button className={`tl-clip ${sel ? 'sel' : ''} ${c.speed !== 1 ? 'fast' : ''}`} aria-pressed={sel} aria-label={`Clip ${i + 1}, ${fmt(len)}${c.speed !== 1 ? `, ${c.speed}× speed` : ''}`}
                    onPointerDown={(e) => { e.stopPropagation(); onSelect({ kind: 'clip', id: c.id }); onSeek(ms(xOf(e))); }}>
                    {c.speed !== 1 ? <span className="tl-speed">{c.speed}×</span> : null}
                  </button>
                  {i < clips.length - 1 && clips[i + 1].start - c.end > 40 ? (
                    <button className="tl-gap" title={`Put back the ${fmt(clips[i + 1].start - c.end, true)} cut here`} aria-label="Put back the cut part" onPointerDown={(e) => e.stopPropagation()} onClick={() => onRestoreGap(i)}>✂</button>
                  ) : null}
                </div>
              );
            })}
            {marks.map((m, i) => <span key={i} className={`tl-mark ${m.kind}`} style={{ left: px(m.o) }} aria-hidden />)}
          </div>
          <div className="tl-track tl-zooms" onDoubleClick={(e) => onAddZoom(outToSrc(clips, ms(xOf(e))))} onPointerDown={() => onSelect(null)}>
            <span className="tl-label">Zooms</span>
            {project.timeline.zooms.map((z) => {
              const sp = outSpan(clips, z.start, z.end);
              if (!sp) return null;
              const sel = selection?.kind === 'zoom' && selection.id === z.id;
              return (
                <div key={z.id} className={`tl-block zoom ${sel ? 'sel' : ''} ${z.auto ? 'auto' : ''}`} style={{ left: px(sp[0]), width: Math.max(6, px(sp[1] - sp[0])) }}
                  role="button" tabIndex={0} aria-pressed={sel} aria-label={`Zoom ${z.scale.toFixed(1)}× at ${fmt(sp[0])}, ${fmt(sp[1] - sp[0])} long`}
                  onPointerDown={(e) => startDrag(e, 'zoom', z, 'move')} onKeyDown={(e) => nudge(e, 'zoom', z)} onFocus={() => onSelect({ kind: 'zoom', id: z.id })}>
                  <span className="tl-handle l" onPointerDown={(e) => startDrag(e, 'zoom', z, 'l')} aria-hidden />
                  <span className="tl-block-label">{z.scale.toFixed(1)}×{z.follow ? '' : ' ◎'}</span>
                  <span className="tl-handle r" onPointerDown={(e) => startDrag(e, 'zoom', z, 'r')} aria-hidden />
                </div>
              );
            })}
            {!project.timeline.zooms.length ? <span className="tl-hint">Double-click to add a zoom</span> : null}
          </div>
          {project.timeline.blurs.length || project.timeline.captions.length ? (
            <div className="tl-track tl-overlays">
              <span className="tl-label">Overlays</span>
              {project.timeline.captions.map((c, i) => { const sp = outSpan(clips, c.start, c.end); return sp ? <span key={`c${i}`} className="tl-caption" style={{ left: px(sp[0]), width: Math.max(2, px(sp[1] - sp[0])) }} title={c.text} aria-hidden /> : null; })}
              {project.timeline.blurs.map((b) => {
                const sp = outSpan(clips, b.start, b.end);
                if (!sp) return null;
                const sel = selection?.kind === 'blur' && selection.id === b.id;
                return (
                  <div key={b.id} className={`tl-block blur ${sel ? 'sel' : ''}`} style={{ left: px(sp[0]), width: Math.max(6, px(sp[1] - sp[0])) }} role="button" tabIndex={0} aria-pressed={sel}
                    aria-label={`Blur${b.label ? ` (${b.label})` : ''} at ${fmt(sp[0])}`} onPointerDown={(e) => startDrag(e, 'blur', b, 'move')} onKeyDown={(e) => nudge(e, 'blur', b)} onFocus={() => onSelect({ kind: 'blur', id: b.id })}>
                    <span className="tl-handle l" onPointerDown={(e) => startDrag(e, 'blur', b, 'l')} aria-hidden />
                    <span className="tl-block-label">Blur</span>
                    <span className="tl-handle r" onPointerDown={(e) => startDrag(e, 'blur', b, 'r')} aria-hidden />
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className="tl-playhead" style={{ left: px(time) }} aria-hidden />
        </div>
      </div>
    </div>
  );
}
