// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Video and audio: plays everything — formats Chromium cannot play are
// converted on this computer first. Frame strip, subtitles, speed, loop and
// frame stepping for video; cover art, tags and a waveform for audio.

import { useEffect, useRef, useState } from 'react';
import { formatBytes, formatDuration } from '../../../core/format';
import { toVtt } from '../../../core/docparse';
import { api, isDemo } from '../../api';
import { Icon } from '../../components/Icon';
import { Bar, BarButton, PreviewLoading, PreviewMessage, type ViewerProps } from '../Preview';
import { fetchBytes } from '../util';

/** The original file when it plays, otherwise a converted copy. */
function usePlayableSource(info: ViewerProps['info'], audioOnly: boolean) {
  const [src, setSrc] = useState<string | null>(info.playable ? info.url : null);
  const [converting, setConverting] = useState(!info.playable);
  const [error, setError] = useState<string | null>(null);
  const convert = () => {
    if (isDemo) {
      setError('Playing media works in the desktop app.');
      return;
    }
    setConverting(true);
    setError(null);
    api.preview.transcode(info.path, audioOnly)
      .then((u) => { setSrc(u); setConverting(false); })
      .catch((e: unknown) => { setConverting(false); setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)); });
  };
  useEffect(() => {
    setSrc(info.playable ? info.url : null);
    setError(null);
    if (!info.playable) convert();
    else setConverting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.path]);
  // Called when the element reports it cannot decode the codec inside a playable container.
  const failed = () => {
    if (src === info.url) convert();
    else setError('This file could not be played.');
  };
  return { src, converting, error, failed };
}

async function findSubtitles(path: string): Promise<{ label: string; url: string }[]> {
  if (isDemo) return [];
  const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/';
  const dir = path.slice(0, path.lastIndexOf(sep));
  const stem = path.slice(dir.length + 1).replace(/\.[^.]+$/, '').toLowerCase();
  const list = await api.files.browse(dir).catch(() => []);
  const subs = list.filter((e) => !e.isDir && /\.(srt|vtt)$/i.test(e.name) && e.name.toLowerCase().startsWith(stem));
  const out: { label: string; url: string }[] = [];
  for (const s of subs.slice(0, 6)) {
    const t = await api.preview.text(s.path, 2 * 1024 * 1024).catch(() => null);
    if (!t) continue;
    const label = s.name.slice(stem.length).replace(/^[.\s_-]+/, '').replace(/\.(srt|vtt)$/i, '') || 'Subtitles';
    out.push({ label, url: URL.createObjectURL(new Blob([toVtt(t.text)], { type: 'text/vtt' })) });
  }
  return out;
}

