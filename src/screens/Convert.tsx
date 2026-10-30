// SPDX-License-Identifier: AGPL-3.0-or-later
// Convert: video, audio, picture, PDF and file tools in one place. Results go
// to a new folder next to the originals, which are never changed.

import { useEffect, useMemo, useState } from 'react';
import { extOf, kindOf } from '../../core/classify';
import { TOOL_INFO, type ConvertCategory, type ConvertCapabilities, type ConvertOp, type ConvertResult, type ConvertTool, type Corner, type HashAlgo } from '../../core/convert-types';
import type { Progress } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { KIND_COLOR, PageHead } from '../components/ui';
import { useStore } from '../state';
import '../styles/screens-m.css';

const CATEGORIES: { id: ConvertCategory; label: string; icon: string }[] = [
  { id: 'video', label: 'Video', icon: 'video' },
  { id: 'audio', label: 'Audio', icon: 'audio' },
  { id: 'image', label: 'Pictures', icon: 'image' },
  { id: 'pdf', label: 'PDF', icon: 'document' },
  { id: 'file', label: 'Any file', icon: 'lock' },
];

type Accept = 'video' | 'audio' | 'image' | 'pdf' | 'keeper-enc' | '*';

function acceptOf(p: string): Accept {
  const e = extOf(p.split(/[\\/]/).pop() ?? '');
  if (e === 'pdf') return 'pdf';
  if (e === 'keeper-enc') return 'keeper-enc';
  const k = kindOf(p.split(/[\\/]/).pop() ?? '');
  return k === 'video' || k === 'audio' || k === 'image' ? k : '*';
}

function fits(tool: ConvertTool, paths: string[]): boolean {
  if (!paths.length) return true;
  const acc = TOOL_INFO[tool].accepts;
  if (acc.includes('*')) return true;
  return paths.every((p) => acc.includes(acceptOf(p)));
}

function defaults(tool: ConvertTool): ConvertOp {
  switch (tool) {
    case 'video.compress': return { tool, targetMb: 25 };
    case 'video.preset': return { tool, preset: 'email' };
    case 'video.convert': return { tool, format: 'mp4' };
    case 'video.trim': return { tool, start: 0, end: 10 };
    case 'video.audio': return { tool, format: 'mp3' };
    case 'video.mute': return { tool };
    case 'video.rotate': return { tool, degrees: 90 };
    case 'video.speed': return { tool, factor: 2 };
    case 'video.frames': return { tool, fps: 1, format: 'jpg' };
    case 'audio.convert': return { tool, format: 'mp3' };
    case 'audio.normalize': return { tool };
    case 'image.convert': return { tool, format: 'jpg', quality: 85 };
    case 'image.resize': return { tool, maxSide: 1600 };
    case 'image.compress': return { tool, quality: 70 };
    case 'image.strip': return { tool };
    case 'image.rotate': return { tool, degrees: 90 };
    case 'image.watermark': return { tool, text: '', position: 'bottom-right', opacity: 0.7 };
    case 'image.toPdf': return { tool, pageSize: 'a4' };
    case 'image.removeBg': return { tool };
    case 'pdf.merge': return { tool };
    case 'pdf.split': return { tool, ranges: '' };
    case 'pdf.extract': return { tool, pages: '1' };
    case 'pdf.rotate': return { tool, degrees: 90, pages: '' };
    case 'pdf.reorder': return { tool, order: '' };
    case 'pdf.delete': return { tool, pages: '' };
    case 'pdf.number': return { tool, position: 'bottom-center', start: 1 };
    case 'pdf.watermark': return { tool, text: 'CONFIDENTIAL', opacity: 0.2 };
    case 'pdf.compress': return { tool, quality: 60, maxSide: 1600 };
    case 'pdf.encrypt': return { tool, password: '' };
    case 'pdf.decrypt': return { tool, password: '' };
    case 'pdf.toImages': return { tool, format: 'png', dpi: 150 };
    case 'file.checksum': return { tool, algo: 'sha256' };
    case 'file.verify': return { tool, algo: 'sha256', expected: '' };
    case 'file.encrypt': return { tool, password: '' };
    case 'file.decrypt': return { tool, password: '' };
    case 'file.split': return { tool, sizeMb: 25 };
    case 'file.join': return { tool };
  }
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => <button key={String(v)} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="conv-field">
      <span className="conv-label">{label}</span>
      {children}
      {hint ? <span className="small muted">{hint}</span> : null}
    </label>
  );
}

