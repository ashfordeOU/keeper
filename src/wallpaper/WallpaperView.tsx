// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The page inside a wallpaper window: a scene, a video, a picture or a folder
// of pictures. It draws only while the main process says so (the governor's
// policy) and while the window can be seen.

import { useEffect, useRef, useState } from 'react';
import type { WallpaperFrame } from '../../core/scenes/api';
import type { RenderPolicy } from '../../core/scenes/policy';
import { api } from '../api';
import { SceneRenderer } from './scene-gl';
import { reduceMotion } from '../../core/a11y';
import '../styles/ambience.css';

const fileUrl = (p: string) => api.preview.url(p);

/**
 * Reduce motion (Settings → Accessibility, or the system's own setting): scenes
 * draw one still frame and videos and pictures hold still.
 */
function useCalm(): boolean {
  const sys = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [pref, setPref] = useState<string | undefined>(undefined);
  const [system, setSystem] = useState(sys);
  useEffect(() => {
    const read = () => void api.settings?.get?.().then((s) => setPref(s?.a11y?.motion)).catch(() => undefined);
    read();
    const off = api.on?.('settings-changed', (s: { a11y?: { motion?: string } }) => setPref(s?.a11y?.motion));
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onMq = () => setSystem(sys());
    mq?.addEventListener('change', onMq);
    return () => { off?.(); mq?.removeEventListener('change', onMq); };
  }, []);
  return reduceMotion(pref as 'system' | 'reduce' | 'full' | undefined, system);
}

function Scene({ frame, policy, still, calm }: { frame: WallpaperFrame; policy: RenderPolicy; still: boolean; calm?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const r = useRef<SceneRenderer | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!ref.current) return;
    try {
      r.current = new SceneRenderer(ref.current);
      r.current.onStats = (s) => api.ambience.report(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    return () => { r.current?.dispose(); r.current = null; };
  }, []);
  useEffect(() => {
    const src = frame.source;
    if (src.kind !== 'scene' || !r.current) return;
    r.current.setScene(src.scene, frame.palette.colors, src.params);
    if (still) r.current.drawOnce(() => api.ambience.ready());
    else if (calm) r.current.drawOnce();
  }, [frame, still, calm]);
  useEffect(() => {
    if (!still && !calm) r.current?.setPolicy(policy.run, policy.fps, policy.scale);
    else r.current?.setPolicy(false, 30, 1);
    if (calm && !still) r.current?.drawOnce();
  }, [policy, still, calm]);
  // No WebGL here (no graphics driver, or blocked): the palette as a slowly breathing gradient instead.
  if (error) return <div className={`wp-fallback ${still ? '' : 'wp-breathe'}`} data-error={error} style={{ background: `radial-gradient(120% 90% at 25% 20%, ${frame.palette.colors[3]}66, transparent 60%), linear-gradient(160deg, ${frame.palette.colors.join(', ')})`, animationPlayState: policy.run && !still ? 'running' : 'paused' }} ref={() => { if (still) api.ambience.ready(); }} />;
  return <canvas ref={ref} className="wp-canvas" />;
}

function Video({ path, run, still, rate }: { path: string; run: boolean; still: boolean; rate?: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.playbackRate = rate ?? 1;
    if (run && !still) void v.play().catch(() => undefined);
    else v.pause();
  }, [run, still, rate]);
  return <video ref={ref} className="wp-media" src={fileUrl(path)} muted loop playsInline preload="auto" onLoadedData={(e) => { if (still) { e.currentTarget.currentTime = Math.min(1, e.currentTarget.duration / 2 || 0); api.ambience.ready(); } }} />;
}

function Picture({ path, motion, run, still }: { path: string; motion: string; run: boolean; still: boolean }) {
  return <img className={`wp-media wp-${still ? 'still' : motion}`} style={{ animationPlayState: run && !still ? 'running' : 'paused' }} src={fileUrl(path)} alt="" onLoad={() => still && api.ambience.ready()} />;
}

function Folder({ folder, interval, motion, shuffle, run, still }: { folder: string; interval: number; motion: string; shuffle: boolean; run: boolean; still: boolean }) {
  const [list, setList] = useState<string[]>([]);
  const [i, setI] = useState(0);
  useEffect(() => { void api.widgets.photos(folder).then((l) => setList(shuffle ? [...l].sort(() => Math.random() - 0.5) : l)); }, [folder, shuffle]);
  useEffect(() => {
    if (!run || still || list.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % list.length), Math.max(10, interval) * 1000);
    return () => clearInterval(t);
  }, [run, still, list, interval]);
  if (!list.length) return <div className="wp-fallback" />;
  // Two layers: the next picture fades in over the last.
  return (
    <>
      {list.length > 1 ? <img key={`p${(i + list.length - 1) % list.length}`} className="wp-media" src={fileUrl(list[(i + list.length - 1) % list.length])} alt="" /> : null}
      <img key={`c${i}`} className={`wp-media wp-fadein wp-${still ? 'still' : motion}`} style={{ animationPlayState: run && !still ? 'running' : 'paused' }} src={fileUrl(list[i % list.length])} alt="" onLoad={() => still && api.ambience.ready()} />
    </>
  );
}

export function WallpaperView() {
  const params = new URLSearchParams(location.search);
  const still = params.get('still') === '1';
  const [frame, setFrame] = useState<WallpaperFrame | null>(null);
  const [policy, setPolicy] = useState<RenderPolicy>({ run: false, fps: 30, scale: 0.75 });
  const [fade, setFade] = useState(false);
  const calm = useCalm();
  useEffect(() => {
    document.documentElement.dataset.view = 'wallpaper';
    let first = true;
    const load = () => void api.ambience.frame().then((f) => {
      if (!f) return;
      // Pictures and videos cross-fade through a short dip; scenes fade inside the renderer.
      if (!first && f.source.kind !== 'scene') { setFade(true); setTimeout(() => { setFrame(f); setFade(false); }, 350); } else setFrame(f);
      if (first) setPolicy(f.policy);
      first = false;
    });
    load();
    const offFrame = api.on('wallpaper-frame', load);
    const offPolicy = api.on('wallpaper-policy', (p) => setPolicy(p));
    return () => { offFrame(); offPolicy(); };
  }, []);
  if (!frame) return <div className="wp-root" />;
  const s = frame.source;
  const run = policy.run && !calm;
  return (
    <div className={`wp-root ${fade ? 'fading' : ''}`} data-running={run ? '1' : '0'} data-kind={s.kind} aria-hidden>
      {s.kind === 'scene' ? <Scene frame={frame} policy={policy} still={still} calm={calm} /> : null}
      {s.kind === 'video' ? <Video path={s.path} run={run} still={still} rate={s.rate} /> : null}
      {s.kind === 'image' ? <Picture path={s.path} motion={s.motion} run={run} still={still} /> : null}
      {s.kind === 'folder' ? <Folder folder={s.path} interval={s.interval} motion={s.motion} shuffle={s.shuffle} run={run} still={still} /> : null}
    </div>
  );
}
