// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The editor's live preview: the recording plays in hidden video and audio
// elements, and every frame is drawn onto a canvas with the same code the
// export uses. Playback follows the timeline: cut parts are skipped, sped-up
// parts play faster, and the microphone, the computer's sound and the camera
// stay in step with the picture.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { OpenedProject } from '../../core/studio/api';
import { drawBackground, drawFrame } from '../../core/studio/draw';
import { derive, frameAt, type Derived } from '../../core/studio/frame';
import { outputSize } from '../../core/studio/layout';
import { clipAtOut, outputDuration, outToSrc, srcToOut } from '../../core/studio/timeline';
import type { EventLog, StudioProject } from '../../core/studio/types';

export interface PreviewHandle {
  play(): void;
  pause(): void;
  toggle(): void;
  seek(outMs: number): void;
  canvas(): HTMLCanvasElement | null;
}

interface Props {
  opened: OpenedProject;
  project: StudioProject;
  events: EventLog;
  time: number;
  onTime(outMs: number): void;
  onPlaying(p: boolean): void;
  /** draw boxes for blur areas (preview only) */
  overlay?: React.ReactNode;
  onCanvasMouseDown?: (e: React.MouseEvent<HTMLCanvasElement>, d: Derived) => void;
}

const mac = /Mac/.test(navigator.platform);