const CORNERS: [Corner, string][] = [['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom'], ['top-right', 'Top right'], ['top-left', 'Top left'], ['center', 'Middle']];

function Options({ op, set, duration, pages }: { op: ConvertOp; set: (o: ConvertOp) => void; duration: number | null; pages: number | null }) {
  const num = (v: string, d = 0) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const pageHint = pages ? `This PDF has ${pages} page${pages === 1 ? '' : 's'}. Use 1-3, 5, 8- or “last”.` : 'Use 1-3, 5, 8- or “last”.';
  switch (op.tool) {
    case 'video.compress':
      return <Field label="Target size (MB)" hint="Keeper picks the best quality that fits."><input className="input" type="number" min={1} value={op.targetMb} onChange={(e) => set({ ...op, targetMb: num(e.target.value, 25) })} /></Field>;
    case 'video.preset':
      return <Field label="Make it fit"><Seg value={op.preset} options={[['email', 'E-mail 25 MB'], ['whatsapp', 'Messaging 16 MB'], ['discord', 'Chat 10 MB'], ['720p', '720p'], ['1080p', '1080p']]} onChange={(preset) => set({ ...op, preset })} /></Field>;
    case 'video.convert':
      return (
        <>
          <Field label="Format"><Seg value={op.format} options={[['mp4', 'MP4'], ['webm', 'WebM'], ['mov', 'MOV'], ['gif', 'GIF']]} onChange={(format) => set({ ...op, format })} /></Field>
          <Field label="Width (optional)" hint={op.format === 'gif' ? 'GIFs default to 480 px wide at 12 frames a second.' : 'Leave empty to keep the size.'}>
            <input className="input" type="number" min={16} value={op.width ?? ''} placeholder="Keep" onChange={(e) => set({ ...op, width: e.target.value ? num(e.target.value) : undefined })} />
          </Field>
          {op.format === 'gif' ? <Field label="Frames per second"><input className="input" type="number" min={1} max={30} value={op.fps ?? 12} onChange={(e) => set({ ...op, fps: num(e.target.value, 12) })} /></Field> : null}
        </>
      );
    case 'video.trim':
      return (
        <div className="row">
          <Field label="Start (seconds)"><input className="input" type="number" min={0} step={0.1} value={op.start} onChange={(e) => set({ ...op, start: num(e.target.value) })} /></Field>
          <Field label="End (seconds)" hint={duration ? `The clip is ${mmss(duration)} long.` : undefined}><input className="input" type="number" min={0} step={0.1} value={op.end} onChange={(e) => set({ ...op, end: num(e.target.value) })} /></Field>
        </div>
      );
    case 'video.audio':
      return <Field label="Format"><Seg value={op.format} options={[['mp3', 'MP3'], ['m4a', 'M4A']]} onChange={(format) => set({ ...op, format })} /></Field>;
    case 'video.rotate':
    case 'image.rotate':
      return <Field label="Turn by"><Seg value={op.degrees} options={[[90, '90° right'], [180, '180°'], [270, '90° left']]} onChange={(degrees) => set({ ...op, degrees })} /></Field>;
    case 'video.speed':
      return <Field label="Speed"><Seg value={op.factor} options={[[0.5, '0.5×'], [1.5, '1.5×'], [2, '2×'], [4, '4×'], [8, '8×']]} onChange={(factor) => set({ ...op, factor })} /></Field>;
    case 'video.frames':
      return (
        <>
          <Field label="Pictures per second"><input className="input" type="number" min={0.1} step={0.1} value={op.fps} onChange={(e) => set({ ...op, fps: num(e.target.value, 1) })} /></Field>
          <Field label="Format"><Seg value={op.format} options={[['jpg', 'JPEG'], ['png', 'PNG']]} onChange={(format) => set({ ...op, format })} /></Field>
        </>
      );
    case 'audio.convert':
      return <Field label="Format"><Seg value={op.format} options={[['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV'], ['flac', 'FLAC'], ['ogg', 'OGG']]} onChange={(format) => set({ ...op, format })} /></Field>;
    case 'image.convert':
      return (
        <>
          <Field label="Format"><Seg value={op.format} options={[['jpg', 'JPEG'], ['png', 'PNG'], ['webp', 'WebP'], ['avif', 'AVIF'], ['tiff', 'TIFF'], ['gif', 'GIF']]} onChange={(format) => set({ ...op, format })} /></Field>
          {['jpg', 'webp', 'avif'].includes(op.format) ? <Field label={`Quality ${op.quality ?? 85}`}><input type="range" min={30} max={100} value={op.quality ?? 85} onChange={(e) => set({ ...op, quality: +e.target.value })} /></Field> : null}
        </>
      );
    case 'image.resize':
      return (
        <>
          <Field label="Resize by"><Seg value={op.percent ? 'percent' : 'side'} options={[['side', 'Longest side'], ['percent', 'Percent']]} onChange={(v) => set(v === 'percent' ? { tool: op.tool, percent: 50 } : { tool: op.tool, maxSide: 1600 })} /></Field>
          {op.percent
            ? <Field label="Percent"><input className="input" type="number" min={1} max={400} value={op.percent} onChange={(e) => set({ ...op, percent: num(e.target.value, 50) })} /></Field>
            : <Field label="Longest side (pixels)" hint="Smaller pictures are left as they are."><input className="input" type="number" min={16} value={op.maxSide ?? 1600} onChange={(e) => set({ ...op, maxSide: num(e.target.value, 1600) })} /></Field>}
        </>
      );
    case 'image.compress':
      return <Field label={`Quality ${op.quality}`} hint="70 looks the same to most eyes and is often half the size."><input type="range" min={20} max={95} value={op.quality} onChange={(e) => set({ ...op, quality: +e.target.value })} /></Field>;
    case 'image.watermark':
      return (
        <>
          <Field label="Text"><input className="input" value={op.text} placeholder="© Your name" onChange={(e) => set({ ...op, text: e.target.value })} /></Field>
          <Field label="Where"><select className="input" value={op.position} onChange={(e) => set({ ...op, position: e.target.value as Corner })}>{CORNERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label={`Opacity ${Math.round(op.opacity * 100)}%`}><input type="range" min={10} max={100} value={Math.round(op.opacity * 100)} onChange={(e) => set({ ...op, opacity: +e.target.value / 100 })} /></Field>
        </>
      );
    case 'image.toPdf':
      return <Field label="Page size" hint="Pictures are added in the order shown above."><Seg value={op.pageSize} options={[['a4', 'A4'], ['letter', 'Letter'], ['fit', 'Fit picture']]} onChange={(pageSize) => set({ ...op, pageSize })} /></Field>;
    case 'pdf.split':
      return <Field label="Ranges (optional)" hint="Empty makes one PDF per page. “1-3, 4-6” makes two PDFs."><input className="input" value={op.ranges ?? ''} placeholder="Every page" onChange={(e) => set({ ...op, ranges: e.target.value })} /></Field>;
    case 'pdf.extract':
      return <Field label="Pages" hint={pageHint}><input className="input" value={op.pages} onChange={(e) => set({ ...op, pages: e.target.value })} /></Field>;
    case 'pdf.delete':
      return <Field label="Pages to delete" hint={pageHint}><input className="input" value={op.pages} placeholder="2, 5-6" onChange={(e) => set({ ...op, pages: e.target.value })} /></Field>;
    case 'pdf.reorder':
      return <Field label="New order" hint={`List every page in the order you want, e.g. ${pages && pages > 2 ? `3, 1-2, 4-${pages}` : '3, 1, 2'} or ${pages ? `${pages}-1` : 'last-1'} to reverse.`}><input className="input" value={op.order} onChange={(e) => set({ ...op, order: e.target.value })} /></Field>;
    case 'pdf.rotate':
      return (
        <>
          <Field label="Turn by"><Seg value={op.degrees} options={[[90, '90° right'], [180, '180°'], [270, '90° left']]} onChange={(degrees) => set({ ...op, degrees })} /></Field>
          <Field label="Pages (optional)" hint="Empty turns every page."><input className="input" value={op.pages ?? ''} placeholder="All pages" onChange={(e) => set({ ...op, pages: e.target.value })} /></Field>
        </>
      );
    case 'pdf.number':
      return (
        <>
          <Field label="Where"><select className="input" value={op.position} onChange={(e) => set({ ...op, position: e.target.value as Corner })}>{CORNERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Start at"><input className="input" type="number" min={0} value={op.start ?? 1} onChange={(e) => set({ ...op, start: num(e.target.value, 1) })} /></Field>
        </>
      );
    case 'pdf.watermark':
      return (
        <>
          <Field label="Text"><input className="input" value={op.text} onChange={(e) => set({ ...op, text: e.target.value })} /></Field>
          <Field label={`Opacity ${Math.round(op.opacity * 100)}%`}><input type="range" min={5} max={80} value={Math.round(op.opacity * 100)} onChange={(e) => set({ ...op, opacity: +e.target.value / 100 })} /></Field>
        </>
      );
    case 'pdf.compress':
      return (
        <>
          <Field label={`Photo quality ${op.quality}`}><input type="range" min={25} max={90} value={op.quality} onChange={(e) => set({ ...op, quality: +e.target.value })} /></Field>
          <Field label="Largest photo side (pixels)"><Seg value={op.maxSide} options={[[1000, 'Screen'], [1600, 'Balanced'], [2400, 'Print']]} onChange={(maxSide) => set({ ...op, maxSide })} /></Field>
        </>
      );
    case 'pdf.encrypt':
    case 'file.encrypt':
      return <Field label="Password" hint={op.tool === 'file.encrypt' ? 'Keeper cannot recover a lost password — keep it somewhere safe.' : 'Uses AES-256, which every current PDF reader supports.'}><input className="input" type="password" autoComplete="new-password" value={op.password} onChange={(e) => set({ ...op, password: e.target.value })} /></Field>;
    case 'pdf.decrypt':
    case 'file.decrypt':
      return <Field label="Password"><input className="input" type="password" value={op.password} onChange={(e) => set({ ...op, password: e.target.value })} /></Field>;
    case 'pdf.toImages':
      return (
        <>
          <Field label="Format"><Seg value={op.format} options={[['png', 'PNG'], ['jpg', 'JPEG']]} onChange={(format) => set({ ...op, format })} /></Field>
          <Field label="Sharpness"><Seg value={op.dpi} options={[[72, 'Screen'], [150, 'Good'], [300, 'Print']]} onChange={(dpi) => set({ ...op, dpi })} /></Field>
        </>
      );
    case 'file.checksum':
      return <Field label="Kind"><Seg<HashAlgo> value={op.algo} options={[['sha256', 'SHA-256'], ['sha512', 'SHA-512'], ['sha1', 'SHA-1'], ['md5', 'MD5']]} onChange={(algo) => set({ ...op, algo })} /></Field>;
    case 'file.verify':
      return <Field label="Checksum from the website" hint="Paste it as shown; the kind is detected from its length."><input className="input mono" value={op.expected} placeholder="e.g. 9f86d08188…" onChange={(e) => set({ ...op, expected: e.target.value })} /></Field>;
    case 'file.split':
      return <Field label="Part size (MB)" hint="Join the parts again with Join parts."><Seg value={op.sizeMb} options={[[8, '8 MB'], [25, '25 MB'], [100, '100 MB'], [1024, '1 GB'], [4000, '4 GB']]} onChange={(sizeMb) => set({ ...op, sizeMb })} /></Field>;
    default:
      return <div className="small muted">No options needed.</div>;
  }
}

function canRun(op: ConvertOp, files: string[]): string | null {
  if (!files.length) return 'Add files first';
  if (!fits(op.tool, files)) return `This tool works on ${TOOL_INFO[op.tool].accepts.join(' or ')} files`;
  if (TOOL_INFO[op.tool].multi && op.tool === 'pdf.merge' && files.length < 2) return 'Add at least two PDFs to merge';
  if ('password' in op && !op.password) return 'Type a password';
  if ('text' in op && !op.text.trim()) return 'Type the text';
  if (op.tool === 'file.verify' && !op.expected.trim()) return 'Paste the checksum';
  if ((op.tool === 'pdf.extract' && !op.pages.trim()) || (op.tool === 'pdf.delete' && !op.pages.trim()) || (op.tool === 'pdf.reorder' && !op.order.trim())) return 'List the pages';
  if (op.tool === 'video.trim' && !(op.end > op.start)) return 'The end must be after the start';
  return null;
}

export function Convert() {
  const { route, info, toast } = useStore();
  const initial = useMemo<string[]>(() => {
    try {
      const v = route.arg ? JSON.parse(route.arg) : [];
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }, [route.arg]);
  const [files, setFiles] = useState<string[]>(initial);
  const firstAccept = files[0] ? acceptOf(files[0]) : 'video';
  const [cat, setCat] = useState<ConvertCategory>(firstAccept === 'pdf' ? 'pdf' : firstAccept === 'image' ? 'image' : firstAccept === 'audio' ? 'audio' : firstAccept === '*' || firstAccept === 'keeper-enc' ? 'file' : 'video');
  const [op, setOp] = useState<ConvertOp>(() => defaults(firstAccept === 'pdf' ? 'pdf.compress' : firstAccept === 'image' ? 'image.convert' : firstAccept === 'audio' ? 'audio.convert' : firstAccept === 'keeper-enc' ? 'file.decrypt' : firstAccept === '*' ? 'file.checksum' : 'video.compress'));
  const [outDir, setOutDir] = useState<string | null>(null);
  const [caps, setCaps] = useState<ConvertCapabilities | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => setFiles(initial), [initial]);
  useEffect(() => { void api.convert.capabilities().then(setCaps); }, []);
  useEffect(() => api.on('progress', (p: Progress) => { if (p.task === 'convert') setProgress(p); }), []);
  // Facts that make the options smarter: clip length for trimming, page count for PDFs.
  useEffect(() => {
    setDuration(null);
    setPages(null);
    const f = files[0];
    if (!f) return;
    const a = acceptOf(f);
    if (a === 'video' || a === 'audio') void api.convert.duration(f).then((d) => {
      setDuration(d);
      if (d) setOp((o) => (o.tool === 'video.trim' && o.end === 10 ? { ...o, end: Math.round(d * 10) / 10 } : o));
    });
    if (a === 'pdf') void api.convert.pageCount(f).then(setPages);
  }, [files]);

  const add = (paths: string[]) => setFiles((cur) => [...cur, ...paths.filter((p) => !cur.includes(p))]);
  const move = (i: number, d: -1 | 1) => setFiles((cur) => {
    const n = [...cur];
    const j = i + d;
    if (j < 0 || j >= n.length) return cur;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  const tools = (Object.keys(TOOL_INFO) as ConvertTool[]).filter((t) => TOOL_INFO[t].category === cat);
  const blocked = canRun(op, files);
  const missing =
    op.tool.startsWith('video') || op.tool.startsWith('audio') ? (caps && !caps.ffmpeg ? 'The video engine is missing from this copy of Keeper.' : null)
    : op.tool === 'image.removeBg' && caps && !caps.bgRemoval ? 'Background removal is not available in this copy of Keeper.'
    : op.tool === 'pdf.toImages' && caps && !caps.pdfRender ? 'Drawing PDF pages is not available here.'
    : null;

  const run = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    setProgress({ task: 'convert', phase: 'Starting', done: 0, total: 1 });
    try {
      const r = await api.convert.run({ op, inputs: files, outDir: outDir ?? undefined });
      setResult(r);
      if (r.outputs.length) toast(`${TOOL_INFO[op.tool].label}: ${r.outputs.length} new file${r.outputs.length === 1 ? '' : 's'}`);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setRunning(false);
    }
  };

  const name = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="conv">
      <PageHead title="Convert" sub="Video, audio, pictures, PDFs and any file — on this computer. Results go to a new folder; your originals are never changed." />

      <div
        className={`card pad conv-drop ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const paths = [...e.dataTransfer.files].map((f) => api.files.pathOf?.(f) ?? (f as File & { path?: string }).path).filter((p): p is string => !!p);
          if (paths.length) add(paths);
        }}
      >
        {files.length ? (
          <div className="conv-files">
            {files.map((p, i) => (
              <div key={p} className="conv-file">
                <span className="dot" style={{ background: KIND_COLOR[acceptOf(p) === 'pdf' ? 'document' : acceptOf(p) === '*' || acceptOf(p) === 'keeper-enc' ? 'other' : (acceptOf(p) as 'video')] }} />
                <span className="ellipsis grow" title={p}>{name(p)}</span>
                {files.length > 1 ? (
                  <>
                    <button className="btn ghost sm icon" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrowUp" size={12} /></button>
                    <button className="btn ghost sm icon" title="Move down" disabled={i === files.length - 1} onClick={() => move(i, 1)}><Icon name="chevronDown" size={12} /></button>
                  </>
                ) : null}
                <button className="btn ghost sm icon" title="Remove" onClick={() => setFiles(files.filter((x) => x !== p))}><Icon name="close" size={12} /></button>
              </div>
            ))}
          </div>
        ) : (
          <div className="conv-empty">
            <Icon name="drop" size={28} stroke={1.4} />
            <div><b>Drop files here</b> or choose them. You can also right-click any file in Keeper and pick <b>Convert…</b></div>
          </div>
        )}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => void api.settings.pickFiles().then(add)}><Icon name="plus" size={14} /> Choose files</button>
          {files.length ? <button className="btn ghost" onClick={() => { setFiles([]); setResult(null); }}>Clear</button> : null}
        </div>
      </div>

      <div className="seg conv-cats">
        {CATEGORIES.map((c) => (
          <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => { setCat(c.id); setOp(defaults((Object.keys(TOOL_INFO) as ConvertTool[]).find((t) => TOOL_INFO[t].category === c.id && fits(t, files)) ?? (Object.keys(TOOL_INFO) as ConvertTool[]).find((t) => TOOL_INFO[t].category === c.id)!)); setResult(null); setError(null); }}>
            <Icon name={c.icon} size={14} /> {c.label}
          </button>
        ))}
      </div>

      <div className="conv-grid">
        <div className="conv-tools">
          {tools.map((t) => {
            const ok = fits(t, files);
            return (
              <button key={t} className={`conv-tool ${op.tool === t ? 'on' : ''} ${ok ? '' : 'dim'}`} onClick={() => { setOp(defaults(t)); setResult(null); setError(null); }} title={ok ? TOOL_INFO[t].description : `Works on ${TOOL_INFO[t].accepts.join(' or ')} files`}>
                <b>{TOOL_INFO[t].label}</b>
                <span>{TOOL_INFO[t].description}</span>
              </button>
            );
          })}
        </div>

        <div className="card pad conv-panel">
          <h2>{TOOL_INFO[op.tool].label}</h2>
          <div className="sub small" style={{ marginBottom: 12 }}>{TOOL_INFO[op.tool].description}</div>
          <div className="col" style={{ gap: 12 }}>
            <Options op={op} set={setOp} duration={duration} pages={pages} />
            {!['file.checksum', 'file.verify'].includes(op.tool) ? (
              <Field label="Save to">
                <div className="row">
                  <span className="ellipsis small grow" title={outDir ?? ''}>{outDir ? outDir.replace(info?.home ?? '\u0000', '~') : 'A new folder next to the file'}</span>
                  <button className="btn sm" onClick={() => void api.settings.pickFolder().then((d) => d && setOutDir(d))}>Choose…</button>
                  {outDir ? <button className="btn sm ghost" onClick={() => setOutDir(null)}>Reset</button> : null}
                </div>
              </Field>
            ) : null}
          </div>

          {missing ? <div className="conv-warn small"><Icon name="warning" size={14} /> {missing}</div> : null}

          <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
            <span className="small muted">{blocked ?? `${files.length} file${files.length === 1 ? '' : 's'}`}</span>
            <button className="btn primary" disabled={!!blocked || running || !!missing} onClick={() => void run()}>
              {running ? <span className="spinner" /> : <Icon name="sparkle" size={14} />} {running ? 'Working…' : 'Run'}
            </button>
          </div>

          {running && progress ? (
            <div style={{ marginTop: 12 }}>
              <div className="progress"><i style={{ width: `${pct}%` }} /></div>
              <div className="small muted" style={{ marginTop: 4 }}>{progress.phase} · {pct}%</div>
            </div>
          ) : null}

          {error ? <div className="conv-error small"><Icon name="warning" size={14} /> {error}</div> : null}

          {result ? (
            <div className="conv-result">
              {result.message ? <div className={`badge ${result.verified === false ? 'danger' : 'ok'}`} style={{ height: 'auto', padding: '4px 10px', whiteSpace: 'normal' }}>{result.message}</div> : null}
              {result.checksums?.map((c) => (
                <div key={c.path} className="conv-out">
                  <span className="ellipsis grow"><b>{name(c.path)}</b><br /><span className="mono small" style={{ userSelect: 'text' }}>{c.algo.toUpperCase()} {c.hash}</span></span>
                  <button className="btn sm" onClick={() => void api.files.copyText(c.hash)}><Icon name="copy" size={12} /> Copy</button>
                </div>
              ))}
              {result.outputs.slice(0, 50).map((o) => (
                <div key={o} className="conv-out">
                  <Icon name="check" size={14} style={{ color: 'var(--ok)' }} />
                  <span className="ellipsis grow" title={o}>{name(o)}</span>
                  <button className="btn sm" onClick={() => void api.files.open(o)}>Open</button>
                  <button className="btn sm ghost" onClick={() => void api.files.reveal(o)}>Show</button>
                </div>
              ))}
              {result.outputs.length > 50 ? <div className="small muted">…and {result.outputs.length - 50} more in the same folder</div> : null}
              {result.failed?.map((f) => <div key={f.path} className="conv-error small"><b>{name(f.path)}</b>: {f.reason}</div>)}
            </div>
          ) : null}
        </div>
      </div>
      <div className="small muted" style={{ marginTop: 14 }}>
        Everything runs on this computer. Large videos can take a while; you can keep using Keeper meanwhile.
      </div>
    </div>
  );
}
