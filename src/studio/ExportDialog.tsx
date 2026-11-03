// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Export: a destination preset (or the details by hand), then progress with
// Cancel, and the finished file with Show in Folder and Copy.

import { useEffect, useMemo, useState } from 'react';
import type { ExportJob } from '../../core/studio/api';
import { avcCodec, EXPORT_PRESETS, extensionFor, FPS_CHOICES, LINE_CHOICES, normalizeExport, type ExportSettings } from '../../core/studio/export';
import { outputSize } from '../../core/studio/layout';
import { outputDuration } from '../../core/studio/timeline';
import type { Aspect, StudioProject } from '../../core/studio/types';
import { defaultExpiry, expiryChoices } from '../../core/share-page';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from '../components/Icon';
import { Modal } from '../components/ui';
import { fmt } from './Timeline';

/** What the page's encoder can make at this size. */
export async function encoderSupport(w: number, h: number, fps: number): Promise<{ h264: boolean; vp9: boolean }> {
  const ok = async (codec: string, extra: object = {}) => {
    try { return !!(await VideoEncoder.isConfigSupported({ codec, width: w, height: h, framerate: fps, bitrate: 8e6, ...extra })).supported; } catch { return false; }
  };
  return { h264: await ok(avcCodec({ width: w, height: h }, fps), { avc: { format: 'annexb' } }), vp9: await ok('vp09.00.41.08') };
}

interface Props {
  dir: string;
  project: StudioProject;
  initial?: Partial<ExportSettings>;
  setAspect(a: Aspect): void;
  onClose(): void;
}