export const Preview = forwardRef<PreviewHandle, Props>(function Preview({ opened, project, events, time, onTime, onPlaying, overlay, onCanvasMouseDown }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const camRef = useRef<HTMLVideoElement>(null);
  const micRef = useRef<HTMLAudioElement>(null);
  const sysRef = useRef<HTMLAudioElement>(null);
  const playing = useRef(false);
  const timeRef = useRef(time);
  const raf = useRef(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const src = { width: project.meta.width, height: project.meta.height };
  const out = useMemo(() => outputSize(project.style.frame.aspect, src, 1080), [project.style.frame.aspect, src.width, src.height]);
  const derived = useMemo(() => derive(project, events, out, mac), [out, events, project.style.frame, project.style.cursor.smoothing, project.style.zoom, project.timeline.zooms, project.style.camera, project.style.overlay.shortcutsOnly, project.meta.duration]);
  const bg = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = out.width;
    c.height = out.height;
    drawBackground(c.getContext('2d')!, project.style.frame.background, out.width, out.height);
    return c;
  }, [out.width, out.height, project.style.frame.background]);
  const latest = useRef({ project, events, derived, bg });
  latest.current = { project, events, derived, bg };
  const hasCam = !!opened.urls.webcam;

  const draw = useCallback(() => {
    const c = canvasRef.current, v = screenRef.current;
    if (!c || !v) return;
    const { project: p, events: ev, derived: d, bg: b } = latest.current;
    const ctx = c.getContext('2d', { alpha: false });
    if (!ctx) return;
    const st = frameAt(p, ev, d, timeRef.current, 60, hasCam);
    // while playing, the picture is the video's own frame; paused, the seeked one
    drawFrame(ctx, st, p.style, { screen: v.readyState >= 2 ? v : null, webcam: camRef.current && camRef.current.readyState >= 2 ? camRef.current : null, background: b });
  }, [hasCam]);

  /** Puts the media elements at the recording time for an output time. */
  const place = useCallback((outMs: number, exact: boolean) => {
    const p = latest.current.project;
    const s = outToSrc(p.timeline.clips, outMs);
    const v = screenRef.current;
    const clip = clipAtOut(p.timeline.clips, outMs)?.clip;
    const rate = clip?.speed ?? 1;
    const sync = (el: HTMLMediaElement | null, offset: number) => {
      if (!el) return;
      const want = (s - offset) / 1000;
      if (want < 0 || (el.duration && want > el.duration)) { el.pause(); return; }
      if (exact || Math.abs(el.currentTime - want) > 0.15) el.currentTime = want;
      el.playbackRate = Math.min(16, rate);
      if (playing.current && el.paused) void el.play().catch(() => undefined);
    };
    if (v) { if (exact || Math.abs(v.currentTime * 1000 - s) > 120) v.currentTime = s / 1000; v.playbackRate = Math.min(16, rate); }
    sync(camRef.current, opened.project.meta.webcam?.offset ?? 0);
    sync(micRef.current, opened.project.meta.mic?.offset ?? 0);
    sync(sysRef.current, opened.project.meta.system?.offset ?? 0);
  }, [opened]);

  const stop = useCallback(() => {
    playing.current = false;
    cancelAnimationFrame(raf.current);
    for (const el of [screenRef.current, camRef.current, micRef.current, sysRef.current]) el?.pause();
    onPlaying(false);
    onTime(timeRef.current);
  }, [onPlaying, onTime]);

  const loop = useCallback(() => {
    if (!playing.current) return;
    const v = screenRef.current!;
    const p = latest.current.project;
    const clips = p.timeline.clips;
    const s = v.currentTime * 1000;
    const at = clipAtOut(clips, timeRef.current);
    const o = srcToOut(clips, s);
    if (at && s >= at.clip.end - 5) {
      // the end of a clip: on to the next one
      const next = clips[at.index + 1];
      if (!next) { timeRef.current = outputDuration(clips); draw(); stop(); return; }
      timeRef.current = at.outStart + (at.clip.end - at.clip.start) / at.clip.speed + 0.5;
      place(timeRef.current, true);
    } else if (o !== null) {
      timeRef.current = o;
      place(o, false);
    } else {
      // inside a cut: jump to where the timeline says
      place(timeRef.current, true);
    }
    draw();
    onTime(timeRef.current);
    raf.current = requestAnimationFrame(loop);
  }, [draw, onTime, place, stop]);

  const play = useCallback(() => {
    const p = latest.current.project;
    const total = outputDuration(p.timeline.clips);
    if (timeRef.current >= total - 30) timeRef.current = 0;
    playing.current = true;
    onPlaying(true);
    place(timeRef.current, true);
    void screenRef.current?.play().then(() => { raf.current = requestAnimationFrame(loop); }).catch((e: unknown) => { setError(String(e)); stop(); });
  }, [loop, onPlaying, place, stop]);

  const seek = useCallback((outMs: number) => {
    const total = outputDuration(latest.current.project.timeline.clips);
    timeRef.current = Math.max(0, Math.min(total, outMs));
    place(timeRef.current, true);
    onTime(timeRef.current);
    if (!playing.current) draw();
  }, [draw, onTime, place]);

  useImperativeHandle(ref, () => ({ play, pause: stop, toggle: () => (playing.current ? stop() : play()), seek, canvas: () => canvasRef.current }), [play, stop, seek]);

  // a change made while paused shows straight away
  useEffect(() => { if (!playing.current) draw(); }, [draw, project, derived, bg]);
  useEffect(() => { if (!playing.current && Math.abs(time - timeRef.current) > 1) seek(time); }, [time, seek]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const vol = (el: HTMLAudioElement | null, v: number, on: boolean) => { if (el) { el.volume = Math.max(0, Math.min(1, v)); el.muted = !on; } };
  useEffect(() => {
    vol(micRef.current, project.style.audio.micVolume, project.style.audio.mic);
    vol(sysRef.current, project.style.audio.systemVolume, project.style.audio.system);
  }, [project.style.audio]);

  const dims = derived.layout.out;
  return (
    <div className="studio-preview">
      <div className="studio-stage" style={{ aspectRatio: `${dims.width} / ${dims.height}` }}>
        <canvas
          ref={canvasRef} width={dims.width} height={dims.height} className="studio-canvas" role="img"
          aria-label={`Preview of ${project.name}`} data-testid="studio-canvas"
          onMouseDown={onCanvasMouseDown ? (e) => onCanvasMouseDown(e, derived) : undefined}
        />
        {overlay}
        {!ready && !error ? <div className="studio-loading" role="status">Loading the recording…</div> : null}
        {error ? <div className="studio-loading error" role="alert">{error}</div> : null}
      </div>
      <video ref={screenRef} src={opened.urls.screen} crossOrigin="anonymous" muted playsInline preload="auto" hidden onLoadedData={() => { setReady(true); seek(timeRef.current); }} onSeeked={() => { if (!playing.current) draw(); }} onError={() => setError('The recording could not be played here.')} />
      {opened.urls.webcam ? <video ref={camRef} src={opened.urls.webcam} crossOrigin="anonymous" muted playsInline preload="auto" hidden onSeeked={() => { if (!playing.current) draw(); }} /> : null}
      {opened.urls.mic ? <audio ref={micRef} src={opened.urls.mic} preload="auto" hidden /> : null}
      {opened.urls.system ? <audio ref={sysRef} src={opened.urls.system} preload="auto" hidden /> : null}
    </div>
  );
});