export function VideoViewer({ info, mode }: ViewerProps) {
  const { src, converting, error, failed } = usePlayableSource(info, false);
  const video = useRef<HTMLVideoElement>(null);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [strip, setStrip] = useState<string[]>([]);
  const [subs, setSubs] = useState<{ label: string; url: string }[]>([]);
  const [poster, setPoster] = useState<string | null>(null);
  const full = mode === 'full';

  useEffect(() => {
    setStrip([]);
    setSubs([]);
    void api.files.thumbnail(info.path, 960).then(setPoster).catch(() => undefined);
    if (full && !isDemo) {
      void api.preview.filmstrip(info.path, 12).then(setStrip).catch(() => undefined);
      void findSubtitles(info.path).then(setSubs);
    }
  }, [info.path, full]);

  useEffect(() => {
    if (video.current) video.current.playbackRate = rate;
  }, [rate, src]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      const v = video.current;
      if (!v || (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === ',' || e.key === '.') {
        v.pause();
        v.currentTime = Math.max(0, v.currentTime + (e.key === '.' ? 1 / 30 : -1 / 30));
      } else if (e.key.toLowerCase() === 'k') (v.paused ? v.play() : v.pause());
      else if (e.key.toLowerCase() === 'j') v.currentTime -= 10;
      else if (e.key.toLowerCase() === 'l') v.currentTime += 10;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  if (error) return poster ? <div className="pv-video-poster"><img src={poster} alt="" /><div className="pv-note small">{error}</div></div> : <PreviewMessage icon="video" title="This video could not be played">{error}</PreviewMessage>;
  if (converting || !src) return (
    <div className="pv-video-poster">
      {poster ? <img src={poster} alt="" /> : null}
      <div className="pv-converting"><PreviewLoading label="Preparing this video for playback…" /></div>
    </div>
  );
  const step = (d: number) => {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, v.currentTime + d);
  };
  return (
    <div className="pv-col">
      {full ? (
        <Bar>
          <select className="pv-select" value={rate} onChange={(e) => setRate(+e.target.value)} title="Speed">
            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
          <BarButton icon="repeat" label="Loop" on={loop} onClick={() => setLoop((l) => !l)} />
          <BarButton icon="prev" label="Previous frame (,)" onClick={() => step(-1 / 30)} />
          <BarButton icon="next" label="Next frame (.)" onClick={() => step(1 / 30)} />
          <BarButton icon="external" label="Picture in picture" onClick={() => void video.current?.requestPictureInPicture?.().catch(() => undefined)} />
          {src !== info.url ? <span className="badge accent">Converted for preview</span> : null}
          <span className="grow" />
          {subs.length ? <span className="small muted">{subs.length} subtitle track{subs.length === 1 ? '' : 's'}</span> : null}
        </Bar>
      ) : null}
      <div className="pv-video">
        <video
          ref={video}
          key={src}
          src={src}
          poster={poster ?? undefined}
          controls
          loop={loop}
          autoPlay={full}
          preload="metadata"
          onError={failed}
          onLoadedMetadata={(e) => { if (e.currentTarget.videoWidth === 0 && e.currentTarget.duration > 0 && !/^(webm|mkv)$/.test(info.ext)) { /* audio-only container: fine */ } }}
        >
          {subs.map((s, i) => <track key={s.url} kind="subtitles" label={s.label} src={s.url} default={i === 0} />)}
        </video>
      </div>
      {full && strip.length ? (
        <div className="pv-strip">
          {strip.map((f, i) => (
            <button key={f} onClick={() => { const v = video.current; if (v && v.duration) v.currentTime = ((i + 0.5) * v.duration) / strip.length; }}>
              <img src={f} alt="" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AudioViewer({ info, mode }: ViewerProps) {
  const { src, converting, error, failed } = usePlayableSource(info, true);
  const audio = useRef<HTMLAudioElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const tags = info.audio;
  const full = mode === 'full';

  // Waveform from the decoded audio (files under 120 MB).
  useEffect(() => {
    setPeaks(null);
    if (isDemo || info.size > 120 * 1024 * 1024) return;
    let alive = true;
    (async () => {
      try {
        const buf = await fetchBytes(info.path, 120 * 1024 * 1024);
        const ctx = new OfflineAudioContext(1, 1, 44100);
        const audioBuf = await ctx.decodeAudioData(buf);
        const ch = audioBuf.getChannelData(0);
        const n = 240;
        const block = Math.floor(ch.length / n);
        const out: number[] = [];
        for (let i = 0; i < n; i++) {
          let m = 0;
          for (let j = i * block; j < (i + 1) * block; j += 16) m = Math.max(m, Math.abs(ch[j]));
          out.push(m);
        }
        const max = Math.max(...out, 0.01);
        if (alive) setPeaks(out.map((v) => v / max));
      } catch {
        /* codec the browser cannot decode: no waveform */
      }
    })();
    return () => { alive = false; };
  }, [info.path, info.size]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !peaks) return;
    const g = c.getContext('2d')!;
    const w = c.width;
    const h = c.height;
    g.clearRect(0, 0, w, h);
    const played = dur ? pos / dur : 0;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6d6dff';
    const dim = getComputedStyle(document.documentElement).getPropertyValue('--line-strong').trim() || '#8884';
    peaks.forEach((p, i) => {
      const x = (i / peaks.length) * w;
      const bh = Math.max(2, p * (h - 4));
      g.fillStyle = i / peaks.length <= played ? accent : dim;
      g.fillRect(x, (h - bh) / 2, Math.max(1, w / peaks.length - 1.5), bh);
    });
  }, [peaks, pos, dur]);

  const title = tags?.title || info.name.replace(/\.[^.]+$/, '');
  return (
    <div className={`pv-audio ${full ? 'full' : ''}`}>
      <div className="pv-cover">
        {tags?.cover ? <img src={tags.cover} alt="" /> : <Icon name="audio" size={full ? 64 : 40} stroke={1.3} />}
      </div>
      <div className="pv-audio-meta">
        <div className="pv-audio-title">{title}</div>
        {tags?.artist || tags?.album ? <div className="muted">{[tags.artist, tags.album, tags.year].filter(Boolean).join(' · ')}</div> : null}
        <div className="small muted">{info.format} · {formatBytes(info.size)}{dur ? ` · ${formatDuration(dur)}` : ''}{tags?.genre ? ` · ${tags.genre}` : ''}</div>
      </div>
      {peaks ? (
        <canvas
          ref={canvas}
          width={960}
          height={full ? 120 : 64}
          className="pv-wave"
          onClick={(e) => {
            const a = audio.current;
            if (!a || !a.duration) return;
            const r = e.currentTarget.getBoundingClientRect();
            a.currentTime = ((e.clientX - r.left) / r.width) * a.duration;
          }}
        />
      ) : null}
      {error ? <div className="small muted">{error}</div> : converting || !src ? <PreviewLoading label="Preparing audio…" /> : (
        <audio
          ref={audio}
          key={src}
          src={src}
          controls
          autoPlay={full}
          onError={failed}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        />
      )}
      {src && src !== info.url ? <span className="badge accent">Converted for preview</span> : null}
    </div>
  );
}