export function ExportDialog({ dir, project, initial, setAspect, onClose }: Props) {
  const [preset, setPreset] = useState<string>(() => EXPORT_PRESETS.find((p) => JSON.stringify(p.settings) === JSON.stringify(normalizeExport(initial)))?.id ?? 'custom');
  const [s, setS] = useState<ExportSettings>(() => normalizeExport(initial));
  const [job, setJob] = useState<ExportJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { go } = useStore();
  // Where the finished video goes: this computer only, or also a link in the person's own storage.
  const [dest, setDest] = useState<'file' | 'link'>('file');
  const [target, setTarget] = useState<{ kind: 'none' | 'webdav' | 's3'; where: string; hours: number } | null>(null);
  const [hours, setHours] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState<{ link: string; expiresAt?: number } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  useEffect(() => { void api.studio.shareTarget().then((t) => { setTarget(t); setHours(defaultExpiry(t.kind, t.hours)); }).catch(() => undefined); }, []);
  const out = useMemo(() => outputSize(project.style.frame.aspect, { width: project.meta.width, height: project.meta.height }, s.lines), [project.style.frame.aspect, project.meta.width, project.meta.height, s.lines]);
  const dur = outputDuration(project.timeline.clips);

  useEffect(() => api.on('studio-export', (j) => setJob((cur) => (cur && cur.id === j.id ? j : cur))), []);

  const choose = (id: string) => {
    setPreset(id);
    const p = EXPORT_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setS(p.settings);
    if (p.aspect && p.aspect !== project.style.frame.aspect) setAspect(p.aspect);
  };
  const patch = (x: Partial<ExportSettings>) => { setPreset('custom'); setS((cur) => normalizeExport({ ...cur, ...x })); };

  const start = async () => {
    setErr(null);
    try {
      const can = await encoderSupport(out.width, out.height, s.fps);
      if (dest === 'link' && target?.kind === 'none') { setErr('Choose where links go first.'); return; }
      setJob(await api.studio.export(dir, project, s, can, dest === 'link' ? { hours } : undefined));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const running = job && (job.phase === 'preparing' || job.phase === 'rendering' || job.phase === 'finishing' || job.phase === 'uploading');
  const link = job?.link ?? shared?.link;
  const linkUntil = job?.linkUntil ?? shared?.expiresAt;
  const shareNow = async () => {
    if (!job?.path) return;
    setErr(null);
    setSharing(true);
    try { setShared(await api.studio.share(job.path, dir, { hours })); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setSharing(false); }
  };
  const copyLink = () => { if (link) void api.files.copyText(link).then(() => setLinkCopied(true)); };
  const choices = expiryChoices(target?.kind ?? 'none');
  const eta = job?.speed && job.phase === 'rendering' ? (job.frames - job.done) / job.speed : null;
  const phaseText = !job ? '' : job.phase === 'preparing' ? 'Getting the recording ready…' : job.phase === 'rendering' ? `Drawing frame ${job.done.toLocaleString()} of ${job.frames.toLocaleString()}${job.speed ? ` · ${job.speed.toFixed(0)} frames a second` : ''}${eta !== null && eta > 1 ? ` · about ${fmt(eta * 1000)} left` : ''}` : job.phase === 'finishing' ? 'Adding the sound and finishing the file…' : job.phase === 'uploading' ? 'Uploading to your storage…' : job.phase === 'done' ? 'Done' : job.phase === 'cancelled' ? 'Cancelled' : job.error ?? 'Something went wrong';

  return (
    <Modal title="Export" onClose={() => { if (!running) onClose(); }} width={560}>
      {!job || job.phase === 'cancelled' || job.phase === 'error' ? (
        <>
          <div className="st-presets" role="radiogroup" aria-label="Export preset">
            {EXPORT_PRESETS.map((p) => (
              <button key={p.id} role="radio" aria-checked={preset === p.id} className={`st-preset ${preset === p.id ? 'on' : ''}`} onClick={() => choose(p.id)}>
                <b>{p.name}</b><span>{p.detail}</span>
              </button>
            ))}
          </div>
          <div className="st-export-grid">
            <label>Format
              <select value={s.format} onChange={(e) => patch({ format: e.target.value as ExportSettings['format'] })}>
                <option value="mp4">MP4 (H.264)</option><option value="hevc">MP4 (HEVC)</option><option value="webm">WebM (VP9)</option><option value="gif">GIF</option>
              </select>
            </label>
            <label>Size
              <select value={s.lines} onChange={(e) => patch({ lines: +e.target.value })}>
                {LINE_CHOICES.filter((l) => s.format !== 'gif' || l <= 720).map((l) => <option key={l} value={l}>{l === 2160 ? '4K (2160p)' : `${l}p`}</option>)}
              </select>
            </label>
            <label>Frame rate
              <select value={s.fps} onChange={(e) => patch({ fps: +e.target.value })}>
                {FPS_CHOICES.filter((f) => s.format !== 'gif' || f <= 24).map((f) => <option key={f} value={f}>{f} fps</option>)}
              </select>
            </label>
            <label>Quality
              <select value={s.quality} onChange={(e) => patch({ quality: e.target.value as ExportSettings['quality'] })}>
                <option value="high">High</option><option value="balanced">Balanced</option><option value="small">Smaller file</option>
              </select>
            </label>
          </div>
          <div className="st-export-checks">
            {s.format !== 'gif' ? <label><input type="checkbox" checked={s.chapters} onChange={(e) => patch({ chapters: e.target.checked })} /> Chapters in the file{project.timeline.chapters.length < 2 ? ' (none yet)' : ''}</label> : null}
            <label><input type="checkbox" checked={s.srt} disabled={!project.timeline.captions.length} onChange={(e) => patch({ srt: e.target.checked })} /> Captions as an .srt file{project.timeline.captions.length ? '' : ' (make captions first)'}</label>
          </div>
          <div className="st-dest" role="radiogroup" aria-label="Where the video goes">
            <button role="radio" aria-checked={dest === 'file'} className={`st-dest-opt ${dest === 'file' ? 'on' : ''}`} onClick={() => setDest('file')} data-testid="studio-dest-file">
              <Icon name="down" size={14} /><b>Save to this computer</b>
            </button>
            <button role="radio" aria-checked={dest === 'link'} className={`st-dest-opt ${dest === 'link' ? 'on' : ''}`} onClick={() => setDest('link')} data-testid="studio-dest-link">
              <Icon name="link" size={14} /><b>Upload and copy link</b>
            </button>
          </div>
          {dest === 'link' ? (
            target?.kind === 'none' ? (
              <p className="st-share-note small" data-testid="studio-share-setup">
                Links go to your own storage (a WebDAV server or a storage bucket), never to Keeper. Set it up once in Island settings → Upload & share.{' '}
                <button className="btn sm" onClick={() => { onClose(); go({ name: 'island' }); }}>Set up storage</button>
              </p>
            ) : (
              <div className="st-share-note small">
                <span>Uploads the video and a small page to watch it (chapters, captions, transcript, download) to <b>{target?.where || 'your storage'}</b>, then copies the link.</span>
                <label>Link works for{' '}
                  <select value={hours} onChange={(e) => setHours(Number(e.target.value))} data-testid="studio-share-expiry">
                    {choices.map((c) => <option key={c.hours} value={c.hours}>{c.label}</option>)}
                  </select>
                </label>
                {target?.kind === 'webdav' && hours > 0 ? <span className="muted">The page says the link has ended after that; the file stays on your server until you delete it.</span> : null}
              </div>
            )
          ) : null}
          <p className="small muted">{out.width}×{out.height} · {s.fps} fps · {fmt(dur)} long · saved as .{extensionFor(s.format)} next to the project</p>
          {err || job?.error ? <p className="st-error" role="alert">{err ?? job?.error}</p> : null}
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>Close</button>
            <button className="btn primary" onClick={() => void start()} data-testid="studio-export-start"><Icon name={dest === 'link' ? 'link' : 'down'} size={14} /> {dest === 'link' ? 'Export and Upload' : 'Export'}</button>
          </div>
        </>
      ) : (
        <>
          <div className="st-progress" role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}>
            <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
          <p className="small" role="status" aria-live="polite" data-testid="studio-export-phase">{phaseText}</p>
          {job.phase === 'done' && job.path ? (
            <>
              <p className="st-done"><Icon name="check" size={14} /> <span className="mono small">{job.path}</span></p>
              {job.srt ? <p className="small muted">Captions: {job.srt}</p> : null}
              {link ? (
                <div className="st-link" data-testid="studio-share-link">
                  <Icon name="link" size={14} />
                  <input className="input mono small" readOnly value={link} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
                  <button className="btn sm" onClick={copyLink}><Icon name="copy" size={12} /> {linkCopied ? 'Copied' : 'Copy link'}</button>
                  <button className="btn sm" onClick={() => void api.capture.openLink(link)}><Icon name="external" size={12} /> Open</button>
                </div>
              ) : null}
              {link ? <p className="small muted">The link was copied.{linkUntil ? ` It works until ${new Date(linkUntil).toLocaleString()}.` : ''}</p> : null}
              {job.linkError ? <p className="st-error" role="alert">The video was saved, but the upload did not finish: {job.linkError}</p> : null}
              {err ? <p className="st-error" role="alert">{err}</p> : null}
              <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                {!link && target && target.kind !== 'none' ? <button className="btn" disabled={sharing} onClick={() => void shareNow()} data-testid="studio-share-now"><Icon name="link" size={14} /> {sharing ? 'Uploading…' : 'Upload and copy link'}</button> : null}
                <button className="btn" onClick={() => void api.studio.revealFile(job.path!)}><Icon name="reveal" size={14} /> Show in Folder</button>
                <button className="btn" onClick={() => void api.studio.copyFile(job.path!).then(() => setCopied(true))}><Icon name="copy" size={14} /> {copied ? 'Copied' : 'Copy'}</button>
                <button className="btn primary" onClick={onClose}>Done</button>
              </div>
            </>
          ) : (
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => void api.studio.cancelExport(job.id)}>Cancel</button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
